# Phase 18 Security Design Re-review 16 (SEC-17)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `909d794` on `docs/phase-18-architecture` (architecture rev 2 plus the rev 3 to rev 17 patches).

Scope: the complete revised Phase 18 design after OWNER-12 (Option C) and OWNER-13 (no production approval path). That means the rev 17 patch and its edits to the AC JSON, threat model, owner decisions, plan, traceability, architecture document and the rev 12 to rev 15 banners. It is checked against re-review 15 (SEC-16) and supersedes it.

This is a design review only. No browser, runtime or server probe was run. Four read-only shell probes were made:
- P1: the commit list and diff stat (`e7f372f..909d794`, 12 files), a `git grep` of `src/` for action and request sinks, a `git grep` for approval tokens on production surfaces, and the `package.json` scripts.
- P2: a Python check of the AC JSON (counts, phases, deferred set, key criteria).
- P3: the text of the approval-related live criteria, plus the repository-wide stale-claim `git grep`.
- P4: targeted `git grep` of the threat model, traceability, owner decisions, banners, `src/` and `scripts/` require and spawn edges, and the workflows.

Files were otherwise read with the read tool. **Node v22.19.0 only. Node 24 is UNVERIFIED. Firefox and WebKit are UNVERIFIED.** The Security Engineer role is read-only; the coordinator saved this text from the reviewer's report without changing its findings.

**Verdict: BLOCK for 18B, 18D, 18E, 18F and DOC.**
- 18A: rev 17 does not change it. The SEC-15 APPROVE WITH CONDITIONS stands.
- 18C: no major in 18C-owned text. Conditions m-59 and m-60 apply.
- **Blockers: 0. Majors: 2 (M-21, M-22). New minors: 6 (m-59 to m-64). No P0.**
- **The owner's requirement "zero blockers and zero majors" is NOT met at 909d794.**
- On the merits, Security supports OWNER-13. Both majors are integration and specification defects, not objections to the decision.
- Nothing here risk-accepts anything. Risk acceptance belongs to the owner alone.

## Evidence checked

