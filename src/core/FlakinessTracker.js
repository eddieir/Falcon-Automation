const path = require("path");
const Middleware = require("./Middleware");
const Logger = require("../../utils/Logger");
const AtomicJsonStore = require("./util/AtomicJsonStore");

/**
 * FlakinessTracker — Phase 9. Persistent pass/fail history per scenario,
 * used to tell a genuinely broken test apart from a flaky one, and to let a
 * human quarantine a known-flaky scenario so it stops blocking CI without
 * ever being silently hidden.
 *
 * Every scenario TestRunner executes is identified by a stable key —
 * `<page url>::<action>::<locator>` — independent of its (occasionally
 * regenerated) human-readable description. Each outcome ("passed" or
 * "failed"; "skipped" carries no signal about the interaction itself and is
 * not recorded) is appended to that scenario's history, capped to the most
 * recent MAX_HISTORY_PER_SCENARIO results.
 *
 * Classification looks only at the most recent WINDOW_SIZE results:
 *   "new"     — fewer than MIN_SAMPLES_FOR_VERDICT results seen yet; not
 *               enough data to say anything.
 *   "stable"  — every recent result passed.
 *   "broken"  — every recent result failed. A real, consistent regression —
 *               this must stay loud, never a quarantine candidate.
 *   "flaky"   — a mix of passes and failures for the exact same
 *               interaction. This is the candidate list a human reviews.
 *
 * Quarantining a scenario is always an explicit, attributed human decision
 * (dashboard or `scripts/flakiness/review.js`), never automatic — the same
 * "never silently trusted" principle Phase 8's HealingTrust applies to
 * AI-healed selectors applies here to red builds: a quarantined scenario's
 * failures are still recorded and reported (as "quarantined", a distinct
 * status from "passed"/"failed"/"skipped"), just no longer block CI.
 */
const MIN_SAMPLES_FOR_VERDICT = 3;
const WINDOW_SIZE             = 10;
const MAX_HISTORY_PER_SCENARIO = 20;
const MAX_TRACKED_SCENARIOS    = 500;
const QUARANTINE_DECISIONS_MAX_ROWS = 500;

