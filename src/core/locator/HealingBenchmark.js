"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("playwright");

const CandidateMatcher = require("./CandidateMatcher");
const ElementSignature = require("./ElementSignature");
const ElementFactsCollector = require("./ElementFactsCollector");
const Logger = require("../../../utils/Logger");

/**
 * HealingBenchmark — the reproducible mutation benchmark for Tier 2.5
 * (CandidateMatcher) self-healing, built against the fixture corpus in
 * `tests/fixtures/benchmark/`.
 *
 * PURPOSE: let an operator (or a customer evaluating Falcon's healing
 * claims) independently verify how often deterministic healing gets things
 * right — INCLUDING the cases it gets wrong. This module reports every
 * outcome Tier 2.5 can produce against the published corpus, never only the
 * favourable ones.
 *
 * STRUCTURAL ISOLATION: this module imports `CandidateMatcher` the same way
 * `AIHealer.js` does, but nothing under the runtime healing path (AIHealer,
 * Dashboard, HealingReport, falcon.js) ever imports THIS module. It is a
 * standalone, offline measurement tool — `require`d only by its own CLI
 * entry point and by its own regression test. Keeping that one-directional
 * is deliberate: a benchmark harness must never become a hidden runtime
 * dependency.
 *
 * ---------------------------------------------------------------------------
 * METRIC DEFINITIONS (binding — settled by a QA gate, not re-derived here):
 *
 * One denominator for all four rates: N = the number of mutation fixtures
 * attempted in a single run (one row per fixture in the manifest, not per
 * attempt/retry/candidate). The four outcomes below are a mutually
 * exclusive, EXHAUSTIVE partition of N:
 *
 *   - no_candidate : `ElementFactsCollector.collect()` itself returned zero
 *     raw candidates for the mutated page. This is a COLLECTION-level
 *     condition, not `CandidateMatcher.evaluate()`'s own `status` field.
 *   - refused      : collection produced at least one raw candidate, but
 *     Tier 2.5 declined to accept any of them. This covers BOTH of
 *     `CandidateMatcher`'s own possible non-accept outcomes when raw
 *     candidates existed: `status: "refused"` (below_threshold,
 *     insufficient_margin, action_incompatible, weak_evidence_only) AND
 *     the case where `evaluate()` itself reports `status: "no_candidate"`
 *     because every raw candidate was gated out for a reason OTHER than
 *     action-incompatibility (e.g. `contradictory_role`,
 *     `conflicting_identity`, `hidden`). That second case is a genuinely
 *     confusing naming collision: `CandidateMatcher.evaluate()` uses
 *     `"no_candidate"` to mean "nothing survived gating", which is NOT the
 *     same thing as this benchmark's `no_candidate` bucket ("collection
 *     found nothing to gate in the first place"). Collapsing the two would
 *     misreport a real, interesting refusal as if the DOM query had failed
 *     — this module keeps them distinct by classifying on
 *     `rawCandidateCount` first, before ever looking at `matcherStatus`.
 *   - correct_heal : Tier 2.5 accepted a candidate AND that candidate's
 *     selector resolves, via `page.locator(selector)`, to EXACTLY the
 *     fixture's ground-truth element (identity proven by the fixture's own
 *     fixed `data-benchmark-ground-truth-id` attribute — never by whether
 *     an action against it would have thrown).
 *   - false_heal   : Tier 2.5 accepted a candidate and it resolves to
 *     anything else (a different node, zero nodes, or more than one node —
 *     a selector that no longer resolves uniquely is not "the same DOM
 *     node" under any reading of that phrase).
 *
 * GROUND TRUTH, AND WHY THIS DEFINITION DOES NOT GENERALISE: correctness
 * here is a DOM-identity comparison against an attribute the fixture AUTHOR
 * wrote into both `pre.html` and `post.html` at fixture-authoring time, and
 * which `CandidateMatcher`/`ElementSignature` never read, hash, or score
 * (`data-benchmark-ground-truth-id` is not in `ATTRIBUTE_ALLOW_LIST`). That
 * is only possible because this corpus is synthetic and fully
 * author-controlled. It does NOT generalise to a scraped or real-world page,
 * where no author-declared ground truth exists — "correct" would be
 * unmeasurable under this definition on such a page, and must be redefined
 * or explicitly marked unmeasurable rather than quietly backed by
 * "the click did not throw", if this corpus is ever extended that way.
 * ---------------------------------------------------------------------------
 */

