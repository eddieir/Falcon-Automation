const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, temp } = require("./helpers.cjs");

function trackerAt(t) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const emitted = [];
  const warnings = [];
  const Tracker = load("src/core/FlakinessTracker.js", {
    "./Middleware": { emit: (...args) => emitted.push(args) },
    "../../utils/Logger": { info() {}, error() {}, async flush() {}, warning: (m) => warnings.push(m) },
  });
  Tracker.historyPath = path.join(dir, "scenario_history.json");
  Tracker.decisionsPath = path.join(dir, "quarantine_decisions.json");
  Tracker._reload();
  return { tracker: Tracker, emitted, warnings };
}

function fixture(overrides = {}) {
  return { url: "https://example.com", action: "click", locator: "#save", description: "Save", ...overrides };
}

// ── classify(): pure function, no I/O ──

test("classify: fewer than 3 samples is 'new' regardless of outcome mix", () => {
  const Tracker = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  assert.equal(Tracker.classify([]).classification, "new");
  assert.equal(Tracker.classify([{ status: "passed" }]).classification, "new");
  assert.equal(Tracker.classify([{ status: "passed" }, { status: "failed" }]).classification, "new");
});
test("classify: exactly 3 samples, all passed, is 'stable'", () => {
  const Tracker = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  const result = Tracker.classify([{ status: "passed" }, { status: "passed" }, { status: "passed" }]);
  assert.equal(result.classification, "stable");
  assert.equal(result.flakeRate, 0);
  assert.equal(result.sampleSize, 3);
});
test("classify: exactly 3 samples, all failed, is 'broken' with flakeRate 1", () => {
  const Tracker = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  const result = Tracker.classify([{ status: "failed" }, { status: "failed" }, { status: "failed" }]);
  assert.equal(result.classification, "broken");
  assert.equal(result.flakeRate, 1);
});
test("classify: a mix of pass and fail is 'flaky' with the correct rate", () => {
  const Tracker = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  const result = Tracker.classify([
    { status: "passed" }, { status: "failed" }, { status: "passed" }, { status: "failed" },
  ]);
  assert.equal(result.classification, "flaky");
  assert.equal(result.flakeRate, 0.5);
  assert.equal(result.sampleSize, 4);
});
test("classify: only looks at the most recent WINDOW_SIZE (10) results", () => {
  const Tracker = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  // 5 failures, then 10 passes — if the window were unbounded this would
  // still read as flaky; bounded to the last 10, it must read as stable.
  const history = [
    ...Array.from({ length: 5 }, () => ({ status: "failed" })),
    ...Array.from({ length: 10 }, () => ({ status: "passed" })),
  ];
  assert.equal(Tracker.classify(history).classification, "stable");
});
test("classify: null/undefined history is treated as empty, not a crash", () => {
  const Tracker = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  assert.equal(Tracker.classify(undefined).classification, "new");
  assert.equal(Tracker.classify(null).classification, "new");
});
test("classify: statuses other than passed/failed in history don't count toward sampleSize", () => {
  const Tracker = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  const result = Tracker.classify([{ status: "quarantined" }, { status: "quarantined" }, { status: "quarantined" }]);
  assert.equal(result.classification, "new");
  assert.equal(result.sampleSize, 0);
});

// ── record() ──

