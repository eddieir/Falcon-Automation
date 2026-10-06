"use strict";

/**
 * P15-T4 regression: falcon.js end to end through the CLI fixture preload.
 * Covers P15-AC-03, 12, 15, 16 and SEC-11, SEC-12.
 *
 * Every child runs tests/fixtures/p15-heal-preload.cjs, which applies the
 * cli-preload mocks, sets the history test seam, and (FALCON_FIXTURE_HEALS=N)
 * pushes N real-shaped heal events into the real HealingReport before the run.
 * The ledger lives in a temp directory; the repo's data/run_history.json is
 * asserted untouched before and after the whole file.
 *
 * Run directly: node --test tests/regression/p15-integration.check.cjs
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { root, temp } = require("./helpers.cjs");
const { RunLedger } = require("../../src/core/history/RunLedger.js");

const PRELOAD = path.join(root, "tests/fixtures/p15-heal-preload.cjs");
const FALCON = path.join(root, "falcon.js");
const HISTORY = path.join(root, "scripts/history.js");
const REAL_LEDGER = path.join(root, "data", "run_history.json");

const MODES = [
  ["success", 0],
  ["scenario-failure", 1],
  ["navigation-failure", 1],
  ["empty", 1],
  ["launch-failure", 1],
];

const GIT_ENV = { GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567", GITHUB_REF_NAME: "p15-integration" };

const digestOfReal = () => (fs.existsSync(REAL_LEDGER)
  ? crypto.createHash("sha256").update(fs.readFileSync(REAL_LEDGER)).digest("hex")
  : null);
const realBefore = digestOfReal();

test.after(() => {
  assert.equal(digestOfReal(), realBefore, "the suite must never create or modify data/run_history.json");
});

function sandbox(t) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, ledger: path.join(dir, "run_history.json") };
}

function envFor({ dir, ledger }, extra = {}) {
  return {
    ...process.env,
    ...GIT_ENV,
    FALCON_TEST_RUN_HISTORY_PATH: ledger,
    FALCON_TEST_PENDING_PATH: path.join(dir, "healing_pending.json"),
    FALCON_TEST_HEALING_DECISIONS_PATH: path.join(dir, "healing_decisions.json"),
    FALCON_TEST_HISTORY_PATH: path.join(dir, "scenario_history.json"),
    FALCON_TEST_DECISIONS_PATH: path.join(dir, "quarantine_decisions.json"),
    OPENAI_API_KEY: "sk-p15-integration-secret",
    ...extra,
  };
}

function falcon(box, mode, { env = {}, args = [] } = {}) {
  const child = spawnSync(
    process.execPath,
    ["--require", PRELOAD, FALCON, "--no-dashboard", "--url=http://fixture.test/", ...args],
    { cwd: box.dir, env: envFor(box, { FALCON_FIXTURE_MODE: mode, ...env }), encoding: "utf8", timeout: 20000 },
  );
  assert.equal(child.error, undefined);
  return child;
}

function historyCli(box, args, env = {}) {
  const child = spawnSync(process.execPath, ["--require", PRELOAD, HISTORY, ...args], {
    cwd: box.dir, env: envFor(box, env), encoding: "utf8", timeout: 20000,
  });
  assert.equal(child.error, undefined);
  return child;
}

const runsOf = (ledger) => JSON.parse(fs.readFileSync(ledger, "utf8")).runs;

// ---------------------------------------------------------------------------
// One record per run, in every fixture mode
// ---------------------------------------------------------------------------

const EXPECTED = {
  success: { result: "PASSED", counts: { total: 1, passed: 1, failed: 0 }, coverage: { pagesTested: 1, pagesSkipped: 0, pagesUnreachable: 0 }, incomplete: false },
  "scenario-failure": { result: "FAILED", counts: { total: 1, passed: 0, failed: 1 }, coverage: { pagesTested: 1, pagesSkipped: 0, pagesUnreachable: 0 }, incomplete: false },
  "navigation-failure": { result: "NO_TESTS_RUN", counts: { total: 0, passed: 0, failed: 0 }, coverage: { pagesTested: 0, pagesSkipped: 0, pagesUnreachable: 1 }, incomplete: false },
  empty: { result: "NO_TESTS_RUN", counts: { total: 0, passed: 0, failed: 0 }, coverage: { pagesTested: 1, pagesSkipped: 0, pagesUnreachable: 0 }, incomplete: false },
  // AC-03: the crash path records incomplete and no coverage.
  "launch-failure": { result: "FAILED", counts: { total: 1, passed: 0, failed: 1 }, coverage: null, incomplete: true },
};

for (const [mode, exitCode] of MODES) {
  test(`${mode}: appends exactly one correct record and exits ${exitCode} (AC-01, 03, 12)`, (t) => {
    const box = sandbox(t);
    const child = falcon(box, mode);
    assert.equal(child.status, exitCode, child.stdout + child.stderr);
    const runs = runsOf(box.ledger);
    assert.equal(runs.length, 1);
    const r = runs[0];
    const want = EXPECTED[mode];
    assert.equal(r.schemaVersion, 1);
    assert.equal(r.result, want.result);
    assert.equal(r.incomplete, want.incomplete);
    assert.deepEqual(r.coverage, want.coverage);
    for (const [k, v] of Object.entries(want.counts)) assert.equal(r.counts[k], v, `counts.${k}`);
    assert.equal(r.repeat, 1);
    assert.equal(r.sha, GIT_ENV.GITHUB_SHA);
    assert.equal(r.branch, GIT_ENV.GITHUB_REF_NAME);
    assert.deepEqual(r.heals, { t2: 0, t25: 0, t3: 0 });
    assert.equal(typeof r.durationMs, "number");
    assert.ok(!JSON.stringify(r).includes("fixture.test"), "no URL in the ledger");
    assert.ok(!JSON.stringify(r).includes("sk-p15-integration-secret"));
  });
}

test("--repeat is recorded", (t) => {
  const box = sandbox(t);
  const child = falcon(box, "success", { args: ["--repeat=3"] });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal(runsOf(box.ledger)[0].repeat, 3);
});

test("FALCON_FIXTURE_HEALS events are counted by the real collector", (t) => {
  const box = sandbox(t);
  const child = falcon(box, "success", { env: { FALCON_FIXTURE_HEALS: "4" } });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const r = runsOf(box.ledger)[0];
  assert.equal(r.heals.t25, 4);
  assert.equal(r.heals.t2 + r.heals.t3, 0);
});

test("an invalid --repeat exits before the run and writes no record", (t) => {
  const box = sandbox(t);
  const marker = path.join(box.dir, "launched");
  const child = falcon(box, "success", { args: ["--repeat=0"], env: { FALCON_LAUNCH_MARKER: marker } });
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.equal(fs.existsSync(marker), false, "the browser must never launch");
  assert.equal(fs.existsSync(box.ledger), false, "no record for a run that never started");
});

// An exception inside recordRun must not change the exit code or the report.
for (const [mode, exitCode] of MODES) {
  test(`${mode}: a throw inside recordRun leaves exit ${exitCode} and the report unchanged and logs a warning (SEC-12)`, (t) => {
    const control = sandbox(t);
    const ok = falcon(control, mode, { env: { FALCON_RUN_HISTORY: "off" } });
    const boxed = sandbox(t);
    const bad = falcon(boxed, mode, { env: { FALCON_FIXTURE_RECORD_THROW: "1" } });
    assert.equal(ok.status, exitCode, ok.stdout + ok.stderr);
    assert.equal(bad.status, exitCode, bad.stdout + bad.stderr);
    assert.match(bad.stdout + bad.stderr, /Run history was not recorded/);
    assert.doesNotMatch(bad.stdout + bad.stderr, /fixture getGitInfo failure/, "the error text is not echoed");
    assert.equal(fs.existsSync(boxed.ledger), false, "nothing is written when recording failed");
    const read = (box) => {
      const r = JSON.parse(fs.readFileSync(path.join(box.dir, "reports/test-report.json"), "utf8"));
      return { result: r.result, summary: r.summary };
    };
    assert.deepEqual(read(boxed), read(control));
  });
}

// ---------------------------------------------------------------------------
// AC-12: the exit code does not depend on history
// ---------------------------------------------------------------------------

function baselineRecords(n, branch = GIT_ENV.GITHUB_REF_NAME) {
  return Array.from({ length: n }, (_, i) => ({
    schemaVersion: 1,
    runId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    sha: GIT_ENV.GITHUB_SHA, branch, source: "falcon", repeat: 1, result: "PASSED",
    counts: { total: 1, passed: 1, failed: 0, skipped: 0, quarantined: 0, deduped: 0, unavailable: 0 },
    coverage: { pagesTested: 1, pagesSkipped: 0, pagesUnreachable: 0 },
    heals: { t2: 0, t25: 0, t3: 0 }, healFailures: { t25: 0, t3: 0, exhausted: 0 },
    pendingDepth: 0, quarantineCount: 0, durationMs: 1000, incomplete: false,
  }));
}

async function seedBaseline(ledger, n = 10) {
  const l = new RunLedger({ filePath: ledger, backoffMs: 1 });
  for (const r of baselineRecords(n)) assert.equal((await l.append(r)).ok, true);
}

for (const [mode, exitCode] of MODES) {
  test(`${mode}: exit code is ${exitCode} with history on, off, unwritable and flagged (AC-12, SEC-12)`, async (t) => {
    const on = falcon(sandbox(t), mode);
    assert.equal(on.status, exitCode, on.stdout + on.stderr);

    const offBox = sandbox(t);
    const off = falcon(offBox, mode, { env: { FALCON_RUN_HISTORY: "off" } });
    assert.equal(off.status, exitCode, off.stdout + off.stderr);
    assert.equal(fs.existsSync(offBox.ledger), false, "off must not create the ledger");
    assert.deepEqual(fs.readdirSync(offBox.dir).filter((f) => f.includes("run_history")), []);

    const dirBox = sandbox(t);
    fs.mkdirSync(dirBox.ledger); // unwritable: the ledger path is a directory
    const unwritable = falcon(dirBox, mode);
    assert.equal(unwritable.status, exitCode, unwritable.stdout + unwritable.stderr);
    assert.ok(fs.statSync(dirBox.ledger).isDirectory());

    const flagBox = sandbox(t);
    await seedBaseline(flagBox.ledger);
    const flagged = falcon(flagBox, mode, { env: { FALCON_FIXTURE_HEALS: "5" } });
    assert.equal(flagged.status, exitCode, flagged.stdout + flagged.stderr);
    assert.equal(runsOf(flagBox.ledger).length, 11);
  });
}

test("a corrupt ledger does not change the exit code and is set aside", (t) => {
  const box = sandbox(t);
  fs.writeFileSync(box.ledger, "{corrupt");
  const child = falcon(box, "success");
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal(runsOf(box.ledger).length, 1);
});

test("a raised flag is logged as one line with signal names only and never changes the exit code (AC-16)", async (t) => {
  const box = sandbox(t);
  await seedBaseline(box.ledger);
  const child = falcon(box, "success", { env: { FALCON_FIXTURE_HEALS: "5" } });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const lines = child.stdout.split("\n").filter((l) => l.includes("history:"));
  assert.equal(lines.length, 1, child.stdout);
  assert.match(lines[0], /history: 1 flag\(s\): heal_rate$/);
});

test("no flag line when nothing is flagged", async (t) => {
  const box = sandbox(t);
  await seedBaseline(box.ledger);
  const child = falcon(box, "success");
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.ok(!/history: \d+ flag/.test(child.stdout));
});

test("an invalid FALCON_TREND_* setting warns naming it, uses defaults, and keeps the exit code and record", (t) => {
  const box = sandbox(t);
  const child = falcon(box, "success", { env: { FALCON_TREND_BASELINE_N: "0" } });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout + child.stderr, /WARNING.*FALCON_TREND_BASELINE_N/);
  assert.equal(runsOf(box.ledger).length, 1);
});

test("the test-seam env var is inert without the preload marker", (t) => {
  // history.js is read-only, so it is safe to prove the seam here without
  // risking a write to the real data/ directory.
  const box = sandbox(t);
  fs.writeFileSync(box.ledger, JSON.stringify({ schemaVersion: 1, runs: baselineRecords(1, "seam-probe") }));
  const child = spawnSync(process.execPath, [HISTORY, "list"], {
    cwd: box.dir, env: envFor(box), encoding: "utf8", timeout: 20000,
  });
  assert.ok(!child.stdout.includes("seam-probe"));
});

// ---------------------------------------------------------------------------
// AC-15 / AC-16: ten runs, no flags; an eleventh with a heal spike is flagged
// ---------------------------------------------------------------------------

test("ten consecutive runs give ten records, distinct runIds, no flags; a heal spike on the eleventh is flagged (AC-15, AC-16)", (t) => {
  const box = sandbox(t);
  for (let i = 0; i < 10; i++) {
    const child = falcon(box, "success");
    assert.equal(child.status, 0, `run ${i}: ${child.stdout}${child.stderr}`);
  }
  const runs = runsOf(box.ledger);
  assert.equal(runs.length, 10);
  assert.equal(new Set(runs.map((r) => r.runId)).size, 10);

  const check = historyCli(box, ["check", "--strict"]);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /no flags/);

  const list = historyCli(box, ["list"]);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(list.stdout.trimEnd().split("\n").length, 11, "header plus ten rows");

  const spike = falcon(box, "success", { env: { FALCON_FIXTURE_HEALS: "3" } });
  assert.equal(spike.status, 0, "a flagged run is still a green run");
  assert.equal(runsOf(box.ledger).length, 11);
  const strict = historyCli(box, ["check", "--strict"]);
  assert.equal(strict.status, 1, strict.stdout + strict.stderr);
  assert.match(strict.stdout, /heal_rate/);
  const soft = historyCli(box, ["check"]);
  assert.equal(soft.status, 0);
});
