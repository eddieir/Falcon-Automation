/**
 * src/core/llm/LlmProvider.js — shared contract for pluggable LLM providers
 * (Phase 17, ADR-0017).
 *
 * This module has no network code and no provider logic. It only pins down
 * the vocabulary that every other Phase 17 module (LlmConfig,
 * LlmProviderRegistry, the concrete providers, LlmTelemetry) must agree on:
 * which provider ids and endpoint classes exist, and which error codes a
 * provider is allowed to report. Keeping that vocabulary in one frozen place
 * means a typo in a new provider's error code fails loudly instead of
 * silently falling outside the telemetry allowlist (ADR section 9/12).
 *
 * Nothing in this file selects, configures, or talks to a provider — see
 * LlmConfig.js for configuration resolution and LlmProviderRegistry.js for
 * provider lookup.
 */

"use strict";

/**
 * Canonical provider ids. Case-sensitive, exact match only — a leading
 * space, different case, or synonym is a configuration error, not something
 * normalised here (ADR section 6). "none" is an accepted operator-facing
 * alias for "disabled" and is normalised to "disabled" by LlmConfig before
 * this list is consulted; it is intentionally not itself a member.
 */
const PROVIDER_IDS = Object.freeze(["openai", "azure-openai", "openai-compatible", "anthropic", "gemini", "disabled"]);

/**
 * Endpoint classes a provider's configured target can be classified into,
 * for telemetry only (ADR section 9/12). Derived from the validated,
 * resolved address — never from the raw hostname string (OD-5).
 */
const ENDPOINT_CLASSES = Object.freeze([
    "openai_public",
    "azure",
    "anthropic_public",
    "gemini_public",
    "custom_loopback",
    "custom_private",
    "custom_public",
]);

/**
 * Closed, frozen list of error codes a provider (or the config/registry
 * layer) may report. This list is normative per ADR-0017 section 5 — do not
 * add a code here without updating the ADR and the telemetry allowlist.
 */
const ERROR_CODES = Object.freeze([
    "CONFIG_PROVIDER_REQUIRED",
    "CONFIG_UNSUPPORTED_PROVIDER",
    "CONFIG_CONFLICT",
    "CONFIG_MISSING_CREDENTIALS",
    "CONFIG_INVALID",
    "CONFIG_ENDPOINT_OPT_IN_REQUIRED",
    "PROVIDER_DISABLED",
    "ENDPOINT_POLICY_REJECTED",
    "REDIRECT_REJECTED",
    "BUDGET_EXHAUSTED",
    "AUTH_FAILED",
    "BAD_REQUEST",
    "RATE_LIMITED",
    "PROVIDER_ERROR",
    "TIMEOUT",
    "NETWORK_ERROR",
    "MALFORMED_RESPONSE",
    "OVERSIZED",
    "UNSUPPORTED_CAPABILITY",
    "CONTENT_BLOCKED",
]);

const ERROR_CODE_SET = new Set(ERROR_CODES);

/**
 * @returns {boolean} true iff `code` is a member of the closed ERROR_CODES
 *   list. Use this instead of `ERROR_CODES.includes(...)` at call sites that
 *   check untrusted/derived values, so the Set lookup cost is paid once.
 */
function isKnownErrorCode(code) {
    return typeof code === "string" && ERROR_CODE_SET.has(code);
}

/**
 * @typedef {Object} LlmRequest
 * @property {string} prompt - already bounded/capped prompt text.
 * @property {number} maxOutputTokens
 * @property {number} temperature
 */

/**
 * @typedef {Object} LlmResult
 * On success: {ok: true, text, provider, modelLabel, latencyMs, attempts, usage}
 * On failure: {ok: false, errorCode, provider, modelLabel, latencyMs, attempts, retryable}
 * `errorCode` on a failure result must always be a member of ERROR_CODES.
 * A provider's complete() must never throw for provider/transport
 * conditions — those become `ok:false` results (ADR section 3).
 */

/**
 * Interface every concrete provider module (DisabledProvider,
 * OpenAIProvider, ...) implements:
 *   - id: one of PROVIDER_IDS
 *   - modelLabel: string, operator-facing model/deployment name
 *   - endpointClass: one of ENDPOINT_CLASSES
 *   - complete(req: LlmRequest): Promise<LlmResult> — never throws
 *   - close(): Promise<void>
 */

module.exports = {
    PROVIDER_IDS,
    ENDPOINT_CLASSES,
    ERROR_CODES,
    isKnownErrorCode,
};
