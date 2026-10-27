# Upstream, license and patch record

- Source: https://github.com/trailofbits/skills at `196a9073ab10d35bacf111f945e02c00b2c6883a`, `plugins/differential-review` v1.1.4, authored by Trail of Bits. Verified 2026-10-27.
- License: Creative Commons Attribution-ShareAlike 4.0 (`LICENSE` in this directory). The files here are an adaptation and remain under CC BY-SA 4.0; this notice is the attribution and change statement. The rest of Falcon stays under its own license.
- Copied: `SKILL.md`, `methodology.md`, `adversarial.md`, `patterns.md`, `reporting.md`. Not copied: the plugin manifest, the `adversarial-modeler` agent, the `/diff-review` command, the `openai.yaml` and the logo asset.
- Changes: removed the `allowed-tools` pre-approval (`Write`, `Bash`); replaced the delegation to the `adversarial-modeler` agent with inline analysis (nested agents are forbidden); replaced "Always write report" and the `issue-writer` references (that skill is not installed) with not-applicable notes in `SKILL.md` and `reporting.md`; added a "Falcon governance overlay" paragraph.
- Dependency: none. Markdown only.
- Update: re-pin to a new upstream commit, re-audit, re-apply the changes. Rollback: delete this directory.
