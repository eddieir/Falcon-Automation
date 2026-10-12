/**
 * src/core/llm/LlmProviderRegistry.js — frozen, literal lookup from a
 * resolved LlmConfig to a concrete provider instance (ADR-0017 section 6).
 *
 * Deliberately NOT dynamic: there is no `require(providerId)` or similar
 * string-driven module loading, so a resolved config value can never cause
 * an arbitrary file to be loaded. Only the four ids wired in below exist.
 * OpenAIProvider / AzureOpenAIProvider / OpenAICompatibleProvider are later
 * tasks (Dev-01b/c); until they land, resolving a config for those provider
 * ids throws a programmer error rather than silently returning something
 * that looks like it works.
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
    disabled: (_config) => new DisabledProvider(),
    openai: (config) => new OpenAIProvider(config),
    "azure-openai": (config) => new AzureOpenAIProvider(config),
    "openai-compatible": (config) => new OpenAICompatibleProvider(config),
});

/**
 * Per-process memoization cache, keyed by provider id. ADR section 3:
 * "provider=Registry.resolve(config) memoized per process" — a given
 * resolved config's provider id is only ever constructed once.
 */
const memo = new Map();

/**
 * @param {{provider:string}} config - a resolved LlmConfig.config object.
 * @returns {Object} a provider instance implementing the LlmProvider
 *   contract (id, modelLabel, endpointClass, complete(), close()).
 * @throws {Error} if `config.provider` is not a wired-in provider id.
 */
function resolve(config) {
    const id = config && config.provider;
    if (!Object.hasOwn(FACTORIES, id)) {
        throw new Error(`LlmProviderRegistry: no provider wired in for id "${id}".`);
    }
    if (memo.has(id)) return memo.get(id);
    const instance = FACTORIES[id](config);
    memo.set(id, instance);
    return instance;
}

/** Test-only seam: clear the per-process memoization cache. */
function _resetMemoForTests() {
    memo.clear();
}

module.exports = { resolve, _resetMemoForTests };
