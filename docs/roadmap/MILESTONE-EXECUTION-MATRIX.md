# Milestone execution matrix (M0–M9)

Status: **PROPOSAL.** Issue states read from GitHub on 2026-10-27; implementation state read from `origin/main` `f910c66` and `docs/CAPABILITY-TRUTH-TABLE.md`. Acceptance text is quoted from each issue's first criterion only; the full list stays in the issue. Dates are the existing provisional targets, unchanged. "Not assessable" means the repository holds no evidence to estimate from. Companion: [strategy](EXECUTION-STRATEGY.md).

Common to every milestone: no auto-merge; CI green on the exact SHA; independent QA and Code Review; Security when risk-triggered; Release Manager verdict recorded; truth-table row changed in the same PR as its evidence; mock-provider tests never cited as live behaviour.

| M | Objective | Target | Issues | State | Hard dependencies | Security gate | Reviewers beyond QA/CR | Date assessment |
|---|---|---|---|---|---|---|---|---|
| M0 | Competitive evidence baseline | 2026-11-13 | #74 #75 #76 | **Done**, 3/3 closed, CI green on `f910c66` | none | n/a | none | Met |
| M1 | Trustworthy Alpha | 2027-01-08 | #79 #77 #78 (+G-03) | Not started. Related: `expect` checks (PR #54), `TestRunner.runExpect`, M0 harness | D1–D3, D8 | Persistence and approval (WP-77a/d); action guard (WP-78a) | Security (Opus) | Plausible if D2/D3/D8 decided early; review capacity is the constraint |
| M2 | Secure Technical Preview | 2027-02-19 | #80 #81 #82 (+G-01, G-02) | Phase 18 design draft only; refusal path designed, **no armed path** | M1 #79; OWNER-24/25; SEC-21; SPIKE-W7; Ubuntu measurement | The milestone | **Qualifying independent human security review** | At risk, not assessable |
| M3 | Verified Self-Healing | 2027-03-26 | #83 #84 #85 (+G-04, G-05) | Healing, matcher, approve/reject/rollback shipped (CAP-05, 06, 08); corpus is Falcon-authored (CAP-24 PARTIAL) | M0, M1 #77 (outcome-gated reuse) | Replay scope, approval scope | Security | Not assessable |
| M4 | Developer Beta | 2027-05-07 | #86 #87 #88 | Not started | M1, M3 | Import must not execute code | Security | Not assessable |
| M5 | Efficient CI | 2027-06-18 | #89 #90 #91 | Sharding and merge shipped (CAP-16, 17) | M1 #79 (budget exhaustion must be `UNVERIFIED`) | Cost-cap bypass | Code Review emphasis | Not assessable |
| M6 | Enterprise Operations | 2027-08-13 | #92 #93 #95, **#94 duplicate** | Dashboard token only (CAP-12); no RBAC (CAP-29) | M2 | Yes, full | Human security review | Not assessable |
| M7 | Customer Pilot | 2027-09-24 | #96 #97 #98 | Not started; discovery track starts earlier (D6) | M2, M3, partner recruitment | Customer data handling | Owner, legal for #98 | Not assessable |
| M8 | Advanced QA | 2027-12-03 | #99 #100 #101 | Visual regression PARTIAL (CAP-09) | M1, M6 | Masking, privacy | Security | Not assessable |
| M9 | Independent Competitive Release | 2028-01-14 | #102 #103 #104 | Harness exists (CAP-25 PARTIAL) | All prior; external reviewer | Yes, independent | **Independent human security and QA review**; owner | Not assessable |

## Per-milestone detail

