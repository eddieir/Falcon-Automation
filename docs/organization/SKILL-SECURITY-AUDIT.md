# Skill security audit

Date 2026-10-27. Method: pinned upstream trees were fetched into scratch directories and read (SKILL.md, scripts, manifests). Nothing external was executed, installed globally or piped to a shell. This is an agent audit, not an independent human security review.

| Candidate | Executable code | Network / credentials | License | Verdict |
|---|---|---|---|---|
| playwright-cli, playwright-trace (from `playwright-core@1.64.1`) | None (markdown); drive the project's own `playwright` | Upstream text suggests `npm install -g ... @latest`, real-browser `attach`, cookie/`eval` commands and `gh --attach` uploads | Apache-2.0 | APPROVED_FOR_PROJECT_INSTALL with patch: pre-approval removed; overlay forbids global install, attach, cookie/storage, eval against non-fixtures and uploads |
| differential-review | None (markdown); plugin also has an agent and a command, not copied | Read-only `git`/`gh pr view`; upstream pre-approved `Write` and `Bash` | CC-BY-SA-4.0 | APPROVED_FOR_PROJECT_INSTALL with patch: pre-approval and nested-agent delegation removed; attribution and share-alike notice added |
| skill-creator | 7 Python scripts, local HTTP server, nested `claude -p` | Google Fonts; opens browser | Apache-2.0 | DEFERRED |
| insecure-defaults | JS workflow, shell test runner, parallel sweeps | none seen | CC-BY-SA-4.0 | DEFERRED |
| supply-chain-risk-auditor | Stdlib Python, `gh auth token`, `pip-audit` | Sends GitHub token to api.github.com; five external APIs | CC-BY-SA-4.0 | DEFERRED |
| mutation-testing | External binaries | n/a | CC-BY-SA-4.0 | DEFERRED |
| web-design-guidelines | None | Fetches unpinned remote instructions | not reported | DEFERRED |

Agent review SEC-A/SEC-B of `287be8e` found no P0/P1 and these conditions, now handled: residual unsafe upstream instructions in `playwright-cli` removed or neutralized (patches 3-5 in its `UPSTREAM.md`); Apache `LICENSE` and `NOTICE` added; `.gitignore` covers `auth.json`, `*.storage.json`, `.playwright-cli/`; a `subagent-guard.js` PreToolUse hook (see the table below: enforced allowlist for three roles, advisory denylist for the rest); Bash was removed from Chief Architect, AI/Agentic, Data & Analytics and SRE; validator allowlists for Bash/Edit/Write/Skill holders, overlay presence and the lockfile pin. **Accepted residual risk (CTO to confirm):** the `Skill` tool is not scoped per skill (no per-skill allow rule exists in the project settings), so a role holding it could load any project or user-level skill; a headless test where Developer was asked to load a user-level skill ended in a prompt-level refusal, not proof of a tool-level block. The hook is defense in depth, not a sandbox: SEC-C showed that indirect forms (scripts, variables, other launchers) can evade it, and it fails open on unparseable input.

## Enforcement boundaries (what is real, what is advisory)

Checked against the Claude Code docs on 2026-10-27 (permissions, hooks, sub-agents, skills pages) and by live subagent runs on 2.1.311.

