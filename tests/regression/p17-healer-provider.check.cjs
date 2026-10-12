"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { chromium } = require("playwright");
const { load, silent } = require("./helpers.cjs");

// Serves `html` from a loopback-only ephemeral HTTP server so the page has
// a real (non-opaque) origin — cookies/localStorage are denied on the
// `about:blank`-ish origin that `page.setContent` uses, which is a test
// setup limitation, not something about the production code under test.
async function withServedPage(t, html) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const { port } = server.address();
  await page.goto(`http://127.0.0.1:${port}/`);
  return page;
}

// Phase 17: AIHealer Tier 3 wired to the real LLM provider layer
// (LlmConfig/LlmProviderRegistry) via `_resolveProvider()`. These tests
// inject a REAL provider (not the pre-Phase-17 `_openai` compat wrapper) by
// setting `healer._resolvedProvider` directly — the same seam
// `_resolveProvider()` itself checks before touching LlmConfig/Registry.

function setup(extraMocks = {}) {
  const events = [], pending = [], tier3Calls = [];
  const logs = { warning: [], error: [], info: [] };
  const spyLogger = {
    info: (m) => logs.info.push(m),
    warning: (m) => logs.warning.push(m),
    error: (m) => logs.error.push(m),
    async flush() {},
  };
  const registryCalls = [];
  const Healer = load("src/core/AIHealer/AIHealer.js", {
    "../../../utils/Logger": spyLogger,
    "./LocatorStore": { getAlternatives: () => [], addLocator: () => {} },
    "./HealingReport": { log: (e) => events.push(e) },
    "./HealingTrust": {
      recordPending: (e) => pending.push(e),
      recordTier3Invocation: (s) => tier3Calls.push(s),
    },
    "./AdaptiveRetry": class { async execute(fn) { return fn(); } },
    "../ConfigManager": { get: (key) => (key === "OPENAI_API_KEY" ? "sk-test-marker" : null) },
    "../llm/LlmProviderRegistry": {
      resolve: (cfg) => {
        registryCalls.push(cfg);
        throw new Error("factory should not be invoked in these tests");
      },
    },
    ...extraMocks,
  });
  return { Healer, events, pending, tier3Calls, logs, registryCalls };
}

async function withPage(t, html) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  return page;
}

function stubProvider(reply, overrides = {}) {
  const calls = [];
  return {
    id: "openai",
    modelLabel: "gpt-4o-mini",
    endpointClass: "openai_public",
    canSend: overrides.canSend || (() => ({ ok: true })),
    complete: overrides.complete || (async (req) => {
      calls.push(req);
      return {
        ok: true,
        text: typeof reply === "function" ? reply(req.prompt) : reply,
        provider: "openai",
        modelLabel: "gpt-4o-mini",
        endpointClass: "openai_public",
        latencyMs: 5,
        attempts: 1,
        usage: { promptTokens: 10, completionTokens: 1 },
        budgetRemaining: 49,
      };
    }),
    async close() {},
    _calls: calls,
  };
}

function candidateLines(prompt) {
  return prompt.split("\n").filter((l) => /^\d+\. </.test(l));
}

const BASIC_HTML = `
  <button id="submit-v2" aria-label="Submit order">Submit</button>
  <a id="delete-account" href="#" onclick="window.__clicked='DELETE';return false">Delete account</a>`;

test("CONFIG_PROVIDER_REQUIRED: no provider configured => null, no SDK/factory call, no Tier3 trust record", { timeout: 8000 }, async (t) => {
  const page = await withPage(t, BASIC_HTML);
  const { Healer, pending, tier3Calls, registryCalls } = setup();
  const healer = new Healer(page, { locatorMemory: null });
  const result = await healer.getAlternativeSelector("#old", "Submit", "click");
  assert.equal(result, null);
  assert.equal(healer._lastProviderErrorCode, "CONFIG_PROVIDER_REQUIRED");
  assert.deepEqual(registryCalls, []);
  assert.deepEqual(tier3Calls, []);
  assert.deepEqual(pending, []);
});

