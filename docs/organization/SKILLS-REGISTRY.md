# Skills registry

Verification date 2026-10-27. **INSTALLED** = committed under `.claude/skills/`, discovery and activation tested. **DEFERRED** = not installed, reason and follow-up given. **DESIGN** = nothing shipped. Maintenance owner: Production Director. Evidence: [SKILL-SECURITY-AUDIT](SKILL-SECURITY-AUDIT.md). Roles: [AGENT-SKILL-MATRIX](AGENT-SKILL-MATRIX.md).

## Installed and tested
| Skill | Source and pin | License | Assigned agents | Activation | Patch / rollback |
|---|---|---|---|---|---|
| `playwright-cli` | `playwright-core@1.64.1` tarball (sha512 = lockfile) | Apache-2.0 | Developer, QA, Developer Experience | Agent's `Skill` tool, lazy | Removed `allowed-tools`, added Falcon overlay. Delete the directory |
| `playwright-trace` | same tarball | Apache-2.0 | Developer, QA, Performance & Reliability | same | same |
| `differential-review` | trailofbits/skills `196a907` plugins/differential-review v1.1.4 | CC-BY-SA-4.0 (see its `UPSTREAM.md` and the root `THIRD_PARTY_NOTICES.md`) | Code Reviewer, Security Engineer | same | Removed `allowed-tools` and the nested-agent delegation, added overlay. Delete the directory |
| `advisor-governance`, `falcon-executive-decisions`, `falcon-neutral-benchmarking` | Falcon-authored | Falcon's | see matrix | coordinator or assigned agent | Delete the directory |
| `production-cycle` | Falcon-authored (existing) | Falcon's | Production Director | user runs `/production-cycle` | n/a |

Activation evidence (headless `claude -p --agent <name>` in the PR worktree): QA activated `playwright-cli` and `playwright-trace` and quoted both overlays and the absence of `allowed-tools`; Code Reviewer activated `differential-review` and quoted its overlay and "no agents" section.

## Deferred
| Skill | Exact reason | Prerequisite / follow-up |
|---|---|---|
| Anthropic `skill-creator` | Eval loop spawns nested `claude -p` sessions (breaks no-nested-agents, burns quota), runs a local server, opens a browser. Already available at user level (`anthropic-skills:skill-creator`) | Use that copy on request; vendor a scripts-free subset only if the CTO wants it |
| ToB `insecure-defaults` | Plugin form needs the `Workflow` tool and parallel sweeps (conflicts with the 2-concurrent cap) | CTO decision to install at user scope, or an inline adaptation |
| ToB `supply-chain-risk-auditor` | Reads the `gh` token and sends it to GitHub; five external services; needs Python. `npm audit` and GitHub scanning already cover Falcon | Patch out token use, approve egress, Security re-review |
| ToB `mutation-testing` | Needs external `mewt`/`muton` binaries | CTO decision on a JS mutation tool as a devDependency (separate PR) |
| ToB `property-based-testing` | No demonstrated need; no property-test library in Falcon | Decide on `fast-check` first |
| Vercel `web-design-guidelines` | Fetches instructions from an unpinned URL at run time | Vendor a pinned, reviewed copy of the guidelines |
| UI/UX Pro Max, Sentry, CodeQL/Semgrep skills | Metadata only; no distinct need shown; CodeQL already runs in CI | Reopen when a role gap is demonstrated |
| Superpowers TDD/debugging | Already at user level; vendoring would compete with `/production-cycle` | none |
| `playwright-component-testing` | Falcon does not use Playwright component testing | none |
| ToB `agentic-actions-auditor` | Not audited | Audit before any DevOps assignment |

## Design entries (nothing shipped)
`falcon-business-correctness` (after #79 lands), `falcon-self-healing-verification`, `falcon-agentic-security`, `falcon-playwright-interoperability`, `falcon-architecture-governance`, `falcon-solution-specification`, `falcon-release-readiness`, `falcon-customer-validation`.
