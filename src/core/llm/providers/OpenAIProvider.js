/**
 * src/core/llm/providers/OpenAIProvider.js — the `provider: "openai"` adapter
 * (ADR-0017 section 4/8, Sec-00 S-05/S-08/S-10/S-11/S-12/S-13/S-15/S-17).
 *
 * Talks to the real `openai` SDK, but every byte on the wire goes through
 * guardedFetch (transport/guardedFetch.js) — the SDK itself never resolves
 * DNS or opens a socket directly. The SDK client is constructed lazily (on
 * first complete() call) and exactly once per provider instance, with an
 * explicit, closed option set: no ambient OPENAI_* env vars are ever
 * consulted (S-12), and the api key is read only from the resolved config
 * (S-11).
 *
 * complete() never throws for provider/transport conditions — every
 * failure, including a thrown SDK error, is mapped to one of the closed
 * LlmProvider.ERROR_CODES and returned as an ok:false result. Nothing
 * request/response shaped (SDK error .message, headers, bodies, URLs) is
 * ever placed on the result or logged (S-17).
 */

"use strict";

const { createRequire } = require("node:module");
const { createGuardedFetch } = require("../transport/guardedFetch");
const RetryPolicy = require("../RetryPolicy");
const LlmBudget = require("../LlmBudget");
const Semaphore = require("../Semaphore");

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const AUTH_STATUSES = new Set([401, 403]);
const BAD_REQUEST_STATUSES = new Set([400, 404, 422]);

/**
 * Lazily load the `openai` SDK via dynamic import (works for both an ESM
 * and a CommonJS build of the package), falling back to `createRequire` for
 * environments where dynamic import of a CJS package needs it.
 */
function defaultImportOpenAI() {
    return import("openai").catch(() => {
        const rq = createRequire(__filename);
        return rq("openai");
    });
}

/** @returns {string} one of the closed ERROR_CODES for an HTTP status. */
function mapStatusToErrorCode(status) {
    if (AUTH_STATUSES.has(status)) return "AUTH_FAILED";
    if (BAD_REQUEST_STATUSES.has(status)) return "BAD_REQUEST";
    if (status === 429) return "RATE_LIMITED";
    return "PROVIDER_ERROR";
}

/** @returns {{promptTokens:number|null, completionTokens:number|null}|null} */
function safeUsage(usage) {
    if (!usage || typeof usage !== "object") return null;
    const promptTokens = Number.isSafeInteger(usage.prompt_tokens) ? usage.prompt_tokens : null;
    const completionTokens = Number.isSafeInteger(usage.completion_tokens) ? usage.completion_tokens : null;
    if (promptTokens === null && completionTokens === null) return null;
    return { promptTokens, completionTokens };
}

/** @returns {number|undefined} Retry-After header value in ms, clamp-ready. */
function readRetryAfterMs(error) {
    const headers = (error && error.headers) || (error && error.response && error.response.headers) || null;
    if (!headers) return undefined;
    const raw = typeof headers.get === "function" ? headers.get("retry-after") : headers["retry-after"];
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return seconds * 1000;
}

class OpenAIProvider {
    /**
     * @param {Object} config - a resolved LlmConfig.config object.
     * @param {Object} [deps] - injectable seams for tests: importOpenAI,
     *   createGuardedFetch, baseUrl, policyOpts, transportDeps, sleep, now,
     *   budget, semaphore.
     */
    constructor(config, deps = {}) {
        this.id = "openai";
        this.modelLabel =
            typeof config.model === "string" && config.model.trim() !== "" ? config.model.trim() : "gpt-4o-mini";
        this.endpointClass = "openai_public";
        this._config = config;
        this._deps = deps;
        this._client = null;
        this._clientPromise = null;
        this._budget = deps.budget || new LlmBudget(config.runBudget);
        this._semaphore = deps.semaphore || new Semaphore(config.concurrency);
    }

    async _getClient() {
        if (this._client) return this._client;
        if (this._clientPromise) return this._clientPromise;
        this._clientPromise = (async () => {
            const importOpenAI = this._deps.importOpenAI || defaultImportOpenAI;
            const mod = await importOpenAI();
            const OpenAI = mod.OpenAI || mod.default || mod;
            const baseUrl = this._deps.baseUrl || DEFAULT_BASE_URL;
            const policyOpts = this._deps.policyOpts || {};
            const createFetch = this._deps.createGuardedFetch || createGuardedFetch;
            const fetchImpl = createFetch({
                baseUrl,
                policyOpts,
                timeoutMs: this._config.timeoutMs,
                maxResponseBytes: this._config.maxResponseBytes,
                deps: this._deps.transportDeps,
            });
            const client = new OpenAI({
                apiKey: this._config.apiKey,
                baseURL: baseUrl,
                organization: null,
                project: null,
                maxRetries: 0,
                timeout: this._config.timeoutMs,
                fetch: fetchImpl,
                logLevel: "off",
            });
            this._client = client;
            return client;
        })();
        return this._clientPromise;
    }

    /**
     * @param {{prompt:string, maxOutputTokens:number, temperature:number}} req
     * @returns {Promise<Object>} an LlmResult — never throws.
     */
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

    async complete(req) {
        const now = this._deps.now || Date.now;
        const sleep = this._deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        const start = now();

        const attemptOnce = async () => {
            let client;
            try {
                client = await this._getClient();
            } catch {
                return { ok: false, errorCode: "PROVIDER_ERROR" };
            }

            try {
                const response = await client.chat.completions.create({
                    model: this._config.model,
                    messages: [{ role: "user", content: req.prompt }],
                    max_tokens: req.maxOutputTokens,
                    temperature: 0,
                });
                const choice = response && Array.isArray(response.choices) ? response.choices[0] : null;
                const content = choice && choice.message ? choice.message.content : undefined;
                if (typeof content !== "string") {
                    return { ok: false, errorCode: "MALFORMED_RESPONSE" };
                }
                return { ok: true, result: { text: content, usage: safeUsage(response.usage) } };
            } catch (error) {
                // guardedFetch's rejection (err.llmCode) is the SDK's `cause`
                // once it has wrapped the fetch-level failure in its own
                // connection error — check both shapes.
                const llmCode =
                    (error && typeof error.llmCode === "string" && error.llmCode) ||
                    (error && error.cause && typeof error.cause.llmCode === "string" && error.cause.llmCode) ||
                    null;
                if (llmCode) {
                    return { ok: false, errorCode: llmCode };
                }
                const status = error && typeof error.status === "number" ? error.status : null;
                if (status !== null) {
                    const errorCode = mapStatusToErrorCode(status);
                    const retryAfterMs = errorCode === "RATE_LIMITED" ? readRetryAfterMs(error) : undefined;
                    return { ok: false, errorCode, retryAfterMs };
                }
                if (error instanceof SyntaxError) {
                    return { ok: false, errorCode: "MALFORMED_RESPONSE" };
                }
                if (error && (error.name === "APIConnectionTimeoutError" || /timeout/i.test(String(error.name || "")))) {
                    return { ok: false, errorCode: "TIMEOUT" };
                }
                return { ok: false, errorCode: "NETWORK_ERROR" };
            }
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
        this._client = null;
        this._clientPromise = null;
    }
}

module.exports = OpenAIProvider;
