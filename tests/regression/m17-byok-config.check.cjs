/**
 * tests/regression/m17-byok-config.check.cjs — ADR-0019 ProviderContext
 * direct-config resolution: precedence, conflicts, provider-shape rules.
 *
 * Run: node --test --test-concurrency=1 tests/regression/m17-byok-config.check.cjs
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");

const ProviderContext = require(path.join("..", "..", "src", "core", "llm", "ProviderContext.js"));

function noGet() {
    return null;
}
function makeGet(map) {
    return (key) => (Object.hasOwn(map, key) ? map[key] : null);
}
function fakeEnv(map) {
    return { ...map };
}

test("AC01: direct options provider=openai with credentialEnvVar resolves ok", () => {
    const env = fakeEnv({ FAKEMARKER_TOKEN_1_API_KEY: "tok-abc123" });
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "FAKEMARKER_TOKEN_1_API_KEY" },
        get: noGet,
        env,
    });
    assert.equal(result.ok, true);
    assert.equal(result.context.config.provider, "openai");
    assert.equal(result.context.config.model, "gpt-4o-mini");
    assert.equal(result.context.config.apiKey, "tok-abc123");
});

test("AC02: precedence options > profile for the same field", () => {
    const env = fakeEnv({ FAKEMARKER_TOKEN_2_API_KEY: "tok-def456" });
    const result = ProviderContext.resolve({
        options: { provider: "openai", model: "from-options", credentialEnvVar: "FAKEMARKER_TOKEN_2_API_KEY" },
        profile: { provider: "openai", model: "from-profile" },
        get: noGet,
        env,
    });
    assert.equal(result.ok, true);
    assert.equal(result.context.config.model, "from-options");
    assert.equal(result.context.sources.model, "options");
});

test("AC02: profile fills a field options omits", () => {
    const env = fakeEnv({ FAKEMARKER_TOKEN_3_API_KEY: "tok-ghi789" });
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "FAKEMARKER_TOKEN_3_API_KEY" },
        profile: { model: "from-profile-only" },
        get: noGet,
        env,
    });
    assert.equal(result.ok, true);
    assert.equal(result.context.config.model, "from-profile-only");
    assert.equal(result.context.sources.model, "profile");
});

test("AC05: endpoint field rejected (CONFIG_CONFLICT) for provider=openai", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai", endpoint: "https://example.com/v1", credentialEnvVar: "FAKEMARKER_X_API_KEY" },
        get: noGet,
        env: fakeEnv({ FAKEMARKER_X_API_KEY: "tok" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_CONFLICT");
});

test("C6: profile endpoint field rejected for provider!=openai-compatible", () => {
    const result = ProviderContext.resolve({
        options: { provider: "azure-openai", credentialEnvVar: "FAKEMARKER_X_API_KEY" },
        profile: { endpoint: "https://example.com/v1" },
        get: noGet,
        env: fakeEnv({ FAKEMARKER_X_API_KEY: "tok" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_CONFLICT");
});

test("AC07: unsupported provider value is rejected", () => {
    const result = ProviderContext.resolve({ options: { provider: "chatgpt-deluxe" }, get: noGet, env: {} });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_UNSUPPORTED_PROVIDER");
});

test("AC08: provider 'none' normalizes to disabled (options and profile)", () => {
    const r1 = ProviderContext.resolve({ options: { provider: "none" }, get: noGet, env: {} });
    assert.equal(r1.ok, true);
    assert.equal(r1.context.config.provider, "disabled");

    const r2 = ProviderContext.resolve({ profile: { provider: "none" }, get: noGet, env: {} });
    assert.equal(r2.ok, true);
    assert.equal(r2.context.config.provider, "disabled");
});

test("AC09: provider=anthropic requires an explicit model (no default)", () => {
    const result = ProviderContext.resolve({
        options: { provider: "anthropic", credentialEnvVar: "ANTHROPIC_API_KEY" },
        get: noGet,
        env: fakeEnv({ ANTHROPIC_API_KEY: "tok-anthropic" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("AC09: provider=gemini requires an explicit model (no default)", () => {
    const result = ProviderContext.resolve({
        options: { provider: "gemini", credentialEnvVar: "GEMINI_API_KEY" },
        get: noGet,
        env: fakeEnv({ GEMINI_API_KEY: "tok-gemini" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("AC10: a resolve failure never falls back to another provider — it just fails", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai-compatible" }, // no allowCustomEndpoint, no endpoint
        get: noGet,
        env: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_ENDPOINT_OPT_IN_REQUIRED");
    assert.equal(result.context, undefined);
});

test("AC14: options/profile provider vs conflicting FALCON_LLM_PROVIDER env-compat => CONFIG_CONFLICT", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "FAKEMARKER_X_API_KEY" },
        get: makeGet({ FALCON_LLM_PROVIDER: "azure-openai" }),
        env: fakeEnv({ FAKEMARKER_X_API_KEY: "tok" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_CONFLICT");
});

test("AC14: options provider matching FALCON_LLM_PROVIDER ('none' vs 'disabled') is not a conflict", () => {
    const result = ProviderContext.resolve({
        options: { provider: "none" },
        get: makeGet({ FALCON_LLM_PROVIDER: "disabled" }),
        env: {},
    });
    assert.equal(result.ok, true);
    assert.equal(result.context.config.provider, "disabled");
});

test("AC23: env-only path is unchanged — OPENAI_API_KEY alone => CONFIG_PROVIDER_REQUIRED", () => {
    const result = ProviderContext.resolve({
        get: makeGet({ OPENAI_API_KEY: "sk-test-unused" }),
        env: { OPENAI_API_KEY: "sk-test-unused" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_PROVIDER_REQUIRED");
});

test("AC23: env-only path with no settings at all resolves to disabled, byte-identical to LlmConfig", () => {
    const result = ProviderContext.resolve({ get: noGet, env: {} });
    assert.equal(result.ok, true);
    assert.equal(result.context.config.provider, "disabled");
});

test("N04: azureDeployment is rejected for provider=openai (azure* fields pinned to azure-openai)", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai", azureDeployment: "my-deploy", credentialEnvVar: "FAKEMARKER_X_API_KEY" },
        get: noGet,
        env: fakeEnv({ FAKEMARKER_X_API_KEY: "tok" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_CONFLICT");
});

test("N04: model and azureDeployment cannot both be set", () => {
    const result = ProviderContext.resolve({
        options: {
            provider: "azure-openai",
            model: "gpt-4",
            azureDeployment: "my-deploy",
            azureResource: "my-resource",
            azureHostSuffix: "openai.azure.com",
            credentialEnvVar: "FAKEMARKER_X_API_KEY",
        },
        get: noGet,
        env: fakeEnv({ FAKEMARKER_X_API_KEY: "tok" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_CONFLICT");
});

test("N05: timeoutMs out of bounds is rejected (CONFIG_INVALID), not silently clamped", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai", timeoutMs: 999999, credentialEnvVar: "FAKEMARKER_X_API_KEY" },
        get: noGet,
        env: fakeEnv({ FAKEMARKER_X_API_KEY: "tok" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("N05: a valid timeoutMs/maxAttempts override is honored", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai", timeoutMs: 5000, maxAttempts: 3, credentialEnvVar: "FAKEMARKER_X_API_KEY" },
        get: noGet,
        env: fakeEnv({ FAKEMARKER_X_API_KEY: "tok" }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.context.config.timeoutMs, 5000);
    assert.equal(result.context.config.maxAttempts, 3);
    assert.equal(result.context.sources.timeoutMs, "options");
});

test("N09: provider value containing control characters is rejected", () => {
    const result = ProviderContext.resolve({ options: { provider: "openai\n" }, get: noGet, env: {} });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("N12: blank/whitespace-only model is rejected, not treated as unset", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai", model: "   ", credentialEnvVar: "FAKEMARKER_X_API_KEY" },
        get: noGet,
        env: fakeEnv({ FAKEMARKER_X_API_KEY: "tok" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("C1: gemini model id traversal/escape shapes are rejected by the stricter charset", () => {
    const bad = ["../x", "a/b", "models/x", "a:b", "%2e%2e"];
    for (const model of bad) {
        const result = ProviderContext.resolve({
            options: { provider: "gemini", model, credentialEnvVar: "GEMINI_API_KEY" },
            get: noGet,
            env: fakeEnv({ GEMINI_API_KEY: "tok-gemini" }),
        });
        assert.equal(result.ok, false, `expected rejection for model=${model}`);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    }
});

test("C1: a well-formed gemini model id is accepted", () => {
    const result = ProviderContext.resolve({
        options: { provider: "gemini", model: "gemini-1.5-flash", credentialEnvVar: "GEMINI_API_KEY" },
        get: noGet,
        env: fakeEnv({ GEMINI_API_KEY: "tok-gemini" }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.context.config.model, "gemini-1.5-flash");
    assert.equal(result.context.config.endpointClass, "gemini_public");
});

test("getDefaultContext memoizes once per process (C2)", () => {
    ProviderContext._resetForTests();
    const first = ProviderContext.getDefaultContext(noGet, {});
    const second = ProviderContext.getDefaultContext(noGet, {});
    assert.equal(first, second);
    ProviderContext._resetForTests();
});

// ── detail sanitisation: a planted runtime marker must never leak out ─────

test("a marker planted in credentialEnvVar's NAME never appears in any detail", () => {
    const marker = crypto.randomBytes(16).toString("hex");
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: `not-a-valid-name-${marker}` },
        get: noGet,
        env: fakeEnv({}),
    });
    assert.equal(result.ok, false);
    assert.equal(result.detail.includes(marker), false, `detail must never contain the planted marker: ${result.detail}`);
});

test("a marker planted in model never appears in any detail (invalid charset path)", () => {
    const marker = crypto.randomBytes(16).toString("hex");
    const result = ProviderContext.resolve({
        options: { provider: "gemini", model: `../${marker}`, credentialEnvVar: "GEMINI_API_KEY" },
        get: noGet,
        env: fakeEnv({ GEMINI_API_KEY: "tok-gemini" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
    assert.equal(result.detail.includes(marker), false, `detail must never contain the planted marker: ${result.detail}`);
});

test("a marker planted in endpoint never appears in any detail (invalid shape path)", () => {
    const marker = crypto.randomBytes(16).toString("hex");
    const result = ProviderContext.resolve({
        options: { provider: "openai-compatible", allowCustomEndpoint: true, endpoint: `http://${marker}.internal` },
        get: noGet,
        env: fakeEnv({}),
    });
    assert.equal(result.ok, false);
    assert.equal(result.detail.includes(marker), false, `detail must never contain the planted marker: ${result.detail}`);
});

test("a marker planted in a FALCON_LLM_TIMEOUT_MS value never appears in any detail", () => {
    const marker = crypto.randomBytes(16).toString("hex");
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "FAKEMARKER_TIMEOUT_API_KEY", timeoutMs: `not-a-number-${marker}` },
        get: noGet,
        env: fakeEnv({ FAKEMARKER_TIMEOUT_API_KEY: "tok-abc123" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
    assert.equal(result.detail.includes(marker), false, `detail must never contain the planted marker: ${result.detail}`);
});
