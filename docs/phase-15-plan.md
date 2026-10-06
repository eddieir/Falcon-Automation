# Phase 15 — Run history and trend: detailed plan

Status: **planned, not started.** Plan of record for the phase summarised in
[PHASE-PLANS.md](PHASE-PLANS.md#phase-15--run-history-and-trend). It consolidates the product
framing, acceptance criteria, threat model, CI plan, architecture, test strategy and delivery plan
produced by the product, security, DevOps, architecture, QA and project-management reviews.
Everything below was checked against the code on `main` at `32c9a8b`.

---

## 1. Problem

A QA lead's question is "are we getting better or worse?", and Falcon cannot answer it:

- `reports/test-report.json` is overwritten on every run (`ReportManager.generateReport`).
- The live dashboard exists only while `falcon.js` runs, plus a 60 s linger.
- Phase 9 keeps per-scenario history (`data/scenario_history.json`); nothing exists at suite level.
- No run records its commit or branch, so a result cannot be tied to the code that produced it.

The most useful signal is one a per-run report cannot show: **a rising heal rate means the
application is drifting underneath the suite.** That is a finding about the product, not about the
tests.

## 2. Users and the questions they need answered

| Who | Question | Answered by |
|---|---|---|
| QA lead / manager | Is quality improving or decaying? Is selector drift growing? | Trend view, heal-rate and pass-rate flags, CSV export |
| Engineer triaging a red build | Is this new, or has it been degrading for days? Which commit did it start on? | Run list with SHA and branch, flags |
| CI maintainer | Did the run history survive? Is the review queue backing up? | CI step summary, pending-depth and quarantine flags |

## 3. Scope

**In scope (standard scope):** a bounded run ledger, a persistent history view that works without
a run in progress, advisory trend flags, and JSON/CSV export.

**Out of scope:** any hosted service or external database; rollups across branches or repositories;
forecasting or ML-based anomaly detection; bulk approval of anything; sending history over the
network; using history to change healing, quarantine, approval or the run's exit code.

## 4. Decisions for the owner

The plan proceeds on these defaults. Each can be reversed before or during implementation.

| # | Decision | Default in this plan | Alternative |
|---|---|---|---|
| D1 | How history "outlives the run" | New `npm run dashboard` serve mode (no browser, no run) plus JSON/CSV exports | Static HTML export only |
| D2 | Where CI history lives | Separate per-branch cache entry; exports in the `reports/` artifact (14 days); raw ledger as a main-only artifact (90 days); no automated commits | Commit the ledger to the repository on merge to `main` |
| D3 | PR runs and `main`'s history | PR runs start with an empty history (cache is scoped to the PR ref) | Restore `main`'s ledger read-only as a baseline |
| D4 | Flags and the exit code | Advisory only; `history:check --strict` is the only way a flag fails a command | Gate CI on flags |
| D5 | First flag | Needs 10 complete baseline runs on the same branch and repeat count, so the 11th run is the first that can flag | 5 runs (noisier) |
| D6 | Which runs are recorded | Only `node falcon.js`; standalone `tests/ui/*.js` runs are not | Record every report with a `source` tag |

## 5. Definitions

These are fixed in one place (`RunRecord.js`) so every surface agrees.

- **verified** = passed + failed + quarantined + unavailable (the existing ReportManager definition).
- **pass_rate** = passed ÷ (passed + failed + unavailable). Quarantined outcomes are reported but
  excluded so a quarantine cannot make the rate look better. `null` when the denominator is 0.
  Deduplicated scenarios are not outcomes and never count.
- **heals** = successful resolutions only, classified by the shape of the events `AIHealer` actually
  emits, not by the tier names the README uses (the README describes Tier 2 as `LocatorStore`
  cached alternatives; in the code, scoped replay of an approved selector is logged under
  `LocatorMemory`):
  Tier 2 = `tier: "LocatorMemory"`, `status: "approved_reuse"` (scoped replay of an approved
  selector); Tier 2.5 = `tier: "LocatorMemory"`, `status: "accepted"`; Tier 3 = `tier: "LLM"` with a
  non-null `resolved` and `trust: "pending"`. Tier 1 retry successes are not heals. Nothing logs
  `tier: "LocatorStore"` today (it appears only in a doc comment), so it is not a source.
- **heal_failures** = `LocatorMemory` `refused` / `no_candidate` / `failed`; `LLM` with
  `resolved: null` (rejected events carry `status: "rejected"`, unresolved ones carry no status, so
  classification keys on `resolved === null`); and `tier: "exhausted"` (logged by `TestRunner`).
  Recorded separately, never added to heals.
- **heal_rate** = heals ÷ verified. `null` when verified is 0. It can exceed 1, because one scenario
  can heal several interactions.
- **durationMs** = run wall clock from `reportManager.startRun()` to the ledger write, excluding the
  dashboard linger.
- **pendingDepth** and **quarantineCount** are point-in-time snapshots (HealingTrust pending entries;
  FlakinessTracker quarantined scenarios), not per-run deltas.

## 6. Run record

One record per `falcon.js` run, built from a fixed allow-list. Anything not listed is never written.

| Field | Type and validation |
|---|---|
| `schemaVersion` | `1` |
| `runId` | UUID generated by Falcon |
| `timestamp` | ISO 8601, generated by Falcon |
| `sha` | `GITHUB_SHA`, else `git rev-parse HEAD`; must match `/^[0-9a-f]{7,40}$/`, else `"unknown"` |
| `branch` | `GITHUB_REF_NAME`, else `git rev-parse --abbrev-ref HEAD`; control characters stripped, characters outside `[A-Za-z0-9._/-]` replaced, ≤100 characters, else `"unknown"` |
| `source` | `"falcon"` |
| `repeat` | integer 1–50 (the existing `--repeat` bound) |
| `result` | `PASSED` / `FAILED` / `PARTIAL` / `NO_TESTS_RUN` |
| `counts` | `total, passed, failed, skipped, quarantined, deduped, unavailable` — integers 0–1,000,000 |
| `coverage` | `pagesTested, pagesSkipped, pagesUnreachable` — integers, `null` on the crash path |
| `heals` | `{t2, t25, t3}` integers |
| `healFailures` | `{t25, t3, exhausted}` integers (`t25` covers every `LocatorMemory` failure status) |
| `pendingDepth`, `quarantineCount` | integers |
| `durationMs` | finite, 0 to 7 days in ms |
| `incomplete` | `true` on the crash path, else `false` |

**Never recorded:** URLs, selectors, page text, error messages, scenario names, reviewer identities,
tokens, environment values, hostnames, file paths.

## 7. Architecture

### Storage (ADR-15-01)

`data/run_history.json` holds `{ "schemaVersion": 1, "runs": [...] }`, written with
`AtomicJsonStore.writeJsonAtomic` (temporary file, rename, mode 0600) through
`LocatorMemoryWriter.write(file, data, expectedDigest, atomic)`, which takes the cross-process lock
and refuses if the file changed since it was read. That function does not wait: a held lock or a
changed file returns `{ ok: false }` at once. `RunLedger.append` therefore runs a **bounded retry
loop** — re-read, re-validate, recompute the digest, push, evict oldest to **500 records**, call
`write` — up to 5 attempts with a short jittered back-off and a total wait under 2 s, then gives up
with a warning. On the first append there is no file, so the expected digest is `null` (what
`digestSync` returns for a missing file). If computing the digest throws (an oversized or unreadable
file), the append takes the corrupt-file path below rather than retrying. Without the loop, concurrent appends would lose records. Note that the writer's
digest reader allows 8 MB; the ledger's own 1 MB cap is enforced separately, below.

- Load is defensive. `RunLedger` `stat`s the file first: over **1 MB** is treated as corrupt.
  `AtomicJsonStore.readJsonSync` has no size bound and its corrupt-file preservation is internal, so
  `RunLedger` writes its own byte-for-byte sidecar (`run_history.json.corrupt-<timestamp>-<pid>-<uuid>`,
  `wx`, 0600, the same naming as `AtomicJsonStore`) for oversized, unparsable or wrongly shaped files, then starts empty. Every record is
  re-validated and invalid ones are dropped with a count (never their content) logged;
  `__proto__`/`constructor` keys are rejected. Records with a future `schemaVersion` inside a
  version-1 file are not read, but are kept on rewrite, capped at 2 KB each, and count toward the
  500-record cap so the file cannot grow without bound. A future-version record over 2 KB is dropped with a warning, not kept: losing that newer data is deliberate, to keep the file bounded. A file whose envelope has a future version,
  or that cannot be read, makes the ledger read-only for that process. A symlink or non-regular file
  at the ledger path is refused, never followed. A bad file is moved aside with `rename` (so the
  sidecar is the original bytes and nothing is copied or deleted); if that fails, the ledger is
  read-only for the process.
- A write failure logs a warning and never throws.
- **Phase 16:** exactly one record per logical run, written by the aggregating process after shards
  finish. `RunLedger.merge(a, b)` deduplicates by `runId` and orders by `(timestamp, runId)`, so
  per-shard ledgers merge deterministically.

Alternatives rejected: JSON Lines (append is simpler, but eviction needs a rewrite anyway and the
file cannot be validated as a whole); SQLite or an external database (non-goal, new dependency).

### Modules

| Path | Responsibility |
|---|---|
| `src/core/history/RunRecord.js` | `buildRunRecord(...)`, `validateRecord(raw)`, sanitisers, the tier map, metric definitions |
| `src/core/history/RunLedger.js` | `load`, `append`, `list`, `merge`, caps, kill switch (`FALCON_RUN_HISTORY=off`); file path injectable for tests only |
| `src/core/history/GitInfo.js` | `execFileSync("git", [fixed argv])`, no shell, 5 s timeout, repo-root cwd, bounded output; any failure → `"unknown"` |
| `src/core/history/TrendDetector.js` | Pure `evaluate(runs, current)` → `{ flags, suppressed }`; never throws |
| `src/core/util/OutputSafe.js` | Adds `csvCell()` (formula neutralisation + RFC 4180 quoting) |
| `scripts/history.js` | `list`, `export --format=json\|csv`, `check [--strict]` |
| `scripts/dashboard.js` | Serve mode: the existing `Dashboard` with no run and no browser |
| `src/core/Dashboard.js` | `GET /history` → last 50 runs + flags |
| `src/dashboard/index.html` | History panel |

### Integration with `falcon.js`

A `recordRun({ incomplete })` helper, wrapped in try/catch and **awaited**, is called right after
each of the two `reportManager.generateReport(...)` calls (normal path, and the crash path with
`incomplete: true`), before `Logger.flush()` and the dashboard linger. Its lock wait is bounded (see
Storage), so it cannot hold up the exit. It reads `HealingReport._instance.logs`,
`HealingTrust`, `FlakinessTracker`, the report summary and coverage. It cannot change the exit code.
`BaseTest` and other scripts never append.

## 8. Trend rules

Baseline: the previous **10** records on the **same branch** with the **same repeat count** and
`incomplete: false`. For each signal, *m* = median, *band* = 3 × 1.4826 × MAD.

**Suppress every flag** (and report why) when: the current run is incomplete (`incomplete-run`); it
fails validation (`invalid-current`); fewer than 10 eligible baseline runs exist
(`insufficient-baseline`); or its `pagesTested` is below 80% of the baseline median, or it has no
coverage at all (`reduced-coverage`). A rate signal whose baseline has fewer than 10 non-null values
is skipped on its own (`insufficient-baseline:<signal>`) while the other signals are still evaluated.

| Signal | Flag when |
|---|---|
| Heal-rate spike | current ≥ 0.10 **and** current > *m* + max(*band*, 0.05) |
| Pass-rate decay | current < 0.95 **and** current < *m* − max(*band*, 0.10) |
| Duration regression | current > *m* + max(*band*, 0.25 × *m*, 30 000 ms) |
| Review backlog | pendingDepth ≥ *m* + 5 **and** strictly rising across the two previous runs and the current one |
| Quarantine growth | quarantineCount ≥ *m* + 2 |

The absolute floors are what stop a zero-variance baseline from flagging a trivial change, which
plain mean ± σ rules do. Baseline size and minimum are overridable through `validateIntSetting`
(`FALCON_TREND_BASELINE_N`, `FALCON_TREND_MIN_BASELINE`); the other constants are fixed so flags stay
comparable over time. `validateIntSetting` throws `INVALID_CONFIG` on a bad value, so the settings are
parsed outside `evaluate` (which stays pure and never throws): `falcon.js` logs a warning and uses the
defaults, and the CLI exits 2 naming the setting, as `scripts/review/status.js` already does.

A flag is `{ signal, current, baseline, threshold, message }`; the message is a fixed template
containing numbers only.

**Worked examples**

- *Induced heal-rate spike (phase acceptance):* ten runs at heal rate 0.02 with MAD 0.01 → band 0.044
  → threshold 0.02 + max(0.044, 0.05) = 0.07. A run at 0.20 is ≥ 0.10 and > 0.07 → **flagged**.
- *Zero-variance baseline:* ten runs at 0.00, current 0.04 → below the 0.10 gate → no flag.
- *Stable run:* heal rate 0.03 vs median 0.02, pass rate 1.0, duration +5% → no flags.
- *Reduced coverage:* current run tested 5 pages against a baseline median of 10 → all flags
  suppressed with reason `reduced-coverage`.

## 9. Surfaces

**CLI** (`npm run history:list | history:export | history:check`). Takes no path, file or URL
arguments; unknown flags are rejected; output goes to stdout only. Exit codes: 0 success, 1 a flag
under `--strict`, 2 usage or ledger error. A missing ledger is not an error (`list` prints nothing,
`check` exits 0). Every string printed to a terminal goes through `sanitizeField`; CSV cells go
through `csvCell`.
An invalid `FALCON_TREND_*` setting makes `check` and `export --format=csv` exit 2, even on an empty
ledger. `list` and `export --format=json` do not read those settings. A closed stdout (`| head`) exits 0.

**Dashboard.** `GET /history` returns the last 50 records and current flags. GET only, behind the
existing token check, Host/Origin guard and rate limiter. The History panel shows a table of the last
20 runs (time, branch, short SHA, pass %, heal %, duration, pending, quarantine, flag badge), inline SVG
sparklines for pass rate, heal rate and duration built with `createElementNS`, and the flag list.
Every value is set with `textContent`. Loaded once when the panel opens, with a Refresh button; no
polling. Empty state: "No runs recorded yet. Run `node falcon.js` to start building history."

**Serve mode.** `npm run dashboard` starts the existing `Dashboard` class unchanged — loopback
default, refusal of a non-loopback host without a token, Host guard, rate limit — with no run and no
browser, until Ctrl-C.

## 10. CI

- A **separate** cache entry for the ledger: key `falcon-history-${{ github.ref_name }}-${{ github.run_id }}`,
  restored by prefix, path `data/run_history.json` only. Restored before the pipeline step; saved
  with `if: always()` and `continue-on-error: true`. Locator memory is never added to any cache.
- `history:export` writes JSON and CSV to `reports/history/` (stdout redirect), covered by the
  existing 14-day `falcon-reports` artifact.
- `history:check` (never `--strict`) writes to `$GITHUB_STEP_SUMMARY`, fenced and truncated.
- On `main` only: upload `data/run_history.json` as a `run-history` artifact, 90-day retention, as a
  recovery copy.
- Limits to state plainly: caches unused for 7 days are evicted, so an idle branch silently starts
  over; PR runs start empty (D3); the ten-run acceptance is only meaningful on `main`.

## 11. Security requirements

All are acceptance criteria (section 12).

- **SEC-01** Records come from the field allow-list; extra keys, URLs, selectors and secret-like
  strings never reach the ledger.
- **SEC-02** `sha` and `branch` validated and sanitised as in section 6.
- **SEC-03** Git read with `execFileSync`, fixed argv, no shell, timeout, bounded output; failure →
  `"unknown"`, never a failed run. Environment values pass the same validation.
- **SEC-04** CSV cells starting with `= + - @`, tab or CR are prefixed with `'`; cells with commas,
  quotes or newlines are quoted with embedded quotes doubled.
- **SEC-05** Terminal output contains no raw control bytes.
- **SEC-06** The History panel never uses `innerHTML` with ledger data.
- **SEC-07** Serve mode uses the unchanged `Dashboard` class and all its guards.
- **SEC-08** History routes are GET-only, read-only, allow-listed JSON, no parameter reaches the
  filesystem; 401 without a token, 403 for a foreign Host, 404/405 for other methods.
- **SEC-09** No path, file or URL arguments anywhere; CI exports go to a fixed path.
- **SEC-10** Defensive load as in section 7.
- **SEC-11** Atomic 0600 writes under the cross-process lock; a failed write never changes the exit
  code.
- **SEC-12** Flags are advisory; nothing in healing, quarantine, approval or the exit code reads the
  ledger.
- **SEC-13** The CI ledger cache holds only the ledger file.
- **SEC-14** Trend functions are pure and tolerate empty or malformed input.
- **SEC-15** No secret or environment value appears in the ledger, exports or logs.

**Forbidden:** shell strings for git; writing errors, scenario names, URLs, selectors, page text or
identities to the ledger; path arguments; query-string tokens or any new unauthenticated or write
route; binding to `0.0.0.0` by default; `innerHTML` with ledger data; using history to approve, heal,
skip quarantine or fail CI without `--strict`; adding the ledger to the state-file or locator caches.

## 12. Acceptance criteria

Registered in `docs/phase-15-acceptance-criteria.json`; `tests/regression/p15-traceability.check.cjs`
asserts every row names an implementation file and a test that exists, following Phase 14.

| ID | Pri | Criterion |
|---|---|---|
| **Ledger** | | |
| P15-AC-01 | Must | Each `node falcon.js` run appends exactly one record with every section 6 field, and nothing else (SEC-01) |
| P15-AC-02 | Must | `sha`/`branch` come from CI variables, then git, else `"unknown"`; invalid values become `"unknown"` (SEC-02, SEC-03) |
| P15-AC-03 | Must | The crash path records `incomplete: true`, `coverage: null`, and is excluded from baselines |
| P15-AC-04 | Must | `runId` is unique across 100 appends |
| P15-AC-05 | Must | The 501st append evicts the oldest record and logs one warning with the count |
| P15-AC-06 | Must | A ledger over 1 MB, malformed JSON, or the wrong shape is moved to a sidecar byte-for-byte; history restarts empty; the run continues |
| P15-AC-07 | Must | Invalid records (NaN, negative, wrong type, oversized, prototype keys) are dropped with a count logged, never their content (SEC-10) |
| P15-AC-08 | Must | Records with `schemaVersion` > 1 are skipped with a warning and never rewritten |
| P15-AC-09 | Must | Writes are atomic, mode 0600, and leave no temporary file; two processes appending 20 records each produce 40 valid records (SEC-11) |
| P15-AC-10 | Must | A stale lock from a dead process is reclaimed; a live owner's lock is never displaced |
| P15-AC-11 | Must | `FALCON_RUN_HISTORY=off` writes nothing, creates no file or lock, and the CLI reports history as disabled |
| **Exit codes** | | |
| P15-AC-12 | Must | `falcon.js` exits with the same code whether history is on, off, unwritable, or raising a flag, across the fixture modes pass / scenario-failure / navigation-failure / empty / launch-failure (SEC-12) |
| **Metrics** | | |
| P15-AC-13 | Must | pass_rate, heal_rate, heals, heal_failures and durationMs follow section 5 exactly, with `null` for zero denominators |
| P15-AC-14 | Must | The tier map is the only place event tiers and statuses are classified |
| **Trend** | | |
| P15-AC-15 | Must | Ten consecutive fixture runs produce ten listed records and no flags |
| P15-AC-16 | Must | An induced heal-rate spike on the eleventh run is flagged, and `history:check --strict` exits 1 naming `heal_rate` |
| P15-AC-17 | Must | Each section 8 rule has a positive and a negative case, including a zero-variance baseline that does not flag a trivial change |
| P15-AC-18 | Must | Flags are suppressed, with the reason reported, for an incomplete run, fewer than 10 eligible baseline runs, reduced coverage, and a different repeat count |
| P15-AC-19 | Must | `evaluate` is deterministic, does not mutate its input, and never throws on empty, single-record or malformed input (SEC-14) |
| **CLI** | | |
| P15-AC-20 | Must | `list`, `export --format=json`, `export --format=csv` and `check` write to stdout only; stderr is empty on success |
| P15-AC-21 | Must | Path arguments, unknown flags or a missing subcommand exit 2; a corrupt ledger exits 2; a missing ledger exits 0 (SEC-09) |
| P15-AC-22 | Must | CSV neutralises `=cmd`, `@SUM(1)`, `+1`, `-1`, a leading tab, and an embedded newline in `branch`, and re-parses to one row per record (SEC-04) |
| P15-AC-23 | Must | ANSI, CR/LF and OSC sequences in `branch` never reach terminal output (SEC-05) |
| **Dashboard** | | |
| P15-AC-24 | Must | `GET /history` returns allow-listed records and flags; 401 without a token, 403 for a foreign Host, 404/405 for other methods, shares the rate limiter (SEC-08) |
| P15-AC-25 | Must | The History panel renders a branch of `<img src=x onerror=...>` as text and runs no script (SEC-06) |
| P15-AC-26 | Must | The panel shows the empty state, the run table, three sparklines with no `NaN` in SVG attributes for `null` values, and the flag list |
| P15-AC-27 | Must | `npm run dashboard` serves history with no run and no browser, refuses a non-loopback host without a token, and exits cleanly on SIGINT (SEC-07) |
| **CI** | | |
| P15-AC-28 | Must | The workflow caches only `data/run_history.json` under its own key, separate from the state-file cache (SEC-13) |
| P15-AC-29 | Must | Exports land in `reports/history/`; the advisory check reaches the step summary and never fails the job |
| P15-AC-30 | Should | `main` runs upload the ledger as a 90-day artifact; PR runs do not |
| P15-AC-31 | Must | Hosted evidence: two consecutive runs on one branch show a ledger cache miss then a hit with the record count growing (platform) |
| **Safety and docs** | | |
| P15-AC-32 | Must | Seeded `OPENAI_API_KEY`, `DASHBOARD_TOKEN` and a URL never appear in the ledger, exports or `/history` (SEC-15) |
| P15-AC-33 | Must | Git is never invoked through a shell: static check plus a stubbed `execFileSync` and a branch value of `$(touch PWN)` that creates no file (SEC-03) |
| P15-AC-34 | Must | README, CHANGELOG, HANDOFF, `.env.example` and this plan describe the shipped behaviour; `FALCON_RUN_HISTORY` and the trend overrides are documented blank in `.env.example` |
| P15-AC-35 | Must | Existing CLIs (`scripts/healing/review.js`, `scripts/review/status.js`) keep their exit codes |
| P15-AC-36 | Must | Every criterion is registered and the traceability check passes |

## 13. Test strategy

| File | Covers |
|---|---|
| `tests/regression/p15-record.check.cjs` | Allow-list, sanitisers, field bounds, tier map against real emitted events; dynamic half of AC-33 (stubbed `execFileSync`, `$(touch PWN)` branch) (AC-01, 02, 13, 14, 33) |
| `tests/regression/p15-ledger.check.cjs` | Caps, corruption, versions, atomicity, lock, concurrency, kill switch (AC-04–11) |
| `tests/regression/p15-trend.check.cjs` | The rule matrix from synthetic ledgers with fixed timestamps (AC-17–19) |
| `tests/regression/p15-export-safety.check.cjs` | `csvCell`, terminal sanitisation (AC-22, 23) |
| `tests/regression/p15-cli.check.cjs` | Child-process CLI, exit codes 0/1/2 (AC-20, 21) |
| `tests/regression/p15-integration.check.cjs` | `falcon.js` via the CLI fixture preload: ten runs, spike, exit-code invariance, crash path (AC-03, 12, 15, 16) |
| `tests/regression/p15-routes.check.cjs` | `/history` auth, Host, methods, limiter, secrets; serve mode started as a child process: readiness line, no browser, refusal on a non-loopback host without a token, clean SIGINT exit (AC-24, 27, 32) |
| `tests/regression/browser.spec.js` | History panel XSS, empty state, sparklines (AC-25, 26) |
| `tests/regression/p15-traceability.check.cjs` | Register, static check that no history module calls `exec`/`execSync`/`shell: true`, CI YAML assertions (AC-28–30, static half of 33, 36) |
| `tests/regression/cli.check.cjs`, `tests/regression/review-status.check.cjs` (existing, unchanged) | Existing CLI exit codes still hold (AC-35) |

- **Heal spike in fixture mode.** The CLI fixture stubs the sweep, so no heals happen. A new
  `tests/fixtures/p15-heal-preload.cjs` pushes N events into the real `HealingReport` before the run
  (`FALCON_FIXTURE_HEALS`), so the collector is exercised end to end.
- **AC-34 (docs)** is verified by review: the Code Reviewer checks the final docs diff against the code.
- **Fail before.** Every test is written to fail against an empty module first. Security controls
  are proven by mutation, with the red output recorded in the PR: remove CSV neutralisation, the
  allow-list, terminal sanitisation, `textContent`, the Host or token check on `/history`; change the
  500 cap or the 10-run minimum; drop the incomplete exclusion or the lock; replace `execFileSync`
  with `execSync`; let a write failure reach the exit code.
- **Flakiness.** Serve-mode tests wait for a readiness line on port 0 instead of sleeping; lock tests
  use reaped child PIDs and injectable timeouts; permission tests skip explicitly under root; the real
  `data/` directory is checksummed before and after the suite.
- **Hosted-only evidence**, collected in the PR: ledger cache miss then hit across two runs, the step
  summary, `reports/history/` in the artifact, the 90-day artifact on a `main` run and its absence on
  a PR run, and the job's status unchanged when `check` flags.

## 14. Delivery plan

Each task has one owner, a fixed file scope, and an independent check before the next milestone
starts. At most two tasks run at once, and only on disjoint files.

| Task | Owner | Files | Depends on | Criteria |
|---|---|---|---|---|
| **M1 — Record and ledger** | | | | |
| T1 | Developer | `src/core/history/RunRecord.js`, `src/core/history/GitInfo.js`, `tests/regression/p15-record.check.cjs` | — | AC-01, 02, 13, 14, 33 |
| T2 | Developer | `src/core/history/RunLedger.js`, `tests/regression/p15-ledger.check.cjs` | T1 | AC-04–11 |
| V1 | QA + Code Reviewer + Security | read-only | T1, T2 | M1 gate |
| **M2 — Trend, CLI, integration** | | | | |
| T3 | Developer | `src/core/history/TrendDetector.js`, `src/core/util/OutputSafe.js`, `tests/regression/p15-trend.check.cjs`, `tests/regression/p15-export-safety.check.cjs` | T1 | AC-17–19, 22, 23 |
| T4 | Developer | `scripts/history.js`, `falcon.js`, `package.json` (`history:*` scripts only), `tests/fixtures/p15-heal-preload.cjs`, `tests/regression/p15-cli.check.cjs`, `tests/regression/p15-integration.check.cjs` | T2, T3 | AC-03, 12, 15, 16, 20, 21, 35 |
| V2 | QA + Code Reviewer | read-only | T3, T4 | M2 gate |
| **M3 — Dashboard and serve mode** | | | | |
| T5 | Developer | `src/core/Dashboard.js`, `scripts/dashboard.js`, `package.json` (`dashboard` script only, after T4), `src/dashboard/index.html`, `tests/regression/p15-routes.check.cjs`, `tests/regression/browser.spec.js` | T4 | AC-24–27, 32 |
| V3 | QA + Code Reviewer + Security | read-only | T5 | M3 gate |
| **M4 — CI, docs, register** | | | | |
| T6 | DevOps | `.github/workflows/ci.yml` | T4 | AC-28–30 |
| T7 | Technical Writer | `README.md`, `CHANGELOG.md`, `HANDOFF.md`, `.env.example`, `docs/PHASE-PLANS.md`, this file | T4, T5 | AC-34 |
| T8 | QA | `docs/phase-15-acceptance-criteria.json`, `tests/regression/p15-traceability.check.cjs` | T1–T6 | AC-36 |
| **M5 — Verification and release** | | | | |
| V4 | QA | read-only: full gates, mutation evidence, hosted evidence (AC-31) | T6–T8 | M5 gate |
| V5 | Code Reviewer + Security | read-only: whole-branch review | V4 | M5 gate |
| R1 | Release Manager | read-only | V5 | GO / NO-GO |

**Concurrency.** T1 runs alone; T2 and T3 can pair (disjoint files, both need only T1); T4 follows
T2 and T3; T5 follows T4 (both touch `package.json`) and can pair with T6; T7 and T8 can pair.

**Milestone gates.**

- **M1:** record and ledger tests pass; allow-list, lock and corruption handling reviewed by Security;
  no P0/P1 findings.
- **M2:** ten-run and spike acceptance pass through `falcon.js`; exit codes unchanged in every
  fixture mode; CSV and terminal safety proven by mutation.
- **M3:** routes reject missing tokens and foreign hosts; panel XSS case passes in Chromium; serve
  mode passes Security review.
- **M4:** workflow YAML assertions pass; docs match the code; every criterion is registered.
- **M5:** unit, regression and browser suites green; mutation evidence recorded; hosted ledger cache
  miss then hit observed; release decision recorded.

**Critical path:** T1 → T2 → T4 → T5 → V3 → V4 → V5 → R1 (T6 runs alongside T5).

**Dispatch budget.** The repository's full tier allows 16 dispatches. This plan uses 14 (8 build
tasks, 5 verification passes, 1 release decision), leaving 2 for rework, so a third repair round
would need the owner's approval rather than a silent overrun.

