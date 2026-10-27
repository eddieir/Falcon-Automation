---
name: advisor-governance
description: Write and record a scoped advisory request when a decision warrants a second opinion (architecture, complex debugging, model-behavior change, security boundary). Native Claude API Advisor is not available to Claude Code subagents here, so this is the compliant fallback.
---

# Advisor governance

Policy: `docs/organization/ADVISOR-POLICY.md`. Read it for levels and cost rules; do not restate them.

## Use when
Level 1+ applies (uncertainty, repeated failures, architecture, security boundary). Skip for routine edits (Level 0).

## Inputs
The single decision, evidence paths, constraints, 2-3 options, and the level.

## Steps
1. Check the ledger for valid prior advice on the same decision and revision; reuse it.
2. Write a request of at most 150 words: question, evidence paths, options, what a good answer must cover.
3. Route it to the already-assigned specialist best placed to answer (Solution Architect or Chief Architect; the Security Engineer, who runs on Opus, only for security-boundary questions, since extra Opus use is a CTO decision), who answers at their own model, or to the CTO as a brief if Level 3 and unsupported.
4. Record in the ledger: question, answerer, level, outcome, revision.

## Output
A recommendation labeled RECOMMENDATION, never an approval.

## Safety
No recursion, no spawning agents, no external API call, no model change, no cost without CTO authorization. An unsupported required consultation is recorded as a gap and escalated, not simulated.

## Verification
The ledger entry exists and no gate (QA, Review, Security, release) cites the advice as its approval.

Roles: all; invoked by the coordinator.
