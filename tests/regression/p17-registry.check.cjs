const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers.cjs");

test("AC06: disabled provider is consulted but constructs no client, no network", async () => {
  const { resolve } = load("src/core/llm/LlmProviderRegistry.js", {});
  const provider = resolve({ provider: "disabled" });
  assert.equal(provider.id, "disabled");
  const result = await provider.complete({ prompt: "x", maxOutputTokens: 80, temperature: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "PROVIDER_DISABLED");
  assert.equal(result.attempts, 0);
});

test("DisabledProvider.complete never throws and resolves synchronously-cheap", async () => {
  const { resolve } = load("src/core/llm/LlmProviderRegistry.js", {});
  const provider = resolve({ provider: "disabled" });
  await assert.doesNotReject(provider.complete({ prompt: "", maxOutputTokens: 0, temperature: 0 }));
});

test("registry memoizes the same provider id per process", () => {
  const { resolve, _resetMemoForTests } = load("src/core/llm/LlmProviderRegistry.js", {});
  _resetMemoForTests();
  const first = resolve({ provider: "disabled" });
  const second = resolve({ provider: "disabled" });
  assert.equal(first, second);
});

test("registry rejects unwired provider ids instead of dynamic loading", () => {
  const { resolve } = load("src/core/llm/LlmProviderRegistry.js", {});
  // "openai"/"azure-openai"/"openai-compatible"/"anthropic"/"gemini" are all
  // wired in now (Dev-02a/02b/03); any other string is still an unknown,
  // unwired provider id and must stay rejected, never dynamically loaded.
  assert.throws(() => resolve({ provider: "bogus-provider-id" }), /no provider wired in/);
  assert.throws(() => resolve({ provider: "../../etc/passwd" }), /no provider wired in/);
});

test("registry: provider=openai resolves to a wired OpenAIProvider instance (Dev-02a)", () => {
  const { resolve, _resetMemoForTests } = load("src/core/llm/LlmProviderRegistry.js", {});
  _resetMemoForTests();
  const provider = resolve({ provider: "openai", model: "gpt-4o-mini", apiKey: "x", timeoutMs: 1000, maxAttempts: 2, runBudget: 10, maxResponseBytes: 65536, concurrency: 2 });
  assert.equal(provider.id, "openai");
  assert.equal(provider.endpointClass, "openai_public");
  _resetMemoForTests();
});

test("registry exact-match lookup is case-sensitive, no fuzzy match", () => {
  const { resolve } = load("src/core/llm/LlmProviderRegistry.js", {});
  assert.throws(() => resolve({ provider: "Disabled" }), /no provider wired in/);
  assert.throws(() => resolve({ provider: "DISABLED" }), /no provider wired in/);
});
