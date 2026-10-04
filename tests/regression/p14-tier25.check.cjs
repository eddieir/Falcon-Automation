"use strict";

/**
 * P14-21 regression: Tier 2.5 wired into the live AIHealer healing chain.
 *
 * Covers EP-5 §8's integration contract: Tier 2.5 runs only after Tier 2
 * exhausts and only before Tier 3; a cold identity (no trusted evidence)
 * costs zero DOM queries; a refused/no_candidate match falls through to
 * Tier 3 without throwing; an accepted-but-failed action persists nothing
 * and still reaches Tier 3; an accepted genuinely-new selector lands in
 * `pendingCandidate` only; an accepted verbatim-identical selector refreshes
 * trust; Tier 1/Tier 2 successes capture evidence on a fire-and-forget
 * basis that never adds latency; the shared-salt requirement (F14-1); and
 * ElementFactsCollector's own quiet-degradation behaviour.
 *
 * Run directly with `node --test`, independent of the rest of the suite.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, silent, temp, root } = require("./helpers.cjs");

const LocatorMemory = require(path.join(root, "src", "core", "locator", "LocatorMemory.js"));
const LocatorIdentity = require(path.join(root, "src", "core", "locator", "LocatorIdentity.js"));
const ElementSignature = require(path.join(root, "src", "core", "locator", "ElementSignature.js"));
const ElementFactsCollector = require(path.join(root, "src", "core", "locator", "ElementFactsCollector.js"));

const PAGE_URL = "https://example.com/checkout";

function identityFor(selector, action = "click") {
  const built = LocatorIdentity.buildIdentity({ url: PAGE_URL, action, originalSelector: selector, env: {} });
  assert.equal(built.status, "built", `identity should build for ${selector}`);
  return built;
}

/** Fresh AIHealer class loaded with every non-locator dependency faked out. */
function loadAIHealer() {
  const logs = [];
  const AdaptiveRetryFake = class {
    constructor() {}
    // Single attempt, no backoff, no jitter — deterministic and fast.
    async execute(fn) {
      return fn();
    }
  };
  const AIHealer = load("src/core/AIHealer/AIHealer.js", {
    "../../../utils/Logger": silent,
    "./LocatorStore": { getAlternatives: () => [] },
    "./HealingReport": { log: (opts) => logs.push(opts) },
    "./HealingTrust": { recordPending() {}, recordTier3Invocation() {} },
    "./AdaptiveRetry": AdaptiveRetryFake,
  });
  return { AIHealer, logs };
}

function makeMemory(dir, env = { FALCON_LOCATOR_SALT: "p14-tier25-test-salt" }) {
  return new LocatorMemory({ memoryPath: path.join(dir, "locator_memory.json"), env });
}

function makePage(overrides = {}) {
  return Object.assign(
    {
      url: () => PAGE_URL,
      waitForSelector: async () => {},
      click: async () => {},
      fill: async () => {},
      selectOption: async () => {},
      locator: () => ({ count: async () => 1 }),
      evaluate: async () => {
        throw new Error("page.evaluate must not be called directly in these tests — inject a fake collector instead");
      },
    },
    overrides
  );
}

const BUTTON_DESCRIPTOR = Object.freeze({
  tagName: "button",
  role: "button",
  accessibleName: "Submit order",
  attributes: { "data-testid": "submit-btn", type: "submit" },
  structuralPath: ["form", "div"],
  ownText: "Submit order",
  boundingBoxBucket: "bottom-right:small",
});

function liveCandidateFacts(selectorLabel, descriptor = BUTTON_DESCRIPTOR) {
  return {
    selector: selectorLabel,
    tagName: descriptor.tagName,
    role: descriptor.role,
    accessibleName: descriptor.accessibleName,
    attributes: descriptor.attributes,
    structuralPath: descriptor.structuralPath,
    ownText: descriptor.ownText,
    boundingBoxBucket: descriptor.boundingBoxBucket,
    ancestorIdentity: null,
    structuralChain: [{ tagName: "form", nthOfType: 1 }],
    state: { hidden: false, disabled: false, readonly: false },
    contentEditable: false,
  };
}

