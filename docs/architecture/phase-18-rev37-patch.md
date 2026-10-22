# Phase 18 rev 37 — SEC-32 closed in the DESIGN: measured positive controls, the no-sandbox correction, challenge-response, a SUPERVISOR exit-code mechanism (m-108) and a no-literal gate (m-109)

Narrow addendum on rev 36 (`52e3c94`), rev 35 (`cd9f843`), rev 34 (`0418106`) and rev 33 (`183e341`). **Docs-only. No implementation, no merge, no tag, no release, no customer claim is authorised by this document.**

Reviewed-against: Security **SEC-32** (`docs/security/phase-18-design-review-31.md`): majors m-110..m-113, minors m-114/m-115, plus prior **m-108 NOT CLOSED** and **m-109 PARTIAL**. Measurement inputs: `docs/phase-18-netw02-hardened-isolation-findings.md` (NETW-02, a coordinator reading of raw results, including the coordinator's sandbox correction), `docs/phase-18-netw01-isolated-proxy-findings.md` (NETW-01), `docs/phase-18-conf11-gate-supervisor-results.md` (CONF-11).

It **supersedes**: rev 36 sections 1.1 (sandbox status and positive-control wording), 1.3 items C6-O1/C6-O6, 3 (the in-process layer-2 claim), 4 (the literal check), 5 (gates table), 6 and 7. Everything else in rev 33/34/35/36 stands. `decide32.js` unchanged (sha256 `e197ec58…b898b3a522`). New reference texts: `gate37.js` (sha256 `6c6d888ae0fca2fe865fba1907e1c7235838ef34e788fb84b434f8486469a5ae`) replacing `gate34.js`, and `supervisor37.js` (sha256 `dd87998e8241c1077f789649334789bafb5bf3d616873b9d75b3553f95b9bb94`), both reproduced verbatim below.

Owner rulings in force, carried unchanged: **OWNER-24** strict same-process browser posture with the **empty supported-browser set accepted**; **no identity uncertainty may arm**; **worker WebSocket traffic must be contained or must cause a fail-closed refusal and is NOT excluded from the security claims**; **CSP-through-routing (FW2-C1) is REJECTED**; **no other FW-2 mechanism may be attempted without owner review**; no implementation, no merge.

Wording discipline: **OBSERVED** = measured on the stated environment with the stated runs; **INFERENCE** = reasoning from observations, not independently proven; **REQUIREMENT / RECOMMENDATION** = normative design text, not a measurement. Nothing here converts a REQUIREMENT into evidence. Paths beginning `scratchpad/` name coordinator-machine evidence (not tracked); normative text they contain is reproduced here.

---

## 1. m-110 — positive controls are now measured for every worker type; the remaining gaps stay named

**OBSERVED (NETW-02, same arm64 Docker Desktop topology as NETW-01, Node 22 and Node 24, 3 reps per case, `--no-sandbox` throughout — see section 2):**

- For **dedicated, nested, blob and module worker `ws`, page `ws`, page `wss` and dedicated worker `wss`**: the allowed destination **OPENED** and the denied destination **ERRORED**, 3 of 3 in every run. The allowed fixture counted **47 `ws_upgrade` and 18 `tls_ws_upgrade`**, so those workers demonstrably started and reached the allowed fixture through the proxy. This retires the FW2-C1 failure mode for these channels: a silently dead worker can no longer read as containment.
- The denied fixture now has a **TLS listener**, and its TLS counter was **proven capable**: deliberate control requests from outside the isolated network raised `tls_http` to 2, while the browser's denied `wss`/`https` attempts left `tls_ws_upgrade = 0`. Rev 36's `tls_*=0` is therefore now evidence rather than a null result.
- `data:` worker: construction returned "alive" 3 of 3; **a WebSocket from a `data:` worker was NOT measured.**
- Escapes: **none**; the `escapes` list is empty in all three result files.

**Still UNMEASURED and owed (REQUIREMENT, explicitly not closed by NETW-02):** whether the **production** proxy pins resolved IPs; **DNS rebinding**; **redirect-to-denied** (the harness logged an attempt and stored no result); **mid-session proxy kill during open WebSockets**; **allowlist swap mid-run**. Rev 36 C6-O4 and C6-O6 stay OPEN unchanged.

**REQUIREMENT (test proxy vs production proxy, carried and sharpened).** Every containment statement must name which proxy produced it. The bypass battery of NETW-01/NETW-02 ran against a **187-line test proxy**, not against a production proxy; a test-proxy result may never be quoted as a production-proxy property, and C6-O7 (allowlist provenance, pinning, audit) remains unmeasured.

---

## 2. m-111 — every NETW measurement ran `--no-sandbox`; the sandbox posture needs a measurement or an owner decision

**OBSERVED (coordinator correction in the NETW-02 findings).** The runner never set `chromiumSandbox: true`, and `playwright-core` adds `--no-sandbox` unless that option is `true`. Therefore **every NETW-01 and NETW-02 measurement ran with `--no-sandbox`**, including the run the measuring agent labelled "sandboxed" (uid 1001). Rev 36 section 1.1 did not say so and the NETW-01 findings still do not; both are corrected here. This was a violation of rev 36's own rule 2.2.4 (sandbox status must be stated) and the rule stands.

**OBSERVED (direct coordinator probe, same image):** default seccomp with `--user pwuser` (uid 1001) → launch FAILS ("Chromium sandboxing failed!"); default seccomp as root → FAILS; `--user pwuser --security-opt seccomp=unconfined` → launches, **no** `--no-sandbox` in argv; `--user pwuser --cap-add SYS_ADMIN` → launches, no `--no-sandbox`. A **narrower custom seccomp profile was NOT tested.**

**INFERENCE (not OBSERVED).** A genuinely sandboxed non-root Chromium in this image requires a **relaxed container profile**, which trades Chromium's internal sandbox against the container's own confinement. Which trade is acceptable is a security posture question, not a measurement.

**REQUIREMENTS added:**

1. **2.2.4 extended to every claim, not only wrapper claims.** Any containment, identity or FW-2 claim must carry the sandbox status of the run that produced it. A `--no-sandbox` result may never be quoted as a sandboxed result. Documents that omit it are defective and must be corrected, not re-labelled.
2. **MG-17 (new).** Either a **custom seccomp profile measurement** (narrow enough that Security accepts it, with the isolated-network topology re-measured under a genuinely sandboxed browser, both Nodes, 3+ reps) **or an explicit owner decision recording the accepted sandbox posture** (e.g. "`--no-sandbox` inside an `--internal` network is accepted, with the reasoning recorded"). Until one exists, FW2-C6's containment evidence is **no-sandbox-only** and may not be generalised.
3. **The supported-browser set stays EMPTY** under OWNER-24. Nothing in section 1 or 2 changes it, and no sandbox result can change it without owner review.

---

## 3. m-112 — C6-O1 `proxy.identity` becomes challenge-response with a key absent from the browser container

**OBSERVED (NETW-02, 3 of 3 reps).** Challenge-response with the key held **outside** the browser container: the correct response was accepted; **replay was refused (403)**; a missing response was refused (403); an empty nonce was refused (400). A challenge attempted *from* the isolated runner was refused (403).

**REQUIREMENT (supersedes rev 36 C6-O1 rows `proxy.identity` and `proxy.liveness`).** The "per-run token echoed by the proxy" is withdrawn as replayable. Arming requires challenge-response where the verifying key is **never present in the browser container**:

| Element | Requirement | State |
|---|---|---|
| Nonce | **Fresh, unpredictable nonce per verification, including at every pilot step** — never a per-run constant | design only, UNMEASURED |
| Key custody | The signing/verifying key lives outside the browser container; the container holds no material that can produce a valid response | replay refusal OBSERVED; custody design UNMEASURED |
| Verifier identity | **Who holds the verifier must be named** (proxy process? supervisor? environment owner?) and the answer must survive a compromised browser container | **OPEN — unassigned** |
| Failure | Any miss, replay, malformed or late response ⇒ refuse mid-run, fail-closed | REQUIREMENT |

Remaining design work is explicitly owed: nonce source and freshness proof, key provisioning and rotation, and the trust relationship between verifier and supervisor (section 6).

---

## 4. m-113 — verified-then-changed detection is **UNMEASURED** and owed

**OBSERVED (NETW-02).** The change-detection script reached `WAITING_FOR_CHANGE` and **recorded nothing further**. The image has **no `ip` and no route command** (results came back `no-route-cmd` / `no-ip-cmd`), so **no route-table or interface snapshot was obtained**. The browser proxy read-back and the must-fail canaries (denied TCP, external TCP, Docker gateway → `EAI_AGAIN`, `ENETUNREACH`) were confirmed **once, at arm time**.

**Status: MEASURED? NO. m-113 is answered in DESIGN only and is marked UNMEASURED and owed.** The attack it describes — an environment verified at arm time and changed afterwards — is undetected today.

**REQUIREMENT (replaces rev 36's per-step proxy-liveness-only check).** At **every pilot step**, Falcon must re-verify and re-hash: (a) the **route table and resolver list**; (b) the **interface list and reachable-peer set**; (c) the **must-fail canaries**; (d) **Chromium's effective proxy config read back from the browser**, not the flags Falcon passed; (e) the challenge-response of section 3. Any divergence from the pinned record ⇒ refuse mid-run.

**REQUIREMENT (canary unpredictability).** The canary list must be **randomised per step from a large space and unpredictable to the environment**, so an attacker cannot selectively allow exactly the canaries while opening everything else. A fixed canary list is insufficient (SEC-32).

**REQUIREMENT (tool availability).** The snapshot may not depend on `ip` or `route`, which the pinned image lacks. It must read **`/proc/net/route`, `/proc/net/ipv6_route`, `/proc/net/dev`, `/proc/net/tcp`, `/etc/resolv.conf`** (or an equivalent that is proven present in the pinned image), and the presence of every source must itself be a pass condition — a missing source is a refusal, not a skip.

---

## 5. m-114 / m-115 — resolved-IP pinning required; the status port is measured unreachable

- **m-114 (REQUIREMENT, unmeasured).** The proxy allowlist must pin **resolved IPs**, not hostnames alone: resolve once, pin the resulting address set, and re-check the connected peer address against the pin before forwarding, so that a re-resolution (DNS rebinding) cannot move an allowed name onto a new address. Wildcard and apex entries may not broaden the pinned set. **DNS rebinding is UNMEASURED** and whether the production-style proxy pins resolved IPs **is not shown** (NETW-02).
- **m-115 (OBSERVED, closed as measured).** The proxy **status port was unreachable from the isolated runner** in all NETW-02 runs, and a challenge attempted from the runner was refused (403). **REQUIREMENT:** the status/control surface must stay off the isolated network, and its unreachability must be one of the must-fail canaries of section 4.

---

## 6. m-108 — the load-bearing exit-code mechanism becomes a SUPERVISOR parent process (supersedes rev 36 section 3)

**Why the in-process claim is withdrawn.** **OBSERVED (SEC-32, Node 22):** patching `process.reallyExit`, an `'exit'` listener that sets `exitCode = 0`, and patched `listeners`/`listenerCount` each **pass all four** per-call integrity checks of rev 36 section 3 and still exit **0**. An in-process mapper cannot be made load-bearing by adding checks inside the same process, because the checks read state the same process can forge. Rev 36's layer-2 claim is **superseded**, not patched.

**Design (REQUIREMENT).** The exit code CI observes is decided by a **separate, minimal parent process**. The child (pilot) writes **exactly one canonical verdict line** on an inherited pipe (**fd 3**). The parent maps: one well-formed verdict line **and** a normally-ended child with a consistent status ⇒ that verdict; **anything else** (no verdict, malformed, two lines, extra key, signal, arm with non-zero child status) ⇒ **exit 18**. **Layer 1 (the try/catch at the call site mapping to the frozen canonical refusal) stays unchanged.** The in-process mapper may remain as a convenience, but **no claim rests on it**.

**Process-integrity boundary (stated, not hidden).** A child that can execute code and write fd 3 can **forge a verdict**. That is the boundary; the supervisor does not and cannot close it. **REQUIREMENT:** the supervisor must be a **separate, minimal module carrying no product code**, loaded without the product's require graph, so that compromising the product does not compromise the exit-code decision.

**OBSERVED (CONF-11, macOS arm64, Node 22.19.0 and 24.21.0, 3 reps per child):** all 17 refusal/bypass children exit **18 in every repetition**; the authorised arm child exits **0**; **zero wrong exit-0 results**. Linux and CI are **UNMEASURED**; no product consumer exists.

### 6.1 Reference supervisor text (verbatim `supervisor37.js`, sha256 `dd87998e…95b9bb94`)

```js
'use strict';
// Reference supervisor (rev 37, m-108): the exit code seen by CI is decided by a SEPARATE parent process.
// The child (pilot process) reports ONE canonical verdict line on an inherited pipe (fd 3). The parent maps:
//   exactly one well-formed canonical verdict line AND child ended normally with a consistent status  -> that verdict
//   anything else (no verdict, malformed, two lines, signal, status inconsistent with the verdict)     -> exit 18
// No in-child hook (listeners, capture callbacks, patched process.exit/reallyExit, exit-listener exitCode
// writes) can turn a missing verdict into a success; forging the verdict requires code execution inside the
// child that can write fd 3, which is the process-integrity boundary.
const { spawnSync } = require('node:child_process');
const REFUSAL_EXIT = 18;
function parseVerdictLine(text) {
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length !== 1) return null;
  let v;
  try { v = JSON.parse(lines[0]); } catch (e) { return null; }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (v.armed === true) {
    return keys.length === 3 && v.exit === 0 && v.reason === 'shared_worker_absent_all_realms' ? { armed: true, exit: 0 } : null;
  }
  if (v.armed === false) {
    const okReason = v.reason === 'shared_worker_block_unverified' || v.reason === 'shared_worker_present' || v.reason === 'worker_websocket_containment_unverified';
    return keys.length === 4 && v.exit === 18 && okReason && typeof v.detail === 'string' && v.detail.length <= 256 ? { armed: false, exit: 18 } : null;
  }
  return null;
}
function supervise(childArgs, opts) {
  const r = spawnSync(process.execPath, childArgs, { stdio: ['ignore', 'pipe', 'pipe', 'pipe'], timeout: (opts && opts.timeoutMs) || 20000, maxBuffer: 1 << 20 });
  const out = r.output && r.output[3] ? r.output[3].toString('utf8') : '';
  const verdict = parseVerdictLine(out);
  if (r.error || r.signal !== null || verdict === null) return { exit: REFUSAL_EXIT, why: r.error ? 'spawn-error' : r.signal ? 'child-signal' : 'no-valid-verdict', childStatus: r.status };
  if (verdict.armed === true) return r.status === 0 ? { exit: 0, why: 'verdict-arm', childStatus: r.status } : { exit: REFUSAL_EXIT, why: 'arm-with-nonzero-child-status', childStatus: r.status };
  return { exit: REFUSAL_EXIT, why: 'verdict-refusal', childStatus: r.status };
}
module.exports = Object.freeze({ supervise: supervise, parseVerdictLine: parseVerdictLine });
```

### 6.2 Child test cases as rows SV1..SV18 (verbatim bodies from `supervisor-test.js`, sha256 `42e2c67f4699f2d86b344bae18094ffaf0048cca2b96352181fcf265388bf92a`)

| Row | Child | Simulated bypass | Required supervisor exit | Observed (3 reps x 2 Nodes) |
|---|---|---|---|---|
| SV1 | `bypass-listener-exits-0` | `uncaughtException` listener calls `process.exit(0)` | 18 | 18 |
| SV2 | `bypass-prepend-listener` | `prependListener` added after install, exits 0 | 18 | 18 |
| SV3 | `bypass-capture-callback` | `setUncaughtExceptionCaptureCallback` sets `exitCode = 0` | 18 | 18 |
| SV4 | `bypass-process-exit-noop` | `process.exit` patched to a no-op, then `exitCode = 0` | 18 | 18 |
| SV5 | `bypass-reallyExit-patch` | `process.reallyExit` patched to set `exitCode = 0` | 18 | 18 |
| SV6 | `bypass-exit-listener-sets-0` | `'exit'` listener sets `exitCode = 0` | 18 | 18 |
| SV7 | `bypass-patched-listeners` | `listeners`/`listenerCount` patched to defeat the integrity checks | 18 | 18 |
| SV8 | `bypass-removeAllListeners` | mapper removed, default exit 1 | 18 | 18 |
| SV9 | `bypass-throw-in-mapper` | throw inside the mapper (exit 7 in-process) | 18 | 18 |
| SV10 | `bypass-unhandled-rejection-exit0` | `unhandledRejection` listener exits 0 | 18 | 18 |
| SV11 | `bypass-clean-exit-no-verdict` | silent `process.exit(0)`, no verdict written | 18 | 18 |
| SV12 | `bypass-silent-exit-0-after-work` | deferred exit 0 after work, no verdict | 18 | 18 |
| SV13 | `malformed-verdict-two-lines` | two arm verdict lines on fd 3, exit 0 | 18 | 18 |
| SV14 | `malformed-verdict-extra-key` | arm verdict with an extra key, exit 0 | 18 | 18 |
| SV15 | `arm-but-child-status-1` | valid arm verdict with child status 1 | 18 | 18 |
| SV16 | `killed-by-signal` | child SIGKILLs itself | 18 | 18 |
| SV17 | `LEGIT-refusal` | canonical refusal verdict, child exit 18 | 18 | 18 |
| SV18 | `LEGIT-authorised-arm` | canonical arm verdict, child exit 0 | **0** | 0 |

**REQUIREMENT.** SV1..SV18 are the acceptance rows for MG-12; **all bypass children must exit 18 and only SV18 may exit 0**. Rows TL1..TL10 of rev 36 are retained as layer-1 rows only and no longer carry the exit-code claim. Owed: the same battery on **Linux and in CI** (UNMEASURED), plus a forged-fd-3 row documented as **out of scope by boundary**, not as a pass.

---

## 7. m-109 — the literal check is replaced by the `gate37.js` design (supersedes rev 36 section 4)

**Why the rev 36 check is withdrawn.** **OBSERVED (SEC-32):** a blocking scan for `contained-for-test` is defeated by **building the string at run time**; it is acceptable only together with MG-13, and MG-13 must refuse dynamic requires. Rev 36 relied on an exemption keyed to `gate34.js`'s digest, i.e. on the literal existing in production at all.

**Design (REQUIREMENT).** **There is no test literal in production.** The contained state is a **private frozen object identity** (`FW2_CONTAINED`) known only inside the gate module and never exported by the production surface, so no string, flag, environment variable or caller value can equal it. The production export stays the single frozen key `gateDecide`. Tests reach the private factory only through a **recompiling test loader** that re-emits the same source text with the final export line replaced, exporting `createGate` and the token for tests only; the generated artifact lives under the test tree. No exemption list is needed, and the digest-keyed exemption of rev 36 is removed.

**CI checks (defence in depth, REQUIREMENT):**

1. **Export-surface assertion** — the production module exports exactly `{ gateDecide }`, frozen; `createGate` and `FW2_CONTAINED` are absent from it.
2. **Package contents** — `npm pack --dry-run` contains no generated loader and no test-tree module; the generated artifact may exist only under the test tree.
3. **Zero-exemption literal scan** — a blocking scan for any contained-state test literal outside the test tree, with **no exemptions at all** (it must now pass trivially, since production holds no such literal). It is defence in depth, not the primary control.
4. **MG-13 refuses dynamic requires** — the production-entry-point reachability checker must **fail on any dynamic/computed `require`** in the production graph, since a runtime-built specifier defeats both the scan and the graph walk.
5. **MG-11 still cannot close without MG-13.** Renaming and runtime string construction defeat path- and name-based reasoning, so test-factory exclusion is credible only together with the reachability checker. **MG-11 and MG-13 close together or not at all.**

**OBSERVED (CONF-11, macOS arm64, Node 22.19.0 and 24.21.0):** against `gate37.js`, **11 of 11** FC22 gate rows pass on both Nodes (FC22a export surface; FC22b every input refused with `worker_websocket_containment_unverified` / `fw2:unmeasured` / exit 18; FC22c evidence-only arity; FC22d pass-through by value; FC22e 13 injected throws with **0** hostile member runs; FC22f 25 stack exhaustions; FC22g post-`decide` throw; FC22h 29 malformed results with **0** trap/accessor runs; FC22i reason preservation and supplied object never returned; FC22j arm rebuilt; FC22k documented scope — a lying well-formed arm from a compromised `decide` is accepted). The built-in patching sweep (784 properties singly and together, plus 125 inherited accessors) shows **0 caller executions and 0 decision changes** on both Nodes. FC19–FC21 pass through the gate.

### 7.1 Reference gate text (verbatim `gate37.js`, sha256 `6c6d888a…6469a5ae`)

```js
'use strict';
// gate37.js - Phase 18 decision boundary, architecture revision 37 (m-99, M-1, m-100..m-102, m-109).
//
// The production gate takes EVIDENCE only (the per-realm array), invokes the decision function
// it captured at load, and never accepts a caller-supplied decision result. Every intrinsic it
// needs is captured once at initialization; afterwards it uses only those values, operators and
// own data properties of objects it created or of fresh descriptor objects. It never inspects a
// thrown value and never returns an object it was handed: it rebuilds and freezes a canonical result.
//
// FW-2 (worker WebSocket containment) is a pre-arming precondition evaluated FIRST, inside this
// boundary. While its state is the production constant 'unmeasured' the gate refuses every input
// with reason worker_websocket_containment_unverified, detail fw2:unmeasured, exit 18.
//
// PROCESS-INTEGRITY BOUNDARY: code that runs in this process before this module finishes
// initializing can replace what is captured here, including the captured decision function. That is
// outside this module's guarantee. The gate does not and cannot verify that an arm is semantically
// true; it guarantees that nothing but a well-formed canonical verdict, rebuilt here, leaves it.

const { types } = require('node:util');
const { decide: CAPTURED_DECIDE } = require('./decide32.js');

const isProxy = types.isProxy;
const ObjectFreeze = Object.freeze;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectHasOwn = Object.hasOwn;
const ObjectPrototype = Object.prototype;
const ReflectOwnKeys = Reflect.ownKeys;

const MAX_DETAIL_LENGTH = 256;
const ARM_KEYS = ObjectFreeze(['armed', 'exit', 'reason']);
const REFUSAL_KEYS = ObjectFreeze(['armed', 'exit', 'reason', 'detail']);
const REFUSAL_REASONS = ObjectFreeze([
  'shared_worker_block_unverified', 'shared_worker_present', 'worker_websocket_containment_unverified'
]);
const FW2_PRODUCTION_STATE = 'unmeasured';
// Private identity token for the 'contained' state. It is an object known only inside this module and is never
// exported by the production surface, so no string, flag or caller value can equal it (m-109: there is no test literal).
const FW2_CONTAINED = ObjectFreeze({});

function listHas(list, x) {
  for (let i = 0; i < list.length; i += 1) { if (list[i] === x) return true; }
  return false;
}
function refusal(reason, detail) {
  return ObjectFreeze({ armed: false, exit: 18, reason: reason, detail: detail });
}
function arm() {
  return ObjectFreeze({ armed: true, exit: 0, reason: 'shared_worker_absent_all_realms' });
}
// Reads a candidate result WITHOUT running caller code and returns a canonical rebuilt verdict,
// or null. Proxy check first; exact own enumerable string-key set; plain prototype; data
// properties only; no symbols, accessors or extra keys.
function canonicalize(r) {
  if (isProxy(r)) return null;
  if (r === null || typeof r !== 'object') return null;
  if (ObjectGetPrototypeOf(r) !== ObjectPrototype) return null;
  const keys = ReflectOwnKeys(r);
  const n = keys.length;
  if (n !== 3 && n !== 4) return null;
  const expected = n === 3 ? ARM_KEYS : REFUSAL_KEYS;
  for (let i = 0; i < n; i += 1) {
    if (typeof keys[i] !== 'string' || !listHas(expected, keys[i])) return null;
  }
  const vals = [undefined, undefined, undefined, undefined];   // own slots: no inherited index setter can run
  for (let i = 0; i < expected.length; i += 1) {
    const d = ObjectGetOwnPropertyDescriptor(r, expected[i]);
    if (d === undefined || ObjectGetPrototypeOf(d) !== ObjectPrototype) return null;
    if (!ObjectHasOwn(d, 'value') || ObjectHasOwn(d, 'get') || ObjectHasOwn(d, 'set')) return null;
    if (d.enumerable !== true) return null;
    vals[i] = d.value;
  }
  const armed = vals[0], exit = vals[1], reason = vals[2];
  if (n === 3) {
    return armed === true && exit === 0 && reason === 'shared_worker_absent_all_realms' ? arm() : null;
  }
  const detail = vals[3];
  if (armed !== false || exit !== 18 || !listHas(REFUSAL_REASONS, reason)) return null;
  if (typeof detail !== 'string' || detail.length > MAX_DETAIL_LENGTH) return null;
  return refusal(reason, detail);
}
// Private factory. The production export calls it with the captured decision function and the
// production FW-2 state. Tests reach it only through a recompiling test loader.
function createGate(decideFn, fw2State) {
  return function gateDecide(perRealm) {
    if (fw2State !== FW2_CONTAINED) {
      return refusal('worker_websocket_containment_unverified', 'fw2:unmeasured');
    }
    let r;
    try { r = decideFn(perRealm); } catch (e) {            // the caught value is never read
      return refusal('shared_worker_block_unverified', 'decision-exception');
    }
    try {
      const c = canonicalize(r);
      return c !== null ? c : refusal('shared_worker_block_unverified', 'decision-result-malformed');
    } catch (e) {
      return refusal('shared_worker_block_unverified', 'decision-exception');
    }
  };
}

// LAST STATEMENT: the frozen production surface, exactly one function, evidence in, verdict out.
module.exports = ObjectFreeze({ gateDecide: createGate(CAPTURED_DECIDE, FW2_PRODUCTION_STATE) });
```

**Gate behaviour is UNCHANGED in effect:** while the FW-2 state is the production constant, every input is refused with `worker_websocket_containment_unverified`, detail `fw2:unmeasured`, exit 18. No flag, environment variable, allowlist, acknowledgement or warning mode may bypass it. `gate37.js` replaces `gate34.js` as the **reference text only**; no production code changes until MG-8 clears and the owner authorises.

---

## 8. Mandatory implementation gates (refreshed; supersedes the rev 36 table)

| Gate | Requirement | Owner | State at rev 37 |
|---|---|---|---|
| MG-1 | Deterministic stack-exhaustion fixture proving an exception inside the real `decide` becomes `decision-exception` | QA | **PARTIAL** (FC22f exhausts inside the decision call, 25 runs, both Nodes; the real-`decide` fixture is still owed) |
| MG-2 | FC19–FC22 asserted by the W6-T checker; row total 57 | Developer + QA | **NOT MET** |
| MG-3 | Capture-once of all intrinsics at initialization | Developer | **NOT MET** (design closed; `gate37.js` captures at load) |
| MG-4 | FW-2: one candidate MEASURED on both Nodes, macOS **and** Linux, 3+ reps, Security-reviewed | DevOps + Security | **NOT MET — OPEN.** FW2-C6 now has measured positive controls for 7 channels and a proven-capable TLS counter, all `--no-sandbox`; owes C6-O1..C6-O7 |
| MG-5 | `worker_websocket_containment_unverified`, FW-2-first precedence, exit 18 asserted directly | Developer + QA | **NOT MET** |
| MG-6 | F21 emits `serviceworker.probe`; no `sw.postMessage`; F19 in-realm `location.href` | Developer | **NOT MET** |
| MG-7 | OPEN-BID-27: BID-M1..M9 measured and Security-reviewed | Security + DevOps | **NOT MET; OPEN.** M9 (sandbox) still not measured; swap-restore TOCTOU open |
| MG-8 | Security review of **this** rev 37 document | Security | **NOT STARTED** |
| MG-9 | Linux / GitHub-runner coverage of every realm row, FW-1, FW-2, the caller, the wrapper **and SV1..SV18** | DevOps | **PARTIAL — OPEN.** arm64 Docker Desktop only; supervisor measured on macOS only |
| MG-10 | CodeQL, code scanning and secret scanning green on the implementing branch | DevOps | **NOT STARTED** |
| MG-11 | Test-factory exclusion: section 7 checks 1–4 implemented | DevOps + Developer | **NOT MET — OPEN; cannot close without MG-13** |
| MG-12 | **Supervisor parent process plus layer-1 try/catch, with rows SV1..SV18 green on both Nodes and in CI** | Developer + QA | **NOT MET — OPEN.** macOS 18/18 OBSERVED; Linux/CI unmeasured; no product consumer |
| MG-13 | Production-entry-point reachability checker (requires-graph walk) **that refuses dynamic requires** | DevOps | **NOT MET — OPEN** |
| MG-14 | A real armed path on a real browser without SharedWorker | Owner + DevOps | **NOT MET — OPEN.** Supported-browser set is empty and stays empty |
| MG-15 | FW2-C6 runtime verification record (C6-O1) implemented and measured, incl. a failing positive control forcing a refusal, **the per-step re-verification and randomised canaries of section 4**, and **the section 3 challenge-response** | DevOps + Security | **NOT MET — OPEN** |
| MG-16 | Trusted pre-launch wrapper measurement (sealed memfd / IMA / fs-verity) closing swap-restore TOCTOU | Security + DevOps | **NOT MET — OPEN** |
| **MG-17** (new) | **Sandbox posture: a custom seccomp profile measurement with the topology re-measured under a genuinely sandboxed browser, OR a recorded owner decision accepting the `--no-sandbox` posture** | Owner + DevOps + Security | **NOT MET — OPEN** |

---

## 9. Delta versus rev 36

1. **m-110 answered with measurement:** allowed-OPENED / denied-ERRORED positive controls now exist for dedicated, nested, blob and module worker `ws`, page `ws`/`wss` and dedicated worker `wss` (3/3, 47 `ws_upgrade` + 18 `tls_ws_upgrade` at the allowed fixture), and the denied TLS counter is proven capable. Production-proxy pinning, rebinding, redirect, mid-session kill and allowlist swap remain **UNMEASURED**; the test-proxy vs production-proxy distinction is explicit.
2. **m-111 answered as a correction:** **all** NETW-01/NETW-02 runs were `--no-sandbox`, including the mislabelled "sandboxed" run; a sandboxed non-root launch needs `seccomp=unconfined` or `SYS_ADMIN`; **MG-17** requires a custom-profile measurement or an owner decision; every claim must carry its sandbox status; the supported-browser set stays empty.
3. **m-112 answered:** the echoed per-run token is withdrawn in favour of challenge-response with an out-of-container key (replay refused 3/3 OBSERVED); per-step fresh nonce, key custody and verifier ownership remain owed.
4. **m-113 answered in DESIGN only and marked UNMEASURED:** per-step re-verification of route table, resolver, canaries and browser proxy read-back; randomised unpredictable canaries; `/proc/net` sources because the image lacks `ip`/`route`.
5. **m-114/m-115:** resolved-IP pinning is now a REQUIREMENT (rebinding unmeasured); the status port is **OBSERVED unreachable** from the isolated runner and becomes a canary.
6. **m-108 superseded, not patched:** the in-process layer-2 claim is withdrawn (three bypasses pass all four checks and still exit 0); the load-bearing mechanism is a **separate minimal supervisor parent** with verbatim `supervisor37.js` and rows **SV1..SV18** (17 bypass children 18/18, authorised arm 0); layer 1 stays; forging fd 3 is stated as the process-integrity boundary.
7. **m-109 superseded:** no test literal in production — a **private object identity** with a recompiling test loader (verbatim `gate37.js`, 11/11 FC22 rows, 784-property sweep clean on both Nodes); CI keeps export-surface, package-contents and a **zero-exemption** scan as defence in depth; MG-13 must refuse dynamic requires; MG-11 still cannot close without MG-13.
8. **Gates refreshed to MG-1..MG-17**; MG-12 reworded around the supervisor.
9. **Unchanged:** FW2-C1 FAILED/REJECTED; server-delivered CSP is not a Falcon mechanism; the fail-closed rule 1.3; exit precedence; OPEN-BID-27 OPEN and candidate-only; ADR-0053/0054/0056/0057.

---

## 10. What remains unmeasured (honest list)

- **Any FW-2 Falcon mechanism.** Worker WebSocket traffic is **NOT CONTAINED by Falcon**. FW2-C6's containment is an environment property, `--no-sandbox` only, arm64 Docker Desktop only; C6-O1..C6-O7 all open.
- **m-113 verified-then-changed detection: not measured at all** (script stalled at `WAITING_FOR_CHANGE`; no route/interface snapshot obtained). DNS rebinding, redirect-to-denied, mid-session proxy kill, allowlist swap, production-proxy IP pinning.
- Sandbox: custom seccomp profile; the topology under a genuinely sandboxed browser; Node 22 in the relaxed sandboxed configuration; OPEN-BID-27 non-root sandboxed runs (BID-M9).
- x64 GitHub-runner parity for **everything**: NETW topology, MEASB-04 wrapper, realm rows, FW-1, the caller, and **SV1..SV18** (macOS only today).
- `data:` worker WebSocket, service-worker sockets, SharedWorker sockets, `WebTransport`/HTTP3, `EventSource`, worker `fetch`; Firefox and WebKit; a worker-realm containment readiness check.
- Supervisor: Linux and CI runs; no product consumer exists; a child with code execution can forge fd 3 (boundary, not a gap to be closed here).
- Customer staging allowlisting and allowlist provenance; **who owns the isolated environment** and **who holds the challenge verifier** — both unassigned.
- OPEN-BID-27 swap-restore TOCTOU (OBSERVED undetectable post-launch); same-UID attacker; macOS running-image hashing; headed/channel/concurrent launches; Playwright argv drift; CI tenancy; wrapper-plus-isolated-network combination.
- MG-1 deterministic exhaustion against the real `decide`; reachability from the production entry point; any real armed path on a real browser without SharedWorker.

---

## ADR-0058 — The exit code CI trusts is decided by a separate supervisor process, not by in-process exception mapping

*Status:* Proposed (design only; blocked on MG-8, MG-12 and owner authorisation). Supersedes the layer-2 portion of ADR-0055 as amended by rev 36 section 3.
*Context:* OBSERVED (SEC-32): patched `process.reallyExit`, an `'exit'` listener setting `exitCode = 0`, and patched `listeners`/`listenerCount` each pass all four per-call integrity checks and still exit 0. Checks that read state the same process can forge cannot make an in-process mapper load-bearing. OBSERVED (CONF-11, macOS, both Nodes, 3 reps): a 35-line supervisor parent reading one canonical verdict line on fd 3 returns 18 for all 17 bypass/refusal children and 0 only for the authorised arm, with zero wrong exit-0 results.
*Decision:* The pilot runs as a **child**; a **separate, minimal supervisor with no product code** maps exactly one well-formed verdict line plus a consistent child status to that verdict and **everything else to exit 18**. Layer 1 (call-site try/catch to the frozen canonical refusal) stays. The in-process mapper is retained only as a convenience and carries no claim. Rows SV1..SV18 are the acceptance set; forging fd 3 from inside a compromised child is the stated process-integrity boundary.
*Consequences:* Falcon gains a parent process in CI and a defined fd-3 verdict contract; reason codes, detail strings and exit 18 are unchanged, so the gate and `decide32.js` are untouched; the supervisor must be excluded from the product require graph (interacts with MG-11/MG-13); Linux and CI measurement are owed before MG-12 can close.
*Alternatives rejected:* adding further in-process integrity checks (OBSERVED insufficient); claiming "no bypass arms" as sufficient while exit 0/1/7 stay reachable (the owner's CI contract is the exit code); a wrapper shell script (no canonical verdict parsing, no signal/status consistency check); a new reason code or exit code (forbidden).

---

## Handoff constraints

- **Developer:** implement nothing until MG-8 clears and the owner authorises. No new mechanism. Interface surface: the supervisor's `supervise`/`parseVerdictLine` contract, the fd-3 one-line verdict, layer 1, and the `gate37.js` private-identity gate with its recompiling test loader. No new reason code, no new exit code, no bypass flag.
- **QA:** rows **SV1..SV18** (exactly one exit 0) on both Nodes and on Linux/CI; the 11 FC22 rows against `gate37.js`; the four CI checks of section 7; TL1..TL10 as layer-1 rows only; MG-1 stays PARTIAL.
- **Security:** review the m-108 supersession (is "separate supervisor plus stated fd-3 boundary" sufficient?), the m-109 private-identity design, the section 3 verifier custody question, the section 4 UNMEASURED marking, and **MG-17** (accept a custom seccomp profile, or escalate the posture decision to the owner).
- **DevOps:** MG-9 and MG-12 on Linux/x64 CI; MG-15 (per-step re-verification, randomised canaries, `/proc/net` sources, challenge-response); MG-17; MG-11 with MG-13; MG-16; MG-10. Pin a non-root container user. No uncontrolled third-party site in CI; GoogleSearchTest stays local and manual.
