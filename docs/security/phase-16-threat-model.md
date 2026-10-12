# Phase 16 Threat Model: Parallel Execution

Revision: branch phase-16/parallel-execution @ 747d6ec (design-time; current head cebd31f). Status: design-time. Owner: Security Engineer. Covers P16-AC-27..30 and P16-AC-101..125.
Evidence labels: CONFIRMED = observed in code at the cited file:line. HYPOTHESIS = plausible, not demonstrated.
No secret values appear in this document or are needed to verify it.

## 1. Scope and method

Phase 16 adds parallel workers and shards, per-worker journals, manifests, a merger and an aggregate output, plus the existing GitHub security checks (code scanning, secret scanning) and `npm audit` in CI. This model maps assets, actors, entry points and trust boundaries, then threats with a control, a verifying test and an owner for each. It ends with the weaknesses already in the code that parallelism would amplify.

Owners: DEV = Developer, SEC = Security Engineer, DEVOPS = DevOps/CI owner, QA = Test Engineer, HUMAN = repository owner (the only role that can accept risk).

## 2. Assets

| ID | Asset | Where it lives | Sensitivity |
|---|---|---|---|
| A1 | Secrets: DASHBOARD_TOKEN, OPENAI_API_KEY, DB creds | env, ci.yml:57, Dashboard.js:107 | Critical |
| A2 | Healing state: pending, decisions, approved locators | data/healing_*.json, data/locator_store.json | High (integrity) |
| A3 | Quarantine and flakiness state | data/quarantine_decisions.json, data/scenario_history.json | Medium (integrity) |
| A4 | Locator memory: trusted, unproven, revoked evidence | data/locator_memory.json, .lock file | High (integrity) |
| A5 | Run history ledger | data/run_history.json | Medium |
| A6 | Reports, artifacts, caches, logs | reports/, allure-results/, reports/execution.log, GitHub caches and artifacts | Medium (can leak A1) |
| A7 | Browser auth state, cookies, storage | per-context storage | High |
| A8 | Phase 16 journals, manifests, fragments, aggregate output | new | High (integrity); the pass/fail verdict is the product |
| A9 | GitHub permissions and cache/artifact scopes | ci.yml `permissions: contents: read` | High |
| A10 | Host resources: CPU, memory, disk, processes, ports | runner or developer machine | Medium (availability) |

## 3. Actors, entry points, trust boundaries

Actors:
- Trusted: the maintainer/user; the CI runner running the pinned workflow; the coordinator process (falcon.js).
- Semi-trusted: workers, shards and the merger. They are the same code, but a worker can be buggy, killed, retried or stale.
- Untrusted: the app under test and its pages; PRs, branch names and forks; downloaded artifacts and caches; compromised dependencies; stale or retried workers; any actor able to upload an artifact or write into a shared directory.

