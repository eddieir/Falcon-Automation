# Phase 16 security evidence

Security evidence for this phase comes from GitHub's own checks (CodeQL for JavaScript/TypeScript and Actions, GitGuardian, GitHub secret scanning) and `npm audit` in CI, plus an independent code review. Results below are for the stated heads; recheck them if the head changes.

Baseline: `main` at `d13be7f`. Evidence recorded at head `543e78d`; not re-run on `cebd31f` (see docs/phase-16-docs-review.md, OPEN items).

## Hosted checks on 543e78d

| Check | Result |
|---|---|
| CodeQL, Analyze (javascript-typescript), Analyze (actions) | success |
| Open code-scanning alerts on the PR ref | 0 |
| GitHub secret scanning alerts | none open |
| GitGuardian | skipped (one finding, see below) |
| Falcon CI: test, regression, shards 1-3, aggregate, shard-negative (run 37935443035) | success |
| `npm audit --omit=dev --audit-level=high` | no findings |
| `github-advanced-security` | failing; a GitHub platform workflow that also fails on other PRs in this repository |

## Alerts raised during the phase and how each was classified

| Source | Finding | Classification | Disposition |
|---|---|---|---|
| CodeQL | Inefficient regular expression in Logger URL redaction (47 s on a 400 KB line) | confirmed, high | replaced by a linear scan; regression test fails on the old code |
| CodeQL | Reflected path in the test fixture server | confirmed, high | fixed |
| CodeQL | Incomplete string escaping | confirmed, high | fixed |
| CodeQL | Two backtracking regexes in `p16-gaps.check.cjs` | confirmed, high | replaced by a linear line scan; negative control kept |
| GitGuardian | Incident 38007648, "Generic Password", test string in `p16-state-io-hardening.check.cjs` (commit e25c66b) | false positive, test fixture | marked Ignored / Test credential by the owner on 2026-10-09; history not rewritten |
| History scan | `client.key` in `main` history (BL-003) | credential class | owner disposition recorded in the baseline assessment |

## Independent review

Security Engineer review of head `9385e72`: APPROVE WITH CONDITIONS, no P0 or P1. Reviewed: workflow permissions, SHA-pinned actions, cache and artifact ownership, host-aware locks, journal and artifact sanitisation, supply chain (lockfile unchanged, no new runtime dependency, Postgres image pinned by digest), path/symlink/prototype/size limits, dashboard `/emit` allow-list and authentication, and absence of committed credentials. Secrets (`OPENAI_API_KEY`) are referenced only in the sequential test job as repository secrets.
