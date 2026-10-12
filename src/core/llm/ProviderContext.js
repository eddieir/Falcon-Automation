/**
 * src/core/llm/ProviderContext.js — invocation-scoped BYOK provider context
 * resolution (ADR-0019).
 *
 * `resolve({options, profile, get, env})` turns a direct invocation
 * (CLI flags / explicit call-site options), an optional profile object, and
 * the existing Phase 17 `FALCON_LLM_*` env-compat layer into either a
 * validated, deep-frozen ProviderContext or a structured, non-fatal error.
 * It never throws, never performs network or file I/O, and never writes to
 * `process.env`.
 *
 * Precedence per field is options > profile > env-compat > defaults. When
 * neither `options` nor `profile` select a provider, resolution is
 * delegated wholly to `LlmConfig.resolve()` so Phase 17 env-only behaviour
 * (including its error codes) stays byte-identical.
 *
 * Every context owns its own `LlmBudget`/`Semaphore` (no cross-invocation
 * starvation) layered on top of the process-wide hard ceilings in
 * `LlmBudget.processCeiling` (C15) — no matter how many contexts exist in
 * this process, their combined attempts/in-flight requests can never exceed
 * those ceilings.
 */

"use strict";

const { validateIntSetting } = require("../util/ConfigValidation");
const { PROVIDER_IDS } = require("./LlmProvider");
const { validateEndpointUrl } = require("./transport/EndpointPolicy");
const { isKeyShapedValue, isValidCredentialShape } = require("./transport/guardedFetch");
const LlmConfig = require("./LlmConfig");
const LlmBudget = require("./LlmBudget");
const Semaphore = require("./Semaphore");

const INT_BOUNDS = LlmConfig.INT_BOUNDS;
const AZURE_RESOURCE_RE = LlmConfig.AZURE_RESOURCE_RE;
const AZURE_HOST_SUFFIXES = LlmConfig.AZURE_HOST_SUFFIXES;
const PROMPT_MAX_BYTES = LlmConfig.PROMPT_MAX_BYTES;

const BOUND_BY_PROP = Object.freeze(
    Object.fromEntries(Object.entries(INT_BOUNDS).map(([envKey, bound]) => [bound.prop, { ...bound, envKey }])),
);

// Model id charsets (ADR-0019 C1): gemini is stricter because its model id
// is placed directly in a URL path — no '/', ':' or '%'-style escapes, no
// "models/" prefix is representable at all under this charset.
const MODEL_RE_GENERIC = /^[A-Za-z0-9._:/-]{1,64}$/;
const MODEL_RE_GEMINI = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// Credential env-var NAME shape (ADR-0019 C11, this task's binding spec).
const CRED_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}_API_KEY$/;
const CRED_NAME_DENY_EXACT = new Set(["PATH", "HOME", "SHELL", "USER", "PWD", "TMPDIR"]);
const CRED_NAME_DENY_PREFIX = Object.freeze(["NODE_", "LD_", "DYLD_", "npm_"]);

const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

function fail(errorCode, detail) {
    return { ok: false, errorCode, detail };
}

function isBlankOrControl(value) {
    if (typeof value !== "string") return true;
    if (value.trim() === "") return true;
    return CONTROL_CHAR_RE.test(value);
}

function isDeniedCredentialName(name) {
    if (CRED_NAME_DENY_EXACT.has(name)) return true;
    return CRED_NAME_DENY_PREFIX.some((prefix) => name.startsWith(prefix));
}

/**
 * Read a property's value from `env` WITHOUT triggering a `get` trap on a
 * Proxy-wrapped `env` — existence/shape validation at resolve() time must
 * never count as "reading the credential" (ADR-0019 C15/AC15): this peeks
 * the own-property descriptor instead of indexing `env[name]`.
 */
function peekOwnValue(obj, name) {
    const descriptor = Object.getOwnPropertyDescriptor(obj, name);
    return descriptor ? descriptor.value : undefined;
}

/**
 * Validate a credential env-var reference's NAME and (resolve-time) shape
 * without ever exposing the value outside this function and without
 * reading it through the normal `env[name]` property-get path.
 */
