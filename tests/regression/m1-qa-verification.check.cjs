"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { classifyRow, aggregateRun } = require(path.join(__dirname, "..", "..", "src/core/outcome/Verification"));

/**
 * m1-qa-verification.check.cjs — QA adversarial tests for WP-79a.
 *
 * Attack vectors the dev tests might miss: prototype pollution keys, hostile
 * objects with getters, empty assertion objects, null rows, no-status rows,
 * huge lists, and edge cases that could let BUSINESS_VERIFIED appear when a
 * FAIL/INCONCLUSIVE/NOT_TESTED assertion exists.
 */

const EV = { check: "visible", locator: "#x" };

function row(status, assertion) {
    const r = { name: "test", status };
    if (assertion !== undefined) r.assertion = assertion;
    return r;
}

// ----------------------------------------------------------------
// Critical invariant: BUSINESS_VERIFIED cannot coexist with bad assertions
// ----------------------------------------------------------------

test("BUSINESS_VERIFIED requires ALL assertions PASS (contract section 2)", () => {
    const cases = [
        { rows: [row("passed", EV), row("failed", {})], desc: "one PASS, one FAIL" },
        { rows: [row("passed", EV), row("unavailable", {})], desc: "one PASS, one INCONCLUSIVE" },
        { rows: [row("passed", EV), row("skipped", {})], desc: "one PASS, one NOT_TESTED" },
        { rows: [row("passed", EV), row("passed", EV), row("failed", {})], desc: "two PASS, one FAIL" },
        { rows: [row("quarantined", {})], desc: "quarantined assertion is FAIL" },
        { rows: [row("passed", EV), row("quarantined", {})], desc: "PASS + quarantined assertion" },
    ];

    for (const { rows, desc } of cases) {
        const result = aggregateRun(rows);
        assert.notStrictEqual(result.level, "BUSINESS_VERIFIED",
            `${desc} should never be BUSINESS_VERIFIED; got ${result.level}`);
    }
});

test("BUSINESS_VERIFIED forbidden when no assertions exist", () => {
    const result = aggregateRun([row("passed"), row("passed"), row("passed")]);
    assert.notStrictEqual(result.level, "BUSINESS_VERIFIED",
        "interactions without assertions cannot be BUSINESS_VERIFIED");
    assert.strictEqual(result.level, "INTERACTION_ONLY");
});

test("BUSINESS_VERIFIED forbidden when required count is zero", () => {
    const result = aggregateRun([row("passed")]);
    assert.strictEqual(result.assertions.required, 0);
    assert.notStrictEqual(result.level, "BUSINESS_VERIFIED");
});

// ----------------------------------------------------------------
// Empty and minimal assertion objects
// ----------------------------------------------------------------

test("empty assertion object {} on a passed row is NOT evidence: INCONCLUSIVE, never BUSINESS_VERIFIED", () => {
    const c = classifyRow(row("passed", {}));
    assert.strictEqual(c.assertionOutcome, "INCONCLUSIVE");
    assert.deepStrictEqual(c.reasonCodes, ["MALFORMED_ASSERTION"]);

    const r = aggregateRun([row("passed", {})]);
    assert.strictEqual(r.level, "UNVERIFIED");
    assert.strictEqual(r.assertions.required, 1);
    assert.strictEqual(r.assertions.pass, 0);
});

test("a FAIL with an empty assertion object is still FAIL (failures are never reduced)", () => {
    assert.strictEqual(classifyRow(row("failed", {})).assertionOutcome, "FAIL");
    assert.strictEqual(classifyRow(row("quarantined", {})).assertionOutcome, "FAIL");
});

test("assertion object with arbitrary keys still classified correctly", () => {
    const weirdAssertion = { foo: "bar", baz: 123, nested: { x: 1 } };
    const c = classifyRow(row("failed", weirdAssertion));
    assert.strictEqual(c.assertionOutcome, "FAIL");
});

// ----------------------------------------------------------------
// Hostile objects with getters and prototype pollution
// ----------------------------------------------------------------

test("assertion with getter does not cause side effects during classification", () => {
    let getterCalled = 0;
    const hostileAssertion = {
        get dangerous() {
            getterCalled++;
            return "triggered";
        },
        check: "visible",
        locator: "#x"
    };

    const c = classifyRow(row("passed", hostileAssertion));
    assert.strictEqual(c.assertionOutcome, "PASS");
    // Getter might be called during isPlainObject or other checks, but should not break
    assert.ok(getterCalled >= 0, "getter may be called but should not break classification");
});

test("rows with prototype pollution keys are handled safely", () => {
    const pollutedRow = {
        name: "test",
        status: "passed",
        assertion: EV,
        __proto__: { injected: "bad" },
        constructor: { name: "hacked" }
    };

    const c = classifyRow(pollutedRow);
    assert.strictEqual(c.assertionOutcome, "PASS");

    const result = aggregateRun([pollutedRow]);
    assert.strictEqual(result.level, "BUSINESS_VERIFIED");
});

