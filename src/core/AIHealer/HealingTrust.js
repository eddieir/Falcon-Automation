const path = require("path");
const LocatorStore = require("./LocatorStore");
const Middleware   = require("../Middleware");
const AtomicJsonStore = require("../util/AtomicJsonStore");
const Logger = require("../../../utils/Logger");

/**
 * HealingTrust — Phase 8 approval gate for Tier 3 (LLM-inferred) selector
 * fixes.
 *
 * Before Phase 8, a successful Tier 3 inference was written straight into
 * LocatorStore, so an unreviewed LLM guess was trusted for reuse the moment
 * it happened to click the right element once — exactly what the Roadmap's
 * "Self-healing should never mean silently trusted" called out.
 *
 * New flow:
 *   Tier 3 succeeds -> HealingTrust.recordPending()  (visible, not yet reused)
 *   human approves   -> LocatorStore.addLocator()     (Tier 2 reuses it)
 *   human rejects     -> discarded, kept in the decision ledger for audit
 *
 * Until a human approves it, the same broken selector pays the Tier 3 LLM
 * cost again on every subsequent run. That's intentional: a guess earns no
 * trust just because it worked once.
 *
 * Phase 13 additions — decisions can't rot:
 *   - `previouslyRejected` on every pending entry, so a reviewer sees
 *     up-front whether the exact same (original, suggested) pair was already
 *     turned down before, rather than only discovering that by digging
 *     through the raw decision ledger. It is derived fresh from the
 *     decision ledger on every read (see `_hydratePreviouslyRejected`) — the
 *     copy persisted on the pending entry is a debug/forensic cache only and
 *     is never treated as authoritative, so it can't go stale when a later
 *     decision changes the picture or an old rejection ages out of the
 *     capped ledger.
 *   - `tier3Invocations` — model requests actually issued for this selector
 *     since `firstSeen`, counted from the moment the LLM call is *made*
 *     (`recordTier3Invocation`, called from `AIHealer.getAlternativeSelector`
 *     immediately before the request goes out), not from when it happens to
 *     succeed — so an original selector that burns five LLM calls before one
 *     finally resolves shows 5, not 1. A request that throws, returns null,
 *     resolves ambiguously, or is followed by a healed action that later
 *     fails still counts: the model was genuinely asked.
 *   - both ledgers (pending, decisions) are bounded, so neither grows
 *     forever on a long-lived install.
 */
const PENDING_MAX_ENTRIES        = 200;
const HEALING_DECISIONS_MAX_ROWS = 500;

class HealingTrust {
    constructor() {
        this.pendingPath   = path.join(__dirname, "..", "..", "..", "data", "healing_pending.json");
        this.decisionsPath = path.join(__dirname, "..", "..", "..", "data", "healing_decisions.json");
        this._queue = Promise.resolve();
        // Logs the *first* ledger rotation (mutation-time cap) per process,
        // then stays silent — never a warning per push forever.
        this._decisionsRotationLogged = false;
        this._reload();
    }

    /**
     * (Re)load both files from disk. Exposed for tests that swap the paths
     * after construction.
     *
     * The decisions ledger is capped on load (oldest rows dropped, one
     * warning naming the count and the cap). The pending queue is capped on
     * load too, via the same `_evictPendingIfNeeded()` selection/logging used
     * by the mutation-time path — PENDING_MAX_ENTRIES must be a genuine
     * invariant, not merely a mutation-time behaviour, so a 10,000-entry
     * `healing_pending.json` on a read-only/read-mostly install is trimmed
     * (and every eviction logged, never silently) the moment it's loaded, not
     * left oversized until the next `recordPending()` happens to fire. The
     * trimmed result is persisted through the normal `_queue`/
     * `writeJsonAtomic` chain — `_reload()` itself stays synchronous; only
     * that write is queued — and the write is only queued when something was
     * actually evicted, so a file already at or under the cap is left
     * completely untouched on disk.
     */
    _reload() {
        this.pending   = AtomicJsonStore.readJsonSync(this.pendingPath, {});
        this.decisions = AtomicJsonStore.readJsonSync(this.decisionsPath, []);

        if (this.decisions.length > HEALING_DECISIONS_MAX_ROWS) {
            const totalFound = this.decisions.length;
            const dropped = totalFound - HEALING_DECISIONS_MAX_ROWS;
            this.decisions = this.decisions.slice(-HEALING_DECISIONS_MAX_ROWS);
            Logger.warning(
                `HealingTrust: loaded decisions ledger had ${totalFound} rows, exceeding `
                + `HEALING_DECISIONS_MAX_ROWS (${HEALING_DECISIONS_MAX_ROWS}); dropped ${dropped} oldest row(s).`,
            );
        }

        const evictedCount = this._evictPendingIfNeeded();
        if (evictedCount > 0) {
            // writeJsonAtomic never rejects by design (see AtomicJsonStore),
            // so this can't poison `_queue` — no `.catch` needed, same as
            // every other write queued in this file.
            this._queue = this._queue.then(() => AtomicJsonStore.writeJsonAtomic(this.pendingPath, this.pending));
        }

        this._buildRejectionIndex();
    }

