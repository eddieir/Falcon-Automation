# Falcon — Competitive Product Roadmap: GitHub Milestones & Issue Register

**Prepared:** 2026-10-23. **Repository:** https://github.com/eddieir/Falcon-Automation

 > The ten GitHub milestones exist and issues #74–#104 are assigned (links in [FALCON-MILESTONE-LINKS.md](FALCON-MILESTONE-LINKS.md)). This file is the issue register; for execution order and open proposals see [roadmap/EXECUTION-STRATEGY.md](roadmap/EXECUTION-STRATEGY.md).

## Milestones ordered by provisional delivery target

**Important:** These are planning targets, not promised releases. Milestone URLs are in [FALCON-MILESTONE-LINKS.md](FALCON-MILESTONE-LINKS.md).

| Delivery order | Milestone | Target date | GitHub issues |
|---|---|---|---|
| M0 | Competitive evidence baseline | 2026-11-13 | [#74](https://github.com/eddieir/Falcon-Automation/issues/74)–[#76](https://github.com/eddieir/Falcon-Automation/issues/76) |
| M1 | Trustworthy Alpha | 2027-01-08 | [#77](https://github.com/eddieir/Falcon-Automation/issues/77)–[#79](https://github.com/eddieir/Falcon-Automation/issues/79) |
| M2 | Secure Technical Preview | 2027-02-19 | [#80](https://github.com/eddieir/Falcon-Automation/issues/80)–[#82](https://github.com/eddieir/Falcon-Automation/issues/82) |
| M3 | Verified Self-Healing | 2027-03-26 | [#83](https://github.com/eddieir/Falcon-Automation/issues/83)–[#85](https://github.com/eddieir/Falcon-Automation/issues/85) |
| M4 | Developer Beta | 2027-05-07 | [#86](https://github.com/eddieir/Falcon-Automation/issues/86)–[#88](https://github.com/eddieir/Falcon-Automation/issues/88) |
| M5 | Efficient CI | 2027-06-18 | [#89](https://github.com/eddieir/Falcon-Automation/issues/89)–[#91](https://github.com/eddieir/Falcon-Automation/issues/91) |
| M6 | Enterprise Operations | 2027-08-13 | [#92](https://github.com/eddieir/Falcon-Automation/issues/92)–[#95](https://github.com/eddieir/Falcon-Automation/issues/95) |
| M7 | Customer Pilot | 2027-09-24 | [#96](https://github.com/eddieir/Falcon-Automation/issues/96)–[#98](https://github.com/eddieir/Falcon-Automation/issues/98) |
| M8 | Advanced QA | 2027-12-03 | [#99](https://github.com/eddieir/Falcon-Automation/issues/99)–[#101](https://github.com/eddieir/Falcon-Automation/issues/101) |
| M9 | Independent Competitive Release | 2028-01-14 | [#102](https://github.com/eddieir/Falcon-Automation/issues/102)–[#104](https://github.com/eddieir/Falcon-Automation/issues/104) |

`scripts/roadmap/setup-github-milestones.sh` created the milestone objects and assigned the issues; it is kept for reference and refuses to overwrite conflicting assignments.

## Release and review policy

- Prioritize measurable evidence and product correctness before future capabilities. Treat planned behavior as not implemented.
- Every issue needs acceptance criteria, negative tests and exact revision evidence. Keep QA, Code Review, Security when relevant, and Release Manager decisions independent.
- C2 requires a qualifying human independent reviewer; AI reviews do not substitute. Preserve Phase 18 unresolved risks until explicitly decided.
- Evaluate “100 steps above competitors” by repeatable outcome metrics, not number of features or marketing assertions.
- Create one bounded implementation PR per independently verifiable unit of work; never auto-merge.

## GitHub issues — original descriptions

### [#104 — [M9] Publish evidence-backed release readiness dossier](https://github.com/eddieir/Falcon-Automation/issues/104)

## Objective
Consolidate benchmark, ROI, security, quality, interoperability, adoption and limits into versioned release documentation.

## Acceptance criteria
- [ ] Every external claim traced to reproducible evidence; clear version scope; Release Manager and owner approve explicitly.
- [ ] Define measurable baseline and edge/error scenarios before implementation.
- [ ] Add deterministic regression and negative-case tests with exact test evidence.
- [ ] Preserve existing Falcon trust/refusal boundaries and honest reporting.
- [ ] Record Security review when risk-triggered, independent QA and Code Review, and Release Manager decision.
- [ ] Document limitations and update public statements without claiming unverified behavior.

## Candidate scope
README.md; CHANGELOG.md; docs/

## Dependencies
Deliver after prerequisite milestone gates; track blockers and owner decisions explicitly. No automatic merges or risk waivers.

## Completion
Acceptance evidence bound to exact revision; all mandatory CI checks green; reviewers independent. No P0/P1 open.

**Roadmap:** M9. **Status:** Proposed; not yet implemented.

---

### [#103 — [M9] Commission independent security and quality review](https://github.com/eddieir/Falcon-Automation/issues/103)

## Objective
Obtain qualifying human independent review of security boundaries, evidence integrity and real customer failure modes.

## Acceptance criteria
- [ ] Findings triaged, critical issues block release, owner-signed risk decisions, reviewed SHA recorded.
- [ ] Define measurable baseline and edge/error scenarios before implementation.
- [ ] Add deterministic regression and negative-case tests with exact test evidence.
- [ ] Preserve existing Falcon trust/refusal boundaries and honest reporting.
- [ ] Record Security review when risk-triggered, independent QA and Code Review, and Release Manager decision.
- [ ] Document limitations and update public statements without claiming unverified behavior.

## Candidate scope
docs/security/; tests/

## Dependencies
Deliver after prerequisite milestone gates; track blockers and owner decisions explicitly. No automatic merges or risk waivers.

## Completion
Acceptance evidence bound to exact revision; all mandatory CI checks green; reviewers independent. No P0/P1 open.

**Roadmap:** M9. **Status:** Proposed; not yet implemented.

---

### [#102 — [M9] Run cross-product reproducible benchmarks](https://github.com/eddieir/Falcon-Automation/issues/102)

## Objective
Evaluate Falcon and available competitors against common fixtures with version/date, cost and environment disclosed.

## Acceptance criteria
- [ ] Reproducible scorecard, raw evidence and confidence limitations; unavailable tools marked NOT TESTED.
- [ ] Define measurable baseline and edge/error scenarios before implementation.
- [ ] Add deterministic regression and negative-case tests with exact test evidence.
- [ ] Preserve existing Falcon trust/refusal boundaries and honest reporting.
- [ ] Record Security review when risk-triggered, independent QA and Code Review, and Release Manager decision.
- [ ] Document limitations and update public statements without claiming unverified behavior.

## Candidate scope
docs/research/; tests/

## Dependencies
Deliver after prerequisite milestone gates; track blockers and owner decisions explicitly. No automatic merges or risk waivers.

## Completion
Acceptance evidence bound to exact revision; all mandatory CI checks green; reviewers independent. No P0/P1 open.

**Roadmap:** M9. **Status:** Proposed; not yet implemented.

---

### [#101 — [M8] Add API/UI correlation for customer journeys](https://github.com/eddieir/Falcon-Automation/issues/101)

## Objective
Relate browser interactions to authorized API/network observations with privacy-safe redaction.

## Acceptance criteria
- [ ] UI-to-API evidence mapped to actions; permission boundaries, masking, async flows and negative fixtures tested.
- [ ] Define measurable baseline and edge/error scenarios before implementation.
- [ ] Add deterministic regression and negative-case tests with exact test evidence.
- [ ] Preserve existing Falcon trust/refusal boundaries and honest reporting.
- [ ] Record Security review when risk-triggered, independent QA and Code Review, and Release Manager decision.
- [ ] Document limitations and update public statements without claiming unverified behavior.

## Candidate scope
src/core/; tests/api/; docs/

## Dependencies
Deliver after prerequisite milestone gates; track blockers and owner decisions explicitly. No automatic merges or risk waivers.

## Completion
Acceptance evidence bound to exact revision; all mandatory CI checks green; reviewers independent. No P0/P1 open.

**Roadmap:** M8. **Status:** Proposed; not yet implemented.

---

### [#100 — [M8] Advance visual regression baselines and change triage](https://github.com/eddieir/Falcon-Automation/issues/100)

## Objective
Establish approval workflow for screenshot baselines, deterministic viewports and explainable diffs.

## Acceptance criteria
- [ ] Measured false-positive rate; testable approval/rollback; no silent baseline acceptance.
- [ ] Define measurable baseline and edge/error scenarios before implementation.
- [ ] Add deterministic regression and negative-case tests with exact test evidence.
- [ ] Preserve existing Falcon trust/refusal boundaries and honest reporting.
- [ ] Record Security review when risk-triggered, independent QA and Code Review, and Release Manager decision.
- [ ] Document limitations and update public statements without claiming unverified behavior.

## Candidate scope
src/core/VisualRegression.js; src/dashboard/; tests/

## Dependencies
Deliver after prerequisite milestone gates; track blockers and owner decisions explicitly. No automatic merges or risk waivers.

## Completion
Acceptance evidence bound to exact revision; all mandatory CI checks green; reviewers independent. No P0/P1 open.

**Roadmap:** M8. **Status:** Proposed; not yet implemented.

---

### [#99 — [M8] Integrate accessibility audits with functional journeys](https://github.com/eddieir/Falcon-Automation/issues/99)

## Objective
Use accessibility checks alongside discovered browser states and distinguish automated findings from human evaluation.

## Acceptance criteria
- [ ] Grounded rule references, reproducible fixture tests, accessibility review workflow and no certification claims.
- [ ] Define measurable baseline and edge/error scenarios before implementation.
- [ ] Add deterministic regression and negative-case tests with exact test evidence.
- [ ] Preserve existing Falcon trust/refusal boundaries and honest reporting.
- [ ] Record Security review when risk-triggered, independent QA and Code Review, and Release Manager decision.
- [ ] Document limitations and update public statements without claiming unverified behavior.

## Candidate scope
src/core/; tests/; docs/

## Dependencies
Deliver after prerequisite milestone gates; track blockers and owner decisions explicitly. No automatic merges or risk waivers.

## Completion
Acceptance evidence bound to exact revision; all mandatory CI checks green; reviewers independent. No P0/P1 open.

**Roadmap:** M8. **Status:** Proposed; not yet implemented.

---

### [#98 — [M7] Prepare sustainable product packaging and support policies](https://github.com/eddieir/Falcon-Automation/issues/98)

## Objective
Compare open-source plus commercial support and other packaging approaches; define support expectations and IP/license review.

## Acceptance criteria
- [ ] Decision document with costs, maintenance, SLA and legal sign-off before any license changes.
- [ ] Define measurable baseline and edge/error scenarios before implementation.
- [ ] Add deterministic regression and negative-case tests with exact test evidence.
- [ ] Preserve existing Falcon trust/refusal boundaries and honest reporting.
- [ ] Record Security review when risk-triggered, independent QA and Code Review, and Release Manager decision.
- [ ] Document limitations and update public statements without claiming unverified behavior.

## Candidate scope
LICENSE; README.md; docs/

## Dependencies
Deliver after prerequisite milestone gates; track blockers and owner decisions explicitly. No automatic merges or risk waivers.

## Completion
Acceptance evidence bound to exact revision; all mandatory CI checks green; reviewers independent. No P0/P1 open.

**Roadmap:** M7. **Status:** Proposed; not yet implemented.

---

### [#97 — [M7] Build customer ROI and TCO calculator](https://github.com/eddieir/Falcon-Automation/issues/97)

## Objective
Estimate time-to-value, setup, maintenance, compute, LLM calls, false repairs, review time and support.

## Acceptance criteria
- [ ] Published assumptions, sensitivity analysis, customer-verified inputs; distinguish forecasts and observed outcomes.
- [ ] Define measurable baseline and edge/error scenarios before implementation.
- [ ] Add deterministic regression and negative-case tests with exact test evidence.
- [ ] Preserve existing Falcon trust/refusal boundaries and honest reporting.
- [ ] Record Security review when risk-triggered, independent QA and Code Review, and Release Manager decision.
- [ ] Document limitations and update public statements without claiming unverified behavior.

## Candidate scope
docs/customer/; docs/research/

## Dependencies
Deliver after prerequisite milestone gates; track blockers and owner decisions explicitly. No automatic merges or risk waivers.

## Completion
Acceptance evidence bound to exact revision; all mandatory CI checks green; reviewers independent. No P0/P1 open.

**Roadmap:** M7. **Status:** Proposed; not yet implemented.

---

### [#96 — [M7] Run three scoped design-partner evaluations](https://github.com/eddieir/Falcon-Automation/issues/96)

## Objective
Prepare informed-consent pilots with representative journeys, disposable test data, baselines and measurable acceptance.

## Acceptance criteria
- [ ] Three evaluations or explicit recruitment blocker; pre/post maintenance and false-positive evidence; limitations recorded.
- [ ] Define measurable baseline and edge/error scenarios before implementation.
- [ ] Add deterministic regression and negative-case tests with exact test evidence.
- [ ] Preserve existing Falcon trust/refusal boundaries and honest reporting.
- [ ] Record Security review when risk-triggered, independent QA and Code Review, and Release Manager decision.
- [ ] Document limitations and update public statements without claiming unverified behavior.

## Candidate scope
docs/customer/; docs/research/

## Dependencies
Deliver after prerequisite milestone gates; track blockers and owner decisions explicitly. No automatic merges or risk waivers.

## Completion
Acceptance evidence bound to exact revision; all mandatory CI checks green; reviewers independent. No P0/P1 open.

**Roadmap:** M7. **Status:** Proposed; not yet implemented.

---

### [#95 — [M6] Harden CI integrations and multi-project operation](https://github.com/eddieir/Falcon-Automation/issues/95)

## Objective
Design GitHub/GitLab CI integration, least-privilege tokens, fork safety, artifact publishing and project isolation.

## Acceptance criteria
- [ ] Workflow tests cover untrusted PRs, token scoping, partial CI, separate projects and fail-closed handling.
- [ ] Define measurable baseline and edge/error scenarios before implementation.
- [ ] Add deterministic regression and negative-case tests with exact test evidence.
- [ ] Preserve existing Falcon trust/refusal boundaries and honest reporting.
- [ ] Record Security review when risk-triggered, independent QA and Code Review, and Release Manager decision.
- [ ] Document limitations and update public statements without claiming unverified behavior.

## Candidate scope
 .github/workflows/; scripts/; docs/

## Dependencies
Deliver after prerequisite milestone gates; track blockers and owner decisions explicitly. No automatic merges or risk waivers.

## Completion
Acceptance evidence bound to exact revision; all mandatory CI checks green; reviewers independent. No P0/P1 open.

**Roadmap:** M6. **Status:** Proposed; not yet implemented.

---

### [#94 — [M6] Implement retention, audit export and secret-safe artifacts](https://github.com/eddieir/Falcon-Automation/issues/94)

## Objective
Document storage classes, minimization, configurable retention, audit export integrity, and deletion lifecycle.

## Acceptance criteria
- [ ] Tests prove retention, safe deletion, corruption detection, no credentials/PII in default artifacts, and export authenticity.
- [ ] Define measurable baseline and edge/error scenarios before implementation.
- [ ] Add deterministic regression and negative-case tests with exact test evidence.
- [ ] Preserve existing Falcon trust/refusal boundaries and honest reporting.
- [ ] Record Security review when risk-triggered, independent QA and Code Review, and Release Manager decision.
- [ ] Document limitations and update public statements without claiming unverified behavior.

## Candidate scope
src/core/; docs/; tests/

## Dependencies
Deliver after prerequisite milestone gates; track blockers and owner decisions explicitly. No automatic merges or risk waivers.

## Completion
Acceptance evidence bound to exact revision; all mandatory CI checks green; reviewers independent. No P0/P1 open.

**Roadmap:** M6. **Status:** Proposed; not yet implemented.

---

### [#93 — [M6] Implement retention, audit export and secret-safe artifacts](https://github.com/eddieir/Falcon-Automation/issues/93)

## Objective
Document storage classes, privacy minimization, retention policies, signed/exportable audit records and deletion lifecycle.

## Rationale
This delivers M6 (Enterprise Operations) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/core/; docs/; tests/

## Acceptance criteria
- [ ] Tests for retention/corruption recovery/export integrity; no credentials/PII in default artifacts; clear legal/data limitations.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M5 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
Avoid claiming compliance certifications without third-party assessment.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M6 — Enterprise Operations. **Priority:** P2. **Status:** proposed.

---

### [#92 — [M6] Design enterprise RBAC and actor-attributed review workflow](https://github.com/eddieir/Falcon-Automation/issues/92)

## Objective
Define team/workspace ownership, authentication, reviewer permissions, separation of duties and decision provenance.

## Rationale
This delivers M6 (Enterprise Operations) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/dashboard/; docs/architecture/; tests/

## Acceptance criteria
- [ ] Threat model; deny-by-default matrix; actor identity in audit events; impersonation and privilege escalation tests; staged migration.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M5 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
Existing loopback token is not enterprise RBAC.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M6 — Enterprise Operations. **Priority:** P2. **Status:** proposed.

---

### [#91 — [M5] Introduce explicit execution and AI-cost budgets](https://github.com/eddieir/Falcon-Automation/issues/91)

## Objective
Limit browsers, duration, pages, provider calls, per-step tokens and repeated failing work; show budget spend.

## Rationale
This delivers M5 (Efficient CI) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
falcon.js; src/core/; docs/

## Acceptance criteria
- [ ] Budget exhaustion returns explicit PARTIAL/UNKNOWN, never PASSED; deterministic accounting; per-run summary covers estimated vs observed spend.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M4 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
Claude subscription budget is not Falcon's runtime API token budget.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M5 — Efficient CI. **Priority:** P1. **Status:** proposed.

---

### [#90 — [M5] Implement failure clustering and automated triage notes](https://github.com/eddieir/Falcon-Automation/issues/90)

## Objective
Group related selectors, network errors, infrastructure instability and assertion failures without flattening root causes.

## Rationale
This delivers M5 (Efficient CI) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/core/ReportManager.js; src/core/; tests/

## Acceptance criteria
- [ ] Deterministic signatures and confidence; distinct root causes remain distinct; reports link raw evidence and suggested action.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M4 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
No autonomous commit or silent quarantine.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M5 — Efficient CI. **Priority:** P1. **Status:** proposed.

---

### [#89 — [M5] Build deterministic change-impact test selection](https://github.com/eddieir/Falcon-Automation/issues/89)

## Objective
Map tested pages/journeys to code/path changes; explain selection and ensure conservative fallback.

## Rationale
This delivers M5 (Efficient CI) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/core/parallel/; src/core/; tests/

## Acceptance criteria
- [ ] On seeded fixture changes, high-risk tests included; missing impact map triggers full relevant set; selection provenance persisted.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M4 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
Never skip mandatory gate based on unverified impact.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M5 — Efficient CI. **Priority:** P1. **Status:** proposed.

---

### [#88 — [M4] Deliver five-minute onboarding and troubleshooting experience](https://github.com/eddieir/Falcon-Automation/issues/88)

## Objective
One-command fixture demo, setup validation, actionable failures, migration quickstart and container examples.

## Rationale
This delivers M4 (Developer Beta) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
README.md; docs/; scripts/

## Acceptance criteria
- [ ] Cold-start walkthrough on Node22/24; documented timings and failure paths; reproducible without API key; versioned docs.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M3 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
No fake performance claims.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M4 — Developer Beta. **Priority:** P1. **Status:** proposed.

---

### [#87 — [M4] Export maintainable Playwright tests and migration proofs](https://github.com/eddieir/Falcon-Automation/issues/87)

## Objective
Emit idiomatic TS tests with stable assertions, locators, scoped human-approved repairs and CI-ready structure.

## Rationale
This delivers M4 (Developer Beta) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/core/; scripts/; tests/

## Acceptance criteria
- [ ] Export compiles and passes on fixtures; import-export diff reviewed; no injected secrets or hallucinated assertions.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M3 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
Test data and assertions remain customer-owned.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M4 — Developer Beta. **Priority:** P1. **Status:** proposed.

---

### [#86 — [M4] Design Playwright TypeScript import with compatibility inventory](https://github.com/eddieir/Falcon-Automation/issues/86)

## Objective
Parse/import supported tests/fixtures/locators via AST, define unsupported syntax behavior and deterministic mapping.

## Rationale
This delivers M4 (Developer Beta) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/core/; scripts/; tests/regression/

## Acceptance criteria
- [ ] Representative Playwright suites import without executing arbitrary code; unsupported constructs listed not silently ignored; source tests preserved.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M3 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
No dynamic evaluation of imported repository scripts for parsing.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M4 — Developer Beta. **Priority:** P1. **Status:** proposed.

---

### [#85 — [M3] Improve repair explainability and rollback UX](https://github.com/eddieir/Falcon-Automation/issues/85)

## Objective
Surface candidate evidence, original/current selector, refusal reasons, prior revisions, approval scope and undo in CLI/dashboard.

## Rationale
This delivers M3 (Verified Self-Healing) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/dashboard/; scripts/healing/review.js; tests/

## Acceptance criteria
- [ ] Human can trace and reverse each proposal; history bounded; stale evidence warnings; keyboard accessible; no secret data.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M2 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
Dashboard review history is not enterprise identity proof.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M3 — Verified Self-Healing. **Priority:** P1. **Status:** proposed.

---

### [#84 — [M3] Strengthen candidate matching and replay invariants](https://github.com/eddieir/Falcon-Automation/issues/84)

## Objective
Test action/URL/origin/path semantics, accessibility signals, confidence margins, drift expiry and ambiguous candidate rejection.

## Rationale
This delivers M3 (Verified Self-Healing) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/core/AIHealer.js; src/core/; tests/regression/

## Acceptance criteria
- [ ] No cross-scope replay; matching refuses near ties; test mutation examples show defenses; approvals cannot authorize newer proposals.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M2 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
Preserve human approval as necessary for trusted reuse.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M3 — Verified Self-Healing. **Priority:** P1. **Status:** proposed.

---

### [#83 — [M3] Create healing precision and refusal benchmark corpus](https://github.com/eddieir/Falcon-Automation/issues/83)

## Objective
Curate labeled selector-drift cases: benign changes, ambiguous candidates, lookalikes, hidden targets, wrong destinations and hostile markup.

## Rationale
This delivers M3 (Verified Self-Healing) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
tests/regression/; docs/research/

## Acceptance criteria
- [ ] Precision/recall/wrong-action/refusal rates reproducibly reported; negative cases included; baseline published before algorithm changes.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M2 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
No marketing accuracy claim without the dataset and methodology.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M3 — Verified Self-Healing. **Priority:** P1. **Status:** proposed.

---

### [#82 — [M2] Implement isolated authenticated test journeys](https://github.com/eddieir/Falcon-Automation/issues/82)

## Objective
Support secret-free identity references and fixtures for multiple roles with short-lived isolated browser contexts; prevent state leakage.

## Rationale
This delivers M2 (Secure Technical Preview) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/core/BrowserManager.js; tests/e2e/; docs/

## Acceptance criteria
- [ ] Role fixtures cover allowed/denied journeys; no secret leakage; context cleanup verified; sessions and cookies not shared across tenants or workers.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M1 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
No external identity integration without threat review.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M2 — Secure Technical Preview. **Priority:** P0. **Status:** proposed.

---

### [#81 — [M2] Introduce safe autonomous action policy and refusal evidence](https://github.com/eddieir/Falcon-Automation/issues/81)

## Objective
Classify navigation, read, write, delete, payment, external domain and sensitive controls; require allowlist and hard budgets.

## Rationale
This delivers M2 (Secure Technical Preview) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/core/ClickExplorer.js; src/core/; tests/

## Acceptance criteria
- [ ] Destructive actions blocked by default; refusal reasons observable; adversarial fixtures pass; logs redacted; replay consistent.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M1 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
Never run unsafe explorations against real production.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M2 — Secure Technical Preview. **Priority:** P0. **Status:** proposed.

---

### [#80 — [M2] Resolve Phase 18 security gates and independent review prerequisites](https://github.com/eddieir/Falcon-Automation/issues/80)

## Objective
Map C1–C5 implementation status and C2 independent human approval, T1–T3 and open findings to owner-approved remediation steps.

## Rationale
This delivers M2 (Secure Technical Preview) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
docs/phase-18-plan.md; docs/PHASE-PLANS.md; security tests

## Acceptance criteria
- [ ] Owner-reviewed threat model, scoped implementation PRs, tests and independent sign-off; no pilot until mandatory gates satisfied; no risk assumed accepted.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M1 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
C2 remains unmet until a qualifying human reviewer approves.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M2 — Secure Technical Preview. **Priority:** P0. **Status:** proposed.

---

### [#79 — [M1] Formalize truthful coverage and false-green contract](https://github.com/eddieir/Falcon-Automation/issues/79)

## Objective
Track verified business assertions separately from interactions, skips, quarantine and generated scenarios; define CI exit policy.

## Rationale
This delivers M1 (Trustworthy Alpha) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/core/ReportManager.js; src/dashboard/; tests/

## Acceptance criteria
- [ ] A zero-assertion run cannot be presented as fully verified; explicit incomplete/unknown; regression fixtures demonstrate no false green; reporting/CLI/dashboard agree.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M0 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
Maintain existing nonzero exit semantics and backwards-compatibility migration.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M1 — Trustworthy Alpha. **Priority:** P0. **Status:** proposed.

---

### [#78 — [M1] Implement state-aware multi-step journey discovery](https://github.com/eddieir/Falcon-Automation/issues/78)

## Objective
Design bounded state graph over browser actions, navigation, form state and auth context, with dedupe and destructive action guard.

## Rationale
This delivers M1 (Trustworthy Alpha) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/core/SiteSweep.js; src/core/; tests/regression/

## Acceptance criteria
- [ ] Discovers representative 2–5 step flows in fixtures; documents unreachable states and coverage budget; deterministic replay; same-origin and action-budget enforcement.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M0 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
No uncontrolled production browsing.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M1 — Trustworthy Alpha. **Priority:** P0. **Status:** proposed.

---

### [#77 — [M1] Generate business assertions with human confirmation](https://github.com/eddieir/Falcon-Automation/issues/77)

## Objective
Design assertion suggestions for navigation outcomes, data values, permissions and side effects; do not conflate successful interaction with business correctness.

## Rationale
This delivers M1 (Trustworthy Alpha) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
src/core/TestGenerator.js; src/core/TestRunner.js; tests/

## Acceptance criteria
- [ ] Assertions explicitly accepted by operator; deterministically executable without LLM at run time; invalid/ambiguous assertions rejected; meaningful counterexamples fail CI.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Milestone M0 evidence and prerequisite security/correctness gates. Specific implementation dependencies to be refined at intake.

## Security / non-goals
Human-reviewed assertions, no false positives.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M1 — Trustworthy Alpha. **Priority:** P0. **Status:** proposed.

---

### [#76 — [M0] Publish Falcon capability truth table and claim audit](https://github.com/eddieir/Falcon-Automation/issues/76)

## Objective
Audit README, ARCHITECTURE and phase plans against tests and current implementation; tag every promised capability SHIPPED, PARTIAL, PLANNED or UNVERIFIED.

## Rationale
This delivers M0 (Competitive evidence baseline) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
README.md; docs/ARCHITECTURE.md; docs/PHASE-PLANS.md

## Acceptance criteria
- [ ] Each marketed capability references executable evidence; known limits visible; misleading comparative claims corrected; evidence gaps tracked.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Start of roadmap; baseline work may run in parallel.

## Security / non-goals
Do not silently upgrade planned features into shipped claims.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M0 — Competitive evidence baseline. **Priority:** P0. **Status:** proposed.

---

### [#75 — [M0] Create neutral competitive benchmark harness and fixtures](https://github.com/eddieir/Falcon-Automation/issues/75)

## Objective
Specify equivalent workflows for locator churn, multi-step assertions, auth/navigation, refusal, flake reporting and CI runtime; build local deterministic test applications and standardized measures.

## Rationale
This delivers M0 (Competitive evidence baseline) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
tests/regression/; docs/research/

## Acceptance criteria
- [ ] Versioned fixtures and test protocol; same workload and environment; documented cost, versions, confidence intervals and limitations; scoring rubric independently reviewed.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Start of roadmap; baseline work may run in parallel.

## Security / non-goals
External SaaS trials require budget and data-handling approval.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M0 — Competitive evidence baseline. **Priority:** P0. **Status:** proposed.

---

### [#74 — [M0] Build versioned competitor evidence register](https://github.com/eddieir/Falcon-Automation/issues/74)

## Objective
Research direct and adjacent competitors: Playwright Agents, Momentic, mabl, Testim, testRigor, Testsigma, Katalon, Healenium, Autify, Functionize, QA Wolf, BrowserStack and open-source browser agents.

## Rationale
This delivers M0 (Competitive evidence baseline) toward Falcon's measurable competitive differentiation. The issue describes proposed work, not currently shipped behavior.

## Scope / candidate paths
docs/research/competitor-matrix.json; README.md

## Acceptance criteria
- [ ] A source table with URL, accessed date, product/version, official-vs-independent classification, last-verified timestamp and unknown claims; factual claims have citations; no absent-feature conclusions from marketing silence.
- [ ] Add deterministic tests (positive, negative, failure and boundary cases) and record exact commands/results.
- [ ] Update relevant documentation and migration guidance; distinguish implemented from planned behavior.
- [ ] Preserve current trust/refusal, CLI exit-code, evidence integrity and non-false-green guarantees.
- [ ] Obtain independent QA and Code Review, Security when risk-triggered, and Release Manager verdict under the existing production-cycle policy.
- [ ] Record benchmark evidence, limitations and any residual risks against the exact revision.

## Dependencies and sequencing
Start of roadmap; baseline work may run in parallel.

## Security / non-goals
No purchases or live third-party testing without approval.
No automatic merges, production-site exploration, waiver acceptance, or fabricated feature/competitor claims.

## Definition of done
All acceptance boxes evidenced; repository regression/CI checks pass; user-facing claims accurate; mandatory reviews complete. If blocked, remain OPEN with the reason.

**Roadmap milestone:** M0 — Competitive evidence baseline. **Priority:** P0. **Status:** proposed.
