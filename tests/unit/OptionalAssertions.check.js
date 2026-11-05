"use strict";

/**
 * OptionalAssertions.check.js — unit coverage for optional (`required: false`)
 * contract assertions (WP-77I) across Verification.aggregateRun,
 * Verification.trustedOptionalIndexes and ReportManager.buildReport.
 * Plain node + assert, exits non-zero on failure.
 */

const assert = require("assert");
const Verification = require("../../src/core/outcome/Verification");
const ReportManager = require("../../src/core/ReportManager");

const { aggregateRun, trustedOptionalIndexes, REASON_CODES } = Verification;

let failures = 0;
let passed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (e) {
        failures++;
        console.error(`❌ ${name}: ${e && e.stack ? e.stack : e}`);
    }
}

const D1 = "sha256:" + "a".repeat(64);
const D2 = "sha256:" + "b".repeat(64);

function bound(status, required, id = "a1", digest = D1) {
    return {
        name: `row-${id}`,
        status,
        required,
        assertion: { id, digest, check: "pathEquals", locator: "url:pathname" },
    };
}

function report(tests, provenance) {
    return ReportManager.buildReport({ tests, runId: "r1", duration: "0s", verificationProvenance: provenance });
}

test("optional pass does not increase required counts; BUSINESS_VERIFIED needs a required pass", () => {
    const v = aggregateRun([bound("passed", true, "r1"), bound("passed", false, "o1")]);
    assert.strictEqual(v.level, "BUSINESS_VERIFIED");
    assert.strictEqual(v.assertions.required, 1);
    assert.strictEqual(v.assertions.pass, 1);
    assert.deepStrictEqual(v.assertions.optional, { total: 1, pass: 1, fail: 0, inconclusive: 0, notTested: 0 });
});

test("optional-only run is INTERACTION_ONLY and never BUSINESS_VERIFIED", () => {
    const v = aggregateRun([bound("passed", false, "o1")]);
    assert.strictEqual(v.level, "INTERACTION_ONLY");
    assert.ok(v.reasonCodes.includes(REASON_CODES.NO_REQUIRED_ASSERTIONS));
    assert.strictEqual(v.assertions.required, 0);
    assert.strictEqual(v.assertions.optional.pass, 1);
});

test("optional failure is visible, flagged, and does not change the level", () => {
    const v = aggregateRun([bound("passed", true, "r1"), bound("failed", false, "o1")]);
    assert.strictEqual(v.level, "BUSINESS_VERIFIED");
    assert.strictEqual(v.assertions.fail, 0, "optional failure must not count as a required failure");
    assert.strictEqual(v.assertions.optional.fail, 1);
    assert.ok(v.reasonCodes.includes(REASON_CODES.OPTIONAL_FAILED));
});

test("required failure with an optional pass is FAILED", () => {
    const v = aggregateRun([bound("failed", true, "r1"), bound("passed", false, "o1")]);
    assert.strictEqual(v.level, "FAILED");
    assert.strictEqual(v.assertions.fail, 1);
});

test("optional unavailable, skipped and quarantined are reported accurately", () => {
    const base = [bound("passed", true, "r1")];
    const un = aggregateRun([...base, bound("unavailable", false, "o1")]);
    assert.strictEqual(un.assertions.optional.inconclusive, 1);
    assert.ok(un.reasonCodes.includes(REASON_CODES.OPTIONAL_UNVERIFIED));
    assert.strictEqual(un.level, "BUSINESS_VERIFIED");

    const sk = aggregateRun([...base, bound("skipped", false, "o1")]);
    assert.strictEqual(sk.assertions.optional.notTested, 1);
    assert.ok(sk.reasonCodes.includes(REASON_CODES.OPTIONAL_UNVERIFIED));

    const qu = aggregateRun([...base, bound("quarantined", false, "o1")]);
    assert.strictEqual(qu.assertions.optional.fail, 1, "a quarantine never hides an optional failure");
    assert.ok(qu.reasonCodes.includes(REASON_CODES.OPTIONAL_FAILED));
});