test("record: creates a new entry on first sighting, classified 'new'", (t) => {
  const { tracker } = trackerAt(t);
  const entry = tracker.record({ ...fixture(), status: "passed", duration: 42 });
  assert.equal(entry.classification, "new");
  assert.equal(entry.history.length, 1);
  assert.equal(entry.history[0].status, "passed");
  assert.equal(entry.history[0].duration, 42);
  assert.equal(entry.key, "https://example.com::click::#save");
});
test("record: ignores statuses other than passed/failed and returns null", (t) => {
  const { tracker } = trackerAt(t);
  assert.equal(tracker.record({ ...fixture(), status: "skipped" }), null);
  assert.equal(tracker.record({ ...fixture(), status: "quarantined" }), null);
  assert.equal(tracker.list().length, 0);
});
test("record: stores errorType alongside a failed outcome", (t) => {
  const { tracker } = trackerAt(t);
  const entry = tracker.record({ ...fixture(), status: "failed", errorType: "TIMEOUT" });
  assert.equal(entry.history[0].errorType, "TIMEOUT");
});
test("record: accumulates history across calls for the same key", (t) => {
  const { tracker } = trackerAt(t);
  tracker.record({ ...fixture(), status: "passed" });
  tracker.record({ ...fixture(), status: "failed" });
  const entry = tracker.record({ ...fixture(), status: "passed" });
  assert.equal(entry.history.length, 3);
  assert.deepEqual(entry.history.map((h) => h.status), ["passed", "failed", "passed"]);
});
test("record: history is capped at MAX_HISTORY_PER_SCENARIO (20), oldest dropped first", (t) => {
  const { tracker } = trackerAt(t);
  for (let i = 0; i < 25; i++) tracker.record({ ...fixture(), status: i % 2 === 0 ? "passed" : "failed" });
  const entry = tracker.list()[0];
  assert.equal(entry.history.length, 20);
});
test("record: different action/locator/url produce independent scenario keys", (t) => {
  const { tracker } = trackerAt(t);
  tracker.record({ ...fixture(), locator: "#a", status: "passed" });
  tracker.record({ ...fixture(), locator: "#b", status: "failed" });
  tracker.record({ ...fixture(), action: "type", status: "passed" });
  tracker.record({ url: "https://other.com", action: "click", locator: "#save", status: "failed" });
  assert.equal(tracker.list().length, 4);
});
test("record: description updates to the latest, falling back to the previous one when omitted", (t) => {
  const { tracker } = trackerAt(t);
  tracker.record({ ...fixture(), description: "Original", status: "passed" });
  const entry = tracker.record({ ...fixture(), description: "", status: "passed" });
  assert.equal(entry.description, "Original");
  const renamed = tracker.record({ ...fixture(), description: "Renamed", status: "passed" });
  assert.equal(renamed.description, "Renamed");
});
test("record: emits 'flakyDetected' only on the transition into flaky, not on every subsequent flaky record", (t) => {
  const { tracker, emitted } = trackerAt(t);
  tracker.record({ ...fixture(), status: "passed" });
  tracker.record({ ...fixture(), status: "failed" });
  tracker.record({ ...fixture(), status: "passed" }); // -> flaky, 3rd sample
  tracker.record({ ...fixture(), status: "failed" }); // still flaky
  tracker.record({ ...fixture(), status: "passed" }); // still flaky
  const flakyEmits = emitted.filter(([name]) => name === "flakyDetected");
  assert.equal(flakyEmits.length, 1);
});
test("record: re-emits 'flakyDetected' if a scenario goes stable then flaky again", (t) => {
  const { tracker, emitted } = trackerAt(t);
  tracker.record({ ...fixture(), status: "passed" });
  tracker.record({ ...fixture(), status: "passed" });
  tracker.record({ ...fixture(), status: "passed" }); // stable
  tracker.record({ ...fixture(), status: "failed" }); // -> flaky (transition 1)
  for (let i = 0; i < 10; i++) tracker.record({ ...fixture(), status: "passed" }); // window fills with passes -> stable again
  tracker.record({ ...fixture(), status: "failed" }); // -> flaky (transition 2)
  const flakyEmits = emitted.filter(([name]) => name === "flakyDetected");
  assert.equal(flakyEmits.length, 2);
});
test("record: never emits 'flakyDetected' for a consistently broken or consistently stable scenario", (t) => {
  const { tracker, emitted } = trackerAt(t);
  for (let i = 0; i < 6; i++) tracker.record({ ...fixture(), locator: "#stable", status: "passed" });
  for (let i = 0; i < 6; i++) tracker.record({ ...fixture(), locator: "#broken", status: "failed" });
  assert.equal(emitted.filter(([name]) => name === "flakyDetected").length, 0);
});
test("record: bounds total tracked scenarios at MAX_TRACKED_SCENARIOS (500), evicting the least recently used", (t) => {
  const { tracker } = trackerAt(t);
  for (let i = 0; i < 500; i++) {
    const entry = tracker.record({ ...fixture(), locator: `#s${i}`, status: "passed" });
    entry.lastUsed = i; // deterministic ordering for the eviction check below
    tracker._setScenario(entry.key, entry);
  }
  tracker.record({ ...fixture(), locator: "#new-scenario", status: "passed" });
  assert.equal(Object.keys(tracker.scenarios).length, 500);
  assert.equal(tracker._hasScenario("https://example.com::click::#s0"), false);
  assert.equal(tracker._hasScenario("https://example.com::click::#new-scenario"), true);
});

