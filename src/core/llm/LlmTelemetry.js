/**
 * src/core/llm/LlmTelemetry.js — Phase 17 telemetry allowlist (ADR-0017
 * section 9/12, Sec-00 S-10/S-16).
 *
 * `serialize(result)` never passes the input through. Every field is
 * rebuilt one at a time, validated, and only then placed on the output
 * object — an attacker (or a bug) that adds an extra field to an LlmResult,
 * or stuffs an unexpected type into a known field, cannot make that survive
 * into a report, dashboard payload, or ledger entry. This is the single
 * place Phase 17 telemetry is produced; HealingReport/dashboard code should
 * call this instead of forwarding raw provider results.
 */

"use strict";

const { ERROR_CODES, ENDPOINT_CLASSES, PROVIDER_IDS } = require("./LlmProvider");

const ERROR_CODE_SET = new Set(ERROR_CODES);
const ENDPOINT_CLASS_SET = new Set(ENDPOINT_CLASSES);
const OUTCOME_SET = new Set(["success", "failure"]);

const MODEL_LABEL_RE = /^[A-Za-z0-9._:/-]{1,64}$/;

/** @returns {string} a string, truncated to a sane cap; never throws. */
function safeString(value, maxLen = 256) {
    if (typeof value !== "string") return "";
    return value.slice(0, maxLen);
}

/** @returns {number|null} a JS safe integer, or null for anything else. */
function safeInt(value) {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/**
 * HTML-escape for dashboard/report rendering (S-16). Escapes the five
 * characters that matter for both HTML text and attribute contexts.
 *
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
    const str = typeof value === "string" ? value : String(value ?? "");
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Rebuild one telemetry record from an LlmResult (or any object shaped like
 * one), field by field, from the closed allowlist. Unknown/extra fields on
 * the input never survive. Never throws.
 *
 * @param {Object} result
 * @returns {{provider:string|null, modelLabel:string, endpointClass:string|null,
 *   latencyMs:number|null, attempts:number|null, outcome:string,
 *   errorCode:string|null, promptTokens:number|null,
 *   completionTokens:number|null, budgetRemaining:number|null}}
 */
function serialize(result) {
    const input = result && typeof result === "object" ? result : {};

    const modelLabelRaw = typeof input.modelLabel === "string" ? input.modelLabel : "";
    const modelLabel = MODEL_LABEL_RE.test(modelLabelRaw) ? modelLabelRaw : "invalid";

    const outcome = input.ok === true ? "success" : "failure";

    let errorCode = null;
    if (outcome === "failure") {
        errorCode = typeof input.errorCode === "string" && ERROR_CODE_SET.has(input.errorCode) ? input.errorCode : null;
    }

    const endpointClass =
        typeof input.endpointClass === "string" && ENDPOINT_CLASS_SET.has(input.endpointClass)
            ? input.endpointClass
            : null;

    const usage = input.usage && typeof input.usage === "object" ? input.usage : {};

    return Object.freeze({
        provider: PROVIDER_IDS.includes(input.provider) ? input.provider : null,
        modelLabel,
        endpointClass,
        latencyMs: safeInt(input.latencyMs),
        attempts: safeInt(input.attempts),
        outcome: OUTCOME_SET.has(outcome) ? outcome : "failure",
        errorCode,
        promptTokens: safeInt(usage.promptTokens),
        completionTokens: safeInt(usage.completionTokens),
        budgetRemaining: safeInt(input.budgetRemaining),
    });
}

module.exports = { serialize, escapeHtml };
