# Agent-to-Skill matrix

Skill profile per role. Skills load lazily (a role loads one only when the task needs it): none is preloaded through the `skills:` agent field (that injects full content at startup and costs tokens), and none is needed on every task. "Installed" means committed under `.claude/skills/`; external candidates are tracked in [SKILLS-REGISTRY](SKILLS-REGISTRY.md) and are **not installed** in this change. Maintenance owner for every profile: Production Director (see [SKILL-MAINTENANCE](SKILL-MAINTENANCE.md)). Security status and pins are in the registry and security audit; no row here grants any permission.

| Agent | Core Skill capability | Installed skills | Candidates (not installed) | Activation |
|---|---|---|---|---|
| Chief of Staff | Executive decisions, escalation, strategic synthesis | falcon-executive-decisions (via coordinator), advisor-governance (via coordinator) | none | Coordinator invokes and passes the guidance in the task packet |
| Product Director | Product strategy, portfolio evaluation | none | none | Coordinator invokes and passes the guidance in the task packet |
| Product Manager | Discovery, product metrics, customer value | none | none | Coordinator invokes and passes the guidance in the task packet |
| Product Owner | Acceptance criteria, backlog refinement | none | none | Coordinator invokes and passes the guidance in the task packet |
| Project Manager | Project planning, dependencies | none | none | Coordinator invokes and passes the guidance in the task packet |
| Market Competitive Intelligence | Competitive research and source verification | none | none | Coordinator invokes and passes the guidance in the task packet |
| Customer Validation Strategist | Customer research and commercial validation | none | none | Coordinator invokes and passes the guidance in the task packet |
| Technical Product Marketing | Evidence-backed technical positioning | none | none | Coordinator invokes and passes the guidance in the task packet |
| Chief Architect | Architecture governance, ADRs | advisor-governance (via coordinator) | none | Coordinator invokes and passes the guidance in the task packet |
| Solution Architect | Technical architecture, interface design | none | none | Coordinator invokes and passes the guidance in the task packet |
| Solution Designer | Detailed workflows, schemas and state machines | none | none | Coordinator invokes and passes the guidance in the task packet |
| UX / Product Designer | User experience, accessibility, design systems | none | Vercel web-design-guidelines, UI/UX Pro Max: deferred | Coordinator invokes and passes the guidance in the task packet |
| Developer | JavaScript, Node.js, Playwright, TDD | playwright-cli, playwright-trace | none | Agent invokes with its Skill tool when the task needs it |
| AI / Agentic Systems Engineer | LLM integration, agentic safety, model evaluation | advisor-governance (via coordinator) | none | Coordinator invokes and passes the guidance in the task packet |
| Developer Experience Engineer | CLI/SDK, Playwright interoperability | playwright-cli | skill-creator (Anthropic): deferred; user-level copy exists | Agent invokes with its Skill tool when the task needs it |
| Data & Analytics Engineer | Telemetry, aggregation, metric integrity | none | none | Coordinator invokes and passes the guidance in the task packet |
| QA Engineer | Automated test design and business correctness | playwright-cli, playwright-trace | property-based-testing (ToB): deferred | Agent invokes with its Skill tool when the task needs it |
| Benchmark & Evaluation Engineer | Independent benchmarks, mutation testing | falcon-neutral-benchmarking (via coordinator) | mutation-testing (ToB): deferred | Coordinator invokes and passes the guidance in the task packet |
| Code Reviewer | Differential review, secure review | differential-review | none | Agent invokes with its Skill tool when the task needs it |
| Security Engineer | Agentic security, threat modeling, supply-chain review | differential-review, advisor-governance | insecure-defaults, supply-chain-risk-auditor (ToB): deferred | Agent invokes with its Skill tool when the task needs it |
| Privacy & Compliance Specialist | Privacy-by-design and data governance | none | none | Coordinator invokes and passes the guidance in the task packet |
| DevOps Engineer | GitHub/GitLab CI, build security | none | agentic-actions-auditor (ToB): deferred, not audited | Coordinator invokes and passes the guidance in the task packet |
| Performance & Reliability Engineer | Profiling, load and resilience | playwright-trace | none | Agent invokes with its Skill tool when the task needs it |
| Site Reliability Engineer | Operational reliability and recovery | none | none | Coordinator invokes and passes the guidance in the task packet |
| Production Director | Production-cycle orchestration and evidence routing | production-cycle | none | User runs /production-cycle |
| Release Manager | Release evidence and authorization gates | none | none | Coordinator invokes and passes the guidance in the task packet |
| Technical Writer | Technical documentation and developer guides | none | none | Coordinator invokes and passes the guidance in the task packet |
