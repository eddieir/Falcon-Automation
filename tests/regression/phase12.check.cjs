const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { root, load, temp } = require("./helpers.cjs");

// ── QA independent verification (P12-09) ──────────────────────────────────
//
// This file targets three things the implementer's own tests do not cover
// (see .git/production-cycle/phase12-20260926-080146/09-qa-verification.md
// for the full analysis):
//
//   1. `--repeat` reaching `--single-page` mode. Every existing --repeat
//      test (cli.check.cjs) and every existing --single-page reference
//      (there are none outside falcon.js itself) exercises only the sweep
//      path. tests/fixtures/cli-preload.cjs's own "./src/core/TestRunner"
//      mock does not implement the static `runRepeatedTestPlan` the
//      --single-page path unconditionally calls (falcon.js:270) — spawning
//      the real CLI with --single-page against that existing fixture
//      crashes with "TestRunner.runRepeatedTestPlan is not a function".
//      That is a gap in the delivered *test double*, not a claim about
//      production code (production TestRunner.js does export the static
//      method) — but it proves --single-page + --repeat had zero coverage,
//      unit or CLI, anywhere in the delivered suite. This file's own preload
//      (built fresh per test, not touching the existing fixture) closes that
//      gap without editing any file this role isn't allowed to touch.
//   2. A real, spawned falcon.js process reaching exit code 1 end-to-end for
//      an "unavailable" result — AC-07's exit-code consumer, exercised only
//      in-process (via ReportManager directly) by the delivered tests.
//   3. FlakinessTracker._evictLeastRecentlyUsed()'s partially-protected-over-
//      cap case: some entries protected, but not enough unprotected ones to
//      close the shortfall. The implementer flagged this exact gap as
//      untested; it was originally characterized here as a silent breach
//      (P12-09 finding, P2) and reported to the coordinator. P12-10 fixed it
//      — the warning condition now fires whenever eviction cannot fully
//      restore the cap, naming tracked/protected/evicted/shortfall counts —
//      and the two tests below were updated accordingly: the exact-cap case
//      (line ~205) still expects no warning (no shortfall), and the
//      over-cap case (line ~230) now asserts the corrected single warning
//      and its four counts, not silence.

// ── 1 & 2: a from-scratch CLI preload for the --single-page path ───────────
//
// Deliberately independent of tests/fixtures/cli-preload.cjs (that fixture's
// TestRunner double only models the SiteSweep path). Written to a temp file
// per test via `temp()` so no new file lands anywhere but this one.

function writeSinglePagePreload(dir, { resultStatuses = ["passed"], repeatCapture }) {
  const preloadPath = path.join(dir, "single-page-preload.cjs");
  const capturePath = repeatCapture;
  const src = `
const Module = require("node:module");
const fs = require("node:fs");
const original = Module._load;
const page = { goto: async () => {}, url: () => "http://fixture.test/" };
const mocks = {
  playwright: { chromium: { launch: async () => ({
    newContext: async () => ({ newPage: async () => page }),
    close: async () => {},
  }) } },
  "./src/core/ExploratoryAI": class { async detectUIIssues() { return []; } },
  "./src/core/ClickExplorer": class {
    constructor() { this.visitedPages = new Set(["http://fixture.test/"]); }
    async explore() {}
  },
  "./src/core/TestGenerator": class {
    async generateTestScenarios() {
      return { url: "http://fixture.test/", test_scenarios: [{ action: "click", locator: "#x", description: "X" }] };
    }
  },
  "./src/core/TestRunner": class {
    constructor() {}
    async executeExploratoryTest() {}
    static async runRepeatedTestPlan(page, testPlan, repeatCount) {
      if (${JSON.stringify(Boolean(capturePath))}) {
        fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ repeatCount }));
      }
      const statuses = ${JSON.stringify(resultStatuses)};
      return statuses.map((status, i) => ({
        name: "X-" + i,
        status,
        duration: 1,
        reason: status === "unavailable" ? "chain exhausted" : undefined,
        error: status === "unavailable" ? "chain exhausted" : undefined,
        repetition: i + 1,
      }));
    }
  },
  "./src/core/Dashboard": class { async start() {} async stop() {} emit() {} },
};
Module._load = function (name, parent, ...rest) {
  if (Object.hasOwn(mocks, name)) return mocks[name];
  return original.call(this, name, parent, ...rest);
};
`;
  fs.writeFileSync(preloadPath, src);
  return preloadPath;
}

function runSinglePageCLI(t, { extraArgs = [], resultStatuses = ["passed"] } = {}) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repeatCapture = path.join(dir, "repeat-capture.json");
  const preload = writeSinglePagePreload(dir, { resultStatuses, repeatCapture });
  const child = spawnSync(
    process.execPath,
    [
      "--require", preload,
      path.join(root, "falcon.js"),
      "--no-dashboard",
      "--url=http://fixture.test",
      "--single-page",
      ...extraArgs,
    ],
    { cwd: dir, encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.error, undefined);
  return { child, dir, repeatCapture };
}

