# Phase 18 architecture rev 18 patch (ARCH-18) — closes SEC-17 M-21, M-22 and m-59..m-64

Normative prose. **Nothing here authorises implementation, merge, publication or deployment.** Design only: no browser, runtime, server or CI probe was run. **Node 24 is UNVERIFIED (H-8); Firefox and WebKit are UNVERIFIED.** OWNER-12 (Option C) and OWNER-13 (no production approval path) are binding and are not reopened.

The machine-applicable edit set for this patch is `docs/architecture/phase-18-rev18-edits.json`. Where the two disagree, this prose is normative and the JSON is a defect.

## 0. Why rev 17 failed review

SEC-17 found the same defect class three revisions running: an owner decision was recorded in banners and in one or two documents, while the **acceptance-criteria JSON stayed the merge-condition source of truth and still specified the removed feature**. Rev 18 therefore propagates by token, not by narrative: section F defines a standing grep over an extended token list, and every one of the 258 scanned occurrences of the approval vocabulary is given an explicit disposition in the edits JSON `coverage` array (`deferred-18P`, `rewritten-exit-18`, `annotated`, or `moot`).

## 1. Context and constraints

- The AC JSON is the gate. A criterion with no `phase` and no `mergeCondition` reads as a live Must.
- Phase 18 ships **detection and refusal only**: a protected action is classified and refused before interaction, transmission, provider call or healing. No approval is created, persisted, consumed, replayed or executed, because no approval machinery exists in production.
- Exit codes are CI-sensitive. Phase 18 has exactly **one** code for a by-design protected-step refusal: **exit 18 with a mandatory reason code** (`exitCodes.policyRefusal`, `policyRefusalNote`). `approval: 14` stays in the code table as reserved and unreachable until 18P.
- CommonJS, Node >= 22 locally, Node 24 in CI (UNVERIFIED here). `Logger.*` only. No raw `console.log`, no new raw OpenAI HTTP calls, optional DB/OpenAI configuration unchanged by this patch.
- No criterion is deleted, renumbered or weakened. Text removed from live scope is preserved as unshipped, non-normative design history.

## 2. Affected components and trust boundaries

| Area | Change in rev 18 | Trust boundary |
|---|---|---|
| AC JSON | clause-level phase classification, exit-18 rewrites, recomputed counts | merge gate |
| `src/core/pilot/` | no `approval/` directory; `PilotActionGate` refusal path only | production |
| `falcon.js`, `package.json`, `.github/workflows/` | no approve flag, no token key, no approvals path, no pilot-manual script | production / CI |
| `tests/`, `tests/experimental/` | only permitted homes for fixture and prototype code | test |
| Dashboard | **no** approval view ships (deferred: it would have nothing to show) | production |

## 3. Section A — clause-level classification (closes M-21)

Classification vocabulary. `phase: "deferred-18P"` with `mergeCondition: false` means the whole criterion is out of Phase 18. `phase: "mixed"` means `phaseClauses` partitions the text into `current` and `deferred-18P` lists, and `mergeCondition` is then an **object** keyed by clause label with a boolean per clause (a schema extension introduced here; the JSON lint of section F must accept boolean or object).

**A1. Wholly deferred to 18P (phase `deferred-18P`, `mergeCondition: false`, `pr: "18P"`):** AC-052, AC-053, AC-054, AC-055, AC-056, AC-057, AC-094, in addition to the already-deferred AC-092, AC-093, AC-096, AC-097. AC-052, AC-053 and AC-057 were not named in M-21; the rev-18 scan found them (`APPROVAL_REQUIRED` with zero clicks, `APPROVAL_MISMATCH` on binding comparison, and the grant/refusal/consumption audit entry with an `approver`). They are the same approval state machine and cannot be live while no approval exists.

