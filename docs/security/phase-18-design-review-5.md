# Phase 18 Security Design Re-review 5 (SEC-06)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `c6dc247` (architecture rev 2 plus the [rev 3](../architecture/phase-18-rev3-patch.md), [rev 4](../architecture/phase-18-rev4-patch.md), [rev 5](../architecture/phase-18-rev5-patch.md) and [rev 6](../architecture/phase-18-rev6-patch.md) patches; base `2572e73`). This record supersedes [re-review 4](phase-18-design-review-4.md) and covers only this revision.

**Verdict for starting PR 18E: APPROVE WITH CONDITIONS.** No P0 or P1. **Blockers: 0. New majors: 2 (M-11, M-12). New minors: 4 (m-11..m-14).** **18F: BLOCK** until M-11 and M-12 are resolved in the design. No Must criterion and no owner decision (OD-01..OD-19) may be weakened. No risk is accepted here.

## Code facts verified by grep

- **The architect's m-6 correction is right.** `Args.js` matches only `--(workers|shard|run-id|input|expect-total)` and ignores any other flag ("Unrelated flags are ignored"). `Runner.js:25` `MERGE_FLAG` is the strict gate for merge flags. `Runner.parseMergeExpect` (`Runner.js:47-65`) parses `--expect-run-id` and `--expect-commit`. `--pilot-manifest` belongs in `MERGE_FLAG` and `parseMergeExpect`, so `Args.js` needs no change.
- **The architect's M-2 leak-path correction is right.** `readTimings` (`ShardMerge.js:243-261`) copies only `discoveryMs`, `analysisMs` and `executionMs`. The upload of the staged bundle directory at `ci.yml:412-416` carries `timings.json` verbatim. The direct writer is at `Runner.js:22,136`.
- `exitCodes` in `docs/phase-18-acceptance-criteria.json` map `safetyInvariant` to 17, `internalError` to 18, `identity` to 16, `planBinding` to 15, `policy` to 13, `approval` to 14, `authLoss` to 12, `authSetup` to 11, `manifest` to 10 and `planInvalid` to 2.
- AC-060 does cover shard runs ("every persisted artifact ... shard runs"). AC-022 includes the "merger refusal of excluded types (OD-17)" component.
- In `ShardMerge.merge`, step 4 (`run_history`) and step 5 (`healing_logs`, `exploratory`, `report`, `receipt`) run before cleanup. A receipt replay (`:286-290`) returns the stored code without recomputing it. The merge takes no lock on `data/`.
- In `loadManifests` (`:118-127`), the `MIXED_TOTAL`, `DUPLICATE_SHARD` and `COMMON` checks run in a single loop. `expectRunId` and `expectCommit` are optional (`:112-113`). CI passes both at `ci.yml:468`.
- `configFp` is computed from config alone (`ParallelSweep.js:81`). An exit-11 shard can therefore derive it before discovery.
- `Runner.run` with `--workers` writes a bundle under `reports/shards/<runId>/` and then calls `runMerge` internally (`Runner.js:154`) with no extra flags.

## Item status

- **M-1: CLOSED (design).** 2b.1(a) admits two event types, checks them on write and on read, runs no healing or locator reducer, and asserts the post-condition. Verification: six excluded-type journals and `neg-pilot-store-untouched`.
- **M-2: CLOSED (design).** `timings.json` becomes a closed fifth shape, written through `put`, with a writer-inventory test.
- **M-3: PARTIAL.** The refusal bundle and partition are sound, but M-11 remains.
- **M-4: CLOSED.** The rank is total, has no default, and covers every admitted code. A refusal or unranked code can never yield 0.
- **m-5: CLOSED.**
- **m-6: CLOSED.** The seam correction is verified.
- **m-7: CLOSED (design).** Verification is the 18F static check.
- **m-8: CLOSED.**
- **m-9: CLOSED.**
- **m-10: PARTIAL.** The SPIKE-R record and the chunked-body test are still outstanding, and they are 18C merge conditions.

## Rulings requested by the architect

1. **2b.3(4) anonymous-fragment narrowing: ACCEPTED with m-13.** It stays fail-closed: an anonymous page is never counted as authenticated and can never yield exit 0. Side effect: a pilot that includes any anonymous page can never exit 0. This must be documented in limitations. The per-page expected mode is deferred and is not a defect.
2. **Exit 17 for `PILOT_STORE_MUTATION`: CORRECT.** It matches the contract's `safetyInvariant` code. It is subject to M-12.
3. **Zero-sentinel digest instead of a schema change: ACCEPTED with m-12.** No real SHA-256 output can collide with the sentinel in practice. Admission is gated by declared fields, not by the sentinel.

