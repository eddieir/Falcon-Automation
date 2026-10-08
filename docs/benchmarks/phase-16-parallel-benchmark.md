# Phase 16 parallel execution benchmark

Source data: `phase-16-parallel-benchmark.json`, produced by `node scripts/benchmark/parallel.js --workers=1,2,4 --runs=5 --warmup=1 --delay-ms=200 --write`. Each worker count: 1 warm-up run (discarded) and 5 measured runs, median/min/max reported. The script runs in a temporary copy, so the repository's `data/` and `reports/` are not touched.

## Results (local fixture, 200 ms page delay)

| Workers | End-to-end median (min/max) | End-to-end speedup | Efficiency | Analysis+execution median (min/max) | Parallel-stage speedup | Parallel-stage efficiency | Peak RSS |
|---|---|---|---|---|---|---|---|
| 1 | 16.45 s (16.43 / 16.59) | 1.00x | 1.00 | 4.79 s (4.76 / 4.86) | 1.00x | 1.00 | 526,544 KB |
| 2 | 15.79 s (15.74 / 15.81) | 1.04x | 0.52 | 4.12 s (4.07 / 4.17) | 1.16x | 0.58 | 542,144 KB |
| 4 | 13.99 s (13.89 / 14.09) | 1.18x | 0.29 | 2.35 s (2.28 / 2.39) | 2.04x | 0.51 | 733,360 KB |

Stage medians for parallel runs (monotonic clock, `execution.timings`): 2 workers: discovery 11.22 s, analysis 1.60 s, execution 2.52 s, merge 0.05 s. 4 workers: discovery 11.18 s, analysis 0.83 s, execution 1.52 s, merge 0.06 s.

## Thresholds

| Threshold | Result |
|---|---|
| 2 workers >= 1.5x end-to-end | MISS (1.04x) |
| 4 workers >= 2.3x end-to-end | MISS (1.18x) |
| 1-worker regression <= 10% | UNKNOWN: no `--baseline-1w-ms` was supplied, so no pre-change baseline was compared |

## Why end-to-end speedup is small

Link discovery (ClickExplorer) runs once and serially, before any worker starts, and its behaviour was deliberately not changed. At 1 worker, discovery takes about 11.40 s and analysis+execution about 4.79 s, so the serial fraction is 0.70 and Amdahl's bound on end-to-end speedup is about 1.42x regardless of worker count. The measured 4-worker result (1.18x) is below that bound because the parallel stages themselves scale at 2.04x on 4 workers (efficiency about 0.5), and browser start-up and merge add fixed cost.

The 1-worker stage split is derived from `execution.log` timestamps (first "Sweeping" line to first PageAnalyser line, then to the last log line) and is approximate. Parallel splits come from the report's `execution.timings`, which is VOLATILE and must be stripped when comparing reports.

## Equivalence

Semantic equivalence across worker counts (exit code, summary, result, sorted test name/status pairs, explored URL set): true. Raw report files are not byte-identical (`rawReportsIdentical: false`) because parallel rows carry extra bookkeeping fields (`page`, `pageOrdinal`, `scn`, `rep`), explored-URL order differs, and parallel runs write extra files.

## Environment

Darwin 25.5.0 arm64, 10 CPUs, Node v22.19.0, headless Chromium via Playwright, local fixture server (`scripts/fixture/server.js`), no network.

## Caveat

These results are specific to this fixture and machine and do not show linear scaling. Peak RSS is the maximum sampled process-tree resident size.
