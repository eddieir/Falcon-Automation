"use strict";

/**
 * Verification.js — WP-79a verification classification.
 *
 * Pure module: no I/O, no clock, no console. Classifies legacy test rows
 * into an assertion outcome / interaction / technical-failure bucket and
 * aggregates that into an additive `verification` report block.
 *
 * See docs/roadmap/BUSINESS-CORRECTNESS-CONTRACT.md sections 2, 3, 5, 7 and
 * docs/roadmap/M1-DETAILED-IMPLEMENTATION-PLAN.md section 2 (WP-79a) for the
 * design this implements.
 *
 * WP-79a rows carry only legacy fields. Since WP-79s, shard-merged rows also
 * carry the normalised `assertion` ({ check, locator } or null when the source
 * record was malformed) and optional `journeyId`/`required`. This classifier
 * still ignores `journeyId`/`required`: the whole run is one implicit journey
 * and every assertion row counts as required until the approval model lands.
 */

const REASON_CODES = Object.freeze({
    NO_TESTS_RUN: "NO_TESTS_RUN",
    NO_REQUIRED_ASSERTIONS: "NO_REQUIRED_ASSERTIONS",
    MALFORMED_ASSERTION: "MALFORMED_ASSERTION",
});

function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Classify a single row (legacy shape: { status, assertion? , ... }).
 *
 * Returns an internal (non-schema) shape describing the row's contribution:
 * { ignored, assertionOutcome, interaction, technicalFailure, reasonCodes }
 *
 * - `ignored`: true for `deduped` rows — excluded entirely from coverage.
 * - `assertionOutcome`: one of PASS|FAIL|INCONCLUSIVE|NOT_TESTED|REFUSED|null.
 * - `interaction`: true when a non-assertion row ran and passed.
 * - `technicalFailure`: true when a non-assertion row failed/was unavailable.
 *
 * Never throws: `buildReport` already restricts `status` to the six legacy
 * values before any row reaches here, and any other shape falls through to
 * "no contribution" rather than raising.
 */
function classifyRow(row) {
    const status = row && row.status;

    // `deduped` is never executed; it contributes nothing to coverage,
    // regardless of any other field present on the row.
    if (status === "deduped") {
        return { ignored: true, assertionOutcome: null, interaction: false, technicalFailure: false, reasonCodes: [] };
    }

    const hasAssertion = !!(row && Object.prototype.hasOwnProperty.call(row, "assertion"));

    if (hasAssertion) {
        if (!isPlainObject(row.assertion)) {
            // A malformed assertion record can never be trusted enough to
            // report PASS/FAIL; it is INCONCLUSIVE regardless of `status`.
            return {
                ignored: false,
                assertionOutcome: "INCONCLUSIVE",
                interaction: false,
                technicalFailure: false,
                reasonCodes: [REASON_CODES.MALFORMED_ASSERTION],
            };
        }

        // A PASS needs evidence: the `expect` runner always records the check
        // and the locator. An assertion object without them cannot support a
        // business-verified claim, so it is INCONCLUSIVE, never PASS. FAIL is
        // deliberately not subject to this rule: a failure is never reduced.
        const hasEvidence = typeof row.assertion.check === "string" && row.assertion.check !== ""
            && typeof row.assertion.locator === "string" && row.assertion.locator !== "";
        if (status === "passed" && !hasEvidence) {
            return {
                ignored: false,
                assertionOutcome: "INCONCLUSIVE",
                interaction: false,
                technicalFailure: false,
                reasonCodes: [REASON_CODES.MALFORMED_ASSERTION],
            };
        }

        let outcome;
        switch (status) {
            case "passed": outcome = "PASS"; break;
            case "failed": outcome = "FAIL"; break;
            case "unavailable": outcome = "INCONCLUSIVE"; break;
            case "skipped": outcome = "NOT_TESTED"; break;
            // Decision Q1: a quarantined *business assertion* failure is
            // never quarantinable — it must still surface as FAIL so a
            // quarantine can never hide a real business failure.
            case "quarantined": outcome = "FAIL"; break;
            default: outcome = "INCONCLUSIVE"; // defensive; buildReport rejects other statuses upstream
        }
        return { ignored: false, assertionOutcome: outcome, interaction: false, technicalFailure: false, reasonCodes: [] };
    }

    // No assertion object: legacy interaction-only mapping.
    if (status === "passed") {
        return { ignored: false, assertionOutcome: null, interaction: true, technicalFailure: false, reasonCodes: [] };
    }
    if (status === "failed" || status === "unavailable") {
        return { ignored: false, assertionOutcome: null, interaction: false, technicalFailure: true, reasonCodes: [] };
    }
    // `skipped` or `quarantined` without an assertion: no verification
    // contribution either way (not a pass, not a technical failure).
    return { ignored: false, assertionOutcome: null, interaction: false, technicalFailure: false, reasonCodes: [] };
}

/**
 * Aggregate a run's rows into the additive `verification` report block.
 * Pure function of `rows`: order-independent, no timestamps/ids, and never
 * copies locator/value text from any assertion into the result.
 */
function aggregateRun(rows) {
    const list = Array.isArray(rows) ? rows : [];

    let pass = 0, fail = 0, inconclusive = 0, refused = 0, notTested = 0, required = 0;
    let interactionCount = 0, technicalFailureCount = 0;
    const reasonSet = new Set();

    for (const row of list) {
        const classified = classifyRow(row);
        if (classified.ignored) continue;

        for (const code of classified.reasonCodes) reasonSet.add(code);

        if (classified.assertionOutcome) {
            required++;
            switch (classified.assertionOutcome) {
                case "PASS": pass++; break;
                case "FAIL": fail++; break;
                case "INCONCLUSIVE": inconclusive++; break;
                case "NOT_TESTED": notTested++; break;
                case "REFUSED": refused++; break;
                default: break;
            }
        } else if (classified.interaction) {
            interactionCount++;
        } else if (classified.technicalFailure) {
            technicalFailureCount++;
        }
    }

    const ranCount = required + interactionCount + technicalFailureCount;
    const hasFail = fail > 0 || technicalFailureCount > 0;
    const hasInconclusiveGroup = inconclusive > 0 || notTested > 0 || refused > 0;

    let level;
    if (hasFail) {
        level = "FAILED";
    } else if (hasInconclusiveGroup || ranCount === 0) {
        level = "UNVERIFIED";
        if (ranCount === 0) reasonSet.add(REASON_CODES.NO_TESTS_RUN);
    } else if (required >= 1) {
        level = "BUSINESS_VERIFIED";
    } else {
        level = "INTERACTION_ONLY";
        reasonSet.add(REASON_CODES.NO_REQUIRED_ASSERTIONS);
    }

    const journeys = { total: 1, businessVerified: 0, interactionOnly: 0, unverified: 0, failed: 0 };
    if (level === "BUSINESS_VERIFIED") journeys.businessVerified = 1;
    else if (level === "INTERACTION_ONLY") journeys.interactionOnly = 1;
    else if (level === "UNVERIFIED") journeys.unverified = 1;
    else if (level === "FAILED") journeys.failed = 1;

    return {
        schemaVersion: 1,
        level,
        journeys,
        assertions: { required, pass, fail, inconclusive, refused, notTested, proposedUnapproved: 0 },
        reasonCodes: [...reasonSet].sort(),
    };
}

module.exports = { classifyRow, aggregateRun, REASON_CODES };
