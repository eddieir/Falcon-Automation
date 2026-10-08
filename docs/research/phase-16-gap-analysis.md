# Phase 16 Gap Analysis

## Falcon today (baseline, commit d13be7f)
- Execution is strictly sequential: `falcon.js` launches one browser and one context; `SiteSweep.run` loops `queue` with `await this._sweepPage(...)`.
- Dedupe state (`_seenSignatures`) is claimed during sequential execution, so page order determines ownership; claims are released when a page fails.
- Budget is checked only between pages (`Date.now() - startedAt >= budgetMs`); an in-flight page can overrun, so it is not a hard wall-clock cap.
- Singletons write shared files: `FlakinessTracker` (`data/scenario_history.json`, `quarantine_decisions.json`), `HealingTrust` (`healing_pending.json`, `healing_decisions.json`), `LocatorStore` (`locator_store.json`), `LocatorMemory` (`locator_memory.json`), `RunLedger` (`run_history.json`), `HealingReport` (`reports/healing_logs.json`), `Logger` (`reports/execution.log`, non-atomic `appendFile`), `ReportManager` (`reports/test-report.json`), `VisualRegression` (`reports/baselines`, diffs, summary), `TestRunner` (`reports/exploratory_test_results.json`), `ErrorHandler` (`reports/*_error.json`).
- Write protection is per-process only: `AtomicJsonStore.writeJsonAtomic` gives atomic rename; stores chain promises. Two processes loading the same file and each rewriting it whole would lose the other's changes. `HealingReport._flush` writes the whole array with plain `writeFile` (not atomic).
- Sync file I/O remains in `ReportManager`, `TestRunner`.
- CLI: `--repeat` fails hard on invalid values; `--max-pages` and `--budget-ms` fall back silently. No `--workers`, `--shard`, or merge command exists.

## Gaps against the Phase 16 objective
| Gap | Needed |
|---|---|
| G1 No concurrency | Bounded page-level scheduler, default 1 |
| G2 Order-dependent dedupe | Analyse in parallel, dedupe in canonical page order |
| G3 No shard identity | Stable page ordinals, `--shard=I/N`, manifests, run identity |
| G4 Cross-process state loss | Private immutable journals, coordinator-only reconciliation (preferred design, to be confirmed in architecture) |
| G5 Single-writer report/history | One aggregate report and one history record after validated merge |
| G6 Budget semantics | Stop scheduling after deadline, bounded in-flight, name it honestly |
| G7 Dashboard assumes one stream | Coordinator-sequenced worker events, mode/shard display |
| G8 CI single job | Shard matrix plus `if: always()` aggregate job |
| G9 Non-atomic and unbounded writers | Atomic isolated writes for logs/visual artifacts, or explicit unsupported guard |
| G10 No benchmark | Local deterministic fixture, workers 1/2/4 |

## Competitor-informed gaps
- Merge validation (missing/duplicate/mixed shards) is not documented in the reviewed Playwright/Momentic pages; Falcon must define and test its own (S02–S04).
- Healing/locator state reconciliation under parallelism has no reviewed public precedent; Falcon's reducer rules are original design requiring its own proof.

## Open items before design sign-off
1. Re-open PARTIALLY VERIFIED sources (S07–S12) before any public citation.
2. Review third-party open-source Playwright shard orchestrators (UNKNOWN).
3. Independent source review, Product Manager value review, Product Owner scope approval, QA testability review (Phase 0 exit gates) — not yet done.