function validateCredentialRef(name, env) {
    if (typeof name !== "string" || isBlankOrControl(name)) {
        return fail("CONFIG_INVALID", "credentialEnvVar must be a non-blank string.");
    }
    const trimmed = name.trim();
    if (!CRED_NAME_RE.test(trimmed)) {
        return fail("CONFIG_INVALID", "credentialEnvVar does not match the required *_API_KEY name shape.");
    }
    if (isDeniedCredentialName(trimmed)) {
        return fail("CONFIG_INVALID", "credentialEnvVar names a reserved/system environment variable.");
    }
    if (!Object.hasOwn(env, trimmed)) {
        return fail("CONFIG_MISSING_CREDENTIALS", "The configured credential environment variable is not set.");
    }
    const raw = peekOwnValue(env, trimmed);
    if (typeof raw !== "string" || raw === "") {
        return fail("CONFIG_MISSING_CREDENTIALS", "The configured credential environment variable is empty.");
    }
    if (!isValidCredentialShape(raw)) {
        return fail("CONFIG_INVALID", "The configured credential environment variable has an invalid shape.");
    }
    return { ok: true, name: trimmed };
}

/**
 * Build a non-enumerable, never-cached apiKey reader for a named env-var
 * credential. The returned function reads `env[name]` fresh on every call
 * (ADR-0019: "never cached on the context") and never throws.
 */
function makeNamedCredentialReader(name, env) {
    return function readCredential() {
        if (!Object.hasOwn(env, name)) return null;
        const raw = env[name];
        if (typeof raw !== "string" || raw === "") return null;
        if (!isValidCredentialShape(raw)) return null;
        return raw;
    };
}

/** Attach a non-enumerable `apiKey` getter to `config` (never logged/JSON'd). */
function defineHiddenApiKeyGetter(config, readCredential) {
    Object.defineProperty(config, "apiKey", {
        get: readCredential,
        enumerable: false,
        configurable: false,
    });
}

function pickField(options, profile, get, name, envKey) {
    if (Object.hasOwn(options, name) && options[name] !== undefined) {
        return { value: options[name], source: "options" };
    }
    if (Object.hasOwn(profile, name) && profile[name] !== undefined) {
        return { value: profile[name], source: "profile" };
    }
    if (envKey) {
        const raw = get(envKey);
        if (raw !== null && raw !== undefined) {
            const str = String(raw).trim();
            if (str !== "") return { value: str, source: "env" };
        }
    }
    return { value: undefined, source: "default" };
}

function validateStringField(name, pick, { required = false, keyShapeCheck = true, charsetRe = null } = {}) {
    if (pick.value === undefined) {
        if (required) return fail("CONFIG_INVALID", `${name} is required for this provider.`);
        return { ok: true, value: null };
    }
    const value = pick.value;
    if (typeof value !== "string") return fail("CONFIG_INVALID", `${name} must be a string.`);
    if (isBlankOrControl(value)) {
        return fail("CONFIG_INVALID", `${name} must not be blank or contain control characters.`);
    }
    const trimmed = value.trim();
    if (keyShapeCheck && isKeyShapedValue(trimmed)) {
        return fail("CONFIG_INVALID", `${name} must not contain a credential-shaped value.`);
    }
    if (charsetRe && !charsetRe.test(trimmed)) {
        return fail("CONFIG_INVALID", `${name} has an invalid format.`);
    }
    return { ok: true, value: trimmed };
}

function validateBoolField(name, pick) {
    if (pick.value === undefined) return { ok: true, value: false, source: "default" };
    const value = pick.value;
    if (typeof value === "boolean") return { ok: true, value, source: pick.source };
    if (typeof value === "string" && (value === "true" || value === "false")) {
        return { ok: true, value: value === "true", source: pick.source };
    }
    return fail("CONFIG_INVALID", `${name} must be a boolean.`);
}

function normalizeProviderValue(raw) {
    return raw === "none" ? "disabled" : raw;
}

/** Shared process-wide default-context memoization (C2). */
let defaultContextResult = null;

/**
 * Wrap a per-context LlmBudget so every attempt also consults the
 * process-wide hard ceiling (ADR-0019 C15): per-context exhaustion OR
 * process-wide exhaustion both block the attempt and consume nothing.
 */
function wrapBudget(budget) {
    return {
        consumeAttempt() {
            if (budget.remaining() <= 0) return false;
            if (!LlmBudget.processCeiling.tryConsumeAttempt()) return false;
            budget.consumeAttempt();
            return true;
        },
        remaining() {
            return budget.remaining();
        },
    };
}

/**
 * Wrap a per-context Semaphore so `run()` also claims/releases a
 * process-wide in-flight slot (ADR-0019 C15) around the wrapped function.
 */
