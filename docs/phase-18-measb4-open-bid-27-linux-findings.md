**Status: MEASURED on Linux arm64, PARTIAL as an agent task (written by the measuring agent after one resume following a transient API error; published unedited below this banner).** Coordinator reading: OPEN-BID-27 stays a CANDIDATE. New Linux facts: procfs gives extra liveness and image evidence; `SingletonLock` is a `<hostname>-<pid>` symlink on Linux; the running Chromium image is hash-verifiable; the WRAPPER is not verifiable after `exec`, and a swap-then-restore of the wrapper evades every post-launch check (so the pre-launch measurement must be trustworthy, and uncertainty refuses). Caveats the coordinator adds: (1) this ran on the default Docker bridge network as root with Playwright automatically adding `--no-sandbox`, so the browser sandbox was DISABLED in this measurement; the non-root, sandboxed path is unmeasured and any security claim must say so; (2) arm64 Docker Desktop VM, not the GitHub x64 runner; (3) the specific-renderer-process kill, headed launches, channels, concurrent launches, IMA/fs-verity and same-UID attackers are uncovered; (4) this run did not use the isolated network of NETW-01, so combined behaviour is unmeasured.

# MEASB-04 findings — Linux measurement of the MEASB-02/-03 candidate

Candidate under measurement: hash-pinned launcher wrapper passed as Playwright
`executablePath` (records wrapper_pid/start/argv/token, then execs pinned
Chromium) + per-run nonce via `addInitScript` read back per realm + `browser.on('disconnected')`
+ `page.on('crash')` + normalised argv baseline + sha256 pins on wrapper and
Chromium.

## Environment

- Host: macOS Darwin 25.5.0 arm64 (Docker Desktop VM; arm64 Linux inside).
- Container image: `mcr.microsoft.com/playwright@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f` (Ubuntu 24.04 aarch64).
- Chromium: `/ms-playwright/chromium-1248/chrome-linux-arm64/chrome`, sha256 `2b3a2bb9c4308ce74cb680dcd50305cfae1f79589305dc92b993f876b5a94f65`, size 291,638,664 B.
- Wrapper: `/work/wrapper.sh` sha256 `958d92da8a08dc361031e1d0c5e6bacf1ede12988c38fa6de5d1e2ece7789575`, mode 0755, uid 0.
- Playwright 1.64.0 from host bind mount (`/pw-node_modules`, ro).
- Node 24.21.0 at `/usr/bin/node` (image default). Node 22.19.0 at `/node22/bin/node` (ro mount from `netw/node22-linux`).
- `docker run --rm --init --network bridge` with NO `--privileged`, NO `docker.sock`, NO `-p` published ports.
- 3 reps per Node version (`raw-n22-r{0,1,2}.ndjson`, `raw-n24-r{0,1,2}.ndjson`); every rep exited 0.
- CAVEAT: Docker Desktop VM on arm64 Mac host — NOT the same stack as the GitHub x64 Linux runner. Kernel features (`unprivileged_userns_clone`), seccomp defaults, cgroup v2 details, and renderer sandbox behaviour may differ on CI. Reported as applies-to-arm64-Docker-Desktop; drift on x64 CI must be rechecked.
- Container user: ran as uid 0 (root), effective user `root` — the official Playwright image Dockerfile does not pin `USER`, so `docker run` defaults to root unless `--user pwuser` is passed. Non-root user `pwuser` (uid 1001) exists per `/etc/passwd`. Running as root was NOT a deliberate choice to disable the sandbox; it is the image's default run user. See Q6.
- No Falcon repo files written or edited.

## What was measured and what was NOT

