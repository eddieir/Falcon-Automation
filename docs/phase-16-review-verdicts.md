# Phase 16 review verdicts

Each verdict names the head it was issued on. The code under review did not change after `0e68ce4`; later commits change documentation (and the acceptance register) only. Reviewers confirmed their verdicts on the later heads after checking that delta.

## Verdicts

| Role | Review | Head | Verdict | Findings and conditions |
|---|---|---|---|---|
| QA | QA-5 | `0e68ce4` | ACCEPT WITH CONDITIONS | 1461/1461 regression; fixture equivalence across sequential, 2 workers, 4 workers and merged shards (63 tests, 11 pages); missing shard exits 2 with no report; three mutation checks each fail a test. No defects. Conditions: (1) the release-evidence rows get verdicts recorded against the exact head; (2) the `github-advanced-security` failure is acknowledged as a pre-existing platform failure. |
| QA | QA-6 | `db38f5f` | ACCEPT WITH CONDITIONS | Verdict unchanged (docs-only delta). Carried conditions: the aggregate state-cache save can only be observed after the merge; the `github-advanced-security` (Copilot review) platform failure, which is a quota limit and not required; the unscanned CI Postgres image (owner-accepted). |
| Code Review | CR-4 | `a5bb560` | APPROVE WITH CONDITIONS | Two P2 (transient failures and the task cap were silent) and four P3. Fixed in `0e68ce4`; the three minor points that remain are recorded under CR-5. |
| Code Review | CR-5 | `0e68ce4` | APPROVE | CR-4 findings resolved. Three minor findings, recorded as known limits in `docs/phase-16-operations.md` section 7: successful retries are not reported; a URL a click lands on is not filtered for credentials or length; a retry also repeats for failures that cannot succeed. |
| Code Review | CR-6 | `db38f5f` | APPROVE | Unchanged. One doc finding (`MIXED_PLANDIGEST` should read `PLAN_DIGEST_MISMATCH`) fixed in `4693510`. |
| Security | SEC-5 | `9385e72` | APPROVE WITH CONDITIONS | No P0/P1. Conditions were owner actions (see `docs/security/phase-16-owner-acceptance.md`), now recorded. |
| Security | SEC-6 | `0e68ce4` | APPROVE | No P0/P1/P2. Two P3 notes (a click-landed URL keeps its query string; clicking runs page JavaScript that can load another origin), same as the sequential crawl. |
| Security | SEC-7 | `db38f5f` | APPROVE | Unchanged. `npm audit` 0 vulnerabilities, secret scan of the branch commits clean, 0 open code-scanning and secret-scanning alerts. |
| DevOps | OPS-4 | `0e68ce4` | READY WITH CONDITIONS | Conditions: record the platform check as non-blocking (done: GitHub Copilot monthly quota, not required); add rollback triggers and a monitoring table (done); the aggregate cache save on `main` can only be observed after the merge. |
| DevOps | OPS-5 | `db38f5f` | READY WITH CONDITIONS | Unchanged; the post-merge cache observation is the only open item. |
| Release Manager | RM-4 | `4693510` | CONDITIONAL GO | Conditions: (C1) record the QA condition text (above); (C2) the code and documentation verdicts apply to the final head through the documentation-only delta, confirmed by the reviewers; (C3) persist the verdict packets (this file). AC-42 may be closed by a register-only commit. |

## Hosted evidence

Falcon CI (test, regression, shards 1-3, aggregate, shard-negative), CodeQL, both Analyze jobs and GitGuardian are green on `db38f5f` and `4693510`. Open code-scanning and secret-scanning alerts: 0. The `github-advanced-security` check fails with `You have exceeded your monthly quota` (a GitHub Copilot quota, not a Falcon defect; not a required check).

## Post-merge verification

On the first run on `main`: all checks green; the aggregate job's "Save Falcon state" step is green; `gh cache list` shows `falcon-state-agg-main-<run id>`. If the save fails, the next run starts from an empty state (safe, loses history); open a follow-up.

## Local run of the required commands

Run on 2026-10-12 on code head `0e68ce4` (the code is unchanged since): Darwin arm64, 10 CPUs, Node v22.19.0, headless Chromium, no retries, no skips. The hosted CI job runs `npm ci` on every head; it was not repeated locally because it deletes `node_modules`.

| Command | Result | Duration |
|---|---|---|
| `npm audit --omit=dev --audit-level=high` | exit 0, 0 vulnerabilities | 1 s |
| `npm audit --audit-level=high` | exit 0, 0 vulnerabilities | 1 s |
| `npm run test:unit` | exit 0, all three unit checks passed | 5 s |
| `npm run test:browser` | exit 0, 52 passed | 39 s |
| `npm run test:coverage` | exit 0, 1461 tests pass, 0 fail, 0 skipped; all files 97.13% statements, 91.79% branches, 91.68% functions (`Runner.js` 100% statements, `ParallelDiscovery.js` 91.76%) | 184 s |
| `npm test` (regression, then browser) | exit 0, 1461 regression tests and 52 browser tests pass | 215 s |
| `node falcon.js --no-dashboard --workers=1 --url=<local fixture>` in a temporary copy of the code | exit 0, report written | 3 s |

The last command uses the local fixture rather than the default target so that no uncontrolled third-party site is contacted. Untested locally: the DB tests (they need a database and run in hosted CI), and dashboard behaviour under `--workers` or `--shard`.
