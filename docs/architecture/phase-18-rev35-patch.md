# Phase 18 rev 35 — FW-2 mechanism FAILED, OPEN-BID-27 reconciled with MEASB-03, two-layer top-level caller (m-104/m-107), CI check corrected (m-106)

Narrow addendum on rev 34 (`0418106`) and rev 33 (`183e341`). **Docs-only.** Reviewed-against findings: Security SEC-29 (`docs/security/phase-18-design-review-28.md`, m-104/m-105) and SEC-30 (`docs/security/phase-18-design-review-29.md`, m-106/m-107); measurement inputs `docs/phase-18-fw2-csp-containment-findings.md` (FW2SP-01), `docs/phase-18-measb3-open-bid-27-findings.md` (+ MEASB-02, MEASB-01), `docs/phase-18-conf09-gate-results.md`.

It **supersedes**: rev 33 section 2.3 row FW2-C1 and the FW-2 candidate ranking; rev 33 section 4's BID-M1/M5/M6 states; rev 34 section 2's MG-1 wording; rev 34 section 3a's CI check wording. Everything else in rev 33/rev 34 stands. `decide32.js` unchanged (sha256 `e197ec58f6084f03508cac198e21630eb31eb3f2218023c227642fb898b3a522`); `gate34.js` unchanged (sha256 `92ad5650c386f8a37d5f7caa6c25255f100711f61e6a86860c758639f04ca95f`). **No implementation, merge, tag, release or customer claim is authorised by this document.**

Owner rulings in force, carried unchanged: **OWNER-24** strict same-process browser posture, **empty supported-browser set accepted**; **no identity uncertainty may arm**; **worker WebSocket traffic must be contained or must cause a fail-closed refusal and is NOT excluded from the security claims**; a worker-channel escape is reported as a blocker for the mechanism without weakening any claim.

Wording discipline: **OBSERVED** = measured on the pinned environment with the runs stated; **INFERENCE** = reasoning from observations, not independently proven; **REQUIREMENT / RECOMMENDATION** = normative design text, not a measurement.

> Paths beginning `scratchpad/` name coordinator-machine evidence locations (not tracked); normative text they contain is reproduced here.

---

## 1. FW-2 — the CSP-through-`context.route` mechanism is FAILED

### 1.1 Observed result (BLOCKER for the mechanism)

**OBSERVED** (`docs/phase-18-fw2-csp-containment-findings.md`; macOS Darwin 25.5.0 arm64, Playwright 1.64.0, Chromium 156.0.8078.4 headless, `chromium.launchPersistentContext`, loopback fixtures, REPS=3, Node 22.19.0 and Node 24.21.0):