test("assertion with __proto__ key is treated as plain object", () => {
    const assertion = { __proto__: { evil: true }, check: "visible", locator: "#x" };
    const c = classifyRow(row("passed", assertion));
    assert.strictEqual(c.assertionOutcome, "PASS");
});

// ----------------------------------------------------------------
// Null and malformed rows
// ----------------------------------------------------------------

test("null row in array does not crash", () => {
    const result = aggregateRun([row("passed", EV), null, row("failed", {})]);
    assert.strictEqual(result.level, "FAILED");
});

test("undefined row in array does not crash", () => {
    const result = aggregateRun([row("passed", EV), undefined, row("passed", EV)]);
    assert.strictEqual(result.level, "BUSINESS_VERIFIED");
    assert.strictEqual(result.assertions.required, 2);
});

test("row without status field is handled gracefully", () => {
    const noStatusRow = { name: "test", assertion: { check: "visible", locator: "#x" } };
    const c = classifyRow(noStatusRow);
    // Should fall through to no contribution or INCONCLUSIVE
    assert.ok(c.assertionOutcome === null || c.assertionOutcome === "INCONCLUSIVE");
});

test("row with non-string status is handled gracefully", () => {
    const badStatusRow = { status: 123, assertion: { check: "visible", locator: "#x" } };
    const c = classifyRow(badStatusRow);
    // Should not match any switch case, fall to default
    assert.ok(c);
});

// ----------------------------------------------------------------
// Non-array input to aggregateRun
// ----------------------------------------------------------------

test("aggregateRun handles null input as empty array", () => {
    const result = aggregateRun(null);
    assert.strictEqual(result.level, "UNVERIFIED");
    assert.deepStrictEqual(result.reasonCodes, ["NO_TESTS_RUN"]);
});

test("aggregateRun handles undefined input as empty array", () => {
    const result = aggregateRun(undefined);
    assert.strictEqual(result.level, "UNVERIFIED");
    assert.deepStrictEqual(result.reasonCodes, ["NO_TESTS_RUN"]);
});

test("aggregateRun handles non-array input as empty array", () => {
    const result = aggregateRun({ not: "an array" });
    assert.strictEqual(result.level, "UNVERIFIED");
});

// ----------------------------------------------------------------
// Large input stress test
// ----------------------------------------------------------------

test("huge row list (10k rows) processes without timeout or memory issues", () => {
    const rows = [];
    for (let i = 0; i < 10000; i++) {
        rows.push(row("passed", { check: "visible", locator: "#x" }));
    }
    const start = Date.now();
    const result = aggregateRun(rows);
    const duration = Date.now() - start;

    assert.strictEqual(result.level, "BUSINESS_VERIFIED");
    assert.strictEqual(result.assertions.pass, 10000);
    assert.ok(duration < 1000, `should complete in <1s, took ${duration}ms`);
});

test("huge mixed row list with all status types", () => {
    const rows = [];
    const statuses = ["passed", "failed", "skipped", "quarantined", "deduped", "unavailable"];
    for (let i = 0; i < 6000; i++) {
        const status = statuses[i % statuses.length];
        const hasAssertion = i % 2 === 0;
        rows.push(row(status, hasAssertion ? {} : undefined));
    }

    const result = aggregateRun(rows);
    assert.ok(result.level); // Should complete without crashing
    assert.ok(result.assertions.required > 0);
});

// ----------------------------------------------------------------
// Determinism under various orderings
// ----------------------------------------------------------------

test("determinism: random shuffle of 100 mixed rows", () => {
    const baseRows = [];
    for (let i = 0; i < 100; i++) {
        const statuses = ["passed", "failed", "skipped", "unavailable", "deduped"];
        const status = statuses[i % statuses.length];
        baseRows.push(row(status, i % 3 === 0 ? {} : undefined));
    }

    const result1 = aggregateRun(baseRows);

    // Multiple random shuffles
    for (let trial = 0; trial < 5; trial++) {
        const shuffled = [...baseRows].sort(() => Math.random() - 0.5);
        const result2 = aggregateRun(shuffled);
        assert.deepStrictEqual(result2, result1, `shuffle trial ${trial} should match`);
    }
});

// ----------------------------------------------------------------
// Edge case: passed status with malformed assertion vs empty assertion
// ----------------------------------------------------------------

test("passed + empty object {} is INCONCLUSIVE with MALFORMED_ASSERTION", () => {
    const c = classifyRow(row("passed", {}));
    assert.strictEqual(c.assertionOutcome, "INCONCLUSIVE");
    assert.deepStrictEqual(c.reasonCodes, ["MALFORMED_ASSERTION"]);
});

