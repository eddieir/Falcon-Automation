# Phase 18 Security Design Re-review 3 (SEC-04)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `6bba249` (architecture rev 2 plus the [rev 3 patch](../architecture/phase-18-rev3-patch.md); base `2572e73`). This record covers only that revision and is superseded by the next re-review.

**Verdict for starting PR 18E: APPROVE WITH CONDITIONS E1–E8.** The patch closes 22 SEC-03 items; 9 are partially closed. No P0 found. One **P1 candidate** sits in 18C (SPIKE-W fallback race). **18D: NOT READY.** **18C:** blocked on the SPIKE-W design fix before merge. **18B and 18F:** ready with conditions. No Must criterion or owner decision (OD-01..OD-19) is weakened (spot-checked OD-04, OD-10, OD-12 (strengthened), OD-14, OD-18; `FailureCodes` unchanged). No risk accepted.

## Code facts verified by grep

- `Logger`: the console write is synchronous; the file write goes through `_writeQueue` (`:108,:135`) and is drained by `flush()` (`:155`).
- `HealingBenchmark:308-310` calls fill, selectOption and click directly. `GitInfo:38` prefers `GITHUB_SHA`.
- `playwright.config.js`: top-level `testIgnore` (`:24`), global json and allure reporters (`:37-43`), `baseURL` defaults to a third-party demo site (`:48`), `outputDir` is `reports/test-artifacts` (`:71`). `.gitignore` has no `run/` entry.
- **Two claims in the patch do not match the code:** (a) `fs.statfs` on darwin returns a **number** (this host prints 26, `0x1a`), not "apfs"/"hfs"; (b) `rejectKeyCarrierFlags` exits **1** (`falcon.js:481`), not 2.
- Runner workers run **in-process** (`browser.newContext` at `Runner:121`; no fork, spawn or worker_threads anywhere in `src`). Shards are separate processes started by CI followed by a separate merge invocation. The patch's "spawn environment" model for `runId`, the claim receipt and `registryKey` does not exist in the code.
- A stray CJK character appears in the normative patch text (patch line 212).

## CLOSED

L03 (7b, ADR-0036); P02 (section 9); N01 execute-mode GET/navigation deny (residual: a destructive GET on an *allowed* route depends on manifest authoring); F01; F02; S01 (minor: after a restart the byte count must be re-derived from file size); L08-vs-P04 (an approval minted in source mode can never be consumed by a git-required stateFile run; fails closed, acceptable); P04/C2 (add `-c core.fsmonitor=false -c core.hooksPath=/dev/null`; residual: gitignored `node_modules` are not part of the build identity); D-2; D-4; D-5/C7; D-6; N-2 (recommend binding the lease to the gated page/frame via `request.frame().page()`; today any page in the context, or any script, can consume the triple, and the body is not bound); C1; C5; C8 (design; the file change lands in 18E); X02; R02; N02; S02; plan values (step 11a); C6 (correction: Node has no `unlinkat`/`openat`, so remove the "fd-relative unlink" claim and record the re-lstat-to-unlink window as a residual that needs a same-uid attacker).

## PARTIALLY CLOSED

