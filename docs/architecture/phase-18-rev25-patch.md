# Phase 18 architecture patch — revision 25 (ARCH-25)

Base: architecture rev 2 plus the rev 3..rev 23 patches, at `e75cad0` on `docs/phase-18-architecture`.
Inputs: `docs/phase-18-spike-w6-findings.md` (SPIKE-W6, executed, with its coordinator note), `docs/phase-18-spike-w5-findings.md` (SPIKEW-05, INCONCLUSIVE), `docs/phase-18-spike-w4-findings.md` (SPIKEW-04, PARTIAL), `docs/phase-18-spike-w2-findings.md` (SPIKEW-03, harness negative), `docs/phase-18-spike-w-findings.md` (SPIKE-W, BLOCKER), `docs/phase-18-linux-runner-evidence-findings.md` (FS-RUNNER-01), `docs/security/phase-18-design-review-22.md` (SEC-23: M-25, m-82..m-86), plus the owner decisions recorded in the ARCH-25 task packet.
Scope: design text only. No production source file, `package.json` script or workflow step is edited by rev 25.
Machine-applicable edits: `docs/architecture/phase-18-rev25-edits.json`; this document is normative for intent.

**Status carried forward.** Counts stay **98 total / 89 Must / 6 Should / 3 Could**. C6-T stays **27 / 5** with rev 23 section D.4 as its single source. **M-23 and M-24 stay closed.** Firefox and WebKit stay UNVERIFIED and non-blocking; pilot scope is Chromium only. Every check listed as unexecuted by rev 21, rev 22 and rev 23 remains owed. Rev 25 **weakens nothing**, adds no bypass, and converts no unexecuted check into evidence. The untracked `phase-18-rev24-*` drafts are a superseded draft built on the rejected CDP assumption and carry no authority.

## Section A — what rev 25 changes

| Item | Change | Primary targets |
|---|---|---|
| 1 | The **CDP enforcement design is NOT ACCEPTED** and is superseded **in place**: rev 23 section B.2 Layer 1 (stub) and Layer 2 (`Target.setAutoAttach` paused on start), the B.5 SPIKE-W2 matrix, the SEC-23 M-25 25-case x 4-mode extension, and ADR-0048 | rev 23 B.2/B.5/F/H/I, rev 3 N-3, rev 4 N-3, section 7a rules 1 and 4, plan, SPIKE-W/SPIKE-W2 open items |
| 2 | The **fail-closed capability fallback is ADOPTED** (section B) with its conformance matrix **W6-T** (section C) as the single source of SharedWorker realm and case ids and counts | section 7a, AC-091, exit-code registry, ADR-0049 |
| 3 | Reason codes reconciled: `shared_worker_blocked` **withdrawn**; `shared_worker_present` and `shared_worker_block_unverified` are the only SharedWorker reasons, both double-labelled `PILOT_INTERNAL_ERROR` + exit 18 | exit-code registry, AC-091, AC-084 |
| 4 | **Scope statement: Phase 18 cannot arm execute mode on the current pinned Chromium build** (section F), with practical impact in the plan and in the customer limitations obligations (section G) | plan, section F, section G |
| 5 | SEC-23 **m-82..m-86 closed in the design**; **M-25 superseded by design, NOT closed** (closure needs an executed conformance measurement plus Security) | rev 4 lines 131/132/134/135, AC-090, AC-085, rev 23 E.2, M-25 open item |
| 6 | FS-RUNNER-01 folded in as **observations that admit nothing**; the rev 23 tmpfs admission is **withdrawn** (tightening) | section E, AC-085, rev 4 admission table, rev 23 E.2 |

---

## Section B — the accepted design: fail-closed SharedWorker capability refusal

### B.1 Why the CDP design is not accepted (evidence, without overclaim)

