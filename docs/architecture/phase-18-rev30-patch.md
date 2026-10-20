# Phase 18 — architecture revision 30 (ARCH-30)

**Base revision:** `7891f50` on `docs/phase-18-architecture` (rev 29 `677fe69`, rev 28 `4f9e2d5`).
**Inputs consumed:** `docs/security/phase-18-design-review-24.md` (SEC-25, APPROVE WITH CONDITIONS, 0 blockers, 1 major M-26 open, 5 new minors m-91..m-95), `docs/architecture/phase-18-rev29-patch.md` (B.4a, B.5, C, D, J), `docs/architecture/phase-18-rev28-patch.md` (B.5 full reference), `phase-18-rev29-edits.json`, and the owner decision recorded in the ARCH-30 task packet.
**Machine-applicable edits:** `docs/architecture/phase-18-rev30-edits.json` (15 anchors, each verified by exact string count to occur exactly once at `7891f50`; no `docEdit` targets an evidence document).
**Status carried forward.** Counts stay **98 total / 89 Must / 6 Should / 3 Could**; C6-T stays **27 / 5**; **M-23 and M-24 stay closed**; **M-25 stays CLOSED AS A DESIGN FINDING** per SEC-25 with its implementation gates intact; **M-26 is FIXED BY DESIGN here and is not accepted as a residual**; O-1 and the `PILOT_APPROVAL_RUN_TOKEN` text are untouched; OWNER-24 and OWNER-25 stay **DECIDED**; `PROXY-27` stays **withdrawn**; the supported-browser set stays **EMPTY**; scope stays Chromium only. Rev 30 executes nothing and commits nothing.

## Section A — context and constraints

SEC-25 confirmed that the rev 29 validity matrix (B.4a) is total and correct for every record that passes schema validation, and that `decide29.js` matches the rev 29 B.5 text. The hole was one layer out: the decision read the **caller's** `requiredIds` array by **calling a method on it** (`requiredIds.slice()`, then `req.slice()` for the snapshot). With a non-enumerable own `slice` override, or with a swapped array prototype, the snapshot's required set was cut to `['F1']`, and the reviewer's scratch run armed with `F2` VALID-PRESENT, `F3` `nativeCtor:'mismatch'` and `F21` unmeasured. Four minors sit alongside it: `Object.freeze(module.exports)` ran before the exports object was replaced (m-91); `decideFromSnapshot` was exported and armed on an empty required set (m-92); the MT-1 checker read the harness's own `expected*` fields and skipped 34 of 237 rows (m-93); getters on `requiredIds` indices ran caller code (m-94); the Sweep D boundary reading was never stated (m-95).

The owner did **not** accept M-26 as a process-integrity residual. Rev 30 removes the attack surface rather than documenting it.

**Constraints.** Design text only; no production source file, `package.json` script or workflow step is edited by this revision. `decide` stays synchronous, deterministic, total and CommonJS, with no I/O, clock, network, filesystem or environment read. No new public surface, CLI flag, environment variable, configuration key, hook or bypass (OWNER-25). No new reason code and no new exit code. `schemaVersion` stays `1`.

### A.1 What rev 30 changes

1. **`requiredIds` is removed from the production API.** The entry point is `decide(perRealm)`. The required-realm identifier list is **private**: built from string literals at module initialization, frozen, never exported, never read from input.
2. **No caller method, getter, setter, iterator or trap is ever invoked.** Caller array elements are read exactly once each through own data-property descriptors obtained from captured intrinsics.
3. **The decision iterates only the canonical list**, and asserts inside the function that the list is still 21 frozen literal ids, so an empty or reduced required set cannot arm (m-92).
4. **`decideFromSnapshot` and `snapshotAndValidate` are private and unexported**; SEAM-28 is redesigned around a test-only source loader plus an internal `createDecider({testHooks})` factory that the product entry never exports and never calls with hooks.
5. **`module.exports = Object.freeze({ decide })` is the last statement** of the module (m-91).
6. **MT-1 is replaced** by a contract-derived machine-readable oracle with total coverage and no silent skips, plus MT-2, its self-test (m-93).
7. **Sweep D's boundary rule is stated** (m-95); **Sweep E** (18 hostile-container cases) is added; **FC16**, **FC17** and **MT-2** are added; **FC8** and every other `requiredIds`-based row or sub-case is re-expressed as a canonical-set or `perRealm`-inventory case. **52 rows** authoritative.
8. **The popup gesture stays UNVERIFIED** and becomes a CONF-05 **recording** requirement.
9. Section J becomes the **CONF-05** gate.

Rev 30 weakens nothing. Every change either refuses in more input shapes or records a measurement obligation. No outcome that previously refused now arms.

### A.2 Affected components and trust boundaries

| Component | Change | Trust boundary |
|---|---|---|
| `SharedWorkerArmingDecision` module (the `decide30.js` reference) | signature, container reads, private canonical list, export surface, test seam | **untrusted input** on one side (`perRealm`, assembled from browser-side evidence), **arming authority** on the other |
| `SharedWorkerCapabilityProbe` | unchanged; still emits `nativeCtor` only from the FC1 comparison | page/browser realm, never an arming authority |
| Pilot arming call site | passes `perRealm` only; must stop passing a required-id list | Node process |
| W6-T harness and its oracle | oracle moves out of the harness into a contract-derived expectations file | harness is **not** trusted to author pass flags |
| Report block `sharedWorkerCapability` | unchanged plus the rev 29 per-realm classification | operator-visible output |

The decisive boundary is the one SEC-25 broke: **everything the caller supplies is data, never behaviour.** After rev 30 the only caller-reachable code path is a sequence of own-descriptor reads of a known non-proxy array with the captured `Array.prototype`.

### A.3 Data and control flow

`probe (browser realms) → evidence records (plain objects) → pilot call site → decide(perRealm) → [proxy rejection → own-descriptor container read → per-record shape/snapshot/schema validation → freeze → canonical-list assertion → matrix validation of all 21 canonical records → presence classification → arming] → { armed, exit, reason, detail } → Logger.error + report block → process exit code`.

The required-realm set no longer crosses any boundary: it is a module-private constant on the arming side of the line.

## Section B — the decision contract after rev 30

### B.1–B.3 (carried forward with one deletion and one addition)

Rev 28 B.1–B.3 and rev 29 B.1–B.3 stay in force **except** for the `requiredIds` rules, which are withdrawn with the parameter. Proxy rejection at every accepted container boundary, ahead of everything else, stays verbatim. The version-1 `sharedWorkerRealmEvidence` schema is unchanged (11 own data properties, canonical order, closed enumerations, primitive own values, absence of a field is always UNVERIFIED).

**Withdrawn detail strings** (the parameter they described no longer exists): `input-proxy:requiredIds`, `required-id-set-malformed`, `required-id-unknown`, `required-id-missing`.

### B.3a Container rules (normative, new)

Applied to `perRealm` before anything else, in this order:

1. `isProxy(perRealm)` ⇒ `input-proxy:perRealm`. The captured intrinsic is read first, so no trap can run.
2. `perRealm` must be a non-null object and `Array.isArray(perRealm) === true`, else `input-not-array`.
3. `Object.getPrototypeOf(perRealm)` must be **identical to the captured `Array.prototype`**, else `input-prototype-invalid:perRealm`. This refuses the swapped-prototype half of the SEC-25 reproduction.
4. `length` is read through its **own** descriptor; it must be a data descriptor holding a non-negative integer, else `input-length-unreadable:perRealm`; a length above **1024** ⇒ `input-length-excessive:perRealm` (a bounded total function; the real maximum is 22).
5. No symbol own keys, and exactly `length + 1` own names (the indices plus `length`), else `array-sparse-or-extra-keys`. This refuses extras and sparse arrays.
6. Each index `0..length-1` is read **exactly once** through `Object.getOwnPropertyDescriptor`. A missing index ⇒ `array-sparse-or-extra-keys`; an accessor ⇒ `array-accessor-element:index-N` (m-94); anything that is neither ⇒ `array-descriptor-malformed:index-N`.
7. The copy is built with an index loop over captured intrinsics. **`.slice`, `.map`, `.forEach`, spread and the iteration protocol are forbidden on any caller value**, as is any method or accessor call on it.

**Added detail strings**, all under the unchanged reason `shared_worker_block_unverified` with exit 18 and `armed:false`: `input-prototype-invalid:perRealm`, `input-length-unreadable:perRealm`, `input-length-excessive:perRealm`, `array-accessor-element:index-N`, `array-descriptor-malformed:index-N`, `canonical-required-set-corrupt`. No detail carries caller-controlled text; page-supplied strings still never reach a detail.

### B.4 Precedence (unchanged from rev 29)

1. Any invalid, incomplete, inconsistent or unverified required record (including any proxy, and now any hostile container) ⇒ `armed:false`, exit **18**, `shared_worker_block_unverified`, detail as specified — this **wins over any presence**;
2. otherwise any **VALID-PRESENT** canonical realm ⇒ `armed:false`, exit **18**, `shared_worker_present`, detail `realm:<id>`;
3. only when **every** canonical required record is **VALID-ABSENT** ⇒ `armed:true`, exit 0, and then only if OWNER-24 holds.

### B.4a Validity matrix (unchanged from rev 29)

