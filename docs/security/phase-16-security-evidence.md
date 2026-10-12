# Phase 16 security evidence

Security evidence for this phase comes from GitHub's own checks (CodeQL for JavaScript/TypeScript and Actions, GitGuardian, GitHub secret scanning) and `npm audit` in CI, plus an independent code review. Results below are for the stated heads; recheck them if the head changes.

Baseline: `main` at `d13be7f`. Final head reviewed: `0e68ce4` (hosted checks and the independent review below). Commits after it change documentation only.

## Hosted checks on 0e68ce4

| Check | Result |
|---|---|
| CodeQL, Analyze (javascript-typescript), Analyze (actions) | success |
| Open code-scanning alerts on the PR ref | 0 |
| GitHub secret scanning alerts | none open |
| GitGuardian | success (the earlier finding is ignored by the owner, see below) |
| Falcon CI: test, regression, shards 1-3, aggregate, shard-negative (run 37946476757) | success |
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

SEC-6 (head 0e68ce4): APPROVE, no P0/P1/P2. Re-ran npm audit (0 vulnerabilities, production and all), a secret scan of the 49 branch commits (no leaks), checked that workflows are unchanged since 9385e72, and reviewed the new discovery code (ParallelDiscovery.js): it opens only same-origin pages from the frontier, resolves only http(s) links, skips links with credentials or hrefs over 2048 characters, and is bounded (two hops, five candidates per page, 400 tasks, one retry, pages closed in `finally`). Two P3 notes: a URL a click lands on keeps its query string and any credentials a redirect adds (same as the sequential crawl; journal redaction not verified); clicking runs page JavaScript that can load another origin (same as the sequential crawl).

Earlier review, SEC-5 (head `9385e72`), below.

Security Engineer review of head `9385e72`: APPROVE WITH CONDITIONS, no P0 or P1. Reviewed: workflow permissions, SHA-pinned actions, cache and artifact ownership, host-aware locks, journal and artifact sanitisation, supply chain (lockfile unchanged, no new runtime dependency, Postgres image pinned by digest), path/symlink/prototype/size limits, dashboard `/emit` allow-list and authentication, and absence of committed credentials. Secrets (`OPENAI_API_KEY`) are referenced only in the sequential test job as repository secrets.
