const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { root, temp } = require("./helpers.cjs");

const CONFIG = path.join(root, "tests/fixtures/allure/allure.config.js");
const CLI = require.resolve("@playwright/test/cli");
const REPORTER_VERSION = JSON.parse(fs.readFileSync(path.join(root, "node_modules/allure-playwright/package.json"), "utf8")).version;

function runFixture(extraArgs = [], extraEnv = {}) {
  const base = temp();
  const resultsDir = path.join(base, "allure-results");
  const outputDir = path.join(base, "pw-output");
  const res = spawnSync(process.execPath, [CLI, "test", "-c", CONFIG, ...extraArgs], {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      FALCON_ALLURE_RESULTS_DIR: resultsDir,
      FALCON_ALLURE_OUTPUT_DIR: outputDir,
      ...extraEnv,
    },
  });
  return { base, resultsDir, status: res.status, output: `${res.stdout}\n${res.stderr}` };
}

// The helper under test: an empty or missing results directory is an error, never an empty pass.
function readAllureResults(dir) {
  if (!fs.existsSync(dir)) throw new Error(`Allure results directory missing: ${dir}`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith("-result.json"));
  if (files.length === 0) throw new Error(`Allure results directory has no result files: ${dir}`);
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

// allure-playwright attaches the failure screenshot inside a step, so search the whole tree.
function allAttachments(node) {
  return [...(node.attachments || []), ...(node.steps || []).flatMap(allAttachments)];
}

const byName = (results, name) => results.find((r) => r.name === name);
const pairs = (results) => results.map((r) => `${r.name}=${r.status}`).sort();
const why = (msg) => `${msg} (allure-playwright ${REPORTER_VERSION})`;

test("the repository Playwright config still registers the Allure reporter", () => {
  const config = require(path.join(root, "playwright.config.js"));
  const names = config.reporter.map((r) => (Array.isArray(r) ? r[0] : r));
  assert.ok(names.includes("allure-playwright"), why("playwright.config.js lost the allure-playwright reporter"));
});

test("Allure results record passed, failed and skipped tests with the fields reviewers rely on", (t) => {
  const run = runFixture();
  t.after(() => fs.rmSync(run.base, { recursive: true, force: true }));
  assert.notEqual(run.status, 0, `the failing test must still fail the run\n${run.output}`);

  const results = readAllureResults(run.resultsDir);
  assert.equal(results.length, 3, why(`expected 3 results, got ${results.length}`));

  const passed = byName(results, "allure fixture passes");
  assert.equal(passed.status, "passed", why("passing test status"));
  assert.equal(typeof passed.uuid, "string");
  assert.ok(passed.historyId, why("passing test has no historyId"));
  assert.ok(Number.isFinite(passed.start) && Number.isFinite(passed.stop) && passed.stop >= passed.start, why("passing test timestamps"));

  const failed = byName(results, "allure fixture fails on purpose");
  assert.equal(failed.status, "failed", why("failing test status"));
  assert.match(failed.statusDetails?.message ?? "", /Expected title|toHaveText/, why("failure message missing"));
  const shot = allAttachments(failed).find((a) => a.type === "image/png");
  assert.ok(shot, why("failing test has no screenshot attachment"));
  const shotFile = path.join(run.resultsDir, shot.source);
  assert.ok(fs.existsSync(shotFile) && fs.statSync(shotFile).size > 0, why("screenshot attachment file missing or empty"));

  const skipped = byName(results, "allure fixture is skipped");
  assert.equal(skipped.status, "skipped", why("skipped test must not be reported as passed"));
});

test("two runs produce the same set of (name, status) pairs", (t) => {
  const a = runFixture();
  const b = runFixture();
  t.after(() => {
    fs.rmSync(a.base, { recursive: true, force: true });
    fs.rmSync(b.base, { recursive: true, force: true });
  });
  assert.deepEqual(pairs(readAllureResults(a.resultsDir)), pairs(readAllureResults(b.resultsDir)));
});

test("a run without the Allure reporter is detected as empty, not as a pass", (t) => {
  const run = runFixture([], { FALCON_ALLURE_REPORTER_OFF: "1" });
  t.after(() => fs.rmSync(run.base, { recursive: true, force: true }));
  assert.throws(() => readAllureResults(run.resultsDir), /missing|no result files/);
});

test("a run that selects zero tests yields no results and the helper reports it", (t) => {
  const run = runFixture(["--grep", "matches-nothing-at-all"]);
  t.after(() => fs.rmSync(run.base, { recursive: true, force: true }));
  assert.throws(() => readAllureResults(run.resultsDir), /missing|no result files/);
});

test("an empty results directory is an error", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => readAllureResults(dir), /no result files/);
});