The rev 29 B.4a matrix, its common preconditions and its agreement rule are **reprinted by reference and unchanged**: `nativeCtor` MUST be `'present'` iff `typeofSharedWorker` is `'function'` and `'absent'` iff `'undefined'`; `'mismatch'` and `'uncaptured'` are never valid; every other combination is INVALID. SEC-25 found the matrix total and correct, so rev 30 does not touch it.

### B.4b Canonical required set (normative, new)

The 21 required realm ids are a module-private frozen array of **string literals**, with a frozen `Set` of the same literals for membership. It is never a parameter, never a property of an input, never exported, never rebuilt from input, and never mutated. `decideFromSnapshot` asserts, on every call, that the array is frozen and has exactly **21** entries; a failure ⇒ `armed:false`, exit 18, `shared_worker_block_unverified`, detail `canonical-required-set-corrupt`. This assertion is unreachable in a sound process and exists as defence in depth so that an empty or reduced required set can never arm.

### B.5 Reference module (normative; supersedes rev 28 B.5 and rev 29 B.5 in full)

Normative behaviour; an implementation may differ in style but not in outcome or in **order of checks**. The whole file follows. The factory and hook mechanism used by tests is the clearly separated last section.

```js
'use strict';
// decide30.js - Phase 18 SharedWorker arming decision, architecture revision 30.
//
// Deterministic, synchronous, total, CommonJS. No I/O, no clock, no network, no
// filesystem, no environment read. Node-side by contract: exactly one standard-library
// intrinsic is used, captured once here at module initialization.
//
// PRODUCT EXPORT SURFACE: { decide } and nothing else, frozen as the LAST statement.
// decide(perRealm) takes ONE argument. There is no requiredIds parameter: the required
// realm id list is private, frozen, built from literals and never read from input.
// No caller method, getter, setter, iterator or proxy trap is ever invoked.

const { types } = require('node:util');

// --- captured intrinsics: every read of a caller value goes through these ----------
// None of these is ever re-read, taken from an argument, or resolved through a
// caller-reachable prototype chain.
const isProxy = types.isProxy;
const ObjectFreeze = Object.freeze;
const ObjectIsFrozen = Object.isFrozen;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const ArrayIsArray = Array.isArray;
const ArrayPrototype = Array.prototype;
const ownHasOwnProperty = Object.prototype.hasOwnProperty;
const JSONparse = JSON.parse;
const JSONstringify = JSON.stringify;
const MapCtor = Map;
const SetCtor = Set;
const NumberIsInteger = Number.isInteger;
const StringCtor = String;

function hasOwnKey(o, k) { return ownHasOwnProperty.call(o, k); }

// --- private canonical required-realm set (literals, frozen, never exported) -------
const CANONICAL_REQUIRED_COUNT = 21;
const CANONICAL_REQUIRED_REALM_IDS = ObjectFreeze([
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11',
  'F12', 'F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21'
]);
const CANONICAL_REQUIRED_INDEX = (function buildCanonicalIndex() {
  const m = new MapCtor();
  for (let i = 0; i < CANONICAL_REQUIRED_REALM_IDS.length; i += 1) {
    m.set(CANONICAL_REQUIRED_REALM_IDS[i], i);
  }
  return m;                      // module-private; never exported, never handed out
})();

const SCHEMA_VERSION = 1;
const MAX_RECORDS = 1024;        // bounded total function; the real maximum is 22

const REQUIRED_KEYS = ObjectFreeze([
  'schemaVersion', 'id', 'mechanism', 'measurable', 'error', 'timedOut',
  'typeofSharedWorker', 'descriptor', 'nativeCtor', 'constructed', 'repetitionsConsistent'
]);

const ENUMS = ObjectFreeze({
  mechanism: ObjectFreeze(['page.evaluate', 'frame.evaluate', 'popup.page.evaluate',
                           'serviceworker.probe', 'unavailable']),
  error: ObjectFreeze(['none', 'threw', 'timeout', 'not-created', 'frame-not-found',
                       'unexpected-success-no-allow-scripts', 'unreachable']),
  typeofSharedWorker: ObjectFreeze(['undefined', 'function', 'object', 'other', 'unreadable']),
  descriptor: ObjectFreeze(['absent', 'present-data', 'present-accessor', 'unreadable']),
  nativeCtor: ObjectFreeze(['absent', 'present', 'mismatch', 'uncaptured'])
});
const ENUM_KEYS = ObjectFreeze(['mechanism', 'error', 'typeofSharedWorker',
                                'descriptor', 'nativeCtor']);
const BOOLEAN_KEYS = ObjectFreeze(['measurable', 'timedOut', 'constructed',
                                   'repetitionsConsistent']);
const PRESENT_DESCRIPTORS = ObjectFreeze(['present-data', 'present-accessor']);

// Decisions are frozen so that a caller cannot edit a returned verdict in place.
function UNVERIFIED(detail) {
  return ObjectFreeze({
    armed: false, exit: 18, reason: 'shared_worker_block_unverified', detail: detail
  });
}
function PRESENT(id) {
  return ObjectFreeze({
    armed: false, exit: 18, reason: 'shared_worker_present', detail: 'realm:' + id
  });
}
function ARMED() {
  return ObjectFreeze({ armed: true, exit: 0, reason: 'shared_worker_absent_all_realms' });
}

// --- step 0: proxy rejection, before anything that could run a trap ---------------
// isProxy() reads an internal slot: it reports a Proxy, INCLUDING a revoked Proxy,
// without invoking any trap and without throwing.
function proxyFault(v) { return isProxy(v); }

// --- descriptor helpers: the ONLY way a caller value is ever read ----------------
// Object.getOwnPropertyDescriptor returns a fresh ordinary object, so inspecting it
// cannot run caller code. A usable data descriptor has an own `value` and no accessor.
function isDataDescriptor(d) {
  return d !== undefined && d !== null && typeof d === 'object'
    && ObjectGetPrototypeOf(d) === ObjectPrototype
    && hasOwnKey(d, 'value') && !hasOwnKey(d, 'get') && !hasOwnKey(d, 'set');
}
function isAccessorDescriptor(d) {
  return d !== undefined && d !== null && typeof d === 'object'
    && (hasOwnKey(d, 'get') || hasOwnKey(d, 'set'));
}

// --- step 1: read the caller's container WITHOUT calling anything on it -----------
// Refuses proxies, altered prototypes, unreadable or excessive lengths, sparse holes,
// extra own properties, symbol keys, accessor elements and malformed descriptors.
// Each index is read EXACTLY ONCE. No .slice/.map/.forEach/spread/iterator is used.
function readOwnArrayElements(arr, label) {
  if (proxyFault(arr)) return { ok: false, detail: 'input-proxy:' + label };
  if (arr === null || typeof arr !== 'object') return { ok: false, detail: 'input-not-array' };
  if (ArrayIsArray(arr) !== true) return { ok: false, detail: 'input-not-array' };
  if (ObjectGetPrototypeOf(arr) !== ArrayPrototype) {
    return { ok: false, detail: 'input-prototype-invalid:' + label };
  }
  const lengthDescriptor = ObjectGetOwnPropertyDescriptor(arr, 'length');
  if (!isDataDescriptor(lengthDescriptor)
      || typeof lengthDescriptor.value !== 'number'
      || !NumberIsInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0) {
    return { ok: false, detail: 'input-length-unreadable:' + label };
  }
  const n = lengthDescriptor.value;
  if (n > MAX_RECORDS) return { ok: false, detail: 'input-length-excessive:' + label };
  if (ObjectGetOwnPropertySymbols(arr).length !== 0) {
    return { ok: false, detail: 'array-sparse-or-extra-keys' };
  }
  if (ObjectGetOwnPropertyNames(arr).length !== n + 1) {   // indices + 'length' only
    return { ok: false, detail: 'array-sparse-or-extra-keys' };
  }
  const items = [];
  for (let i = 0; i < n; i += 1) {
    const d = ObjectGetOwnPropertyDescriptor(arr, StringCtor(i));
    if (d === undefined) return { ok: false, detail: 'array-sparse-or-extra-keys' };
    if (!isDataDescriptor(d)) {
      if (isAccessorDescriptor(d)) {
        return { ok: false, detail: 'array-accessor-element:index-' + i };
      }
      return { ok: false, detail: 'array-descriptor-malformed:index-' + i };
    }
    items[items.length] = d.value;        // read ONCE; no getter can run
  }
  return { ok: true, items: items, length: n };
}

// --- step 2: structural inspection of a record; runs no caller code --------------
function inspectRecordShape(r) {
  if (proxyFault(r)) return 'record-proxy';                        // FIRST, always
  if (r === null || typeof r !== 'object' || ArrayIsArray(r)) return 'record-not-plain-object';
  if (ObjectGetPrototypeOf(r) !== ObjectPrototype) return 'record-prototype-invalid';
  if (ObjectGetOwnPropertySymbols(r).length !== 0) return 'record-symbol-key';
  const names = ObjectGetOwnPropertyNames(r);
  if (names.length !== REQUIRED_KEYS.length) return 'record-keys-mismatch';
  // accessor check BEFORE key order (canonical since rev 28)
  const values = [];
  for (let i = 0; i < REQUIRED_KEYS.length; i += 1) {
    const k = REQUIRED_KEYS[i];
    const d = ObjectGetOwnPropertyDescriptor(r, k);
    if (d === undefined) return 'record-keys-mismatch';
    if (!isDataDescriptor(d)) return 'record-accessor-property';
    values[values.length] = [k, d.value];
  }
  for (let i = 0; i < REQUIRED_KEYS.length; i += 1) {
    if (names[i] !== REQUIRED_KEYS[i]) return 'record-key-order';
  }
  for (let i = 0; i < values.length; i += 1) {
    const k = values[i][0];
    const v = values[i][1];
    if (proxyFault(v)) return 'record-value-proxy:' + k;
    if (v !== null && (typeof v === 'object' || typeof v === 'function')) {
      return 'record-value-type:' + k;
    }
  }
  return null;                                                     // shape accepted
}

// --- step 3: inert snapshot (only of a non-Proxy, primitive-valued plain record) --
function snapshotRecord(r) {
  try { return JSONparse(JSONstringify(r)); } catch (e) { return null; }
}

// --- step 4: validate the SNAPSHOT against the schema ----------------------------
function validateRecord(snap) {
  const shape = inspectRecordShape(snap);
  if (shape) return shape;
  if (typeof snap.schemaVersion !== 'number' || !NumberIsInteger(snap.schemaVersion)) {
    return 'record-value-type:schemaVersion';
  }
  if (snap.schemaVersion !== SCHEMA_VERSION) return 'schema-version-unknown';
  if (typeof snap.id !== 'string') return 'record-value-type:id';
  if (!CANONICAL_REQUIRED_INDEX.has(snap.id)) return 'record-value-enum:id';
  for (let i = 0; i < ENUM_KEYS.length; i += 1) {
    const k = ENUM_KEYS[i];
    if (typeof snap[k] !== 'string') return 'record-value-type:' + k;
    if (ENUMS[k].indexOf(snap[k]) === -1) return 'record-value-enum:' + k;
  }
  for (let i = 0; i < BOOLEAN_KEYS.length; i += 1) {
    if (typeof snap[BOOLEAN_KEYS[i]] !== 'boolean') {
      return 'record-value-type:' + BOOLEAN_KEYS[i];
    }
  }
  return null;                                                     // valid
}

// --- the B.4a validity matrix ----------------------------------------------------
function basePreconditionsHold(v) {
  return v.measurable === true
    && v.error === 'none'
    && v.timedOut === false
    && v.repetitionsConsistent === true
    && v.mechanism !== 'unavailable';
}
function isValidAbsence(v) {
  return basePreconditionsHold(v)
    && v.typeofSharedWorker === 'undefined'
    && v.descriptor === 'absent'
    && v.nativeCtor === 'absent'                 // agreement with typeof 'undefined'
    && v.constructed === false;
}
function isValidPresence(v) {
  return basePreconditionsHold(v)
    && v.typeofSharedWorker === 'function'
    && PRESENT_DESCRIPTORS.indexOf(v.descriptor) !== -1
    && v.nativeCtor === 'present'                // 'mismatch'/'uncaptured'/'absent' INVALID
    && (v.constructed === true || v.constructed === false);
}

// --- SEAM part 1 (PRIVATE): everything that touches the caller's objects ---------
function snapshotAndValidate(perRealm) {
  const no = function (d) { return { ok: false, result: UNVERIFIED(d) }; };
  const container = readOwnArrayElements(perRealm, 'perRealm');
  if (!container.ok) return no(container.detail);

  const records = [];
  const seen = new SetCtor();
  for (let i = 0; i < container.length; i += 1) {
    const raw = container.items[i];
    const shape = inspectRecordShape(raw);                 // proxy checked first inside
    if (shape) return no(shape + ':index-' + i);
    const snapA = snapshotRecord(raw);
    const snapB = snapshotRecord(raw);                     // second independent read
    if (snapA === null || snapB === null) return no('record-not-snapshotable:index-' + i);
    if (proxyFault(snapA) || proxyFault(snapB)) return no('snapshot-proxy:index-' + i);
    if (JSONstringify(snapA) !== JSONstringify(snapB)) return no('record-unstable:index-' + i);
    const bad = validateRecord(snapA);
    if (bad) return no(bad + ':index-' + i);
    const frozen = ObjectFreeze(snapA);
    if (!CANONICAL_REQUIRED_INDEX.has(frozen.id)) {
      return no('realm-unknown-or-extra:' + frozen.id);
    }
    if (seen.has(frozen.id)) return no('realm-duplicate:' + frozen.id);
    seen.add(frozen.id);
    records[records.length] = frozen;
  }
  // complete-inventory check against the PRIVATE canonical list, in canonical order
  for (let i = 0; i < CANONICAL_REQUIRED_REALM_IDS.length; i += 1) {
    const id = CANONICAL_REQUIRED_REALM_IDS[i];
    if (!seen.has(id)) return no('realm-missing:' + id);
  }
  return {
    ok: true,
    snapshot: ObjectFreeze({
      schemaVersion: SCHEMA_VERSION,
      records: ObjectFreeze(records)        // no requiredIds: the set is never caller data
    })
  };
}

// --- SEAM part 2 (PRIVATE): the decision, which reads ONLY the frozen snapshot ---
function decideFromSnapshot(snapshot) {
  // defence in depth: a reduced or unfrozen canonical list can NEVER arm
  if (!ObjectIsFrozen(CANONICAL_REQUIRED_REALM_IDS)
      || CANONICAL_REQUIRED_REALM_IDS.length !== CANONICAL_REQUIRED_COUNT
      || CANONICAL_REQUIRED_INDEX.size !== CANONICAL_REQUIRED_COUNT) {
    return UNVERIFIED('canonical-required-set-corrupt');
  }
  if (proxyFault(snapshot)) return UNVERIFIED('snapshot-proxy:input');
  if (snapshot === null || typeof snapshot !== 'object'
      || snapshot.schemaVersion !== SCHEMA_VERSION
      || !ArrayIsArray(snapshot.records)) {
    return UNVERIFIED('snapshot-malformed');
  }
  const snapshotRecords = readOwnArrayElements(snapshot.records, 'snapshotRecords');
  if (!snapshotRecords.ok) return UNVERIFIED('snapshot-malformed');

  const byId = new MapCtor();
  for (let i = 0; i < snapshotRecords.length; i += 1) {
    const v = snapshotRecords.items[i];
    if (proxyFault(v)) return UNVERIFIED('snapshot-proxy:record');
    if (inspectRecordShape(v) !== null) return UNVERIFIED('snapshot-malformed');
    byId.set(v.id, v);
  }

  // PASS 1 - GLOBAL VALIDATION over the PRIVATE canonical list. Every canonical
  // required record must be VALID-ABSENT or VALID-PRESENT before ANY presence is
  // inspected. Refuses at the FIRST offending id in canonical order.
  for (let i = 0; i < CANONICAL_REQUIRED_REALM_IDS.length; i += 1) {
    const id = CANONICAL_REQUIRED_REALM_IDS[i];
    const v = byId.get(id);
    if (!v) return UNVERIFIED('realm-missing:' + id);
    if (!isValidAbsence(v) && !isValidPresence(v)) {
      return UNVERIFIED('realm-not-affirmatively-validated:' + id);
    }
  }

  // PASS 2 - CLASSIFICATION, reached only when every canonical record is valid.
  for (let i = 0; i < CANONICAL_REQUIRED_REALM_IDS.length; i += 1) {
    const id = CANONICAL_REQUIRED_REALM_IDS[i];
    if (isValidPresence(byId.get(id))) return PRESENT(id);
  }

  // PASS 3 - arm only when every canonical record affirmatively proves absence.
  for (let i = 0; i < CANONICAL_REQUIRED_REALM_IDS.length; i += 1) {
    const id = CANONICAL_REQUIRED_REALM_IDS[i];
    if (!isValidAbsence(byId.get(id))) {
      return UNVERIFIED('realm-not-affirmatively-validated:' + id);   // defence in depth
    }
  }
  return ARMED();
}

// --- the product decision: ONE argument, no caller-supplied required set ---------
function decide(perRealm) {
  const v = snapshotAndValidate(perRealm);
  return v.ok ? decideFromSnapshot(v.snapshot) : v.result;
}

// =================================================================================
// TEST SEAM (SEAM-28), clearly separated. createDecider is NOT exported. The product
// entry below calls it with NO argument, so no hook can exist on a production path.
// Tests reach the internals only through a test-only loader that recompiles THIS
// source text in its own module instance (see rev 30 section H) and then calls
// createDecider({ testHooks: { exposeInternals: true } }). The hook adds nothing to
// the decision: it only widens the returned object of that separate instance.
// =================================================================================
function createDecider(options) {
  const opts = (options !== null && typeof options === 'object') ? options : {};
  const hooksDescriptor = ObjectGetOwnPropertyDescriptor(opts, 'testHooks');
  const hooks = isDataDescriptor(hooksDescriptor) ? hooksDescriptor.value : null;
  let expose = false;
  if (hooks !== null && typeof hooks === 'object' && !proxyFault(hooks)) {
    const d = ObjectGetOwnPropertyDescriptor(hooks, 'exposeInternals');
    expose = isDataDescriptor(d) && d.value === true;
  }
  if (expose) {
    return ObjectFreeze({
      decide: decide,
      snapshotAndValidate: snapshotAndValidate,
      decideFromSnapshot: decideFromSnapshot,
      inspectRecordShape: inspectRecordShape,
      snapshotRecord: snapshotRecord,
      validateRecord: validateRecord,
      readOwnArrayElements: readOwnArrayElements,
      isValidAbsence: isValidAbsence,
      isValidPresence: isValidPresence,
      canonicalRequiredRealmIds: CANONICAL_REQUIRED_REALM_IDS     // frozen; read-only
    });
  }
  return ObjectFreeze({ decide: decide });
}

// LAST STATEMENT OF THE FILE (m-91): the actual final export object is frozen.
module.exports = ObjectFreeze({ decide: createDecider().decide });
```