| Restriction | Supported hard control | In this PR |
|---|---|---|
| Which role can run shell, write files, spawn agents, load skills | The agent's `tools` allowlist (no `Agent` in `tools` means it cannot spawn subagents) | **Enforced** by Claude Code; locked by allowlists in `AgentCatalog.check.js` |
| Model per role | `model:` front matter | **Enforced**; verified at runtime for all 27 |
| Which commands the three Bash roles may run | No per-subagent Bash rules exist. A `PreToolUse` hook in `settings.json` can key on the payload's `agent_type` | **Enforced allowlist** in `subagent-guard.js` (matched on `agent_type`; a missing `agent_type` falls back to the advisory denylist, and a plugin-namespaced one is judged by its bare name) (one simple command from a short list, deny by default; git subcommands only inside the project with no `-C`/`-c`, `--no-index`, `--contents` or output options, noting the project's own git config still applies; Playwright CLI limited to an explicit subcommand list, local http(s) URLs only, no file-writing or storage options), fail-closed (`"onFailure": "block"`, Claude Code 2.1.295+; older versions ignore the field and fail open). It is a hook, not a sandbox: it covers only calls Claude Code routes through `Bash` |
| Frontmatter hooks | Skipped until the folder is trusted and in `-p` sessions | **Not used** for security; the hook is registered in `settings.json` |
| Nested `claude -p`, `gh --attach` uploads, global installs, real-browser attach for other subagents | Permission rules are session-wide, not per subagent, and Claude Code itself says Bash deny rules are "not a security boundary" (other forms such as `sh -c` or a full path evade them) | **Advisory** denylist; a global `Bash(claude *)` deny would also stop the coordinator, so it is not added |
| Credential or secret access by an agent | `Read`/`Edit` deny rules and sandbox settings (session-wide); keep secrets out of reach | **Not enforceable by regex shell inspection**; roles without Bash cannot run shell at all; the rest relies on the allowlist and CTO review. Sandbox network/filesystem settings are a CTO option |
| Arbitrary external commands for Developer, QA, Code Reviewer, Security, DevOps, Release Manager, Solution Architect, Technical Writer, Production Director | Only Claude Code's normal permission prompts | **Pre-existing**; unchanged by this PR except the advisory denylist |
| Which skills a role can load | `Skill(name)` allow/deny rules and `disable-model-invocation`, both session-wide; there is no per-subagent skill allowlist | **Not isolated.** Holding the `Skill` tool means any skill that is not hidden may be loaded. The matrix lists *intended* skills only |

### Bash for the three new roles: rationale and limits
| Role | Real tasks that need a shell | Allowed (deny by default) | Dropped |
|---|---|---|---|
| Benchmark & Evaluation Engineer | Re-run the scorer on a manifest, diff results against a revision | `git` status/diff/log/show/rev-parse/ls-files/blame, `node scripts/benchmark/*.js`, `node tests/unit/*.check.js`, `npm run test:unit` | everything else, redirects, `node -e`, installs |
| Developer Experience Engineer | Try the CLI/Playwright flow against a local fixture, run the catalog checks | the same `git`, `node tests/unit/*.check.js`, `npm run test:unit`, `npx --no-install playwright --version` and `playwright cli` for an explicit list (open, goto, snapshot, find, click, fill, type, hover, select, check, press, navigation, tabs, resize, screenshot without `--filename`; local http(s) URLs only) | attach, eval, cookie/storage/state, upload, drag/drop, pdf, file or profile options, other node scripts, any download |
| Performance & Reliability Engineer | Run the benchmark scripts, inspect a Playwright trace | the same `git`, `node scripts/benchmark/*.js`, `node tests/unit/*.check.js`, `playwright cli` (same list) and `playwright trace actions|requests|request|console|errors|snapshot|attachments` (no `-o`/`--output`) | profiling flags, `trace screenshot|attachment`, file-writing commands; the default `cli screenshot` writes under the project's `.playwright-cli/` (gitignored). Add a specific command deliberately if needed |

Bash was removed from Chief Architect, AI/Agentic, Data & Analytics and Site Reliability Engineer, which can read code with Read/Grep/Glob. The narrowest supported restriction is this hook-based allowlist; Claude Code has no per-subagent Bash pattern rules.

Accepted residual risks (CTO to confirm): the advisory denylist is bypassable; the allowlist protects only the three roles; the `Skill` tool has no per-skill scope; fail-closed on a malformed payload would also stop the coordinator's Bash call if the harness ever sent one (it always sends valid JSON, and the failure is one blocked call, not a crash).

The installed directories have no hooks and no `scripts/` (the validator enforces the latter). Prompt-injection and governance-override text was looked for by reading and keyword search; none found, which is not proof of absence. The Security Engineer review of the final revision is recorded in [IMPLEMENTATION-CHECKPOINT](IMPLEMENTATION-CHECKPOINT.md).

License note for the CTO: the three `differential-review` files stay CC-BY-SA-4.0 wherever the repo is redistributed. Falcon is MIT; share-alike applies to those adapted files, not Falcon's code. Confirm this suits your commercial plans.