    /**
     * True if `key` is an own entry of `this.pending`. Never delegates to the
     * prototype chain — `"constructor" in this.pending` or a bare
     * `this.pending[key]` read would silently resolve to `Object.prototype`
     * members for keys like "constructor"/"toString", masking a real
     * pending entry (or worse: a bracket *assignment* to "__proto__" would
     * silently repoint the object's own prototype instead of creating a
     * property, and the entry would vanish, unrecoverable, from `list()`).
     * A CSS selector can legitimately be any string, including these, so
     * every access below goes through `_hasPending`/`_getPending`/`_setPending`.
     */
    _hasPending(key) {
        return Object.hasOwn(this.pending, key);
    }

    _getPending(key) {
        return this._hasPending(key) ? this.pending[key] : undefined;
    }

    _setPending(key, value) {
        Object.defineProperty(this.pending, key, {
            value, enumerable: true, configurable: true, writable: true,
        });
    }

    /**
     * Fold `this.decisions` (append-only, in array/time order) into
     * `_rejectionIndex`: `Map<JSON.stringify([original, suggested]), {
     * count, lastRejectedAt, lastRejectedBy }>`. Identity is the exact pair,
     * case-sensitive, no normalisation — a different `suggested` for the
     * same `original`, or a near-miss on case/whitespace, is a different
     * pair entirely.
     *
     * `count` is always derived fresh by folding every matching "rejected"
     * row; it is never read back from a stored aggregate, so it can't drift
     * from the ledger. `lastRejectedAt`/`lastRejectedBy` come from the LAST
     * matching row in ARRAY order — never by parsing/sorting `decidedAt` —
     * so a ledger with out-of-order timestamps (e.g. clock skew) still
     * reports "last" as "most recently appended", which is what actually
     * happened.
     *
     * A row is skipped (without throwing) if `original`/`suggested` aren't
     * strings, `decision` isn't exactly "approved"/"rejected", or
     * `decidedAt` isn't a parseable date. A row that's otherwise well-formed
     * but has a missing/non-string `decidedBy` is NOT malformed — it still
     * counts, contributing `lastRejectedBy: null` if it's the last match.
     *
     * Called from `_reload()` and from `_pushDecision()` — deliberately
     * never folded inside `recordPending()`, which is the hot path of a
     * live browser test and must not pay an O(decisions) cost on every
     * healing attempt.
     */
    _buildRejectionIndex() {
        const index = new Map();
        for (const row of this.decisions) {
            if (!row || typeof row !== "object") continue;
            if (typeof row.original !== "string" || typeof row.suggested !== "string") continue;
            if (row.decision !== "approved" && row.decision !== "rejected") continue;
            if (typeof row.decidedAt !== "string" || Number.isNaN(Date.parse(row.decidedAt))) continue;
            if (row.decision !== "rejected") continue;

            const key = JSON.stringify([row.original, row.suggested]);
            const prior = index.get(key) ?? { count: 0, lastRejectedAt: null, lastRejectedBy: null };
            index.set(key, {
                count: prior.count + 1,
                lastRejectedAt: row.decidedAt,
                lastRejectedBy: typeof row.decidedBy === "string" ? row.decidedBy : null,
            });
        }
        this._rejectionIndex = index;
    }

