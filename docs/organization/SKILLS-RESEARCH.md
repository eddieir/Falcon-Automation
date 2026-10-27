# Skills research

Audit date 2026-10-27, under the CTO's conditional authorization for PR #120. Upstream trees were fetched at the pinned commits into scratch directories, read, and never executed. Stars were not used as a quality signal. Falcon pins Playwright `1.64.1` (`package.json`, `package-lock.json`); the installed `node_modules` in the main checkout reports `1.64.0` (local drift; CI uses the lockfile).

| Source | Pin | License | Finding |
|---|---|---|---|
| `playwright-core@1.64.1` npm tarball (Microsoft); https://playwright.dev/docs/getting-started-cli | sha512 `BC4s8y6S...xyDQ==`, verified equal to the `package-lock.json` integrity | Apache-2.0 | Ships `lib/tools/skills/{playwright-cli,playwright-trace,playwright-component-testing}` and a built-in `playwright cli` command: version-matched to Falcon's Playwright, no new dependency |
| https://github.com/microsoft/playwright-cli | `b1a5903c5b633b8c9f843ad7b629c2a78437040c` (v0.1.22) | Apache-2.0 | Standalone `@playwright/cli` built on an alpha 1.64.0 build; not used. Its SKILL.md says to run `npm install -g @playwright/cli@latest`; the bundled copy is used instead |
| https://github.com/anthropics/skills | `dbd4588f9e1033efb41dad4bef2f7947c8993d44` | Apache-2.0 (skill-creator `LICENSE.txt`) | `skill-creator` has 7 Python scripts: `run_eval.py` and `improve_description.py` spawn nested `claude -p` sessions, `generate_review.py` starts a local HTTP server and opens a browser, `generate_report.py` loads Google Fonts |
| https://github.com/trailofbits/skills | `196a9073ab10d35bacf111f945e02c00b2c6883a` | CC-BY-SA-4.0 | differential-review v1.1.4 (markdown skill + agent + command); insecure-defaults v2.0.3 (plugin with a `Workflow` tool and parallel sweeps); supply-chain-risk-auditor v2.0.4 (stdlib Python; calls OSV, npm, PyPI, deps.dev, Scorecard, GitHub; runs `gh auth token` and sends it to api.github.com); mutation-testing needs external `mewt`/`muton`; property-based-testing needs a test library |
| https://github.com/vercel-labs/agent-skills | `6ec269328bc400712ee225a173a14b6b29128df7` | not reported | `web-design-guidelines` makes the agent WebFetch its rules from an unpinned `main` URL at run time |
| https://github.com/anthropics/claude-plugins-official | `41f619d61b999adec1a1c8deb97d1a5b6ac35bb6` | Apache-2.0 | Marketplace; not installed |
| https://github.com/obra/superpowers | `2ce8aa15d05bd57213e6f746f953aafb7ded7a8b` | MIT | Already enabled at the CTO's user level; not vendored (would compete with `/production-cycle`) |
| https://github.com/getsentry/skills `d12f250460ffd961f549dbebf7eeb0cf4afd4c2e` (Apache-2.0); https://github.com/nextlevelbuilder/ui-ux-pro-max-skill `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03` (MIT) | pins only | | Metadata only; no distinct need shown |
| https://code.claude.com/docs/en/skills and /sub-agents | n/a | n/a | A subagent with an explicit `tools` list needs `Skill` in it to load skills lazily (confirmed by a headless test: Code Reviewer reported no Skill tool, then saw all skills once `Skill` was added); the `skills:` field preloads full content and is not used |

Not researched: CodeQL/Semgrep skills (CodeQL already gates CI) and additional CI or accessibility skills.