const DEFAULT_CORPUS_DIR = path.join(__dirname, "..", "..", "..", "tests", "fixtures", "benchmark");
const GROUND_TRUTH_ATTR = "data-benchmark-ground-truth-id";
const DEFAULT_SALT = "falcon-healing-benchmark-fixed-salt-v1";

function _percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, idx)];
}

function _mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Load and validate the fixture manifest. Throws on any structural problem
 * (missing fixture directory, missing pre/post HTML, duplicate id) rather
 * than silently skipping a broken fixture — a benchmark that quietly drops
 * a fixture would under-report N without anyone noticing.
 */
async function loadCorpus(corpusDir = DEFAULT_CORPUS_DIR) {
  const manifestPath = path.join(corpusDir, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  if (!manifest || !Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    throw new Error(`HealingBenchmark: manifest at ${manifestPath} has no fixtures`);
  }

  const seenIds = new Set();
  const fixtures = [];
  for (const entry of manifest.fixtures) {
    if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
      throw new Error("HealingBenchmark: a manifest fixture is missing a valid `id`");
    }
    if (seenIds.has(entry.id)) {
      throw new Error(`HealingBenchmark: duplicate fixture id "${entry.id}" in manifest`);
    }
    seenIds.add(entry.id);

    const dir = path.join(corpusDir, entry.dir);
    const prePath = path.join(dir, "pre.html");
    const postPath = path.join(dir, "post.html");
    const [preHtml, postHtml] = await Promise.all([
      fs.readFile(prePath, "utf8"),
      fs.readFile(postPath, "utf8"),
    ]);

    const groundTruthSelector = `[${GROUND_TRUTH_ATTR}="${entry.groundTruthId}"]`;
    if (!preHtml.includes(entry.groundTruthId) || !postHtml.includes(entry.groundTruthId)) {
      throw new Error(
        `HealingBenchmark: fixture "${entry.id}" must carry ${GROUND_TRUTH_ATTR}="${entry.groundTruthId}" in BOTH pre.html and post.html`
      );
    }

    fixtures.push({
      id: entry.id,
      mutationClass: entry.mutationClass,
      action: entry.action,
      groundTruthId: entry.groundTruthId,
      groundTruthSelector,
      mustRefuse: entry.mustRefuse === true,
      description: typeof entry.description === "string" ? entry.description : "",
      preHtml,
      postHtml,
    });
  }

  // Deterministic order: fixture id, ascending. Never manifest file order
  // (which could change without affecting content) and never discovery
  // order from the filesystem (which is not guaranteed stable across
  // platforms) — this is what makes the per-case log order reproducible.
  fixtures.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { manifestPath, fixtures };
}

/**
 * Capture the stored (pre-mutation) signature for one fixture's ground-truth
 * element, via the SAME `ElementFactsCollector.collectOne` path the runtime
 * healing chain uses for Tier 1/Tier 2 evidence capture — this benchmark
 * does not maintain a second DOM-reading code path.
 */
async function _captureStoredSignature(page, fixture, salt) {
  await page.setContent(fixture.preHtml, { waitUntil: "load" });
  const facts = await ElementFactsCollector.collectOne(page, fixture.groundTruthSelector);
  if (!facts) {
    throw new Error(`HealingBenchmark: fixture "${fixture.id}" ground-truth element not found in pre.html`);
  }
  return ElementSignature.capture(
    {
      tagName: facts.tagName,
      role: facts.role,
      accessibleName: facts.accessibleName,
      attributes: facts.attributes,
      structuralPath: facts.structuralPath,
      ownText: facts.ownText,
      boundingBoxBucket: facts.boundingBoxBucket,
    },
    { salt }
  );
}

/** Hash every raw live candidate fact into the `{selector, signature, ...}` shape CandidateMatcher expects — mirrors AIHealer._tryLocatorMemory's own wiring exactly. */
function _toLiveCandidates(facts, salt) {
  return facts.map((f) => ({
    selector: f.selector,
    signature: ElementSignature.capture(
      {
        tagName: f.tagName,
        role: f.role,
        accessibleName: f.accessibleName,
        attributes: f.attributes,
        structuralPath: f.structuralPath,
        ownText: f.ownText,
        boundingBoxBucket: f.boundingBoxBucket,
      },
      { salt }
    ),
    state: f.state,
    contentEditable: f.contentEditable,
    selectOptionAbsent: f.selectOptionAbsent,
  }));
}

/**
 * Classify one fixture's result into the four-way partition. `rawCandidateCount`
 * is checked BEFORE `matcherResult.status` — see the header comment's
 * explanation of why those are not interchangeable.
 */