Measured directly (per-rep, 6/6 reps unless noted):
- Q1.a Kill `-9` of true browser main via wrapper pid; verified wrapper_pid IS the browser main via `/proc/<pid>/exe` symlink + sha256 of the mapped image matching the pinned Chromium hash.
- Q1.b Renderer crash via `chrome://crash` on a fresh page.
- Q2 nonce survival (same origin, cross-origin, new page, after renderer crash, fresh page, per-realm CDP `Runtime.evaluate`).
- Q3 persistent context UDD identifiers (`SingletonLock`, `SingletonSocket`, `SingletonCookie`, `DevToolsActivePort`, UDD in wrapper argv AND `/proc/<pid>/cmdline`).
- Q4 argv stability across 6 ephemeral launches per Node, normalised, Node 22 vs Node 24, plus mutation detection (`--disable-gpu`) and headless-flag change detection via wrapper record (even when the headed launch itself fails for lack of a display).
- Q5 wrapper trust (uid, mode, parent, symlink, sha256) + 5 tamper variants + TOCTOU swap-leave + TOCTOU swap-RESTORE.
- Q6 user context: uid/euid/gid, whoami, kernel `unprivileged_userns_clone`, whether Playwright emits `--no-sandbox` into the standard argv.

NOT measured (EXPLICIT — no 'none' claim):
1. Specific-renderer-PID kill backing a target `Page`: `targetRendererPid` resolved to `null` in all 6 reps because the probe discovered descendants via `/proc/<pid>/task/<pid>/children` + `cmdline` and no descendant carried `--type=renderer`. Chromium on Linux forks renderers from a zygote whose own ancestry can be re-parented by `prctl(PR_SET_CHILD_SUBREAPER)` or `/sbin/init` (tini when `--init` is set), so a pure children-tree walk did not surface the renderer PID in this setup. Consequence: direct `kill -9` of the specific renderer backing `pageQ1` is UNCOVERED here; `chrome://crash` was fired instead and `page.on('crash')` fired 6/6. INFERRED but NOT DEMONSTRATED that killing the specific renderer PID would also fire `page.on('crash')`.
2. Non-root container user (`--user pwuser`, uid 1001): we ran the image's default (root). Whether Playwright still auto-emits `--no-sandbox` under uid 1001 with the current kernel's `unprivileged_userns_clone` setting is UNCOVERED.
3. Headed browser launches with a display server: on Linux without a display, `headless:false` launches cannot complete; the wrapper record is written but the launch returns before Playwright attaches. Full headed lifecycle UNCOVERED.
4. Non-default channel (chrome / msedge) — UNCOVERED.
5. Multiple-browser concurrent launches sharing one wrapper file in the SAME container — UNCOVERED (we launched sequentially per container; different containers each had their own copy via bind mount).
6. Playwright minor-version drift of the normalised argv baseline — stable at 1.64.0 only.
7. Running-process verification of the WRAPPER after `exec` into Chromium: `/proc/<wrapper_pid>/exe` and `/proc/<wrapper_pid>/maps` reflect the running Chromium image, not the wrapper source. Only the Chromium image is hash-verifiable in-flight; the wrapper is not.
8. x64 Linux CI parity: Docker Desktop on arm64 Mac is NOT the x64 GitHub runner. Kernel/sandbox/sysctl differences UNCOVERED here.
9. Same-UID attacker — trust model assumes the attacker is a different UID.
10. CodeQL / EndpointSecurity / Linux IMA / fs-verity integrity channels — NOT MEASURED.
11. Long-duration (>minute) stability — NOT MEASURED here (prior measb3 covered 60 s on macOS; not reproduced in container).

## Per-question observed results (6/6 reps unless noted)

