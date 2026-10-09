# Phase 16 Architecture: Deterministic Parallel Execution and Safe CI Sharding

Status: implemented on the branch and in review, not merged (HEAD 42fac1a); originally written as the CP1 design. Base: branch `phase-16/parallel-execution` at 747d6ec (Phase 15 merged). Risk tier: full. Acceptance register: `docs/phase-16-acceptance-criteria.json` (P16-AC-01..42; security program AC-101..125 are out of scope here except where noted).

## 1. Context and constraints

Falcon runs one browser, one context, and a strictly sequential page loop (`SiteSweep.run` -> `_sweepPage`). Dedupe ownership is decided by execution order (`_seenSignatures`, claims released on page failure). State is held in module singletons, each rewriting a whole file from memory:

| Surface | Writer | Cross-process protection today |
|---|---|---|
| `data/scenario_history.json`, `quarantine_decisions.json` | FlakinessTracker | none (in-process promise queue + atomic rename) |
| `data/healing_pending.json`, `healing_decisions.json` | HealingTrust | none |
| `data/locator_store.json` | LocatorStore (writes also on read: `getAlternatives` touches `lastUsed`) | none |
| `data/locator_memory.json` | LocatorMemory | adjacent `.lock` + expected digest (`LocatorMemoryWriter.write`); fail-closed on conflict; documented residual overlap in `reclaimStale` |
| `data/run_history.json` | RunLedger | same lock/digest, 5 retries; no runId dedupe on append |
| `reports/healing_logs.json` | HealingReport | none, and non-atomic `writeFile` |
| `reports/execution.log` | Logger | append queue, in-process only |
| `reports/test-report.json`, `exit code` | ReportManager (sync fs; sets `process.exitCode`) | n/a |
| `reports/exploratory_test_results.json` | TestRunner.logResults (sync fs) | none |
| `reports/baselines|screenshots|diffs`, `visual-regression.json` | VisualRegression (cwd-relative, read-modify-write summary) | in-process class queue only; not on the falcon.js sweep path |
| `reports/*_error.json` | ErrorHandler | not inspected; Developer must confirm it is unreachable from the sweep path (UNKNOWN) |

Constraints: CommonJS, Node >= 22 (CI 24); sequential default must stay byte-compatible (AC-01); no new runtime dependency; no raw `console.log` in production code (existing `ReportManager` console output is legacy and untouched); `fs.promises` on hot paths; OpenAI/DB stay optional; no uncontrolled external sites; exit codes preserved and tested; LocatorMemory must not be restored across branches (ci.yml comment).

Key code facts that drive the design:
- Tier-2/2.5 reads (`isQuarantined`, `getAlternatives`, `getTrusted`) are cheap in-memory reads of state loaded at require time.
- Singleton mutators are called from inside a page task (`FlakinessTracker.record`, `HealingTrust.recordPending/recordTier3Invocation`, `LocatorStore.getAlternatives`, `LocatorMemory.recordEvidence/recordPendingCandidate`, `HealingReport.log`). Human decisions (`approve/reject/quarantine/rollback`) are called from Dashboard HTTP handlers or review CLIs, never from a page task.
- `TestGenerator` and `PageAnalyser` are DOM-only (no model call), so plan generation is cheap and deterministic for a static page.
- `RunRecord.validateRecord` requires a UUID `runId`.

## 2. Execution flow today

1. `falcon.js` parses args (`--repeat` strict, `--max-pages`/`--budget-ms` lenient), optionally starts Dashboard, launches one Chromium and one context.
2. `SiteSweep.run`: `_discover` (entry page; `_harvestLinks` then ClickExplorer) -> `_plan` (entry first, then discovery order, dedupe by normalized URL, same-origin filter, `maxPages` cut by index) -> loop: budget check between pages -> `_sweepPage`: new page, goto, `DOMIssueScanner`, `TestGenerator`, `_applyDedupe` (claims signatures), `runRepeatedTestPlan`, release unreached claims on throw, close page.
3. `falcon.js` flattens results, emits dashboard events, writes `exploratory_test_results.json`, calls `ReportManager.generateReport` (writes `test-report.json`, sets `process.exitCode` = 0 only for PASSED), then `recordRun` appends one RunLedger record (advisory, never changes exit code).
4. `finally`: `Logger.flush`, browser close, dashboard linger and stop.

Worker completion order is irrelevant today only because there is no concurrency. Introducing concurrency without changes would make dedupe ownership, flakiness history order, eviction, and `lastUsed` depend on timing, and would make two processes lose each other's whole-file rewrites.

## 3. Chosen design

### 3.1 Modes

| Mode | Trigger | Path |
|---|---|---|
| Sequential | no `--workers`, no `--shard`, or `--workers=1` without shard | existing code path, unchanged (legacy discovery order, direct singleton writes) |
| Parallel local | `--workers=N` (N>1) | staged pipeline, in-process scheduler, journal mode, then an in-process merge equal to shard 1/1 |
| Sharded | `--shard=I/N` (with optional `--workers`) | staged pipeline over the shard's pages, journal mode, writes a shard bundle and exits; no report, no canonical state writes |
| Merge | `node falcon.js merge --input=<dir>` | validates bundles, reduces state, publishes the single report, one history record |

"Journal mode" is on iff parallel local or sharded. It is a process-global flag (`ParallelMode.active()`), set by falcon.js before the first page task, never by tests/ui processes.