function wrapSemaphore(semaphore) {
    return {
        acquire: (...args) => semaphore.acquire(...args),
        release: (...args) => semaphore.release(...args),
        async run(fn) {
            return semaphore.run(async () => {
                if (!LlmBudget.processCeiling.enterFlight()) {
                    const error = new Error("Semaphore: process-wide concurrency ceiling reached");
                    error.code = "SEMAPHORE_WAIT_TIMEOUT";
                    throw error;
                }
                try {
                    return await fn();
                } finally {
                    LlmBudget.processCeiling.leaveFlight();
                }
            });
        },
    };
}

function buildRuntime(config) {
    const budget = new LlmBudget(config.runBudget);
    const semaphore = new Semaphore(config.concurrency);
    return { budget: wrapBudget(budget), semaphore: wrapSemaphore(semaphore) };
}

/** Deep-ish freeze: freezes `config`/`sources`, then the context itself. */
function finalizeContext(config, sources, runtime, credentialEnvVarName) {
    Object.freeze(config);
    const frozenSources = Object.freeze({ ...sources });
    const context = { config, sources: frozenSources };
    Object.defineProperty(context, "runtime", {
        value: runtime,
        enumerable: false,
        writable: false,
        configurable: false,
    });
    // ADR-0019: "the env-var NAME may appear only in a non-enumerable
    // property" — present for diagnostics only, never JSON/inspect-visible.
    Object.defineProperty(context, "_credentialEnvVarName", {
        value: credentialEnvVarName ?? null,
        enumerable: false,
        writable: false,
        configurable: false,
    });
    Object.freeze(context);
    return context;
}

function resolveEnvOnlyInt(prop, get) {
    const bound = BOUND_BY_PROP[prop];
    const raw = get(bound.envKey);
    const value = validateIntSetting(bound.envKey, raw, bound);
    return value === null ? bound.def : value;
}

/**
 * Build a ProviderContext from a successful legacy `LlmConfig.resolve()`
 * config object (the env-only delegation path). Phase 17 behaviour here is
 * intentionally unchanged (C4/AC23) — this only adds the ADR-0019 runtime
 * (budget/semaphore) and source map around the existing config shape.
 */
function buildContextFromLegacyConfig(config) {
    const sources = {
        provider: "env",
        model: "env",
        azureResource: "env",
        azureHostSuffix: "env",
        azureDeployment: "env",
        endpoint: "env",
        allowCustomEndpoint: "env",
        allowHttpLoopback: "env",
        allowPrivateEndpoint: "env",
        timeoutMs: "env",
        maxAttempts: "env",
        runBudget: "env",
        maxResponseBytes: "env",
        maxPromptCandidates: "env",
        concurrency: "env",
        apiKey: "env",
    };
    const runtime = buildRuntime(config);
    return { ok: true, context: finalizeContext(config, sources, runtime, null) };
}

