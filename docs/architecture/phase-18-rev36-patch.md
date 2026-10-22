# Phase 18 rev 36 — FW-2 gains its first MEASURED candidate (FW2-C6, environment-level) but keeps refusing; OPEN-BID-27 reconciled with Linux (MEASB-04); m-108 and m-109 fixed

Narrow addendum on rev 35 (`cd9f843`), rev 34 (`0418106`) and rev 33 (`183e341`). **Docs-only.** Reviewed-against: Security **SEC-31** (`docs/security/phase-18-design-review-30.md`, m-108/m-109). Measurement inputs: `docs/phase-18-netw01-isolated-proxy-findings.md` (NETW-01), `docs/phase-18-measb4-open-bid-27-linux-findings.md` (MEASB-04), `docs/phase-18-measb3-open-bid-27-findings.md` (MEASB-03), `docs/phase-18-fw2-csp-containment-findings.md` (FW2SP-01).

It **supersedes**: rev 35 section 1.4 (candidate table), section 2.1 rows BID-M2/M6, section 2.2 items 1 and 5, section 2.3, section 3.2 and section 4, and the rev 35 gates table. Everything else in rev 33/34/35 stands. `decide32.js` unchanged (sha256 `e197ec58f6084f03508cac198e21630eb31eb3f2218023c227642fb898b3a522`); `gate34.js` unchanged (sha256 `92ad5650c386f8a37d5f7caa6c25255f100711f61e6a86860c758639f04ca95f`). **No implementation, merge, tag, release or customer claim is authorised by this document.**

Owner rulings in force, carried unchanged: **OWNER-24** strict same-process browser posture with the **empty supported-browser set accepted**; **no identity uncertainty may arm**; **worker WebSocket traffic must be contained or must cause a fail-closed refusal and is NOT excluded from the security claims**; **CSP-through-routing (FW2-C1) is REJECTED**; **no other FW-2 mechanism may be attempted without owner review**; no implementation, no merge.

Wording discipline: **OBSERVED** = measured on the stated environment with the stated runs; **INFERENCE** = reasoning from observations, not independently proven; **REQUIREMENT / RECOMMENDATION** = normative design text, not a measurement. Nothing in this document converts a REQUIREMENT into evidence.

> Paths beginning `scratchpad/` name coordinator-machine evidence locations (not tracked); normative text they contain is reproduced here.

---

## 1. FW-2 — FW2-C6 is the first MEASURED candidate; the production gate still refuses

### 1.1 What was observed (NETW-01)

**OBSERVED** (`docs/phase-18-netw01-isolated-proxy-findings.md`; Docker 28.5.2 **linux/arm64 Docker Desktop VM on macOS Darwin 25.5.0**, image `mcr.microsoft.com/playwright@sha256:06a9939…e971f` (Ubuntu 24.04 aarch64), Playwright 1.64.0, Chromium 156.0.8078.4, Node 22.19.0 **and** 24.21.0, 3 reps per decisive case, 5 phases; topology = `docker network create --internal falcon-iso` for the browser container, `falcon-out` for fixtures, dual-homed allowlist proxy on both networks, Chromium launched with `--proxy-server`):

- Denied-fixture final counters: `ws_upgrade=0`, `tls_http=0`, `tls_ws_upgrade=0`, `http=1` (the `docker exec` `/counts` self-check only). **0 escapes across all phases, both Nodes, all reps.**
- Page, `fetch`/XHR, page `ws`, page `wss` (via CONNECT), **dedicated, nested, blob and module worker** WebSockets all routed through the proxy; allowed destinations **OPENED** (working positive control — the control FW2-C1 lacked), denied destinations got `error`/403 with **0** arrivals at the denied fixture.
- From inside `falcon-iso`: all external DNS, TCP, UDP, QUIC, IPv6, Docker-gateway and `host.docker.internal` attempts FAILED (`EAI_AGAIN`/`ESERVFAIL`/`ENETUNREACH`). Only the proxy was reachable.
- No-proxy, `--proxy-bypass-list=*`, `--proxy-bypass-list=<-loopback>` and `--enable-quic` produced **no escape**; proxy failure modes (garbage, hanging, unreachable) produced `ERR_INVALID_HTTP_RESPONSE` / timeout / `ERR_PROXY_CONNECTION_FAILED` with **no direct fallback**.
- Ten proxy-bypass attempts (CONNECT to denied host, CONNECT to allowed:25/22, absolute-URI, Host-header trick, IPv6 literal, decimal/octal IP, link-local `169.254.169.254`, `host.docker.internal`) all returned 403 or reached only the allowed fixture; **none** reached the denied fixture.

