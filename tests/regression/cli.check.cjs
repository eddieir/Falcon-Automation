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