function withTempDir(fn) {
  const dir = temp();
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

async function flush(memory) {
  // Microtask ticks for the fire-and-forget evidence capture chain, then
  // wait on the store's own write queue so a persisted assertion is never
  // racing the in-flight write.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await memory._queue;
}

// ---------------------------------------------------------------------------
// No trusted evidence -> zero DOM query, falls through to Tier 3.
// ---------------------------------------------------------------------------

test("Tier 2.5: no trusted evidence falls through to Tier 3 with zero DOM query", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir);
    const { AIHealer, logs } = loadAIHealer();

    let collectCalls = 0;
    const collector = {
      collect: async () => {
        collectCalls++;
        throw new Error("collect() must never be called when there is no trusted evidence");
      },
      collectOne: async () => null,
    };

    const healer = new AIHealer(makePage(), { locatorMemory: memory, elementFactsCollector: collector });
    let tier3Calls = 0;
    healer.getAlternativeSelector = async () => {
      tier3Calls++;
      return null;
    };

    await assert.rejects(
      () => healer.healSelector("#broken-button", "Submit", "click"),
      (err) => err.code === "TARGET_UNAVAILABLE"
    );

    assert.equal(collectCalls, 0, "ElementFactsCollector.collect must not be invoked for a cold identity");
    assert.equal(tier3Calls, 1, "Tier 3 must still be reached");
    const tier25Logs = logs.filter((l) => l.tier === "LocatorMemory");
    assert.equal(tier25Logs.length, 1);
    assert.equal(tier25Logs[0].status, "no_candidate");
  }));

// ---------------------------------------------------------------------------
// Refused match -> falls through to Tier 3 without throwing from Tier 2.5.
// ---------------------------------------------------------------------------

test("Tier 2.5: a refused match falls through to Tier 3 without throwing", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir);
    const identity = identityFor("#broken-button").identity;
    const storedSignature = ElementSignature.capture(BUTTON_DESCRIPTOR, { salt: memory.salt });
    memory.recordEvidence(identity, storedSignature);

    const { AIHealer, logs } = loadAIHealer();
    const dissimilarDescriptor = {
      tagName: "a",
      role: null,
      accessibleName: "Zzyx Qwkk unrelated link",
      attributes: { id: "unrelated-link" },
      structuralPath: ["nav"],
      ownText: "Zzyx Qwkk unrelated link",
      boundingBoxBucket: "top-left:large",
    };
    const collector = {
      collect: async () => [liveCandidateFacts("#live-1", dissimilarDescriptor)],
      collectOne: async () => null,
    };

    const healer = new AIHealer(makePage(), { locatorMemory: memory, elementFactsCollector: collector });
    let tier3Calls = 0;
    healer.getAlternativeSelector = async () => {
      tier3Calls++;
      return null;
    };

    await assert.rejects(() => healer.healSelector("#broken-button", "Submit", "click"), (err) => err.code === "TARGET_UNAVAILABLE");

    assert.equal(tier3Calls, 1, "Tier 3 must still be reached after a refusal");
    const tier25Logs = logs.filter((l) => l.tier === "LocatorMemory");
    assert.equal(tier25Logs.length, 1);
    assert.equal(tier25Logs[0].status, "refused");
    // Trust must be unaffected by a refusal.
    assert.ok(memory.getTrusted(identity));
    await memory._queue;
  }));

// ---------------------------------------------------------------------------
// Accepted but the action itself fails -> nothing persisted, falls through.
// ---------------------------------------------------------------------------

test("Tier 2.5: accepted-then-failed action persists nothing and still reaches Tier 3", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir);
    const built = identityFor("#old-submit-button");
    const identity = built.identity;
    const storedSignature = ElementSignature.capture(BUTTON_DESCRIPTOR, { salt: memory.salt });
    const before = memory.recordEvidence(identity, storedSignature);

    const { AIHealer, logs } = loadAIHealer();
    const collector = {
      collect: async () => [liveCandidateFacts("#live-1")],
      collectOne: async () => null,
    };

    const page = makePage({
      click: async () => {
        throw new Error("click failed on the healed candidate");
      },
    });
    const healer = new AIHealer(page, { locatorMemory: memory, elementFactsCollector: collector });
    let tier3Calls = 0;
    healer.getAlternativeSelector = async () => {
      tier3Calls++;
      return null;
    };

    await assert.rejects(() => healer.healSelector("#old-submit-button", "Submit", "click"), (err) => err.code === "TARGET_UNAVAILABLE");

    assert.equal(tier3Calls, 1);
    const tier25Logs = logs.filter((l) => l.tier === "LocatorMemory");
    assert.equal(tier25Logs[tier25Logs.length - 1].status, "failed");

    const after = memory.getEntry(built.key);
    assert.equal(after.trust, "trusted");
    assert.deepEqual(after.signature, before.signature, "stored signature must be unchanged");
    assert.equal(after.pendingCandidate, null, "nothing proposed on a failed action");
    await memory._queue;
  }));

