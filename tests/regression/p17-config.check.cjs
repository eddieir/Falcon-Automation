const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, silent } = require("./helpers.cjs");

function makeGet(map) {
  return (key) => (Object.hasOwn(map, key) ? map[key] : null);
}

function freshConfigModule() {
  // Fresh module instance per test so the "warn once per process" latches
  // in LlmConfig don't leak between unrelated assertions.
  return load("src/core/llm/LlmConfig.js", { "../../../utils/Logger": silent });
}

test("AC01: unset provider resolves to disabled, zero provider contact", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(makeGet({}), {});
  assert.equal(result.ok, true);
  assert.equal(result.config.provider, "disabled");
});

test("AC01: same config resolves to the same selection", () => {
  const { resolve } = freshConfigModule();
  const get = makeGet({ FALCON_LLM_PROVIDER: "openai", FALCON_LLM_API_KEY: "sk-test" });
  const first = resolve(get, {});
  const second = resolve(get, {});
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.config.provider, second.config.provider);
});

test("AC19: blank provider is treated as unset", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(makeGet({ FALCON_LLM_PROVIDER: "" }), {});
  assert.equal(result.ok, true);
  assert.equal(result.config.provider, "disabled");
});

test("AC19: whitespace-only provider is treated as unset", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(makeGet({ FALCON_LLM_PROVIDER: "   " }), {});
  assert.equal(result.ok, true);
  assert.equal(result.config.provider, "disabled");
});

for (const bad of [" openai", "OpenAI", "azure", "OPENAI-COMPATIBLE", "azure openai"]) {
  test(`AC19: unsupported provider value "${bad}" -> CONFIG_UNSUPPORTED_PROVIDER, zero requests`, () => {
    const { resolve } = freshConfigModule();
    const result = resolve(makeGet({ FALCON_LLM_PROVIDER: bad }), {});
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_UNSUPPORTED_PROVIDER");
  });
}

test("Dev-01b fix: unsupported-provider error detail never echoes the configured value", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(makeGet({ FALCON_LLM_PROVIDER: "sk-MARKER-SECRET-LOOKING-VALUE" }), {});
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_UNSUPPORTED_PROVIDER");
  assert.ok(!result.detail.includes("MARKER-SECRET"));
});

for (const key of ["FALCON_LLM_ALLOW_CUSTOM_ENDPOINT", "FALCON_LLM_ALLOW_HTTP_LOOPBACK", "FALCON_LLM_ALLOW_PRIVATE_ENDPOINT"]) {
  test(`Dev-01b fix: ${key}="yes" (not blank/true/false) -> CONFIG_INVALID`, () => {
    const { resolve } = freshConfigModule();
    const result = resolve(
      makeGet({ FALCON_LLM_PROVIDER: "openai", FALCON_LLM_API_KEY: "sk-x", [key]: "yes" }),
      {},
    );
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
  });
}

test("Dev-01b fix: http loopback endpoint accepted only with ALLOW_HTTP_LOOPBACK=true", () => {
  const { resolve } = freshConfigModule();
  const withoutOptIn = resolve(
    makeGet({
      FALCON_LLM_PROVIDER: "openai-compatible",
      FALCON_LLM_ALLOW_CUSTOM_ENDPOINT: "true",
      FALCON_LLM_ENDPOINT: "http://127.0.0.1:11434/v1",
    }),
    {},
  );
  assert.equal(withoutOptIn.ok, false);
  assert.equal(withoutOptIn.errorCode, "CONFIG_ENDPOINT_OPT_IN_REQUIRED");

  const withOptIn = resolve(
    makeGet({
      FALCON_LLM_PROVIDER: "openai-compatible",
      FALCON_LLM_ALLOW_CUSTOM_ENDPOINT: "true",
      FALCON_LLM_ALLOW_HTTP_LOOPBACK: "true",
      FALCON_LLM_ENDPOINT: "http://127.0.0.1:11434/v1",
    }),
    {},
  );
  assert.equal(withOptIn.ok, true);
  assert.equal(withOptIn.config.endpoint, "http://127.0.0.1:11434/v1");
});

