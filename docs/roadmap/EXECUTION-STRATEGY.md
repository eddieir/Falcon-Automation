# Falcon execution strategy (M0–M9 reconciliation)

Status: **PROPOSAL for owner review.** Nothing here changes a GitHub milestone, due date or issue. Verified 2026-10-27 against `origin/main` at `f910c66`. Sibling documents: [milestone matrix](MILESTONE-EXECUTION-MATRIX.md), [M1 plan](M1-DETAILED-IMPLEMENTATION-PLAN.md), [business correctness contract](BUSINESS-CORRECTNESS-CONTRACT.md), [validation gaps](VALIDATION-GAPS.md), [checkpoint](IMPLEMENTATION-CHECKPOINT.md).

## 1. Verified current state

| Fact | Evidence |
|---|---|
| `origin/main` is `f910c66` (#112, truth table). Local `main` was at `9460485`, one commit behind; the planning branch was cut from `origin/main` in a separate worktree so the owner's uncommitted `.claude/settings.json` change and untracked `falcon-operating-policy.md` were left alone. | `git rev-parse`, `git status` |
| M0 is complete: #74, #75, #76 closed, 0 open. M1–M9 have 3 open issues each, except M6 with 4 (#92–#95). | `gh api milestones` |
| No open PRs. CI (Falcon CI and CodeQL) succeeded on `f910c66`. | `gh pr list`, `gh run list` |
| Validation gaps #113–#117 (G-01..G-05) are all open and have **no milestone**. | `gh issue list` |
| Phase 18 is a design draft (rev 3 with patches to rev 25). Implementation is blocked pending Security review SEC-21, SPIKE-W7, an Ubuntu CI measurement, and explicit owner authorisation. OWNER-24 and OWNER-25 (how an authenticated run may ever be armed) are open. On the pinned Chromium, the `SharedWorker` rule refuses every configuration measured, so there is **no armed authenticated path** today. | `docs/phase-18-plan.md` header |
| Agent models in `.claude/agents/*.md` match the `CLAUDE.md` routing table. | `grep ^model` |

Capability truth table (`docs/CAPABILITY-TRUTH-TABLE.md`, 30 rows) is the scope authority for every claim below.

## 2. Observed problems in the roadmap records

| ID | Observation | Verified |
|---|---|---|
| P1 | #93 and #94 are the same work ("retention, audit export and secret-safe artifacts"), filed 41 s apart. Each holds acceptance criteria the other lacks. | Yes. #94 adds corruption detection, export authenticity and "define a measurable baseline"; #93 adds "clear legal/data limitations" and the no-compliance-claim non-goal. |
| P2 | `FALCON-GITHUB-ROADMAP-ISSUES.md` still says milestone setup is pending. Milestones and links exist. | Yes |
| P3 | The same file has 31 `#undefined` headings whose URLs carry the real number. | Yes (`grep -c`) |
| P4 | G-01..G-05 are open issues without a milestone, so no delivery order includes them. | Yes |
| P5 | Customer contact is first scheduled in M7 (2027-09-24), after nine milestones of building. | Yes |
| P6 | **CAP-22 says "Honest exit codes and no false green" is SHIPPED**, while the recorded local benchmark has Falcon reporting 15 of 18 objectively failing runs as passes (five distinct fixtures × 3 runs). The row's own limit ("reflects what ran") is accurate, but the title invites a wider reading. | Yes, see §3 |
| P7 | `PHASE-PLANS.md` Phase 19 (outcome contract, `INCONCLUSIVE`) is sequenced after Phase 18, while the roadmap puts the same idea (#77) in M1, before the Phase 18 gates (#80, M2). | Yes |
| P8 | #78 requires a "destructive action guard". No such guard exists in discovery code; #81 (M2) owns the policy. | Yes (`grep` for destructive/unsafe in `src/core`) |
| P9 | #77–#79 each say "Specific implementation dependencies to be refined at intake". They never were. | Yes |

## 3. What the false-green finding actually shows

Reading `competitive-benchmark-runs/d11c9e2-results.md`: Falcon's five false-green fixtures are `W5-unasserted-step`, `corpus/contradictory-role-action-f1`, `corpus/implicit-role-change-f1`, `corpus/stable-key-absent-f1` and `corpus/weak-text-only-f1`. In each, the original locator still resolves (to a wrong element or a step that asserts nothing), so healing never runs and Falcon behaves like the plain tools. The sixth Falcon "!" row, `W5-element-removed`, is reported as a failure and is not a false green.

Root cause in code: `ReportManager.buildReport` derives `PASSED` from `failed === 0 && unavailable === 0` among `verified = passed + failed + quarantined + unavailable`. `passed` means "the interaction did not throw". Only `expect` rows carry an `assertion` object (`TestRunner.runExpect`). The report therefore cannot tell an asserted pass from an interaction-only pass, and a run with zero assertions exits 0. The fix is a distinction the data model does not yet make, not a scorer change. The scorer must not be altered to improve Falcon's numbers (see M1 plan §WP-79c).

These are local, Falcon-authored, deterministic fixtures. They support the architecture argument, not an accuracy percentage.

## 4. Proposed changes (delta register)

Format: CURRENT → OBSERVED → PROPOSED → WHY → DEPENDENCY IMPACT → ACCEPTANCE EVIDENCE. **Every row with "OWNER" needs authorisation before it is applied.**

| # | Current | Observed | Proposed | Why | Dependency impact | Acceptance evidence | Authority |
|---|---|---|---|---|---|---|---|
| D1 | M1 issues unordered | P9 | Order inside M1: #79 foundation (WP-79a) → #77 Stage A → #79 integration → #78 → M1 qualification | The assertion engine needs the outcome model; discovery needs both to report coverage honestly | #77 and #78 depend on #79a; #78 depends on #77 Stage A | Dependency table in [M1 plan](M1-DETAILED-IMPLEMENTATION-PLAN.md) | Plan only |
| D2 | #77 in M1, Phase 19 after Phase 18 | P7 | Treat #77 Stage A as the first slice of Phase 19. It extends `PlanFile` `expect` (shipped in PR #54), needs no authentication, and so does not depend on Phase 18. Gating *healing reuse* on outcomes stays in M3 (#84) | Avoids blocking M1 on an undecided browser posture | None new | Owner records the Phase 19 split in `PHASE-PLANS.md` | **OWNER** |
| D3 | #78 acceptance silent on auth | P8, Phase 18 blocker | Split #78 acceptance: **M1 = unauthenticated, same-origin, local-fixture journeys** with budgets, loop detection and a deny-by-default action guard. Authenticated and state-changing discovery waits for #81 and #82 | #82 cannot arm on the current browser build; M1 must not imply otherwise | #78 no longer waits on Phase 18; authenticated variant waits on OWNER-24/25 | #78 closes on fixtures only; authenticated scope is listed as a named limitation | **OWNER** |
| D4 | #93 and #94 | P1 | Keep #93; copy #94's unique criteria into it (corruption detection, export authenticity, measured baseline); close #94 as duplicate | One owner for the work, nothing lost | None | Diff of the two issue bodies in [matrix](MILESTONE-EXECUTION-MATRIX.md) §M6 | **OWNER** (closes an issue) |
| D5 | G-01..G-05 unscheduled | P4 | Assign to milestones per [VALIDATION-GAPS.md](VALIDATION-GAPS.md): G-03 → M1, G-01 and G-02 → M2, G-04 and G-05 → M3 | Each gap blocks a claim a milestone wants to make | Adds 1 small item to M1 | Milestone field set | **OWNER** (changes milestones) |
| D6 | Customer contact in M7 | P5 | Add a **non-release-gating discovery track** from M1: up to five structured conversations about false-green pain and review cost, no code, no data from customers. M7 stays the only gate that counts design-partner evidence | A wrong assumption found in M1 costs weeks; found in M7 it costs quarters | None; M7 criteria unchanged | Interview notes kept outside the repo; only anonymised themes committed | **OWNER** (recruitment, sharing) |
| D7 | CAP-22 SHIPPED | P6 | Re-scope CAP-22 to PARTIAL with the limit "interaction-only passes and zero-assertion runs exit 0; see #79", and restore SHIPPED when #79 lands. The truth-table check requires the limit text | Truth table is the claim authority | None | `m0-76-capability-truth-table.check.cjs` passes after the edit | **OWNER** (downgrades a published claim); not applied in this PR |
| D8 | Default exit behaviour for zero-assertion runs | Breaking-change risk | First release of #79 adds the verification block and an opt-in `--require-verified` that exits non-zero. Flipping the default is a separate, announced, owner-decided change | Existing CI users would turn red overnight | Default flip becomes a decision gate before M1 qualification | Decision recorded in the matrix | **OWNER** |
| D9 | Non-material doc faults | P2, P3 | Fixed in this PR: setup warning replaced, `#undefined` headings numbered | Broken documentation | None | `grep -c undefined` returns 0 | Non-material, in PR |

Milestone dates are **not** changed. Feasibility is addressed in §6.

## 5. Dependency graph

```
M0 done ──► #79a outcome model ──► #77 Stage A ──► #79b integration ──► #78 (fixtures) ──► M1 qualification
                  │                                      │
                  └─ G-03 Allure content ────────────────┘
M1 ──► #80 Phase 18 gates ─┬─► #81 safe-action policy ─► #82 isolated auth journeys
                           └─ OWNER-24 / OWNER-25 (browser posture) ───────────┘
G-01, G-02 ──► M2 (cheap CI hardening, independent of the above)
#83 corpus ─► #84 matcher/replay invariants ─► #85 UX         (G-04, G-05 feed #83)
M1 + M3 ──► #86..#88 (M4) ──► #89..#91 (M5) ──► #92..#95 (M6) ──► #96..#98 (M7) ──► #99..#101 (M8) ──► #102..#104 (M9)
```

Critical path to the *first externally defensible claim*: #79a → #77A → #79b → #83 (healing corpus, external apps) → #102. Everything authenticated (#82, #96 pilots with logins) hangs off OWNER-24/25, which is a human decision no agent can make.

## 6. Feasibility of target dates

The repository has no velocity data beyond M0 (three issues, PRs #105–#112, merged within days, but all documentation or fixtures). That is not a basis for estimating code milestones, so **no new estimates are made**.

| Milestone | Assessment |
|---|---|
| M1 2027-01-08 | Plausible on dependency grounds if D2, D3, D8 are decided by early November. Review capacity (independent QA and Code Review per work package) is the likelier constraint than coding. |
| M2 2027-02-19 | **At risk, not assessable.** Needs OWNER-24/25, SEC-21, SPIKE-W7 and a qualifying independent human security review; none is within agent control. |
| M3–M6 | Depend on M1/M2 outcomes; not assessable now. |
| M7 | Needs recruitment; the discovery track (D6) is the early signal. |
| M9 | Needs an independent human security reviewer; not satisfiable by dispatching an agent. |

## 7. Risks

1. Owner decision latency on D2/D3/D8/OWNER-24 is the main schedule risk.
2. Business assertions can be wrong in the same way the app is wrong if expected values come from observed output; provenance rules in the [contract](BUSINESS-CORRECTNESS-CONTRACT.md) address this.
3. Scope creep: Stage B/C assertion adapters touch databases and APIs and belong after M1 unless the owner pulls them in.
4. A benchmark improvement achieved by changing the scorer would be worthless; the M1 plan forbids it.
5. Token budget: M1 has roughly eleven PR-sized work packages. The checkpoint file exists so a session can resume without re-reading history.

## 8. Human review prerequisites

| Gate | Needs a person |
|---|---|
| Phase 18 security gate (#80) | Independent human security reviewer; SEC-21 is an agent review and does not satisfy it |
| Any release declaration (M2, M9) | Owner approval; Release Manager records GO/CONDITIONAL GO/NO-GO |
| Approvals of business assertions | A human reviewer. Today's dashboard token proves a channel, not an identity (CAP-08, CAP-12); records say so |
| Closing #94, moving milestones, reassigning G-issues | Owner |

## 9. Early customer discovery plan (non-gating)

Goal: test two hypotheses before M7: (a) teams see "green but wrong" as a recurring cost, (b) they will approve business assertions rather than write them. Method: up to five 30-minute conversations with practising QA or SDET owners, a fixed question list, no demo of unreleased features as proof, no customer data, no Falcon claims made. Output: an anonymised theme list in `docs/research/` (optional) and a go/revise note to the owner at the M1 and M2 boundaries. It does not count toward #96.

## 10. Plan review log (Stage 3)

Two read-only agent reviews were run on this revision. They are agent reviews: they are **not** the independent human review that Phase 18 and M9 require, and they do not approve anything.

| Review | Outcome | Plan change made |
|---|---|---|
| Solution Architect (S3-ARCH-1) | `ShardMerge` drops the `assertion` object and the shard row schema is strict, so merged and unsharded verification could not match | Added WP-79s (shard carriage) before WP-79b; moved row fields out of WP-79a; added N15–N17; contract placement beside the plan |
| Security Engineer (S3-SEC-1) | HIGH: #78 guard was a denylist; approval state could be forged because the digest excludes `approval`. MED: provenance is a label, locator steering by page text, report masking. LOW: dashboard approval open when no token | Allowlist guard plus network backstop, guard on replay, fresh context (M1 plan §4); approval store keyed by digest with hash chain, fail closed, strict JSON, provenance stripped from AI proposals, masking, token required (contract §6, §9) |

Unresolved: the Architect did not verify `falcon.js` line citations, and neither reviewer ran code. The model IDs for these two dispatches were not read from runtime metadata in this session, so the CLAUDE.md first-dispatch verification is **not recorded as done**. Residual risk accepted by nobody: approval records a channel, not a person.
