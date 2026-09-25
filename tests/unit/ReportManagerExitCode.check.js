const assert = require("assert");
const ReportManager = require("../../src/core/ReportManager");

/**
 * ReportManagerExitCode.test.js — regression test for the Phase 6 exit-code fix.
 *
 * Context: every scenario test file in this repo (LoginTest, CheckoutTest,
 * UserApiTest, ProductApiTest, UserDBTest, OrderDBTest) reports its outcome
 * through ReportManager.generateReport(). Before Phase 6, the Node process
 * always exited 0 regardless of the tallied result, because nothing ever set
 * process.exitCode or called process.exit(). Since every CI step is a plain
 * `run: node tests/....js` command, a real test failure never actually failed
 * its CI step — only a crash did.
 *
 * generateReport() now sets process.exitCode based on the tallied result.
 * This is the one thing that makes every CI step in ci.yml a real signal
 * instead of a formality, so it needs its own test that can't be silently
 * broken by a future refactor of ReportManager. There's no test framework
 * wired into this repo (no Jest/Mocha) — this follows the same plain
 * Node + assert + non-zero-exit-on-failure convention every other test file
 * here already uses.
 *
 * Each case below calls generateReport(), captures the exitCode it just
 * set, then immediately resets process.exitCode so this test script's own
 * final exit status reflects whether *these assertions* passed — not a
 * side effect of the last case exercised.
 */

const reportManager = new ReportManager();
let failures = 0;

function check(label, tests, expectedResult, expectedExitCode) {
    reportManager.startRun();
    const report = reportManager.generateReport({ tests });
    const actualExitCode = process.exitCode;
    process.exitCode = 0; // reset before the next case / before this script exits

    try {
        assert.strictEqual(report.result, expectedResult);
        assert.strictEqual(
            actualExitCode,
            expectedExitCode,
            `${label}: expected process.exitCode ${expectedExitCode}, got ${actualExitCode}`
        );
        console.log(`✅ ${label}`);
    } catch (error) {
        failures++;
        console.error(`❌ ${label}: ${error.message}`);
    }
}

// A clean pass must exit 0 — this is the case every CI step depends on to
// know "nothing to see here."
check(
    "all tests passed → PASSED → exit 0",
    [{ name: "a", status: "passed" }, { name: "b", status: "passed" }],
    "PASSED",
    0
);

// This is the exact case that was silently broken before Phase 6: a real
// failure must produce a non-zero exit code, or CI can never catch it.
check(
    "a real failure → FAILED → exit 1",
    [{ name: "a", status: "failed", error: "boom" }],
    "FAILED",
    1
);

// Mixed pass/fail (PARTIAL) must still fail the process — "some tests
// failed" is not an acceptable green build.
check(
    "mixed pass/fail → PARTIAL → exit 1",
    [{ name: "a", status: "passed" }, { name: "b", status: "failed", error: "boom" }],
    "PARTIAL",
    1
);

// Phase 11 corrects this case. A skip-only run verified nothing — no
// passed, no failed, no quarantined — so it must report NO_TESTS_RUN and
// exit 1, exactly like an all-deduped or an empty run, rather than PASSED.
// Before this phase, generateReport() only gated on `failed === 0`, so a run
// whose every scenario was skipped (a non-click target that never reached
// the healer, back when a missing target short-circuited before AIHealer
// ever saw it) still reported PASSED — the same class of false green Phase 6
// exists to kill, just reached through `skipped` instead of a swallowed
// exception.
//
// The DB tests used to reach this case: both pushed a single `skipped`
// result when no local database was configured, and relied on the old
// PASSED/exit-0 contract so `npm run test:db` stayed green for a contributor
// without Postgres. They no longer produce a report at all on that path —
// running without a database is a declaration that nothing was verified, not
// a verdict — so this case now describes only what it says it does. See
// tests/unit/DBConfigBehavior.check.js for the three branches that replaced it.
check(
    "all tests skipped, none failed → NO_TESTS_RUN → exit 1",
    [{ name: "a", status: "skipped" }],
    "NO_TESTS_RUN",
    1
);

// No results pushed at all is itself a signal something is wrong (a test
// that silently never ran) — this should not read as a quiet success.
check(
    "no tests recorded → NO_TESTS_RUN → exit 1",
    [],
    "NO_TESTS_RUN",
    1
);

if (failures > 0) {
    console.error(`\n❌ ReportManagerExitCode: ${failures} case(s) failed`);
    process.exitCode = 1;
} else {
    console.log("\n✅ ReportManagerExitCode: all cases passed");
}
