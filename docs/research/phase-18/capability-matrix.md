# Phase 18 Capability Matrix

Date: 2026-10-15. Each cell is `STATUS (source)`. A cell with `NOT_FOUND_IN_REVIEWED_DOCS` records only that the reviewed pages were silent; it must not be read as the product lacking the capability. Source IDs: [source-register.md](source-register.md). `n/r` = product not reviewed for that dimension and no source opened.

Statements in a cell are what the cited page says on 2026-10-15, not an assessment of quality or comparison to Falcon.

| Product | Saved auth state / login reuse | Multiple roles | Secret store and masking | Preview / dry-run without acting | Destructive-action policy | Approval of AI repairs | Public pricing |
|---|---|---|---|---|---|---|---|
| Playwright | VERIFIED (S01): `storageState`, setup project | VERIFIED (S01): per-role files or contexts | VERIFIED (S01): advises gitignore and deleting expired state; no built-in redaction described | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | NOT_APPLICABLE (no AI repair) | NOT_APPLICABLE (open source) |
| mabl | FETCH_BLOCKED (S02) | FETCH_BLOCKED (S02) | FETCH_BLOCKED (S02) | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | VERIFIED (S21): quote only |
| Katalon | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | VERIFIED (S05): PII regex filtering, exclusions, raw values not in reports | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | VERIFIED (S07) |
| Tricentis Testim | VERIFIED (S04): recorded login, skip-if-logged-in condition | NOT_FOUND_IN_REVIEWED_DOCS | VERIFIED (S03): Secrets Manager; masking limited to password fields | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | n/r |
| testRigor | VERIFIED (S08): suite login credentials, `login` keyword | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS (S08 silent on masking) | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | n/r |
| Momentic | NOT_FOUND_IN_REVIEWED_DOCS (S10) | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS (S10: interpolation only) | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | VERIFIED (S11): PR-based review of repairs; modes include direct push | VERIFIED (S12) |
| Healenium | NOT_APPLICABLE (library) | NOT_APPLICABLE | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS (S13) | NOT_APPLICABLE (Apache-2.0) |
| Stagehand | VERIFIED (S14): example persists session cookies locally | NOT_FOUND_IN_REVIEWED_DOCS | VERIFIED (S14): example keeps credentials out of the model via env vars | NOT_FOUND_IN_REVIEWED_DOCS (`observe` returns selectors; no documented dry-run) | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | NOT_APPLICABLE (MIT SDK; hosted tiers not reviewed) |
| Checkly | NOT_FOUND_IN_REVIEWED_DOCS (S15 index) | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | NOT_APPLICABLE | VERIFIED (S16) |
| Applitools | n/r | n/r | NOT_FOUND_IN_REVIEWED_DOCS (S20) | n/r | n/r | n/r | VERIFIED (S19) |
| Chromatic | NOT_FOUND_IN_REVIEWED_DOCS (S17) | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | n/r | n/r | n/r | VERIFIED (S18) |
| Percy | NOT_FOUND_IN_REVIEWED_DOCS (S23) | NOT_FOUND_IN_REVIEWED_DOCS | NOT_FOUND_IN_REVIEWED_DOCS | n/r | n/r | n/r | NOT_FOUND_IN_REVIEWED_DOCS (S22) |

Dimension notes:
- "Preview / dry-run" is the Phase 18 capability of proposing actions without performing them. No reviewed page documented it as a product feature. That is a statement about the reviewed pages only.
- Enterprise SSO, SAML/OIDC and tenant RBAC are `NOT_APPLICABLE` to Phase 18 (S25) and are not columns.
- Marketing statements about self-healing (S26) are `MARKETING_CLAIM` and are excluded from the matrix.