| Spike | Status | What it does and does not support |
|---|---|---|
| SPIKEW-03 (`spike-w2-findings`) | Harness-level negative, PARTIAL | Root cause of the paused page target **never isolated**. The `SIGKILL`/exit-137 resource-exhaustion attribution is **WITHDRAWN**: a stalled harness was terminated by the coordinator; there is no evidence of OS resource pressure. The M3 stub injection never engaged, so it supports no design statement. |
| SPIKEW-04 | PARTIAL; gate NOT passed | Stages 1 and 2 are **valid as measured**: the scoped filter `[{type:'shared_worker'},{exclude:true}]` did not pause page, iframe, popup or dedicated-worker targets, and a paused shared worker closed by `Target.closeTarget` produced **0** fixture requests 5/5. The headline "gate = PASS" is withdrawn. Stage **3(a) is UNRESOLVED**: one fixture request arrived after a second `Target.attachToTarget`, through the same Playwright session, with no genuinely separate CDP client, so it is not a valid competing-client test and the cause is unproven. |
| SPIKEW-05 | **INCONCLUSIVE** | No `shared_worker` target was reported to client A in **any** of 30 two-client runs, so the central question was never put to the browser. `workerExecuted:false` with `fixtureHitCount:0` is therefore **vacuous**. Every run record carries a **false `falconEquivalentExitCode: 18`** marker written regardless of detection; it must never be read as the refusal path working. **Part 1 (production transport) was NOT MEASURED**: no browser process handle, so Falcon never proved that production exposes no independent CDP endpoint. |

Owner stop rule: an ambiguous result after SPIKEW-05 adopts the fail-closed fallback and schedules **no further CDP spike**. That rule applies. The CDP enforcement design is therefore superseded in place, not parked.

### B.2 The rule (normative)

**Before any external target navigation or any target-origin access**, Falcon:

1. launches the approved browser in an **isolated, empty `BrowserContext`** (fresh browser process, fresh context, no customer target contacted);
2. captures a **pre-author-script native constructor reference** in every realm it creates, via `addInitScript`, before any page script runs;
3. determines **out of page** — `page.evaluate` / `frame.evaluate` in an isolated world, reading `typeof SharedWorker`, the property descriptor, and the pre-captured native reference — whether `SharedWorker` capability is available in every **applicable realm** of table W6-T;
4. decides, and then either arms or refuses.

**Decision function** (Falcon-equivalent of the executed SPIKE-W6 function; normative shape, not literal code):

| Condition, evaluated in this order | Outcome |
|---|---|
| no realm results at all | `armed:false`, exit **18**, `shared_worker_block_unverified` |
| any required realm `measurable === false`, errored, or timed out | `armed:false`, exit **18**, `shared_worker_block_unverified` |
| any realm reports `typeof SharedWorker === 'function'` or a successful construction | `armed:false`, exit **18**, `shared_worker_present` |
| realm results disagree (more than one distinct `typeof` across required realms) | `armed:false`, exit **18**, `shared_worker_block_unverified` |
| the capability check itself throws | `armed:false`, exit **18**, `shared_worker_block_unverified` |
| every required realm cleanly measured absent, all in agreement | `armed:true`, exit 0 |

**Hard constraints.** No page-supplied value may influence the result: no `postMessage` from the target, no DOM value, no binding callback payload, no exception message. Every input is read out of page in the Node process. There is **no** override flag, environment variable, warning mode, degraded mode or documented-residual path. An unmeasurable realm is a refusal, never a pass (SEC-23 m-82). Dry-run mode mutates and arms nothing and is unaffected.

### B.3 What is withdrawn from the design

No construction stub; no `Object.defineProperty` non-configurable `SharedWorker` replacement; no run-scoped `exposeBinding` for this purpose; no `Target.setAutoAttach`, `waitForDebuggerOnStart`, `Target.closeTarget`, `Target.detachFromTarget` or `Runtime.runIfWaitingForDebugger`; no page-side throw. **Reason `shared_worker_blocked` is withdrawn from the registry** and no code may emit it. Developer must not implement any part of rev 23 section B.

