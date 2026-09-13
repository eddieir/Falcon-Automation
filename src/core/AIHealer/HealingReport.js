const fs   = require("fs");
const path = require("path");

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
     */
    static log(opts = {}) {
        HealingReport._instance._log(opts);
    }

    _log({ original, resolved, tier, description = "", error = null }) {
        const entry = {
            timestamp:   new Date().toISOString(),
            original,
            resolved,
            tier,
            description,
            ...(error ? { error } : {}),
        };

        this.logs.push(entry);
        this._queue = this._queue.then(() => this._flush());
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
