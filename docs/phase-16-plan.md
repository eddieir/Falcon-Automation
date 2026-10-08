# Phase 16 — Deterministic Parallel Execution and Safe CI Sharding

Status: planning. Branch `phase-16/parallel-execution`, base `origin/main` d13be7f (Phase 15 merged). Risk tier: full.

## 1. Objective
Run independent application pages concurrently on one machine (`--workers=N`) and split pages across CI shards (`--shard=I/N`) with a dedicated merge step, while keeping results, exit codes, page ownership, shared state and reports deterministic and auditable. Sequential execution stays the default and remains byte-compatible.

## 2. Scope
In: page-level parallelism, deterministic ordinals, shard manifests and merge validation, private state journals reconciled by one coordinator, dashboard status, CI shard matrix, local benchmark fixture, security program (GitHub code scanning and secret scanning, npm audit, secret scan of history, threat model), documentation.
Out: scenario-level parallelism, new LLM providers, internal databases, hosted control planes, trust-policy changes, unrelated refactors or dependency upgrades.

## 3. Staged pipeline
Discover once → normalize URLs → assign page ordinals → plan with bounded concurrency → return serializable analysis → dedupe in canonical page order → assign scenario ordinals → execute retained plans with bounded concurrency → merge by page/scenario/repetition ordinal → one final report.

## 4. Cross-process state (central gate)
Workers never overwrite canonical files. Each worker or shard writes private, bounded, immutable journals; one coordinator validates, deduplicates, reconciles with per-store reducers and persists atomically; journals are removed only after durable persistence. Alternatives (advisory locks, append-only log, embedded transactions, coordinator-only mutation) are compared in `docs/architecture/phase-16-parallel-execution.md` before implementation.

## 5. Delivery checkpoints (dispatch ceiling 16 each; human approval between checkpoints)
- CP1 Research and design: research docs, acceptance register, architecture, threat model, baseline security assessment.
- CP2 Implementation: planning/sharding, worker pool, fragments and merge, state journals, dashboard, CI, benchmark, security tests.
- CP3 Independent verification: QA, code review, security, DevOps, documentation review, Release Manager.

Suggested commits: research and criteria; deterministic planning/sharding; bounded parallel pages; fragments/report merge; state journals; dashboard status; sharded CI; benchmarks and failure tests; documentation.

## 6. Acceptance criteria
Registered in `docs/phase-16-acceptance-criteria.json`: `P16-AC-01`–`P16-AC-42` (functional, security controls, CI, docs, process) and `P16-AC-101`–`P16-AC-125` (security program). Rows start as `planned`; implementation and test paths are filled as work lands, and a traceability test will reject any `done` row whose paths or tests are missing.

## 7. Known constraints and decisions
- Benchmark speedup thresholds are reported as evidence on a delay-dominated fixture and do not gate CI (QA review P16-QA-1).
- Budget is a scheduling deadline with bounded in-flight work, not a hard wall-clock cap.
- The Phase 16 security gate uses the repository's GitHub security checks on the PR (code scanning, GitGuardian, secret scanning, dependency alerts) plus `npm audit` in CI. Missing or failing evidence means release NO-GO.
- Competitor statements marked PARTIALLY VERIFIED in the source register must be re-opened before any public citation.
