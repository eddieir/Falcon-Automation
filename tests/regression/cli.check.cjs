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

function reviewCLI(t, scenarios, args) {
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
