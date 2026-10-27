# M1 — Trustworthy Alpha: detailed implementation plan (#79, #77, #78)

Status: **PROPOSED, not authorised.** No runtime code is changed by this document. Revision basis: `origin/main` `f910c66`. Contract placement (Architect recommendation for Q4): store the contract **beside** the plan, bound by `journeyId` + `digest`; embedding it would force a `PlanFile` version bump and mix approved data with plan key lists. Contract details: [BUSINESS-CORRECTNESS-CONTRACT.md](BUSINESS-CORRECTNESS-CONTRACT.md). Decisions D1–D9: [EXECUTION-STRATEGY.md](EXECUTION-STRATEGY.md).

Goal in one sentence: Falcon never reports a business-verified pass without approved, evaluated assertions, and says plainly when it only exercised the interface.

## 1. Order and dependencies

| WP | Issue | Title | Depends on | Size |
|---|---|---|---|---|
| WP-79a | #79 | Verification classification (pure module, additive report block) | M0 | S |
| WP-77a | #77 | Contract schema, validator, digest, lifecycle store | WP-79a (types) | M |
| WP-77b | #77 | Stage A evaluator: new `expect` checks incl. money | WP-77a | M |
| WP-79s | #79 | Shard carriage: extend the strict shard row schema (`Schemas.js`) and `ShardMerge`/`Reducers` to carry assertion outcome, `journeyId`, `required`; legacy bundles still load | WP-79a | M |
| WP-79b | #79 | CLI `--require-verified`, dashboard, Allure; merged equals unsharded | WP-79s, WP-77b, G-03 | M |
| WP-77c | #77 | Business-correctness fixtures and benchmark workloads | WP-77b | M |
| WP-77d | #77 | Proposal generation and approval UX (CLI first, then dashboard) | WP-77a, owner D2 | M |
| WP-78a | #78 | Pure state-graph model with budgets, dedupe, loop detection, action guard | WP-79a | M |
| WP-78b | #78 | SiteSweep integration, replay evidence, coverage taxonomy in report | WP-78a, WP-79b, WP-77b | L |
| WP-M1Q | all | Qualification: benchmark rerun, docs, truth-table updates, reviews | all above | S |

Sizes are relative (S/M/L), not durations: the repository has no data to convert them.

Added after Architect review S3-ARCH-1: `ShardMerge` rebuilds rows keeping only name, status, duration, page, scn, rep, error and description, and the shard row schema is a strict allowed-key list, so the `assertion` object is dropped today. A verification block computed at merge cannot equal the unsharded one until WP-79s lands; that is why it precedes WP-79b.

WP-79s status: implemented. Shard rows optionally carry `assertion` (`{check, locator}`, or `null` for a malformed source record), `journeyId` and `required`; fragment version stays 1 and legacy bundles load unchanged. Only `check` and `locator` are persisted (not `expected`/`actual`/timing). Invalid `journeyId`/`required` are dropped; `required` and `journeyId` are carried but not yet interpreted by the classifier. A quarantined status is still mapped to `skipped` by the shard bundle, so a quarantined assertion reads NOT_TESTED (never verified) after merge; assertion rows are not quarantinable in `TestRunner` today. Fragment integrity remains unkeyed SHA-256 (unchanged).

Parallelism (at most two concurrent tasks, disjoint paths): WP-77a ∥ WP-78a after WP-79a; WP-77c ∥ WP-79b after WP-77b.

## 2. #79 — truthful execution

### Existing components

`src/core/ReportManager.js` (`buildReport`, `generateReport`), `src/core/TestRunner.js` (`runExpect`, status rows), `src/core/FlakinessTracker.js`, `src/core/parallel/{ShardMerge,ShardBundle,Reducers}.js`, `src/core/Dashboard.js` and `src/dashboard/index.html`, `falcon.js` (exit handling, ~l.540-650), Allure wiring in `playwright.config.js`.

### WP-79a — classification, no behaviour change

