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
    APPROVAL_UNPROVEN: "APPROVAL_UNPROVEN",
    OPTIONAL_CLAIM_UNTRUSTED: "OPTIONAL_CLAIM_UNTRUSTED",
    OPTIONAL_FAILED: "OPTIONAL_FAILED",
    OPTIONAL_UNVERIFIED: "OPTIONAL_UNVERIFIED",
});

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidId(id) {
    return typeof id === "string" && id.length > 0 && id.length <= 64;
}

function isValidDigest(digest) {
    return typeof digest === "string" && DIGEST_RE.test(digest);
}

/**
 * Read every field this classifier ever needs from a row exactly once, and
 * return a plain snapshot object. This is the only place `row.status`,
 * `row.assertion`, and (for a plain-object assertion) `assertion.id` /
 * `assertion.digest` / `assertion.check` / `assertion.locator` are read —
 * callers (both single-row classification and run aggregation) must work
 * from the returned snapshot rather than re-reading the row or its
 * assertion. This matters when any of those fields is a getter: a snapshot
 * guarantees each getter fires exactly once per row, however many times the
 * snapshot's data is subsequently consulted.
 */
function snapshotRow(row) {
    const status = row && row.status;
    // A deduped row is never executed and contributes nothing: do not touch
    // its assertion (keeps a hostile getter on a deduped row inert, as before).
    if (status === "deduped") {
        return { status, hasAssertion: false, isAssertionObject: false, hasOwnId: false, hasOwnDigest: false, optionalClaim: false };
    }
    // WP-77I: read `required` exactly once, only for a row that was actually
    // executed. A row explicitly opting out of the required tally (`required
    // === false`) is an "optional claim" — it is only ever honoured when
    // `trustedOptionalIndexes` can independently verify the row's origin.
    const optionalClaim = !!(row && row.required === false);
    const hasAssertion = !!(row && Object.prototype.hasOwnProperty.call(row, "assertion"));
    const assertion = row ? row.assertion : undefined;
    const isAssertionObject = isPlainObject(assertion);

    let hasOwnId = false, hasOwnDigest = false, id, digest, check, locator;
    if (isAssertionObject) {
        hasOwnId = Object.prototype.hasOwnProperty.call(assertion, "id");
        hasOwnDigest = Object.prototype.hasOwnProperty.call(assertion, "digest");
        id = assertion.id;
        digest = assertion.digest;
        check = assertion.check;
        locator = assertion.locator;
    }

    return {
        status,
        hasAssertion,
        isAssertionObject,
        hasOwnId,
        hasOwnDigest,
        id,
        digest,
        check,
        locator,
        optionalClaim,
    };
}

function isBoundSnapshot(snap) {
    return snap.isAssertionObject && (snap.hasOwnId || snap.hasOwnDigest);
}

function hasEvidenceSnapshot(snap) {
    return typeof snap.check === "string" && snap.check !== ""
        && typeof snap.locator === "string" && snap.locator !== "";
}

/**
 * Classify a single row's snapshot (see `snapshotRow`).
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
function classifySnapshot(snap) {
    const status = snap.status;

    // `deduped` is never executed; it contributes nothing to coverage,
    // regardless of any other field present on the row.
    if (status === "deduped") {
        return { ignored: true, assertionOutcome: null, interaction: false, technicalFailure: false, reasonCodes: [] };
    }

    if (snap.hasAssertion) {
        if (!snap.isAssertionObject) {
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

        if (isBoundSnapshot(snap)) {
            // Contract-origin row (runVerify / shard rows): only these can
            // ever count as a required business assertion. A PASS needs
            // full evidence — a valid id, a valid digest, and the check/
            // locator the `expect` runner always records — otherwise it is
            // INCONCLUSIVE, never PASS. FAIL is deliberately not subject to
            // this rule: a failure is never reduced.
            if (status === "passed") {
                if (!(isValidId(snap.id) && isValidDigest(snap.digest) && hasEvidenceSnapshot(snap))) {
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
            if (hasEvidenceSnapshot(snap)) {
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
 * Classify a single row (legacy shape: { status, assertion? , ... }).
 * Convenience wrapper around `snapshotRow` + `classifySnapshot` for callers
 * that only need one row's classification (e.g. unit tests).
 */
