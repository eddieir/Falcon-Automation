/**
 * src/core/llm/providers/AnthropicProvider.js — the `provider: "anthropic"`
 * adapter (ADR-0019 WP3, Sec-00/Sec-01 C8/C9/C10).
 *
 * Talks to the Anthropic Messages API over guardedFetch's fixed-host
 * transport mode — no SDK, no ambient env vars, no DNS/socket work outside
 * guardedFetch. The fixed-host fetch is built lazily (on first complete()
 * call) and cached on the instance; it carries no credential. The API key
 * is read from the resolved config fresh on every attempt, used only to
 * build that attempt's request headers, and never stored on the instance
 * beyond the call.
 *
 * complete() never throws for provider/transport conditions — every
 * failure is mapped to one of the closed LlmProvider.ERROR_CODES and
 * returned as an ok:false result. The upstream error body is never read,
 * forwarded, or logged (S-17); the credential value is never echoed.
 */

"use strict";

const { createGuardedFetch, isValidCredentialShape } = require("../transport/guardedFetch");
const RetryPolicy = require("../RetryPolicy");
const LlmBudget = require("../LlmBudget");
const Semaphore = require("../Semaphore");

const HOST = "api.anthropic.com";
const PORT = 443;
const PATH = "/v1/messages";
const URL_STRING = `https://${HOST}${PATH}`;
const ANTHROPIC_VERSION = "2023-06-01";

const AUTH_STATUSES = new Set([401, 403]);
const BAD_REQUEST_STATUSES = new Set([400, 404, 413, 422]);

/** @returns {string} one of the closed ERROR_CODES for an Anthropic HTTP status. */
function mapStatusToErrorCode(status) {
    if (AUTH_STATUSES.has(status)) return "AUTH_FAILED";
    if (BAD_REQUEST_STATUSES.has(status)) return "BAD_REQUEST";
    if (status === 429) return "RATE_LIMITED";
    if (status === 504) return "TIMEOUT";
    return "PROVIDER_ERROR";
}

/** @returns {{promptTokens:number|null, completionTokens:number|null}|null} */
function safeUsage(usage) {
    if (!usage || typeof usage !== "object") return null;
    const promptTokens = Number.isSafeInteger(usage.input_tokens) ? usage.input_tokens : null;
    const completionTokens = Number.isSafeInteger(usage.output_tokens) ? usage.output_tokens : null;
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

class AnthropicProvider {
    /**
     * @param {Object} config - a resolved LlmConfig.config object.
     * @param {Object} [deps] - injectable seams for tests: createGuardedFetch,
     *   policyOpts, transportDeps, sleep, now, budget, semaphore.
     */
    constructor(config, deps = {}) {
        this.id = "anthropic";
        this.modelLabel =
            typeof config.model === "string" && config.model.trim() !== "" ? config.model.trim() : "claude-3-5-sonnet";
        this.endpointClass = "anthropic_public";
        this._config = config;
        this._deps = deps;
        this._fetch = null;
        this._budget = deps.budget || new LlmBudget(config.runBudget);
        this._semaphore = deps.semaphore || new Semaphore(config.concurrency);
    }

    _getFetch() {
        if (this._fetch) return this._fetch;
        const createFetch = this._deps.createGuardedFetch || createGuardedFetch;
        this._fetch = createFetch({
            mode: "fixed-host",
            fixedHost: { host: HOST, port: PORT, pathAllowlist: [PATH] },
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
        const sleep = this._deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        const start = now();

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
                response = await fetchFn(URL_STRING, {
                    method: "POST",
                    headers: {
                        "x-api-key": apiKey,
                        "anthropic-version": ANTHROPIC_VERSION,
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({
                        model: this._config.model,
                        max_tokens: req.maxOutputTokens,
                        messages: [{ role: "user", content: req.prompt }],
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
                const contentList = Array.isArray(data && data.content) ? data.content : [];
                const textBlock = contentList.find((block) => block && block.type === "text" && typeof block.text === "string");
                if (!textBlock) {
                    return { ok: false, errorCode: "MALFORMED_RESPONSE" };
                }
                return { ok: true, result: { text: textBlock.text, usage: safeUsage(data.usage) } };
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

module.exports = AnthropicProvider;