test("--single-page --repeat=4 reaches TestRunner.runRepeatedTestPlan as 4 (gap: no existing test exercises --repeat in --single-page mode)", (t) => {
  const { child, repeatCapture } = runSinglePageCLI(t, { extraArgs: ["--repeat=4"] });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const captured = JSON.parse(fs.readFileSync(repeatCapture, "utf8"));
  assert.equal(captured.repeatCount, 4);
});

test("--single-page with --repeat omitted still defaults to 1 (parity with the sweep path)", (t) => {
  const { child, repeatCapture } = runSinglePageCLI(t, {});
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const captured = JSON.parse(fs.readFileSync(repeatCapture, "utf8"));
  assert.equal(captured.repeatCount, 1);
});

test("--single-page with an invalid --repeat is still a hard failure (AC-02 applies identically to both modes)", (t) => {
  const { child, repeatCapture } = runSinglePageCLI(t, { extraArgs: ["--repeat=0"] });
  assert.notEqual(child.status, 0, child.stdout + child.stderr);
  assert.equal(fs.existsSync(repeatCapture), false, "TestRunner.runRepeatedTestPlan must never be reached on invalid --repeat");
});

test("a real spawned falcon.js process ending in an 'unavailable' result exits non-zero end-to-end (AC-07, single-page path)", (t) => {
  const { child, dir } = runSinglePageCLI(t, { resultStatuses: ["unavailable"] });
  assert.notEqual(child.status, 0, child.stdout + child.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(dir, "reports/test-report.json"), "utf8"));
  assert.equal(report.result, "FAILED");
  assert.equal(report.summary.unavailable, 1);
  assert.match(child.stdout, /Unavailable: 1/);
});

test("a real spawned falcon.js process with a mix of passed + unavailable reports PARTIAL and still exits non-zero (AC-07)", (t) => {
  const { child, dir } = runSinglePageCLI(t, { resultStatuses: ["passed", "unavailable"] });
  assert.notEqual(child.status, 0, child.stdout + child.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(dir, "reports/test-report.json"), "utf8"));
  assert.equal(report.result, "PARTIAL");
  assert.equal(report.summary.unavailable, 1);
  assert.equal(report.summary.passed, 1);
});

test("an all-passed real spawned falcon.js single-page run exits 0 (control case, proves the harness itself is sound)", (t) => {
  const { child, dir } = runSinglePageCLI(t, { resultStatuses: ["passed", "passed"] });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(dir, "reports/test-report.json"), "utf8"));
  assert.equal(report.result, "PASSED");
});

// ── 3: FlakinessTracker eviction, partially protected, still over cap ──────
//
// The implementer's own tests cover only the two extremes: nothing protected
// (ordinary eviction holds the cap) and everything protected (eviction is
// skipped outright, with a warning). Between those: some entries protected,
// enough survivors to necessarily still exceed the cap after evicting every
// unprotected entry. Per FlakinessTracker.js's `_evictLeastRecentlyUsed()`:
//   toEvict = Math.min(keys.length - MAX_TRACKED_SCENARIOS, unprotected.length)
// When unprotected.length < (keys.length - MAX_TRACKED_SCENARIOS), every
// unprotected entry is evicted but the cap is still exceeded afterward —
// and, unlike the "all protected" branch, NO warning is logged for this
// silent partial breach. This test characterizes that actual behavior so a
// human reviewer can decide whether it's an accepted, bounded trade-off (a
// human decision was never dropped; MAX_TRACKED_SCENARIOS is a soft
// memory-bound, not a hard invariant) or a defect.

function trackerAt(t) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const warnings = [];
  const Tracker = load("src/core/FlakinessTracker.js", {
    "./Middleware": { emit() {} },
    "../../utils/Logger": { info() {}, error() {}, async flush() {}, warning: (m) => warnings.push(m) },
  });
  Tracker.historyPath = path.join(dir, "scenario_history.json");
  Tracker.decisionsPath = path.join(dir, "quarantine_decisions.json");
  Tracker._reload();
  return { tracker: Tracker, warnings };
}

// Built directly against `tracker.scenarios` (never through `record()`,
// which triggers its own eviction pass on every call and would silently
// re-shape the very edge case being constructed here) so
// `_evictLeastRecentlyUsed()` runs exactly once against a known, fixed
// starting shape.
function seedEntry(tracker, locator, { lastUsed, quarantined = false }) {
  const key = `https://example.com::click::${locator}`;
  tracker._setScenario(key, {
    key, url: "https://example.com", action: "click", locator,
    history: [{ status: "passed", timestamp: new Date().toISOString(), duration: null, errorType: null, outcome: null }],
    classification: "new", flakeRate: 0, sampleSize: 1,
    lastUsed, quarantined, quarantinedAt: null, quarantinedBy: null,
  });
  return key;
}

