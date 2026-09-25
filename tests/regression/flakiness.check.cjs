const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, temp } = require("./helpers.cjs");

function trackerAt(t) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const emitted = [];
  const Tracker = load("src/core/FlakinessTracker.js", {
    "./Middleware": { emit: (...args) => emitted.push(args) },
  });
  Tracker.historyPath = path.join(dir, "scenario_history.json");
  Tracker.decisionsPath = path.join(dir, "quarantine_decisions.json");
  Tracker._reload();
  return { tracker: Tracker, emitted };
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
