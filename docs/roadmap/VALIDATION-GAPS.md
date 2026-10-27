# Validation gaps (G-01–G-05 and new findings)

Status: **PROPOSAL.** Issues #113–#117 are open and have no milestone as of 2026-10-27. The truth-table rule applies: a gap closes only when a test lands and its row changes status in the same change.

| Gap | Issue | Capability | Risk | Proposed milestone | Verification work | Depends on | Closure evidence |
|---|---|---|---|---|---|---|---|
| G-01 | #113 | CAP-02 Firefox/WebKit via `BrowserManager` | Medium: README implies support the CI never exercises | M2 | Smoke test launching real Firefox and WebKit; CI job or documented manual run; else README wording stays "not validated" | none (CI cost only) | Test file, CI run on the SHA, CAP-02 row changed |
| G-02 | #114 | CAP-11 PostgreSQL TLS/mTLS | Medium–High: security claim backed by config-builder tests only | M2 | TLS Postgres service in CI; test proves handshake and rejection of an untrusted certificate | CI change (DevOps) | CI run, CAP-11 row changed |
| G-03 | #115 | CAP-15 Allure content | Medium: #79 needs "reporting agrees" to be provable | **M1** (inside WP-79b) | Test reads generated Allure results and asserts fields incl. verification level | WP-79a | Test file, CAP-15 row changed |
| G-04 | #116 | CAP-19 live providers | Medium: all provider claims are mock-only | M3 | Opt-in, secret-gated checks outside the default gate; never prints keys | Owner-supplied keys, cost approval | Documented run output on a SHA; CAP-19 row changed; mock tests still not cited as live |
| G-05 | #117 | CAP-24 external accuracy | High for any competitive claim | M3 (#83) | Measure on applications the authors did not write; publish failures | #83 corpus design, M1 for the verified-repair definition | Reproducible report with raw evidence; CAP-24 row changed |

## New gaps found in this review

| ID | Finding | Evidence | Risk | Proposed home | Closure evidence |
|---|---|---|---|---|---|
| G-06 | CAP-22 "no false green" is SHIPPED while the benchmark shows 15/18 false greens in local fixtures | truth table, `d11c9e2-results.md` | High (claim accuracy) | #79 / strategy D7 (owner) | Row re-scoped, then restored when #79 lands |
| G-07 | No destructive-action guard in discovery | `grep` of `src/core` | High for #78 | WP-78a interim guard, #81 policy | Adversarial fixture refused |
| G-08 | Report cannot distinguish interaction-only passes | `ReportManager.buildReport` | High | WP-79a | Matrix N12, N13 |
| G-09 | No authenticated-run path can arm on the pinned Chromium | `phase-18-plan.md` header | High for M2, M7 | OWNER-24/25 | Owner decision recorded |
| G-10 | Assertion/approval attribution is a channel, not a person | CAP-08, CAP-12 | Medium (audit weight) | #92 | Actor-attributed records |
| G-11 | Roadmap record faults (#93/#94, `#undefined`, stale setup note) | GitHub, `FALCON-GITHUB-ROADMAP-ISSUES.md` | Low | This PR (docs), owner (#94) | Docs fixed; #94 closed by owner |

Scheduling G-03 into M1 is the only change that adds scope to M1; it is small and required for the #79 agreement test.
