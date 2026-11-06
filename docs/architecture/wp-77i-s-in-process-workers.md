# WP-77I-S: in-process approved-contract workers

Status: design accepted for implementation (parent issue #77). Baseline `3dbdebd`.

## Scope

Delivered by this package:

- `--plan <file> [--plan <file> ...] --workers N` runs several approved-contract journeys concurrently in one process.
- Whole-journey scheduling: one plan is one contract is one journey. Assertions are never split across workers, so journey steps are never replayed.
- The approved contract is bound once per journey, before any browser work, and the frozen binding is handed to the worker.
- Required/optional membership comes only from the approved contract (S4). A row's own `required` claim is ignored.
- Approval is re-queried per journey at the in-process merge boundary (revocation, replacement, unreadable store all fail closed).
- A required business assertion cannot be hidden by marking it quarantined (S6).

Not delivered:

- Cross-process approved-contract shard verification. `--plan` with `--shard` stays refused. Shard bundles stay `unproven` and never reach `BUSINESS_VERIFIED`. A bundle hash is self-attested and is not authentication.
- Keyed signing, external attestation, dashboard approval, `severity: "blocking"`, journey discovery (#78), final qualification (WP-77Q).

## Trust model

Evidence is trusted because it is produced inside the coordinator process from a binding the coordinator itself obtained from `ExecutionBinding.bind()`. `bind()` records each successful binding in a module-private `WeakSet`; `ExecutionBinding.isIssued()` is the only way to test membership. Verification refuses a binding that was not issued. This defeats untrusted data (rows, plan files, bundles) but not malicious code running in the same process; that limit is documented and unchanged from the approval store's local trust boundary.

## Components

| Area | Change |
|---|---|
| `ExecutionBinding` | issuance registry, `isIssued()` |
| `Verification` | `aggregateJourneys(entries)`; per-journey classification against the contract; duplicate, unknown and conflicting rows fail closed |
| `ReportManager.buildReport` | additive `journeyEntries` option; required quarantined rows count as failing |
| `JourneyCoordinator` | merge-time `ContractStore.status` re-check per journey |
| `falcon.js`, `MultiJourneyRunner` | strict repeated `--plan`, one browser context per journey, serialized shared stores |

## Reporting

Single-journey runs keep the existing `verification` shape byte for byte. With more than one journey the block adds `perJourney`. Roll-up: any FAILED gives FAILED, else any UNVERIFIED, else any INTERACTION_ONLY, else BUSINESS_VERIFIED. Journeys are ordered by `journeyId`.

## Compatibility note (S6)

A required `verify` row with status `quarantined` previously produced `result: PASSED` (exit 0) beside `verification.level: FAILED`. It now produces a non-PASSED result and exit code 1. Plain UI quarantine (no assertion) is unchanged.
