# Claude Code Production House for Falcon

Twelve available specialists, activated only when needed. Each owns a distinct decision or deliverable, uses an explicit economical model, and passes evidence to the next owner through the main session. Implementation never certifies itself.

## Start a cycle

From the repository root:

```bash
claude --model sonnet --effort medium
```

```text
/production-cycle Fix the dashboard socket limiter's unbounded per-IP state while preserving authorized connections.
```

The project settings default the coordinator to Sonnet at medium effort. Check `/model`, `/effort` and `/context` before starting. Restart Claude Code if the agents directory was added after the session started. Install dependencies/browser binaries only if the selected verification needs them; documentation review does not require `npm ci` or Playwright downloads.

For a focused specialist task:

```text
Use the code-reviewer agent to review the current diff against main, restricted to the changed dashboard files and AC-01 through AC-03.
```

The main session is normally the director; do not launch a second director to repeat coordination. A standalone director session is also available with `claude --model sonnet --effort medium --agent production-director`.

## Model and ownership map

“Dedicated” means explicitly assigned per role, not twelve different model products.

| Role | Model | Turns per invocation | Exclusive responsibility | Main recipients |
|---|---|---:|---|---|
| Production Director | Sonnet | 20 | Routing, evidence ledger, conflict resolution | Selected specialists |
| Product Manager | Haiku | 8 | User problem, value and measurable outcome | Product Owner |
| Product Owner | Haiku | 8 | Scope, priority, observable AC IDs | Developer, QA, planning roles |
| Project Manager | Haiku | 8 | Dependency order, task ownership and delivery status | Director |
| Solution Architect | Sonnet | 16 | Interfaces, boundaries, failure and migration design | Developer, QA, Security, DevOps |
| Developer | Sonnet | 16 | Production implementation and focused tests | QA, Code Reviewer |
| QA Engineer | Sonnet | 16 | Independent AC verification and defect evidence | Developer, Release Manager |
| Security Engineer | Sonnet | 16 | Trust-boundary findings and security verdict | Developer, Release Manager |
| DevOps Engineer | Sonnet | 16 | CI/runtime/configuration changes and operational evidence | Developer, Release Manager |
| Code Reviewer | Sonnet | 16 | Independent read-only diff review | Developer, Release Manager |
| Technical Writer | Haiku | 8 | Documentation of verified behavior | Code Reviewer, Release Manager |
| Release Manager | Haiku | 8 | Evidence-based readiness decision | Director / human owner |

Sonnet specialists use medium effort. Haiku roles avoid elaborate reasoning for bookkeeping and bounded synthesis. No role inherits the main session model or automatically escalates to Opus/Fable. Turn limits are per invocation, not per whole cycle; continuations count toward the dispatch budget.

Aliases are used for provider compatibility; they do not pin a price or immutable model version. Check the effective mapping on your account. Explicit full model IDs can be substituted only after verifying availability and cost, while retaining the Haiku/Sonnet policy.

### Model preflight

