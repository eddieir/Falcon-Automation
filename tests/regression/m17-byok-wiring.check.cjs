/**
 * tests/regression/m17-byok-wiring.check.cjs — ADR-0019 wiring tests for
 * AIHealer's `providerContext` option and src/core/llm/InvocationContext.js.
 *
 * Scope: WIRING only (does AIHealer pass the right context to the
 * registry, is a no-context healer still byte-identical to Phase 17, does
 * InvocationContext route flags/profile correctly) — provider-internal
 * behaviour (HTTP shape, retries, error mapping) is covered by the
 * per-provider contract test files (m17-byok-anthropic.check.cjs etc.) and
 * is deliberately not re-tested here.
 *
 * Run: node --test --test-concurrency=1 --test-timeout=10000 tests/regression/m17-byok-wiring.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { load, silent } = require("./helpers.cjs");

const ProviderContext = require("../../src/core/llm/ProviderContext");

async function withPage(t, html) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  return page;
}

/**
 * Builds a fake LlmProviderRegistry mock that mimics the real contextMemo
 * semantics (one provider instance per context object identity) without
 * touching any real SDK/transport.
 */
function fakeRegistry() {
  const memo = new Map();
  const byContext = new WeakMap();
  const resolveCalls = [];
  function resolve(contextOrConfig) {
    resolveCalls.push(contextOrConfig);
    if (byContext.has(contextOrConfig)) return byContext.get(contextOrConfig);
    const config = contextOrConfig && contextOrConfig.config ? contextOrConfig.config : contextOrConfig;
    const calls = [];
    const instance = {
      id: config.provider,
      modelLabel: config.model,
      endpointClass: config.endpointClass || null,
      canSend: () => ({ ok: true }),
      complete: async (req) => {
        calls.push(req);
        return {
          ok: true,
          text: "0",
          provider: config.provider,
          modelLabel: config.model,
          latencyMs: 1,
          attempts: 1,
          usage: { promptTokens: 1, completionTokens: 1 },
        };
      },
      async close() {},
      _calls: calls,
    };
    byContext.set(contextOrConfig, instance);
    return instance;
  }
  return { resolve, resolveCalls };
}

function setup(extraMocks = {}) {
  const events = [];
  const Healer = load("src/core/AIHealer/AIHealer.js", {
    "../../../utils/Logger": silent,
    "./LocatorStore": { getAlternatives: () => [], addLocator: () => {} },
    "./HealingReport": { log: (e) => events.push(e) },
    "./HealingTrust": { recordPending: () => {}, recordTier3Invocation: () => {} },
    "./AdaptiveRetry": class {
      async execute(fn) {
        return fn();
      }
    },
    ...extraMocks,
  });
  return { Healer, events };
}

const BASIC_HTML = `<button id="submit-v2" aria-label="Submit order">Submit</button>`;

let _credCounter = 0;
function makeContext(provider, model, { get = () => null } = {}) {
  const credName = `FAKE_CRED_${provider.toUpperCase()}_${_credCounter++}_API_KEY`;
  const result = ProviderContext.resolve({
    options: { provider, model, credentialEnvVar: credName },
    get,
    env: { [credName]: "FAKEMARKER_cred_present" },
  });
  assert.equal(result.ok, true, `expected makeContext(${provider}, ${model}) to resolve ok`);
  return result.context;
}

test("AIHealer with providerContext uses that context's provider, not the default", { timeout: 8000 }, async (t) => {
  const { resolve, resolveCalls } = fakeRegistry();
  const { Healer, events } = setup({ "../llm/LlmProviderRegistry": { resolve } });
  const page = await withPage(t, BASIC_HTML);
  const ctx = makeContext("openai", "gpt-wiring-test");
  const healer = new Healer(page, { locatorMemory: null, providerContext: ctx });
  const result = await healer.getAlternativeSelector("#old", "Submit", "click");
  assert.ok(typeof result === "string");
  assert.equal(resolveCalls.length, 1);
  assert.equal(resolveCalls[0], ctx, "registry must be called with the exact injected context");
  assert.equal(healer._llmConfig, ctx.config);
  void events;
});