    /**
     * Keep at most PENDING_MAX_ENTRIES pending entries, evicting the ones
     * with the oldest `lastSeen` first. Called both at mutation-time
     * (`recordPending()`) and from `_reload()` on load, so PENDING_MAX_ENTRIES
     * is a genuine invariant rather than something only enforced when a fix
     * happens to be recorded. Neither caller queues a write from inside this
     * method — `_reload()` and `recordPending()` each decide separately
     * whether/when to queue one — so this stays a pure in-memory selection +
     * log + delete.
     *
     * Determinism: an entry whose `lastSeen` is missing or unparseable can't
     * be shown to be recent, so it's treated as having recency 0 (the oldest
     * possible) and is evicted before any entry with a valid, more recent
     * timestamp. Ties (including ties between multiple missing-`lastSeen`
     * entries) are broken by ascending selector key, so the outcome is
     * stable across runs regardless of object key insertion order.
     *
     * Every eviction is logged, naming the evicted selector(s) and their
     * `occurrences` counts (never the description, never the whole entry —
     * security condition 8). Returns the number of entries evicted (0 if
     * none), so callers can tell whether anything actually changed.
     */
    _evictPendingIfNeeded() {
        const keys = Object.keys(this.pending);
        const overflow = keys.length - PENDING_MAX_ENTRIES;
        if (overflow <= 0) return 0;

        const toEvict = keys
            .map((key) => ({ key, lastSeenMs: Date.parse(this._getPending(key)?.lastSeen) || 0 }))
            .sort((a, b) => a.lastSeenMs - b.lastSeenMs || a.key.localeCompare(b.key))
            .slice(0, overflow);

        const details = toEvict.map(({ key }) => {
            const entry = this._getPending(key);
            return `"${key}" (occurrences: ${entry?.occurrences ?? "unknown"})`;
        });
        Logger.warning(
            `HealingTrust pending cap reached (PENDING_MAX_ENTRIES=${PENDING_MAX_ENTRIES}); evicted `
            + `${toEvict.length} least-recently-seen entr${toEvict.length === 1 ? "y" : "ies"}: ${details.join(", ")}.`,
        );
        for (const { key } of toEvict) delete this.pending[key];
        return toEvict.length;
    }

    /**
     * Record a Tier 3 success as awaiting review. Re-recording the same
     * original selector (it broke again before being reviewed) bumps
     * `occurrences`/`lastSeen` in place instead of creating a duplicate;
     * the latest `suggested`/`description` win, since they reflect the most
     * recent LLM inference for that selector.
     *
     * `previouslyRejected` is always present (never omitted) and is always
     * recomputed fresh from `_rejectionIndex` for the (original, suggested)
     * pair of THIS call — never carried forward from an existing entry — so
     * a legacy entry self-heals the moment it's touched again. This is still
     * only a snapshot at creation/update time, though: it is NOT the
     * authoritative value for reads — see `list()`/`_hydratePreviouslyRejected`,
     * which recompute it again from the live index on every read, so a
     * rejection recorded (or evicted from the ledger) *after* this call
     * still shows up correctly later.
     *
     * `tier3Invocations`: a pending entry only ever exists because a Tier 3
     * request was actually issued and succeeded, so a brand-new entry is
     * seeded at 1 — that request, by definition the first at/after
     * `firstSeen`. If a pending entry already exists, its count was already
     * bumped in place by `recordTier3Invocation()` before this call (the
     * request that produced this very success), so it's carried through
     * unchanged here — never read from any separate tally.
     *
     * @param {Object} opts
     * @param {string} opts.original    - The selector that no longer matched
     * @param {string} opts.suggested   - What the LLM inferred as a replacement
     * @param {string} [opts.description]
     */
    recordPending({ original, suggested, description = "" }) {
        const existing = this._getPending(original);

        const rejectionKey = JSON.stringify([original, suggested]);
        const rejection = this._rejectionIndex.get(rejectionKey)
            ?? { count: 0, lastRejectedAt: null, lastRejectedBy: null };

        const tier3Invocations = existing ? (existing.tier3Invocations ?? 0) : 1;

        const entry = {
            original,
            suggested,
            // A later sighting that arrives without a description must not wipe
            // the one a reviewer already has in front of them.
            description: description || existing?.description || "",
            firstSeen:   existing?.firstSeen ?? new Date().toISOString(),
            lastSeen:    new Date().toISOString(),
            occurrences: (existing?.occurrences ?? 0) + 1,
            tier3Invocations,
            previouslyRejected: {
                count: rejection.count,
                lastRejectedAt: rejection.lastRejectedAt,
                lastRejectedBy: rejection.lastRejectedBy,
            },
        };
        this._setPending(original, entry);
        this._evictPendingIfNeeded();
        this._queue = this._queue.then(() => AtomicJsonStore.writeJsonAtomic(this.pendingPath, this.pending));
        Middleware.emit("healingPending", entry);
        return entry;
    }