test("FORGED: unproven provenance treats a required:false claim as a required FAIL", () => {
    const rows = [bound("passed", true, "r1"), bound("failed", false, "o1")];
    const v = aggregateRun(rows, { approvalProvenance: "unproven" });
    assert.strictEqual(v.level, "FAILED");
    assert.ok(v.reasonCodes.includes(REASON_CODES.OPTIONAL_CLAIM_UNTRUSTED));
    assert.strictEqual(v.assertions.optional, undefined);
    assert.strictEqual(trustedOptionalIndexes(rows, { approvalProvenance: "unproven" }).size, 0);
});

test("FORGED through ReportManager: an untrusted failing optional claim still fails the run", () => {
    const r = report([bound("passed", true, "r1"), bound("failed", false, "o1")], "unproven");
    assert.notStrictEqual(r.result, "PASSED");
    assert.strictEqual(r.summary.failed, 1);
    assert.strictEqual(r.summary.optionalNotPassed, undefined);
    assert.strictEqual(r.verification.level, "FAILED");
});

test("ReportManager: trusted optional failure is a warning, result stays PASSED", () => {
    const r = report([bound("passed", true, "r1"), bound("failed", false, "o1")]);
    assert.strictEqual(r.result, "PASSED");
    assert.strictEqual(r.summary.failed, 0);
    assert.strictEqual(r.summary.optionalNotPassed, 1);
    assert.strictEqual(r.summary.total, 2);
    assert.strictEqual(r.verification.assertions.optional.fail, 1);
});

test("ReportManager: a required failure is never excluded", () => {
    const r = report([bound("failed", true, "r1"), bound("failed", false, "o1")]);
    assert.notStrictEqual(r.result, "PASSED");
    assert.strictEqual(r.summary.failed, 1);
    assert.strictEqual(r.summary.optionalNotPassed, 1);
});

test("contradictory approval evidence (two digests) makes optional claims untrusted", () => {
    const rows = [bound("passed", true, "r1", D1), bound("failed", false, "o1", D2)];
    assert.strictEqual(trustedOptionalIndexes(rows).size, 0);
    const v = aggregateRun(rows);
    assert.notStrictEqual(v.level, "BUSINESS_VERIFIED");
    assert.ok(v.reasonCodes.includes(REASON_CODES.OPTIONAL_CLAIM_UNTRUSTED));
    const r = report(rows);
    assert.notStrictEqual(r.result, "PASSED");
});

test("malformed optional claim (bad id or digest) is treated as required", () => {
    const badDigest = { ...bound("failed", false, "o1"), assertion: { id: "o1", digest: "nope", check: "pathEquals", locator: "url:pathname" } };
    const badId = { ...bound("failed", false, ""), assertion: { id: "", digest: D1, check: "pathEquals", locator: "url:pathname" } };
    for (const bad of [badDigest, badId]) {
        const rows = [bound("passed", true, "r1"), bad];
        assert.strictEqual(trustedOptionalIndexes(rows).size, 0);
        assert.strictEqual(report(rows).verification.level, "FAILED");
        assert.notStrictEqual(report(rows).result, "PASSED");
    }
});

test("unbound plain rows with required:false are never optional", () => {
    const plain = { name: "p", status: "failed", required: false, assertion: { check: "pathEquals", locator: "url:pathname" } };
    assert.strictEqual(trustedOptionalIndexes([plain]).size, 0);
    const r = report([plain]);
    assert.notStrictEqual(r.result, "PASSED");
    assert.strictEqual(r.summary.optionalNotPassed, undefined);
});

test("without optional rows the result shapes are unchanged", () => {
    const v = aggregateRun([bound("passed", true, "r1")]);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(v.assertions, "optional"), false);
    const r = report([bound("passed", true, "r1")]);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(r.summary, "optionalNotPassed"), false);
    assert.deepStrictEqual(Object.keys(r.summary), ["total", "passed", "failed", "skipped", "quarantined", "deduped", "unavailable"]);
});

test("aggregation is order independent with optional rows", () => {
    const rows = [bound("passed", true, "r1"), bound("failed", false, "o1"), bound("unavailable", false, "o2")];
    const a = JSON.stringify(aggregateRun(rows));
    const b = JSON.stringify(aggregateRun([...rows].reverse()));
    assert.strictEqual(a, b);
});

console.log(`\n${passed} passed, ${failures} failed`);
process.exitCode = failures > 0 ? 1 : 0;