### 3.2 Staged pipeline (parallel and shard modes)

1. Discover once (one context, as today; `storageState` copied in memory if present, section 3.7).
2. Normalize URLs (`SiteSweep.normalizeUrl`).
3. Assign page ordinals (section 3.3).
4. Analyse: for every eligible page with ordinal < maxPages, run goto + `DOMIssueScanner` + `TestGenerator` with bounded concurrency in its own context. Return a serializable `{ordinal, url, status, reason, uiIssues, scenarios[]}`; close page and context in `finally`. Unreachable (HTTP >= 400 / goto failure) is decided here and recorded exactly as today (failed row `Load <url>`).
5. Dedupe in canonical page order on the coordinator using the same signature (`SiteSweep.signatureOf`). Pure function over the ordered analyses.
6. Assign scenario ordinals = index in the page's generated `test_scenarios` (0-based). Repetition is 1-based.
7. Execute retained plans of the pages assigned to this process with bounded concurrency; each task opens a fresh context and page and re-navigates to the page URL (an extra page load per executed page compared to sequential; documented cost of separating analysis from execution).
8. Merge by (page, scenario, repetition) ordinal.
9. One final report, written only by the merge step.

Every shard performs stages 1-6 for ALL pages (analysis is DOM-only and cheap relative to execution) and executes only its own. This makes dedupe ownership exact and shard-independent: no duplicate executions, no after-the-fact conversion of executed rows. The cost is O(pages) analysis per shard; the benefit is that equivalence with parallel local mode is structural. Divergent analysis between shards (non-deterministic discovery or DOM) is detected, not prevented: each manifest carries `frontierDigest` (sha256 of the ordered eligible URL list) and `planDigest` (sha256 of the ordered per-page signature lists); merge rejects any mismatch.

Dedupe release rule (preserves Phase 10 semantics): a signature is owned by the earliest page, in canonical order, that reached a verdict for it. In stage 5 the plan-time claim is provisional. Since later pages with a deduped row did not execute, plan-time dedupe cannot be undone after the fact. Therefore stage 5 is exact for the normal case; for the failure case the design chooses safety over parity: unreached signatures on a failed owner page produce an explicit failed row on the owner (as today: `Sweep of <url>` failed) and later pages keep `deduped` with `firstRunOn` pointing at the owner. This differs from sequential, where a later page would run the released scenario. Documented difference D-REL; the run still fails (failed row), so no false green. Residual risk R3.

### 3.3 Canonical total order and shard assignment

Eligible set E = unique normalized same-origin (or allowed cross-origin) URLs, as `_plan` computes today. Total order:

1. Ordinal 0 = the normalized entry URL.
2. The remaining URLs sorted ascending by plain string comparison (UTF-16 code unit order; `a < b`, never `localeCompare`). URLs are unique after normalization, so the order is total and independent of discovery timing, machine speed, and locale.
3. `maxPages` truncation applies by ordinal after sorting: ordinal >= maxPages is `skipped` with reason `max-pages` (still present in `pages`). `maxPages` bounds the whole run, not each shard.

Shard assignment: page with ordinal `o` belongs to shard `(o mod N) + 1`. This partitions exactly, balances counts within one page, and is independent of everything but the ordinal. Hash assignment was rejected (uneven for small page counts, no exactness proof beyond collision-freedom). Skipped (`max-pages`) and unreachable pages are still assigned by ordinal so ownership is total; the owning shard reports them.

Compatibility decision D-ORD: sorting changes page order relative to Phase 15 discovery order. It is applied only in parallel/shard modes. Default and `--workers=1` keep discovery order. Consequence: when the frontier exceeds `maxPages`, parallel mode may select different pages than sequential. Equivalence tests (AC-15) use a fixture whose discovery order equals canonical order and frontier <= maxPages; the difference is documented in the CLI help and README.

Discovery decision D-DISC: parallel and shard modes discover with `src/core/parallel/ParallelDiscovery.js`, not the depth-first crawl. It runs the same bounds (two click hops, five candidates per page) breadth-first. Each frontier page is loaded once and its candidates listed; plain anchors (an http(s) `href`, no inline handler, not a bare fragment) are resolved from the attribute, and every other candidate is clicked in its own page. The set found at each level is the union of task results, so it is independent of task timing and of the lane count, which keeps every shard's frontier identical. Other origins are recorded but never opened, links that open a new tab are not followed, and the task count is capped at 400. The sequential path keeps the original crawl. Residual risk: on a site whose anchor click handler sends the browser away from its `href`, the page sets can differ between modes.

Scheduler dispatch order = ordinal order (a shared cursor); completion order is arbitrary and is never used for anything (results are stored by index).

### 3.4 Scheduler (`src/core/parallel/Scheduler.js`)

`runBounded(items, limit, task, {deadline, signal})`: starts `limit` lanes; each lane loops `i = cursor++` until the cursor passes the end or `Date.now() >= deadline`. No `Promise.all` over the item list. Each task runs inside an `AsyncLocalStorage` store `{pageOrdinal, seq counter}` so singleton mutators can attribute events to the task (section 3.5). `finally` closes page and context, clears timers. A task that throws yields a failed result for that ordinal; sibling lanes continue (salvage); the run never exits 0 with a missing verdict (AC-10): the merge requires every assigned ordinal to have a disposition.