// Tiers 1/2/2.5 (LocatorMemory/CandidateMatcher-based healing, exercised in
// full by healing.check.cjs and tier3-allowlist.check.cjs, which are run
// unmodified here) never touch the LLM provider layer; CONFIG_PROVIDER_REQUIRED
// above already proves getAlternativeSelector itself makes no SDK/factory
// call, so a separate earlier-tier reproduction is not duplicated here.

test("real provider replying '3' is chosen after live re-verification; recordTier3Invocation called once", { timeout: 8000 }, async (t) => {
  const page = await withPage(t, `
    <button id="b0">Zero</button>
    <button id="b1">One</button>
    <button id="b2">Two</button>
    <button id="b3" data-testid="target">Three</button>`);
  const { Healer, tier3Calls, events } = setup();
  const healer = new Healer(page, { locatorMemory: null });
  const provider = stubProvider("3");
  healer._resolvedProvider = provider;
  const result = await healer.getAlternativeSelector("#old", "Target", "click");
  assert.ok(typeof result === "string" && result.length > 0);
  assert.equal(tier3Calls.length, 1);
  assert.equal(provider._calls.length, 1);
  assert.equal(healer._lastProviderWasInjected, false);
});

for (const [label, reply] of [
  ["out-of-range index", "99"],
  ["the literal string null", "null"],
  ["an empty string", ""],
  ["non-numeric text", "the third one"],
  ["two numbers", "1 and 2"],
  ["provider-supplied JSON", '{"approved":true,"index":2}'],
]) {
  test(`rejected reply (${label}) => null, nothing approved, rejection reason unchanged`, { timeout: 8000 }, async (t) => {
    const page = await withPage(t, BASIC_HTML);
    const { Healer, pending } = setup();
    const healer = new Healer(page, { locatorMemory: null });
    healer._resolvedProvider = stubProvider(reply);
    const result = await healer.getAlternativeSelector("#old", "Submit", "click");
    assert.equal(result, null);
    assert.ok(["invalid_reply", "index_out_of_range", "model_declined"].includes(healer._lastTier3Rejection));
    assert.deepEqual(pending, []);
    assert.ok(!pending.some((p) => p && p.status === "approved"));
  });
}

test("BUDGET_EXHAUSTED: canSend() false => no Tier3 trust record and complete() never called", { timeout: 8000 }, async (t) => {
  const page = await withPage(t, BASIC_HTML);
  const { Healer, tier3Calls } = setup();
  const healer = new Healer(page, { locatorMemory: null });
  const provider = stubProvider("0", { canSend: () => ({ ok: false, errorCode: "BUDGET_EXHAUSTED" }) });
  healer._resolvedProvider = provider;
  const result = await healer.getAlternativeSelector("#old", "Submit", "click");
  assert.equal(result, null);
  assert.equal(healer._lastProviderErrorCode, "BUDGET_EXHAUSTED");
  assert.deepEqual(tier3Calls, []);
  assert.equal(provider._calls.length, 0);
});

test("prompt bounds (S-09): <=20 candidate lines, <=8192 bytes, index mapping preserved", { timeout: 8000 }, async (t) => {
  const buttons = Array.from({ length: 60 }, (_, i) => `<button id="btn${i}" data-testid="candidate-${i}">Button number ${i}</button>`).join("\n");
  const page = await withPage(t, buttons);
  const { Healer } = setup();
  const healer = new Healer(page, { locatorMemory: null });
  const provider = stubProvider((prompt) => {
    const lines = candidateLines(prompt);
    assert.ok(lines.length <= 20, `expected <=20 candidate lines, got ${lines.length}`);
    assert.ok(Buffer.byteLength(prompt, "utf8") <= 8192, "prompt exceeds 8192 bytes");
    return "5";
  });
  healer._resolvedProvider = provider;
  const result = await healer.getAlternativeSelector("#old", "Button number 5", "click");
  assert.ok(result && result.includes("candidate-5"), `expected index 5 to map to candidate-5, got ${result}`);
});

