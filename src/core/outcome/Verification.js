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
    // WP-77I/S4 (multi-journey aggregation):
    BINDING_UNISSUED: "BINDING_UNISSUED",
    EVIDENCE_UNKNOWN: "EVIDENCE_UNKNOWN",
    EVIDENCE_DUPLICATE: "EVIDENCE_DUPLICATE",
    // WP-77IS (repair): a binding that IS issued but fails an independent
    // integrity re-check (mutated after issuance, or digest no longer
    // matches its own contract).
    BINDING_TAMPERED: "BINDING_TAMPERED",
    // WP-77IS (security P1): a REQUIRED contract assertion whose matched row
    // reports `skipped` was recognized but never executed (not a business
    // failure, never a pass); and a row whose status is outside the
    // reporting vocabulary is malformed evidence (an integrity breach).
    EVIDENCE_NOT_EXECUTED: "EVIDENCE_NOT_EXECUTED",
    EVIDENCE_INVALID_STATUS: "EVIDENCE_INVALID_STATUS",
});

const VALID_ROW_STATUSES = new Set(["passed", "failed", "skipped", "quarantined", "deduped", "unavailable"]);

/**
 * Normalize the status of the single row matched to a contract assertion.
 * `skipped` on a required assertion becomes `unavailable` plus a closed-set
 * NOT_EXECUTED reason (no business failure is manufactured). A status outside
 * the vocabulary (undefined, null, "PASS", anything else) is never trusted:
 * it becomes `unavailable` and is flagged as an integrity breach.
 */
function normalizeMatchedStatus(status, required) {
    if (status === "passed" || status === "failed" || status === "quarantined" || status === "unavailable") {
        return { status };
    }
    if (status === "skipped") {
        return required
            ? { status: "unavailable", reason: REASON_CODES.EVIDENCE_NOT_EXECUTED }
            : { status: "skipped" };
    }
    return { status: "unavailable", reason: REASON_CODES.EVIDENCE_INVALID_STATUS, breach: true };
}

