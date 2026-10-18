"use strict";

/**
 * Regression: `healingStage` dashboard events on the recovery path only.
 * Order, reuse path, silence on Tier 1 success, emitter-failure isolation, and
 * the fixed `reasons` vocabulary.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, temp, root, silent, drainQueue } = require("./helpers.cjs");

const LocatorMemory = require(path.join(root, "src", "core", "locator", "LocatorMemory.js"));
const LocatorIdentity = require(path.join(root, "src", "core", "locator", "LocatorIdentity.js"));
const ElementSignature = require(path.join(root, "src", "core", "locator", "ElementSignature.js"));

const PAGE_URL = "https://example.com/checkout";
const VOCAB = new Set([
  "Stable attributes match (test id, name, label, type)",
  "Same visible label",
  "Same place in the page structure",
  "Same text",
  "Same position on the page",
]);

const DESCRIPTOR = Object.freeze({
  tagName: "button", role: "button", accessibleName: "Submit order",
  attributes: { "data-testid": "submit-btn", type: "submit" },
  structuralPath: ["form", "div"], ownText: "Submit order", boundingBoxBucket: "bottom-right:small",
});

function liveFacts(selector) {
  return {
    selector, ...DESCRIPTOR, ancestorIdentity: null,
    structuralChain: [{ tagName: "form", nthOfType: 1 }],
    state: { hidden: false, disabled: false, readonly: false }, contentEditable: false,
  };
}

function loadHealer(emit) {
  return load("src/core/AIHealer/AIHealer.js", {
    "../../../utils/Logger": silent,
    "../Middleware": { emit },
    "./LocatorStore": { getAlternatives: () => [] },
    "./HealingReport": { log() {} },
    "./HealingTrust": { recordPending() {}, recordTier3Invocation() {} },
    "./AdaptiveRetry": class { async execute(fn) { return fn(); } },
  });
}

function makePage({ failWait = false } = {}) {
  return {
    url: () => PAGE_URL,
    waitForSelector: async () => { if (failWait) throw new Error("timeout"); },
    click: async () => {}, fill: async () => {}, selectOption: async () => {},
    locator: () => ({ count: async () => 1 }),
  };
}

async function withMemory(fn) {
  const dir = temp();
  const memory = new LocatorMemory({
    memoryPath: path.join(dir, "locator_memory.json"),
    env: { FALCON_LOCATOR_SALT: "stage-events-test-salt" },
  });
  try { await fn(memory); } finally {
    await drainQueue(memory, dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function seed(memory) {
  const identity = LocatorIdentity.buildIdentity({
    url: PAGE_URL, action: "click", originalSelector: "#broken-button", env: {},
  }).identity;
  memory.recordEvidence(identity, ElementSignature.capture(DESCRIPTOR, { salt: memory.salt }));
  return identity;
}

function recorder() {
  const events = [];
  return { events, emit: (name, payload) => { if (name === "healingStage") events.push(payload); } };
}

const FAST = { maxAttempts: 1, baseDelayMs: 1, selectorTimeoutMs: 5 };

test("recovery emits stages in order with the agreed payload", () => withMemory(async (memory) => {
  seed(memory);
  const { events, emit } = recorder();
  const AIHealer = loadHealer(emit);
  const collector = { collect: async () => [liveFacts("#live-1")], collectOne: async () => null };
  const healer = new AIHealer(makePage({ failWait: true }), {
    locatorMemory: memory, elementFactsCollector: collector,
    tier1: { maxAttempts: 2, baseDelayMs: 1, selectorTimeoutMs: 123 },
  });
  await healer.healAndClick("#broken-button", "Submit");

  assert.deepEqual(events.map((e) => e.stage),
    ["original_failed", "recovery_started", "candidate_selected", "action_completed", "proposal_pending"]);
  assert.equal(events[0].attempts, 1, "attempts actually made (stub retry runs once)");
  assert.equal(events[0].timeoutMs, 123);
  assert.equal(events[0].original, "#broken-button");
  assert.equal(events[1].tier, "LocatorMemory");
  const cand = events[2];
  assert.equal(typeof cand.resolved, "string");
  assert.equal(typeof cand.score, "number");
  assert.equal(typeof cand.margin, "number");
  assert.ok(cand.reasons.length > 0);
  for (const r of cand.reasons) assert.ok(VOCAB.has(r), `unexpected reason: ${r}`);
  assert.equal(events[3].resolved, cand.resolved);
  assert.equal(typeof events[4].proposalId, "string");
  assert.ok(events[4].proposalId.length > 0);
  for (const e of events) {
    for (const v of Object.values(e)) {
      assert.ok(["string", "number"].includes(typeof v) || Array.isArray(v), "plain values only");
    }
  }
}));

test("approved reuse emits action_completed(via approved) and no proposal_pending", () => withMemory(async (memory) => {
  seed(memory);
  const { events, emit } = recorder();
  const AIHealer = loadHealer(emit);
  const sig = ElementSignature.capture(DESCRIPTOR, { salt: memory.salt });
  memory.getApprovedAlternatives = () => [{ selector: "#approved", signature: sig }];
  const collector = {
    collect: async () => [liveFacts("#live-1")],
    collectOne: async (_p, sel) => liveFacts(sel),
  };
  const healer = new AIHealer(makePage({ failWait: true }), {
    locatorMemory: memory, elementFactsCollector: collector, tier1: FAST,
  });
  await healer.healAndClick("#broken-button", "Submit");
  const stages = events.map((e) => e.stage);
  const done = events.find((e) => e.stage === "action_completed");
  assert.ok(done, "action_completed must be emitted");
  assert.equal(done.via, "approved");
  assert.equal(done.resolved, "#approved");
  assert.equal(stages.includes("proposal_pending"), false);
  assert.equal(stages.includes("candidate_selected"), false);
}));

test("Tier 1 success emits no stage events", async () => {
  const { events, emit } = recorder();
  const AIHealer = loadHealer(emit);
  const healer = new AIHealer(makePage(), { locatorMemory: null });
  await healer.healAndClick("#ok", "OK");
  assert.deepEqual(events, []);
});

test("an emitter that throws never fails healing", () => withMemory(async (memory) => {
  seed(memory);
  const AIHealer = loadHealer(() => { throw new Error("emitter down"); });
  const clicks = [];
  const page = makePage({ failWait: true });
  page.click = async (s) => { clicks.push(s); };
  const collector = { collect: async () => [liveFacts("#live-1")], collectOne: async () => null };
  const healer = new AIHealer(page, { locatorMemory: memory, elementFactsCollector: collector, tier1: FAST });
  await healer.healAndClick("#broken-button", "Submit");
  assert.equal(clicks.length, 1, "the healed action must still run");
}));

async function proposalStages(memory, stub) {
  seed(memory);
  const { events, emit } = recorder();
  const AIHealer = loadHealer(emit);
  if (stub) memory.recordPendingCandidate = stub;
  const collector = { collect: async () => [liveFacts("#live-1")], collectOne: async () => null };
  const healer = new AIHealer(makePage({ failWait: true }), { locatorMemory: memory, elementFactsCollector: collector, tier1: FAST });
  await healer.healAndClick("#broken-button", "Submit");
  return events.map((e) => e.stage);
}

test("no proposal_pending when recording throws", () => withMemory(async (memory) => {
  const stages = await proposalStages(memory, () => { throw new Error("decision in progress"); });
  assert.ok(stages.includes("action_completed"));
  assert.equal(stages.includes("proposal_pending"), false);
}));

test("no proposal_pending on a ParallelMode divert (null)", () => withMemory(async (memory) => {
  const stages = await proposalStages(memory, () => null);
  assert.equal(stages.includes("proposal_pending"), false);
}));

test("no proposal_pending for an already-approved entry without pendingCandidate", () => withMemory(async (memory) => {
  const stages = await proposalStages(memory, () => ({ status: "trusted" }));
  assert.equal(stages.includes("proposal_pending"), false);
}));

test("a real pending proposal emits exactly one proposal_pending", () => withMemory(async (memory) => {
  const stages = await proposalStages(memory, null);
  assert.equal(stages.filter((s) => s === "proposal_pending").length, 1);
}));

test("absent pacing emits every stage with no delay", () => withMemory(async (memory) => {
  seed(memory);
  const { events, emit } = recorder();
  const AIHealer = loadHealer(emit);
  const collector = { collect: async () => [liveFacts("#live-1")], collectOne: async () => null };
  const healer = new AIHealer(makePage({ failWait: true }), {
    locatorMemory: memory, elementFactsCollector: collector, tier1: FAST,
  });
  const start = Date.now();
  await healer.healAndClick("#broken-button", "Submit");
  assert.ok(Date.now() - start < 100, "no pacing configured must not add real delay");
  assert.deepEqual(events.map((e) => e.stage),
    ["original_failed", "recovery_started", "candidate_selected", "action_completed", "proposal_pending"]);
}));

test("pacing.stageDelayMs separates stages and the click waits for candidate_selected + delay", () => withMemory(async (memory) => {
  seed(memory);
  const stageTimes = [];
  const timedEmit = (name) => { if (name === "healingStage") stageTimes.push(Date.now()); };
  const AIHealer = loadHealer(timedEmit);
  const collector = { collect: async () => [liveFacts("#live-1")], collectOne: async () => null };
  const page = makePage({ failWait: true });
  const clickTimes = [];
  page.click = async () => { clickTimes.push(Date.now()); };
  const DELAY = 40;
  const healer = new AIHealer(page, {
    locatorMemory: memory, elementFactsCollector: collector, tier1: FAST,
    pacing: { stageDelayMs: DELAY },
  });
  await healer.healAndClick("#broken-button", "Submit");
  assert.ok(stageTimes.length >= 3, "expected at least 3 healingStage events");
  for (let i = 1; i < stageTimes.length; i++) {
    assert.ok(stageTimes[i] - stageTimes[i - 1] >= DELAY - 5,
      `stage ${i} fired only ${stageTimes[i] - stageTimes[i - 1]}ms after stage ${i - 1}, expected >= ${DELAY}`);
  }
  assert.ok(clickTimes.length >= 1, "the click must still happen");
  assert.ok(clickTimes[0] >= stageTimes[2] + DELAY - 5,
    "the click must happen only after candidate_selected plus its pacing delay");
}));

test("pacing.stageDelayMs is validated like tier1", () => {
  const AIHealer = loadHealer(() => {});
  assert.throws(() => new AIHealer(makePage(), { pacing: { stageDelayMs: -1 } }), /stageDelayMs/);
  assert.throws(() => new AIHealer(makePage(), { pacing: { stageDelayMs: "no" } }), /stageDelayMs/);
  assert.throws(() => new AIHealer(makePage(), { pacing: { stageDelayMs: NaN } }), /stageDelayMs/);
  assert.doesNotThrow(() => new AIHealer(makePage(), { pacing: { stageDelayMs: 0 } }));
  assert.doesNotThrow(() => new AIHealer(makePage(), {}));
});

test("Tier 1 success with pacing configured still emits no stage events and no delay", async () => {
  const { events, emit } = recorder();
  const AIHealer = loadHealer(emit);
  const healer = new AIHealer(makePage(), { locatorMemory: null, pacing: { stageDelayMs: 500 } });
  const start = Date.now();
  await healer.healAndClick("#ok", "OK");
  assert.deepEqual(events, []);
  assert.ok(Date.now() - start < 100, "Tier 1 success must never await a pacing delay");
});

test("TestRunner forwards healerOptions without overriding providerContext", () => {
  const seen = [];
  const TestRunner = load("src/core/TestRunner.js", {
    "./AIHealer/AIHealer": class { constructor(page, opts) { seen.push(opts); } },
  });
  const memory = {};
  const tier1 = { maxAttempts: 1 };
  const ctx = { id: "real" };
  new TestRunner({}, null, { providerContext: ctx, healerOptions: { tier1, locatorMemory: memory, providerContext: { id: "evil" } } });
  assert.equal(seen[0].tier1, tier1);
  assert.equal(seen[0].locatorMemory, memory);
  assert.equal(seen[0].providerContext, ctx);
  new TestRunner({}, null, { providerContext: ctx });
  assert.deepEqual(Object.keys(seen[1]).sort(), ["providerContext"]);
  assert.equal(seen[1].providerContext, ctx);
});