Entry points:
- CLI args and environment: falcon.js:375-408 (`--repeat`, `--shard`, `DASHBOARD_*`, `FALCON_*`).
- Dashboard HTTP and socket: POST /emit, /healing/approve, /healing/reject, /locator/*; socket.io handshake (Dashboard.js:526-861).
- Files read at startup: every `data/*.json`, worker journals, manifests, fragments, restored caches.
- Page content: selectors, attributes, URLs and error text from the app under test.
- Git/CI environment: GITHUB_REF_NAME, GITHUB_SHA, branch names (GitInfo.js:34-46).
- Downloaded artifacts and caches (merge inputs).
- Child processes: `git` via execFileSync with fixed argv; any new worker spawn.

Trust boundaries:
- TB1: app-under-test to Falcon (all page data is hostile).
- TB2: worker/shard to coordinator and merger (workers cannot approve or elevate).
- TB3: filesystem and cache/artifact to process (any file may be stale, forged or symlinked).
- TB4: network client to Dashboard (token, Host/Origin, rate limit).
- TB5: PR/fork/branch to CI (secrets, caches, artifacts).
- TB6: branch A state to branch B (no trust inheritance).
- TB7: dependency/install-time to runtime (install scripts, lockfile, image digest).

## 4. Threats, controls, verification, owner

Common to all threats: any failure to persist, parse or validate is reported as failed, never as durable or green. A missing or unverifiable input fails the aggregate closed. Each test idea below is to be written as an automated test, and each must fail on the unfixed behavior (the repository regression-test rule).

| # | Threat | Control (requirement) | Verifying test idea | Owner | AC |
|---|---|---|---|---|---|
| T1 | Path traversal via run/shard/worker id | Ids must match `^[A-Za-z0-9_-]{1,32}$`. Raw ids never form paths; use derived ids (index or hash). Resolve under a fixed trusted root and check containment with `path.relative`. | Feed `../x`, absolute paths, `a/b`, NUL, over-length and unicode ids. Assert rejection and no file outside the root. | DEV/QA | 27 |
| T2 | Symlink and zip-slip when extracting artifacts | Prefer no extraction; if unavoidable, refuse symlink/hardlink entries, absolute paths, `..` and duplicate names. Cap file count and bytes. Use `lstat`, `O_NOFOLLOW` where available, and `wx` creates. | Craft an archive with a symlink entry, a `../` entry and a bomb. Assert rejection and a clean temp dir. Plant a symlink at a journal path and assert refusal. | DEV | 27, 28 |
| T3 | Prototype pollution from JSON | Allow-list schemas. Reject `__proto__`, `prototype` and `constructor` keys at any depth. Use `Object.create(null)` for maps and `Object.hasOwn` for lookups; never deep-merge untrusted input. | Journals containing the three keys at nested levels. Assert rejection and `({}).polluted === undefined`. | DEV/QA | 28 |
| T4 | Malformed, oversized or deeply nested JSON | Numeric constants for bytes, depth, array length, string length, event count and fragment count. Read through a bounded reader that checks `fstat` size and the actual bytes read. Reject non-finite numbers and invalid UTF-8. | For each limit: accept max, reject max+1. Add a 10k-deep nesting case. | DEV/QA | 28 |
| T5 | Duplicate replay or event collision | Each event has a unique id (worker + monotonic sequence). The merger dedupes by id, and a replayed event cannot change counts or trust. Conflicting content under one id marks the shard invalid. | Replay the same journal twice. Assert counts are unchanged and trust is not raised. Inject two different events with one id. Assert failure. | DEV/QA | 29 |
| T6 | Shard spoofing | The manifest declares `shardCount`, expected shard ids and the run id. Each fragment binds `runId`, `shardId` and `configHash` and is verified against the manifest. Unknown or extra shards are rejected. | Submit a fragment claiming another shard id, or a shard index above the count. Assert the merge fails. | DEV | 27, 29 |
| T7 | Mixed run, commit or config injection | The merger requires one `runId`, one commit SHA and one config hash across all fragments. Any mismatch fails the aggregate. | Mix a fragment from run B, or from another SHA, into run A. Assert failure and no aggregate written. | DEV/QA | 29 |
| T8 | Missing or duplicate shard causes a false green | Aggregate verdict is green only if the set of valid fragments exactly equals the expected set. Missing, duplicate, empty or truncated shards cause a non-zero exit. A zero-test shard is not a pass. | Drop one shard, duplicate one, and truncate one. Assert exit code != 0 and the aggregate is not green. | DEV/QA | 29 |
| T9 | Order manipulation (reordered or substituted events) | Sequence numbers are contiguous per worker. Aggregate ordering is derived deterministically from ids, not file mtime or arrival order. | Shuffle the events and swap two. Assert gap or ordering detection and deterministic output. | DEV | 28 |
| T10 | Rollback to an old state or manifest | Manifests carry runId and a creation nonce. Reject files older than the run start, or from a different run. State files keep the digest check (LocatorMemoryWriter `write` expected-digest). | Present a previous run's manifest. Assert rejection. Restore an old locator_memory.json and assert the write conflicts. | DEV | 29 |
| T11 | Approval/revocation conflict | Only the coordinator process can apply approve/revoke. Workers can only propose. A revocation always wins and fails closed on conflict. Approval is bound to a proposal id and revision (see W-3). | Concurrent approve and revoke of one entry. Assert the final state is revoked. Approve a stale proposal and assert refusal. | DEV/SEC | 29 |
| T12 | Cache or artifact poisoning | Never restore locator memory or quarantine state across branches for trust decisions. Treat restored files as untrusted and validate them against the schema. Do not execute anything from caches or artifacts. Keep the locator memory exclusion from ci.yml:~170-200. | Plant a forged cache file with trusted entries. Assert the entries load as unproven or are rejected. | DEVOPS/DEV | 29, 118 |
| T13 | Branch trust inheritance | Met by scoping, not by new approval rules. CI state caches are keyed per branch (`github.ref_name`) by the platform and the workflow; a PR run can read the default branch cache but cannot write it; the aggregate save runs only on the default branch for non-fork runs; `locator_memory.json` is never cached. Journals carry runId, commit and configFp, and the merge is bound with `--expect-run-id` and `--expect-commit`. Approval semantics are unchanged. Residual risk: local developer copies of `data/` shared between branches by hand; documented, and accepted only when the owner says so. | Static test on `ci.yml` (branch ref in every cache key, no `locator_memory.json` in any cache path, restricted aggregate save): `tests/regression/p16-gaps.check.cjs`. | DEV/SEC | 29 |
| T14 | Secret or LLM-key leakage | Keys only via environment, never in argv, files, logs or artifacts. Redact secrets in Logger (see W-5). Forks never receive secrets. Scrub canaries in journals, manifests and reports. | Plant a canary in env and in page data. Grep journals, manifests, reports, logs and uploaded artifacts for it; assert absent. Lint the workflow for token in `run:` args. | SEC/DEVOPS | 30, 102, 111, 119 |
| T15 | Shell, HTML and log injection | Use `spawn`/`execFile` argument arrays only. Escape on output (`textContent`, `sanitizeField`). Never interpolate branch names or artifact data into a shell string or `${{ }}` in a `run:` block. | Branch named `$(touch PWN)` and `"; rm`. Assert no side effects. Journal with ANSI, CR/LF and `<script>`. Assert escaped output. | DEV/DEVOPS | 28 |
| T16 | Worker, browser, file and temp exhaustion | Hard caps on workers, contexts, shards, retries, open files, temp bytes and runtime. Close contexts in `finally`. Kill process groups on timeout. Remove temp dirs on exit and on crash recovery. | Request N+1 workers and assert rejection. Kill a worker and assert no orphan process or temp dir. | DEV/QA | 28 |
| T17 | Stale lock | Implemented. Locks carry pid, host and creation time. pid probing reclaims only when the recorded host equals the current host and the pid is dead. A lock from another host is never reclaimed; the write fails closed with `LOCK_FOREIGN_HOST` and no canonical change. A lock with no usable owner is reclaimed only after a 60 s grace. Legacy locks with a pid but no host still use the same-host pid probe. | `tests/regression/p16-lock-host.check.cjs` (foreign host with dead pid, same-host dead pid, live pid, legacy grace, RunLedger) and `locator-lock-recovery.check.cjs`. | DEV | 29 |
| T18 | TOCTOU file replacement | Open then `fstat` on the descriptor (never stat-then-open). Create with `wx`. Write to a temp file in the same directory, then rename. Re-verify identity after the rename where possible. | Swap a file for a symlink between check and use via a test hook. Assert refusal. | DEV | 27 |
| T19 | Partial canonical writes | Write via temp + rename only. Fsync before the rename for canonical files. Report `ok:false` on failure and never claim durability. Readers reject truncated files. | Inject a write failure after temp creation. Assert the canonical file is unchanged and the result is `ok:false`. | DEV | 28 |
| T20 | Malicious URLs or error text | Validate the origin and protocol (http/https) of recorded URLs. Strip credentials and query strings from stored URLs. Bound and sanitize error text before it enters journals or logs. | URL with userinfo, `javascript:` and a 1 MB error string. Assert rejection or truncation. | DEV | 28 |
| T21 | Dependency install scripts, supply chain | Review each new dependency (publisher, scripts, license, typo-squat). Lockfile consistent, `npm ci` clean. Prefer no new runtime dependency. No scanning tool is installed in CI. | `npm ci --ignore-scripts` comparison. Diff of the lockfile. Code scanning and npm audit gates. | SEC/DEVOPS | 101, 103 |
| T22 | Mutable images and unpinned actions | Pin the postgres service image by digest (ci.yml:75 uses a tag). Pin all actions to full SHAs (already true for existing actions). Image vulnerability status is not scanned in this phase. | CI lint that rejects `image:` without `@sha256:` and `uses:` without a 40-hex SHA. | DEVOPS | 117, 123 |
| T23 | Dashboard abuse by a worker or remote client | Keep token auth, timing-safe compare, rate limits, Host/Origin checks, socket auth and the replay cap. Add an event-name allow-list and payload bounds (see W-1, W-2). | Existing tests/unit/DashboardAuth.check.js plus unknown event names, oversized payloads and forged `healingApproved`. | DEV/QA | 29 |
| T24 | Fork or PR runs obtain secrets | Workflows reference no secrets beyond the existing test job. No `pull_request_target` with fork code. | Workflow lint for `pull_request_target` and secret use under fork conditions. | DEVOPS/SEC | 111, 112 |
| T25 | Workflow permissions and cache scope | Minimum `permissions` per job. The security job gets `contents: read` only. Cache keys that include the branch. Uploads use bounded retention and unique names. | Workflow lint for permissions and retention. | DEVOPS | 115, 119 |

## 5. Secure implementation requirements (security program section 6 mapping)

- Identity, path and containment: T1, T2, T18. Permissions and atomic writes: T18, T19.
- Bounds: T4, T16. Schema allow-lists and pollution: T3. No executable data or dynamic evaluation: T15.
- Argument arrays and process bounds: T15, T16. Healing and trust rules: T5, T11, T13 (AC-29).
- Preserve dashboard auth, host, rate limit, CORS, socket auth, escaping, replay bound and shutdown timeout: T23.
- New dependency review: T21.

## 6. Existing controls worth keeping (confirmed good)

- Dashboard: timing-safe token compare via SHA-256 digests (Dashboard.js:433-441), Host/Origin check including DNS-rebinding, refusal to bind non-loopback without a token (Dashboard.js:499-506), HttpOnly SameSite=Strict cookie (Dashboard.js:550), rate limits on HTTP and socket, socket auth, replay cap MAX_EVENTS=20000 (Dashboard.js:22).
- AtomicJsonStore.writeJsonAtomic: temp file with `wx` and mode 0o600, then rename (AtomicJsonStore.js:140-146); never rejects; failure tracking.
- RunLedger: `lstat` symlink refusal and a size cap (RunLedger.js:195-203). GitInfo: `execFileSync` with fixed argv, timeout and bounded buffer (GitInfo.js:19-30); `sanitiseBranch` allow-list (RunRecord.js:151).
- LocatorMemory: bounded read through an open descriptor and `fstat` (LocatorMemoryWriter.js `readBoundedSync`), digest check, exclusive lock, strict evidence validation with `Object.create(null)` and key allow-lists (LocatorMemoryValidation.js).
- HealingTrust: `Object.hasOwn` and `defineProperty` for pending keys against `__proto__` (HealingTrust.js:~139-156).
- CI: actions pinned by SHA, `permissions: contents: read`, timeouts, locator memory excluded from the cross-run cache with the reasoning documented in ci.yml.

## 7. Pre-existing weaknesses that Phase 16 would amplify

Severity is provisional pending Security Engineer triage; none was exploited.

### Confirmed

- W-1 (Medium): Dashboard accepts any event name and payload. POST /emit forwards `name` and `payload` unchanged (Dashboard.js:566-575), and `emit()` stores them (Dashboard.js:876) and broadcasts. `express.json()` uses the default limit (Dashboard.js:526). Any holder of the token, or any local process when no token is set, can forge events such as `healingApproved` or coverage events. Parallel workers will post heavily through this path. Fix: an event-name allow-list, per-event schema, payload size cap and event ids.
- W-2 (Medium): Memory bound on the replay buffer is by count only. 20000 events with up to 100 KB each can hold about 2 GB. The socket rate-limit Map `_socketConnectAttempts` (Dashboard.js:108, 389-391) keeps one entry per IP and never removes idle IPs. The 120/min `/emit` limit (Dashboard.js:536) will throttle many workers and could silently drop their events. Fix: bound bytes, prune the map, and give workers a journal path instead of /emit.
- W-3 (High for Phase 16, Medium today): healing approval is not bound to a proposal. `/healing/approve` takes only `{original}` (Dashboard.js:596-601) and `HealingTrust.approve(original)` approves whatever suggestion is currently pending for that selector (HealingTrust.js:~432-446). If a different suggestion replaces the pending one between display and click, or a stale proposal exists from another revision, the human approves something they did not review. Fix: require `suggested` plus a proposal id/revision in the request and reject on mismatch.
- W-4 (Medium): `readJsonSync` reads without a size bound, symlink refusal or descriptor-based check (AtomicJsonStore.js:92-93: `existsSync` then `readFileSync`). It is used for `healing_pending`, decisions, quarantine, scenario history and the locator store, and for restored cache files. It does no key allow-listing, so shape is checked only as array-vs-object. `writeJsonAtomic` creates directories with default mode (AtomicJsonStore.js:144) and does not fsync before rename. Fix: share the bounded descriptor reader that LocatorMemoryWriter and RunLedger already use, add schema checks per store, and `mkdir` with mode 0o700.
- W-5 (Medium): token leaked to logs. `Dashboard.url` embeds `?token=<DASHBOARD_TOKEN>` (Dashboard.js:491-493) and `start()` logs it with `Logger.info` (Dashboard.js:855). The log goes to the console and to reports/execution.log, and `reports/` is uploaded as a CI artifact. In CI the dashboard is off by default, but a run with `--dashboard` and a token set would leak it. Logger has no secret redaction, only control-character escaping (Logger.js `sanitizeField`). Fix: print the URL without the token, and add a redaction pass for known secret env values and `token=` patterns. This is the control for AC-30.
- W-6 (Medium): `OPENAI_API_KEY` is set as job-level `env` in the `test` job (ci.yml:57), so every step sees it, including `npm ci` and its install scripts. A compromised dependency or install script on a same-repo PR branch could read it. Forks do not receive secrets. Fix: scope the key to the single step that needs it. The new security job must not inherit it.
- W-7 (Medium): `reports/execution.log` is created with the default umask (observed mode 644 locally), is append-only with no rotation or size bound (Logger.js:43, 81), and swallows write errors silently. N parallel workers appending to one file can interleave lines and grow it without bound. Fix: per-worker logs under the trusted root with 0o600, a size cap, and a flush on exit.
- W-8 (Low-Medium): CI state caches restore by branch prefix (ci.yml:145, 203, 221). GitHub also lets a branch read caches from the default branch, so a PR run inherits `main` state for healing pending, decisions, quarantine and scenario history. Locator memory is deliberately excluded, but the restored files are read with `readJsonSync` and no provenance check (W-4). Parallel shards that restore and save the same keys would also race. Fix: provenance fields plus per-shard keys, or no restore for trust-bearing files.
- W-9 (Low): mutable service image `postgres:16-alpine` (ci.yml:75). The security program requires a digest. It is a throwaway CI database with disposable credentials.
- W-10 (Low): `FALCON_TEST_RUN_HISTORY_PATH` can redirect the ledger path, but only when `globalThis.__FALCON_TEST_SEAMS__` is set by a test preload (falcon.js:69-80). This is guarded and acceptable; keep the same pattern for any new test seam (no env or flag may set journal/manifest roots in production).
- W-11 (Low): `npx allure awesome ... || true` (ci.yml:335) hides report-generation failure. Advisory today but must not be copied into the aggregate or security gates.

### Hypotheses (not demonstrated)

- H-1: LocatorMemory lock uses `process.kill(pid,0)` to decide staleness (LocatorMemoryWriter.js:31-39). With shards on different hosts or containers sharing a state volume, pids are meaningless, so a live lock could be reclaimed and two writers could overlap. The file documents a residual overlap window (LocatorMemoryWriter.js:72-77). Needs a concurrency test with N writers before any claim.
- H-2: `shared()` returns one in-process LocatorMemory (sharedLocatorMemory.js). Forked workers each build their own instance with a stale `_expectedDigest`; the design says stale instances fail closed. Whether many workers then starve each other with repeated conflicts (availability, not integrity) is untested.
- H-3: `sanitiseBranch` keeps `/`, `.` and `_`, so a branch name of `..` or one containing `../` could survive as text. Safe as data in the ledger, unsafe if reused as a path component. Never use branch names in paths.
- H-4: Journals are likely to carry selectors and error text drawn from page content. LocatorMemoryValidation rejects value-like selectors, but error messages from Playwright can echo page text or URLs with tokens. Not verified; covered by the canary test in T14/T20.

## 8. Residual risk (after planned controls)

- A trusted user with write access to the repository directory can still alter state files; the model defends against stale, buggy or hostile inputs, not against a malicious maintainer.
- Same-host workers share a filesystem; lock reclaim has a documented narrow overlap window (H-1) that the digest check narrows but does not close.
- A lock left by another host (shared or network filesystem) is not reclaimed automatically (T17); an operator removes it after confirming the owner is gone.
- Local developer copies of `data/` moved between branches by hand can carry state across branches (T13); accepted only by the owner.
- GitHub code scanning, secret scanning and npm audit coverage depends on GitHub services; absence is BLOCKED, never clean.
- Zero-day or unscanned dependencies cannot be ruled out.
All residual risk acceptance belongs to the human owner (HUMAN). No agent may accept it.

## 9. Gate recommendations

- Before the Phase 16 feature merge: W-3 (proposal binding), W-5 (token in log), W-4 (bounded reader) and W-1 (event allow-list) should be fixed or designed out, with regression tests that fail on the old behavior. Those four directly touch AC-27..30.
- W-6 and W-9 belong with the security CI job (AC-111..123). W-2, W-7, W-8, W-10, W-11 are triage items with an owner and follow-up.
- Design-gate verdict: APPROVE WITH CONDITIONS, conditional on the T-table tests being implemented and AC-101..125 evidence existing on the exact final head. A missing or stale scan, any P0/P1 or an unaccepted high risk means BLOCK.

## 10. Verification traceability

AC-27: T1, T2, T6, T18. AC-28: T2, T3, T4, T9, T15, T16, T19, T20. AC-29: T5-T8, T10-T13, T17, T23. AC-30: T14 (with W-5, W-7). AC-101..125: T14, T21, T22, T24, T25 and the CodeQL/GitGuardian evidence and the baseline-to-head comparison.
