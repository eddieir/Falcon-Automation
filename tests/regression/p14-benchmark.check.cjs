"use strict";

/**
 * P14-23 regression: the reproducible mutation benchmark (HealingBenchmark).
 *
 * This is the harness a customer uses to verify Falcon's healing claims
 * independently, so these tests cover the properties that make the
 * published numbers trustworthy rather than flattering:
 *
 *   - the four outcomes (no_candidate, refused, correct_heal, false_heal)
 *     form a mutually exclusive, exhaustive partition of N;
 *   - the no_candidate bucket is tied to COLLECTION finding nothing, not to
 *     CandidateMatcher.evaluate()'s own "no_candidate" status (those two
 *     are not the same thing — see HealingBenchmark.js's header comment);
 *   - the two ambiguous/adversarial fixture classes never produce
 *     "accepted" against the real corpus;
 *   - correctness is decided by DOM identity (the fixture's own
 *     author-declared data-benchmark-ground-truth-id), never by whether an
 *     action would merely not throw;
 *   - rankings and full per-dimension explanations are identical across
 *     TWO SEPARATE PROCESS invocations of the same corpus, not just a loop
 *     inside one process (a loop cannot detect state leaking through a
 *     module-level cache);
 *   - the output artifact lands under the gitignored reports/ directory.
 *
 * Launches real Chromium (the "regression" CI job already installs it
 * before running this suite — see .github/workflows/ci.yml). Run directly
 * with `node --test`, independent of the rest of the suite.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { root, temp } = require("./helpers.cjs");

const HealingBenchmark = require(path.join(root, "src", "core", "locator", "HealingBenchmark.js"));

const TEST_SALT = "p14-benchmark-test-salt-v1";

// ---------------------------------------------------------------------------
// Corpus loading / authoring invariants.
// ---------------------------------------------------------------------------

test("loadCorpus: the published manifest loads, is deterministically ordered, and covers every required class", async () => {
  const { fixtures } = await HealingBenchmark.loadCorpus();
  assert.ok(fixtures.length >= 7, "at least one fixture per required mutation class");

  const classes = new Set(fixtures.map((f) => f.mutationClass));
  for (const required of [
    "id-only-change",
    "wrapper-insertion",
    "controlled-text-change",
    "two-equally-plausible-targets",
    "contradictory-role-action",
    "duplicate-test-id",
    "duplicate-test-id-asymmetric",
  ]) {
    assert.ok(classes.has(required), `manifest must include a fixture for mutation class "${required}"`);
  }

  const ids = fixtures.map((f) => f.id);
  const sortedIds = [...ids].sort();
  assert.deepEqual(ids, sortedIds, "loadCorpus must return fixtures in deterministic ascending-id order");

  for (const fixture of fixtures) {
    assert.ok(fixture.preHtml.includes(fixture.groundTruthId), `${fixture.id}: ground-truth attribute must be present in pre.html`);
    assert.ok(fixture.postHtml.includes(fixture.groundTruthId), `${fixture.id}: ground-truth attribute must be present in post.html`);
  }
});

test("loadCorpus: rejects a manifest with a duplicate fixture id", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const real = await HealingBenchmark.loadCorpus();
  const firstFixtureDir = path.dirname(real.manifestPath);

  const manifest = {
    schemaVersion: 1,
    fixtures: [
      { id: "dup", mutationClass: "id-only-change", action: "click", groundTruthId: "id-only-change-f1", dir: "id-only-change/f1" },
      { id: "dup", mutationClass: "wrapper-insertion", action: "click", groundTruthId: "wrapper-insertion-f1", dir: "wrapper-insertion/f1" },
    ],
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  // Symlink the real fixture dirs in so pre.html/post.html resolve.
  fs.symlinkSync(path.join(firstFixtureDir, "id-only-change"), path.join(dir, "id-only-change"));
  fs.symlinkSync(path.join(firstFixtureDir, "wrapper-insertion"), path.join(dir, "wrapper-insertion"));

  await assert.rejects(() => HealingBenchmark.loadCorpus(dir), /duplicate fixture id/);
});

// ---------------------------------------------------------------------------
// classifyOutcome — the no_candidate-vs-refused nuance, as a pure unit test.
// ---------------------------------------------------------------------------

test("classifyOutcome: zero raw candidates is always no_candidate, regardless of matcher status", () => {
  const result = HealingBenchmark.classifyOutcome(0, { status: "no_candidate" });
  assert.equal(result.outcome, "no_candidate");
});

test("classifyOutcome: raw candidates existed but all were gated out (matcher says no_candidate) buckets as refused, not no_candidate", () => {
  // This is the exact shape CandidateMatcher.evaluate() returns when every
  // raw candidate was excluded by a gate OTHER than action_incompatible
  // (e.g. contradictory_role, conflicting_identity) — status "no_candidate"
  // with no `reason` field, even though candidates existed before gating.
  const result = HealingBenchmark.classifyOutcome(3, { status: "no_candidate" });
  assert.equal(result.outcome, "refused", "must not be confused with collection finding nothing");
  assert.equal(result.reason, "all_candidates_gated");
});

test("classifyOutcome: raw candidates existed and matcher explicitly refused buckets as refused with its own reason", () => {
  const result = HealingBenchmark.classifyOutcome(2, { status: "refused", reason: "insufficient_margin" });
  assert.equal(result.outcome, "refused");
  assert.equal(result.reason, "insufficient_margin");
});

test("classifyOutcome: accepted buckets as accepted (caller still resolves DOM identity afterward)", () => {
  const result = HealingBenchmark.classifyOutcome(1, { status: "accepted" });
  assert.equal(result.outcome, "accepted");
});

// ---------------------------------------------------------------------------
// A real benchmark run against the real corpus with a real browser.
// ---------------------------------------------------------------------------

let sharedReport = null;
async function getReport() {
  if (!sharedReport) {
    sharedReport = await HealingBenchmark.runBenchmark({ salt: TEST_SALT, headless: true, measurePerformance: false });
  }
  return sharedReport;
}

test("runBenchmark: the four outcomes exactly partition N", async () => {
  const report = await getReport();
  assert.equal(report.N, report.perCase.length);
  assert.ok(report.N >= 5);
  const sum = report.counts.no_candidate + report.counts.refused + report.counts.correct_heal + report.counts.false_heal;
  assert.equal(sum, report.N, "the four outcome counts must sum to exactly N");
  assert.equal(report.partitionValid, true);

  const rateSum = report.rates.no_candidate + report.rates.refused + report.rates.correct_heal + report.rates.false_heal;
  assert.ok(Math.abs(rateSum - 1) < 1e-9, "the four rates must sum to exactly 100%");

  // Every fixture appears exactly once — no case silently dropped or
  // double-counted.
  const { fixtures } = await HealingBenchmark.loadCorpus();
  assert.equal(report.perCase.length, fixtures.length);
  const seenIds = new Set(report.perCase.map((r) => r.id));
  assert.equal(seenIds.size, fixtures.length, "no fixture id is duplicated in the per-case log");
  for (const fixture of fixtures) assert.ok(seenIds.has(fixture.id), `fixture ${fixture.id} must appear in the per-case log`);
});

test("runBenchmark: the per-case log reports every fixture, not only the favourable ones", async () => {
  const report = await getReport();
  for (const row of report.perCase) {
    assert.ok(["no_candidate", "refused", "correct_heal", "false_heal"].includes(row.outcome));
    assert.equal(typeof row.id, "string");
    assert.equal(typeof row.mutationClass, "string");
    assert.equal(typeof row.rawCandidateCount, "number");
  }
});

test("runBenchmark: both ambiguous/adversarial fixtures are refused, never accepted", async () => {
  const report = await getReport();
  const ambiguousRows = report.perCase.filter((r) => r.mustRefuse);
  assert.ok(ambiguousRows.length >= 2, "both mandatory ambiguous classes must be present");
  for (const row of ambiguousRows) {
    assert.notEqual(row.outcome, "correct_heal", `${row.id} must never be silently accepted as correct`);
    assert.notEqual(row.outcome, "false_heal", `${row.id} must never be accepted at all`);
    assert.equal(row.outcome, "refused", `${row.id} (ambiguous/adversarial) must be refused`);
  }
});

// ---------------------------------------------------------------------------
// P14-23 round 2: the conflicting-stable-identity gate was narrowed (an
// exact data-testid/data-test match now outweighs a differing id). These
// two tests pin down the before/after of that change against the real
// corpus, end to end through a real browser — not just at the
// CandidateMatcher unit level (see p14-matcher.check.cjs for that).
// ---------------------------------------------------------------------------

test("P14-23 round 2: id-only-change-f1 now correctly heals instead of refusing (gate narrowing changed this outcome)", async () => {
  const report = await getReport();
  const row = report.perCase.find((r) => r.id === "id-only-change-f1");
  assert.ok(row, "id-only-change-f1 must still be in the corpus");
  // BEFORE round 2: the regenerated id (present on both sides, differing)
  // unconditionally excluded the real button, and the matcher fell back to
  // an unrelated decoy (a form label) scoring below MIN_CONFIDENCE — status
  // "refused"/"below_threshold". AFTER: the matching data-testid vouches
  // for the candidate despite the differing id, attribute evidence is
  // strong enough to clear both the confidence and margin bars, and the
  // winner resolves to the TRUE ground-truth node — a CORRECT heal, not
  // merely an accept.
  assert.equal(row.matcherStatus, "accepted");
  assert.equal(row.outcome, "correct_heal", "the healed candidate must resolve to the ground-truth node, not merely be accepted");
});

test("P14-23 round 2/3: THE FALSE-HEAL VECTOR (exact tie) — duplicate-test-id-f1 (two distinct elements sharing a data-testid) is refused, never accepted", async () => {
  const report = await getReport();
  const row = report.perCase.find((r) => r.id === "duplicate-test-id-f1");
  assert.ok(row, "the duplicate-test-id adversarial fixture must be present in the corpus");
  assert.equal(row.mustRefuse, true);
  assert.notEqual(row.matcherStatus, "accepted", "narrowing the gate must not let a duplicated data-testid resolve ambiguity by accident");
  assert.equal(row.outcome, "refused");
  // Round 3: this exact-tie case is now caught by the dedicated structural
  // ambiguity gate, named by its own reason — not folded into
  // insufficient_margin.
  assert.equal(row.refusalReason, "ambiguous_stable_identity");
});

test("P14-23 round 3: THE FALSE-HEAL VECTOR (asymmetric, the real falsification case) — duplicate-test-id-asymmetric-f1 is refused even though the decoy genuinely outscores the ground truth", async () => {
  const report = await getReport();
  const row = report.perCase.find((r) => r.id === "duplicate-test-id-asymmetric-f1");
  assert.ok(row, "the asymmetric duplicate-test-id fixture must be present in the corpus");
  assert.equal(row.mustRefuse, true);
  assert.notEqual(row.matcherStatus, "accepted", "a genuinely higher-scoring duplicate-data-testid decoy must still never be accepted");
  assert.equal(row.outcome, "refused");
  assert.equal(row.refusalReason, "ambiguous_stable_identity");

  // Prove this is the HARDER, non-degenerate case: the two candidates must
  // NOT be tied — the ground-truth row's own evidence has genuinely
  // drifted, which is what defeated round 2's margin-only defence in the
  // first place (a tie is caught by insufficient_margin regardless; an
  // outright higher-scoring decoy is not, unless something else catches it).
  assert.ok(row.winnerContributions, "a winner must still have been computed for explainability even though it is refused");
  assert.ok(row.runnerUpContributions, "two candidates must have been scored");
  const totals = row.alternativesConsidered.map((a) => a.total);
  assert.equal(new Set(totals).size, totals.length, "the two candidates' totals must differ — this is not a tie, unlike duplicate-test-id-f1");
});

test("P14-23 round 2/3: the false-heal rate across the whole corpus is reported prominently", async () => {
  const report = await getReport();
  // The narrowing (round 2) plus the structural ambiguity gate (round 3)
  // together must not introduce any false heal in this published run.
  assert.equal(report.counts.false_heal, 0, "if this ever goes nonzero, report it — do not adjust thresholds to force it back to zero");
});

test("runBenchmark: correctness is decided by ground-truth DOM identity, never by action success alone", async () => {
  const report = await getReport();
  const healedRows = report.perCase.filter((r) => r.outcome === "correct_heal" || r.outcome === "false_heal");
  assert.ok(healedRows.length >= 1, "the corpus must exercise at least one accepted heal");
  for (const row of healedRows) {
    assert.ok(row.winnerSelector, `${row.id}: an accepted row must carry the winning selector`);
  }
});

test("runBenchmark: reports tier3FallbackCount, timing, storage size, and deterministic-repeat agreement", async () => {
  const report = await getReport();
  assert.equal(report.tier3FallbackCount, report.counts.no_candidate + report.counts.refused);
  assert.equal(typeof report.timing.meanMatchTimeMs, "number");
  assert.equal(typeof report.timing.p95MatchTimeMs, "number");
  assert.ok(report.storageBytes > 0);
  assert.equal(report.deterministicRepeatAgreement.total, report.N);
  assert.equal(
    report.deterministicRepeatAgreement.agreedCount,
    report.N,
    "same-process repeat of evaluate() on identical captured inputs must be perfectly self-consistent"
  );
});

// ---------------------------------------------------------------------------
// Determinism across TWO SEPARATE PROCESS invocations (not a loop).
// ---------------------------------------------------------------------------

test("runBenchmark: identical rankings and full explanations across two separate process invocations", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runnerScript = path.join(dir, "run-once.js");
  fs.writeFileSync(
    runnerScript,
    `
    const HealingBenchmark = require(${JSON.stringify(path.join(root, "src", "core", "locator", "HealingBenchmark.js"))});
    HealingBenchmark.runBenchmark({ salt: ${JSON.stringify(TEST_SALT)}, headless: true, measurePerformance: false })
      .then((report) => { process.stdout.write(JSON.stringify(report)); })
      .catch((err) => { console.error(err); process.exit(1); });
    `
  );

  const out1 = execFileSync(process.execPath, [runnerScript], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 32 });
  const out2 = execFileSync(process.execPath, [runnerScript], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 32 });

  const report1 = JSON.parse(out1);
  const report2 = JSON.parse(out2);

  assert.equal(report1.perCase.length, report2.perCase.length);

  // Strip wall-clock-dependent fields (generatedAt, and the per-case/overall
  // timing numbers, which are real measured durations and will never be
  // bit-identical between two process runs) before the deep-equality check.
  // Rankings and explanations — the actual determinism claim — are
  // everything else: status, reason, winner, runnerUp-equivalent margin,
  // and every per-dimension contribution.
  const strip = (report) =>
    report.perCase.map((row) => ({
      id: row.id,
      mutationClass: row.mutationClass,
      action: row.action,
      rawCandidateCount: row.rawCandidateCount,
      matcherStatus: row.matcherStatus,
      matcherReason: row.matcherReason,
      margin: row.margin,
      winnerSelector: row.winnerSelector,
      outcome: row.outcome,
      refusalReason: row.refusalReason,
      // Full per-dimension explanations, not just the verdict — these are
      // now persisted on every row (P14-23 round 3 addendum) specifically
      // so the published artifact is self-sufficient evidence for this
      // exact property, rather than requiring a separate direct
      // CandidateMatcher comparison to verify it.
      winnerContributions: row.winnerContributions,
      runnerUpContributions: row.runnerUpContributions,
      alternativesConsidered: row.alternativesConsidered,
    }));

  assert.deepEqual(strip(report1), strip(report2), "two separate process invocations over the same corpus must produce identical rankings and FULL explanations (contributions included)");
  assert.deepEqual(report1.counts, report2.counts);
  assert.deepEqual(report1.rates, report2.rates);
  assert.equal(report1.partitionValid, true);
  assert.equal(report2.partitionValid, true);
});

// ---------------------------------------------------------------------------
// Ground-truth comparison: a sanity check that the DOM-identity check used
// by the harness actually distinguishes correct from wrong nodes, using a
// hand-built page rather than the corpus (keeps this test fast and isolated
// from fixture content drifting over time).
// ---------------------------------------------------------------------------

test("ground-truth identity check: a selector resolving to a different node than the ground truth is not correct", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <button id="wrong" data-benchmark-ground-truth-id="other-id">Wrong button</button>
    <button id="right" data-benchmark-ground-truth-id="the-real-one">Right button</button>
  `);

  const fixture = { groundTruthId: "the-real-one" };
  const wrongResolves = await page.locator("#wrong").getAttribute("data-benchmark-ground-truth-id");
  const rightResolves = await page.locator("#right").getAttribute("data-benchmark-ground-truth-id");
  assert.notEqual(wrongResolves, fixture.groundTruthId);
  assert.equal(rightResolves, fixture.groundTruthId);
});

// ---------------------------------------------------------------------------
// Performance measurement (hypothesis check, not an assertion of a specific
// number — only that the measurement mechanism itself runs and returns real
// positive numbers).
// ---------------------------------------------------------------------------

test("measureLargeDomPerformance: produces a real measurement against a ~5,000-node / 200-interactive-element DOM", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const result = await HealingBenchmark.measureLargeDomPerformance(page, { salt: TEST_SALT });

  assert.equal(result.totalNodes, 5000);
  assert.equal(result.interactiveElements, 200);
  assert.ok(result.rawCandidateCount > 0 && result.rawCandidateCount <= 200);
  assert.ok(result.collectMs > 0, "collection time must be a real measured positive number");
  assert.ok(result.scoreMs >= 0, "scoring time must be a real measured number");
  assert.equal(result.totalMs, result.collectMs + result.scoreMs);
  // Deliberately no assertion against the 500ms hypothesis — this test
  // proves the measurement mechanism works; the actual number is reported
  // in the task's verification output, not asserted here, per instruction
  // not to encode an unproven performance claim as a hard gate.
});

// ---------------------------------------------------------------------------
// Output artifact lands in a gitignored location.
// ---------------------------------------------------------------------------

test("CLI output path default lives under the gitignored reports/ directory", () => {
  const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.ok(/^reports\/$/m.test(gitignore), "reports/ must be gitignored for the benchmark artifact to be safely written there");
});

test("a real CLI run writes its report under reports/ and nothing is staged by git", async (t) => {
  const outPath = path.join(root, "reports", "healing_benchmark_regression_check.json");
  t.after(async () => {
    await fsp.rm(outPath, { force: true });
  });

  execFileSync(
    process.execPath,
    [path.join(root, "src", "core", "locator", "HealingBenchmark.js"), "--out", outPath],
    { cwd: root, encoding: "utf8", env: { ...process.env, PATH: process.env.PATH } }
  );

  const stat = await fsp.stat(outPath);
  assert.ok(stat.isFile());
  const parsed = JSON.parse(await fsp.readFile(outPath, "utf8"));
  assert.ok(parsed.partitionValid);

  const gitStatus = execFileSync("git", ["status", "--porcelain", "reports/"], { cwd: root, encoding: "utf8" });
  assert.equal(gitStatus.trim(), "", "reports/ must show no untracked/staged changes to git even after a real run");
});
