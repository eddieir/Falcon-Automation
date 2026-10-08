# Phase 16 documentation review

Head reviewed: `42fac1a47a3c967ccbb0e9bfa55614e645e85005` on `phase-16/parallel-execution`.
Result legend: OK = checked, matches code or CI; FIXED = edited in this review; OPEN = not resolved here.

## 1. Document checklist

| Document | Claims checked | Check used | Result |
| --- | --- | --- | --- |
| README.md, "Parallel execution and sharding" | Status in review; `--workers=2`, `--shard=1/2 --run-id=...`, merge `--expect-total=2`; optional `--expect-run-id`/`--expect-commit`; benchmark 1.04x and 1.18x | `node -e` parser run (section 2 below); benchmark doc | OK |
| CHANGELOG.md, Phase 16 entry | Flags; merge exit codes 0-3; invalid flags exit 1; benchmark; CI jobs; security evidence wording | parser run; `.github/workflows/ci.yml`; `gh run list` | FIXED (grammar and security sentence reworded to name GitHub checks and `npm audit` only) |
| HANDOFF.md, Phase 16 lines | "in review, not merged"; branch; operations guide link | `grep -n phase-16 HANDOFF.md` | OK |
| docs/PHASE-PLANS.md, Phase 16 | Status; hosted CI | `gh run view 37792596841` | FIXED (stale "not yet recorded" replaced with run result) |
| docs/phase-16-operations.md | Flags and their rules; exit codes 0-3 (merge), shard exit rule; bundle layout; receipt; rerun rule "Re-run all jobs"; MIXED_PLANDIGEST; storageState; VisualRegression rejection; budget wording; linksOutOfScope difference; hosted CI | parser run; `node falcon.js --workers=0` exit 1; `node falcon.js merge --input=/nonexistent/dir --expect-total=3` exit 2; ci.yml; gh run | FIXED (hosted CI status line). Merge exit 0/1/3 and shard exit codes not executed against real bundles: OPEN |
| docs/phase-16-plan.md | Status; security gate sources; budget wording | file read | FIXED (status updated; third-party scanner name removed) |
| docs/architecture/phase-16-parallel-execution.md | Status; shard exit rule; manifest and merge contracts; CI description | file read; ci.yml | FIXED (status line; shard exit wording corrected). ADR-016 "Status: proposed" left as-is: OPEN for owner |
| docs/benchmarks/phase-16-parallel-benchmark.md | Speedups, thresholds, environment | compared with operations guide and README figures; JSON not re-derived | OK for quoted figures; JSON source OPEN |
| docs/research/phase-16-*.md (competitive analysis, gap analysis, source register) | Competitor statements | not re-read in this pass | OPEN (source register marks some claims PARTIALLY VERIFIED; must not be cited publicly) |
| docs/security/phase-16-baseline-security-assessment.md, phase-16-threat-model.md | Security evidence and controls | not re-read in this pass; search for third-party product names found matches to be checked | OPEN |

## 2. CLI flag check (parseParallelArgs and parseMergeExpect via node -e)

| Argument list | Result |
| --- | --- |
| `--workers=2` | OK (workers 2) |
| `--shard=1/2 --run-id=local-run-1` | OK |
| `--shard=2/2 --run-id=local-run-1` | OK |
| `--shard=1/2` (no run id) | rejected: requires --run-id |
| `--workers=0`, `--workers=17` | rejected |
| `--workers=2 --shard=1/2 --run-id=local-run-1` | OK (accepted by parser; falcon.js enforces single-page conflict) |
| `--run-id=local-run-1` alone | rejected |
| `--shard=3/2 --run-id=...` | rejected |
| `--workers` (no value) | rejected |
| `merge --input=... --expect-total=2` | OK |
| `merge --input=shards-in --expect-total=3 --expect-run-id=gh-1-1 --expect-commit=<sha>` | OK (parseMergeExpect accepts both) |
| `merge --expect-total=2` (no input) | rejected |
| `merge --input=x --workers=2` | rejected |
| `--input=x` outside merge | rejected |

## 3. Exit codes executed

| Command | Exit |
| --- | --- |
| `node falcon.js --url=https://example.invalid --workers=0 --no-dashboard` | 1 |
| `node falcon.js merge --input=/nonexistent/dir --expect-total=3` | 2 (INPUT_DIR_UNREADABLE) |

## 4. Architecture topic checklist (AC-39)

| Topic | Section |
| --- | --- |
| Alternatives | 4 (Cross-process state alternatives) |
| Lifecycle | 2 and 3.2 |
| Data flow | 3.5 and 2 |
| Trust boundaries | 8 |
| Schemas | 3.6 (manifest) and 5 (journal envelope) |
| Conflicts | 7 (reducers return conflicts[]) |
| Failure matrix | 9 |
| Compatibility | 10 |
| Migration | 10 |
| Rollback | 10 and operations guide 6 |
| Residual risk | 12 |

## 5. Verification evidence

- Regression suite: `node --test --test-concurrency=1 tests/regression/*.check.cjs` gives 1444 tests, 1443 pass, 1 fail (exit 1). The failing test is not yet identified: OPEN.
- Hosted CI for 42fac1a: Falcon CI run 37792596841 succeeded on all seven jobs (regression, test, shards 1-3, aggregate, shard-negative).
- GitHub code scanning run 37792606063 on the same head concluded failure: OPEN, not investigated.
- No separate security workflow exists in `.github/workflows/`; security evidence is the GitHub checks plus `npm audit --omit=dev --audit-level=high` in the regression job.
