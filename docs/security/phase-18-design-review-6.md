# Phase 18 Security Design Re-review 6 (SEC-07)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `28c1ebd` (architecture rev 2 plus the [rev 3](../architecture/phase-18-rev3-patch.md) to [rev 7](../architecture/phase-18-rev7-patch.md) patches; base `2572e73`). This record supersedes [re-review 5](phase-18-design-review-5.md) and covers only this revision.

**Verdict: APPROVE WITH CONDITIONS.** No P0 or P1. **Blockers: 0. Majors: 0 open** (M-11 and M-12 are closed in the design). **New minors: 5 (m-15..m-19).** One architect ruling is rejected: a missing expect flag must exit 2, not 1 (m-15). No Must criterion and no owner decision (OD-01..OD-19) is weakened. No risk is accepted here.

## Code facts verified by grep

- **The architect's healing-sink correction is right.** `src/core/AIHealer/HealingReport.js:33` sets its path to `__dirname/../../../reports/healing_logs.json`, which resolves to the repository `reports/`. `ci.yml:45-46` (`regression-reports`) and `ci.yml:342-343` (`falcon-reports`) upload `reports/`. `src/core/AIHealer/HealingTrust.js:52-53` writes `data/healing_pending.json` and `data/healing_decisions.json` directly. Rev 6 2b.1(a)(5) was misleading, and 2b.5 is needed.
- The ShardMerge seams match the citations. `COMMON` is at `ShardMerge.js:35`. The optional expect checks are at `:111-112`. The `TOTAL_UNEXPECTED`, `MIXED_TOTAL`, `DUPLICATE_SHARD`, `COMMON` and `MISSING_SHARD` checks are at `:118-126`. Receipt replay returns `r.code` unrecomputed at `:283-289`. Steps run in this order: `scenario_history :317`, `locator_store :343`, `locator_memory :350`, `run_history :384`, `healing_logs :396`, `receipt :409-410` (`v: 1`), then `cleanup :414`.
- The internal worker merge is at `Runner.js:153` (rev 7 cites `:154`, which is off by one). It passes `{input: root, expectTotal: 1}` only. `MERGE_FLAG` (`Runner.js:25`) and `parseMergeExpect` (`:47-65`) are as cited.
- **Existing merge argv refusals exit 2**, not 1 (`falcon.js:542-551`). The documented merge contract is "0/1 validated, 2 rejected input, 3 state not durable" (`falcon.js:538`).
- `configFingerprint` (`ParallelSweep.js:22-26`) hashes `entryUrl`, `maxPages`, `dedupe`, `sameOriginOnly` and `repeat`. The `merge` subcommand does not receive these values, because `MERGE_FLAG` admits only merge flags.
- The CI merge job downloads shard artifacts to `shards-in`. The state cache restores only `data/*` files (`ci.yml:443-450`). Receipts under `reports/merge/receipts/` are therefore neither restored nor uploaded from shard artifacts.

## Item status

- **M-11: CLOSED (design).** 2b.2(3)(b)-(d) apply identity checks to every bundle and set-shape checks to all shards. Only `frontierDigest` and `planDigest` are exempt. The cross-shard `COMMON_IDENTITY` equality holds even without an external expectation. Remaining conditions (both minor): m-15 (exit code) and m-16 (source of `expectConfigFp`). Verification: the extended `neg-shard-refusal-bundle` test, including its inversion.
- **M-12: CLOSED (design).** `pilot_store_check` runs before `run_history`. A mismatch writes only a `code:17` receipt, and a second merge returns 17. Remaining conditions (both minor): m-17 and m-18. Verification: the extended `neg-pilot-store-untouched` test with a second merge and its inversion.
- **M-3: CLOSED** now that M-11 is closed.
- **m-10: PARTIAL, unchanged.** The SPIKE-R record and the chunked-body test remain 18C merge conditions.
- **m-11: CLOSED (design).** The internal merge receives the in-process manifest object without re-reading it, and `PILOT_EXPECT_INCOMPLETE` guards the API boundary. Verification: `pos-pilot-worker-merge` and the AC-076 `--workers` baseline.
- **m-12: CLOSED.** All rev 7 refusal codes and the sentinel check apply in pilot mode only. Non-pilot runs keep a zero-delta AC-076 baseline across three shapes.
- **m-13: CLOSED (design).** `authContext` is mandatory per fragment. The digest, role and mode checks compare against the merge's own manifest. Verification: `neg-pilot-fragment-authcontext`.
- **m-14: CLOSED (design).** The write side exits 17, uses no fallback sink, and validates ranks before step 1. A shard that exits 17 leaves no bundle, so the merge returns `MISSING_SHARD` (2). This is acceptable because the shard job itself fails with 17 and the overall result is never 0.
- **Re-review 5 unverified item 1 (receipt replay): RESOLVED in design**, subject to m-18.
- **Re-review 5 unverified item 2 (healing sinks): CONFIRMED by grep**, and closed in design by 2b.5.

## Rulings requested by the architect

1. **Exit 1 vs 2 for a missing `--expect-run-id`/`--expect-commit`: REJECTED. It must be exit 2 (m-15).** Exit 1 is the merge's "validated, tests failed" outcome (`falcon.js:538`), and every existing merge argv refusal exits 2 (`falcon.js:546,551`). Exit 1 would make an operator error look like a legitimate failing pilot run. It would also break the existing argv convention, which AC-076 baselines. Keep "before any filesystem read". The exit code still has to be 2 there.
2. **Write a `code:17` receipt rather than none: ACCEPTED, with m-17 and m-18.** With no receipt, a replay would treat the already mutated store as a fresh baseline and could return 0 or 1. The receipt is the only durable record of the violation.
3. **Aggregate healing counters under OD-17: ADMISSIBLE, with m-19.** They are admissible only as run-level integers with a closed key set.

