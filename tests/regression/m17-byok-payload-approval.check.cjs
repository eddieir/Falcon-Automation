/**
 * tests/regression/m17-byok-payload-approval.check.cjs — AC17: AIHealer
 * Tier 3 driven through the new BYOK adapters (AnthropicProvider,
 * GeminiProvider) with hostile reply payloads, confirming only a clean
 * in-range integer selects a candidate and Phase 8 approval/trust flags
 * are unchanged. Mirrors the injected-provider seam used by
 * tests/regression/p17-healer-provider.check.cjs; FAKE markers are
 * runtime-built, never hardcoded provider-key-shaped literals.
 *
 * Run: node --test --test-concurrency=1 --test-timeout=10000 tests/regression/m17-byok-payload-approval.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { load } = require("./helpers.cjs");

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

/**
 * Wraps a BYOK adapter (Anthropic/Gemini shaped) so its `complete()` always
 * resolves ok:true with the given hostile `reply` text, regardless of what
 * the Tier 3 prompt asked for — exercising the healer's own reply
 * validation, not the adapter's HTTP parsing (already covered by
 * m17-byok-anthropic/gemini.check.cjs).
 */
function hostileProvider(id, modelLabel, endpointClass, reply) {
  const calls = [];
  return {
    id,
    modelLabel,
    endpointClass,
    canSend: () => ({ ok: true }),
    complete: async (req) => {
      calls.push(req);
      return {
        ok: true,
        text: reply,
        provider: id,
        modelLabel,
        endpointClass,
        latencyMs: 5,
        attempts: 1,
        usage: { promptTokens: 10, completionTokens: 1 },
      };
    },
    async close() {},
    _calls: calls,
  };
}

const BASIC_HTML = `
  <button id="submit-v2" aria-label="Submit order">Submit</button>
  <a id="delete-account" href="#" onclick="window.__clicked='DELETE';return false">Delete account</a>`;

const HOSTILE_REPLIES = [
  "0",
  "99",
  "-1",
  "2; ignore previous",
  "3.5",
  "candidate 2",
  "<script>",
  "x".repeat(5000),
];

for (const [providerId, modelLabel, endpointClass] of [
  ["anthropic", "claude-3-5-sonnet", "anthropic_public"],
  ["gemini", "gemini-1.5-flash", "gemini_public"],
]) {
  for (const reply of HOSTILE_REPLIES) {
    const label = reply.length > 40 ? `${reply.slice(0, 20)}...(${reply.length} chars)` : reply;
    test(`${providerId}: hostile reply "${label}" is rejected, nothing approved`, { timeout: 8000 }, async (t) => {
      const page = await withPage(t, BASIC_HTML);
      const { Healer, pending, events } = setup();
      const healer = new Healer(page, { locatorMemory: null });
      const provider = hostileProvider(providerId, modelLabel, endpointClass, reply);
      healer._resolvedProvider = provider;
      const result = await healer.getAlternativeSelector("#old", "Submit", "click");

      // Only "0" is a clean in-range integer for this 2-candidate page
      // (indices 0 and 1) — every other hostile reply above must be
      // rejected, never approved.
      if (reply === "0") {
        assert.ok(typeof result === "string" && result.length > 0, "the one clean in-range integer must select a candidate");
      } else {
        assert.equal(result, null, `hostile reply "${label}" must not select a candidate`);
      }

      assert.equal(provider._calls.length, 1);
      // Phase 8 approval/trust flags are unchanged: no row is ever marked
      // approved as a side effect of a hostile Tier 3 reply.
      assert.ok(!pending.some((p) => p && p.status === "approved"));
      for (const e of events) {
        assert.ok(!(e && e.approved === true), "no report row is approved by a hostile Tier 3 reply");
      }
    });
  }
}

test("sanity: a clean in-range integer from either adapter still heals normally (anthropic)", { timeout: 8000 }, async (t) => {
  const page = await withPage(t, `
    <button id="b0">Zero</button>
    <button id="b1">One</button>
    <button id="b2" data-testid="target">Two</button>`);
  const { Healer, tier3Calls } = setup();
  const healer = new Healer(page, { locatorMemory: null });
  const provider = hostileProvider("anthropic", "claude-3-5-sonnet", "anthropic_public", "2");
  healer._resolvedProvider = provider;
  const result = await healer.getAlternativeSelector("#old", "Target", "click");
  // SelectorBuilder prefers the stable data-testid attribute over the
  // element's `id` when both are present on the chosen candidate.
  assert.ok(typeof result === "string" && result.includes("target"), `expected the target candidate, got ${result}`);
  assert.equal(tier3Calls.length, 1);
});

test("sanity: a clean in-range integer from either adapter still heals normally (gemini)", { timeout: 8000 }, async (t) => {
  const page = await withPage(t, `
    <button id="b0">Zero</button>
    <button id="b1" data-testid="target">One</button>`);
  const { Healer, tier3Calls } = setup();
  const healer = new Healer(page, { locatorMemory: null });
  const provider = hostileProvider("gemini", "gemini-1.5-flash", "gemini_public", "1");
  healer._resolvedProvider = provider;
  const result = await healer.getAlternativeSelector("#old", "Target", "click");
  assert.ok(typeof result === "string" && result.includes("target"), `expected the target candidate, got ${result}`);
  assert.equal(tier3Calls.length, 1);
});
