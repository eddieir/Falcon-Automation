# Skill maintenance

- Owner: Production Director; Security Engineer reviews any third-party change.
- Updating an external skill: re-pin to a new commit only after re-running the audit in [SKILL-SECURITY-AUDIT](SKILL-SECURITY-AUDIT.md); never track a branch.
- Each skill needs a registry row, a trigger description, an applicable-roles list and a rollback (delete the directory; nothing else depends on it).
- Review the registry whenever Playwright is upgraded, a Claude Code major version changes skill/subagent fields, or quarterly.
- A skill must not duplicate or contradict `/production-cycle` or the `CLAUDE.md` routing table; conflicts are resolved in favor of those.
- Regenerate [AGENT-CATALOG](AGENT-CATALOG.md) and the matrix when an agent file changes; `npm run test:unit` flags drift against `CLAUDE.md`.