test("FlakinessTracker eviction: partially protected and still over cap evicts every unprotected entry but silently leaves the cap exceeded, with no warning", (t) => {
  const { tracker, warnings } = trackerAt(t);
  const MAX = 500;
  const protectedCount = 480;
  const unprotectedCount = 40; // total 520, overflow = 20, but only 40 unprotected exist
  for (let i = 0; i < protectedCount; i++) seedEntry(tracker, `#p${i}`, { lastUsed: i, quarantined: true });
  for (let i = 0; i < unprotectedCount; i++) seedEntry(tracker, `#u${i}`, { lastUsed: 1000 + i });
  const totalBefore = Object.keys(tracker.scenarios).length;
  assert.equal(totalBefore, protectedCount + unprotectedCount);

  tracker._evictLeastRecentlyUsed();

  const totalAfter = Object.keys(tracker.scenarios).length;
  // Every protected entry survives.
  for (let i = 0; i < protectedCount; i++) {
    assert.equal(tracker._hasScenario(`https://example.com::click::#p${i}`), true);
  }
  // The overflow (20) is less than the unprotected pool (40), so eviction
  // actually succeeds in reaching the cap in THIS shape — evict exactly the
  // 20 stalest unprotected entries.
  assert.equal(totalAfter, MAX);
  const evictionWarnings = warnings.filter((w) => w.includes("eviction"));
  assert.equal(evictionWarnings.length, 0, "cap was reached without needing every unprotected entry, so no warning is expected here");
});

test("P12-10 fix: protected pool alone already exceeds the cap — every unprotected entry is still evicted, the cap stays exceeded, but now exactly one warning fires naming tracked/protected/evicted/shortfall counts", (t) => {
  const { tracker, warnings } = trackerAt(t);
  const MAX = 500;
  // Forces "even evicting every unprotected entry still leaves the cap
  // exceeded": the protected pool alone already exceeds MAX. Per
  // `_evictLeastRecentlyUsed()`'s `toEvict = Math.min(overflow,
  // unprotected.length)`, `unprotected.length` is the binding constraint
  // here, so a shortfall remains after eviction — which, since the P12-10
  // fix, is exactly the case the new Logger.warning condition
  // (`shortfall = overflow - toEvict > 0`) catches.
  const reallyProtected = 550;
  for (let i = 0; i < reallyProtected; i++) seedEntry(tracker, `#p${i}`, { lastUsed: i, quarantined: true });
  const smallUnprotected = 10;
  for (let i = 0; i < smallUnprotected; i++) seedEntry(tracker, `#u${i}`, { lastUsed: 1000 + i });
  const totalBefore = Object.keys(tracker.scenarios).length;
  assert.equal(totalBefore, reallyProtected + smallUnprotected);
  const overflow = totalBefore - MAX;
  const expectedEvicted = Math.min(overflow, smallUnprotected); // = smallUnprotected here (10 < 60)
  const expectedShortfall = overflow - expectedEvicted;

  tracker._evictLeastRecentlyUsed();

  const totalAfter = Object.keys(tracker.scenarios).length;
  // Every unprotected entry is gone...
  for (let i = 0; i < smallUnprotected; i++) {
    assert.equal(tracker._hasScenario(`https://example.com::click::#u${i}`), false, "every unprotected entry is still evicted");
  }
  // ...every protected entry survives (the fix must never touch a protected entry)...
  for (let i = 0; i < reallyProtected; i++) {
    assert.equal(tracker._hasScenario(`https://example.com::click::#p${i}`), true, "protected entries must never be evicted");
  }
  // ...and the tracked total is STILL over MAX_TRACKED_SCENARIOS — the fix
  // does not (and per D4 must not) reach into the protected pool to force
  // the cap; it only changes whether the shortfall is reported.
  assert.equal(totalAfter, reallyProtected);
  assert.ok(totalAfter > MAX, "the cap remains exceeded — the fix reports the breach, it does not evict a human decision to close it");

  const evictionWarnings = warnings.filter((w) => w.includes("eviction"));
  // Exactly one warning per call — not one per evicted/protected entry, and
  // not silent as it was pre-fix (P12-09/P2).
  assert.equal(evictionWarnings.length, 1, "a partial breach must warn exactly once per call, never silently and never once-per-entry");
  const [message] = evictionWarnings;
  assert.match(message, new RegExp(String(totalBefore)), "warning must name the tracked total");
  assert.match(message, new RegExp(String(reallyProtected)), "warning must name the protected count");
  assert.match(message, new RegExp(String(expectedEvicted)), "warning must name how many unprotected entries were actually evicted");
  assert.match(message, new RegExp(String(expectedShortfall)), "warning must name the remaining shortfall over the cap");
  assert.equal(expectedShortfall, totalAfter - MAX, "sanity: the shortfall this test expects matches the actual post-eviction overage");
});
