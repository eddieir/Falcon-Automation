"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const ReportManager = require(path.join(__dirname, "..", "..", "src/core/ReportManager"));
const Verification = require(path.join(__dirname, "..", "..", "src/core/outcome/Verification"));

/**
 * m1-report-verification.check.cjs — WP-79a regression coverage.
 *
 * Proves buildReport's new `verification` key is additive: every existing
 * field (summary, result, tests, exit-code-relevant result value, etc.)
 * is byte-identical to the pre-WP-79a shape once `verification` is removed,
 * for several fixtures, and that the block itself equals
 * Verification.aggregateRun(tests).
 */

const FIXTURES = {
    empty: {},
    allPassedNoAssertions: { tests: [{ name: "a", status: "passed" }, { name: "b", status: "passed" }] },
    businessVerified: { tests: [{ name: "a", status: "passed", assertion: { check: "visible" } }] },
    failedAssertion: { tests: [{ name: "a", status: "passed" }, { name: "b", status: "failed", assertion: { check: "visible" } }] },
    quarantinedAssertionFail: { tests: [{ name: "a", status: "quarantined", assertion: { check: "visible" } }] },
    skippedAssertion: { tests: [{ name: "a", status: "skipped", assertion: { check: "visible" } }] },
    unavailableAssertion: { tests: [{ name: "a", status: "unavailable", assertion: { check: "visible" } }] },
    malformedAssertion: { tests: [{ name: "a", status: "passed", assertion: "nope" }] },
    dedupedMixed: { tests: [{ name: "a", status: "passed" }, { name: "b", status: "deduped" }] },
    skippedOnly: { tests: [{ name: "a", status: "skipped" }] },
    legacyPartial: {
        tests: [{ name: "a", status: "passed" }, { name: "b", status: "unavailable" }, { name: "c", status: "quarantined" }],
        coverage: { pagesTested: 1 },
        pages: [{ url: "u", status: "tested" }],
        healingEvents: [{ resolved: true }],
        uiIssues: [{ type: "t" }],
    },
};

// Previous (pre-WP-79a) buildReport shape, inlined verbatim as the golden
// reference — same approach as tests/regression/p16-report.check.cjs.
function oldReport({ tests = [], uiIssues = [], healingEvents = [], coverage = null, pages = [], timings = null }, runId, duration) {
    const c = (s) => tests.filter((t) => t.status === s).length;
    const passed = c("passed"), failed = c("failed"), skipped = c("skipped"), quarantined = c("quarantined"), deduped = c("deduped"), unavailable = c("unavailable");
    const total = tests.length;
    const verified = passed + failed + quarantined + unavailable;
    let result;
    if (verified === 0) result = "NO_TESTS_RUN";
    else if (failed === 0 && unavailable === 0) result = "PASSED";
    else if (passed === 0) result = "FAILED";
    else result = "PARTIAL";
    const report = { runId, duration, summary: { total, passed, failed, skipped, quarantined, deduped, unavailable }, result, tests, uiIssues, healingEvents, coverage, pages };
    if (timings && typeof timings === "object") report.execution = { timings };
    return report;
}

test("buildReport's verification key is additive: all other fields byte-identical to the pre-WP-79a shape", () => {
    for (const [name, fixture] of Object.entries(FIXTURES)) {
        const report = ReportManager.buildReport({ ...fixture, runId: "R", duration: "1.00s" });
        assert.ok("verification" in report, name);
        const { verification, ...withoutVerification } = report;
        const golden = oldReport(fixture, "R", "1.00s");
        assert.strictEqual(JSON.stringify(withoutVerification, null, 2), JSON.stringify(golden, null, 2), name);
        assert.deepStrictEqual(Object.keys(withoutVerification).sort(), Object.keys(golden).sort(), name);
    }
});

test("the verification block equals Verification.aggregateRun(tests) directly", () => {
    for (const [name, fixture] of Object.entries(FIXTURES)) {
        const report = ReportManager.buildReport({ ...fixture, runId: "R", duration: "1.00s" });
        assert.deepStrictEqual(report.verification, Verification.aggregateRun(fixture.tests || []), name);
    }
});

test("result value driving the exit code is untouched by the new key", () => {
    const passReport = ReportManager.buildReport({ tests: [{ name: "a", status: "passed" }], runId: "R", duration: "0s" });
    assert.strictEqual(passReport.result, "PASSED");
    assert.ok(passReport.verification);

    const failReport = ReportManager.buildReport({ tests: [{ name: "a", status: "failed" }], runId: "R", duration: "0s" });
    assert.strictEqual(failReport.result, "FAILED");
    assert.ok(failReport.verification);
});

test("verification is order-independent at the report level, same as the pure Verification module", () => {
    const rows = [
        { name: "a", status: "passed", assertion: { check: "visible" } },
        { name: "b", status: "failed", assertion: { check: "visible" } },
        { name: "c", status: "deduped" },
    ];
    const r1 = ReportManager.buildReport({ tests: rows, runId: "R", duration: "0s" });
    const r2 = ReportManager.buildReport({ tests: [...rows].reverse(), runId: "R", duration: "0s" });
    assert.deepStrictEqual(r1.verification, r2.verification);
});

test("buildReport's existing status validation is unchanged (still throws on a bogus status)", () => {
    assert.throws(() => ReportManager.buildReport({ tests: [{ status: "bogus" }] }), TypeError);
});