function resolveInner(options, profile, get, env) {
    const optProvider = Object.hasOwn(options, "provider") ? options.provider : undefined;
    const profProvider = Object.hasOwn(profile, "provider") ? profile.provider : undefined;
    const direct = optProvider !== undefined || profProvider !== undefined;

    if (!direct) {
        const delegated = LlmConfig.resolve(get, env);
        if (!delegated.ok) return delegated;
        return buildContextFromLegacyConfig(delegated.config);
    }

    const providerSource = optProvider !== undefined ? "options" : "profile";
    const providerRaw = optProvider !== undefined ? optProvider : profProvider;
    if (typeof providerRaw !== "string" || isBlankOrControl(providerRaw)) {
        return fail("CONFIG_INVALID", "provider must be a non-blank string.");
    }
    const provider = normalizeProviderValue(providerRaw.trim());
    if (!PROVIDER_IDS.includes(provider)) {
        return fail("CONFIG_UNSUPPORTED_PROVIDER", "Unsupported provider value.");
    }

    // Conflict against the Phase 17 env-compat provider (ADR-0019 section 7).
    const envProviderRaw = get("FALCON_LLM_PROVIDER");
    if (envProviderRaw !== null && envProviderRaw !== undefined) {
        const trimmedEnvProvider = String(envProviderRaw).trim();
        if (trimmedEnvProvider !== "" && normalizeProviderValue(trimmedEnvProvider) !== provider) {
            return fail("CONFIG_CONFLICT", "FALCON_LLM_PROVIDER conflicts with the directly selected provider.");
        }
    }

    const isAnthropicOrGemini = provider === "anthropic" || provider === "gemini";

    const modelPick = pickField(options, profile, get, "model", "FALCON_LLM_MODEL");
    const endpointPick = pickField(options, profile, get, "endpoint", "FALCON_LLM_ENDPOINT");
    const allowCustomPick = pickField(options, profile, get, "allowCustomEndpoint", "FALCON_LLM_ALLOW_CUSTOM_ENDPOINT");
    const allowHttpLoopbackPick = pickField(
        options,
        profile,
        get,
        "allowHttpLoopback",
        "FALCON_LLM_ALLOW_HTTP_LOOPBACK",
    );
    const allowPrivatePick = pickField(options, profile, get, "allowPrivateEndpoint", "FALCON_LLM_ALLOW_PRIVATE_ENDPOINT");
    const azureResourcePick = pickField(options, profile, get, "azureResource", "FALCON_LLM_AZURE_RESOURCE");
    const azureHostSuffixPick = pickField(options, profile, get, "azureHostSuffix", "FALCON_LLM_AZURE_HOST_SUFFIX");
    const azureDeploymentPick = pickField(options, profile, get, "azureDeployment", "FALCON_LLM_AZURE_DEPLOYMENT");
    const timeoutPick = pickField(options, profile, get, "timeoutMs", "FALCON_LLM_TIMEOUT_MS");
    const maxAttemptsPick = pickField(options, profile, get, "maxAttempts", "FALCON_LLM_MAX_ATTEMPTS");

    if (endpointPick.value !== undefined && provider !== "openai-compatible") {
        return fail("CONFIG_CONFLICT", "endpoint is only valid for provider openai-compatible.");
    }
    if (allowCustomPick.value !== undefined && provider !== "openai-compatible") {
        return fail("CONFIG_CONFLICT", "allowCustomEndpoint is only valid for provider openai-compatible.");
    }
    const anyAzureField =
        azureResourcePick.value !== undefined || azureHostSuffixPick.value !== undefined || azureDeploymentPick.value !== undefined;
    if (anyAzureField && provider !== "azure-openai") {
        return fail("CONFIG_CONFLICT", "azure* fields are only valid for provider azure-openai.");
    }
    if (modelPick.value !== undefined && azureDeploymentPick.value !== undefined) {
        return fail("CONFIG_CONFLICT", "model and azureDeployment cannot both be set.");
    }

    const modelCharset = provider === "gemini" ? MODEL_RE_GEMINI : MODEL_RE_GENERIC;
    const modelResult = validateStringField("model", modelPick, {
        required: isAnthropicOrGemini,
        charsetRe: modelCharset,
    });
    if (!modelResult.ok) return modelResult;
    let model = modelResult.value;
    if (model === null && !isAnthropicOrGemini) model = "gpt-4o-mini";

    const allowCustomResult = validateBoolField("allowCustomEndpoint", allowCustomPick);
    if (!allowCustomResult.ok) return allowCustomResult;
    const allowHttpLoopbackResult = validateBoolField("allowHttpLoopback", allowHttpLoopbackPick);
    if (!allowHttpLoopbackResult.ok) return allowHttpLoopbackResult;
    const allowPrivateResult = validateBoolField("allowPrivateEndpoint", allowPrivatePick);
    if (!allowPrivateResult.ok) return allowPrivateResult;

    const allowCustomEndpoint = allowCustomResult.value;
    const allowHttpLoopback = allowHttpLoopbackResult.value;
    const allowPrivateEndpoint = allowPrivateResult.value;

    let endpoint = null;
    let endpointClass = null;
    let azureResource = null;
    let azureHostSuffix = null;
    let azureDeployment = null;

    if (provider === "openai-compatible") {
        if (!allowCustomEndpoint) {
            return fail(
                "CONFIG_ENDPOINT_OPT_IN_REQUIRED",
                "provider=openai-compatible requires allowCustomEndpoint=true.",
            );
        }
        const endpointResult = validateStringField("endpoint", endpointPick, { required: true });
        if (!endpointResult.ok) return endpointResult;
        endpoint = endpointResult.value;
        if (allowHttpLoopback && /^https:\/\//i.test(endpoint)) {
            return fail("CONFIG_CONFLICT", "allowHttpLoopback is set but endpoint is https.");
        }
        const shapeCheck = validateEndpointUrl(endpoint, {
            allowHttpLoopback,
            allowLoopback: true,
            allowPrivate: allowPrivateEndpoint,
        });
        if (!shapeCheck.ok) {
            return fail(shapeCheck.errorCode, "endpoint is not an absolute https URL ending in /v1.");
        }
        endpointClass = null;
    } else if (provider === "openai") {
        endpointClass = "openai_public";
    } else if (provider === "azure-openai") {
        const resourceResult = validateStringField("azureResource", azureResourcePick, {
            required: true,
            charsetRe: AZURE_RESOURCE_RE,
        });
        if (!resourceResult.ok) return resourceResult;
        azureResource = resourceResult.value;

        const suffixResult = validateStringField("azureHostSuffix", azureHostSuffixPick, { required: true });
        if (!suffixResult.ok) return suffixResult;
        if (!AZURE_HOST_SUFFIXES.has(suffixResult.value)) {
            return fail("CONFIG_INVALID", "azureHostSuffix is not a supported suffix.");
        }
        azureHostSuffix = suffixResult.value;

        const deploymentResult = validateStringField("azureDeployment", azureDeploymentPick, { required: true });
        if (!deploymentResult.ok) return deploymentResult;
        azureDeployment = deploymentResult.value;

        endpointClass = "azure";
    } else if (provider === "anthropic") {
        endpointClass = "anthropic_public";
    } else if (provider === "gemini") {
        endpointClass = "gemini_public";
    } else {
        endpointClass = null; // disabled
    }

    let timeoutMs;
    try {
        const bound = BOUND_BY_PROP.timeoutMs;
        const parsed = validateIntSetting("timeoutMs", timeoutPick.value, bound);
        timeoutMs = parsed === null ? bound.def : parsed;
    } catch (error) {
        return fail("CONFIG_INVALID", "timeoutMs has an invalid value.");
    }
    let maxAttempts;
    try {
        const bound = BOUND_BY_PROP.maxAttempts;
        const parsed = validateIntSetting("maxAttempts", maxAttemptsPick.value, bound);
        maxAttempts = parsed === null ? bound.def : parsed;
    } catch (error) {
        return fail("CONFIG_INVALID", "maxAttempts has an invalid value.");
    }

    let runBudget;
    let maxResponseBytes;
    let maxPromptCandidates;
    let concurrency;
    try {
        runBudget = resolveEnvOnlyInt("runBudget", get);
        maxResponseBytes = resolveEnvOnlyInt("maxResponseBytes", get);
        maxPromptCandidates = resolveEnvOnlyInt("maxPromptCandidates", get);
        concurrency = resolveEnvOnlyInt("concurrency", get);
    } catch (error) {
        return fail("CONFIG_INVALID", "A numeric FALCON_LLM_* setting has an invalid value.");
    }

    // --- Credential resolution (ADR-0019 C11; never crosses providers). ---
    let credentialEnvVarName = null;
    let credentialSource = "default";
    let readCredential = null;
    let eagerApiKey;
    let eagerApiKeySet = false;

    const optCredName = Object.hasOwn(options, "credentialEnvVar") ? options.credentialEnvVar : undefined;
    const profCredName = Object.hasOwn(profile, "credentialEnvVar") ? profile.credentialEnvVar : undefined;

    if (optCredName !== undefined || profCredName !== undefined) {
        credentialSource = optCredName !== undefined ? "options" : "profile";
        const name = optCredName !== undefined ? optCredName : profCredName;
        const refCheck = validateCredentialRef(name, env);
        if (!refCheck.ok) return refCheck;
        credentialEnvVarName = refCheck.name;
        readCredential = makeNamedCredentialReader(credentialEnvVarName, env);
    } else if (provider === "openai" || provider === "azure-openai" || provider === "openai-compatible") {
        // Phase 17 compat — byte-identical credential-source semantics to
        // LlmConfig.resolve(): FALCON_LLM_API_KEY always, OPENAI_API_KEY only
        // for provider=openai, both read via `get` (not `env`).
        const compatRaw = get("FALCON_LLM_API_KEY");
        const compatTrimmed = compatRaw !== null && compatRaw !== undefined ? String(compatRaw).trim() : "";
        if (compatTrimmed !== "") {
            eagerApiKey = compatTrimmed;
            eagerApiKeySet = true;
            credentialSource = "env";
        } else if (provider === "openai") {
            const openaiRaw = get("OPENAI_API_KEY");
            const openaiTrimmed = openaiRaw !== null && openaiRaw !== undefined ? String(openaiRaw).trim() : "";
            if (openaiTrimmed !== "") {
                eagerApiKey = openaiTrimmed;
                eagerApiKeySet = true;
                credentialSource = "env";
            }
        }
        if (!eagerApiKeySet) {
            return fail(
                "CONFIG_MISSING_CREDENTIALS",
                `provider=${provider} requires FALCON_LLM_API_KEY${provider === "openai" ? " (or OPENAI_API_KEY)" : ""} or an explicit credentialEnvVar.`,
            );
        }
    } else if (provider === "anthropic") {
        const refCheck = validateCredentialRef("ANTHROPIC_API_KEY", env);
        if (!refCheck.ok) return refCheck;
        credentialEnvVarName = refCheck.name;
        readCredential = makeNamedCredentialReader(credentialEnvVarName, env);
    } else if (provider === "gemini") {
        const refCheck = validateCredentialRef("GEMINI_API_KEY", env);
        if (!refCheck.ok) return refCheck;
        credentialEnvVarName = refCheck.name;
        readCredential = makeNamedCredentialReader(credentialEnvVarName, env);
    }
    // provider === "disabled": no credential needed.

    const config = {
        provider,
        model,
        azureResource,
        azureHostSuffix,
        azureDeployment,
        endpoint,
        allowCustomEndpoint,
        allowHttpLoopback,
        allowPrivateEndpoint,
        endpointClass,
        promptMaxBytes: PROMPT_MAX_BYTES,
        timeoutMs,
        maxAttempts,
        runBudget,
        maxResponseBytes,
        maxPromptCandidates,
        concurrency,
    };

    if (readCredential) {
        defineHiddenApiKeyGetter(config, readCredential);
    } else {
        defineHiddenApiKeyGetter(config, () => (eagerApiKeySet ? eagerApiKey : null));
    }

    const sources = {
        provider: providerSource,
        model: modelPick.source,
        azureResource: azureResourcePick.source,
        azureHostSuffix: azureHostSuffixPick.source,
        azureDeployment: azureDeploymentPick.source,
        endpoint: endpointPick.source,
        allowCustomEndpoint: allowCustomPick.source,
        allowHttpLoopback: allowHttpLoopbackPick.source,
        allowPrivateEndpoint: allowPrivatePick.source,
        timeoutMs: timeoutPick.source,
        maxAttempts: maxAttemptsPick.source,
        runBudget: "env",
        maxResponseBytes: "env",
        maxPromptCandidates: "env",
        concurrency: "env",
        apiKey: credentialSource,
    };

    const runtime = buildRuntime(config);
    return { ok: true, context: finalizeContext(config, sources, runtime, credentialEnvVarName) };
}

