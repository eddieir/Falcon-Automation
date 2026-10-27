# Upstream and patch record

- Source: `playwright-core@1.64.1` npm tarball, `lib/tools/skills/playwright-cli/` (Microsoft, Apache-2.0). This is the version pinned in Falcon's `package-lock.json`; the tarball sha512 (`sha512-BC4s8y6SEVA6Q1rSxZTto8hI1KUI3xXlHGZgvGqP4IqPdI/a6FX9H29IDNz7vKo9l21b6LfYosScPL6M3xxyDQ==`) was verified equal to the lockfile integrity before copying.
- Related upstream repo reviewed: microsoft/playwright-cli `b1a5903c5b633b8c9f843ad7b629c2a78437040c`.
- Verified 2026-10-27. Files are markdown only; no scripts or hooks.
- Patches vs upstream: (1) removed the `allowed-tools` pre-approval line; (2) added a "Falcon governance overlay" paragraph; (3) replaced the global-install fallback with "stop and report"; (4) removed the `attach --extension`/`--cdp` examples (SKILL.md and `references/session-management.md`), the `cookie-get` into a variable example, the PR-attachment section and `references/pr-attachments.md`, and the `gh --attach` section of `references/video-recording.md`; (5) replaced `npm init playwright@latest` in `references/test-generation.md`. Re-apply all five on every refresh.
- Dependency: none added; commands run through the project's own `playwright` (`npx --no-install playwright cli`).
- Update: re-extract from the new pinned `playwright-core`, re-apply both patches, re-run the audit. Rollback: delete this directory.
- Licence files: `LICENSE` (Apache-2.0) and `NOTICE` (Microsoft Corporation) copied from the same tarball.