### M1 — see the [M1 plan](M1-DETAILED-IMPLEMENTATION-PLAN.md)
Acceptance (#79): "A zero-assertion run cannot be presented as fully verified; explicit incomplete/unknown; regression fixtures demonstrate no false green; reporting/CLI/dashboard agree." (#77) approved assertions executable, unapproved never counted. (#78) 2–5 step fixture flows, deterministic replay, origin and action budgets.
Validation: matrix N1–N14; benchmark rerun with baseline 15/18 retained. Release criteria: M1 plan §7.

### M2 — Secure Technical Preview (#80, #81, #82)
Strategy: do not start #82 implementation until the owner picks OWNER-24 (supported browser posture) or OWNER-25 (exception process). Sequence #80 (threat model, human review) → #81 (default-deny policy, replaces M1's interim guard through the narrow `classifyAction` interface) → #82. Fixed by evidence, not by wish: the `SharedWorker` rule refuses on every measured configuration of Chromium 156.0.8078.4, so 18C delivers refusal and probe only. G-01 and G-02 are cheap, independent CI hardening and can run beside #80.
Acceptance (#81): "Destructive actions blocked by default; refusal reasons observable; adversarial fixtures pass; logs redacted; replay consistent." (#82) "Role fixtures cover allowed/denied journeys; no secret leakage; context cleanup verified; sessions and cookies not shared across tenants or workers."
Release gate for a "technical preview": all of the above plus a qualifying independent human review; an agent review does not qualify. If no reviewer exists, M2 stays NO-GO.

### M3 — Verified Self-Healing (#83, #84, #85)
Strategy: publish the baseline *before* changing the matcher (#83's own rule). Include external applications (G-05) and a live-provider check that is opt-in and secret-gated (G-04). Reuse the M1 outcome model so a repair counts only when action success *and* an approved assertion pass. Cover #84's "approvals cannot authorize newer proposals" with the digest approach from the contract. Local fixtures alone never justify a "superior accuracy" statement.

### M4 — Developer Beta (#86, #87, #88)
Strategy: inventory first (what Playwright constructs map to Falcon plan actions; unsupported ones listed, not skipped). Parse statically; never execute the user's test file. Export only what Falcon can prove round-trips. Avoid rebuilding what `@playwright/test` already does.

### M5 — Efficient CI (#89, #90, #91)
Strategy: selection must fail open to the full relevant set when the impact map is missing; every skipped test is counted as `NOT_TESTED` in the verification block, never a pass. #91 depends on #79: budget exhaustion yields `UNVERIFIED`.

### M6 — Enterprise Operations (#92, #93, #94, #95)
Strategy: #94 is a duplicate of #93 (strategy D4). Merge #94's unique criteria into #93 — "Tests prove retention, safe deletion, corruption detection, no credentials/PII in default artifacts, and export authenticity", "Define measurable baseline and edge/error scenarios before implementation" — and keep #93's "clear legal/data limitations" and "avoid claiming compliance certifications without third-party assessment". #92 must precede actor-attributed approvals; until it lands, records carry channel only. No SOC 2 or similar claim.

### M7 — Customer Pilot (#96, #97, #98)
Strategy: three scoped evaluations or a documented recruitment blocker. ROI inputs must be customer-verified. Licensing decisions need legal sign-off (#98). The early discovery track (D6) does not count.

### M8 — Advanced QA (#99, #100, #101)
Strategy: accessibility findings are advisory evidence in journeys, no certification wording. Visual baseline approval uses the same digest-and-supersede pattern as assertions. API/UI correlation reuses Stage B adapters.

### M9 — Independent Competitive Release (#102, #103, #104)
Strategy: rerun the M0 harness on the release SHA; tools that cannot run unpaid stay `NOT_TESTED`. Independent human reviewers produce the verdict; Falcon's agents may prepare evidence only. The dossier lists every claim with its evidence row; a claim without a row is not published.

## Scorecard template (applies to every milestone that publishes a number)

For each metric record: numerator, denominator, method, population, environment, tool and model versions, benchmark revision, confidence limits, threshold (only if justified by an owner decision), observed value. `NOT TESTED` is not zero; a zero denominator is `null`.

| Metric | Numerator / denominator | Baseline (observed 2026-10, local fixtures, 3 runs) | Target | Observed |
|---|---|---|---|---|
| Falsely green rate | objectively failing runs reported as pass / objectively failing runs | Falcon 15/18 (5 distinct fixtures × 3) | owner to set after M1 | NOT TESTED after change |
| Correct refusal | refusals where expected / refusal expected | Falcon 24/36 | owner to set | — |
| Healing precision | correct repairs / attempted | Falcon 9/9 (Falcon-authored corpus) | external-app figure in M3 | — |
| Unsafe repair rate | wrong repairs / attempted | 0/9 (same corpus) | — | — |
| True defect detection (business) | planted defects detected / planted defects | NOT TESTED | set in WP-77c | — |
| Missing-evidence detection | missing-evidence cases yielding INCONCLUSIVE or NOT_TESTED / cases | NOT TESTED | 100% by construction, tested | — |
| Business assertion coverage | journeys with ≥1 approved required assertion / journeys | NOT TESTED | — | — |
| Deterministic replay | replays with identical state sequence / replays | NOT TESTED | — | — |
| Shard merge correctness | merged verification equals unsharded / pairs | NOT TESTED | — | — |
| Cross-browser outcomes | real Firefox/WebKit passes / attempts | NOT TESTED (CAP-02 mocked) | G-01 | — |
| CI runtime, AI cost, maintenance, review effort, cost per verified journey | measured per run manifest | partial (W6 wall time; $0, 0 AI calls in local run) | M5 | — |
| Unauthorized-action refusal, auth isolation, approval-scope violations | adversarial cases refused / cases | NOT TESTED | M2 | — |

No threshold above is proposed as a number: the repository has no basis for one yet.
