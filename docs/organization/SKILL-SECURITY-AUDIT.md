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

The installed directories have no hooks and no `scripts/` (the validator enforces the latter). Prompt-injection and governance-override text was looked for by reading and keyword search; none found, which is not proof of absence. The Security Engineer review of the final revision is recorded in [IMPLEMENTATION-CHECKPOINT](IMPLEMENTATION-CHECKPOINT.md).

License note for the CTO: the three `differential-review` files stay CC-BY-SA-4.0 wherever the repo is redistributed. Falcon is MIT; share-alike applies to those adapted files, not Falcon's code. Confirm this suits your commercial plans.