| # | Check | Result |
|---|---|---|
| E1 | AC JSON counts (P2) | 98 total: 89 Must, 6 Should, 3 Could. No duplicate IDs. `counts.deferredToPhase18P` is 5 and equals `counts.deferredUnderOptionC` (5). `counts.deferredIds` = {086, 092, 093, 096, 097}, which equals the set computed by the 11e.3 rule. Phases: AC-092 has no `phase` key in the reviewer's read, AC-051 is `current`, AC-086 is `mixed` with `phaseClauses`, and four are `deferred-18P`. `mergeCondition: false` and `pr: "18P"` are set on AC-092, 093, 096 and 097. No `phase-note` remains |
| E2 | `exitCodes` | `policyRefusal: 18` and `policyRefusalNote` added. `approval: 14` is kept |
| E3 | AC-086 requirement (JSON line 855) | Text unchanged from 997f1a1. **The stray token `deferred-18P` still ends the string.** The 10f A3 deferral sentence and the window-validation sentence are absent. Only the `phase`/`phaseClauses` tags were added |
| E4 | AC-051 | Both 11g inversions, the three 11h.3 request cases and the genuine-recording-server sentence are present. **The old single inversion "remove the refusal and the case must record a request" is still present**, and it contradicts inversion (i) |
| E5 | AC-098 | Rewritten as `scope: non-reachability`, Must, 18D, U and R, with its inversion. Its components are clean |
| E6 | Live Must criteria naming the approval machinery, with no `phase` and no `mergeCondition` (P2, P3) | See the AC-by-AC list under M-21 |
| E7 | `src/` sinks (P1) | Action and navigation sites are listed under owner check 5. **Zero** `request.*`, `page.route`, `context.route` or `route.continue/fulfill/fetch/abort` sinks in `src/` (confirms 11j.0) |
| E8 | Approval tokens on production surfaces (P1) | `git grep` for `approve-action`, `emit-token-to`, `RunToken`, `ApprovalStore` and `PILOT_APPROVAL` over `falcon.js`, `package.json`, `src/`, `scripts/` and `.github/` returns **no match** (rc=1) |
| E9 | `package.json` scripts (P1) | `test:unit`, `test:ui`, `test:api`, `test:db`, `test:regression` and `test:coverage` run files under `tests/`. `test:e2e` and `test:demo` run Playwright test runners. `demo:record` runs a file under `docs/demo/`. `healing:benchmark` runs `src/core/locator/HealingBenchmark.js`. `fixture:serve` runs `scripts/fixture/server.js` |
| E10 | Edges in `scripts/`, `src/` and `falcon.js` (P4) | About 20 `require(path.join(...))` calls in `scripts/` (non-literal). `child_process` spawn, spawnSync and execFile in `scripts/benchmark/parallel.js` and in five `scripts/demo/*` files. `import("openai")` plus `createRequire` in three `src/core/llm/providers/*`. `HealingBenchmark.js:20` names `tests/fixtures/benchmark/` as its input |
| E11 | Workflows (P4) | `ci.yml` runs `node tests/unit/*`, `node tests/ui/*`, `node tests/api/*` and `node tests/db/*` (lines 110 to 169), `npx playwright test` (line 328), and `node scripts/fixture/server.js` (line 393), which feeds `falcon.js --shard` against 127.0.0.1 (line 402) |
| E12 | Threat model | Items 20 and 22 have the OWNER-13 appendix. Items 27, 28 and 29 are added. The 18B, 18C and 18D gate rows are annotated. **The 18D row's "approval machinery rows" are not enumerated.** The 18E row and the DOC row still carry approval-root text |
| E13 | Traceability | D7 is annotated. Rows OWNER-13, OWNER-13-Q1, m-34/m-40 and m-52 are added. Items 36 to 40 are added. **D4 still contains "tests-only executable for exit 0 and exit 14" and the AC-094 pty test. D3 still says "static pre-flight exit 14"** |
| E14 | Owner decisions, residual list (read at lines 75 to 100) | **Residual 4 carries residual 21's rev 17 text. The 11l(3) residual 4 text is absent, and the rev 16 "no Phase 18 trigger" annotation stays.** Residual 15 has no rev 17 annotation. Residuals 24, 25 and 26 describe the production ledger writer and the PilotRuntime approval gate as live, with no OWNER-13 annotation. Residual 25 contains an embedded "and `26. Forwarding fixture server`" fragment |
| E15 | Banners (P4) | Rev 12 (lines 67 and 94) has explicit-extent OWNER-13 banners. Rev 13 (213, 242), rev 14 (41) and rev 15 (27, 149) have extent-bounded OWNER-12 banners |
| E16 | README.md, `docs/pilot/` | README: no stale-claim hit. `docs/pilot/` has no tracked files, so the operator-guide drafts exist only as rev 17 section 11n.G text |

## M-21 (Major, new): OWNER-13 was not carried into about ten live Must criteria or into several plan, threat-model and residual rows, so the source of truth still specifies a production approval writer and consumer

**Severity:** Major. **Likelihood:** high. The AC JSON is the merge-condition source of truth, and these criteria have no `phase` or `mergeCondition` field, so they read as live Musts.

**Impact:**
- 18B, 18D, 18E and 18F are directed to build `ApprovalStore`, durable approval consumption, the `falcon.js --approve-action` TTY writer, a ledger genesis entry, an approvals root and a pty test that asserts exit 0 with a verifying ledger entry.
- That is exactly the production approval path OWNER-13 forbids.
- Several of these Musts cannot be satisfied together with AC-084 and AC-098 as rewritten. An implementer would have to weaken one Must without review. This is the SEC-16 M-19/M-20 defect class again, now for OWNER-13.

