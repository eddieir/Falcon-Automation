/**
 * src/core/llm/LlmConfig.js — Phase 17 LLM provider configuration
 * resolution (ADR-0017 sections 6-7, Sec-00 S-11/S-14).
 *
 * `resolve(get, env)` turns the raw `FALCON_LLM_*` / `OPENAI_API_KEY`
 * settings into either a validated config object or a structured, non-fatal
 * error. It never throws and it never performs network I/O — provider
 * credential/shape checks here are shape-only; the network egress
 * chokepoint (guardedFetch/EndpointPolicy) is implemented separately
 * (Dev-01b).
 *
 * `get` mirrors `ConfigManager.get(key)`: config-file value, else env var,
 * else null for "not configured anywhere". `env` is a plain key/value map
 * (defaults to `process.env`) used only to enumerate `FALCON_LLM_*` key
 * *names* for the unknown-key warning (S-14) — `get` alone cannot enumerate
 * keys it doesn't already know about.
 */

"use strict";

const Logger = require("../../../utils/Logger");
const { validateIntSetting } = require("../util/ConfigValidation");
const { stripControlChars } = require("../util/OutputSafe");
const { PROVIDER_IDS } = require("./LlmProvider");
const { validateEndpointUrl } = require("./transport/EndpointPolicy");

const INT_BOUNDS = Object.freeze({
    FALCON_LLM_TIMEOUT_MS: { min: 1000, max: 60000, def: 10000, prop: "timeoutMs" },
    FALCON_LLM_MAX_ATTEMPTS: { min: 1, max: 3, def: 2, prop: "maxAttempts" },
    FALCON_LLM_RUN_BUDGET: { min: 1, max: 500, def: 50, prop: "runBudget" },
    FALCON_LLM_MAX_RESPONSE_BYTES: { min: 4096, max: 1048576, def: 65536, prop: "maxResponseBytes" },
    FALCON_LLM_MAX_PROMPT_CANDIDATES: { min: 1, max: 60, def: 20, prop: "maxPromptCandidates" },
    FALCON_LLM_CONCURRENCY: { min: 1, max: 4, def: 2, prop: "concurrency" },
});

// Fixed per ADR section 3/S-09 — not operator-configurable via env.
const PROMPT_MAX_BYTES = 8192;

const NON_NUMERIC_KEYS = Object.freeze([
    "FALCON_LLM_PROVIDER",
    "FALCON_LLM_API_KEY",
    "FALCON_LLM_MODEL",
    "FALCON_LLM_AZURE_RESOURCE",
    "FALCON_LLM_AZURE_HOST_SUFFIX",
    "FALCON_LLM_AZURE_DEPLOYMENT",
    "FALCON_LLM_ENDPOINT",
    "FALCON_LLM_ALLOW_CUSTOM_ENDPOINT",
    "FALCON_LLM_ALLOW_HTTP_LOOPBACK",
    "FALCON_LLM_ALLOW_PRIVATE_ENDPOINT",
]);

const KNOWN_KEYS = new Set([...NON_NUMERIC_KEYS, ...Object.keys(INT_BOUNDS)]);

const AZURE_RESOURCE_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const AZURE_HOST_SUFFIXES = new Set(["openai.azure.com", "services.ai.azure.com"]);

// S-14: fired at most once per process regardless of how many times
// resolve() is called (startup may call it more than once in some paths).
let warnedUnknownKeys = false;
// OD-1/S-11: "warned once per process, no key" for the legacy-key path too.
let warnedProviderRequired = false;

/** @returns {string|null} trimmed value, or null for blank/whitespace/unset. */
function readTrimmed(get, key) {
    const raw = get(key);
    if (raw === null || raw === undefined) return null;
    const str = String(raw);
    const trimmed = str.trim();
    return trimmed === "" ? null : { raw: str, trimmed };
}

function readProvider(get) {
    const raw = get("FALCON_LLM_PROVIDER");
    if (raw === null || raw === undefined) return { unset: true };
    const str = String(raw);
    if (str.trim() === "") return { unset: true };
    return { unset: false, value: str };
}

function fail(errorCode, detail) {
    return { ok: false, errorCode, detail };
}

function warnUnknownKeys(env) {
    if (warnedUnknownKeys) return;
    const unknown = Object.keys(env || {})
        .filter((k) => k.startsWith("FALCON_LLM_") && !KNOWN_KEYS.has(k))
        .map((k) => stripControlChars(k).slice(0, 64));
    if (unknown.length === 0) return;
    warnedUnknownKeys = true;
    Logger.warning(`Unknown FALCON_LLM_* configuration key(s): ${unknown.join(", ")}`);
}

/**
 * Build the apiKey accessor as a non-enumerable property so a resolved
 * config object never leaks its credential through JSON.stringify,
 * util.inspect, or Object.keys/for-in — only explicit `config.apiKey`
 * access reads it (S-11/S-14 redaction intent carried into Phase 17).
 */
function defineHiddenApiKey(target, value) {
    Object.defineProperty(target, "apiKey", {
        value: value ?? null,
        enumerable: false,
        writable: false,
        configurable: false,
    });
}