// ── record(): "unavailable" status (AC-06) ──

test("record: 'unavailable' is stored as a failure-equivalent sample, not dropped, carrying outcome:'unavailable'", (t) => {
  const { tracker } = trackerAt(t);
  const entry = tracker.record({ ...fixture(), status: "unavailable" });
  assert.notEqual(entry, null);
  assert.equal(entry.history.length, 1);
  assert.equal(entry.history[0].status, "failed");
  assert.equal(entry.history[0].outcome, "unavailable");
});
test("record: an explicit outcome is threaded onto the entry next to errorType for a plain 'failed' call", (t) => {
  const { tracker } = trackerAt(t);
  const entry = tracker.record({ ...fixture(), status: "failed", errorType: "TIMEOUT", outcome: "custom" });
  assert.equal(entry.history[0].status, "failed");
  assert.equal(entry.history[0].errorType, "TIMEOUT");
  assert.equal(entry.history[0].outcome, "custom");
});
test("record: a plain 'passed'/'failed' call without outcome stores outcome:null", (t) => {
  const { tracker } = trackerAt(t);
  const entry = tracker.record({ ...fixture(), status: "passed" });
  assert.equal(entry.history[0].outcome, null);
});
test("classify: an alternating passed/unavailable history of >=3 samples classifies flaky with the correct flake rate", (t) => {
  const { tracker } = trackerAt(t);
  tracker.record({ ...fixture(), status: "passed" });
  tracker.record({ ...fixture(), status: "unavailable" });
  const entry = tracker.record({ ...fixture(), status: "passed" });
  assert.equal(entry.classification, "flaky");
  assert.equal(entry.flakeRate, 1 / 3);
  assert.equal(entry.sampleSize, 3);
});
test("quarantineEligibility: an all-unavailable history with zero genuine passes is still refused, exactly like all-failed", (t) => {
  const { tracker } = trackerAt(t);
  for (let i = 0; i < 3; i++) tracker.record({ ...fixture(), status: "unavailable" });
  const result = tracker.quarantineEligibility("https://example.com::click::#save");
  assert.equal(result.eligible, false);
  assert.match(result.reason, /never passed/);
});
test("quarantineEligibility: an all-unavailable history with one earlier genuine pass is eligible", (t) => {
  const { tracker } = trackerAt(t);
  tracker.record({ ...fixture(), status: "passed" });
  for (let i = 0; i < 3; i++) tracker.record({ ...fixture(), status: "unavailable" });
  const result = tracker.quarantineEligibility("https://example.com::click::#save");
  assert.equal(result.eligible, true);
});

// ── isQuarantined() / quarantine() / unquarantine() ──

test("isQuarantined: false for an untracked key, false before quarantining, true after", (t) => {
  const { tracker } = trackerAt(t);
  const key = "https://example.com::click::#save";
  assert.equal(tracker.isQuarantined(key), false);
  tracker.record({ ...fixture(), status: "passed" });
  assert.equal(tracker.isQuarantined(key), false);
  tracker.quarantine(key);
  assert.equal(tracker.isQuarantined(key), true);
});
test("quarantine: attributes the decision, updates the entry, and records the ledger", async (t) => {
  const { tracker, emitted } = trackerAt(t);
  const key = "https://example.com::click::#save";
  tracker.record({ ...fixture(), status: "passed" });
  const entry = tracker.quarantine(key, { by: "peyman" });
  await tracker._queue;
  assert.equal(entry.quarantined, true);
  assert.equal(entry.quarantinedBy, "peyman");
  assert.ok(entry.quarantinedAt);
  assert.equal(tracker.decisions.length, 1);
  assert.equal(tracker.decisions[0].action, "quarantine");
  assert.ok(emitted.some(([name]) => name === "scenarioQuarantined"));
});
test("quarantine: defaults 'by' to \"dashboard\" when not specified", (t) => {
  const { tracker } = trackerAt(t);
  tracker.record({ ...fixture(), status: "passed" });
  const entry = tracker.quarantine("https://example.com::click::#save");
  assert.equal(entry.quarantinedBy, "dashboard");
});
test("quarantine: a no-op returning null for an untracked scenario key", (t) => {
  const { tracker } = trackerAt(t);
  assert.equal(tracker.quarantine("https://never.example.com::click::#nope"), null);
});
test("quarantine: quarantining an already-quarantined scenario is idempotent, not an error", (t) => {
  const { tracker } = trackerAt(t);
  const key = "https://example.com::click::#save";
  tracker.record({ ...fixture(), status: "passed" });
  const first = tracker.quarantine(key);
  const second = tracker.quarantine(key);
  assert.equal(first.quarantined, true);
  assert.equal(second.quarantined, true);
});
test("quarantine: the same decision twice writes one ledger row, not two", async (t) => {
  const { tracker } = trackerAt(t);
  const key = "https://example.com::click::#save";
  tracker.record({ ...fixture(), status: "passed" });
  tracker.quarantine(key, { by: "peyman" });
  tracker.quarantine(key, { by: "someone-else" });
  await tracker._queue;
  assert.equal(tracker.decisions.length, 1);
  assert.equal(tracker.decisions[0].by, "peyman");
});