test("Dev-01b fix: http loopback [::1] endpoint accepted with ALLOW_HTTP_LOOPBACK=true", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(
    makeGet({
      FALCON_LLM_PROVIDER: "openai-compatible",
      FALCON_LLM_ALLOW_CUSTOM_ENDPOINT: "true",
      FALCON_LLM_ALLOW_HTTP_LOOPBACK: "true",
      FALCON_LLM_ENDPOINT: "http://[::1]:11434/v1",
    }),
    {},
  );
  assert.equal(result.ok, true);
});

test("Dev-01b fix: http endpoint to a public host is rejected even with ALLOW_HTTP_LOOPBACK=true", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(
    makeGet({
      FALCON_LLM_PROVIDER: "openai-compatible",
      FALCON_LLM_ALLOW_CUSTOM_ENDPOINT: "true",
      FALCON_LLM_ALLOW_HTTP_LOOPBACK: "true",
      FALCON_LLM_ENDPOINT: "http://example.com/v1",
    }),
    {},
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_INVALID");
});

test('OD-6: "none" is an accepted alias of "disabled"', () => {
  const { resolve } = freshConfigModule();
  const result = resolve(makeGet({ FALCON_LLM_PROVIDER: "none" }), {});
  assert.equal(result.ok, true);
  assert.equal(result.config.provider, "disabled");
});

test("AC19: conflicting settings (AZURE_* with non-azure provider) -> CONFIG_CONFLICT", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(
    makeGet({ FALCON_LLM_PROVIDER: "openai", FALCON_LLM_API_KEY: "sk-test", FALCON_LLM_AZURE_RESOURCE: "res1" }),
    {},
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_CONFLICT");
});

test("AC19: FALCON_LLM_* set while disabled -> CONFIG_CONFLICT", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(makeGet({ FALCON_LLM_MODEL: "gpt-4o-mini" }), {});
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_CONFLICT");
});

test("AC19: MODEL conflicts with AZURE_DEPLOYMENT", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(
    makeGet({
      FALCON_LLM_PROVIDER: "azure-openai",
      FALCON_LLM_API_KEY: "key",
      FALCON_LLM_MODEL: "gpt-4o-mini",
      FALCON_LLM_AZURE_RESOURCE: "myres",
      FALCON_LLM_AZURE_HOST_SUFFIX: "openai.azure.com",
      FALCON_LLM_AZURE_DEPLOYMENT: "dep1",
    }),
    {},
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_CONFLICT");
});

test("AC19: unknown FALCON_LLM_* key logs one warning naming the key", () => {
  const warnings = [];
  const { resolve } = load("src/core/llm/LlmConfig.js", {
    "../../../utils/Logger": { ...silent, warning: (msg) => warnings.push(msg) },
  });
  resolve(makeGet({}), { FALCON_LLM_TYPO_KEY: "x" });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /FALCON_LLM_TYPO_KEY/);
});

test("S-14: unknown key warning strips control chars and caps length at 64", () => {
  const warnings = [];
  const longKey = `FALCON_LLM_${"A".repeat(100)}\x1b[31m`;
  const { resolve } = load("src/core/llm/LlmConfig.js", {
    "../../../utils/Logger": { ...silent, warning: (msg) => warnings.push(msg) },
  });
  resolve(makeGet({}), { [longKey]: "x" });
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes("\x1b"));
  const nameInMessage = warnings[0].split(": ")[1];
  assert.ok(nameInMessage.length <= 64);
});

test("AC31a/S-11: OPENAI_API_KEY alone (no provider) -> CONFIG_PROVIDER_REQUIRED, zero requests, no key in message", () => {
  const warnings = [];
  const { resolve } = load("src/core/llm/LlmConfig.js", {
    "../../../utils/Logger": { ...silent, warning: (msg) => warnings.push(msg) },
  });
  const result = resolve(makeGet({ OPENAI_API_KEY: "sk-SECRETMARKER" }), {});
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_PROVIDER_REQUIRED");
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes("sk-SECRETMARKER"));
  assert.match(warnings[0], /FALCON_LLM_PROVIDER/);
});