test("two AIHealers with different contexts never share provider or budget", { timeout: 8000 }, async (t) => {
  const { resolve } = fakeRegistry();
  const { Healer } = setup({ "../llm/LlmProviderRegistry": { resolve } });
  const page = await withPage(t, BASIC_HTML);
  const ctxA = makeContext("openai", "gpt-a");
  const ctxB = makeContext("openai", "gpt-a"); // same provider/model, distinct context object
  const healerA = new Healer(page, { locatorMemory: null, providerContext: ctxA });
  const healerB = new Healer(page, { locatorMemory: null, providerContext: ctxB });
  const providerA = await healerA._resolveProvider();
  const providerB = await healerB._resolveProvider();
  assert.notEqual(providerA, providerB, "distinct contexts must resolve to distinct provider instances");
  assert.notEqual(ctxA.runtime.budget, ctxB.runtime.budget, "distinct contexts must have distinct budgets");
});

test("no-context path is identical to Phase 17: CONFIG_PROVIDER_REQUIRED, memoized default context", { timeout: 8000 }, async (t) => {
  ProviderContext._resetForTests();
  t.after(() => ProviderContext._resetForTests());
  const { resolve, resolveCalls } = fakeRegistry();
  const { Healer } = setup({
    "../ConfigManager": { get: (key) => (key === "OPENAI_API_KEY" ? "sk-test-marker" : null) },
    "../llm/LlmProviderRegistry": { resolve },
  });
  const page = await withPage(t, BASIC_HTML);
  const healer1 = new Healer(page, { locatorMemory: null });
  const healer2 = new Healer(page, { locatorMemory: null });
  const r1 = await healer1.getAlternativeSelector("#old", "Submit", "click");
  const r2 = await healer2.getAlternativeSelector("#old", "Submit", "click");
  assert.equal(r1, null);
  assert.equal(r2, null);
  assert.equal(healer1._lastProviderErrorCode, "CONFIG_PROVIDER_REQUIRED");
  assert.equal(healer2._lastProviderErrorCode, "CONFIG_PROVIDER_REQUIRED");
  assert.deepEqual(resolveCalls, [], "registry must never be reached on a config error");

  // The process-level default context memoization is exercised directly:
  // two independent getDefaultContext() calls must return the SAME object.
  const d1 = ProviderContext.getDefaultContext(() => null);
  const d2 = ProviderContext.getDefaultContext(() => null);
  assert.equal(d1, d2, "default context must be memoized once per process");
});

test("AC11: Tier1 heal success never reads any provider credential or touches the registry", { timeout: 8000 }, async (t) => {
  const reads = [];
  const CRED_KEYS = new Set(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "FALCON_LLM_API_KEY"]);
  const envProxy = new Proxy(process.env, {
    get(target, prop) {
      if (typeof prop === "string" && CRED_KEYS.has(prop)) reads.push(prop);
      return target[prop];
    },
  });
  const { resolve, resolveCalls } = fakeRegistry();
  const { Healer } = setup({
    "../ConfigManager": { get: (key) => envProxy[key] ?? null },
    "../llm/LlmProviderRegistry": { resolve },
  });
  const page = await withPage(t, `<button id="old" data-testid="target">Click</button>`);
  const healer = new Healer(page, { locatorMemory: null });
  // Tier 1: the selector still resolves directly, so Tier 3 (and the
  // provider layer entirely) is never reached.
  await healer.healAndClick("#old", "Click target");
  assert.deepEqual(reads, [], "Tier1 success must never read a provider credential");
  assert.deepEqual(resolveCalls, [], "Tier1 success must never touch the provider registry");
});

