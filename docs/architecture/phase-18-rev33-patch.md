# Phase 18 rev 33 — decision boundary (m-99), FW-2 worker WebSocket fail-closed rule, realm-table resolution, OPEN-BID-27 kept open

Revision base: `31c403a` (branch `docs/phase-18-architecture`). **Docs-only, normative addendum.** It extends, and does not replace, `docs/architecture/phase-18-rev32-patch.md` (reference decision module `decide32.js`, sha256 `e197ec58f6084f03508cac198e21630eb31eb3f2218023c227642fb898b3a522`, unchanged by this revision). No implementation, no merge, no tag, no customer claim is authorised by this document.

> Paths beginning `scratchpad/` name coordinator-machine evidence locations (not tracked); the normative text they contain is reproduced in this document.

Owner rulings in force and carried unchanged: **OWNER-24** strict same-process browser posture, no exceptions, an **empty supported-browser set is accepted**; **no identity uncertainty may arm**; **worker WebSocket traffic must be contained or must cause a fail-closed refusal, and must not be excluded from the security claims**.

Wording discipline used throughout: **OBSERVED** = measured on a pinned environment with the runs stated; **INFERENCE** = reasoning from observations, not independently proven; **RECOMMENDATION / REQUIREMENT** = normative design text that is not itself a measurement.

---

## 1. m-99 — the decision boundary (normative)