**A2. Mixed (phase `mixed`, clause-level `mergeCondition`):** AC-032 (PLAN_DRIFT live; ApprovalStore invalidation deferred), AC-074 (zero-skip live, now asserting exit 18; approved half and tests-only executable withdrawn), AC-083 (shard refusal live at exit 18; run-token transport refusals deferred), AC-085 (numeric per-root filesystem admission live for `run/auth` and `run/plans`; the approvals-root, ledger, genesis-entry and symlink rows deferred), AC-086 (window validation live; lease, redirect, transmission-counter and `chainDeadlineMs` clauses deferred), AC-089 (recompute, maximum rule and PLAN_CLASSIFICATION_DRIFT live, with heal reclassification refused exit 18 per 11i; the approved-identity comparison deferred), AC-090 (structural-unavailability half live; everything else deferred), AC-095 (the `PilotActionGate` capture set live; the `ApprovalStore` and `PilotFixtureServer` capture sets and the ledger-predicate cases deferred).

**A3. AC-084 is rewritten, not deferred.** It stays a live 18F Must with: exit 18 for a protected action reached in CI; the `src/core/pilot/` carve-out **removed** (no approval module exists anywhere in production, so no import of one is tolerable); the primary control restated as the section C dependency-reachability check and AC-098 (ii) rather than the deferred rev 10 section 4a fixture boundary; and the existence checks on `--approve-action` and `--emit-token-to` kept, because a prohibition is not a capability claim.

**A4. AC-090 text handling.** AC-090's live half is restated in `phaseClauses.current` and its requirement is replaced by the live clause plus a pointer. Its rev 17 text is preserved **by immutable git reference** (`909d794`, `docs/phase-18-acceptance-criteria.json`, `P18-AC-090`) and is listed clause by clause in the `18P-PROTECTED-NONGET` open item. Verbatim re-transcription into the open item was deliberately not performed: the coordinator applies exact-substring edits, and a hand-copied 4 kB string is a corruption risk with no preservation benefit over the git reference. This is an architect decision; flag it to Security if a literal copy is required.

**A5. AC-086 (m-59).** Three edits: delete the stray trailing token `deferred-18P` from the requirement; add the deferral sentence and the live window-validation sentence; add clause-level `mergeCondition`. **Honesty note:** the architect did not read rev 17 section 11e.1 "A3" in this task; the added sentences are a restatement of AC-086's own `phaseClauses` content, not a copy of A3. The coordinator must diff them against 11e.1 A3 and prefer A3 verbatim if it differs.

**A6. AC-051 (m-59).** The superseded single inversion sentence (`Inversion: remove the refusal and the case must record a request.`) is deleted; it contradicts inversion (i). Nothing else in AC-051 changes.

## 4. Section B — the run-token transport refusals: DROP for Phase 18

M-21 item 3 offered two resolutions for the 11f.4 exit-14 `PILOT_APPROVAL_RUN_TOKEN` transport refusals against 11d.5, which fails on that literal in `src/`.

**Decision: drop them for Phase 18.** No shipped need was found: nothing in Phase 18 mints, emits, reads or consumes a run token; the literal is absent from `src/`, `falcon.js`, `package.json`, `scripts/` and `.github/` today (SEC-17 E8); and the key is removed from the `.env.example` addition list. A refusal constant module would reintroduce the exact literal that AC-098 (ii) and AC-084 must fail on, in order to refuse a transport that does not exist. The refusal text moves to 18P with the writer.

**Residual, stated and not accepted:** if an operator sets the variable, Phase 18 ignores it silently rather than refusing loudly. That is safe (it is never read, and the protected step is refused anyway by classification) but it is not a loud failure. **This is for owner and Security confirmation, not an architect acceptance.** If either prefers a loud refusal, the only option that keeps AC-098 (ii) checkable is one named constant module whose exact path and export the section C check matches by exact content, never by pattern, and that costs a reviewed AC-098 exception. Rev 18 does not take that cost.

## 5. Section C — the production dependency-reachability check, implementably (closes M-22)

This is the only technical control behind owner check 4 and AC-098 (ii). It must fail closed and admit **zero** exemptions.

