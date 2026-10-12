/**
 * src/core/llm/providers/GeminiProvider.js — the `provider: "gemini"`
 * adapter (ADR-0019 WP3, Sec-00/Sec-01 C1/C8/C9/C10).
 *
 * Talks to the Gemini generateContent API over guardedFetch's fixed-host
 * transport mode — no SDK, no ambient env vars, no DNS/socket work outside
 * guardedFetch. The request path embeds the configured model id, so the
 * model is re-validated against a strict charset ONCE at construction
 * (coordinator condition C1) and the fixed-host fetch (with its one-entry
 * pathAllowlist) is computed then — never re-derived from a later,
 * possibly attacker-influenced value. An invalid model id makes every
 * complete() call fail closed with CONFIG_INVALID and zero requests.
 *
 * The API key is read from the resolved config fresh on every attempt,
 * used only to build that attempt's request headers (x-goog-api-key —
 * never a `?key=` query parameter), and never stored on the instance
 * beyond the call. complete() never throws; every failure is mapped to a
 * closed LlmProvider.ERROR_CODES member. The upstream error body is never
 * read, forwarded, or logged (S-17).
 */

"use strict";

const { createGuardedFetch, isValidCredentialShape } = require("../transport/guardedFetch");
const RetryPolicy = require("../RetryPolicy");
const LlmBudget = require("../LlmBudget");
const Semaphore = require("../Semaphore");

const HOST = "generativelanguage.googleapis.com";
const PORT = 443;
// C1: stricter than the general [A-Za-z0-9._:/-]{1,64} model-id charset
// because this value is placed directly in the request path — no '/' or
// ':' (no path traversal, no "models/" prefix, no accidental method
// suffix), checked again here regardless of any earlier validation.
const MODEL_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BLOCKED_FINISH_REASONS = new Set(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "RECITATION", "IMAGE_SAFETY"]);

const AUTH_STATUSES = new Set([401, 403]);
const BAD_REQUEST_STATUSES = new Set([400, 404, 413, 422]);

/** @returns {string} one of the closed ERROR_CODES for a Gemini HTTP status. */
function mapStatusToErrorCode(status) {
    if (AUTH_STATUSES.has(status)) return "AUTH_FAILED";
    if (BAD_REQUEST_STATUSES.has(status)) return "BAD_REQUEST";
    if (status === 429) return "RATE_LIMITED";
    if (status === 504) return "TIMEOUT";
    return "PROVIDER_ERROR";
}

/** @returns {{promptTokens:number|null, completionTokens:number|null}|null} */
function safeUsage(usageMetadata) {
    if (!usageMetadata || typeof usageMetadata !== "object") return null;
    const promptTokens = Number.isSafeInteger(usageMetadata.promptTokenCount) ? usageMetadata.promptTokenCount : null;
    const completionTokens = Number.isSafeInteger(usageMetadata.candidatesTokenCount)
        ? usageMetadata.candidatesTokenCount
        : null;
    if (promptTokens === null && completionTokens === null) return null;
    return { promptTokens, completionTokens };
}

/** @returns {number|undefined} Retry-After header value in ms. */
function readRetryAfterMs(response) {
    const raw = response && typeof response.headers.get === "function" ? response.headers.get("retry-after") : undefined;
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return seconds * 1000;
}

class GeminiProvider {
    /**
     * @param {Object} config - a resolved LlmConfig.config object.
     * @param {Object} [deps] - injectable seams for tests: createGuardedFetch,
     *   policyOpts, transportDeps, sleep, now, budget, semaphore.
     */
    constructor(config, deps = {}) {
        this.id = "gemini";
        this.modelLabel =
            typeof config.model === "string" && config.model.trim() !== "" ? config.model.trim() : "gemini-1.5-flash";
        this.endpointClass = "gemini_public";
        this._config = config;
        this._deps = deps;
        this._fetch = null;
        this._budget = deps.budget || new LlmBudget(config.runBudget);
        this._semaphore = deps.semaphore || new Semaphore(config.concurrency);

        // C1: validated once, here, against the model id actually used to
        // build the fixed-host path/pathAllowlist below.
        const rawModel = typeof config.model === "string" ? config.model : "";
        this._modelPathValid = MODEL_PATH_RE.test(rawModel);
        this._path = this._modelPathValid ? `/v1beta/models/${rawModel}:generateContent` : null;
        this._url = this._modelPathValid ? `https://${HOST}${this._path}` : null;
    }