// ── quarantineEligibility(): the guard that keeps a regression loud ──

test("quarantineEligibility: an untracked key is neither tracked nor eligible", (t) => {
  const { tracker } = trackerAt(t);
  const result = tracker.quarantineEligibility("https://never.example.com::click::#nope");
  assert.equal(result.tracked, false);
  assert.equal(result.eligible, false);
  assert.match(result.reason, /No tracked scenario/);
});
test("quarantineEligibility: a scenario with at least one pass is eligible", (t) => {
  const { tracker } = trackerAt(t);
  tracker.record({ ...fixture(), status: "failed" });
  tracker.record({ ...fixture(), status: "passed" });
  tracker.record({ ...fixture(), status: "failed" });
  const result = tracker.quarantineEligibility("https://example.com::click::#save");
  assert.equal(result.eligible, true);
  assert.equal(result.reason, null);
});
test("quarantineEligibility: a 'broken' scenario that has never passed is refused", (t) => {
  const { tracker } = trackerAt(t);
  for (let i = 0; i < 3; i++) tracker.record({ ...fixture(), status: "failed" });
  assert.equal(tracker.list()[0].classification, "broken");
  const result = tracker.quarantineEligibility("https://example.com::click::#save");
  assert.equal(result.tracked, true);
  assert.equal(result.eligible, false);
  assert.match(result.reason, /never passed/);
});
test("quarantineEligibility: an all-failing scenario still classified 'new' is refused too", (t) => {
  // Two failures is under the 3-sample verdict threshold, so it reads as
  // "new" — but hiding it would silence a red run just as effectively.
  const { tracker } = trackerAt(t);
  for (let i = 0; i < 2; i++) tracker.record({ ...fixture(), status: "failed" });
  assert.equal(tracker.list()[0].classification, "new");
  assert.equal(tracker.quarantineEligibility("https://example.com::click::#save").eligible, false);
});
test("quarantine: refuses a never-passed scenario, throws QUARANTINE_REFUSED, and changes nothing", async (t) => {
  const { tracker, emitted } = trackerAt(t);
  const key = "https://example.com::click::#save";
  for (let i = 0; i < 3; i++) tracker.record({ ...fixture(), status: "failed" });

  assert.throws(() => tracker.quarantine(key, { by: "peyman" }), (error) => {
    assert.equal(error.code, "QUARANTINE_REFUSED");
    assert.equal(error.entry.key, key);
    return true;
  });

  await tracker._queue;
  assert.equal(tracker.isQuarantined(key), false);
  assert.equal(tracker.decisions.length, 0);
  assert.equal(emitted.filter(([name]) => name === "scenarioQuarantined").length, 0);
});
test("quarantine: a refused scenario becomes quarantinable as soon as it genuinely passes once", (t) => {
  const { tracker } = trackerAt(t);
  const key = "https://example.com::click::#save";
  for (let i = 0; i < 3; i++) tracker.record({ ...fixture(), status: "failed" });
  assert.throws(() => tracker.quarantine(key), (error) => error.code === "QUARANTINE_REFUSED");

  tracker.record({ ...fixture(), status: "passed" });
  assert.equal(tracker.quarantine(key).quarantined, true);
});
test("unquarantine: reverses quarantine and records a separate ledger entry", async (t) => {
  const { tracker } = trackerAt(t);
  const key = "https://example.com::click::#save";
  tracker.record({ ...fixture(), status: "passed" });
  tracker.quarantine(key, { by: "peyman" });
  const entry = tracker.unquarantine(key, { by: "reviewer" });
  await tracker._queue;
  assert.equal(entry.quarantined, false);
  assert.equal(entry.quarantinedAt, null);
  assert.equal(entry.quarantinedBy, null);
  assert.equal(tracker.decisions.length, 2);
  assert.equal(tracker.decisions[1].action, "unquarantine");
  assert.equal(tracker.decisions[1].by, "reviewer");
});
test("unquarantine: a no-op returning null when the scenario isn't currently quarantined", (t) => {
  const { tracker } = trackerAt(t);
  tracker.record({ ...fixture(), status: "passed" });
  assert.equal(tracker.unquarantine("https://example.com::click::#save"), null);
});
test("unquarantine: a no-op returning null for an untracked scenario key", (t) => {
  const { tracker } = trackerAt(t);
  assert.equal(tracker.unquarantine("https://never.example.com::click::#nope"), null);
});
test("quarantining a scenario doesn't change its classification — it changes how a failure is reported, not the data", (t) => {
  const { tracker } = trackerAt(t);
  const key = "https://example.com::click::#save";
  tracker.record({ ...fixture(), status: "passed" });
  tracker.record({ ...fixture(), status: "failed" });
  tracker.record({ ...fixture(), status: "passed" });
  const before = tracker.list()[0].classification;
  tracker.quarantine(key);
  const after = tracker.list()[0].classification;
  assert.equal(before, after);
});

