# Skill security audit

Date 2026-10-27. Scope: what was actually checked. Nothing external was installed, executed, or downloaded; only GitHub API metadata and file listings were read.

| Item | Checked | Result |
|---|---|---|
| Publisher/repo ownership | GitHub org and repo names via API | Microsoft, Anthropic, Trail of Bits, Vercel, Sentry, obra, nextlevelbuilder resolve as listed; authenticity beyond that not independently verified |
| License | API license field | ToB CC-BY-SA-4.0 (share-alike); Apache-2.0/MIT others; anthropics/skills and vercel report none at repo level |
| Install scripts / hooks | File listings | ToB insecure-defaults has `tests/harness.js` and `run_seeds.sh`; skill-creator has Python scripts; playwright-cli requires an npm tool. SKILL.md bodies and script contents **not read** |
| Network/credential/FS access, prompt-injection content | Not assessed | Unknown for all external candidates |
| Paid services | Not found in metadata | Unverified |

Verdict: no external skill meets "source-verified, security-reviewed" yet, so none is `APPROVED_FOR_PROJECT_INSTALL`. The three Falcon-authored skills contain only Markdown, run no scripts, request no tools beyond defaults, and set no hooks. Agent privilege changes: 14 new agents are read-only (several without Bash); no new write-capable agent. Recommended before any install: Security Engineer reviews the pinned tree line by line, CTO answers the license/dependency question.
