# Phase 18 Security Design Re-review (SEC-03)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `dca2258` (architecture rev 2; base `2572e73`). This record covers only that revision and is superseded by the next re-review.

**Verdict for PR 18E (foundation): APPROVE WITH CONDITIONS (C1–C8).** No P0 or P1 findings fall in 18E. **PR 18D is not ready to implement** (major gaps D-1..D-6). 18C, 18B and 18F have open design items. The acceptance-criteria JSON diff changes no requirement or priority; no Must criterion and no owner decision (OD-01..OD-19) is weakened. No risk has been accepted on the owner's behalf.

## Code facts checked

- `Schemas.canonicalJson` is at lines 36–41. `SafeFs.readBoundedJson` does lstat, O_NOFOLLOW, fstat; `writeAtomicPrivate` uses a random temp name and `fh.sync` but no directory fsync.
- `PlanFile` stats at `:175` and `:219` and uses `JSON.parse` at `:190` (duplicate keys resolve last-wins).
- `AIHealer._performAction` is called at `:337`, `:419`, `:586`, `:652` and is the only place that calls click, fill or selectOption (`:364-368`). `ClickExplorer.clickElement` (`:75-95`) is called from `SiteSweep:208`, `ParallelDiscovery:130` and `falcon.js:387`. `HealingBenchmark:308-310` clicks and fills directly: an extra mutation site the design does not list. `TestRunner:259-263` goes through `healer.healAnd*`. No keyboard, mouse or `APIRequestContext` calls exist.
- `GitInfo.js:38` takes the commit SHA from the `GITHUB_SHA` env var first and has no dirty flag. `falcon.js:223` already refuses credential-carrying flags (`rejectKeyCarrierFlags`).
- `playwright.config.js`: top-level `testIgnore` includes `**/regression/**`; reporters are global (json to `reports/playwright-results.json`, plus allure-playwright); `outputDir` is `reports/test-artifacts/`, not `test-results/`; `baseURL` defaults to a third-party demo site. `.gitignore` has no `run/` entries yet.

## SEC-02 blockers

| ID | Status | Remaining requirement |
|---|---|---|
| L01 | CLOSED for the six sub-items | New gaps: values the app writes to localStorage/sessionStorage during the run and tokens in JSON response bodies are never registered; the cookie diff is async but `Logger` is sync, so flush semantics need defining; each worker's registry must be unioned when shard bundles merge. Test: `neg-l01-runtime-storage` |
| L03 | PARTIAL | The project-level pilot config inherits the global json and allure reporters, which persist error call logs and attachments outside the boundary; the pilot project must override `testIgnore` or the global `**/regression/**` excludes its own tests; `baseURL` falls through to a third-party site; the negative test scans `test-results/` but the real output is `reports/test-artifacts/`. Use a separate `playwright.pilot.config.js` (precedent: `playwright.demo.config.js`) and scan `reports/`, `allure-results/` and the outputDir |
| P01 | CLOSED | See D-1 |
| P02 | PARTIAL | The order "marker, then audit append" breaks under SIGKILL: a marker with no chain entry is defined as tampering, so every later run fails `APPROVAL_HISTORY_TAMPERED` (permanent denial of service) and contradicts `neg-p02-replay`. Fix: append a fsynced `consume-intent` entry first, then the marker; treat the action as consumed if either exists; a marker with no intent entry is then genuine tampering |
| P03 | CLOSED | See N-2 (arming window) |
| P06 | CLOSED | — |
| D01 | CLOSED, with spec additions | See C1 |
| N01 | PARTIAL | Execute mode does not abort GETs or navigations to denied routes, so a JS `location=` or redirect to a destructive GET route goes through. SPIKE-R fallback is underspecified (N-3). Tests: `neg-n01-exec-denied-get`, `neg-n1-worker-fetch` |
| F01 | CLOSED | Add: realpath `repoRoot` once; `JsonStrict` rejects escaped lone surrogates (`"\ud800"`) |
| B01 | CLOSED for enumerated paths | 18B conditions: a static scan of action call sites (like the sink scan) covering `.click/.fill/.type/.press/.check/.selectOption/.setInputFiles/.tap/.dragTo/.dispatchEvent`, keyboard, mouse and `request`, including `HealingBenchmark`; define how the static `clickElement` knows it is in pilot mode without a module singleton (for example a WeakSet of pilot pages registered by the gate) |

## Major and minor rows

CLOSED: L02, L04, L05, L06, L07, P05, B02, B03, B04, B05, R01, F03, X01, E01 (exit 18 is a distinct code).