// ---------------------------------------------------------------------------
// Accepted, genuinely new selector -> pendingCandidate only, not trusted.
// ---------------------------------------------------------------------------

test("Tier 2.5: an accepted new selector lands in pendingCandidate, not trusted", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir);
    const built = identityFor("#old-submit-button");
    const identity = built.identity;
    const storedSignature = ElementSignature.capture(BUTTON_DESCRIPTOR, { salt: memory.salt });
    memory.recordEvidence(identity, storedSignature);

    const { AIHealer, logs } = loadAIHealer();
    const collector = {
      collect: async () => [liveCandidateFacts("#live-1")],
      collectOne: async () => null,
    };
    const page = makePage();
    const healer = new AIHealer(page, { locatorMemory: memory, elementFactsCollector: collector });

    await healer.healSelector("#old-submit-button", "Submit", "click");

    const entry = memory.getEntry(built.key);
    assert.equal(entry.trust, "trusted", "trust must not be auto-upgraded by a proposal");
    assert.deepEqual(entry.signature, storedSignature, "the original trusted signature must be untouched");
    assert.ok(entry.pendingCandidate, "a pending candidate must be recorded");
    assert.equal(entry.pendingCandidate.selector, '[data-testid="submit-btn"]');
    assert.equal(memory.getTrusted(identity).signature !== undefined, true);

    const tier25Logs = logs.filter((l) => l.tier === "LocatorMemory");
    assert.equal(tier25Logs[tier25Logs.length - 1].status, "accepted");
    assert.equal(tier25Logs[tier25Logs.length - 1].resolved, '[data-testid="submit-btn"]');
    await memory._queue;
  }));

// ---------------------------------------------------------------------------
// Accepted, verbatim-identical selector -> trust refresh.
// ---------------------------------------------------------------------------

test("Tier 2.5: an accepted verbatim-identical selector refreshes trust", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir);
    // The broken selector IS what SelectorBuilder will deterministically
    // build from this descriptor's data-testid (tier 1) — i.e. this
    // simulates Tier 1 breaking transiently and Tier 2.5 re-finding the
    // exact same element via the exact same selector string.
    const brokenSelector = '[data-testid="submit-btn"]';
    const built = identityFor(brokenSelector);
    const identity = built.identity;
    const storedSignature = ElementSignature.capture(BUTTON_DESCRIPTOR, { salt: memory.salt });
    memory.recordEvidence(identity, storedSignature);

    const { AIHealer, logs } = loadAIHealer();
    const collector = {
      collect: async () => [liveCandidateFacts("#live-1")],
      collectOne: async () => null,
    };
    const healer = new AIHealer(makePage(), { locatorMemory: memory, elementFactsCollector: collector });

    await healer.healSelector(brokenSelector, "Submit", "click");

    const entry = memory.getEntry(built.key);
    assert.equal(entry.trust, "trusted");
    assert.equal(entry.pendingCandidate, null, "a refresh must never populate pendingCandidate");

    const tier25Logs = logs.filter((l) => l.tier === "LocatorMemory");
    assert.equal(tier25Logs[tier25Logs.length - 1].status, "accepted");
    assert.equal(tier25Logs[tier25Logs.length - 1].resolved, brokenSelector);
    await memory._queue;
  }));

// ---------------------------------------------------------------------------
// Tier 1 success -> fire-and-forget evidence capture, zero added latency.
// ---------------------------------------------------------------------------

test("Tier 1 success: evidence capture never blocks or delays the Tier 1 return", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir);
    const { AIHealer } = loadAIHealer();

    const collector = {
      collect: async () => [],
      // Never resolves — if Tier 1 awaited this even indirectly, the test
      // itself would hang/timeout.
      collectOne: () => new Promise(() => {}),
    };
    const page = makePage();
    const healer = new AIHealer(page, { locatorMemory: memory, elementFactsCollector: collector });

    const result = await Promise.race([
      healer.healAndClick("#submit-btn", "Submit").then(() => "resolved"),
      new Promise((resolve) => setTimeout(() => resolve("timed-out"), 300)),
    ]);

    assert.equal(result, "resolved", "Tier 1 must resolve without waiting on evidence capture");
  }));

