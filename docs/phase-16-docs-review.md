# Phase 16 documentation review

Head reviewed: `cebd31f7460589d8a31211fb5cb5ddb16a6277b9` on `phase-16/parallel-execution` (verified with `git rev-parse`). Merge-base with `main`: `6e7f5f1` (Phase 15 merged). PR #48 is open.
Result legend: OK = checked, matches code, JSON or CI; FIXED = edited in this review; OPEN = not resolved here, reason given.
Scope: documentation only. No source, test, register JSON or commit changes.

## 1. Per-file checklist

| File | Claims checked | Check used | Result |
| --- | --- | --- | --- |
| README.md, "Parallel execution and sharding (Phase 16, in review)" | Status (not merged); the three example commands; merge `--expect-total`; optional `--expect-run-id`/`--expect-commit`; benchmark figures | Parser run (section 2); benchmark JSON (section 3) | FIXED: stale 1.04x/1.18x and "targets missed" replaced by 2.80x/4.15x, discovery explanation, page-only parallelism, copied auth state, page independence, non-linear caveat |
| docs/PHASE-PLANS.md, Phase 16 (line ~810) | Status; last hosted run | `gh run view 37940648249` (success, head cebd31f); `gh run view 37940650327` (failure) | FIXED: run head 42fac1a replaced by cebd31f; code scanning failure recorded as open |
| CHANGELOG.md, Phase 16 entry | Flags; exit codes 0-3; invalid flags exit 1; benchmark; CI jobs; security evidence wording | Parser run; falcon.js rejection runs; benchmark JSON; ci.yml | FIXED: non-linear caveat added. Other lines OK |
| HANDOFF.md, Phase 16 lines | "in review, not merged"; operations link; main at 6e7f5f1 | `gh pr view 48`; `git merge-base` | OK |
| .env.example | No Phase 16 variables exist in docs; no worker/shard/parallel entries present | grep of the file | OK (no change needed; blank-valued optional entries policy unaffected) |
| docs/phase-16-operations.md | Flags and rules; exit codes; bundle layout; rerun rule; MIXED_PLANDIGEST; storageState; VisualRegression rejection; budget wording; CI description; hosted CI status; benchmark | Parser run; falcon.js runs; ci.yml; benchmark JSON | FIXED: status head and CI run; benchmark 1.04x/1.18x replaced by JSON figures; "only job that saves state cache" narrowed to shard and aggregate jobs (sequential jobs also save); discovery limitation added. OPEN items listed in section 5 |
| docs/phase-16-plan.md | Status; base commit | `git merge-base` | FIXED: base d13be7f replaced by 6e7f5f1. Scanner wording is the GitHub checks plus `npm audit` only |
| docs/architecture/phase-16-parallel-execution.md | Status and head; base; sections 1-13; topic coverage; residual risks | Heading list and targeted reads; section 14 added | FIXED: status line (head cebd31f, base 6e7f5f1); R11 (discovery difference) and R12 (non-linear evidence) added; section 14 review checklist added with verdict PASS WITH GAPS. ADR-016 "proposed" left as-is: OPEN for owner |
| docs/benchmarks/phase-16-parallel-benchmark.md | Every quoted figure, min/max, stage medians, speedups, efficiencies, RSS, thresholds, command flags, temporary-copy claim | Re-derived from the JSON (section 3); `scripts/benchmark/parallel.js` read (mkdtemp copy confirmed) | OK. The "before this change 1.04x/1.18x" sentence is an intentional historical note pointing at git history and is kept |
| docs/research/phase-16-competitive-analysis.md | Competitor statements for S07-S12 | Pages re-opened on 2026-10-09 (mabl, Testsigma, testRigor, Autify, Functionize, Virtuoso); statements compared with the source register | FIXED: mabl local/CI no-parallel and cloud limits, Testsigma and testRigor wording, Autify and Virtuoso URLs corrected; unsupported claims withdrawn |
| docs/research/phase-16-gap-analysis.md | Baseline commit; open items | Compared with source register | FIXED: baseline d13be7f labelled as the review-time baseline; branch base is 6e7f5f1. Open item 1 (re-open S07-S12) remains OPEN |
| docs/research/phase-16-source-register.md | Statuses and UNKNOWN entries | Read only; no new sources added | OK. Not re-opened in this pass (see OPEN) |
| docs/security/phase-16-security-evidence.md | Evidence head and check results | Read | FIXED: "Final head 543e78d" labelled as evidence at that head, not re-run on cebd31f. Check results not re-run: OPEN |
| docs/security/phase-16-threat-model.md | Revision line | Read | FIXED: revision labelled design-time, current head cebd31f |
| docs/security/phase-16-baseline-security-assessment.md | Baseline commit d13be7f (historical); UNKNOWN GitGuardian baseline | Read | OK, unchanged (historical record) |
| docs/security/phase-16-owner-acceptance.md | Owner dispositions | Read | OK, unchanged |

