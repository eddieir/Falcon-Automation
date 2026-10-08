# Phase 16 operations: parallel runs, shards and merge

Status: **in review, not merged.** The behaviour below is implemented on branch `phase-16/parallel-execution`. Sequential runs (no flags) are the default and are unchanged. Hosted CI results for the Phase 16 jobs are not yet recorded.

Audience: engineers who run Falcon locally or in CI, and reviewers approving the merge.

## 1. Usage

Flags are strict. An invalid, duplicate or conflicting value exits with code 1 before the browser or dashboard starts.

| Flag | Meaning |
| --- | --- |
| `--workers=N` | Page-level parallelism, integer 1 to 16, default 1. Pages run in parallel; scenarios within one page stay sequential. |
| `--shard=I/N --run-id=<id>` | Run shard I of N (1 <= I <= N <= 64). Writes a bundle under `reports/shards/<runId>/shard-I-of-N`. Writes no report and no canonical state. `--run-id` must match `^[a-z0-9][a-z0-9-]{5,62}$` and is required with `--shard`. |
| `--single-page` | Cannot be combined with `--workers` or `--shard`. |

Run a parallel page sweep locally (replace the URL with your entry page):

```bash
node falcon.js --url=https://your-app.example --workers=2
```

Run one shard of a sharded run:

```bash
node falcon.js --url=https://your-app.example --shard=1/2 --run-id=local-run-1
node falcon.js --url=https://your-app.example --shard=2/2 --run-id=local-run-1
```

Merge the shard bundles into one report and one history record:

```bash
node falcon.js merge --input=reports/shards/local-run-1 --expect-total=2
```

`merge` takes `--input=<dir>` (required) and optionally `--expect-total=N` (1 to 64), `--expect-run-id=<id>` and `--expect-commit=<sha>`. The last two are strict: a bundle whose run id or commit differs is rejected with exit 2. CI passes both. It cannot be combined with `--workers`, `--shard` or `--run-id`.

### Merge exit codes

| Code | Meaning |
| --- | --- |
| 0 | Inputs validated and the verdict is PASSED. |
| 1 | Inputs validated, but the verdict is not PASSED (FAILED, PARTIAL or NO_TESTS_RUN). |
| 2 | Rejected input or usage (bad flags, missing or inconsistent bundles, duplicate or missing page ownership). Nothing canonical is changed. |
| 3 | State not durable: a write failed during reduction. Inputs are kept. |

### Shard exit codes

A shard exits 0 unless a verdict is `failed` or `unavailable`, or the shard hits an infrastructure error. A shard whose pages were all deduplicated exits 0. The NO_TESTS_RUN rule is applied only by the merge.

## 2. How it works

1. Ordinal 0 is the normalized entry URL. The remaining pages are sorted by URL in parallel and shard modes.
2. A shard owns every page whose ordinal `o` satisfies `(o mod N) + 1 = I`.
3. Each page task writes its events to a private journal (`journals/page-<ordinal>.json`). Page tasks never write canonical state.
4. Discovery (link harvesting and ClickExplorer) runs once and serially before any page task starts.
5. A shard writes a bundle: manifest, fragments and journals.
6. One merge validates all bundles, reconciles the journals in a fixed order, and writes one report and one run-history record.
7. A receipt is written last. If the same inputs are merged again, the merge prints the recorded outcome and exits with the recorded code.

## 3. Limitations

- Pages must be independent of each other. Parallel execution does not order page-to-page dependencies.
- `storageState` is copied in memory into each worker context. Mutations made inside one context are not synchronized with the others.
- VisualRegression is rejected under parallel mode.
- Page order can differ from a sequential run when the frontier is larger than `--max-pages`.
- If a page that owns a deduplicated scenario fails, later pages keep the scenario deduplicated, and the run fails.
- `--budget-ms` is a scheduling deadline. The deadline is checked before starting each page task in analysis and execution; a task that has already started runs to completion.
- Evidence recorded in a parallel run does not raise locator trust until a sequential run has confirmed it.

## 4. Benchmark

Measured on one machine (Darwin 25.5.0 arm64, 10 CPUs, Node v22.19.0, headless Chromium, local fixture server, no network), with a 200 ms page delay:

- 2 workers: 1.04x end-to-end speedup.
- 4 workers: 1.18x end-to-end speedup.
- Serial link discovery dominates the run time. Its serial fraction bounds end-to-end speedup at about 1.42x.
- The thresholds were missed: 2 workers needed at least 1.5x (measured 1.04x); 4 workers needed at least 2.3x (measured 1.18x).
- The results are specific to this fixture and machine. They do not show linear scaling.

Source: `docs/benchmarks/phase-16-parallel-benchmark.md`.

## 5. CI

- `.github/workflows/ci.yml` has a `shards` matrix job, an `aggregate` job, and a `shard-negative` job.
- The `aggregate` job runs with `if: always()`, downloads the shard artifacts, runs `merge --expect-total=N`, and uploads the merged report. It is the only job that saves the state cache, on main for non-fork runs, even when the merge fails. The save skips when no state file exists and is the only step allowed to fail without failing the job. Shard artifacts are named `falcon-shard-<i>-of-3-<attempt>` so a re-run does not collide, and the merge receives the expected run id and commit.
- The `shard-negative` job checks that a missing shard is rejected.
- Local runs do not exercise the matrix. CI is the authority for these jobs.

## 6. Recovery and rollback

- **Merge failed (exit 2 or 3):** fix the input or the storage problem and run the same `merge` command again. Inputs are preserved until the merge succeeds. A successful merge is idempotent.
- **Merge crashed:** re-run the same `merge` command. The receipt is written last, so reduction runs again and converges.
- **Re-running CI after a shard failure:** use "Re-run all jobs". The run id includes the attempt number and the aggregate is told to expect it, so "Re-run failed jobs" leaves the passing shards' bundles under the previous attempt and the merge rejects the set (exit 2, unexpected run id). That is the safe failure; nothing is published.
- **Mixed plan digests (`MIXED_PLANDIGEST`):** every shard analyses all pages and records a digest of the plan. If shards reach the `--budget-ms` deadline at different points during analysis, their digests differ and the merge rejects the set (exit 2). CI does not use `--budget-ms`. When using it locally, give the budget enough room for analysis, or run without it when sharding.
- **Clean up bundles:** delete `reports/shards` and `reports/merge`. Neither directory holds canonical state.
- **Return to sequential:** stop passing `--workers`, `--shard` and `--run-id`. Canonical files written by a Phase 16 run are readable by the earlier build.

## 7. Known open items

- A historical private key (`client.key`, commits `8d1cff4` and `ef4b32c`, removed in `58cd66a`) is in git history. Owner disposition pending.
- The CI Postgres service image is pinned by digest; no image vulnerability scan has been run.

Sources: `docs/architecture/phase-16-parallel-execution.md`, `docs/security/phase-16-baseline-security-assessment.md`.

## Known difference from a sequential report
A merged report matches a sequential one on test names and statuses, page statuses and coverage counts, with one gap: `coverage.linksOutOfScope` (links skipped as cross-origin or non-page) is not carried through the bundle, so the merged report does not include it. The merged report also adds `execution` and `stateMerge` blocks.
