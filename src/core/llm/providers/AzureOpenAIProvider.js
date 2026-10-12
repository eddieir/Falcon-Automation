/**
 * src/core/llm/providers/AzureOpenAIProvider.js — the `provider:
 * "azure-openai"` adapter (ADR-0017 sections 6-8, Sec-00 S-01/S-05/S-11/
 * S-12/S-15/S-17).
 *
 * Mirrors OpenAIProvider's wiring (lazy SDK import, guardedFetch transport,
 * RetryPolicy/LlmBudget/Semaphore) with three differences dictated by the
 * Azure OpenAI v1 surface (ADR section 6/research-packet-R1 item 3):
 *   - baseURL is `https://<azureResource>.<azureHostSuffix>/openai/v1`
 *     (already shape-validated by LlmConfig) — NOT `api.openai.com`.
 *   - the `model` field sent on the wire is the *deployment name*
 *     (config.azureDeployment), not a model id.
 *   - the credential is config.apiKey ONLY — OPENAI_API_KEY is never read
 *     for this provider (S-11), and Entra/AAD token auth is out of scope
 *     for this phase: no AZURE_* environment variable is ever read here.
 *
 * Like OpenAIProvider, complete() never throws for provider/transport
 * conditions; every failure maps to a closed LlmProvider.ERROR_CODES value.
 */

"use strict";

const { createRequire } = require("node:module");
const { createGuardedFetch } = require("../transport/guardedFetch");
const RetryPolicy = require("../RetryPolicy");
const LlmBudget = require("../LlmBudget");
const Semaphore = require("../Semaphore");

const AUTH_STATUSES = new Set([401, 403]);
const BAD_REQUEST_STATUSES = new Set([400, 404, 422]);
// ADR section 6/R1 item 3: Azure v1 model labels for telemetry must still
// pass the same label shape as any other provider (LlmTelemetry regex) —
// a deployment name containing characters outside that shape is reported
// as "invalid" rather than echoed verbatim.
const MODEL_LABEL_RE = /^[A-Za-z0-9._-]{1,64}$/;

function defaultImportOpenAI() {
    return import("openai").catch(() => {
        const rq = createRequire(__filename);
        return rq("openai");
    });
}

function mapStatusToErrorCode(status) {
    if (AUTH_STATUSES.has(status)) return "AUTH_FAILED";
    if (BAD_REQUEST_STATUSES.has(status)) return "BAD_REQUEST";
    if (status === 429) return "RATE_LIMITED";
    return "PROVIDER_ERROR";
}

function safeUsage(usage) {
    if (!usage || typeof usage !== "object") return null;
    const promptTokens = Number.isSafeInteger(usage.prompt_tokens) ? usage.prompt_tokens : null;
    const completionTokens = Number.isSafeInteger(usage.completion_tokens) ? usage.completion_tokens : null;
    if (promptTokens === null && completionTokens === null) return null;
    return { promptTokens, completionTokens };
}

function readRetryAfterMs(error) {
    const headers = (error && error.headers) || (error && error.response && error.response.headers) || null;
    if (!headers) return undefined;
    const raw = typeof headers.get === "function" ? headers.get("retry-after") : headers["retry-after"];
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return seconds * 1000;
}

function buildBaseUrl(config) {
    return `https://${config.azureResource}.${config.azureHostSuffix}/openai/v1`;
}

class AzureOpenAIProvider {
    /**
     * @param {Object} config - a resolved LlmConfig.config object
     *   (provider === "azure-openai").
     * @param {Object} [deps] - injectable seams for tests: importOpenAI,
     *   createGuardedFetch, baseUrl, policyOpts, transportDeps, sleep, now,
     *   budget, semaphore.
     */
    constructor(config, deps = {}) {
        this.id = "azure-openai";
        const deployment =
            typeof config.azureDeployment === "string" && config.azureDeployment.trim() !== ""
                ? config.azureDeployment.trim()
                : "";
        this.modelLabel = MODEL_LABEL_RE.test(deployment) ? deployment : "invalid";
        this.endpointClass = "azure";
        this._deployment = deployment;
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
            const baseUrl = this._deps.baseUrl || buildBaseUrl(this._config);
            const policyOpts = this._deps.policyOpts || {};
            const createFetch = this._deps.createGuardedFetch || createGuardedFetch;
            const fetchImpl = createFetch({
                baseUrl,
                policyOpts,
                timeoutMs: this._config.timeoutMs,
                maxResponseBytes: this._config.maxResponseBytes,
                deps: this._deps.transportDeps,
            });
            // S-11/S-12: apiKey comes only from the resolved config (never
            // OPENAI_API_KEY, never an AZURE_* env var — Entra/AAD token
            // auth is unsupported this phase and no such flow is ever
            // started). No api-version query/header is ever added — the
            // Azure v1 surface does not use one (R1 item 3).
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
                    model: this._deployment,
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

module.exports = AzureOpenAIProvider;