### B.4 Reason codes (registry reconciliation)

Both are **double-labelled**: top-level code `PILOT_INTERNAL_ERROR`, process exit **18**, plus a lower `snake_case` reason — consistent with the existing exit-18 reason rows (`worker_not_interceptable`, `approvals_root_not_durable`, `approvals_root_symlink`, `approval_history_unverifiable`). `POLICY_*` stays the family of top-level failure codes and is **not** used for SharedWorker; `POLICY_SHARED_WORKER_BLOCKED` must not appear anywhere.

| Reason | Raised when | Message content |
|---|---|---|
| `shared_worker_present` | capability available in at least one measured applicable realm (the spelling used by the executed SPIKE-W6 harness) | the W6-T realm id and the read mechanism; never a page-supplied value; never a target URL query or fragment |
| `shared_worker_block_unverified` | a required realm cannot be created or measured, the probe times out, realms disagree, or the check itself fails | the W6-T realm id and the failure kind (`not-created`, `not-measurable`, `timeout`, `disagreement`, `check-failed`) |

**Naming note (owner may overrule, no behavioural change).** The `block` in `shared_worker_block_unverified` is a residue of the withdrawn construction-block design; `shared_worker_unverified` would be consistent with `shared_worker_present`. Rev 25 keeps the existing spelling so the executed SPIKE-W6 evidence and the design text agree. Exit precedence is unchanged (rev 6 order `2 > 3 > 18 > 17 > 16 > 15 > 13 > 12 > 11 > 14 > 10 > 1 > 0`).

### B.5 Interfaces

- **Internal, new:** `SharedWorkerCapabilityProbe.measure(browser, { realms, timeoutMs })` → `{ perRealm: [{ id, mechanism, typeofSharedWorker, descriptor, nativeCtorMatched, constructed, measurable, error, timedOut }] }`, and `decide(perRealm)` → `{ armed, exit, reason, perRealm }`. Pure, synchronous, no I/O: `decide` is the primary unit test seam.
- **Internal, changed:** `NetworkGate.install(context, { mode: "execute" })` refuses at install time, **before any navigation**, on a non-armed decision. The refusal carries the full `perRealm` record to the reporter.
- **Public surface:** unchanged — no new CLI flag, no new environment variable, no new config key. CommonJS throughout; `Logger.info` / `Logger.warning` / `Logger.error` only, no `console.log`; `fs.promises.*` for any evidence write.
- **Observability:** one `Logger.error` line naming code, exit, reason and realm id, plus a structured `sharedWorkerCapability` block in the run report (per-realm id, mechanism, decision inputs, duration). No target URL query or fragment, no page-supplied string, no secret.

### B.6 Trust boundaries and control flow

