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

// WP-77F: contract-origin assertion fixture. Only rows carrying their own
// `id` AND `digest` come from an approved contract (runVerify / shard
// rows); a plain `expect` row never has either. Tests that build rows with
// `row("passed", { check, locator })` and expect PASS/BUSINESS_VERIFIED
// encode the pre-WP-77F defect (any assertion object counted as required)
// and are updated below to use `bound()` instead.
function bound(extra) {
    return { id: "A1", digest: "sha256:" + "a".repeat(64), check: "visible", locator: "#x", ...extra };
}

// ---------------------------------------------------------------------
// classifyRow — per-row mapping
// ---------------------------------------------------------------------

test("classifyRow: passed + bound (contract-origin) assertion -> PASS", () => {
    const c = classifyRow(row("passed", bound()));
    assert.strictEqual(c.assertionOutcome, "PASS");
    assert.strictEqual(c.ignored, false);
});

// WP-77F: plain expect row
test("classifyRow: failed + plain (contractless) assertion -> technical failure, not FAIL", () => {
    const c = classifyRow(row("failed", { check: "visible", locator: "#x" }));
    assert.strictEqual(c.assertionOutcome, null);
    assert.strictEqual(c.technicalFailure, true);
});

// WP-77F: plain expect row
test("classifyRow: unavailable + plain (contractless) assertion -> technical failure, not INCONCLUSIVE", () => {
    const c = classifyRow(row("unavailable", { check: "visible", locator: "#x" }));
    assert.strictEqual(c.assertionOutcome, null);
    assert.strictEqual(c.technicalFailure, true);
});

// WP-77F: plain expect row
test("classifyRow: skipped + plain (contractless) assertion -> no contribution, not NOT_TESTED", () => {
    const c = classifyRow(row("skipped", { check: "visible", locator: "#x" }));
    assert.strictEqual(c.assertionOutcome, null);
    assert.strictEqual(c.interaction, false);
    assert.strictEqual(c.technicalFailure, false);
});

// WP-77F: plain expect row
test("classifyRow: quarantined + plain (contractless) assertion -> technical failure, not FAIL", () => {
    const c = classifyRow(row("quarantined", { check: "visible", locator: "#x" }));
    assert.strictEqual(c.assertionOutcome, null);
    assert.strictEqual(c.technicalFailure, true);
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
    const c2 = classifyRow(row("deduped", { check: "visible", locator: "#x" }));
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
    const r = aggregateRun([row("passed", bound({ id: "A1" })), row("passed", bound({ id: "A2" }))]);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
    assert.strictEqual(r.assertions.required, 2);
    assert.strictEqual(r.assertions.pass, 2);
    assert.strictEqual(r.journeys.businessVerified, 1);
    assert.strictEqual(r.journeys.total, 1);
    assert.deepStrictEqual(r.reasonCodes, []);
});

test("N2: one required assertion fails -> FAILED", () => {
    const r = aggregateRun([row("passed", { check: "visible", locator: "#x" }), row("failed", { check: "visible", locator: "#x" })]);
    assert.strictEqual(r.level, "FAILED");
    assert.strictEqual(r.journeys.failed, 1);
});

// WP-77F: plain expect row. A plain (contractless) assertion is never
// "required", so a lone plain-skipped row contributes nothing -- it is
// indistinguishable from no rows having run at all.
test("N3: a lone plain (contractless) skipped row -> UNVERIFIED via NO_TESTS_RUN, not notTested", () => {
    const r = aggregateRun([row("skipped", { check: "visible", locator: "#x" })]);
    assert.strictEqual(r.level, "UNVERIFIED");
    assert.strictEqual(r.assertions.notTested, 0);
    assert.strictEqual(r.assertions.required, 0);
    assert.deepStrictEqual(r.reasonCodes, [REASON_CODES.NO_TESTS_RUN]);
});

// WP-77F: plain expect row. A plain (contractless) unavailable row is a
// technical failure, not an inconclusive *assertion*, so it still surfaces
// as FAILED (a technical failure is never silently downgraded to
// UNVERIFIED), and it never contributes to the assertions.inconclusive count.
test("N4: a lone plain (contractless) unavailable row -> FAILED (technical failure), not inconclusive assertion", () => {
    const r = aggregateRun([row("unavailable", { check: "visible", locator: "#x" })]);
    assert.strictEqual(r.level, "FAILED");
    assert.strictEqual(r.assertions.inconclusive, 0);
    assert.strictEqual(r.assertions.required, 0);
    assert.strictEqual(r.journeys.failed, 1);
});

