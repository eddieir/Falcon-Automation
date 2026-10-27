# Agent-to-Skill matrix

Skill profile per role. Skills load lazily: none is preloaded through the `skills:` agent field (that injects full content at startup and costs tokens), and none is needed on every task. "Installed" means committed under `.claude/skills/`; external candidates are tracked in [SKILLS-REGISTRY](SKILLS-REGISTRY.md) and are **not installed** in this change. Maintenance owner for every profile: Production Director (see [SKILL-MAINTENANCE](SKILL-MAINTENANCE.md)). Security status and pins are in the registry and security audit; no row here grants any permission.

| Agent | Core Skill capability | Installed now | Candidate (not installed; see registry) | Activation trigger |
|---|---|---|---|---|
| Chief of Staff | Executive decisions, escalation, strategic synthesis | falcon-executive-decisions, advisor-governance | none | When the task needs it; never by default |
| Product Director | Product strategy, portfolio evaluation | none | none | When the task needs it; never by default |
| Product Manager | Discovery, product metrics, customer value | none | none | When the task needs it; never by default |
| Product Owner | Acceptance criteria, backlog refinement | none | none | When the task needs it; never by default |
| Project Manager | Project planning, dependencies | none | none | When the task needs it; never by default |
| Market Competitive Intelligence | Competitive research and source verification | none | none | When the task needs it; never by default |
| Customer Validation Strategist | Customer research and commercial validation | none | none | When the task needs it; never by default |
| Technical Product Marketing | Evidence-backed technical positioning | none | none | When the task needs it; never by default |
| Chief Architect | Architecture governance, ADRs | advisor-governance | none | When the task needs it; never by default |
| Solution Architect | Technical architecture, interface design | none | none | When the task needs it; never by default |
| Solution Designer | Detailed workflows, schemas and state machines | none | none | When the task needs it; never by default |
| UX / Product Designer | User experience, accessibility, design systems | none | Vercel web-design-guidelines, UI/UX Pro Max | When the task needs it; never by default |
| Developer | JavaScript, Node.js, Playwright, TDD | none | Superpowers TDD/debugging (already in user plugins) | When the task needs it; never by default |
| AI / Agentic Systems Engineer | LLM integration, agentic safety, model evaluation | advisor-governance | none | When the task needs it; never by default |
| Developer Experience Engineer | CLI/SDK, Playwright interoperability | none | playwright-cli (Microsoft) | When the task needs it; never by default |
| Data & Analytics Engineer | Telemetry, aggregation, metric integrity | none | none | When the task needs it; never by default |
| QA Engineer | Automated test design and business correctness | none | playwright-cli, property-based-testing | When the task needs it; never by default |
| Benchmark & Evaluation Engineer | Independent benchmarks, mutation testing | falcon-neutral-benchmarking | mutation-testing (ToB) | When the task needs it; never by default |
| Code Reviewer | Differential review, secure review | none | differential-review (ToB) | When the task needs it; never by default |
| Security Engineer | Agentic security, threat modeling, supply-chain review | advisor-governance | insecure-defaults, supply-chain-risk-auditor, agentic-actions-auditor (ToB) | When the task needs it; never by default |
| Privacy & Compliance Specialist | Privacy-by-design and data governance | none | none | When the task needs it; never by default |
| DevOps Engineer | GitHub/GitLab CI, build security | none | agentic-actions-auditor (ToB) | When the task needs it; never by default |
| Performance & Reliability Engineer | Profiling, load and resilience | none | none | When the task needs it; never by default |
| Site Reliability Engineer | Operational reliability and recovery | none | none | When the task needs it; never by default |
| Production Director | Production-cycle orchestration and evidence routing | production-cycle | none | When the task needs it; never by default |
| Release Manager | Release evidence and authorization gates | none | none | When the task needs it; never by default |
| Technical Writer | Technical documentation and developer guides | none | none | When the task needs it; never by default |
