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

module.exports = LlmBudget;
