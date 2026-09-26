const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { root, temp } = require("./helpers.cjs");
for (const [mode, expected] of [
  ["success", 0],
  ["query", 0],
  ["scenario-failure", 1],
  ["navigation-failure", 1],
  ["launch-failure", 1],
  ["empty", 1],
]) {
  test(`CLI ${mode} has honest exit status and report`, (t) => {
    const dir = temp();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const child = spawnSync(
      process.execPath,
      [
        "--require",
        path.join(root, "tests/fixtures/cli-preload.cjs"),
        path.join(root, "falcon.js"),
        "--no-dashboard",
        "--url=http://fixture.test/?key=value=tail",
      ],
      {
        cwd: dir,
        env: { ...process.env, FALCON_FIXTURE_MODE: mode },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, expected, child.stdout + child.stderr);
    const report = JSON.parse(
      fs.readFileSync(path.join(dir, "reports/test-report.json")),
    );
    assert.equal(report.result === "PASSED", expected === 0);
  });
}

// ── scripts/flakiness/review.js ──
//
// Quarantine is the one control that can turn a red run green, so the CLI gets
// the same guard as the dashboard route: a scenario with no pass anywhere in
// its history can't be bought out of the exit code.

function reviewCLI(t, scenarios, args, env = {}) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const historyPath = path.join(dir, "scenario_history.json");
  const decisionsPath = path.join(dir, "quarantine_decisions.json");
  fs.writeFileSync(historyPath, JSON.stringify(scenarios));

  const child = spawnSync(
    process.execPath,
    [
      "--require",
      path.join(root, "tests/fixtures/flakiness-cli-preload.cjs"),
      path.join(root, "scripts/flakiness/review.js"),
      ...args,
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        FALCON_TEST_HISTORY_PATH: historyPath,
        FALCON_TEST_DECISIONS_PATH: decisionsPath,
        ...env,
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(child.error, undefined);
  return { child, historyPath, decisionsPath };
}

function scenarioFixture(statuses, { locator = "#save" } = {}) {
  const key = `https://x.com::click::${locator}`;
  return {
    [key]: {
      key,
      url: "https://x.com",
      action: "click",
      locator,
      description: "Save",
      history: statuses.map((status) => ({ status, timestamp: new Date().toISOString() })),
      classification: statuses.every((s) => s === "failed") ? "broken" : "flaky",
      flakeRate: statuses.filter((s) => s === "failed").length / statuses.length,
      sampleSize: statuses.length,
      lastUsed: Date.now(),
      quarantined: false,
      quarantinedAt: null,
      quarantinedBy: null,
    },
  };
}

test("review CLI: quarantining a scenario that has never passed is refused and exits 1", (t) => {
  const { child, historyPath, decisionsPath } = reviewCLI(
    t,
    scenarioFixture(["failed", "failed", "failed"]),
    ["quarantine", "https://x.com::click::#save"],
  );
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.match(child.stderr, /Refused/);
  assert.match(child.stderr, /never passed/);
  assert.equal(JSON.parse(fs.readFileSync(historyPath, "utf8"))["https://x.com::click::#save"].quarantined, false);
  assert.equal(fs.existsSync(decisionsPath), false);
});

test("review CLI: quarantining a genuinely flaky scenario succeeds and is written to the ledger", (t) => {
  const { child, historyPath, decisionsPath } = reviewCLI(
    t,
    scenarioFixture(["passed", "failed", "passed"]),
    ["quarantine", "https://x.com::click::#save"],
  );
  assert.equal(child.status ?? 0, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /Quarantined/);
  assert.equal(JSON.parse(fs.readFileSync(historyPath, "utf8"))["https://x.com::click::#save"].quarantined, true);
  const ledger = JSON.parse(fs.readFileSync(decisionsPath, "utf8"));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].by, "cli");
});

test("review CLI: quarantining an unknown key exits 1 and says so", (t) => {
  const { child } = reviewCLI(t, {}, ["quarantine", "https://x.com::click::#nope"]);
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.match(child.stderr, /No tracked scenario/);
});

// ── Phase 12: --repeat=N (AC-02, AC-03) ──
//
// AC-02 requires a HARD failure for a bad --repeat, unlike the warn-and-
// fall-back numericArg() pattern --max-pages/--budget-ms already use. Every
// invalid case here must exit non-zero *before* the browser ever launches —
// asserted via the launch marker file, not inferred from the exit code alone
// (a crash for an unrelated reason would also exit non-zero).