test("CONFIG_PROVIDER_REQUIRED warning fires only once per process", () => {
  const warnings = [];
  const { resolve } = load("src/core/llm/LlmConfig.js", {
    "../../../utils/Logger": { ...silent, warning: (msg) => warnings.push(msg) },
  });
  const get = makeGet({ OPENAI_API_KEY: "sk-x" });
  resolve(get, {});
  resolve(get, {});
  resolve(get, {});
  assert.equal(warnings.length, 1);
});

test("S-11: OPENAI_API_KEY marker with provider=openai-compatible never reaches resolved config", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(
    makeGet({
      FALCON_LLM_PROVIDER: "openai-compatible",
      FALCON_LLM_ALLOW_CUSTOM_ENDPOINT: "true",
      FALCON_LLM_ENDPOINT: "https://localhost:11434/v1",
      OPENAI_API_KEY: "sk-MARKER-SHOULD-NEVER-APPEAR",
    }),
    {},
  );
  assert.equal(result.ok, true);
  assert.equal(result.config.apiKey, null);
  assert.ok(!JSON.stringify(result.config).includes("MARKER"));
  assert.ok(!require("node:util").inspect(result.config).includes("MARKER"));
});

test("S-11: resolved config does not leak apiKey via JSON.stringify or util.inspect", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(makeGet({ FALCON_LLM_PROVIDER: "openai", FALCON_LLM_API_KEY: "sk-HIDDEN-MARKER" }), {});
  assert.equal(result.ok, true);
  assert.equal(result.config.apiKey, "sk-HIDDEN-MARKER");
  assert.ok(!JSON.stringify(result.config).includes("HIDDEN-MARKER"));
  assert.ok(!require("node:util").inspect(result.config).includes("HIDDEN-MARKER"));
  assert.ok(!Object.keys(result.config).includes("apiKey"));
});

test("openai-compatible without opt-in flag -> CONFIG_ENDPOINT_OPT_IN_REQUIRED, zero requests", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(
    makeGet({ FALCON_LLM_PROVIDER: "openai-compatible", FALCON_LLM_ENDPOINT: "https://localhost:11434/v1" }),
    {},
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_ENDPOINT_OPT_IN_REQUIRED");
});

test("provider=openai without any credential -> CONFIG_MISSING_CREDENTIALS", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(makeGet({ FALCON_LLM_PROVIDER: "openai" }), {});
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_MISSING_CREDENTIALS");
});

test("numeric bounds: out-of-range FALCON_LLM_TIMEOUT_MS -> CONFIG_INVALID", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(
    makeGet({ FALCON_LLM_PROVIDER: "openai", FALCON_LLM_API_KEY: "sk-x", FALCON_LLM_TIMEOUT_MS: "99" }),
    {},
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("numeric bounds: unset settings fall back to ADR defaults", () => {
  const { resolve } = freshConfigModule();
  const result = resolve(makeGet({ FALCON_LLM_PROVIDER: "openai", FALCON_LLM_API_KEY: "sk-x" }), {});
  assert.equal(result.ok, true);
  assert.equal(result.config.timeoutMs, 10000);
  assert.equal(result.config.maxAttempts, 2);
  assert.equal(result.config.runBudget, 50);
  assert.equal(result.config.maxResponseBytes, 65536);
  assert.equal(result.config.maxPromptCandidates, 20);
  assert.equal(result.config.concurrency, 2);
  assert.equal(result.config.promptMaxBytes, 8192);
});

// TDD red/green proof (documented, not executed as part of the suite): the
// AC19 "blank provider is unset" test above fails if readProvider() treats
// an empty string as a provider value instead of unset — reverting the
// `str.trim() === "" -> unset` branch in LlmConfig.js reproduces a red run
// of that test (config.provider would be undefined/thrown instead of
// "disabled"). Left as a comment per the Dev-01a instructions rather than a
// mutated duplicate file, to avoid shipping a deliberately broken module.