- **L01/C4 (section 10, ADR-0037).** (i) `settle()` must *trigger* a fresh storage/cookie diff, not only await one already in flight. (ii) Storage must be enumerated for every origin and frame (`sessionStorage` per frame). (iii) A pilot-mode uncaughtException/unhandledRejection handler that emits codes only, because Node's default handler prints messages to stderr. (iv) The worker-union design does not fit the real process model: local workers are in-process and should share one registry; shards have no coordinator spawn env, so `registryKey` would have to come from a CI secret, or authenticated shard runs must be refused. Test `neg-l01-runtime-storage`: an in-process multi-context run; a storage write with no navigation followed by a sink write; a cross-origin iframe `sessionStorage` canary.
- **D-1 (`lockExclusive`, ADR-0035).** (i) Lock-steal race: two breakers both judge the same record stale; A renames it aside and creates a live lock, then B renames A's *live* lock aside. Fix: break under an `O_EXCL` `.break` guard, verify the identity of the renamed file (nonce/inode), and have the holder re-check its lock before commit. (ii) PID reuse makes a dead holder look alive forever (permanent exit 18): use the recorded bootId (a different boot means stale) and never break a lock whose hostname differs. (iii) The AsyncLocalStorage reentrancy must cover descendants of the acquiring call only; keyed per run or per process it would let concurrent in-process appends through. Tests: two simultaneous breakers produce one holder; a reused live PID with a different bootId is broken; 8 in-process contexts plus 8 processes produce a contiguous chain.
- **D-3.** The claim receipt assumes spawned workers. Define the in-process case (one claim per process); refuse protected actions in shard mode or define them there (approval roots are local to each runner); guarantee that no CLI or env surface lets a process declare itself a "worker", otherwise anyone holding the runId can consume the batch's remaining actions without the nonce while the TTL lasts. Test: a standalone process given the runId and receipt path is refused.
- **N-3.** SPIKE-R fallback direction is CLOSED; add a body-size cap or streaming for `route.fetch` (it buffers in memory: DoS). **SPIKE-W fallback is a P1 candidate for 18C:** refusing on `page.on("worker")` is a race (the worker can POST before the context is torn down), Blob-URL workers bypass the route, and SharedWorker coverage is unverified. Fix: a preventive `addInitScript` that makes the `Worker`/`SharedWorker` constructors throw in execute mode, with the event-based refusal kept as a backstop. Test: a worker POSTs synchronously at script start, repeated 50 times, counter 0 every time.
- **N-4.** Page-derived strings must be NFC-normalised *at capture*, otherwise the `plan-v1` rejection fires on NFD page text written into the plan, contradicting `neg-n4`. DOM text can contain lone surrogates, which NFC does not fix: replace them with U+FFFD at capture, otherwise a hostile page can force exit 18. Test: an accessible name containing `\uD800`.
- **N-5/C3.** The zero-length-marker part is CLOSED. The allowlist cannot be implemented for darwin as written: use spike-verified numeric `f_type` values or another API. `0xEF53` also matches ext2 and ext3, so the ext2/ext3 part of OD-20 is moot.
- **B01.** The WeakSet design is CLOSED. The scan list is missing `dblclick`, `setChecked`, `clear`, `pressSequentially`, `selectText`, `touchscreen.`, `evaluate`/`$eval`, `route.fetch`, and Node HTTP clients (`APIClient.js`, `Middleware.js`).

## 18D-specific conditions

- **D-a.** Physically truncate a torn tail under the lock before the next append, otherwise P02's permanent-tamper denial of service returns.
- **D-b.** Add the crash points for seal and anchor append to the crash table.
- **D-c.** Define a genesis protocol for `anchors.log` so a crash during first init does not become TAMPERED.
- **D-d.** Delete `PILOT_APPROVAL_RUN_TOKEN` and `registryKey` from `process.env` after reading them and keep them out of the browser launch env (Playwright inherits the environment by default).
- **D-e.** In CI, write the token to a 0600 file instead of mixing it into captured stdout. Whether CI may self-approve goes to the owner.

## 18E conditions

- **E1.** Split the 18E tests. The end-to-end cases of `neg-l01-runtime-storage` (arming window, login), the HealingBenchmark guard case of `neg-b01-action-scan` and `neg-x02` depend on 18A, 18B, 18D and the 18F fixture: keep their unit halves in 18E and move the rest to named later PRs. As written the 18E merge gate cannot be met. The action-site scan also needs a tracked temporary exclusion list for today's unguarded call sites.
- **E2.** The N-5 fix (darwin numeric types, ext magic note).
- **E3.** The D-1 fixes (lock steal, bootId/hostname, reentrancy scope).
- **E4.** The L01 fixes (i)–(iv).
- **E5.** The N-4 capture-time normalisation and lone-surrogate handling.
- **E6.** The C6 correction (remove the `unlinkat` claim).
- **E7.** Editorial fixes: the stray CJK character and exit code 1 versus 2.
- **E8.** Specify the attestation/`secretIndex` for in-process workers and for shards.

## Owner items (none accepted)

BLOCKER-1; OD-20 (with the corrected darwin and ext notes); OD-21 (`disable_non_proxied_udp` still allows TCP TURN, so the mitigation is weak); OD-22 (a longer window widens exposure: the triple can be consumed by any request and the body is unbound); residuals: threat model section 6, PII in literal plan values, same-uid rollback, no Windows support, run-token leak (same uid), mixing builds against one approvals root, undelimited secret embedding in shards, tokens in IndexedDB or non-JSON or oversize bodies, destructive GETs on allowed routes, `node_modules` outside the build identity, and whether CI may self-approve.
