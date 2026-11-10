# M2 issue #80: Phase 18 security-gate reconciliation

Scope: issue #80, "Resolve Phase 18 security gates and independent review prerequisites". This document reconciles gate status against the repository. It implements no Phase 18 control, enables no protected action and changes no production code. Issue #80 stays open.

## 1. Baseline

- Base: `origin/main` at `229816e1d60757d2b888f1bb539c9e7078f0eab3` (2026-11-10).
- Sources read: `docs/phase-18-plan.md` (header and sections 1 to 6), `docs/architecture/phase-18-implementation-readiness.md` (sections 5 to 9), `docs/security/phase-18-residual-risk-T1.md` in full and the status lines of T2 and T3, `docs/roadmap/ROADMAP.md`, `README.md`, and the live issue #80.
- Not re-read: the 39 design reviews, the spike and conformance result files, `docs/phase-18-owner-decisions.md` and `docs/phase-18-h8-node24-findings.md`. Their conclusions are taken from the two summaries above and are labelled historical.
- The readiness package was last synced at `main` `2f31076` (2026-10-22). Merges since then (M1 work, #135) do not touch Phase 18 gate material, which `git log` on the two gate documents confirms: their last commit is `cdd58d7`.
- The plan header still reads "DRAFT rev 3" while carrying rev 21 to 25 text. The binding content is the later text; the header is stale.
- claude-mem was not available as a tool in this session, so no memory retrieval was done. Graphify was not needed: reachability was checked directly (section 5).

## 2. Gate matrix

Status vocabulary: SATISFIED, BLOCKED, UNVERIFIED, DEFERRED_BY_OWNER, NOT_APPLICABLE. No gate is SATISFIED.

| Gate | Requirement | Status | Evidence | Blocking condition | Owner | Minimum remediation | Verification | Next dependency |
|---|---|---|---|---|---|---|---|---|
| C1 | Behavioral export check: detect routes that expose the private gate-construction function | BLOCKED | Specified in rev 42 s6 / rev 43 s1; readiness s5: design only, not implemented. Limits L1 to L9 stated; SEC-38 approximations missed 12 evasion routes | Owner has not accepted or adjusted limits L1 to L9 (readiness s9 item 4); `falcon.js` load decision open | CTO | Record the L1 to L9 decision; then implement the C1 harness (readiness s8 row 3) | C1-AC1 to AC7; KNOWN-MISS fixtures recorded as unresolved, never as passes | C1 decision, then T1 |
| C2 | Package and executed-tree integrity, with an independent reviewer | BLOCKED | Readiness s3: independence UNMET; single account, admin bypass `always`, no `CODEOWNERS`, no required review on `main` | No independent human reviewer exists or is named. An AI-agent verdict cannot satisfy C2 (owner excluded it) and CTO authorization does not substitute for a qualifying reviewer | CTO (name reviewer) | Name the reviewer, grant access, add `CODEOWNERS` and the ruleset, remove admin bypass (readiness s8 row 0); then build the manifest and baseline-loaded verifier (row 2) | The five effectiveness tests of readiness s3 item 5, recorded with dates | Independent person |
| C3 | Supervisor and process integrity | UNVERIFIED | Reference code only (rev 41), not shipped. 41 process and 24 unit rows pass on Node 22 and 24, macOS and Linux arm64 (historical) | No Linux x64, hosted-runner or Windows evidence; `TZ` and `LC_*` open; `setsid` grandchild residual | Security / DevOps | Run the conformance rows on the GitHub-hosted x64 runner | Same rows, runner log | Owner approval of the CI change |
| C4 | Runtime refusal (`gate37`); refusal stays in force while FW-2 is `unmeasured` | UNVERIFIED | Reference text only. Reviewed SEC-34 to SEC-39 with no finding on its behaviour. arm64 evidence only | No implementation in `src/` (section 5); no parity evidence | Security | Implement the refusal (readiness s8 row 4) after the failure-code decision | Refusal exits before browser launch with the chosen exit class | Readiness s9 item 3 |
| C5 | Scope B isolation for any workflow running untrusted executable code | BLOCKED | Network containment only (NETW-01, arm64 Docker Desktop, 0 escapes) | PID and cgroup containment, x64 and runner parity, wiring and wss controls (MG-15) not done | Security | Separate approval; no work under #80 | Per readiness s5 | Later; not needed while such workflows stay disabled |
| T1 | Residual risk: gate-construction interface exposed by an authorised first-party change | BLOCKED | `phase-18-residual-risk-T1.md`: OPEN, NOT ACCEPTED | Owner has neither accepted, mitigated nor closed it | CTO | Decide among the record's options (a) to (d); (c) needs the C2 reviewer | Updated status line in the record | C2 reviewer |
| T2 | Residual risk: private identity token forged or reused outside the gate | BLOCKED | `phase-18-residual-risk-T2.md`: OPEN, NOT ACCEPTED | Same | CTO | Same | Same | Same |
| T3 | Residual risk: disallowed builtin loaded by an authorised change | BLOCKED | `phase-18-residual-risk-T3.md`: OPEN, NOT ACCEPTED; scanner returned CLEAN on forms f01 to f03 | Same; also tied to the incomplete C5 | CTO | Same | Same | C5 |

C2 breakdown, kept separate on purpose:

| Element | State |
|---|---|
| Architecture review | Done as design text (rev 42 s7, rev 43 s2, readiness s2 and s3) |
| Automated Security-agent review | Done for the design (SEC-34 to SEC-39); not acceptance, and not implementation review |
| Qualifying independent human review | Missing |
| Explicit human approval | Missing. Required evidence: the reviewer's name in the owner decision record, a recorded approval by that person who is not the author, and a passing run of the readiness s3 item 5 effectiveness tests |

## C2 approval record

Machine-read by `tests/regression/phase18-gate-reconciliation.check.cjs` only when C2 is marked SATISFIED. Fill in when a qualifying human reviewer approves; paths are repository paths to the recorded approval and to the dated effectiveness-test results.

reviewer: NOT RECORDED
author: NOT RECORDED
approval-record: NOT RECORDED
effectiveness-evidence: NOT RECORDED

## 3. Owner decisions

Current and binding (from the plan header and readiness package; not re-derived):

- OWNER-12: no protected non-GET execution against customer applications; refusal before transmission.
- OWNER-13: the production approval path is removed from Phase 18; detection and refusal only.
- Rev 25 section B: the fail-closed SharedWorker capability fallback is the accepted design.
- OWNER-13-Q1, OWNER-14-Q1 and OWNER-14-Q2: decided and closed.

Still required from the CTO (readiness s9 and the roadmap):

1. Name the independent human reviewer and decide write access (item 1).
2. Decide on removing or limiting the admin bypass on `main` (item 2).
3. Choose the failure code and exit class for the Scope A refusal, and whether enforcement needs separate security review (item 3).
4. Accept or adjust C1 limits L1 to L9 (item 4).
5. Decide whether browser jobs run in a digest-pinned container (item 6; needs an x64 digest).
6. OWNER-24 (a supported browser posture) or OWNER-25 (an owner-approved exception process). Both open. Roadmap gate date: 22 Jan 2027.
7. Accept, mitigate or close T1, T2 and T3.

## 4. Superseded design decisions

- Rev 23 section B (construction stub plus CDP target auto-attach for SharedWorker coverage): superseded and not accepted.
- The 16-case SPIKE-W2 matrix: withdrawn in favour of the W6-T conformance matrix.
- Rev 14 and rev 15 arming, lease and redirect gates, the M1 mechanism and the `route.fetch({maxRedirects:0})` fallback: withdrawn by OWNER-12.
- The whole approval path (writer, flags, RunToken, ledger, approvals root): deferred to 18P-PROTECTED-NONGET by OWNER-13; design history is in `docs/pilot-deferred/phase-18p-protected-nonget.md`.
- The "two-command approval workflow" wording: removed from the operator documentation plan.

## 5. Phase 18 boundaries: verified disposition

| Boundary | Disposition | Basis |
|---|---|---|
| SharedWorker detection and refusal | Design accepted; not implemented. Execute mode cannot be armed on pinned Chromium 156.0.8078.4; refusal is exit 18 (`shared_worker_present` or `shared_worker_block_unverified`). Must not be weakened | Plan header; `src/core/pilot/` absent |
| `--disable-features=SharedWorker` | Not accepted as a product mechanism | Plan header; now enforced by a test |
| Protected-action classification and destructive-action blocking | Specified (18C); not implemented. Existing `JourneyExplorer` refuses destructive verbs for discovery only | Plan s1; PR #142 |
| Approval and protected execution | DEFERRED_BY_OWNER (OWNER-12, OWNER-13) | Plan s5 |
| Authentication-state isolation | Specified (18A); not implemented | Plan s3 |
| Evidence redaction, secret-safe reporting | Specified (18E); not implemented | Plan s3 |
| Dependency-reachability controls | Mandatory gate; checker never built or executed in any revision reviewed (plan header, rev 21) | Plan header |
| Filesystem and storage compatibility | SPIKE-FS partial; LINUX-01 reported on Docker Desktop; GitHub `ubuntu` x64 runner required and unmeasured (one filesystem-only run, FS-RUNNER-01) | Plan header; readiness s7 |
| Node and browser versions | H-8 (Node 24) UNVERIFIED at rev 21; not re-checked here; all conformance evidence arm64 | Plan header; readiness s7 |
| Remaining open gates | MG-1 (partial), MG-4, MG-8, MG-9 to MG-17, FW2-C6, OPEN-BID-27, OWNER-24 | Readiness s7 |

Reachability check on main (run in this change): `src/core/pilot/` does not exist, and no `--approve-action`, `--emit-token-to`, `PILOT_APPROVAL_RUN_TOKEN` or `disable-features=SharedWorker` appears in `falcon.js`, `package.json`, `.env.example`, `src/`, `scripts/` or `.github/`. So no armed path and no protected execution is reachable today. This is a statement about main, not evidence that the specified controls work.

## 6. Work classification (Stage C)

| Class | Items |
|---|---|
| A. Documentation reconciliation | This document; README and `docs/roadmap/ROADMAP.md` status |
| B. Missing verification | `tests/regression/phase18-gate-reconciliation.check.cjs` (section 8) |
| C. Production-code defects | None found. No reproducible P0 to P2 defect was identified in existing code. Controls C1 to C5 are unimplemented, which is a readiness gap, not a defect |
| D. Owner decisions | Section 3 |
| E. Independent human approval | C2 reviewer, section 2 |

## 7. Minimal remediation actions

| # | Action | Owner | Depends on | Verified by |
|---|---|---|---|---|
| 1 | Name the independent reviewer in `docs/phase-18-owner-decisions.md` | CTO | A person | The record names someone other than the author |
| 2 | Apply `CODEOWNERS` and the ruleset; remove admin bypass | CTO, DevOps | 1 | The five effectiveness tests of readiness s3, recorded with dates |
| 3 | Record decisions on C1 limits, failure code, container and OWNER-24/25 | CTO | None | Dated entries in the owner-decision record |
| 4 | Record accept, mitigate or close for T1 to T3 | CTO | 1 for option (c) | Status line of each record changes; the regression check is then updated in the same change |
| 5 | Implement C2 verifier (readiness s8 row 2) | Developer, Security review | 1, 2 | C2-AC1 to AC7 |
| 6 | Implement C1 harness (row 3) | Developer, Security review | 3 | C1-AC1 to AC7 |
| 7 | Implement the Scope A refusal (row 4) | Developer, Security review | 3 | Each refusal case exits before browser launch with the chosen exit class |
| 8 | Run C3 rows on the x64 hosted runner | DevOps | Owner approval of the CI change | Runner log against the arm64 baseline |

Each of 5 to 8 needs its own owner approval before work starts (readiness s8).

## 8. Tests

New: `tests/regression/phase18-gate-reconciliation.check.cjs`, picked up by the existing `npm run test:regression` glob. It checks documentary consistency, not control effectiveness. A passing run says nothing about whether a security control works; any SATISFIED claim still needs independent review of the evidence it cites.

Durable invariants:

- Every gate C1 to C5 and T1 to T3 appears in the matrix with a recognised status.
- A SATISFIED gate cites at least one repository path in its evidence cell, and every cited path exists. This confirms the reference resolves, not that the evidence is sufficient.
- C2 may be SATISFIED only if the "C2 approval record" section names a reviewer who is not marked as an agent or model and is not the author, and its approval-record and effectiveness-evidence paths exist.
- T1 to T3 matrix status must agree with the Status line of the matching residual-risk record: an open record requires BLOCKED or UNVERIFIED; a resolved record requires SATISFIED, DEFERRED_BY_OWNER or NOT_APPLICABLE. Changing a record without updating the matrix fails, and so does the reverse.
- No `--approve-action`, `--emit-token-to` or SharedWorker-disabling `--disable-features` in `falcon.js`, `package.json`, `src/`, `scripts/` or `.github/`, and the plan still rejects that flag as a product mechanism. `PILOT_APPROVAL_RUN_TOKEN` is not scanned because the plan requires production code to reject it on presence.
- Pilot keys in `.env.example` stay blank.

Not asserted, so legitimate progress does not fail: which gates are open, whether `src/core/pilot/` exists, and whether T1 to T3 stay open.

Validator behaviour is exercised on in-memory fixtures (missing gate, invalid status, unsupported SATISFIED, C2 without human approval evidence, accepted progress, planted forbidden tokens); the authoritative records are not mutated.

Limits: the forbidden-token scan is a regex over file text and can be evaded by obfuscation or built strings. The reviewer check is a name heuristic. Path existence does not prove the evidence is adequate. The check cannot detect a control that was implemented incorrectly.

Commands and results are recorded in the PR description, tied to the head SHA. No exit-code behaviour changed.

## 9. Benchmark and measurement evidence

None produced. No performance claim is made. Historical measurements (SPIKE-W6: 42 decisive runs on Node 22.19.0 and 24.21.0; NETW-01) are cited from the plan, not repeated.

## 10. Dependencies for #81 and #82

- Neither starts from this change.
- #81 (safe action policy) depends on this document's items 3 and 7 (failure code and refusal), and on the C1 decision.
- #82 (isolated authenticated journeys) depends on OWNER-24 or OWNER-25, which are open. On the pinned Chromium build Phase 18 cannot arm execute mode, so #82 cannot deliver an armed authenticated run until one of them is decided with new independent security evidence. It also depends on the C2 reviewer for the M2 sign-off.

## 11. Residual risks

- T1, T2, T3 are open and unaccepted. C1 can never prove absence of exposure routes.
- Every control is specified rather than built; the review evidence is for design text.
- All conformance evidence is arm64; no hosted-runner, Linux x64 or Windows evidence.
- This reconciliation was done by an AI coordinator from document text. It is not an independent QA, Code Review, Security or Release Manager verdict, and not C2.

## 12. Rollback

Revert the commit. It adds one document, one test and roadmap text. Nothing in `src/`, workflows or settings changes.

## 13. Next action

The CTO names the independent human reviewer and records the decisions in section 3. Until then #80 remains open and #81 and #82 do not start.
