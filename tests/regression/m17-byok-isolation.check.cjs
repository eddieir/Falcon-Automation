/**
 * tests/regression/m17-byok-isolation.check.cjs — ADR-0019 cross-invocation
 * isolation: registry WeakMap-by-context (N01/N02), per-context budget vs
 * process-wide ceiling (C15), and credential isolation across two
 * concurrently-live contexts.
 *
 * Run: node --test --test-concurrency=1 tests/regression/m17-byok-isolation.check.cjs
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");

const ProviderContext = require(path.join("..", "..", "src", "core", "llm", "ProviderContext.js"));
const Registry = require(path.join("..", "..", "src", "core", "llm", "LlmProviderRegistry.js"));
const LlmBudget = require(path.join("..", "..", "src", "core", "llm", "LlmBudget.js"));

function noGet() {
    return null;
}

function resolveOpenAiContext(credentialEnvVar, env) {
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar },
        get: noGet,
        env,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.context;
}

test("N01: two ProviderContexts with the same provider id get distinct provider instances", () => {
    const ctxA = resolveOpenAiContext("FAKEMARKER_N01_A_API_KEY", { FAKEMARKER_N01_A_API_KEY: "a" });
    const ctxB = resolveOpenAiContext("FAKEMARKER_N01_B_API_KEY", { FAKEMARKER_N01_B_API_KEY: "b" });
    const providerA = Registry.resolve(ctxA);
    const providerB = Registry.resolve(ctxB);
    assert.notEqual(providerA, providerB, "distinct contexts must not share a memoized provider instance");
    assert.equal(providerA.id, "openai");
    assert.equal(providerB.id, "openai");
});

test("N01: resolving the same context object twice returns the same memoized instance", () => {
    const ctx = resolveOpenAiContext("FAKEMARKER_N01_C_API_KEY", { FAKEMARKER_N01_C_API_KEY: "c" });
    const first = Registry.resolve(ctx);
    const second = Registry.resolve(ctx);
    assert.equal(first, second);
});

test("N02: legacy Map-by-provider-id memoization is unchanged (existing p17 behaviour)", () => {
    Registry._resetMemoForTests();
    const first = Registry.resolve({ provider: "disabled" });
    const second = Registry.resolve({ provider: "disabled" });
    assert.equal(first, second, "legacy plain-config callers keep the pre-existing per-id memo behaviour");
    Registry._resetMemoForTests();
});

test("N02: a context and a legacy plain config for the same provider id are independent", () => {
    Registry._resetMemoForTests();
    const legacy = Registry.resolve({ provider: "disabled" });
    const ctx = ProviderContext.resolve({ options: { provider: "none" }, get: noGet, env: {} });
    assert.equal(ctx.ok, true);
    const fromContext = Registry.resolve(ctx.context);
    assert.notEqual(legacy, fromContext);
    Registry._resetMemoForTests();
});

test("Credential isolation: two contexts (openai + azure-openai) each read only their own marker", () => {
    const markerOpenAi = "FAKEMARKER_ISO_" + crypto.randomBytes(8).toString("hex");
    const markerAzure = "FAKEMARKER_ISO_" + crypto.randomBytes(8).toString("hex");

    const openaiResult = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "FAKEMARKER_ISO_OPENAI_API_KEY" },
        get: noGet,
        env: { FAKEMARKER_ISO_OPENAI_API_KEY: markerOpenAi, FAKEMARKER_ISO_AZURE_API_KEY: markerAzure },
    });
    const azureResult = ProviderContext.resolve({
        options: {
            provider: "azure-openai",
            azureResource: "my-resource",
            azureHostSuffix: "openai.azure.com",
            azureDeployment: "my-deploy",
            credentialEnvVar: "FAKEMARKER_ISO_AZURE_API_KEY",
        },
        get: noGet,
        env: { FAKEMARKER_ISO_OPENAI_API_KEY: markerOpenAi, FAKEMARKER_ISO_AZURE_API_KEY: markerAzure },
    });

    assert.equal(openaiResult.ok, true);
    assert.equal(azureResult.ok, true);

    assert.equal(openaiResult.context.config.apiKey, markerOpenAi);
    assert.equal(azureResult.context.config.apiKey, markerAzure);
    assert.notEqual(openaiResult.context.config.apiKey, azureResult.context.config.apiKey);

    const openaiProvider = Registry.resolve(openaiResult.context);
    const azureProvider = Registry.resolve(azureResult.context);
    assert.notEqual(openaiProvider, azureProvider);
    assert.notEqual(openaiResult.context.runtime.budget, azureResult.context.runtime.budget);
    assert.notEqual(openaiResult.context.runtime.semaphore, azureResult.context.runtime.semaphore);
});

test("C15: per-context budget exhaustion blocks attempts without touching the process ceiling", () => {
    LlmBudget.processCeiling._resetForTests();
    const before = LlmBudget.processCeiling.remainingAttempts();

    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "FAKEMARKER_C15_LOCAL_API_KEY" },
        get: (key) => (key === "FALCON_LLM_RUN_BUDGET" ? "1" : null),
        env: { FAKEMARKER_C15_LOCAL_API_KEY: "tok" },
    });
    assert.equal(result.ok, true);

    assert.equal(result.context.runtime.budget.consumeAttempt(), true);
    assert.equal(LlmBudget.processCeiling.remainingAttempts(), before - 1);

    assert.equal(result.context.runtime.budget.consumeAttempt(), false, "local budget of 1 is exhausted");
    assert.equal(
        LlmBudget.processCeiling.remainingAttempts(),
        before - 1,
        "an attempt blocked locally must not also consume the process-wide ceiling",
    );
    LlmBudget.processCeiling._resetForTests();
});

test("C15: the process-wide ceiling blocks attempts even when every per-context budget still has room", () => {
    LlmBudget.processCeiling._resetForTests();
    // Drain the process-wide ceiling down to 0 directly.
    while (LlmBudget.processCeiling.tryConsumeAttempt()) {
        /* drain */
    }
    assert.equal(LlmBudget.processCeiling.remainingAttempts(), 0);

    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "FAKEMARKER_C15_CEILING_API_KEY" },
        get: noGet,
        env: { FAKEMARKER_C15_CEILING_API_KEY: "tok" },
    });
    assert.equal(result.ok, true);
    assert.equal(
        result.context.runtime.budget.consumeAttempt(),
        false,
        "a fresh per-context budget still cannot bypass an exhausted process-wide ceiling",
    );
    LlmBudget.processCeiling._resetForTests();
});