**C1. Roots are structural and committed.**
- Production roots: `falcon.js`; `package.json` `main` (`falcon.js`) and every `bin` entry (none today); and every entry in a **committed classification file**, `docs/pilot/reachability-roots.json`, which must classify **every** `package.json` script and **every** workflow `run:` step as `production` or `test`.
- An unclassified or unknown script or `run:` step **fails the check**. Adding a script or a `run:` step without classifying it fails CI. This replaces "rooted at every package.json script", which failed on day one because six test scripts are rooted in `tests/`.
- Production-classified roots must not reach `tests/` (or `tests/experimental/`). Test-classified roots may.
- The classification file is data, not an allowlist of exceptions: it may mark an entry only `production` or `test`, and it has no exempt value.

**C2. Edge resolution.**
- Resolve `require`, `require.resolve`, `import()` with a literal argument, and `path.join`/`path.resolve` expressions built **only** from string literals and `__dirname`.
- Every other non-literal `require`, `import()`, `createRequire`, `child_process` spawn, spawnSync, fork, exec, execFile or execFileSync, `worker_threads.Worker`, and Playwright config, `testDir` or `testMatch` load edge in `src/`, `scripts/` or `falcon.js` **fails closed** (the check fails; it does not warn and does not skip). `scripts/` has about 20 `require(path.join(...))` edges; those resolve under the literal rule, and any that do not must be rewritten rather than exempted.
- A child-process invocation whose argv is `node <literal path>` (including `process.execPath`) is a **graph edge** to that path.
- Workflow `run:` steps are resolved with the **AC-084 resolver** (npm, yarn and npx script indirection and `node`/`bash` invocation, transitive, with cycle detection, failing closed on anything unresolvable).
- Matching is **exact path and exact export name**. The semantic matcher ("`AuditLog` where it is the approval ledger", "approval-root helpers") is withdrawn: in Phase 18 the set of approval modules in production is empty, so the rule is "no production root reaches any path under `tests/`, and no production module exports a name in the committed approval-export list", both exact.