## 15. Release gates

**GO requires all of the following, against the final revision:**

- `npm run test:unit`, `npm run test:regression`, `CI=true npm run test:regression` and
  `npm run test:browser` green; every `p15-*` suite included; `npm audit` reports no high or
  critical advisory.
- Mutation evidence recorded in the PR for each control listed in section 13: the test goes red with
  the control removed and green with it restored.
- Hosted evidence (AC-31): a ledger cache miss then a hit across two runs on the branch, with the
  record count growing; `reports/history/` present in the artifact; the advisory step summary
  present; the job status unchanged when `check` flags.
- Verdicts covering the final revision: QA accept, Code Reviewer approve, Security approve (SEC-01 to
  SEC-15), DevOps ready, and a Code Reviewer pass over the final docs diff.
- `p15-traceability` passes with every criterion registered.

**NO-GO:** any failing test, including one that passes only on retry; a missing or unproven security
control; docs that contradict the code; an unregistered criterion; a verdict that covers an older
revision.

**CONDITIONAL GO** is limited to evidence that only exists after merge: the 90-day artifact on a
`main` run (AC-30) and a ten-run trend on `main` itself. Owner: the release manager; checked on the
first `main` run and again after ten.

**Rollout.** Merge after GO. On `main`, history starts empty: the first run misses the cache and the
second hits it; no flag can appear until the eleventh complete run; exports appear in
`reports/history/` from the first run.

