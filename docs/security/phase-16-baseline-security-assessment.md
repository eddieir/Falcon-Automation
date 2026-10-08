# Phase 16 Baseline Security Assessment

Baseline commit: `d13be7f19c51b81735e78abff123bf57c04b5deb` (origin/main, Phase 15 merged). Date: 2026-10-08.
Checkout: clean detached worktree outside the repository, `npm ci` run, no Phase 16 changes. Raw outputs are kept outside the working tree; only hashes and sanitized summaries are recorded here.
Snyk CLI: 1.1307.4 (exact pin; npm `latest` on the date). Node v22.19.0, macOS (Darwin 25.5.0). Authentication via the `SNYK_TOKEN` environment variable only; the token was never printed, logged or passed as an argument.

## 1. Scan results

| Scan | Command | Exit | Result | Raw output SHA-256 |
|---|---|---|---|---|
| Snyk dependencies | `snyk test --all-projects --dev --severity-threshold=low --json` | 0 | Completed. 1 project (`falcon-automation`), 261 dependencies, 0 vulnerabilities | 7ea23fa2c788de2c2e14aaa6aa6700883d2a2a5570f0e1783e6a18219503c244 |
| Snyk Code | `snyk code test --severity-threshold=low --json` | 2 | **BLOCKED (operational failure).** Message: Snyk Code is not supported for the current organization. Not a clean result | c6be8ddff8243490525eb26ccb150c35050e838e30099fb04e00f5aabf41c09b |
| npm audit (production) | `npm audit --omit=dev --audit-level=high --json` | 0 | No findings at high or above | cab0eda97a3b756ca77ee3db6021856ec8c5a163e79fab55ff5d993068c75b02 |
| npm audit (all) | `npm audit --audit-level=high --json` | 0 | No findings at high or above | cab0eda97a3b756ca77ee3db6021856ec8c5a163e79fab55ff5d993068c75b02 (same bytes as production audit) |
| Snyk IaC | not run | n/a | NOT APPLICABLE: no Terraform, Kubernetes, Helm, CloudFormation, ARM or Dockerfile files found by a search of the tree. GitHub Actions YAML is not claimed as covered by Snyk IaC; workflows are reviewed separately (section 3) | n/a |
| Snyk container | `snyk container test postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea --severity-threshold=low --json` | 1 | Completed with findings: 1 unique vulnerability (reported 6 times in the output) | 60a37a9a1231f5222b23c77f0f3d0cd1945d0110a1d84b58c81a26f68d2e654a |

Container image: tag `postgres:16-alpine` (the CI service image, `.github/workflows/ci.yml`), resolved digest above on 2026-10-08, platform linux/amd64. The local Docker daemon was not running; the scan completed without it. Remediation advice for base-image upgrades was not returned in the output (UNKNOWN).

## 2. Finding register

| ID | Tool / type | Severity | Identifier | Component | Direct/transitive, prod/dev | Fixed in | Exploit maturity | Reachability / Falcon relevance | Assessment | Remediation | Owner | Blocker? | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BL-001 | Snyk container | High | SNYK-ALPINE324-ZLIB-20541555, CVE-2026-85091 (out-of-bounds write, CVSS 3.1 AV:N/AC:H) | `zlib@1.3.2-r0` in the Alpine layer of the CI Postgres service image | OS package in a CI-only service container; not shipped, not a Falcon runtime dependency | `zlib 1.3.2-r1` | Not Defined | The container runs a disposable test database in the hosted CI `test` job with throwaway credentials. Falcon does not feed untrusted compressed input to it. Exploitation path from Falcon: none identified (HYPOTHESIS, not tested) | Real image finding, low Falcon exposure. Not an exploitable-critical/high blocker under the program definition (no confirmed exploitation) | Move the service image to a rebuilt digest that includes the fix; pin by `@sha256:` (also required by AC-122). Candidate digest to be resolved and rescanned | DevOps | No (pending human confirmation) | Open; fix scheduled with the CI work (separate baseline-remediation commit) |
| BL-002 | Snyk Code | Unknown | n/a | whole repository | n/a | n/a | n/a | n/a | Not assessed: scan could not run | Enable Snyk Code for the organization (Snyk settings, owner action), then rerun | Human owner | **Yes. Missing scan means release NO-GO** | BLOCKED |

No critical findings. One high finding, assessed above; no dependency or npm-audit findings.

## 3. Additional baseline checks

| Check | Result |
|---|---|
| CodeQL on baseline commit | `Analyze (javascript-typescript)` success and `Analyze (actions)` success (GitHub check runs) |
| Hosted CI on baseline commit | `regression` and `test` success |
| GitGuardian hosted check | UNKNOWN: no status or check run is attached to the baseline commit. It reports on pull requests; to be read on the Phase 16 PR |
| Current-tree and Git-history secret scan | NOT RUN: no approved scanner (gitleaks, trufflehog) is installed. Needs the owner to approve installing one; absence is not a clean result |
| Branch protection / rulesets | Branch protection API: not protected. One active ruleset (`Eddie_main`) with `deletion` and `non_fast_forward` rules only; no required reviews or required checks. Observation for the owner |
| Existing security tests | Not yet run in this assessment; to be run in the final evidence set |
| Workflow security review | Preliminary review is in `phase-16-threat-model.md` section 7 (W-6 job-wide `OPENAI_API_KEY`, W-8 cache restore by branch prefix, W-9 mutable image tag, W-11 `|| true` on report generation). Full review pending |

## 4. Blockers before the release gate
1. BL-002: Snyk Code not enabled for the organization (owner action).
2. Secret scanning of tree and history: scanner needed.
3. GitGuardian: read the check on the PR.
4. BL-001 remediation or owner acceptance.

Risk acceptance belongs to the repository owner only.