function classifyOutcome(rawCandidateCount, matcherResult) {
  if (rawCandidateCount === 0) return { outcome: "no_candidate", reason: null };
  if (matcherResult.status === "accepted") return { outcome: "accepted", reason: null };
  // status is "refused" (has a reason) or "no_candidate" (all raw candidates
  // were gated out for a non-action-incompatible reason, so evaluate() had
  // nothing left to score) — both are a benchmark-level refusal because at
  // least one raw candidate existed.
  const reason = matcherResult.reason || (matcherResult.status === "no_candidate" ? "all_candidates_gated" : "unknown");
  return { outcome: "refused", reason };
}

/**
 * Resolve whether an ACCEPTED winner selector is the fixture's true
 * ground-truth node, by DOM identity via `page.locator` + the fixture's own
 * author-declared `data-benchmark-ground-truth-id` — never by whether an
 * action against it would succeed.
 */
async function _resolvesToGroundTruth(page, winnerSelector, fixture) {
  let locator;
  try {
    locator = page.locator(winnerSelector);
  } catch {
    return false;
  }
  let count;
  try {
    count = await locator.count();
  } catch {
    return false;
  }
  if (count !== 1) return false;
  let actualId;
  try {
    actualId = await locator.getAttribute(GROUND_TRUTH_ATTR);
  } catch {
    return false;
  }
  return actualId === fixture.groundTruthId;
}

/**
 * Run exactly one fixture end to end: capture stored evidence from
 * `pre.html`, collect live candidates from `post.html`, score them, and
 * classify the outcome. Returns one per-case log row.
 */
async function runFixture(page, fixture, { salt = DEFAULT_SALT, config = {} } = {}) {
  const storedSignature = await _captureStoredSignature(page, fixture, salt);

  await page.setContent(fixture.postHtml, { waitUntil: "load" });

  const collectStart = process.hrtime.bigint();
  const facts = await ElementFactsCollector.collect(page, { action: fixture.action });
  const collectEnd = process.hrtime.bigint();

  const liveCandidates = _toLiveCandidates(facts, salt);

  const scoreStart = process.hrtime.bigint();
  const matcherResult = CandidateMatcher.evaluate({ storedSignature, liveCandidates, action: fixture.action }, config);
  const scoreEnd = process.hrtime.bigint();

  // In-process repeat, same captured inputs, immediately after — a per-case
  // diagnostic signal distinct from (and weaker than) the two-SEPARATE-
  // PROCESS determinism proof the harness's own regression test performs.
  // This only re-runs the pure `evaluate()` call, never a second DOM query,
  // so it cannot by itself catch state leaking through a module-level
  // cache shared across process boundaries.
  const repeatResult = CandidateMatcher.evaluate({ storedSignature, liveCandidates, action: fixture.action }, config);
  const deterministicRepeatAgreement = JSON.stringify(matcherResult) === JSON.stringify(repeatResult);

  const { outcome: gateOutcome, reason } = classifyOutcome(facts.length, matcherResult);

  let outcome = gateOutcome;
  let isCorrect = null;
  if (gateOutcome === "accepted") {
    isCorrect = await _resolvesToGroundTruth(page, matcherResult.winner.selector, fixture);
    outcome = isCorrect ? "correct_heal" : "false_heal";
  }

  const collectMs = Number(collectEnd - collectStart) / 1e6;
  const scoreMs = Number(scoreEnd - scoreStart) / 1e6;

  return {
    id: fixture.id,
    mutationClass: fixture.mutationClass,
    action: fixture.action,
    mustRefuse: fixture.mustRefuse,
    description: fixture.description,
    rawCandidateCount: facts.length,
    matcherStatus: matcherResult.status,
    matcherReason: matcherResult.reason || null,
    margin: matcherResult.margin,
    winnerSelector: matcherResult.winner ? matcherResult.winner.selector : null,
    outcome,
    refusalReason: outcome === "refused" ? reason : null,
    collectMs,
    scoreMs,
    totalMs: collectMs + scoreMs,
    deterministicRepeatAgreement,
  };
}

/**
 * Build a synthetic ~5,000-node / 200-interactive-element DOM in-browser and
 * measure collection + scoring time against it. This is a MEASUREMENT, not
 * an assertion — EP-3/EP-5 state only a hypothesis ("well under 500ms") that
 * this function exists to check empirically; it reports the real number
 * either way, including if it exceeds the hypothesis.
 */
