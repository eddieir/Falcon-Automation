---
name: production-cycle
description: Run Falcon work through a risk-scaled production workflow from intake to release decision. Use for features, non-trivial bugs, incidents, refactors, CI changes, and releases.
argument-hint: "[issue, feature, bug, or release objective]"
disable-model-invocation: true
---

# Falcon Production Cycle

Run this workflow for: $ARGUMENTS

The main session is the Sonnet Production Director and sole coordinator. Before dispatch, confirm session model Sonnet and medium effort; check global subagent model/effort overrides, premium alias remapping, or other settings that could defeat specialist model choices. If effective selection is uncertain or would silently use a premium model, resolve it or tell the human before dispatch. Activate only roles needed by task risk and acceptance evidence; do not invoke every role by default. Haiku roles: Product Manager, Product Owner, Project Manager, Technical Writer, Release Manager. Sonnet roles: Production Director and technical roles (Solution Architect, Developer, QA Engineer, Code Reviewer, Security Engineer, DevOps Engineer). The coordinator dispatches and relays all work through the main session; do not assume agents can message one another or spawn nested agents.

## Coordination contract

At intake, set a run ID and create a durable coordinator-owned ledger under `.git/production-cycle/<run-id>/`. Resolve the actual Git directory with `git rev-parse --git-path production-cycle` so worktrees use the right location. Keep the brief, task dispatches, returned evidence, revision, decisions, open risks, actual model per dispatch, and dispatch/resume counts there. Define revision as HEAD plus working-tree diff identity, including relevant untracked files; do not identify work only by HEAD. Only the coordinator updates this ledger. Workers return findings and edit only explicitly allowlisted deliverable paths.

Every dispatch states: unique task ID; target revision; specific task; applicable acceptance criteria (AC IDs); allowlisted paths; inputs/evidence; intended consumer; and effort bound. Give one independent task per dispatch. Never allow concurrent edits to overlapping paths.

Require a concise return of at most 200 words with these fields: `TASK_ID`, `REVISION`, `STATUS`, `INPUTS`, `EVIDENCE_PATHS`, `RECIPIENT`, `DELTA`, `OPEN_RISKS`. `INPUTS` lists consumed packet IDs; `STATUS` is `DONE`, `BLOCKED`, `PARTIAL`, or `NEEDS_INPUT`. If task ID or revision is unknown, require `UNKNOWN`; include commands/results in evidence where relevant. Reject ungrounded claims and ask for missing evidence within the task’s retry allowance.

Bound coordination: at most 2 concurrent tasks. Dispatch ceilings, including retries and resumed tasks: fast work 4, standard work 8, full work 16. Classify scope and risk at intake. These are soft coordination ceilings, not claimed model-token usage or guaranteed hard token caps. Never fabricate token or cost measurements. Allow at most one retry per blocked task; then replan within the remaining ceiling or report the blocker. Do not automatically escalate to a more expensive model. Do not skip a required risk gate to fit a budget; surface the constraint and obtain a human decision if the gate cannot be completed.

## Phase 0 — Intake and risk

Read `CLAUDE.md`, relevant repository files, user-supplied context, and current Git status. Record objective, source, affected users, urgency, constraints, non-goals, success definition, unknowns, risk class, and decision owner in the ledger. Ask the human only when an unknown materially affects scope, safety, cost, public API, or data handling; otherwise state a reversible assumption.

Choose a tier: fast for bounded, low-risk changes; standard for ordinary feature/fix work, including a bounded security fix with contained impact; full for broad or high-impact work, including security-sensitive, operational, or release-critical changes beyond a contained fix. Keep a live status summary in the conversation or task plan. The exit gate is a clear objective, decision owner, and risk tier.

## Phase 1 — Product and acceptance (when needed)