// ── list() ──

test("list: filters by classification", (t) => {
  const { tracker } = trackerAt(t);
  for (let i = 0; i < 3; i++) tracker.record({ ...fixture(), locator: "#stable", status: "passed" });
  for (let i = 0; i < 3; i++) tracker.record({ ...fixture(), locator: "#broken", status: "failed" });
  tracker.record({ ...fixture(), locator: "#new-one", status: "passed" });
  assert.equal(tracker.list({ classification: "stable" }).length, 1);
  assert.equal(tracker.list({ classification: "broken" }).length, 1);
  assert.equal(tracker.list({ classification: "new" }).length, 1);
  assert.equal(tracker.list().length, 3);
});

// ── keyFor() ──

test("keyFor: identical inputs produce identical keys; any differing field changes the key", () => {
  const Tracker = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  const base = { url: "https://a.com", action: "click", locator: "#x" };
  assert.equal(Tracker.keyFor(base), Tracker.keyFor({ ...base }));
  assert.notEqual(Tracker.keyFor(base), Tracker.keyFor({ ...base, url: "https://b.com" }));
  assert.notEqual(Tracker.keyFor(base), Tracker.keyFor({ ...base, action: "type" }));
  assert.notEqual(Tracker.keyFor(base), Tracker.keyFor({ ...base, locator: "#y" }));
});

// ── Corner cases: prototype-pollution-safe keys, corrupt/malformed storage, write failures, concurrency ──

