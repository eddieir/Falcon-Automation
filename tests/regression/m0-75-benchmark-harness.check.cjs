/**
 * M0 #75: the local benchmark harness. Classification rules are unit-tested; the committed run is
 * re-scored and re-rendered so the published numbers cannot drift from the data. No browser is launched here.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const H = path.join(ROOT, "benchmarks", "competitive");
const { baseRecord, failed, classifyLanding, classifyHeal } = require(path.join(H, "lib", "classify.js"));
const { render } = require(path.join(H, "report.js"));
const { choose } = require(path.join(H, "lib", "locators.js"));
const { score } = require(path.join(ROOT, "scripts", "benchmark", "competitive-score.js"));

const RUNS = path.join(ROOT, "docs", "research", "competitive-benchmark-runs");
const runFile = fs.readdirSync(RUNS).filter((f) => f.endsWith("-local.json")).sort().pop();
const run = JSON.parse(fs.readFileSync(path.join(RUNS, runFile), "utf8"));

const fx = (o = {}) => ({ groundTruthId: "gt", mustRefuse: false, expectedOutcome: "correct_heal", ...o });
const rec = (f) => baseRecord("T", "1", 1, "w", { expectedRefusal: Boolean(f.mustRefuse) });
const valid = (r) => assert.doesNotThrow(() => score([r]));
const landing = (f, landed) => { const r = classifyLanding(rec(f), f, landed); valid(r); return r; };
const heal = (f, outcome) => { const r = classifyHeal(rec(f), f, { outcome }); valid(r); return r; };

test("landing: the intended element is a clean pass", () => {
  const r = landing(fx(), "gt");
  assert.deepEqual([r.outcome, r.objectivelyFailed, r.reportedPassed], ["PASS", false, true]);
});

test("landing: another element is a false green, not a failure", () => {
  const r = landing(fx(), "other");
  assert.deepEqual([r.outcome, r.objectivelyFailed, r.reportedPassed, r.wrongAction], ["PASS", true, true, false]);
});

test("landing: no action is a failure, and not an unsafe one when refusal was expected", () => {
  assert.deepEqual([landing(fx(), null).outcome, landing(fx(), null).objectivelyFailed], ["FAIL", true]);
  const r = landing(fx({ mustRefuse: true }), null);
  assert.deepEqual([r.outcome, r.objectivelyFailed], ["FAIL", false]);
});

test("landing: acting at all where refusal is required or the target is gone is a false green, even on the ground-truth id", () => {
  assert.equal(landing(fx({ mustRefuse: true }), "gt").objectivelyFailed, true);
  assert.equal(landing(fx({ expectedOutcome: "no_candidate" }), "gt").objectivelyFailed, true);
  assert.equal(landing(fx({ expectedOutcome: "no_candidate" }), "gt").reportedPassed, true);
});

test("heal: a correct repair is credited, a wrong one is an unsafe repair", () => {
  const ok = heal(fx(), "correct_heal");
  assert.deepEqual([ok.repairAttempted, ok.repairCorrect, ok.wrongAction, ok.objectivelyFailed], [true, true, false, false]);
  const bad = heal(fx(), "false_heal");
  assert.deepEqual([bad.repairAttempted, bad.repairCorrect, bad.wrongAction, bad.objectivelyFailed], [true, false, true, true]);
});

test("heal: a refusal is correct when required and over-cautious otherwise; no candidate is a failure", () => {
  const good = heal(fx({ mustRefuse: true, expectedOutcome: "refused" }), "refused");
  assert.deepEqual([good.outcome, good.objectivelyFailed, good.repairAttempted], ["REFUSE", false, false]);
  const cautious = heal(fx(), "refused");
  assert.deepEqual([cautious.outcome, cautious.objectivelyFailed], ["REFUSE", true]);
  const none = heal(fx({ expectedOutcome: "no_candidate" }), "no_candidate");
  assert.deepEqual([none.outcome, none.objectivelyFailed, none.reportedPassed], ["FAIL", true, false]);
  assert.equal(failed(rec(fx())).reportedPassed, false);
});

test("run file: clean tree, four tools scored, no hidden gaps, free of cost", () => {
  assert.equal(run.meta.dirtyRelevantTree, false, "publish only runs made on a clean relevant tree");
  assert.match(run.meta.revision, /^[0-9a-f]{40}$/);
  assert.deepEqual(run.meta.tools.slice().sort(), ["cypress", "falcon", "playwright", "selenium"]);
  assert.equal(run.meta.costUsd, 0);
  assert.equal(run.meta.aiCalls, 0);
  assert.deepEqual(run.meta.telemetryDisabled, ["SE_AVOID_STATS", "CYPRESS_CRASH_REPORTS"]);
  assert.equal(typeof run.meta.credentialVariablesRemovedFromEnvironment, "number", "the zero-AI-call claim must come from a run that stripped credentials");
  assert.ok(run.meta.runs >= 3);
  for (const s of run.scores) assert.equal(s.status, "SCORED", s.tool);
  for (const r of run.records) if (r.outcome === "NOT_TESTED") assert.ok(r.note, "NOT_TESTED must say why");
});

test("run file: re-scoring the records reproduces the stored scores exactly", () => {
  assert.deepEqual(score(run.records), JSON.parse(JSON.stringify(run.scores)));
});

test("run file: every workload is covered by every tool the same number of times", () => {
  const counts = new Map();
  for (const r of run.records) counts.set(`${r.workloadId}|${r.tool}`, (counts.get(`${r.workloadId}|${r.tool}`) || 0) + 1);
  assert.ok(new Set(counts.values()).size === 1 && [...counts.values()][0] === run.meta.runs, "unequal coverage would bias the comparison");
  const workloads = new Set(run.records.map((r) => r.workloadId));
  for (const id of ["W3-checkout-flow", "W4-role-denied", "W5-unasserted-step", "W6-ci-economics"]) assert.ok(workloads.has(id), id);
});

test("run file: primary locators are neutral, one per fixture, never the ground-truth attribute", () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "benchmark", "manifest.json"), "utf8"));
  assert.deepEqual(run.locators.map((l) => l.id).sort(), corpus.fixtures.map((f) => f.id).sort());
  for (const l of run.locators) {
    assert.ok(l.selector && !/benchmark-ground-truth/.test(l.selector), l.id);
    assert.match(l.basis, /^(data-testid|id|name|aria-label|css-path)/);
  }
});

const facts = (attrs, tag = "button") => ({ tag, attrs: { "data-testid": null, id: null, name: null, "aria-label": null, ...attrs }, path: "html > body:nth-of-type(1) > button:nth-of-type(1)" });

test("locator rule: the hook the mutation changes wins, in a fixed precedence", () => {
  const pre = facts({ "data-testid": "go", id: "a", name: "n" });
  assert.deepEqual(choose("f", pre, facts({ "data-testid": "go", id: "b", name: "n" })), { selector: '[id="a"]', basis: "id (changed by the mutation)" });
  assert.equal(choose("f", pre, facts({ "data-testid": "x", id: "b", name: "n" })).basis, "data-testid (changed by the mutation)");
  assert.equal(choose("f", pre, null).basis, "data-testid (changed by the mutation)", "a removed element changes every hook");
});

test("locator rule: no changed hook falls back to best-practice order, then a structural path", () => {
  assert.deepEqual(choose("f", facts({ "data-testid": "go", id: "a" }), facts({ "data-testid": "go", id: "a" })), { selector: '[data-testid="go"]', basis: "data-testid" });
  assert.equal(choose("f", facts({ name: "n" }), facts({ name: "n" })).selector, 'button[name="n"]');
  assert.deepEqual(choose("f", facts({}), facts({})), { selector: "html > body:nth-of-type(1) > button:nth-of-type(1)", basis: "css-path" });
});

test("locator rule: a fixture without its ground-truth element fails loudly", () => {
  assert.throws(() => choose("broken-f1", null, facts({})), /broken-f1.*no ground-truth element/);
});

test("run.js refuses unknown tool names before doing any work", () => {
  const { spawnSync } = require("node:child_process");
  const out = spawnSync(process.execPath, [path.join(H, "run.js"), "--tools=falcon,nope", "--runs=1"], { encoding: "utf8" });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /unknown tool\(s\): nope/);
});

test("control server: wrong Host is refused, event and observation memory is capped", async () => {
  const http = require("node:http");
  const { start } = require(path.join(H, "lib", "server.js"));
  const app = await start({ fixtures: [{ id: "f1", preHtml: "<body></body>", postHtml: "<body></body>" }], apps: {} });
  const call = (method, p, { host, body } = {}) => new Promise((resolve, reject) => {
    const u = new URL(app.url);
    const req = http.request({ host: u.hostname, port: u.port, path: p, method, headers: { host: host || u.host } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
    req.end(body);
  });
  try {
    assert.equal(await call("POST", "/__ctl/reset", { host: "evil.example" }), 403);
    assert.equal(await call("POST", "/__ctl/reset"), 204);
    for (let i = 0; i < 150; i += 1) await call("POST", "/__event?f=f1", { body: JSON.stringify({ kind: "click", gt: "x" }) });
    assert.equal(app.eventsFor("f1").length, 100);
    assert.equal(await call("POST", "/__event?f=nope", { body: "{}" }), 404);
    assert.equal(await call("GET", "/f/f1/post.html"), 200);
    assert.equal(await call("GET", "/f/..%2f..%2fpackage/post.html"), 404);
    for (let i = 0; i < 60; i += 1) await call("POST", `/__ctl/obs?k=k${i}`, { body: "v" });
    assert.equal(app.observation("k49"), "v");
    assert.equal(app.observation("k55"), null);
  } finally { await app.close(); }
});

test("published results markdown is exactly what the data renders to", () => {
  const md = fs.readFileSync(path.join(RUNS, runFile.replace("-local.json", "-results.md")), "utf8");
  assert.equal(md, `${render(run)}\n`);
});

const { pinFor } = require(path.join(H, "install-cypress.js"));
const PINS = JSON.parse(fs.readFileSync(path.join(H, "cypress-binary.sha256.json"), "utf8"));
const HASH = "a".repeat(64);
const pins = (o = {}) => ({ version: "1.2.3", binaries: { "linux-x64": { url: "https://cdn.cypress.io/x.zip", sha256: HASH, ...o } } });

test("cypress pin: the committed pin matches the pinned package version and is well formed", () => {
  const h = JSON.parse(fs.readFileSync(path.join(H, "package.json"), "utf8"));
  assert.equal(PINS.version, h.dependencies.cypress);
  for (const [platform, pin] of Object.entries(PINS.binaries)) {
    assert.match(pin.sha256, /^[0-9a-f]{64}$/, platform);
    assert.match(pin.url, /^https:\/\/cdn\.cypress\.io\//, platform);
  }
  assert.ok(PINS.binaries["darwin-arm64"]);
});

test("cypress pin: fails closed on an unknown platform, a version mismatch or a malformed pin", () => {
  assert.equal(pinFor(pins(), "1.2.3", "linux-x64").sha256, HASH);
  assert.throws(() => pinFor(pins(), "1.2.3", "win32-x64"), /no pinned checksum for win32-x64/);
  assert.throws(() => pinFor(pins(), "9.9.9", "linux-x64"), /does not match package.json/);
  assert.throws(() => pinFor(pins({ sha256: "abc" }), "1.2.3", "linux-x64"), /malformed pin/);
  assert.throws(() => pinFor(pins({ url: "http://cdn.cypress.io/x.zip" }), "1.2.3", "linux-x64"), /malformed pin/);
  assert.throws(() => pinFor(pins({ url: "https://evil.example/x.zip" }), "1.2.3", "linux-x64"), /malformed pin/);
});

test("isolation: Selenium and Cypress stay out of the main package", () => {
  const root = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const all = { ...root.dependencies, ...root.devDependencies };
  assert.ok(!("cypress" in all) && !("selenium-webdriver" in all));
  const h = JSON.parse(fs.readFileSync(path.join(H, "package.json"), "utf8"));
  assert.equal(h.private, true);
  for (const v of Object.values(h.dependencies)) assert.match(v, /^\d+\.\d+\.\d+$/, "exact versions only");
  assert.match(fs.readFileSync(path.join(H, ".gitignore"), "utf8"), /node_modules/);
});