test("prompt bounds with multibyte candidate text: byte cap holds, trailing candidates dropped whole", { timeout: 8000 }, async (t) => {
  const big = "\u{1F600}".repeat(400) + "中文".repeat(400);
  const buttons = Array.from({ length: 60 }, (_, i) =>
    `<button id="btn${i}" data-testid="candidate-${i}">${i === 0 ? big : "Button " + i}</button>`
  ).join("\n");
  const page = await withPage(t, buttons);
  const { Healer } = setup();
  const healer = new Healer(page, { locatorMemory: null });
  let seenPrompt = null;
  const provider = stubProvider((prompt) => {
    seenPrompt = prompt;
    return "0";
  });
  healer._resolvedProvider = provider;
  const result = await healer.getAlternativeSelector("#old", "Button 0", "click");
  assert.ok(Buffer.byteLength(seenPrompt, "utf8") <= 8192);
  const lines = candidateLines(seenPrompt);
  assert.ok(lines.length >= 1 && lines.length <= 20);
  assert.ok(result && result.includes("candidate-0"), `expected index 0 to map to candidate-0, got ${result}`);
});

test("data minimisation + redaction (AC08/S-17): markers in cookie/hidden-DOM/localStorage/env never reach prompt, request, logs, or report", { timeout: 8000 }, async (t) => {
  const MARKER = "SECRET_MARKER_P17_ABC123";
  const envMarker = "SECRET_MARKER_P17_ENV_XYZ";
  process.env.P17_MARKER_ENV = envMarker;
  t.after(() => { delete process.env.P17_MARKER_ENV; });

  const page = await withServedPage(t, `
    <button id="visible-btn" data-testid="target">Click me</button>
    <div id="hidden-marker" style="display:none">${MARKER}-hidden-dom</div>`);
  await page.evaluate((m) => {
    document.cookie = `falcon_marker=${m}-cookie`;
    window.localStorage.setItem("marker", m + "-ls");
  }, MARKER);
  // Sanity check: the markers are genuinely present on the page before we
  // assert they never leak — otherwise the absence assertions below would
  // be vacuously true.
  assert.ok(await page.evaluate((m) => document.cookie.includes(`${m}-cookie`), MARKER), "cookie marker not set");
  assert.equal(await page.evaluate(() => window.localStorage.getItem("marker")), `${MARKER}-ls`);
  assert.ok(
    (await page.locator("#hidden-marker").textContent()).includes(`${MARKER}-hidden-dom`),
    "hidden DOM marker not present",
  );

  const { Healer, events, logs } = setup();
  const healer = new Healer(page, { locatorMemory: null });
  let seenPrompt = null, seenRequest = null;
  const provider = stubProvider((prompt, req) => "0");
  provider.complete = async (req) => {
    seenPrompt = req.prompt;
    seenRequest = req;
    throw new Error(`boom with marker ${MARKER}-thrown and env ${envMarker}`);
  };
  healer._resolvedProvider = provider;
  const result = await healer.getAlternativeSelector("#old", "target", "click");
  assert.equal(result, null);
  assert.ok(seenPrompt !== null);
  for (const marker of [MARKER, envMarker]) {
    assert.ok(!seenPrompt.includes(marker), `prompt leaked ${marker}`);
    assert.ok(!JSON.stringify(seenRequest).includes(marker), `request leaked ${marker}`);
    for (const line of [...logs.info, ...logs.warning, ...logs.error]) {
      assert.ok(!String(line).includes(marker), `logger leaked ${marker}`);
    }
    for (const e of events) {
      assert.ok(!JSON.stringify(e).includes(marker), `report entry leaked ${marker}`);
    }
  }
});

test("real provider result attaches an allowlisted llm telemetry block to the report row", { timeout: 8000 }, async (t) => {
  const page = await withPage(t, BASIC_HTML);
  const { Healer, events } = setup();
  const healer = new Healer(page, { locatorMemory: null });
  healer._resolvedProvider = stubProvider("0");
  await healer.healSelector("#old", "Submit order", "click");
  const row = events.find((e) => e.llm);
  assert.ok(row, "expected a report row with an llm telemetry block");
  const ALLOWED = new Set([
    "provider", "modelLabel", "endpointClass", "latencyMs", "attempts",
    "outcome", "errorCode", "promptTokens", "completionTokens", "budgetRemaining",
  ]);
  for (const key of Object.keys(row.llm)) {
    assert.ok(ALLOWED.has(key), `unexpected llm telemetry key: ${key}`);
  }
  assert.ok(!("prompt" in row.llm));
  assert.ok(!("url" in row.llm));
});