## New majors

- **M-11 (AC-023, refusal-bundle admission; 18A/18F).** 2b.2(4) runs `COMMON` "over intact only", and the code checks `MIXED_TOTAL` and `DUPLICATE_SHARD` in the same loop. 2b.2(3) relies on "the merge's own expectations", but `--expect-run-id` and `--expect-commit` are optional. A literal implementation would therefore admit a replayed or foreign refusal bundle (from another run, commit or config) for any shard index. That bundle would hide that shard's failed rows and misattribute them as auth loss. This is still non-zero, but it is a relaxation for a non-intact bundle.
  - Fix: exempt only `frontierDigest` and `planDigest` for refusal shards. Compare `runId`, `commit` and `configFp` across all shards. Run total, index, duplicate, name and `MISSING_SHARD` checks over all shards. Make `--expect-run-id` and `--expect-commit` mandatory whenever `--pilot-manifest` is given.
  - Verify: extend `neg-shard-refusal-bundle` with a refusal bundle from another run, another commit and another `configFp` (each must exit 2), and a merge with `--pilot-manifest` but without the expect flags (argv refusal).
- **M-12 (2b.1(a)(4), exit 17 ordering; 18F).** The re-digest happens "after step 5", but step 5 already writes the report and the receipt (code 0/1), and step 4 has already appended `run_history`. A detected mutation would return 17 once. A receipt replay would then return the stored 0/1, so the safety violation turns into a pass on rerun.
  - Fix: re-digest after the last state step and before step 4. On a mismatch, write a receipt that records 17 (or no receipt at all) and no PASSED report.
  - Verify: the `neg-pilot-store-untouched` forced-mutation case followed by a second merge must return 17.

## New minors

- **m-11.** Pilot `--workers` runs merge internally (`Runner.js:154`) with no `--pilot-manifest`, so as written every pilot worker run would exit 2. The internal merge must pass the validated in-process manifest. 2b.1 must apply to every pilot bundle in every shape, not only to shards.
- **m-12.** `SENTINEL_DIGEST_NOT_ADMITTED` in a non-pilot merge changes non-pilot behaviour. That input is unreachable for honest producers. Either keep the non-pilot path byte-identical (preferred) or record this as the single intended AC-076 delta in the baseline test.
- **m-13.** A pilot merge must refuse any fragment without `authContext`, with a `pilotManifestDigest` that differs from the merge's own, or with a `roleId` that is not in the manifest. Today the schema key is optional.
- **m-14.** The design must name the shard process exit code for a write-side `BUNDLE_EXCLUDED_TYPE`; 17 is proposed. Excluded events that are diverted from the journal must be dropped, with no fallback write to `data/`. `rank()` inputs must be validated before step 3, so that a throw cannot surface as exit 3 after state writes.

## Unverified items

- Receipt-replay recomputation and the replay rank-table version. This is design only, with no code yet.
- Whether process-local pilot healing logs land under uploaded `reports/` paths. This must be confirmed in 18A under AC-060.

## Verdict per PR (blockers/majors)

- **18E: APPROVE WITH CONDITIONS (0/0).** Product implementation may start. Conditions: m-14 (write-side exit code), and the AC-076 baseline lands with the `Schemas` change.
- **18A: APPROVE WITH CONDITIONS (0/1).** Merge requires M-11, m-11, m-13, the OD-17-Q1 answer, and m-12.
- **18B: APPROVE WITH CONDITIONS (0/0).** Unchanged.
- **18C: APPROVE WITH CONDITIONS (0/0).** Conditions: SPIKE-R and SPIKE-W evidence, and m-10.
- **18D: APPROVE WITH CONDITIONS (0/0).** Conditions: the m-5 tests and `neg-d1-lock` (e)–(i). OD-24 must be decided before any CI approve step.
- **18F: BLOCK (0/2: M-11, M-12).** m-7 static check and SPIKE-FS also apply.

## Owner items (none accepted)

- BLOCKER-1
- OD-20, OD-21 and OD-22
- OD-23 (re-scoped)
- OD-24
- OD-17-Q1 (the design assumes no pilot healing record; the cost is no authenticated locator learning)
- Residuals:
  - Bundles are unauthenticated and the attestation is self-reported. A forged refusal bundle can mask 14 or 1 with 11, but never with 0.
  - Exit 14 masks exit 1.
  - The merge holds no lock on `data/`, so a concurrent local writer can cause a false 17. This fails closed.
  - Every residual from re-review 4 carries forward.
