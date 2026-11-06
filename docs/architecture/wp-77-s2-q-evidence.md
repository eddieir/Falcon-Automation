# WP-77I-S2 + WP-77Q: approved-contract workers and qualification (issue #77)

Single branch `feat/m1-wp77-s2-q-completion`, single PR, single production cycle, single evidence ledger.
Baseline: `5b523331b850f0e7fd6c56d2417a0e1254169183` (main, S1 merged). Issue #77 stays open until the CTO authorizes closure.

## Stage 0: baseline verification (coordinator, no dispatch)

| Check | Result |
|---|---|
| `origin/main` HEAD equals authorized baseline | yes, `5b52333`; no newer commits |
| PR #140 (S1) merged | yes |
| Issue #77 open | yes |
| Open PR already implementing S2/Q | none |
| Existing APIs | `ExecutionBinding.bind/revalidate/isIssued`, `Verification.aggregateJourneys/reconcileJourneys`, `ReportManager.buildReport({journeyEntries})` |
| Existing CLI | single strict `--plan=<file>`; `--plan` with `--workers`/`--shard` refused (`falcon.js`) |

## Implementation map

| Area | Owner | Files |
|---|---|---|
| Coordinator: validate, bind-all, whole-journey scheduling, merge-time revalidation | Developer 1 | `src/core/outcome/JourneyCoordinator.js` (new) |
| Duplicate journey/binding protection, revalidation verdict, per-journey optional tally fix, new closed-set reason codes | Developer 1 | `src/core/outcome/Verification.js`, `src/core/ReportManager.js` |
| CLI wiring: repeated `--plan`, `--workers`, one browser context per journey | Coordinator (limited wiring, recorded) | `falcon.js` |
| Acceptance tests 1-24, negative config tests, browser integration, benchmark | Developer 2 | `tests/unit/`, `tests/regression/`, `scripts/benchmark/` |
| Documentation, migration, rollback | Coordinator (CTO exception) | this file, `docs/architecture/wp-77i-s-in-process-workers.md`, README/CHANGELOG |

## Dispatch ledger

| # | Role | Model (front matter) | Verdict | Notes |
|---|---|---|---|---|
| 1 | Developer 1 (core runtime) | claude-sonnet-5 (front matter) | PARTIAL, 10-turn limit, no report | Only src/core/outcome/JourneyCoordinator.js written (unreviewed, untested). Verification.js, ReportManager.js and JourneyCoordinator.check.js not started. Not auto-retried per directive. |

## Milestone log (coordinator, CTO exception for the runtime)

- M1: Developer 1 partial `JourneyCoordinator.js` reviewed (sound scheduling/bind-first/revalidate-after). Coordinator-authored changes: plan deep copy per journey, resolved-path duplicate-contract detection; `Verification.js` (JOURNEY_DUPLICATE, APPROVAL_REVALIDATION_FAILED, `requireRevalidation`, per-journey `optionalIndexes`); `ReportManager.js` (per-journey optional tallies, `requireRevalidation` passthrough). S1 suites JourneyAggregation 29/0, Verification 56/0 still green after the change. Authorship: coordinator, not independent approval.
- M2: `falcon.js` wiring (coordinator-authored): repeated `--plan=` or `--plan` with `--workers>1` routes to `JourneyCoordinator`; single plan with default workers stays on the untouched legacy path; `--shard` with `--plan` stays refused; one BrowserContext, deep-copied plan and cloned identities per journey; no dashboard in this mode. `tests/unit/JourneyCoordinator.check.js` added (22 tests, all pass) and `package.json`/CI now run it plus `JourneyAggregation.check.js`, which S1 had left out of the hosted CI step.
- Finding: the store has no revoke transition (APPROVED cannot be rejected, `INVALID_TRANSITION`); revocation is supersession, covered by test D1.

## What S2 delivers

