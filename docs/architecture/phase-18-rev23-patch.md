# Phase 18 architecture patch — revision 23 (ARCH-23)

Base: architecture rev 2 plus the rev 3..rev 22 patches, at `92cffc8` on `docs/phase-18-architecture`.
Inputs: `docs/phase-18-spike-w-findings.md` (SPIKE-W, BLOCKER), `docs/phase-18-spike-fs-findings.md` (SPIKE-FS, PARTIAL), `docs/phase-18-h8-node24-findings.md` (H-8, macOS arm64 only), `docs/phase-18-linux-evidence-findings.md` (LINUX-01, reported at `ba8421d`, Docker Desktop only), plus owner decisions (1) to (4) recorded in the ARCH-23 task packet.
Scope: design text only. No production source file, `package.json` script or workflow step is edited by rev 23.
Machine-applicable edits: `docs/architecture/phase-18-rev23-edits.json`; this document is normative for intent.

**Review status carried forward.** SEC-21 stays BLOCK at the design gate; rev 22's four fixes stand and **M-23 and M-24 are not reopened**. Counts stay **98 total / 89 Must / 6 Should / 3 Could**. Firefox and WebKit stay UNVERIFIED and non-blocking; pilot scope is Chromium only. Every check listed as unexecuted by rev 21 and rev 22 remains owed and none has been run on any tree. Rev 23 adds a **new BLOCKER-class design change** (SharedWorker) and **adds gates**; it weakens nothing and converts no unexecuted check into evidence.

## Section A — what rev 23 changes

| Item | Change | Primary targets |
|---|---|---|
| 1 | SPIKE-W BLOCKER closed in the design by **blocking `SharedWorker` construction before page scripts run**, with an out-of-page refusal signal, exit 18, and a **refuse-to-arm** rule for every unmeasured frame/realm case; **SPIKE-W2** defined as the measurement that must pass before 18C merges | section 7a, rev 3 N-3, rev 4 N-3, ADR-0029, AC/open item SPIKE-W |
| 2 | The false claim "`SharedWorker` is treated as a dedicated worker by the same handler" is **superseded explicitly everywhere it appears**, and rev 4's "`addInitScript` is defense in depth inside workers" framing is corrected: it does not reach worker scope | rev 3 line 122, rev 4 N-3, section 7a, SPIKE-W open item |
| 3 | LINUX-01 folded in (Section E): tmpfs admitted for the ephemeral roots only, overlayfs/virtiofs/ext4 not admitted, the GitHub Actions runner still unmeasured. The macOS RAM-backed HFS+ `statfs` type **25** is recorded as an **observation only and is NOT admitted**; APFS **26** remains admitted for `darwin` exactly as rev 4's table already states; rev 4's **documentation-derived Linux ids are withdrawn from admission** until observed | rev 4 admission table, AC-085, SPIKE-FS open item |
| 4 | `DEP0190` (Node 24.21.0 only) is folded into the reachability checker as new rule **C3.10**, with fixtures **X26, X27** and controls **P4, P5**; table C6-T is reprinted here as the single source with new totals | rev 21 section C / rev 22 section B, AC-090, AC-098 |

---

## Section B — owner decision (1): `SharedWorker` is blocked, not routed

### B.1 What is MEASURED and what is not

**MEASURED (SPIKE-W, Playwright 1.64.0 / Chromium 156.0.8078.4, macOS arm64, 3 reps, two runs, no flake):**

1. `BrowserContext.route()` **does not** observe a `SharedWorker`-initiated `fetch`. The request reached the loopback fixture and mutated it on **every** repetition (leak count 1/1/1).
2. `page.on('worker')` **does not fire** for a `SharedWorker` (`workerEventCount: 0`), so the rev 3/rev 4 event-based backstop cannot see one.
3. `context.addInitScript()` **does** run in page/frame scope (`window.__FALCON_MARK__ === true`) and **does not** run in dedicated-worker scope (`self.__FALCON_MARK__` absent).
4. Dedicated-worker traffic **is** interceptable (fetch, sync XHR, `importScripts`, own script load, `EventSource`, nested workers, `blob:`, `data:`, `{type:'module'}`), so no dedicated-worker refusal is required on the pinned pair.