function classifyRow(row) {
    return classifySnapshot(snapshotRow(row));
}

/**
 * Collect the distinct valid digests carried by non-deduped bound rows whose
 * id is ALSO valid, and report whether they disagree (more than one distinct
 * digest). Shared by `aggregateRun` and `trustedOptionalIndexes` so both
 * agree on what counts as contradictory approval evidence.
 */
function computeApprovalMismatch(snapshots) {
    const validDigests = new Set();
    for (const snap of snapshots) {
        if (snap.status === "deduped") continue;
        if (isBoundSnapshot(snap) && isValidId(snap.id) && isValidDigest(snap.digest)) {
            validDigests.add(snap.digest);
        }
    }
    return validDigests.size > 1;
}

/**
 * WP-77I: indexes (into `snapshots`, same order as the input rows) of rows
 * that are TRUSTED optional assertions — a bound row (own id or digest),
 * with a valid id AND a valid digest, that claims `required: false`, while
 * the run's approval provenance is proven and free of contradictory digest
 * evidence. Any other `required: false` claim (unbound, malformed id/digest,
 * unproven provenance, or mismatched digests) is never trusted and is
 * treated exactly like a required row — fail closed.
 */
function computeTrustedOptionalSet(snapshots, approvalUnproven, approvalMismatch) {
    const trusted = new Set();
    snapshots.forEach((snap, idx) => {
        if (snap.status === "deduped") return;
        if (!snap.optionalClaim) return;
        if (!isBoundSnapshot(snap)) return;
        if (!(isValidId(snap.id) && isValidDigest(snap.digest))) return;
        if (approvalUnproven) return;
        if (approvalMismatch) return;
        trusted.add(idx);
    });
    return trusted;
}

/**
 * Public helper: which rows (by index into `rows`) are trusted optional
 * assertions. `ReportManager` uses this to keep its own tallies in sync with
 * `aggregateRun`'s classification without duplicating the trust rule.
 */
function trustedOptionalIndexes(rows, opts) {
    const list = Array.isArray(rows) ? rows : [];
    const approvalUnproven = !!(opts && opts.approvalProvenance === "unproven");
    const snapshots = list.map(snapshotRow);
    const approvalMismatch = computeApprovalMismatch(snapshots);
    return computeTrustedOptionalSet(snapshots, approvalUnproven, approvalMismatch);
}

/**
 * Aggregate a run's rows into the additive `verification` report block.
 * Pure function of `rows`: order-independent, no timestamps/ids, and never
 * copies locator/value text from any assertion into the result.
 */
