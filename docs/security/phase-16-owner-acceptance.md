# Phase 16 owner acceptance record

Status: **draft, awaiting the owner's confirmation.** Nothing below is accepted until the owner confirms in the PR conversation or by editing the Status column in a commit.

| Item | What remains | Why it is acceptable | Status |
|---|---|---|---|
| T13 branch trust inheritance | A developer who copies a `data/` folder by hand from one branch to another carries that branch's state with it. CI cannot do this: caches are keyed per branch, a PR run cannot write the default branch's cache, the aggregate save runs only on the default branch for non-fork runs, and `locator_memory.json` is never cached. | The risk needs local, deliberate action by someone who already has write access. Approval rules are unchanged and merge is bound to run id and commit. | Awaiting owner |
| T17 stale lock on another host | A lock written by another host (shared or network filesystem) is never reclaimed automatically. The write fails closed with `LOCK_FOREIGN_HOST` and no canonical change; an operator removes the lock after confirming its owner is gone. | Failing closed cannot lose or double-count state. The cost is an operator step, documented in `docs/phase-16-operations.md`. A lock with no `host` field falls back to the older same-host pid and grace logic. | Awaiting owner |
| CI Postgres image | The `postgres:16-alpine` service image is pinned by digest but has not been vulnerability-scanned (no scanner is in use). | The database is an ephemeral CI service with throwaway credentials and no data, used only by DB tests on the runner. | Awaiting owner |
| Historical `client.key` (BL-003) | The key remains in `main`'s git history. | The Supabase project it belonged to is fully deleted (owner statement, 2026-10-09). Use of the same certificate elsewhere is not verified. | Recorded by owner |
| Speed targets | None. The 2-worker and 4-worker thresholds are met on the fixture (2.80x, 4.15x). | See `docs/benchmarks/phase-16-parallel-benchmark.md` for what the gain consists of. | Not needed |
| GitGuardian incident 38007648 | None. | Test fixture, marked Ignored / Test credential by the owner on 2026-10-09. | Recorded by owner |
