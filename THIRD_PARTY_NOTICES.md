# Third-party notices

Falcon's own code is licensed under the MIT License (`LICENSE`). The files below are third-party material kept in the repository under **their own** licenses; the MIT License does not relicense them, and their terms apply wherever they are copied or redistributed. This list is informational, not legal advice.

## Trail of Bits `differential-review` skill (CC BY-SA 4.0)

- Location: `.claude/skills/differential-review/` (`SKILL.md`, `methodology.md`, `adversarial.md`, `patterns.md`, `reporting.md`; `LICENSE` is the full license text; `UPSTREAM.md` is the change record).
- Creator: Trail of Bits (https://www.trailofbits.com/). Source: https://github.com/trailofbits/skills, commit `196a9073ab10d35bacf111f945e02c00b2c6883a`, `plugins/differential-review` v1.1.4. Upstream states: "This work is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License. Made by Trail of Bits." It carries no separate copyright line.
- License: Creative Commons Attribution-ShareAlike 4.0 International, https://creativecommons.org/licenses/by-sa/4.0/. The files are an adaptation and are made available under the same license (ShareAlike). The license text, including its disclaimer of warranties, is in the directory.
- Modifications (also recorded in `UPSTREAM.md`): removed the `allowed-tools` pre-approval; replaced the delegation to the `adversarial-modeler` agent with inline analysis; replaced report-file and `issue-writer` instructions with not-applicable notes; added a Falcon governance overlay paragraph. Trail of Bits did not endorse these changes.
- Not copied: plugin manifest, agent, command, `openai.yaml`, logo.

## Playwright CLI and trace skills (Apache-2.0)

- Location: `.claude/skills/playwright-cli/` and `.claude/skills/playwright-trace/` (each with `LICENSE`, `NOTICE`, `UPSTREAM.md`).
- Source: `playwright-core@1.64.1` (Copyright (c) Microsoft Corporation), the version pinned in `package-lock.json`.
- Modifications: listed in each `UPSTREAM.md` (removed pre-approved tools and unsafe examples, added a Falcon overlay).

## Open point for the human CTO

Whether keeping CC BY-SA material in a repository that is, or may become, a commercial product is acceptable (for example if the repository is packaged or redistributed) is a legal question that has not been decided or certified here. Counsel should confirm before any redistribution of the `.claude/skills/differential-review/` files. Removing that directory is the rollback.