**NOT MEASURED — nothing about the mechanism below has been measured.** Specifically unmeasured: that `addInitScript` runs before the first page script in *every* frame and realm; that a non-configurable `SharedWorker` stub resists page-side removal; that Playwright exposes `shared_worker` auto-attach targets to a browser- or context-level CDP session; that `waitForDebuggerOnStart` prevents the SharedWorker's first statement from executing; that `Target.closeTarget` is sufficient; and every frame/realm case in B.5. Treat Section B.2 as **design assumption** until SPIKE-W2 reports.

### B.2 Mechanism (design assumption, two independent layers)

**Layer 1 — construction block in every page realm (prevention).**
`context.addInitScript(...)`, installed on every pilot context in execute mode **before any navigation**, replaces `SharedWorker` on `globalThis` inside a non-leaking IIFE using
`Object.defineProperty(globalThis, "SharedWorker", { value: stub, writable: false, configurable: false, enumerable: true })`,
where `stub` (a) synchronously notifies Falcon out of page (Layer 2 channel), then (b) throws `DOMException("SharedWorker is blocked in Falcon pilot execute mode", "NotSupportedError")`. The same is applied to `self` in every realm the init script reaches. The stub is never a silent no-op: page code that swallows the throw still cannot swallow the Layer 2 notification. Because the constructor never runs, `blob:`/`data:`/cross-realm *script sources* are irrelevant — the bypass would have to be in the *constructor*, which is what B.5 measures.

**Layer 2 — out-of-page detection and refusal (the actual control).**
Falcon arms, before any navigation, a browser- or context-level CDP session with
`Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true })`.
On `Target.attachedToTarget` where `targetInfo.type === "shared_worker"`, Falcon **never calls `Runtime.runIfWaitingForDebugger`**: it calls `Target.closeTarget` (and `Target.detachFromTarget`), records the attempt, and refuses the run. The paused-on-start property is what makes "no request reaches the fixture" achievable even if Layer 1 is bypassed. A `page.exposeBinding` callback is the secondary signal used by the Layer 1 stub; the binding is installed before any navigation and its name is run-scoped. **Page script cannot suppress either signal**, because both are consumed in the Node process; deleting the binding or the stub removes the *notice*, not the CDP attach event, and B.5/W2-12 measures exactly that.

**Layer 3 — the refusal is a Falcon refusal, not a page exception.** The page-side throw is a convenience for the application under test. The authoritative outcome is the Falcon refusal below.

### B.3 Refusal semantics and reason codes

Every attempted `SharedWorker` construction refuses the run: **`PILOT_INTERNAL_ERROR`, exit 18, reason `shared_worker_blocked`**, raised before any further pilot action, with the attempted URL (origin + canonical path only) and the frame identity in the message.

**Naming, checked against the existing registry.** Exit-18 reasons in this design are lower `snake_case` modifiers of `PILOT_INTERNAL_ERROR` (`worker_not_interceptable`, `approvals_root_not_durable`, `approvals_root_symlink`, `approval_history_unverifiable`), while `POLICY_*` is the family of top-level failure codes (`POLICY_NETWORK_BLOCKED`, `POLICY_ORIGIN_DENIED`, `POLICY_REDIRECT_LIMIT`). The owner's suggested spelling `POLICY_SHARED_WORKER_BLOCKED` would therefore be inconsistent on both halves. Rev 23 uses **`shared_worker_blocked`** under exit 18 and flags this as a naming decision the owner may overrule without any behavioural change.

A second code is required for the arming refusal: **`PILOT_INTERNAL_ERROR`, exit 18, reason `shared_worker_block_unverified`** (B.4). Exit precedence is unchanged (rev 6 order `2 > 3 > 18 > 17 > 16 > 15 > 13 > 12 > 11 > 14 > 10 > 1 > 0`).

**Decisive test assertion** (mirrors the exact shape of the SPIKE-W leak): for every case, the fixture's recorded request log for the denied sink is **empty** and its mutation counter is **0**, *and* the process exit code is 18 with the reason code above. A non-zero counter is a failure, not a flake; SPIKE-W's leak was reproducible 3/3.

### B.4 Refuse to arm (normative)

**The pilot must REFUSE TO ARM execute mode unless every case in B.5 is recorded MEASURED-PASS on the pinned Playwright/Chromium pair in a committed SPIKE-W2 evidence document.** Until then, `NetworkGate.install(context, { mode: "execute" })` refuses at install time with exit 18, reason `shared_worker_block_unverified`, before any navigation. This is unconditional: an unmeasured case is a refusal, never a documented residual, never a warning, never a degraded mode. Dry-run mode is unaffected (it mutates nothing and arms nothing).

