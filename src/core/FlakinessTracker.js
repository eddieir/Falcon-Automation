const fs   = require("fs");
const path = require("path");
const Middleware = require("./Middleware");

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

class FlakinessTracker {
    constructor() {
        this.historyPath   = path.join(__dirname, "..", "..", "data", "scenario_history.json");
        this.decisionsPath = path.join(__dirname, "..", "..", "data", "quarantine_decisions.json");
        this._queue = Promise.resolve();
        this._reload();
    }

    /** (Re)load both files from disk. Exposed for tests that swap the paths after construction. */
    _reload() {
        this.scenarios = this._loadJson(this.historyPath, {});
        this.decisions = this._loadJson(this.decisionsPath, []);
    }

    _loadJson(filePath, fallback) {
        try {
            if (fs.existsSync(filePath)) {
                const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
                if (Array.isArray(fallback)) return Array.isArray(raw) ? raw : fallback;
                return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : fallback;
            }
        } catch {
            // Corrupt file — start fresh rather than crash the run
        }
        return fallback;
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
     * @param {Object} opts
     * @param {string} opts.url
     * @param {string} opts.action
     * @param {string} opts.locator
     * @param {string} [opts.description]
     * @param {"passed"|"failed"} opts.status
     * @param {number} [opts.duration]
     * @param {string} [opts.errorType] - AdaptiveRetry.classify() result, when status is "failed"
     */
    record({ url, action, locator, description = "", status, duration = null, errorType = null }) {
        if (status !== "passed" && status !== "failed") return null;

        const key = this.keyFor({ url, action, locator });
        const existing = this._getScenario(key);
        const history = [...(existing?.history ?? []), {
            status, timestamp: new Date().toISOString(), duration, errorType,
        }].slice(-MAX_HISTORY_PER_SCENARIO);

        const { classification, flakeRate, sampleSize } = this.classify(history);
        const wasFlaky = existing?.classification === "flaky";

        const entry = {
            key, url, action, locator,
            description: description || existing?.description || "",
            history,
            classification, flakeRate, sampleSize,
            lastUsed: Date.now(),
            quarantined: existing?.quarantined ?? false,
            quarantinedAt: existing?.quarantinedAt ?? null,
            quarantinedBy: existing?.quarantinedBy ?? null,
        };
        this._setScenario(key, entry);
        this._evictLeastRecentlyUsed();
        this._queue = this._queue.then(() => this._save(this.historyPath, this.scenarios));

        // Only fire on the transition into "flaky" — re-recording an
        // already-flaky scenario every run would flood the dashboard/CLI
        // with duplicate alerts for something already known and visible.
        if (classification === "flaky" && !wasFlaky) {
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
        this._queue = this._queue
            .then(() => this._save(this.historyPath, this.scenarios))
            .then(() => this._save(this.decisionsPath, this.decisions));
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
        this._setScenario(key, entry);

        const decision = { key, action: "unquarantine", by, at: new Date().toISOString() };
        this.decisions.push(decision);
        this._queue = this._queue
            .then(() => this._save(this.historyPath, this.scenarios))
            .then(() => this._save(this.decisionsPath, this.decisions));
        Middleware.emit("scenarioUnquarantined", entry);
        return entry;
    }

    /** Keep at most MAX_TRACKED_SCENARIOS entries, dropping the stalest first. */
    _evictLeastRecentlyUsed() {
        const keys = Object.keys(this.scenarios);
        if (keys.length <= MAX_TRACKED_SCENARIOS) return;

        keys
            .sort((a, b) => this.scenarios[a].lastUsed - this.scenarios[b].lastUsed)
            .slice(0, keys.length - MAX_TRACKED_SCENARIOS)
            .forEach((key) => delete this.scenarios[key]);
    }

    async _save(filePath, data) {
        try {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
        } catch {
            // A failed audit write must never abort the run
        }
    }
}

module.exports = new FlakinessTracker();