Before launching work, check for CLI, local, user, managed or environment settings that override the intended models. In particular, inspect `CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, and configured fallback chains without printing unrelated environment variables or secrets. Remove conflicting overrides in the session configuration; never silently alter organization settings.

On Claude Code versions before 2.1.251, the subagent environment override takes precedence over the agent file. Newer versions can also force one model globally. Invocation overrides, provider alias mappings, allowlists and fallback chains can change the actual model. If the assigned model is unavailable or resolves to a premium model, stop that task and report the configuration problem. Do not pay for a premium fallback.

Project `settings.json` provides a default, not an account-level spending lock. `maxTurns` limits agent turns, not tokens or dollars. Dispatch counts, word targets and context discipline below are workflow controls. Use actual provider usage data when available; otherwise report usage as unknown. No claimed savings percentage is meaningful without measurement.

## Choose the smallest sufficient route

| Route | Typical specialist work | Total dispatch budget |
|---|---|---:|
| Fast: documentation | Writer → Reviewer → Release Manager | 4 |
| Fast: isolated bug with clear ACs | Developer → QA + Reviewer → Release Manager | 4 |
| Standard | Acceptance if missing → implementation → relevant independent checks → docs if needed → release | 8 |
| Full: cross-cutting feature/release | Discovery, scope, design/delivery, implementation, all applicable gates, docs, release | 16 |

Maximum concurrency is two. One retry per task is allowed within the total budget, including resumed tasks. A four-dispatch bug path has no spare retry: if it fails or needs extra specialists, replan explicitly. Risk decides which gates apply; budget exhaustion never waives them. Mark skipped roles `NOT NEEDED` with a reason, not `PASS`.

Examples:

- A spelling fix needs no Product Manager, Architect, QA runtime run or Security review. The reviewer still checks the actual final diff.
- A dashboard limiter fix uses the standard route if Security or architecture work is needed. QA covers pruning, authorized/unauthorized clients, lifecycle and process exit behavior; Security checks bypass and denial of service.
- Human approval of healed locators is a full route: Product Owner specifies pending/approve/reject/reuse behavior; Architect owns state transitions; Security examines poisoning and authorization; Developer changes implementation; independent checks certify the resulting diff.

## How specialists share results

The coordinator sends each consumer the relevant producer packet and evidence references. This works with ordinary project subagents; it does not require experimental agent teams or assume workers can message one another. For example, QA's reproducer goes to Developer, the corrected diff goes back to QA, and both outcomes go to Reviewer and Release Manager. Consumers acknowledge the input IDs they used and return only new findings.

The coordinator keeps a local run ledger under the Git metadata directory, resolved with:

```bash
git rev-parse --git-path production-cycle
```

Create a unique run subdirectory there, including in linked worktrees. Keep the task table, packets, evidence index and decisions outside tracked source. Only the coordinator writes the ledger; workers return packets or write explicitly assigned deliverable/log paths. It contains no secrets and is not itself shared by Git; include a concise, sanitized summary in the human handoff.

A dispatch identifies task ID, selected role/model, objective, AC IDs, base/head plus working-diff revision, allowed paths, input packet IDs/evidence, expected output, recipient, required check and remaining effort. Send excerpts and paths, not entire previous conversations or repository dumps.

Each result is at most 200 words, excluding referenced evidence files:

```text
TASK_ID: QA-02; REVISION: <head SHA + working-diff ID>
STATUS: DONE | BLOCKED | PARTIAL | NEEDS_INPUT
INPUTS: DEV-01, AC-01..03
DELTA: AC-01/02 pass; AC-03 fails on idle-client cleanup.
EVIDENCE_PATHS: <path + line or log>; <command, exit, counts, environment>
RECIPIENT: developer — fix reproduced idle-client leak; release-manager — gate blocked.
OPEN_RISKS: Idle-client leak remains; no other criteria rerun.
```

Large findings, test output or acceptance matrices belong in referenced artifacts. Do not truncate blockers to meet the word target: return a concise blocker index with complete evidence references. Read-only roles return their artifact content to the coordinator to persist rather than gaining write access.

A result is valid only for its recorded revision and environment. The coordinator fingerprints the working diff as well as HEAD, including relevant untracked files; HEAD alone misses uncommitted edits. Any subsequent implementation, test, configuration or documentation edit invalidates affected checks. Serialize overlapping writers and freeze reviewed files during checks. After the writer changes docs, review the final documentation diff before release.

## Token discipline

- Search narrowly once, then reuse the file/evidence index. Expand scope only for a concrete missing dependency.
- Load role instructions on demand. Do not preload the whole team or every artifact into every worker.
- Dispatch independent work in parallel only when it can use stable inputs and disjoint outputs.
- Keep one owner per deliverable; QA verifies behavior, Reviewer inspects correctness, Security checks threats. Share findings rather than duplicate the same sweep.
- Run the smallest relevant test first. The verifier may independently rerun a necessary check, but do not repeat unchanged full suites without a reason.
- Record dispatches, retries, actual model, status and usage when exposed. Do not invent token totals from word counts.
- At the limit, persist partial evidence and remaining work, then replan. Do not restart discovery, recurse into more agents or switch to a premium model.

## Verification and release gates

| Change | Required evidence |
|---|---|
| Documentation/configured agents | Frontmatter parsing, model/role consistency, command/link review |
| Local core logic | Focused regression and relevant unit checks |
| Selector/browser behavior | Regression and Playwright browser suite |
| Dashboard/auth/network | Unit/regression, real HTTP/socket checks, security review |
| DB/configuration | Missing-config behavior and configured PostgreSQL execution in CI |
| CI workflow | YAML/script review and actual GitHub Actions run |
| OpenAI/healing | No-key fallback, deterministic mocked path, trust/security review |
| Release candidate | Relevant scenario suites, autonomous pipeline, CI, docs and rollback |

Run agent frontmatter validation without making model calls:

```bash
claude plugin validate .claude/agents
```

This command needs Claude Code 2.1.233 or newer and checks parsing, not actual role execution or billing. Inspect that every definition has a unique name, the intended model, bounded turns and tools matching its responsibility. For a runtime smoke test, use a small docs-only cycle and inspect the actual dispatched models and packets; it consumes model usage.

QA rejects unmet Must-have criteria. Reviewer blocks unresolved blocker/major findings. Required evidence absent or stale is `UNKNOWN`; partial output is not acceptance. Release Manager cannot issue GO while a required gate is unknown, failed or stale. CONDITIONAL GO requires explicit owner-accepted, time-bounded nonblocking conditions. P0/P1 defects, unaccepted security findings and broken required CI remain NO-GO.

The final handoff includes outcome, changed files, AC evidence, independent verdicts, limitations, rollout/rollback where relevant, and the next action. Existing explicit human authorization remains valid; the workflow grants no new permission to merge, deploy, publish, delete, rotate credentials or accept security risk.

## Source references

The role files and workflow are repository policy. Claude Code mechanics were checked against the official [subagent documentation](https://code.claude.com/docs/en/sub-agents) and [model configuration documentation](https://code.claude.com/docs/en/model-config). Capabilities and precedence depend on the installed version; the screenshot's model menu is not a configuration file.
