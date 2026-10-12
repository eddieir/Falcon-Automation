"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ReportManager = require(path.join(__dirname, "..", "..", "src/core/ReportManager"));

// Previous generateReport tally/shape, inlined verbatim as the golden reference.
function oldReport({ tests = [], uiIssues = [], healingEvents = [], coverage = null, pages = [] }, runId, duration) {
    const c = (s) => tests.filter((t) => t.status === s).length;
    const passed = c("passed"), failed = c("failed"), skipped = c("skipped"), quarantined = c("quarantined"), deduped = c("deduped"), unavailable = c("unavailable");
    const total = tests.length;
    const verified = passed + failed + quarantined + unavailable;
    let result;
    if (verified === 0) result = "NO_TESTS_RUN";
    else if (failed === 0 && unavailable === 0) result = "PASSED";
    else if (passed === 0) result = "FAILED";
    else result = "PARTIAL";
    return { runId, duration, summary: { total, passed, failed, skipped, quarantined, deduped, unavailable }, result, tests, uiIssues, healingEvents, coverage, pages };
}
const CASES = {
    empty: {},
    passed: { tests: [{ name: "a", status: "passed", duration: 1 }, { name: "b", status: "deduped" }] },
    failed: { tests: [{ name: "a", status: "failed", error: "x" }] },
    partial: { tests: [{ name: "a", status: "passed" }, { name: "b", status: "unavailable" }, { name: "c", status: "quarantined" }], coverage: { pagesTested: 1 }, pages: [{ url: "u", status: "tested" }], healingEvents: [{ resolved: true }], uiIssues: [{ type: "t" }] },
    skippedOnly: { tests: [{ name: "a", status: "skipped" }] },
};

test("buildReport is byte-identical to the previous implementation", () => {
    for (const [k, o] of Object.entries(CASES)) {
        assert.strictEqual(JSON.stringify(ReportManager.buildReport({ ...o, runId: "R", duration: "1.00s" }), null, 2),
            JSON.stringify(oldReport(o, "R", "1.00s"), null, 2), k);
    }
});

test("generateReport writes the same bytes as the previous implementation (volatile fields normalised)", () => {
    const cwd = process.cwd(); const log = console.log; const code = process.exitCode;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p16r-"));
    process.chdir(dir); console.log = () => {};
    try {
        for (const [k, o] of Object.entries(CASES)) {
            const rm = new ReportManager(); rm.startRun();
            const rep = rm.generateReport(o);
            const written = JSON.parse(fs.readFileSync(path.join(dir, "reports", "test-report.json"), "utf8"));
            assert.deepStrictEqual(written, JSON.parse(JSON.stringify(rep)));
            const norm = { ...written, runId: "R", duration: "D" };
            assert.strictEqual(JSON.stringify(norm, null, 2), JSON.stringify(oldReport(o, "R", "D"), null, 2), k);
            assert.deepStrictEqual(Object.keys(written), Object.keys(oldReport(o, "R", "D")));
            assert.strictEqual(process.exitCode, written.result === "PASSED" ? 0 : 1);
        }
    } finally { process.chdir(cwd); console.log = log; process.exitCode = code; }
});

test("buildReport is pure: no console, no exit code, no files, deterministic", () => {
    const log = console.log; const code = process.exitCode; let calls = 0;
    console.log = () => { calls++; };
    try {
        process.exitCode = undefined;
        const a = ReportManager.buildReport({ tests: [{ name: "a", status: "failed" }], runId: "R", duration: "0s" });
        const b = ReportManager.buildReport({ tests: [{ name: "a", status: "failed" }], runId: "R", duration: "0s" });
        assert.deepStrictEqual(a, b);
        assert.strictEqual(calls, 0);
        assert.strictEqual(process.exitCode, undefined);
    } finally { console.log = log; process.exitCode = code; }
});

test("buildReport keeps the validation errors", () => {
    assert.throws(() => ReportManager.buildReport({ tests: [{ status: "bogus" }] }), TypeError);
    assert.throws(() => ReportManager.buildReport({ tests: "x" }), TypeError);
    assert.throws(() => ReportManager.buildReport({ coverage: [] }), TypeError);
});
