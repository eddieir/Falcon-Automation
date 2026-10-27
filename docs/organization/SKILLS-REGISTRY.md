# Skills registry

Statuses: `INSTALLED`, `CANDIDATE` (approved or conditional, not installed), `DEFERRED`, `REJECTED`, `DESIGN` (future Falcon skill, nothing shipped). Pins are upstream commits from [SKILLS-RESEARCH](SKILLS-RESEARCH.md). Verification date 2026-10-27. Maintenance owner: Production Director.

## Installed (project-local, Falcon-authored)
| Skill | Purpose | Roles | Rollback |
|---|---|---|---|
| `production-cycle` (existing) | Authoritative orchestration | Production Director | n/a |
| `advisor-governance` | Scoped advisory request and recording, fallback for the unavailable native Advisor | All; used by coordinator | delete directory |
| `falcon-executive-decisions` | CTO decision brief format and classification | Chief of Staff | delete directory |
| `falcon-neutral-benchmarking` | Checklist over the existing neutral benchmark protocol | Benchmark Engineer | delete directory |

## External candidates (none installed)
| Candidate | Status | Reason |
|---|---|---|
| Microsoft playwright-cli skill | CONDITIONAL / `NEEDS_CTO_AUTHORIZATION` | Needs the `@playwright/cli` package: a new dependency; CTO must authorize and a compatibility test against Playwright 1.64.1 is required. |
| Anthropic skill-creator | CONDITIONAL | Ships Python scripts and sub-agent prompts; needs a script review and a license check before vendoring. |
| ToB differential-review, insecure-defaults, supply-chain-risk-auditor, property-based-testing, mutation-testing, agentic-actions-auditor | `NEEDS_CTO_AUTHORIZATION` | CC-BY-SA-4.0 share-alike and attribution obligations on copied material; some bundle agents, commands or shell/JS harnesses needing review. Option: install as a plugin outside the repo instead of vendoring. |
| Vercel web-design-guidelines, UI/UX Pro Max, Sentry skills, Superpowers TDD/debugging, CodeQL/Semgrep skills | DEFERRED | Not reviewed beyond metadata; Superpowers already available at user level. |
| Entire marketplaces | REJECTED | Policy: single skills only. |

## Design entries (not shipped, no instructions pretending they exist)
`falcon-business-correctness` (after #79 lands), `falcon-self-healing-verification`, `falcon-agentic-security`, `falcon-playwright-interoperability`, `falcon-architecture-governance`, `falcon-solution-specification`, `falcon-release-readiness` (largely covered by the Release Manager agent), `falcon-customer-validation`. Create each only when a reusable procedure exists in approved Falcon behavior.