**Context (OBSERVED).** `docs/phase-18-conf08-stress-results.md` FC20 recorded one `RangeError` escaping `decide` under real stack exhaustion on Node 22.19.0 (none on Node 24.21.0); no wrong decision and no arm on invalid input was produced. `decide` contains no `try`/`catch`, so engine resource exhaustion is outside its totality claim. Security logged this as minor **m-99** (`docs/security/phase-18-design-review-26.md` lists the stack-exhaustion throw test as *not done* by the reviewer; m-99 originates from the coordinator's CONF-08 run).

### 1.1 Normative rule

1. **No product code may call `decide` directly.** Every consumer calls it through the gate boundary of section 1.2.
2. **Every exception** thrown out of `decide`, of any type, becomes `{ armed: false, exit: 18, reason: 'shared_worker_block_unverified', detail: 'decision-exception' }`. The caught value is **never read** (no `e.message`, no `e.stack`, no `instanceof`), so a hostile or throwing error object cannot run code or influence the verdict.
3. **Every result that is not exactly one of the three frozen shapes** `decide` is contracted to return becomes `{ armed: false, exit: 18, reason: 'shared_worker_block_unverified', detail: 'decision-result-malformed' }`. "Not exactly" includes: not frozen, prototype not `Object.prototype`, wrong key count, accessor-backed fields, a `Proxy`, a null-prototype object, `armed` not a boolean, `exit` inconsistent with `armed`, an unknown `reason`, a non-string `detail`, and a `detail` present on an armed result.
4. **Fail-closed direction is one-way.** The gate may turn an arm into a refusal; it may never turn a refusal into an arm, and it may never rewrite a well-formed verdict (an authorised arm passes through byte-identically).
5. **Capture-once is a consumer requirement** (CONF-08 FC21): the gate module performs `const { decide } = require('./decide32.js')` **once at its own load**, never re-requires, never re-reads the export, and never deletes or reloads the require-cache entry. A `decide` reference captured at load was OBSERVED unaffected by later assignment, `defineProperty`, `delete`, or require-cache removal; a fresh `require` after cache removal yields a **different instance** and is therefore forbidden.
6. **Process-integrity boundary (restated, unchanged).** Code that runs in the Falcon process before the gate module finishes initializing can replace any intrinsic either module captures. That is outside this design's guarantee and remains the documented process-integrity assumption (process, dependencies and launch environment trusted at load time). This boundary is **not** a protection claim.
7. **Exit code:** 18 only. No new exit code. Exit precedence is unchanged: `2 > 3 > 18 > 17 > 16 > 15 > 13 > 12 > 11 > 14 > 10 > 1 > 0`.

### 1.2 Reference gate boundary (verbatim, `scratchpad/conf07/gate32.js`)

This text is the normative reference for the boundary. It is reference text, not shipped code.

```js
'use strict';
// Reference decision boundary (m-99): every exception, malformed or unexpected result becomes
// shared_worker_block_unverified / exit 18. Uses only captured intrinsics; the caught value is never read.
const ObjectFreeze = Object.freeze;
const ObjectIsFrozen = Object.isFrozen;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectPrototype = Object.prototype;
function refuse(detail) {
  return ObjectFreeze({ armed: false, exit: 18, reason: 'shared_worker_block_unverified', detail: detail });
}
function dataValue(o, k) {
  const d = ObjectGetOwnPropertyDescriptor(o, k);
  return d !== undefined && ObjectGetPrototypeOf(d) === ObjectPrototype && Object.hasOwn(d, 'value') ? d.value : undefined;
}
// A result is trusted only if it is one of the exact three frozen shapes the decision function returns.
function wellFormed(r) {
  if (r === null || typeof r !== 'object' || !ObjectIsFrozen(r) || ObjectGetPrototypeOf(r) !== ObjectPrototype) return false;
  const names = ObjectGetOwnPropertyNames(r);
  const armed = dataValue(r, 'armed'), exit = dataValue(r, 'exit'), reason = dataValue(r, 'reason');
  if (armed === true) return names.length === 3 && exit === 0 && reason === 'shared_worker_absent_all_realms';
  if (armed !== false || exit !== 18) return false;
  const detail = dataValue(r, 'detail');
  return names.length === 4 && typeof detail === 'string'
    && (reason === 'shared_worker_block_unverified' || reason === 'shared_worker_present');
}
function createGate(decideFn) {
  return function gateDecide(perRealm) {
    try {
      const r = decideFn(perRealm);
      return wellFormed(r) ? r : refuse('decision-result-malformed');
    } catch (e) {                      // never inspect e: any exception is a refusal
      return refuse('decision-exception');
    }
  };
}
module.exports = ObjectFreeze({ createGate: createGate });
```

**Known gaps in the reference text, stated honestly.** `Object.hasOwn` is read live inside `dataValue` rather than captured at initialization; under the m-96 standard applied to `decide32.js` it should be captured. `createGate` takes the decision function as an argument, so the capture-once requirement (rule 5) lives in the consumer, not in this file. Both are **implementation constraints for Developer**, not defects in the measured results below.

### 1.3 New matrix rows (counts and expected outcomes)

Rows **FC19–FC21** come from `docs/phase-18-conf08-stress-results.md`; **FC22** from `scratchpad/conf07/gate-test.js`. Rows total becomes **57** (53 + FC19 + FC20 + FC21 + FC22). They are **not yet** in `docs/architecture/phase-18-rev32-expectations.json`; adding them is an owed artifact edit, not a claim of coverage.

| Row | Case | Count | Expected outcome | Status |
|---|---|---|---|---|
| FC19a-b | self-referencing record value; self-containing array | 2 | refuse `record-value-type:*` / `record-not-plain-object`, no throw | OBSERVED, both Nodes |
| FC19c-d | 200000-deep nested array / object as a record value | 2 | refuse in ~1 ms, no recursion, no throw | OBSERVED |
| FC19e | 5000-deep `Proxy` chain as a record | 1 | refuse `record-proxy`, **0** traps run | OBSERVED |
| FC19f-g | sparse array `length` 1e9; 1025 records | 2 | refuse `input-length-excessive` before allocation | OBSERVED |
| FC19h | 50 MB string value | 1 | refuse `record-value-enum:*` | OBSERVED |
| FC20 | `decide` at 1001 stack depths, 4000–11000 frames, valid and invalid input | 1001 depths x 2 inputs | no wrong decision; **never** armed on invalid input; valid input armed except **1** `RangeError` (Node 22; 0 on Node 24) | OBSERVED |
| FC20b | 301-depth window around the measured overflow boundary | 301 depths x 2 inputs | 0 wrong decisions, 0 arms on invalid input | OBSERVED; the overflow itself **could not be reproduced** inside the window (frame size varies with JIT tier) |
| FC21 | capture-once export | 1 export + 4 mutation attempts + cache-removal probe | export frozen, single key `decide`; strict assign / `defineProperty` / `delete` throw `TypeError`; sloppy assign ignored; `require` returns the same frozen object; a load-time-captured `decide` is unaffected; post-cache-removal `require` is a **different** instance | OBSERVED against the module contract only (no product consumer exists) |
| FC22a-b | gate pass-through: authorised-arm input and a refusing input are returned byte-identical to bare `decide` | 2 | identical result; `armed === true` only for the authorised arm | OBSERVED |
| FC22c-e | thrown values: `Error`, `RangeError`, `null`, `'x'`, object with a throwing `message` getter | 5 | refuse, `detail === 'decision-exception'`; the throwing getter is **never invoked** | OBSERVED |
| FC22f | malformed / unfrozen / Proxy / null-prototype results | 14 | refuse, `detail === 'decision-result-malformed'`; **never** armed | OBSERVED |
| FC22g | real stack exhaustion through the real `decide` behind the gate: depths 3000 → measured-max+400, step 5, valid and invalid input | ~2 x ((max+400−3000)/5) calls | `wrongArm === 0`; any exception raised **inside** `decide` becomes `decision-exception` | OBSERVED for `wrongArm === 0`; see limit below |
| FC22h | gate export frozen with the single key `createGate` | 1 | frozen, `Object.keys` === `['createGate']` | OBSERVED |

**Honest limit on FC22g (must be carried into any claim).** Real stack exhaustion *inside* `decide` was **not reproduced deterministically**. The harness records `converted`, `passed` and `escapedBeforeGate` counters; frames can overflow in `atDepth` or in the gate frame itself, before `decide` is entered, and the overflow depth moves with the JIT tier (consistent with FC20b). Therefore: the design may claim **"no wrong arm was observed under stack pressure"** and **"the gate converts exceptions it catches into exit 18"**; it may **not** claim **"stack exhaustion inside `decide` is converted to exit 18"** as a measured fact. Closing this needs a deterministic exhaustion fixture (owed measurement **MG-1**, section 5).

---

## 2. FW-2 — worker WebSocket containment (normative)

### 2.1 What was measured

**OBSERVED** (`docs/phase-18-measa2-f17-f21-fw1-findings.md`; 3 repetitions on each of Node 22.19.0 and 24.21.0, identical; macOS arm64, Playwright 1.64.0, Chromium 156.0.8078.4, loopback fixtures only):

- **Page socket: CONTAINED.** `browserContext.routeWebSocket` fired for the page-level WebSocket in 3 of 3 runs and the handler could close it.
- **Worker sockets: MEASURED NOT CONTAINED.** For dedicated (URL), blob and nested workers the socket **opened** (`readyState 1`) in **9 of 9** attempts; the route handler fired **0** times; the context `websocket` event reported **none**; the fixture counted **9 opens, 0 closes**. `docs/phase-18-measa-f16-f21-fw1-findings.md` independently OBSERVED the dedicated-worker socket opening with `playwrightSawWs:false` in 3 of 3 runs on both Nodes.

**Consequence (fact, not inference):** on the pinned build, `routeWebSocket` does not intercept WebSockets created in dedicated, blob or nested workers. The design must not state or imply that all customer-bound traffic is observed or refused through Playwright routing, and worker WebSocket traffic must not be excluded from the security claims.

### 2.2 Fail-closed rule (normative, FW-2)

1. Until a containment mechanism for worker-originated WebSockets is **MEASURED** on the pinned build **and** reviewed by Security, **execute mode does not arm**. This is independent of the SharedWorker realm decision and of the supported-browser set (which remains empty under OWNER-24).
2. Stable reason code: **`worker_websocket_containment_unverified`**, `exit: 18`, `armed: false`, detail vocabulary `fw2:unmeasured` (no mechanism measured) and `fw2:mechanism-failed:<mechanism-id>` (a mechanism was configured but its containment check did not hold at runtime).
3. **Precedence placement.** Within exit 18, FW-2 is a **pre-arming precondition evaluated before** the SharedWorker realm decision, because it does not depend on `perRealm` and cannot be satisfied by realm evidence. Order inside exit 18: `worker_websocket_containment_unverified` → `shared_worker_block_unverified` → `shared_worker_present`. The overall exit precedence (`2 > 3 > 18 > ...`) is unchanged, and no new exit code is introduced.
4. The refusal is **not** a flake. CI must expect exit 18 from pilot execute mode and must match the reason **set**, which now includes `worker_websocket_containment_unverified`.
5. No flag, environment variable, allowlist, acknowledgement or warning mode may bypass rule 1.

### 2.3 Candidate containment mechanisms — UNMEASURED measurement gates

Listed as gates to measure. **No claim is made that any of these works.** Each must be measured on the pinned build (both Nodes, 3+ repetitions, macOS **and** Linux/GitHub runner) and reviewed by Security before it can retire rule 2.2.1.

| ID | Candidate | Why it is plausible (INFERENCE) | What must be measured |
|---|---|---|---|
| FW2-C1 | `Content-Security-Policy: connect-src` injected into the **document** and **worker-script** responses that Falcon fulfils through its routing handler | SPIKE-W OBSERVED that dedicated worker scripts are routed, so a header can be attached | Does CSP inherit into dedicated, blob and nested worker realms; does it block `WebSocket`, and how the block surfaces (throw vs silent); bypass via `data:`/`blob:` script sources |
| FW2-C2 | CDP-level network blocking of the `ws:`/`wss:` scheme for worker targets | CDP sees more target types than the client routing API | Whether worker targets are attachable and whether the interception domain covers WebSocket handshakes |
| FW2-C3 | Refuse to route at all: deny the worker-script response unless its origin is on the pilot allowlist | removes the realm instead of containing its traffic | Whether blocking worker scripts breaks legitimate pilot pages; fail-closed behaviour on a missed route |
| FW2-C4 | Network-layer egress restriction outside the browser (host/CI level) | outside the browser's control surface entirely | Feasibility on a GitHub runner; whether it is in scope for a product claim at all |

**Not measured anywhere yet, and therefore also open:** shared-worker and service-worker sockets, `WebTransport`, `EventSource`, worker `fetch` beyond SPIKE-W's routing observation, Linux and GitHub-runner behaviour for every row in this section.

---

## 3. Realm table updates (normative)

Replaces the corresponding rows carried into rev 32. Source: `docs/phase-18-measa2-f17-f21-fw1-findings.md` (resolving) and `docs/phase-18-measa-f16-f21-fw1-findings.md` (superseded where the two disagree).

| Realm | Rev 33 status | Evidence and mechanism | Gate outcome |
|---|---|---|---|
| F16 srcdoc iframe | **present** (measured) | measurable; `typeof SharedWorker === 'function'`; descriptor present | `shared_worker_present` |
| F17 late-appended iframe | **RESOLVED — MEASURED-PRESENT** | capture script installed **before** frame creation and OBSERVED to run in the frame; live `typeof` = `function`, native constructor present. The rev-32-era caveat ("probe injected inline, capture-versus-live unreliable") is **withdrawn** | `shared_worker_present` |
| F18 back navigation | **UNMEASURABLE** | `pageshow` fired with `persisted:false`; bfcache restoration is **not observed** in headless Chromium under CDP instrumentation (INFERENCE: bfcache disabled there). No bfcache realm was ever created, so nothing is known about a restored document. The harness's non-schema error `bfcache-not-observed` was correctly refused by `decide32` (`record-value-enum:error`) | `shared_worker_block_unverified` — F18 can never contribute to an arm on this build |
| F19 `javascript:` realm | **RESOLVED — MEASURED-PRESENT** | the `javascript:` iframe is enumerable by Playwright (frame URL `about:blank`, script-written marker present); the capture ran in it; `typeof` = `function`. Supersedes the earlier `frame-not-found` / UNMEASURABLE result | `shared_worker_present` |
| F20 `<object>` document | **present** (measured) | measurable; `function` | `shared_worker_present` |
| F21 service worker scope | **RESOLVED — MEASURED-ABSENT (structural)** | `typeof SharedWorker === 'undefined'`. **Mechanism MUST be `serviceworker.probe`.** The harness value `sw.postMessage` is not in the closed schema enum and was refused (`record-value-enum:mechanism`); that was a harness mapping defect, not a gate result | absence is structural per specification and says nothing about the page's capability; composed with synthetic absence in the other 20 realms the pure function arms — that is the **authorised control**, not a result about a real browser |

**Normative consequences.**
1. `serviceworker.probe` is the only schema-valid mechanism for F21; any harness, fixture or checker emitting `sw.postMessage` is non-conforming and must be regenerated.
2. F18 is UNMEASURABLE on the pinned build, so the complete-inventory requirement of `decide32.js` (all 21 canonical ids valid) **cannot be satisfied** there. Under OWNER-24 this is accepted: the **supported-browser set stays empty** and no armed path exists on the pinned Chromium.
3. F16, F17, F19 and F20 are SharedWorker-**present**; none of them adds an armed path.
4. Linux and GitHub-runner coverage of every realm row above is **unmeasured**.

---

## 4. OPEN-BID-27 — browser identity (stays OPEN)

**Status: OPEN. Candidate only.** `docs/phase-18-measb2-open-bid-27-findings.md` carries a coordinator banner: its claim **"Uncovered scenarios: NONE" is NOT supported**, and this revision does not adopt it.

**Candidate combination (CANDIDATE, not a decision):** trusted **hash-pinned launcher wrapper** passed as `executablePath` (records `wrapper_pid`, `start_ns`, per-run `token`, the exec'd `exe` path and the full argv) **⨁ per-run nonce** injected by `addInitScript` and read back **⨁ `browser.on('disconnected')`** liveness **⨁ argv diff against a committed baseline ⨁ sha256 pin of the exec'd binary**.

**Owed measurements — every one of these blocks adoption.**

| ID | Owed measurement | Current state |
|---|---|---|
| BID-M1 | Crash detection (`kill -9`) against the **true browser main pid**, with latency of the `disconnected` event | **NOT MEASURED.** The `ps` parser found `candidates=0` in all 6 reps; the observed `disconnected` corresponds to a graceful `close()`. MEASB-01's kill observation used a `ps`-identified pid, CDP stayed responsive, and `disconnected` did not fire within 2 s — evidence that the pid was likely **not** the true main |
| BID-M2 | Linux / GitHub-runner behaviour of the wrapper (shebang, permissions, sha256-pin workflow, process-tree supervision) | **NOT MEASURED** (macOS, headless only) |
| BID-M3 | Wrapper **trust model**: file ownership, install-directory write access, CI runner tenancy, mode 0555 on CI, SIP interaction | **REQUIREMENT, not a measurement** — explicitly stated as such in the findings |
| BID-M4 | A substitute for `Browser.getCommandLine` | **UNAVAILABLE** in headless Chromium 156 as shipped by Playwright 1.64: `'Browser.getCommandLine' wasn't found` in every rep, every Node, every browser instance. `Browser.getVersion` works; `SystemInfo.getProcessInfo` returns CDP-internal ids, not host pids |
| BID-M5 | A nonce that survives a renderer replacement | The nonce lives in a `window` global and **dies with the renderer**; `sessionStorage` throws `SecurityError` on `about:blank` and `data:` pages (OBSERVED, every rep). A `window`-global nonce cannot by itself detect renderer replacement, and is lost on cross-origin navigation |
| BID-M6 | Lockfile semantics (`SingletonLock`, `DevToolsActivePort`) for a persistent context that stays open | **NOT MEASURED**; both absent at inspection time, likely a lifecycle artefact |
| BID-M7 | Argv-diff completeness against Playwright minor-version flag drift | **INFERENCE only** |

**Normative refusal rule.** Any uncertainty, any unavailable signal, or any unmet wrapper-trust precondition **refuses**: no arm, exit 18, no degraded or best-effort identity mode. This is the direct application of the owner ruling that no identity uncertainty may arm. OPEN-BID-27 remains **undecided**; rev 33 changes none of the `IC8` mapping.

---

## 5. Mandatory implementation gates

Every row must be **DONE with recorded evidence** before any implementation, merge, tag or customer claim. No row may be waived by a document.

| Gate | Requirement | Owner | Current state |
|---|---|---|---|
| MG-1 | Deterministic stack-exhaustion fixture proving an exception raised **inside** `decide` reaches the gate and becomes `decision-exception` | QA | **NOT MET** (FC22g limit, section 1.3) |
| MG-2 | FC19–FC22 added to `docs/architecture/phase-18-rev32-expectations.json` (or a rev 33 successor) and asserted by the W6-T checker; row total 57 | Developer + QA | **NOT MET** (rows live only in findings) |
| MG-3 | Gate module implements capture-once (`require` at load, no re-require, no cache deletion) and captures `Object.hasOwn` at initialization | Developer | **NOT MET** |
| MG-4 | FW-2: one candidate containment mechanism MEASURED on both Nodes, macOS **and** Linux, 3+ reps, and Security-reviewed | DevOps + Security | **NOT MET** — rule 2.2.1 therefore applies |
| MG-5 | `worker_websocket_containment_unverified` present in the reason set, precedence placement implemented, and exit 18 asserted directly by a test | Developer + QA | **NOT MET** |
| MG-6 | F21 emits `serviceworker.probe`; no fixture or harness emits `sw.postMessage` | Developer | **NOT MET** |
| MG-7 | OPEN-BID-27: BID-M1 … BID-M7 all measured and Security-reviewed | Security + DevOps | **NOT MET**; OPEN |
| MG-8 | Security review of rev 33 itself (m-99 boundary, FW-2 rule, realm resolution, OPEN-BID-27 wording) | Security | **NOT STARTED** |
| MG-9 | Linux / GitHub-runner coverage of every realm row and FW-1/FW-2 row | DevOps | **NOT MET** |
| MG-10 | CodeQL, code scanning and secret scanning green on the implementing branch | DevOps | **NOT STARTED** |

---

## 6. Delta versus rev 32

Against `docs/architecture/phase-18-rev32-patch.md`:

1. **Added** the m-99 decision boundary as a normative requirement with a verbatim reference gate (`scratchpad/conf07/gate32.js`): all exceptions → `decision-exception`, all malformed results → `decision-result-malformed`, both `shared_worker_block_unverified` exit 18; capture-once is a consumer requirement. Rev 32 had no boundary at all; CONF-08 (`docs/phase-18-conf08-stress-results.md`) only *recommended* one.
2. **Added** rows FC19, FC20/FC20b, FC21 (from `docs/phase-18-conf08-stress-results.md`) and FC22 (from `scratchpad/conf07/gate-test.js`) with counts and expected outcomes; row total 53 → **57**. Sweep totals from rev 32 item 6 are otherwise unchanged.
3. **Added** FW-2 as a new, independent pre-arming refusal with reason code `worker_websocket_containment_unverified` and a defined position inside exit 18. Source: `docs/phase-18-measa2-f17-f21-fw1-findings.md`, `docs/phase-18-measa-f16-f21-fw1-findings.md`. Rev 32 contained no worker-WebSocket rule.
4. **Changed realm statuses:** F17 caveat withdrawn → MEASURED-PRESENT; F19 `frame-not-found`/UNMEASURABLE → MEASURED-PRESENT; F18 → UNMEASURABLE (bfcache not observed); F21 mechanism fixed to `serviceworker.probe`. Supersedes the F17/F18/F19/F21 rows carried from `docs/phase-18-measa-f16-f21-fw1-findings.md`.
5. **Recorded** the OPEN-BID-27 candidate combination with seven owed measurements and an explicit refusal rule; `docs/phase-18-measb2-open-bid-27-findings.md`'s "Uncovered scenarios: NONE" is **rejected** per its own coordinator banner. Status unchanged: OPEN.
6. **Added** the mandatory-implementation-gates table (section 5); all ten rows are currently unmet.
7. **Unchanged:** `decide32.js` and its sha256; the m-96 intrinsic-capture design; the process-integrity boundary; exit precedence; the empty supported-browser set; `m-96` CLOSED and `m-98` fixed per `docs/security/phase-18-design-review-26.md`.

---

## 7. What remains unmeasured (honest list)

- Stack exhaustion **inside** `decide`, deterministically (MG-1).
- Any FW-2 containment mechanism — all four candidates are UNMEASURED.
- Shared-worker and service-worker sockets, `WebTransport`, `EventSource`, worker `fetch` containment.
- Linux and GitHub-runner behaviour for every realm row, FW-1, FW-2 and the OPEN-BID-27 wrapper.
- Headed (non-headless) launches; bfcache on any build where it is actually observable.
- Crash detection against the true browser main pid; wrapper trust model; renderer-surviving nonce; lockfile semantics; argv-diff completeness.
- Any real armed path on a real browser without SharedWorker. The supported-browser set is **empty** and stays empty.
- Code loaded **after** the decision module that patches whatever reads the verdict or the require cache (noted as not done in `docs/security/phase-18-design-review-26.md`).

---

## ADR-0053 — Exceptions and malformed results at the decision boundary refuse

*Status:* Proposed (design only; blocked on MG-8).
*Context:* `decide` is total over well-formed input but has no `try`/`catch`; CONF-08 OBSERVED one `RangeError` escaping under stack pressure, and a compromised or wrapped decision function could return a shape that is not one of the three contracted verdicts.
*Decision:* No product code calls `decide` directly. A gate boundary wraps it; any exception becomes `detail: 'decision-exception'` and any non-conforming result becomes `detail: 'decision-result-malformed'`, both `shared_worker_block_unverified` / exit 18. The caught value is never read. The gate may only convert an arm into a refusal. The consumer captures `decide` once at load.
*Consequences:* One extra frame on the decision path and two new detail strings; no new exit code; the refusal direction is provably one-way. Residual: stack exhaustion inside `decide` is not yet deterministically reproducible, so the conversion claim is bounded by MG-1.
*Alternatives rejected:* adding `try`/`catch` inside `decide` (re-introduces caller-reachable surface into the audited m-96 module and changes its sha256); accepting m-99 as residual (an escaping `RangeError` would surface as an unhandled rejection or a non-18 exit code, breaking the CI contract); trusting the returned shape (a lying `armed: true` would arm).

## ADR-0054 — Uncontained worker WebSocket traffic refuses to arm

*Status:* Proposed (design only; blocked on MG-4 and MG-8).
*Context:* MEASURED: page WebSockets are contained by `routeWebSocket`; dedicated, blob and nested worker WebSockets are **not** (9 of 9 opened, 0 route-handler invocations). The owner requires containment or a fail-closed refusal, and forbids excluding this traffic from the security claims.
*Decision:* Execute mode does not arm while worker WebSocket containment is unmeasured or fails at runtime; reason `worker_websocket_containment_unverified`, exit 18, evaluated before the SharedWorker realm decision. No bypass exists.
*Consequences:* Execute mode is unavailable until a mechanism is measured and Security-reviewed; CI must accept this exit-18 reason as expected, not a flake. The security claims now state the gap instead of omitting it.
*Alternatives rejected:* excluding worker WebSockets from the claim (violates the owner ruling); shipping a CSP `connect-src` mechanism as if proven (no measurement exists); best-effort observation with a warning (no acknowledgement or warning mode is permitted).

---

## Handoff constraints

- **Developer:** implement nothing until MG-8 clears. The gate, the capture-once rule, the FW-2 reason code and precedence placement, and the `serviceworker.probe` mechanism string are the only interface changes this revision authorises.
- **QA:** rows FC19–FC22 with the counts in section 1.3, direct exit-code assertions for exit 18 and both new reason codes, and MG-1.
- **Security:** review the m-99 boundary (including the two stated gaps in section 1.2), the FW-2 rule and claim wording, and the OPEN-BID-27 refusal rule.
- **DevOps:** Linux / GitHub-runner coverage (MG-9), FW-2 measurement environment (MG-4), CodeQL and scanning gates (MG-10). No uncontrolled third-party site in CI; GoogleSearchTest stays local.