### B.5 SPIKE-W2 — the measurements that must pass before 18C merges

Owner 18C, hermetic loopback fixture, pinned versions, **3 repetitions minimum per case**, route-hit counters instrumented per case (closing SPIKE-W's `data:`/`module` corroborated-by-pattern minor). Every case has an **inversion fixture**: with Falcon's control disabled, the same case must record a **non-zero** request/mutation count, proving the case is a real channel and the test is decisive rather than vacuous.

| Id | Case | Expected with controls on | Inversion (controls off) |
|---|---|---|---|
| W2-1 | `new SharedWorker` in the main frame | exit 18 `shared_worker_blocked`, 0 requests | non-zero |
| W2-2 | same-origin iframe | same | non-zero |
| W2-3 | cross-origin iframe (second loopback port) | same | non-zero |
| W2-4 | popup (`window.open`, `target=_blank`, and `noopener`) | same | non-zero |
| W2-5 | `about:blank` frame | same | non-zero |
| W2-6 | `srcdoc` iframe | same | non-zero |
| W2-7 | `blob:` frame | same | non-zero |
| W2-8 | sandboxed iframe (`sandbox="allow-scripts"`, and the same without `allow-same-origin`) | same | non-zero |
| W2-9 | frame appended **after** arming and after the first navigation | same | non-zero |
| W2-10 | bfcache: navigate away and back, then construct | same | non-zero |
| W2-11 | dedicated worker constructing a `SharedWorker` (if the constructor exists in worker scope; if absent, record **API ABSENT**, which is *not* a pass and must be re-checked on Chromium upgrades, since `addInitScript` cannot reach worker scope at all) | same | non-zero |
| W2-12 | page-code suppression attempts: `delete globalThis.SharedWorker`; `Object.defineProperty`/`Reflect.defineProperty` redefinition; assignment; prototype and `__proto__` manipulation; shadowing via `with`; removing or overwriting the `exposeBinding` function | same; the CDP path still refuses | non-zero |
| W2-13 | cross-realm constructor: `new (f.contentWindow.SharedWorker)(url)` where `f` is an `about:blank`, `srcdoc`, `blob:` or sandboxed iframe, and the same taken from a popup | same | non-zero |
| W2-14 | escalation: a `SharedWorker` (if one ever starts) creating a `Worker` from a `blob:` URL that POSTs | same | non-zero |
| W2-15 | **dedicated-worker-initiated `WebSocket`** with `routeWebSocket("**/*")` armed, against a fixture implementing a real WS upgrade (SPIKE-W dropped this case rather than stubbing it) | frames dropped and counted, 0 fixture mutation | non-zero |
| W2-16 | **`SharedWorker`-initiated `WebSocket`** | exit 18 `shared_worker_blocked`, 0 frames reach the fixture | non-zero |

**Unmeasured cases keep the pilot refusing to arm.** W2-15 and W2-16 are **currently UNMEASURED**, so worker-initiated WebSocket is an arming blocker exactly like the frame/realm cases: until measured (or until the owner explicitly narrows scope in writing), execute mode refuses with `shared_worker_block_unverified`. Service-worker registration stays out of SPIKE-W/W2 scope and remains covered by `serviceWorkers: 'block'`, unverified in this spike.

Carried-forward SPIKE-W gap, unchanged by rev 23: **`request.frame()` identity** on worker-initiated requests is only known not to throw. No design statement may depend on frame-scoping a worker request until a targeted measurement exists (this already constrains AC-102-class frame-identity rules).

### B.6 Explicit supersessions (false claims corrected)

| Location | False text | Correction |
|---|---|---|
| rev 3 N-3 (`phase-18-rev3-patch.md:122`) | "`SharedWorker` is treated as a dedicated worker by the same handler." | **FALSE, measured false 3/3.** Superseded by section B: SharedWorker traffic is not routed and `page.on('worker')` does not fire; construction is blocked and the run refuses. |
| rev 4 N-3 item 1 | the preventive `addInitScript` as worker defence in depth | **Corrected.** `addInitScript` does **not** execute in worker global scope (MEASURED). Dedicated workers are protected by the `route`/`routeWebSocket` **network layer only**; the init script protects page/frame realms only and is the SharedWorker *construction* block, not an in-worker control. |
| rev 4 N-3 and 19a row | "the same case with `SharedWorker`" treated as a counted denial that lets the run continue | **Corrected.** A `SharedWorker` construction attempt is a **run refusal** (exit 18), not a counted denial. |
| section 7a rules 1 and 4 | no SharedWorker rule; beacons/WebSocket described as covered by rule 3 | **Extended** with the construction block, the out-of-page detection, the refusal codes and the refuse-to-arm rule; rule 4 notes that a SharedWorker-initiated request is **not** covered by rule 3. |
| ADR-0029 | network gate described as covering worker traffic generally | **Amended** by ADR-0048 (Section H). |
| AC/open item SPIKE-W | "preventive addInitScript ships regardless; interception behaviour recorded" | **Replaced**: BLOCKER found, design revised in rev 23, SPIKE-W2 required before 18C merges, arming refused until then. |

Also recorded as current-environment observations, **not Falcon controls** (Chromium-version dependent, re-verify on upgrade; destination `docs/pilot/limitations.md`, which still does not exist): `navigator.sendBeacon` is absent in dedicated-worker scope; `new Worker(crossOriginUrl)` throws synchronously in the page by browser policy; a route armed after worker creation still applies to that worker's later requests.

---

## Section C — owner decision (2): the macOS RAM-backed HFS+ observation

**C.1 Categorisation.** macOS has **no tmpfs**. The volume SPIKE-FS measured was created unprivileged with `hdiutil attach -nomount ram://2048` plus `diskutil eraseVolume HFS+`, i.e. a **RAM-backed HFS+** volume reporting `fs.statfsSync().type === 25`. It is **not** tmpfs, must never be reported as tmpfs evidence, and is **NOT ADMITTED on any root**: an id outside the admitted per-root set fails closed (rev 10 4c item 4, exit 18 naming the observed id and path). Rev 23 records 25 as an **observation only**. Admission is never granted by observation alone, and never by documentation: it requires an owner-intended per-root entry **plus** the behaviour battery **plus** a durability argument, and this volume's durability was never measured (and for memory-backed storage would be expected to fail).

**C.2 APFS 26 — stated consistently.** The existing admission table (rev 4, `phase-18-rev4-patch.md:175`) **already admits `26` for `darwin`**, "observed on the dev host; must be re-observed by SPIKE-FS on every supported darwin major". SPIKE-FS re-observed 26 on darwin 25.5.0 for both `/tmp` and the repo volume, and H-8 re-observed 26 under **both** Node 22.19.0 and Node 24.21.0. So: **APFS 26 is admitted for `darwin`**, for the two live Phase 18 roots (`run/auth`, `run/plans`; `run/approvals` is deferred under OWNER-13 and Phase 18 creates no approvals root). This is a *local/dev* platform admission; the **CI production root is Linux and is UNMEASURED** (Section E). Rev 23 adds no id to the table.

**C.3 Correction — no id by documentation (tightening).** Rev 4's table admits `0xEF53`, `0x58465342` and `0x9123683E` for `linux` with the provenance "documented Linux `magic.h` constants". That contradicts rev 9 m-21(a), rev 10 4c item 3 and AC-085, all of which forbid admitting an id from a kernel header, documentation or reviewer knowledge. **Rev 23 withdraws those three ids from admission until they are observed and committed** (LINUX-01 / a second SPIKE-FS pass on the real runner). Consequence, stated plainly: until then, pilot execute mode on Linux — including CI — **refuses** with exit 18 naming the observed id. This is fail-closed and a tightening; it is the honest reading of the design's own rule.

**C.4 SPIKE-FS status = PARTIAL.** Darwin APFS and the RAM-backed HFS+ battery are measured. **Unobserved:** Darwin `F_FULLFSYNC` (Node exposes no `fcntl(F_FULLFSYNC)` without a native addon), reboot/power-loss durability (unmeasurable in-process, by design — rev 4 rejects a capability probe as a durability substitute), all Linux ids and behaviours, ZFS, and the "is the platform tmpfs id shared with ramfs" comparison. ZFS stays inadmissible on every root. 18F cannot merge on this evidence.

---

## Section D — owner decision (3): DEP0190 and the reachability checker

**D.1 Fact (MEASURED, H-8, macOS arm64).** Node **24.21.0** emits `[DEP0190] DeprecationWarning` for `child_process.spawn`/`spawnSync` called with `shell: true` **and** a non-empty `args` array; Node **22.19.0** does not. `src/core/history/GitInfo.js` is unaffected (`execFileSync`, `shell` unset). Nothing else differed between the two Node versions in the measured set. CI runs Node 24, so this is a CI-reachable behaviour difference.

**D.2 New rule C3.10 (extends rev 21 section C / rev 22 C3 rules; C3.1–C3.9 unchanged).**
In code within the **C3.7 production-reachable scope**, a `child_process.spawn`/`spawnSync` call (identified **by binding**, per C3.4b) whose options object carries a truthy `shell` together with a non-empty `args` array is **FORBIDDEN and fails the check closed**. Fail-closed also covers the unanalysable forms: a non-literal `shell` value, a spread or computed options object, and a non-literal `args` expression. The same shape on `execFile`/`execFileSync` is forbidden under the same rule on the same rationale (arguments are concatenated, not escaped); only the `spawn`/`spawnSync` warning emission is measured, and the extension to `execFile*` is labelled a design assumption.
In code classified **test**, the same shape is a **recorded WARNING**, not a failure. The warning set is deterministic, emitted in a stable order, and committed as a baseline so that a new occurrence is visible in review; a warning never becomes a failure and never becomes evidence of absence.

**D.3 CI behaviour.** CI runs with `NODE_OPTIONS` **unchanged** (no `--throw-deprecation`, no `--no-deprecation`); C3.9's environment-injection rule continues to forbid setting it in a production step. Inside **the checker's own process only**, the checker installs `process.on("warning", w => ...)` and treats `w.code === "DEP0190"` as a failure of its own run. If that in-process observation proves infeasible on the pinned Node, the fallback is the static rule C3.10 alone, and the dynamic check is recorded as **NOT IMPLEMENTED** — never as green, and never silently dropped. No other job's warning behaviour changes.

**D.4 Fixtures — table C6-T, reprinted as the single source.** This table **supersedes the printed copies in rev 22 section B and rev 21 section C** and is the only source of fixture ids and counts. Prose must not restate a count. The checker asserts its own fixture directory against this table — both count and id set — and fails on any extra, missing or duplicate id.

| Id | Kind | Shape | Origin | Expected |
|---|---|---|---|---|
| X1 | inversion | inline `NODE_OPTIONS="--require ./tests/x.js" node falcon.js` in a production step, and its `env:`-block twin (C3.9) | rev 20 | fail |
| X2 | inversion | a production entry committed as `test` (step 226 and `start`), rejected by C4.1 recomputation | rev 20 | fail |
| X3 | inversion | `require(path.join("..","tests","x"))` in `scripts/` from a production root | rev 19 | fail |
| X4 | inversion | `import("../../tests/x")` in `src/` | rev 19 | fail |
| X5 | inversion | `spawn(process.execPath,["tests/x.js"])` from a production root | rev 19 | fail |
| X6 | inversion | a `production` step running `node tests/experimental/x.js` | rev 19 | fail |
| X7 | inversion | `createRequire(__filename)("../../tests/x")` in `src/` | rev 19 | fail |
| X8 | inversion | `|| true` relied on as an unknown executable (removing C3.6a must fail the current tree) | rev 20 | fail |
| X9 | inversion | `set -o pipefail` relied on as an unknown executable (same sense as X8) | rev 20 | fail |
| X10 | inversion | `GitInfo`-shaped default-parameter capability with a non-literal executable or non-literal argv | rev 20 | fail |
| X11 | inversion | forwarding escape: capability passed to a **non-local** function | rev 21 | fail |
| X12 | inversion | capability **returned** from the module | rev 21 | fail |
| X13 | inversion | capability stored as an **object property** that escapes | rev 21 | fail |
| X14 | inversion | capability **assigned** to an alias then called with variable argv | rev 21 | fail |
| X15 | inversion | capability as a **default parameter** that is never invoked | rev 21 | fail |
| X16 | inversion | X11-shaped escape via a worker/`createRequire` edge (unanalysable) | rev 21 | fail |
| X17 | inversion | `new Worker("./tests/x.js")` in `scripts/` from a production root | rev 19 | fail |
| X18 | inversion | a production step `bash -c "node tests/x.js"` | rev 19 | fail |
| X19 | inversion | a production step `nohup node tests/x.js &` | rev 19 | fail |
| X20 | inversion | a production step `npx playwright test` | rev 19 | fail |
| X21 | inversion | a new unclassified `package.json` script | rev 19 | fail |
| X22 | inversion | a new unclassified `ci.yml` `run:` step | rev 19 | fail |
| X23 | inversion | a classification value other than `production`/`test` | rev 19 | fail |
| X24 | inversion | an unclassified `pre`/`post` lifecycle script | rev 19 | fail |
| X25 | inversion | `falcon.js` requiring `scripts/fixture/server.js` | rev 19 | fail |
| X26 | inversion | **C3.10**: production-reachable `spawn(cmd, ["a"], { shell: true })` | rev 23 | fail |
| X27 | inversion | **C3.10**: production-reachable `spawnSync` with a non-literal `args` and a non-literal `shell` value (the unanalysable form) | rev 23 | fail |
| P1 | positive control | `execFile("git", ["rev-parse","--git-common-dir"])` with a literal argv in `src/` | rev 20 | pass |
| P2 | positive control | the same with a module-level `const` argv array | rev 20 | pass |
| P3 | positive control | the real two-hop `GitInfo` shape (`:34` default param -> `:39`/`:44` forward -> `:21` call, literal argv) | rev 21 | pass |
| P4 | positive control | **C3.10**: the X26 shape in **test**-classified code — passes, with exactly one recorded `DEP0190` warning in the baseline | rev 23 | pass |
| P5 | positive control | **C3.10**: production-reachable `spawn(cmd, { shell: true })` with **no** `args` (outside the DEP0190 shape) — passes, no warning | rev 23 | pass |

**Totals: 27 inversion fixtures (X1..X27, contiguous, no duplicate id) and 5 positive controls (P1..P5).** Mapping: rev 19 contributed `X3..X7` and `X17..X25`; rev 20 `X1..X10`, `X17..X25`, `P1`, `P2`; rev 21 `X11..X16`, `P3`; rev 23 `X26`, `X27`, `P4`, `P5`. Every stale "25 / twenty-five inversion fixtures" and "three positive controls" statement is updated to **27 / 5** by the edits list. Verification obligation (owed, unexecuted): all 27 fail and all 5 pass on the real shapes before 18D or 18F claims the gate.

**D.5 Counts.** Criterion counts are untouched: **98 / 89 / 6 / 3**; deferred counts, `deferredIds` and `mixedPhase18PIds` unchanged; no criterion added, removed or re-phased. The only numeric changes are inside C6-T (25 -> 27 inversions, 3 -> 5 controls).

---

## Section E — Linux findings (LINUX-01, reported)

LINUX-01 reported after the first ARCH-23 pass and is committed at `ba8421d`: `docs/phase-18-linux-evidence-findings.md`. It replaces the earlier "pending" placeholder. Evidence is **digest-pinned Docker Desktop** (multi-arch index digests for `node:22.19.0` `sha256:afff6d8c…` and `node:24.21.0` `sha256:3d27e5c1…`, with per-architecture manifest digests recorded in the findings doc; full 64-hex digests live there, not here).

**E.1 MEASURED (Docker Desktop, Node 22.19.0 and 24.21.0, arm64 native and amd64 emulated).** Observed `statfs` types: **overlay `0x794c7630`**, **tmpfs `0x1021994`**, **ext4 volume `0xef53`**, **virtiofs `0x6a656a63`**. Every filesystem property in the battery **PASSED on every root under both Node versions and both architectures** (`O_EXCL` single and contended, same-directory rename, file and directory `fsync`, cross-process lock visibility, symlink `lstat`/`O_NOFOLLOW`/swap observability, `0600`/`0700` under a restrictive umask, SIGKILL leftover-partial-temp). `DEP0190` appeared **only** under Node 24, confirming the H-8 macOS finding on Linux. Babel parse of `falcon.js` plus all of `src/**`: **82/82**. CLI exit **2** with intact stderr: PASS.

**E.2 Admission implications under the owner rules (no id admitted by documentation).** An id enters the admitted set **only** as an observed, committed value and **only** for the purpose it was admitted for:

1. **tmpfs `0x1021994` is ADMITTED for the ephemeral roots `run/auth` and `run/plans` only**, per rev 10 4c item 2, carrying **no durability claim**. It stays **REFUSED for the approval/audit root** (`run/approvals`): exit 18, `approvals_root_not_durable` — unchanged, and unaffected by these PASS results, because what was measured is same-process success, never durability.
2. **overlayfs `0x794c7630` and virtiofs `0x6a656a63` are NOT ADMITTED on any root.** They were observed and they passed the battery; observation plus behaviour is not admission, and no owner decision admits them.
3. **ext4 `0xef53` is an observation only**, taken inside a Docker Desktop VM volume. It is **not** admitted: the Section C.3 withdrawal stands, and readmission requires an observation on the actual target runner, per root.
4. **Unknown ids continue to fail closed** on every root (exit 18, naming the observed id and path) — never a skip, never a warning, never a degraded mode.
5. **`ramfs` id UNOBSERVED**: `mount -t ramfs` requires privileges the container did not have, so the rev 10 line 257 question — whether the platform tmpfs id is shared with ramfs — is **still unanswered**. Admitting tmpfs for the ephemeral roots therefore carries the explicit residual that the admitted id has **not** been shown to be distinguishable from ramfs on Linux.
6. **ZFS stays inadmissible** on every root: not testable in Docker Desktop or on `ubuntu-latest`; it remains conditional on direct evidence from a real pool.
7. **`F_FULLFSYNC` and power-loss durability remain untested** on every platform, as before and by design.

**E.3 Still REQUIRED and UNMEASURED: the GitHub Actions `ubuntu` x64 runner.** Docker Desktop is **not** the CI runner. The real runner's per-root `statfs` ids, Playwright Chromium launch under Node 24, and the pilot job's admission result are unmeasured, so **18F cannot merge**. The findings doc contains a **proposed evidence-only `workflow_dispatch` workflow** (text in the document, unpushed, `permissions: contents: read`, no secrets); it is a proposal for DevOps, not evidence, and rev 23 counts it as an unexecuted gate.

**E.4 Supersession.** The earlier rev 23 "Linux findings (pending LINUX-01)" placeholder is withdrawn; this section is normative, and the `LINUX-01` open item text in `phase-18-rev23-edits.json` carries the same content.

## Section F — evidence status recorded by rev 23

| Item | Status |
|---|---|
| SPIKE-W | **COMPLETE with a BLOCKER.** Design revised in rev 23; **SPIKE-W2 required before 18C merges**; arming refused until SPIKE-W2 passes. Minors carried: `data:`/`module` route-hit counters, `request.frame()` identity. |
| SPIKE-W2 | **NOT STARTED.** 16 cases, each with an inversion fixture (B.5). |
| SPIKE-FS | **PARTIAL.** macOS APFS (26) and RAM-backed HFS+ (25) measured; `F_FULLFSYNC`, reboot durability, all Linux ids/behaviours and ZFS **unobserved**. 18F blocked. |
| H-8 | **macOS arm64 only.** DEP0190 is the single observed Node 22 vs 24 difference; **Linux CI unmeasured**; Playwright Chromium launch under Node 24 not attempted. H-8 stays an open item, not closed. |
| LINUX-01 | **REPORTED** at `ba8421d` (Section E): digest-pinned Docker Desktop, four ids observed, full battery PASS under Node 22.19.0 and 24.21.0 on arm64 and amd64, DEP0190 Node 24 only, Babel 82/82, exit 2 plus stderr OK. **tmpfs admitted for the ephemeral roots only; overlayfs and virtiofs not admitted; ext4-in-VM observation only; ramfs unobserved; ZFS untestable.** The GitHub Actions `ubuntu` x64 runner stays **REQUIRED and UNMEASURED**. |
| M-23, M-24 | **Closed, not reopened.** |
| Owner decisions | Untouched. OWNER-11, OWNER-12, OWNER-13, OWNER-14 and OD-20 stand as written. |

**New unexecuted gates introduced by rev 23** (all mandatory, none run on any tree):

1. SPIKE-W2 cases W2-1..W2-16 with their 16 inversion fixtures (18C merge gate).
2. The `shared_worker_blocked` refusal test: exit 18, correct reason, **zero** fixture requests and zero mutations, repeated (SPIKE-W's leak was reproducible).
3. The `shared_worker_block_unverified` arming-refusal test: with SPIKE-W2 evidence absent or incomplete, execute-mode install refuses with exit 18 before any navigation (an inversion fixture must show that removing the gate lets the run arm).
4. A test asserting `addInitScript` is **not** claimed as an in-worker control (the design-text assertion is a review item; the measurable half is SPIKE-W fact 3, already recorded).
5. C3.10 fixtures X26, X27 and controls P4, P5, plus the checker's count-and-id-set self-assertion at **27 / 5**.
6. The D.3 in-process `DEP0190` failure behaviour of the checker's own run (or its explicit NOT IMPLEMENTED record).
7. A SPIKE-FS pass on the **real GitHub Actions `ubuntu` x64 runner**, per root (18F merge gate; LINUX-01 covered Docker Desktop only), plus the Section C.3 fail-closed refusal test for an unobserved Linux id, plus the admission test that tmpfs `0x1021994` is accepted for `run/auth` and `run/plans` and refused for an approvals root, and that overlayfs, virtiofs and ext4 are refused on every root.
8. The worker-initiated WebSocket measurements W2-15 and W2-16 against a fixture with a real WS upgrade.

---

## Section H — ADR-0048 (short ADR; durable and cross-cutting)

**ADR-0048 — `SharedWorker` is blocked at construction and unmeasured realms refuse to arm.**
*Status:* Accepted (design), amending ADR-0029.
*Context:* SPIKE-W measured, 3/3, that `BrowserContext.route()` does not observe `SharedWorker`-initiated requests and that `page.on('worker')` does not fire for a SharedWorker, so the rev 3 claim of handler coverage and the rev 4 event backstop are both void. An unintercepted `SharedWorker` is an uncontained POST egress channel in an authenticated pilot.
*Decision:* Do not attempt to intercept SharedWorker traffic. Block construction in every page realm before page scripts run, detect every attempt out of page (CDP `shared_worker` auto-attach paused on start, plus a run-scoped binding), refuse the run with exit 18 `shared_worker_blocked`, and **refuse to arm execute mode** (exit 18 `shared_worker_block_unverified`) until SPIKE-W2 records a pass for every frame/realm, suppression, cross-realm and WebSocket case.
*Consequences:* Pilots cannot run against applications that legitimately use SharedWorker — accepted, because the alternative is silent uncontained egress. Falcon takes a dependency on CDP target auto-attach semantics, which is Chromium-only (pilot scope is already Chromium-only) and is itself unmeasured until SPIKE-W2. Dedicated workers remain protected by the network layer alone; `addInitScript` is explicitly not an in-worker control.
*Alternatives rejected:* (a) keep `page.on('worker')` as the backstop — measured not to fire; (b) document SharedWorker as a residual and continue — the leak is reproducible egress, not a theoretical gap; (c) page-side stub only — page code can delete it, and the throw is suppressible; (d) ship with partial realm coverage — an unmeasured realm is indistinguishable from an open channel, so arming is refused instead.

---

## Section I — handoff constraints

- **Developer:** do not implement anything in Section B yet; it is unmeasured. The implementable surface after SPIKE-W2 is: `addInitScript` non-configurable `SharedWorker` stub + run-scoped binding + browser/context CDP auto-attach listener that never resumes a `shared_worker` target; refusals are `PILOT_INTERNAL_ERROR` exit 18 with `shared_worker_blocked` / `shared_worker_block_unverified`; never log the attempted URL's query or fragment; CommonJS, `Logger.*`, no `console.log`.
- **QA:** build fixtures from **table C6-T in Section D.4 only** (X1..X27, P1..P5) and from the B.5 matrix; every B.5 case needs its inversion with the control disabled proving a non-zero counter; the decisive SharedWorker assertion is **zero fixture requests**, not "the constructor threw"; do not weaken any inversion fixture to pass.
- **Security:** rev 23 claims **no execution**. Review scope: the B.2 mechanism's unmeasured assumptions, the B.3 reason-code naming deviation from the owner's suggested spelling, the C.3 tightening (withdrawing documentation-derived Linux ids), and whether the refuse-to-arm rule is stated without an escape hatch.
- **DevOps:** `NODE_OPTIONS` unchanged in CI; the DEP0190 failure behaviour is scoped to the checker's own process; LINUX-01 (`ba8421d`) is Docker Desktop evidence and the GitHub Actions `ubuntu` x64 runner is still unmeasured — the proposed evidence-only `workflow_dispatch` workflow in the findings doc is yours to review, and it is a proposal, not evidence; Node 24 on Linux is still unmeasured; Chromium-only pilot scope; GoogleSearchTest stays out of CI.

## Needs anchors (not applied by rev 23)

Every `old` anchor in `phase-18-rev23-edits.json` was verified by exact string count to occur **exactly once** in its target field or file at `92cffc8`. Short SHAs only; no 40-character SHA is introduced. `docs/pilot/limitations.md` still does not exist, so the Section B.6 observations remain a DOC-gate obligation rather than an edit. Rev 22's own pending `docEdits` against `phase-18-rev21-patch.md` are unchanged by rev 23 except that rev 23's C6-T supersedes the table they rewrite; if rev 22's edits are applied after rev 23's, the Section D.4 table still wins.
