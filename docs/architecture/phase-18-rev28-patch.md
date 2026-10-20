# Phase 18 architecture patch — revision 28 (ARCH-28)

Base: architecture rev 2 plus the rev 3..rev 27 patches, at `98db206` on `docs/phase-18-architecture`.
Inputs: `docs/phase-18-conf02-results.md` (CONF-02, EXECUTED, **PARTIAL**), `docs/phase-18-conf02a-pure-results.md` (the four SPEC-AMBIGUOUS items), `docs/phase-18-conf02b-browser-results.md`, `docs/architecture/phase-18-rev27-patch.md` and `phase-18-rev27-edits.json`, `docs/phase-18-acceptance-criteria.json`, plus the owner decision recorded in the ARCH-28 task packet. The three CONF result documents and the SPIKE findings are **evidence**: rev 28 references them and edits none of them.
Scope: design text only. No production source file, `package.json` script or workflow step is edited. **Rev 28 executes nothing.**
Machine-applicable edits: `docs/architecture/phase-18-rev28-edits.json`; this document is normative for intent.

**Status carried forward.** Counts stay **98 total / 89 Must / 6 Should / 3 Could**. C6-T stays **27 / 5** sourced from rev 23 section D.4. **M-23 and M-24 stay closed. M-25 stays OPEN. M-26 stays OPEN.** O-1 and the `PILOT_APPROVAL_RUN_TOKEN` text are untouched. OWNER-24 and OWNER-25 stay **DECIDED**; the supported-browser set stays **EMPTY**; scope stays **Chromium only**; **no Linux filesystem is admitted**. Reason codes stay `snake_case`. No exit code is added and no bypass exists. The untracked `phase-18-rev24-*` drafts are ignored.

## Section A — context, and what rev 28 changes

CONF-02 executed the rev 27 contract on Node 22.19.0 and 24.21.0 and closed the five CONF-01 arming classes: all 1155 malformed single-field mutations, all 126 valid-negative substitutions and all 13 structural cases behaved exactly as specified, with the authorised all-absent control the only `armed:true` — **except** that a **pass-through Proxy armed** (`armed:true`, exit 0), exactly as rev 27 section B.7 predicted it would. CONF-02 also left FC1 and IC4 unexecuted as independent rows, failed to create the F13/F14 popup realms (`error:'not-created'`), and raised four SPEC-AMBIGUOUS items.

| Item | Change | Primary targets |
|---|---|---|
| 1 | **Proxy rejection is a RULE, not a residual** (B.3, B.5, B.7): `isProxy` captured once at module initialization from `node:util`, applied at every accepted container boundary before any trap-triggering operation. `PROXY-27` is **withdrawn**, with no exception created | B.7, PROXY-27, AC-091, ADR-0052 |
| 2 | The **"pure JavaScript function"** claim is withdrawn everywhere and replaced by **"deterministic Node-side decision function using a captured standard-library intrinsic"** | B.5, B.6, B.8, B.9, C, H, I, L |
| 3 | The unreachable **`disagreement`** branch and detail string are **deleted**; FC6/IC3-d are redefined as reachable rows | B.5, C.3, C.4 |
| 4 | **Accessor check before key-order check** is made canonical, fixing the C3/C4 expected `detail` | B.5, D.3 |
| 5 | A named **test seam** (`snapshotAndValidate` / `decideFromSnapshot`) makes FC10 and sweep C13/C20 directly executable with no product-reachable hook | B.5, B.8, H, SEAM-28 |
| 6 | **IC5 "extra id" split** into two exact sub-cases; **FC1 and IC4** defined as independently executable rows; **F13/F14 popup creation** specified | C.3, C.4, J.5, J.6, J.7 |
| 7 | Table W6-T reprinted in full; **authoritative total 44 rows**; Sweep C grows to **20** cases | C, D |
| 8 | Section J becomes the **CONF-03** executed gate, with honest handling of API/network failure and cleanup of stale earlier-CONF processes | J |
| 9 | Repository-wide stale-reference search for `pure JavaScript function`, `PROXY-27`, `B.7` and the `42 rows` totals, every hit disposed in place | K |

Nothing is weakened: every change either refuses in more input shapes or records a measurement obligation.

## Section B — the decision contract after rev 28

### B.1 Constraints

Synchronous, deterministic, total (every input shape yields a decision, never a throw), CommonJS. No I/O, no clock, no network, no filesystem, no environment read inside `decide`. No new public surface (OWNER-25). `Logger.*` only at the call site; `fs.promises.*` for any evidence write. **New and explicit:** `decide` is **Node-side by contract**. It depends on exactly one standard-library intrinsic, `require('node:util').types.isProxy`, captured once at module initialization. It is therefore **not** a pure-ECMAScript function and must not be described as one; it is still pure in the sense that matters for CI — no side effects, no hidden state, identical output for identical input on both supported Node versions.

### B.2 Schema `sharedWorkerRealmEvidence` version 1

Unchanged from rev 27 section B.2: exactly 11 own data properties in canonical order (`schemaVersion`, `id`, `mechanism`, `measurable`, `error`, `timedOut`, `typeofSharedWorker`, `descriptor`, `nativeCtor`, `constructed`, `repetitionsConsistent`), exact types, closed enumerations, named string sentinels (`error:'none'`, `descriptor:'absent'`, `nativeCtor:'absent'`), and **absence of a field is always UNVERIFIED**. Clean absence, measured presence and the F21 note are unchanged. **Added by rev 28:** every own value must be a **primitive** of its declared type; a non-primitive own value is rejected, and if it is a Proxy it is rejected as a proxy first.

### B.3 Rejection rules (all ⇒ `armed:false`, exit 18, `shared_worker_block_unverified`)

The rev 27 rejection set stays in force verbatim. Rev 28 adds, **ahead of everything else**:

- `perRealm` is a Proxy ⇒ `input-proxy:perRealm`;
- `requiredIds` is a Proxy, or any `requiredIds` element is a Proxy ⇒ `input-proxy:requiredIds`;
- any realm record is a Proxy ⇒ `record-proxy:index-N`;
- any non-primitive own value of a record (the only way a nested structured evidence value can appear) is a Proxy ⇒ `record-value-proxy:KEY:index-N`; a non-primitive own value that is **not** a Proxy is still rejected by the type checks (`record-value-type:KEY`);
- a snapshot that is somehow a Proxy ⇒ `snapshot-proxy:index-N` / `snapshot-proxy:input` (defence in depth: `JSON.parse` cannot produce one).

**Ordering is normative and security-relevant:** proxy rejection runs **before** property enumeration, prototype inspection, descriptor access, snapshotting, cloning and freezing, so no rejected proxy can run a trap. Within shape inspection the order is now: proxy → plain object → prototype → symbol keys → own-name count → **own-descriptor/accessor** → **canonical key order** → nested-value proxy → nested-value primitiveness. The accessor check deliberately precedes the key-order check so that a getter or setter on a required key always refuses with `record-accessor-property`; `record-key-order` is reserved for a genuinely reordered key set.

**Deleted:** the rev 27 `disagreement` branch and its detail string. It was unreachable (clean absence forces `typeofSharedWorker === 'undefined'` for every clean-absence realm, and any realm that differs is neither clean absence nor measured presence and is already refused at precedence step 1). Realm disagreement is refused through the field-validation path with `realm-not-affirmatively-validated:ID`.

### B.4 Precedence (unchanged)

**AMENDED IN PLACE BY REV 29 (ARCH-29, CONF-03): the precedence ORDER below is right but it was not enforced by the rev 28 reference text. Rev 29 makes it explicit as GLOBAL VALIDATION BEFORE CLASSIFICATION: every required record is validated first (containers, required-ID set, complete inventory, schema, types, descriptors, captured-constructor agreement, repetitions, consistency); any invalid, incomplete, inconsistent or unverified record yields `shared_worker_block_unverified` exit 18 and WINS over any presence; only then may presence be inspected. See rev 29 sections B.4a (validity matrix) and B.5.**

1. invalid, incomplete or unverified evidence (now including any proxy) ⇒ `armed:false`, exit **18**, `shared_worker_block_unverified`;
2. otherwise any **measured presence** ⇒ `armed:false`, exit **18**, `shared_worker_present`;
3. only complete, valid, **unanimous** validated absence ⇒ `armed:true`, exit 0 — and then only if OWNER-24 (same-process rule) holds.

### B.5 Reference text — deterministic Node-side decision function using a captured standard-library intrinsic

**SUPERSEDED BY REV 29 (ARCH-29, CONF-03 FC1 defect): the code block below is NOT the live reference. CONF-03 measured `shared_worker_present` detail `realm:F1` where the contract requires `shared_worker_block_unverified` detail `realm-not-affirmatively-validated:F1`, because `hasMeasuredPresence` classified a realm present without checking captured-constructor evidence. The live reference is rev 29 section B.5: `isProxy` first, snapshot, VALIDATE EVERY REQUIRED RECORD against the rev 29 validity matrix, and only then classify. `isCleanAbsence`/`hasMeasuredPresence` are replaced by `isValidAbsence`/`isValidPresence`.**

Normative behaviour; the implementation may differ in style but not in outcome or in **order of checks**.

