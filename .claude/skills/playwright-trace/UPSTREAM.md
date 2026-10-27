# Upstream and patch record

- Source: `playwright-core@1.64.1` npm tarball, `lib/tools/skills/playwright-trace/` (Microsoft, Apache-2.0); sha512 matches Falcon's `package-lock.json` integrity entry. Verified 2026-10-27. Markdown only.
- Patch vs upstream: removed the `allowed-tools` pre-approval line; added a "Falcon governance overlay" paragraph.
- Dependency: none added. Update: re-extract from the new pinned `playwright-core` and re-apply the patches above. Rollback: delete this directory.
- Licence files: `LICENSE` (Apache-2.0) and `NOTICE` (Microsoft Corporation) copied from the same tarball.
