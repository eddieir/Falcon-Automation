# Phase 18 Falcon Gap Analysis

Date: 2026-10-15. Baseline: `main` at `2572e73`. Falcon facts come from the repository; vendor facts come only from [capability-matrix.md](capability-matrix.md) and carry its evidence limits. This is a gap analysis against Falcon's own Phase 18 outcome, not a competitor comparison.

## Falcon today (repository evidence)

- Saved-plan replay and ordered journeys exist (`--save-plan`, `--plan`; docs/PHASE-PLANS.md). The plan has no digest and no approval binding.
- Healing recoveries stay pending until a person approves them in the dashboard; approval is a local click with no reviewer identity.
- `src/core/parallel/ParallelSweep.js` can capture a context's `storageState` and clone it into sweep workers. There is no user-facing import or export, no role model and no auth-loss detection.
- `src/core/parallel/ShardBundle.js` redacts error text through `Schemas.redactText`. There is no central evidence boundary across logs, reports, dashboard, screenshots, locator memory and provider prompts.
- No dry-run mode, pilot manifest, route/origin policy or deterministic destructive-action classifier exists.

## Gaps against the Phase 18 outcome

| # | Phase 18 need | Current state | Gap |
|---|---|---|---|
| G1 | Import/export `storageState`; login setup | Internal clone only | Full lifecycle missing |
| G2 | Detect login redirect, expiry, anonymous run; stable failure codes | None | Missing |
| G3 | Named roles with isolated state per worker/shard | None | Missing |
| G4 | Zero-mutation dry-run with canonical digest | Plans exist without digest | Missing |
| G5 | Versioned manifest, origin/route/action policy, fail-closed | None | Missing |
| G6 | Deterministic destructive-action detection before healing or provider use | None | Missing |
| G7 | Revision-bound protected-action approval with replay protection | Pending/approve exists for locator recoveries only | Different object; extension required |
| G8 | Secret-safe boundary across all persisted and displayed artifacts | Partial redaction in shard bundles | Largely missing |
| G9 | Hermetic authenticated fixture and end-to-end gate | None | Missing |

## What the research does and does not show

- Playwright documents the same `storageState` model Falcon will build on, including the warning that state files can carry impersonation-capable cookies and headers (S01). Falcon's design should treat that as a baseline requirement, not a differentiator.
- Reviewed vendors document secret stores and PII filtering (S03, S05). Testim's page states masking is limited to password fields (S03). This supports testing Falcon's boundary on real artifacts rather than on a redaction function alone.
- Momentic documents PR-based review of AI repairs and a mode that pushes directly (S11). Falcon's pending-until-approved model is a documented design choice, not shown to be better.
- No reviewed page documented a dry-run planning mode, a destructive-action policy or revision-bound approval. That is `NOT_FOUND_IN_REVIEWED_DOCS` for the pages read and proves nothing about those products.
- Visual and several agentic products were only partly reviewed (S20, S22–S24). Conclusions about them are not drawn.

## Out of scope for Phase 18

Enterprise SSO, SAML/OIDC, multi-tenant RBAC, compliance attestations, production-safety certification, business-outcome contracts (Phase 19), measured healing accuracy (Phase 20).