```js
// Deterministic, synchronous, total, CommonJS. No I/O, no clock, no network,
// no filesystem, no environment read. NOT a pure-ECMAScript function: it uses one
// standard-library intrinsic, captured ONCE here at module initialization.
const { types } = require('node:util');
const isProxy = types.isProxy;            // never re-read, never taken from input
Object.freeze(module.exports);            // see B.8 note on export immutability

const SCHEMA_VERSION = 1;

const CANONICAL_REQUIRED_REALM_IDS = Object.freeze([
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11',
  'F12','F13','F14','F15','F16','F17','F18','F19','F20','F21'
]);

const REQUIRED_KEYS = Object.freeze([
  'schemaVersion','id','mechanism','measurable','error','timedOut',
  'typeofSharedWorker','descriptor','nativeCtor','constructed','repetitionsConsistent'
]);

const ENUMS = Object.freeze({
  mechanism: Object.freeze(['page.evaluate','frame.evaluate','popup.page.evaluate',
                            'serviceworker.probe','unavailable']),
  error: Object.freeze(['none','threw','timeout','not-created','frame-not-found',
                        'unexpected-success-no-allow-scripts','unreachable']),
  typeofSharedWorker: Object.freeze(['undefined','function','object','other','unreadable']),
  descriptor: Object.freeze(['absent','present-data','present-accessor','unreadable']),
  nativeCtor: Object.freeze(['absent','present','mismatch','uncaptured'])
});
const BOOLEAN_KEYS = Object.freeze(['measurable','timedOut','constructed','repetitionsConsistent']);

const UNVERIFIED = (detail) => ({
  armed: false, exit: 18, reason: 'shared_worker_block_unverified', detail
});

// --- step 0: PROXY REJECTION, before anything that could run a trap -----------------
// isProxy() inspects the object's internal slot. It reports a Proxy, INCLUDING a
// revoked Proxy, without invoking any trap and without throwing.
function proxyFault(v) { return isProxy(v); }   // one audited read of the captured intrinsic

// --- step 1: structural inspection of the CALLER's object; runs no user value code ---
function inspectRecordShape(r) {
  if (proxyFault(r)) return 'record-proxy';                       // FIRST, always
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return 'record-not-plain-object';
  if (Object.getPrototypeOf(r) !== Object.prototype) return 'record-prototype-invalid';
  if (Object.getOwnPropertySymbols(r).length !== 0) return 'record-symbol-key';
  const names = Object.getOwnPropertyNames(r);
  if (names.length !== REQUIRED_KEYS.length) return 'record-keys-mismatch';
  // accessor check BEFORE key order (canonical since rev 28)
  const values = [];
  for (const k of REQUIRED_KEYS) {
    const d = Object.getOwnPropertyDescriptor(r, k);
    if (!d) return 'record-keys-mismatch';
    if (!Object.prototype.hasOwnProperty.call(d, 'value')) return 'record-accessor-property';
    values.push([k, d.value]);
  }
  for (let i = 0; i < REQUIRED_KEYS.length; i += 1) {
    if (names[i] !== REQUIRED_KEYS[i]) return 'record-key-order';
  }
  // nested structured evidence values: proxy first, then primitiveness
  for (const [k, v] of values) {
    if (proxyFault(v)) return 'record-value-proxy:' + k;
    if (v !== null && (typeof v === 'object' || typeof v === 'function')) {
      return 'record-value-type:' + k;
    }
  }
  return null; // shape accepted
}

// --- step 2: inert snapshot (only ever applied to a non-Proxy, primitive-valued record) ---
function snapshotRecord(r) {
  try { return JSON.parse(JSON.stringify(r)); } catch (e) { return null; }
}

// --- step 3: validate the SNAPSHOT against the schema ---
function validateRecord(snap) {
  const shape = inspectRecordShape(snap);
  if (shape) return shape;
  if (typeof snap.schemaVersion !== 'number' || !Number.isInteger(snap.schemaVersion)) {
    return 'record-value-type:schemaVersion';
  }
  if (snap.schemaVersion !== SCHEMA_VERSION) return 'schema-version-unknown';
  if (typeof snap.id !== 'string') return 'record-value-type:id';
  if (!CANONICAL_REQUIRED_REALM_IDS.includes(snap.id)) return 'record-value-enum:id';
  for (const k of Object.keys(ENUMS)) {
    if (typeof snap[k] !== 'string') return 'record-value-type:' + k;
    if (!ENUMS[k].includes(snap[k])) return 'record-value-enum:' + k;
  }
  for (const k of BOOLEAN_KEYS) {
    if (typeof snap[k] !== 'boolean') return 'record-value-type:' + k;
  }
  return null; // valid
}

function isCleanAbsence(v) {
  return v.measurable === true
    && v.error === 'none'
    && v.timedOut === false
    && v.typeofSharedWorker === 'undefined'
    && v.descriptor === 'absent'
    && v.nativeCtor === 'absent'
    && v.constructed === false
    && v.repetitionsConsistent === true
    && v.mechanism !== 'unavailable';
}

// WITHDRAWN BY REV 29 (ARCH-29): hasMeasuredPresence is REPLACED by isValidPresence (rev 29 B.5).
// A record is present ONLY if typeofSharedWorker === 'function' AND descriptor is 'present-data'
// or 'present-accessor' AND nativeCtor === 'present'. nativeCtor 'mismatch', 'uncaptured' or
// 'absent' with typeof 'function' is INVALID => armed:false, exit 18,
// shared_worker_block_unverified, detail realm-not-affirmatively-validated:<id>.
// DO NOT IMPLEMENT the function below.
function hasMeasuredPresence(v) {
  return v.typeofSharedWorker === 'function' || v.constructed === true;
}

// --- SEAM part 1: everything that touches the caller's objects ---------------------
function snapshotAndValidate(perRealm, requiredIds) {
  const no = (d) => ({ ok: false, result: UNVERIFIED(d) });
  if (proxyFault(perRealm)) return no('input-proxy:perRealm');     // before Array.isArray
  if (proxyFault(requiredIds)) return no('input-proxy:requiredIds');
  if (!Array.isArray(perRealm) || !Array.isArray(requiredIds)) return no('input-not-array');
  if (Object.keys(perRealm).length !== perRealm.length) return no('array-sparse-or-extra-keys');
  if (Object.keys(requiredIds).length !== requiredIds.length) return no('array-sparse-or-extra-keys');
  for (let i = 0; i < requiredIds.length; i += 1) {
    if (proxyFault(requiredIds[i])) return no('input-proxy:requiredIds');
    if (typeof requiredIds[i] !== 'string') return no('required-id-set-malformed');
  }
  const req = requiredIds.slice();
  const canonical = CANONICAL_REQUIRED_REALM_IDS;
  if (req.length !== canonical.length || new Set(req).size !== req.length) {
    return no('required-id-set-malformed');
  }
  for (const id of req) if (!canonical.includes(id)) return no('required-id-unknown');
  for (const id of canonical) if (!req.includes(id)) return no('required-id-missing');

  const records = [];
  const seen = new Set();
  for (let i = 0; i < perRealm.length; i += 1) {
    const raw = perRealm[i];
    const shape = inspectRecordShape(raw);                 // proxy checked first inside
    if (shape) return no(shape + ':index-' + i);
    const snapA = snapshotRecord(raw);
    const snapB = snapshotRecord(raw);                     // second independent read
    if (snapA === null || snapB === null) return no('record-not-snapshotable:index-' + i);
    if (proxyFault(snapA) || proxyFault(snapB)) return no('snapshot-proxy:index-' + i);
    if (JSON.stringify(snapA) !== JSON.stringify(snapB)) return no('record-unstable:index-' + i);
    const bad = validateRecord(snapA);
    if (bad) return no(bad + ':index-' + i);
    const frozen = Object.freeze(snapA);
    if (!req.includes(frozen.id)) return no('realm-unknown-or-extra:' + frozen.id);
    if (seen.has(frozen.id)) return no('realm-duplicate:' + frozen.id);
    seen.add(frozen.id);
    records.push(frozen);
  }
  for (const id of req) if (!seen.has(id)) return no('realm-missing:' + id);
  return {
    ok: true,
    snapshot: Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      requiredIds: Object.freeze(req.slice()),
      records: Object.freeze(records)
    })
  };
}

// --- SEAM part 2: the decision, which reads ONLY the frozen snapshot ---------------
function decideFromSnapshot(snapshot) {
  if (proxyFault(snapshot)) return UNVERIFIED('snapshot-proxy:input');
  if (snapshot === null || typeof snapshot !== 'object'
      || snapshot.schemaVersion !== SCHEMA_VERSION
      || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.requiredIds)) {
    return UNVERIFIED('snapshot-malformed');
  }
  const byId = new Map();
  for (const v of snapshot.records) {
    if (proxyFault(v)) return UNVERIFIED('snapshot-proxy:record');
    byId.set(v.id, v);
  }
  for (const id of snapshot.requiredIds) {
    const v = byId.get(id);
    if (!v) return UNVERIFIED('realm-missing:' + id);
    if (!isCleanAbsence(v) && !hasMeasuredPresence(v)) {
      return UNVERIFIED('realm-not-affirmatively-validated:' + id);
    }
  }
  for (const id of snapshot.requiredIds) {
    if (hasMeasuredPresence(byId.get(id))) {
      return { armed: false, exit: 18, reason: 'shared_worker_present', detail: 'realm:' + id };
    }
  }
  // the rev 27 'disagreement' branch is DELETED: it was unreachable.
  return { armed: true, exit: 0, reason: 'shared_worker_absent_all_realms' };
}

function decide(perRealm, requiredIds) {
  const v = snapshotAndValidate(perRealm, requiredIds);
  return v.ok ? decideFromSnapshot(v.snapshot) : v.result;
}

module.exports = {
  decide,                                  // the ONLY product entry point
  snapshotAndValidate, decideFromSnapshot, // exported for tests (SEAM-28)
  inspectRecordShape, snapshotRecord, validateRecord
};
```

