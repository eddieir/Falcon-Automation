# Phase 18 rev 32 - m-96: bound every decision-critical intrinsic at initialization

Owner decision: fix m-96; do not accept it as residual. Supersedes the rev 30 reference module (B.5); rows, expectations and details are otherwise unchanged except as listed. Test-contract corrections of rev 31 stay in force.

## Change

1. **Capture once, use only captured values.** `decide32.js` captures `util.types.isProxy`, `Array.isArray`, `Object.freeze/isFrozen/getOwnPropertyDescriptor/getOwnPropertyNames/getOwnPropertySymbols/getPrototypeOf/defineProperty/hasOwn`, `Number.isInteger` and `String` at module initialization, and never reads an intrinsic through a prototype chain afterwards.
2. **Removed from the decision path:** `JSON.parse`/`JSON.stringify` (the snapshot is built from values already read through own data descriptors and compared field by field, so `toJSON` and BigInt serialisation cannot run), `Map`/`Set` (replaced by plain loops over the private frozen canonical list), `.call`, `.indexOf`, array element assignment (arrays are filled with `Object.defineProperty` and a null-prototype descriptor, so inherited index setters and inherited `get`/`set`/`value` cannot run).
3. **BigInt and symbol values** are refused by the existing type checks (`record-value-type:<key>:index-N`) instead of the former `record-not-snapshotable`. Both are refusals; no expectation referenced the old detail.
4. **New row FC18 (m-96).** After loading, every configurable property of every global built-in (59 roots including `Object`, `Function`, `Array`, `String`, `Number`, `BigInt`, `Symbol`, `Map`, `Set`, `Promise`, `JSON`, `Reflect`, iterator prototypes, `util.types`; 784 properties) is replaced by a counting getter/wrapper/setter, one at a time and then all at once, with 125 additional inherited accessors on `Object.prototype` and `Array.prototype` (descriptor names, record keys, indices 0-39, `toJSON`, `then`). Required: **zero caller executions, unchanged decision for all 10 inputs, only the authorised all-absent input arms.** Three runs. A control run against the rev 30 module must be detected (it is: 8 single-property failures and 9 mismatches).
5. **Process-integrity boundary (explicit).** Code that runs in the Falcon process before this module finishes initializing can replace any intrinsic it captures. That is outside this module's guarantee and is covered by the existing process-integrity assumption (the process, its dependencies and its launch environment are trusted at load time). This rev 32 text and the module header state it; rev 30 B.7 ("no caller method can reach") is superseded by it and gives no protection claim against pre-initialization compromise.
6. Rows: **53** (52 + FC18). Sweep totals unchanged (1155/126/20/195/16 + 2 invariant controls; 1513 invocations).

## Reference module (verbatim, sha256 `e197ec58f6084f03508cac198e21630eb31eb3f2218023c227642fb898b3a522`)