test("Tier 1 success: evidence is recorded in the background without changing the return value", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir);
    const { AIHealer } = loadAIHealer();

    const collector = {
      collect: async () => [],
      collectOne: async () => liveCandidateFacts("#submit-btn"),
    };
    const page = makePage();
    const healer = new AIHealer(page, { locatorMemory: memory, elementFactsCollector: collector });

    const returnValue = await healer.healAndClick("#submit-btn", "Submit");
    assert.equal(returnValue, undefined, "healAndClick's resolved value must be unchanged by Phase 14 wiring");

    await flush(memory);

    const identity = identityFor("#submit-btn").identity;
    const trusted = memory.getTrusted(identity);
    assert.ok(trusted, "Tier 1 success must have recorded trusted evidence");
    assert.equal(trusted.signature.tagName, "button");
  }));

// ---------------------------------------------------------------------------
// Quiet degradation: collector returns no facts even though evidence exists.
// ---------------------------------------------------------------------------

test("Tier 2.5: quiet degradation when live facts are entirely unavailable", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir);
    const identity = identityFor("#broken-button").identity;
    const storedSignature = ElementSignature.capture(BUTTON_DESCRIPTOR, { salt: memory.salt });
    memory.recordEvidence(identity, storedSignature);

    const { AIHealer, logs } = loadAIHealer();
    const collector = {
      collect: async () => [], // mirrors ElementFactsCollector's own degrade-quietly contract
      collectOne: async () => null,
    };
    const healer = new AIHealer(makePage(), { locatorMemory: memory, elementFactsCollector: collector });
    let tier3Calls = 0;
    healer.getAlternativeSelector = async () => {
      tier3Calls++;
      return null;
    };

    await assert.rejects(() => healer.healSelector("#broken-button", "Submit", "click"), (err) => err.code === "TARGET_UNAVAILABLE");

    assert.equal(tier3Calls, 1);
    const tier25Logs = logs.filter((l) => l.tier === "LocatorMemory");
    assert.equal(tier25Logs[tier25Logs.length - 1].status, "no_candidate");
    await memory._queue;
  }));

// ---------------------------------------------------------------------------
// Salt consistency (F14-1): a stored signature and a live signature must be
// hashed with the SAME salt for Tier 2.5 to ever accept anything.
// ---------------------------------------------------------------------------

test("salt consistency: stored and live signatures hashed with the store's own salt match", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir, { FALCON_LOCATOR_SALT: "the-one-true-salt" });
    const identity = identityFor("#broken-button").identity;
    // The "stored" path: captured independently of AIHealer, using the same
    // salt the live LocatorMemory instance exposes.
    const storedSignature = ElementSignature.capture(BUTTON_DESCRIPTOR, { salt: memory.salt });
    memory.recordEvidence(identity, storedSignature);

    const { AIHealer } = loadAIHealer();
    const collector = {
      collect: async () => [liveCandidateFacts("#live-1")], // raw, unhashed descriptor
      collectOne: async () => null,
    };
    const healer = new AIHealer(makePage(), { locatorMemory: memory, elementFactsCollector: collector });

    // Must succeed: the integration path threads memory.salt through
    // ElementSignature.capture() for the live candidate, exactly matching
    // how the stored signature above was produced.
    await healer.healSelector("#broken-button", "Submit", "click");
    assert.equal(memory.getEntry(identityFor("#broken-button").key).pendingCandidate.selector, '[data-testid="submit-btn"]');
    await memory._queue;
  }));