- **L08** is CLOSED but inconsistent with P04: if git is absent L08 refuses, which makes the `BuildIdentity` source-digest fallback unreachable for runs with a state file. The architect must pick one.
- **P04** PARTIAL: `BuildIdentity` must not reuse `GitInfo`. Ignore `GITHUB_SHA` and strip `GIT_*` from git's environment; use `git status --porcelain --untracked-files=all` for the dirty check; the source fallback needs its own domain `build-v1` (not `plan-v1`); add `falcon.js`, `BrowserManager`, `Runner`, `TestRunner` and `package-lock.json` to the file list. Test: a spoofed `GITHUB_SHA` must still invalidate the approval.
- **F02** PARTIAL: refuse, rather than chmod-repair, a group- or world-writable `run/approvals` or `run/auth`.
- **S01** PARTIAL: a segment of 4096 entries (about 1.6 MiB) exceeds the 1 MiB ledger cap; also seal at about 768 KiB.
- **X02, R02, N02, S02** open-minor, carried over (rev 2 does not mention them). S02: multi-value substitution must use literal matching (`indexOf` or Aho-Corasick), never a RegExp built from secret values.

## Targeted questions

- **Plan values:** CLOSED (section 8a). 18B adds: the gate refuses a literal fill when the live handle is credential-semantic. The PII residual is the owner's decision.
- **Confused deputy:** fixed roots CLOSED; retention CLOSED, add re-lstat of parent components immediately before each unlink (parent-swap race); pruning PARTIAL (D-4).
- **Run scope and TTL:** PARTIAL (D-3, D-5).
- **N1–N8:** N2–N8 CLOSED. N1 CLOSED apart from the arming window (N-2).

## New design flaws

- **D-1 (18D, major).** No cross-process or in-process lock for appending to the audit chain. Concurrent consumers (which ADR-0031 supports) will fork the chain and trigger `APPROVAL_HISTORY_TAMPERED`; the `anchors.log` whole-file rewrite is last-writer-wins. Fix: an `O_EXCL` lockfile with stale-PID detection.
- **D-2 (18D).** The record stores only `runIdHash`, so the nonce cannot be verified. Store a nonce hash.
- **D-3 (18D, major).** One run can adopt only one runId, so a plan with several protected actions cannot run; worker-mode claim semantics are undefined. Fix: the approve command takes several action IDs under one token and the coordinator claims the token once.
- **D-4 (18D).** `verify()` must require a body for every sealed segment younger than 90 days, require a `segment-pruned` entry for every missing body, and keep marker retention between the TTL and the segment retention; otherwise deleting a segment looks the same as pruning one.
- **D-5 (18D).** A `--approval-run-token=` argv flag conflicts with `rejectKeyCarrierFlags` and leaks via `ps` and shell history; accept the token from env or a 0600 file only. Printing the token to stdout trips the boundary, which already has it registered: define a single exempt emission channel. Do not add `PILOT_APPROVAL_RUN_TOKEN` to `.env.example`. CI must use `::add-mask::`.
- **D-6 (18D).** The approve command should refuse a plan digest that has no review (N2).
- **N-2 (18C/18B).** Disarming in `finally` aborts approved single-page-app POSTs that fire after `click()` resolves. Define a bounded arming window that excludes any other `gate.perform`.
- **N-3 (18C).** The SPIKE-R fallback must fulfil the 3xx response and let the browser re-request each hop; it must never follow redirects server-side (that would render origin B's content under origin A). The spike must also check that `route.fetch` sends the cookies and headers the browser would have sent. Network-gate gaps to cover: OPTIONS preflight, WebSocket `connectToServer` semantics, dedicated Web Worker requests, WebRTC (residual).
- **N-4.** The non-NFC rejection breaks identity digests of real page text with exit 18. Normalise identity strings before digesting.
- **N-5.** Non-POSIX and network filesystems: use a statfs *allowlist* and refuse unknown types (covers virtiofs, FUSE, drvfs).

## 18E conditions

- **C1 (Digest).** `digest()` rejects unknown domains; add `build-v1` and `runtoken-v1`; reject sparse arrays, accessor properties and symbol keys; apply NFC and surrogate checks to keys; golden vectors for all of these.
- **C2.** `BuildIdentity` hardening as in P04.
- **C3.** `SafeFs` statfs allowlist; `createExclusive` treats a zero-length marker as consumed.
- **C4.** `SecretRegistry` exposes a runtime storage-registration API and uses literal matching only.
- **C5.** realpath `repoRoot`; refuse broad modes on approvals and auth.
- **C6.** `Retention` re-lstats parents before each unlink.
- **C7.** Define the token-emission exemption, or forbid emitting the token through any boundary sink.
- **C8.** `.gitignore` covers all of `run/`.

## Owner items (none accepted)

BLOCKER-1; threat model section 6 residual risks; PII in literal plan values; same-uid rollback (bounded by the 1800 s TTL and by wall-clock trust); no Windows support for pilots; run-token leak impact (limited to the same uid).
