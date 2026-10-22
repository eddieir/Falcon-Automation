# Phase 18 rev 34 - the production decision gate (M-1, m-100 to m-103, MG-1 progress)

Narrow addendum on rev 33 (`183e341`). **Docs-only.** Reviewed-against finding: Security SEC-28 (`security/phase-18-design-review-27.md`: M-1 and m-100 to m-103). It **supersedes**: rev 33 section 1.1 rules 3 and 4, the gate text in section 1.2, the FW-2 precedence sentence in section 2.2 item 3, ADR-0053's wording, and the F19 row in section 3. Everything else in rev 33 stands. `decide32.js` is unchanged (sha256 `e197ec58f6084f03508cac198e21630eb31eb3f2218023c227642fb898b3a522`). No implementation, merge, tag or customer claim is authorised.

## 1. The corrected gate (normative)

1. **Evidence in, verdict out.** The production gate `gateDecide(perRealm)` accepts the per-realm evidence **only**. It invokes the decision function it captured at its own load (`require('./decide32.js')` once) and **never accepts a caller-supplied decision result**. A private factory `createGate(decideFn, fw2State)` exists only for tests and is reached only through a recompiling test loader that replaces the final export line; the production export is `ObjectFreeze({ gateDecide })` with exactly one key.
2. **FW-2 first (m-100).** The worker WebSocket precondition is evaluated **inside the gate, before the decision function is called**. While its state is the production constant `unmeasured` the gate refuses every input with `worker_websocket_containment_unverified`, detail `fw2:unmeasured`, exit 18. Order inside exit 18 is therefore: FW-2 (gate) then whatever `decide32` returns. The gate preserves any valid refusal reason it receives from the decision function, including `worker_websocket_containment_unverified`; `decision-result-malformed` is used **only** for invalid results.
3. **Rebuild, never return (M-1, m-102).** A result is read with: captured `util.types.isProxy` **first**; non-null object; prototype exactly `Object.prototype`; captured `Reflect.ownKeys` giving the exact own string-key set (3 keys for an arm, 4 for a refusal; symbols, extras, missing keys rejected); each property read through a captured `Object.getOwnPropertyDescriptor`, which must be an own enumerable **data** property (accessors, setters and non-enumerable keys rejected). Valid shapes are: the arm (`armed:true`, `exit:0`, reason `shared_worker_absent_all_realms`) and a refusal (`armed:false`, `exit:18`, reason one of `shared_worker_block_unverified`, `shared_worker_present`, `worker_websocket_containment_unverified`, string `detail` of at most 256 characters). The gate then **builds a new frozen canonical object**; the supplied object is never returned.
4. **Exceptions.** Any exception from the decision call or from result reading becomes `shared_worker_block_unverified`, exit 18, detail `decision-exception`. The caught value is never read. **Limit (m-104, Security SEC-29):** the gate is not total near stack exhaustion. Security observed a `RangeError` escaping `gateDecide` itself 17 to 22 times per 5 sweeps on both Nodes after `decide` was entered (never an arm). Therefore `gateDecide` **may throw**, and the process boundary that calls it must map **any** exception from `gateDecide` to exit 18 (`shared_worker_block_unverified`, never an arm), with a test; the claim "every exception becomes a refusal" is withdrawn and replaced by "every exception *caught inside the gate* becomes a refusal, and any exception that escapes it is mapped to exit 18 by the caller".
5. **Captured intrinsics (m-101).** `isProxy`, `Object.freeze`, `Object.getPrototypeOf`, `Object.getOwnPropertyDescriptor`, **`Object.hasOwn`**, `Object.prototype` and `Reflect.ownKeys` are captured at initialization. The result array of values is created with own slots so no inherited index setter can run. No live built-in is used afterwards.
6. **Honest scope (corrects the M-1 overclaim).** The gate does **not** verify that an arm is *true*. If the captured decision function were compromised and returned a well-formed frozen arm, the gate would pass it (row FC22k records this as expected behaviour). The protection is: nothing but a canonical well-formed verdict, rebuilt inside the gate, can leave it; a compromised decision function before load is the documented **process-integrity boundary** and is not a protection claim. ADR-0053's sentence "a lying `armed: true` would arm" is withdrawn; it is replaced by "a *malformed* result, a Proxy, an accessor-backed result or an exception cannot arm".
7. **F19 (m-103).** Playwright's `frame.url()` is `""` for the `javascript:` realm. The realm's identity is established from the **in-realm `location.href`** read by the probe (`about:blank` in MEASA-02), not from `frame.url()`; fixtures and expectations must use the in-realm value.

## 2. Rows

Rows total **57** (53 + FC19, FC20, FC21, FC22). `phase-18-rev34-expectations.json` carries the expected outcomes. FC19 to FC21 run against `decide32` directly **and** through the gate; FC18 (784 patched properties, one at a time and all together) runs through the gate as well. FC22 has 11 sub-cases (see the JSON), including deterministic exception injection (13 thrown value kinds), 25 deterministic stack exhaustions inside the decision call, and 29 malformed results.

**MG-1 (deterministic stack exhaustion): PARTIAL (Security SEC-29 ruling).** The injection runs a stand-in decision function at shallow depth, not `decide32` under real exhaustion, and real exhaustion can escape the gate (m-104). What is shown for the *gate boundary* by injection: a runaway recursion inside the decision call is converted to `decision-exception` 25 of 25 times on both Node versions. Real exhaustion inside the real `decide` was additionally observed converted by the gate once per 1001 depths on Node 22 in 3 of 3 runs and 0 times on Node 24 (JIT-tier dependent); that is evidence, not a deterministic fixture, so claims are limited to "converted when it occurs".

## 3. Gate reference text (verbatim, sha256 `92ad5650c386f8a37d5f7caa6c25255f100711f61e6a86860c758639f04ca95f`)

```js
'use strict';
// gate34.js - Phase 18 decision boundary, architecture revision 34 (m-99, M-1, m-100..m-102).
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
    if (fw2State !== 'contained-for-test') {
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

## 3a. Test-only factory (m-105)

The recompiling test loader writes a copy of the gate that exposes the private factory `createGate` and the state value `contained-for-test`. That generated file and the sweep module are **test artefacts only**: they must live under the test tree, be excluded from the package, and a CI check must fail if any file exporting `createGate` or containing `contained-for-test` is reachable from the production entry point or included in the published package. The production surface was confirmed not to leak the factory (single frozen key). The `gateDecide` function object being extendable has no effect on behaviour and may be frozen by the implementation.

## 4. Still open (unchanged by this revision)

Worker WebSocket containment (no mechanism measured; production gate refuses), OPEN-BID-27 (candidate only; crash detection, Linux, wrapper trust model owed), Linux and GitHub-runner coverage, the implementation reachability checker in CI, a real armed path on a browser without SharedWorker (supported-browser set empty), Security sign-off of this revision, and explicit owner authorisation to start implementation.
