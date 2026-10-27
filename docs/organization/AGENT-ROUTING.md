# Agent routing

The decision router lives in `.claude/skills/production-cycle/SKILL.md` and model routing in `CLAUDE.md`; this file only maps task types to roles. Dispatch ceilings are unchanged by the larger catalog: 2 concurrent tasks, at most one retry per task, fast 4 / standard 8 / full 16 dispatches.

| Mode | Use for | Required | Optional (risk-triggered) | Output / owner |
|---|---|---|---|---|
| MICRO | Typo, read, mechanical change | Production Director alone where governance allows | none | Change; Production Director |
| STANDARD | Ordinary feature or fix | Developer, then independent QA and Code Reviewer, then Release Manager | Product Owner (ambiguous ACs), Security, DevOps, Technical Writer, Data & Analytics (metric/report schema), Developer Experience (CLI/API surface) | AC-traced evidence; Production Director |
| ARCHITECTURAL | Cross-module design | Solution Architect, Developer, QA, Code Reviewer, Release Manager | Chief Architect (platform-wide or exception), Solution Designer (spec not yet implementation-ready), UX (operator-visible), AI/Agentic (AI paths), Security, Privacy, Performance, SRE | Design/ADR then implementation; Chief Architect / Solution Architect |
| STRATEGIC | Portfolio, investment, long-term architecture | Chief of Staff, plus only the relevant advisors (Product Director, Chief Architect, Customer Validation, Market Intelligence, Benchmark) | Release Manager if a release is implied | CTO decision brief; CTO decides |

Specific triggers:
- Benchmark Engineer: performance/accuracy claims, benchmark changes, competitor comparisons; not ordinary regression tests.
- Technical Product Marketing: only after Benchmark/truth-table evidence; drafts only.
- Customer Validation and Market Intelligence: explicit scoped requests, never during routine cycles.
- Privacy: new data stored/sent, reports, traces, screenshots.
- SRE and Performance: hosted/long-running/parallel-scale changes and incident work.
- Chief of Staff is not called for ordinary source changes; Chief Architect not for every design; Solution Designer not when the architect's design is already implementation-ready.

Cost and context: share task packets (`TASK_ID, REVISION, OBJECTIVE, SCOPE, ALLOWED_PATHS, ACCEPTANCE_IDS, RELEVANT_EVIDENCE, KNOWN_CONSTRAINTS, DELIVERABLE, RECIPIENT, TURN_BUDGET`) and result packets (`TASK_ID, REVISION, STATUS, INPUTS, EVIDENCE_PATHS, DELTA, OPEN_RISKS, RECIPIENT`), not history. See [CLAUDE-PRO-EFFICIENCY](CLAUDE-PRO-EFFICIENCY.md).
