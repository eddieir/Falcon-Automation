**Status: MEASURED, PARTIAL as an agent task (written by the measuring agent after one retry; published unedited below this banner).** Coordinator reading: OPEN-BID-27 stays a CANDIDATE, not a decision. Measured on macOS arm64 only: crash of the true main process (via the wrapper pid) is detected by the `disconnected` event in under 40 ms and by `kill -0`; a renderer crash is detected by `page.on('crash')` and NOT by `disconnected`; the normalised wrapper argv is a stable baseline within Playwright 1.64.0; pre-launch trust checks reject byte, mode, symlink, foreign-executable and writable-parent tampering; the nonce must be re-verified per page and realm. Explicitly uncovered (see the agent's list, items 1 to 10): Linux and CI runners, a kill of the specific renderer process, lockfile semantics in other modes, the swap-then-restore TOCTOU, running-image hashing on macOS, Playwright upgrade drift, concurrent launches, headed and other channels, runner tenancy, and an attacker with the Falcon user's own UID. No scenario list here is claimed complete.

# MEASB-03 findings — measurement of the MEASB-02 candidate

Candidate under measurement: hash-pinned launcher wrapper (passed as Playwright `executablePath`) + per-run nonce via `addInitScript` + `browser.on('disconnected')` + argv diff from wrapper-recorded argv + sha256 pin on wrapper and (via the wrapper's exec target) on the Chromium binary.

Environment: macOS Darwin 25.5.0 arm64, loopback only. Playwright 1.64.0, Chromium 156.0.8078.4 (ms-playwright `chromium-1248`, exe sha256 `c8509aee32abd6977968e9999769980b7a420dea05402d90042d9e5b41db15ef`). Node 22.19.0 on PATH; Node 24.21.0 at `scratchpad/node24/.../bin/node`. Wrapper sha256 `f0661b04085f73686d61b3b62d9e85cc583727c9bf25d79997a1819feddcbb76`, mode 0755, uid 501. 3 reps per Node (n22-r{0,1,2}, n24-r{0,1,2}); all six reps exited 0; `pgrep -lf chromium-1248` empty before and after each rep and at task end.

Nothing in the Falcon repo was written or edited.

## What was measured and what was NOT measured

Measured (observed, with raw evidence per rep):
- Q1 crash of the TRUE browser main process via the wrapper (wrapper_pid IS browser main), confirmed by `ps -p wrapperPid` showing the pinned Chromium executable, and by helper children having `ppid == wrapperPid`.
- Q1 renderer crash via `page.goto('chrome://crash')`.
- Q1 kill of a direct helper child (first child of main, which on this host was consistently the GPU helper — see caveat below).
- Q2 nonce survival across cross-origin navigation, new page in same context, renderer crash of a page, and per-realm CDP `Runtime.evaluate`.
- Q3 persistent context with a Falcon-chosen UDD while OPEN: `SingletonLock`, `DevToolsActivePort`, UDD-in-wrapper-argv.
- Q4 argv diff across 6 launches per Node (12 total ephemeral launches), with normalisation, and detection of a `--disable-gpu` injection.
- Q5 wrapper trust: owner uid, mode, parent-dir writability, symlink, sha256 pin; tamper tests: mod-byte, chmod g+w, symlink, foreign-exe (`/bin/echo`), parent-writable dir; and TOCTOU: pass pre-check, overwrite wrapper file, launch, hash recorded exec'd path post-launch.
- Q6 docker daemon availability.

NOT measured (explicit):
- Q1 renderer-only helper kill with the renderer specifically for a target `Page`. The probe killed the first direct child of the browser main; on this host that was consistently the `--type=gpu-process` helper, not the `--type=renderer` for `pageQ1`. Consequence: the probe recorded `page.crash = false` and `disconnected = false` after the helper kill, which is the correct outcome for killing a GPU helper (browser recovers), but it does NOT demonstrate the `page.crash` signal fires when the actual renderer process backing a `Page` is killed. The chrome://crash test (which crashes the renderer in a controlled way) DID fire `page.crash = true` with `disconnected = false` in every rep, so renderer-crash → `page.crash` is observed via that path; direct `kill -9` of a specific renderer process is NOT.
- Q6 Linux CI: `docker version` returned Server 28.5.2 (daemon up), but no digest-pinned Playwright-capable image is local (`docker image ls` shows no `mcr.microsoft.com/playwright/*` or similar). Per the task's "do not pull large images" rule: Linux NOT MEASURED. The macOS behaviours above are not assumed to carry over, especially (i) `SingletonLock` on Linux is traditionally a symlink of form `<hostname>-<pid>` present during live use — this was NOT observed on macOS (see Q3) — and (ii) `/proc/<pid>/exe` + `/proc/<pid>/maps` enable stronger TOCTOU detection on Linux that is not available on macOS.
- Headless-vs-headed launches (headless only; a change of `headless` option would also show up in argv diff via presence/absence of `--headless`, but was not exercised).
- Attacker-restores-after-launch TOCTOU: if the attacker swaps the wrapper, launches, then restores the original file, the post-launch hash would re-match and detection would fail. NOT MEASURED but called out as a residual risk; the running image hash in process memory is not accessible on macOS without debugger-level privileges.
- Long-duration (>minute) stability of the nonce / disconnected wiring under background pressure. Prior MEASB-02 covered 60 s on scenario (a); not re-run here.

## Per-question observed results (all 6 reps consistent unless noted)

### Q1 — Crash of the TRUE browser main
- `ps -p wrapperPid` returns the pinned Chromium executable as `command=` in every rep. Direct helpers (GPU, utility network, utility storage, renderer) have `ppid == wrapperPid`. CONFIRMED wrapper_pid IS the browser main.
- `kill -9 wrapperPid` → `browser.on('disconnected')` latency per rep (ms): n22 {35, 28, 24}, n24 {22, 26, 33}. All < 40 ms, all < the 5 s poll deadline.
- CDP call after kill: `browser.newBrowserCDPSession: Target page, context or browser has been closed` in every rep.
- `kill -0 wrapperPid` after kill: ESRCH → `alive = false` in every rep.
- Helper child kill (first child, which was `--type=gpu-process` on this host in every rep inspected): `disconnected = false`, `page.crash = false` on `pageQ1`, main alive. This matches expected behaviour (killing the GPU helper does not crash a page's renderer, nor disconnect CDP). The probe did NOT exercise a kill of the specific renderer PID for `pageQ1`.
- `page.goto('chrome://crash')` on a fresh page: `page.crash` fired `true` in every rep, `disconnected` remained `false`, main alive. Confirms the `page.on('crash')` signal is a reliable renderer-crash detector; `disconnected` is a browser-main liveness signal and MUST NOT be used alone for renderer crashes.

### Q2 — Nonce survival (`addInitScript` sets `window.__FALCON_NONCE`)
Per rep (all six identical):
- Origin 1 (http://127.0.0.1:P1): match true.
- Cross-origin navigation (same page, new origin 2): match true (addInitScript re-injects on each navigation).
- New page in the same context: match true.
- Same page after `chrome://crash`: `page.evaluate: Target crashed` (ERR). Nonce value is NOT recoverable from a crashed renderer — expected.
- Fresh page opened in the same context after the crash: match true (addInitScript persists on the context and re-injects into every new realm).
- Per-realm `Runtime.evaluate` via `context.newCDPSession(page)`: match true.
Design implications (OBSERVED → required):
1. The nonce must be re-verified per page/per realm; a single read-back at launch is insufficient because a crashed/replaced renderer loses its `window` state.
2. For evidence, the browser-side expected value should be compared against the per-realm `Runtime.evaluate` result on every realm used for a verification step (shown WORKING via `newCDPSession`).
3. `sessionStorage` on opaque origins is unavailable (observed in MEASB-02); the nonce must live in `window.<global>` injected by `addInitScript`, which the current test confirms survives new pages and cross-origin navigation.

### Q3 — Persistent context (Falcon-chosen UDD) while OPEN
Per rep (all six identical):
- `SingletonLock` present in UDD: `false`. (On macOS headless, Chromium does not create a `SingletonLock` symlink in the UDD during the lifetime of this launch. The file was checked ~500 ms after a page navigation while the context was still open.)
- `DevToolsActivePort` present in UDD: `false`. (CDP is over `--remote-debugging-pipe`, not an HTTP port, so this file is not written.)
- `--user-data-dir=<chosenUDD>` present in the wrapper-recorded argv: TRUE in every rep (`uddMatchesChosen = true`).
Consequence: on macOS/headless with `--remote-debugging-pipe`, `SingletonLock`/`DevToolsActivePort` are NOT reliable owner-pid signals. The wrapper-recorded argv IS a reliable, mechanism-independent record of the UDD and the owner (`wrapper_pid`). On Linux the lockfile semantics may differ and are OPEN.

### Q4 — Argv diff stability
- Raw argv across 6 launches: NOT equal (differs only in the temp `--user-data-dir=/var/folders/.../playwright_chromiumdev_profile-XXXXXX`). This is the only varying flag observed; `--remote-debugging-pipe`, log files, and pipe fds were not variable on this host.
- Normalised argv (replace `--user-data-dir=...` → `--user-data-dir=<TMP>`, and placeholders for `--remote-debugging-pipe`, `--crashpad-handler-pid`, `--log-file`): IDENTICAL across all 6 ephemeral launches per Node and ACROSS Node 22 and Node 24. Baseline length 45 flags.
- Mutation detection: launch with `args: ['--disable-gpu']` → the diff against the normalised baseline contains `--disable-gpu` in `onlyMut` in every rep (`mutationDetected = true`).
Consequence: a committed normalised argv baseline is a stable fingerprint on this (macOS/arm64/pw-1.64) combination; drift from a Playwright minor-version flag change is an OPEN risk and must be guarded by re-baselining on every Playwright upgrade.

### Q5 — Wrapper trust and tamper
Pre-launch trust checker (observed per rep, identical result):
- Baseline wrapper: PASS (uid=501, mode=755, parent 755, sha matches).
- Mod-byte (append ` `): REJECT reason `sha-mismatch`.
- `chmod g+w` (mode 775): REJECT reason `group-or-other-writable`.
- Symlink to wrapper: REJECT reason `symlink` (via `fs.lstatSync`).
- `/bin/echo` as a stand-in for a replaced exe path: REJECT reason `uid-mismatch` (root-owned). The sha check would also have rejected it had the uid matched.
- Wrapper placed inside a 0777 parent dir: REJECT reason `parent-dir-writable`.
All five tamper variants fail-closed BEFORE launch in every rep.

TOCTOU (pre-check passes, wrapper overwritten before `exec`, then launched):
- `preCheck.ok = true` with `sha = f0661b04...`.
- After tamper (append one byte) and launch: `toctouPostHash = 7648e55f...`, `detectedPostLaunch = true` in every rep.
- `ps -p wrapperPid` shows the exec'd Chromium command line (not the wrapper) because the wrapper has already `exec`'d; `lsof -p wrapperPid` `txt` entries list the Chromium framework binaries (not the wrapper path), so running-process-based detection is not reliable on macOS. The only reliable post-launch detector shown here is hashing the wrapper file at the known path and comparing against the pre-launch pin — which DOES detect the tamper IF the attacker leaves the modified file in place. If the attacker restores the original file after launch, this post-launch hash check WOULD NO LONGER DETECT the TOCTOU — explicitly uncovered.

### Q6 — Linux
- `docker version` → Server 28.5.2 reachable.
- `docker image ls` → no `mcr.microsoft.com/playwright/*` or any image whose tag/digest matches a Playwright-capable base.
- Decision per task rule ("do not pull large images"): Linux NOT MEASURED. No Linux data.

## Mechanism x scenario matrix (OBSERVED)

Legend: DETECT = mechanism, as measured, produced a difference a detector can refuse on. MISS = mechanism did not surface the scenario. N/A = not meaningful for this mechanism. UNMEAS = scenario not exercised.

| Scenario | Wrapper argv/pid record | sha256 pin on wrapper file | Pre-launch trust checker | `browser.on('disconnected')` | `page.on('crash')` | Per-run nonce (`addInitScript`) + per-realm CDP read | `kill -0 wrapper_pid` |
|---|---|---|---|---|---|---|---|
| (Q1.a) `kill -9` of true browser main | DETECT (wrapper_pid is the main; recorded) | N/A | N/A | DETECT (lat 22–35 ms, 6/6) | N/A | DETECT indirectly (post-crash evaluate ERR) | DETECT (ESRCH 6/6) |
| (Q1.b) renderer crash via chrome://crash | N/A | N/A | N/A | MISS (no fire, correct) | DETECT 6/6 | DETECT (crashed page evaluate ERR; fresh page re-reads nonce OK) | MISS (main alive) |
| (Q1.c) kill of a non-renderer helper (GPU) | N/A | N/A | N/A | MISS (correct — browser recovers) | MISS on `pageQ1` (correct) | N/A | MISS |
| (Q1.d) kill of the specific renderer backing a Page | UNMEAS | N/A | N/A | UNMEAS | UNMEAS (inferred DETECT from (b)) | UNMEAS | UNMEAS |
| (Q2.a) nonce stable at same origin | N/A | N/A | N/A | N/A | N/A | DETECT (match 6/6) | N/A |
| (Q2.b) cross-origin navigation | N/A | N/A | N/A | N/A | N/A | DETECT (match 6/6; `addInitScript` re-injects) | N/A |
| (Q2.c) new page in same context | N/A | N/A | N/A | N/A | N/A | DETECT (match 6/6) | N/A |
| (Q2.d) renderer crash + new page | N/A | N/A | N/A | N/A | DETECT via `page.on('crash')` | DETECT on fresh page; on crashed page: evaluate ERR | N/A |
| (Q3) persistent context UDD identity while open | DETECT (UDD in recorded argv, 6/6) | N/A | N/A | N/A | N/A | N/A | DETECT (wrapper_pid is owner) |
| (Q3') `SingletonLock`/`DevToolsActivePort` owner-pid signal on macOS/headless/pipe | N/A | N/A | N/A | N/A | N/A | N/A | MISS (files absent — do NOT rely on them on this platform) |
| (Q4.a) argv-identical across 6 launches, normalised | DETECT (match 6/6 per Node and across Nodes 22/24) | N/A | N/A | N/A | N/A | N/A | N/A |
| (Q4.b) argv change (`--disable-gpu` injected) | DETECT 6/6 | N/A | N/A | N/A | N/A | N/A | N/A |
| (Q5.a) wrapper byte modified | N/A | DETECT (sha-mismatch) | DETECT | N/A | N/A | N/A | N/A |
| (Q5.b) wrapper chmod g+w | N/A | MISS (sha still matches) | DETECT (mode) | N/A | N/A | N/A | N/A |
| (Q5.c) wrapper replaced with symlink | N/A | MISS (sha of target still matches) | DETECT (lstat) | N/A | N/A | N/A | N/A |
| (Q5.d) `executablePath` repointed to foreign binary | N/A | DETECT (sha-mismatch) | DETECT (uid-mismatch and/or sha-mismatch) | N/A | N/A | N/A | N/A |
| (Q5.e) parent dir world-writable | N/A | MISS (file sha unchanged until an attacker acts) | DETECT (parent mode) | N/A | N/A | N/A | N/A |
| (Q5.f) TOCTOU — swap wrapper between check and exec, leave swapped | DETECT (post-launch hash of recorded path differs 6/6) | DETECT (post-launch re-hash) | N/A at pre-launch | N/A | N/A | N/A | N/A |
| (Q5.g) TOCTOU — swap wrapper, exec, restore original | UNMEAS | MISS (hash re-matches) | MISS (pre-check passes before swap) | N/A | N/A | N/A | N/A |
| (Q6) Linux (docker) | UNMEAS | UNMEAS | UNMEAS | UNMEAS | UNMEAS | UNMEAS | UNMEAS |

## Uncovered scenarios (EXPLICIT — not an empty set)

1. Linux CI behaviour of all mechanisms (Q6). No image available locally; task rule forbids pull.
2. Kill of the specific renderer process backing a target `Page` by PID — only the GPU helper (first child) was killed; `page.on('crash')` detection via chrome://crash is a proxy, not the same test.
3. `SingletonLock` and `DevToolsActivePort` under headed and/or non-pipe (`--remote-debugging-port=`) modes on macOS and under any mode on Linux. On macOS/headless/pipe these files are ABSENT and must NOT be relied on.
4. TOCTOU where attacker restores original wrapper file after exec — post-launch file hash check WOULD NOT DETECT this.
5. Running-process image hash on macOS (no `/proc/<pid>/exe`); `lsof -p <wrapper_pid>` `txt` lists Chromium frameworks post-exec, not the wrapper. Alternative detection channels (e.g., codesign verification, EndpointSecurity events) NOT MEASURED.
6. Playwright version drift of the normalised argv baseline — baseline was stable within pw 1.64.0 across both Nodes but has not been exercised across minor Playwright upgrades.
7. Multiple-browser concurrent launches sharing one wrapper (parallel reps shared `WRAPPER` file; sequential reps did not stress concurrent file access).
8. Headed launches, non-default channels (chrome, msedge), persistent-context long-lived use (>500 ms).
9. CI runner tenancy: on a shared-tenant runner, parent-dir and uid trust requires policies not measured here.
10. Attacker with the Falcon user's own UID — all file trust checks assume the attacker is a different UID; a same-UID attacker trivially passes the pre-check and can replace the wrapper after the check.

## Observed vs inference boundary

OBSERVED directly: everything in the per-question sections and matrix cells marked DETECT/MISS/N/A with 6/6 rep counts.
INFERENCE (not independently measured in MEASB-03): that killing the specific renderer PID backing `pageQ1` would surface via `page.on('crash')` (inferred from the chrome://crash result); that the Linux equivalents behave similarly; that normalised argv stays stable across Playwright minor upgrades; that a same-UID attacker is out of scope for the current trust model.

## Cleanup

`pgrep -lf chromium-1248` returned empty immediately after every rep and at task end (see `cleanup` ndjson event with `leftoverBefore` and `leftoverAfter` both empty strings in every rep). All launched browsers were closed cleanly or killed and reaped.

## Evidence files (absolute paths)

- Probe: `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/measb3/probe.js`
- Wrapper (hash-pinned): `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/measb3/wrapper.sh`
- Raw ndjson per rep: `raw-n22-r{0,1,2}.ndjson`, `raw-n24-r{0,1,2}.ndjson`
- Logs per rep: `log-n22-r{0,1,2}.txt`, `log-n24-r{0,1,2}.txt`
- Wrapper launch records per scenario: `wrap-r{0,1,2}-n{22,24}-q{1,2,3}.ndjson`, `wrap-r*-n*-q4-{0..5,mut}.ndjson`
- Persistent context dirs: `udd-r{0,1,2}-n{22,24}/`
- Tamper variants per rep: `tamper-r{0,1,2}-n{22,24}/{wrapper-mod.sh,wrapper-gw.sh,wrapper-symlink.sh,parent-writable/wrapper.sh,wrapper-toctou.sh,wrap-toctou-rec.ndjson}`
- Prior MEASB-02: `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/measb2/measb2-findings.md`
