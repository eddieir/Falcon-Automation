"use strict";

/**
 * P16 diversion (AC-26, AC-29, AC-30): state mutators record a journal event
 * instead of mutating canonical state when journal mode is on inside a page
 * task; human decisions are never diverted; VisualRegression refuses parallel.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, silent, temp, root } = require("./helpers.cjs");

const ParallelMode = require(path.join(root, "src", "core", "parallel", "ParallelMode.js"));
const Schemas = require(path.join(root, "src", "core", "parallel", "Schemas.js"));
const LocatorIdentity = require(path.join(root, "src", "core", "locator", "LocatorIdentity.js"));
const ElementSignature = require(path.join(root, "src", "core", "locator", "ElementSignature.js"));

const L = { "../../utils/Logger": silent, "../../../utils/Logger": silent };
const settle = () => new Promise((r) => setTimeout(r, 60));

/** Journal double that enforces the real payload schema, like StateJournal.record. */
function fakeJournal() {
  const events = [];
  return {
    events,
    record(type, scn, rep, payload) {
      const v = Schemas.validateEventPayload(type, payload);
      if (!v.ok) throw new Error("payload invalid: " + v.code + " " + v.path);
      events.push({ type, p: JSON.parse(JSON.stringify(payload)) });
    },
  };
}

function snapshot(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir).sort()) out[f] = fs.readFileSync(path.join(dir, f), "utf8");
  return out;
}

async function inTask(fn) {
  const j = fakeJournal();
  ParallelMode.setActive(true);
  try {
    await ParallelMode.runWithJournal(j, fn);
  } finally {
    ParallelMode.setActive(false);
  }
  return j.events;
}

test.afterEach(() => ParallelMode.setActive(false));

function flakiness(dir) {
  const t = load("src/core/FlakinessTracker.js", L);
  t.historyPath = path.join(dir, "history.json");
  t.decisionsPath = path.join(dir, "decisions.json");
  t._reload();
  return t;
}
const outcome = { url: "https://example.com/a", action: "click", locator: "#go", description: "d", status: "failed", duration: 12.4, errorType: "timeout" };

test("FlakinessTracker.record: mode off writes; diverted records one event and leaves state and files", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tr = flakiness(dir);
  tr.record(outcome);
  await settle();
  assert.ok(fs.existsSync(tr.historyPath), "mode off persists as before");

  const before = snapshot(dir);
  const stateBefore = JSON.stringify(tr.history ?? tr._history ?? null);
  const events = await inTask(async () => { tr.record({ ...outcome, locator: "#other" }); });
  await settle();
  assert.deepEqual(events, [{ type: "flakiness.outcome", p: { action: "click", locator: "#other", status: "failed", outcome: null, errorType: "timeout", durationMs: 12, description: "d" } }]);
  assert.deepEqual(snapshot(dir), before);
  assert.equal(JSON.stringify(tr.history ?? tr._history ?? null), stateBefore);

  // outside a task, mode on: behaves as today
  ParallelMode.setActive(true);
  tr.record({ ...outcome, locator: "#third" });
  await settle();
  assert.notDeepEqual(snapshot(dir), before);
});

test("FlakinessTracker diversion surfaces bad payloads (negative path) and quarantine is never diverted", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tr = flakiness(dir);
  await assert.rejects(inTask(async () => { tr.record({ ...outcome, action: "hover" }); }), /payload invalid/);
  const events = await inTask(async () => { tr.quarantine("nope"); tr.unquarantine("nope"); });
  assert.deepEqual(events, []);
});

function healingTrust(dir) {
  const h = load("src/core/AIHealer/HealingTrust.js", { ...L, "./LocatorStore": { addAlternative() {}, add() {} } });
  h.pendingPath = path.join(dir, "pending.json");
  h.decisionsPath = path.join(dir, "decisions.json");
  h.pending = {};
  h._decisions = [];
  return h;
}

test("HealingTrust.recordPending / recordTier3Invocation divert; approve/reject never do", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = healingTrust(dir);
  h.recordPending({ original: "#a", suggested: "#b", description: "x" });
  await settle();
  assert.ok(fs.existsSync(h.pendingPath), "mode off persists");

  const before = snapshot(dir);
  const pendingBefore = JSON.stringify(h.pending);
  const events = await inTask(async () => {
    h.recordPending({ original: "#c", suggested: "#d", description: "y" });
    h.recordTier3Invocation("#a");
  });
  await settle();
  assert.deepEqual(events, [
    { type: "healing.pending", p: { original: "#c", suggested: "#d", description: "y" } },
    { type: "healing.tier3", p: { original: "#a" } },
  ]);
  assert.equal(JSON.stringify(h.pending), pendingBefore);
  assert.deepEqual(snapshot(dir), before);

  const decisionEvents = await inTask(async () => {
    try { h.approve("#a", { suggested: "#b" }); } catch { /* outcome irrelevant */ }
    try { h.reject("#a"); } catch { /* outcome irrelevant */ }
  });
  assert.deepEqual(decisionEvents, []);
});