**Evidence: live Must criteria (no phase, no `mergeCondition`):**
- **AC-094** (18D): "spawns `node falcon.js --approve-action` under a pty ... asserts exit 0 and exactly one verifying ledger entry ... replay yields APPROVAL_REQUIRED exit 14". Section 11d.6 says the flag becomes an unknown flag (exit 1), and AC-084 now fails on the flag's existence. Section 11d.6 deferred AC-092 as the "PTY production approval test", but AC-092 is the fixture no-arbitrary-target and listener criterion. **The PTY test is AC-094, and it stays live** (see m-64).
- **AC-090** (18D), body unchanged except an appended sentence. It requires:
  - an `ApprovalStore` constructor and a `PilotRuntime` frozen ledger source with a resolver;
  - "Consumption is re-checked in production code at gate.perform ... APPROVAL_REQUIRED exit 14";
  - "--approve-action and --emit-token-to still refuse exit 1 in CI and --approve-action requires a TTY";
  - "the ledger writer is reachable only through falcon.js's interactive --approve-action path".
  Its components name `ApprovalCliWriter`, the `PilotApprovalResolver` injection seam and `tests/pilot/bin/approved-fixture-case.cjs`.
- **AC-055** (18D): "ApprovalStore durable exclusive consumption across restart and concurrency", which is a production consumer.
- **AC-054 and AC-056** (18D): ApprovalStore staleness and lookup.
- **AC-032** (18B): "ApprovalStore invalidation".
- **AC-095** (18D): the uncurried capture block "in ApprovalStore.js".
- **AC-085** (18E):
  - approvals-root admission;
  - "missing approval history yields APPROVAL_REQUIRED exit 14";
  - "a freshly initialised ledger writes a genesis audit entry", which is a ledger writer;
  - components: "operator guide states why the approval root must be durable".
  Section 11d.6 required these approval-specific clauses to be reclassified. Nothing was applied.
- **AC-089** (18B): a healed element "whose identity differs from the approved one is refused APPROVAL_MISMATCH exit 14".
- **AC-083** (18D): "run/approvals is never created", with protected shard steps at exit 14.
- **AC-084** requirement (18F): "a protected action reached in CI is refused APPROVAL_REQUIRED exit 14". It also fails on "approval-module import **outside src/core/pilot/** and tests/", a carve-out that presumes approval modules exist in production. Its "primary control is the structural fixture boundary of rev 10 section 4a" refers to an approval authority that is now deferred.
- **AC-074** components (line 760): "asserts exit 14 ... the AC-051 approved half ... in-process plus a tests-only executable for the exit codes". The OWNER-13 sentence is appended, not substituted, so the text contradicts itself.

**Evidence: plan, threat model, traceability and residuals:**
- **Plan 18D row:** the base file set `src/core/pilot/approval/{ApprovalStore,ApprovalRecord,AuditLog,Binding,RunToken}.js`. The rev 17 annotation defers only the writer, the flags, RunToken, RunTokenEmitter, LedgerLock, the root, AC-092 and AC-093. **ApprovalStore, ApprovalRecord, Binding, the PilotApprovalResolver seam, the closure-held ledger registry, the gate-side capability WeakMap, the PilotRuntime unbranded-approval refusal, `neg-p02-replay` and `approval-interactive-path.test.js`/`pty-approve.cjs` (AC-094) stay in scope.** The 11d.5 check fails on the basenames ApprovalStore, ApprovalRecord and Binding by construction.
- **Plan 18E row:** "approvals root refuses tmpfs", and the AC-085 approvals-root rows.
- **Plan 18F row:** "the pilot-manual project and test:pilot-manual script for AC-094".
- **Plan section 1 item 4:** "Revision-bound, run-scoped, replay-protected approval for protected actions (18D)". This is a live capability statement.
- **Threat model:**
  - The 18D row defers "the approval machinery rows" without listing them, while P01 to P06, `neg-shard-approve-argv`, `neg-fixture-*`, L17 to L20, F14 to F25 and AC-095 stay listed.
  - The 18E row has "approvals root refuses tmpfs".
  - The DOC row has "approver-string limitation" and "durable-approval-root rationale".
- **Traceability:** D4 and D5 as in E13. Open item R-9, about "Falcon's production interactive approval path" and AC-094, is not marked moot.
- **Residuals 24, 25 and 26:** E14.