`proxyFault` exists only to make the single intrinsic read auditable in one place; it never dispatches on anything the caller supplies. `isProxy` is a boolean-returning intrinsic: it does not throw, does not invoke a trap, and reports a **revoked** Proxy as a Proxy, so the revoked case refuses instead of throwing `TypeError` from a later read. Every throw-capable operation (`JSON.stringify`) runs only after the record has passed the proxy, prototype, accessor and primitiveness checks, and is additionally wrapped, so `decide` stays total.

### B.6 Order of operations, stated as a rule

**AMENDED BY REV 29 (ARCH-29): the rule gains its missing middle step. ORDER OF OPERATIONS (normative): reject proxies -> inspect shape (accessor before key order) -> snapshot twice -> compare -> validate the snapshot schema -> freeze -> VALIDATE EVERY REQUIRED RECORD AGAINST THE VALIDITY MATRIX (containers, required-ID set, complete realm inventory, schema, types, descriptors, captured-constructor agreement, repetitions and consistency) -> only if EVERY required record is valid, inspect presence -> any valid-present realm => shared_worker_present exit 18 -> arm only when every required record is VALID-ABSENT. Classification may never precede validation; a single invalid, incomplete, inconsistent or unverified record wins over any presence and over any arming.**

**reject proxies → inspect shape (accessor before key order) → snapshot twice → compare → validate the snapshot → freeze → decide on the frozen snapshot.** The caller's object is read only by descriptor reads of a known non-Proxy plain object and by the two `JSON.stringify` passes. Every value the decision reads comes from the frozen snapshot, which is created inside `snapshotAndValidate` and cannot be reached by the caller. Therefore mutating the caller's record **after** validation and **before** the decision — including replacing a field with a Proxy or an accessor — cannot change the decision; the decision is either unchanged or, if the mutation is visible across the two snapshot reads, a refusal (`record-unstable`). `JSON` round-trip is kept over `structuredClone` for the rev 27 reasons.

### B.7 Proxy rejection rule (supersedes the rev 27 residual; `PROXY-27` withdrawn)

**`PROXY-27` is withdrawn. No proxy exception is created or accepted.** CONF-02 measured the rev 27 outcome the rev 27 text predicted: a pass-through Proxy over an otherwise-valid all-absent base **armed**. Rev 28 refuses it by rule:

1. `isProxy` is captured **once** at module initialization from `node:util` and is never re-read, never taken from an argument, never read from page-controlled or otherwise mutable state.
2. Proxy rejection runs **before** property enumeration, prototype inspection, descriptor access, cloning, freezing or any other operation that could trigger a trap.
3. It is applied at **every accepted container boundary**: `perRealm`, `requiredIds` (and its elements), every realm record, every non-primitive own value of a record, and the snapshot itself.
4. Every proxy case — transparent pass-through, trapping (throwing or lying), **revoked**, array-level, `requiredIds`-level, nested-value, and a proxy substituted after validation — returns `shared_worker_block_unverified`, exit 18, `armed:false`, and **never** throws an uncaught exception and **never** arms.
5. `util.types.isProxy` detects Proxy objects, including revoked ones, **without triggering traps**, because it reads an internal slot rather than performing a property operation.

**What honestly remains** (stated, not an exception, and not a detection gap for proxies):

- **Node-only dependence.** `util.types` has no browser equivalent, so the decision function is Node-side by contract. Nothing in the browser may take an arming decision; the probe only reports evidence.
- **Process integrity is an assumption.** An intrinsic captured at module initialization cannot protect against an **already-compromised Node process** that patched `node:util` before this module loaded, or that patched the module registry. That is a process-integrity assumption of the whole runtime, recorded here, not a weakening of the rule.
- **Non-Proxy exotic objects.** A non-Proxy host object with malicious getters is outside `isProxy`'s scope; it is handled by the own-data-property check (`record-accessor-property`), the prototype check, the symbol-key check, the key-order check, the primitiveness check and the two-read snapshot-stability check. No accessor can reach the decision.

Verification is owed to CONF-03 rows **FC12** and **IC9**.

### B.8 Interfaces

- **Internal, changed:** `decide(perRealm, requiredIds)` → `{ armed, exit, reason, detail }`. Deterministic, synchronous, total, Node-side; the primary unit seam. It is **not** a pure-ECMAScript function and must not be documented as one.
- **Internal, new (tests only — SEAM-28):** `snapshotAndValidate(perRealm, requiredIds)` → `{ ok:false, result }` | `{ ok:true, snapshot }` where `snapshot` is a frozen `{ schemaVersion, requiredIds, records }` of frozen records; `decideFromSnapshot(snapshot)` → verdict. **Exactly these two**, plus the rev 27 `inspectRecordShape`, `snapshotRecord` and `validateRecord`, are module-internal exports. Product callers call `decide()` only. There is **no** injected hook, callback, flag, environment variable or configuration key: the seam cannot influence a production decision, and `module.exports` is frozen so a later require cannot swap `decide`.
- **Internal, changed:** `SharedWorkerCapabilityProbe.measure(...)` must emit schema-version-1 records with **primitive** values only, and must never fill a missing measurement with a default.
- **Internal, unchanged:** `BrowserIdentity.assert(browser, expected)`; its mechanism remains `OPEN-BID-27`.
- **Public surface:** unchanged — no CLI flag, no environment variable, no config key (OWNER-25). CommonJS throughout.
- **Observability:** one `Logger.error` naming code, exit, reason, `detail` and realm id; the structured `sharedWorkerCapability` report block carries the frozen validated snapshots, the schema version, the per-realm `detail` and the browser identity record. `detail` strings come from the closed list (rev 28 adds `input-proxy:perRealm`, `input-proxy:requiredIds`, `record-proxy:index-N`, `record-value-proxy:KEY:index-N`, `snapshot-proxy:*`, `snapshot-malformed`; it drops `disagreement`) and are never page-supplied.

### B.9 Trust boundaries and data flow

