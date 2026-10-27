# Upstream, license and patch record

- Source: https://github.com/trailofbits/skills at `196a9073ab10d35bacf111f945e02c00b2c6883a`, `plugins/differential-review` v1.1.4, authored by Trail of Bits. Verified 2026-10-27.
- Creator and attribution: Trail of Bits (https://www.trailofbits.com/). Upstream text: "This work is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License. Made by Trail of Bits." No separate copyright line exists upstream.
- License: Creative Commons Attribution-ShareAlike 4.0 International (https://creativecommons.org/licenses/by-sa/4.0/; full text in `LICENSE` here, including the warranty disclaimer). These files are an adaptation and are shared under the same license (ShareAlike). Falcon's own code stays MIT; see `THIRD_PARTY_NOTICES.md` at the repository root. Trail of Bits did not endorse the changes below.
- Copied: `SKILL.md`, `methodology.md`, `adversarial.md`, `patterns.md`, `reporting.md`. Not copied: the plugin manifest, the `adversarial-modeler` agent, the `/diff-review` command, the `openai.yaml` and the logo asset.
- Changes: removed the `allowed-tools` pre-approval (`Write`, `Bash`); replaced the delegation to the `adversarial-modeler` agent with inline analysis (nested agents are forbidden); replaced "Always write report" and the "always generate the output file" lines and the `issue-writer` references (that skill is not installed) with not-applicable notes in `SKILL.md` and `reporting.md`; added a "Falcon governance overlay" paragraph.
- Dependency: none. Markdown only.
- Update: re-pin to a new upstream commit, re-audit, re-apply the changes. Rollback: delete this directory.