const ExecutionBinding = require("./ExecutionBinding");
// Pure module (no I/O) — safe to require directly for the independent
// digest recheck below. Referenced as `Contract.digestOf(...)` (never
// destructured) so a test can swap the method on the module object for a
// tamper-defense-in-depth check without needing to mutate this module.
const Contract = require("./Contract");

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
    let optPass = 0, optFail = 0, optInconclusive = 0, optNotTested = 0;
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

    // An untrusted `required: false` claim (bound or unbound) is never honoured:
    // it is treated exactly like a required row, but the run is flagged so
    // the claim's existence is still visible in the report.
    snapshots.forEach((snap, idx) => {
        if (snap.status === "deduped") return;
        if (snap.optionalClaim && !trustedOptional.has(idx)) {
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

/**
 * WP-77I/S4 — multi-journey aggregation.
 *
 * Resolve a single journey entry `{ binding, rows }` into the rows that are
 * actually proven to belong to that journey's APPROVED contract, then
 * delegate to `aggregateRun` for the per-run classification rules so the
 * two code paths can never silently diverge.
 *
 * A row only ever counts as evidence for an expected contract assertion id
 * when ALL of the following hold: the binding was actually issued by
 * `ExecutionBinding.bind()` (never a hand-built object literal), the row's
 * own `journeyId` matches the binding's, the row's assertion carries its own
 * `id` (one of the contract's), and the row's assertion digest equals the
 * binding's proven digest. `required` for every expected assertion comes
 * ONLY from the contract — a row's own `required` claim is never consulted.
 */
function buildExpectedMap(contract) {
    const list = Array.isArray(contract && contract.assertions) ? contract.assertions : [];
    const expected = new Map();
    for (const a of list) {
        if (a && typeof a.id === "string" && a.id.length > 0 && !expected.has(a.id)) {
            expected.set(a.id, { required: !!a.required, check: a.check, locator: a.locator });
        }
    }
    return expected;
}

/**
 * Verification block for a journey whose binding cannot be trusted at all
 * (unissued or tampered) and that supplied no failing row. Deliberately NOT
 * a synthetic contract assertion: nothing here carries an id or digest, so it
 * can never contaminate the approved-contract digest comparison or the
 * optional-claim trust rule, and it fabricates no business PASS or FAIL.
 * The breach is carried on a separate technical-integrity channel
 * (`integrityBreaches`, see `reconcileJourneys`) plus a closed-set reason code.
 */
function untrustedVerification() {
    return {
        schemaVersion: 1,
        level: "UNVERIFIED",
        journeys: { total: 1, businessVerified: 0, interactionOnly: 0, unverified: 1, failed: 0 },
        assertions: { required: 0, pass: 0, fail: 0, inconclusive: 0, refused: 0, notTested: 0, proposedUnapproved: 0 },
        reasonCodes: [],
    };
}

/**
 * A real failure/quarantine must never be reduced just because its binding
 * or evidence could not be trusted (contract rule 3). This re-expresses the
 * row as a plain, unbound failure — no id/digest, so it is never mistaken
 * for trusted contract evidence, but it still counts as a technical failure
 * and so still forces the run to FAILED rather than merely UNVERIFIED.
 */
function plainFailedRow(journeyId) {
    return { name: `${journeyId || "unknown"}:evidence`, journeyId, status: "failed" };
}

/**
 * Independent, authoritative re-check that an issued binding is still
 * trustworthy: still frozen (never mutated after issuance), its contract
 * still frozen, its contract's own journeyId matching what the binding
 * claims, and a digest independently recomputed from the binding's own
 * frozen contract still matching the digest the binding carries. Never
 * throws; any failure (including a hostile/absent `contract`) is untrusted.
 */
function isBindingIntegrityValid(binding) {
    try {
        return Object.isFrozen(binding)
            && !!binding.contract
            && Object.isFrozen(binding.contract)
            && binding.contract.journeyId === binding.journeyId
            && Contract.digestOf(binding.contract) === binding.digest;
    } catch {
        return false;
    }
}

function resolveJourney(binding, rows, opts) {
    const rowList = Array.isArray(rows) ? rows : [];
    const issued = ExecutionBinding.isIssued(binding);
    const integrityOk = issued && isBindingIntegrityValid(binding);

    if (!issued || !integrityOk) {
        // Fails closed: an unissued OR tampered binding (including a forged
        // object literal with matching-looking fields, or one mutated after
        // issuance) is given no trust at all for *membership*. A real
        // failure/quarantine already present in the supplied rows is never
        // dropped (contract rule 3): it is re-expressed as a plain technical
        // failure. The breach itself rides the separate integrity channel
        // (one breach per untrusted journey) — no synthetic assertion row.
        const journeyId = journeyIdOf(binding);
        const sanitizedRows = [];
        for (const row of rowList) {
            const snap = snapshotRow(row);
            if (snap.status === "failed" || snap.status === "quarantined") {
                sanitizedRows.push(plainFailedRow(journeyId));
            }
        }
        const verification = sanitizedRows.length > 0 ? aggregateRun(sanitizedRows, opts) : untrustedVerification();
        return {
            reasons: new Set([issued ? REASON_CODES.BINDING_TAMPERED : REASON_CODES.BINDING_UNISSUED]),
            level: verification.level,
            verification,
            sanitizedRows,
            integrityBreaches: 1,
        };
    }

    const reasons = new Set();
    const expected = buildExpectedMap(binding.contract);
    const byId = new Map();
    const passthrough = [];
    let integrityBreaches = 0;

    for (const row of rowList) {
        const snap = snapshotRow(row);
        if (snap.status === "deduped") {
            passthrough.push(row);
            continue;
        }
        if (isBoundSnapshot(snap)) {
            const id = snap.id;
            const belongs = expected.has(id)
                && row && row.journeyId === binding.journeyId
                && snap.digest === binding.digest;
            if (belongs) {
                const list = byId.get(id) || [];
                list.push(row);
                byId.set(id, list);
            } else {
                // WP-77IS (repair): unknown evidence (unknown id, digest
                // mismatch, or wrong journeyId) is never simply dropped. A
                // failure/quarantine the row itself reports still surfaces
                // as a plain failure (rule 3), and every unknown row is one
                // breach on the separate integrity channel, which keeps the
                // technical result non-PASSED and the level below
                // BUSINESS_VERIFIED. No synthetic contract assertion is made.
                reasons.add(REASON_CODES.EVIDENCE_UNKNOWN);
                integrityBreaches++;
                if (snap.status === "failed" || snap.status === "quarantined") {
                    passthrough.push(plainFailedRow(binding.journeyId));
                }
            }
        } else if (VALID_ROW_STATUSES.has(snap.status)) {
            passthrough.push(row);
        } else {
            // Malformed status on a plain row: never trusted, never counted.
            reasons.add(REASON_CODES.EVIDENCE_INVALID_STATUS);
            integrityBreaches++;
        }
    }

    const sanitizedAssertionRows = [];
    for (const [id, def] of expected) {
        const matches = byId.get(id) || [];
        if (matches.length === 0) {
            sanitizedAssertionRows.push({
                status: "unavailable",
                required: def.required,
                assertion: { id, digest: binding.digest, check: def.check, locator: def.locator },
            });
        } else if (matches.length === 1) {
            const norm = normalizeMatchedStatus(matches[0] && matches[0].status, def.required);
            if (norm.reason) reasons.add(norm.reason);
            if (norm.breach) integrityBreaches++;
            sanitizedAssertionRows.push({
                status: norm.status,
                required: def.required,
                assertion: { id, digest: binding.digest, check: def.check, locator: def.locator },
            });
        } else {
            reasons.add(REASON_CODES.EVIDENCE_DUPLICATE);
            integrityBreaches++;
            const anyFailing = matches.some((r) => r && (r.status === "failed" || r.status === "quarantined" || r.status === "unavailable"));
            sanitizedAssertionRows.push({
                status: anyFailing ? "failed" : "unavailable",
                required: def.required,
                assertion: { id, digest: binding.digest, check: def.check, locator: def.locator },
            });
        }
    }

    const sanitizedRows = sanitizedAssertionRows.concat(passthrough);
    const verification = aggregateRun(sanitizedRows, opts);

    let level = verification.level;
    if ((reasons.has(REASON_CODES.EVIDENCE_UNKNOWN) || reasons.has(REASON_CODES.EVIDENCE_DUPLICATE)
        || reasons.has(REASON_CODES.EVIDENCE_NOT_EXECUTED) || reasons.has(REASON_CODES.EVIDENCE_INVALID_STATUS))
        && (level === "BUSINESS_VERIFIED" || level === "INTERACTION_ONLY")) {
        level = "UNVERIFIED";
    }

    return { reasons, level, verification, sanitizedRows, integrityBreaches };
}

function journeyIdOf(binding) {
    return (binding && typeof binding.journeyId === "string") ? binding.journeyId : "";
}

function sortedEntries(entries) {
    const list = Array.isArray(entries) ? entries.slice() : [];
    list.sort((a, b) => {
        const ja = journeyIdOf(a && a.binding);
        const jb = journeyIdOf(b && b.binding);
        return ja < jb ? -1 : (ja > jb ? 1 : 0);
    });
    return list;
}

/**
 * Flat sanitized rows (contract-derived `required`, synthesized missing/
 * duplicate/unissued rows) across every journey, in the same sorted order
 * `aggregateJourneys` uses. `ReportManager` tallies from this list instead
 * of raw rows when it is given `journeyEntries`, so its summary counts can
 * never disagree with what `aggregateJourneys` actually trusted.
 */
function reconcileJourneys(entries, opts) {
    const rows = [];
    let integrityBreaches = 0;
    for (const entry of sortedEntries(entries)) {
        const resolved = resolveJourney(entry && entry.binding, entry && entry.rows, opts);
        for (const row of resolved.sanitizedRows) rows.push(row);
        integrityBreaches += resolved.integrityBreaches;
    }
    return { rows, integrityBreaches };
}

function sanitizeJourneyRows(entries, opts) {
    return reconcileJourneys(entries, opts).rows;
}

/**
 * Aggregate multiple journeys, each proven against its own issued binding
 * and APPROVED contract, into one additive `verification` report block.
 * Pure: no I/O, no clock. See module header / WP-77I-S design doc.
 */
function aggregateJourneys(entries, opts) {
    const list = sortedEntries(entries);

    const journeys = { total: list.length, businessVerified: 0, interactionOnly: 0, unverified: 0, failed: 0 };
    const perJourney = [];
    const reasonSet = new Set();
    let required = 0, pass = 0, fail = 0, inconclusive = 0, refused = 0, notTested = 0;
    let optPass = 0, optFail = 0, optInconclusive = 0, optNotTested = 0, hasOptional = false;

    for (const entry of list) {
        const binding = entry && entry.binding;
        const resolved = resolveJourney(binding, entry && entry.rows, opts);

        for (const code of resolved.reasons) reasonSet.add(code);

        switch (resolved.level) {
            case "BUSINESS_VERIFIED": journeys.businessVerified++; break;
            case "INTERACTION_ONLY": journeys.interactionOnly++; break;
            case "UNVERIFIED": journeys.unverified++; break;
            default: journeys.failed++; break;
        }

        const a = resolved.verification.assertions;
        required += a.required; pass += a.pass; fail += a.fail;
        inconclusive += a.inconclusive; refused += a.refused; notTested += a.notTested;
        for (const code of resolved.verification.reasonCodes) reasonSet.add(code);
        if (a.optional) {
            hasOptional = true;
            optPass += a.optional.pass; optFail += a.optional.fail;
            optInconclusive += a.optional.inconclusive; optNotTested += a.optional.notTested;
        }

        perJourney.push({
            journeyId: (binding && typeof binding.journeyId === "string") ? binding.journeyId : null,
            digest: (binding && typeof binding.digest === "string") ? binding.digest : null,
            level: resolved.level,
        });
    }

    let level;
    if (journeys.failed > 0) level = "FAILED";
    else if (journeys.unverified > 0) level = "UNVERIFIED";
    else if (journeys.interactionOnly > 0) level = "INTERACTION_ONLY";
    else if (journeys.total === 0) level = "UNVERIFIED";
    else level = "BUSINESS_VERIFIED";
    // WP-77IS (M2): no journey evidence at all is never business verification.
    if (journeys.total === 0) reasonSet.add("NO_TESTS_RUN");

    const result = {
        schemaVersion: 1,
        level,
        journeys,
        assertions: {
            required, pass, fail, inconclusive, refused, notTested, proposedUnapproved: 0,
            ...(hasOptional
                ? { optional: { total: optPass + optFail + optInconclusive + optNotTested, pass: optPass, fail: optFail, inconclusive: optInconclusive, notTested: optNotTested } }
                : {}),
        },
        reasonCodes: [...reasonSet].sort(),
    };
    // Single-entry, no-integrity-issue runs must stay byte-identical to what
    // `aggregateRun` alone would have produced: `perJourney` is additive and
    // only appears once there is more than one journey to report.
    if (list.length > 1) result.perJourney = perJourney;
    return result;
}

/**
 * Public helper: is this row "bound" (its assertion carries its own `id` or
 * `digest` field — contract-origin, as opposed to a plain contractless UI
 * `expect`)? `ReportManager` uses this (WP-77I/S6) to tell a quarantined
 * REQUIRED bound business assertion (never just a warning) apart from a
 * plain UI/unbound quarantine (unchanged, warning-only behaviour).
 */
function isBoundRow(row) {
    return isBoundSnapshot(snapshotRow(row));
}

module.exports = {
    classifyRow,
    aggregateRun,
    trustedOptionalIndexes,
    aggregateJourneys,
    sanitizeJourneyRows,
    reconcileJourneys,
    isBoundRow,
    REASON_CODES,
};