// N6 (REFUSED) and N7 (optional assertions) are not achievable with legacy
// rows in WP-79a: nothing produces REFUSED yet, and `required: false` does
// not exist until WP-79s. Documented here rather than tested as a no-op.

test("N11: quarantined technical instability never turns a business FAIL into PASS", () => {
    const r = aggregateRun([
        row("failed", { check: "visible", locator: "#x" }),
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
    const base = [row("passed", { check: "visible", locator: "#x" }), row("failed", { check: "visible", locator: "#x" })];
    const withDupes = [...base, row("deduped"), row("deduped", { check: "visible", locator: "#x" })];
    assert.deepStrictEqual(aggregateRun(withDupes), aggregateRun(base));
});

test("order independence (invariant 2, part 2): shuffled rows produce the identical block", () => {
    const rows = [
        row("passed", { check: "visible", locator: "#x" }),
        row("failed", { check: "visible", locator: "#x" }),
        row("skipped", { check: "visible", locator: "#x" }),
        row("unavailable", { check: "visible", locator: "#x" }),
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
    const failing = aggregateRun([row("failed", { check: "visible", locator: "#x" })]);
    assert.strictEqual(failing.level, "FAILED");
    const withMorePasses = aggregateRun([
        row("failed", { check: "visible", locator: "#x" }),
        row("passed", { check: "visible", locator: "#x" }),
        row("passed", { check: "visible", locator: "#x" }),
        row("passed"),
    ]);
    assert.strictEqual(withMorePasses.level, "FAILED");
});

test("block shape matches the contract's illustrative schema", () => {
    const r = aggregateRun([row("passed", { check: "visible", locator: "#x" })]);
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
    const rows = [row("passed", { check: "visible", locator: "#x" }), row("failed")];
    assert.deepStrictEqual(aggregateRun(rows), aggregateRun(rows));
});

// ---------------------------------------------------------------------
// WP-77F: bound vs. plain assertion semantics (issue #77)
//
// A "plain" assertion ({ check, locator } with neither own `id` nor own
// `digest`) comes from a contractless `expect` row and can never count as
// a required business assertion. A "bound" assertion (own `id` or own
// `digest`) comes from an approved contract (runVerify / shard rows) and
// is the only thing that can count toward assertions.required.
// ---------------------------------------------------------------------

test("classifyRow: bound + failed -> FAIL", () => {
    const c = classifyRow(row("failed", bound()));
    assert.strictEqual(c.assertionOutcome, "FAIL");
});

test("classifyRow: bound + unavailable -> INCONCLUSIVE", () => {
    const c = classifyRow(row("unavailable", bound()));
    assert.strictEqual(c.assertionOutcome, "INCONCLUSIVE");
});

test("classifyRow: bound + skipped -> NOT_TESTED", () => {
    const c = classifyRow(row("skipped", bound()));
    assert.strictEqual(c.assertionOutcome, "NOT_TESTED");
});

test("classifyRow: bound + quarantined -> FAIL (Q1, never hidden)", () => {
    const c = classifyRow(row("quarantined", bound()));
    assert.strictEqual(c.assertionOutcome, "FAIL");
});

test("classifyRow: bound + passed missing check -> INCONCLUSIVE + MALFORMED_ASSERTION", () => {
    const c = classifyRow(row("passed", bound({ check: undefined })));
    assert.strictEqual(c.assertionOutcome, "INCONCLUSIVE");
    assert.deepStrictEqual(c.reasonCodes, [REASON_CODES.MALFORMED_ASSERTION]);
});

test("classifyRow: bound + passed missing locator -> INCONCLUSIVE + MALFORMED_ASSERTION", () => {
    const c = classifyRow(row("passed", bound({ locator: undefined })));
    assert.strictEqual(c.assertionOutcome, "INCONCLUSIVE");
    assert.deepStrictEqual(c.reasonCodes, [REASON_CODES.MALFORMED_ASSERTION]);
});

test("classifyRow: bound + passed with empty id -> INCONCLUSIVE + MALFORMED_ASSERTION", () => {
    const c = classifyRow(row("passed", bound({ id: "" })));
    assert.strictEqual(c.assertionOutcome, "INCONCLUSIVE");
    assert.deepStrictEqual(c.reasonCodes, [REASON_CODES.MALFORMED_ASSERTION]);
});

test("classifyRow: bound + passed with id over 64 chars -> INCONCLUSIVE + MALFORMED_ASSERTION", () => {
    const c = classifyRow(row("passed", bound({ id: "a".repeat(65) })));
    assert.strictEqual(c.assertionOutcome, "INCONCLUSIVE");
    assert.deepStrictEqual(c.reasonCodes, [REASON_CODES.MALFORMED_ASSERTION]);
});

test("classifyRow: bound + passed with malformed digest -> INCONCLUSIVE + MALFORMED_ASSERTION", () => {
    const c = classifyRow(row("passed", bound({ digest: "sha256:" + "g".repeat(64) })));
    assert.strictEqual(c.assertionOutcome, "INCONCLUSIVE");
    assert.deepStrictEqual(c.reasonCodes, [REASON_CODES.MALFORMED_ASSERTION]);
});

test("classifyRow: the runner's binding-failure row (id only, no digest, unavailable) stays INCONCLUSIVE, not technicalFailure", () => {
    const c = classifyRow(row("unavailable", { id: "binding", check: "contract", locator: "contract:binding" }));
    assert.strictEqual(c.assertionOutcome, "INCONCLUSIVE");
    assert.strictEqual(c.technicalFailure, false);
});

test("[plain passed] -> INTERACTION_ONLY, required 0, NO_REQUIRED_ASSERTIONS", () => {
    const r = aggregateRun([row("passed", { check: "visible", locator: "#x" })]);
    assert.strictEqual(r.level, "INTERACTION_ONLY");
    assert.strictEqual(r.assertions.required, 0);
    assert.ok(r.reasonCodes.includes(REASON_CODES.NO_REQUIRED_ASSERTIONS));
});

test("[plain failed] -> FAILED", () => {
    const r = aggregateRun([row("failed", { check: "visible", locator: "#x" })]);
    assert.strictEqual(r.level, "FAILED");
});

test("[bound pass + plain pass] -> BUSINESS_VERIFIED, required exactly 1", () => {
    const r = aggregateRun([row("passed", bound()), row("passed", { check: "visible", locator: "#x" })]);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
    assert.strictEqual(r.assertions.required, 1);
});

test("[bound pass + plain failed] -> FAILED", () => {
    const r = aggregateRun([row("passed", bound()), row("failed", { check: "visible", locator: "#x" })]);
    assert.strictEqual(r.level, "FAILED");
});

test("[bound fail] -> FAILED", () => {
    const r = aggregateRun([row("failed", bound())]);
    assert.strictEqual(r.level, "FAILED");
});

test("[bound skipped] -> UNVERIFIED", () => {
    const r = aggregateRun([row("skipped", bound())]);
    assert.strictEqual(r.level, "UNVERIFIED");
});

test("[bound quarantined] -> FAILED", () => {
    const r = aggregateRun([row("quarantined", bound())]);
    assert.strictEqual(r.level, "FAILED");
});

test("two distinct valid digests among bound rows -> no PASS, never BUSINESS_VERIFIED, APPROVAL_MISMATCH", () => {
    const r = aggregateRun([
        row("passed", bound({ id: "A1", digest: "sha256:" + "a".repeat(64) })),
        row("passed", bound({ id: "A2", digest: "sha256:" + "b".repeat(64) })),
    ]);
    assert.strictEqual(r.assertions.pass, 0);
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
    assert.ok(r.reasonCodes.includes("APPROVAL_MISMATCH"));
});

test("shard-shaped bound row (journeyId/required on the row) -> BUSINESS_VERIFIED", () => {
    const shardRow = { name: "x", status: "passed", assertion: bound(), journeyId: "j1", required: true };
    const r = aggregateRun([shardRow]);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
});

test("shard-normalised plain row ({check, locator} only) alone -> never BUSINESS_VERIFIED (INTERACTION_ONLY)", () => {
    const shardRow = { name: "x", status: "passed", assertion: { check: "visible", locator: "#x" } };
    const r = aggregateRun([shardRow]);
    assert.strictEqual(r.level, "INTERACTION_ONLY");
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
});

// ---------------------------------------------------------------------
// 77H-D2: malformed-id rows never contribute a digest to the mismatch set
// ---------------------------------------------------------------------

function malformedIdRow(status, digest, idValue) {
    return row(status, { id: idValue, digest, check: "visible", locator: "#x" });
}

test("missing id + valid digest differing from a valid row's digest -> no APPROVAL_MISMATCH; valid row PASS; malformed row INCONCLUSIVE/MALFORMED_ASSERTION", () => {
    const validDigest = "sha256:" + "a".repeat(64);
    const otherDigest = "sha256:" + "b".repeat(64);
    const validRow = row("passed", bound({ id: "A1", digest: validDigest }));
    const noIdRow = row("passed", { digest: otherDigest, check: "visible", locator: "#x" });
    const r = aggregateRun([validRow, noIdRow]);
    assert.ok(!r.reasonCodes.includes("APPROVAL_MISMATCH"));
    assert.strictEqual(r.assertions.pass, 1);

    const noIdClassified = classifyRow(noIdRow);
    assert.strictEqual(noIdClassified.assertionOutcome, "INCONCLUSIVE");
    assert.ok(noIdClassified.reasonCodes.includes(REASON_CODES.MALFORMED_ASSERTION));
});

for (const badId of [42, "", "x".repeat(65)]) {
    test(`malformed id (${JSON.stringify(badId)}) + valid digest differing from a valid row's digest -> no APPROVAL_MISMATCH; valid row PASS; malformed row INCONCLUSIVE/MALFORMED_ASSERTION`, () => {
        const validDigest = "sha256:" + "a".repeat(64);
        const otherDigest = "sha256:" + "b".repeat(64);
        const validRow = row("passed", bound({ id: "A1", digest: validDigest }));
        const badRow = malformedIdRow("passed", otherDigest, badId);
        const r = aggregateRun([validRow, badRow]);
        assert.ok(!r.reasonCodes.includes("APPROVAL_MISMATCH"));
        assert.strictEqual(r.assertions.pass, 1);

        const badClassified = classifyRow(badRow);
        assert.strictEqual(badClassified.assertionOutcome, "INCONCLUSIVE");
        assert.ok(badClassified.reasonCodes.includes(REASON_CODES.MALFORMED_ASSERTION));
    });
}

test("valid ids + conflicting digests -> APPROVAL_MISMATCH, level not BUSINESS_VERIFIED", () => {
    const r = aggregateRun([
        row("passed", bound({ id: "A1", digest: "sha256:" + "a".repeat(64) })),
        row("passed", bound({ id: "A2", digest: "sha256:" + "c".repeat(64) })),
    ]);
    assert.ok(r.reasonCodes.includes("APPROVAL_MISMATCH"));
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
});

test("getter digest valid-then-invalid: exactly one read per field per aggregateRun", () => {
    let digestReads = 0;
    let idReads = 0;
    let checkReads = 0;
    let locatorReads = 0;
    const digestValues = ["sha256:" + "a".repeat(64), "not-a-digest"];
    const gettableRow = {
        name: "x",
        status: "passed",
        get assertion() {
            const self = this;
            return {
                get id() { idReads++; return "A1"; },
                get digest() { digestReads++; return digestValues.shift(); },
                get check() { checkReads++; return "visible"; },
                get locator() { locatorReads++; return "#x"; },
            };
        },
    };
    aggregateRun([gettableRow]);
    assert.strictEqual(idReads, 1);
    assert.strictEqual(digestReads, 1);
    assert.strictEqual(checkReads, 1);
    assert.strictEqual(locatorReads, 1);
});

test("getter digest invalid-then-valid: exactly one read per field per aggregateRun", () => {
    let digestReads = 0;
    let idReads = 0;
    let checkReads = 0;
    let locatorReads = 0;
    const digestValues = ["not-a-digest", "sha256:" + "a".repeat(64)];
    const gettableRow = {
        name: "x",
        status: "passed",
        get assertion() {
            return {
                get id() { idReads++; return "A1"; },
                get digest() { digestReads++; return digestValues.shift(); },
                get check() { checkReads++; return "visible"; },
                get locator() { locatorReads++; return "#x"; },
            };
        },
    };
    aggregateRun([gettableRow]);
    assert.strictEqual(idReads, 1);
    assert.strictEqual(digestReads, 1);
    assert.strictEqual(checkReads, 1);
    assert.strictEqual(locatorReads, 1);
});

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