class FlakinessTracker {
    constructor() {
        this.historyPath   = path.join(__dirname, "..", "..", "data", "scenario_history.json");
        this.decisionsPath = path.join(__dirname, "..", "..", "data", "quarantine_decisions.json");
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
     * After loading, reconciles the decision ledger against history (D4/Q10):
     * the ledger (`quarantine_decisions.json`) is the append-only audit
     * trail, so for every key present in BOTH `scenarios` and the folded
     * ledger, `scenarios[key].quarantined` is forced to match the ledger's
     * latest verdict for that key — the ledger wins on disagreement (e.g. a
     * crash between the history save and the decisions save left them out of
     * sync). A key present only in the ledger (no matching history entry) is
     * NOT resurrected — there is no sample data to rebuild a `history` array
     * from a decision record alone — it is left to the in-memory
     * eviction-protection set (`_protectedKeys()`) to keep it immune from
     * eviction if a matching entry ever reappears. This reconciliation is
     * in-memory only; it is not written back to disk as a side effect of
     * loading.
     */
    _reload() {
        this.scenarios = AtomicJsonStore.readJsonSync(this.historyPath, {});
        this.decisions = AtomicJsonStore.readJsonSync(this.decisionsPath, []);

        // Reconcile against the FULLY LOADED ledger first, then cap. Folding
        // is in-memory and cheap, so doing it before the cap costs nothing —
        // and it matters: if a key's only "quarantine" row would fall outside
        // the retained window and `scenarios[key].quarantined` disagrees
        // (`false`), reconciling first still sees that row and forces
        // `entry.quarantined` to `true` before the row is ever dropped. That
        // write lands on the scenario entry itself, not on the ledger array,
        // so it survives the cap below intact — `_evictLeastRecentlyUsed()`'s
        // `isProtected` checks `entry.quarantined === true` directly, so the
        // key stays protected even though its ledger row (and therefore its
        // membership in `_protectedKeys()`) is gone after capping. Capping
        // first, as before, discarded the row before reconciliation could
        // ever see it, silently losing both the audit trail and eviction
        // protection for an already-disagreeing key.
        for (const [key, action] of this._effectiveDecisionMap()) {
            if (!this._hasScenario(key)) continue;
            const entry = this._getScenario(key);
            const verdict = action === "quarantine";
            if (entry.quarantined !== verdict) {
                this._setScenario(key, { ...entry, quarantined: verdict });
            }
        }

        // Cap AFTER reconciliation now runs above — this remains the D7
        // migration path for an already-oversized file on disk, and still
        // logs exactly one warning naming how many rows were dropped.
        if (this.decisions.length > QUARANTINE_DECISIONS_MAX_ROWS) {
            const totalFound = this.decisions.length;
            const dropped = totalFound - QUARANTINE_DECISIONS_MAX_ROWS;
            this.decisions = this.decisions.slice(-QUARANTINE_DECISIONS_MAX_ROWS);
            Logger.warning(
                `FlakinessTracker: loaded quarantine ledger had ${totalFound} rows, exceeding `
                + `QUARANTINE_DECISIONS_MAX_ROWS (${QUARANTINE_DECISIONS_MAX_ROWS}); dropped ${dropped} oldest row(s).`,
            );
        }
    }

    /**
     * Fold `this.decisions` (append-only, in array/time order) into a
     * `Map<key, "quarantine"|"unquarantine">` of each key's *latest*
     * effective decision — last write wins. A key quarantined and later
     * unquarantined drops out once its last decision is "unquarantine"
     * (Q9): this keeps protection bounded to currently-live decisions
     * rather than every historical row.
     */
    _effectiveDecisionMap() {
        const latest = new Map();
        for (const decision of this.decisions) {
            if (decision && typeof decision.key === "string"
                && (decision.action === "quarantine" || decision.action === "unquarantine")) {
                latest.set(decision.key, decision.action);
            }
        }
        return latest;
    }

    /** Keys whose latest ledger decision is "quarantine" — the eviction-protected set. */
    _protectedKeys() {
        const keys = new Set();
        for (const [key, action] of this._effectiveDecisionMap()) {
            if (action === "quarantine") keys.add(key);
        }
        return keys;
    }

    // Same rationale as HealingTrust's equivalent helpers: `scenarios` is a
    // plain object keyed by an arbitrary string (built from a page URL and a
    // CSS selector, both attacker/author-influenced), so every read/write
    // goes through Object.hasOwn()/Object.defineProperty() rather than bare
    // bracket access — a key like "__proto__" must not be able to silently
    // vanish or repoint the object's own prototype.
    _hasScenario(key) {
        return Object.hasOwn(this.scenarios, key);
    }

    _getScenario(key) {
        return this._hasScenario(key) ? this.scenarios[key] : undefined;
    }

    _setScenario(key, value) {
        Object.defineProperty(this.scenarios, key, {
            value, enumerable: true, configurable: true, writable: true,
        });
    }

    /** Stable identity for a scenario, independent of its human-readable description. */
    keyFor({ url, action, locator }) {
        return `${url}::${action}::${locator}`;
    }

    /**
     * Pure classification function over a scenario's (already-capped)
     * history array of `{ status }` objects — no I/O, safe to call
     * directly in tests via the exported singleton.
     */
    classify(history) {
        const recent = (history || []).slice(-WINDOW_SIZE);
        const passCount = recent.filter((h) => h.status === "passed").length;
        const failCount = recent.filter((h) => h.status === "failed").length;
        const sampleSize = passCount + failCount;

        if (sampleSize < MIN_SAMPLES_FOR_VERDICT) {
            return { classification: "new", flakeRate: 0, sampleSize };
        }
        if (failCount === 0) {
            return { classification: "stable", flakeRate: 0, sampleSize };
        }
        if (passCount === 0) {
            return { classification: "broken", flakeRate: 1, sampleSize };
        }
        return { classification: "flaky", flakeRate: failCount / sampleSize, sampleSize };
    }

    /**
     * Record one scenario outcome. Only "passed"/"failed" carry signal
     * about the interaction itself; anything else (e.g. "skipped") is a
     * no-op and returns null.
     *
     * `"unavailable"` (the target page/site couldn't be reached at all) is
     * normalized at this boundary rather than taught to every caller: it is
     * stored as `status: "failed"` (so it counts toward classify()'s
     * pass/fail window exactly like any other failure — an alternating
     * present/absent target correctly classifies "flaky") plus
     * `outcome: "unavailable"` on the history entry, so a reporter can still
     * tell the two failure kinds apart. Without this normalization, a raw
     * "unavailable" status would hit the `status !== "passed" && status !==
     * "failed"` guard below and be silently dropped — never recorded at all.
     *
     * @param {Object} opts
     * @param {string} opts.url
     * @param {string} opts.action
     * @param {string} opts.locator
     * @param {string} [opts.description]
     * @param {"passed"|"failed"|"unavailable"} opts.status
     * @param {number} [opts.duration]
     * @param {string} [opts.errorType] - AdaptiveRetry.classify() result, when status is "failed"
     * @param {string} [opts.outcome] - additional detail alongside errorType, e.g. "unavailable"
     */
    record({ url, action, locator, description = "", status, duration = null, errorType = null, outcome = null }) {
        let normalizedStatus = status;
        let normalizedOutcome = outcome;
        if (status === "unavailable") {
            normalizedStatus = "failed";
            normalizedOutcome = outcome ?? "unavailable";
        }
        if (normalizedStatus !== "passed" && normalizedStatus !== "failed") return null;

        const key = this.keyFor({ url, action, locator });
        const existing = this._getScenario(key);
        const history = [...(existing?.history ?? []), {
            status: normalizedStatus, timestamp: new Date().toISOString(), duration, errorType, outcome: normalizedOutcome,
        }].slice(-MAX_HISTORY_PER_SCENARIO);

        const { classification, flakeRate, sampleSize } = this.classify(history);
        const wasFlaky = existing?.classification === "flaky";
        // Same boolean gates both the flakySince reset below and the
        // flakyDetected emit, so the two can never drift apart.
        const enteringFlaky = classification === "flaky" && !wasFlaky;
        const leavingFlaky = wasFlaky && classification !== "flaky";
        const flakySince = enteringFlaky
            ? new Date().toISOString()
            : leavingFlaky
                ? null
                : (existing?.flakySince ?? null);

        const entry = {
            key, url, action, locator,
            description: description || existing?.description || "",
            history,
            classification, flakeRate, sampleSize,
            lastUsed: Date.now(),
            quarantined: existing?.quarantined ?? false,
            quarantinedAt: existing?.quarantinedAt ?? null,
            quarantinedBy: existing?.quarantinedBy ?? null,
            flakySince,
        };
        this._setScenario(key, entry);
        this._evictLeastRecentlyUsed();
        this._queue = this._queue.then(() => AtomicJsonStore.writeJsonAtomic(this.historyPath, this.scenarios));

        // Only fire on the transition into "flaky" — re-recording an
        // already-flaky scenario every run would flood the dashboard/CLI
        // with duplicate alerts for something already known and visible.
        if (enteringFlaky) {
            Middleware.emit("flakyDetected", entry);
        }
        return entry;
    }

    /** True if the given scenario key is currently quarantined. */
    isQuarantined(key) {
        return !!this._getScenario(key)?.quarantined;
    }

    /** All tracked scenarios, optionally filtered by classification ("new"|"stable"|"broken"|"flaky"). */
    list({ classification } = {}) {
        const all = Object.values(this.scenarios);
        return classification ? all.filter((e) => e.classification === classification) : all;
    }

    /**
     * Can this scenario be quarantined at all?
     *
     * Quarantine buys a failing scenario out of the exit code, so the one
     * thing it must never cover is a scenario that has never once passed:
     * that isn't flakiness, that's a regression, and silencing it turns a
     * genuinely red run green. "Has a pass in its retained history" is the
     * check rather than `classification !== "broken"` on purpose — a
     * scenario that has only ever failed twice is still classified "new"
     * (too few samples for a verdict) and is exactly as dangerous to hide.
     *
     * @returns {{tracked: boolean, eligible: boolean, reason: string|null}}
     */
    quarantineEligibility(key) {
        const entry = this._getScenario(key);
        if (!entry) {
            return { tracked: false, eligible: false, reason: "No tracked scenario for that key." };
        }
        // Already quarantined: re-applying is idempotent, not a new decision.
        if (entry.quarantined) return { tracked: true, eligible: true, reason: null };

        const passes = (entry.history ?? []).filter((h) => h?.status === "passed").length;
        if (passes === 0) {
            return {
                tracked: true,
                eligible: false,
                reason: `This scenario has never passed (${entry.sampleSize} recorded run(s), all failed). `
                      + "That's a regression, not flakiness — fix it or delete it, but it can't be quarantined.",
            };
        }
        return { tracked: true, eligible: true, reason: null };
    }

    /**
     * Quarantine a scenario: future failures report as "quarantined"
     * instead of "failed" and stop blocking CI. Never touches whether the
     * scenario actually passes or fails — it only changes how a failure is
     * reported. Returns null if there's no tracked entry for that key, and
     * throws (code QUARANTINE_REFUSED) if the scenario has never passed —
     * see quarantineEligibility(). There is deliberately no force flag.
     */
    quarantine(key, { by = "dashboard" } = {}) {
        const entry = this._getScenario(key);
        if (!entry) return null;

        const eligibility = this.quarantineEligibility(key);
        if (!eligibility.eligible) {
            const refusal = new Error(eligibility.reason);
            refusal.code = "QUARANTINE_REFUSED";
            refusal.entry = entry;
            throw refusal;
        }

        // Idempotent: a second quarantine of the same scenario is the same
        // decision, and the ledger is an audit trail, not a click counter.
        if (entry.quarantined) return entry;

        entry.quarantined = true;
        entry.quarantinedAt = new Date().toISOString();
        entry.quarantinedBy = by;
        this._setScenario(key, entry);

        const decision = { key, action: "quarantine", by, at: entry.quarantinedAt };
        this.decisions.push(decision);
        this._capDecisionsLedger();
        this._queue = this._queue
            .then(() => AtomicJsonStore.writeJsonAtomic(this.historyPath, this.scenarios))
            .then(() => AtomicJsonStore.writeJsonAtomic(this.decisionsPath, this.decisions));
        Middleware.emit("scenarioQuarantined", entry);
        return entry;
    }

    /**
     * Reverse a quarantine. A no-op (returns null) if the scenario isn't
     * currently quarantined, or isn't tracked at all.
     */
    unquarantine(key, { by = "dashboard" } = {}) {
        const entry = this._getScenario(key);
        if (!entry || !entry.quarantined) return null;

        entry.quarantined = false;
        entry.quarantinedAt = null;
        entry.quarantinedBy = null;
        // Restart the review clock: a scenario let back into the queue is
        // not instantly "stale" again just because it was flagged flaky
        // long ago, before the quarantine.
        if (entry.classification === "flaky") {
            entry.flakySince = new Date().toISOString();
        }
        this._setScenario(key, entry);

        const decision = { key, action: "unquarantine", by, at: new Date().toISOString() };
        this.decisions.push(decision);
        this._capDecisionsLedger();
        this._queue = this._queue
            .then(() => AtomicJsonStore.writeJsonAtomic(this.historyPath, this.scenarios))
            .then(() => AtomicJsonStore.writeJsonAtomic(this.decisionsPath, this.decisions));
        Middleware.emit("scenarioUnquarantined", entry);
        return entry;
    }

    /**
     * Ring-buffer the quarantine decision ledger to QUARANTINE_DECISIONS_MAX_ROWS,
     * synchronously right after a push and before the write is queued. Logs
     * only the first rotation per process (then stays silent for the rest of
     * the process) — see the equivalent in HealingTrust._pushDecision.
     */
    _capDecisionsLedger() {
        if (this.decisions.length > QUARANTINE_DECISIONS_MAX_ROWS) {
            this.decisions = this.decisions.slice(-QUARANTINE_DECISIONS_MAX_ROWS);
            if (!this._decisionsRotationLogged) {
                this._decisionsRotationLogged = true;
                Logger.warning(
                    `FlakinessTracker quarantine ledger reached its cap (QUARANTINE_DECISIONS_MAX_ROWS=${QUARANTINE_DECISIONS_MAX_ROWS}) `
                    + "and began discarding its oldest row. Further rotations this process will not be logged individually.",
                );
            }
        }
    }

    /**
     * Keep at most MAX_TRACKED_SCENARIOS entries, dropping the stalest first
     * — but never a scenario a human has explicitly decided about (D4/AC-08):
     * an entry currently `quarantined === true`, or a key whose latest
     * ledger decision is "quarantine" (`_protectedKeys()`), is excluded from
     * the eviction pool entirely. Sort/slice runs only over the remaining
     * unprotected keys, using the same overflow count as before, so
     * unprotected entries stay bounded exactly as today.
     *
     * Eviction never touches a protected entry, so it can only ever reduce
     * the tracked total down to (approximately) the size of the protected
     * pool — if the protected pool alone is at or over the cap, or is close
     * enough to it that the unprotected pool can't cover the whole overflow,
     * evicting every unprotected entry still leaves the cap exceeded
     * (P12-10: this used to happen silently whenever *some* unprotected
     * entries existed but not enough of them — only the fully-protected case
     * warned). Whenever eviction cannot fully restore the cap, exactly one
     * Logger.warning fires naming the tracked total, the protected count,
     * how many entries were actually evicted, and the remaining shortfall
     * over the cap — a human decision is never dropped, but it is also never
     * silent when it leaves the cap exceeded.
     */
    _evictLeastRecentlyUsed() {
        const keys = Object.keys(this.scenarios);
        const overflow = keys.length - MAX_TRACKED_SCENARIOS;
        if (overflow <= 0) return;

        const protectedKeys = this._protectedKeys();
        const isProtected = (key) => this._getScenario(key)?.quarantined === true || protectedKeys.has(key);
        const unprotected = keys.filter((key) => !isProtected(key));

        const toEvict = Math.min(overflow, unprotected.length);
        unprotected
            .sort((a, b) => this.scenarios[a].lastUsed - this.scenarios[b].lastUsed)
            .slice(0, toEvict)
            .forEach((key) => delete this.scenarios[key]);

        const shortfall = overflow - toEvict;
        if (shortfall > 0) {
            const protectedCount = keys.length - unprotected.length;
            Logger.warning(
                `FlakinessTracker eviction could not restore the cap: ${keys.length} tracked scenarios exceed `
                + `MAX_TRACKED_SCENARIOS (${MAX_TRACKED_SCENARIOS}); ${protectedCount} are protected `
                + `(quarantined or ledger-referenced) and were never eligible for eviction, ${toEvict} unprotected `
                + `${toEvict === 1 ? "entry" : "entries"} evicted, leaving the tracked total ${shortfall} over the cap.`,
            );
        }
    }

    /**
     * Pure read, no writes: which currently-flaky, non-quarantined scenarios
     * have gone unreviewed longer than `thresholdDays` (measured from
     * `flakySince`). A boundary age exactly equal to the threshold is NOT
     * stale. A scenario that's currently flaky and not quarantined but has
     * `flakySince == null` (every legacy record, from before this field
     * existed) is eligible but has no age to judge — it goes to
     * `unknownAge` and must never appear in `stale`.
     */
    unreviewedFlakyStale({ thresholdDays, now = Date.now() }) {
        const stale = [];
        const notStale = [];
        const unknownAge = [];
        for (const entry of Object.values(this.scenarios)) {
            if (!entry || entry.classification !== "flaky" || entry.quarantined) continue;
            const sinceMs = entry.flakySince == null ? NaN : Date.parse(entry.flakySince);
            if (entry.flakySince == null || Number.isNaN(sinceMs)) {
                unknownAge.push(entry);
                continue;
            }
            const age = now - sinceMs;
            if (age > thresholdDays * 86400000) stale.push(entry);
            else notStale.push(entry);
        }
        return { thresholdDays, stale, notStale, unknownAge };
    }

    /**
     * Pure read, no writes, and — critically — no mutation of any reachable
     * state (security condition 3): a quarantined scenario is a
     * rehabilitation candidate iff its history (filtered to "passed"/"failed"
     * entries only, matching record()'s own signal rule — "unavailable" is
     * stored as "failed", so it correctly disqualifies) has at least
     * `windowSize` such entries AND the most recent `windowSize` of them are
     * ALL "passed". `recentHistory` on the result is a fresh copy, never a
     * reference into `this.scenarios`.
     */
    rehabilitationCandidates({ windowSize, now = Date.now() } = {}) {
        void now; // no age-based logic here (yet) — accepted for signature symmetry with the other pure reads.
        const candidates = [];
        for (const entry of Object.values(this.scenarios)) {
            if (!entry || entry.quarantined !== true) continue;
            const relevant = (entry.history ?? []).filter((h) => h?.status === "passed" || h?.status === "failed");
            if (relevant.length < windowSize) continue;
            const recent = relevant.slice(-windowSize);
            if (!recent.every((h) => h.status === "passed")) continue;

            candidates.push({
                key: entry.key,
                url: entry.url,
                action: entry.action,
                locator: entry.locator,
                description: entry.description,
                quarantinedAt: entry.quarantinedAt,
                quarantinedBy: entry.quarantinedBy,
                windowSize,
                recentHistory: recent.map((h) => ({ ...h })),
                allPassedInWindow: true,
                reason: `The last ${windowSize} recorded outcome(s) while quarantined all passed — a candidate for a human to review and lift quarantine.`,
            });
        }
        return candidates;
    }
}

module.exports = new FlakinessTracker();
