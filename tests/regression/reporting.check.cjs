const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Report = require("../../src/core/ReportManager");
const { load, silent, temp } = require("./helpers.cjs");
for (const [statuses, result, exit] of [
  [["passed"], "PASSED", 0],
  [["failed"], "FAILED", 1],
  [["passed", "failed"], "PARTIAL", 1],
  [["skipped"], "PASSED", 0],
  [[], "NO_TESTS_RUN", 1],
  [["passed", "skipped"], "PASSED", 0],
  // Phase 9 — a quarantined result is a real failure that a human has
  // explicitly decided must not block the run. It must never be silently
  // merged into "passed", and it must never be enough on its own to flip
  // the run to FAILED — but a genuine (non-quarantined) failure alongside
  // one still must.
  [["quarantined"], "PASSED", 0],
  [["passed", "quarantined"], "PASSED", 0],
  [["quarantined", "quarantined"], "PASSED", 0],
  [["failed", "quarantined"], "FAILED", 1],
  [["passed", "failed", "quarantined"], "PARTIAL", 1],
  // Phase 10 — "deduped" marks a scenario that was never executed on this
  // page because a byte-identical instruction already ran on an earlier one.
  // It has no outcome, so it must behave like neither a pass nor a failure:
  // it can never fail a run on its own, and — the part that matters — it can
  // never turn a genuinely failing run green either. The exit code is asserted
  // directly rather than inferred from the printed summary, because Phase 6
  // exists precisely because CI was green regardless of the real results.
  [["deduped"], "PASSED", 0],
  [["deduped", "deduped"], "PASSED", 0],
  [["passed", "deduped"], "PASSED", 0],
  [["skipped", "deduped"], "PASSED", 0],
  [["quarantined", "deduped"], "PASSED", 0],
  [["failed", "deduped"], "FAILED", 1],
  [["passed", "failed", "deduped"], "PARTIAL", 1],
  [["passed", "failed", "skipped", "quarantined", "deduped"], "PARTIAL", 1],
]) {
  test(`report tallies ${statuses.join("/") || "empty"} accurately`, (t) => {
    const cwd = process.cwd(),
      dir = temp(),
      oldCode = process.exitCode,
      log = console.log;
    process.chdir(dir);
    // generateReport() prints a real emoji summary (✅/❌/⚠️) straight to
    // stdout for humans running `node tests/...js` directly — useful there,
    // but node:test's own TAP reporter is also reading this process's stdout
    // while the test runs, and on some Node builds a raw emoji line (in
    // particular the ⚠️ variation-selector sequence) isn't valid TAP and
    // corrupts the parser (ERR_TAP_LEXER_ERROR), failing this test for a
    // reason that has nothing to do with what it's actually checking.
    // Silencing console.log for the duration of the call under test —
    // exactly the same "mock the noisy side channel" pattern already used
    // for Logger further down this file — keeps the assertions the same
    // while not leaking output into the TAP stream.
    console.log = () => {};
    t.after(() => {
      console.log = log;
      process.chdir(cwd);
      process.exitCode = oldCode;
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const manager = new Report();
    manager.startRun();
    const tests = statuses.map((status, i) => ({ name: `case ${i}`, status }));
    const report = manager.generateReport({
      tests,
      uiIssues: [{ type: "fixture" }],
      healingEvents: [{ original: "#old" }],
    });
    assert.equal(process.exitCode, exit);
    process.exitCode = oldCode;
    assert.equal(report.result, result);
    assert.equal(report.summary.total, statuses.length);
    for (const status of [
      "passed",
      "failed",
      "skipped",
      "quarantined",
      "deduped",
    ])
      assert.equal(
        report.summary[status],
        statuses.filter((s) => s === status).length,
      );
    // Absent a sweep, the new fields are present and empty rather than
    // missing — consumers of test-report.json should not have to branch.
    assert.equal(report.coverage, null);
    assert.deepEqual(report.pages, []);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(dir, "reports/test-report.json"))),
      report,
    );
    assert.match(report.duration, /^\d+\.\d{2}s$/);
  });
}
// Run `fn(dir)` in a throwaway cwd with console.log muted and process.exitCode
// restored afterwards — see the long comment above for why generateReport()'s
// emoji output must not reach node:test's TAP parser.
const inTempDir = (fn) => {
  const cwd = process.cwd();
  const dir = temp();
  const oldCode = process.exitCode;
  const log = console.log;
  process.chdir(dir);
  console.log = () => {};
  try {
    return fn(dir);
  } finally {
    console.log = log;
    process.chdir(cwd);
    process.exitCode = oldCode;
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
for (const status of ["quarantined", "deduped"])
  test(`report rejects a genuinely invalid status, but accepts '${status}' as valid`, () => {
    const manager = new Report();
    assert.throws(
      () => manager.generateReport({ tests: [{ name: "x", status: "bogus" }] }),
      TypeError,
    );
    assert.doesNotThrow(() =>
      inTempDir(() =>
        manager.generateReport({ tests: [{ name: "x", status }] }),
      ),
    );
  });
test("report persists the sweep's coverage block and per-page breakdown", () => {
  const coverage = {
    pagesDiscovered: 13,
    pagesTested: 11,
    pagesSkipped: 2,
    pagesUnreachable: 0,
    scenariosGenerated: 184,
    scenariosDeduplicated: 93,
    budgetExhausted: false,
  };
  const pages = [
    { url: "http://a.test/", status: "tested", summary: { passed: 2 } },
    { url: "http://a.test/x", status: "skipped", reason: "max-pages" },
    { url: "http://a.test/y", status: "skipped", reason: "max-pages" },
  ];
  const { report, onDisk } = inTempDir((dir) => {
    const manager = new Report();
    manager.startRun();
    return {
      report: manager.generateReport({
        tests: [
          { name: "a", status: "passed" },
          { name: "b", status: "deduped", firstRunOn: "http://a.test/" },
        ],
        coverage,
        pages,
      }),
      onDisk: JSON.parse(
        fs.readFileSync(path.join(dir, "reports/test-report.json")),
      ),
    };
  });
  assert.deepEqual(report.coverage, coverage);
  assert.deepEqual(report.pages, pages);
  // Persisted, not merely returned: test-report.json is what CI and the
  // dashboard read, and a coverage claim that only exists in memory is no
  // coverage claim at all.
  assert.deepEqual(onDisk, report);
  assert.equal(report.summary.deduped, 1);
  // The deduped entry is kept verbatim, firstRunOn included, so a reader can
  // see which page actually exercised the shared control.
  assert.equal(report.tests[1].firstRunOn, "http://a.test/");
});
test("report rejects malformed coverage and pages", () => {
  const manager = new Report();
  for (const bad of [{ coverage: [] }, { coverage: "none" }, { pages: {} }])
    assert.throws(() => manager.generateReport({ tests: [], ...bad }), TypeError);
  // null coverage is the documented "this run was not a sweep" value.
  assert.doesNotThrow(() =>
    inTempDir(() => manager.generateReport({ tests: [], coverage: null })),
  );
});
for (const [coverage, pages, expected] of [
  [
    {
      pagesTested: 11,
      pagesSkipped: 2,
      pagesUnreachable: 0,
      scenariosGenerated: 184,
      scenariosDeduplicated: 93,
    },
    [
      { status: "skipped", reason: "max-pages" },
      { status: "skipped", reason: "max-pages" },
    ],
    "Pages: 11 tested, 2 skipped (max-pages) | Scenarios: 184 generated, 93 deduped",
  ],
  // Every page not tested must carry an explicit reason, and distinct
  // reasons must stay distinguishable rather than collapsing into one count.
  [
    {
      pagesTested: 3,
      pagesSkipped: 2,
      pagesUnreachable: 1,
      scenariosGenerated: 40,
      scenariosDeduplicated: 4,
      budgetExhausted: true,
    },
    [
      { status: "skipped", reason: "max-pages" },
      { status: "skipped", reason: "budget-exhausted" },
      { status: "unreachable", reason: "net::ERR_ABORTED" },
    ],
    "Pages: 3 tested, 2 skipped (max-pages, budget-exhausted), 1 unreachable [budget exhausted] | Scenarios: 40 generated, 4 deduped",
  ],
  // A sweep that reached everything says so without a stray empty "()".
  [
    {
      pagesTested: 1,
      pagesSkipped: 0,
      pagesUnreachable: 0,
      scenariosGenerated: 7,
      scenariosDeduplicated: 0,
    },
    [{ url: "http://a.test/", status: "tested" }],
    "Pages: 1 tested, 0 skipped | Scenarios: 7 generated, 0 deduped",
  ],
  // Missing counts read as zero rather than "undefined".
  [
    {},
    [],
    "Pages: 0 tested, 0 skipped | Scenarios: 0 generated, 0 deduped",
  ],
])
  test(`coverage line reads "${expected.slice(0, 40)}…"`, () => {
    assert.equal(Report.coverageLine(coverage, pages), expected);
  });
for (const [content, expected] of [
  [" #new ", "#new"],
  ["null", null],
  ["", null],
]) {
  test(`standalone locator analysis normalizes ${content || "empty response"}`, async () => {
    const Analyser = load("src/core/AIHealer/AIAnalyser.js", {
      "../../../utils/Logger": silent,
      dotenv: { config() {} },
    });
    Analyser._client = async () => ({
      chat: {
        completions: {
          create: async (request) => {
            assert.match(request.messages[1].content, /fixture/);
            return { choices: [{ message: { content } }] };
          },
        },
      },
    });
    assert.equal(await Analyser.getAlternativeLocator("fixture"), expected);
  });
}
for (const status of [401, 429, 500])
  test(`standalone locator analysis tolerates provider ${status}`, async () => {
    const Analyser = load("src/core/AIHealer/AIAnalyser.js", {
      "../../../utils/Logger": silent,
      dotenv: { config() {} },
    });
    Analyser._client = async () => {
      throw Object.assign(Error("provider error"), { status });
    };
    assert.equal(await Analyser.getAlternativeLocator("fixture"), null);
  });
