/**
 * src/core/llm/LlmProviderRegistry.js — frozen, literal lookup from a
 * resolved LlmConfig (legacy) or a ProviderContext (ADR-0019) to a concrete
 * provider instance (ADR-0017 section 6, ADR-0019 "Registry").
 *
 * Deliberately NOT dynamic: there is no `require(providerId)` or similar
 * string-driven module loading, so a resolved config value can never cause
 * an arbitrary file to be loaded. Only the four ids wired in below exist.
 * OpenAIProvider / AzureOpenAIProvider / OpenAICompatibleProvider are later
 * tasks (Dev-01b/c); until they land, resolving a config for those provider
 * ids throws a programmer error rather than silently returning something
 * that looks like it works. anthropic/gemini remain unwired until the
 * adapter task (ADR-0019 WP3).
 */

"use strict";

const DisabledProvider = require("./providers/DisabledProvider");
const OpenAIProvider = require("./providers/OpenAIProvider");
const AzureOpenAIProvider = require("./providers/AzureOpenAIProvider");
const OpenAICompatibleProvider = require("./providers/OpenAICompatibleProvider");

/**
 * Frozen literal map of provider id -> factory. Every entry is a plain
 * function reference, not a dynamic lookup keyed by untrusted input beyond
 * the exact string match below.
 */
const FACTORIES = Object.freeze({
    disabled: (_config, _deps) => new DisabledProvider(),
    openai: (config, deps) => new OpenAIProvider(config, deps),
    "azure-openai": (config, deps) => new AzureOpenAIProvider(config, deps),
    "openai-compatible": (config, deps) => new OpenAICompatibleProvider(config, deps),
});

/**
 * Legacy per-process memoization cache, keyed by provider id (unchanged
 * behaviour, ADR-0017 section 3 — "provider=Registry.resolve(config)
 * memoized per process"). Preserved byte-for-byte for callers that still
 * pass a plain resolved LlmConfig object rather than a ProviderContext.
 */
const memo = new Map();

/**
 * ADR-0019 "Registry": per-context memoization cache, keyed by the
 * ProviderContext object itself (not by provider id) — two distinct
 * invocation-scoped contexts that happen to select the same provider id
 * must get distinct provider instances (fixes S-01 cross-invocation
 * starvation; N01/N02).
 */
const contextMemo = new WeakMap();

/**
 * @param {Object} value - candidate ProviderContext.
 * @returns {boolean} true if `value` looks like a ProviderContext produced
 *   by ProviderContext.resolve()/getDefaultContext() (has a `config` and a
 *   `runtime` with budget/semaphore), as opposed to a legacy plain
 *   LlmConfig.resolve() config object.
 */
function isProviderContext(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        value.config !== null &&
        typeof value.config === "object" &&
        value.runtime !== null &&
        typeof value.runtime === "object" &&
        typeof value.runtime.budget === "object" &&
        typeof value.runtime.semaphore === "object"
    );
}

/**
 * @param {{provider:string}|Object} contextOrConfig - either a resolved
 *   ProviderContext (ADR-0019) or a legacy resolved LlmConfig.config object.
 * @param {Object} [deps] - optional dependency overrides (e.g. for tests).
 *   When `contextOrConfig` is a ProviderContext, `deps.budget`/
 *   `deps.semaphore` are always taken from `contextOrConfig.runtime` —
 *   explicit overrides in `deps` for those two keys are ignored so a
 *   context's own per-invocation budget/semaphore can never be bypassed.
 * @returns {Object} a provider instance implementing the LlmProvider
 *   contract (id, modelLabel, endpointClass, complete(), close()).
 * @throws {Error} if the selected provider id is not a wired-in provider.
 */
function resolve(contextOrConfig, deps = {}) {
    if (isProviderContext(contextOrConfig)) {
        if (contextMemo.has(contextOrConfig)) return contextMemo.get(contextOrConfig);
        const config = contextOrConfig.config;
        const id = config && config.provider;
        if (!Object.hasOwn(FACTORIES, id)) {
            throw new Error(`LlmProviderRegistry: no provider wired in for id "${id}".`);
        }
        const mergedDeps = Object.assign({}, deps, {
            budget: contextOrConfig.runtime.budget,
            semaphore: contextOrConfig.runtime.semaphore,
        });
        const instance = FACTORIES[id](config, mergedDeps);
        contextMemo.set(contextOrConfig, instance);
        return instance;
    }

    const config = contextOrConfig;
    const id = config && config.provider;
    if (!Object.hasOwn(FACTORIES, id)) {
        throw new Error(`LlmProviderRegistry: no provider wired in for id "${id}".`);
    }
    if (memo.has(id)) return memo.get(id);
    const instance = FACTORIES[id](config, deps);
    memo.set(id, instance);
    return instance;
}

/** Test-only seam: clear both the legacy and context memoization caches. */
function _resetMemoForTests() {
    memo.clear();
    // WeakMap has no .clear(); tests use fresh context objects per case, so
    // stale entries are unreachable and GC-collectible — nothing to do here
    // beyond documenting the seam for discoverability.
}

module.exports = { resolve, _resetMemoForTests };