test("scenarios whose url/locator collide with Object.prototype keys are tracked safely, not silently dropped", async (t) => {
  const { tracker } = trackerAt(t);
  for (const locator of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    tracker.record({ url: "https://example.com", action: "click", locator, status: "passed" });
  }
  assert.equal(tracker.list().length, 5);
  const key = "https://example.com::click::__proto__";
  const entry = tracker.quarantine(key);
  await tracker._queue;
  assert.equal(entry.quarantined, true);
  assert.equal(Object.getPrototypeOf(tracker.scenarios), Object.prototype);
  assert.equal(tracker.list().length, 5);
});
test("AC-11: __proto__/constructor/toString keys stay safe through eviction and a save->corrupt->reload cycle", async (t) => {
  const { tracker } = trackerAt(t);
  for (const locator of ["__proto__", "constructor", "toString"]) {
    tracker.record({ url: "https://example.com", action: "click", locator, status: "passed" });
  }
  const protoKey = "https://example.com::click::__proto__";
  tracker.quarantine(protoKey); // protect it, then flood past the cap
  for (let i = 0; i < 600; i++) {
    const entry = tracker.record({ ...fixture(), locator: `#flood${i}`, status: "passed" });
    entry.lastUsed = i;
    tracker._setScenario(entry.key, entry);
  }
  await tracker._queue;
  assert.equal(tracker._hasScenario(protoKey), true);
  assert.equal(Object.getPrototypeOf(tracker.scenarios), Object.prototype);

  const reloaded = load("src/core/FlakinessTracker.js", {
    "./Middleware": { emit() {} },
    "../../utils/Logger": { info() {}, warning() {}, error() {}, async flush() {} },
  });
  reloaded.historyPath = tracker.historyPath;
  reloaded.decisionsPath = tracker.decisionsPath;
  reloaded._reload();
  assert.equal(reloaded._hasScenario(protoKey), true);
  assert.equal(reloaded.isQuarantined(protoKey), true);
  assert.equal(Object.getPrototypeOf(reloaded.scenarios), Object.prototype);
});
test("recovers from corrupt JSON in scenario_history.json / quarantine_decisions.json", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Tracker = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  Tracker.historyPath = path.join(dir, "history.json");
  Tracker.decisionsPath = path.join(dir, "decisions.json");
  fs.writeFileSync(Tracker.historyPath, "{not json");
  fs.writeFileSync(Tracker.decisionsPath, "[not json");
  Tracker._reload();
  assert.deepEqual(Tracker.list(), []);
  assert.deepEqual(Tracker.decisions, []);
});
test("recovers when the files hold the wrong JSON shape (array where an object is expected, and vice versa)", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Tracker = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  Tracker.historyPath = path.join(dir, "history.json");
  Tracker.decisionsPath = path.join(dir, "decisions.json");
  fs.writeFileSync(Tracker.historyPath, JSON.stringify([1, 2, 3]));
  fs.writeFileSync(Tracker.decisionsPath, JSON.stringify({ not: "an array" }));
  Tracker._reload();
  assert.deepEqual(Tracker.list(), []);
  assert.deepEqual(Tracker.decisions, []);
  assert.doesNotThrow(() => Tracker.record({ ...fixture(), status: "passed" }));
});
test("survives null and non-object JSON at the top level", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Tracker = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  Tracker.historyPath = path.join(dir, "history.json");
  Tracker.decisionsPath = path.join(dir, "decisions.json");
  fs.writeFileSync(Tracker.historyPath, "null");
  fs.writeFileSync(Tracker.decisionsPath, "42");
  Tracker._reload();
  assert.deepEqual(Tracker.list(), []);
  assert.deepEqual(Tracker.decisions, []);
});
test("tolerates write errors without losing in-memory state", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Tracker = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  fs.mkdirSync(path.join(dir, "history.json")); // a directory, not a file — every write attempt fails
  Tracker.historyPath = path.join(dir, "history.json");
  Tracker.decisionsPath = path.join(dir, "decisions.json");
  Tracker._reload();
  assert.doesNotThrow(() => Tracker.record({ ...fixture(), status: "passed" }));
  await Tracker._queue;
  assert.equal(Tracker.list().length, 1);
});
test("decisions and history persist across a reload from disk", async (t) => {
  const { tracker } = trackerAt(t);
  const key = "https://example.com::click::#save";
  tracker.record({ ...fixture(), status: "passed" });
  tracker.record({ ...fixture(), status: "failed" });
  tracker.quarantine(key);
  await tracker._queue;

  const reloaded = load("src/core/FlakinessTracker.js", { "./Middleware": { emit() {} } });
  reloaded.historyPath = tracker.historyPath;
  reloaded.decisionsPath = tracker.decisionsPath;
  reloaded._reload();
  assert.equal(reloaded.list().length, 1);
  assert.equal(reloaded.list()[0].history.length, 2);
  assert.equal(reloaded.list()[0].quarantined, true);
  assert.equal(reloaded.decisions.length, 1);
});
test("ten concurrent record() calls for the same scenario all land without a lost update", async (t) => {
  const { tracker } = trackerAt(t);
  for (let i = 0; i < 10; i++) {
    tracker.record({ ...fixture(), status: i % 2 === 0 ? "passed" : "failed" });
  }
  await tracker._queue;
  const onDisk = JSON.parse(fs.readFileSync(tracker.historyPath, "utf8"));
  const entry = onDisk["https://example.com::click::#save"];
  assert.equal(entry.history.length, 10);
  assert.equal(entry.sampleSize, 10);
});
test("concurrent quarantine calls across different scenarios are all persisted", async (t) => {
  const { tracker } = trackerAt(t);
  for (let i = 0; i < 15; i++) tracker.record({ ...fixture(), locator: `#s${i}`, status: "passed" });
  for (let i = 0; i < 15; i++) tracker.quarantine(`https://example.com::click::#s${i}`);
  await tracker._queue;
  assert.ok(tracker.list().every((e) => e.quarantined));
  const onDisk = JSON.parse(fs.readFileSync(tracker.decisionsPath, "utf8"));
  assert.equal(onDisk.length, 15);
});