- `context.route('**/*')` + `route.fetch()` + `route.fulfill()` with an injected `Content-Security-Policy: connect-src` header **does not intercept the script fetch of a worker instantiated from inside another worker**. The inner worker realm receives no Falcon CSP and its `new WebSocket(...)` reached the non-allowlisted origin **3 of 3 reps, in all five route phases (`allowlist`, `none`, `skip-worker-script`, `meta-weaken`, `double-csp`), on both Nodes**. This is an **ESCAPE**.
- **OBSERVED:** in route mode the allowed-page control returned **0** handshakes where the bare control returned 3 of 3. The route handler itself suppresses top-level WebSocket upgrades. Consequence: **every route-mode "CONTAINED" cell is UNVERIFIED, not a pass** — the counts cannot distinguish CSP containment from routing interference. (The findings' explanation that the handler fulfils an HTTP 200 in place of a 101 is **INFERENCE**, not measured.)
- **OBSERVED:** CSP delivered as a native HTTP response header **by the origin server** contained page, dedicated, blob, `data:`, module and nested-worker WebSockets (0/3 each) while the allowed control still opened (3/3), on both Nodes.
- **OBSERVED:** a main-realm `securitypolicyviolation` canary fires when the document CSP is armed (1/1 in every CSP phase, 0 in `none`/`route-throws`) but **cannot observe worker realms**; a worker realm's violation event fires only inside that worker.
- **OBSERVED:** a throwing route handler fails closed (`net::ERR_FAILED` on every `page.goto`, 0 handshakes anywhere); `meta` CSP and a second CSP header can only tighten, never broaden.

**Verdict (REQUIREMENT).** Mechanism **FW2-C1 (CSP via `context.route`) = FAILED**, recorded as a blocker for that mechanism. It must not be implemented, offered behind a flag, or cited as partial containment.

### 1.2 Server-header CSP is not a Falcon mechanism (normative)

Server-delivered CSP shows **CSP `connect-src` semantics only**. Falcon does not control a customer server's response headers, so the 0/3 containment in the control column is **not an available Falcon mechanism** and must never be quoted as Falcon containment, as a partial pass, or as a basis for arming. Its only design value is **INFERENCE**: the containment gap is a delivery-coverage problem, not a CSP-semantics problem.

### 1.3 Fail-closed rule (ADR-0054, unchanged and reaffirmed)

1. Execute mode does not arm until a worker-WebSocket containment mechanism is **MEASURED** on the pinned build (both Nodes, 3+ reps, macOS **and** Linux/GitHub runner) **and** Security-reviewed. Independent of the SharedWorker realm decision and of the supported-browser set.
2. Reason `worker_websocket_containment_unverified`, `armed: false`, `exit: 18`. Detail vocabulary:
   - `fw2:unmeasured` — the production constant state; **unchanged and still what `gate34.js` emits**. No gate code change is authorised by this revision.
   - `fw2:mechanism-failed:<mechanism-id>` — a configured mechanism's runtime containment check did not hold.
   - **New, optional, documentation-only:** `fw2:mechanism-escaped:<mechanism-id>` for a mechanism **measured as escaping** (e.g. `fw2:mechanism-escaped:FW2-C1`). It is a reporting detail for evidence, never a separate verdict; the refusal and exit code are identical. It may only ever appear on a refusal.
3. FW-2 stays a pre-arming precondition evaluated **inside** the gate before the decision function is called (rev 34 section 1 item 2). Exit precedence unchanged.
4. No flag, environment variable, allowlist, acknowledgement or warning mode may bypass item 1.
5. A measured escape in **any** worker channel is reported as a blocker for that mechanism; no claim is narrowed, and worker WebSocket traffic stays inside the security claims as an **open, stated gap**.

### 1.4 Re-ranked candidate mechanisms — all UNMEASURED

**No claim is made that any of these works.** Ranking is by INFERENCE about likely coverage, not by evidence. Each must be measured on both Nodes, 3+ reps, macOS **and** Linux/GitHub runner, and Security-reviewed, before it can retire rule 1.3.1.

| Rank | ID | Candidate | What it must PROVE | State |
|---|---|---|---|---|
| — | FW2-C1 | CSP injected via `context.route` + `route.fulfill` | — | **FAILED (OBSERVED escape, nested worker, 3/3, both Nodes)** |
| 1 | FW2-C5 | Falcon-controlled **loopback egress proxy / MITM** that adds the CSP header to **every** response, including worker-initiated and nested-worker script fetches, and terminates/refuses `ws:`/`wss:` at the network layer | (a) nested, blob, `data:`, module, Shared and service worker script responses all carry the header; (b) an allowed WebSocket still opens (working positive control, which FW2-C1 lacked); (c) WebSocket neutralisation at the network layer is observable and fail-closed; (d) no request path bypasses the proxy (QUIC/HTTP3, DNS, direct IP, proxy-exempt schemes); (e) per-realm verification, since a main-realm canary is insufficient (OBSERVED); (f) TLS interception posture is acceptable to Security | UNMEASURED |
| 2 | FW2-C4 | **Host/CI-level egress restriction** outside the browser | (a) deny-by-default egress on a GitHub runner with loopback fixtures allowed; (b) Falcon can *verify* the restriction is active before arming, not assume it; (c) it holds for worker-initiated sockets (it should, being below the browser — INFERENCE); (d) whether an environment-provided control may support a *product* claim at all | UNMEASURED |
| 3 | FW2-C3 | **Refuse pages that create workers** (detectability): deny worker-script responses / refuse the run when a worker is detected | (a) every worker-creation path is **detectable** — including nested, `blob:`, `data:`, module and `importScripts`, the paths that already bypassed `context.route` (OBSERVED), which is the central doubt; (b) a missed worker fails closed, not open; (c) the usability cost on real pilot pages | UNMEASURED |
| 4 | FW2-C2 | CDP-level network blocking of `ws:`/`wss:` for worker targets | (a) worker targets are attachable, including nested/`blob:`/`data:` workers; (b) the interception domain covers the WebSocket handshake; (c) an unattachable target fails closed | UNMEASURED |

**Also still unmeasured anywhere:** SharedWorker sockets (absent in headless Chromium), service-worker sockets, `WebTransport`, `EventSource`, worker `fetch`, `data:`-worker construction viability, Firefox/WebKit, and Linux/GitHub-runner behaviour for every row above.

---

## 2. OPEN-BID-27 — reconciliation with MEASB-03 (stays OPEN)

**Status: OPEN. CANDIDATE only, not a decision.** MEASB-03 is MEASURED/PARTIAL on **macOS arm64 only**; MEASB-02's claim "Uncovered scenarios: NONE" stays **rejected** per its coordinator banner.

**Exact candidate combination (CANDIDATE):** trusted **hash-pinned launcher wrapper** passed as Playwright `executablePath`, which records `wrapper_pid`, `start_ns`, a per-run `token`, the exec'd `exe` path and the full argv, and `exec`s the sha256-pinned Chromium binary **⨁ per-run nonce** injected with `addInitScript` into `window.<global>` and read back **per page and per realm** (page `evaluate` plus `context.newCDPSession(page)` → `Runtime.evaluate`) **⨁ `browser.on('disconnected')`** for browser-main liveness **⨁ `page.on('crash')`** for renderer liveness **⨁ `kill -0 wrapper_pid`** **⨁ normalised-argv diff against a committed baseline ⨁ sha256 pin on the wrapper file and on the exec'd Chromium binary ⨁ a post-launch re-hash of the wrapper at the recorded path**.

### 2.1 Owed-measurement reconciliation (rev 33 BID-M1..M7)

| ID | Owed measurement | Rev 35 state | Evidence |
|---|---|---|---|
| BID-M1 | Crash detection against the **true** browser main pid, with `disconnected` latency | **MEASURED (macOS)** | `ps -p wrapperPid` shows the pinned Chromium exe and direct helpers have `ppid == wrapperPid`, so wrapper_pid **is** the browser main; `kill -9` → `disconnected` in 22–35 ms, 6/6 reps; `kill -0` → ESRCH 6/6; CDP calls then fail closed. Renderer crash (`chrome://crash`) → `page.on('crash')` 6/6 with `disconnected` **false** |
| BID-M2 | Linux / GitHub-runner behaviour of the wrapper | **STILL OPEN** | Docker daemon up (28.5.2) but no Playwright-capable image local; image pull forbidden by task rule. No Linux data at all |
| BID-M3 | Wrapper **trust model** (ownership, mode, parent-dir write access, symlink, foreign exe, CI tenancy) | **PARTIAL** | Pre-launch checker rejects all five tamper variants 6/6: `sha-mismatch`, `group-or-other-writable`, `symlink` (via `lstat`), `uid-mismatch`, `parent-dir-writable`. **Open:** CI runner tenancy policy, mode 0555 on CI, SIP interaction, same-UID attacker |
| BID-M4 | A substitute for `Browser.getCommandLine` | **CLOSED as answered — the substitute is the wrapper-recorded argv** | `Browser.getCommandLine` UNAVAILABLE in every rep (rev 33). The wrapper's own argv record is mechanism-independent and OBSERVED stable; it is the designated substitute |
| BID-M5 | A nonce that survives renderer replacement | **MEASURED, with a design consequence (macOS)** | `addInitScript` nonce matches at origin 1, across cross-origin navigation, on a new page in the same context, and via per-realm CDP `Runtime.evaluate` (6/6). A **crashed** renderer loses it (`evaluate: Target crashed`); a fresh page re-reads it. So: **no nonce survives its own renderer; the context-level injection survives**. A single launch-time read-back is insufficient |
| BID-M6 | Lockfile semantics (`SingletonLock`, `DevToolsActivePort`) for a persistent context kept open | **MEASURED NEGATIVE (macOS)** | Both **absent** while the context was open, 6/6, under headless + `--remote-debugging-pipe`. They **must not** be used as owner-pid signals on this platform. The wrapper-recorded `--user-data-dir` (matching the Falcon-chosen UDD 6/6) is the reliable record. Linux and headed/`--remote-debugging-port` modes STILL OPEN |
| BID-M7 | Argv-diff completeness against Playwright flag drift | **PARTIAL** | Normalised argv (placeholders for `--user-data-dir`, `--remote-debugging-pipe`, `--crashpad-handler-pid`, `--log-file`) is **identical** across 12 ephemeral launches and across Node 22/24, 45 flags; an injected `--disable-gpu` is detected 6/6. Cross-version drift is **INFERENCE only** |

### 2.2 Normative rules carried forward and sharpened

1. **Mandatory pre-launch trust checks (all must PASS, or refuse before launch):** wrapper path is not a symlink (`lstat`); owner uid == Falcon uid; mode has no group/other write bit; no ancestor directory up to the install root is group/other writable; wrapper sha256 == pin; the wrapper's exec target sha256 == the Chromium binary pin. Any failure ⇒ `armed: false`, exit 18, no launch, no degraded mode.
2. **Per-realm nonce re-verification (REQUIREMENT).** The nonce must be re-read and compared **per page and per realm** immediately before every verification step, via the per-realm CDP `Runtime.evaluate` path. A launch-time read-back is **not** sufficient. A mismatch, an unreadable realm, or a `Target crashed` error refuses.
3. **Renderer-crash vs disconnected signals are distinct and non-substitutable.** `browser.on('disconnected')` is a **browser-main** liveness signal and **MUST NOT** be used to detect a renderer crash (OBSERVED: it does not fire). `page.on('crash')` is the renderer signal. Both must be wired; either firing during a pilot refuses the run. `kill -0 wrapper_pid` is the independent main-liveness cross-check.
4. **Argv baseline re-baselining rule.** The committed normalised-argv baseline is valid **only** for the exact Playwright version it was recorded on (1.64.0). Any Playwright upgrade (including a patch bump) **invalidates** the baseline: it must be re-recorded and re-reviewed, and until it is, identity verification is UNVERIFIED and refuses. The pinned Playwright version must be stored **with** the baseline and compared at startup.
5. **Post-launch re-hash.** Re-hash the wrapper at the recorded path after launch and compare to the pin; a mismatch refuses the run. This detects a swap left in place (6/6) and is explicitly **blind** to swap-then-restore.
6. **Refusal rule (unchanged owner ruling).** Any uncertainty, any unavailable signal, any unmet trust precondition, any unreadable realm ⇒ no arm, exit 18, no degraded or best-effort identity mode. `IC8` mapping unchanged.

### 2.3 Explicit uncovered list (not an empty set)

Linux and GitHub-runner behaviour of every mechanism; `kill -9` of the **specific renderer process** backing a target `Page` (only the GPU helper was killed; `chrome://crash` is a proxy, not the same test); swap-then-restore **TOCTOU** (post-launch file hash re-matches — undetected); running-image hashing on macOS (no `/proc/<pid>/exe`; `lsof` `txt` lists Chromium frameworks post-exec; codesign/EndpointSecurity not measured); **an attacker holding the Falcon user's own UID** (trivially passes every file trust check and can replace the wrapper after the check); `SingletonLock`/`DevToolsActivePort` under headed and `--remote-debugging-port` modes and on Linux; Playwright minor-version argv drift; concurrent launches sharing one wrapper file; headed launches and the `chrome`/`msedge` channels; long-lived persistent contexts (>500 ms); CI runner tenancy policy; nonce/disconnected wiring stability beyond 60 s.

---

## 3. MG-1 and m-104 / m-107 — honest wording and the two-layer top-level caller

### 3.1 Corrected wording (supersedes rev 34 section 2 and rev 33 section 1.3)

**MG-1 state: PARTIAL.** Normative wording, replacing "converted when it occurs":

> An exception raised inside the decision call is **sometimes converted** by the gate to `shared_worker_block_unverified` / exit 18 / detail `decision-exception`, and **may escape** `gateDecide` entirely when the stack is nearly exhausted. `gateDecide` **may throw**.

Supporting records: deterministic injection of a runaway recursion in a stand-in decision function was converted 25/25 on both Nodes (that is **not** `decide32` under real exhaustion); real exhaustion inside the real `decide` was converted once per 1001 depths on Node 22 in 3 of 3 runs and 0 times on Node 24 (JIT-tier dependent, evidence not a fixture); Security's own sweep OBSERVED a `RangeError` escaping `gateDecide` **17 to 22 times per 5 sweeps on both Nodes with 0 conversions and never an arm** (m-104). The claim "every exception becomes a refusal" is **withdrawn**; it is replaced by "every exception **caught inside** the gate becomes a refusal, and any exception that **escapes** it is mapped to exit 18 by the caller".

### 3.2 The top-level caller is TWO LAYERS (normative)

- **Layer 1 — call-site mapping.** A `try`/`catch` around the `gateDecide` call returns a frozen canonical refusal `{ armed: false, exit: 18, reason: 'shared_worker_block_unverified', detail: 'gate-exception' }`. The caught value is never read. A well-formed verdict passes through untouched.
- **Layer 2 — process-level mapping.** `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers set `process.exitCode = 18` and call `process.exit(18)`. Layer 2 exists **because layer 1 can itself fail to run** when the stack is too exhausted to enter the `catch`; it guarantees the process never exits 0 (and never arms) on an escaping exception.
- Both layers are mandatory. Neither is a substitute for the other. Exit 18 only; exit precedence unchanged.

### 3.3 Reference top-level caller (verbatim, `scratchpad/conf09/toplevel34.js`)

Reference text, not shipped code.

```js
'use strict';
// Reference top-level caller (SEC-29 m-104): gateDecide may throw; every escaping exception becomes exit 18.
// Layer 1: a try/catch around the gate call (maps to the canonical refusal verdict).
// Layer 2: process-level handlers so an exception that escapes even layer 1 (for example when the stack is
// too exhausted for the catch to run) still ends the process with exit code 18 and never an arm.
const ObjectFreeze = Object.freeze;
const FALLBACK = ObjectFreeze({ armed: false, exit: 18, reason: 'shared_worker_block_unverified', detail: 'gate-exception' });
function runGate(gateDecide, perRealm) {
  try { return gateDecide(perRealm); } catch (e) { return FALLBACK; }
}
function installProcessExitMapper(proc) {
  const die = function () { try { proc.exitCode = 18; } catch (e) {} proc.exit(18); };
  proc.on('uncaughtException', die);
  proc.on('unhandledRejection', die);
}
module.exports = ObjectFreeze({ runGate: runGate, installProcessExitMapper: installProcessExitMapper, FALLBACK: FALLBACK });
```

**Implementation constraints for Developer (not defects in the results).** `installProcessExitMapper` must be called **before** any gate call; `detail: 'gate-exception'` is a new, fourth caller-side detail string on an existing reason code (no new reason, no new exit code); a pre-existing `uncaughtException` listener elsewhere in the process would suppress the mapper's exit — the implementation must assert it is the authoritative handler or refuse at startup. `process.exit(18)` truncates pending async work, which is correct for a refusal path.

### 3.4 Rows TL1–TL4 (`scratchpad/conf09/toplevel-test.js`)

| Row | Case | Count | Expected outcome | Status |
|---|---|---|---|---|
| TL1 | Injected throw from `gateDecide`: `Error`, `RangeError`, `null`, object with a throwing `message` getter | 4 | layer 1 returns exactly `FALLBACK`; `exit === 18`, `armed === false`; the hostile getter is never invoked | **OBSERVED PASS**, Node 22.19.0 and 24.21.0 |
| TL2 | A normal verdict passes through layer 1 untouched (test factory, `contained-for-test`) | 1 | `armed === true` for the authorised arm; byte-identical pass-through | **OBSERVED PASS**, both Nodes |
| TL3 | Near-stack-limit sweep through `runGate` + the real gate over the real `decide`, depths 3000 → measured-max+300 step 4, valid and invalid input | 2 × ((max+300−3000)/4) calls | `badArm === 0`; escapes of `runGate` itself counted | **OBSERVED PASS**, both Nodes: **0 arms on invalid input and 0 escapes of both layers** |
| TL4 | Layer-2 process mapper in child processes: uncaught sync throw, unhandled rejection, late timer throw, clean exit | 4 | `sync = 18`, `async = 18`, `timer = 18`, `clean = 0` | **OBSERVED PASS**, both Nodes: exit codes 18/18/18/0 |

**Honest limits on TL1–TL4.** (a) TL3 **did not reproduce an escape** (`escapedBothLayers = 0`), so it demonstrates "no wrong arm under stack pressure" and **not** that layer 2 catches a real near-exhaustion escape of layer 1; layer 2's coverage is demonstrated only by the **synthetic** TL4 escapes. The claim is therefore: *layer 2 covers an exception that escapes layer 1* (OBSERVED for synthetic escapes; INFERENCE for the m-104 stack-exhaustion escape). (b) The m-104 escapes were observed in Security's own sweep, not in TL3; sweep shape and JIT tier differ, so absence in TL3 is not evidence of absence. (c) macOS arm64 only; Linux/CI unmeasured. (d) TL2 uses the test-only factory, not the production export.

---

## 4. m-106 — corrected CI reachability check (supersedes rev 34 section 3a)

**Problem (OBSERVED, SEC-30).** The rev 34 check fails any file "containing `contained-for-test`", but `gate34.js` itself contains that literal in its FW-2 comparison, so the check would flag the **production** module. The check as written is wrong.

**Corrected check (normative).** The CI check must target the **exported test factory and the generated test files**, never a literal that the production gate legitimately contains:

1. **Export-surface assertion (primary).** Require the production entry point's gate module in a fresh process and assert `Object.keys(module.exports)` is exactly `['gateDecide']`, the export is frozen, and `createGate` is `undefined` on it. Fail the build otherwise. This is behavioural and cannot be defeated by renaming a string.
2. **Generated-artifact location assertion.** Fail if any generated loader output (`*-testloader.generated.js`, the sweep module) exists outside the test tree, or if any file outside the test tree **exports** a symbol named `createGate` (checked via the module's export surface or an AST/`module.exports` pattern on the export statement — not a bare substring of the file body).
3. **Package-contents assertion.** Fail if `npm pack --dry-run` output includes any generated test loader, sweep module, or the test tree.
4. **Explicit exemption.** The production gate module path is exempt from any residual literal-based grep for `contained-for-test`; any such grep is advisory only and must never be the sole gate.

Reachability from the production entry point (requires-graph walk) remains an **open** gate, not satisfied by the above.

---

## 5. Mandatory implementation gates (refreshed)

Every row must be **DONE with recorded evidence** before any implementation, merge, tag or customer claim. No row may be waived by a document.

| Gate | Requirement | Owner | State at rev 35 |
|---|---|---|---|
| MG-1 | Deterministic stack-exhaustion fixture proving an exception raised inside the real `decide` reaches the gate and becomes `decision-exception` | QA | **PARTIAL** — injection is a stand-in at shallow depth; real exhaustion can escape (m-104). Wording now "sometimes converted, may escape" (m-107) |
| MG-2 | FC19–FC22 rows asserted by the W6-T checker against `phase-18-rev34-expectations.json`; row total 57 | Developer + QA | **NOT MET** (JSON carries expectations; checker assertion owed) |
| MG-3 | Gate implements capture-once and captures all intrinsics (incl. `Object.hasOwn`) at initialization | Developer | **NOT MET** (closed in design at SEC-29; implementation owed) |
| MG-4 | FW-2: one candidate containment mechanism MEASURED on both Nodes, macOS **and** Linux, 3+ reps, Security-reviewed | DevOps + Security | **NOT MET, and FW2-C1 is now FAILED.** Rule 1.3.1 applies. Stays **OPEN** |
| MG-5 | `worker_websocket_containment_unverified` in the reason set, FW-2-first precedence, exit 18 asserted directly by a test | Developer + QA | **NOT MET** |
| MG-6 | F21 emits `serviceworker.probe`; no fixture emits `sw.postMessage`; F19 identity from in-realm `location.href` | Developer | **NOT MET** |
| MG-7 | OPEN-BID-27: BID-M1..M7 measured and Security-reviewed | Security + DevOps | **NOT MET; OPEN.** M1/M5/M6 measured on macOS, M4 answered, M3/M7 PARTIAL, **M2 (Linux) open**; section 2.3 uncovered list open |
| MG-8 | Security review of the rev 35 document itself | Security | **NOT STARTED** |
| MG-9 | Linux / GitHub-runner coverage of every realm row, FW-1, FW-2 and the OPEN-BID-27 wrapper | DevOps | **NOT MET — stays OPEN** |
| MG-10 | CodeQL, code scanning and secret scanning green on the implementing branch | DevOps | **NOT STARTED** |
| MG-11 | Test-factory exclusion: the corrected CI check of section 4 (export-surface, artifact location, package contents) implemented and failing on a seeded violation | DevOps + Developer | **NOT MET — stays OPEN** |
| MG-12 | Two-layer top-level caller implemented (layer 1 `try`/`catch` → `gate-exception`; layer 2 process mapper → exit 18) with direct exit-code tests, incl. the sole-authoritative-handler assertion | Developer + QA | **NOT MET** (reference text and TL1–TL4 exist in scratch only) |
| MG-13 | Production-entry-point **reachability checker** (requires-graph walk proving no test artifact is reachable) | DevOps | **NOT MET — stays OPEN** |
| MG-14 | A real armed path on a real browser without SharedWorker | Owner + DevOps | **NOT MET — stays OPEN.** Supported-browser set is empty and stays empty under OWNER-24 |

---

## 6. Delta versus rev 34

1. **FW-2 FW2-C1 recorded FAILED** on an OBSERVED nested-worker escape (3/3, five route phases, both Nodes); all other route-mode cells reclassified **UNVERIFIED** because the route handler breaks the positive control. Rev 33/34 listed FW2-C1 as the leading plausible candidate.
2. **Server-header CSP declared not a Falcon mechanism** (explicit, normative); its 0/3 containment may not be quoted as Falcon containment.
3. **Candidates re-ranked** with required proofs: FW2-C5 (loopback egress proxy/MITM, new) > FW2-C4 (host-level egress) > FW2-C3 (refuse worker-creating pages, detectability) > FW2-C2 (CDP worker-target blocking). All **UNMEASURED**; no mechanism is claimed to work.
4. **Detail vocabulary extended** with the optional documentation-only `fw2:mechanism-escaped:<mechanism-id>`. `fw2:unmeasured` remains the production state; **`gate34.js` is unchanged**.
5. **OPEN-BID-27 reconciled with MEASB-03:** BID-M1/M5/M6 MEASURED on macOS, BID-M4 answered (wrapper-recorded argv is the substitute), BID-M3/M7 PARTIAL, BID-M2 open; added mandatory pre-launch trust checks, per-realm nonce re-verification, the renderer-crash vs `disconnected` separation, the Playwright-upgrade re-baselining rule, and an explicit uncovered list. Status unchanged: **OPEN, candidate only**.
6. **MG-1 reworded** to "sometimes converted, may escape" (m-107) and the **two-layer** top-level caller specified with verbatim reference text and rows **TL1–TL4** (OBSERVED PASS on Node 22.19.0 and 24.21.0), including the limit that TL3 produced no escape.
7. **m-106 fixed:** the CI check now targets the export surface and generated artifacts instead of the `contained-for-test` literal.
8. **Gates table refreshed** to MG-1..MG-14; MG-11 (test-factory exclusion), MG-13 (reachability checker), MG-9 (Linux/CI) and MG-14 (real armed path) stay OPEN.
9. **Unchanged:** `decide32.js` and `gate34.js` and their sha256 values; the m-96 intrinsic-capture design; the process-integrity boundary; exit precedence; the empty supported-browser set; the rev 34 rebuild-never-return rule; realm table rows; ADR-0053 and ADR-0054 as amended.

---

## 7. What remains unmeasured (honest list)

- Any FW-2 containment mechanism: FW2-C1 **failed**; C2, C3, C4, C5 **unmeasured**. Worker WebSocket traffic is **NOT CONTAINED** on the pinned build.
- SharedWorker and service-worker sockets, `WebTransport`, `EventSource`, worker `fetch`; `data:`-worker construction viability; Firefox and WebKit.
- A worker-realm CSP readiness check; the main-realm canary is OBSERVED insufficient.
- Deterministic stack exhaustion inside the real `decide` (MG-1); whether layer 2 catches a **real** near-exhaustion escape of layer 1 (TL3 saw none).
- Linux and GitHub-runner behaviour for every realm row, FW-1, FW-2, the two-layer caller and the OPEN-BID-27 wrapper.
- OPEN-BID-27 section 2.3 in full: renderer-pid kill, swap-then-restore TOCTOU, same-UID attacker, running-image hashing on macOS, Playwright argv drift, headed/channel/concurrent launches, CI tenancy.
- Headed launches; bfcache on any build where it is observable (F18 UNMEASURABLE here).
- Any real armed path on a real browser without SharedWorker.
- Code loaded **after** the decision module that patches whatever reads the verdict or the require cache.

---

## ADR-0055 — The top-level caller maps every gate escape to exit 18 in two layers

*Status:* Proposed (design only; blocked on MG-8 and MG-12).
*Context:* OBSERVED (SEC-29 m-104): `gateDecide` is not total near stack exhaustion — a `RangeError` escaped it 17–22 times per 5 sweeps on both Nodes, with 0 conversions and never an arm. A single `try`/`catch` at the call site can itself fail to run when the stack is exhausted, and an unhandled exception would otherwise produce a non-18 exit code and break the CI contract.
*Decision:* Two mandatory layers. Layer 1: a `try`/`catch` around `gateDecide` returning a frozen canonical refusal (`shared_worker_block_unverified`, exit 18, detail `gate-exception`), never reading the caught value. Layer 2: `uncaughtException` and `unhandledRejection` handlers installed before any gate call, setting `exitCode = 18` and calling `process.exit(18)`. No new reason code, no new exit code. An arm can never be produced by either layer.
*Consequences:* One new caller-side detail string; the process can no longer exit 0 on an escaping exception; `process.exit` truncates pending async work on the refusal path; the implementation must own the process-level handlers or refuse at startup. Residual: TL3 produced no real escape, so layer 2's coverage of the m-104 case is INFERENCE from synthetic escapes (TL4).
*Alternatives rejected:* layer 1 only (OBSERVED to be escapable); layer 2 only (loses the canonical verdict and the ability to continue a non-execute flow); `try`/`catch` inside `decide32.js` (changes the audited module and its sha256); a distinct exit code for a gate escape (breaks the frozen precedence and the CI contract).

## ADR-0056 — CSP injected through Playwright request routing is rejected as a containment mechanism

*Status:* Proposed (design only; blocked on MG-8).
*Context:* OBSERVED (FW2SP-01): with CSP injected only through `context.route` + `route.fulfill`, a nested worker's inner script fetch bypasses the route handler, that realm gets no CSP, and its WebSocket reached a non-allowlisted origin 3/3 reps in all five route phases on Node 22 and 24. The same CSP delivered as a native server header contained every channel, and the route handler also broke the allowed-WebSocket positive control, making every route-mode "contained" count UNVERIFIED.
*Decision:* FW2-C1 is **FAILED** and must not be implemented, flagged, or cited as partial containment. Server-delivered CSP is **not** an available Falcon mechanism and may not be quoted as Falcon containment. ADR-0054's fail-closed refusal stays in force: the production gate refuses with `worker_websocket_containment_unverified` / `fw2:unmeasured` / exit 18. Remaining candidates are re-ranked as UNMEASURED with explicit proof obligations, including a working positive control and per-realm verification.
*Consequences:* Execute mode stays unavailable; the containment gap is stated in the security claims rather than omitted; the next FW-2 spike must target response-delivery coverage (a Falcon-controlled proxy) rather than CSP semantics.
*Alternatives rejected:* shipping FW2-C1 with the nested-worker case documented as a known gap (violates the owner ruling that a worker escape is a blocker and that worker traffic is not excluded); relying on customer server headers (not under Falcon's control); narrowing the claim to exclude worker channels (forbidden by the owner ruling).

---

## Handoff constraints

- **Developer:** implement nothing until MG-8 clears and the owner authorises implementation. This revision authorises **no** change to `gate34.js` or `decide32.js`. The only new interface surface is the two-layer top-level caller (MG-12) with detail `gate-exception` on the existing reason code.
- **QA:** rows TL1–TL4 with the counts in section 3.4 and direct exit-code assertions (18 for sync throw, unhandled rejection and late timer throw; 0 for a clean exit); MG-1 stays PARTIAL until a deterministic exhaustion fixture exists; add a seeded-violation test for the corrected CI check.
- **Security:** review the FW2-C1 FAILED verdict and the re-ranked candidates' proof obligations, the OPEN-BID-27 reconciliation and refusal rules, the two-layer caller including its stated inference limit, and the corrected m-106 check. m-106 and m-107 are addressed here; confirm or reject.
- **DevOps:** MG-4 (FW-2 measurement environment incl. Linux), MG-9 (Linux/GitHub-runner coverage), MG-11 (corrected exclusion check), MG-13 (reachability checker), MG-10 (CodeQL and scanning). No uncontrolled third-party site in CI; GoogleSearchTest stays local and manual.