Boundary 1: browser → Node, unchanged (Falcon's own `evaluate` against a Falcon-authored local document, main world, before any external target access). Boundary 2: probe layer → `decide`, schema-checked and one-way, and now additionally **proxy-checked at the boundary itself**: a container crossing this boundary is rejected if it is a Proxy, before any property of it is touched, so a page-influenced or probe-influenced object graph cannot run code inside the decision path. The decision is taken **Node-side only** on a frozen snapshot that shares no identity with the probe's objects. Boundary 3: `decide` → `NetworkGate.install`, which refuses before any navigation on a non-armed verdict and additionally requires the OWNER-24 same-process validation before acting on `armed:true`. No page-supplied string reaches a reason, a `detail` or a log line.

## Section C — table W6-T, CONSOLIDATED (single source, reprinted in full)

**This table is the single source of SharedWorker realm and case ids, counts and expected results.** It supersedes the rev 27 section C reprint and the rev 25 / rev 26 split, which remain only as history. **SUPERSEDED BY REV 29 (ARCH-29, CONF-03): the authoritative row count is 49 ROWS (21 F + 1 F22 + 15 FC (FC1..FC15) + 10 IC (IC1..IC10) + 1 FW-1 + 1 MT-1) and the single source is `docs/architecture/phase-18-rev29-patch.md` section C. Rev 29 adds FC13, FC14, FC15, IC10 and the META-TEST row MT-1, and corrects the FC1 mismatch expectation.** Authoritative row count after rev 28: 44 rows (superseded).

### C.1 Required decision realms (F1..F21) — 21 rows

| Id | Realm | Mechanism | Expected result |
|---|---|---|---|
| F1 | isolated empty context (`about:blank`, fresh context) | `page.evaluate` | present ⇒ `shared_worker_present` 18; validated clean absence ⇒ clean negative |
| F2 | top, same-origin fixture | `page.evaluate` | as F1 |
| F3 | iframe, same-origin | `frame.evaluate` | as F1 |
| F4 | iframe, cross-origin (second loopback port) | `frame.evaluate` | as F1 |
| F5 | sandboxed iframe, `sandbox=""` (no `allow-scripts`) | `frame.evaluate` | **REQUIRED FAIL-CLOSED** ⇒ `shared_worker_block_unverified` 18 (`unexpected-success-no-allow-scripts`) |
| F6 | sandboxed iframe, `allow-scripts` only | `frame.evaluate` | present ⇒ `shared_worker_present` 18 |
| F7 | sandboxed iframe, `allow-same-origin` only | `frame.evaluate` | **REQUIRED FAIL-CLOSED** ⇒ `shared_worker_block_unverified` 18 |
| F8 | sandboxed iframe, `allow-scripts allow-same-origin` | `frame.evaluate` | present ⇒ `shared_worker_present` 18 |
| F9 | `data:` frame | `frame.evaluate` | present ⇒ `shared_worker_present` 18 |
| F10 | `blob:` frame | `frame.evaluate` | present ⇒ `shared_worker_present` 18 |
| F11 | `document.write`-created frame | `frame.evaluate` | **REQUIRED FAIL-CLOSED** ⇒ `shared_worker_block_unverified` 18 (`frame-not-found`) |
| F12 | removed-then-reinserted frame | `frame.evaluate` | present ⇒ `shared_worker_present` 18 |
| F13 | popup, same-origin (`window.open`) | `popup.page.evaluate` | **created and present** ⇒ `shared_worker_present` 18 (the row's primary expectation, requires J.7 creation); **not created** ⇒ `error:'not-created'` ⇒ `shared_worker_block_unverified` 18 recorded as **REALM NOT MEASURED**, never a pass |
| F14 | popup, cross-origin, `noopener` | `popup.page.evaluate` | as F13, with the J.7 `noopener` acquisition rule |
| F15 | nested iframe, depth 2 | `frame.evaluate` | present ⇒ `shared_worker_present` 18 |
| F16 | `srcdoc` iframe | `frame.evaluate` | unmeasured today ⇒ `shared_worker_block_unverified` 18 until measured |
| F17 | frame appended after the probe / after arming | `frame.evaluate` | unmeasured today ⇒ `shared_worker_block_unverified` 18 until measured |
| F18 | bfcache: navigate away and back, then read | `page.evaluate` | unmeasured today ⇒ `shared_worker_block_unverified` 18 until measured |
| F19 | `javascript:` URL document | `frame.evaluate` | unmeasured today ⇒ `shared_worker_block_unverified` 18 until measured |
| F20 | `object` / `embed`-hosted document | `frame.evaluate` | unmeasured today ⇒ `shared_worker_block_unverified` 18 until measured |
| F21 | service-worker global scope | not queryable (`mechanism:'unavailable'`, `error:'unreachable'`) | **REQUIRED FAIL-CLOSED** ⇒ `shared_worker_block_unverified` 18; `serviceWorkers:'block'` stays in force and is unverified |

### C.2 Informational realm (never a decision input) — 1 row

| Id | Realm | Expected result |
|---|---|---|
| F22 | dedicated-worker global scope | informational only; `typeof SharedWorker === 'undefined'` observed (W6, re-observed by CONF-02); **must never appear in `perRealm`**; contributes neither a pass nor a refusal; re-check on Chromium upgrade |

### C.3 Decision-function and mechanism cases (FC1..FC12) — 12 rows

**SUPERSEDED BY REV 29: FC1..FC15 — 15 rows (rev 29 section C adds FC13, FC14 and FC15).**

| Id | Case | Expected result | Coverage |
|---|---|---|---|
| FC1 | **expectation CORRECTED BY REV 29: the mismatch-injection sub-case expects EXACTLY `armed:false`, exit 18, `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:<realm id>`, and nothing else; the oracle comes only from the rev 29 contract.** **independently executable row (J.5):** pre-author-script native-constructor capture via `addInitScript`, compared with the evaluate-time read, **its own run per measurable realm per repetition**, plus a mismatch-injection sub-case | match ⇒ `nativeCtor:'present'` or `'absent'` as measured and the row PASSES on agreement; injected mismatch ⇒ `nativeCtor:'mismatch'` ⇒ `shared_worker_block_unverified` 18 | W6 (matched) / CONF-03 |
| FC2 | page-mutation evasion (five sub-observations, J.4) | decision unchanged and the pre-captured native reference still usable; otherwise `shared_worker_block_unverified` 18 | W6; `fc2Pass:true` measured by CONF-02 |
| FC3 | no page-supplied value influences the decision | structural: the decision reads only Falcon's own `evaluate` results through the validated frozen snapshot; a forged "absent" verdict changes nothing. Representative executable case: forged extra key ⇒ `record-keys-mismatch:index-0` | W7 |
| FC4 | probe timeout in a required realm | `timedOut:true` ⇒ `shared_worker_block_unverified` 18, `realm-not-affirmatively-validated:ID` | W7 |
| FC5 | required realm cannot be created | `error:'not-created'` ⇒ `shared_worker_block_unverified` 18, `realm-not-affirmatively-validated:ID` | W7 |
| FC6 | **realm results disagree (redefined):** the explicit disagreement branch is DELETED as unreachable. The row is exercised through the field-validation path — a base in which one realm reports `repetitionsConsistent:false` (and a second variant where one realm reports a different `typeofSharedWorker` that is not clean absence) | `armed:false`, exit 18, `shared_worker_block_unverified`, `detail` exactly `realm-not-affirmatively-validated:<that realm id>`; the detail `disagreement` must never be emitted | W7 / CONF-03 |
| FC7 | the capability check itself throws | `error:'threw'` ⇒ `shared_worker_block_unverified` 18, `realm-not-affirmatively-validated:ID` | W7 |
| FC8 | `requiredIds` contract: must equal `F1..F21` exactly; non-array, missing, duplicate, extra or unknown id rejected | `shared_worker_block_unverified` 18 with the matching `detail` | W7 |
| FC9 | per-realm evidence schema contract: exact 11-key own-property set, canonical key order, data properties only, plain-object prototype, no symbol key, no inherited key, exact types and enumerations, **primitive values only** | every violation ⇒ `shared_worker_block_unverified` 18 with the matching `detail`; absence of a field is always unverified | W7 / CONF-03 |
| FC10 | **order and immutability (redefined with a seam):** via `snapshotAndValidate` → mutate the caller's original objects (delete a key, change a value, install a getter, **substitute a Proxy**) → `decideFromSnapshot` | decision **byte-identical** to the unmutated decision, or a refusal; never an `armed:true` created by the mutation. Companion in-`decide` case: a value whose serialization varies across the two snapshot reads ⇒ `record-unstable:index-N` | W7 / CONF-03 |
| FC11 | `schemaVersion` gating: only version `1` is accepted | `0`, `2`, `'1'`, missing or non-integer ⇒ 18 (`schema-version-unknown` / `record-value-type:schemaVersion`) | W7 / CONF-03 |
| **FC12** (new) | **proxy rejection at every accepted container boundary**, performed before property enumeration, prototype inspection, descriptor access, cloning or freezing, using `isProxy` captured once at module initialization | `perRealm` proxy ⇒ `input-proxy:perRealm`; `requiredIds` or element proxy ⇒ `input-proxy:requiredIds`; record proxy ⇒ `record-proxy:index-N`; non-primitive own value proxy ⇒ `record-value-proxy:KEY:index-N`; post-validation substitution ⇒ decision unchanged or `snapshot-proxy:*`. **Every case `armed:false`, exit 18, `shared_worker_block_unverified`, no uncaught exception, never armed** | CONF-03 |

### C.4 Control fixtures (IC1..IC9) — 9 rows

**SUPERSEDED BY REV 29: IC1..IC10 — 10 rows (rev 29 section C adds IC10, the present-record constructor-evidence battery) and the expectations of IC3, IC5 and IC6 are corrected there.**

| Id | Fixture | Expected result | Coverage |
|---|---|---|---|
| IC1 | positive control: `new SharedWorker(url)` against the loopback fixture | the fixture's HTTP log records the shared-worker **script fetch** (probe is not vacuous) | W6 + CONF-02 (PASS) |
| IC2 | inversion at browser level: a configuration in which `typeof SharedWorker` is `'undefined'` in every measurable realm | the rule **still refuses** while any required realm is unmeasurable | W6 + CONF-02 (PASS) |
| IC3 | inversion at unit level, synthetic `perRealm`: (a) 21 schema-valid clean-absence records ⇒ `armed:true` exit 0 (**authorised positive control; the only place `armed:true` is exercised, never against a customer target**); (b) one present ⇒ 18 `shared_worker_present`; (c) one unmeasurable ⇒ 18 `realm-not-affirmatively-validated:ID`; (d) **disagreement, redefined:** exercised through the field-validation path, expected `detail` exactly `realm-not-affirmatively-validated:ID`; (e) empty array ⇒ 18 `realm-missing:F1` | as stated | W7 / CONF-03 |
| IC4 | **independently executable row (J.6):** probe disabled or removed | (a) probe stubbed to emit nothing ⇒ `armed:false`, exit 18, `realm-missing:F1`; (b) probe stubbed to emit a partial array ⇒ `realm-missing:<first absent id>`; (c) **gate removed:** with the `decide` call deleted from the arming path, the test **must FAIL** — a passing suite with the gate removed is itself a defect | W7 / CONF-03 |
| IC5 | `decide()` negative-case battery: (1) missing realm `realm-missing:F1`; (2) duplicate id `realm-duplicate:F1`; **(3a) `requiredIds`-level extra id (22-entry `requiredIds`) ⇒ `required-id-set-malformed`; (3b) `perRealm`-level extra record (22 records, the extra one schema-valid) ⇒ `realm-duplicate:ID` when its id repeats a required id, or `realm-unknown-or-extra:ID` when its id is outside the required set**; (4) unknown id `required-id-unknown`; (5) `measurable:undefined` `record-keys-mismatch:index-0`; (6) `typeofSharedWorker:null` `record-value-type:typeofSharedWorker:index-0`; (7) `typeofSharedWorker:'object'` `realm-not-affirmatively-validated:F1`; (8) primitive record `record-not-plain-object:index-0`; (9) non-array `perRealm` `input-not-array`; (10) `repetitionsConsistent:false` `realm-not-affirmatively-validated:F1` | every case ⇒ 18 `shared_worker_block_unverified`, `armed:false`, with the stated `detail` | W7 / CONF-03 |
| IC6 | **expectation CORRECTED BY REV 29: all 126 Sweep B cases refuse with `shared_worker_block_unverified`; presence is exercised by Sweep D (21 valid-present controls + 174 refusals).** exhaustive single-field mutation sweep (section D): 21 × 11 × 5 = **1155** malformed cases, plus 21 × 6 = **126** valid-negative substitutions | **1155** ⇒ 18 `shared_worker_block_unverified`; of the 126: 42 ⇒ 18 `shared_worker_present`, 84 ⇒ 18 `shared_worker_block_unverified`; **zero unexpected `armed:true`** | W7 / CONF-02 (PASS) / CONF-03 |
| IC7 | structural rejection battery, **20** named cases (section D.3) | every case ⇒ 18 `shared_worker_block_unverified` with the expected `detail` | W7 / CONF-03 |
| IC8 | browser process identity established before the run and re-verified immediately before the simulated run step (J.2) | identity established and unchanged, or ⇒ 18 `shared_worker_block_unverified`; **it never arms** | CONF-02 (PASS) / CONF-03 |
| **IC9** (new) | **proxy battery, 7 named cases** (= sweep C14..C20): transparent pass-through record proxy; trapping record proxy (throwing `get`/`getOwnPropertyDescriptor`); **revoked** proxy; `perRealm`-array proxy; `requiredIds` proxy; nested non-primitive own-value proxy; post-validation substituted proxy through the SEAM-28 seam | every case `armed:false`, exit 18, `shared_worker_block_unverified` with the `detail` of FC12; **no uncaught exception in any case**; 3 repetitions per Node version | CONF-03 |

### C.5 Carried worker-WebSocket case — 1 row

**REV 29 ADDS a section C.6 META-TEST row (MT-1): the gate fails if a row's recorded pass flag disagrees with its expected reason, exit code, armed value or detail; pass flags must be recomputed by an independent checker.**

| Id | Case | Expected result | Coverage |
|---|---|---|---|
| FW-1 | dedicated-worker-initiated WebSocket against a fixture with a real WS upgrade | **WebSocket behaviour remains UNMEASURED** and FW-1 stays an independent arming blocker; its **required fail-closed decision** (unmeasured ⇒ `shared_worker_block_unverified` 18, `armed:false`, `detail fw1-websocket-unmeasured`) is executed 3× per Node version | CONF-02 (decision only) / CONF-03 |

**SUPERSEDED BY REV 29 (ARCH-29): the authoritative total is 21 (F1..F21) + 1 (F22) + 15 (FC1..FC15) + 10 (IC1..IC10) + 1 (FW-1) + 1 (MT-1) = 49 ROWS, reprinted with its changed and new rows in rev 29 section C.** Rev 28 total (superseded): 21 (F1..F21) + 1 (F22) + 12 (FC1..FC12) + 9 (IC1..IC9) + 1 (FW-1) = 44 rows. SPIKE-W6 covers 15 decision realms plus FC1, FC2, IC1 and IC2; every other row is owed to SPIKE-W7 and the section J gate. The rev 25 "34 rows", rev 26 "36 rows" and rev 27 "42 rows" totals are superseded by **44**. C6-T stays **27 / 5** and the two inventories stay disjoint.

## Section D — the exhaustive sweep, defined precisely

### D.1 Base array `B27`

Unchanged from rev 27 section D.1: 21 schema-valid clean-absence records, one per `CANONICAL_REQUIRED_REALM_IDS` entry. `decide(B27, CANONICAL_REQUIRED_REALM_IDS)` must return `armed:true`, exit 0 — the **single authorised positive control** and the only permitted `armed:true` outcome in the whole sweep.

### D.2 Sweep A — malformed single-field mutations

Unchanged: every realm index (21) × every required key (11) × every mutation (5: `delete`, `null`, `blank`, `typeChange`, `invalidValue`, defined in rev 27 section D.2). **Count = `|IDS| × |REQUIRED_KEYS| × |MUTATIONS| = 21 × 11 × 5 = 1155.`** Expected for every case: `armed:false`, exit 18, `shared_worker_block_unverified`.

### D.3 Sweep B — valid-but-negative substitutions, and Sweep C — structural battery (now 20 cases)

Sweep B unchanged: 21 realms × 6 in-schema substitutions (`measurable:false`, `timedOut:true`, `repetitionsConsistent:false`, `error:'threw'`, `typeofSharedWorker:'function'`, `constructed:true`). **Count = `|IDS| × |VALID_NEGATIVES| = 21 × 6 = 126`**; **CORRECTED BY REV 29 (ARCH-29): all 126 Sweep B cases ⇒ `shared_worker_block_unverified`. The former 42 presence cases are INVALID under the rev 29 validity matrix, because substituting `typeofSharedWorker:'function'` or `constructed:true` into a clean-absence record leaves `nativeCtor:'absent'`; measured presence is exercised instead by the new Sweep D (rev 29 section D).**

Sweep C, each case applied to `B27`, with the **exact expected `detail`**:

| Case | Description | Expected `detail` |
|---|---|---|
| C1 | extra own property on a record | `record-keys-mismatch:index-0` |
| C2 | inherited property (`Object.create(valid)` with the own key deleted) | `record-prototype-invalid:index-0` |
| C3 | **getter** for a required key | **`record-accessor-property:index-0`** (accessor check now precedes key order) |
| C4 | **setter** for a required key | **`record-accessor-property:index-0`** |
| C5 | Proxy whose trap varies between reads | `record-proxy:index-0` (rev 28: refused as a proxy before the stability check can be reached) |
| C6 | symbol own key | `record-symbol-key:index-0` |
| C7 | sparse array (`delete arr[7]`) | `array-sparse-or-extra-keys` |
| C8 | extra own key on the array | `array-sparse-or-extra-keys` |
| C9 | class-instance record | `record-prototype-invalid:index-0` |
| C10 | null-prototype record | `record-prototype-invalid:index-0` |
| C11 | non-canonical key order (all 11 keys present, reordered, all data properties) | `record-key-order:index-0` |
| C12 | duplicate realm id | `realm-duplicate:F1` |
| C13 | post-validation mutation of a **data value** through the SEAM-28 seam | decision byte-identical to the unmutated decision (`armed:true` control base ⇒ still the control outcome; any other base ⇒ its own refusal), or `record-unstable:index-N` when the variance is visible across the two snapshot reads |
| **C14** | transparent pass-through record Proxy (observationally identical) | `record-proxy:index-0` |
| **C15** | trapping record Proxy (`get`/`getOwnPropertyDescriptor` throws or lies) | `record-proxy:index-0`, **no uncaught exception** |
| **C16** | **revoked** record Proxy | `record-proxy:index-0`, **no uncaught exception** |
| **C17** | `perRealm` itself is a Proxy over a valid array | `input-proxy:perRealm` |
| **C18** | `requiredIds` is a Proxy (and a variant where one element is a Proxy) | `input-proxy:requiredIds` |
| **C19** | nested structured evidence value: a required key holds a Proxy object | `record-value-proxy:<key>:index-0` |
| **C20** | post-validation **proxy** substitution: `snapshotAndValidate` succeeds, the test then replaces a field (or the record) in the caller's original array with a Proxy, then calls `decideFromSnapshot` | decision **unchanged** relative to the unmutated base; the substituted proxy is never read, and if it is ever observed the refusal is `snapshot-proxy:*` — never a new `armed:true` |

**SUPERSEDED BY REV 29 (ARCH-29): the live formulas are Sweep A 21*11*5 = 1155, Sweep B 21*6 = 126 (all refusals), Sweep C 20, Sweep D 21 + 63 + 42 + 63 + 6 = 195 ⇒ 1496 refusals (1475 `shared_worker_block_unverified` + 21 `shared_worker_present`) plus exactly one authorised `armed:true` across 1497 `decide` invocations (rev 29 section D).** Checker assertions, derived from the schema (formulas, not literals):** `|CANONICAL_REQUIRED_REALM_IDS| = 21`, `|REQUIRED_KEYS| = 11`, `|MUTATIONS| = 5`, `|VALID_NEGATIVES| = 6`, `|STRUCTURAL| = 13 + 7 = 20` ⇒ Sweep A `21*11*5 = 1155`, Sweep B `21*6 = 126`, Sweep C `20`, total **1301 refusals** plus **exactly 1** `armed:true` (the `B27` control) across **1302** `decide` invocations. The harness must compute these numbers from the constants and then compare them with this document, as CONF-02A did. **Zero unexpected `armed:true` is a gate condition, not a warning.**

## Section E — alternatives considered

| Alternative | Tradeoff | Verdict |
|---|---|---|
| Accept `PROXY-27` as a documented residual (rev 27 position) | Zero code change; keeps the "pure JavaScript" claim — but CONF-02 measured an actual `armed:true` from a malformed input, which the owner's rule forbids | **Rejected** (owner decision) |
| Structural-only hardening (more double reads, deeper descriptor comparison) | Stays pure ECMAScript; a perfectly transparent proxy is observationally identical by construction, so no amount of structural reading can refuse it | **Rejected** — cannot close the measured arming |
| `WeakSet` of records minted by the probe (provenance tokens) | Refuses any object the probe did not create; but requires a mutable module-level registry, couples `decide` to probe lifecycle, and is defeated by a proxy *of* a registered record unless `isProxy` is also used | **Rejected** as the primary rule; may be revisited as defence in depth |
| `structuredClone` as the proxy filter | Clones through a proxy silently, so a transparent proxy still arms | **Rejected** |
| **`util.types.isProxy` captured once at module initialization, applied at every container boundary before any trap-triggering operation** | Costs the pure-ECMAScript claim and makes the function Node-side by contract; refuses transparent, trapping and revoked proxies without running a trap, in one total check | **Chosen** |
| Keep the unreachable `disagreement` branch "for safety" | Dead code that cannot be exercised; its presence made FC6/IC3-d unattainable as written and invited a false expectation in the row table | **Rejected** — deleted, rows redefined |
| Key-order check before accessor check (rev 27 behaviour) | Produces `record-key-order` for a getter installed with `defineProperty` after a delete, which hides the more security-relevant fact | **Rejected** — accessor check first is canonical |
| An injected hook parameter on `decide` for the mutation test | One function; but a product-reachable hook is an arming influence surface and violates OWNER-25 | **Rejected** in favour of the two internal, test-only exports |

## Section F — failure modes, fallback, observability, rollback

| Failure mode | Behaviour |
|---|---|
| `perRealm`, `requiredIds`, an element, a record, a non-primitive own value or a snapshot is a Proxy | exit 18 `shared_worker_block_unverified` with the matching `input-proxy:*` / `record-proxy:*` / `record-value-proxy:*` / `snapshot-proxy:*` detail; no trap runs; never arms |
| a revoked Proxy anywhere | same; `isProxy` reports it without throwing, so no `TypeError` escapes |
| a trapping Proxy that throws | same; the proxy is refused before any read |
| non-Proxy exotic object with accessors | `record-accessor-property`; prototype, symbol, key-order, primitiveness and stability checks also apply |
| any schema violation, missing/extra/inherited key, symbol key, key-order change, wrong type, out-of-enum value, non-primitive value | exit 18 with the `detail` naming the violation and the record index |
| unknown `schemaVersion` | same, `schema-version-unknown` |
| record not snapshotable (cycle, BigInt, function value) | same, `record-not-snapshotable` |
| two snapshot reads disagree | same, `record-unstable` |
| caller mutates a record after validation (data, accessor or Proxy) | decision unchanged (the decision reads the frozen snapshot) or `record-unstable` / `snapshot-proxy:*` |
| realm results disagree | `realm-not-affirmatively-validated:ID` — the former `disagreement` detail no longer exists |
| probe throws, hangs, times out, or a realm cannot be created | same, via `error`/`timedOut` sentinels |
| capability present in any validated realm | exit 18 `shared_worker_present`, realm id named |
| browser identity not established or any value changed | exit 18 `shared_worker_block_unverified`; never arms |
| probe removed or disabled; gate removed | IC4: execute mode must not arm, and with the gate removed the test must fail |
| `node:util` unavailable or `types.isProxy` not a function at module load | module initialization fails loudly at require time (a configuration/runtime defect, not a decision path); `decide` must never fall back to a proxy-blind mode |

**Fallback:** none to a weaker mode; the only fallback is refusal. **Rollback:** design rollback only — no code ships from rev 28. Reverting to rev 27 restores a contract under which CONF-02 measured a pass-through Proxy arming, so a revert requires a fresh owner decision. **Observability:** B.8; the `detail` list is closed and page-independent. **Determinism:** `decide`, the seam functions, `validateRecord`, `inspectRecordShape` and all three sweeps are browser-free and deterministic on Node 22 and 24, so they are safe CI unit tests; they are also Node-only by contract, which is already true of the whole framework.

## Section G — compatibility and migration

No public surface change; no exit code added; precedence unchanged (`2 > 3 > 18 > 17 > 16 > 15 > 13 > 12 > 11 > 14 > 10 > 1 > 0`). CommonJS only; **no new dependency** — `node:util` is a built-in, available on Node 22 and 24, and is required with the `node:` prefix. Migration is internal and documentation-only today (no caller exists in the tree): (1) the decision module must capture `isProxy` at module initialization and must export `decide` plus the four internal helpers and the two seam functions, with `module.exports` frozen; (2) any text calling `decide` a "pure JavaScript function" or "pure function" must be reworded to "deterministic Node-side decision function using a captured standard-library intrinsic" — see section K; (3) the `disagreement` detail string must be removed from any fixture, checker or vocabulary list; (4) the W6-T checker must assert the **44**-row id set and the sweep counts `1155 / 126 / 20`; (5) `docs/pilot/limitations.md`, when it is created, must state the Proxy rule and its three honest residual notes (Node-only, process-integrity assumption, non-Proxy exotic objects) and must not describe the decision function as pure JavaScript. CI must continue to expect exit 18 from pilot execute mode, must not treat the refusal as a flake, and must match the reason **set** rather than a single string.

## Section H — test seams and acceptance-criteria mapping

| Seam | Rows | Browser needed |
|---|---|---|
| `inspectRecordShape` | FC9, FC12, IC7 (C1..C6, C9..C12, C14..C16, C19), IC9 | no |
| `validateRecord` | FC9, FC11, IC5, IC6 Sweep A | no |
| `snapshotRecord` + freeze order | FC10, IC7 C13 | no |
| `snapshotAndValidate` + `decideFromSnapshot` (SEAM-28, tests only) | FC10, FC12 post-validation, IC7 C13/C20, IC9 case 7 | no |
| `decide` | FC3..FC8, FC11, FC12, IC3, IC4(a,b), IC5, IC6, IC7, IC9, FW-1 decision | no |
| probe → schema conformance | F1..F21, FC1, FC2, IC1, IC2 | yes |
| `BrowserIdentity.assert` | IC8 | yes |
| `NetworkGate.install` refusal before navigation | IC4(c), F-row gate runs | yes |

**AC mapping.** `P18-AC-091` carries the rev 28 proxy rule, the check-order rule, the deletion of the `disagreement` branch, the seam and the withdrawal of the pure-JavaScript claim (edits JSON `ac[]`). The W6-T 44-row inventory and the sweep counts are carried by `counts.rev28Note`; the `detail` vocabulary by `exitCodes.rev28Note`. M-26 maps to FC9, FC10, FC11, **FC12**, IC6, IC7 and **IC9**; M-25 maps to the complete section J (CONF-03) execution; `OPEN-BID-27` maps to IC8 and is explicitly **not** satisfied by rev 28; `SEAM-28` maps to FC10 and C13/C20; `PROXY-27` is withdrawn and its verification obligation is FC12/IC9.

## Section I — ADR-0052 (short ADR; durable and cross-cutting)

**ADR-0052 — the SharedWorker arming decision is a deterministic Node-side function that rejects Proxies by rule, using a standard-library intrinsic captured at module initialization.**
*Status:* Accepted (design). **Amends ADR-0051**, which stays in force for the closed versioned schema, the sentinels, the ordering rule and the precedence.
*Context:* CONF-02 executed the ADR-0051 / rev 27 `decide()` and measured a transparent pass-through Proxy **arming** (`armed:true`, exit 0) while all 1294 other sweep cases refused. The rev 27 position that this was an acceptable stated residual (`PROXY-27`) is rejected by the owner.
*Decision:* `decide` captures `require('node:util').types.isProxy` **once at module initialization** and rejects a Proxy at **every accepted container boundary** (`perRealm`, `requiredIds` and its elements, every realm record, every non-primitive own value, the snapshot) **before** any property enumeration, prototype inspection, descriptor access, cloning or freezing. Every proxy case refuses with `shared_worker_block_unverified`, exit 18, never throwing and never arming. The claim that the decision is a "pure JavaScript function" is **withdrawn**: it is a deterministic Node-side decision function using a captured standard-library intrinsic, with no I/O and no hidden state. The unreachable `disagreement` branch is deleted; the accessor check precedes the key-order check; `decide` is composed of two internal, test-only exports so post-validation mutation immunity is directly testable without any product-reachable hook.
*Consequences:* `PROXY-27` is withdrawn with no exception; the decision function is Node-side by contract and cannot be ported into the page; what remains is stated honestly — Node-only dependence, a process-integrity assumption (an intrinsic captured at initialization cannot protect against an already-compromised process that patched `node:util` earlier), and non-Proxy exotic objects covered by the own-data-property and stability checks; table W6-T becomes 44 rows; Sweep C becomes 20 cases; verification is owed to CONF-03.
*Alternatives rejected:* section E. *Failure modes, fallback, rollback, observability:* section F.

## Section J — executed W6-T conformance gate (CONF-03), required before Security

**SUPERSEDED BY REV 29 (ARCH-29): CONF-03 has EXECUTED and returned PARTIAL (`docs/phase-18-conf03-results.md`) with a required-row failure (FC1 mismatch-injection). The live gate is CONF-04, rev 29 section J: the full 49-row matrix on Node 22.19.0 and 24.21.0, all sweeps including Sweep D, the corrected FC1 expectation and the MT-1 meta-test. CONF-03 must never be presented as a pass.**

CONF-01 and CONF-02 are **superseded, not upgraded**; both stay **PARTIAL** records of what they executed. Rev 28 executes nothing; `CONF-03` and `W6T-GATE` stay NOT EXECUTED / NOT SATISFIED.

### J.1 Executed-gate spec

1. **Coverage:** every row of the consolidated **44**-row table C, each row executed **independently at least 3 times on Node 22.19.0 and at least 3 times on Node 24.21.0**. A row covered only as part of another row's array run does not count.
2. **Per-row record:** row **ID**, **expected**, **actual**, **reason**, **exit**, **armed**, **detail**, **Node version and browser identity**, **repetition index**, and the **target/network observation** for that repetition.
3. **Proxy rows:** all seven FC12/IC9 cases, each ≥3 repetitions per Node version, each asserting `armed:false`, exit 18, `shared_worker_block_unverified`, the exact `detail`, and **that no exception escaped `decide`** (the harness must record the absence of a thrown error explicitly, including for the revoked and throwing-trap cases).
4. **Real-browser rows:** fresh isolated state per run — a unique browser profile directory and a unique process group per run, fresh empty context, explicit close, and **cleanup verified**, including a scan for **stale processes left by earlier CONF runs** (CONF-02 found two CONF-01 fixture servers still listening). The verification command and its output are recorded.
5. **Network:** **zero non-loopback requests and no external target access in every refusal run**, counted and recorded as `n of N`.
6. **Arming:** the only `armed:true` outcomes permitted anywhere are the explicitly authorised all-absent positive controls with complete valid evidence (`B27` / IC3-a). The sweeps must report **zero unexpected `armed:true`**; **one** unexpected arming — including from any proxy case — is a gate failure.
7. **Sweeps:** Sweep A 1155, Sweep B 126, Sweep C **20** (including C14..C20), counts re-derived from the schema constants before comparison, 3 full passes per Node version.
8. **Mutation sweeps including proxy mutations:** every C13/C20 variant must be executed through the SEAM-28 seam, mutating the caller's **original** objects between `snapshotAndValidate` and `decideFromSnapshot`, with at least: delete a key, change a value, install a getter, replace a value with a Proxy, replace the whole record with a Proxy.
9. **Identity wrapper:** section J.2 unchanged (scratch executable wrapper + CDP corroboration, re-verified immediately before the simulated run step; `browser.process()` and `ps` discovery are not acceptable). If `SystemInfo.getProcessInfo` is unavailable, record it as unavailable; do not substitute another source silently.
10. **FW-1:** keeps its honest statement that WebSocket behaviour is **unmeasured**; its required fail-closed decision is executed 3× per Node version as a decision row.
11. **Honest handling of API or network failure:** if a Playwright, CDP, fixture or network operation fails, the harness must (a) **preserve** all evidence already collected, (b) record the exact error and the affected row ids as **NOT MEASURED**, (c) report the gate as **PARTIAL**, and (d) **never** replace a missing measurement with an inferred, reused, defaulted or earlier-run value. A retry is permitted only when it is recorded as a new repetition with its own row record.
12. **Outcome rule:** a refusal is a **PASS** when it is the expected outcome. If any row is unmeasured the gate reports **PARTIAL** and arming stays refused. Documentation alone must not close M-25 or M-26.
13. **Output:** one evidence document plus the per-row table; input to M-25 and M-26 closure together with a Security review.

### J.2 Browser identity (measurement scaffolding only — never product code)

Unchanged from rev 27 section J.2 in full (scratch executable wrapper recording its own PID, start time, normalized argument vector and a random per-run token, then `exec`ing the pinned Chromium so the PID is unchanged; independent executable hash; CDP corroboration via `Browser.getVersion` and, where supported, `SystemInfo.getProcessInfo`; re-verification immediately before the simulated run step; any failure or change ⇒ IC8 refusal, never arming; the product-side equivalent stays `OPEN-BID-27`). CONF-02's start-time whitespace normalization is adopted as a harness requirement.

### J.3 Node-side rows

FC3..FC12, IC3, IC5, IC6, IC7, IC9 and the FW-1 decision need no browser. They run on both Node versions, 3 repetitions each, recorded with `browser identity: n/a (node-side)`. They are **Node-side**, not pure-ECMAScript: the harness must run them under `node` and must record both Node versions, because the proxy rule depends on `util.types.isProxy`.

### J.4 FC2 and `fc2Pass`

Unchanged from rev 27 section J.4: FC2 passes only when, in every measurable realm, each of the five named sub-observations holds (delete, `defineProperty`/`Reflect.defineProperty` redefinition, assignment, prototype and `__proto__` manipulation, `with`-scope shadowing), each leaving the pre-captured native constructor usable and the decision byte-identical. CONF-02 measured `fc2Pass:true` with its sub-observations; CONF-03 must re-emit them per realm.

### J.5 FC1 as an independently executable row

**Procedure.** For each measurable realm, for each repetition: (1) before any page script runs, `addInitScript` captures the native constructor reference and records a **capture marker** (`present` / `absent`) plus the constructor's identity fingerprint into a Falcon-owned variable the page cannot name; (2) the realm is created and `evaluate` reads `typeof SharedWorker`, the own-property descriptor and the comparison of the live binding against the pre-captured reference; (3) the realm record's `nativeCtor` is set from that comparison only — `present` on agreement with a present reference, `absent` on agreement with an absent one, `mismatch` on disagreement, `uncaptured` when step (1) did not run.
**Inputs.** The loopback fixtures of the realm under test; no external target.
**Expected result — CORRECTED BY REV 29 (ARCH-29): agreement in every measurable realm ⇒ the row PASSES with `nativeCtor` `present` or `absent` as measured AND the record classified by the rev 29 validity matrix; the mismatch-injection sub-case expects EXACTLY `armed:false`, exit 18, `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:<realm id>` — `shared_worker_present` is a FAILURE for that sub-case, and a harness expectation is never the oracle.** **Mismatch-injection sub-case:** the fixture replaces `window.SharedWorker` with a look-alike before the read ⇒ `nativeCtor:'mismatch'` ⇒ `armed:false`, exit 18, `shared_worker_block_unverified`, `detail realm-not-affirmatively-validated:<realm id>`.
**Evidence recorded.** Per realm per repetition: the capture marker, the evaluate-time read, the comparison outcome, the resulting `nativeCtor` value, the decision, the Node version, the browser identity and the network observation. FC1 is its **own** run: it may not be inferred from the `nativeCtor` field of another row's array run (the CONF-02 defect).

### J.6 IC4 as an independently executable row

**Procedure.** Three sub-cases, each in execute mode against a loopback fixture:
(a) **probe disabled** — the harness replaces the capability probe with a stub that returns an empty `perRealm` array (configuration is not used; the stub is injected in the harness copy of the arming path);
(b) **probe partial** — the stub returns a valid array with one required realm omitted;
(c) **gate removed** — the harness deletes the `decide` call from its copy of the arming path.
**Expected result.** (a) `armed:false`, exit 18, `shared_worker_block_unverified`, `detail realm-missing:F1`; (b) the same with `realm-missing:<first absent id>`; (c) **the test MUST FAIL** — the harness asserts that the suite reports a failure when the gate is removed, and a green run in sub-case (c) is itself the recorded defect. No network request beyond loopback in any sub-case; no arming in any sub-case.
**Evidence recorded.** The exact stub or deletion applied, the resulting verdict, the exit code observed from the process, the assertion outcome, 3 repetitions per Node version.

### J.7 F13 and F14 popup realms

CONF-02 recorded `error:'not-created'` for both, so the rows' primary expectation was not observed. CONF-03 **must** create them or record the exact reason:

1. **F13 (same-origin):** the harness triggers `window.open('<loopback same-origin fixture>')` from a user-gesture-equivalent `page.evaluate`, acquires the popup with `page.waitForEvent('popup')` (and, as a fallback, `context.waitForEvent('page')`), waits for its load state, then runs the `popup.page.evaluate` measurement.
2. **F14 (cross-origin, `noopener`):** the harness opens the second loopback port with `noopener`; because the opener relationship is severed, the popup must be acquired with `context.waitForEvent('page')`, not from the opener handle, then measured the same way. The harness must assert that the acquired page's URL is the expected cross-origin fixture.
3. **Expected results.** *Created and present:* `typeof SharedWorker === 'function'` or `constructed:true` in the popup ⇒ row result `shared_worker_present`, exit 18, `armed:false`. *Created and clean absence:* the row records a clean negative. *Not created:* `error:'not-created'` ⇒ `shared_worker_block_unverified`, exit 18, and the row is recorded as **REALM NOT MEASURED** with the exact failure reason (timeout value, event never fired, popup blocked, URL mismatch) — the gate stays PARTIAL and the row is never written as a pass.
4. **Evidence recorded.** The acquisition mechanism used, the popup URL, the wait timeout, the measurement, 3 repetitions per Node version, and explicit confirmation that the popup was closed and no process or profile leaked.

### J.8 Cleanup

At the end of the run: no harness, wrapper, Chromium, fixture-server or scratch-listener process, and no profile directory, may remain. The harness must additionally scan for and report **stale processes from earlier CONF runs** (CONF-01 and CONF-02), terminating only processes it can attribute to a CONF run and recording exactly what it terminated and what it left alone.

## Section K — repository-wide stale-reference search

Command form: `git grep -nI -- "<pattern>" 98db206 -- docs/` over `pure JavaScript function`, `pure JavaScript`, `pure function`, `PROXY-27`, `B.7`, `42 rows`, `42-row`, `disagreement`, `13 structural`, `record-accessor-property`. The untracked rev 24 drafts are excluded. Evidence documents (`docs/phase-18-w6t-conformance-results.md`, `docs/phase-18-conf02*-results.md`, `docs/phase-18-spike-*-findings.md`) are **not edited**: they are records of what was executed and are referenced from this patch instead. Every hit and its disposition:

| Hit | Disposition |
|---|---|
| `phase-18-rev27-patch.md:234` B.7 "Pure JavaScript **cannot** distinguish a Proxy…" and the B.7 heading | **LIVE → fixed.** In-place note at the `### B.7 Stated residual: Proxy` heading: section B.7 is WITHDRAWN; the rule is rev 28 B.7; the pure-JavaScript claim is withdrawn |
| `phase-18-rev27-patch.md:73` "### B.5 Reference text (pure functions, no I/O)" | **LIVE → fixed.** In-place note: heading claim withdrawn, code block superseded by rev 28 B.5 (proxy rejection first, accessor before key order, `disagreement` deleted) |
| `phase-18-rev27-patch.md:8` status line | **LIVE → fixed.** One in-place note disposing of **all nine** `42 rows` occurrences in that document (→ 44), the pure-function characterisation and the `PROXY-27` residual, so no hit in the file is left pointing at a withdrawn claim |
| `phase-18-rev27-patch.md:251` "Authoritative row count after rev 27: 42 rows" and `:320` the 42-row total | **LIVE → fixed** (two in-place notes: 44 rows; single source is rev 28 section C) |
| `phase-18-rev27-patch.md:346` "Sweep C (13 named cases…)" | **LIVE → fixed** (in-place note: 20 cases; C3/C4 detail is `record-accessor-property`; totals 1155/126/20) |
| `phase-18-rev27-patch.md:406` section J heading (CONF-02) | **LIVE → fixed** (in-place note: CONF-02 executed and is PARTIAL; the live gate is CONF-03, rev 28 section J) |
| `phase-18-rev27-patch.md:403` ADR-0051 consequences ("Proxy indistinguishability is a stated residual (`PROXY-27`); table W6-T is consolidated at 42 rows") | **LIVE → fixed** (in-place note: amended by ADR-0052; residual withdrawn; 44 rows) |
| `phase-18-rev27-patch.md:468` section L Security scope "the **B.7 Proxy residual (`PROXY-27`)**" | **LIVE → fixed** (replaced in place by the rev 28 proxy-rejection rule and its honest residual notes) |
| `phase-18-acceptance-criteria.json:269` openItem `PROXY-27` ("Pure JavaScript cannot distinguish a Proxy…") | **LIVE → fixed** by the rev 28 `openItems` `appendText` on `PROXY-27`: superseded and withdrawn, replaced by the `isProxy` rule, with the three honest residual notes and the CONF-03 verification obligation |
| `phase-18-acceptance-criteria.json:1247` AC-091 requirement (rev 26/27 text, "CLOSED, TOTAL pure function decide(perRealm, requiredIds)") | **LIVE → fixed** by the rev 28 `ac[]` `appendText`: the pure-function characterisation is withdrawn, the proxy rule, the check order, the branch deletion and the seam are stated |
| `phase-18-acceptance-criteria.json` `counts.rev27Note` (42 rows) and `exitCodes.rev27Note` (`disagreement` in the vocabulary) | **Disposed by addition:** `counts.rev28Note` (44 rows, 20 structural cases, formulas) and `exitCodes.rev28Note` (new proxy details; `disagreement` withdrawn; accessor-before-key-order). The rev 27 notes are not rewritten, so the applied-note history stays readable |
| `phase-18-rev23-patch.md:64` and `:209` ("42 rows") | **LIVE → fixed** (in-place corrections to 44 rows and to the rev 28 contract) |
| `phase-18-rev25-patch.md:145` ("authoritative total is 42 rows") | **LIVE → fixed** (in-place correction to 44 rows in rev 28 section C) |
| `phase-18-rev26-patch.md:223` and `:265` ("SUPERSEDED BY REV 27: 42 rows") | **LIVE → fixed** (in-place corrections: 44 rows, gate CONF-03, checker counts 1155/126/20, add FC12 and IC9) |
| `phase-18-rev26-patch.md:8` and `phase-18-plan.md:3` ("42 decisive runs") | **Not a row total** — SPIKE-W6 run count. **No edit** |
| `phase-18-rev26-patch.md:55` "### B.5 … (pure function, no I/O)" and `:178` "the pure function" | **Superseded-revision text already carrying a rev 27 SUPERSEDED note at the same heading; the rev 28 B.5 note in `phase-18-rev27-patch.md` names the withdrawal of the pure-function characterisation for the live contract. No further edit** — rewriting a twice-superseded revision would rewrite history |
| `phase-18-rev25-patch.md:194` "The decision function is a pure function and the primary test seam" | **Historical ADR-0050 consequence in a superseded revision, already marked NO LONGER THE SINGLE SOURCE by the rev 27 edit at `:145` and the rev 28 edit on the same anchor. Disposed by ADR-0052's explicit withdrawal of the pure-function characterisation; no further edit** |
| `phase-18-rev12-patch.md`, `phase-16-parallel-execution.md`, `phase-18-design-review-10.md` "pure function" | **Unrelated subjects** (`chainDeadlineMs`, `SiteSweep.signatureOf`). **No edit** |
| `phase-18-rev21-patch.md` / `phase-18-rev22-patch.md` "B.7" | **Different documents' own section B.7**, unrelated to the Proxy residual. **No edit** |
| `phase-18-plan.md` | Checked for `42 rows`, `PROXY-27`, `pure function`: **no live hit**. **No edit** |
| `docs/security/phase-18-threat-model.md` | Checked for `W6-T`, `decide(`, `PROXY`: **no hit**. **No edit** |
| `docs/security/phase-18-design-review-23.md` and the CONF/SPIKE evidence documents | **Evidence, left as written** by instruction; rev 28 answers them in the design and references them |

## Section L — handoff constraints

- **Developer:** implement `inspectRecordShape`, `snapshotRecord`, `validateRecord`, `snapshotAndValidate`, `decideFromSnapshot` and `decide(perRealm, requiredIds)` exactly as section B.5, including the **order of checks**. Capture `isProxy` **once** at module initialization via `require('node:util').types.isProxy`; never re-read it, never accept it as a parameter, never read it from input or page-controlled state. Run proxy rejection before enumeration, prototype inspection, descriptor access, cloning or freezing, at every accepted container boundary. Freeze `module.exports`. Do not add a hook, flag, environment variable, config key or exemption (OWNER-25); do not describe `decide` as a pure JavaScript function; do not emit `disagreement` or `shared_worker_blocked`; do not default, coerce or fill a missing measurement; do not implement any browser-identity mechanism (`OPEN-BID-27` is undecided, and the J.2 wrapper must never enter product code). `Logger.*` only, `fs.promises.*` for evidence writes, CommonJS.
- **QA:** fixtures from the consolidated **44-row** table C only; the checker asserts the id set, the 44-row total and the sweep counts **derived from the schema constants** (1155 / 126 / 20; 1301 refusals + exactly 1 authorised `armed:true` across 1302 invocations). Generate sweep records from the schema, not by hand. Exercise all seven proxy cases including **revoked** and **throwing** traps and assert no exception escapes; exercise post-validation mutation through the SEAM-28 seam only; use the exact expected `detail` strings of C.3, C.4 and D.3 (note `record-accessor-property` for C3/C4 and `realm-not-affirmatively-validated:ID` for FC6/IC3-d). F5, F7, F11 and F21 stay required fail-closed. `armed:true` only at unit level, only for IC3-a/`B27`. Node-side rows on both Node versions, 3 repetitions; browser rows per J.1, with F13/F14 created per J.7 or recorded NOT MEASURED, and FC1/IC4 executed per J.5/J.6.
- **Security:** review scope is the B.3/B.5/B.7 proxy rule (capture-at-initialization, boundary coverage, check order, totality), whether any input shape can still arm, the **withdrawal of `PROXY-27`** and the honesty of the three remaining statements (Node-only, process-integrity assumption, non-Proxy exotic objects), the deletion of the `disagreement` branch, the accessor-before-key-order change, the SEAM-28 exports as a potential influence surface, the section D sweep definition at 20 structural cases, the section J.2 identity scaffolding and `OPEN-BID-27`, the J.5/J.6/J.7 row definitions, the section K dispositions, and the M-25/M-26 closure conditions (executed CONF-03 **plus** your review; documentation alone must not close either). CONF-02 must not be accepted as a pass.
- **DevOps:** no workflow or `NODE_OPTIONS` change in rev 28; GoogleSearchTest stays out of CI; the Node-side rows are deterministic and browser-free and remain the only part suitable for CI today, but they must run under both Node 22.19.0 and Node 24.21.0 because the rule depends on a Node intrinsic; `node:util` is a built-in, so no dependency or lockfile change. CI must expect exit 18, must not treat the refusal as a flake, and must match the reason set. CONF-03 is a scratch run, not a CI job: unique profile and process group per run, cleanup verified including stale processes from CONF-01 and CONF-02, no non-loopback request, no secret written.

## Needs anchors (not applied by rev 28)

Every `old` anchor in `phase-18-rev28-edits.json` was verified by exact string count to occur **exactly once** in its target file at `98db206` (script-verified, 14 anchors, 0 failures). No `docEdit` targets an evidence document. Short SHAs only; no 40-character SHA; no AI attribution. `docs/pilot/limitations.md` still does not exist, so its rev 28 obligation (section G item 5) stays a DOC-gate obligation. Nothing in this revision is committed and nothing is executed.