test("C15: concurrent in-flight ceiling is enforced across contexts via semaphore.run()", async () => {
    LlmBudget.processCeiling._resetForTests();
    const ceiling = LlmBudget.CONCURRENT_IN_FLIGHT_CEILING;
    const contexts = [];
    for (let i = 0; i < ceiling + 1; i += 1) {
        const envName = `FAKEMARKER_C15_FLIGHT_${i}_API_KEY`;
        const r = ProviderContext.resolve({
            options: { provider: "openai", credentialEnvVar: envName },
            get: noGet,
            env: { [envName]: "tok" },
        });
        assert.equal(r.ok, true);
        contexts.push(r.context);
    }

    let maxObservedConcurrency = 0;
    let active = 0;
    let rejected = 0;

    await Promise.all(
        contexts.map((ctx) =>
            ctx.runtime.semaphore
                .run(async () => {
                    active += 1;
                    maxObservedConcurrency = Math.max(maxObservedConcurrency, active);
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    active -= 1;
                })
                .catch((error) => {
                    rejected += 1;
                    assert.equal(error.code, "SEMAPHORE_WAIT_TIMEOUT");
                }),
        ),
    );

    assert.ok(maxObservedConcurrency <= ceiling, `observed ${maxObservedConcurrency} > ceiling ${ceiling}`);
    LlmBudget.processCeiling._resetForTests();
});
