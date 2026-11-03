"use strict";

/**
 * Verification.js — WP-79a verification classification, revised by WP-77F
 * (issue #77) for contract-bound vs. contractless assertions.
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
 * still ignores `journeyId`/`required`: the whole run is one implicit journey.
 *
 * WP-77F: not every `assertion` object is a required business assertion. A
 * row is "bound" (contract-origin: runVerify / shard rows) only when its
 * assertion object carries its OWN `id` or `digest` field; only bound rows
 * can count toward `assertions.required`. A contractless UI `expect` row
 * (assertion shaped `{ check, locator, expected }`, no id/digest) is "plain":
 * it is an interaction when it passes, a technical failure when it fails or
 * is unavailable/quarantined, and contributes nothing when skipped — it can
 * never be a required business assertion. `aggregateRun` also cross-checks
 * bound rows for contradictory approval evidence (more than one distinct
 * valid digest among them) and downgrades affected PASS rows to
 * INCONCLUSIVE with reason code APPROVAL_MISMATCH.
 */

const REASON_CODES = Object.freeze({
    NO_TESTS_RUN: "NO_TESTS_RUN",
    NO_REQUIRED_ASSERTIONS: "NO_REQUIRED_ASSERTIONS",
    MALFORMED_ASSERTION: "MALFORMED_ASSERTION",
    APPROVAL_MISMATCH: "APPROVAL_MISMATCH",
});

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A row's assertion is "bound" (contract-origin) when it carries its own
// `id` or `digest` field; a contractless `expect` row has neither.
function isBoundAssertion(assertion) {
    return isPlainObject(assertion) && (
        Object.prototype.hasOwnProperty.call(assertion, "id")
        || Object.prototype.hasOwnProperty.call(assertion, "digest")
    );
}

function isValidId(id) {
    return typeof id === "string" && id.length > 0 && id.length <= 64;
}

function isValidDigest(digest) {
    return typeof digest === "string" && DIGEST_RE.test(digest);
}

function hasEvidence(assertion) {
    return typeof assertion.check === "string" && assertion.check !== ""
        && typeof assertion.locator === "string" && assertion.locator !== "";
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

        const assertion = row.assertion;

        if (isBoundAssertion(assertion)) {
            // Contract-origin row (runVerify / shard rows): only these can
            // ever count as a required business assertion. A PASS needs
            // full evidence — a valid id, a valid digest, and the check/
            // locator the `expect` runner always records — otherwise it is
            // INCONCLUSIVE, never PASS. FAIL is deliberately not subject to
            // this rule: a failure is never reduced.
            if (status === "passed") {
                if (!(isValidId(assertion.id) && isValidDigest(assertion.digest) && hasEvidence(assertion))) {
                    return {
                        ignored: false,
                        assertionOutcome: "INCONCLUSIVE",
                        interaction: false,
                        technicalFailure: false,
                        reasonCodes: [REASON_CODES.MALFORMED_ASSERTION],
                    };
                }
                return { ignored: false, assertionOutcome: "PASS", interaction: false, technicalFailure: false, reasonCodes: [] };
            }

            let outcome;
            switch (status) {
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

        // Plain (contractless) assertion: a UI `expect` with no id/digest,
        // or a shard-normalised { check, locator } row. It can never be a
        // required business assertion — a passing one is an interaction,
        // a failing/unavailable/quarantined one is a technical failure (it
        // must still be able to fail the run), and skipped contributes
        // nothing.
        if (status === "passed") {
            if (hasEvidence(assertion)) {
                return { ignored: false, assertionOutcome: null, interaction: true, technicalFailure: false, reasonCodes: [] };
            }
            return {
                ignored: false,
                assertionOutcome: "INCONCLUSIVE",
                interaction: false,
                technicalFailure: false,
                reasonCodes: [REASON_CODES.MALFORMED_ASSERTION],
            };
        }
        if (status === "failed" || status === "unavailable" || status === "quarantined") {
            return { ignored: false, assertionOutcome: null, interaction: false, technicalFailure: true, reasonCodes: [] };
        }
        // `skipped` (or any other status) with a plain assertion: no
        // verification contribution either way.
        return { ignored: false, assertionOutcome: null, interaction: false, technicalFailure: false, reasonCodes: [] };
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

    // WP-77F: contradictory approval evidence. Collect the distinct valid
    // digests carried by non-deduped bound rows; more than one means the
    // rows disagree about which approved contract they came from, so no
    // bound PASS in this run can be trusted.
    const validDigests = new Set();
    for (const row of list) {
        if (row && row.status === "deduped") continue;
        const assertion = row && row.assertion;
        if (isBoundAssertion(assertion) && isValidDigest(assertion.digest)) {
            validDigests.add(assertion.digest);
        }
    }
    const approvalMismatch = validDigests.size > 1;

    for (const row of list) {
        let classified = classifyRow(row);
        if (classified.ignored) continue;

        if (approvalMismatch && classified.assertionOutcome === "PASS" && isBoundAssertion(row && row.assertion)) {
            classified = { ...classified, assertionOutcome: "INCONCLUSIVE", reasonCodes: [...classified.reasonCodes, REASON_CODES.APPROVAL_MISMATCH] };
        }

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