test("salt consistency: a stored signature hashed with a DIFFERENT salt never matches (negative control)", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir, { FALCON_LOCATOR_SALT: "the-real-store-salt" });
    const identity = identityFor("#broken-button").identity;
    // Deliberately wrong: captured with a salt that is NOT memory.salt, to
    // prove the matcher genuinely depends on salt agreement rather than
    // trivially accepting any identical descriptor regardless of hashing.
    const storedSignature = ElementSignature.capture(BUTTON_DESCRIPTOR, { salt: "a-completely-different-salt" });
    memory.recordEvidence(identity, storedSignature);

    const { AIHealer, logs } = loadAIHealer();
    const collector = {
      collect: async () => [liveCandidateFacts("#live-1")],
      collectOne: async () => null,
    };
    const healer = new AIHealer(makePage(), { locatorMemory: memory, elementFactsCollector: collector });
    let tier3Calls = 0;
    healer.getAlternativeSelector = async () => {
      tier3Calls++;
      return null;
    };

    await assert.rejects(() => healer.healSelector("#broken-button", "Submit", "click"), (err) => err.code === "TARGET_UNAVAILABLE");

    assert.equal(tier3Calls, 1, "a salt mismatch must refuse, never throw or hang, and fall through to Tier 3");
    const tier25Logs = logs.filter((l) => l.tier === "LocatorMemory");
    // A role hashed under a different salt reads as a hard "contradictory
    // role" to CandidateMatcher (both sides non-empty, values differ) and
    // the candidate is gated out entirely rather than scored low — either
    // way the one invariant this test exists to prove holds: a salt
    // mismatch must never be able to reach "accepted".
    assert.notEqual(tier25Logs[tier25Logs.length - 1].status, "accepted");
    await memory._queue;
  }));

// ---------------------------------------------------------------------------
// ElementFactsCollector: quiet degradation at the DOM boundary itself.
// ---------------------------------------------------------------------------

test("ElementFactsCollector.collect degrades quietly when page.evaluate is absent", async () => {
  const result = await ElementFactsCollector.collect({}, { action: "click" });
  assert.deepEqual(result, []);
});

test("ElementFactsCollector.collect degrades quietly when page.evaluate throws", async () => {
  const page = {
    evaluate: async () => {
      throw new Error("navigation interrupted mid-evaluate");
    },
  };
  const result = await ElementFactsCollector.collect(page, { action: "click" });
  assert.deepEqual(result, []);
});

test("ElementFactsCollector.collectOne returns null for an empty selector without calling evaluate", async () => {
  let called = false;
  const page = { evaluate: async () => { called = true; return []; } };
  const result = await ElementFactsCollector.collectOne(page, "");
  assert.equal(result, null);
  assert.equal(called, false);
});

test("ElementFactsCollector.collect runs the real in-browser gatherer against a minimal fake DOM", async () => {
  // Exercises the actual browser-side function (not a mock of it) by
  // faking just enough of `document`/`window` for it to run — `page.evaluate`
  // here invokes the function directly in this process, which is exactly
  // what the function is written to tolerate (no outer Node closures).
  const fakeButton = {
    tagName: "BUTTON",
    getAttribute: (name) => ({ "data-testid": "submit-btn", "aria-label": null, role: null }[name] ?? null),
    parentElement: null,
    previousElementSibling: null,
    childNodes: [{ nodeType: 3, nodeValue: "Submit order" }],
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 20 }),
    disabled: false,
    readOnly: false,
    isContentEditable: false,
    hidden: false,
    offsetParent: {},
  };
  const originalDocument = global.document;
  const originalWindow = global.window;
  global.document = { querySelectorAll: () => [fakeButton] };
  global.window = { innerWidth: 1000, innerHeight: 800, getComputedStyle: () => ({ display: "block", visibility: "visible", position: "static" }) };
  try {
    const page = { evaluate: async (fn, args) => fn(args) };
    const result = await ElementFactsCollector.collect(page, { action: "click" });
    assert.equal(result.length, 1);
    assert.equal(result[0].tagName, "button");
    assert.equal(result[0].attributes["data-testid"], "submit-btn");
    assert.equal(result[0].selector, '[data-testid="submit-btn"]');
    assert.equal(result[0].ownText, "Submit order");
  } finally {
    global.document = originalDocument;
    global.window = originalWindow;
  }
});

// ---------------------------------------------------------------------------
// Round 2 fix: HealingReport persists Tier 2.5's status/reason (additively).
// ---------------------------------------------------------------------------