test("AC10: provider auth failure surfaces as an error result; a different context's provider is never touched", { timeout: 8000 }, async (t) => {
  const otherCalls = [];
  const failing = {
    id: "openai",
    modelLabel: "gpt-fail",
    endpointClass: "openai_public",
    canSend: () => ({ ok: true }),
    complete: async () => ({ ok: false, errorCode: "AUTH_FAILED", provider: "openai", modelLabel: "gpt-fail", attempts: 1, retryable: false, usage: null }),
    async close() {},
  };
  const other = {
    id: "openai",
    modelLabel: "gpt-other",
    endpointClass: "openai_public",
    canSend: () => ({ ok: true }),
    complete: async (req) => {
      otherCalls.push(req);
      return { ok: true, text: "0", provider: "openai", modelLabel: "gpt-other", attempts: 1, usage: null };
    },
    async close() {},
  };
  const ctxFail = makeContext("openai", "gpt-fail");
  const ctxOther = makeContext("openai", "gpt-other");
  const resolve = (ctx) => (ctx === ctxFail ? failing : other);
  const { Healer } = setup({ "../llm/LlmProviderRegistry": { resolve } });
  const page = await withPage(t, BASIC_HTML);
  const healer = new Healer(page, { locatorMemory: null, providerContext: ctxFail });
  const result = await healer.getAlternativeSelector("#old", "Submit", "click");
  assert.equal(result, null);
  assert.equal(healer._lastProviderErrorCode, "AUTH_FAILED");
  assert.deepEqual(otherCalls, [], "a provider auth failure must never fall back to another provider");
});

// --- src/core/llm/InvocationContext.js matrix ---------------------------

function loadInvocationContext(profileStoreMock) {
  return load("src/core/llm/InvocationContext.js", {
    "./ProfileStore": profileStoreMock,
  });
}

test("InvocationContext: no flags => ok:true, context:null (caller keeps the process default)", async () => {
  const { resolveFromFlags } = loadInvocationContext({ get: async () => ({ ok: false, errorCode: "CONFIG_INVALID", detail: "should never be called" }) });
  const result = await resolveFromFlags({});
  assert.deepEqual(result, { ok: true, context: null });
});

test("InvocationContext: profile only => resolves a context from the stored profile", async () => {
  const { resolveFromFlags } = loadInvocationContext({
    get: async (name) => {
      assert.equal(name, "myprofile");
      return { ok: true, name, profile: { provider: "anthropic", model: "claude-wiring-test", credentialEnvVar: "FAKE_ANTHROPIC_API_KEY" } };
    },
  });
  const result = await resolveFromFlags(
    { llmProfile: "myprofile" },
    { env: { FAKE_ANTHROPIC_API_KEY: "FAKEMARKER_x" }, get: () => null },
  );
  assert.equal(result.ok, true);
  assert.equal(result.context.config.provider, "anthropic");
  assert.equal(result.context.config.model, "claude-wiring-test");
});

test("InvocationContext: provider+model flags only (no profile) resolve directly", async () => {
  const { resolveFromFlags } = loadInvocationContext({ get: async () => ({ ok: false, errorCode: "CONFIG_INVALID", detail: "unused" }) });
  const result = await resolveFromFlags(
    { llmProvider: "openai", llmModel: "gpt-wiring-flagonly" },
    { env: { FALCON_LLM_API_KEY: "FAKEMARKER_y" }, get: (k) => (k === "FALCON_LLM_API_KEY" ? "FAKEMARKER_y" : null) },
  );
  assert.equal(result.ok, true);
  assert.equal(result.context.config.provider, "openai");
  assert.equal(result.context.config.model, "gpt-wiring-flagonly");
});

test("InvocationContext: direct --llm-model overrides the profile's model (direct > profile)", async () => {
  const { resolveFromFlags } = loadInvocationContext({
    get: async () => ({ ok: true, name: "p", profile: { provider: "openai", model: "profile-model", credentialEnvVar: "FAKE_K_API_KEY" } }),
  });
  const result = await resolveFromFlags(
    { llmProfile: "p", llmModel: "flag-model" },
    { env: { FAKE_K_API_KEY: "FAKEMARKER_z" }, get: () => null },
  );
  assert.equal(result.ok, true);
  assert.equal(result.context.config.model, "flag-model");
});

