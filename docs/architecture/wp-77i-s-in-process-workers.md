# WP-77I-S: in-process approved-contract workers

Status: design accepted (parent issue #77). Baseline `3dbdebd`. The work is split into two packages:

- **S1 (Package 1): Trusted Verification Core.** Implemented (PR #140). Described in "WP-77I-S1" below.
- **S2 (Package 2): in-process workers, CLI orchestration and journey scheduling.** Implemented together with WP-77Q in one branch; see `wp-77-s2-q-evidence.md`. The "Package 2 design" section below is the accepted design it follows.

## WP-77I-S1: Trusted Verification Core

### What S1 delivers

- **Approved-contract binding.** `ExecutionBinding.bind()` reads the contract file once, recomputes its digest, requires the digest to be `APPROVED` in the `ContractStore`, and returns a deep-frozen, issued binding. A matching digest binds *content*; it does not authenticate who approved it.
- **Binding immutability and revalidation.** The returned binding object is frozen, and so is its contract. `ExecutionBinding.revalidate(binding, { storeRoot, repoRoot })` re-checks, on demand, that a binding was issued, that its digest still matches its own contract, and that the digest is still `APPROVED` (revocation, supersession and an unreadable store fail closed with closed-set codes).
- **Authoritative required/optional reconciliation.** Which assertions exist, and whether each is required, come only from the approved contract. A row's own `required` claim is ignored.
- **Evidence-integrity checks.** Unknown assertion ids, duplicate evidence, a binding that was not issued or no longer matches its contract, and malformed statuses all fail closed (see the table below). Technical integrity problems travel on their own channel (`summary.integrityBreaches`) and never add a synthetic assertion row.
- **Required-quarantine correction.** A quarantined required assertion previously produced result `PASSED` beside verification level `FAILED`. It is now non-successful. Plain UI quarantine (no contract assertion) is unchanged.
- **Empty aggregate fails closed.** `aggregateJourneys([])` (and `null` or `undefined`) returns `UNVERIFIED` with `NO_TESTS_RUN`, never `BUSINESS_VERIFIED`.

### What S1 does not deliver

- No `--plan ... --workers N` orchestration, no journey scheduling, no worker or CLI changes. S1 supplies the trusted core those features will call.
- No authenticated cross-process shard verification. Shard bundles carry an unkeyed, self-attested hash, which is not authentication. Rows merged from independent shard bundles stay `unproven` and never reach `BUSINESS_VERIFIED`. `--plan` with `--shard` stays refused.
- No keyed signing, external attestation, dashboard approval or `severity: "blocking"`.

### Trust boundary

- Issuance state is a `WeakSet` private to `ExecutionBinding.js`. `bind()` is the only code that adds to it; `isIssued()` is read-only. There is no registry module and no claim or mint function. (An earlier design exposed a one-shot claim function; it was removed because import order could let another module claim it.)
- A hand-built object, a spread copy, an `Object.create` clone, a JSON copy or a Proxy of a real binding is not issued and is refused (`BINDING_UNISSUED`). A binding whose contract or digest was altered after issuance is refused (`BINDING_TAMPERED`).
- **Protected:** untrusted data (report rows, plan files, shard bundles) presented to approved execution paths.
- **Not protected, outside the threat model:** arbitrary malicious code already running with full privileges in the Falcon process. Such code can patch modules or use the debugger.

### Status semantics for rows matched to a contract assertion

| Evidence row status | Result | Verification level | Reason code | Integrity breach |
|---|---|---|---|---|
| required `passed` (all required pass) | `PASSED` | `BUSINESS_VERIFIED` | none | no |
| required `failed` | `PARTIAL` or `FAILED` | `FAILED` | none | no |
| required `quarantined` | non-`PASSED` | `FAILED` | none (`summary.quarantineGating` counts it) | no |
| required `unavailable` or no row | `PARTIAL` | `UNVERIFIED` | none | no |
| required `skipped` | `PARTIAL` | `UNVERIFIED` | `EVIDENCE_NOT_EXECUTED` | no |
| any status outside the vocabulary (`undefined`, `null`, `"PASS"`, other strings or types) | `PARTIAL` | `UNVERIFIED` | `EVIDENCE_INVALID_STATUS` | yes |
| optional `skipped` | does not block | unchanged | `OPTIONAL_UNVERIFIED` | no |
| optional `failed` | does not block | unchanged | `OPTIONAL_FAILED` | no |
| optional malformed status | non-`PASSED` | not `BUSINESS_VERIFIED` | `EVIDENCE_INVALID_STATUS` | yes |
| unknown id or digest mismatch | non-`PASSED` | not `BUSINESS_VERIFIED` | `EVIDENCE_UNKNOWN` | yes |
| duplicate evidence for one id | non-`PASSED` | not `BUSINESS_VERIFIED` | `EVIDENCE_DUPLICATE` | yes |
| binding not issued / tampered | non-`PASSED` | `UNVERIFIED` (`FAILED` if the supplied rows report a failure) | `BINDING_UNISSUED` / `BINDING_TAMPERED` | yes |

Notes:

- The vocabulary is `passed`, `failed`, `skipped`, `quarantined`, `deduped`, `unavailable`.
- A skipped required assertion was recognized but not executed: it never verifies anything and never manufactures a business failure. A malformed status is evidence tampering or a producer bug: it is an integrity breach, not an ordinary unavailable result.
- Reason codes are a closed set. Reports never contain contract text, expected values or the malformed status text.
- A malformed optional status cannot hide a required failure; the required failure still sets level `FAILED`.

### Result versus verification level

- **Technical result** (`report.result`, CLI exit code): `PASSED`, `PARTIAL`, `FAILED`, `NO_TESTS_RUN`. `PASSED` requires no failed, unavailable or gating-quarantined rows and zero integrity breaches. Only `PASSED` exits 0.
- **Verification level** (`report.verification.level`): `BUSINESS_VERIFIED`, `INTERACTION_ONLY`, `UNVERIFIED`, `FAILED`. It says whether approved required assertions were proven.
- For a run with required assertions, a level of `FAILED` or `UNVERIFIED` is never paired with a technical `PASSED`.

### Known limitations and requirements for S2 (P3 findings)

These are not delivered by S1 and are recorded so S2 does not assume them:

- `buildReport` and `aggregateJourneys` do not call `revalidate`. A binding whose approval was revoked or superseded after issuance still reports as verified if reported later. S2 must call `revalidate` at merge time.
- The same binding passed in twice is not rejected, which inflates the journey count. S2 must reject duplicate bindings or journeys.
- With several journeys, per-journey digests can make optional rows count as required in the `ReportManager` tallies. This fails safe but the tallies can disagree with the `verification` block. S2 must reconcile them.
- A required failure beside an optional row that did not pass reports result `PARTIAL` (level `FAILED`). That behaviour predates S1; S2 should decide whether it should be `FAILED`.
- `buildReport` without `journeyEntries` (the legacy, contractless path) still trusts a bound row's own `required` flag. Its callers build rows in-process from the issued contract or are `unproven` shard rows, so untrusted data cannot reach it.
- A stale comment in `src/core/ReportManager.js` still names the removed `BindingRegistry`. It is informational and is left for a separately reviewed change.
- Local Playwright-pin regression failures (installed 1.64.0 versus the 1.64.1 pin) are environmental and were not repaired by this work.

## Package 2 design (delivered by S2, see wp-77-s2-q-evidence.md)

The following is the accepted design for S2. S2 implements it (with the deviations listed in the evidence document).

- `--plan <file> [--plan <file> ...] --workers N` runs several approved-contract journeys concurrently in one process.
- Whole-journey scheduling: one plan is one contract is one journey. Assertions are never split across workers, so journey steps are never replayed.
- The approved contract is bound once per journey, before any browser work, and the frozen binding is handed to the worker.
- Approval is re-queried per journey at the in-process merge boundary (revocation, replacement, unreadable store all fail closed).

Not part of S2 either: cross-process approved-contract shard verification (`--plan` with `--shard` stays refused), keyed signing, dashboard approval, `severity: "blocking"`, journey discovery (#78), final qualification (WP-77Q).

| Area | S1 | S2 |
|---|---|---|
| `ExecutionBinding` | private issuance, `isIssued()`, `revalidate()` | called at merge time |
| `Verification` | `aggregateJourneys`, contract-derived classification, closed-set integrity codes | consumed by the coordinator |
| `ReportManager.buildReport` | additive `journeyEntries`, required quarantine gating, `integrityBreaches` | multi-journey tally reconciliation |
| `JourneyCoordinator` | none | merge-time `ContractStore.status` re-check per journey |
| `falcon.js`, `MultiJourneyRunner` | none | strict repeated `--plan`, one browser context per journey, serialized shared stores |

## Reporting

Single-journey runs keep the existing `verification` shape byte for byte. With more than one journey the block adds `perJourney`. Roll-up: any `FAILED` gives `FAILED`, else any `UNVERIFIED`, else any `INTERACTION_ONLY`, else `BUSINESS_VERIFIED`. Journeys are ordered by `journeyId`.

## Compatibility note (required quarantine)

A required `verify` row with status `quarantined` previously produced `result: PASSED` (exit 0) beside `verification.level: FAILED`. It now produces a non-`PASSED` result and exit code 1. Plain UI quarantine (no assertion) is unchanged.

## Authorship

The S1 documentation update was written by the coordinator under a documented CTO exception after the Technical Writer dispatch ended without a report.