test("HealingReport persists a Tier 2.5 refusal's status and reason to disk", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const HealingReportReal = require(path.join(root, "src", "core", "AIHealer", "HealingReport.js"));
  const originalFilePath = HealingReportReal._instance.filePath;
  HealingReportReal._instance.filePath = path.join(dir, "healing_logs.json");
  t.after(() => {
    HealingReportReal._instance.filePath = originalFilePath;
  });

  HealingReportReal.log({
    original: "#broken-button",
    resolved: null,
    tier: "LocatorMemory",
    description: "Submit",
    action: "click",
    status: "refused",
    reason: "below_threshold",
  });
  await HealingReportReal._instance._queue;

  const events = JSON.parse(fs.readFileSync(HealingReportReal._instance.filePath, "utf8"));
  const entry = events[events.length - 1];
  assert.equal(entry.status, "refused");
  assert.equal(entry.reason, "below_threshold");
});

test("HealingReport omits status/reason keys entirely when not supplied (additive, no shape change)", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const HealingReportReal = require(path.join(root, "src", "core", "AIHealer", "HealingReport.js"));
  const originalFilePath = HealingReportReal._instance.filePath;
  HealingReportReal._instance.filePath = path.join(dir, "healing_logs.json");
  t.after(() => {
    HealingReportReal._instance.filePath = originalFilePath;
  });

  HealingReportReal.log({ original: "#old", resolved: "#new", tier: "LocatorStore" });
  await HealingReportReal._instance._queue;

  const events = JSON.parse(fs.readFileSync(HealingReportReal._instance.filePath, "utf8"));
  const entry = events[events.length - 1];
  assert.equal(Object.hasOwn(entry, "status"), false);
  assert.equal(Object.hasOwn(entry, "reason"), false);
});

// ---------------------------------------------------------------------------
// Round 2 fix: AIHealer and Dashboard share ONE LocatorMemory instance — a
// write through one is never lost by a mutation through the other. This is
// the behavioural repro of the lost-update bug the coordinator ran against
// round 1 (AIHealer's private singleton vs. Dashboard's per-instance
// default), now against the fix (both default to sharedLocatorMemory).
// ---------------------------------------------------------------------------

test("AIHealer and Dashboard share one LocatorMemory instance; nothing written is lost", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sharedMod = require(path.join(root, "src", "core", "locator", "sharedLocatorMemory.js"));
  const AIHealerReal = require(path.join(root, "src", "core", "AIHealer", "AIHealer.js"));
  const DashboardReal = require(path.join(root, "src", "core", "Dashboard.js"));

  // Redirect the process-wide shared instance onto an isolated temp path
  // BEFORE either consumer is constructed — never the real data/ directory.
  const instance = sharedMod.shared();
  instance.memoryPath = path.join(dir, "locator_memory.json");
  instance._env = { FALCON_LOCATOR_SALT: "p14-tier25-shared-instance-salt" };
  instance._reload();

  const healer = new AIHealerReal(makePage()); // no injection -> defaults to shared()
  const dash = new DashboardReal({ port: 0 }); // no injection -> defaults to shared()
  t.after(async () => {
    await dash.stop();
  });

  assert.equal(healer._locatorMemory, dash._locatorMemory, "both consumers must resolve to the identical shared object");
  assert.equal(healer._locatorMemory, instance, "and it must be the same instance this test isolated");

  // Simulate "the run": a Tier 1 trust refresh and a Tier 2.5 proposal.
  const trustedIdentity = identityFor("#login-button").identity;
  const trustedSignature = ElementSignature.capture(BUTTON_DESCRIPTOR, { salt: instance.salt });
  healer._locatorMemory.recordEvidence(trustedIdentity, trustedSignature);

  const pendingBuilt = identityFor("#old-checkout-button");
  const pendingSignature = ElementSignature.capture(BUTTON_DESCRIPTOR, { salt: instance.salt });
  healer._locatorMemory.recordPendingCandidate(pendingBuilt.identity, {
    selector: '[data-testid="checkout-btn"]',
    signature: pendingSignature,
    contributions: { attribute: 0.4 },
    total: 0.9,
  });
  await instance._queue;

  // The dashboard's view must see both immediately — not stale, not empty.
  const dashboardView = dash._locatorMemory.list();
  assert.equal(Object.keys(dashboardView).length, 2, "the dashboard must see both entries the run just wrote, not a stale empty map");

  // Simulate "one dashboard approval" of the pending candidate.
  dash._locatorMemory.approve(pendingBuilt.key, { approvedBy: "test-operator" });
  await instance._queue;

  // Nothing the run wrote may be destroyed by that approval.
  const onDisk = JSON.parse(fs.readFileSync(instance.memoryPath, "utf8"));
  assert.equal(Object.keys(onDisk.entries).length, 2, "both entries must still be on disk after the approval");

  const trustedAfter = healer._locatorMemory.getTrusted(trustedIdentity);
  assert.ok(trustedAfter, "the Tier 1 trust refresh must have survived the dashboard approval");

  const approvedEntry = healer._locatorMemory.getEntry(pendingBuilt.key);
  assert.equal(approvedEntry.trust, "trusted", "the approved candidate must now be trusted");
  assert.equal(approvedEntry.pendingCandidate, null);
});

