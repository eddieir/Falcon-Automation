# Falcon Automation — Claude Code Instructions

## Mission

Build Falcon as a trustworthy, production-grade, AI-powered Playwright test automation framework. Optimize for deterministic behavior, explainable healing, secure defaults, useful reports, and CI reliability.

## Required workflow

For any non-trivial feature, bug, or release, use the `/production-cycle` skill. Delegate by role; do not ask one agent to invent requirements, implement, and approve its own work.

The main session coordinates on Sonnet 5.5 at medium effort. Invoke only specialists whose outputs are needed; the ordered phases are dependencies, not a requirement to run all 12 agents. See the skill's routing table for documentation, small bug, standard, and full cycles.

Each agent has an explicit, version-specific model ID in its front matter and a turn limit. This table is the single source of truth for routing (Phase 17 policy, set by the owner; it supersedes the earlier Haiku/Sonnet-only rule):

| Role | Model ID |
|---|---|
| Production Director (main session) | `claude-sonnet-5-5` |
| Product Manager | `claude-haiku-4-5` |
| Product Owner | `claude-haiku-5-5` |
| Project Manager | `claude-sonnet-4-6` |
| Solution Architect | `claude-opus-5` |
| Developer | `claude-sonnet-5` |
| QA Engineer | `claude-opus-4-7` |
| Code Reviewer | `claude-opus-4-8` |
| Security Engineer | `claude-opus-5-5` |
| DevOps Engineer | `claude-opus-4-6` |
| Technical Writer | `claude-haiku-4-5` |
| Release Manager | `claude-sonnet-4-6` |

Fable models are prohibited: never select, invoke, probe, or fall back to one. Never use `inherit`, aliases, extended-context variants, or a premium fallback for a role. Model reuse is limited to two low-risk pairs (Product Manager/Technical Writer, Project Manager/Release Manager); Solution Architect, Developer, QA Engineer, Code Reviewer, Security Engineer, and DevOps Engineer keep distinct models. Verify each role's effective model from runtime metadata at its first real dispatch and record it in the ledger. If a model is unsupported, remapped, or unverifiable, stop before accepting that agent's output and report the exact error; never substitute silently. Check effective session/provider overrides before dispatch. This is a routing policy, not a billing cap.

Give each task one owner, an allowed file scope, acceptance IDs, relevant evidence, a recipient, and an effort bound. The coordinator relays compact result packets between specialists and owns the run ledger; workers do not rediscover completed work or assume private peer messaging. Reuse valid evidence, share only deltas, and invalidate affected verdicts when the reviewed revision changes.

Default to two concurrent tasks with disjoint edits, at most one retry per task, and the selected cycle's dispatch budget. A partial or budget-exhausted task stays incomplete; preserve required independent verification and replan instead of silently escalating models or marking missing evidence green.

## Repository facts

- Runtime: Node.js >= 22; CI uses Node 24.
- Framework: Playwright, CommonJS JavaScript.
- Main entry point: `falcon.js`.
- Core implementation: `src/core/`.
- Dashboard: `src/dashboard/index.html`.
- Tests: `tests/unit/`, `tests/regression/`, `tests/ui/`, `tests/api/`, `tests/db/`.
- CI: `.github/workflows/ci.yml`.
- Optional configuration values in `.env.example` must be genuinely blank, not fake placeholders.
- GoogleSearchTest is local/manual only; do not add it to CI.

## Commands

```bash
npm ci
npm run test:unit
npm run test:regression
npm run test:browser
npm run test:coverage
npm test
npm run test:ui
npm run test:api
npm run test:db
npm run test:e2e
node falcon.js --no-dashboard
```

Choose the smallest sufficient verification set first, then run the full relevant gate before claiming completion. DB tests may skip locally without configuration; CI is the authority for the real PostgreSQL path.

## Engineering rules

- Use `Logger.info`, `Logger.warning`, and `Logger.error`; do not add raw `console.log` in production code.
- Prefer `fs.promises.*` over synchronous filesystem calls on hot paths.
- Use `path.join(__dirname, ...)` carefully and verify the resulting path.
- Use the OpenAI SDK, lazy initialization, and a missing-key fallback; do not add raw OpenAI HTTP calls.
- Preserve meaningful process exit codes and test them directly for CI-sensitive behavior.
- Avoid uncontrolled third-party sites in CI.
- Never expose, commit, print, or copy secrets. Treat any leaked key as compromised.
- Do not weaken tests to make a change pass.
- Every bug fix needs a regression test that fails on the broken behavior and passes on the fix.
- Keep changes scoped. Do not mix unrelated refactors into feature work.
- Do not commit generated reports, runtime state, screenshots, or credentials unless explicitly intended as fixtures.
- Commit and PR text must be human, concise, and contain no AI attribution.

## Definition of Done

A change is done only when:
- acceptance criteria are traceable to implementation and tests;
- relevant automated tests pass with commands and results recorded;
- security and operational impact are reviewed when applicable;
- documentation is synchronized;
- no unresolved P0/P1 defects remain;
- known residual risks are explicit;
- the Release Manager records GO, CONDITIONAL GO, or NO-GO.

Never claim a test, review, deployment, or GitHub Action succeeded without direct evidence.