    /**
     * Record that a Tier 3 LLM call was *made* for `original` — the
     * invocation boundary, counted regardless of whether the call returns
     * null, resolves ambiguously, or the healed action later fails.
     *
     * Called from `AIHealer.getAlternativeSelector()` immediately before the
     * model request is issued — i.e. before it's known whether this attempt
     * will produce a pending entry at all. If a pending entry already exists
     * for `original`, its `tier3Invocations` is bumped in place (through
     * `_setPending`, preserving the same prototype-safety as every other
     * pending mutation) and a write is queued. If none exists yet, this is a
     * no-op: there is nothing to bump, and nothing is tallied on the side —
     * if this same request goes on to succeed, `recordPending()` seeds the
     * brand-new entry's `tier3Invocations` at 1 for exactly that request.
     */
    recordTier3Invocation(original) {
        const existing = this._getPending(original);
        if (!existing) return;
        this._setPending(original, { ...existing, tier3Invocations: (existing.tier3Invocations ?? 0) + 1 });
        this._queue = this._queue.then(() => AtomicJsonStore.writeJsonAtomic(this.pendingPath, this.pending));
    }

    /**
     * Recompute `previouslyRejected` for one entry from the live
     * `_rejectionIndex`, ignoring whatever value is on the stored entry.
     * Returns a new object (shallow copy) — never the same reference, and
     * never mutates `entry` or anything reachable from `this.pending`.
     */
    _hydratePreviouslyRejected(entry) {
        const rejectionKey = JSON.stringify([entry.original, entry.suggested]);
        const rejection = this._rejectionIndex.get(rejectionKey)
            ?? { count: 0, lastRejectedAt: null, lastRejectedBy: null };
        return {
            ...entry,
            previouslyRejected: {
                count: rejection.count,
                lastRejectedAt: rejection.lastRejectedAt,
                lastRejectedBy: rejection.lastRejectedBy,
            },
        };
    }

    /**
     * All fixes currently awaiting review. Never updates recency, never
     * mutates `this.pending`.
     *
     * `previouslyRejected` on the entries returned here is not read from
     * whatever was persisted on disk — it is recomputed fresh from the
     * current `_rejectionIndex` for each entry's own (original, suggested)
     * pair. A value is written into the persisted pending entry (by
     * `recordPending()`) purely as a debug/forensic cache; it is never
     * authoritative, so a rejection that later ages out of the capped
     * decisions ledger — or one recorded after this entry was created — is
     * always reflected correctly here, in both directions, without ever
     * needing to touch the pending entry again. Every entry returned is a
     * fresh copy, never a reference into `this.pending`.
     */
    list() {
        return Object.values(this.pending).map((entry) => this._hydratePreviouslyRejected(entry));
    }

    /**
     * Push a decision (approved/rejected) onto the ledger: append, then
     * synchronously cap the ledger to the newest HEALING_DECISIONS_MAX_ROWS
     * rows (before the write is queued), then rebuild `_rejectionIndex`,
     * then queue the atomic write. Called from both `approve()` and
     * `reject()`, which enqueue the pendingPath write first — since each
     * `_queue = _queue.then(...)` appends to the same chain in call order,
     * the existing pending-then-decisions write order is preserved exactly.
     */
    _pushDecision(decision) {
        this.decisions.push(decision);
        if (this.decisions.length > HEALING_DECISIONS_MAX_ROWS) {
            this.decisions = this.decisions.slice(-HEALING_DECISIONS_MAX_ROWS);
            if (!this._decisionsRotationLogged) {
                this._decisionsRotationLogged = true;
                Logger.warning(
                    `HealingTrust decisions ledger reached its cap (HEALING_DECISIONS_MAX_ROWS=${HEALING_DECISIONS_MAX_ROWS}) `
                    + "and began discarding its oldest row. Further rotations this process will not be logged individually.",
                );
            }
        }
        this._buildRejectionIndex();
        this._queue = this._queue.then(() => AtomicJsonStore.writeJsonAtomic(this.decisionsPath, this.decisions));
    }