**First two weeks on `main`.** The step summary appears on every run and never fails the job; the
record count grows by one per run; incomplete runs stay rare; exports and `/history` contain no
secret or URL; the History panel loads and renders.

**Rollback trigger:** a corrupted ledger that is not recovered, a run whose exit code differs from
before, or flags that fire on runs the team agrees are normal. **Steps:** set `FALCON_RUN_HISTORY=off`
(or revert the merge), remove the history steps from the workflow, delete `data/run_history.json`,
and confirm the next run's exit code matches the pre-Phase-15 behaviour.

## 16. Risks

| Risk | Mitigation |
|---|---|
| False alarms erode trust | Robust median/MAD rules with absolute floors, 10-run minimum, suppression gates, advisory only |
| History silently reset by 7-day cache eviction | Documented; main-only 90-day artifact as a recovery copy |
| Suite growth looks like drift | Rates are normalised; reduced-coverage suppression |
| A poisoned cache on `main` skews flags | Only writers to `main` can affect it; flags never gate anything |
| Phase 16 concurrent writers | One record per logical run from the aggregator; `merge` by `runId` |
| Coverage missing on a crash | The crash path still reads the heal log, but has no coverage; it is recorded as incomplete and excluded from baselines |

## 17. Rollback

Set `FALCON_RUN_HISTORY=off` (append, routes and CLI disabled), or revert the merge. Deleting
`data/run_history.json` is harmless. In CI, removing the history cache, export and check steps is
enough; orphaned caches expire within 7 days. No data migration is involved.