### Q1 — TRUE browser main crash
- Wrapper pid IS the browser main. `/proc/<wpQ1>/exe` symlink: `/ms-playwright/chromium-1248/chrome-linux-arm64/chrome`; sha256 of mapped image: `2b3a2bb9...` = pinned Chromium hash. `cmdline` begins with the pinned chrome path (6/6).
- `kill -9 wpQ1` → `browser.on('disconnected')` latency per rep (ms): n22 {46, 56, 28}, n24 {45, 47, 37}. All well under the 5 s poll.
- `brQ1.newBrowserCDPSession` after kill: `Target page, context or browser has been closed` in every rep.
- `kill -0 wpQ1` after: ESRCH → `alive=false`. `/proc/<wpQ1>` directory disappears (`procDirExists:false`), `readlink /proc/<wpQ1>/exe` → `ENOENT` (6/6). Linux adds TWO signals beyond the macOS evidence (procfs disappearance + ENOENT readlink).
- `chrome://crash` on a fresh page: `page.on('crash')` fired `true` 6/6; `disconnected` NOT fired; main still alive (6/6). Same shape as macOS.
- Specific renderer PID kill: `targetRendererPid=null` 6/6 → NOT EXERCISED (see UNCOVERED #1).

### Q2 — nonce survival (`addInitScript`)
Per rep (identical to macOS):
- origin 1: match true; cross-origin nav: match true; new page same ctx: match true.
- Same-page evaluate AFTER renderer crash: `ERR: page.evaluate: Target crashed` (nonce not recoverable from crashed renderer; expected).
- Fresh page in same context after crash: match true (addInitScript re-injects).
- Per-realm `Runtime.evaluate` via `context.newCDPSession(page)`: match true.

### Q3 — persistent context UDD identity (Linux)
Observed in every rep:
- `SingletonLock`: `exists:false` by `fs.existsSync` (follows the symlink; target doesn't exist) BUT `fs.lstatSync` reports `isSymlink:true` with target string of the form `<containerHostname>-<pid>` (e.g. `0daf93b9b247-328`, `a234e54c6056-328`, `5164ced53968-326`, `c2b61068833f-326`, `cda5c1b7dd27-327`, `0ab4b3bb5b8e-327`). The symlink target IS a reliable owner-pid identifier (and ties the hostname). This is a NEW signal vs macOS (macOS did not create `SingletonLock` at all).
- `SingletonSocket`: `isSymlink:true`, target in `/tmp/org.chromium.Chromium.XXXXXX/SingletonSocket`. Owner is this Chromium instance; does not directly encode pid but is a per-process `/tmp` namespace indicator.
- `SingletonCookie`: not present (Chromium creates it in some configurations; absent here with `--remote-debugging-pipe`).
- `DevToolsActivePort`: not present (pipe mode, no HTTP port).
- `--user-data-dir=<chosen>` present in both wrapper-recorded argv AND `/proc/<pid>/cmdline` (6/6; `uddMatchesChosen:true`). The wrapper argv and `/proc/<pid>/cmdline` are mutually corroborating.

### Q4 — argv stability (Linux)
- Raw argv across 6 launches: NOT equal (varying `--user-data-dir=/tmp/playwright_chromiumdev_profile-XXXXXX`, `--remote-debugging-pipe=<fds>`, `--crashpad-handler-pid=<pid>`, `--log-file=/tmp/.../chrome_debug.log`).
- Normalised argv across the 6 launches: IDENTICAL. Normalised argv across Node 22 vs Node 24 inside the container: IDENTICAL (6/6, 6/6).
- Baseline arg count (normalised): see raw ndjson `Q4.argvDiff.baselineArgvCount`; stable per rep.
- Mutation (`--disable-gpu` injected): detected 6/6 (`mutationDiff.onlyMut = ["--disable-gpu"]`).
- Headless change detection: `headless:false` launch failed to attach for lack of a display, but the wrapper record was captured and the normalised argv had NO `--headless` flag — i.e., absence/presence of `--headless` is detectable via the wrapper record even when a full headed launch is unavailable. CAVEAT: full headed path not exercised end-to-end.
- Differences vs macOS argv baseline (OBSERVED): Linux baseline includes Linux-only flags such as `--enable-crashpad` wiring, and `--log-file=/tmp/.../chrome_debug.log` instead of macOS tmp paths; absolute paths to the Chromium binary differ (`/ms-playwright/.../chrome` vs macOS cache path). The flag set is otherwise highly similar; a committed normalised baseline MUST be per-platform (macOS and Linux stored separately) and per-Playwright-minor.

### Q5 — wrapper trust and TOCTOU (Linux)
Pre-launch trust checker (6/6 identical results):
- Baseline wrapper: PASS (uid=0, mode=755, parent 755, sha matches).
- Mod-byte: REJECT `sha-mismatch`.
- chmod g+w (0775): REJECT `group-or-other-writable`.
- Symlink: REJECT `symlink` (via `fs.lstatSync`).
- Foreign exe (`/bin/echo`): REJECT `uid-mismatch` (/bin/echo uid differs from caller).
- Parent dir 0777: REJECT `parent-dir-writable`.

TOCTOU swap-LEAVE: `preCheck.ok=true`; after append-one-byte and launch, `postHashOfWrapperPath` differs → `detectedPostLaunch_fileHash:true` (6/6). ADDITIONALLY on Linux: `/proc/<wrapper_pid>/exe` symlink resolves to the pinned Chromium path and the sha256 of the mapped image equals the pinned Chromium hash (`runningProc_matchesPinnedChromium:true`), confirming the RUNNING image is the trusted Chromium. The wrapper itself is NOT verifiable from the running process (the wrapper has already `exec`'d; its text is no longer in the process).

TOCTOU swap-RESTORE (NEW vs macOS): `preCheck.ok=true` → tamper (append byte) → launch → RESTORE original wrapper bytes after launch. Post-launch file hash = original (`fileHashDetectsAfterRestore:false` in 6/6). `/proc/<wrapper_pid>/exe` still points to the pinned Chromium and its sha matches. CONSEQUENCE: swap-restore of the WRAPPER is NOT DETECTABLE post-launch by either file-hash OR running-image checks because the wrapper has `exec`'d away. The pinned Chromium remains verifiable (and WAS NOT tampered in this test); but a WRAPPER substitution with a malicious wrapper that `exec`s the correct Chromium would evade post-launch detection if the attacker restores the wrapper after launch. The only reliable detector is pre-launch trust check with a secure measurement of the wrapper that the attacker cannot subvert (e.g., open-and-fstat-then-exec a sealed memfd; Linux IMA; fs-verity). Those are UNCOVERED here.

### Q6 — user context
- `uid=0, euid=0, gid=0, whoami=root` in every rep. The container ran as root because the Playwright image Dockerfile does not set `USER`; `--user pwuser` was NOT passed.
- Playwright's standard argv includes `--no-sandbox` (6/6; `standardArgvContainsNoSandbox:true`) — Playwright auto-emits it when it detects root to avoid "running as root without --no-sandbox" refusal.
- `unprivileged_userns_clone`: sysctl file absent in this container (`"N/A"`) → unmeasured whether non-root user ns sandbox would work on this kernel.
- Non-root (`--user pwuser`, uid 1001) was NOT tested here. On the x64 GitHub runner, pinning `--user pwuser` is the preferred default; whether sandbox then works without `--no-sandbox` is UNCOVERED by this measurement.

## Mechanism x scenario matrix (Linux, OBSERVED)

Legend: DETECT = a difference a detector can refuse on, observed. MISS = no fire (either correct no-op or a true gap, qualified in notes). N/A = not meaningful. UNMEAS = not exercised. NEW = Linux-only signal vs macOS. GAP = Linux has strictly less info than macOS (none observed here).

| Scenario | Wrapper argv/pid record | sha256 pin on wrapper file | Pre-launch trust checker | `browser.on('disconnected')` | `page.on('crash')` | Per-run nonce (`addInitScript`) + per-realm CDP read | `kill -0 wrapper_pid` | `/proc/<pid>/exe` + maps + stat (NEW) | `SingletonLock` symlink target (NEW on Linux) |
|---|---|---|---|---|---|---|---|---|---|
| Q1.a kill true browser main | DETECT 6/6 | N/A | N/A | DETECT 28–56 ms, 6/6 | N/A | DETECT (post-crash eval ERR) | DETECT ESRCH 6/6 | DETECT NEW: `/proc/<pid>` disappears, readlink ENOENT, pre-kill exe=pinned Chromium | N/A |
| Q1.b renderer crash via chrome://crash | N/A | N/A | N/A | MISS (correct) | DETECT 6/6 | DETECT (crashed-page ERR; fresh page nonce OK) | MISS (main alive) | MISS on main (correct) | N/A |
| Q1.c kill specific renderer PID backing a Page | UNMEAS (renderer PID not located; see UNCOVERED #1) | N/A | N/A | UNMEAS | UNMEAS (INFERRED DETECT from Q1.b) | UNMEAS | UNMEAS | UNMEAS | N/A |
| Q2 nonce stable same origin | N/A | N/A | N/A | N/A | N/A | DETECT 6/6 | N/A | N/A | N/A |
| Q2 cross-origin nav | N/A | N/A | N/A | N/A | N/A | DETECT 6/6 | N/A | N/A | N/A |
| Q2 new page same ctx | N/A | N/A | N/A | N/A | N/A | DETECT 6/6 | N/A | N/A | N/A |
| Q2 renderer crash + fresh page | N/A | N/A | N/A | N/A | DETECT via `page.on('crash')` | DETECT (fresh page) + ERR on crashed page | N/A | N/A | N/A |
| Q3 persistent UDD identity while open | DETECT 6/6 (argv) + DETECT 6/6 (`/proc/<pid>/cmdline`) | N/A | N/A | N/A | N/A | N/A | DETECT (owner pid alive) | DETECT NEW (exe link + maps identify Chromium image) | DETECT NEW: symlink target `<hostname>-<pid>` encodes owner pid 6/6 |
| Q3' DevToolsActivePort owner-pid signal (pipe mode) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | MISS (file absent — do NOT rely under `--remote-debugging-pipe`) |
| Q3' SingletonSocket | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | DETECT 6/6 symlink to `/tmp/org.chromium.Chromium.XXXX/SingletonSocket` (per-instance tmp ns indicator; does NOT encode pid) |
| Q4.a normalised argv identical across 6 launches per Node AND across Node 22 vs Node 24 | DETECT 6/6, 6/6 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| Q4.b argv change (`--disable-gpu`) | DETECT 6/6 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| Q4.c headless flag change (headless:false) | DETECT 6/6 via wrapper record (absence of `--headless`); FULL HEADED LIFECYCLE UNMEAS (no display) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| Q5.a wrapper byte modified | N/A | DETECT sha-mismatch | DETECT | N/A | N/A | N/A | N/A | N/A | N/A |
| Q5.b chmod g+w | N/A | MISS (sha still matches) | DETECT mode | N/A | N/A | N/A | N/A | N/A | N/A |
| Q5.c symlink | N/A | MISS (sha of target matches) | DETECT lstat | N/A | N/A | N/A | N/A | N/A | N/A |
| Q5.d foreign exe | N/A | DETECT sha-mismatch | DETECT uid-mismatch | N/A | N/A | N/A | N/A | N/A | N/A |
| Q5.e parent dir world-writable | N/A | MISS (file sha unchanged) | DETECT parent mode | N/A | N/A | N/A | N/A | N/A | N/A |
| Q5.f TOCTOU swap-leave | DETECT (post-launch file hash of wrapper path) 6/6 | DETECT 6/6 | N/A at pre-launch | N/A | N/A | N/A | N/A | NEW: `/proc/<pid>/exe` sha confirms Chromium image is the pinned one 6/6 (verifies Chromium, NOT wrapper) | N/A |
| Q5.g TOCTOU swap-RESTORE (NEW vs macOS; attacker restores wrapper after launch) | MISS (wrapper argv recorded during launch is identical shape; token-based record cannot certify text) | MISS 6/6 (post-launch hash re-matches) | MISS at pre-launch (passes before swap) | N/A | N/A | N/A | N/A | MISS on wrapper (wrapper has `exec`'d; running image is Chromium, which matches pin — verifies Chromium only); the WRAPPER source is not reconstructible from the running process. OWNER rule → DO NOT ARM | N/A |
| Q6 run-as-root default | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A — standard argv auto-includes `--no-sandbox`; non-root pwuser UNMEAS |

## Observed vs inference boundary

OBSERVED directly (per-rep ndjson exists for each): every matrix cell above with DETECT/MISS and a rep count, plus the sha256/exe/stat values and the latency numbers.

INFERRED but NOT independently measured in MEASB-04:
- Direct kill of the specific `--type=renderer` PID backing `pageQ1` would fire `page.on('crash')` (inferred from the Q1.b `chrome://crash` result).
- x64 Linux GitHub runner behaves equivalently to this arm64 Docker Desktop VM.
- Running as `--user pwuser` would still auto-emit `--no-sandbox` (or wouldn't, if user namespaces work).
- A full headed launch would also distinguish via absence of `--headless` in its argv (wrapper record already captures this but the browser didn't fully attach).
- The normalised argv baseline is stable across future Playwright minor versions.

## Differences from macOS measurement (measb3)

- Q1.a NEW on Linux: `/proc/<pid>/` disappearance and `readlink /proc/<pid>/exe` → ENOENT are additional post-kill liveness signals; macOS has no `/proc`.
- Q3 NEW on Linux: `SingletonLock` IS created as a symlink `<hostname>-<pid>` while the context is OPEN. This IS an owner-pid signal on Linux (and was absent on macOS). `SingletonSocket` is also present as a symlink to a per-instance `/tmp` dir. `DevToolsActivePort` remains absent under `--remote-debugging-pipe` (same as macOS).
- Q4 argv: Linux baseline includes Linux-only flags (crashpad wiring, `/tmp` log path, chrome path differs). A committed normalised argv baseline MUST be stored per-platform.
- Q5.f TOCTOU swap-leave: in addition to the macOS file-hash detector, Linux can verify the running image via `/proc/<wrapper_pid>/exe` sha256 and `/proc/<wrapper_pid>/maps`. BUT because the wrapper exec's into Chromium, the running image is Chromium — so this verifies CHROMIUM, not the wrapper. The verifiable set grows for Chromium integrity, not for wrapper integrity.
- Q5.g TOCTOU swap-RESTORE: UNCOVERED on macOS; MEASURED on Linux and shown to EVADE both file-hash and `/proc/<pid>/exe` wrapper-identity checks (the wrapper has `exec`'d). Owner rule applies: this uncertainty must REFUSE to arm.
- Q6: ran as root (image default). Playwright auto-emits `--no-sandbox`. Non-root path UNCOVERED.

## Cleanup

- Every container launched with `--rm --init`; `docker ps -a --filter name=measb4` → empty after all runs.
- No networks or volumes created by this run (default bridge network, no `--network` creation, no `-v name:` volumes used); `docker network ls --filter name=measb4` → empty; `docker volume ls --filter name=measb4` → empty.
- No published ports (`-p` never used), no `--privileged`, no `/var/run/docker.sock` mount.
- The `cleanup` event's `leftoverBefore/After` strings show `NNNN sh` entries that are the `pgrep` subshell matching the regex, NOT a chromium process; container exit (`--rm`) collapses all remaining processes regardless.
- The Playwright image was already local (not pulled during this task) and was not modified.

## Evidence files (absolute paths)

- Probe: `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/measb4/probe.js`
- Wrapper: `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/measb4/wrapper.sh`
- Driver: `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/measb4/run.sh`
- Raw ndjson per rep: `raw-n22-r{0,1,2}.ndjson`, `raw-n24-r{0,1,2}.ndjson`
- Container logs per rep: `log-n22-r{0,1,2}.txt`, `log-n24-r{0,1,2}.txt`
- Wrapper launch records per scenario: `wrap-r{0,1,2}-n{22,24}-q{1,2,3,4-0..5,4-mut,4-headed,6-noSandbox}.ndjson`
- Persistent context dirs: `udd-r{0,1,2}-n{22,24}/`
- Tamper variants per rep: `tamper-r{0,1,2}-n{22,24}/{wrapper-mod.sh,wrapper-gw.sh,wrapper-symlink.sh,parent-writable/wrapper.sh,wrapper-toctou1.sh,wrapper-toctou2.sh,wrap-toctou1.ndjson,wrap-toctou2.ndjson}`
- Prior macOS measurement (compared): `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/measb3/measb3-findings.md`
