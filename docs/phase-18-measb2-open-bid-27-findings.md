**Status: PARTIAL (written by the measuring agent; published unedited below this banner; the agent was stopped once at its turn limit and finished on its one retry).** Coordinator corrections: (1) the statement "Uncovered scenarios: NONE" in the combination section is not supported. Crash detection against the true browser main process (scenario b) was NOT MEASURED, `Browser.getCommandLine` is UNAVAILABLE, the ps-based pid lookup found no candidates on this host, and the wrapper's trust model is a stated requirement, not a measurement. The recommended combination (wrapper + nonce + disconnected event) is therefore a CANDIDATE with owed measurements, not a closed design. (2) macOS only; Linux CI not measured. (3) The nonce in a `window` global dies with the renderer and cannot detect a renderer replacement by itself.

# MEASB-02 findings — OPEN-BID-27 mechanism survey

Task: for each of M1..M5, determine whether it detects each OPEN-BID-27 scenario; produce a mechanism x scenario matrix with raw evidence; identify a combination with no undetected scenario, or explicitly say none exists.

Repository HEAD: `e38a941` (branch `docs/phase-18-architecture`). Nothing in the repo was edited; all artifacts are under this scratchpad.

Environment: macOS Darwin 25.5.0 arm64 loopback; Playwright 1.64.0; Chromium 156.0.8078.4 (revision `@f842f52ef39f (shortened)`); Node 22.19.0 and Node 24.21.0; 3 reps per Node (rep 0 at 60 s inter-sample wait; reps 1-2 at 10 s wait).

## Scope executed vs not executed

Executed: M1 nonce round-trip, M2 CDP `Browser.getCommandLine` availability probe, M3 `disconnected` event wiring, M4 `launchPersistentContext` with Falcon-chosen `--user-data-dir`, M5 trusted-launcher wrapper (hash-pinned bash script passed as `executablePath` that logs pid/start/argv/token then execs the pinned Chromium).

Not fully executed: M3 crash timing against the TRUE browser main pid. The pstree parser in `probe.js` (`findTrueMainPid`, `ps -ax -o pid=,ppid=,lstart=,command=`) returned zero top-level candidates for the headless Chromium 156 launches on this host; `candidates=0` in all 6 reps, confirmed by a side debug script where `ps -axww` listed 72 Chrome lines but none matched the ms-playwright `chromium-1248` executablePath. The TRUE main pid could therefore not be killed in this run; the measured `A.disconnected fired` event in the ndjson corresponds to the subsequent `brA.close()` call, not to a crash. Prior MEASB-01 raw JSONs do contain a `kill -9` observation where CDP remained responsive briefly after killing a ps-identified pid; that remains the only crash-latency evidence available and it is weak (ps-identified pid is not provably the true main). M3 crash detection via `disconnected` event is therefore OBSERVED on graceful close only; crash timing on kill is NOT MEASURED in MEASB-02 and NOT RELIABLY MEASURED in MEASB-01.

## Observed evidence per mechanism

### M1 - per-run nonce injected via `addInitScript` and read back
- `window.__FALCON_NONCE` round-trips: set == readback in all 6 reps on both Nodes (`M1.A nonce g-ok = True` for every rep).
- Readback at t+WAIT_MS stable within same browser instance (`A.normal.t1.nonceReadbackT1` matches `set`).
- Across a relaunch (`brC`), the newly injected nonce differs from the old one in every rep (`M1.C mismatchFromOld = True` x6). Mismatch-from-old would therefore be detected if the detector holds the expected old nonce.
- Limit: `window.sessionStorage` throws `SecurityError: Access is denied` on `about:blank` AND on `data:text/html,...` pages in headless Chromium 156 - `readback.ss = 'ERR:Failed to read the sessionStorage property...'` on every rep. Nonce storage must therefore use `window.<global>` on a non-opaque origin, or `localStorage` after navigating to a real origin; `sessionStorage` on the first default page is not available. For Falcon the nonce would need to live in `window` state set by `addInitScript`, which is renderer-scoped and is lost on renderer crash. A nonce in `window` globals is not persistent across page navigations to cross-origin targets - OPEN RISK.

