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
 *     through the raw decision ledger.
 *   - `tier3Invocations`, counted from the moment the LLM call is *made*
 *     (recordTier3Invocation), not from when it happens to succeed — so an
 *     original selector that burns five LLM calls before one finally
 *     resolves shows 5, not 1.
 *   - both ledgers (pending, decisions) are bounded, so neither grows
 *     forever on a long-lived install.
 */
const PENDING_MAX_ENTRIES        = 200;
const HEALING_DECISIONS_MAX_ROWS = 500;
const TIER3_TALLY_CAP            = 200;

class HealingTrust {
    constructor() {
        this.pendingPath   = path.join(__dirname, "..", "..", "..", "data", "healing_pending.json");
        this.decisionsPath = path.join(__dirname, "..", "..", "..", "data", "healing_decisions.json");
        this._queue = Promise.resolve();
        // Selectors whose Tier 3 LLM call has been *made* but haven't (yet,
        // or ever) produced a pending entry — e.g. the LLM returned null, or
        // the resulting locator turned out ambiguous. Folded into
        // `tier3Invocations` the moment a pending entry for that selector is
        // first created. Bounded (TIER3_TALLY_CAP) with LRU-by-touch
        // eviction so a flood of never-successful selectors can't grow this
        // forever.
        this._tier3Tally = new Map();
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
     * warning naming the count and the cap). The pending queue is loaded
     * whole and never truncated on load — only mutation-time recordPending()
     * enforces PENDING_MAX_ENTRIES — but a warning fires if it's already
     * over cap, since that can only mean the cap was lowered or entries were
     * added outside this process.
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

        const pendingCount = Object.keys(this.pending).length;
        if (pendingCount > PENDING_MAX_ENTRIES) {
            Logger.warning(
                `HealingTrust: loaded pending queue has ${pendingCount} entries, exceeding `
                + `PENDING_MAX_ENTRIES (${PENDING_MAX_ENTRIES}); the excess will be trimmed on the next recorded fix.`,
            );
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
     * with the oldest `lastSeen` first. Mutation-time only — `list()` never
     * updates recency and never triggers eviction. Every eviction is logged,
     * naming the evicted selector(s) and their `occurrences` counts (never
     * the description, never the whole entry — security condition 8).
     */
    _evictPendingIfNeeded() {
        const keys = Object.keys(this.pending);
        const overflow = keys.length - PENDING_MAX_ENTRIES;
        if (overflow <= 0) return;

        const toEvict = keys
            .map((key) => ({ key, lastSeenMs: Date.parse(this._getPending(key)?.lastSeen) || 0 }))
            .sort((a, b) => a.lastSeenMs - b.lastSeenMs)
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
     * a legacy entry self-heals the moment it's touched again.
     *
     * `tier3Invocations`: if a pending entry already exists, its count was
     * already bumped in place by `recordTier3Invocation()` before this call
     * (the LLM call that produced this very success), so it's carried
     * through unchanged. If there's no existing entry, the tally recorded by
     * that same invocation lives in `_tier3Tally` under `original` — pull it
     * (defaulting to 0 for the vanishingly unlikely case this was somehow
     * never invoked) and clear it, since it's now folded into the entry.
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

        let tier3Invocations;
        if (existing) {
            tier3Invocations = existing.tier3Invocations ?? 0;
        } else {
            tier3Invocations = this._tier3Tally.get(original) ?? 0;
            this._tier3Tally.delete(original);
        }

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
     * If a pending entry already exists for `original`, its
     * `tier3Invocations` is bumped in place (through `_setPending`,
     * preserving the same prototype-safety as every other pending
     * mutation) and a write is queued. Otherwise the count accrues in
     * `_tier3Tally` — a bounded (TIER3_TALLY_CAP), LRU-by-touch map — until
     * `recordPending()` eventually creates the entry and folds the tally in.
     */
    recordTier3Invocation(original) {
        const existing = this._getPending(original);
        if (existing) {
            this._setPending(original, { ...existing, tier3Invocations: (existing.tier3Invocations ?? 0) + 1 });
            this._queue = this._queue.then(() => AtomicJsonStore.writeJsonAtomic(this.pendingPath, this.pending));
            return;
        }

        if (this._tier3Tally.has(original)) {
            const count = this._tier3Tally.get(original);
            this._tier3Tally.delete(original);
            this._tier3Tally.set(original, count + 1);
        } else {
            if (this._tier3Tally.size >= TIER3_TALLY_CAP) {
                const oldestKey = this._tier3Tally.keys().next().value;
                this._tier3Tally.delete(oldestKey);
            }
            this._tier3Tally.set(original, 1);
        }
    }

    /** All fixes currently awaiting review. Never updates recency. */
    list() {
        return Object.values(this.pending);
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
     */
    approve(original, { approvedBy = "dashboard" } = {}) {
        const entry = this._getPending(original);
        if (!entry) return null;

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
     */
    reject(original, { rejectedBy = "dashboard" } = {}) {
        const entry = this._getPending(original);
        if (!entry) return null;

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
     */
    unreviewedStale({ thresholdDays, now = Date.now() }) {
        const stale = [];
        const notStale = [];
        for (const entry of Object.values(this.pending)) {
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