// ── Eviction protects human decisions (AC-08, D4/Q9) ──

function flood(tracker, count, { startAt = 0 } = {}) {
  for (let i = 0; i < count; i++) {
    const entry = tracker.record({ ...fixture(), locator: `#flood${startAt + i}`, status: "passed" });
    entry.lastUsed = startAt + i; // deterministic recency ordering
    tracker._setScenario(entry.key, entry);
  }
}

test("AC-08: ordinary stale entries are still evicted deterministically and the cap still holds when nothing is protected", (t) => {
  const { tracker } = trackerAt(t);
  flood(tracker, 600);
  assert.equal(Object.keys(tracker.scenarios).length, 500);
});

test("AC-08: a quarantined entry survives 600 new scenarios and a save/reload cycle intact", async (t) => {
  const { tracker } = trackerAt(t);
  const key = "https://example.com::click::#save";
  tracker.record({ ...fixture(), status: "passed" });
  const quarantined = tracker.quarantine(key, { by: "peyman" });
  quarantined.lastUsed = -1; // oldest possible — would be first evicted if unprotected
  tracker._setScenario(key, quarantined);

  flood(tracker, 600);
  await tracker._queue;

  assert.equal(tracker._hasScenario(key), true);
  const survivor = tracker._getScenario(key);
  assert.equal(survivor.quarantined, true);
  assert.equal(survivor.quarantinedBy, "peyman");
  assert.equal(survivor.history.length, 1);
  // 601 tracked total (600 flood + 1 protected); eviction only ever pulls
  // from the unprotected pool, capped at the same overflow count as today
  // (keys.length - MAX_TRACKED_SCENARIOS = 101), leaving 500 total.
  assert.equal(Object.keys(tracker.scenarios).length, 500);

  const reloaded = load("src/core/FlakinessTracker.js", {
    "./Middleware": { emit() {} },
    "../../utils/Logger": { info() {}, warning() {}, error() {}, async flush() {} },
  });
  reloaded.historyPath = tracker.historyPath;
  reloaded.decisionsPath = tracker.decisionsPath;
  reloaded._reload();
  const reloadedEntry = reloaded._getScenario(key);
  assert.ok(reloadedEntry, "quarantined entry must survive a full save/reload cycle");
  assert.equal(reloadedEntry.quarantined, true);
  assert.equal(reloadedEntry.quarantinedBy, "peyman");
});

test("AC-08/D4: a key whose latest ledger decision is 'quarantine' is protected from eviction even if its own entry.quarantined disagrees", (t) => {
  const { tracker, warnings } = trackerAt(t);
  const key = "https://example.com::click::#save";
  const entry = tracker.record({ ...fixture(), status: "passed" });
  entry.lastUsed = -1;
  entry.quarantined = false; // simulate a crash between the history save and the decisions save
  tracker._setScenario(key, entry);
  tracker.decisions.push({ key, action: "quarantine", by: "peyman", at: new Date().toISOString() });

  flood(tracker, 600);

  assert.equal(tracker._hasScenario(key), true, "ledger-referenced key must be protected independent of entry.quarantined");
  assert.equal(warnings.length, 0);
});

test("AC-08/D4/Q9: a key whose latest ledger decision is 'unquarantine' is NOT protected", (t) => {
  const { tracker } = trackerAt(t);
  const key = "https://example.com::click::#save";
  const entry = tracker.record({ ...fixture(), status: "passed" });
  entry.lastUsed = -1;
  entry.quarantined = false;
  tracker._setScenario(key, entry);
  tracker.decisions.push({ key, action: "quarantine", by: "peyman", at: "2020-01-01T00:00:00.000Z" });
  tracker.decisions.push({ key, action: "unquarantine", by: "reviewer", at: "2020-01-02T00:00:00.000Z" });

  flood(tracker, 600);

  assert.equal(tracker._hasScenario(key), false, "the latest decision (unquarantine) must not leave this key protected");
});