test("LocatorStore.getAlternatives diverts the lastUsed touch but still serves the snapshot", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = load("src/core/AIHealer/LocatorStore.js", L);
  s.storePath = path.join(dir, "store.json");
  s.data = { "#a": { alternatives: ["#b", "#c"], lastUsed: 1 } };
  assert.deepEqual(s.getAlternatives("#a"), ["#b", "#c"]);
  await settle();
  assert.ok(fs.existsSync(s.storePath), "mode off persists the touch");
  s.data["#a"].lastUsed = 1;

  const before = snapshot(dir);
  let got;
  const events = await inTask(async () => { got = s.getAlternatives("#a"); });
  await settle();
  assert.deepEqual(got, ["#b", "#c"]);
  assert.deepEqual(events, [{ type: "locatorStore.use", p: { original: "#a" } }]);
  assert.equal(s.data["#a"].lastUsed, 1);
  assert.deepEqual(snapshot(dir), before);

  const none = await inTask(async () => { assert.deepEqual(s.getAlternatives("#missing"), []); });
  assert.deepEqual(none, [], "unknown selectors record nothing");
});

test("HealingReport.log diverts with the exact payload and writes no file", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const HealingReport = load("src/core/AIHealer/HealingReport.js", { ...L, "../Middleware": { emit() {}, on() {} } });
  const rep = HealingReport._instance;
  rep.filePath = path.join(dir, "sub", "healing_logs.json");
  HealingReport.log({ original: "#a", resolved: "#b", tier: "LLM", description: "d" });
  await rep._queue; await settle();
  assert.equal(rep.logs.length, 1);
  assert.ok(fs.existsSync(rep.filePath), "mode off writes");
  fs.rmSync(path.join(dir, "sub"), { recursive: true });

  const events = await inTask(async () => {
    HealingReport.log({ original: "#x", resolved: null, tier: "exhausted", description: "e", error: "boom", trust: "pending", action: "click", status: "failed", reason: "r" });
  });
  await rep._queue; await settle();
  assert.deepEqual(events, [{ type: "healing.log", p: { original: "#x", resolved: null, tier: "exhausted", description: "e", error: "boom", trust: "pending", action: "click", status: "failed", reason: "r" } }]);
  assert.equal(rep.logs.length, 1);
  assert.equal(fs.existsSync(path.join(dir, "sub")), false);
});

const SALT = "p16-diversion-salt";
function identityFor(sel) {
  const b = LocatorIdentity.buildIdentity({ url: "https://example.com/c", action: "click", originalSelector: sel, env: {} });
  return b.identity;
}
function sigFor(label) {
  return ElementSignature.capture({ tagName: "button", role: "button", accessibleName: label, attributes: { id: label }, structuralPath: ["form", "div", "button"], ownText: label, boundingBoxBucket: "bottom-right:small" }, { salt: SALT });
}

test("LocatorMemory evidence/candidate divert and leave entries and file unchanged", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = load("src/core/locator/LocatorMemory.js", L);
  const m = new LocatorMemory({ memoryPath: path.join(dir, "mem.json"), env: {} });
  const id = identityFor("#checkout");
  m.recordEvidence(id, sigFor("Checkout"));
  await settle();
  const before = snapshot(dir);
  const entriesBefore = JSON.stringify([...m.entries]);

  const cand = { selector: "#new", signature: sigFor("Now"), contributions: { attribute: 0.4, accessibleName: 0.2 }, total: 0.6 };
  const id2 = identityFor("#other");
  const events = await inTask(async () => {
    m.recordEvidence(id2, sigFor("Other"));
    m.recordPendingCandidate(id, cand);
  });
  await settle();
  assert.deepEqual(events.map((e) => e.type), ["locatorMemory.evidence", "locatorMemory.candidate"]);
  assert.deepEqual(Object.keys(events[0].p).sort(), ["identity", "signature"]);
  assert.deepEqual(Object.keys(events[1].p).sort(), ["baseRevision", "candidate", "identity"]);
  assert.match(events[1].p.baseRevision, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify([...m.entries]), entriesBefore);
  assert.deepEqual(snapshot(dir), before);

  const none = await inTask(async () => { m.recordPendingCandidate(identityFor("#fresh"), cand); });
  assert.equal(none[0].p.baseRevision, null);

  // outside a task with mode on: today's behaviour
  ParallelMode.setActive(true);
  m.recordPendingCandidate(id, cand);
  assert.ok(m.entries.get(LocatorIdentity.serialiseIdentity(id)).pendingCandidate);
});

test("LocatorMemory decisions are never diverted", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = load("src/core/locator/LocatorMemory.js", L);
  const m = new LocatorMemory({ memoryPath: path.join(dir, "mem.json"), env: {} });
  const events = await inTask(async () => {
    for (const fn of ["approve", "reject", "rollback", "revoke"]) {
      if (typeof m[fn] === "function") { try { await m[fn](identityFor("#z"), "x", "y"); } catch { /* outcome irrelevant */ } }
    }
  });
  assert.deepEqual(events, []);
});

test("VisualRegression constructor throws VISUAL_REGRESSION_UNSUPPORTED_PARALLEL and creates nothing", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const VR = load("src/core/VisualRegression.js", L);
  new VR({}); // mode off: constructs
  const cwdFiles = () => fs.readdirSync(dir).length;
  ParallelMode.setActive(true);
  assert.throws(() => new VR({}), (e) => e.code === "VISUAL_REGRESSION_UNSUPPORTED_PARALLEL");
  assert.equal(cwdFiles(), 0);
  assert.throws(() => new VR({}, { threshold: 5 }), (e) => e.code === "VISUAL_REGRESSION_UNSUPPORTED_PARALLEL");
});