Budget semantics (AC-06), stated honestly: `budgetMs` is a scheduling deadline. After the deadline no new task starts; tasks already running finish (in-flight count is bounded by `workers`, in-flight time is bounded only by Playwright timeouts and plan length, so this is not a wall-clock cap); never-started pages are `skipped` with reason `budget-exhausted` (same representation as today); completed verdicts are kept; actual duration is reported. The deadline covers analysis and execution together per process. README/CLI help must not call it a hard cap.

Per-page disposition values in the manifest: `completed`, `budget-exhausted`, `task-failed`, `not-run`. `not-run` on an assigned page fails merge validation; `budget-exhausted` is legitimate.

### 3.5 Cross-process state: journals and coordinator merge

Page tasks never write canonical files. Inside a task (AsyncLocalStorage store present) the singleton mutators divert to `StateJournal.record(type, payload)` instead of mutating canonical state or queueing a write. Outside a task (Dashboard handlers, review CLIs, coordinator) singletons behave exactly as today, so human decisions stay direct and immediate. Reads during a task use the state snapshot loaded at process start (plus any human decision made in the same process); state recorded during the run is not visible to other tasks until merge (documented difference D-VIS; fails closed for trust).

Each page task writes one journal `journals/page-<ordinal>.json` atomically at task end (also on failure, with terminal `task.end`). Tasks in the same process may also hold events in memory until write; a crash loses that task's journal and the manifest then marks the page `task-failed` or `not-run`.

Merge (coordinator-only) algorithm, used identically by parallel local (in-process, as shard 1/1) and by the `merge` command:

1. Validate all inputs (section 6). Any failure: exit before touching anything.
2. Compute `inputDigest` = sha256 over the sorted manifest digests. If `reports/merge/receipts/<runId>.json` exists: same `inputDigest` -> print recorded outcome and exit with the recorded code (idempotent); different digest -> reject.
3. For each store, in fixed order (history, pending, locator_store, locator_memory): read the canonical file fresh, apply the reducer to the events, persist with a digest-guarded write (`LocatorMemoryWriter.write`, retry loop of 5 with back-off, re-reading and re-reducing each attempt, as RunLedger does). Per-entry idempotence marker prevents double application after a crash (section 7).
4. Append the single aggregate history record (deduped by runId).
5. Write `reports/healing_logs.json`, `reports/exploratory_test_results.json`, then `reports/test-report.json` (atomic, deterministic content), then the receipt (marks complete).
6. Delete journals and bundles only after step 5 succeeded. On any failure in 3-5: keep everything, print bounded diagnostics, exit 3 (non-durable). The aggregate report is not published as PASSED if step 3 failed because step 5 comes after.

Crash at any point: re-running merge converges (reducers are idempotent via markers, report is deterministic, receipt written last).

### 3.6 Manifests, fragments, bundle layout

```
<out>/<runId>/shard-<i>-of-<n>/
  manifest.json
  fragments/page-<ordinal>.json      (results, uiIssues, per-page status)
  journals/page-<ordinal>.json
  logs/execution.log                 (private; not merged)
  analysis.json                      (ordered per-page analysis summary for planDigest check)
```
Default `<out>` = `reports/shards`. Local parallel writes to a temp bundle under the same root and merges in-process. Logger.logFilePath is redirected into `logs/` in shard mode before any log call (private logs, no cross-process append).

Manifest (`falcon.shard-manifest`, v1), all fields required unless marked:
`schema`, `v`, `runId`, `shard {index,total}`, `attempt` (int), `commit` (40 hex or `unknown`), `ref` (sanitized branch name, optional), `configFp` (sha256 of canonical JSON of entry URL, maxPages, dedupe, sameOriginOnly, repeat, falcon schema version; workers and budgetMs are excluded), `frontierDigest`, `planDigest`, `pages[]` ({ordinal, url, assigned bool, disposition, fragment {name, bytes, sha256}, journal {name, bytes, sha256, events}}), `exit {code, verdictCounts}`, `timing {startedAt, endedAt, wallMs}`, `limits {workers, budgetMs}`. Every file reference is a bare name matching `^(page)-\d{1,4}\.json$`, never a path.

Run identity: `--run-id=<id>` (required with `--shard`; generated for local parallel). Pattern `^[a-z0-9][a-z0-9-]{5,62}$`. CI passes `gh-${{ github.run_id }}`. The history record uses a UUID derived deterministically from runId (sha256 -> UUID layout) so `RunRecord` validation passes and append is idempotent.

Merge command: `node falcon.js merge --input=<dir> [--expect-total=N]`. Dispatched before dashboard or browser start. Strict arguments (unknown, duplicate, empty, conflicting values exit 2). Exit codes: 0 validated and PASSED; 1 validated, verdict not PASSED (same rule as `ReportManager`: PASSED only; FAILED, PARTIAL, NO_TESTS_RUN are 1); 2 rejected input or usage; 3 state not durable. CLI flag errors in falcon.js itself keep today's convention (exit 1 before dashboard/browser, like `--repeat`).

