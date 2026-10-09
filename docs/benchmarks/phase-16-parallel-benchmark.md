# Phase 16 parallel execution benchmark

Source data: `phase-16-parallel-benchmark.json`, produced by `node scripts/benchmark/parallel.js --workers=1,2,4 --runs=5 --warmup=1 --delay-ms=200 --write`. Each worker count: 1 warm-up run (discarded) and 5 measured runs, median/min/max reported. The script runs in a temporary copy, so the repository's `data/` and `reports/` are not touched.

## Results (local fixture, 200 ms page delay)

Command: `node scripts/benchmark/parallel.js --workers=1,2,4 --runs=5 --warmup=1 --delay-ms=200 --baseline-1w-ms=16450 --write`.

| Workers | End-to-end median (min/max) | End-to-end speedup | Efficiency | Analysis+execution median (min/max) | Parallel-stage speedup | Parallel-stage efficiency | Peak RSS |
|---|---|---|---|---|---|---|---|
| 1 (sequential) | 16.43 s (16.29 / 16.53) | 1.00x | 1.00 | 4.77 s (4.72 / 4.84) | 1.00x | 1.00 | 530,496 KB |
| 2 | 5.87 s (5.74 / 8.21) | 2.80x | 1.40 | 4.28 s (4.16 / 5.70) | 1.11x | 0.56 | 582,048 KB |
| 4 | 3.96 s (3.83 / 4.05) | 4.15x | 1.04 | 2.53 s (2.52 / 2.69) | 1.88x | 0.47 | 758,544 KB |

Stage medians for parallel runs (monotonic clock, `execution.timings`): 2 workers: discovery 1.11 s, analysis 1.61 s, execution 2.67 s, merge 0.06 s. 4 workers: discovery 0.85 s, analysis 0.87 s, execution 1.65 s, merge 0.06 s. Sequential discovery is 11.40 s.

## Thresholds

| Threshold | Result |
|---|---|
| 2 workers >= 1.5x end-to-end | PASS (2.80x) |
| 4 workers >= 2.3x end-to-end | PASS (4.15x) |
| 1-worker regression <= 10% | PASS against the earlier 1-worker median of 16.45 s (16.43 s now; the sequential path is unchanged apart from a refactor that shares helper code) |

## Where the speedup comes from

The end-to-end speedup is larger than the worker count (efficiency above 1 at 2 workers), so it is **not** a measure of how well pages parallelise. Most of it comes from discovery, which fell from 11.4 s to about 1 s:

- Parallel and shard runs use a different link-discovery pass (`src/core/parallel/ParallelDiscovery.js`). It runs the same two click hops and five candidates per page as the sequential crawl, but it resolves plain anchors from their `href` instead of clicking them, and it skips clicks on pages two hops away, whose results the sequential crawl discards. That removes most of the roughly 25 navigations per click the sequential crawl makes.
- The remaining part is real parallelism: with the page work alone (analysis + execution) 2 workers give 1.11x and 4 workers 1.88x, with efficiency about 0.5.
- The fixture's page set found by the new discovery equals the sequential crawl's, for 1, 2 and 4 lanes (tested). On a real site the two can differ: the new pass does not click plain anchors, so a link whose click handler sends the browser somewhere other than its `href` is resolved to the `href`; it does not open other origins; and it does not click links that open a new tab.

Before this change the end-to-end speedup was 1.04x and 1.18x and the thresholds were missed, because the serial discovery (about 11 s) dominated. That result is kept in the git history of this file.

## Equivalence

Semantic equivalence across worker counts (exit code, summary, result, sorted test name/status pairs, explored URL set): true on the fixture. Raw report files are not byte-identical (`rawReportsIdentical: false`) because parallel rows carry extra bookkeeping fields (`page`, `pageOrdinal`, `scn`, `rep`), explored-URL order differs, and parallel runs write extra files.

## Environment

Darwin 25.5.0 arm64, 10 CPUs, Node v22.19.0, headless Chromium via Playwright, local fixture server (`scripts/fixture/server.js`), no network.

## Caveat

These results are specific to this fixture and machine and do not show linear scaling. Peak RSS is the maximum sampled process-tree resident size.
