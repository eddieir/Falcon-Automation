const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers.cjs");
const { ERROR_CODES } = require("../../src/core/llm/LlmProvider");

test("closed error-code list is frozen and matches ADR-0017 section 5", () => {
  assert.ok(Object.isFrozen(ERROR_CODES));
  assert.throws(() => {
    ERROR_CODES.push("NEW_CODE");
  });
  assert.equal(ERROR_CODES.length, 19);
  assert.ok(ERROR_CODES.includes("PROVIDER_DISABLED"));
  assert.ok(ERROR_CODES.includes("CONFIG_PROVIDER_REQUIRED"));
});

test("S-10: telemetry serializes a success result from the allowlist only", () => {
  const { serialize } = load("src/core/llm/LlmTelemetry.js", {});
  const out = serialize({
    ok: true,
    provider: "openai",
    modelLabel: "gpt-4o-mini",
    endpointClass: "openai_public",
    latencyMs: 120,
    attempts: 1,
    usage: { promptTokens: 10, completionTokens: 2 },
    budgetRemaining: 49,
  });
  assert.deepEqual(out, {
    provider: "openai",
    modelLabel: "gpt-4o-mini",
    endpointClass: "openai_public",
    latencyMs: 120,
    attempts: 1,
    outcome: "success",
    errorCode: null,
    promptTokens: 10,
    completionTokens: 2,
    budgetRemaining: 49,
  });
});

test("S-10: telemetry serializes a failure result with a known errorCode", () => {
  const { serialize } = load("src/core/llm/LlmTelemetry.js", {});
  const out = serialize({ ok: false, provider: "disabled", modelLabel: "disabled", errorCode: "PROVIDER_DISABLED", latencyMs: 0, attempts: 0 });
  assert.equal(out.outcome, "failure");
  assert.equal(out.errorCode, "PROVIDER_DISABLED");
});

test("unknown errorCode on input is dropped, not forwarded", () => {
  const { serialize } = load("src/core/llm/LlmTelemetry.js", {});
  const out = serialize({ ok: false, errorCode: "TOTALLY_MADE_UP_CODE" });
  assert.equal(out.errorCode, null);
});

test("malformed modelLabel is replaced with the literal 'invalid'", () => {
  const { serialize } = load("src/core/llm/LlmTelemetry.js", {});
  const out = serialize({ ok: true, modelLabel: "<script>alert(1)</script>" });
  assert.equal(out.modelLabel, "invalid");
});

test("non-safe-integer numeric fields become null, never NaN/Infinity", () => {
  const { serialize } = load("src/core/llm/LlmTelemetry.js", {});
  const out = serialize({ ok: true, latencyMs: Infinity, attempts: NaN, budgetRemaining: "49" });
  assert.equal(out.latencyMs, null);
  assert.equal(out.attempts, null);
  assert.equal(out.budgetRemaining, null);
});

test("extra/unknown fields on the input never survive serialization", () => {
  const { serialize } = load("src/core/llm/LlmTelemetry.js", {});
  const out = serialize({
    ok: true,
    provider: "openai",
    prompt: "the entire prompt text",
    apiKey: "sk-PLANTED-MARKER",
    rawHeaders: { authorization: "Bearer sk-PLANTED-MARKER" },
    __proto__marker: "PLANTED",
  });
  assert.ok(!Object.keys(out).includes("prompt"));
  assert.ok(!Object.keys(out).includes("apiKey"));
  assert.ok(!Object.keys(out).includes("rawHeaders"));
  assert.ok(!JSON.stringify(out).includes("PLANTED"));
});

test("S-16: escapeHtml neutralises HTML/script content for report rendering", () => {
  const { escapeHtml } = load("src/core/llm/LlmTelemetry.js", {});
  const out = escapeHtml('<script>alert("x")</script>&\'');
  assert.equal(out, "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;");
  assert.ok(!out.includes("<script>"));
});

test("output telemetry object is frozen (defensive against later mutation)", () => {
  const { serialize } = load("src/core/llm/LlmTelemetry.js", {});
  const out = serialize({ ok: true, provider: "openai" });
  assert.ok(Object.isFrozen(out));
  out.provider = "tampered"; // silently a no-op outside strict mode
  assert.equal(out.provider, "openai");
});
