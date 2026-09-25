const fs   = require("fs");
const path = require("path");
const Middleware = require("../Middleware");

/**
 * HealingReport — append-only audit log for self-healing events.
 *
 * Phase 2 fixes:
 *
 * 1. Static `log()` method added.
 *    AIHealer and TestRunner both call `HealingReport.log({...})` but only a
 *    three-arg instance method `logHealing()` existed — calling `.log()` threw
 *    `TypeError: HealingReport.log is not a function` on every healing attempt,
 *    which is exactly when you need the audit trail most.
 *
 * 2. Correct project-root path.
 *    The old path was `__dirname/../../reports/` which resolves to
 *    `src/reports/` — not the project-level `reports/` directory.
 *    Fixed to `__dirname/../../../reports/` (three levels up from
 *    `src/core/AIHealer/`).
 *
 * 3. Lazy directory creation before first write.
 *    A missing `reports/` directory caused ENOENT on the writeFile call.
 *
 * 4. Async file I/O.
 *    `fs.writeFileSync` on every healing event stalled the event loop.
 *    Replaced with an async write via a serialised promise queue (same
 *    pattern as Logger) so it never blocks Playwright's scheduler.
 */
class HealingReport {
    constructor() {
        this.filePath = path.join(__dirname, "..", "..", "..", "reports", "healing_logs.json");
        this.logs     = [];
        this._queue   = Promise.resolve();
        this._dirOk   = false;
    }

    /**
     * Record a healing event.
     * Accepts a structured object so callers do not need to know argument order.
     *
     * @param {Object} opts
     * @param {string}      opts.original    - The selector that failed
     * @param {string|null} opts.resolved    - The selector that worked (null if all tiers failed)
     * @param {string}      opts.tier        - "LocatorStore" | "LLM" | "exhausted"
     * @param {string}      [opts.description]
     * @param {string}      [opts.error]
     * @param {string}      [opts.trust]     - "pending" when a Tier 3 fix is awaiting review (Phase 8)
     * @param {string}      [opts.action]    - "click" | "type" | "select" (Phase 11) — which
     *                                          interaction was healed
     */
    static log(opts = {}) {
        HealingReport._instance._log(opts);
    }

    _log({ original, resolved, tier, description = "", error = null, trust = null, action = null }) {
        const entry = {
            timestamp:   new Date().toISOString(),
            original,
            resolved,
            tier,
            description,
            ...(error ? { error } : {}),
            ...(trust ? { trust } : {}),
            ...(action ? { action } : {}),
        };

        this.logs.push(entry);
        this._queue = this._queue.then(() => this._flush());
        Middleware.emit("healingEvent", entry);
    }

    /**
     * Phase 8 — aggregate the flat audit log into a reviewable trend: one
     * row per original selector, showing how often it broke, which tiers
     * resolved it and how many times each, and its most recent outcome.
     * This is the "reviewable trend across a run" the Roadmap called for,
     * instead of a flat, unreadable event list.
     */
    static summary() {
        return HealingReport._instance._summary();
    }

    _summary() {
        const bySelector = new Map();
        for (const entry of this.logs) {
            if (!bySelector.has(entry.original)) {
                bySelector.set(entry.original, {
                    original: entry.original,
                    occurrences: 0,
                    tiers: {},
                    lastTier: null,
                    lastResolved: null,
                    lastTimestamp: null,
                });
            }
            const agg = bySelector.get(entry.original);
            agg.occurrences += 1;
            agg.tiers[entry.tier] = (agg.tiers[entry.tier] || 0) + 1;
            agg.lastTier = entry.tier;
            agg.lastResolved = entry.resolved;
            agg.lastTimestamp = entry.timestamp;
        }
        return [...bySelector.values()].sort((a, b) => b.occurrences - a.occurrences);
    }

    async _flush() {
        try {
            if (!this._dirOk) {
                await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
                this._dirOk = true;
            }
            await fs.promises.writeFile(
                this.filePath,
                JSON.stringify(this.logs, null, 2),
                "utf8"
            );
        } catch {
            // Never crash the test process because the audit log failed
        }
    }
}

HealingReport._instance = new HealingReport();
module.exports = HealingReport;
