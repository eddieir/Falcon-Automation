"use strict";

/**
 * Verification.check.js — unit coverage for src/core/outcome/Verification.js
 * (WP-79a). Plain node + assert, exits non-zero on failure, same convention
 * as the other tests/unit/*.check.js files (e.g. CiWait.check.js).
 *
 * Table-driven over the negative matrix in
 * docs/roadmap/M1-DETAILED-IMPLEMENTATION-PLAN.md section 2 (N1-N13 subset
 * achievable with legacy rows) plus the aggregation invariants from
 * docs/roadmap/BUSINESS-CORRECTNESS-CONTRACT.md section 3.
 */

const assert = require("assert");
const { classifyRow, aggregateRun, REASON_CODES } = require("../../src/core/outcome/Verification");

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

function row(status, assertion) {
    const r = { name: "x", status };
    if (assertion !== undefined) r.assertion = assertion;
    return r;
}

// ---------------------------------------------------------------------
// classifyRow — per-row mapping
// ---------------------------------------------------------------------

test("classifyRow: passed + assertion -> PASS", () => {
    const c = classifyRow(row("passed", { check: "visible" }));
    assert.strictEqual(c.assertionOutcome, "PASS");
    assert.strictEqual(c.ignored, false);
});

test("classifyRow: failed + assertion -> FAIL", () => {
    const c = classifyRow(row("failed", { check: "visible" }));
    assert.strictEqual(c.assertionOutcome, "FAIL");
});

test("classifyRow: unavailable + assertion -> INCONCLUSIVE", () => {
    const c = classifyRow(row("unavailable", { check: "visible" }));
    assert.strictEqual(c.assertionOutcome, "INCONCLUSIVE");
});

test("classifyRow: skipped + assertion -> NOT_TESTED", () => {
    const c = classifyRow(row("skipped", { check: "visible" }));
    assert.strictEqual(c.assertionOutcome, "NOT_TESTED");
});

test("classifyRow: quarantined + assertion -> FAIL (Q1, never hidden)", () => {
    const c = classifyRow(row("quarantined", { check: "visible" }));
    assert.strictEqual(c.assertionOutcome, "FAIL");
});

test("classifyRow: malformed assertion (array) -> INCONCLUSIVE + MALFORMED_ASSERTION, regardless of status", () => {
    for (const status of ["passed", "failed", "quarantined"]) {
        const c = classifyRow(row(status, ["not", "an", "object"]));
        assert.strictEqual(c.assertionOutcome, "INCONCLUSIVE", status);
        assert.deepStrictEqual(c.reasonCodes, [REASON_CODES.MALFORMED_ASSERTION], status);
    }
});

test("classifyRow: malformed assertion (string/number/null) -> INCONCLUSIVE + MALFORMED_ASSERTION", () => {
    for (const bad of ["x", 42, null]) {
        const c = classifyRow(row("passed", bad));
        assert.strictEqual(c.assertionOutcome, "INCONCLUSIVE");
        assert.deepStrictEqual(c.reasonCodes, [REASON_CODES.MALFORMED_ASSERTION]);
    }
});

test("classifyRow: deduped -> ignored entirely, even with an assertion present", () => {
    const c1 = classifyRow(row("deduped"));
    const c2 = classifyRow(row("deduped", { check: "visible" }));
    assert.strictEqual(c1.ignored, true);
    assert.strictEqual(c2.ignored, true);
});

test("classifyRow: passed without assertion -> interaction", () => {
    const c = classifyRow(row("passed"));
    assert.strictEqual(c.interaction, true);
    assert.strictEqual(c.assertionOutcome, null);
});

test("classifyRow: failed/unavailable without assertion -> technical failure", () => {
    assert.strictEqual(classifyRow(row("failed")).technicalFailure, true);
    assert.strictEqual(classifyRow(row("unavailable")).technicalFailure, true);
});

test("classifyRow: skipped/quarantined without assertion -> no contribution", () => {
    const a = classifyRow(row("skipped"));
    const b = classifyRow(row("quarantined"));
    assert.strictEqual(a.interaction, false);
    assert.strictEqual(a.technicalFailure, false);
    assert.strictEqual(a.assertionOutcome, null);
    assert.strictEqual(b.interaction, false);
    assert.strictEqual(b.technicalFailure, false);
    assert.strictEqual(b.assertionOutcome, null);
});

// ---------------------------------------------------------------------
// aggregateRun — negative matrix (N1-N13 subset) and block shape
// ---------------------------------------------------------------------

test("N1: all required assertions pass -> BUSINESS_VERIFIED", () => {
    const r = aggregateRun([row("passed", { check: "visible" }), row("passed", { check: "visible" })]);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
    assert.strictEqual(r.assertions.required, 2);
    assert.strictEqual(r.assertions.pass, 2);
    assert.strictEqual(r.journeys.businessVerified, 1);
    assert.strictEqual(r.journeys.total, 1);
    assert.deepStrictEqual(r.reasonCodes, []);
});

test("N2: one required assertion fails -> FAILED", () => {
    const r = aggregateRun([row("passed", { check: "visible" }), row("failed", { check: "visible" })]);
    assert.strictEqual(r.level, "FAILED");
    assert.strictEqual(r.journeys.failed, 1);
});

test("N3: required assertion never runs (earlier step failed) -> UNVERIFIED", () => {
    const r = aggregateRun([row("skipped", { check: "visible" })]);
    assert.strictEqual(r.level, "UNVERIFIED");
    assert.strictEqual(r.assertions.notTested, 1);
});