## 2. Commands and flags checked against the parser

Parser functions: `parseParallelArgs` (src/core/parallel/Args.js) and `parseMergeExpect` (src/core/parallel/Runner.js), called through `node -e`. falcon.js was run with `--no-dashboard` and `--url=https://example.invalid` where it had to reject before the browser; a `perl alarm` wrapper was used because `timeout` is not installed on this host.

### 2a. Parser cases (17 parseParallelArgs, 4 parseMergeExpect): all match the expected result

| Argument list | Result |
| --- | --- |
| `--url=https://your-app.example --workers=2` | OK, workers 2 |
| `--url=... --shard=1/2 --run-id=local-run-1` | OK |
| `--url=... --shard=2/2 --run-id=local-run-1` | OK |
| `--shard=1/2` | REJECT (requires --run-id) |
| `--run-id=local-run-1` | REJECT (only valid with --shard) |
| `--workers=0`, `--workers=17`, `--workers` | REJECT (three cases) |
| `--shard=3/2 --run-id=local-run-1` | REJECT |
| `--workers=2 --workers=3` | REJECT (duplicate) |
| `--input=x` outside merge | REJECT |
| `merge --input=reports/shards/local-run-1 --expect-total=2` | OK |
| `merge --input=shards-in --expect-total=3 --expect-run-id=gh-1-1 --expect-commit=<40-hex>` | OK (parseParallelArgs ignores the two expect flags; they are handled by parseMergeExpect) |
| `merge --expect-total=2` | REJECT (requires --input) |
| `merge --input=x --workers=2`; `merge --input=x --shard=1/2 --run-id=...` | REJECT |
| `merge --input=x --expect-total=0` | REJECT |
| parseMergeExpect `--expect-run-id=gh-1-1 --expect-commit=<sha>` | OK |
| parseMergeExpect `--expect-run-id=BAD_ID` | REJECT (pattern) |
| parseMergeExpect `--expect-commit=abc` | REJECT (40 lowercase hex) |
| parseMergeExpect with no expect flags | OK, both null |

### 2b. Executed falcon.js and benchmark runs

| Command | Exit | Note |
| --- | --- | --- |
| `node falcon.js --url=https://example.invalid --workers=0 --no-dashboard` | 1 | Rejected before the browser |
| `... --workers=2 --single-page` | 1 | "--single-page cannot be combined with --workers or --shard" |
| `... --shard=1/2` | 1 | "--shard requires --run-id" |
| `node falcon.js merge --input=<missing dir> --expect-total=3` | 2 | INPUT_DIR_UNREADABLE; nothing canonical changed |
| `node scripts/benchmark/parallel.js --workers=0` | 1 | "Invalid --workers: 0" |
| `... --shard=1/2 --run-id=local-run-1 --workers=2` | 1 | Not rejected: the run started and failed on DNS for example.invalid. See OPEN item 6 |

### 2c. Static checks

- Benchmark flags in the benchmark doc and README (`--workers`, `--runs`, `--warmup`, `--delay-ms`, `--baseline-1w-ms`, `--write`) all appear in `parseArgs` of `scripts/benchmark/parallel.js`.
- `npm audit --omit=dev --audit-level=high` matches the regression job in `.github/workflows/ci.yml`.
- Shard artifact name `falcon-shard-<i>-of-3-<attempt>`, `if: always()` aggregate, and `merge --expect-total=N --expect-run-id --expect-commit` match ci.yml.
- No bare-URL usage found; every example uses `--url=<value>`.

Totals: 21 parser cases and 6 falcon.js or benchmark invocations executed; 2 static CLI groups checked. Failures against documentation: none. One behaviour is undocumented (item 6).

## 3. Benchmark re-derivation (docs/benchmarks/phase-16-parallel-benchmark.json)

| Figure | JSON | Doc / README / CHANGELOG / ops |
| --- | --- | --- |
| 1w end-to-end median (min/max) | 16,428.9 ms (16,293 / 16,529) | 16.43 s (16.29 / 16.53) OK |
| 2w end-to-end median (min/max) | 5,868.4 ms (5,739 / 8,212) | 5.87 s (5.74 / 8.21), speedup 2.80x (2.7995), efficiency 1.40 OK |
| 4w end-to-end median (min/max) | 3,959.5 ms (3,829 / 4,048) | 3.96 s (3.83 / 4.05), speedup 4.15x (4.1493), efficiency 1.04 OK |
| Parallel stage 1w / 2w / 4w | 4,769 / 4,280 / 2,530 ms | 4.77 / 4.28 / 2.53 s OK |
| Parallel-stage speedup / efficiency | 1.114 / 0.557 (2w); 1.885 / 0.471 (4w) | 1.11x / 0.56; 1.88x / 0.47 OK |
| Stage medians 2w: discovery, analysis, execution, merge | 1,109 / 1,610 / 2,668 / 61 ms | 1.11 / 1.61 / 2.67 / 0.06 s OK |
| Stage medians 4w: discovery, analysis, execution, merge | 852 / 870 / 1,649 / 58 ms | 0.85 / 0.87 / 1.65 / 0.06 s OK |
| Sequential discovery | 11,404 ms | 11.40 s OK |
| Peak RSS 1w / 2w / 4w | 530,496 / 582,048 / 758,544 KB | matches OK |
| Thresholds | 2w>=1.5x PASS; 4w>=2.3x PASS; 1w regression <=10% PASS | matches OK |
| semanticEquivalence / rawReportsIdentical | true / false | matches OK |
| amdahl.maxEndToEndSpeedup | 1.42 (serial fraction 0.705, computed at 1 worker) | Not quoted anywhere now. Old "serial discovery bounds speedup at 1.42x" wording is absent. Note: this figure describes the sequential baseline and is not a bound on parallel mode |