/**
 * Resolve an invocation-scoped ProviderContext.
 *
 * @param {Object} [params]
 * @param {Object} [params.options] - direct invocation fields.
 * @param {Object} [params.profile] - plain profile object (same field names).
 * @param {function(string): *} [params.get] - ConfigManager-like getter for
 *   the Phase 17 FALCON_LLM_* env-compat layer. Defaults to a no-op that
 *   treats every key as unset.
 * @param {Object} [params.env] - plain key/value map used ONLY by
 *   readCredential/credential-shape checks. Defaults to `process.env`,
 *   captured by reference at resolve time.
 * @returns {{ok:true, context:Object}|{ok:false, errorCode:string, detail:string}}
 */
function resolve(params = {}) {
    const options = params && typeof params.options === "object" && params.options !== null ? params.options : {};
    const profile = params && typeof params.profile === "object" && params.profile !== null ? params.profile : {};
    const get = typeof params.get === "function" ? params.get : () => null;
    const env = params && typeof params.env === "object" && params.env !== null ? params.env : process.env;
    try {
        return resolveInner(options, profile, get, env);
    } catch (error) {
        return fail("CONFIG_INVALID", "Unexpected provider-context error.");
    }
}

/**
 * Lazily resolve (once per process) and memoize a default context built
 * from the Phase 17 env-compat layer only (ADR-0019 C2). Both the success
 * and failure outcome are memoized so repeated calls are byte-identical and
 * side-effect-free.
 */
function getDefaultContext(get, env) {
    if (defaultContextResult) return defaultContextResult;
    defaultContextResult = resolve({ options: {}, profile: {}, get, env });
    return defaultContextResult;
}

/** Test-only seam: reset the memoized default context. */
function _resetForTests() {
    defaultContextResult = null;
}

module.exports = {
    resolve,
    getDefaultContext,
    _resetForTests,
    // Additive-only (ADR-0019 section 6): expose already-existing internal
    // validators/constants for reuse by ProfileStore.js. No behaviour of
    // resolve()/getDefaultContext() changes — these are the same objects
    // already used internally above.
    MODEL_RE_GENERIC,
    MODEL_RE_GEMINI,
    CRED_NAME_RE,
    isDeniedCredentialName,
};
