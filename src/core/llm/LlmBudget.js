/**
 * src/core/llm/LlmBudget.js — per-process HTTP attempt budget for Phase 17
 * LLM providers (ADR-0017, Sec-00 S-05).
 *
 * The budget counts network ATTEMPTS, not logical complete() calls — a
 * single complete() that retries twice consumes two units. consumeAttempt()
 * must be called before every outbound network attempt (including the
 * first) so an exhausted budget prevents that attempt from ever happening.
 */

"use strict";

class LlmBudget {
    /** @param {number} runBudget - total attempts allowed this process. */
    constructor(runBudget) {
        this._remaining = Number.isSafeInteger(runBudget) && runBudget > 0 ? runBudget : 0;
    }

    /**
     * Consume one attempt unit.
     * @returns {boolean} true if an attempt may proceed, false if exhausted
     *   (in which case nothing was consumed and no network call should be
     *   made).
     */
    consumeAttempt() {
        if (this._remaining <= 0) return false;
        this._remaining -= 1;
        return true;
    }

    /** @returns {number} attempts remaining. */
    remaining() {
        return this._remaining;
    }

    /** Test-only seam: reset the counter to a fresh budget. */
    reset(runBudget) {
        this._remaining = Number.isSafeInteger(runBudget) && runBudget > 0 ? runBudget : 0;
    }
}

/**
 * Process-wide hard ceilings shared by every per-context LlmBudget/Semaphore
 * (ADR-0019 C15, resolves Sec-01 S-01 vs per-context budget): no matter how
 * many invocation-scoped contexts exist in this process, their combined
 * attempts/in-flight requests can never exceed these ceilings. Per-context
 * budgets/semaphores consult this singleton in addition to their own local
 * limit; consulting it is a synchronous, allocation-free check — exhaustion
 * returns false and makes no network call.
 */
const TOTAL_ATTEMPTS_CEILING = 2000;
const CONCURRENT_IN_FLIGHT_CEILING = 8;

let totalAttemptsRemaining = TOTAL_ATTEMPTS_CEILING;
let inFlightCount = 0;

const processCeiling = {
    /** @returns {boolean} true if a process-wide attempt unit was consumed. */
    tryConsumeAttempt() {
        if (totalAttemptsRemaining <= 0) return false;
        totalAttemptsRemaining -= 1;
        return true;
    },

    /** @returns {boolean} true if an in-flight slot was claimed. */
    enterFlight() {
        if (inFlightCount >= CONCURRENT_IN_FLIGHT_CEILING) return false;
        inFlightCount += 1;
        return true;
    },

    /** Release an in-flight slot previously claimed by enterFlight(). */
    leaveFlight() {
        if (inFlightCount > 0) inFlightCount -= 1;
    },

    /** @returns {number} remaining process-wide attempt units. */
    remainingAttempts() {
        return totalAttemptsRemaining;
    },

    /** @returns {number} current process-wide in-flight count. */
    inFlight() {
        return inFlightCount;
    },

    /** Test-only seam: reset both ceilings to their initial values. */
    _resetForTests() {
        totalAttemptsRemaining = TOTAL_ATTEMPTS_CEILING;
        inFlightCount = 0;
    },
};

LlmBudget.processCeiling = processCeiling;
LlmBudget.TOTAL_ATTEMPTS_CEILING = TOTAL_ATTEMPTS_CEILING;
LlmBudget.CONCURRENT_IN_FLIGHT_CEILING = CONCURRENT_IN_FLIGHT_CEILING;

module.exports = LlmBudget;