function runFalconCLI(t, extraArgs, env = {}) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const launchMarker = path.join(dir, "launched.marker");
  const optsCapture = path.join(dir, "sweep-opts.json");
  const child = spawnSync(
    process.execPath,
    [
      "--require",
      path.join(root, "tests/fixtures/cli-preload.cjs"),
      path.join(root, "falcon.js"),
      "--no-dashboard",
      "--url=http://fixture.test",
      ...extraArgs,
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        FALCON_FIXTURE_MODE: "success",
        FALCON_LAUNCH_MARKER: launchMarker,
        FALCON_CAPTURE_OPTS_PATH: optsCapture,
        ...env,
      },
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(child.error, undefined);
  return { child, launchMarker, optsCapture, dir };
}

test("--repeat omitted executes once (default observable behavior)", (t) => {
  const { child, launchMarker, optsCapture } = runFalconCLI(t, []);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal(fs.existsSync(launchMarker), true);
  const opts = JSON.parse(fs.readFileSync(optsCapture, "utf8"));
  assert.equal(opts.repeat, 1);
});

test("--repeat=1 matches the default observable behavior", (t) => {
  const { child, optsCapture } = runFalconCLI(t, ["--repeat=1"]);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const opts = JSON.parse(fs.readFileSync(optsCapture, "utf8"));
  assert.equal(opts.repeat, 1);
});

test("--repeat=3 reaches the sweep as 3", (t) => {
  const { child, optsCapture } = runFalconCLI(t, ["--repeat=3"]);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const opts = JSON.parse(fs.readFileSync(optsCapture, "utf8"));
  assert.equal(opts.repeat, 3);
});

for (const bad of ["abc", "0", "-2", "1.5", "51", ""]) {
  test(`--repeat=${bad || "(empty)"} is a hard failure before browser launch`, (t) => {
    const { child, launchMarker, optsCapture } = runFalconCLI(t, [`--repeat=${bad}`]);
    assert.notEqual(child.status, 0, child.stdout + child.stderr);
    assert.equal(fs.existsSync(launchMarker), false, "browser must never launch on invalid --repeat");
    assert.equal(fs.existsSync(optsCapture), false, "SiteSweep must never be constructed on invalid --repeat");
  });
}

test("duplicate conflicting --repeat values are a hard failure before browser launch", (t) => {
  const { child, launchMarker } = runFalconCLI(t, ["--repeat=3", "--repeat=5"]);
  assert.notEqual(child.status, 0, child.stdout + child.stderr);
  assert.equal(fs.existsSync(launchMarker), false);
});

test("duplicate identical --repeat values are accepted (not a conflict)", (t) => {
  const { child, optsCapture } = runFalconCLI(t, ["--repeat=3", "--repeat=3"]);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const opts = JSON.parse(fs.readFileSync(optsCapture, "utf8"));
  assert.equal(opts.repeat, 3);
});

// ── scripts/healing/review.js: previouslyRejected display (Phase 13) ──
//
// scripts/healing/review.js's own preload would need a fixture that redirects
// only HealingTrust, but tests/fixtures/review-status-cli-preload.cjs already
// redirects both HealingTrust and FlakinessTracker to FALCON_TEST_* paths, so
// it's reused here rather than adding a second near-identical fixture file.