**INFERENCE (not OBSERVED).** The network boundary, not the proxy, is the authoritative layer; the proxy allowlists within the reachable set. The findings' own "viable for Falcon CI network containment" sentence is INFERENCE and is **not** adopted as a verdict here.

### 1.2 How it is recorded — FW2-C6, a MEASURED **environment property**, not yet a Falcon mechanism

**REQUIREMENT.** This is recorded as a **new candidate FW2-C6 — "verified isolated network plus allowlist egress proxy"** — deliberately **not** as C5 (C5 is an in-Falcon loopback MITM that adds CSP headers and was not measured) and **not** silently as C4 (C4 is *unverified* host egress restriction; C6's defining addition is the **mandatory runtime verification** below). C6 is a **specialisation of the C4 family with a verification obligation attached**.

Honest ranking statement: **C6 is the only candidate with any containment measurement at all, and it is still UNMEASURED as a Falcon mechanism.** Its evidence is a property of a Docker topology the measurement built; Falcon neither creates nor currently proves that topology. Ranking it first means "best evidence and most likely to be completable", not "closer to shipping than its owed list implies".

### 1.3 Owed items before FW2-C6 may retire the refusal (all REQUIREMENTS, none measured)

**C6-O1 — Runtime verification record (the core new design obligation).** Falcon must **verify**, in-process, immediately before arming, that isolation and proxying are active; it may never assume them from configuration, environment variables or CI job names. Design of the evidence record (REQUIREMENT, unmeasured):

| Field | Content | Pass condition |
|---|---|---|
| `canary.attempts[]` | From the browser container, **outbound canary attempts that MUST fail**: external DNS name, external IP:443 TCP, UDP/53, QUIC/443, IPv6 literal, Docker gateway, `host.docker.internal`, link-local `169.254.169.254`, direct TCP to the known-denied fixture | every attempt errors with a network-level error; **any success ⇒ refuse** |
| `canary.positive` | One allowlisted destination reached **through** the proxy, plus one allowed WebSocket that OPENS | both succeed; a failing positive control means the harness is broken ⇒ refuse (a silently broken harness must not read as containment — the FW2-C1 lesson) |
| `proxy.identity` | Proxy endpoint, its TLS/handshake identity or a pre-shared per-run token echoed by the proxy, proxy build sha256, its allowlist contents hash | matches the pinned expected values |
| `proxy.liveness` | Token challenge at arm time **and** re-challenged at each pilot step | every challenge answers; a miss ⇒ refuse mid-run (see C6-O6) |
| `route.table` | Container route table, resolver list, interface list, and that the only reachable peer is the proxy | matches the pinned expected shape |
| `browser.proxy_config` | Chromium's effective proxy config read back from the launched browser (not from the flags Falcon passed) | equals the pinned proxy; no bypass list entries beyond the pinned set |
| `env.owner` | Who built and owns the environment (see C6-O7) | a named owner is recorded |

Every field is **recorded, hashed and attached to the run report**; any missing field is a refusal, not a warning. The record format and its checks are **design text only — unimplemented and unmeasured**.

**C6-O2 — x64 GitHub-runner parity.** The whole topology and C6-O1 record re-measured on `ubuntu-latest` x64 (both Nodes, 3+ reps). The arm64 Docker Desktop result does not transfer: `--internal` enforcement, embedded-DNS behaviour, kernel/nftables version and seccomp defaults differ.

**C6-O3 — Channels the measurement did not cover.** `data:` workers (the findings substituted `blob:`); **service-worker** WebSockets (needs an HTTPS/localhost origin through the proxy); `WebTransport`/HTTP3 on a runner where QUIC is not pre-blocked; `EventSource`; worker `fetch`; SharedWorker sockets.

**C6-O4 — Redirect-to-denied.** HTTP 30x and `Location` chains from an allowed origin to a denied origin, including from worker-initiated and nested-worker fetches. The findings only note this as "inherently proxy-gated" — that is INFERENCE, not a measurement.

**C6-O5 — DNS and QUIC on the real runner.** Resolution paths that are not Docker's embedded DNS (host resolver, `/etc/hosts`, DoH/DoT to an external resolver), and QUIC where the network does not already block it.

**C6-O6 — Mid-session proxy kill and degradation.** Stop/kill/restart the **real** proxy mid-run and mid-request, and swap its allowlist mid-run. Required outcome: the run **refuses** (fail-closed) rather than continuing on stale verification. Phase 4 tested only broken-at-startup proxies.

**C6-O7 — Customer staging destinations and environment ownership.** A design and measurement for how a **customer** staging destination is added to the allowlist: who authorises it, where the allowlist lives, how it is pinned and audited, that an allowlist entry cannot be injected at run time, and that wildcard/apex entries cannot broaden egress. Plus a named owner for building and maintaining the isolated environment (DevOps-owned, Security-reviewed) — **unassigned today**.

### 1.4 Gate behaviour is UNCHANGED

**REQUIREMENT.** The production gate keeps refusing: reason `worker_websocket_containment_unverified`, `armed: false`, `exit: 18`, detail **`fw2:unmeasured`** — exactly what `gate34.js` emits today. No gate code change, no new detail string, no flag, environment variable, allowlist, acknowledgement or warning mode may bypass it. FW2-C6 may only retire rule 1.3.1 of rev 35 when **C6-O1..C6-O7 all pass and Security reviews them**. Until then FW2-C6 is **UNMEASURED as a Falcon mechanism**, and an environment-provided control supporting a *product* claim remains an open question for the owner (carried from C4).

### 1.5 Re-ranked candidate table (supersedes rev 35 section 1.4)

| Rank | ID | Candidate | State |
|---|---|---|---|
| — | FW2-C1 | CSP via `context.route` + `route.fulfill` | **FAILED / REJECTED** (OBSERVED nested-worker escape 3/3, both Nodes). Owner ruling FW2-C1: rejected |
| 1 | **FW2-C6** | **Verified** isolated network (`--internal`) + dual-homed allowlist egress proxy + mandatory runtime verification record | **Containment OBSERVED on arm64 Docker Desktop (0 escapes, 8 channels, 2 Nodes, 3 reps); UNMEASURED as a Falcon mechanism — owes C6-O1..C6-O7** |
| 2 | FW2-C5 | Falcon-controlled loopback egress proxy/MITM injecting CSP on every response | UNMEASURED (proof obligations (a)–(f) of rev 35 stand) |
| 3 | FW2-C4 | Unverified host/CI-level egress restriction | **Subsumed by FW2-C6**; retained only as the "no verification" variant, which may never arm |
| 4 | FW2-C3 | Refuse pages that create workers (detectability) | UNMEASURED |
| 5 | FW2-C2 | CDP-level `ws:`/`wss:` blocking for worker targets | UNMEASURED |

No candidate other than C6 may be attempted without owner review. Server-delivered CSP remains **not a Falcon mechanism** (rev 35 section 1.2, unchanged).

---

## 2. OPEN-BID-27 — reconciled with MEASB-04 (Linux). **Stays OPEN; candidate only.**

**OBSERVED environment (MEASB-04):** arm64 Docker Desktop VM, Ubuntu 24.04 aarch64 Playwright image, Chromium sha256 `2b3a2bb9…a94f65`, wrapper sha256 `958d92da…789575` mode 0755 uid 0, Playwright 1.64.0, Node 22.19.0 and 24.21.0, 3 reps per Node (6/6), default bridge network, **ran as uid 0 (root)**.

### 2.1 Owed-measurement reconciliation (supersedes rev 35 rows BID-M2 and BID-M6)

| ID | Owed measurement | Rev 36 state | Evidence |
|---|---|---|---|
| BID-M1 | Crash detection against the true browser main | **MEASURED (macOS + Linux arm64)** | Linux: `kill -9 wrapper_pid` → `disconnected` in 28–56 ms 6/6; `kill -0` → ESRCH 6/6; `/proc/<pid>` disappears and `readlink exe` → ENOENT (two NEW Linux signals); CDP then fails closed |
| BID-M2 | Linux / GitHub-runner behaviour of the wrapper | **PARTIAL (was STILL OPEN)** — measured on **arm64 Docker Desktop**, **not** the x64 GitHub runner | MEASB-04, 6/6 reps, both Nodes. x64 parity, kernel/seccomp/`unprivileged_userns_clone` differences UNCOVERED |
| BID-M3 | Wrapper trust model | **PARTIAL** | Linux reproduces all five pre-launch rejections 6/6 (`sha-mismatch`, `group-or-other-writable`, `symlink`, `uid-mismatch`, `parent-dir-writable`). Open: same-UID attacker, CI tenancy, IMA/fs-verity |
| BID-M4 | Substitute for `Browser.getCommandLine` | **CLOSED as answered** | Wrapper-recorded argv; Linux adds `/proc/<pid>/cmdline` as a **mutually corroborating** second source (6/6) |
| BID-M5 | Nonce surviving renderer replacement | **MEASURED (macOS + Linux)** | Identical shape: match at origin 1, cross-origin, new page, per-realm CDP 6/6; crashed renderer loses it; fresh page re-reads |
| BID-M6 | Lockfile semantics for an open persistent context | **MEASURED, PLATFORM-DIVERGENT** | Linux: `SingletonLock` **is** an `lstat`-visible symlink whose target is `<hostname>-<pid>` 6/6 — a usable owner-pid signal **on Linux only**; `SingletonSocket` present (no pid); `DevToolsActivePort` absent under `--remote-debugging-pipe`. macOS: both absent (rev 35, unchanged) |
| BID-M7 | Argv-diff completeness | **PARTIAL** | Normalised argv identical across 6 launches and across Nodes on Linux; `--disable-gpu` detected 6/6; **Linux baseline differs from macOS** (crashpad wiring, `/tmp` log path, binary path) |
| **BID-M8** (new) | **Running-image verification** | **MEASURED (Linux only)** | `/proc/<wrapper_pid>/exe` resolves to the pinned Chromium and the mapped image sha256 equals the pin 6/6 — this verifies **Chromium, not the wrapper** (the wrapper has `exec`'d away) |
| **BID-M9** (new) | **Sandbox posture** | **NOT MEASURED** | Playwright auto-emitted `--no-sandbox` because the container ran as root (6/6). The non-root, sandboxed path is UNMEASURED |

### 2.2 Normative rules added or sharpened

1. **Per-platform argv baselines (REQUIREMENT, sharpened).** The committed normalised-argv baseline must be stored **per platform (macOS, Linux-x64, Linux-arm64) and per Playwright version**, with the platform and version recorded alongside it and compared at startup. A missing or mismatched platform/version pair ⇒ identity UNVERIFIED ⇒ refuse. A macOS baseline may never be applied to a Linux run (OBSERVED difference).
2. **`SingletonLock` is a Linux-only signal (REQUIREMENT).** Read it with `lstat`, not `existsSync` (the target does not exist; `existsSync` reports false — OBSERVED). Its `<hostname>-<pid>` target may be used as a corroborating owner-pid signal **only** on Linux, and only in addition to `kill -0 wrapper_pid`. `DevToolsActivePort` must never be relied on under `--remote-debugging-pipe` on either platform.
3. **Swap-restore TOCTOU is unverifiable post-launch ⇒ the design must require a pre-launch trusted measurement or refuse (REQUIREMENT; this supersedes rev 35 item 5).** OBSERVED (Linux, 6/6): pre-check passes, the wrapper is tampered, launched, then the original bytes are restored — the post-launch file hash **re-matches** and `/proc/<wrapper_pid>/exe` shows the pinned Chromium, so **neither** detector fires. Post-launch re-hashing is therefore demoted from "detector" to "detects swap-leave only (6/6) and is blind to swap-restore (OBSERVED)". Arming requires a **pre-launch measurement the attacker cannot subvert between measurement and `exec`** — e.g. open-then-`fstat`-then-`exec` a sealed `memfd`, Linux IMA, or fs-verity. All of those are **UNMEASURED**. Until one is measured and Security-reviewed, the wrapper path carries an **unclosable TOCTOU** and **must refuse to arm**.
4. **Sandbox status must be measured and stated (REQUIREMENT).** OPEN-BID-27 owes a **non-root (`--user pwuser`, uid 1001), sandboxed** measurement. Any identity or containment claim derived from a wrapper measurement **must state the sandbox status of the run that produced it**; a claim from a `--no-sandbox` root run may not be quoted as a sandboxed result. CI should pin a non-root user by default.
5. **Renderer-crash vs `disconnected` separation, per-realm nonce re-verification, pre-launch trust checks, the Playwright re-baselining rule and the refusal rule** carry forward from rev 35 section 2.2 items 1–4 and 6 unchanged, with `/proc` evidence added as corroboration on Linux only.

### 2.3 Uncovered list (replaces rev 35 section 2.3; still not an empty set)

x64 GitHub-runner parity for every row; **non-root sandboxed runs (BID-M9)**; kill of the **specific** `--type=renderer` PID (`targetRendererPid` was `null` 6/6 — zygote re-parenting under `--init`; `chrome://crash` is a proxy, inferred only); **swap-restore TOCTOU** (OBSERVED undetectable post-launch); same-UID attacker; running-image hashing on macOS (no `/proc`; codesign/EndpointSecurity unmeasured); IMA / fs-verity / sealed-memfd measurement paths; headed launches (no display on Linux; full lifecycle unexercised); `chrome`/`msedge` channels; concurrent launches sharing one wrapper file in one container; Playwright minor-version argv drift; CI runner tenancy policy; long-duration stability inside a container; **combined behaviour of the OPEN-BID-27 wrapper with the FW2-C6 isolated network** (MEASB-04 used the default bridge).

---

## 3. m-108 — honest restatement of the two-layer caller (supersedes rev 35 section 3.2)

**OBSERVED (SEC-31).** Against the reference caller the process exited **0** in five ways: a listener added **before** the mapper that exits 0; `prependListener` added **after** the mapper; `setUncaughtExceptionCaptureCallback`; an `unhandledRejection` listener added before the mapper that exits 0; `process.exit` patched to a no-op followed by a later `exitCode = 0`. A throw inside the mapper gave exit **7**; `removeAllListeners` gave exit **1**. **No case armed.** Also OBSERVED: a listener that merely swallows still produced 18 — so rev 35's claim that "a pre-existing listener would suppress the mapper" is **inaccurate** and is withdrawn.

**Corrected claim (REQUIREMENT), replacing "guarantees the process never exits 0":**

> Layer 1 maps an exception caught at the call site to the frozen canonical refusal. Layer 2 is a **best-effort** process-level mapper that maps an escaping exception to exit 18 **within the process-integrity boundary** — i.e. only while no other code in the process has taken over exception handling or `process.exit`. It is **not** a guarantee that the process never exits 0. In every observed bypass the outcome was a wrong **exit code**, never an **arm**; the no-arm property is the load-bearing one.

**Enumerated bypasses (OBSERVED, to be stated in the security claims, not omitted):** earlier `uncaughtException`/`unhandledRejection` listener that exits 0; `prependListener` after install; `setUncaughtExceptionCaptureCallback`; a patched `process.exit`; `removeAllListeners` (exit 1); a throw inside the mapper itself (exit 7).

**Required per-call integrity checks (REQUIREMENT, unimplemented).** Immediately before **every** gate call:

1. `process.listenerCount('uncaughtException') === 1` **and** `process.listenerCount('unhandledRejection') === 1`, and in each case the single listener is **identically** the mapper's own function reference (identity comparison on `process.listeners(...)[0]`, which also detects `prependListener`);
2. `process.hasUncaughtExceptionCaptureCallback() === false`;
3. `process.exit` is **captured by reference at mapper install time**, and the captured reference is the one the mapper calls; the mapper additionally asserts `process.exit === <captured>` and that the captured value is a function;
4. the mapper was installed **before** any gate call.

Any check failing ⇒ **refuse at startup** (`armed: false`, exit 18, reason `shared_worker_block_unverified`, detail `gate-exception`) and do not call the gate. No new reason code and no new exit code. The reference text in rev 35 section 3.3 is **superseded in claim wording only**; its code must gain the four checks before it is implementable. Rows TL1–TL4 stand with their stated limits; **new rows TL5–TL10 are owed**, one per enumerated bypass, asserting that the integrity check refuses at startup and that **no case arms**.

---

## 4. m-109 — the contained-for-test check becomes BLOCKING outside the test tree (supersedes rev 35 section 4)

**OBSERVED (SEC-31).** The rev 35 items 1–3 are defeated by **renaming**: a generated loader under another file name, the factory exported under another symbol name, or a test-tree file required from production code in a checkout, all pass.

**Corrected check (REQUIREMENT).** Items 1–3 of rev 35 section 4 are retained (export-surface assertion; generated-artifact location; `npm pack --dry-run`), and item 4 is **replaced**:

4. **Blocking literal check.** A repository scan **fails the build** if the literal `contained-for-test` appears in **any** tracked file outside the test tree. The **only** exemption is the production gate module, identified by **exact path and sha256** (`gate34.js`, `92ad5650c386f8a37d5f7caa6c25255f100711f61e6a86860c758639f04ca95f`) — a path match with a different digest, or the digest at a different path, **fails**. The exemption list is data in the check, is reviewed when the gate's digest changes, and may hold at most this one entry. No advisory mode; no name-based or glob-based exemption.
5. **Seeded violation cases (QA/DevOps owed).** The check must be demonstrated failing on: (a) a renamed generated loader outside the test tree; (b) the factory exported under a different symbol name; (c) a production file requiring a test-tree module; (d) the literal added to a non-exempt production file; (e) the exempt path present with a modified digest; (f) a test-tree file legitimately containing the literal — which must **pass**.
6. **MG-11 cannot close without MG-13.** Renaming defeats path- and name-based reasoning, so test-factory exclusion is only credible together with the production-entry-point **reachability checker**. MG-11 and MG-13 close together or not at all.

---

## 5. Mandatory implementation gates (refreshed)

| Gate | Requirement | Owner | State at rev 36 |
|---|---|---|---|
| MG-1 | Deterministic stack-exhaustion fixture proving an exception inside the real `decide` becomes `decision-exception` | QA | **PARTIAL** (unchanged) |
| MG-2 | FC19–FC22 asserted by the W6-T checker; row total 57 | Developer + QA | **NOT MET** |
| MG-3 | Capture-once of all intrinsics at initialization | Developer | **NOT MET** (design closed) |
| MG-4 | FW-2: one candidate MEASURED on both Nodes, macOS **and** Linux, 3+ reps, Security-reviewed | DevOps + Security | **NOT MET — OPEN.** FW2-C1 FAILED/REJECTED; **FW2-C6 has first containment evidence but owes C6-O1..C6-O7**; gate stays `fw2:unmeasured` |
| MG-5 | `worker_websocket_containment_unverified`, FW-2-first precedence, exit 18 asserted directly | Developer + QA | **NOT MET** |
| MG-6 | F21 emits `serviceworker.probe`; no `sw.postMessage`; F19 in-realm `location.href` | Developer | **NOT MET** |
| MG-7 | OPEN-BID-27: BID-M1..M9 measured and Security-reviewed | Security + DevOps | **NOT MET; OPEN.** M1/M5/M6/M8 measured, M4 answered, M2/M3/M7 PARTIAL, **M9 (sandbox) not measured**, swap-restore TOCTOU open |
| MG-8 | Security review of **this** rev 36 document | Security | **NOT STARTED** |
| MG-9 | Linux / GitHub-runner coverage of every realm row, FW-1, FW-2, the caller and the wrapper | DevOps | **PARTIAL — stays OPEN.** Linux **arm64 Docker Desktop** only (NETW-01, MEASB-04); **x64 runner parity unmeasured** |
| MG-10 | CodeQL, code scanning and secret scanning green on the implementing branch | DevOps | **NOT STARTED** |
| MG-11 | Test-factory exclusion: section 4 items 1–5 implemented and failing on every seeded violation | DevOps + Developer | **NOT MET — OPEN; cannot close without MG-13** |
| MG-12 | Two-layer caller with the four per-call integrity checks and rows TL1–TL10 | Developer + QA | **NOT MET** (claim corrected here; TL5–TL10 owed) |
| MG-13 | Production-entry-point reachability checker (requires-graph walk) | DevOps | **NOT MET — OPEN** |
| MG-14 | A real armed path on a real browser without SharedWorker | Owner + DevOps | **NOT MET — OPEN.** Supported-browser set is empty and stays empty under OWNER-24 |
| **MG-15** (new) | **FW2-C6 runtime verification record (C6-O1) implemented and measured, including a failing positive control forcing a refusal** | DevOps + Security | **NOT MET — OPEN** |
| **MG-16** (new) | **Trusted pre-launch wrapper measurement (sealed memfd / IMA / fs-verity) closing swap-restore TOCTOU** | Security + DevOps | **NOT MET — OPEN** |

---

## 6. Delta versus rev 35

1. **FW2-C6 added as the first candidate with containment evidence** (NETW-01: 0 escapes, 8 channels incl. nested/blob/module workers, 2 Nodes, 3 reps, working positive control, fail-closed proxy failure, 10 bypass attempts blocked) — recorded as a **MEASURED environment property, UNMEASURED as a Falcon mechanism**, ranked 1 by evidence only. FW2-C4 is subsumed as its unverified variant.
2. **C6-O1..C6-O7 owed list specified**, with the **runtime verification evidence record** (canary-must-fail attempts, positive control, proxy identity/liveness token, route table, browser-read-back proxy config, environment owner) designed as a REQUIREMENT.
3. **Gate behaviour unchanged:** `fw2:unmeasured`, exit 18, no flag or bypass; `gate34.js` and `decide32.js` untouched.
4. **OPEN-BID-27 reconciled with MEASB-04:** BID-M2 **STILL OPEN → PARTIAL** (arm64 Docker Desktop); BID-M6 now platform-divergent (`SingletonLock` usable on Linux via `lstat`); BID-M8 (running-image hash verifies **Chromium, not the wrapper**) and BID-M9 (**sandbox status, not measured**) added; per-platform argv baselines required; post-launch re-hash demoted; **a trusted pre-launch measurement is now required or the design refuses**; sandbox status must be stated in any claim. Status unchanged: **OPEN, candidate only**.
5. **m-108 fixed:** the "never exits 0" claim withdrawn and replaced with a best-effort claim bounded by the process-integrity boundary; six bypasses enumerated; the inaccurate "a pre-existing listener suppresses the mapper" statement withdrawn; four per-call integrity checks and rows TL5–TL10 required. The no-arm property is OBSERVED to hold in every bypass.
6. **m-109 fixed:** the `contained-for-test` literal check is **blocking** outside the test tree with a single exact-path+sha256 exemption, plus six seeded cases; **MG-11 cannot close without MG-13**.
7. **Gates table refreshed to MG-1..MG-16**; MG-9 moves NOT MET → PARTIAL (arm64 only).
8. **Unchanged:** FW2-C1 FAILED/REJECTED and server-header CSP not a Falcon mechanism; the fail-closed rule 1.3; exit precedence; the empty supported-browser set; ADR-0053/0054/0055/0056 (0055 amended by section 3 and 0056 unchanged).

---

## 7. What remains unmeasured (honest list)

- **Any FW-2 Falcon mechanism.** Worker WebSocket traffic is **NOT CONTAINED by Falcon** on the pinned build. FW2-C6's containment was measured in an environment Falcon does not build or verify; C6-O1..C6-O7 all open.
- x64 GitHub-runner parity for **everything**: NETW-01 topology, MEASB-04 wrapper, realm rows, FW-1, the two-layer caller.
- `data:` workers, service-worker sockets, SharedWorker sockets, `WebTransport`/HTTP3, `EventSource`, worker `fetch`; redirect-to-denied; mid-session proxy kill; real-runner DNS/QUIC; Firefox and WebKit.
- A worker-realm CSP/containment readiness check (the main-realm canary is OBSERVED insufficient).
- Customer staging allowlisting, allowlist provenance, and **who owns the isolated environment** (unassigned).
- OPEN-BID-27: non-root sandboxed runs, specific-renderer-PID kill, **swap-restore TOCTOU** (OBSERVED undetectable post-launch; no trusted pre-launch measurement exists yet), same-UID attacker, macOS running-image hashing, headed/channel/concurrent launches, Playwright argv drift, CI tenancy, wrapper-plus-isolated-network combination.
- Whether layer 2 catches a **real** near-exhaustion escape of layer 1 (TL3 saw none); the six m-108 bypasses are OBSERVED to give wrong exit codes (0, 1, 7) and the integrity checks that would refuse them are unimplemented and unmeasured.
- MG-1 deterministic exhaustion; reachability from the production entry point; any real armed path on a real browser without SharedWorker; code loaded after the decision module that patches the verdict reader or the require cache.

---

## ADR-0057 — An isolated-network-plus-proxy environment may only support containment if Falcon verifies it at run time

*Status:* Proposed (design only; blocked on MG-8, MG-15, and owner review of whether an environment-provided control may support a product claim).
*Context:* OBSERVED (NETW-01): a Docker `--internal` network plus a dual-homed allowlist proxy contained every tested Chromium channel — page, fetch, `ws`, `wss`, dedicated, nested, blob and module worker WebSockets — with 0 arrivals at the denied fixture across 5 phases, 2 Node versions and 3 reps, with a working positive control and no direct fallback when the proxy broke. This is the first FW-2 candidate with any containment evidence. It is also a property of an environment, measured on an arm64 Docker Desktop VM rather than the x64 GitHub runner, and Falcon neither builds nor currently detects that environment.
*Decision:* Record it as candidate **FW2-C6**, distinct from the unverified host-egress candidate C4 by one mandatory addition: before arming, Falcon must **verify** isolation and proxying from inside the environment and persist a verification evidence record (canary attempts that must fail, a working positive control, proxy identity and a liveness token, route/resolver tables, the browser's read-back proxy config, and the environment owner). A missing or failing field refuses. The production gate continues to refuse with `worker_websocket_containment_unverified` / `fw2:unmeasured` / exit 18 until C6-O1..C6-O7 pass and Security reviews them. No flag, variable or acknowledgement may bypass this.
*Consequences:* Execute mode stays unavailable; the containment gap stays inside the security claims; FW-2 work now has a concrete, bounded next spike (verification plus x64 parity) instead of an open search; a new DevOps obligation to own the environment; TLS/identity posture for the proxy needs Security review.
*Alternatives rejected:* treating NETW-01 as closing MG-4 (it measures an environment, not a Falcon mechanism, and not on CI); folding it into C4 (loses the verification obligation that makes it arguable at all); arming behind an "isolated CI" flag or environment variable (assumption, not verification — forbidden by ADR-0054); narrowing the claim to exclude worker channels (forbidden by the owner ruling).

---

## Handoff constraints

- **Developer:** implement nothing until MG-8 clears and the owner authorises. No change to `gate34.js` or `decide32.js`. The only interface surface is the two-layer caller plus the **four per-call integrity checks** of section 3 (detail `gate-exception` on the existing reason; no new reason or exit code).
- **QA:** rows TL1–TL4 as in rev 35 plus **TL5–TL10**, one per enumerated m-108 bypass, asserting startup refusal and no arm; the six seeded cases of section 4 item 5; MG-1 stays PARTIAL.
- **Security:** review FW2-C6's recording and ranking, the C6-O1 verification record, ADR-0057, the OPEN-BID-27 Linux reconciliation (especially the swap-restore TOCTOU refusal and the sandbox-status rule), and the m-108/m-109 fixes. Confirm or reject the claim that "no bypass arms" is sufficient while exit codes 0/1/7 remain reachable.
- **DevOps:** MG-15 (verification record), C6-O2 x64 runner parity, MG-9, MG-11 with MG-13, MG-16 (trusted pre-launch wrapper measurement), MG-10. Pin a non-root container user. No uncontrolled third-party site in CI; GoogleSearchTest stays local and manual.