- New pure module `src/core/outcome/Verification.js` (name for Architect to confirm): `classifyRow(row)`, `aggregateJourney(rows)`, `aggregateRun(journeys)`, `REASON_CODES`.
- `ReportManager.buildReport` adds `verification` (additive). `result`, `summary` and exit code untouched.
- Rows: WP-79a adds **no** row fields, so existing reports regenerate byte-identical apart from the new key. `journeyId` and `required` arrive with WP-79s. The block is a pure function of rows: no timestamps or run ids inside it.
- Tests (`tests/unit/Verification.check.js`): table-driven over every row of the negative matrix below; property tests for invariants 2–3 (order independence, FAIL never reduced).
- Files expected: `src/core/outcome/Verification.js` (new), `src/core/ReportManager.js`, `tests/unit/Verification.check.js`, `tests/regression/m1-report-verification.check.cjs` (descriptive name; `p19-*` already names the Phase 19 checkpoint files).
- Acceptance: today's report fixtures regenerate byte-identical apart from the new `verification` key; `npm run test:unit`, `npm run test:regression` green.

### WP-79b — integration

- `falcon.js`: `--require-verified` (strict flag parsing like the Phase 16 flags). Zero-assertion run prints the notice and exits per the table in the contract §4.
- `ShardMerge`/`Reducers`: carry per-journey outcomes; a missing shard produces `UNVERIFIED`, a contradictory duplicate is rejected with the existing exit 2 path.
- Dashboard: result card shows level and reason codes next to the legacy result; no green badge for `INTERACTION_ONLY`.
- Allure: depends on G-03 (#115). Without a test that reads Allure output, "reporting agrees" is unprovable, so G-03 lands first or in the same PR.
- Quarantine: business `FAIL` is not quarantinable (Q1); `FlakinessTracker` ignores rows flagged `required`.
- Acceptance: CLI, report JSON, dashboard and Allure show the same level for each fixture run; merged-shard report equals unsharded report for the verification block.

### Negative test matrix (WP-79a/b, extended by #77 and #78)

| # | Case | Expected |
|---|---|---|
| N1 | All required assertions pass | `BUSINESS_VERIFIED`, exit 0 |
| N2 | One required assertion fails | `FAILED`, exit 1 |
| N3 | Required assertion never runs (earlier step failed) | `NOT_TESTED` → `UNVERIFIED` |
| N4 | Required evidence missing (target absent) | `INCONCLUSIVE` → `UNVERIFIED` |
| N5 | Contradictory records (same id, PASS and FAIL) | artifact rejected |
| N6 | Refusal during a required journey | `REFUSED` → `UNVERIFIED` |
| N7 | Optional assertion fails | warning outcome; level unaffected unless `blocking` |
| N8 | Unapproved AI proposal present | counted in `proposedUnapproved` only |
| N9 | Duplicate or malformed evidence | rejected |
| N10 | One shard missing | `UNVERIFIED` for its scope |
| N11 | Quarantined technical instability | stays `quarantined`; never turns a business FAIL into PASS |
| N12 | Click succeeds, business outcome wrong (benchmark W5/contradictory-role) | `FAILED` when an approved assertion exists; `INTERACTION_ONLY` otherwise, never `BUSINESS_VERIFIED` |
| N13 | Zero assertions | `INTERACTION_ONLY`; exit 0 default, exit 1 with `--require-verified` |
| N14 | Legacy report without `verification` | read as `UNKNOWN`, no crash |
| N15 | Legacy shard bundle without assertion fields during merge | loads; scope reads `INTERACTION_ONLY`/`UNKNOWN`, no crash |
| N16 | Unknown extra key in a shard row | rejected by the strict schema (exit 2) |
| N17 | Quarantined row plus required FAIL, end to end | FAIL stands; note quarantined currently still yields `PASSED` when `failed===0`, so WP-79b needs its own regression for Q1 in `FlakinessTracker` |

### WP-79c — benchmark honesty (inside WP-M1Q)

The scorer's `falseGreenRate` definition does not change. Add a *separate* metric, `interactionOnlyPassRate` (passes whose verification level is `INTERACTION_ONLY` / passes), and score strict mode (`--require-verified`) as its own tool mode, never pooled with the default (protocol rule 4 on separate modes). Falcon's false-green figure only falls where assertions actually detect the planted defect. Report 15/18 as the baseline and the new figure next to it with the revision.

## 3. #77 — business assertions

### Reuse

`PlanFile.js` (`ACTIONS`, `CHECKS`, allowed-key lists, `expect` validation at ~l.117), `TestRunner.runExpect` (evidence object, `unavailable` handling), the dashboard review surfaces and approval store pattern in `LocatorMemory`, plan CLI `tests/regression/plan-*.check.cjs`.

### New (minimal)

- `src/core/outcome/Contract.js`: parse, validate, canonicalise, digest, lifecycle transitions. Pure, no I/O.
- `src/core/outcome/ContractStore.js`: persistence under the existing runtime-state directory convention, written with `fs.promises`, atomic rename, corruption detected by digest; rejected/superseded digests recorded in an append-only list.
- Checks added to `CHECKS`: `textEquals`, `valueEquals` (inputs), `enabled`, `disabled`, `absent`, `countEquals`, `moneyEquals`. Existing four are untouched.
- Plan wiring: an `expect` step may carry `assertionId`; a plan binds to a contract by `journeyId` + `digest`. A step whose contract is missing, unapproved or digest-mismatched yields `INCONCLUSIVE` (not skipped).

### Stages

- **A (M1):** UI-visible outcomes above, required/optional, structured failure evidence, reload-then-assert for persistence, list-page assertion for duplicates.
- **B (post-M1 unless pulled in):** API/DB/download adapters behind explicit allowlisted configuration. Design note only in M1.
- **C (post-M1):** multi-step invariants, role workflow invariants, async completion.

### WP-77d approval flow

Proposals are written as `proposed`. Page text can steer the proposed *locator* to a decoy, so the reviewer confirms the locator as well as `expected`; the proposal strips `provenance` and `expected`, and a person supplies both (this is the one rule; earlier wording "supply or confirm" is withdrawn). Dashboard approval requires `DASHBOARD_TOKEN` to be set (`_isAuthorized` is open when unset). CLI: `falcon assertions list|approve|reject|supersede` (names provisional). Approval requires the human to supply or confirm `expected` and provenance. Dashboard approval follows after the CLI, with the same store. Records say `channel`, not identity.

### Acceptance (maps to issue #77 criteria)

| #77 criterion | Evidence |
|---|---|
| Approved assertions persistable and executable | WP-77a/b tests: round trip, digest stable, evaluator runs without LLM |
| Unapproved proposals not counted | N8 |
| Failures propagate to scenario, journey, dashboard, report, CI | WP-79b agreement test |
| Missing evidence never PASS | N3, N4 |
| Positive and negative fixtures | WP-77c |
| Healing still works | `healing.check.cjs`, `p14-*` suites unchanged and green |
| Saved-plan replay compatible | `plan-file`, `plan-expect`, `plan-cli` suites unchanged and green; plans without contracts load |
| Schema, approval change, superseded, malformed | `Contract.check.js` table |

## 4. #78 — state-aware journey discovery

### Honest scope for M1 (decision D3)

Unauthenticated, same-origin, local-fixture journeys. There is no destructive-action guard in `src/core` today, and the legacy `ClickExplorer` clicks without one. Security review S3-SEC-1 rejected a keyword denylist (bypassed by synonyms, other languages, icon-only buttons, homoglyphs, `onclick` fetch/XHR POSTs, side-effecting GET links, default-submit buttons, Enter-key submits, iframes). Required design:

- **Allowlist, not denylist.** Only actions on an explicit allowlist (navigation to same-origin links, named read-only controls) are permitted. Everything else is denied. `needs-approval` is treated as deny in M1 (no approval path exists).
- **Network backstop.** The explorer context aborts any non-GET request not on the allowlist, independent of what the click looked like.
- **Fresh context only.** No `storageState`, no cookies, loopback or allowlisted origins only (this is the safe reading of D3).
- **The guard also runs on replay**, not only on discovery; `TestRunner` calls it.
- Interface stays narrow (`classifyAction(el) → allow | deny`) so #81 can replace it.
- Adversarial fixtures: synonym button, icon-only button, `onclick` POST, GET with side effect, default-submit button, Enter submit, iframe, reset/subscribe/contact forms.

### Components

- `src/core/journey/StateGraph.js` (pure): state id = normalised URL + DOM signature hash; edges = action + result; budgets `maxStates`, `maxDepth`, `maxActions`, `timeBudgetMs`; loop detection by state-id revisit; dedupe by (state, action) pair; deterministic ordering (sorted by stable key, seeded tie-break).
- `src/core/journey/ActionGuard.js`: above.
- Integration in `SiteSweep.js` (542 lines) and `ClickExplorer.js`: flag-gated exploration mode; legacy sweep unchanged when the flag is off.
- Replay: a discovered journey serialises to a plan (existing format) so replay reuses `PlanFile` and `TestRunner`; replay evidence includes the state sequence and a hash.

### Coverage taxonomy (reported separately, never summed)

action coverage · state-transition coverage · verified business-outcome coverage (only approved assertions that `PASS`) · refused/unreachable (named with reasons) · unverified.

### Acceptance (maps to #78)

2–5 step flows discovered in checkout/auth fixtures; unreachable states listed with the budget that stopped them; replay twice gives identical state sequences; origin and action budgets enforced by tests that try to exceed them; destructive action fixture is refused and appears as `REFUSED`; replay does not double-submit (duplicate-order fixture); non-false-green guarantees preserved (N-matrix re-run); existing `sitesweep.check.cjs` unchanged and green. Authenticated discovery is documented as **not delivered** and blocked on #81/#82.

## 5. Compatibility and rollback

Additive report block; opt-in strict flag; legacy sweep default; contracts optional. Each WP is one PR and independently revertable. If WP-79b regresses CI semantics, revert it alone; WP-79a stays because it changes nothing observable except one key.

## 6. Agent assignment (per `CLAUDE.md` routing; models verified from runtime metadata at first dispatch, recorded in the ledger)

| Role | Used for | Model ID |
|---|---|---|
| Solution Architect | Confirm module names, store location, contract-in-plan vs beside-plan; review §2–§4 against code | `claude-sonnet-5-5` |
| Developer | WP implementation, test-first | `claude-sonnet-5` |
| QA Engineer | Independent matrix N1–N17, fixture oracles written before assertions | `claude-sonnet-4-5` |
| Code Reviewer | Every PR diff | `claude-sonnet-4-6` |
| Security Engineer | WP-77a/d (persistence, approval), WP-78a (action guard), AI proposal handling | `claude-opus-5-5` |
| Technical Writer | Truth table, README, migration notes | `claude-haiku-4-5` |
| Release Manager | M1 qualification verdict | `claude-sonnet-4-6` |

Developer, QA and Reviewer models are mutually distinct, as required. Product Manager/Owner/Project Manager and DevOps are not needed for M1 except DevOps if CI changes (G-03, fixtures in CI). No AI agent substitutes for independent human review where a gate asks for it.

## 7. Qualification (WP-M1Q) — what "M1 done" requires

1. N1–N17 pass on the final revision; commands and results recorded with the SHA.
2. Benchmark rerun on the final revision, with the baseline 15/18 and new figures, strict mode scored separately.
3. Truth table updated in the same PR as the evidence (CAP-04, CAP-21, CAP-22, CAP-03 limits).
4. GitHub CI green on that SHA, read from the run, not assumed.
5. Independent QA, Code Review and Security verdicts for the revision; Release Manager records GO / CONDITIONAL GO / NO-GO. Verdicts invalidated by later commits are re-run.
6. Residual risks listed, including: approval is channel-attributed, Stage B/C not delivered, authenticated discovery not delivered, local fixtures only.

## 8. First work package

WP-79a. It touches one new pure module, one additive key in `buildReport`, and two test files. It can be reviewed in one sitting, changes no exit code, and every later package depends on its types.
