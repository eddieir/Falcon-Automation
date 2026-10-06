"use strict";

/**
 * Regression: pending-candidate bookkeeping after a SUCCESSFUL healed action.
 *
 * LocatorMemory.recordPendingCandidate() is synchronous and can throw (a
 * decision in progress, an invalid identity or candidate). It runs after the
 * action already happened, so a throw must neither fail the heal (Tier 3 used
 * to report "also failed" for a click that succeeded) nor escape healSelector
 * (Tier 2.5 used to fail the step). An action that itself fails, or a failure
 * before the action, must still fail.
 *
 * Run directly with `node --test`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, temp, root } = require("./helpers.cjs");

const LocatorMemory = require(path.join(root, "src", "core", "locator", "LocatorMemory.js"));
const LocatorIdentity = require(path.join(root, "src", "core", "locator", "LocatorIdentity.js"));
const ElementSignature = require(path.join(root, "src", "core", "locator", "ElementSignature.js"));

const PAGE_URL = "https://example.com/checkout";
const AI_SELECTOR = '[data-testid="ai-guess"]';

const DESCRIPTOR = Object.freeze({
  tagName: "button",
  role: "button",
  accessibleName: "Submit order",
  attributes: { "data-testid": "submit-btn", type: "submit" },
  structuralPath: ["form", "div"],
  ownText: "Submit order",
  boundingBoxBucket: "bottom-right:small",
});

function liveFacts(selector) {
  return {
    selector,
    ...DESCRIPTOR,
    ancestorIdentity: null,
    structuralChain: [{ tagName: "form", nthOfType: 1 }],
    state: { hidden: false, disabled: false, readonly: false },
    contentEditable: false,
  };
}

function loadHealer() {
  const reports = [];
  const pending = [];
  const warnings = [];
  const AIHealer = load("src/core/AIHealer/AIHealer.js", {
    "../../../utils/Logger": {
      info() {}, error() {}, async flush() {},
      warning: (msg) => warnings.push(String(msg)),
    },
    "./LocatorStore": { getAlternatives: () => [] },
    "./HealingReport": { log: (row) => reports.push(row) },
    "./HealingTrust": { recordPending: (row) => pending.push(row), recordTier3Invocation() {} },
    "./AdaptiveRetry": class {
      async execute(fn) { return fn(); }
    },
  });
  return { AIHealer, reports, pending, warnings };
}

function makePage({ counts = {}, clicks = [] } = {}) {
  return {
    url: () => PAGE_URL,
    waitForSelector: async () => {},
    click: async (sel) => { clicks.push(sel); },
    fill: async () => {},
    selectOption: async () => {},
    locator: (sel) => ({ count: async () => (sel in counts ? counts[sel] : 1) }),
  };
}

function withMemory(fn) {
  const dir = temp();
  const memory = new LocatorMemory({
    memoryPath: path.join(dir, "locator_memory.json"),
    env: { FALCON_LOCATOR_SALT: "healer-bookkeeping-test-salt" },
  });
  return Promise.resolve()
    .then(() => fn(memory))
    .finally(async () => {
      await memory._queue;
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

function throwingPending(memory) {
  const calls = [];
  memory.recordPendingCandidate = (...args) => {
    calls.push(args);
    throw new Error("decision in progress");
  };
  return calls;
}

function tier3Healer(memory, page, tier3Calls) {
  const { AIHealer, reports, pending, warnings } = loadHealer();
  const collector = { collect: async () => [], collectOne: async (_p, sel) => liveFacts(sel) };
  const healer = new AIHealer(page, { locatorMemory: memory, elementFactsCollector: collector });
  healer.getAlternativeSelector = async () => {
    tier3Calls.push(1);
    return AI_SELECTOR;
  };
  return { healer, reports, pending, warnings };
}

test("Tier 3: a throwing recordPendingCandidate after a successful action does not fail the heal", () =>
  withMemory(async (memory) => {
    const pendingCalls = throwingPending(memory);
    const clicks = [];
    const tier3Calls = [];
    const { healer, reports, pending, warnings } = tier3Healer(memory, makePage({ clicks }), tier3Calls);

    await healer.healSelector("#gone", "Submit", "click");

    assert.equal(pendingCalls.length, 1, "the bookkeeping call must have been attempted");
    assert.deepEqual(clicks, [AI_SELECTOR], "the action must have run exactly once");
    assert.equal(pending.length, 1, "HealingTrust must still receive its pending row");
    assert.equal(pending[0].suggested, AI_SELECTOR);
    const llm = reports.filter((r) => r.tier === "LLM");
    assert.equal(llm.length, 1);
    assert.equal(llm[0].resolved, AI_SELECTOR);
    assert.equal(llm[0].trust, "pending");
    assert.equal(llm.some((r) => r.error), false, "no error row for an action that succeeded");
    assert.ok(warnings.some((w) => w.includes("decision in progress")), "the swallowed failure must be logged");
  }));

test("Tier 2.5: a throwing recordPendingCandidate after an accepted action does not fail the step", () =>
  withMemory(async (memory) => {
    const identity = LocatorIdentity.buildIdentity({
      url: PAGE_URL, action: "click", originalSelector: "#broken-button", env: {},
    }).identity;
    memory.recordEvidence(identity, ElementSignature.capture(DESCRIPTOR, { salt: memory.salt }));
    const pendingCalls = throwingPending(memory);

    const { AIHealer, reports, pending, warnings } = loadHealer();
    const clicks = [];
    const collector = { collect: async () => [liveFacts("#live-1")], collectOne: async () => null };
    const healer = new AIHealer(makePage({ clicks }), { locatorMemory: memory, elementFactsCollector: collector });
    let tier3Calls = 0;
    healer.getAlternativeSelector = async () => { tier3Calls++; return null; };

    await healer.healSelector("#broken-button", "Submit", "click");

    assert.equal(pendingCalls.length, 1, "the bookkeeping call must have been attempted");
    assert.equal(clicks.length, 1, "the action must have run exactly once");
    assert.equal(tier3Calls, 0, "Tier 3 must not be consulted after an accepted Tier 2.5 action");
    assert.equal(pending.length, 0);
    const t25 = reports.filter((r) => r.tier === "LocatorMemory");
    assert.equal(t25[t25.length - 1].status, "accepted");
    assert.ok(warnings.some((w) => w.includes("decision in progress")), "the swallowed failure must be logged");
  }));

test("Tier 3: an action that itself throws still fails with the unchanged wording", () =>
  withMemory(async (memory) => {
    const pendingCalls = throwingPending(memory);
    const page = makePage();
    page.click = async () => { throw new Error("element detached"); };
    const { healer, reports, pending } = tier3Healer(memory, page, []);

    await assert.rejects(
      () => healer.healSelector("#gone", "Submit", "click"),
      (err) => {
        assert.equal(err.code, "TARGET_UNAVAILABLE");
        assert.equal(
          err.message,
          `AI-Healer could not resolve Submit (#gone) after healing — ` +
          `the healed attempt against "${AI_SELECTOR}" also failed: element detached`
        );
        return true;
      }
    );
    assert.equal(pendingCalls.length, 0, "no bookkeeping for an action that failed");
    assert.equal(pending.length, 0);
    assert.ok(reports.some((r) => r.tier === "LLM" && r.error === "element detached"));
  }));

test("Tier 3: an ambiguous match before the action still fails", () =>
  withMemory(async (memory) => {
    const pendingCalls = throwingPending(memory);
    const clicks = [];
    const { healer, pending } = tier3Healer(memory, makePage({ counts: { [AI_SELECTOR]: 2 }, clicks }), []);

    await assert.rejects(
      () => healer.healSelector("#gone", "Submit", "click"),
      /also failed: AI-suggested locator ".*" is ambiguous \(2 matches\)/
    );
    assert.deepEqual(clicks, []);
    assert.equal(pendingCalls.length, 0);
    assert.equal(pending.length, 0);
  }));