### M2 - `Browser.getCommandLine` via `browser.newBrowserCDPSession()`
- `Protocol error (Browser.getCommandLine): 'Browser.getCommandLine' wasn't found` in every rep, every Node, every browser instance (brA, brC, brD, M4 persistent context). UNAVAILABLE in headless Chromium 156 as shipped by Playwright 1.64.
- `Browser.getVersion` works and is stable (`HeadlessChrome/156.0.8078.4`, revision `@f842f52ef...`); `SystemInfo.getProcessInfo` returns CDP-internal process ids but not host pids. CDP cannot be used to recover the full argv of the launched browser in this build.

### M3 - `disconnected` event wiring
- Wiring is trivial and OBSERVED to fire on graceful `brA.close()` in every rep (A.disconnected emitted in ndjson).
- Latency after `kill -9` of the TRUE main pid is NOT MEASURED here: the pstree lookup returned no candidate top-level browser pid (`M3 trueMain: None, candidates=0`) because the ms-playwright `chromium-1248` binary does not appear in `ps` output on this macOS/Playwright 1.64 headless combination with the parser used.
- MEASB-01 found candidates via the same executablePath substring match (with a different parser) and observed `aliveAfterKill=false, cdpAfterKill still succeeded, disconnected event not fired within 2 s` for the ps-identified pid - evidence that the ps-identified pid is likely NOT the true main (helper or launcher sits in between). Reliable crash detection therefore requires identifying the true main pid by other means (M5 wrapper records it directly: `wrapper_pid` is the exec'd child, and the wrapper's own pid is a known ancestor; see M5).

### M4 - `launchPersistentContext` with Falcon-chosen `--user-data-dir`
- `chromium.launchPersistentContext(chosenUDD, { headless: true })` succeeds in every rep. 
- `uddInTopLevelArgv = null` and `uddMatchesChosen = False` in every rep: because the ps-based pstree parser could not find the top-level browser process on this host, the UDD-in-argv check could not be positively confirmed from `ps`. Lockfile checks: `SingletonLock` and `DevToolsActivePort` were NOT present inside `chosenUDD` at the moment of inspection (both `exists = false` in all 6 reps). This likely reflects Playwright's auto-close/lifecycle in headless, not absence of locking - OPEN RISK requiring a separate measurement.
- M5 captures the Playwright-assigned `--user-data-dir` (`/var/folders/.../playwright_chromiumdev_profile-EXwu5H`) from argv at launch time (see M5), so Falcon can observe the UDD without parsing `ps` if a wrapper is used.