function healingReviewCLI(t, pending, args) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pendingPath = path.join(dir, "healing_pending.json");
  const healingDecisionsPath = path.join(dir, "healing_decisions.json");
  const historyPath = path.join(dir, "scenario_history.json");
  const quarantineDecisionsPath = path.join(dir, "quarantine_decisions.json");
  fs.writeFileSync(pendingPath, JSON.stringify(pending));

  const child = spawnSync(
    process.execPath,
    [
      "--require",
      path.join(root, "tests/fixtures/review-status-cli-preload.cjs"),
      path.join(root, "scripts/healing/review.js"),
      ...args,
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        FALCON_TEST_PENDING_PATH: pendingPath,
        FALCON_TEST_HEALING_DECISIONS_PATH: healingDecisionsPath,
        FALCON_TEST_HISTORY_PATH: historyPath,
        FALCON_TEST_DECISIONS_PATH: quarantineDecisionsPath,
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(child.error, undefined);
  return { child };
}

test("healing review CLI: list renders previouslyRejected distinctly when count > 0", (t) => {
  const { child } = healingReviewCLI(t, {
    "#old": {
      original: "#old",
      suggested: "#new",
      description: "Save button",
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      occurrences: 4,
      tier3Invocations: 5,
      previouslyRejected: { count: 2, lastRejectedAt: "2024-01-01T00:00:00.000Z", lastRejectedBy: "dana" },
    },
  }, ["list"]);
  assert.equal(child.status ?? 0, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /Tier 3 invocations: 5/);
  assert.match(child.stdout, /previously rejected 2 time\(s\), last by dana/);
});

test("healing review CLI: list tolerates a legacy entry with no previouslyRejected field at all", (t) => {
  const { child } = healingReviewCLI(t, {
    "#legacy": {
      original: "#legacy",
      suggested: "#fixed",
      description: "",
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      occurrences: 1,
      // no tier3Invocations, no previouslyRejected — pre-Phase-13 shape
    },
  }, ["list"]);
  assert.equal(child.status ?? 0, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /Tier 3 invocations: 0/);
  assert.doesNotMatch(child.stdout, /previously rejected/);
});

test("healing review CLI: list tolerates a null lastRejectedBy without crashing", (t) => {
  const { child } = healingReviewCLI(t, {
    "#anon": {
      original: "#anon",
      suggested: "#fixed",
      description: "",
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      occurrences: 1,
      tier3Invocations: 1,
      previouslyRejected: { count: 1, lastRejectedAt: "2024-01-01T00:00:00.000Z", lastRejectedBy: null },
    },
  }, ["list"]);
  assert.equal(child.status ?? 0, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /previously rejected 1 time\(s\), last by \(unknown\)/);
});

// ── scripts/flakiness/review.js: rehab subcommand (Phase 13) ──

function rehabScenarioFixture({ locator = "#save", quarantined = true, recentAllPassed = true } = {}) {
  const key = `https://x.com::click::${locator}`;
  const failedRun = { status: "failed", timestamp: new Date().toISOString() };
  const passedRun = { status: "passed", timestamp: new Date().toISOString() };
  const history = recentAllPassed
    ? [failedRun, failedRun, passedRun, passedRun, passedRun, passedRun, passedRun]
    : [passedRun, failedRun, passedRun, failedRun, passedRun];
  return {
    [key]: {
      key,
      url: "https://x.com",
      action: "click",
      locator,
      description: "Save",
      history,
      classification: "flaky",
      flakeRate: 0.3,
      sampleSize: history.length,
      lastUsed: Date.now(),
      quarantined,
      quarantinedAt: quarantined ? new Date().toISOString() : null,
      quarantinedBy: quarantined ? "cli" : null,
      flakySince: null,
    },
  };
}

test("review CLI: rehab subcommand lists rehabilitation candidates and exits 0", (t) => {
  const { child } = reviewCLI(t, rehabScenarioFixture({ recentAllPassed: true }), ["rehab"]);
  assert.equal(child.status ?? 0, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /1 rehabilitation candidate\(s\)/);
  assert.match(child.stdout, /https:\/\/x\.com::click::#save/);
});

test("review CLI: rehab subcommand exits 0 with zero candidates and leaves state byte-identical", (t) => {
  const scenarios = rehabScenarioFixture({ recentAllPassed: false });
  const { child, historyPath, decisionsPath } = reviewCLI(t, scenarios, ["rehab"]);
  assert.equal(child.status ?? 0, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /No rehabilitation candidates/);

  const beforeHistory = JSON.stringify(scenarios);
  const afterHistory = fs.readFileSync(historyPath, "utf8");
  assert.deepEqual(JSON.parse(afterHistory), JSON.parse(beforeHistory));
  assert.equal(fs.existsSync(decisionsPath), false, "rehab must never write to the decisions ledger");
});

test("review CLI: rehab subcommand never mutates a quarantined scenario's state even when candidates are found", (t) => {
  const scenarios = rehabScenarioFixture({ recentAllPassed: true });
  const { historyPath } = reviewCLI(t, scenarios, ["rehab"]);
  const after = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  assert.deepEqual(after, scenarios);
});

test("review CLI: list marks a rehabilitation candidate distinctly", (t) => {
  const scenarios = rehabScenarioFixture({ recentAllPassed: true });
  const { child } = reviewCLI(t, scenarios, ["list"]);
  assert.match(child.stdout, /rehabilitation candidate/);
});

// ── scripts/flakiness/review.js: REHAB_CANDIDATE_WINDOW must agree with
// scripts/review/status.js and the dashboard (Phase 13 AC-09, P13-08 repair) ──
//
// Before this fix, the CLI used a hardcoded REHAB_CANDIDATE_WINDOW_DEFAULT
// (5) and never consulted ConfigManager, so a deployment that configured a
// smaller window (visible to status.js and the dashboard) would have the CLI
// silently under-report — exactly the "hides review work" failure mode
// described in the P13-08 repair ticket. A scenario with history
// [failed, passed, passed] is a rehabilitation candidate under window=2 (the
// last 2 relevant results are both passes) but NOT under the default window
// of 5 (only 3 relevant results exist at all) — so this genuinely
// distinguishes "reads config" from "hardcoded 5".
function windowSensitiveScenarioFixture({ locator = "#save" } = {}) {
  const key = `https://x.com::click::${locator}`;
  return {
    [key]: {
      key,
      url: "https://x.com",
      action: "click",
      locator,
      description: "Save",
      history: [
        { status: "failed", timestamp: new Date().toISOString() },
        { status: "passed", timestamp: new Date().toISOString() },
        { status: "passed", timestamp: new Date().toISOString() },
      ],
      classification: "flaky",
      flakeRate: 0.33,
      sampleSize: 3,
      lastUsed: Date.now(),
      quarantined: true,
      quarantinedAt: new Date().toISOString(),
      quarantinedBy: "cli",
      flakySince: null,
    },
  };
}

test("review CLI rehab: a non-default REHAB_CANDIDATE_WINDOW is honored, matching status.js/dashboard policy", (t) => {
  const scenarios = windowSensitiveScenarioFixture();

  // Sanity: under the DEFAULT window (no env override), this scenario is NOT
  // a candidate — too few relevant results (3 < 5).
  const atDefault = reviewCLI(t, scenarios, ["rehab"]);
  assert.match(atDefault.child.stdout, /No rehabilitation candidates/, atDefault.child.stdout + atDefault.child.stderr);

  // Under REHAB_CANDIDATE_WINDOW=2, it IS a candidate. If the CLI still used
  // a hardcoded default of 5 instead of reading this setting, this assertion
  // fails exactly like the default-window case above.
  const atTwo = reviewCLI(t, scenarios, ["rehab"], { REHAB_CANDIDATE_WINDOW: "2" });
  assert.equal(atTwo.child.status ?? 0, 0, atTwo.child.stdout + atTwo.child.stderr);
  assert.match(atTwo.child.stdout, /1 rehabilitation candidate\(s\)/, atTwo.child.stdout + atTwo.child.stderr);
  assert.match(atTwo.child.stdout, /https:\/\/x\.com::click::#save/);
});

test("review CLI list: a non-default REHAB_CANDIDATE_WINDOW changes whether an entry is marked a rehabilitation candidate", (t) => {
  const scenarios = windowSensitiveScenarioFixture();

  const atDefault = reviewCLI(t, scenarios, ["list"]);
  assert.doesNotMatch(atDefault.child.stdout, /rehabilitation candidate/, atDefault.child.stdout + atDefault.child.stderr);

  const atTwo = reviewCLI(t, scenarios, ["list"], { REHAB_CANDIDATE_WINDOW: "2" });
  assert.match(atTwo.child.stdout, /rehabilitation candidate/, atTwo.child.stdout + atTwo.child.stderr);
});

test("review CLI rehab: an invalid REHAB_CANDIDATE_WINDOW (0) exits 2 and names the setting", (t) => {
  const { child } = reviewCLI(t, {}, ["rehab"], { REHAB_CANDIDATE_WINDOW: "0" });
  assert.equal(child.status, 2, child.stdout + child.stderr);
  assert.match(child.stderr, /REHAB_CANDIDATE_WINDOW/);
});

test("review CLI rehab: an invalid REHAB_CANDIDATE_WINDOW (21, above max) exits 2 and names the setting", (t) => {
  const { child } = reviewCLI(t, {}, ["rehab"], { REHAB_CANDIDATE_WINDOW: "21" });
  assert.equal(child.status, 2, child.stdout + child.stderr);
  assert.match(child.stderr, /REHAB_CANDIDATE_WINDOW/);
});

test("review CLI list: an invalid REHAB_CANDIDATE_WINDOW exits 2 and names the setting", (t) => {
  const { child } = reviewCLI(t, {}, ["list"], { REHAB_CANDIDATE_WINDOW: "abc" });
  assert.equal(child.status, 2, child.stdout + child.stderr);
  assert.match(child.stderr, /REHAB_CANDIDATE_WINDOW/);
});

test("review CLI: list prints every tracked scenario, and filters when given a classification", (t) => {
  const scenarios = {
    ...scenarioFixture(["passed", "failed", "passed"]),
    ...scenarioFixture(["failed", "failed", "failed"], { locator: "#broken" }),
  };

  const all = reviewCLI(t, scenarios, ["list"]);
  assert.match(all.child.stdout, /2 scenario\(s\)/);

  const flakyOnly = reviewCLI(t, scenarios, ["list", "flaky"]);
  assert.match(flakyOnly.child.stdout, /1 scenario\(s\)/);
});
