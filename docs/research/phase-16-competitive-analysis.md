# Phase 16 Competitive Analysis

Companion to `phase-16-source-register.md` (IDs P16-Sxx). Review date 2026-10-08. "Not found" means not found in the reviewed public pages, not unsupported.

## What the reviewed sources establish
| Capability | Playwright runner | Momentic | Katalon TestOps | BrowserStack | mabl | Others reviewed |
|---|---|---|---|---|---|---|
| Local concurrency | Worker processes, file-level by default (S01) | `--parallel n`, one browser per test (S04) | Agent thresholds (S05) | Remote sessions (S06) | Cloud parallel with concurrency limits; local and CI Runner runs have no parallel support (S07) | testRigor, Autify, Testsigma, Virtuoso, Functionize: plan, licence or workspace limits (S08–S12) |
| Cross-machine sharding | `--shard=x/y` (S01, S02) | `--shard-count/--shard-index` (S04) | Agent distribution, not shard-indexed (S05) | Not described (S06) | Not described | Not found |
| Shard assignment rule | Files, or tests with `fullyParallel` (S02) | Not stated (S04) | Priority by agent load (S05) | — | — | Not found |
| Result merge | Blob reporter + `merge-reports` (S02, S03) | `momentic results merge` (S04) | Not stated (S05) | Dashboard (S06) | Platform-side | Not found |
| Missing-shard behaviour | Not stated (S02) | Not stated (S04) | — | — | — | Not found |
| Merge validation / determinism guarantees | Stable blob names; completeness check not stated (S03) | Not stated | Not stated | — | — | Not found |
| Isolation between parallel units | Process + context per worker (S01) | Browser per test (S04) | — | Session per run (S06) | — | Autify warns that order-dependent plans may fail in parallel (S10); Virtuoso journey order is random (S12) |
| Shared learned state (healing/locator memory) across workers | Not applicable (no healing state) | Not found | Not found | Not found | Not found | Not found |

## Reading
- Parallelism and sharding are table stakes. Falcon must not present them as differentiators.
- Playwright and Momentic document sharding and merge, but the reviewed pages do not state shard-completeness validation, duplicate-shard rejection, or deterministic merged output. That is where Falcon can set a verifiable bar, as a hypothesis to be proven by Falcon's own tests rather than a claim about competitors.
- None of the reviewed pages describe reconciling learned self-healing state (locator memory, trust decisions, quarantine) produced by parallel workers. Absence in public pages is not evidence of absence in products.
- Testing concurrency limits, queueing and plan caps (S07–S12) are commercial controls; Falcon's equivalent is a validated `--workers` bound.

## Falcon positioning allowed by evidence
Falcon may state: locally owned artifacts, strict flag validation, deterministic page ownership, coordinator-only state writes, and shard-merge validation — each backed by Falcon tests. Falcon must not claim uniqueness, superiority, or linear scaling.