Stale wording removed: "1.04x/1.18x" as current results, "targets missed", "in review" states that were wrong, old SHAs 42fac1a and 747d6ec in current-state text. Remaining occurrences are labelled historical (benchmark doc line 33 and gap-analysis baseline).

## 4. Architecture checklist (AC-39)

Section 14 of docs/architecture/phase-16-parallel-execution.md lists the 11 topics with covering sections and a verdict. Overall: **PASS WITH GAPS**.
- Alternatives (§4), lifecycle (§2, §3.2), data flow (§2, §3.5, §3.6), trust boundaries (§8), schemas (§3.6, §5, §6), conflicts (§7), failure matrix (§9), compatibility (§10), residual risk (§12, now R1-R12): PASS.
- Migration and rollback: PASS WITH GAPS. Both are bullets inside §10, not their own headings. The rollback path (AC-41) is a design statement and was not executed.
- Gap not closed: ADR-016 status "proposed" against an implemented-on-branch header (owner decision).

Discovery difference, page-only parallelism, copied auth state, page independence, non-linear performance and rollback are now stated in README (Phase 16 section), operations guide (sections 3, 4, 6), and architecture (§3.3 D-DISC, §3.7, R11, R12).

## 5. OPEN items

1. Merge exit codes 0, 1 and 3, and shard exit codes, are not executed against real bundles. Reason: they need real shard runs (browser and fixture). CI jobs cover the matrix; the local merge path was run only for exit 2 (missing input).
2. Operations §3: "`coverage.linksOutOfScope` is not carried through the bundle" is not verified. `linksOutOfScope` appears in `src/core/SiteSweep.js` and `src/core/parallel/ParallelSweep.js`; the bundle and merge path were not traced. Owner or Engineering must confirm before release.
3. Operations §6: the "Re-run all jobs" rule and the MIXED_PLANDIGEST explanation are checked against ci.yml comments and architecture §10, not executed.
4. Research S07-S12 were re-opened on 2026-10-09 and are VERIFIED against the pages named in the source register. Vendor pages change; account-gated pricing and plan limits remain UNKNOWN.
5. Hosted CI on cebd31f: all seven jobs succeeded on the pull_request run 37940648249 (verified with `gh`). GitHub code scanning run 37940650327 on the same head concluded failure. It was not investigated; Release Manager must read it before any GO.
6. Undocumented behaviour: `--workers=2 --shard=1/2 --run-id=...` is accepted by the parser and falcon.js started a run (it did not reject). The docs say conflicting parallel flags exit 1, but the only conflict documented is `--single-page`. Owner must decide whether workers with shard is supported; docs were not changed. This run also created `reports/shards/local-run-1` under the git-ignored `reports/` directory; it was removed after the check.
7. Security evidence file records check results at head 543e78d. It was not re-run on cebd31f. Read the GitHub checks on the final head.
8. ADR-016 status "proposed" (owner decision).
9. Migration and rollback have no separate headings in architecture §10, and AC-41 was not executed.

## 6. Recommended register status (for Release Manager; register JSON not edited)

- P16-AC-38: evidence now covers every command and flag in the listed files (21 parser cases, 6 executed runs, 2 static groups). Recommend `done`, with OPEN items 1-3 and 6 recorded as residual risk.
- P16-AC-39: section 14 lists the 11 topics with locations and verdict PASS WITH GAPS, and gaps are recorded. Recommend `done` if the gaps are accepted as non-blocking; otherwise keep `partial` until migration and rollback have their own headings and AC-41 is executed.


## Addendum, 2026-10-09: `--workers` with `--shard`

Checked by running `node falcon.js --shard=I/2 --run-id=<id> --workers=3` against the fixture and comparing with `--workers=1`: manifests, page ownership and the merged page set are identical, and every page is owned by exactly one shard (`tests/regression/p16-workers-shard.check.cjs`). `--run-id` without `--shard` exits 1. Documented in `docs/phase-16-operations.md` (flag table) and the README Phase 16 section.
