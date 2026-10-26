/**
 * M0 #75 (AC75-01..10): workload manifest integrity and neutral scorer semantics.
 * Records are synthetic; they prove scoring rules, not any product's behaviour.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { score, wilson, InvalidRecordError } = require("../../scripts/benchmark/competitive-score.js");

const ROOT = path.join(__dirname, "..", "..");
const SCORER = path.join(ROOT, "scripts", "benchmark", "competitive-score.js");
const workloads = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "research", "competitive-benchmark-workloads.json"), "utf8"));
const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "benchmark", "manifest.json"), "utf8"));

const rec = (o = {}) => ({
  workloadId: "W1-id-churn", tool: "ToolA", toolVersion: "1.0.0", mode: "automated", run: 1, outcome: "PASS",
  repairAttempted: true, repairCorrect: true, wrongAction: false, objectivelyFailed: false, reportedPassed: true,
  expectedRefusal: false, operatorMinutes: 0, costUsd: 0, ...o,
});
const one = (records, opts) => score(records, opts)[0];

test("AC75-01: workloads are versioned, unique, cover six families and reference real fixtures", () => {
  assert.match(workloads.protocolVersion, /^\d+\.\d+\.\d+$/);
  const ids = workloads.workloads.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...new Set(workloads.workloads.map((w) => w.family))].sort(), [...workloads.families].sort());
  const fixtureIds = new Map(corpus.fixtures.map((f) => [f.id, f]));
  for (const w of workloads.workloads) {
    assert.ok(["PASS", "FAIL", "REFUSE"].includes(w.expectedOutcome), w.id + " expectedOutcome");
    assert.ok(["IMPLEMENTED", "PLANNED"].includes(w.status), w.id + " status");
    if (w.status === "IMPLEMENTED") assert.ok(w.fixtureRefs.length > 0, w.id + " implemented without fixtures");
    else assert.ok(w.note, w.id + " planned workloads must say what is missing");
    for (const ref of w.fixtureRefs) {
      const f = fixtureIds.get(ref);
      assert.ok(f, w.id + " references missing fixture " + ref);
      assert.ok(fs.existsSync(path.join(ROOT, "tests", "fixtures", "benchmark", f.dir, "pre.html")), ref + " pre.html");
      if (w.mustRefuse) assert.equal(f.mustRefuse, true, ref + " must be a must-refuse fixture");
    }
    assert.equal(w.mustRefuse, w.expectedOutcome === "REFUSE", w.id + " mustRefuse disagrees with expectedOutcome");
  }
});

test("AC75-02: rates carry numerator and denominator; zero denominators are N/A, not 0", () => {
  const g = one([rec(), rec({ run: 2, repairCorrect: false, wrongAction: true, reportedPassed: false, outcome: "FAIL" })]);
  assert.deepEqual([g.healingPrecision.numerator, g.healingPrecision.denominator, g.healingPrecision.value], [1, 2, 0.5]);
  assert.equal(g.unsafeActionRate.value, 0.5);
  const none = one([rec({ repairAttempted: false, repairCorrect: false })]);
  assert.equal(none.healingPrecision.value, null);
  assert.equal(none.healingPrecision.denominator, 0);
  assert.equal(none.falseGreenRate.value, null);
  assert.equal(none.correctRefusalRate.value, null);
});

test("AC75-03/04: false green, wrong action and refusal are first-class and separate", () => {
  const g = one([
    rec({ workloadId: "W5-element-removed", repairAttempted: false, repairCorrect: false, objectivelyFailed: true, reportedPassed: true }),
    rec({ workloadId: "W5-element-removed", run: 2, outcome: "FAIL", repairAttempted: false, repairCorrect: false, objectivelyFailed: true, reportedPassed: false }),
    rec({ workloadId: "W2-two-plausible", outcome: "REFUSE", repairAttempted: false, repairCorrect: false, reportedPassed: false, expectedRefusal: true }),
    rec({ workloadId: "W2-two-plausible", run: 2, wrongAction: true, repairCorrect: false, reportedPassed: false, outcome: "FAIL", expectedRefusal: true }),
  ]);
  assert.equal(g.falseGreenRate.value, 0.5);
  assert.equal(g.correctRefusalRate.value, 0.5);
  assert.equal(g.unsafeActionRate.numerator, 1);
  assert.equal(g.passRate.numerator, 0, "a PASS on an objectively failing run is not a pass");
});

test("AC75-05: refusals are not repair failures", () => {
  const g = one([rec(), rec({ run: 2, outcome: "REFUSE", repairAttempted: false, repairCorrect: false, reportedPassed: false })]);
  assert.equal(g.healingPrecision.denominator, 1);
  assert.equal(g.healingPrecision.value, 1);
  assert.equal(g.unnecessaryRefusalRate.value, 0.5);
});

test("AC75-06: NOT_TESTED is never scored as a failure or zero", () => {
  const r = score([{ workloadId: "W1-id-churn", tool: "ToolB", toolVersion: "2.0", mode: "automated", run: 1, outcome: "NOT_TESTED" }]);
  assert.equal(r[0].status, "NOT_TESTED");
  assert.equal(r[0].healingPrecision, undefined);
  const mixed = one([rec(), { workloadId: "W2-two-plausible", tool: "ToolA", toolVersion: "1.0.0", mode: "automated", run: 1, outcome: "NOT_TESTED" }]);
  assert.equal(mixed.notTested, 1);
  assert.equal(mixed.passRate.denominator, 1);
});

test("AC75-03: tool version and mode split results; assisted never pools with automated", () => {
  const r = score([rec(), rec({ mode: "assisted", operatorMinutes: 12 }), rec({ toolVersion: "1.1.0" })]);
  assert.equal(r.length, 3);
  assert.equal(r.find((x) => x.mode === "assisted").operatorMinutes, 12);
});

test("MISSING_EVIDENCE lowers completeness and stays out of correctness rates", () => {
  const g = one([rec(), { workloadId: "W1-class-rename", tool: "ToolA", toolVersion: "1.0.0", mode: "automated", run: 1, outcome: "MISSING_EVIDENCE" }]);
  assert.equal(g.evidenceCompleteness.value, 0.5);
  assert.equal(g.healingPrecision.denominator, 1);
  assert.equal(g.missingEvidence, 1);
});

test("AC75-10: intervals need 3 distinct runs; boundary at exactly 3", () => {
  assert.equal(one([rec(), rec({ workloadId: "W1-class-rename" })]).passRate.interval, null);
  const three = one([1, 2, 3].map((run) => rec({ run })));
  assert.ok(three.passRate.interval.low > 0 && three.passRate.interval.high === 1);
  assert.equal(wilson(0, 0, 5), null);
  const iv = wilson(5, 10, 5);
  assert.ok(iv.low < 0.5 && iv.high > 0.5);
});

test("determinism: record order does not change the score", () => {
  const a = [rec(), rec({ run: 2, outcome: "FAIL", repairCorrect: false, wrongAction: true, reportedPassed: false }), rec({ run: 3, tool: "ToolZ" })];
  assert.deepEqual(score(a), score([...a].reverse()));
});

test("composite is explicit, inverts lower-is-better rates and is null when a dimension is N/A", () => {
  const w = { healingPrecision: 0.5, unsafeActionRate: 0.5 };
  assert.equal(one([rec()], { weights: w }).composite, 1);
  assert.equal(one([rec({ wrongAction: true, repairCorrect: false, outcome: "FAIL", reportedPassed: false })], { weights: w }).composite, 0);
  assert.equal(one([rec({ repairAttempted: false, repairCorrect: false })], { weights: w }).composite, null);
  assert.equal(one([rec()]).composite, null, "no weights, no composite");
  assert.throws(() => one([rec()], { weights: { healingPrecision: 0.4 } }), InvalidRecordError);
  assert.throws(() => one([rec()], { weights: { healingPrecision: 1.2, passRate: -0.2 } }), InvalidRecordError);
});

test("failure: invalid and contradictory records are rejected, not scored", () => {
  const bad = (o) => assert.throws(() => score([rec(o)]), InvalidRecordError);
  bad({ outcome: "WIN" });
  bad({ mode: "manual" });
  bad({ run: 0 });
  bad({ toolVersion: "" });
  bad({ costUsd: -1 });
  bad({ wrongAction: "no" });
  bad({ repairCorrect: true, wrongAction: true });
  bad({ repairAttempted: false, repairCorrect: true });
  bad({ outcome: "REFUSE", repairAttempted: true, repairCorrect: false, reportedPassed: false });
  bad({ outcome: "FAIL", reportedPassed: true });
  assert.throws(() => score([rec(), rec()]), /duplicates/);
  assert.throws(() => score("nope"), InvalidRecordError);
});

test("AC75-07/08: CLI scores a file, exits 2 on bad input, and reads no network or credentials", () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "falcon-m075-"));
  try {
    const good = path.join(dir, "good.json");
    fs.writeFileSync(good, JSON.stringify([rec()]));
    const ok = spawnSync(process.execPath, [SCORER, good], { encoding: "utf8" });
    assert.equal(ok.status, 0);
    assert.equal(JSON.parse(ok.stdout)[0].healingPrecision.value, 1);
    const badFile = path.join(dir, "bad.json");
    fs.writeFileSync(badFile, JSON.stringify([rec({ outcome: "WIN" })]));
    assert.equal(spawnSync(process.execPath, [SCORER, badFile], { encoding: "utf8" }).status, 2);
    assert.equal(spawnSync(process.execPath, [SCORER], { encoding: "utf8" }).status, 2);
    assert.equal(spawnSync(process.execPath, [SCORER, path.join(dir, "missing.json")], { encoding: "utf8" }).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const src = fs.readFileSync(SCORER, "utf8");
  assert.ok(!/require\(['"](node:)?(http|https|net|child_process)['"]\)|process\.env|fetch\(/.test(src));
});

test("AC75-09: the protocol states that no cross-product results exist and requires review first", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs", "research", "competitive-benchmark-protocol.md"), "utf8");
  assert.match(doc, /no cross-product results exist/i);
  assert.match(doc, /independent review before any external comparison/i);
  assert.match(doc, /NOT_TESTED/);
});