Use Product Manager when user problem, evidence, outcomes, or product tradeoffs are unclear. Return problem/users, evidence versus assumptions, success measure, options/recommendation, and non-goals. Use Product Owner when scope or acceptance is material or ambiguous; return prioritized stories, observable AC-IDs, non-functional and edge/error criteria, evidence, out-of-scope, and open decisions. Have QA review testability when criteria are needed. Skip these roles for an unambiguous narrow fix or docs-only change. Exit when scope and observable success are clear enough to implement.

## Phase 2 — Plan and design (risk-triggered)

Use Project Manager when dependencies, parallel work, milestones, or cross-team sequencing matter. Use Solution Architect for cross-boundary changes, new interfaces, migrations, non-obvious failure modes, or architectural tradeoffs. Use Security Engineer for prompts/AI healing, authentication, network exposure, persistence, filesystem, databases, secrets, CI permissions, or dependencies. Use DevOps Engineer for workflows, runtime, configuration, services, artifacts, or deployment. Each returns only its relevant decision and evidence. Plan independent tasks and path ownership before dispatching. Exit when required design and controls satisfy the ACs.

## Phase 3 — Implementation

Dispatch Developer with approved AC IDs, selected design, repository constraints, exact allowlisted paths, required verification, inputs, consumer, and effort bound. Ask for the smallest coherent change, focused tests where appropriate, diff inspection, and command/result evidence. Parallelize only independent modules with disjoint paths. Exit when implementation is complete and each AC has candidate evidence.

## Phase 4 — Independent verification

Select reviewers based on impact. QA checks AC traceability, regression/negative cases, and execution evidence when applicable; docs-only work uses the docs accuracy review path and does not require QA. Code Reviewer independently inspects the diff read-only. Security and DevOps review final changes when their triggers apply. The implementer cannot approve their own work. On a blocker, return a bounded repair task, then rerun every affected review. Any changed revision invalidates reviews of affected content; record the revision each verdict covers.

Minimum validation by impact: docs-only, links/commands and repository consistency; isolated logic, focused unit/regression checks; core framework, `npm run test:unit`, `npm run test:regression`, and relevant browser tests; browser/selector behavior, regression plus `npm run test:browser`; CI/DB/runtime, relevant local checks plus hosted GitHub Actions evidence; broad/release candidate, `npm test`, relevant scenario suites, autonomous pipeline, and CI. Preserve all required risk gates. Exit only when each applicable gate passes: QA accepts when required, review has no blocker or unresolved major finding, and required Security/DevOps verdicts are non-blocking.

## Phase 5 — Documentation and release decision

Use Technical Writer when user-facing behavior, configuration, limitations, or upgrade/release notes changed. After writing, have Code Reviewer inspect the final documentation diff for accuracy and scope; refresh any verdict affected by that revision. Always use Release Manager for `/production-cycle`, including every short path. Supply the brief/ACs, exact revision and diff, test/CI evidence, applicable QA/review/security/DevOps verdicts, final docs review, risks, and rollout/rollback plan. Record GO, CONDITIONAL GO, or NO-GO with rationale.

## Phase 6 — Human handoff

Report outcome, changed files, AC traceability, test/CI evidence, review verdicts and reviewed revision, known risks/conditions, rollout/rollback, and explicit next action. Never merge, deploy, publish, delete, rotate credentials, or accept security risk unless the human explicitly authorized that action.

## Common short paths

- Small bug: Product Owner only if ACs are unclear → Developer → applicable independent QA and Code Reviewer → Release Manager.
- Security incident: Production Director → Security triage → containment recommendation → existing or new human authorization for containment/remediation → Developer/DevOps → QA and Security retest + Code Reviewer → Release Manager. Never disclose secret values.
- Documentation-only: Technical Writer → Code Reviewer for final accuracy; Product Owner only if behavior/scope is ambiguous → Release Manager. QA is not required unless risk or acceptance criteria call for it.
- Release-only: collect required DevOps, QA, and Security evidence → Technical Writer when notes changed → Release Manager.