Shard exit code: 0 unless a verdict is `failed`/`unavailable` or the shard hit an infrastructure error; 1 when a verdict is `failed`/`unavailable` or the shard hits an infrastructure error, 0 otherwise. A shard never applies the run-level NO_TESTS_RUN rule (a shard whose pages were all deduped is fine); the aggregate does. Shards never call `ReportManager.generateReport`; the merge uses a new pure `ReportManager.buildReport(...)` (fixed `runId`, `duration` from manifests, no `Date.now()`, no console, no exit code) with `generateReport` delegating to it so sequential output is unchanged.

Report determinism (AC-14/15): `tests` ordered by (page, scenario, repetition) with deduped rows following the page's executed rows as today; `pages` by ordinal; `healingEvents` by (page, scenario, repetition, seq); fixed key order; no merge-time timestamps. Documented volatile fields: `runId`, `duration`, per-row `duration`, `durationMs`, healing `timestamp`, history timestamps.

### 3.7 Auth state

If discovery establishes `storageState`, the coordinator takes one in-memory copy (cap 1 MiB; over cap -> parallel mode refuses to start with a bounded error) and passes a fresh `structuredClone` to each worker context. Never written to disk by default, never journaled or reported. Mutations (logout, token rotation) are not synchronized across contexts; documented limitation. Page-independence is a user requirement.

### 3.8 Dashboard

Dashboard stays in the coordinator process only (shards run with dashboard off, as CI does). `Dashboard.emit` gains an additive monotonically increasing `seq` on each event. New coordinator events: `runPlan {mode, workers, shard|null, pagesTotal}` and `workerState {configured, active, completed, pending, failed}` emitted at defined points (plan ready, task start, task end, sweep end). Task-originated events (`pageStart`, `pageComplete`, `healingEvent`) pass through the same in-process emitter, so `seq` order is coordinator emit order. `pageStart` index stays 1-based ordinal+1. Developer must verify `_recordSweepEvent` folds interleaved start/complete pairs correctly (R6). Auth, host exposure, rate limits, replay cap (`MAX_EVENTS`), escaping, accessibility, shutdown are untouched; new event types render through the existing escape path. `flakyDetected` is emitted at merge for entries that enter flaky (live per-task emission is suppressed in journal mode).

### 3.9 Visual artifacts and logs

VisualRegression is not on the falcon.js sweep path (it is used from `BaseTest`-style UI tests in their own processes) but writes shared cwd-relative paths with a read-modify-write summary. Decision: reject under parallel mode. The `VisualRegression` constructor throws `VISUAL_REGRESSION_UNSUPPORTED_PARALLEL` when `ParallelMode.active()`; no files or directories are created. A static test asserts the sweep module graph does not require it. Per-worker isolation is deferred (non-goal). `HealingReport._flush` is changed to `writeJsonAtomic` (same content) for the sequential path (closes G9). Logger: private per-shard file; in-process tasks share the existing serialized queue.

## 4. Cross-process state alternatives

| Criterion | A. Advisory locks | B. Private journals + coordinator merge | C. Append-only log + compaction | D. Embedded transactions (SQLite etc.) | E. Coordinator-only mutation (no journals) |
|---|---|---|---|---|---|
| Correctness | Whole-file rewrite still needs read-modify-write under lock; reducer rules still needed | Reducers explicit, order independent | Needs reducers too; replay semantics | Strong, but schema/migration for 8 stores | Correct only if coordinator sees all events |
| Crash recovery | Stale lock reclaim has a documented residual overlap (`reclaimStale`) | Journals survive; merge re-runnable | Torn tail handling | Built in | Events lost if coordinator dies |
| CI shards on separate runners | Not applicable (no shared filesystem) | Works: bundles are artifacts | Needs shared FS | Needs shared DB | Cannot reach shard processes |
| Deadlock / stale lock | Yes | None | Compaction lock | Engine-managed | None |
| Portability | POSIX link/rename semantics | Plain files | Plain files | Native dependency or new service (non-goal) | Plain |
| Complexity | Medium, fragile | Medium, isolated in new module | Medium-high | High | Low but insufficient |
| Performance | Contention at workers>1 | Zero contention in tasks | Good | Good | Good |
| Auditability | Weak | Immutable inputs, receipts | Good | Good | Weak |
| Security surface | Lock file races | Untrusted-input parsing (mitigated by allow-list) | Same | New dependency | Small |
| Migration / rollback | Hard | Additive; delete bundle dir | Format change | Data migration | Trivial |

