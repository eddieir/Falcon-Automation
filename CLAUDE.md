# Falcon Automation — Claude Code Instructions

## Mission

Build Falcon as a trustworthy, production-grade, AI-powered Playwright test automation framework. Optimize for deterministic behavior, explainable healing, secure defaults, useful reports, and CI reliability.

## Required workflow

For any non-trivial feature, bug, or release, use the `/production-cycle` skill. Delegate by role; do not ask one agent to invent requirements, implement, and approve its own work.

1. Product Manager defines the problem, outcome, and success metrics.
2. Product Owner turns it into acceptance criteria and prioritizes scope.
3. Project Manager creates dependencies, sequencing, risks, and status.
4. Solution Architect defines boundaries and records meaningful decisions.
5. Developer implements only the approved scope.
6. QA Engineer independently designs and executes verification.
7. Security Engineer reviews trust boundaries and secrets when relevant.
8. Code Reviewer checks the diff independently.
9. DevOps Engineer verifies CI/runtime impact.
10. Release Manager makes the final evidence-based go/no-go decision.
11. Technical Writer updates user-facing and operational documentation.
12. Production Director coordinates handoffs and resolves conflicts.

Small, obvious edits may use only the relevant specialists, but never skip independent verification.

## Repository facts

- Runtime: Node.js >= 20.19; CI uses Node 24.
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
