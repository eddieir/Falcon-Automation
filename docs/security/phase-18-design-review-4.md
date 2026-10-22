# Phase 18 Security Design Re-review 4 (SEC-05)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `42a0c60` (architecture rev 2 plus the [rev 3](../architecture/phase-18-rev3-patch.md), [rev 4](../architecture/phase-18-rev4-patch.md) and [rev 5](../architecture/phase-18-rev5-patch.md) patches; base `2572e73`). The rev 4 shard-refusal decision is treated as void, as rev 5 states. This record supersedes [re-review 3](phase-18-design-review-3.md) and covers only this revision.

**Verdict for starting PR 18E: APPROVE WITH CONDITIONS S1–S4.** No P0 or P1. **Blockers: 0. Majors: 4 (M-1..M-4). Minors: 6 (m-5..m-10).** The SEC-04 SPIKE-W P1 candidate is retired by the preventive constructor design. **18F: BLOCK** until M-3 and M-4 are resolved in the design. No Must criterion and no owner decision (OD-01..OD-19) may be weakened. M-1 records where rev 5's healing-evidence reduction conflicts with OD-17. No risk is accepted here.

## Code facts verified by grep (`src/`, `ci.yml` and `falcon.js` are unchanged since `2572e73`)

- `Args.js:77-78`: `--shard` requires `--run-id`, and `--run-id` without `--shard` is refused. `ShardBundle.put` is at `:79`, `ShardMerge.COMMON` at `:35`, the closed manifest key set at `Schemas.js:167`, and `exit.code` 0..3 at `Schemas.js:207`. Rev 5's line citations are correct.
- **`ShardBundle.put` is not the only bundle writer.** `Runner.js:22,136` writes `timings.json` into the bundle directory with a direct `SafeFs.writeAtomicPrivate`, and `ShardMerge.js:252` reads it without a closed schema.
- **Journals transport the types OD-17 excludes.** `Schemas.js:14-17,296-330` admits `healing.pending/tier3/log`, `locatorStore.use` and `locatorMemory.evidence/candidate`, which carry selectors, descriptions and element identity or signature objects. `ShardMerge.js:325-354` applies them to `healing_pending.json`, `locator_store.json` and `locator_memory.json`. `ci.yml:475-493` caches `healing_pending.json` on main.
- **Each shard discovers its frontier independently** (`ParallelSweep.js:73-80`). `frontierDigest` and `planDigest` are in `COMMON`, and `buildPageTable` refuses an assigned page that has no fragment (`ShardMerge.js:148-149`).
- `ShardMerge` today derives its exit code only from `report.result` (`:381`). Shard manifest exit codes are not aggregated.
- AC text (`docs/phase-18-acceptance-criteria.json`): AC-021 covers worker mode only; AC-051 does not mention shards; AC-073 is loopback-only egress; AC-077 is the npm-script/CI wiring.
- The patches contain no CJK characters.

## Answers

- **(i) Rule 5 is sound.** It satisfies D-3: no claim is made and no token is admitted. It satisfies D-1: no store, lock or ledger is used in a shard. It weakens no Must criterion, because AC-021 and AC-051 do not cover shards. It is the narrowest restriction that needs no new trust mechanism. A narrower option exists: pin protected steps to one shard with its own local root and token. That option has the same trust as Shape-1 CI self-approval, so it only matters if OD-24 is "yes". This is an owner scope item, not a defect. Rationale (iii) applies equally to Shape-1 CI, and the rev 5 text should say so.
- **(ii) Rules 1–3 do not yet close AC-022 or AC-067 structurally.** M-1 and M-2 remain open. Identity limited to `{roleId, pilotManifestDigest}` is sound.
- **(iii) The precedence order 2>3>12>11>14>1>0 is sound but not total (M-4).** The additive schema change fails closed on an older build: `pilot` triggers `MANIFEST_UNKNOWN_KEY`, and a code above 3 is out of range, so the result is exit 2. Two conditions apply: `pilot` must be required on every pilot manifest, and a code of 10 or above without `pilot` must be refused in both modes.
- **(iv)** See "SEC-04 item status" below.
- **(v)** Rev 4 and rev 5 introduce M-1..M-4 and m-5..m-9. m-10 carries over SEC-04 N-3.

## Majors