Decision: B (with E's coordinator-only canonical mutation as its commit step). A fails the multi-runner requirement and keeps a known race; C and D need shared infrastructure or a new dependency (non-goals); E alone cannot serve shards. Existing LocatorMemory/RunLedger locks remain as the coordinator's guard against a concurrent human write (dashboard or CLI) during step 3.

## 5. Journal envelope and per-event allow-list

Envelope (`falcon.journal`, v1), one file per page task:

```
{ "schema":"falcon.journal","v":1,"runId","shard":{"index","total"},"pageOrdinal",
  "commit","configFp","planDigest","snapshotAt":"<ISO run start>",
  "events":[{"seq":1,"id":"<32 hex>","type":"<enum>","scn":<int|null>,"rep":<int|null>,"at":"<ISO ms>","p":{...}}],
  "count":<int>,"digest":"<sha256 of canonical JSON of events>" }
```
`id` = first 32 hex of sha256(`runId|pageOrdinal|scn|rep|type|seq`): stable across retries and replays, independent of timing. `seq` is strictly increasing from 1 within a file. The last event is always `task.end`. Same `id` with a different payload anywhere in the input set = integrity failure (reject). Same `id` and identical payload = duplicate (ignored).

Global event order for reducers: tuple (pageOrdinal, scn ?? -1, rep ?? 0, seq). `at` is informational/volatile and never used for ordering.

| type | payload (all keys required unless marked) | Bounds |
|---|---|---|
| `flakiness.outcome` | `action` in {click,type,select}; `locator`; `status` in {passed,failed}; `outcome` null or "unavailable"; `errorType` null or `^[a-z0-9_-]{1,40}$`; `durationMs` int; `description` | locator <=300 (selector validator), description <=120 sanitized, durationMs 0..3,600,000. URL not carried: key built at merge from the page table |
| `healing.pending` | `original`, `suggested`, `description` | selectors <=300, description <=120 |
| `healing.tier3` | `original` | <=300 |
| `healing.log` | `original`, `resolved` (null ok), `tier` in {LocatorStore,LLM,LocatorMemory,exhausted,...existing tier strings, validated against a fixed list}, `description`, optional `error`, `trust`, `action`, `status`, `reason` | selectors <=300; description <=120; error <=300; reason <=100; all `sanitizeField`-normalized |
| `locatorStore.use` | `original` | <=300 |
| `locatorMemory.evidence` | `identity` (passes `V.identity`), `signature` (passes `V.signature`) | existing validator bounds (signature total bytes per ElementSignature) |
| `locatorMemory.candidate` | `identity`, `candidate` (passes `V.proposal`), `baseRevision` (hex64 or null) | candidate <=12,000 bytes, evidence <=8,192 bytes (existing); payload cap for this event type is 20,448 bytes |
| `task.end` | `status` in {ok,failed}, `eventCount` int | must equal `count - 1` |

Never allowed anywhere (journal, manifest, fragment): raw DOM or page text beyond the labeled fields above, cookies, storageState, authorization or headers, input values (`scenario.value`), env values, API keys, userinfo in URLs, stack traces, free-form error text beyond the capped sanitized fields. Unknown keys at any level, `__proto__`/`prototype`/`constructor` keys, non-finite numbers, control characters, and unknown event types are rejected. Workers cannot emit decision events (`approve`, `reject`, `quarantine`, `unquarantine`, `rollback`, `locatorStore.add`): these types are not in the enum (AC-29).

## 6. Numeric bounds (proposals for Security and QA to confirm; each has a max/max+1 test)

| Item | Limit |
|---|---|
| `--workers` | integer 1..16, default 1 |
| `--shard=I/N` | N 1..64, I 1..N; one occurrence only |
| Flag value echoed in error | first 40 characters, sanitized; whole message <=300 chars |
| `runId` | `^[a-z0-9][a-z0-9-]{5,62}$` (6..63 chars) |
| Pages per parallel/shard run (`maxPages` ceiling) | 1000 (sequential unchanged) |
| Manifest | <=256 KiB, depth <=6, arrays <=1000, strings <=2048, keys <=64 chars |
| Fragment (per page) | <=1 MiB; <=2000 result rows; error text <=500 chars; uiIssues <=200 items, each <=1 KiB |
| Journal (per page task) | <=2 MiB, <=5000 events, payload <=8 KiB, depth <=6, arrays <=50, strings <=2048 unless table says less |
| Files per shard dir | <=2200 (pages x 2 + fixed) |
| Per-shard total | <=64 MiB |
| Whole merge input | <=1 GiB total, <=250,000 events |
| Merged report | <=64 MiB |
| In-memory `storageState` copy | <=1 MiB |
| Per-entry applied-run markers | 8 runIds, FIFO |
| Canonical store caps after merge | unchanged: scenarios 500 (history 20 each), decisions 500, pending 200, locator_store 500 selectors x 5 alternatives, LocatorMemory 500 identities / 8 MiB / rejections 500 |
| Merge write retries | 5 attempts, jittered back-off (as RunLedger) |

Readers use bounded reads (`fstat` size check then capped read, like `readBoundedSync`), open with `O_NOFOLLOW`, `lstat` first, refuse symlinks and non-regular files, resolve every path from `realpath(trustedRoot)` + a name matching the fixed pattern and require the result to stay under the root. Files created 0600, directories 0700.

## 7. Reducers (all pure: `reduce(canonicalFresh, orderedEvents, runId) -> newCanonical + conflicts[]`)

Common rules: events sorted by the global tuple; duplicates by `id` dropped; per-entry marker `appliedRunIds` (FIFO 8; envelope-level `mergedRuns` for LocatorMemory) makes re-application a no-op; caps applied once after the merge; eviction orders by value derived from events/entries, never by arrival; ties break by ascending key using code-unit comparison.

### 7.1 Flakiness (`scenario_history.json`)
Key = `keyFor({url from page table, action, locator})`.

| Situation | Rule |
|---|---|
| Event id already in entry history (`eventId` field on history items, additive) | skip (no retry inflation) |
| New outcome | append `{status, timestamp: at, duration, errorType, outcome, eventId}` in global order after existing items |
| History > 20 | keep newest 20 by position, after all appends |
| Classification | recompute with `classify()` on final history |
| `flakySince` | entering flaky with no valid value: earliest `at` among this key's events in the batch that made the entry flaky (volatile); leaving flaky -> null |
| `quarantined` | never changed by events; forced to the latest ledger decision (existing reconcile) |
| Entry count > 500 | evict unprotected by (`lastUsed` asc, key asc); `lastUsed` = max(existing, max event `at`); protected = quarantined or ledger quarantine |
| `skipped` outcomes | never recorded (as today) |

### 7.2 Quarantine and healing decisions (`quarantine_decisions.json`, `healing_decisions.json`)
Merge appends nothing. Workers cannot emit decisions. Canonical ledgers are read fresh at merge time and left byte-unchanged, so a human decision made during the run (Dashboard in the coordinator process, or a CLI) is never overwritten. Newer valid decision wins by the existing ledger fold (last row in array order). Rows are immutable and attributed (`by`/`decidedBy`, `at`). A concurrent human write during merge is caught by the digest guard and the reducer is re-run on the fresh file.

### 7.3 Healing pending (`healing_pending.json`)

| Situation | Rule |
|---|---|
| `healing.pending` for `original`, no entry | create: `firstSeen` = min event `at`, `lastSeen` = max, `occurrences` = distinct event ids, `tier3Invocations` = 1 + distinct `healing.tier3` ids for that original |
| Entry exists | `firstSeen` = min(existing, events); `lastSeen` = max; `occurrences += distinct new ids`; `suggested`/`description` from the last event in global order (non-empty description only) |
| `healing.tier3` with no entry and no pending event | no-op (as today) |
| `previouslyRejected` | re-derived from the fresh decisions ledger (`_rejectionIndex` fold); stored value is a cache only |
| A decision ledger row rejects the same (original, suggested) after `snapshotAt` | the entry is still created (pending, flagged `previouslyRejected`), never auto-approved |
| > 200 entries | evict by (`lastSeen` asc, key asc), logged once (existing helper) |
| Keys `__proto__` etc. | written with `Object.defineProperty` helpers only |

### 7.4 LocatorStore (`locator_store.json`)

| Situation | Rule |
|---|---|
| `locatorStore.use` for existing key | `lastUsed = max(existing, event at epoch)`; no other change |
| `use` for absent key | ignored |
| Alternative union (pure reducer function, exercised with synthetic add inputs from the coordinator side only; never from worker journals) | union preserving existing order, append new in global order, drop oldest by position beyond 5 |
| > 500 selectors | evict by (`lastUsed` asc, key asc) |
| Legacy shape | migrated as `_loadSync` does |

### 7.5 LocatorMemory (`locator_memory.json`)
Merge never combines two canonical versions; it layers events on the single fresh canonical read. Authority order: human decision in canonical > ground-truth evidence event > candidate event. The merge never raises the trust of an existing entry.

| # | Canonical entry E | Event(s) | Result | Conflict note |
|---|---|---|---|---|
| 1 | absent | evidence | create `trusted` (same as sequential first sight); firstSeen min, lastSeen max | none |
| 2 | absent | candidate only | create `unproven`, pendingCandidate = last candidate in global order; occurrences = distinct ids of that proposalId | none |
| 3 | trusted | evidence | refresh `signature`/`lastSeen` from the last valid evidence event; trust, approvedAlternative, history unchanged | none |
| 4 | trusted | candidate, proposalId equals `approvedAlternative.proposalId` | no-op | none |
| 5 | trusted | candidate, other proposal | set pendingCandidate (merge occurrences/firstSeen/lastSeen); trust unchanged | none |
| 6 | unproven | evidence | trust stays `unproven`; signature not installed | `evidence_on_unproven_deferred` |
| 7 | unproven | candidate | update pendingCandidate as row 5 | none |
| 8 | revoked | evidence | ignored (revoked identity regains trust only through a sequential `recordEvidence`) | `evidence_on_revoked_ignored` |
| 9 | revoked | candidate | ignored | `candidate_on_revoked_ignored` |
| 10 | any | event whose entry has a human decision (approve, reject, rollback) in `decisionHistory` with `at` > `snapshotAt` | event dropped as stale; a stale proposal cannot approve or replace a newer revision | `stale_after_decision` |
| 11 | any | two candidates, different proposalIds | last in global order wins; others discarded | `candidate_superseded` |
| 12 | trusted, but `revocationHistory` last `at` is later than the last approve in `decisionHistory`, or timestamps unparseable/equal | treat as `revoked` (fail closed to not-approved), persist `trust:"revoked"` only through the LocatorMemory API path that already records a revocation row; if that is not possible, leave file unchanged and report | `revocation_conflict_failed_closed` |
| 13 | blocked envelope (schema/salt/oversize) | any | no write, original preserved; merge reports non-durable (exit 3) | `envelope_blocked` |

Merge never calls `approve`/`reject`/`rollback`; it uses a new `LocatorMemory.applyMerge(events, runId)` that reuses `_classifyEntry`, validators, eviction (`MAX_TRACKED_IDENTITIES`, 8 MiB), and one digest-guarded `_writeState`. Rejection ledger and `legacy` are untouched. Envelope gains additive `mergedRuns` (<=8). `_toPersistable`/`_reload` must preserve it.

### 7.6 Healing logs (`reports/healing_logs.json`, report `healingEvents`)
Union by event id, global order, written atomically by the coordinator from this run's events (same "this run only" semantics as the sequential file). Retry-safe by id; a re-run of merge produces the same bytes. Sequential path keeps its in-memory array, with the flush made atomic.

### 7.7 Run history
Exactly one record per run, built once by the merge from the merged report, merged healing log, post-merge pending depth and quarantine count, `repeat`, and `durationMs` = max shard wall plus merge time (volatile). `runId` is the deterministic UUID derived from the run identity; `RunLedger.append` gains an early no-op when the runId already exists (idempotent). Shards never append. `FALCON_RUN_HISTORY=off` is honored. History failure never changes the exit code (SEC-11 unchanged).

### 7.8 Visual artifacts and logs
Rejected under journal mode (section 3.9). Per-shard `execution.log` is private and uploaded, not merged. `exploratory_test_results.json` is written by the merge only (shards skip `logResults`).

## 8. Trust boundaries

| Boundary | Trusted side | Untrusted input | Control |
|---|---|---|---|
| Page DOM -> plan -> journal | coordinator | element text, selectors, error text | allow-list payloads, caps, `sanitizeField`, selector validator, no raw text |
| Shard bundle -> merge | merge process | every file in the input dir (may come from an artifact download) | strict schema, size/depth bounds, sha256 in manifest, name pattern, realpath + `O_NOFOLLOW`, no path from content |
| Worker -> canonical state | reducers | events | workers cannot emit decisions; evidence/candidate rules in 7.5; fail-closed |
| Human decision (Dashboard/CLI) -> canonical | stores | HTTP payloads | unchanged auth; merge re-reads fresh and uses digest guard so it never overwrites a decision |
| Branch A state -> branch B | n/a | cached `data/` | `locator_memory.json` stays out of CI cache; manifests carry commit/ref/config identity; mixed identity is rejected |
| CI shard job -> aggregate job | aggregate | shard artifacts | unique artifact names, validation, no secrets needed by aggregate beyond what shards used |
| Dashboard | coordinator | browser clients | unchanged; `seq` additive |

## 9. Failure matrix

| Failure | Detection | Behaviour | Exit | State |
|---|---|---|---|---|
| Invalid/duplicate/conflicting `--workers`/`--shard` | arg parser | bounded message, before dashboard/browser | 1 | none |
| Page task throws/context creation fails | scheduler | failed row for page, siblings continue, disposition `task-failed` | run result FAILED/PARTIAL -> 1 | journal for that task written if possible |
| Worker/process crash (no journal) | manifest disposition, or no manifest | assigned page `not-run` -> merge rejection | 2 | inputs preserved |
| Budget deadline | scheduler | stop dequeuing; in-flight finish; `budget-exhausted` rows | per verdict | normal merge |
| Missing shard | merge (index set vs total) | reject | 2 | nothing mutated |
| Duplicate shard index | merge | reject | 2 | |
| Mixed runId/total/commit/configFp/frontierDigest/planDigest | merge | reject | 2 | |
| Duplicate/missing page ownership, bad ordinal/status | merge | reject | 2 | |
| Unknown/future schema, oversized, malformed JSON, traversal, symlink, hash mismatch | merge reader | reject, bounded sanitized diagnostics | 2 | inputs preserved |
| Same event id, different payload | merge | reject | 2 | |
| Truncated journal (no `task.end`, count/digest mismatch) | merge | reject | 2 | |
| Revocation / stale / blocked envelope | reducer | fail closed per entry, listed in `stateMerge.conflicts` (bounded) | per verdict; `envelope_blocked` -> 3 | |
| Concurrent human write during merge | digest guard conflict | re-read, re-reduce, retry (5) then fail | 3 | journals kept |
| Persist failure (disk full, permission) | `writeJsonAtomic` result | no report published, journals kept, non-durable message | 3 | markers make retry safe |
| Crash mid-merge | rerun | converges; receipt absent so reduction re-runs, markers prevent double counting | n/a | |
| Merge re-run after success | receipt | no-op, same recorded exit | recorded | |
| History append fails | RunLedger result | warning only | unchanged | merge still complete |
| Dashboard fails to start | existing | continue without | unchanged | |
| `storageState` over cap | coordinator | refuse parallel start | 1 | |
| `VisualRegression` used under journal mode | constructor | throws unsupported error | per caller | no files written |

Observability: bounded `Logger.info/warning/error` lines per stage (counts only), a `stateMerge` block in the report (`eventsApplied`, `duplicates`, `conflicts[<=50]`), the receipt file, and the per-shard manifest. No raw payloads in logs.

## 10. Compatibility, migration, rollback

- Default behaviour: untouched code path; report gains only additive fields when parallel (`execution {mode, workers, shard}`, `stateMerge`). Sequential report shape unchanged (AC-01).
- Additive file fields: history items `eventId`, entries `appliedRunIds`, LocatorMemory `mergedRuns`. Older Falcon builds ignore unknown history/pending fields; LocatorMemory is the exception because `_classifyEntry`/envelope handling rebuild known fields only, so an older build would drop `mergedRuns` (harmless: markers only guard replay).
- No data migration. `RunLedger` gains a runId-exists no-op; `HealingReport` flush becomes atomic; `ReportManager.buildReport` extracted; `Dashboard.emit` adds `seq`.
- CI: shard jobs restore state read-only (never save), upload unique `falcon-shard-<i>-of-<n>` bundles; the `if: always()` aggregate job downloads all, runs `merge --expect-total=N`, uploads the report, and is the only job saving the state cache (on success). `locator_memory.json` remains excluded. Re-run of a failed shard job uploads a bundle with `attempt` incremented; the aggregate keeps only the latest attempt per index and rejects duplicates of the same attempt.
- Rollback: stop passing `--workers`/`--shard` (or revert the merge) and Falcon runs the sequential path; canonical files are valid for the old build. Orphan bundles (`reports/shards`, `reports/merge`) are deletable. Rollback test (AC-41): merge then run sequential and compare canonical state with the pre-merge expectation; delete bundles and confirm no behaviour change.

## 11. Test seams mapped to acceptance criteria

| Seam / test file (proposed under `tests/regression/*.check.cjs`) | ACs |
|---|---|
| `Phase16Cli`: arg parser unit (pure `parseParallelArgs`), spawn falcon.js for invalid values, assert exit code, no dashboard/browser, message length/echo | 01, 02, 03 |
| `Phase16Planning`: `assignOrdinals`, `shardOf`, canonical sort, property test partition for random frontiers and N 1..64 | 04, 11 |
| `Phase16Dedupe`: pure `dedupeInOrder` with reversed completion orders and failed-owner case | 05 |
| `Phase16Scheduler`: fake tasks, max active counter, reverse completion, deadline, cleanup spies, timers/handles | 06, 07, 08, 10 |
| `Phase16Auth`: stub context factory, `storageState` clone and size cap, no file written | 09 |
| `Phase16Manifest`: writer/reader, max and max+1 size | 12, 28 |
| `Phase16MergeReject`: fixture bundles for each rejection class; assert exit 2, no canonical change, inputs preserved | 13, 27, 28 |
| `Phase16MergeDeterminism`: shuffle input order, byte-compare report; sequential vs parallel vs sharded on the local fixture with volatile fields stripped | 14, 15, 16 |
| `Phase16Journal`: schema allow-list, canary values per disallowed class, prototype keys, non-finite numbers, bounds at max and max+1 | 17, 28, 30 |
| `Phase16MergeIdempotence`: replay, reverse order, duplicate, injected crash between each step, persist failure leaves journals and exit 3 | 18, 25 |
| `Phase16Reducers`: one test per row of 7.1, 7.3, 7.4, 7.6 | 19, 20, 21, 22, 24 |
| `Phase16LocatorMemory`: one test per row 1..13 of 7.5 | 23, 29 |
| `Phase16Visual`: two simulated workers constructing VisualRegression with the same name; static module-graph check | 26 |
| `Phase16Dashboard`: real Dashboard with socket client; counts at event points, strictly increasing `seq`; existing `DashboardAuth` check unchanged | 31, 32 |
| `Phase16Bench` (script, not a CI gate): local fixture >=8 pages, delay, workers 1/2/4 | 33, 34 |
| Workflow static test + hosted run (matrix, missing-shard negative job, SHA pinning, permissions, cache paths) | 35, 36, 37 |
| `Phase16Docs`: flags in docs checked against parser; architecture checklist | 38, 39 |
| `Phase16Traceability` with negative control | 40 |
| `Phase16Rollback` | 41 |
| Release evidence (review verdicts) | 42 |
| Browser test (`playwright.regression.config.js`): workers 2 and 4 on the fixture, real contexts, leak check | 07, 08, 15, 31 |

Injection seams: `StateJournal` path and clock, `ParallelMode`, scheduler `now()`, store file paths (existing test seams), `RunLedger` filePath option, fault hook in the merge step runner (`beforeStep(name)`).

## 12. Residual risk

- R1 Canonical order differs from Phase 15 order when the frontier exceeds `maxPages`.
- R2 Shard discovery/DOM nondeterminism causes merge rejection (detected, honest, but can make CI red on unstable apps).
- R3 Failed owner page: later duplicate pages stay `deduped` (D-REL), unlike sequential release; the run still fails.
- R4 Evidence recorded in a run is not usable for trust until merge; trust of revoked/unproven identities is regained only through a sequential run.
- R5 Description, error and page URL (with query) still reach fragments/journals within caps; Security must rule on redaction.
- R6 Dashboard coverage fold with interleaved events needs verification.
- R7 In-flight work after the deadline has no time bound.
- R8 Extra navigation per executed page lowers speedup; thresholds are evidence only.
- R9 ErrorHandler reachability UNKNOWN.
- R10 Numeric bounds are proposals.

## 13. ADR-016: Private journals reconciled by a coordinator-only merge

Status: proposed. Context: concurrent page tasks and multi-runner shards cannot safely rewrite shared whole-file state; in-process promise queues give no cross-process guarantee; locks do not span runners. Decision: page tasks emit bounded, allow-listed, immutable, event-id-stable journals; a single coordinator (local or `merge`) validates, reduces per store with pure idempotent reducers against fresh canonical state, persists with digest-guarded atomic writes, publishes one report and one history record, writes a receipt, then deletes inputs. Every shard analyses all pages and executes only its ordinal-modulo share so dedupe is exact. Consequences: no cross-process locking in the hot path; additive markers in state files; a new module tree (`src/core/parallel/`, `StateJournal`, `ShardMerge`); trust never rises during merge; one documented ordering change in parallel modes. Rejected: advisory locks, append-only log, embedded database, coordinator-only without journals.