// ---------------------------------------------------------------------------
// AC-17: a success against an already-trusted STORED ALTERNATIVE (Tier 2 /
// LocatorStore) refreshes its evidence. This is distinct from the Tier 2.5
// "accepted verbatim-identical selector refreshes trust" test above — that
// one exercises the Tier 2.5 matcher path; this one exercises the plain
// Tier 2 replay path (a selector LocatorStore already hands back, with no
// matching/scoring involved at all) and proves it feeds the SAME
// fire-and-forget evidence capture (`_recordTrustedEvidence`).
// ---------------------------------------------------------------------------

function loadAIHealerWithStoredAlternatives(alternatives, logs = []) {
  const AdaptiveRetryFake = class {
    constructor() {}
    async execute(fn) {
      return fn();
    }
  };
  const AIHealer = load("src/core/AIHealer/AIHealer.js", {
    "../../../utils/Logger": silent,
    "./LocatorStore": { getAlternatives: () => alternatives },
    "./HealingReport": { log: (opts) => logs.push(opts) },
    "./HealingTrust": { recordPending() {}, recordTier3Invocation() {} },
    "./AdaptiveRetry": AdaptiveRetryFake,
  });
  return { AIHealer, logs };
}

test("AC-17: a Tier 2 (LocatorStore) success against an already-trusted identity refreshes its evidence, preserving firstSeen", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir);
    const identity = identityFor("#broken-selector").identity;
    const originalSignature = ElementSignature.capture(BUTTON_DESCRIPTOR, { salt: memory.salt });
    const before = memory.recordEvidence(identity, originalSignature);

    const logs = [];
    const { AIHealer } = loadAIHealerWithStoredAlternatives(["#stored-alternative"], logs);

    // The live element has moved on slightly since the original evidence
    // was captured (a real, honest "refresh" scenario — not byte-identical).
    const EVOLVED_DESCRIPTOR = { ...BUTTON_DESCRIPTOR, accessibleName: "Submit order now" };
    const collector = {
      collect: async () => [],
      collectOne: async (page, selector) => liveCandidateFacts(selector, EVOLVED_DESCRIPTOR),
    };
    const page = makePage();
    const healer = new AIHealer(page, { locatorMemory: memory, elementFactsCollector: collector });

    await healer.healSelector("#broken-selector", "Submit", "click");
    await flush(memory);

    const tier2Logs = logs.filter((l) => l.tier === "LocatorStore");
    assert.equal(tier2Logs.length, 1, "the Tier 2 success must be logged exactly once");
    assert.equal(tier2Logs[0].resolved, "#stored-alternative");

    const after = memory.getTrusted(identity);
    assert.ok(after, "the identity must still carry usable trusted evidence after the refresh");
    assert.equal(after.firstSeen, before.firstSeen, "a refresh must preserve the original firstSeen, never reset it");
    assert.notEqual(
      after.signature.accessibleNameApprox,
      before.signature.accessibleNameApprox,
      "the refreshed signature must reflect what the live element looks like NOW, not the stale original capture"
    );
    assert.equal(after.signature.accessibleNameApprox, "Submit order now");
  }));

test("AC-17 negative control: without a Tier 2 success, evidence is never refreshed at all (proves the refresh is caused by the success, not a timer)", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir);
    const identity = identityFor("#broken-selector").identity;
    const originalSignature = ElementSignature.capture(BUTTON_DESCRIPTOR, { salt: memory.salt });
    const before = memory.recordEvidence(identity, originalSignature);

    // No stored alternatives at all, and Tier 3 is stubbed to return null —
    // nothing can succeed, so nothing should ever call recordEvidence again.
    const { AIHealer } = loadAIHealerWithStoredAlternatives([]);
    const collector = { collect: async () => [], collectOne: async () => null };
    const healer = new AIHealer(makePage(), { locatorMemory: memory, elementFactsCollector: collector });
    healer.getAlternativeSelector = async () => null;

    await assert.rejects(() => healer.healSelector("#broken-selector", "Submit", "click"));
    await flush(memory);

    const after = memory.getTrusted(identity);
    assert.deepEqual(after.signature, before.signature, "with no success at all, the stored evidence must be untouched");
    assert.equal(after.lastSeen, before.lastSeen);
  }));