**Notes on the module.** `isCleanAbsence` and `hasMeasuredPresence` stay **withdrawn as names and as behaviour**. Pass 3 stays redundant defence in depth. `proxyFault` keeps the single intrinsic read auditable. Every throw-capable operation (`JSONstringify`) runs only after the proxy, prototype, accessor and primitiveness checks and is additionally wrapped, so `decide` stays total. The returned decision objects are frozen, which changes no field and no outcome. The `snapshotRecords` re-read inside `decideFromSnapshot` costs one extra descriptor pass over our own frozen array and makes the private seam safe for the hostile snapshots tests feed it.

### B.6 Order of operations (normative, amended)

**reject proxies → read the container through own data-property descriptors only (`Array.prototype` identity, readable bounded length, no accessor element, no malformed descriptor, no sparse index, no extra own property, no symbol key; each index read exactly once) → inspect record shape (accessor before key order) → snapshot twice → compare → validate the snapshot schema → freeze → assert the private canonical list is 21 frozen literal ids → validate EVERY canonical required record against the B.4a matrix → only then inspect presence → arm only on unanimous VALID-ABSENT.**

Post-validation mutation immunity is unchanged and now unconditional: the decision reads only the frozen snapshot, and the required-realm set is not caller data at all, so replacing a captured reference, a field, a whole record, an array method or an array prototype in the caller's objects after validation leaves the decision unchanged or produces a refusal — never a new `shared_worker_present` and never a new `armed:true`.