**C3. Prototype and fixture locations.**
- `tests/experimental/` is the **only** permitted location for a retained approval or protected-action prototype. Every other location fails. If no prototype is retained the rule still runs and passes vacuously (AC-090's live half).
- `scripts/fixture/server.js`: **proposed classification `production`**, with the stated property that it serves only the fixed hermetic fixture app, is reachable from the `fixture:serve` script and from `ci.yml`, and binds loopback only. It is fixture *infrastructure* used by CI against `falcon.js --shard`; moving it under `tests/` would make a test-classified root the parent of a CI step that drives production code. **Flagged for owner and Security:** if Security prefers it under `tests/fixture/`, the `fixture:serve` script and the `ci.yml` step must be reclassified `test` in the same change.
- `src/core/locator/HealingBenchmark.js`: **proposed classification `production` root via the `healing:benchmark` script**, with the stated property that it reads `tests/fixtures/benchmark/` as **data through `fs`, not as a graph edge**, and that its `fill`, `selectOption` and `click` sinks (`:308-310`) are in scope for the 11j sink scan and must route through the gate or be refused in pilot mode. Data reads are not graph edges in this model; that is a deliberate, stated scope limit. **Flagged for owner and Security:** the alternative is to move the benchmark under `tests/` and drop its script, which is a behaviour change outside Phase 18 scope.

**C4. Inversion fixtures (each must fail the check).** `require(path.join("..","tests","x"))` in `scripts/`; `import("../../tests/x")` in `src/`; `spawn(process.execPath, ["tests/x.js"])` in `scripts/`; a `production`-classified workflow step running `node tests/experimental/x.js`; a new, unclassified `package.json` script. Plus a sixth, implied by C1: a `run:` step added to `ci.yml` with no classification entry.

**C5. The current tree must pass with zero exemptions.** The architect re-read `package.json` directly: 41 scripts (Appendix A), `main: falcon.js`, no `bin`. Test-classified: `test:unit`, `test:login`, `test:checkout`, `test:search`, `test:ui`, `test:api`, `test:db`, `test:all`, `test:e2e`, `test:regression`, `test:browser`, `test:coverage`, `test`, `test:demo`, `demo:record`, `demo:gate`, `demo:record-run`, `demo:build`, `bench:parallel`, `fixture:serve` (see C3). Production-classified: `start`, `healing:benchmark`, the three `healing:` review scripts, the three `flaky:` scripts, both `review:status` scripts, the three `history:` scripts, `dashboard`, `report`, the four `llm:profile:` scripts and the two cycle-dashboard scripts. `healing:approve` is **locator-healing** review, a different feature from protected-action approval (10d and 11d.2 disambiguation), and its presence must not be read as an approval path. Appendix A below is the generated inventory the classification file must cover; **the `ci.yml` `run:` steps were enumerated by script for Appendix A and were not otherwise read in full by the architect** (SEC-17 E11 is the corroborating evidence).

## 6. Section D — exit 18 for protected-step refusals in CI and shards (closes m-60)

One code, everywhere: AC-074 components, AC-083 requirement, AC-084 requirement, AC-089 requirement, traceability D3 and D4. A protected step reached in a shard or in CI is `POLICY_PROTECTED_ACTION_UNSUPPORTED`, **exit 18**, with the mandatory reason code that disambiguates it from `PILOT_INTERNAL_ERROR`. A reclassified heal is refused exit 18 per 11i, with an audited pre-heal provider call and no persistence. `exit 14` survives only inside deferred-18P text and in the `exitCodes` table as a reserved code. Residual 21 (exit 18 masking exits 17 and 1, with the `lostCoverage` summary written on those paths) is unchanged and still not accepted by the design.

## 7. Section E — AC-092 identity correction (closes m-64)

Section 11d.6 called AC-092 the "PTY production approval test". It is not. **AC-092 is the fixture no-arbitrary-target, server-identity, listener-identity and F-case criterion, and it carries the rev 15 9b/9c assertions, which are the substance of m-51. The PTY interactive-path test is AC-094**, which rev 18 defers with the writer (section A1). The 11d.6 row is corrected in traceability, and OWNER-13-Q1 now states explicitly: **if the owner keeps m-51, AC-092 returns as an 18D Must with `mergeCondition: true`, at no design cost.** The reason recorded for m-51's interim deferral is corrected; its disposition ("DEFERRED WITH THE APPROVAL MACHINERY, PENDING OWNER CONFIRMATION") is unchanged and is not asserted as satisfied.

## 8. Section F — standing DOC merge condition: the repo-wide claims grep

A repository-wide, case-insensitive `git grep -nIiE` (excluding `docs/security/phase-18-design-review-*.md` and `docs/architecture/phase-18-rev*-patch.md`) over the extended token list is a **standing DOC merge condition**, run in CI:

`ApprovalStore`, `ApprovalRecord`, `ApprovalCliWriter`, `PilotApprovalResolver`, `approve-action`, `emit-token-to`, `RunToken`, `RunTokenEmitter`, `LedgerLock`, `ledger approval`, `approvals root`, `approval root`, `APPROVAL_MISMATCH`, `APPROVAL_REQUIRED`, `APPROVAL_STALE`, `APPROVAL_REPLAYED`, `approved half`, `tests-only executable`, `PILOT_APPROVAL`, `PILOT_APPROVER`, `replay-protected`, `replay-protected approval`, `pty-approve`, `approver`, `two-command approval workflow`, `approval unlocks`, `approve and then run`, `approved action runs`.

Rules: every hit must sit in a **deferral annotation**, a **prohibition context**, or **quoted design history** explicitly marked unshipped. Any hit in live normative text, or in any criterion or clause whose `mergeCondition` is not `false`, fails the gate. Plus the two M-21 verification checks: a pairwise check that no live Must requires a symbol AC-084 or AC-098 forbids, and a JSON lint that no `mergeCondition != false` text contains a token. The word `approval` in locator-healing documentation is a different feature and is matched by exact phrase only, never by the bare word.

## 9. Section G — owner-decisions residuals (closes m-61)

Residual 4: residual 21's text was pasted into it; removed. Residual 4 **remains open and has a Phase 18 trigger**: a state-changing GET on a permitted route depends on manifest authoring, which Falcon does not verify (11l(3)). Residual 15: the rev 16 "no Phase 18 trigger" annotation is **superseded** (11h.4, SEC-16 m-55): the lease survives for permitted non-protected actions, so the unbound body is still reachable; only the protected half is moot. Residuals 24, 25 and 26 are annotated for OWNER-13 (the discriminator, the ledger writer and the fixture server are deferred, so none has a Phase 18 trigger; the repository-write trust limitation itself is unchanged). The embedded duplicate-26 fragment inside residual 25 is promoted to its own residual **25a** ("Forwarding fixture server (R-8)") rather than renumbered to 26, so no existing number moves. R-9 is **MOOT** under OWNER-13 with its text retained.

## 10. Section H — m-63: implementable sink scan

- **AST-level and receiver-aware.** Parse each `src/` file; report a sink only where the callee is a member expression whose receiver resolves to a Playwright `Page`, `Frame`, `Locator`, `ElementHandle`, `APIRequestContext` or `Route` value, by local assignment, by the project's own JSDoc parameter annotation, or by a `page.`, `frame.`, `locator(...)` or `route.` receiver chain. Comments and string literals are never sinks: this removes `PageAnalyser.js:101` and `TestRunner.js:33,204`. `Array.prototype.fill` on an array receiver is not a sink: this removes `EndpointPolicy.js:117`. Both false-positive classes are encoded as **fixtures of the scanner's own test suite**, so a regression that reintroduces them fails.
- **Discharge rule.** A sink is discharged when every path from a module entry to it passes a gate call in the same module, or the whole module is refused in pilot mode at its public entry. `AIHealer._performAction` (`:364,:366,:368`) is discharged by the four gated call sites (`:337,:419,:586,:652`) **only if** the scanner proves `_performAction` has no other caller and is not exported; otherwise it fails closed and the gate moves into `_performAction`. That proof obligation is explicit, not assumed.
- **Unresolvable fails closed**, and the failure is a check failure, never an exemption entry.
- `scripts/` sinks are **not enumerated** (SEC-17 H-a). Rev 18 extends the scan to `scripts/` under the same rule and records the enumeration as an open obligation of 18B, not as a completed fact.

## 11. Section I — documentation (closes m-62)

`docs/architecture/phase-18-authenticated-pilots.md` lines 52-56, 98, 141, 145, 146, 150, 152, 307, 308, 309, 312, 492, 495 and 594 receive inline OWNER-13 deferral annotations, and the file gains a blanket rev-18 annotation covering the remaining approval-bearing sites (202, 207, 320, 322, 324, 371, 392-397, 418, 443, 464, 542, 561, 564-566, 615, 635) as unshipped design history. Plan section 1 item 4 becomes detection and refusal, with approval deferred. AC-085's "operator guide states why the approval root must be durable" is removed: under 11n.G the operator guide describes refusal only, and there is no approval root. The threat-model DOC row loses the approver-string limitation and the durable-approval-root rationale.

## 12. Alternatives considered

1. **Delete the deferred criteria and renumber.** Rejected: destroys traceability and the review history, and the owner forbade deletion and renumbering.
2. **Mark whole criteria deferred wherever any clause is deferred.** Rejected: it would silently drop live obligations (AC-074's zero-skip rule, AC-085's filesystem admission, AC-086's window validation, AC-089's recompute and maximum rule) that 18B, 18E and 18F need.
3. **Keep a refusal-only run-token transport** (section B option 2). Rejected for Phase 18: it reintroduces the exact literal AC-098 (ii) must fail on, to refuse a transport that does not exist. Routed to owner and Security as a stated residual rather than decided silently.
4. **Keep the Dashboard read-only approval view.** Rejected: it is not a writer, but it has nothing to show, and a shipped approvals view is a claims violation under 10d.
5. **Implementer-chosen roots plus an exemption list for M-22.** Rejected: 11a.4 bans exemptions, and an unreviewed exemption set fails open. The committed classification file is data with two legal values and no exempt value.
6. **Semantic approval-module matcher.** Rejected as non-deterministic; replaced by exact path and export-name matching over an empty production set.

## 13. Failure modes, fallback, observability, rollback

| Failure | Behaviour | Observability |
|---|---|---|
| Protected step reached | exit 18, mandatory reason code, lost coverage reported, never PASS | `Logger.warning` plus receipt and report |
| Reachability check cannot resolve an edge | check fails (red CI), no exemption | names file, line and edge kind |
| Unclassified script or `run:` step | check fails | names the entry |
| Sink scan unresolvable receiver | fails closed | names file and line |
| Claims grep hit in live text | DOC gate fails | names file, line, token |
| JSON lint finds a token in `mergeCondition != false` text | gate fails | names criterion and clause |

Rollback: every rev-18 edit is text in six documents plus two new CI checks; reverting the commit restores rev 17 exactly. There is no runtime rollback surface, because nothing is implemented. Reverting 18D no longer leaves `run/approvals/` on disk, because Phase 18 never creates it.

## 14. Compatibility and migration

No schema, DB, OpenAI or CLI surface change. `.env.example` gains `PILOT_ROLE_*_USERNAME` and `PILOT_ROLE_*_PASSWORD` only, genuinely blank; the approver and run-token keys are **not** added (nothing reads them). `.gitignore` gains `run/auth/` and `run/plans/`; `run/approvals/` is not created in Phase 18. Baseline for compatibility claims stays `2572e73`. `GoogleSearchTest` stays out of CI (`test:search` is test-classified and must not appear in any workflow `run:` step).

## 15. Test seams and acceptance mapping

| Seam | Criterion |
|---|---|
| `reachability-roots.json` plus resolver plus six inversion fixtures | AC-098 (ii), AC-084 |
| export-surface check over an empty approval-export list | AC-098 (iii) |
| AST sink scanner with its own false-positive fixtures | AC-084, AC-089, m-63 |
| refusal runtime case with zero transmissions at a real recording server | AC-051, AC-098 (iv) |
| exit-18 shard and CI assertions | AC-083, AC-084, AC-074 |
| window-validation unit rows only | AC-086 (live clause) |
| per-root statfs admission for `run/auth` and `run/plans` | AC-085 (live clause) |
| JSON lint, claims grep, pairwise symbol check | section F, AC-098 (v) |
| structural-unavailability check, vacuous when no prototype is retained | AC-090 (live clause) |

## 16. ADR-0046 — Approval vocabulary is classified clause by clause, and production reachability is proven from committed roots

**Status:** proposed (durable, cross-cutting). **Context:** three consecutive reviews found owner decisions recorded narratively while the gate source of truth still specified the removed feature; and the only technical control behind "fixture code cannot enter production" was unimplementable as written. **Decision:** (1) every criterion carrying approval vocabulary is classified at clause level, with live text token-free and removed text preserved as unshipped history; (2) production reachability is computed from structural roots plus a committed script and workflow classification with no exempt value, exact path and export matching, fail-closed non-literal edges, and `tests/experimental/` as the sole prototype location; (3) one refusal code, exit 18 with a mandatory reason, for every by-design protected-step refusal; (4) a standing repo-wide claims grep over an extended token list. **Consequences:** adding a script or workflow step requires a classification entry; dynamic requires in `src/`, `scripts/` and `falcon.js` must be literal or be rewritten; the approval design survives only as 18P input. **Alternatives:** coarse deferral, exemption lists and semantic matchers, all rejected above.

## 17. Handoffs

**SEC-18 (Security Engineer).** Re-review scope: this patch, the edits JSON, and the six edited documents. Specifically: (a) is M-21 closed, that is, does every live Must survive the section F lint and the pairwise check; (b) is section C implementable and fail-closed, and are the two classification proposals in C3 acceptable or must `scripts/fixture/server.js` and `HealingBenchmark.js` move; (c) is section B acceptable, or is a loud refusal required at the stated AC-098 cost; (d) is the AC-090 git-reference preservation of A4 acceptable, or is a verbatim copy required; (e) m-63's discharge rule, including the `_performAction` no-other-caller proof obligation; (f) carried items m-21, m-23, m-24, m-26 to m-28, m-30, H-1, H-3, H-7, H-8, R-8, R-10 and residuals 4, 13, 15, 21, 24, 25, 25a and 26, none of which is accepted here.

**Developer.** Implement nothing until the owner authorises. Constraints when authorised: no file under `src/core/pilot/approval/`; no approve flag, token key or approvals path anywhere in `src/`, `falcon.js`, `scripts/`, `package.json` or `.github/`; refusals at exit 18 with a mandatory reason code; `fs.promises` on hot paths; `Logger` only; CommonJS.

**QA.** Build the six section-C inversion fixtures, the two sink-scan false-positive fixtures, the exit-18 shard and CI assertions, and the real-recording-server zero-transmission case. Do not weaken a test to make the tree pass; an unclassified script must fail.

**DevOps.** Two new CI checks (dependency reachability, and claims grep plus JSON lint), both fail-closed and deterministic, with no uncontrolled third-party site. Confirm H-8 on Node 24 before any 18D-equivalent merge; **Node 24 remains UNVERIFIED here.** No pilot-manual project or script is added.

**Owner.** Two decisions requested: section B (drop versus loud refusal) and C3 (classification or relocation of `scripts/fixture/server.js` and `HealingBenchmark.js`). OWNER-13-Q1 (m-51) remains open and is unaffected by this patch except for the section E correction.

## Appendix A (generated) — entries the committed classification file must cover

Generated by script from `package.json` and `.github/workflows/ci.yml` at this revision. Proposed classification only; the committed file is the authority and an unclassified entry fails the check.

### A.1 package.json scripts (41)

| script | command | proposed |
|---|---|---|
| `start` | `node falcon.js` | production (confirm) |
| `test:unit` | `node tests/unit/ReportManagerExitCode.check.js && node tests/unit/DBConfigBehavior.check.js && node tests/unit/DashboardAuth.check.js` | test |
| `test:login` | `node tests/ui/LoginTest.js` | test |
| `test:checkout` | `node tests/ui/CheckoutTest.js` | test |
| `test:search` | `node tests/ui/GoogleSearchTest.js` | test |
| `test:ui` | `npm run test:login && npm run test:checkout` | test |
| `test:api` | `node tests/api/UserApiTest.js && node tests/api/ProductApiTest.js` | test |
| `test:db` | `node tests/db/UserDBTest.js && node tests/db/OrderDBTest.js` | test |
| `test:all` | `npm test && npm run test:unit && npm run test:ui && npm run test:api && npm run test:db && npm run test:e2e` | test |
| `test:e2e` | `npx playwright test tests/full_automation.test.js` | test |
| `demo:gate` | `node scripts/demo/gate-run.js` | production (confirm) |
| `demo:record-run` | `node scripts/demo/record-run.js` | production (confirm) |
| `demo:build` | `node scripts/demo/media/build.js` | production (confirm) |
| `test:demo` | `playwright test -c playwright.demo.config.js` | test |
| `demo:record` | `npm run test:demo && node docs/demo/build-ui-test-recording.js` | test |
| `report` | `allure awesome allure-results -o allure-report && allure open allure-report` | production (confirm) |
| `test` | `npm run test:regression && npm run test:browser` | test |
| `test:regression` | `node --test --test-concurrency=1 tests/regression/*.check.cjs` | test |
| `test:browser` | `playwright test -c playwright.regression.config.js` | test |
| `test:coverage` | `node --experimental-test-coverage --test --test-concurrency=1 tests/regression/*.check.cjs` | test |
| `healing:benchmark` | `node src/core/locator/HealingBenchmark.js` | production (confirm) |
| `healing:pending` | `node scripts/healing/review.js list` | production (confirm) |
| `healing:approve` | `node scripts/healing/review.js approve` | production (confirm) |
| `healing:reject` | `node scripts/healing/review.js reject` | production (confirm) |
| `flaky:list` | `node scripts/flakiness/review.js list` | production (confirm) |
| `flaky:quarantine` | `node scripts/flakiness/review.js quarantine` | production (confirm) |
| `flaky:unquarantine` | `node scripts/flakiness/review.js unquarantine` | production (confirm) |
| `review:status` | `node scripts/review/status.js` | production (confirm) |
| `review:status:strict` | `node scripts/review/status.js --fail-on-stale` | production (confirm) |
| `history:list` | `node scripts/history.js list` | production (confirm) |
| `history:export` | `node scripts/history.js export` | production (confirm) |
| `history:check` | `node scripts/history.js check` | production (confirm) |
| `dashboard` | `node scripts/dashboard.js` | production (confirm) |
| `fixture:serve` | `node scripts/fixture/server.js` | production (confirm) |
| `bench:parallel` | `node scripts/benchmark/parallel.js` | production (confirm) |
| `production:event` | `node scripts/production-cycle/append-event.js` | production (confirm) |
| `production:dashboard` | `node scripts/production-cycle/dashboard.js` | production (confirm) |
| `llm:profile:list` | `node scripts/llm/profile.js list` | production (confirm) |
| `llm:profile:show` | `node scripts/llm/profile.js show` | production (confirm) |
| `llm:profile:set` | `node scripts/llm/profile.js set` | production (confirm) |
| `llm:profile:delete` | `node scripts/llm/profile.js delete` | production (confirm) |

### A.2 ci.yml `run:` steps (33)

| line | command (truncated) | proposed |
|---|---|---|
| 36 | `npm ci` | production (confirm) |
| 38 | `npm audit --omit=dev --audit-level=high` | production (confirm) |
| 39 | `npx playwright install --with-deps chromium` | production (confirm) |
| 40 | `npm run test:coverage` | test |
| 41 | `npm run test:browser` | test |
| 99 | `npm ci` | production (confirm) |
| 102 | `npx playwright install --with-deps chromium` | production (confirm) |
| 110 | `node tests/unit/ReportManagerExitCode.check.js` | test |
| 117 | `node tests/unit/DBConfigBehavior.check.js` | test |
| 125 | `node tests/unit/DashboardAuth.check.js` | test |
| 133 | `psql "postgresql://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME" -f scripts/db/ci-seed.sql` | production (confirm) |
| 150 | `node tests/ui/LoginTest.js` | test |
| 153 | `node tests/ui/CheckoutTest.js` | test |
| 156 | `node tests/api/UserApiTest.js` | test |
| 159 | `node tests/api/ProductApiTest.js` | test |
| 166 | `node tests/db/UserDBTest.js` | test |
| 169 | `node tests/db/OrderDBTest.js` | test |
| 226 | `node falcon.js --no-dashboard --repeat=3` | production (confirm) |
| 270 | `\|` | production (confirm) |
| 296 | `\|` | production (confirm) |
| 324 | `node scripts/review/status.js` | production (confirm) |
| 328 | `npx playwright test` | test |
| 334 | `\|` | production (confirm) |
| 389 | `npm ci` | production (confirm) |
| 390 | `npx playwright install --with-deps chromium` | production (confirm) |
| 392 | `\|` | production (confirm) |
| 402 | `node falcon.js --no-dashboard --url="http://127.0.0.1:$FIXTURE_PORT" --shard="$SHARD_INDEX/3" --run-id="$RUN_ID"` | production (confirm) |
| 405 | `\|` | production (confirm) |
| 436 | `npm ci` | production (confirm) |
| 462 | `\|` | production (confirm) |
| 476 | `\|` | production (confirm) |
| 520 | `npm ci` | production (confirm) |
| 530 | `\|` | production (confirm) |

Multiline `run:` blocks are counted once at their `run:` line; the classification file must cover every command inside such a block. `main` is `falcon.js`; there is no `bin`.