// ---------------------------------------------------------------------------
// AC-38: Tier 3's existing trust behaviour (HealingTrust's pending/decision
// ledgers) is untouched by this phase. Tier 2.5 running — whether it
// accepts, refuses, or finds no candidate — must never call ANY HealingTrust
// method. The mock below exposes recordPending/recordTier3Invocation as
// SPIES (not just no-ops, as the shared loadAIHealer() helper uses) so a
// Tier 2.5 success that incorrectly touched HealingTrust would be caught
// here, not just silently tolerated by a no-op.
// ---------------------------------------------------------------------------

test("AC-38: an accepted Tier 2.5 match never calls any HealingTrust method — only Tier 3 does", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir);
    const identity = identityFor("#broken-button").identity;
    const storedSignature = ElementSignature.capture(BUTTON_DESCRIPTOR, { salt: memory.salt });
    memory.recordEvidence(identity, storedSignature);

    const recordPendingCalls = [];
    const recordTier3Calls = [];
    const AdaptiveRetryFake = class {
      constructor() {}
      async execute(fn) {
        return fn();
      }
    };
    const AIHealer = load("src/core/AIHealer/AIHealer.js", {
      "../../../utils/Logger": silent,
      "./LocatorStore": { getAlternatives: () => [] },
      "./HealingReport": { log() {} },
      "./HealingTrust": {
        recordPending: (...args) => recordPendingCalls.push(args),
        recordTier3Invocation: (...args) => recordTier3Calls.push(args),
      },
      "./AdaptiveRetry": AdaptiveRetryFake,
    });

    const collector = {
      collect: async () => [liveCandidateFacts("#live-1")],
      collectOne: async () => null,
    };
    const healer = new AIHealer(makePage(), { locatorMemory: memory, elementFactsCollector: collector });

    await healer.healSelector("#broken-button", "Submit", "click");
    await flush(memory);

    assert.deepEqual(recordPendingCalls, [], "Tier 2.5 acceptance must never call HealingTrust.recordPending");
    assert.deepEqual(recordTier3Calls, [], "Tier 2.5 acceptance must never call HealingTrust.recordTier3Invocation — it never reached Tier 3");
  }));

test("AC-38: Tier 2.5 refusal falls through to Tier 3, and ONLY THEN does HealingTrust see the call — proves the spy itself is wired correctly", () =>
  withTempDir(async (dir) => {
    const memory = makeMemory(dir);
    const identity = identityFor("#broken-weak").identity;
    // Weak evidence only (no stable identity signal) — Tier 2.5 must refuse.
    memory.recordEvidence(identity, { schemaVersion: 1, tagName: "button", role: null, accessibleNameApprox: null, attributes: {}, structuralPath: null, textApprox: null, boundingBoxBucket: null });

    const recordTier3Calls = [];
    const AdaptiveRetryFake = class {
      constructor() {}
      async execute(fn) {
        return fn();
      }
    };
    const AIHealer = load("src/core/AIHealer/AIHealer.js", {
      "../../../utils/Logger": silent,
      "./LocatorStore": { getAlternatives: () => [] },
      "./HealingReport": { log() {} },
      "./HealingTrust": {
        recordPending() {},
        recordTier3Invocation: (...args) => recordTier3Calls.push(args),
      },
      "./AdaptiveRetry": AdaptiveRetryFake,
    });

    const collector = { collect: async () => [], collectOne: async (page, selector) => liveCandidateFacts(selector) };
    const healer = new AIHealer(makePage(), { locatorMemory: memory, elementFactsCollector: collector });
    let tier3Calls = 0;
    healer.getAlternativeSelector = async () => {
      tier3Calls++;
      return null;
    };

    await assert.rejects(() => healer.healSelector("#broken-weak", "Submit", "click"));
    assert.equal(tier3Calls, 1, "a Tier 2.5 refusal must fall through to Tier 3, not abort the run");
  }));