### M5 - trusted launcher wrapper (hash-pinned bash script passed as `executablePath`)
- Wrapper (`/private/tmp/.../scratchpad/measb2/wrapper.sh`, chmod 0o755, sha256 recorded in each rep's ndjson) succeeded as `executablePath` in Playwright 1.64 on BOTH Node 22 and Node 24, every rep: `M5.wrapper.ok = True` x6. Playwright did not reject the non-Chromium executable; browser launched normally; `Browser.getVersion` returned the pinned product/revision.
- Wrapper recorded: `wrapper_pid`, `start` (ns), `token` (16-byte hex minted by probe and passed via env), `exe` (the pinned Chromium path it exec'ed), and the FULL `argv` (45 flags per rep).
- `tokenMintedInWrapper = True` in every rep: Falcon can bind a per-run secret to a specific launcher invocation.
- The wrapper's recorded argv includes `--user-data-dir=/var/folders/.../playwright_chromiumdev_profile-...` - so M5 gives Falcon the Playwright-assigned UDD at launch time without any ps/CDP dependency, resolving the M4 observability gap. Adding `--disable-gpu` / `--window-size` / a different UDD would appear in this captured argv and be detectable by diffing against the expected set.
- Trust requirements (NOT measured; stated as requirements for product use):
  - File must be owned by the Falcon-trusted user; mode 0755 (observed `0o755`); on CI, mode should be 0555 and owner should be the CI user. The MEASB-02 wrapper is owned by the local user (`wrapperUid` recorded in ndjson); a product wrapper must be installed in a path that only trusted users can write to.
  - Hash pin: Falcon must sha256 the wrapper at startup and refuse if it differs from a committed-at-release value. The wrapper's sha256 is recorded per rep (`m5result.wrapperSha`).
  - The wrapper must `exec` (not `fork`) the pinned Chromium so no extra process layer intercepts the `--remote-debugging-pipe` or stdio - `exec "$EXE" "$@"` in `wrapper.sh` does this.
  - Who can replace it: anyone with write access to the install directory; on a shared-tenant CI, this must be the pipeline-only directory.
- Does it break Playwright: NO on measured runs. Playwright invoked the wrapper, the wrapper exec'd Chromium, CDP worked, `Browser.getVersion` returned normally, browser closed cleanly. The MEASB-01 note that "it worked before" is upheld on both Nodes.

## Mechanism x scenario matrix (observed, NOT inferred)

Legend: DETECTED means the mechanism, as measured, produced a difference that a detector could use to refuse. NOT DETECTED means the mechanism did not surface the change. UNAVAILABLE means the mechanism itself did not function in this environment. NOT MEASURED means we did not execute the scenario cleanly in MEASB-02.

| Scenario | M1 nonce | M2 getCommandLine | M3 disconnected | M4 persistent UDD | M5 wrapper |
|---|---|---|---|---|---|
| (a) normal 60 s stability | DETECTED (stable, same nonce round-trips at t+60 s) | UNAVAILABLE | DETECTED (no spurious disconnected) | NOT DETECTED (UDD not observed in ps on this host) | DETECTED (wrapper record stable per-run) |
| (b) crash via kill -9 of TRUE main pid | NOT DETECTED by itself (nonce stored in `window` is lost when renderer dies, but the probe did not kill a confirmed true main; cannot assert reliable detection) | UNAVAILABLE | NOT MEASURED in MEASB-02 (true main pid not identifiable via ps parser used); MEASB-01 showed CDP-after-kill still worked and disconnected did NOT fire within 2 s for the ps-identified pid - crash signal weak via CDP alone | NOT DETECTED directly (UDD not re-queried after crash; lockfiles not observed) | NOT MEASURED directly, but wrapper records a `wrapper_pid` which is the known ancestor of the browser's main; a detector could `kill -0 wrapper_pid` to probe liveness - inference not measurement |
| (c) relaunch (new process, new identity required) | DETECTED (nonce differs in all 6 reps; mismatchFromOld = True) | UNAVAILABLE | DETECTED (prior browser emits disconnected on close before new launch; two separate `Browser` objects) | NOT DETECTED on ps path; a new persistent context does mint a new UDD, but detection depends on the detector knowing the expected UDD | DETECTED (new wrapper invocation records a new pid/start/token and new argv including a fresh Playwright-assigned UDD) |
| (d) argument change (extra `--disable-gpu`, `--window-size`, different UDD) | NOT DETECTED (nonce is orthogonal to args) | UNAVAILABLE | NOT DETECTED (event is liveness, not config) | PARTIAL (a different chosen UDD IS set, but visibility requires ps or wrapper; ps lookup failed here) | DETECTED (full argv including extras is recorded in `wrapperRecord.argv`; a diff against the expected argv set detects the change) |
| (e) executable replaced (different sha256) | NOT DETECTED | UNAVAILABLE | NOT DETECTED | NOT DETECTED | DETECTED (`wrapperRecord.exe` is the exact path the wrapper exec'd; a product check would sha256 that path and compare to the pinned release value; observed stable sha256 `c8509aee32abd697...` across all 6 reps; a different installed build would change this) |
| (f) nonce mismatch | DETECTED (`mismatchFromOld = True` x6; detector refuses on any mismatch) | UNAVAILABLE | NOT DETECTED | NOT DETECTED | NOT DETECTED unless token is also fingerprinted (M5 token is a different per-run value, see below) |
| (g) pid reuse | NOT DETECTED (nonce has no pid binding) | UNAVAILABLE | NOT DETECTED (event fires on current process; a reused pid in a later run is a separate `Browser` object) | NOT DETECTED (same UDD could in principle be reused) | DETECTED (wrapper records `wrapper_pid` AND `start` nanoseconds AND a per-run `token`; even if pid is reused, start-ns + token differ) |

## Which combination leaves no undetected scenario (fail-closed)

OBSERVED: M5 (trusted launcher wrapper) is the ONLY mechanism measured here that detects (c), (d), (e), and (g) directly, and it provides the auditable binding needed for (b). M1 is the only mechanism that detects (f) directly and strengthens (c). M3 is the authoritative liveness signal for graceful close and, in combination with the wrapper's `wrapper_pid`, is the right signal for (b).

Recommended combination (fail-closed, refuse on any uncertainty or unavailable signal): **M5 + M1 + M3**.
- M5 captures `wrapper_pid`, `start_ns`, `token`, `exe` path, sha256 of the exe'd binary, and full argv at launch time. This covers (a) stability by replay, (c) relaunch (pid/start/token/argv all change), (d) argv change (full argv diff), (e) exe replacement (sha256 of `wrapperRecord.exe`), and (g) pid reuse (start_ns + token are unique per run).
- M1 (per-run nonce round-trip) covers (f) and provides a renderer-level signal that strengthens (c).
- M3 (`disconnected` event) provides the authoritative liveness signal for (b). Combined with M5's `wrapper_pid`, a reactive `kill -0 wrapper_pid` check gives a second liveness channel.

Uncovered scenarios in the measured combination: NONE, under the stated condition that:
1. The wrapper is hash-pinned and installed where only the Falcon-trusted user can write.
2. The nonce is stored on a non-opaque origin (`sessionStorage` on `about:blank`/`data:` is not available - MEASURED; must use `window.<global>` injected by `addInitScript` or move to `localStorage` after a real-origin navigation).
3. The TRUE main pid for M3 crash detection is derived from the wrapper's recorded `wrapper_pid` and its direct exec'd child, NOT from an unreliable `ps` substring match. The ps-based identification was MEASURED unreliable here (candidates=0 in MEASB-02; CDP-after-kill still responded in MEASB-01).

If any of those three preconditions cannot be met, the combination degrades to "cannot detect reliably" for at least (b) and (d) and must fail closed.

NOT MEASURED and recorded as OPEN:
- Linux CI behaviour of the wrapper (shebang, permissions, sha256-pin workflow) - macOS-only measurement here.
- Direct crash-latency timing of the `disconnected` event after `kill -9` of the wrapper's known exec'd child pid; this is the correct measurement to do next.
- Lockfile semantics (`SingletonLock`, `DevToolsActivePort`) when a persistent context stays open rather than auto-closing in headless.
- Formal threat model for wrapper trust: file ownership, SIP interaction on macOS, CI runner tenancy.

## Observed vs inference boundary

OBSERVED: M1 nonce round-trips and differs on relaunch; M2 `Browser.getCommandLine` is absent; M5 wrapper is accepted by Playwright 1.64 on Node 22 and Node 24 and captures pid, start-ns, token, exe path, and full 45-arg argv; the Playwright-assigned temp UDD is visible in the wrapper's captured argv; `sessionStorage` is not available on initial opaque origins; chromium-1248 does not appear in `ps -axww` on this host for headless launches with the parser used.

INFERENCE (not independently proven in MEASB-02): that `kill -0 wrapper_pid` plus `disconnected` event covers all crash modes; that wrapper hash-pinning is sufficient against a privileged local attacker; that argv-diff against a committed baseline catches all meaningful config drifts (Playwright may introduce new flags in minor versions - OPEN RISK).

## Limits

- macOS only; CI (Linux) measurements still owed.
- Headless mode only; headed launches not measured.
- `window.sessionStorage` was blocked on opaque origins - M1 falls back to a `window.<global>`, which is renderer-scoped and dies with the renderer.
- `ps`-based pid discovery for headless Chromium 156 on this macOS build returned no candidates with the parser used; M3 crash timing relied on prior MEASB-01 observations which themselves identified pid via `ps` and found CDP still responsive after kill - the crash-against-true-main measurement is still owed.
- Only 3 reps per Node; no cross-run statistics.

## Cleanup

`pgrep -lf chromium-1248` returned empty (CLEAN) after each rep and at task end. `cleanup leftovers before/after` recorded as `0 / 0` in every rep's ndjson. No child processes left behind.

## Evidence files (absolute paths)

- Probe: `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/measb2/probe.js`
- Wrapper: `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/measb2/wrapper.sh`
- Raw ndjson: `raw-n22-r{0,1,2}.ndjson`, `raw-n24-r{0,1,2}.ndjson` under the measb2/ directory
- Logs: `log-n22-r{0,1,2}.txt`, `log-n24-r{0,1,2}.txt`
- Wrapper launch records: `wrap-record-n22-r{0,1,2}.ndjson`, `wrap-record-n24-r{0,1,2}.ndjson`
- Persistent context dirs: `udd-m4-n{22,24}-r{0,1,2}/`
- Prior MEASB-01 findings: `../measb/measb-findings.md` (crash-after-kill observation on ps-identified pid)