    /**
     * Approve a pending fix. It becomes a trusted Tier 2 alternative
     * (written into LocatorStore) and is removed from the pending queue.
     * Returns null if there is no pending entry for that selector.
     *
     * The decision row is built from a hydrated copy of the entry (see
     * `_hydratePreviouslyRejected`), not the raw `this.pending` value — the
     * raw entry's `previouslyRejected` is only a cache and could be stale,
     * and that field would otherwise be baked into the decision ledger
     * verbatim via the `{...entry}` spread below.
     */
    approve(original, { approvedBy = "dashboard" } = {}) {
        const raw = this._getPending(original);
        if (!raw) return null;
        const entry = this._hydratePreviouslyRejected(raw);

        LocatorStore.addLocator(entry.original, entry.suggested);
        delete this.pending[original];
        this._queue = this._queue.then(() => AtomicJsonStore.writeJsonAtomic(this.pendingPath, this.pending));

        const decision = { ...entry, decision: "approved", decidedAt: new Date().toISOString(), decidedBy: approvedBy };
        this._pushDecision(decision);
        Middleware.emit("healingApproved", decision);
        return decision;
    }

    /**
     * Reject a pending fix. Discarded — never written to LocatorStore — but
     * kept in the decision ledger so a rejected guess doesn't quietly get
     * re-suggested with no record of it having been turned down before.
     * Returns null if there is no pending entry for that selector.
     *
     * As with `approve()`, the decision row is built from a hydrated copy so
     * a stale cached `previouslyRejected` on the raw pending entry never
     * leaks into the ledger.
     */
    reject(original, { rejectedBy = "dashboard" } = {}) {
        const raw = this._getPending(original);
        if (!raw) return null;
        const entry = this._hydratePreviouslyRejected(raw);

        delete this.pending[original];
        this._queue = this._queue.then(() => AtomicJsonStore.writeJsonAtomic(this.pendingPath, this.pending));

        const decision = { ...entry, decision: "rejected", decidedAt: new Date().toISOString(), decidedBy: rejectedBy };
        this._pushDecision(decision);
        Middleware.emit("healingRejected", decision);
        return decision;
    }

    /**
     * Pure read, no writes: split pending entries into stale/not-stale by
     * age of `firstSeen` (a review clock starts the moment a fix is first
     * seen, not each time it recurs). Age = `now - Date.parse(firstSeen)`;
     * stale iff `age > thresholdDays * 86400000` — a record exactly on the
     * boundary is NOT stale. An entry whose `firstSeen` is missing or
     * unparseable is treated as notStale rather than crashing or being
     * silently dropped.
     *
     * As with `list()`, `previouslyRejected` on every returned entry (stale
     * and notStale alike) is recomputed fresh from the live
     * `_rejectionIndex` via `_hydratePreviouslyRejected`, never echoed from
     * whatever is persisted on the pending entry — this is the surface
     * `scripts/review/status.js` and `GET /healing/pending/stale` read, so a
     * rejection that has aged out of the capped decisions ledger must not be
     * reported as still outstanding here either. Hydration also means every
     * returned object is a fresh copy, never `===` an entry in
     * `this.pending` — this stays a pure read that never mutates
     * `this.pending`, never touches recency, and never queues a write.
     */
    unreviewedStale({ thresholdDays, now = Date.now() }) {
        const stale = [];
        const notStale = [];
        for (const rawEntry of Object.values(this.pending)) {
            const entry = this._hydratePreviouslyRejected(rawEntry);
            const firstSeenMs = Date.parse(entry?.firstSeen);
            if (Number.isNaN(firstSeenMs)) {
                notStale.push(entry);
                continue;
            }
            const age = now - firstSeenMs;
            if (age > thresholdDays * 86400000) stale.push(entry);
            else notStale.push(entry);
        }
        return { thresholdDays, stale, notStale };
    }
}

module.exports = new HealingTrust();
