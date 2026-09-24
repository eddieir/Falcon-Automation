---
name: production-cycle
description: Run Falcon work through a production-house workflow from discovery to release decision. Use for features, non-trivial bugs, incidents, refactors, CI changes, and releases.
argument-hint: "[issue, feature, bug, or release objective]"
disable-model-invocation: true
---

# Falcon Production Cycle

Run this workflow for: $ARGUMENTS

The main Claude session is the Production Director unless the user explicitly selects another role. Use the project agents in `.claude/agents/`. Keep a live status table in the conversation or the task plan. Do not create ceremony with no decision value; scale depth to risk, but preserve independent verification.

## Phase 0 — Intake

Read `CLAUDE.md`, relevant repository files, open work supplied by the user, and current git status.

Capture:
- objective;
- request source;
- users affected;
- urgency;
- constraints;
- non-goals;
- definition of success;
- unknowns.

If an unknown materially changes scope, safety, cost, public API, or data handling, ask the human. Otherwise state a reversible assumption.

Exit gate: objective and decision owner are clear.

## Phase 1 — Product discovery

Invoke `product-manager`.

Required output:
- problem statement;
- users/jobs;
- evidence and assumptions;
- success metrics;
- options and recommendation;
- non-goals.

Exit gate: the work solves a defined user problem and has a measurable outcome.

## Phase 2 — Scope and acceptance

Invoke `product-owner` with the approved product brief.

Required output:
- prioritized stories;
- AC-01... acceptance criteria in observable form;
- non-functional criteria;
- edge/error cases;
- acceptance evidence;
- out-of-scope and open decisions.

QA reviews criteria for testability before implementation.

Exit gate: no Must-have criterion is ambiguous or untestable.

## Phase 3 — Delivery and design

Invoke `project-manager` and `solution-architect`. They may work in parallel after scope freezes.

Project Manager returns dependencies, owners, critical path, risks, and milestones.
Architect returns affected boundaries, interfaces, failure modes, alternatives, decision, migration, rollback, and test seams.

Invoke `security-engineer` now if work affects AI prompts/healing, authentication, network endpoints, persistence, filesystem, DB, secrets, CI permissions, or dependencies.
Invoke `devops-engineer` now if work affects workflows, runtime, configuration, services, artifacts, or deployment.

Exit gate: implementation tasks are sequenced; architecture and risk controls satisfy acceptance criteria.

## Phase 4 — Implementation

Invoke `developer` with only:
- approved stories and AC IDs;
- selected architecture;
- repository constraints;
- exact allowed scope;
- required verification.

Developer reproduces the bug/current behavior where practical, implements the smallest coherent patch, adds focused tests, inspects the diff, and records commands/results.

For independent modules only, multiple developer tasks may run in parallel. Never let agents edit overlapping files concurrently.

Exit gate: implementation is complete, focused tests pass, and each AC has candidate evidence.

## Phase 5 — Independent verification

Invoke these independently:
- `qa-engineer` for AC traceability, regression, negative testing, and exact execution evidence;
- `code-reviewer` for a read-only diff review;
- `security-engineer` for the final diff when security-relevant;
- `devops-engineer` for final workflow/runtime evidence when operationally relevant.

The implementer cannot approve their own work. If a blocker appears, return it to Developer with evidence, then rerun the affected review. Do not simply edit around a failed test or reviewer concern.

Minimum Falcon gates by impact:
- docs-only: validate links/commands and repository consistency;
- isolated logic: focused unit/regression checks;
- core framework: `npm run test:unit`, `npm run test:regression`, relevant browser tests;
- browser/selector behavior: regression plus `npm run test:browser`;
- CI/DB/runtime: local relevant tests plus hosted GitHub Actions evidence;
- broad/release candidate: `npm test`, relevant scenario suites, autonomous pipeline, and CI.

Exit gate: QA accepts, review has no blocker/major unresolved finding, required security/DevOps verdicts are non-blocking.

## Phase 6 — Documentation and release decision

Invoke `technical-writer` to synchronize verified behavior, config, limitations, and upgrade notes.

Invoke `release-manager` with the complete evidence packet:
- product brief and accepted ACs;
- changed files/diff;
- test commands/results;
- QA, review, security, and DevOps verdicts;
- docs status;
- known risks;
- rollout/rollback plan.

Exit gate: Release Manager records GO, CONDITIONAL GO, or NO-GO.

## Phase 7 — Human handoff

Return:
1. outcome;
2. changed files;
3. AC traceability;
4. test/CI evidence;
5. review verdicts;
6. known risks and conditions;
7. rollout/rollback;
8. explicit next action.

Never merge, deploy, publish, delete, rotate credentials, or accept security risk unless the human explicitly authorized that action.

## Fast paths

### Small bug
Product Owner clarifies AC → Developer adds failing regression and fix → QA + Code Reviewer → Release Manager.

### Security incident
Production Director → Security triage → containment recommendation → human authorization → Developer/DevOps remediation → QA + Security retest → Release Manager. Never disclose secret values.

### Documentation-only
Technical Writer → Code Reviewer validates accuracy → Release Manager. Add Product Owner only if behavior/scope is ambiguous.

### Release-only
DevOps evidence → QA evidence → Security status → Technical Writer release notes → Release Manager.
