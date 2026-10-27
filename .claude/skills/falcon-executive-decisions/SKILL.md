---
name: falcon-executive-decisions
description: Prepare a CTO decision brief and classify a decision as DELEGATED, RECOMMENDATION, CTO_APPROVAL_REQUIRED or BLOCKED. Use for strategic or authorization-boundary questions, not routine engineering.
---

# Executive decisions

Authority map: `docs/organization/DECISION-RIGHTS.md`. The CTO is human; you recommend only.

## Use when
A decision touches spending, model/provider policy, security or privacy risk acceptance, public claims, external contact, licensing, release, agent permissions, or an installation the registry marks `NEEDS_CTO_AUTHORIZATION`.

## Inputs
The decision question, evidence from specialists (paths), deadline, and what is blocked.

## Steps
1. Classify with DECISION-RIGHTS. If `DELEGATED`, do not interrupt the CTO; state the policy that covers it.
2. Otherwise write the brief: decision, why now, options (max 3) with cost/risk/reversibility, recommendation, evidence, what happens if undecided.
3. Mark assumptions as assumptions; cite only verified sources.

## Output
A brief under 300 words plus evidence links, classification on the first line.

## Safety
Never state or imply the CTO approved something. Never contact external parties. Never fabricate figures.

## Verification
Each claim has an evidence path; classification matches DECISION-RIGHTS.

Roles: Chief of Staff; Production Director when escalating.
