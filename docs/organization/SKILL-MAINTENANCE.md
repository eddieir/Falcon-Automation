# Skill maintenance

- Owner: Production Director; Security Engineer re-reviews any third-party change.
- Playwright skills track Falcon's pinned Playwright. On upgrade, re-extract `lib/tools/skills/` from the new `playwright-core` tarball, check its sha512 against `package-lock.json`, re-apply the patches recorded in each `UPSTREAM.md`, and re-run the audit.
- `differential-review`: re-pin to a new upstream commit only after reading the diff; keep the attribution and license files.
- Never track a branch or use `@latest`; never install an external skill globally or from a marketplace.
- Each skill needs a registry row, an `UPSTREAM.md` (external ones), a trigger description, assigned roles and a rollback (delete its directory; nothing depends on it).
- A skill must not contradict `/production-cycle` or the `CLAUDE.md` routing table; those win.
- Regenerate the catalog and matrix when an agent file changes; `npm run test:unit` flags drift against `CLAUDE.md`, missing registry rows, and any skill `scripts/` directory.
- Review the registry when Playwright or Claude Code is upgraded, and quarterly.
