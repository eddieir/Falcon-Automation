# Phase 16 Baseline Security Assessment

Baseline commit: `d13be7f19c51b81735e78abff123bf57c04b5deb` (origin/main, Phase 15 merged). Date: 2026-10-08.
Checkout: clean detached worktree outside the repository, `npm ci` run, no Phase 16 changes. Raw outputs are kept outside the working tree; only hashes and sanitized summaries are recorded here.

## 1. Scan results

| Scan | Command | Exit | Result | Raw output SHA-256 |
|---|---|---|---|---|
| npm audit (production) | `npm audit --omit=dev --audit-level=high --json` | 0 | No findings at high or above | cab0eda97a3b756ca77ee3db6021856ec8c5a163e79fab55ff5d993068c75b02 |
| npm audit (all) | `npm audit --audit-level=high --json` | 0 | No findings at high or above | cab0eda97a3b756ca77ee3db6021856ec8c5a163e79fab55ff5d993068c75b02 (same bytes as production audit) |

Container image: the CI Postgres service image is pinned by digest (`postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`, resolved 2026-10-08, linux/amd64). No image vulnerability scan has been run.

## 2. Finding register

| ID | Tool / type | Severity | Identifier | Component | Direct/transitive, prod/dev | Fixed in | Exploit maturity | Reachability / Falcon relevance | Assessment | Remediation | Owner | Blocker? | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BL-003 | secret scan (history) | High (credential class) | private-key rule, two hits for `client.key` (28 lines) in commits `8d1cff4` and `ef4b32c` (2025-03-09, "update - worked on DB"), removed later by `58cd66a`; `client.crt` was added in the same commit | Git history, reachable from `origin/main` | Not in the current tree | n/a | Not applicable | The file is still retrievable from public history. Whether it is a real credential or a throwaway test key, and what it protects, is UNKNOWN (value deliberately not displayed) | Treat as compromised until the owner says otherwise (project rule). Owner to identify the key, rotate or revoke it, and decide on any history rewrite. No history rewrite or rotation is performed by the agent | Human owner | **Yes. Credential finding blocks the release gate until the owner records a disposition** | Owner decision 2026-10-08: rotate the key and certificate; no rewrite of main's history. The key material was copied to a private folder outside the repository (owner-only permissions) so it is no longer needed in Git. Rotation by the owner is pending |
| BL-004 | secret scan (history) | Low | generic-api-key, `tests/regression/p15-routes.check.cjs:27` (commit `8d42009`) and `tests/regression/p15-integration.check.cjs:64` (commit `52c7f3a`) | test files | n/a | n/a | n/a | Variable names are `SECRET_KEY` and `OPENAI_API_KEY` in regression tests that plant canary values; consistent with deliberate canaries (HYPOTHESIS, not proven) | Likely false positives | Security Engineer to confirm the values are inert canaries; if so record as false positive without a broad allowlist | Security Engineer | No, once confirmed | Open |
| BL-005 | secret scan (history) | Low | jwt rule, `tests/regression/p14-identity.check.cjs:564` (commit `dcc55cb`) | test file | n/a | n/a | n/a | An accessible-name fixture string beginning `auth:` in an identity-redaction test; consistent with a planted token-shaped fixture (HYPOTHESIS) | Likely false positive | As BL-004 | Security Engineer | No, once confirmed | Open |

No critical findings. High findings: BL-003 (historical private key, owner action).

## 3. Additional baseline checks

| Check | Result |
|---|---|
| CodeQL on baseline commit | `Analyze (javascript-typescript)` success and `Analyze (actions)` success (GitHub check runs) |
| Hosted CI on baseline commit | `regression` and `test` success |
| GitGuardian hosted check | UNKNOWN: no status or check run is attached to the baseline commit. It reports on pull requests; to be read on the Phase 16 PR |
| Current-tree secret scan | Local secret scan of the baseline checkout: exit 0, no leaks. Output SHA-256 37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570 |
| Git-history secret scan | Local secret scan of git history (redacted output), 249 commits: exit 1, 5 findings, triaged in section 2 (BL-003 to BL-005). Output SHA-256 63ca8d7161a29aa5f0f996038545cbf1233e38524a8dbaccc41d4761571464aa |
| Branch protection / rulesets | Branch protection API: not protected. One active ruleset (`Eddie_main`) with `deletion` and `non_fast_forward` rules only; no required reviews or required checks. Observation for the owner |
| Existing security tests | Not yet run in this assessment; to be run in the final evidence set |
| Workflow security review | Preliminary review is in `phase-16-threat-model.md` section 7 (W-6 job-wide `OPENAI_API_KEY`, W-8 cache restore by branch prefix, W-9 mutable image tag, W-11 `|| true` on report generation). Full review pending |

## 4. Blockers before the release gate
1. BL-003: owner disposition for the historical `client.key`.
2. GitGuardian: read the check on the PR.
3. GitHub code scanning and GitGuardian results on the final head.

Risk acceptance belongs to the repository owner only.

## Owner decisions recorded
- 2026-10-08, BL-003 (historical private key): rotate; do not rewrite main's history; keep the key material outside the repository. Until rotation is confirmed by the owner the key is treated as compromised.
- 2026-10-08, GitGuardian: the single "generic password" incident points at a log-redaction test fixture in an earlier commit of this PR; the owner will mark it as a test fixture in the GitGuardian dashboard. History of the PR branch is not rewritten.
