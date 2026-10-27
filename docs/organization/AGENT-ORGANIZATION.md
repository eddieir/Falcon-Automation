# Falcon AI organization

Peyman Iravani is the human CTO and founder. There is **no AI CTO**. Agents recommend and execute delegated work; they never approve on the CTO's behalf, whatever their title.

Accountability (who is answerable) is separate from execution (who runs): all 27 roles are on-demand specialists. Nothing runs in the background, and no routine task needs more than a few of them.

| Department | Roles |
|---|---|
| Executive and strategy | Chief of Staff, Product Director, Product Manager, Product Owner, Project Manager, Market Competitive Intelligence, Customer Validation Strategist, Technical Product Marketing |
| Architecture and design | Chief Architect, Solution Architect, Solution Designer, UX / Product Designer |
| Engineering and AI | Developer, AI / Agentic Systems Engineer, Developer Experience Engineer, Data & Analytics Engineer |
| Independent quality and security | QA Engineer, Benchmark & Evaluation Engineer, Code Reviewer, Security Engineer, Privacy & Compliance Specialist |
| Platform and operations | DevOps Engineer, Performance & Reliability Engineer, Site Reliability Engineer |
| Delivery and knowledge | Production Director, Release Manager, Technical Writer |

## Reporting and coordination
- **Human CTO**: final authority (strategy, spend, model/provider policy, security and privacy risk acceptance, public claims, external contact, release, agent permissions).
- **Chief of Staff** serves the CTO: decision briefs, escalation triage, executive risk register. Not a delivery coordinator.
- **Production Director** is the single routine delivery coordinator (the main session). It routes work, owns the ledger, and enforces gates.
- **Chief Architect** sets platform-wide principles and ADRs. **Solution Architect** designs one approved capability under them. **Solution Designer** turns approved ACs plus that design into a precise specification. **UX Designer** owns operator interaction. A design that is already implementation-ready skips the next layer.
- Pairs kept separate: Product Manager (why/value) vs Product Owner (approved ACs); QA (implementation vs requirements) vs Benchmark Engineer (evaluation method and performance claims); DevOps (delivery automation) vs SRE (operational reliability).

## Escalation
Classify each decision `DELEGATED`, `RECOMMENDATION`, `CTO_APPROVAL_REQUIRED` or `BLOCKED`. Routine engineering inside approved policy is not escalated. Authority map: [DECISION-RIGHTS](DECISION-RIGHTS.md). Catalog: [AGENT-CATALOG](AGENT-CATALOG.md). Routing: [AGENT-ROUTING](AGENT-ROUTING.md).

Precedence when sources conflict: explicit CTO decision, approved security/release gates, `CLAUDE.md` governance and model routing, approved roadmap/specs, this organization design, external skills and advice.

## Change from the previous baseline
`CLAUDE.md` previously routed 12 roles (Market Competitive Intelligence existed as a 13th file without a table row). This change adds 14 roles and 15 table rows (including Market Competitive Intelligence). No existing model assignment or turn limit changed. Tool lists changed only by adding `Skill` to Developer, QA, Code Reviewer, Security Engineer, Developer Experience Engineer and Performance & Reliability Engineer (six roles) so they can load assigned skills lazily; no write or agent-spawning tool was added. Compatibility impact: none for `/production-cycle`; new roles are opt-in.