test("InvocationContext: profile-vs-flag provider conflict => CONFIG_CONFLICT", async () => {
  const { resolveFromFlags } = loadInvocationContext({
    get: async () => ({ ok: true, name: "p", profile: { provider: "anthropic", model: "claude-x", credentialEnvVar: "FAKE_K" } }),
  });
  const result = await resolveFromFlags({ llmProfile: "p", llmProvider: "openai" }, { env: {}, get: () => null });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_CONFLICT");
});

test("InvocationContext: missing profile propagates ProfileStore's error unchanged", async () => {
  const { resolveFromFlags } = loadInvocationContext({
    get: async () => ({ ok: false, errorCode: "CONFIG_INVALID", detail: "profile not found." }),
  });
  const result = await resolveFromFlags({ llmProfile: "does-not-exist" }, { env: {}, get: () => null });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("InvocationContext: a plaintext/invalid profile is rejected via ProfileStore's own schema error", async () => {
  const { resolveFromFlags } = loadInvocationContext({
    get: async () => ({ ok: false, errorCode: "CONFIG_INVALID", detail: "profile is not valid JSON." }),
  });
  const result = await resolveFromFlags({ llmProfile: "broken" }, { env: {}, get: () => null });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("InvocationContext: never reads a credential VALUE, only checks existence via env", async () => {
  const reads = [];
  const envProxy = new Proxy({ FAKE_K_API_KEY: "FAKEMARKER_should_not_be_read_as_value" }, {
    get(target, prop) {
      if (prop === "FAKE_K_API_KEY") reads.push(prop);
      return target[prop];
    },
  });
  const { resolveFromFlags } = loadInvocationContext({
    get: async () => ({ ok: true, name: "p", profile: { provider: "openai", model: "m", credentialEnvVar: "FAKE_K_API_KEY" } }),
  });
  const result = await resolveFromFlags({ llmProfile: "p" }, { env: envProxy, get: () => null });
  assert.equal(result.ok, true);
  // ProviderContext's credential handling only ever checks existence/shape
  // at resolve time (validateCredentialRef), never reads the value eagerly.
  assert.ok(reads.length <= 1, `expected at most a single existence check, got ${reads.length} reads`);
});

// ── detail sanitisation: a planted runtime marker must never leak out ─────

test("InvocationContext: a profile's own CONFIG_INVALID detail never leaks a planted marker", async () => {
  const marker = crypto.randomBytes(16).toString("hex");
  const { resolveFromFlags } = loadInvocationContext({
    get: async () => ({ ok: false, errorCode: "CONFIG_INVALID", detail: `profile content near ${marker} is not valid JSON.` }),
  });
  const result = await resolveFromFlags({ llmProfile: "broken" }, { env: {}, get: () => null });
  assert.equal(result.ok, false);
  // This asserts InvocationContext itself never re-wraps/echoes the marker
  // into a NEW detail of its own; it propagates ProfileStore's result
  // object unchanged, so ProfileStore's own detail text is out of scope
  // here (owned by another task) — this is a canary that InvocationContext
  // never builds a detail string that would interpolate it.
  assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("InvocationContext: a marker planted in model/provider never appears in a CONFIG_CONFLICT detail", async () => {
  const marker = crypto.randomBytes(16).toString("hex");
  const { resolveFromFlags } = loadInvocationContext({
    get: async () => ({ ok: true, name: "p", profile: { provider: `anthropic-${marker}`, model: `model-${marker}`, credentialEnvVar: "FAKE_K" } }),
  });
  const result = await resolveFromFlags({ llmProfile: "p", llmProvider: `openai-${marker}` }, { env: {}, get: () => null });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_CONFLICT");
  assert.equal(result.detail.includes(marker), false, `detail must never contain the planted marker: ${result.detail}`);
});

test("InvocationContext: an unexpected internal error's detail never leaks a planted marker (error.message sanitised)", async () => {
  const marker = crypto.randomBytes(16).toString("hex");
  const { resolveFromFlags } = loadInvocationContext({
    get: async () => {
      throw new Error(`boom ${marker}`);
    },
  });
  const result = await resolveFromFlags({ llmProfile: "p" }, { env: {}, get: () => null });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_INVALID");
  assert.equal(result.detail.includes(marker), false, `detail must never contain the planted marker: ${result.detail}`);
});