    _getFetch() {
        if (this._fetch) return this._fetch;
        const createFetch = this._deps.createGuardedFetch || createGuardedFetch;
        this._fetch = createFetch({
            mode: "fixed-host",
            fixedHost: { host: HOST, port: PORT, pathAllowlist: [this._path] },
            policyOpts: this._deps.policyOpts || {},
            timeoutMs: this._config.timeoutMs,
            maxResponseBytes: this._config.maxResponseBytes,
            deps: this._deps.transportDeps,
        });
        return this._fetch;
    }

    /**
     * I/O-free precheck: can a complete() call be attempted right now?
     * @returns {{ok:true}|{ok:false,errorCode:string}}
     */
    canSend() {
        if (!this._modelPathValid) {
            return { ok: false, errorCode: "CONFIG_INVALID" };
        }
        if (this._budget.remaining() <= 0) {
            return { ok: false, errorCode: "BUDGET_EXHAUSTED" };
        }
        return { ok: true };
    }

    /**
     * @param {{prompt:string, maxOutputTokens:number, temperature:number}} req
     * @returns {Promise<Object>} an LlmResult — never throws.
     */
    async complete(req) {
        const now = this._deps.now || Date.now;
        const start = now();

        // C1: an invalid model id never produces a request — fail closed
        // before touching the budget/semaphore/retry machinery at all.
        if (!this._modelPathValid) {
            return {
                ok: false,
                errorCode: "CONFIG_INVALID",
                provider: this.id,
                modelLabel: this.modelLabel,
                latencyMs: now() - start,
                attempts: 0,
                retryable: false,
            };
        }

        const sleep = this._deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

        const attemptOnce = async () => {
            const apiKey = this._config.apiKey;
            if (!isValidCredentialShape(apiKey)) {
                return { ok: false, errorCode: "CONFIG_INVALID" };
            }

            let fetchFn;
            try {
                fetchFn = this._getFetch();
            } catch {
                return { ok: false, errorCode: "CONFIG_INVALID" };
            }

            let response;
            try {
                response = await fetchFn(this._url, {
                    method: "POST",
                    headers: {
                        "x-goog-api-key": apiKey,
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({
                        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
                        generationConfig: { maxOutputTokens: req.maxOutputTokens, temperature: 0 },
                    }),
                });
            } catch (error) {
                const llmCode = error && typeof error.llmCode === "string" ? error.llmCode : null;
                return { ok: false, errorCode: llmCode || "NETWORK_ERROR" };
            }

            if (response.status >= 200 && response.status < 300) {
                let data;
                try {
                    data = await response.json();
                } catch {
                    return { ok: false, errorCode: "MALFORMED_RESPONSE" };
                }
                const blockReason = data && data.promptFeedback && data.promptFeedback.blockReason;
                const candidates = Array.isArray(data && data.candidates) ? data.candidates : [];
                const candidate = candidates[0];
                const finishReason = candidate && candidate.finishReason;
                if (blockReason || BLOCKED_FINISH_REASONS.has(finishReason)) {
                    return { ok: false, errorCode: "CONTENT_BLOCKED" };
                }
                const parts =
                    candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
                const textPart = parts.find((part) => part && typeof part.text === "string");
                if (!textPart) {
                    return { ok: false, errorCode: "MALFORMED_RESPONSE" };
                }
                return { ok: true, result: { text: textPart.text, usage: safeUsage(data.usageMetadata) } };
            }

            // The error body is never read, forwarded, or logged (S-17).
            const errorCode = mapStatusToErrorCode(response.status);
            const retryAfterMs = errorCode === "RATE_LIMITED" ? readRetryAfterMs(response) : undefined;
            return { ok: false, errorCode, retryAfterMs };
        };

        const outcome = await this._semaphore.run(() =>
            RetryPolicy.run(attemptOnce, {
                maxAttempts: this._config.maxAttempts,
                sleep,
                budget: this._budget,
            }),
        );

        const latencyMs = now() - start;

        if (outcome.ok) {
            return {
                ok: true,
                text: outcome.result.text,
                provider: this.id,
                modelLabel: this.modelLabel,
                latencyMs,
                attempts: outcome.attempts,
                usage: outcome.result.usage,
            };
        }
        return {
            ok: false,
            errorCode: outcome.errorCode,
            provider: this.id,
            modelLabel: this.modelLabel,
            latencyMs,
            attempts: outcome.attempts,
            retryable: RetryPolicy.RETRYABLE_CODES.has(outcome.errorCode),
        };
    }

    async close() {
        this._fetch = null;
    }
}

module.exports = GeminiProvider;
