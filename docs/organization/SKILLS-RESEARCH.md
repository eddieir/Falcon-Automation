# Skills research

Verified 2026-10-27 via the GitHub API (`gh api`), default branch HEAD, license field and last push. Depth: repository metadata and file trees only; SKILL.md bodies and scripts of candidates were **not** read line by line, so no candidate is cleared for install. Stars were not used to judge quality. Falcon pins Playwright `1.64.1` (`package.json`); nothing here changes it.

| Source | Pinned HEAD SHA | License (API) | Last push | Finding |
|---|---|---|---|---|
| https://github.com/microsoft/playwright-cli (latest release v0.1.22) | `b1a5903c5b633b8c9f843ad7b629c2a78437040c` | Apache-2.0 | 2026-10-19 | `skills/playwright-cli/` (SKILL.md + references). The skill drives the separate `@playwright/cli` npm tool, a new dependency not in Falcon. |
| https://github.com/anthropics/skills | `dbd4588f9e1033efb41dad4bef2f7947c8993d44` | none at repo level; per-skill `LICENSE.txt` | 2026-10-09 | `skills/skill-creator/` includes Python scripts, an HTML viewer and sub-agent prompts. |
| https://github.com/anthropics/claude-plugins-official | `41f619d61b999adec1a1c8deb97d1a5b6ac35bb6` | Apache-2.0 | 2026-10-27 | Marketplace; take single plugins only, never the marketplace. |
| https://github.com/trailofbits/skills | `196a9073ab10d35bacf111f945e02c00b2c6883a` | CC-BY-SA-4.0 | 2026-10-24 | Plugins present: differential-review, insecure-defaults, supply-chain-risk-auditor, property-based-testing, mutation-testing, agentic-actions-auditor, static-analysis, semgrep-rule-creator. differential-review also ships an agent and commands; insecure-defaults ships a JS test harness and a shell runner. Share-alike license. |
| https://github.com/vercel-labs/agent-skills | `6ec269328bc400712ee225a173a14b6b29128df7` | none reported | 2026-10-27 | Not examined beyond metadata. |
| https://github.com/obra/superpowers | `2ce8aa15d05bd57213e6f746f953aafb7ded7a8b` | MIT | 2026-10-23 | Already enabled as a user-level plugin in the CTO's environment; not vendored (would compete with `/production-cycle`). |
| https://github.com/getsentry/skills | `d12f250460ffd961f549dbebf7eeb0cf4afd4c2e` | Apache-2.0 | 2026-10-26 | Not examined beyond metadata. |
| https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03` | MIT | 2026-10-26 | Not examined beyond metadata. |
| https://code.claude.com/docs/en/skills and /sub-agents | n/a | n/a | n/a | Project skills at `.claude/skills/<name>/SKILL.md`; `skills:` agent field preloads full content; unknown fields are silently ignored. |
| https://playwright.dev/docs/getting-started-cli | not fetched | n/a | n/a | Not read in this pass. |

Not researched in this pass (no source read): CodeQL/Semgrep skills beyond the Trail of Bits names above, and additional CI/accessibility skills. They remain `DEFERRED`.