Node process (trusted: probe, decision, refusal) → browser process (semi-trusted: realms created by Falcon) → target page/realm (**untrusted**, and the only direction of data flow is browser-to-Node through Falcon's own isolated-world reads). The boundary the design depends on is that `page.evaluate` / `frame.evaluate` results are produced by Falcon's own expression in an isolated world and are not author-controllable values. **Known fidelity caveat, measured:** `frame.evaluate` runs via `Runtime.evaluate` and is **not** gated by the HTML `sandbox` script restriction, so for sandboxed realms the probe can read a different answer than an embedded `<script>` would. That caveat is exactly why F5 and F7 are REQUIRED fail-closed rows and not passes.

---

## Section C — table W6-T, the fallback conformance matrix (single source)

Realms and cases are taken from the executed SPIKE-W6 measurement plus the realms SEC-23 M-25 identified as missing. **This table supersedes rev 23 B.5 (W2-1..W2-16) and the M-25 25-case x 4-mode matrix.** No gate, criterion or prose may cite those as live, and no count may be restated in prose outside this table and the `counts` note.

Coverage legend: **W6** = measured by SPIKE-W6; **W7** = owed to SPIKE-W7. Every W7 row must be run **3 repetitions per case on Node 22.19.0 and on Node 24.21.0**, fresh browser process and fresh empty context per run, hermetic loopback fixtures only.

### C.1 Required decision realms (F1..F21)

| Id | Realm | Mechanism | Required expected decision | Coverage |
|---|---|---|---|---|
| F1 | isolated empty context (`about:blank`, fresh context) | `page.evaluate` | present ⇒ `shared_worker_present`; cleanly absent ⇒ clean negative | W6 (present) |
| F2 | top, same-origin fixture | `page.evaluate` | same | W6 (present, construction confirmed, fixture hit) |
| F3 | iframe, same-origin | `frame.evaluate` | same | W6 (present) |
| F4 | iframe, cross-origin (second loopback port) | `frame.evaluate` | same | W6 (present) |
| F5 | sandboxed iframe, `sandbox=""` (no `allow-scripts`) | `frame.evaluate` | **REQUIRED FAIL-CLOSED** ⇒ `shared_worker_block_unverified` (`unexpected-success-no-allow-scripts`: evaluate succeeded where the sandbox model says no script should run) | W6 (unmeasurable), re-confirm W7 |
| F6 | sandboxed iframe, `allow-scripts` only | `frame.evaluate` | present ⇒ `shared_worker_present` | W6 (present; construction denied, opaque origin) |
| F7 | sandboxed iframe, `allow-same-origin` only | `frame.evaluate` | **REQUIRED FAIL-CLOSED** ⇒ `shared_worker_block_unverified` (same anomaly) | W6 (unmeasurable), re-confirm W7 |
| F8 | sandboxed iframe, `allow-scripts allow-same-origin` | `frame.evaluate` | present ⇒ `shared_worker_present` | W6 (present, fixture hit) |
| F9 | `data:` frame (M-25 missing realm) | `frame.evaluate` | present ⇒ `shared_worker_present` | W6 (present; construction denied, opaque origin) |
| F10 | `blob:` frame | `frame.evaluate` | present ⇒ `shared_worker_present` | W6 (present, fixture hit) |
| F11 | `document.write`-created frame (M-25 missing realm) | `frame.evaluate` | **REQUIRED FAIL-CLOSED** ⇒ `shared_worker_block_unverified` (`frame-not-found-after-docwrite`: the frame tree update raced the synchronous write and the frame was not resolvable in time) | W6 (unmeasurable), re-confirm W7 |
| F12 | removed-then-reinserted frame (M-25 missing realm) | `frame.evaluate` | present ⇒ `shared_worker_present` | W6 (present, fixture hit) |
| F13 | popup, same-origin (`window.open`) | `page.evaluate` on the popup | present ⇒ `shared_worker_present`; construction not independently confirmed, so **construction confirmation is owed and an unconfirmable popup is fail-closed** | W6 (typeof only), W7 |
| F14 | popup, cross-origin, `noopener` | `page.evaluate` on the popup | same as F13 | W6 (typeof only), W7 |
| F15 | nested iframe, depth 2 (M-25 missing realm) | `frame.evaluate` | present ⇒ `shared_worker_present` | W6 (present, fixture hit) |
| F16 | `srcdoc` iframe | `frame.evaluate` | unmeasured today ⇒ `shared_worker_block_unverified` until measured | W7 |
| F17 | frame appended after the probe completes / after arming | `frame.evaluate` | unmeasured today ⇒ `shared_worker_block_unverified` until measured | W7 |
| F18 | bfcache: navigate away and back, then read | `page.evaluate` | unmeasured today ⇒ `shared_worker_block_unverified` until measured | W7 |
| F19 | `javascript:` URL document (M-25 missing realm) | `frame.evaluate` | unmeasured today ⇒ `shared_worker_block_unverified` until measured | W7 |
| F20 | `object` / `embed`-hosted document (M-25 missing realm) | `frame.evaluate` | unmeasured today ⇒ `shared_worker_block_unverified` until measured | W7 |
| F21 | service-worker global scope | not queryable via `page.evaluate` / `frame.evaluate` | **REQUIRED FAIL-CLOSED** ⇒ `shared_worker_block_unverified` while it is a required realm; `serviceWorkers: 'block'` stays in force and is unverified | W6 (unreachable), W7 |

### C.2 Informational realm (never a decision input)

| Id | Realm | Observation | Rule |
|---|---|---|---|
| F22 | dedicated-worker global scope | `typeof SharedWorker === 'undefined'` in Chromium (W6) | **Informational only.** Not a page/frame realm Falcon arms against; it never contributes a pass and never contributes a refusal. Re-check on Chromium upgrade. |

### C.3 Decision-function and mechanism cases (FC1..FC7)

| Id | Case | Required outcome | Coverage |
|---|---|---|---|
| FC1 | pre-author-script native-constructor capture via `addInitScript`, compared with the evaluate-time read in every measurable realm | must match; a mismatch ⇒ `shared_worker_block_unverified` | W6 (matched in every measurable realm) |
| FC2 | page mutation evasion: `delete`, `Object.defineProperty` / `Reflect.defineProperty` redefinition, assignment, prototype and `__proto__` manipulation, `with`-scope shadowing | decision unchanged; the pre-captured native reference stays usable (`new NativeCtor(...)`) | W6 (confirmed: pre-capture defeats page mutation) |
| FC3 | no page-supplied value influences the decision | structural: the decision reads only Falcon's own isolated-world results; a fixture that posts a forged "absent" verdict changes nothing | W7 |
| FC4 | probe timeout in a required realm | `shared_worker_block_unverified` | W7 |
| FC5 | required realm cannot be created | `shared_worker_block_unverified` | W7 |
| FC6 | realm results disagree | `shared_worker_block_unverified` | W7 |
| FC7 | the capability check itself throws | `shared_worker_block_unverified` | W7 |

### C.4 Inversion and positive-control fixtures (IC1..IC4) and the carried worker-WebSocket case

| Id | Fixture | Required outcome | Coverage |
|---|---|---|---|
| IC1 | positive control: `new SharedWorker(url)` against the loopback fixture | the fixture's HTTP log records the shared-worker **script fetch**, proving the capability is a real channel and the probe is not vacuous | W6 (measured: both `/top` and `/shared-worker.js` recorded) |
| IC2 | inversion at browser level: a configuration in which `typeof SharedWorker` is `'undefined'` in every measurable realm | the rule **still refuses** while any required realm is unmeasurable — refusal must not be an artefact of mere presence | W6 (both flag configurations: API removed, decision still `shared_worker_block_unverified`) |
| IC3 | inversion at unit level: synthetic `perRealm` arrays into `decide` — all cleanly absent ⇒ `armed:true`, exit 0; one present ⇒ 18 `shared_worker_present`; one unmeasurable / timed-out / errored ⇒ 18 `shared_worker_block_unverified`; disagreement ⇒ 18 `shared_worker_block_unverified`; empty array ⇒ 18 `shared_worker_block_unverified` | the **only** place `armed:true` is ever exercised; never against a customer target | W7 |
| IC4 | inversion: probe disabled or removed | execute mode must **not** arm (no default-allow); removing the gate must fail the test | W7 |
| FW-1 | dedicated-worker-initiated WebSocket against a real WS upgrade (carried from the withdrawn W2-15) | still **UNMEASURED**; an independent arming blocker in its own right | W7 |

**Totals, single source:** 21 required decision realms (F1..F21), 1 informational realm (F22), 7 mechanism cases (FC1..FC7), 4 control fixtures (IC1..IC4), 1 carried worker-WebSocket case (FW-1) = **34 rows**. SPIKE-W6 covers **15 decision realms plus FC1, FC2, IC1 and IC2**. Reachability-checker table C6-T is untouched at **27 / 5** and remains sourced from rev 23 section D.4; the two inventories are disjoint.

---

## Section D — alternatives considered

| Alternative | Tradeoff | Verdict |
|---|---|---|
| Keep the rev 23 stub + CDP auto-attach enforcement | Would contain SharedWorker without refusing the run, but three spikes left it inconclusive: SPIKEW-04 3(a) unresolved, SPIKEW-05 vacuous, production CDP non-exposure never proved. Enforcement would rest on an untested competing-client property. | **Rejected** (owner decision; SPIKEW-05 stop rule) |
| Intercept SharedWorker traffic at the route layer | Measured impossible: `BrowserContext.route()` does not observe it and `page.on('worker')` does not fire (SPIKE-W, 3/3). | Rejected (measured) |
| Document SharedWorker as a residual and continue | SPIKE-W's leak is reproducible, uncontained POST egress on an authenticated target. | Rejected |
| Launch with `--disable-features=SharedWorker` / `--disable-blink-features=SharedWorker` | Measured to remove the API, but unsupported, Chromium-internal and version-fragile, and the rule still refuses because F5, F7 and F11 stay unmeasurable. | **Rejected as a product mechanism** (owner decision); recorded as a measurement aid only |
| Fail-closed out-of-page capability refusal before any external navigation | Costs the armed execute path on the current build; gains an unconditional, explainable, page-independent control with a pure-function test seam. | **Chosen** |

**Rationale.** It is the simplest design that satisfies the criteria: one probe, one pure decision function, two reason codes, no new public surface, no CDP dependency, and no behaviour that a hostile page can influence. Its cost is stated openly rather than engineered around.

---

## Section E — Linux evidence (FS-RUNNER-01) and admission consistency (m-86)

**E.1 Factual summary (GitHub-hosted run, observations only).** Workflow `Phase 18 Linux evidence (one-shot)` on the temporary branch `evidence/phase18-linux`, event `push`, conclusion success; runner image `ubuntu24` `20261012.334.1`, kernel `6.17.0-1022-azure` (`x86_64`); Node `v24.21.0`, npm `11.19.0`, Playwright `1.64.0` (version string only, **no browser launched**); one run, one image, one day, no repetition; artifact of 16 files downloaded and hashed. OBSERVED `statfs` ids: **`0xef53`** (ext4 runner root), **`0x1021994`** (tmpfs, `/dev/shm`), **`0x858458f6`** (ramfs, mounted with `sudo` on the disposable VM) — the **ramfs id is distinct from the tmpfs id** on this image, and ramfs reported zero blocks and files. All **nine** battery properties PASS on all three roots. Node 24 on Linux x64: `child_process` checks PASS, Babel parse **82/82**, `DEP0190` emitted on `spawn` with `shell:true` and non-empty args, and the O-1 shape delivered exit **2** with byte-identical stderr to a file and a pipe. Not measured: Chromium launch under Node 24 on Linux, dotenv load ordering, a run of `falcon.js` itself, `F_FULLFSYNC`, power-loss or reboot durability, ZFS, other images, self-hosted runners. Cleanup verified: temporary remote branch and workflow artifact deleted, no pull request opened, run record and logs retained on GitHub.

**E.2 Admission position (SEC-23 m-86), stated once and consistently.** **No Linux filesystem is admitted.** Under OWNER-23 admission requires an owner-and-Security-accepted proposal built on runner evidence; this document and FS-RUNNER-01 admit nothing. **tmpfs `0x1021994` is an admission CANDIDATE for the ephemeral roots `run/auth` and `run/plans` only**, with no durability claim, and is **refused for any approval/audit root** (`approvals_root_not_durable`). ext4 `0xef53`, ramfs `0x858458f6`, overlayfs `0x794c7630` and virtiofs `0x6a656a63` are **observations only**. ZFS stays inadmissible. The rev 23 E.2.1 statement that tmpfs is ADMITTED is **withdrawn**, which removes the rev 23 admit-tmpfs / deny-ext4 inconsistency on identical evidence. APFS `26` remains admitted for `darwin` (local/dev) exactly as rev 4 states; HFS+ `25` stays an observation only. Until acceptance **every Linux root, including CI, fails closed with exit 18 naming the observed id and path.** This is a tightening.

---

## Section F — scope and limitations (stated directly)

1. **Phase 18 cannot arm execute mode on the current pinned Chromium build.** SPIKE-W6 measured `typeof SharedWorker === 'function'` in the isolated empty context and in every structurally measurable realm on Playwright 1.64.0 / Chromium 156.0.8078.4, across **42 decisive runs** (7 launch configurations x Node 22.19.0 and Node 24.21.0 x 3 runs; 0 launch errors, 0 disagreement), including the default launch, `headless:false` and the explicit `chrome-headless-shell` binary. The rule refuses with exit 18 in every configuration measured. **`armed:true` has never been observed end to end.**
2. **Practical impact.** 18C delivers the refusal path and the capability probe only. There is no armed execute path against a customer application on this build. Dry-run mode is unaffected. Criteria whose armed behaviour cannot be exercised are verified in dry-run and against loopback fixtures, and are marked as such — never marked green by documentation.
3. **The refusal is not to be weakened.** No bypass, no undocumented exception, no browser posture chosen here, and `--disable-features=SharedWorker` is **not** accepted as a product mechanism.
4. **Inference, not measurement.** The SPIKE-W6 wording that this outcome is "permanent" and "expected" on stock builds is an **inference**. What is measured is this build. Probe gaps remain: `document.write` frame resolvability and sandboxed-iframe `evaluate` fidelity — limits of this probe design, not proof that no probe can certify those realms.
5. **Chromium only.** Firefox and WebKit are **unverified** and were not measured; they are non-blocking and out of pilot scope.
6. **Open owner decisions, not chosen by the Architect:** **OWNER-24** (a supported browser posture) and **OWNER-25** (an explicit owner-approved exception process), each with options and consequences recorded in `phase-18-rev25-edits.json`.

---

## Section G — customer limitations obligations (`docs/pilot/limitations.md`, still absent)

The file still does not exist; rev 25 records it as a DOC-gate obligation that must carry, in customer-facing language: (a) Falcon does not run an armed pilot against an application in a browser where SharedWorker capability is available or unverifiable, and on the currently pinned Chromium build that means **no armed pilot runs at all**; (b) the run ends with exit 18 and the reason `shared_worker_present` or `shared_worker_block_unverified`, and the run report names the realm; (c) there is no flag, environment variable or support toggle to proceed; (d) dry-run remains available; (e) the carried environment observations that are **not** Falcon controls and must be re-verified on browser upgrade — `navigator.sendBeacon` absent in dedicated-worker scope, `new Worker(crossOriginUrl)` throwing synchronously by browser policy, a route armed after worker creation still applying to that worker's later requests, and `SharedWorker` being unexposed inside a dedicated worker; (f) worker-initiated WebSocket (dedicated and shared) is unmeasured; (g) no Linux filesystem is admitted, so pilot execute mode on Linux, including CI, refuses with exit 18 naming the observed filesystem id.

---

## Section H — ADR-0049 (short ADR; durable and cross-cutting)

**ADR-0049 — SharedWorker capability is measured out of page before arming, and any presence or any unverifiable realm refuses the run.**
*Status:* Accepted (design). **Supersedes ADR-0048**; amends ADR-0029.
*Context:* SPIKE-W measured that SharedWorker traffic is neither routable nor observable through `page.on('worker')`. Three CDP spikes (SPIKEW-03 harness negative with a withdrawn exit-137 attribution, SPIKEW-04 with stage 3(a) unresolved, SPIKEW-05 inconclusive and vacuous with Part 1 unmeasured) left the enforcement design unproven, and production non-exposure of a CDP endpoint was never established. The owner's stop rule adopts the fallback.
*Decision:* Before any external target navigation or target-origin access, launch the approved browser in an isolated empty context and determine out of page whether SharedWorker capability is available in every applicable realm of table W6-T. Presence in any measured applicable realm refuses with `PILOT_INTERNAL_ERROR` exit 18 `shared_worker_present`. A realm that cannot be created or measured, a probe timeout, realm disagreement, or a failure of the check itself refuses with exit 18 `shared_worker_block_unverified`. No page-supplied value may influence the decision. No construction stub and no CDP enforcement ships; `shared_worker_blocked` is withdrawn.
*Consequences:* On the current Chromium build Falcon does not arm at all, so Phase 18 ships a refusal path and a probe rather than an armed pilot; dry-run is unaffected. Falcon drops its CDP target-auto-attach dependency entirely. The decision function is a pure function and the primary test seam. Pilots cannot run against applications in capable browsers — accepted, because the alternative is silent uncontained egress.
*Alternatives rejected:* see Section D.
*Fallback, rollback and failure modes:* there is no fallback **to** a weaker mode — the only fallback is refusal. If the probe is unavailable, broken, slow or ambiguous, the outcome is `shared_worker_block_unverified`, exit 18. Rollback is a design rollback only (no code ships from rev 25): reverting to ADR-0048 would re-adopt an unproven CDP dependency and requires a fresh owner decision plus a valid competing-client measurement. Observability: one `Logger.error` line plus a structured `sharedWorkerCapability` report block, with no page-supplied strings and no query or fragment.

---

## Section I — handoff constraints

- **Developer:** implement nothing from rev 23 section B — the stub, the binding and the CDP listener are withdrawn. The implementable surface after SPIKE-W7 is `SharedWorkerCapabilityProbe.measure` plus the pure `decide`, called from `NetworkGate.install` in execute mode before any navigation; refusals are `PILOT_INTERNAL_ERROR` exit 18 with `shared_worker_present` / `shared_worker_block_unverified`; never emit `shared_worker_blocked`; never log a target query or fragment; never let a page value reach the decision; CommonJS, `Logger.*`, no `console.log`, `fs.promises.*`.
- **QA:** SharedWorker fixtures come from **table W6-T only** (B.5 and W2-1..W2-16 are withdrawn); reachability fixtures from **C6-T in rev 23 section D.4 only** (27 / 5). F5, F7, F11 and F21 are **required fail-closed** rows and must never be rewritten into passes. `armed:true` is exercised only by IC3 at unit level. Run every browser case on **Node 22.19.0 and Node 24.21.0**, 3 repetitions, hermetic loopback only; do not weaken IC2 or IC4.
- **Security:** review scope is the B.2 trust boundary and the claim that no page-supplied value reaches the decision; the `frame.evaluate`-versus-sandbox fidelity caveat; the m-82 absent-equals-unmeasured rule; the B.4 naming residue; the E.2 tightening; whether the refusal is stated without an escape hatch; and the M-25 closure conditions (an executed W6-T conformance measurement plus your review — **documentation alone must not close it**).
- **DevOps:** no workflow or `NODE_OPTIONS` change in rev 25; GoogleSearchTest stays out of CI; the FS-RUNNER-01 evidence workflow was one-shot, deleted and admits nothing, so the GitHub-hosted runner stays the authority for the Linux path and Chromium launch under Node 24 on Linux is still unmeasured; CI must expect pilot execute mode to refuse with exit 18 and must not treat that refusal as a flake.

## Needs anchors (not applied by rev 25)

Every `old` anchor in `phase-18-rev25-edits.json` was verified by exact string count to occur **exactly once** in its target file at `e75cad0`. Short SHAs only; no 40-character SHA is introduced. `docs/pilot/limitations.md` still does not exist, so Section G is a DOC-gate obligation rather than an edit. The untracked `phase-18-rev24-patch.md` and `phase-18-rev24-edits.json` are superseded drafts built on the rejected CDP assumption; they are not applied and not copied.
