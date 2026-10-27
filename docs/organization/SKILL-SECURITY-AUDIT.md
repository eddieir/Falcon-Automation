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

Agent review SEC-A/SEC-B of `287be8e` found no P0/P1 and these conditions, now handled: residual unsafe upstream instructions in `playwright-cli` removed or neutralized (patches 3-5 in its `UPSTREAM.md`); Apache `LICENSE` and `NOTICE` added; `.gitignore` covers `auth.json`, `*.storage.json`, `.playwright-cli/`; a `subagent-guard.js` PreToolUse hook now makes a best-effort attempt to deny subagent Bash calls that start nested `claude -p`, upload with `gh --attach`, install packages globally, or run `attach --extension/--cdp`; Bash was removed from Chief Architect, AI/Agentic, Data & Analytics and SRE; validator allowlists for Bash/Edit/Write/Skill holders, overlay presence and the lockfile pin. **Accepted residual risk (CTO to confirm):** the `Skill` tool is not scoped per skill (no per-skill allow rule exists in the project settings), so a role holding it could load any project or user-level skill; a headless test where Developer was asked to load a user-level skill ended in a prompt-level refusal, not proof of a tool-level block. The hook is defense in depth, not a sandbox: SEC-C showed that indirect forms (scripts, variables, other launchers) can evade it, and it fails open on unparseable input.

The installed directories have no hooks and no `scripts/` (the validator enforces the latter). Prompt-injection and governance-override text was looked for by reading and keyword search; none found, which is not proof of absence. The Security Engineer review of the final revision is recorded in [IMPLEMENTATION-CHECKPOINT](IMPLEMENTATION-CHECKPOINT.md).

License note for the CTO: the three `differential-review` files stay CC-BY-SA-4.0 wherever the repo is redistributed. Falcon is MIT; share-alike applies to those adapted files, not Falcon's code. Confirm this suits your commercial plans.