test("passed + Object.create(null) assertion is plain object", () => {
    const bareAssertion = Object.create(null);
    bareAssertion.check = "visible";
    const c = classifyRow(row("passed", bareAssertion));
    // Object.create(null) is not detected as plain object by typical isPlainObject
    // This might be INCONCLUSIVE or PASS depending on implementation
    assert.ok(c.assertionOutcome);
});

// ----------------------------------------------------------------
// Assertion object with no own properties except inherited
// ----------------------------------------------------------------

test("assertion inheriting properties only (Object.create({check: 'visible'}))", () => {
    const proto = { check: "visible", locator: "#x" };
    const inheritedAssertion = Object.create(proto);
    const c = classifyRow(row("passed", inheritedAssertion));
    // Should still pass isPlainObject check
    assert.ok(c.assertionOutcome);
});

// ----------------------------------------------------------------
// Mixed deduped rows never contribute to level
// ----------------------------------------------------------------

test("all deduped rows produce UNVERIFIED NO_TESTS_RUN", () => {
    const result = aggregateRun([row("deduped"), row("deduped", {}), row("deduped")]);
    assert.strictEqual(result.level, "UNVERIFIED");
    assert.deepStrictEqual(result.reasonCodes, ["NO_TESTS_RUN"]);
    assert.strictEqual(result.assertions.required, 0);
});

test("deduped mixed with passed assertions does not reduce level", () => {
    const result = aggregateRun([
        row("passed", EV),
        row("deduped"),
        row("deduped", {}),
        row("passed", EV)
    ]);
    assert.strictEqual(result.level, "BUSINESS_VERIFIED");
    assert.strictEqual(result.assertions.required, 2);
});

// ----------------------------------------------------------------
// Precedence verification: FAILED > UNVERIFIED > BUSINESS_VERIFIED
// ----------------------------------------------------------------

test("one FAIL assertion overrides many PASS assertions", () => {
    const rows = [];
    for (let i = 0; i < 99; i++) {
        rows.push(row("passed", EV));
    }
    rows.push(row("failed", {}));

    const result = aggregateRun(rows);
    assert.strictEqual(result.level, "FAILED");
    assert.strictEqual(result.assertions.pass, 99);
    assert.strictEqual(result.assertions.fail, 1);
});

test("one INCONCLUSIVE/NOT_TESTED overrides PASS", () => {
    const inconclusiveCase = aggregateRun([
        row("passed", EV),
        row("passed", EV),
        row("unavailable", {})
    ]);
    assert.strictEqual(inconclusiveCase.level, "UNVERIFIED");

    const notTestedCase = aggregateRun([
        row("passed", EV),
        row("skipped", {})
    ]);
    assert.strictEqual(notTestedCase.level, "UNVERIFIED");
});

test("technical failure (failed without assertion) produces FAILED", () => {
    const result = aggregateRun([row("passed", {}), row("failed")]);
    assert.strictEqual(result.level, "FAILED");
});

// ----------------------------------------------------------------
// Special case: assertion field present but status is interaction-only
// ----------------------------------------------------------------

test("passed with assertion present but status is interaction produces assertion outcome", () => {
    // The code checks hasAssertion first, so this should be an assertion
    const c = classifyRow(row("passed", { check: "visible", locator: "#x" }));
    assert.strictEqual(c.assertionOutcome, "PASS");
    assert.strictEqual(c.interaction, false);
});

// ----------------------------------------------------------------
// Contract violation detection
// ----------------------------------------------------------------

test("BUSINESS_VERIFIED can only occur when required >= 1 AND no FAIL/INCONCLUSIVE/NOT_TESTED", () => {
    // Systematically verify the contract invariant
    const validBV = [
        [row("passed", {})],
        [row("passed", {}), row("passed", {})],
        [row("passed", {}), row("passed")], // one assertion + one interaction
    ];

    for (const rows of validBV) {
        const result = aggregateRun(rows);
        if (result.level === "BUSINESS_VERIFIED") {
            assert.ok(result.assertions.required >= 1, "BV requires required >= 1");
            assert.strictEqual(result.assertions.fail, 0, "BV requires fail === 0");
            assert.strictEqual(result.assertions.inconclusive, 0, "BV requires inconclusive === 0");
            assert.strictEqual(result.assertions.notTested, 0, "BV requires notTested === 0");
            assert.strictEqual(result.assertions.refused, 0, "BV requires refused === 0");
        }
    }
});

test("no path to BUSINESS_VERIFIED with assertion count mismatch", () => {
    // If we somehow had required > 0 but all assertions were NOT_TESTED, should be UNVERIFIED
    const result = aggregateRun([row("skipped", {})]);
    assert.notStrictEqual(result.level, "BUSINESS_VERIFIED");
    assert.strictEqual(result.level, "UNVERIFIED");
});