async function measureLargeDomPerformance(page, { salt = DEFAULT_SALT, config = {}, totalNodes = 5000, interactiveElements = 200 } = {}) {
  await page.setContent("<!doctype html><html><body><div id=\"root\"></div></body></html>", { waitUntil: "load" });
  await page.evaluate(
    ({ totalNodes: total, interactiveElements: interactive }) => {
      const root = document.getElementById("root");
      const frag = document.createDocumentFragment();
      let placed = 0;
      for (let i = 0; i < total; i++) {
        let el;
        if (placed < interactive && i % Math.floor(total / interactive) === 0) {
          el = document.createElement("button");
          el.setAttribute("data-testid", "perf-btn-" + placed);
          el.textContent = "Action " + placed;
          placed++;
        } else {
          el = document.createElement("div");
          el.className = "filler-node-" + (i % 7);
          el.textContent = "node " + i;
        }
        frag.appendChild(el);
      }
      root.appendChild(frag);
    },
    { totalNodes, interactiveElements }
  );

  const groundTruthFacts = await ElementFactsCollector.collectOne(page, '[data-testid="perf-btn-0"]');
  const storedSignature = ElementSignature.capture(
    {
      tagName: groundTruthFacts.tagName,
      role: groundTruthFacts.role,
      accessibleName: groundTruthFacts.accessibleName,
      attributes: groundTruthFacts.attributes,
      structuralPath: groundTruthFacts.structuralPath,
      ownText: groundTruthFacts.ownText,
      boundingBoxBucket: groundTruthFacts.boundingBoxBucket,
    },
    { salt }
  );

  const collectStart = process.hrtime.bigint();
  const facts = await ElementFactsCollector.collect(page, { action: "click" });
  const collectEnd = process.hrtime.bigint();

  const liveCandidates = _toLiveCandidates(facts, salt);

  const scoreStart = process.hrtime.bigint();
  CandidateMatcher.evaluate({ storedSignature, liveCandidates, action: "click" }, config);
  const scoreEnd = process.hrtime.bigint();

  const collectMs = Number(collectEnd - collectStart) / 1e6;
  const scoreMs = Number(scoreEnd - scoreStart) / 1e6;

  return {
    totalNodes,
    interactiveElements,
    rawCandidateCount: facts.length,
    collectMs,
    scoreMs,
    totalMs: collectMs + scoreMs,
  };
}

/**
 * Run the full published corpus once and return the aggregate report. Each
 * fixture gets its own fresh browser page (new `context`/`page` per
 * fixture) so nothing about one fixture's DOM, console state, or timers can
 * leak into the next one's measurement.
 */
async function runBenchmark({ corpusDir = DEFAULT_CORPUS_DIR, salt = DEFAULT_SALT, config = {}, headless = true, measurePerformance = true } = {}) {
  const { fixtures } = await loadCorpus(corpusDir);
  const browser = await chromium.launch({ headless });
  const perCase = [];
  try {
    for (const fixture of fixtures) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        const row = await runFixture(page, fixture, { salt, config });
        perCase.push(row);
      } finally {
        await context.close();
      }
    }

    let performance = null;
    if (measurePerformance) {
      const perfContext = await browser.newContext();
      const perfPage = await perfContext.newPage();
      try {
        performance = await measureLargeDomPerformance(perfPage, { salt, config });
      } finally {
        await perfContext.close();
      }
    }

    return _buildReport({ fixtures, perCase, salt, performance });
  } finally {
    await browser.close();
  }
}

function _buildReport({ fixtures, perCase, salt, performance }) {
  const N = perCase.length;
  const counts = { no_candidate: 0, refused: 0, correct_heal: 0, false_heal: 0 };
  for (const row of perCase) counts[row.outcome] += 1;

  const partitionSum = counts.no_candidate + counts.refused + counts.correct_heal + counts.false_heal;

  const totalTimes = perCase.map((r) => r.totalMs).sort((a, b) => a - b);
  const deterministicAgreementCount = perCase.filter((r) => r.deterministicRepeatAgreement).length;

  // Storage-size estimate: the bytes a LocatorMemory-shaped entries object
  // would occupy if every fixture's stored signature were persisted — the
  // same JSON shape `LocatorMemory._toPersistable()` writes, computed here
  // without touching the real store or disk.
  const storageShape = {};
  for (const fixture of fixtures) {
    storageShape[fixture.id] = { groundTruthId: fixture.groundTruthId };
  }
  const storageBytes = Buffer.byteLength(JSON.stringify(storageShape), "utf8");

  const rates = {};
  for (const key of Object.keys(counts)) {
    rates[key] = N > 0 ? counts[key] / N : 0;
  }

  return {
    generatedAt: new Date().toISOString(),
    salt,
    N,
    perCase,
    counts,
    rates,
    partitionSum,
    partitionValid: partitionSum === N,
    tier3FallbackCount: counts.no_candidate + counts.refused,
    timing: {
      meanMatchTimeMs: _mean(totalTimes),
      p95MatchTimeMs: _percentile(totalTimes, 95),
    },
    storageBytes,
    deterministicRepeatAgreement: {
      agreedCount: deterministicAgreementCount,
      total: N,
      rate: N > 0 ? deterministicAgreementCount / N : 0,
    },
    largeDomPerformance: performance,
  };
}