test("N4: required evidence missing (target absent) -> UNVERIFIED", () => {
    const r = aggregateRun([row("unavailable", { check: "visible" })]);
    assert.strictEqual(r.level, "UNVERIFIED");
    assert.strictEqual(r.assertions.inconclusive, 1);
});

// N6 (REFUSED) and N7 (optional assertions) are not achievable with legacy
// rows in WP-79a: nothing produces REFUSED yet, and `required: false` does
// not exist until WP-79s. Documented here rather than tested as a no-op.

test("N11: quarantined technical instability never turns a business FAIL into PASS", () => {
    const r = aggregateRun([
        row("failed", { check: "visible" }),
        row("quarantined"), // no assertion: pure technical instability
    ]);
    assert.strictEqual(r.level, "FAILED");
});

test("N12: click succeeds, business outcome wrong -> FAILED when an approved assertion exists", () => {
    const r = aggregateRun([row("failed", { check: "textEquals" })]);
    assert.strictEqual(r.level, "FAILED");
});

test("N12: click succeeds, business outcome wrong -> INTERACTION_ONLY, never BUSINESS_VERIFIED, without an assertion", () => {
    const r = aggregateRun([row("passed")]);
    assert.strictEqual(r.level, "INTERACTION_ONLY");
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
});

test("N13: zero assertions -> INTERACTION_ONLY with NO_REQUIRED_ASSERTIONS", () => {
    const r = aggregateRun([row("passed"), row("passed")]);
    assert.strictEqual(r.level, "INTERACTION_ONLY");
    assert.deepStrictEqual(r.reasonCodes, [REASON_CODES.NO_REQUIRED_ASSERTIONS]);
    assert.strictEqual(r.assertions.required, 0);
});

test("empty run -> UNVERIFIED with NO_TESTS_RUN", () => {
    const r = aggregateRun([]);
    assert.strictEqual(r.level, "UNVERIFIED");
    assert.deepStrictEqual(r.reasonCodes, [REASON_CODES.NO_TESTS_RUN]);
    assert.strictEqual(r.journeys.unverified, 1);
});

test("all-skipped run (no assertions) -> UNVERIFIED with NO_TESTS_RUN", () => {
    const r = aggregateRun([row("skipped"), row("skipped")]);
    assert.strictEqual(r.level, "UNVERIFIED");
    assert.deepStrictEqual(r.reasonCodes, [REASON_CODES.NO_TESTS_RUN]);
});

test("malformed assertion row surfaces MALFORMED_ASSERTION in the run block", () => {
    const r = aggregateRun([row("passed", "not-an-object")]);
    assert.strictEqual(r.level, "UNVERIFIED");
    assert.strictEqual(r.assertions.inconclusive, 1);
    assert.deepStrictEqual(r.reasonCodes, [REASON_CODES.MALFORMED_ASSERTION]);
});

test("deduped rows change nothing (invariant 2, part 1)", () => {
    const base = [row("passed", { check: "visible" }), row("failed", { check: "visible" })];
    const withDupes = [...base, row("deduped"), row("deduped", { check: "visible" })];
    assert.deepStrictEqual(aggregateRun(withDupes), aggregateRun(base));
});

test("order independence (invariant 2, part 2): shuffled rows produce the identical block", () => {
    const rows = [
        row("passed", { check: "visible" }),
        row("failed", { check: "visible" }),
        row("skipped", { check: "visible" }),
        row("unavailable", { check: "visible" }),
        row("quarantined"),
        row("deduped"),
    ];
    const reversed = [...rows].reverse();
    const shuffled = [rows[3], rows[0], rows[5], rows[2], rows[4], rows[1]];
    const a = aggregateRun(rows);
    const b = aggregateRun(reversed);
    const c = aggregateRun(shuffled);
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual(a, c);
});

test("invariant 3: a FAIL is never reduced by adding passing rows", () => {
    const failing = aggregateRun([row("failed", { check: "visible" })]);
    assert.strictEqual(failing.level, "FAILED");
    const withMorePasses = aggregateRun([
        row("failed", { check: "visible" }),
        row("passed", { check: "visible" }),
        row("passed", { check: "visible" }),
        row("passed"),
    ]);
    assert.strictEqual(withMorePasses.level, "FAILED");
});

test("block shape matches the contract's illustrative schema", () => {
    const r = aggregateRun([row("passed", { check: "visible" })]);
    assert.deepStrictEqual(Object.keys(r).sort(), ["assertions", "journeys", "level", "reasonCodes", "schemaVersion"].sort());
    assert.strictEqual(r.schemaVersion, 1);
    assert.deepStrictEqual(Object.keys(r.journeys).sort(), ["businessVerified", "failed", "interactionOnly", "total", "unverified"].sort());
    assert.deepStrictEqual(Object.keys(r.assertions).sort(), ["fail", "inconclusive", "notTested", "pass", "proposedUnapproved", "refused", "required"].sort());
    assert.strictEqual(r.assertions.proposedUnapproved, 0);
});

test("aggregateRun never copies locator/value text into the block", () => {
    const r = aggregateRun([row("failed", { check: "valueEquals", locator: "#secret", expected: "topsecret", actual: "oops" })]);
    const serialized = JSON.stringify(r);
    assert.ok(!serialized.includes("secret"));
    assert.ok(!serialized.includes("topsecret"));
    assert.ok(!serialized.includes("oops"));
});

test("aggregateRun is deterministic: same input, same output, no clock/ids", () => {
    const rows = [row("passed", { check: "visible" }), row("failed")];
    assert.deepStrictEqual(aggregateRun(rows), aggregateRun(rows));
});

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