### B.7 Proxy rejection rule (unchanged) and what honestly remains

Rev 28 B.7 stays in force verbatim, with its `requiredIds` clause withdrawn and `perRealm` plus the record and value boundaries unchanged. The honest residual list shrinks by one entry:

- **Node-only dependence** stays: the decision is Node-side by contract; nothing in the browser may take an arming decision.
- **Process integrity stays an assumption:** an intrinsic captured at module initialization cannot protect against an already-compromised Node process that patched `node:util` or the module registry before this module loaded.
- **Caller-controlled required set: REMOVED, not accepted.** This was M-26. There is no caller-supplied required set any more.
- **Non-proxy exotic objects** are handled by own-descriptor reads, the prototype-identity checks, the symbol-key, key-order, primitiveness and two-read stability checks. No accessor and no caller method can reach the decision.

### B.8 Interfaces

| Interface | Rev 29 | Rev 30 |
|---|---|---|
| `decide(perRealm, requiredIds)` | public product entry | **withdrawn** |
| `decide(perRealm)` | — | **the only public product entry**; returns a frozen `{armed, exit, reason[, detail]}` |
| `module.exports` | `{decide, snapshotAndValidate, decideFromSnapshot, inspectRecordShape, snapshotRecord, validateRecord, isValidAbsence, isValidPresence}` with an ineffective early freeze | **`Object.freeze({ decide })` as the last statement**; nothing else is exported |
| `snapshotAndValidate`, `decideFromSnapshot`, `isValidAbsence`, `isValidPresence`, `inspectRecordShape`, `snapshotRecord`, `validateRecord`, `readOwnArrayElements` | exported for tests | **private**; reachable only through the test-only loader of section H |
| `createDecider(options)` | — | **internal factory, not exported**; the product entry calls it with no argument |
| `CANONICAL_REQUIRED_REALM_IDS` | module constant, also effectively caller-supplied through `requiredIds` | **private, frozen, literal, authoritative** |
| `SharedWorkerCapabilityProbe.measure(...)` | emits `nativeCtor` only from the FC1 comparison | unchanged |
| Pilot call site | `decide(perRealm, ids)` | `decide(perRealm)`; any remaining id argument is ignored and must be deleted |

No CLI flag, environment variable, configuration key, report field or exit code is added or removed.

### B.9 Trust boundaries (unchanged in shape, narrower in surface)

Browser realms produce evidence; the Node-side decision is the only arming authority; the harness is not an oracle; the caller supplies data only. The rev 28/29 boundary list stays as written minus the `requiredIds` boundary, which no longer exists.

## Section C — table W6-T, rev 30 delta (52 rows)

**Rows not listed below are unchanged from the rev 28 section C reprint and the rev 29 section C delta and stay exactly as listed there** (F1..F21, F22, FC2..FC7, FC9..FC15, IC1, IC2, IC4, IC7, IC8, IC9, FW-1). Changed, re-expressed and new rows:

| Id | Case | Expected result (rev 30) |
|---|---|---|
| FC1 (unchanged, re-anchored) | pre-author-script native-constructor capture compared with the evaluate-time read, per measurable realm per repetition, plus a mismatch-injection sub-case | as rev 29: agreement ⇒ PASS with `nativeCtor` as measured and the record classified by B.4a; the mismatch-injection sub-case expects EXACTLY `armed:false`, exit 18, `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:<realm id>`. The oracle is the rev 30 contract only, read from the section C.6 expectations file |
| **FC8 (re-expressed; no longer a `requiredIds` row)** | **canonical-set and `perRealm`-inventory case.** The former `requiredIds`-based sub-cases (malformed set, unknown id, missing id, duplicate id in the caller's id list) are withdrawn with the parameter and re-expressed against the private canonical list and the `perRealm` inventory: (a) `perRealm` missing one canonical realm; (b) `perRealm` missing several; (c) `perRealm` carrying a record whose `id` is outside the canonical set; (d) a duplicate canonical id; (e) empty `perRealm`; (f) 1024 + 1 records | (a) `realm-missing:<first missing id in canonical order>`; (b) same, naming the first; (c) `record-value-enum:id:index-N` when the id is outside the schema enumeration of canonical ids, `realm-unknown-or-extra:<id>` when it passes the schema but is not canonical; (d) `realm-duplicate:<id>`; (e) `realm-missing:F1`; (f) `input-length-excessive:perRealm`. Every sub-case ⇒ `armed:false`, exit 18, `shared_worker_block_unverified`. **No sub-case may be expressed in terms of a caller-supplied required set** |
| **FC16** (new) | **hostile caller-container reads (M-26).** Over the all-absent base `B27` and over a one-present base `BP30`: (a) **the security reviewer's exact reproduction** — a **non-enumerable own `slice`** override on the `perRealm` array that returns `['F1']`-equivalent content, with `F2` VALID-PRESENT, `F3` `nativeCtor:'mismatch'` and `F21` unmeasured; (b) the same reproduction through a **swapped array prototype** whose `slice` cuts the list; (c) an own enumerable method override; (d) an inherited method override installed on `Array.prototype`; (e) a **getter on an index** (m-94); (f) a setter-only index; (g) a sparse hole; (h) an extra non-index own property; (i) a symbol own key; (j) an accessor `length`; (k) `length` above 1024; (l) a Proxy container | **every sub-case ⇒ `armed:false`, exit 18, `shared_worker_block_unverified`, and the decision must be UNVERIFIED — never `armed:true` and never `shared_worker_present`.** Details: (a), (c), (g), (h), (i) ⇒ `array-sparse-or-extra-keys`; (b), (d) ⇒ `input-prototype-invalid:perRealm`; (e), (f) ⇒ `array-accessor-element:index-N`; (j) ⇒ `input-length-unreadable:perRealm`; (k) ⇒ `input-length-excessive:perRealm`; (l) ⇒ `input-proxy:perRealm`. No caller function may be observed to run: each sub-case installs a counter in the override and asserts the counter is **0** |
| **FC17** (new) | **export-surface and canonical-list integrity.** (a) `Object.keys(require(module))` is exactly `['decide']`; (b) `decideFromSnapshot`, `snapshotAndValidate`, `isValidAbsence`, `isValidPresence` and `createDecider` are **absent** from the product export; (c) assigning `module.exports.decide = () => ({armed:true})` and adding a new export key; (d) attempting to mutate, extend, reorder, truncate or unfreeze the canonical required list from outside the module; (e) calling `decide` with a second argument that looks like a required-id list | (a) passes only on exact equality; (b) each name `undefined`; (c) the assignment **throws `TypeError` in strict mode and is silently ignored in sloppy mode — both are a PASS — and the subsequent decision on the all-absent base is byte-identical to the baseline**; (d) no route exists: the list is not exported, `Object.isFrozen` holds on the instance the test loader exposes, and every attempted mutation throws or is ignored with the decision unchanged; (e) the extra argument is ignored and the decision is byte-identical to the one-argument call |
| IC3 (changed) | inversion at unit level, synthetic `perRealm` | (a)–(f) as rev 29, with `decide(perRealm)` called with ONE argument; **(e) empty array ⇒ 18 `realm-missing:F1`** stays; **(g) new: a reduced inventory of 1 or 20 VALID-ABSENT records ⇒ 18 `realm-missing:<first missing canonical id>`, never `armed:true`** (m-92) |
| IC5 (changed) | `decide()` negative-case battery | cases (1)–(12) as rev 29 **with every `requiredIds`-based case re-expressed against the `perRealm` inventory** (the rev 28 "extra id" split becomes `realm-unknown-or-extra` and `record-value-enum:id`); **(13) new: a second argument is supplied and ignored; (14) new: `decide()` with no argument ⇒ `input-not-array`; (15) new: `decide(null)` and `decide('F1')` ⇒ `input-not-array`** |
| FC8/IC5 cross-reference | — | the `requiredIds` vocabulary (`input-proxy:requiredIds`, `required-id-set-malformed`, `required-id-unknown`, `required-id-missing`) must appear in **no** fixture, expectation or assertion. A fixture that still passes a required-id list is a gate failure, not a skip |

### C.6 META-TESTS — 2 rows (MT-1 replaced, MT-2 new)

| Id | Case | Expected result |
|---|---|---|
| **MT-1 (REPLACED)** | **contract-derived oracle.** A checker, separate from the harness, loads the machine-readable expectations file below and recomputes every recorded row's verdict from `actual` versus the **file's** expectation. It **MUST ignore every harness-recorded `expected*` field.** Coverage is total: every row id and every generated case class must have an entry; anything the checker cannot map ⇒ **FAIL**, never skip. The 34 rows CONF-04 skipped, including every `isProxy` row, have entries | the gate **FAILS** if any recorded verdict disagrees with the file, if any recorded row or case class has no entry, if the checker skips anything, or if the checker reads a harness `expected*` field. Harness-authored pass flags are advisory only and are not inputs to the verdict |
| **MT-2** (new) | **oracle self-test.** The checker is run twice over the same recorded results: once against the shipped expectations file, and once against a **deliberately wrong copy** in which (a) one `reason` is changed, (b) one `exit` is changed, (c) one `armed` is flipped, (d) one `detail` is changed, (e) one entry is deleted | run 1 must report the real gate verdict; run 2 must report **exactly five** failures mapped to (a)–(e) — the deleted entry as an **uncovered-row FAIL**, not a skip. If run 2 reports fewer failures, the checker itself is broken and the gate FAILS |

**The expectations file (shipped by this patch; save verbatim as `docs/architecture/phase-18-rev30-expectations.json`).** Every entry is derived from the rev 30 contract text in sections B.3a, B.4, B.4a, B.5, C and D only. No entry is derived from any harness output.

```json
{
  "schema": "phase-18-w6t-expectations/1",
  "derivedFrom": "docs/architecture/phase-18-rev30-patch.md sections B.3a, B.4, B.4a, B.5, C, D (rev 30, ARCH-30)",
  "rules": {
    "harnessExpectedFields": "ignore",
    "unknownRowOrCaseClass": "fail",
    "missingEntry": "fail",
    "skip": "forbidden",
    "unmeasuredRequiredRow": "partial-and-refuse",
    "detailMatch": "exact string after substituting the case's realm id or index",
    "armedTrueAllowance": "exactly one across the whole run: sweep case class D-control"
  },
  "rowTotals": { "rows": 52, "f": 21, "f22": 1, "fc": 17, "ic": 10, "fw": 1, "mt": 2 },
  "rows": {
    "F1..F21": { "kind": "measurement", "perRealm": true, "requiredRecordedFields": ["realmId", "measuredStatus", "mechanism", "typeofSharedWorker", "descriptor", "nativeCtor", "constructed", "repetitionsConsistent", "error", "timedOut", "classification", "popupEventSource?"], "oracle": "recompute classification from the recorded evidence fields with the B.4a matrix and compare with the recorded classification; measuredStatus must be 'measured' or 'unmeasured' and 'unmeasured' can never be a pass", "fullGateExpectation": { "armed": false, "exit": 18 } },
    "F22": { "kind": "informational", "oracle": "must not appear in any canonical required set and must never influence a decision", "expect": { "influencesDecision": false } },
    "FC1": { "subcases": { "agreement": { "kind": "measurement", "oracle": "nativeCtor as measured and classification by B.4a" }, "mismatch-injection": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-not-affirmatively-validated:{realmId}" } } },
    "FC2": { "kind": "measurement", "expect": { "fc2Pass": true, "subObservationsPerRealm": 5, "explained": true } },
    "FC3": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" },
    "FC4": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" },
    "FC5": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" },
    "FC6": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-not-affirmatively-validated:{realmId}", "forbiddenDetailSubstring": "disagreement" },
    "FC7": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" },
    "FC8": { "subcases": { "a-missing-one": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-missing:{firstMissingCanonicalId}" }, "b-missing-many": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-missing:{firstMissingCanonicalId}" }, "c-noncanonical-id-schema": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "record-value-enum:id:index-{n}" }, "c-noncanonical-id-postschema": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-unknown-or-extra:{id}" }, "d-duplicate": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-duplicate:{id}" }, "e-empty": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-missing:F1" }, "f-oversized": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "input-length-excessive:perRealm" } } },
    "FC9": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" },
    "FC10": { "kind": "seam", "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" },
    "FC11": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" },
    "FC12": { "subcases": { "passthrough-perRealm": { "detail": "input-proxy:perRealm" }, "passthrough-record": { "detail": "record-proxy:index-{n}" }, "throwing-trap": { "detail": "record-proxy:index-{n}" }, "lying-trap": { "detail": "record-proxy:index-{n}" }, "revoked": { "detail": "record-proxy:index-{n}" }, "nested-value": { "detail": "record-value-proxy:{key}:index-{n}" }, "substituted-after-validation": { "detail": "snapshot-proxy:record" } }, "commonExpect": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "uncaughtThrows": 0 } },
    "FC13": { "subcases": { "first": { "detail": "realm-not-affirmatively-validated:F1" }, "middle": { "detail": "realm-not-affirmatively-validated:F11" }, "last": { "detail": "realm-not-affirmatively-validated:F21" } }, "commonExpect": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" } },
    "FC14": { "subcases": { "a-invalid-F3-present-F8": { "detail": "realm-not-affirmatively-validated:F3" }, "b-present-F3-invalid-F8": { "detail": "realm-not-affirmatively-validated:F8" }, "c-three-invalid": { "detail": "realm-not-affirmatively-validated:F2" } }, "commonExpect": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" } },
    "FC15": { "kind": "seam", "subcases": { "i-flip-to-mismatch": { "oracle": "byte-identical to the unmutated decision" }, "ii-flip-to-present": { "oracle": "byte-identical to the unmutated decision" }, "iii-field-proxy": { "oracle": "byte-identical, or refusal with detail snapshot-proxy:record or record-unstable:index-{n}" }, "iv-replace-record": { "oracle": "byte-identical, or refusal with detail record-unstable:index-{n}" } }, "forbidden": { "newReason": "shared_worker_present", "newArmed": true } },
    "FC16": { "subcases": { "a-own-nonenumerable-slice": { "detail": "array-sparse-or-extra-keys" }, "b-swapped-prototype-slice": { "detail": "input-prototype-invalid:perRealm" }, "c-own-enumerable-method": { "detail": "array-sparse-or-extra-keys" }, "d-inherited-method": { "detail": "input-prototype-invalid:perRealm" }, "e-index-getter": { "detail": "array-accessor-element:index-{n}" }, "f-index-setter-only": { "detail": "array-accessor-element:index-{n}" }, "g-sparse-hole": { "detail": "array-sparse-or-extra-keys" }, "h-extra-own-property": { "detail": "array-sparse-or-extra-keys" }, "i-symbol-own-key": { "detail": "array-sparse-or-extra-keys" }, "j-accessor-length": { "detail": "input-length-unreadable:perRealm" }, "k-length-over-bound": { "detail": "input-length-excessive:perRealm" }, "l-proxy-container": { "detail": "input-proxy:perRealm" } }, "commonExpect": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "callerFunctionInvocations": 0, "bases": ["B27", "BP30"] } },
    "FC17": { "subcases": { "a-export-keys": { "expect": { "exportKeys": ["decide"] } }, "b-internals-absent": { "expect": { "decideFromSnapshot": "undefined", "snapshotAndValidate": "undefined", "isValidAbsence": "undefined", "isValidPresence": "undefined", "createDecider": "undefined" } }, "c-export-swap": { "expect": { "assignmentOutcome": ["throws-TypeError-strict", "ignored-sloppy"], "decisionAfter": "byte-identical to baseline" } }, "d-canonical-tamper": { "expect": { "mutationOutcome": ["throws", "ignored"], "frozen": true, "decisionAfter": "byte-identical to baseline" } }, "e-second-argument": { "expect": { "decisionAfter": "byte-identical to the one-argument call" } } } },
    "IC1": { "kind": "control", "oracle": "fixture definition in rev 28 J.6; executed independently" },
    "IC2": { "kind": "control", "oracle": "fixture definition in rev 28 J.6; executed independently" },
    "IC3": { "subcases": { "a-all-absent": { "armed": true, "exit": 0, "reason": "shared_worker_absent_all_realms" }, "b-one-valid-present": { "armed": false, "exit": 18, "reason": "shared_worker_present", "detail": "realm:{id}" }, "c-unmeasurable": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-not-affirmatively-validated:{id}" }, "d-disagreement": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-not-affirmatively-validated:{id}" }, "e-empty": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-missing:F1" }, "f-present-looking-bad-ctor": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-not-affirmatively-validated:{id}" }, "g-reduced-inventory": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-missing:{firstMissingCanonicalId}" } } },
    "IC4": { "kind": "control", "oracle": "fixture definition in rev 28 J.4; executed independently" },
    "IC5": { "commonExpect": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" }, "subcases": { "1..10": { "oracle": "rev 28 IC5 details, with every requiredIds-based case re-expressed against the perRealm inventory" }, "11-function-with-absent-descriptor": { "detail": "realm-not-affirmatively-validated:F1" }, "12-constructed-with-undefined-typeof": { "detail": "realm-not-affirmatively-validated:F1" }, "13-ignored-second-argument": { "oracle": "byte-identical to the one-argument call" }, "14-no-argument": { "detail": "input-not-array" }, "15-null-or-string": { "detail": "input-not-array" } } },
    "IC6": { "kind": "sweeps", "oracle": "section D case classes; counts re-derived from the schema constants" },
    "IC7": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" },
    "IC8": { "kind": "control", "oracle": "fixture definition in rev 28 J.6; executed independently" },
    "IC9": { "subcases": { "proxy-1": { "detail": "input-proxy:perRealm" }, "proxy-2": { "detail": "record-proxy:index-{n}" }, "proxy-3": { "detail": "record-value-proxy:{key}:index-{n}" }, "proxy-4-revoked": { "detail": "record-proxy:index-{n}" }, "proxy-5-throwing": { "detail": "record-proxy:index-{n}" }, "proxy-6-lying": { "detail": "record-proxy:index-{n}" }, "proxy-7-post-validation": { "detail": "snapshot-proxy:record" } }, "commonExpect": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "uncaughtThrows": 0 } },
    "IC10": { "subcases": { "a-missing-nativeCtor": { "detail": "record-keys-mismatch:index-{n}" }, "b-uncaptured": { "detail": "realm-not-affirmatively-validated:{id}" }, "c-mismatch": { "detail": "realm-not-affirmatively-validated:{id}" }, "d-proxy-value": { "detail": "record-value-proxy:nativeCtor:index-{n}" }, "e-inconsistent": { "detail": "realm-not-affirmatively-validated:{id}" } }, "commonExpect": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "uncaughtThrows": 0, "repetitionsPerNodeVersion": 3 } },
    "FW-1": { "kind": "measurement", "requiredRecordedFields": ["measuredStatus", "failClosedPathExecuted"], "expect": { "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" }, "oracle": "unmeasured status may never be recorded as a pass; the fail-closed path must be executed 3 times per Node version" },
    "MT-1": { "kind": "meta", "oracle": "this file is the oracle; the checker must read no harness expected* field and must cover every row and case class" },
    "MT-2": { "kind": "meta", "expect": { "runsAgainstWrongCopy": 1, "failuresReported": 5, "mappedTo": ["reason", "exit", "armed", "detail", "deleted-entry-uncovered"] } }
  },
  "caseClasses": {
    "A-mutation": { "count": 1155, "formula": "|IDS|*|REQUIRED_KEYS|*|MUTATIONS| = 21*11*5", "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" },
    "B-valid-negative": { "count": 126, "formula": "|IDS|*|VALID_NEGATIVES| = 21*6", "armed": false, "exit": 18, "reason": "shared_worker_block_unverified" },
    "C-structural": { "count": 20, "formula": "|STRUCTURAL| = 20", "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "oracle": "rev 28 D.3 details, with the former requiredIds-container cases re-expressed as perRealm-container cases" },
    "D-pos": { "count": 21, "formula": "|IDS|", "armed": false, "exit": 18, "reason": "shared_worker_present", "detail": "realm:{id}" },
    "D-ctor": { "count": 63, "formula": "|IDS|*|CTOR_NEGATIVES| = 21*3", "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-not-affirmatively-validated:{id}" },
    "D-desc": { "count": 42, "formula": "|IDS|*|DESC_NEGATIVES| = 21*2", "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-not-affirmatively-validated:{id}" },
    "D-absctor": { "count": 63, "formula": "|IDS|*3", "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "detail": "realm-not-affirmatively-validated:{id}" },
    "D-mix": { "count": 6, "formula": "|POS|*|PARTNER| = 3*2", "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "boundaryRule": "non-circular: F1 uses F2 and F3, F11 uses F10 and F12, F21 uses F20 and F19", "detail": "realm-not-affirmatively-validated:{firstInvalidCanonicalId}" },
    "D-control": { "count": 1, "formula": "1", "armed": true, "exit": 0, "reason": "shared_worker_absent_all_realms" },
    "E-hostile": { "count": 18, "formula": "|HOSTILE|*|BASES| = 9*2", "armed": false, "exit": 18, "reason": "shared_worker_block_unverified", "oracle": "FC16 details per pattern; callerFunctionInvocations must be 0" }
  },
  "runTotals": { "invocations": 1515, "refusals": 1514, "blockUnverified": 1493, "present": 21, "armedTrue": 1 }
}
```

## Section D — sweeps (counts by formula)

Constants: `|IDS| = 21`, `|REQUIRED_KEYS| = 11`, `|MUTATIONS| = 5`, `|VALID_NEGATIVES| = 6`, `|STRUCTURAL| = 20`, `|CTOR_NEGATIVES| = 3`, `|DESC_NEGATIVES| = 2`, `|POS| = 3` (`F1`, `F11`, `F21`), `|PARTNER| = 2`, `|HOSTILE| = 9`, `|BASES| = 2`.

- **Sweep A** (unchanged): `21 × 11 × 5 = 1155` ⇒ all `shared_worker_block_unverified`.
- **Sweep B** (unchanged from rev 29): `21 × 6 = 126` ⇒ all `shared_worker_block_unverified`.
- **Sweep C** (count unchanged, **content re-expressed**): **20** structural cases, with the former `requiredIds`-container cases replaced one-for-one by `perRealm`-container cases (altered prototype, accessor element, sparse hole, extra own property, symbol key, accessor length, oversized length), keeping the rev 28 D.3 details for the cases that survive unchanged ⇒ all `shared_worker_block_unverified`.
- **Sweep D** (as rev 29, **boundary rule now explicit**). Base `BP30(i)` = `B27` with record `i` replaced by a VALID-PRESENT record (`typeof:'function'`, `descriptor:'present-data'`, `nativeCtor:'present'`, `constructed:true`).
  - `D-pos` = `21` ⇒ `shared_worker_present`, detail `realm:<id>`, `armed:false`.
  - `D-ctor` = `21 × 3` = **63** ⇒ `realm-not-affirmatively-validated:<id>`.
  - `D-desc` = `21 × 2` = **42** ⇒ same refusal.
  - `D-absctor` = `21 × 3` = **63** ⇒ same refusal.
  - `D-mix` = `3 × 2` = **6**: one INVALID record at `F1`, `F11` or `F21` combined with a VALID-PRESENT record at a neighbouring canonical realm ⇒ `shared_worker_block_unverified`, never `shared_worker_present`. **Boundary rule (m-95, normative): "preceding" means canonical index `i-1` and "following" means canonical index `i+1` in the fixed `F1..F21` order, with NO wraparound. `F1` has no preceding realm, so both partners are taken forward: `F2` and `F3`. `F21` has no following realm, so both are taken backward: `F20` and `F19`. `F11` uses `F10` and `F12`.** The count stays 6 and the detail always names the first invalid canonical id.
  - **Sweep D total = `21 + 63 + 42 + 63 + 6 = 195`.**
- **Sweep E** (new, hostile containers). `|HOSTILE| = 9` patterns — own non-enumerable method override, swapped array prototype, own enumerable method override, index getter, index setter-only, sparse hole, extra own property, accessor `length`, Proxy container — applied over `|BASES| = 2` (the all-absent base `B27` and a one-present base `BP30(8)`): **`9 × 2 = 18`** ⇒ all `shared_worker_block_unverified` with the FC16 details, **zero caller-function invocations**, and never `shared_worker_present` even over the present base.

**Checker assertions (formulas, not literals):** `1155 + 126 + 20 + 195 + 18 = 1514` refusals — **1493** `shared_worker_block_unverified` and **21** `shared_worker_present` — plus **exactly 1** `armed:true` (the `B27` control) across **1515** `decide` invocations. The harness must derive these from the schema constants and then compare them with this document and with the section C.6 expectations file. **Zero unexpected `armed:true` and zero unexpected `shared_worker_present` are gate conditions, not warnings.**

**Relation between Sweep E and FC16.** Sweep E generates **9 of the 12** FC16 patterns over 2 bases. The remaining three FC16 patterns — an inherited method override installed on `Array.prototype`, a symbol own key, and a `length` above the bound — are executed as named row sub-cases only, because mutating `Array.prototype` must be isolated in a dedicated test process and must not leak into a generated sweep. FC16 is therefore a superset of Sweep E's patterns, and both are mandatory.

## Section E — alternatives considered

| Alternative | Tradeoff | Verdict |
|---|---|---|
| Accept M-26 as part of the existing process-integrity residual | Zero change; but the reproduction needs no compromised process — an ordinary caller object with a non-enumerable own `slice` was enough to arm with a mismatching realm. It is an input-handling defect, not a runtime assumption | **Rejected (owner decision)** |
| Keep `requiredIds` and harden it (`Array.isArray` + prototype identity + descriptor reads, intersected with the canonical list) | Smallest diff; keeps the published signature; but it keeps a caller-controlled arming-relevant input alive, so every future reader must re-derive why it is safe, and an intersection bug re-opens the hole | **Rejected** |
| Keep `requiredIds` for API compatibility but ignore its value | No caller breakage; but a parameter that is accepted and silently ignored is a lie in the interface and invites a caller to believe it narrows the gate | **Rejected**; the argument is dropped and any extra argument is ignored and tested as ignored (FC17-e) |
| Remove `requiredIds`; private frozen literal canonical list; own-descriptor-only container reads; private `decideFromSnapshot`; frozen single export | A signature change at one call site, three new rows, one new sweep and six new detail strings; makes the arming-relevant set structurally unreachable from input | **CHOSEN** |
| Export `decideFromSnapshot` for tests and rely on "tests only" discipline | Convenient; but SEC-25 flagged it as an influence surface, and m-92 showed it armed on an empty required set | **Rejected**; replaced by the recompiling test loader plus `createDecider({testHooks})` |
| Keep MT-1 inside the harness | No new artefact; but it compared results with the harness's own `expected*` fields, so it could not have caught the CONF-03 FC1 wrong expectation, and it skipped 34 rows | **Rejected**; replaced by the contract-derived expectations file and MT-2 |

## Section F — failure modes, fallback, observability, rollback

Unchanged from rev 29 F, with these additions.

**Failure modes.** (1) A hostile or merely unusual container (altered prototype, accessor element, sparse array, extra own property, oversized length) refuses with a specific container detail instead of arming; a legitimate caller never produces one, so any occurrence in production is a real signal. (2) The canonical-list assertion can only fire in a corrupted process and reports `canonical-required-set-corrupt`. (3) A caller that still passes a required-id list sees it ignored; the fixture sweep (FC17-e, IC5-13) is what keeps that honest. (4) The bounded length means a caller that hands over more than 1024 records is refused rather than iterated.

**Fallback.** There is none and none is wanted: every failure mode above ends in `armed:false`, exit 18, `shared_worker_block_unverified`.

**Observability.** The single `Logger.error` keeps naming code, exit, reason, `detail` and realm id. The `sharedWorkerCapability` report block keeps the rev 29 per-realm classification and `nativeCtor`, and gains the **container verdict** (accepted, or the refusing container detail) so an operator can distinguish a malformed evidence container from a measured capability. No raw `console.log`, `fs.promises.*` for evidence writes.

**Rollback.** Reverting rev 30 restores the rev 29 contract, which refuses in every measured case today but re-opens M-26 and m-91 to m-95. Rollback is therefore a **security regression** and must not be done silently; it requires an owner decision recorded next to M-26.

**Honest note on the reference module.** The B.5 text above was exercised in a scratch run on the hostile-container inputs described in FC16 and on the arming, present and mismatch bases, and behaved as this document states. That is a check of the **reference text**, not conformance evidence: it is not CONF evidence, it does not close M-26, and CONF-05 must re-measure every row in the product implementation.

## Section G — compatibility and migration

No schema change (`schemaVersion` stays `1`), no CLI flag, no environment variable, no configuration key, no report field removed, no dependency and no lockfile change; CommonJS throughout, Node >= 22 with CI on Node 24.

**Breaking change, internal only.** `decide(perRealm, requiredIds)` becomes `decide(perRealm)`. The affected surface is internal: the pilot arming call site, the W6-T harness and the unit tests. Migration steps, in order:

1. Update the call site to `decide(perRealm)` and delete the id-list argument and its construction. An extra argument is ignored, so the order of steps 1 and 2 cannot produce an arming change.
2. Replace the product module with the rev 30 B.5 text; delete the early `Object.freeze(module.exports)` and the test exports.
3. Add the test-only loader (section H) and repoint every test that used `snapshotAndValidate` or `decideFromSnapshot`.
4. Delete every fixture, expectation and assertion that mentions `requiredIds`, `input-proxy:requiredIds`, `required-id-set-malformed`, `required-id-unknown` or `required-id-missing`, and re-express them as FC8/IC5 inventory cases.
5. Add the contract-derived expectations file and repoint the oracle; delete the harness-internal MT-1 checker.

No stored evidence is invalidated: CONF-01 to CONF-04 stay valid as records of what earlier revisions did, and are not edited.

## Section H — test seams and acceptance-criteria mapping

**The SEAM-28 redesign (normative).** The product module exports `{ decide }` only. Tests that must exercise post-validation mutation use a **test-only loader** at `tests/unit/support/load-decider-internals.js` that:

1. reads the product source with `fs.promises.readFile`;
2. compiles it in its **own** `Module` instance (`new (require('module'))(filename, null)`, `module._compile(source + EPILOGUE, filename)`), where `EPILOGUE` is exactly `\nmodule.exports = Object.freeze({ createDecider: createDecider });`;
3. returns `createDecider({ testHooks: { exposeInternals: true } })`.

This gives tests `snapshotAndValidate`, `decideFromSnapshot`, the validity predicates, `readOwnArrayElements` and a read-only view of the canonical list **without any product export and without any product-reachable hook**. The recompiled copy is a separate module instance: product code never loads it, the product entry's exports stay frozen, and the loader lives under `tests/` only. A CI guard must assert that no file under `src/` references the loader, and that `Object.keys(require(productModule))` is exactly `['decide']`.

| Seam | Rows / sweeps | AC |
|---|---|---|
| `decide(perRealm)` — the only product entry | FC1, FC8, FC13, FC14, FC16, FC17, IC3, IC5, IC6, IC10, Sweeps A–E | P18-AC-091 |
| test-only loader + `createDecider({testHooks})` (SEAM-28) | FC10, FC15, Sweep C structural seam cases | P18-AC-091 |
| `isValidAbsence` / `isValidPresence` through the loader | the B.4a matrix, row by row | P18-AC-091 |
| `readOwnArrayElements` through the loader | FC16, Sweep E, container details | P18-AC-091 |
| export-surface and canonical-list guard (CI assertion + row) | FC17 | P18-AC-091 |
| contract-derived oracle (`phase-18-rev30-expectations.json`) | MT-1, MT-2, every row | P18-AC-091, W6T-GATE |
| probe `nativeCtor` emission | FC1, IC10 | P18-AC-091 |
| popup event-source recording | F13, F14, J item 8, POPUP-30 | P18-AC-091 |

## Section I — ADR-0054 (short ADR; durable and cross-cutting)

**Context.** SEC-25 reproduced an arming decision with a mismatching and an unmeasured realm by overriding `slice` on the caller's `requiredIds` array (own non-enumerable property, and a swapped prototype). The decision called methods on caller data and let the caller define the required set.

**Decision.** Arming-relevant inputs are **data, never behaviour, and never caller-authored policy**. The required-realm set is a private, frozen, literal, module-scoped constant that the decision iterates directly; `requiredIds` is removed from the API. Caller containers are read only through own data-property descriptors obtained from intrinsics captured at module initialization, each index exactly once, with proxy rejection first and `Array.prototype` identity required; no caller method, getter, setter or iterator is ever invoked. The product export surface is `Object.freeze({ decide })`, created as the file's last statement. Internal functions are private, and the only test access is a recompiled copy of the same source through an unexported factory. Conformance oracles are contract-derived files, never harness fields, and must fail rather than skip.

**Consequences.** One internal signature change and five migration steps; six new detail strings under the unchanged reason and exit code; four withdrawn detail strings; three new rows, two meta-test rows, one new sweep; the authoritative table is 52 rows; the executed gate is CONF-05. ADR-0051, ADR-0052 and ADR-0053 stay in force; this ADR amends them only on input handling, the export surface and the oracle. No exit code, reason code or public surface changes.

## Section J — executed W6-T conformance gate (CONF-05), required before Security

CONF-01 to CONF-04 are **superseded, not upgraded**; all four stay PARTIAL records and are **not edited**. Rev 30 executes nothing; `CONF-05` and `W6T-GATE` stay NOT EXECUTED / NOT SATISFIED. CONF-05 inherits rev 29 J items 2, 4, 5, 7, 9, 12, 13 and rev 28 sections J.2, J.4, J.6, J.7 and J.8 verbatim, and adds or tightens:

1. **Full matrix rerun.** All **52** rows on **Node 22.19.0 and Node 24.21.0**, **≥3 repetitions per required row**, each row executed independently. No row may be carried over from CONF-01 to CONF-04.
2. **Node-side rows.** Every Node-side row (FC3..FC17, IC3, IC5, IC6, IC7, IC9, IC10, the FW-1 decision, MT-1, MT-2) executed on both Node versions, recorded with `browser identity: n/a (node-side)`.
3. **Sweeps and proxies.** Sweeps A 1155, B 126, C 20, D 195, **E 18**, counts re-derived from the schema constants before comparison, 3 full passes per Node version; all seven FC12/IC9 proxy cases including **revoked** and **throwing** traps, each asserting explicitly that no exception escaped `decide`.
4. **M-26 closure rows.** **FC16 and FC17 are required rows.** FC16 must include the SEC-25 reproduction verbatim (non-enumerable own `slice` override, and the swapped-prototype variant, with `F2` VALID-PRESENT, `F3` `nativeCtor:'mismatch'` and `F21` unmeasured) and must record `armed:false`, exit 18, `shared_worker_block_unverified` with the stated container detail **and a caller-function invocation counter of 0** in every repetition. Any `armed:true` or `shared_worker_present` there is a gate failure and M-26 stays open.
5. **Contract-derived oracle.** The oracle reads `phase-18-rev30-expectations.json` and **nothing** from the harness's recorded `expected*` fields. It must map **every** recorded row and generated case class; an unmapped row, a missing entry or a skip is a **FAIL**. **Zero skipped rows** — the 34 rows CONF-04 skipped, including every `isProxy` row, must be covered and recorded. MT-2 must be run and must report exactly five failures against the wrong copy.
6. **Browser rows and the 21-realm gate.** Every browser row plus the full 21-realm gate, with the **current pinned Chromium refusing in every full-gate repetition**; if it ever arms, the gate fails and Security is not dispatched.
7. **FC1 and FC2** as rev 29 J items 6 and 7, unchanged.
8. **Popups — RECORDING REQUIREMENT, claim stays UNVERIFIED.** F13 and F14 must be created by a real user gesture (`page.click()` on a Falcon-authored loopback fixture), never a gesture-free `evaluate`. CONF-05 must **record, per popup realm and per repetition, the event source that opened it** (`trusted-click` versus `evaluate`), together with the fixture URL, the acquisition mechanism and the timeout, in the **raw** results. **Until that field exists in recorded output, the popup-gesture claim is UNVERIFIED and must be labelled UNVERIFIED everywhere it is reported** (POPUP-30). A consolidated document may not upgrade it.
9. **Export surface and canonical list.** Record `Object.keys` of the product module (must be exactly `['decide']`), the result of the export-swap attempt, and the canonical-list tamper attempts, on both Node versions.
10. **Zero-tolerance counters.** Zero unexpected `armed:true`, zero unexpected `shared_worker_present`, zero uncaught throws, zero skipped required rows, zero non-loopback requests (counted `n of N` per repetition), zero caller-function invocations in FC16 and Sweep E, zero `requiredIds` references in fixtures or expectations.
11. **Unmeasured items stay labelled.** F16..F21 and FW-1 are recorded by **measured/unmeasured status**, never as passes, and their fail-closed decision paths are executed and tested (3× per Node version each).
12. **Outcome rule.** A refusal is a PASS when it is the expected outcome. Any unmeasured required row ⇒ **PARTIAL**, arming stays refused, Security is not dispatched. **Documentation alone must not close M-26, and a harness pass flag is not evidence.**

## Section K — repository-wide stale-reference search

Command form: `git grep -nI -- "<pattern>" 7891f50 -- docs/` over `requiredIds`, `decideFromSnapshot`, `49 rows`, `44 rows`, `Object.freeze(module.exports)`, `independent checker`, `MT-1`, `CONF-04`. Evidence documents (`docs/phase-18-conf0*-results.md`, `docs/phase-18-w6t-conformance-results.md`, `docs/phase-18-spike-*-findings.md`, `docs/security/phase-18-design-review-*.md`) are **not edited**: they record what was executed or reviewed and are referenced from this patch. The untracked rev 24 drafts are excluded.

| Hit | Disposition |
|---|---|
| `phase-18-rev29-patch.md` B.5 heading, `function decide(perRealm, requiredIds) {`, the `snapshotAndValidate, decideFromSnapshot` export line, and the "`module.exports` stays frozen" sentence | **LIVE → fixed in place.** Four notes: the rev 29 block is not the live reference; the two-argument signature is withdrawn; the test exports are withdrawn; m-91 corrected with the freeze moved to the last statement |
| `phase-18-rev29-patch.md` section C heading "(49 rows)" and the authoritative-total line | **LIVE → fixed in place** (52 rows; single source is rev 30 section C) |
| `phase-18-rev29-patch.md` MT-1 row | **LIVE → fixed in place**: MT-1 replaced by the contract-derived oracle; MT-2 added; the "independent checker" wording is superseded because it was not independent (m-93) |
| `phase-18-rev29-patch.md` Sweep D bullet | **LIVE → fixed in place** with the non-circular boundary rule (m-95) |
| `phase-18-rev29-patch.md` checker-assertions paragraph | **LIVE → fixed in place**: 1155/126/20/195/18, 1514 refusals, 1493 + 21, one `armed:true`, 1515 invocations |
| `phase-18-rev29-patch.md` B.6 heading and the section H seam row `decide(perRealm, requiredIds)` | **LIVE → fixed in place**: container layer added to the order rule; the seam row becomes `decide(perRealm)` with Sweeps A–E |
| `phase-18-rev29-patch.md` section J heading (CONF-04) | **LIVE → fixed in place**: the live gate is CONF-05; CONF-04 is not accepted (harness-field oracle, 34 skipped rows, unverified popup gesture) |
| `phase-18-rev28-patch.md` `Object.freeze(module.exports);`, `const req = requiredIds.slice();`, and the `input-proxy:requiredIds` rejection bullet | **LIVE → fixed in place**: three notes carrying m-91, the M-26 reproduction and the withdrawn `requiredIds` detail vocabulary, each marked DO NOT IMPLEMENT |
| `phase-18-rev28-patch.md` remaining `requiredIds` occurrences inside the already-superseded B.5 code block | **Disposed by the block-level supersession note** added by rev 29 at the B.5 heading plus the two new in-place notes. Rewriting every line of a twice-superseded code block would rewrite history. **No further edit** |
| `phase-18-rev25-patch.md`, `phase-18-rev26-patch.md`, `phase-18-rev27-patch.md` totals and `requiredIds` mentions | **Disposed by chain**: these carry supersession notes pointing at rev 28/29 section C, which now carry the rev 30 note at both totals. **No edit** |
| `phase-18-acceptance-criteria.json` AC-091 requirement, `counts`, `exitCodes` | **Disposed by addition**: the rev 30 `ac[] appendText`, `counts.rev30Note` and `exitCodes.rev30Note`. Earlier notes are not rewritten, so the applied-note history stays readable |
| `phase-18-acceptance-criteria.json` openItems `M-25`, `M-26`, `CONF-04`, `W6T-GATE` | **Fixed by `openItems` `appendText`**; `CONF-05`, `HOSTILE-30`, `ORACLE-30` and `POPUP-30` added by `openItemsAdd` |
| `docs/phase-18-conf0*-results.md`, `docs/security/phase-18-design-review-24.md` | **Evidence, left as written.** Rev 30 answers them in the design and references them |
| `phase-18-plan.md`, `docs/security/phase-18-threat-model.md` | Checked for `requiredIds` and `49 rows`: **no live hit. No edit** |

## Section L — handoff constraints

- **Developer:** implement the rev 30 B.5 module exactly, in order. `decide(perRealm)` only; never add a `requiredIds` parameter, option, property or environment read; keep the canonical list private, frozen and literal; never call a method, getter, setter, iterator or spread on a caller value; read each index once through `Object.getOwnPropertyDescriptor` from captured intrinsics; keep `module.exports = Object.freeze({ decide })` as the **last** statement and export nothing else; do not export `createDecider`, `decideFromSnapshot` or `snapshotAndValidate`; do not implement `hasMeasuredPresence`; add no detail string beyond the six listed in B.3a and no exit code, flag, environment variable, configuration key, hook or exemption (OWNER-25). Update the single call site. `Logger.*` only, `fs.promises.*` for evidence writes, CommonJS.
- **QA:** fixtures from the 52-row table. Add FC16 (including the SEC-25 reproduction verbatim, with a caller-function invocation counter asserted to be 0), FC17, IC3-g, IC5-13/14/15, the re-expressed FC8, Sweep E (18) and the Sweep D boundary rule. Delete every `requiredIds` fixture and expectation. Build the oracle to read **only** `phase-18-rev30-expectations.json`, cover every row and case class, **fail rather than skip**, and pass MT-2. Assert 1155/126/20/195/18, 1514 refusals, 1493 + 21 and exactly one authorised `armed:true` across 1515 invocations. `armed:true` only at unit level, only for IC3-a/`B27`. Use the test-only loader for SEAM-28; never import a product internal.
- **Security:** review scope is B.3a (do the container rules close the SEC-25 reproduction in both variants, and is any caller-reachable code path left?), B.4b (is the canonical list genuinely unreachable and is the length assertion meaningful?), the private seam and the recompiling loader as an influence surface, the export-freeze fix (m-91), the empty/reduced-set path (m-92), the oracle's independence and total coverage (m-93), accessor and prototype handling (m-94), the stated Sweep D boundary (m-95), the six added and four withdrawn detail strings, and the CONF-05 conditions. M-26 may close only on executed CONF-05 rows FC16, FC17 and Sweep E plus your review; CONF-01 to CONF-04 must not be accepted as passes; the popup-gesture claim stays UNVERIFIED until recorded.
- **DevOps:** no workflow, dependency, lockfile or `NODE_OPTIONS` change; GoogleSearchTest stays out of CI. Node-side rows and sweeps stay the only CI-suitable part and must run under **both** Node 22.19.0 and Node 24.21.0; CI must expect exit 18, must not treat the refusal as a flake and must match the unchanged reason set. Add the CI guard asserting that `Object.keys` of the product module is exactly `['decide']` and that no file under `src/` references the test-only loader. CONF-05 is a scratch run, not a CI job: unique profile and process group per run, verified cleanup of CONF-05-owned artefacts only, read-only identification of the two pre-existing loopback listeners, no non-loopback request, no secret written.

## Needs anchors (not applied by rev 30)

Every `old` anchor in `phase-18-rev30-edits.json` was verified by exact string count to occur **exactly once** in its target file at `7891f50` (script-verified, 15 anchors, 0 failures). No `docEdit` targets an evidence document. Short SHAs only; no 40-character SHA; no AI attribution. Nothing in this revision is committed and nothing is executed.