/**
 * CLI entry point: `node src/core/locator/HealingBenchmark.js [--out <path>] [--corpus <dir>] [--headed]`.
 * Writes the full report (aggregates + per-case log) to a gitignored path
 * under `reports/` by default. Prints a human-readable summary to stdout —
 * this is the one context where a `console.log`-style CLI print is
 * appropriate for this module (mirrors the existing `scripts/**` tools),
 * since `Logger` writes to `reports/execution.log`, not the terminal the
 * operator is reading the benchmark summary from.
 */
async function _main() {
  const args = process.argv.slice(2);
  const getFlag = (name, fallback) => {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  };
  const outPath = getFlag("--out", path.join(process.cwd(), "reports", "healing_benchmark.json"));
  const corpusDir = getFlag("--corpus", DEFAULT_CORPUS_DIR);
  const headless = !args.includes("--headed");

  Logger.info(`HealingBenchmark: running corpus at ${corpusDir}`);
  const report = await runBenchmark({ corpusDir, headless });

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(`\nHealingBenchmark: N=${report.N}  partitionValid=${report.partitionValid}`);
  // eslint-disable-next-line no-console
  console.log(
    `  no_candidate=${report.counts.no_candidate} (${(report.rates.no_candidate * 100).toFixed(1)}%)  `
    + `refused=${report.counts.refused} (${(report.rates.refused * 100).toFixed(1)}%)  `
    + `correct_heal=${report.counts.correct_heal} (${(report.rates.correct_heal * 100).toFixed(1)}%)  `
    + `false_heal=${report.counts.false_heal} (${(report.rates.false_heal * 100).toFixed(1)}%)`
  );
  // eslint-disable-next-line no-console
  console.log(`  tier3FallbackCount=${report.tier3FallbackCount}`);
  // eslint-disable-next-line no-console
  console.log(`  mean match time=${report.timing.meanMatchTimeMs.toFixed(3)}ms  p95=${report.timing.p95MatchTimeMs.toFixed(3)}ms`);
  if (report.largeDomPerformance) {
    // eslint-disable-next-line no-console
    console.log(
      `  large-DOM perf: ${report.largeDomPerformance.totalNodes} nodes / `
      + `${report.largeDomPerformance.interactiveElements} interactive -> `
      + `${report.largeDomPerformance.totalMs.toFixed(3)}ms (collect=${report.largeDomPerformance.collectMs.toFixed(3)}ms, `
      + `score=${report.largeDomPerformance.scoreMs.toFixed(3)}ms)`
    );
  }
  // eslint-disable-next-line no-console
  console.log(`  deterministic repeat agreement=${report.deterministicRepeatAgreement.agreedCount}/${report.deterministicRepeatAgreement.total}`);
  // eslint-disable-next-line no-console
  console.log(`  storageBytes=${report.storageBytes}`);
  // eslint-disable-next-line no-console
  console.log(`\nPer-case log:`);
  for (const row of report.perCase) {
    // eslint-disable-next-line no-console
    console.log(
      `  [${row.outcome.padEnd(13)}] ${row.id} (${row.mutationClass}, action=${row.action}) `
      + `raw=${row.rawCandidateCount} status=${row.matcherStatus}${row.matcherReason ? "/" + row.matcherReason : ""} `
      + `margin=${row.margin}`
    );
  }
  // eslint-disable-next-line no-console
  console.log(`\nFull report written to ${outPath}`);

  Logger.info(`HealingBenchmark: wrote report to ${outPath}`);
  await Logger.flush();
}

if (require.main === module) {
  _main().catch((err) => {
    Logger.error(`HealingBenchmark: run failed - ${err.message}`);
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_CORPUS_DIR,
  GROUND_TRUTH_ATTR,
  DEFAULT_SALT,
  loadCorpus,
  runFixture,
  runBenchmark,
  measureLargeDomPerformance,
  classifyOutcome,
};