- **M-1 (AC-022, OD-17; 18A/18E).** Rule 3(d) checks only file names, manifest keys and excluded *keys*. A pilot bundle can still carry locator-memory and healing events through journals, and the merge applies and caches them. Rule 3(b)'s reduced `{strategyId, outcome, locatorKeyDigest}` record is healing evidence that OD-17 excludes. Fix: pilot journals admit only `flakiness.outcome` and `task.end`. A pilot merge refuses every other event type (`BUNDLE_EXCLUDED_TYPE`) and runs no healing or locator reducer. Drop the reduced record unless the owner amends OD-17. Verify: `neg-shard-bundle-allowlist` gains one journal per excluded type; each is refused, and the stores stay byte-unchanged.
- **M-2 (rules 2–3, AC-067).** `timings.json` breaks both the "sole writer" claim and the "exactly four shapes" claim. As written, every pilot merge would return `BUNDLE_UNEXPECTED_FILE` (exit 2). Alternatively an implementer allowlists the file unscanned, and it is uploaded at `ci.yml:412-416`. Fix: write it through `put` (`settle` then `assertClean`) with a closed schema of three numbers, validated at write and at merge, as the fifth allowlisted shape. Verify: the writer-inventory test covers `Runner.js`, and a canary in `timings.json` is refused.
- **M-3 (rule 6, AC-023).** A shard that exits 11 before or during discovery cannot match the other shards' `frontierDigest`, `planDigest` or page table. A "zero-fragment" bundle also fails `FRAGMENT_MISSING`. The merge therefore returns exit 2 and loses the loss attribution. That fails closed but does not meet AC-023, and it invites relaxing `COMMON`. Fix: specify an explicit refusal-bundle shape that a merge admits only in pilot mode, only with exit 11 or 12, and only with a valid attestation. Take the page table from the agreeing shards only, mark the lost shard's `shardOf` pages as lost, and never relax any check for a non-refusal bundle.
- **M-4 (precedence).** The schema widens codes to 10..18, but the precedence ranks only 2, 3, 12, 11, 14, 1 and 0. Codes 10, 13 and 15–18 are undefined, and an implementation could let them fall through to 0. Shard-declared codes are also not cross-checked. Fix: admit only {0,1,11,12,14} in pilot manifests and refuse anything else with exit 2. Enforce `authCoverage:"lost"` if and only if the code is 11 or 12. An `anonymous` fragment in an "intact" shard is refused. Exit 0 alongside refused protected steps is refused. The merged code is the maximum rank over the merge-derived code and every shard code, and the receipt replays it.

## Minors

- **m-5 (18D).** The shard refusal must also cover `PILOT_APPROVAL_RUN_TOKEN_FILE`: refuse without reading it, and delete both env keys. `--approve-action` and `--emit-token-to` combined with `--shard` must exit 1. `gate.perform` must refuse a runtime-discovered protected control in a shard without opening the store. Assert that `run/approvals` is never created in a shard.
- **m-6.** The merge must also compare `pilotManifestDigest` against its own `--pilot-manifest`, as it already does with `expectRunId`/`expectCommit`, and `Args` must admit that flag for merge.
- **m-7 (18F).** CI must enforce rule 1. Pilot shard jobs log in from fixture-only secrets and never use `--auth-import`, an artifact or a cache into `run/auth`; a static `ci.yml` check asserts this. Update the "no secrets" comment at `ci.yml:362` deliberately. `shard-negative` is skipped when a pilot shard intentionally exits 14.
- **m-8.** Correct rev 5's citations of AC-021, AC-073 and AC-077.
- **m-9.** Assign file scope to PRs for the `Schemas` additive change, `put`/`assertClean`, the merge conformance and coverage work, the precedence, and `Runner` timings. Land the AC-076 baseline test in the same PR as the `Schemas` change.
- **m-10 (18C, carried N-3).** Without `content-length`, the `route.fetch` cap is checked only after buffering. SPIKE-R must record whether a pre-buffer bound exists; otherwise add a timeout plus a run-level RSS ceiling. Test with a chunked body far larger than the cap.

## SEC-04 item status

**CLOSED:** E1; E2 (SPIKE-FS is an 18F gate); E3/D-1 (i–iii); E4 L01 (i–iii); E5/N-4; E6/C6; E7; E8 (the attestation is self-reported, a residual); D-a; D-b; D-c; D-d; D-e (design); D-3 (with m-5); N-2; N-5 numeric `statfs`; B01; the SPIKE-W preventive constructor throw (18C merge gate: 50 repetitions plus the backstop inversion).

**PARTIAL:** L01 (iv) (M-1, M-2); N-3 `route.fetch` (m-10).

## Verdict per PR

- **18E start: APPROVE WITH CONDITIONS.** S1 = M-1 and S2 = M-2 must be fixed in the design before `neg-shard-bundle-allowlist` is written. S3 = m-9. S4 = m-8.
- **18A: APPROVE WITH CONDITIONS.** Merge requires M-1, M-3 and m-6.
- **18B: APPROVE WITH CONDITIONS.** These are unchanged from re-review 3.
- **18C: APPROVE WITH CONDITIONS.** The conditions are SPIKE-R and SPIKE-W evidence, plus m-10.
- **18D: APPROVE WITH CONDITIONS** (previously NOT READY). The conditions are m-5, the `neg-d1-lock` (e)–(i) inversions, and the shard tests. OD-24 must be decided before any CI approve step.
- **18F: BLOCK** until M-3 and M-4 are resolved; m-7 and SPIKE-FS also apply.

## Owner items (none accepted)

- BLOCKER-1
- OD-20, OD-21 and OD-22
- OD-23 (re-scoped)
- OD-24
- OD-17, only if the reduced healing record is kept
- The residuals:
  - The merge does not scan allowlisted strings.
  - Attestation is self-reported.
  - Exit 14 masks exit 1 in the merged code.
  - darwin uses uptime buckets for `bootId`.
  - ext2/ext3 are admitted.
  - `node_modules` is outside the build identity.
  - The retention TOCTOU window remains.
  - Opaque frames are counted, not scanned.
  - The request body inside an open lease is unbound.
  - The re-review-3 list carries forward.