## New minors

- **m-15 (2b.2(3)(a); 18A).** A missing expect flag in pilot mode must return exit 2, not 1, and `PILOT_EXPECT_INCOMPLETE` already uses 2. Update the 18A test assertion from "exits 1" to "exits 2" and keep the fs-spy no-read check. Update the DOC limitations bullet to match.
- **m-16 (2b.2(3)(a); 18A/18F).** The claim that `expectConfigFp` "is always available to the merge" is wrong for the `merge` subcommand, which has no access to `entryUrl` and the other `configFingerprint` inputs. The design must name its source: either a mandatory pilot-mode `--expect-config-fp` flag or a derivation from fields pinned in the strictly loaded pilot manifest. It must never come from any bundle. The `ci.yml` merge steps (`:465`, `:534`) must pass `--pilot-manifest` and that source in pilot mode, and the m-7 static check must assert it. Verification: in pilot mode, a merge with no `expectConfigFp` source exits 2, and a mutation that reads `configFp` from shard 0 makes the foreign-`configFp` case pass, so the test must fail.
- **m-17 (2b.1(a)(4); 18F).**
  - (a) If writing the `code:17` receipt fails, the merge must still return 17, never `fail3`/3 and never a later code. The diagnostic must state that replay protection was not recorded, and this residual must be documented.
  - (b) In pilot mode the `locator_store` and `locator_memory` steps must be skipped, not run with zero events. `LocatorMemory` may write a salt header or envelope even with no events (UNVERIFIED), and that would raise a false 17 on a legitimate run. Verification: a clean pilot merge over absent and present stores yields no 17, and the three digests match.
- **m-18 (2b.1(a)(4)(e); 18F).** As written, the replay recomputation is self-consistency only, and the choice of path is keyed on the receipt's content.
  - (a) A merge in pilot mode must accept only a `v:2`, `pilot:true` receipt, and a non-pilot merge must accept only a `v:1` receipt. Otherwise an edited `v:1` receipt returns a stored 0 to a pilot merge.
  - (b) `shardCodes` must equal the exit codes declared in the freshly loaded manifests, which the matching `inputDigest` already binds. Add both cases to `neg-receipt-replay-recompute`.
- **m-19 (2b.5(3); 18A/18E).** The healing counters must meet five conditions:
  - Use a fixed, closed key set of non-negative integers, aggregated per run only (not per page, role or URL).
  - Histogram keys must come from a closed enum, never from free-text reasons or error messages.
  - Counters go to `Logger` only. They are not added to `timings.json`, whose closed schema stays as it is, and not to any bundle or report unless a closed schema is separately reviewed.
  - `pos-pilot-healing-sinks-silent` asserts the key set.
  - The four-location scan finds no selector, URL or locator-key digest.

## Unverified items

- Whether `LocatorMemory.applyMerge` writes with zero events (see m-17(b)). The design fix makes this moot if it is applied.

## Verdict per PR (blockers/majors)

- **18E: APPROVE WITH CONDITIONS (0/0).** Product implementation may start from the security side. Conditions:
  - The AC-076 baseline lands in the same PR as the `Schemas` change and covers sequential, `--workers` and three-shard runs with `v:1` receipts.
  - `neg-pilot-event-divert-sink` is included, with its inversion.
  - `timings.json` stays closed (m-19).
- **18A: APPROVE WITH CONDITIONS (0/0).** Merge requires m-15, m-16, m-19 and the OD-17-Q1 answer.
- **18B: APPROVE WITH CONDITIONS (0/0).** Unchanged.
- **18C: APPROVE WITH CONDITIONS (0/0).** Conditions: SPIKE-R and SPIKE-W evidence, and m-10.
- **18D: APPROVE WITH CONDITIONS (0/0).** Conditions: the m-5 tests and `neg-d1-lock` (e)-(i). OD-24 must be decided before any CI approve step.
- **18F: APPROVE WITH CONDITIONS (0/0).** No longer blocked. Merge requires:
  - m-16 (`ci.yml` flags and static check), m-17 and m-18
  - the m-7 static check and SPIKE-FS
  - the named 18F merge gate tests over a real three-shard run

**All blocker and major design findings are now closed** (M-3, M-11, M-12). This statement covers design findings only. It does not cover the owner items below, BLOCKER-1 in particular.

## Owner items (none accepted)

- BLOCKER-1
- OD-20, OD-21 and OD-22
- OD-23 (re-scoped)
- OD-24
- OD-17-Q1 (the design assumes no pilot healing record; the cost is no authenticated locator learning)
- Residuals:
  - Bundles and receipts are unauthenticated. An actor who can write to this run's staging directory with matching identity can turn exit 1 into 11, but never into 0. An actor with local write access to `reports/merge/receipts/` is bounded by m-18 only.
  - Exit 14 masks exit 1.
  - The merge holds no lock on `data/`, so a concurrent local writer can cause a false 17. This fails closed.
  - Losing the `code:17` receipt on a failed write loses replay protection (m-17(a)).
  - Every residual from re-review 5 carries forward.