**Contradictions that force an unreviewed weakening:**
- AC-090 (flag present, TTY-gated) against AC-084 (fail on the flag's existence).
- AC-055, AC-090 and AC-095 (ApprovalStore exists) against AC-098 (ii)/(iii) and 11d.5 (fail on the ApprovalStore basename and on any approval export).
- AC-094 (exit 0 through `--approve-action`) against 11d.6 (unknown flag, exit 1).
- The 11f.4 exit-14 run-token-transport refusals, which need the literal `PILOT_APPROVAL_RUN_TOKEN` in `src/`, against 11d.5, which fails on any occurrence of that literal in `src/`.

**Affected:**
- AC JSON: AC-032, 054, 055, 056, 074, 083, 084, 085, 089, 090, 094 and 095; open item R-9.
- Plan: section 1, and rows 18D, 18E and 18F.
- Threat model: rows 18D, 18E and DOC.
- Traceability: D3, D4 and D5.
- Owner decisions: residuals 4, 15, 24, 25 and 26.

**Remediation (design):**
1. Classify each listed criterion clause by clause. Use `phase: "deferred-18P"`, or `phase: "mixed"` plus `phaseClauses` and a clause-level `mergeCondition`, with the text unweakened.
   - AC-054, 055, 056 and 094: wholly deferred.
   - AC-090: keep live only the structural-unavailability sentence (tests/ and any prototype unreachable).
   - AC-095: defer the ApprovalStore capture set, and keep any gate or fixture capture needed by a shipped feature, named explicitly.
   - AC-085: defer the approval-root and ledger clauses; keep the general admission policy live.
   - AC-032: defer the "ApprovalStore invalidation" component; keep PLAN_DRIFT live.
   - AC-089: replace "APPROVAL_MISMATCH exit 14" with the 11i refusal (exit 18) for a reclassified heal; defer the approved-identity clause.
   - AC-083, AC-084 and AC-074: exit 18 per 11f.4. Remove the `src/core/pilot/` carve-out from AC-084.
2. Recompute `deferredIds` from the new rule.
3. Resolve the token-literal conflict. Either drop the exit-14 run-token-transport refusals for Phase 18 (nothing reads the variable, so it is inert), or name a single refusal constant module that 11d.5 checks for exact content. That choice needs Security and owner review, not an implementer's allowlist.
4. Rewrite the plan's 18D, 18E and 18F base file sets and section 1 item 4. Enumerate the deferred row IDs in the threat model's 18D, 18E and DOC rows. Apply 11l(3) and 11h.4 to residuals 4 and 15. Annotate residuals 24 to 26 and R-9 for OWNER-13. Remove the exit-0 executable text from D4, as 11b.1 claimed was done.

**Verification:**
- A JSON lint run in CI. For every criterion or clause whose `mergeCondition` is not false, the live text must contain none of: `ApprovalStore`, `approve-action`, `emit-token-to`, `RunToken`, `ledger approval`, `approvals root`, `APPROVAL_MISMATCH`, `approved half`, `tests-only executable for exit 0`.
- A pairwise check that no live Must requires a symbol that AC-084 or AC-098 forbids.
- A grep of the plan and threat-model live rows for the same tokens, giving zero un-deferred hits.

## M-22 (Major, new): the 11d.5 dependency-reachability check cannot be implemented as written and does not fail closed on the edges that matter

**Severity:** Major. It is the only technical control behind owner check 4 and AC-098 (ii). **Likelihood:** certain for item 1 below. **Impact:** the check either fails on the current tree or gets an implementer-chosen root and exemption set. 11a.4 bans exemptions and allowlists, so that set would be unreviewed and could fail open.

**Evidence:**
1. **The roots contradict the rule.** It is "rooted at every `package.json` script command" and fails on "any path under `tests/`". `test:unit`, `test:ui`, `test:api`, `test:db`, `test:regression` and `test:coverage` are rooted in `tests/` (E9), so the check fails on day one.
2. **Dynamic requires fail closed only "in `src/`"**, and only string or literal-prefix template arguments are resolved. `scripts/` (a production root under 11a.1) has about 20 `require(path.join(...))` edges, which are neither. Their treatment is unspecified (E10).
3. **The model covers `require` only.** It does not cover:
   - `import()` and `createRequire` (present in three `src/core/llm/providers/*`);
   - `child_process` spawn, fork and execFile (`scripts/benchmark/parallel.js`, `scripts/demo/*`);
   - `worker_threads`;
   - Playwright `testDir`/config loading (`test:e2e`, `test:demo`);
   - fs-loaded fixture data. `HealingBenchmark.js` is a `src/` module with live `fill`, `selectOption` and `click` sinks; it is run by `healing:benchmark` and reads `tests/fixtures/benchmark/` (E10).
4. **Workflows are not roots.** Only a literal-token scan covers `.github/`. `ci.yml` runs `node tests/...`, `npx playwright test` and `node scripts/fixture/server.js` (E11).
5. **"The experimental fixture directory" is never named,** so there is nothing to check for, and the check fails open.
6. **Fixture code already sits inside a production root.** `scripts/fixture/server.js` is fixture code inside `scripts/`, so the "structural" boundary of 11c and 11d.4 already misclassifies it.
7. **The approval-module matcher is not deterministic.** `AuditLog` "where it is the approval ledger", `Binding` and "approval-root helpers" need a semantic judgement.
8. **It conflicts with 11f.4** on the `PILOT_APPROVAL_RUN_TOKEN` literal (see M-21).

**Remediation:**
- Declare the production roots structurally: `falcon.js`, `package.json` `main`/`bin`, and a committed classification of every `package.json` script and workflow `run:` step as production or test. An unclassified entry fails. Production-classified roots must not reach `tests/`. Test-classified roots may.
- Resolve `path.join`/`path.resolve` calls that use only literal segments and `__dirname`. Treat every other non-literal `require`, `import()`, `createRequire`, spawn, fork, execFile, Worker or Playwright config edge as **fail-closed in `src/`, `scripts/` and `falcon.js`**.
- Model `node <literal path>` child-process edges as graph edges. Reuse the AC-084 workflow-indirection resolver for `run:` steps.
- Name the experimental directory inside `tests/` (for example `tests/experimental/`) and prohibit every other location.
- Classify `scripts/fixture/server.js` and `HealingBenchmark.js`: move them, or declare them production with a stated property.
- Replace the semantic matcher with exact paths and export names.

**Verification:** inversion fixtures, each of which must fail the check:
- `require(path.join("..","tests","x"))` in `scripts/`;
- `import("../../tests/x")` in `src/`;
- `spawn(process.execPath, ["tests/x.js"])` in `scripts/`;
- a production-classified workflow step running `node tests/experimental/x.js`;
- an unclassified new `package.json` script.

The current tree must pass with zero exemptions.

## m-59 (Minor): AC-086 and AC-051 text was not edited as rev 17 states
- AC-086: 11e.1 ("A3 verbatim; remove the stray token") was not applied (E3). The `phaseClauses` tags are correct. However, AC-086 has no `mergeCondition`, so a gate reader treats the whole of it as live. The live requirement text still describes lease consumption, redirect continuation and Origin handling for protected requests.
- AC-051: still contains the superseded single inversion (E4).
- Remediation: apply A3 verbatim, delete the token, add clause-level `mergeCondition`, and delete the old AC-051 inversion sentence.

## m-60 (Minor): m-53's single CI/shard code is not integrated
Exit 14 for a protected step persists in:
- AC-083 (shard);
- the AC-084 requirement (CI);
- the AC-074 components (CI pilot job);
- traceability D3;
- AC-089 (healed identity change, APPROVAL_MISMATCH).

Sections 11f.4 and 11i say exit 18. 11f.4 cited AC-084 "components:737", but the text is in AC-084's requirement and AC-074's components. Exit codes are CI-sensitive, so this must be fixed before 18B, 18D or 18F.

## m-61 (Minor): owner-decisions residuals and nits were misapplied
- Residual 4 carries residual 21's text, and the 11l(3) residual 4 text is missing.
- Residual 15 lacks the 11h.4 re-annotation, so "no Phase 18 trigger" still stands, contrary to SEC-16 m-55.
- Residuals 24 to 26 lack OWNER-13 annotations.
- There is a duplicate-26 fragment inside residual 25 (E14).

## m-62 (Minor): live documentation still describes the approval machinery
- `docs/architecture/phase-18-authenticated-pilots.md`: lines 55, 98, 145, 146, 150, 152, 307, 309, 312, 495 and 594 have no OWNER-13 annotation. 11m claimed line 307 would be banner-annotated; only line 406 and the status line were changed.
- Plan section 1 item 4 (M-21).
- AC-085 components, "operator guide states why the approval root must be durable", contradicts 11n.G.

## m-63 (Minor): the sink-scan rule needs an implementable definition
- The rev 17 11j.0 counts include an `Array.prototype.fill` (`EndpointPolicy.js:117`) and comment-only hits (`PageAnalyser.js:101`, `TestRunner.js:33,204`).
- A text-level walker with "unresolvable fails closed" will generate false positives and pressure for exemptions.
- The plan gates AIHealer at its call sites (`:337,:419,:586,:652`), while the sinks are in the `_performAction` body (`:364-368`).
- Specify an AST-level, receiver-aware scan and state how a gated caller discharges a sink.
- `scripts/` sinks were not enumerated in this review (hypothesis H-a).

## m-64 (Minor): AC-092 was misidentified, which bears on m-51
- Section 11d.6 calls AC-092 the "PTY production approval test". AC-092 is in fact the fixture no-arbitrary-target, listener and F-case criterion, which carries rev 15 9b/9c, the substance of m-51. The PTY test is AC-094, which remains live (M-21).
- Effect: m-51's substance is already `mergeCondition: false` in the JSON. That matches the declared interim state, "deferred pending confirmation", but the record gives the wrong reason.
- Remediation: correct the 11d.6 row, and state in OWNER-13-Q1 that AC-092 returns as an 18D Must if the owner keeps m-51.

## SEC-16 findings: status
- **M-19:**
  - (a) closed by 11a;
  - (b) closed in AC-098, but D4 and AC-074 retain the exit-0 and approved-half text (M-21);
  - (c) decided by OWNER-13 and **not integrated** (M-21);
  - (d) closed by 11c.
  - **Overall: not closed. Superseded by M-21.**
- **M-20:** closed for AC-096 and AC-097 (`pr: 18P`, `mergeCondition: false`), D7, and plan rows 18B and 18C. AC-086's tags are fixed but its text is not (m-59). **Closed in substance, with residue in m-59.** The defect class recurs under M-21.
- **m-53:** label, reason code and lostCoverage on exits 17 and 1 are closed. The single CI/shard code is **open** (m-60).
- **m-54:** closed in AC-051. A stale sentence remains (m-59).
- **m-55:** closed (11h.1 to 11h.3, threat-model item 28, 18C row). The residual 15 annotation is open (m-61).
- **m-56:** closed in design (11i, threat-model item 27, `neg-heal-reclassified-protected`). AC-089 conflicts (m-60).
- **m-57:** closed in rule. HealingBenchmark sinks confirmed at lines 308 to 310. Implementability is open (m-63).
- **m-58:** closed. Extent-bounded banners are present (E15).
- **Nits:**
  - item 26 numbering: closed;
  - residual 21: closed;
  - residual 4: misapplied (m-61);
  - D3: open (m-60);
  - plan 18P heading and the Origin note: not verified within budget.

## The owner's six verification points
1. **No production approval writer is reachable: FAIL** (M-21).
   - What is clean: today's tree (E8); `falcon.js`, `package.json` scripts and workflows contain no approval token; README is clean; `docs/pilot/` does not exist; the 11n.G operator-guide draft describes refusal only and is acceptable.
   - What fails: live Musts AC-094 (an exit-0 writer via `falcon.js --approve-action`), AC-090 (a TTY writer path), AC-085 (a ledger genesis writer), and the plan's 18D file set (ApprovalStore, ApprovalRecord, Binding).
   - The plan's 18D row still lists `Dashboard.js` with a "read-only view", and the threat model's 18D row lists X01 "approval view". Both are view-only and are not writers, but under OWNER-13 they have nothing to show and should be deferred.
   - The existence rules contradict each other: AC-084 forbids the flag's existence while AC-090 requires the flag; AC-098 forbids the ApprovalStore basename while AC-055 and AC-095 require ApprovalStore.
2. **No approval consumer is reachable: FAIL** (M-21). Live consumers:
   - AC-055: durable exclusive consumption;
   - AC-090: consumption re-check at `gate.perform`, and the PilotRuntime resolver and ledger source;
   - AC-054 and AC-056;
   - AC-089: refusal against "the approved" identity.
   The 11f.4 exit-14 token refusals are refusal-only in intent, but they conflict with 11d.5 (M-21 and M-22).
3. **No dormant A''/B'' transport is reachable: PASS, with condition m-59.**
   - The plan's 18C row names M1 and `route.fetch({maxRedirects:0})` as WITHDRAWN.
   - AC-096 and AC-097 have `pr: 18P` and `mergeCondition: false`.
   - AC-086 is `phase: mixed` with `phaseClauses`, but its text is unchanged and it has no `mergeCondition` (m-59).
   - No `18C-M17-*` case is live: the plan and threat-model 18C rows defer them, and only the deferred AC-096 and AC-097 cite them.
   - The banners are extent-bounded.
   - `src/` has zero route or request sinks (E7).
4. **Fixture or research code cannot enter production dependency graphs: FAIL** (M-22). Answers to the owner's sub-questions:
   - Fail-closed on unresolvable or dynamic edges: only for `require` in `src/`.
   - `package.json` scripts: included as roots, but the rule contradicts them.
   - Workflows: not roots.
   - `tests/`: covered for `require` only.
   - Experimental fixtures: the directory is unnamed.
   AC-090 and AC-098 as rewritten are the right obligations. AC-098 is a real merge condition distinct from AC-084, because of its export-surface check and its runtime check that "no approval object is created". AC-090 still carries the old body (M-21).
5. **Refusal happens before click, submission, network, provider or healing: PASS in design, with conditions m-60 and m-63.**
   - Steps: 10a.2 plus 11a.
   - Requests that are not steps: 11h.1, with three runtime cases and the named repeated `route.abort` measurement (at least 10 runs, server-side records).
   - Heal reclassification: 11i, with an audited pre-heal provider call and no persistence.
   - Inversions: 11g (i) and (ii). Sites from P1 (pattern: click, fill, selectOption, press, check, uncheck, setChecked, dispatchEvent, setInputFiles, goto, tap, hover, dragTo, reload, goBack, goForward, `request.*`, route):

| Site | Sink | Routed by the design? |
|---|---|---|
| AIHealer.js:364, 366, 368 | fill, selectOption, click (`_performAction`) | Yes. 18B gates the four call sites; `:419` is refused in pilot mode; 11i reclassification applies (m-63 on caller-versus-sink) |
| ClickExplorer.js:80, 88 | click | Yes. 18B pilot-mode refusal at `clickElement` |
| ClickExplorer.js:142 | goBack | Only through the 11j generic rule and the NetworkGate GET policy |
| SiteSweep.js:191, 345 | goto | Yes. 18B pilot-mode refusal |
| ParallelDiscovery.js:95, 126 | goto | Yes. 18B pilot-mode refusal |
| ParallelSweep.js:91, 191, 195 | goto | Only through the 11j generic rule. Not in the plan's list (DOC says "bulk sweep refused in pilot mode") |
| TestRunner.js:223, 444 | goto | Only through the 11j generic rule and the NetworkGate GET policy |
| HealingBenchmark.js:308, 309, 310 | fill, selectOption, click | Only through the 11j generic rule. It is a `package.json` script root (M-22) |
| PageAnalyser.js:101; TestRunner.js:33, 204 | comments | False positives (m-63) |
| EndpointPolicy.js:117 | `Array.fill` | False positive (m-63) |
| any `request.*` or route sink | none | No sink in `src/` today |

   `evaluate` sites were not enumerated by P1. Page-script requests they trigger fall under 11h.1.
6. **Public claims describe refusal only: PARTIAL** (m-62, M-21). Repository-wide `git grep -nIiE` (reviews and rev patches excluded). Live occurrences and their disposition:
   - `phase-18-authenticated-pilots.md`:
     - lines 55, 98, 145, 146, 150, 152, 307, 309, 312 and 594: RunToken and `--approve-action` design. **Not annotated** (m-62).
     - line 406: annotated as SUPERSEDED. Acceptable.
   - AC JSON:
     - line 125 (18P open item): acceptable, deferred.
     - line 760 (AC-074 "approved half"): **violation**.
     - line 839 (AC-084): flags in a prohibition context are acceptable, but exit 14 is wrong (m-60).
     - line 899 (AC-090): **violation**.
     - lines 915, 925 and 926 (AC-092, AC-093): deferred. Acceptable.
     - line 935 (AC-094): **violation**.
   - Traceability:
     - line 12 (D4 "approved half ... tests-only executable"): **violation**, only partly annotated.
     - line 46: carries the annotation per 11m. Not read in full.
     - lines 62 and 253: history and quoted withdrawn text. Acceptable.
     - lines 150 and 174: reclassified via line 261. Acceptable.
   - Plan:
     - line 3 (status) and line 110 (18P): acceptable.
     - line 34 (DOC): lists the phrase as prohibited. Acceptable.
     - line 32 (18D base file set): **violation**, only partly annotated.
     - Outside the pattern: section 1 item 4: **violation**.
   - `docs/research/phase-18/proposed-scope-and-criteria.md:100`: annotated. Acceptable.
   - README: none.
   - Threat model and owner decisions: no pattern hit, but residuals 24 to 26 and the threat model's DOC and 18E rows describe the approval root and writer (M-21, m-61).
   - No live occurrences of "enables protected", "executes approved", "destructive action support" or "approval unlocks".
   - The 11n.G operator-guide draft: acceptable as written.
   - The repository-wide grep **should be a standing DOC merge condition**, extended with the M-21 token list and with "replay-protected approval".

## Other required statements
- **m-51 / OWNER-13-Q1:**
  - The interim disposition, "DEFERRED WITH THE APPROVAL MACHINERY — PENDING OWNER CONFIRMATION", is stated honestly in open items, the plan, traceability and the threat model. No document asserts it as satisfied or unnecessary.
  - Security finds deferral acceptable **only if** M-21 is fixed so that no production approval authority or fixture approval authority remains in scope. While AC-090's body is live, m-51 still protects a live surface and must stay an 18D condition.
  - The genuine-recording-server obligation is live in AC-051, and inversion (ii) gives it an operational positive control. Confirmed.
  - The decision is the owner's.
- **Counts and tagging:** 98/89/6/3 recomputed. No deletion and no renumbering. The deferred set is consistent with the 11e.3 rule. Tagging is **incomplete** under OWNER-13 (M-21).
- **11o flags that should rise above Minor:** flag 7 (most claims controls are documentary) underlies M-21; flag 8 (the prototype residual) underlies M-22. Flag 4 (exit 18 double-labelled): Security accepts the double label with the mandatory reason code as a design choice, but **does not accept the residual on the owner's behalf**. Flags 2, 3, 5, 6, 9, 10 and 11 are accurate as stated.

## Hypotheses (not verified)
- H-a: `scripts/demo/*` and `scripts/benchmark/*` contain browser action sinks or non-GET submissions against the local fixture that the 11a.1 rule would cover.
- H-b: `HealingBenchmark.js` is reachable in pilot mode.
- H-c: Repeated hop-zero `route.abort` gives zero server transmissions across at least 10 runs. This is required by 11h.2 and not yet measured.

## Carried, unchanged, not accepted
- Findings: m-21, m-23 (UNVERIFIED); m-24, m-26, m-27, m-28, m-30.
- m-51 / OWNER-13-Q1: open, owner confirmation required, and conditional on M-21 as stated above.
- H-1, H-3, H-7 (carried to 18P); H-8 (Node 24 UNVERIFIED).
- R-8 (including X3 and the m-51 boundary); R-9 (must be marked moot or deferred under M-21).
- Residuals 4 (open: state-changing GETs depend on manifest authoring), 13, 15, 21 (extended to exit 18 masking 17 and 1), 24, 25 and 26. The annotations on 4, 15 and 24 to 26 need correcting (m-61).
- R-7 is DECIDED (OWNER-12). R-10 and SPIKE-R are deferred, except the zero-transmission rows, which remain live in 18B and 18C.
- New: M-21, M-22, m-59 to m-64.
- Nothing here risk-accepts any item. Acceptance is the owner's alone.

**Final: BLOCK.**
