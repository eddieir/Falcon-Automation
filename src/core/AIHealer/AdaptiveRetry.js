const Logger = require("../../../utils/Logger");

/**
 * AdaptiveRetry — intelligent retry engine with error-aware backoff strategies.
 *
 * Phase 3 implementation (was an empty stub in Phase 1/2).
 *
 * Error classification drives the retry strategy rather than applying a
 * uniform delay to every failure:
 *
 *   TIMEOUT       — element never appeared; wait longer between retries.
 *   STALE_ELEMENT — DOM changed between locate and click; wait for DOM to settle.
 *   NETWORK       — transient connectivity blip; retry quickly.
 *   HARD          — deterministic failure (wrong selector, assertion mismatch);
 *                   no amount of retrying will help — fail fast.
 *
 * Backoff is exponential with ±20% jitter so concurrent retries do not
 * collide (thundering-herd avoidance).
 */
class AdaptiveRetry {
    /**
     * @param {Object} opts
     * @param {number} [opts.maxAttempts=3]   - Total attempts before giving up
     * @param {number} [opts.baseDelayMs=500] - Delay after first failure (ms)
     * @param {number} [opts.maxDelayMs=8000] - Cap on any single delay (ms)
     */
    constructor({ maxAttempts = 3, baseDelayMs = 500, maxDelayMs = 8000 } = {}) {
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("maxAttempts must be a positive integer");
        for (const delay of [baseDelayMs, maxDelayMs]) {
            if (!Number.isFinite(delay) || delay < 0) throw new TypeError("Retry delay must be finite and non-negative");
        }
        this.maxAttempts = maxAttempts;
        this.baseDelayMs = baseDelayMs;
        this.maxDelayMs  = maxDelayMs;
    }

    /**
     * Execute `fn` with adaptive retry.
     *
     * @param {Function} fn - Async function to execute; may throw any error.
     * @param {string}   label - Human-readable description for log messages.
     * @returns {*} Resolved value of `fn` on success.
     * @throws  Last error encountered after all attempts are exhausted.
     */
    async execute(fn, label = "operation") {
        let lastError;

        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            try {
                Logger.info(`🔁 [AdaptiveRetry] Attempt ${attempt}/${this.maxAttempts}: ${label}`);
                return await fn();
            } catch (error) {
                lastError = error;
                const errorType = AdaptiveRetry.classify(error);

                Logger.warning(
                    `⚠️ [AdaptiveRetry] Attempt ${attempt} failed for "${label}" ` +
                    `[${errorType}]: ${error?.message ?? String(error)}`
                );

                if (errorType === "HARD") {
                    Logger.error(`🔥 [AdaptiveRetry] Hard failure — aborting retry for "${label}"`);
                    throw error; // Retrying won't help
                }

                if (attempt < this.maxAttempts) {
                    const delay = this._calcDelay(attempt, errorType);
                    Logger.info(`⏳ [AdaptiveRetry] Waiting ${delay}ms before retry...`);
                    await AdaptiveRetry._sleep(delay);
                }
            }
        }

        Logger.error(`❌ [AdaptiveRetry] All ${this.maxAttempts} attempts failed for "${label}"`);
        throw lastError;
    }

    /**
     * Classify a Playwright (or generic JS) error into one of four categories.
     * @param {Error} error
     * @returns {"TIMEOUT"|"STALE_ELEMENT"|"NETWORK"|"HARD"}
     */
    static classify(error) {
        const msg = String(error?.message ?? "").toLowerCase();
        const name = String(error?.name ?? "").toLowerCase();

        // Playwright timeout — element never appeared in the allotted window
        if (name.includes("timeoute") || msg.includes("timeout") || msg.includes("timed out")) {
            return "TIMEOUT";
        }

        // Stale or detached DOM node — element existed then was removed/replaced
        if (
            msg.includes("stale element") ||
            msg.includes("detached") ||
            msg.includes("element is not attached") ||
            msg.includes("element handle is disposed")
        ) {
            return "STALE_ELEMENT";
        }

        // Network / navigation transient failures
        if (
            msg.includes("net::") ||
            msg.includes("network") ||
            msg.includes("econnreset") ||
            msg.includes("econnrefused") ||
            msg.includes("navigation") ||
            msg.includes("fetch failed")
        ) {
            return "NETWORK";
        }

        // Anything else is treated as a hard failure (assertion errors,
        // ReferenceError, syntax errors, element-not-found with no ambiguity…)
        return "HARD";
    }

    /**
     * Compute the next wait duration using exponential backoff with ±20% jitter.
     *
     * @param {number} attempt - 1-based attempt index of the failure just seen.
     * @param {"TIMEOUT"|"STALE_ELEMENT"|"NETWORK"|"HARD"} errorType
     * @returns {number} Milliseconds to wait.
     */
    _calcDelay(attempt, errorType) {
        // Multipliers tune the base delay for each error class.
        // HARD errors throw immediately in execute() and never reach this
        // method, so no HARD entry is needed — the ?? 1.0 fallback below
        // covers any type not listed here.
        const multipliers = {
            TIMEOUT:       2.0,  // Elements that never appeared need more time
            STALE_ELEMENT: 1.5,  // Wait for DOM to settle
            NETWORK:       0.75, // Network blips clear quickly
        };

        const mult  = multipliers[errorType] ?? 1.0;
        const exp   = Math.pow(2, attempt - 1);
        const raw   = this.baseDelayMs * exp * mult;
        if (!Number.isFinite(raw)) return this.maxDelayMs;
        const jitter = raw * 0.2 * (Math.random() * 2 - 1); // ±20%
        return Math.min(Math.round(raw + jitter), this.maxDelayMs);
    }

    static _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = AdaptiveRetry;