```js
'use strict';
// decide32.js - Phase 18 SharedWorker arming decision, architecture revision 32.
//
// Deterministic, synchronous, total, CommonJS. No I/O, no clock, no network, no
// filesystem, no environment read. Node-side by contract: exactly one standard-library
// module is required (node:util), at module initialization.
//
// INTRINSIC BINDING (m-96): every decision-critical intrinsic is captured ONCE at module
// initialization, below, as a plain function value. After initialization the file uses
// ONLY those captured values, operators, literals and own data properties of objects it
// created itself. It never calls a method through a prototype chain (no .call/.apply,
// no JSON, no Map/Set, no .indexOf/.push, no spread, no iterator, no template literal),
// and it creates arrays and records only with literals and Object.defineProperty on a
// null-prototype descriptor, so patched built-ins and inherited accessors cannot run.
// PROCESS-INTEGRITY BOUNDARY: code that runs in this process BEFORE this module has
// finished initializing can replace any intrinsic captured here. That is outside this
// module's guarantee; it is the existing process-integrity boundary (the Falcon process,
// its dependencies and its launch environment are trusted at load time).
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
const ObjectDefineProperty = Object.defineProperty;
const ObjectHasOwn = Object.hasOwn;
const ObjectPrototype = Object.prototype;
const ArrayIsArray = Array.isArray;
const ArrayPrototype = Array.prototype;
const NumberIsInteger = Number.isInteger;
const StringCtor = String;

function hasOwnKey(o, k) { return ObjectHasOwn(o, k); }
// Create an own data property without any [[Set]] (an inherited setter cannot run) and
// with a null-prototype descriptor (an inherited get/set/value cannot leak into it).
function setData(target, key, value) {
  ObjectDefineProperty(target, key, {
    __proto__: null, value: value, writable: true, enumerable: true, configurable: true
  });
}
// Plain loops over module-private frozen lists; no Array.prototype method is used.
function indexOfList(list, x) {
  for (let i = 0; i < list.length; i += 1) { if (list[i] === x) return i; }
  return -1;
}
function samePrimitive(a, b) { return a === b || (a !== a && b !== b); }

// --- private canonical required-realm set (literals, frozen, never exported) -------
const CANONICAL_REQUIRED_COUNT = 21;
const CANONICAL_REQUIRED_REALM_IDS = ObjectFreeze([
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11',
  'F12', 'F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21'
]);

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
    setData(items, items.length, d.value);  // read ONCE; no getter can run
  }
  return { ok: true, items: items, length: n };
}

// --- step 2: structural inspection of a record; runs no caller code --------------
function inspectRecordShape(r, out) {
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
    setData(values, i, d.value);
  }
  for (let i = 0; i < REQUIRED_KEYS.length; i += 1) {
    if (names[i] !== REQUIRED_KEYS[i]) return 'record-key-order';
  }
  for (let i = 0; i < values.length; i += 1) {
    const k = REQUIRED_KEYS[i];
    const v = values[i];
    if (proxyFault(v)) return 'record-value-proxy:' + k;
    if (v !== null && (typeof v === 'object' || typeof v === 'function')) {
      return 'record-value-type:' + k;
    }
  }
  if (out !== undefined) { for (let i = 0; i < values.length; i += 1) setData(out, i, values[i]); }
  return null;                                                     // shape accepted
}

// --- step 3: inert snapshot built from values already read through data descriptors --
// (no JSON, no serialisation hook). Primitive-only values were checked by the shape step;
// bigint and symbol values are refused by validateRecord's type checks.
function buildSnapshotRecord(v) {
  return {
    schemaVersion: v[0], id: v[1], mechanism: v[2], measurable: v[3], error: v[4],
    timedOut: v[5], typeofSharedWorker: v[6], descriptor: v[7], nativeCtor: v[8],
    constructed: v[9], repetitionsConsistent: v[10]
  };
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
  if (indexOfList(CANONICAL_REQUIRED_REALM_IDS, snap.id) === -1) return 'record-value-enum:id';
  for (let i = 0; i < ENUM_KEYS.length; i += 1) {
    const k = ENUM_KEYS[i];
    if (typeof snap[k] !== 'string') return 'record-value-type:' + k;
    if (indexOfList(ENUMS[k], snap[k]) === -1) return 'record-value-enum:' + k;
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
    && indexOfList(PRESENT_DESCRIPTORS, v.descriptor) !== -1
    && v.nativeCtor === 'present'                // 'mismatch'/'uncaptured'/'absent' INVALID
    && (v.constructed === true || v.constructed === false);
}

// --- SEAM part 1 (PRIVATE): everything that touches the caller's objects ---------
function snapshotAndValidate(perRealm) {
  const no = function (d) { return { ok: false, result: UNVERIFIED(d) }; };
  const container = readOwnArrayElements(perRealm, 'perRealm');
  if (!container.ok) return no(container.detail);

  const records = [];
  const seen = [];
  for (let i = 0; i < CANONICAL_REQUIRED_COUNT; i += 1) setData(seen, i, false);
  for (let i = 0; i < container.length; i += 1) {
    const raw = container.items[i];
    const readA = [];
    const shape = inspectRecordShape(raw, readA);          // proxy checked first inside
    if (shape) return no(shape + ':index-' + i);
    const readB = [];                                      // second independent read
    const shapeB = inspectRecordShape(raw, readB);
    if (shapeB) return no(shapeB + ':index-' + i);
    for (let j = 0; j < REQUIRED_KEYS.length; j += 1) {
      if (!samePrimitive(readA[j], readB[j])) return no('record-unstable:index-' + i);
    }
    const snap = buildSnapshotRecord(readA);
    const bad = validateRecord(snap);
    if (bad) return no(bad + ':index-' + i);
    const frozen = ObjectFreeze(snap);
    const idx = indexOfList(CANONICAL_REQUIRED_REALM_IDS, frozen.id);
    if (idx === -1) return no('realm-unknown-or-extra:' + frozen.id);
    if (seen[idx]) return no('realm-duplicate:' + frozen.id);
    setData(seen, idx, true);
    setData(records, records.length, frozen);
  }
  // complete-inventory check against the PRIVATE canonical list, in canonical order
  for (let i = 0; i < CANONICAL_REQUIRED_REALM_IDS.length; i += 1) {
    if (!seen[i]) return no('realm-missing:' + CANONICAL_REQUIRED_REALM_IDS[i]);
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
      || CANONICAL_REQUIRED_REALM_IDS.length !== CANONICAL_REQUIRED_COUNT) {
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

  const byIdx = [];                       // canonical index -> record (last one wins)
  for (let i = 0; i < CANONICAL_REQUIRED_COUNT; i += 1) setData(byIdx, i, undefined);
  for (let i = 0; i < snapshotRecords.length; i += 1) {
    const v = snapshotRecords.items[i];
    if (proxyFault(v)) return UNVERIFIED('snapshot-proxy:record');
    if (inspectRecordShape(v) !== null) return UNVERIFIED('snapshot-malformed');
    const idx = indexOfList(CANONICAL_REQUIRED_REALM_IDS, v.id);
    if (idx !== -1) setData(byIdx, idx, v);
  }

  // PASS 1 - GLOBAL VALIDATION over the PRIVATE canonical list. Every canonical
  // required record must be VALID-ABSENT or VALID-PRESENT before ANY presence is
  // inspected. Refuses at the FIRST offending id in canonical order.
  for (let i = 0; i < CANONICAL_REQUIRED_REALM_IDS.length; i += 1) {
    const id = CANONICAL_REQUIRED_REALM_IDS[i];
    const v = byIdx[i];
    if (!v) return UNVERIFIED('realm-missing:' + id);
    if (!isValidAbsence(v) && !isValidPresence(v)) {
      return UNVERIFIED('realm-not-affirmatively-validated:' + id);
    }
  }

  // PASS 2 - CLASSIFICATION, reached only when every canonical record is valid.
  for (let i = 0; i < CANONICAL_REQUIRED_REALM_IDS.length; i += 1) {
    const id = CANONICAL_REQUIRED_REALM_IDS[i];
    if (isValidPresence(byIdx[i])) return PRESENT(id);
  }

  // PASS 3 - arm only when every canonical record affirmatively proves absence.
  for (let i = 0; i < CANONICAL_REQUIRED_REALM_IDS.length; i += 1) {
    const id = CANONICAL_REQUIRED_REALM_IDS[i];
    if (!isValidAbsence(byIdx[i])) {
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
      buildSnapshotRecord: buildSnapshotRecord,
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
