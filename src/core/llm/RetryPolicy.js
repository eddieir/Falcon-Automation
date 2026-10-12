/**
 * src/core/llm/RetryPolicy.js — bounded retry with fixed backoff for Phase 17
 * LLM provider attempts (ADR-0017 section 7, AC24).
 *
 * Only transient, transport/provider-side error codes are retried
 * (RATE_LIMITED, PROVIDER_ERROR, TIMEOUT, NETWORK_ERROR). Auth, request-shape
 * and configuration/policy codes are never retried — retrying them would
 * either burn budget pointlessly or repeat a request that is guaranteed to
 * fail the same way. Backoff is fixed (500ms, then 1000ms, capped at
 * 2000ms) with no jitter, so behaviour under test is deterministic. Every
 * attempt — including the first — must be authorised by the budget before
 * any network call happens; an exhausted budget short-circuits with
 * BUDGET_EXHAUSTED and performs no I/O for that attempt.
 */

"use strict";

const RETRYABLE_CODES = new Set(["RATE_LIMITED", "PROVIDER_ERROR", "TIMEOUT", "NETWORK_ERROR"]);
const BACKOFF_MS = Object.freeze([500, 1000]);
const BACKOFF_CAP_MS = 2000;

function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @returns {number} `ms` clamped into [0, BACKOFF_CAP_MS]. */
function clampDelay(ms) {
    if (!Number.isFinite(ms) || ms < 0) return 0;
    return Math.min(ms, BACKOFF_CAP_MS);
}

/**
 * @param {function(number): Promise<{ok:true,result:*}|{ok:false,errorCode:string,retryAfterMs?:number}>} attemptFn
 *   Called with the 1-based attempt number. Must never throw.
 * @param {{maxAttempts?:number, sleep?:function(number):Promise<void>, budget?:{consumeAttempt():boolean}}} [opts]
 * @returns {Promise<{ok:true,result:*,attempts:number}|{ok:false,errorCode:string,attempts:number}>}
 */
async function run(attemptFn, opts = {}) {
    const maxAttempts = Number.isSafeInteger(opts.maxAttempts) && opts.maxAttempts > 0 ? opts.maxAttempts : 2;
    const sleep = typeof opts.sleep === "function" ? opts.sleep : defaultSleep;
    const budget = opts.budget;

    let attempts = 0;
    let lastErrorCode = "PROVIDER_ERROR";

    for (let i = 0; i < maxAttempts; i += 1) {
        if (budget && typeof budget.consumeAttempt === "function" && !budget.consumeAttempt()) {
            return { ok: false, errorCode: "BUDGET_EXHAUSTED", attempts };
        }

        attempts += 1;
        const outcome = await attemptFn(attempts);

        if (outcome && outcome.ok) {
            return { ok: true, result: outcome.result, attempts };
        }

        const errorCode = (outcome && outcome.errorCode) || "PROVIDER_ERROR";
        lastErrorCode = errorCode;

        if (!RETRYABLE_CODES.has(errorCode)) {
            return { ok: false, errorCode, attempts };
        }

        const isLastAttempt = i === maxAttempts - 1;
        if (isLastAttempt) break;

        let delay = BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)];
        if (outcome && Number.isFinite(outcome.retryAfterMs)) {
            delay = clampDelay(outcome.retryAfterMs);
        } else {
            delay = clampDelay(delay);
        }
        await sleep(delay);
    }

    return { ok: false, errorCode: lastErrorCode, attempts };
}

module.exports = { run, RETRYABLE_CODES };
