# Skill maintenance

- Owner: Production Director; Security Engineer re-reviews any third-party change.
- Playwright skills track Falcon's pinned Playwright. Any Playwright version bump (including Dependabot) must also refresh them: `npm pack playwright-core@<version> --ignore-scripts` in a temp directory, compare its sha512 with `package-lock.json`, `diff -r` the `lib/tools/skills/` tree against the installed copy (expect only the recorded patches), then re-extract `lib/tools/skills/` from the new `playwright-core` tarball, check its sha512 against `package-lock.json`, re-apply the patches recorded in each `UPSTREAM.md`, and re-run the audit.
- `differential-review`: re-pin to a new upstream commit only after reading the diff; keep the attribution and license files.
- Never track a branch or use `@latest`; never install an external skill globally or from a marketplace.
- Each skill needs a registry row, an `UPSTREAM.md` (external ones), a trigger description, assigned roles and a rollback (delete its directory; nothing depends on it).
- A skill must not contradict `/production-cycle` or the `CLAUDE.md` routing table; those win.
- `tests/unit/AgentCatalog.check.js` fails if an external skill loses its overlay or `UPSTREAM.md`, or if the Playwright skill pin no longer matches the lockfile's `playwright-core` version.
- Regenerate the catalog and matrix when an agent file changes; `npm run test:unit` flags drift against `CLAUDE.md`, missing registry rows, and any skill `scripts/` directory.
- Review the registry when Playwright or Claude Code is upgraded, and quarterly.