- `--plan=<file>` repeated, or `--plan` with `--workers=N` (N from 1 to 8), runs whole approved-contract journeys concurrently in one process (`src/core/outcome/JourneyCoordinator.js`, wired in `falcon.js`).
- Every contract is bound (`ExecutionBinding.bind`) before any browser work. Each journey then runs on one worker in its own `BrowserContext`, with its own deep copy of the plan and its own cloned identities. Results are stored by index, so output order is `journeyId` order whatever the completion order.
- After all workers finish, every issued binding is re-checked against `ContractStore` (`ExecutionBinding.revalidate`). The report is built with `requireRevalidation`, so a journey without a successful merge-time verdict is never trusted.
- `Verification`: `JOURNEY_DUPLICATE` (same journey id or same binding object submitted twice), `APPROVAL_REVALIDATION_FAILED`, and per-journey optional classification (`optionalIndexes`). `ReportManager` tallies use it, so valid journeys with different digests no longer turn optional rows into required ones.
- Refused before any browser starts (exit 1): `--shard` with `--plan`, workers outside 1-8 or not an integer, a duplicate journey id or contract file, a plan without a contract among several, `--single-page`, `--save-plan` and `--url` in this mode.

## What S2 does not deliver (explicit)

- Cross-process `--shard` contract verification (still refused; no attestation protocol invented).
- Merge-time revalidation on the legacy single-process single-`--plan` path. That path is deliberately unchanged; it re-checks nothing after execution (as before).
- The dashboard in multi-journey mode (not started). Per-journey healing-event attribution (the shared `HealingReport` log is append-only and not split per journey).
- Dashboard approval, `severity: "blocking"`, keyed signing, journey discovery (#78).
- A revoke transition: the store has none (an APPROVED digest cannot be rejected). Revocation means supersession, which is what the tests exercise.

## Test evidence (candidate, this worktree, Node v22.19.0, Playwright installed 1.64.0)

| Command | Result |
|---|---|
| `node tests/unit/JourneyCoordinator.check.js` | 22 passed, 0 failed |
| `npm run test:unit` | exit 0 (includes `JourneyAggregation` 29/0, `Verification` 56/0, `OptionalAssertions` 18/0) |
| `node --test --test-concurrency=1 tests/regression/approved-workers.check.cjs` | 10 pass, 0 fail (real Chromium, loopback) |
| `npm run test:regression` (full, once) | 2482 tests: 2480 pass, 2 fail. Both failures are `playwright-pin.check.cjs` (installed 1.64.0 vs pin 1.64.1); environmental, identical on the baseline, and the hosted CI installs the pin with `npm ci` |
| `npm run test:browser` | 61 passed |
| `tests/regression/{m17-byok-docs,p14-claims,cli}.check.cjs` re-run after the docs edits | 76 pass, 0 fail |

Mutation check (failing-before evidence for isolation): forcing every journey onto one shared `BrowserContext` makes W4 fail; the real implementation passes. The pooled-digest tally defect is shown directly by unit test B4 (`trustedOptionalIndexes` over pooled rows trusts 0 optional rows; per-journey classification trusts both).

## Directive acceptance tests mapped to tests

| # | Requirement | Tests |
|---|---|---|
| 1 | Two approved journeys, two workers, both pass | A1, W1 |
| 2 | Required failure in one journey | B1, W2 |
| 3 | Optional failure, required success | B2, W3 |
| 4 | Optional-only contract | B5 |
| 5 | Missing evidence | B6 |
| 6 | Duplicate journey | C3, E1, W7 |
| 7 | Duplicate binding | C3 (same object and a second binding of one journey) |
| 8 | Unknown and conflicting assertions | C1, C2 |
| 9 | Approval revoked (superseded) before merge | D1 |
| 10 | Store-read failure | D2 (corrupted and missing store), D3 (unapproved) |
| 11 | Different approved digests | B4, W3 |
| 12 | Required skipped / invalid status | B6 |
| 13 | Required quarantined failure | B7 |
| 14 | Worker isolation | A5, W4 (with mutation check) |
| 15 | Legacy single-worker compatibility | W5, W9 |
| 16 | Contract `--shard` refusal | W6 (several cases), E1 |
| 17 | Privacy-safe reports, nonzero exits | A6, W1 (tokens absent), B-series exit codes via `generateReport` |
| - | Forged required flag; forged or copied binding | B7, C4 |
| - | Contractless legacy plan | W10 |

## Issue #77 acceptance coverage (evidence pointers; independent verdicts pending)

| Criterion | Evidence |
|---|---|
| Operator-confirmed approved assertions | S1 and earlier packages (propose/approve CLI); exercised by `addJourney` in W1-W10 |
| Deterministic execution, no runtime LLM | integration fixtures return 500 on any LLM endpoint; benchmark and tests run offline |
| Navigation, data, permission, side-effect assertions | earlier packages' suites (`business-assertion-integration.check.cjs`, passing in the full regression run); W1 combines navigation, data and permission across journeys |
| Approved-contract in-process parallel execution | `JourneyCoordinator`, A1-A5, W1-W5 |
| Trusted report and evidence reconciliation | C1-C5, D1-D3, B-series |
| No false-green business outcomes | B5-B7, C1-C5, D1-D3, W8 |
| Performance benchmark | below |
| Documentation and migration | this document, `CHANGELOG.md`, `docs/technical-reference.md` |
| QA, Code Review, Security, Release Manager acceptance | PENDING: not yet dispatched; coordinator authorship does not count |

## Benchmark (`npm run bench:approved-workers`, 4 journeys, 300 ms artificial page latency, 5 interleaved repeats after one warm-up)

| Workers | Median ms | Min | Max | Stddev | Median vs sequential | Peak node RSS (MB) |
|---|---|---|---|---|---|---|
| 1 (sequential) | 1929.0 | 1893.5 | 2005.5 | 44.4 | 1.00 | 140.8 |
| 2 | 1229.9 | 1156.9 | 1342.0 | 68.4 | 0.60 | 134.5 |
| 4 | 845.7 | 795.2 | 1194.9 | 149.0 | 0.40 | 136.6 |

Result equivalence: identical exit code, result and verification block for every sample at every worker count. Limitations: whole `falcon.js` processes including Chromium launch; small sample; one machine (macOS arm64, 10 CPUs); RSS covers the node process only, not Chromium; artificial latency; no speedup target is asserted and none should be inferred for real sites.

## Security notes and limitations

- Trust boundary unchanged from S1: private binding issuance, no new signing or attestation. Untrusted data (report rows, plans) cannot mint an issued binding; copied, spread, JSON-cloned or Proxy bindings are `BINDING_UNISSUED`.
- `revalidation` only ever downgrades: a forged `ok: true` cannot upgrade an unissued binding, and with `requireRevalidation` an absent verdict fails the journey. Entries are built in-process by the coordinator, not read from files.
- Worker errors never carry their message into reports (`JOURNEY_EXECUTION_ERROR`); reports contain closed-set codes, digests and ids, not tokens, URLs or expected values (W1 asserts tokens are absent).
- Residual risks for review: (1) locator-memory writes use pid-based lock files; two in-process journeys healing at once share one pid, so a lock conflict most likely fails that memory write (not verification). Not stress-tested for in-process concurrency. (2) `HealingReport` events are not attributed per journey. (3) The window between a journey's last assertion and the merge-time check is covered, but approval changes after the merge check are not (as for any point-in-time check). (4) `fixtures/identities.json` is read from the Falcon install directory, unchanged from WP-77R.

## Reproduce

```bash
npm ci
npm run test:unit
npm run test:regression      # in a checkout with the pinned Playwright 1.64.1
npm run test:browser
node --test --test-concurrency=1 tests/regression/approved-workers.check.cjs
npm run bench:approved-workers -- --journeys=4 --repeats=5 --latency-ms=300
```

## Usage and migration

```bash
node falcon.js --plan=a.plan.json --plan=b.plan.json --workers=2 --store-root=<store>
```

No migration is needed: existing single `--plan` runs, contractless plans, exit codes and shard-bundle behaviour are unchanged. To adopt, give each journey its own approved contract and plan (distinct `journeyId`), and pass the plans with `--workers`. Use `--workers=1` for ordered sequential execution through the same trusted path.

## Rollback

Revert this PR's merge commit (a single squash commit). There are no data or store-format changes, no new persistent state and no dependency changes. Without the commit, multiple `--plan` flags are refused again as in S1.

## Authorship and review status

- `JourneyCoordinator.js` was started by Developer 1 (PARTIAL, unreviewed on return); the coordinator reviewed it, changed it (plan copy, resolved-path duplicate check) and wrote the rest of the runtime, the tests, the benchmark and the documentation, under the CTO exception of this cycle. This is coordinator-authored work and is not independent approval.
- Independent QA, Code Review, Security and Release Manager verdicts: not yet requested. Dispatch usage: 1 of 8 (the failed Developer 1 run); 5 planned review/qualification dispatches and 2 reserves remain, none used.