test("AC-08: when every tracked entry is protected and the cap is still exceeded, nothing is evicted and one warning names the counts", (t) => {
  const { tracker, warnings } = trackerAt(t);
  for (let i = 0; i < 501; i++) {
    const entry = tracker.record({ ...fixture(), locator: `#q${i}`, status: "passed" });
    entry.lastUsed = i;
    entry.quarantined = true; // every entry protected
    tracker._setScenario(entry.key, entry);
  }
  tracker._evictLeastRecentlyUsed();

  assert.equal(Object.keys(tracker.scenarios).length, 501, "no protected entry may be evicted");
  const evictionWarnings = warnings.filter((w) => w.includes("eviction"));
  assert.equal(evictionWarnings.length, 1);
  assert.match(evictionWarnings[0], /501/);
});

// ── D4/Q10: ledger reconciliation on _reload() ──

test("D4/Q10: on reload, the ledger's latest verdict wins over a disagreeing history flag", (t) => {
  const dir = temp();
  const emitted = [];
  const warnings = [];
  const mocks = {
    "./Middleware": { emit: (...a) => emitted.push(a) },
    "../../utils/Logger": { info() {}, error() {}, async flush() {}, warning: (m) => warnings.push(m) },
  };
  const Tracker = load("src/core/FlakinessTracker.js", mocks);
  Tracker.historyPath = path.join(dir, "history.json");
  Tracker.decisionsPath = path.join(dir, "decisions.json");
  fs.mkdirSync(dir, { recursive: true });
  const key = "https://example.com::click::#save";
  fs.writeFileSync(Tracker.historyPath, JSON.stringify({
    [key]: { key, url: "https://example.com", action: "click", locator: "#save", history: [{ status: "passed" }], classification: "new", flakeRate: 0, sampleSize: 1, lastUsed: 1, quarantined: false, quarantinedAt: null, quarantinedBy: null },
  }));
  fs.writeFileSync(Tracker.decisionsPath, JSON.stringify([{ key, action: "quarantine", by: "peyman", at: "2024-01-01T00:00:00.000Z" }]));

  Tracker._reload();

  assert.equal(Tracker._getScenario(key).quarantined, true, "ledger wins: history said false, ledger says quarantine");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
});

test("D4/Q10: a ledger-only key (no matching history entry) is not resurrected, but is protection-only", (t) => {
  const dir = temp();
  const Tracker = load("src/core/FlakinessTracker.js", {
    "./Middleware": { emit() {} },
    "../../utils/Logger": { info() {}, warning() {}, error() {}, async flush() {} },
  });
  Tracker.historyPath = path.join(dir, "history.json");
  Tracker.decisionsPath = path.join(dir, "decisions.json");
  fs.mkdirSync(dir, { recursive: true });
  const key = "https://gone.example.com::click::#vanished";
  fs.writeFileSync(Tracker.historyPath, "{}");
  fs.writeFileSync(Tracker.decisionsPath, JSON.stringify([{ key, action: "quarantine", by: "peyman", at: "2024-01-01T00:00:00.000Z" }]));

  Tracker._reload();

  assert.equal(Tracker._hasScenario(key), false, "no sample data exists to rebuild a history entry from a decision alone");
  assert.ok(Tracker._protectedKeys().has(key), "still held in the in-memory protection set");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
});

test("D4/Q10: reconciliation is in-memory only — it is not written back to disk as a side effect of _reload()", (t) => {
  const dir = temp();
  const Tracker = load("src/core/FlakinessTracker.js", {
    "./Middleware": { emit() {} },
    "../../utils/Logger": { info() {}, warning() {}, error() {}, async flush() {} },
  });
  Tracker.historyPath = path.join(dir, "history.json");
  Tracker.decisionsPath = path.join(dir, "decisions.json");
  fs.mkdirSync(dir, { recursive: true });
  const key = "https://example.com::click::#save";
  const before = JSON.stringify({
    [key]: { key, url: "https://example.com", action: "click", locator: "#save", history: [{ status: "passed" }], classification: "new", flakeRate: 0, sampleSize: 1, lastUsed: 1, quarantined: false, quarantinedAt: null, quarantinedBy: null },
  });
  fs.writeFileSync(Tracker.historyPath, before);
  fs.writeFileSync(Tracker.decisionsPath, JSON.stringify([{ key, action: "quarantine", by: "peyman", at: "2024-01-01T00:00:00.000Z" }]));

  Tracker._reload();

  assert.equal(Tracker._getScenario(key).quarantined, true, "in-memory reconciliation applied");
  assert.equal(fs.readFileSync(Tracker.historyPath, "utf8"), before, "the on-disk file must be untouched by _reload()");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
});
