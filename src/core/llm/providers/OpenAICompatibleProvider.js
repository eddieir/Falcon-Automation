/**
 * src/core/llm/providers/OpenAICompatibleProvider.js — the `provider:
 * "openai-compatible"` adapter (ADR-0017 sections 6-8, Sec-00 S-01/S-05/
 * S-11/S-12/S-15/S-17).
 *
 * Mirrors OpenAIProvider's wiring (lazy SDK import, guardedFetch transport,
 * RetryPolicy/LlmBudget/Semaphore). Two differences:
 *   - this provider only ever runs opt-in (AC04): without
 *     config.allowCustomEndpoint === true it returns
 *     CONFIG_ENDPOINT_OPT_IN_REQUIRED synchronously, before any client is
 *     built and before any I/O — zero requests reach any server.
 *   - the base address is operator-controlled (config.endpoint), so the
 *     SSRF policy opts (loopback/private) are threaded straight from the
 *     resolved config into guardedFetch's EndpointPolicy — this NEVER
 *     widens the always-deny set (EndpointPolicy enforces that
 *     independently of these opts).
 *
 * The true endpoint class (loopback/private/public) for a plain DNS
 * hostname is only known once guardedFetch actually resolves it, and
 * guardedFetch does not currently expose that resolved classification back
 * to the caller (no `onResolved` hook exists on createGuardedFetch). For a
 * literal IP/loopback-name endpoint this provider classifies it eagerly at
 * construction (shape-level, no I/O) via EndpointPolicy; for a plain DNS
 * hostname it reports a best-effort "custom_public" label — this is a known
 * limitation, see OPEN_RISKS in the Dev-02b handoff.
 */

"use strict";

const { createRequire } = require("node:module");
const { createGuardedFetch } = require("../transport/guardedFetch");
const { validateEndpointUrl, classifyAddress } = require("../transport/EndpointPolicy");
const RetryPolicy = require("../RetryPolicy");
const LlmBudget = require("../LlmBudget");
const Semaphore = require("../Semaphore");

const AUTH_STATUSES = new Set([401, 403]);
const BAD_REQUEST_STATUSES = new Set([400, 404, 422]);
// Ollama and most local OpenAI-compatible servers ignore the Authorization
// header entirely when no key is configured; the openai SDK requires a
// non-empty `apiKey` string to construct a client at all, so a fixed,
// non-secret placeholder is used ONLY when config.apiKey is unset — it is
// never a real credential and is never treated as one.
const UNUSED_KEY_PLACEHOLDER = "unused";

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

/** @returns {{allowLoopback:boolean, allowHttpLoopback:boolean, allowPrivate:boolean}} */
function policyOptsFromConfig(config) {
    return {
        allowLoopback: Boolean(config.allowHttpLoopback),
        allowHttpLoopback: Boolean(config.allowHttpLoopback),
        allowPrivate: Boolean(config.allowPrivateEndpoint),
    };
}

/**
 * Best-effort, I/O-free endpoint class for telemetry (see file header for
 * the DNS-hostname limitation).
 * @returns {string|null}
 */
function deriveEndpointClass(endpoint, policyOpts) {
    if (typeof endpoint !== "string" || endpoint === "") return null;
    const shape = validateEndpointUrl(endpoint, policyOpts);
    if (!shape.ok) return null;
    if (shape.hostKind !== "ip") {
        // Plain DNS hostname — real classification happens at resolution
        // time inside guardedFetch, which this provider cannot observe.
        return "custom_public";
    }
    const unbracketed = shape.url.hostname.replace(/^\[|\]$/g, "");
    const literalIp = unbracketed === "localhost" || unbracketed === "localhost." ? "127.0.0.1" : unbracketed;
    const classification = classifyAddress(literalIp, policyOpts);
    return classification.endpointClass;
}

class OpenAICompatibleProvider {
    /**
     * @param {Object} config - a resolved LlmConfig.config object
     *   (provider === "openai-compatible").
     * @param {Object} [deps] - injectable seams for tests: importOpenAI,
     *   createGuardedFetch, baseUrl, policyOpts, transportDeps, sleep, now,
     *   budget, semaphore.
     */
    constructor(config, deps = {}) {
        this.id = "openai-compatible";
        this.modelLabel =
            typeof config.model === "string" && config.model.trim() !== "" ? config.model.trim() : "custom";
        this._config = config;
        this._deps = deps;
        this._optedIn = config.allowCustomEndpoint === true;
        const policyOpts = deps.policyOpts || policyOptsFromConfig(config);
        this.endpointClass = this._optedIn ? deriveEndpointClass(config.endpoint, policyOpts) : null;
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
            const baseUrl = this._deps.baseUrl || this._config.endpoint;
            const policyOpts = this._deps.policyOpts || policyOptsFromConfig(this._config);
            const createFetch = this._deps.createGuardedFetch || createGuardedFetch;
            const fetchImpl = createFetch({
                baseUrl,
                policyOpts,
                timeoutMs: this._config.timeoutMs,
                maxResponseBytes: this._config.maxResponseBytes,
                deps: this._deps.transportDeps,
            });
            const apiKey =
                typeof this._config.apiKey === "string" && this._config.apiKey !== ""
                    ? this._config.apiKey
                    : UNUSED_KEY_PLACEHOLDER;
            const client = new OpenAI({
                apiKey,
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
        if (!this._optedIn) {
            return { ok: false, errorCode: "CONFIG_ENDPOINT_OPT_IN_REQUIRED" };
        }
        if (this._budget.remaining() <= 0) {
            return { ok: false, errorCode: "BUDGET_EXHAUSTED" };
        }
        return { ok: true };
    }

    async complete(req) {
        const now = this._deps.now || Date.now;
        const sleep = this._deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        const start = now();

        // AC04: opt-in gate, enforced before any client is built and
        // before any network I/O — zero requests on a false/missing opt-in.
        if (!this._optedIn) {
            return {
                ok: false,
                errorCode: "CONFIG_ENDPOINT_OPT_IN_REQUIRED",
                provider: this.id,
                modelLabel: this.modelLabel,
                latencyMs: now() - start,
                attempts: 0,
                retryable: false,
            };
        }

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

module.exports = OpenAICompatibleProvider;