function aggregateRun(rows, opts) {
    const list = Array.isArray(rows) ? rows : [];
    // WP-77H: read the provenance option exactly once. Shard-merged rows
    // carry an assertion id/digest that is only shape-validated against the
    // fragment schema — nothing ties it to an approved business-outcome
    // contract. When the caller marks the run's approval provenance as
    // "unproven" (ShardMerge does this on its single buildReport call), a
    // bound PASS can never be trusted enough to report BUSINESS_VERIFIED;
    // it is downgraded to INCONCLUSIVE with reason APPROVAL_UNPROVEN. Any
    // other opts value (including undefined) preserves prior behaviour.
    const approvalUnproven = !!(opts && opts.approvalProvenance === "unproven");

    let pass = 0, fail = 0, inconclusive = 0, refused = 0, notTested = 0, required = 0;
    let interactionCount = 0, technicalFailureCount = 0;
    // WP-77I: trusted-optional tallies. These never feed `required`, `fail`,
    // `inconclusive`, etc. above, so an optional-only outcome can never by
    // itself flip the run's level between FAILED/UNVERIFIED/BUSINESS_VERIFIED.
    let optTotal = 0, optPass = 0, optFail = 0, optInconclusive = 0, optNotTested = 0;
    const reasonSet = new Set();

    // Snapshot every row exactly once; both the distinct-digest collection
    // below and the per-row classification work from these snapshots, never
    // re-reading `row`/`row.assertion`/`assertion.id`/`assertion.digest`.
    const snapshots = list.map(snapshotRow);

    // WP-77F: contradictory approval evidence. More than one distinct valid
    // digest among bound rows means the rows disagree about which approved
    // contract they came from, so no bound PASS in this run can be trusted —
    // and (WP-77I) no optional claim can be trusted either.
    const approvalMismatch = computeApprovalMismatch(snapshots);
    const trustedOptional = computeTrustedOptionalSet(snapshots, approvalUnproven, approvalMismatch);

    // An untrusted `required: false` claim on a bound row is never honoured:
    // it is treated exactly like a required row, but the run is flagged so
    // the claim's existence is still visible in the report.
    snapshots.forEach((snap, idx) => {
        if (snap.status === "deduped") return;
        if (isBoundSnapshot(snap) && snap.optionalClaim && !trustedOptional.has(idx)) {
            reasonSet.add(REASON_CODES.OPTIONAL_CLAIM_UNTRUSTED);
        }
    });

    snapshots.forEach((snap, idx) => {
        let classified = classifySnapshot(snap);
        if (classified.ignored) return;

        if (approvalMismatch && classified.assertionOutcome === "PASS" && isBoundSnapshot(snap)) {
            classified = { ...classified, assertionOutcome: "INCONCLUSIVE", reasonCodes: [...classified.reasonCodes, REASON_CODES.APPROVAL_MISMATCH] };
        }

        if (approvalUnproven && classified.assertionOutcome === "PASS" && isBoundSnapshot(snap)) {
            classified = { ...classified, assertionOutcome: "INCONCLUSIVE", reasonCodes: [...classified.reasonCodes, REASON_CODES.APPROVAL_UNPROVEN] };
        }

        for (const code of classified.reasonCodes) reasonSet.add(code);

        if (trustedOptional.has(idx)) {
            optTotal++;
            switch (classified.assertionOutcome) {
                case "PASS": optPass++; break;
                case "FAIL": optFail++; break;
                case "INCONCLUSIVE": optInconclusive++; break;
                case "NOT_TESTED": optNotTested++; break;
                default: break;
            }
            return;
        }

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
    });

    // Optional PASS/FAIL/INCONCLUSIVE count toward whether this run ran
    // anything at all (so an optional-only run is INTERACTION_ONLY, not
    // NO_TESTS_RUN); a skipped (NOT_TESTED) optional row does not.
    const ranCount = required + interactionCount + technicalFailureCount + optPass + optFail + optInconclusive;
    const hasFail = fail > 0 || technicalFailureCount > 0;
    const hasInconclusiveGroup = inconclusive > 0 || notTested > 0 || refused > 0;

    if (optFail > 0) reasonSet.add(REASON_CODES.OPTIONAL_FAILED);
    if ((optInconclusive + optNotTested) > 0) reasonSet.add(REASON_CODES.OPTIONAL_UNVERIFIED);

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
        assertions: {
            required, pass, fail, inconclusive, refused, notTested, proposedUnapproved: 0,
            // WP-77I: additive, present only when a trusted optional row exists, so
            // runs without optional assertions keep a byte-identical shape.
            ...(optPass + optFail + optInconclusive + optNotTested > 0
                ? { optional: { total: optPass + optFail + optInconclusive + optNotTested, pass: optPass, fail: optFail, inconclusive: optInconclusive, notTested: optNotTested } }
                : {}),
        },
        reasonCodes: [...reasonSet].sort(),
    };
}

module.exports = { classifyRow, aggregateRun, trustedOptionalIndexes, REASON_CODES };