/**
 * Resolve Phase 17 LLM provider configuration.
 *
 * @param {function(string): *} get - ConfigManager-like getter.
 * @param {Object} [env] - key/value map to enumerate FALCON_LLM_* names
 *   from for the unknown-key warning. Defaults to process.env.
 * @returns {{ok:true, config:Object}|{ok:false, errorCode:string, detail:string}}
 */
function resolve(get, env = process.env) {
    try {
        return resolveInner(get, env);
    } catch (error) {
        // Belt-and-braces: resolve() must never throw. Any unexpected
        // failure (a hostile `get` implementation, etc.) becomes a plain
        // configuration error rather than crashing the caller.
        return fail("CONFIG_INVALID", `Unexpected configuration error: ${error && error.message}`);
    }
}

function resolveInner(get, env) {
    warnUnknownKeys(env);

    const providerRaw = readProvider(get);
    let provider;

    if (providerRaw.unset) {
        const openaiKeyPresent = readTrimmed(get, "OPENAI_API_KEY") !== null;
        if (openaiKeyPresent) {
            if (!warnedProviderRequired) {
                warnedProviderRequired = true;
                Logger.warning(
                    "OPENAI_API_KEY is set but no provider is configured — set FALCON_LLM_PROVIDER to use it.",
                );
            }
            return fail(
                "CONFIG_PROVIDER_REQUIRED",
                "OPENAI_API_KEY alone does not select a provider; set FALCON_LLM_PROVIDER.",
            );
        }
        provider = "disabled";
    } else {
        const raw = providerRaw.value;
        if (raw === "none") {
            provider = "disabled";
        } else if (PROVIDER_IDS.includes(raw)) {
            provider = raw;
        } else {
            return fail("CONFIG_UNSUPPORTED_PROVIDER", "Unsupported FALCON_LLM_PROVIDER value.");
        }
    }

    // --- Conflict checks (ADR section 6) ---------------------------------
    const azureResource = readTrimmed(get, "FALCON_LLM_AZURE_RESOURCE");
    const azureHostSuffix = readTrimmed(get, "FALCON_LLM_AZURE_HOST_SUFFIX");
    const azureDeployment = readTrimmed(get, "FALCON_LLM_AZURE_DEPLOYMENT");
    const model = readTrimmed(get, "FALCON_LLM_MODEL");
    const endpoint = readTrimmed(get, "FALCON_LLM_ENDPOINT");
    const allowCustomEndpoint = readTrimmed(get, "FALCON_LLM_ALLOW_CUSTOM_ENDPOINT");
    const allowHttpLoopback = readTrimmed(get, "FALCON_LLM_ALLOW_HTTP_LOOPBACK");
    const allowPrivateEndpoint = readTrimmed(get, "FALCON_LLM_ALLOW_PRIVATE_ENDPOINT");
    const apiKeyRaw = readTrimmed(get, "FALCON_LLM_API_KEY");

    for (const [name, value] of [
        ["FALCON_LLM_ALLOW_CUSTOM_ENDPOINT", allowCustomEndpoint],
        ["FALCON_LLM_ALLOW_HTTP_LOOPBACK", allowHttpLoopback],
        ["FALCON_LLM_ALLOW_PRIVATE_ENDPOINT", allowPrivateEndpoint],
    ]) {
        if (value && value.trimmed !== "true" && value.trimmed !== "false") {
            return fail("CONFIG_INVALID", `${name} must be "true" or "false".`);
        }
    }

    const anyAzureField = azureResource || azureHostSuffix || azureDeployment;
    if (anyAzureField && provider !== "azure-openai") {
        return fail("CONFIG_CONFLICT", "FALCON_LLM_AZURE_* is set but FALCON_LLM_PROVIDER is not azure-openai.");
    }
    if ((endpoint || allowCustomEndpoint) && provider !== "openai-compatible") {
        return fail(
            "CONFIG_CONFLICT",
            "FALCON_LLM_ENDPOINT/ALLOW_CUSTOM_ENDPOINT is set but FALCON_LLM_PROVIDER is not openai-compatible.",
        );
    }
    if (model && azureDeployment) {
        return fail("CONFIG_CONFLICT", "FALCON_LLM_MODEL and FALCON_LLM_AZURE_DEPLOYMENT cannot both be set.");
    }
    if (allowHttpLoopback && endpoint && /^https:\/\//i.test(endpoint.trimmed)) {
        return fail("CONFIG_CONFLICT", "FALCON_LLM_ALLOW_HTTP_LOOPBACK is set but FALCON_LLM_ENDPOINT is https.");
    }
    if (provider === "disabled") {
        const anySet =
            apiKeyRaw ||
            model ||
            anyAzureField ||
            endpoint ||
            allowCustomEndpoint ||
            allowHttpLoopback ||
            allowPrivateEndpoint;
        const anyNumericSet = Object.keys(INT_BOUNDS).some((k) => readTrimmed(get, k) !== null);
        if (anySet || anyNumericSet) {
            return fail("CONFIG_CONFLICT", "FALCON_LLM_* settings are present while the provider is disabled/none.");
        }
    }

    // --- Numeric bounds (ADR section 7) -----------------------------------
    const numeric = {};
    for (const [key, bound] of Object.entries(INT_BOUNDS)) {
        try {
            const value = validateIntSetting(key, get(key), bound);
            numeric[bound.prop] = value === null ? bound.def : value;
        } catch (error) {
            return fail("CONFIG_INVALID", error.message);
        }
    }

    // --- Provider-specific shape/credential checks ------------------------
    let apiKey = apiKeyRaw ? apiKeyRaw.trimmed : null;
    let endpointClass = null;

    if (provider === "openai") {
        // S-11: OPENAI_API_KEY is a credential source ONLY for provider=openai,
        // and only when FALCON_LLM_API_KEY is unset.
        if (!apiKey) {
            const openaiKey = readTrimmed(get, "OPENAI_API_KEY");
            if (openaiKey) apiKey = openaiKey.trimmed;
        }
        if (!apiKey) {
            return fail("CONFIG_MISSING_CREDENTIALS", "provider=openai requires FALCON_LLM_API_KEY (or OPENAI_API_KEY).");
        }
        endpointClass = "openai_public";
    } else if (provider === "azure-openai") {
        if (!azureResource || !AZURE_RESOURCE_RE.test(azureResource.trimmed)) {
            return fail("CONFIG_INVALID", "FALCON_LLM_AZURE_RESOURCE is missing or malformed.");
        }
        if (!azureHostSuffix || !AZURE_HOST_SUFFIXES.has(azureHostSuffix.trimmed)) {
            return fail("CONFIG_INVALID", "FALCON_LLM_AZURE_HOST_SUFFIX is missing or not a supported suffix.");
        }
        if (!azureDeployment) {
            return fail("CONFIG_INVALID", "FALCON_LLM_AZURE_DEPLOYMENT is required for provider=azure-openai.");
        }
        if (!apiKey) {
            return fail("CONFIG_MISSING_CREDENTIALS", "provider=azure-openai requires FALCON_LLM_API_KEY.");
        }
        endpointClass = "azure";
    } else if (provider === "openai-compatible") {
        if (!allowCustomEndpoint || allowCustomEndpoint.trimmed !== "true") {
            return fail(
                "CONFIG_ENDPOINT_OPT_IN_REQUIRED",
                "provider=openai-compatible requires FALCON_LLM_ALLOW_CUSTOM_ENDPOINT=true.",
            );
        }
        if (!endpoint) {
            return fail("CONFIG_INVALID", "FALCON_LLM_ENDPOINT is missing or not an absolute https URL ending in /v1.");
        }
        const shapeCheck = validateEndpointUrl(endpoint.trimmed, {
            allowHttpLoopback: Boolean(allowHttpLoopback && allowHttpLoopback.trimmed === "true"),
            allowLoopback: true,
            allowPrivate: Boolean(allowPrivateEndpoint && allowPrivateEndpoint.trimmed === "true"),
        });
        if (!shapeCheck.ok) {
            return fail(shapeCheck.errorCode, "FALCON_LLM_ENDPOINT is missing or not an absolute https URL ending in /v1.");
        }
        // Endpoint class (loopback/private/public) is derived from the
        // *resolved address* at network time (OD-5) — Dev-01b/EndpointPolicy.
        endpointClass = null;
    }

    const config = {
        provider,
        model: model ? model.trimmed : "gpt-4o-mini",
        azureResource: azureResource ? azureResource.trimmed : null,
        azureHostSuffix: azureHostSuffix ? azureHostSuffix.trimmed : null,
        azureDeployment: azureDeployment ? azureDeployment.trimmed : null,
        endpoint: endpoint ? endpoint.trimmed : null,
        allowCustomEndpoint: Boolean(allowCustomEndpoint && allowCustomEndpoint.trimmed === "true"),
        allowHttpLoopback: Boolean(allowHttpLoopback && allowHttpLoopback.trimmed === "true"),
        allowPrivateEndpoint: Boolean(allowPrivateEndpoint && allowPrivateEndpoint.trimmed === "true"),
        endpointClass,
        promptMaxBytes: PROMPT_MAX_BYTES,
        ...numeric,
    };
    defineHiddenApiKey(config, apiKey);

    return { ok: true, config };
}

/** Test-only seam: reset the "warn once per process" latches. */
function _resetWarningLatchesForTests() {
    warnedUnknownKeys = false;
    warnedProviderRequired = false;
}

module.exports = {
    resolve,
    PROMPT_MAX_BYTES,
    _resetWarningLatchesForTests,
    // Additive exports (ADR-0019/Dev-02) — reused by ProviderContext.js so
    // the direct-config validation rules (azure resource/host-suffix shape,
    // numeric bounds) stay in exactly one place. Pre-existing exports above
    // are unchanged.
    INT_BOUNDS,
    AZURE_RESOURCE_RE,
    AZURE_HOST_SUFFIXES,
};
