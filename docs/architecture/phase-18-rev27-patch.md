# Phase 18 architecture patch — revision 27 (ARCH-27)

Base: architecture rev 2 plus the rev 3..rev 26 patches, at `7d2c1de` on `docs/phase-18-architecture`.
Inputs: `docs/phase-18-w6t-conformance-results.md` (CONF-01, EXECUTED, PARTIAL), `docs/architecture/phase-18-rev26-patch.md` and `phase-18-rev26-edits.json` (B.5, IC3/IC5/FC8, section J), `docs/architecture/phase-18-rev25-patch.md` (table W6-T), `docs/security/phase-18-design-review-23.md` (SEC-24), `docs/phase-18-acceptance-criteria.json`, plus the owner decision recorded in the ARCH-27 task packet.
Scope: design text only. No production source file, `package.json` script or workflow step is edited by rev 27. **Rev 27 executes nothing.**
Machine-applicable edits: `docs/architecture/phase-18-rev27-edits.json`; this document is normative for intent.

**Status carried forward.** Counts stay **98 total / 89 Must / 6 Should / 3 Could**.

**SUPERSEDED BY REV 28 (ARCH-28, CONF-02): this whole document is amended in place by `docs/architecture/phase-18-rev28-patch.md`. Every "42 rows" total in this document is superseded by **44 rows** (FC12 and IC9 added); the "pure JavaScript function" / "pure function" characterisation of `decide()` is WITHDRAWN and replaced by "deterministic Node-side decision function using a captured standard-library intrinsic"; the `PROXY-27` residual of section B.7 is WITHDRAWN and replaced by a proxy-rejection RULE using `util.types.isProxy` captured once at module initialization; the unreachable `disagreement` branch and its detail string are DELETED. Counts, C6-T 27/5, M-23/M-24 closed, M-25/M-26 open, O-1, OWNER-24, OWNER-25, the EMPTY supported-browser set and the exit-code registry are unchanged** C6-T stays **27 / 5** sourced from rev 23 section D.4. **M-23 and M-24 stay closed. M-25 stays OPEN. M-26 stays OPEN**, narrowed to the executed measurement. O-1 and the `PILOT_APPROVAL_RUN_TOKEN` text are untouched. OWNER-24 and OWNER-25 stay **DECIDED**; the supported-browser set stays **EMPTY**; scope stays **Chromium only**; **no Linux filesystem is admitted**. No exit code is added and no bypass exists. The untracked `phase-18-rev24-*` drafts are ignored.

## Section A — context, and what rev 27 changes

CONF-01 executed the rev 26 `decide(perRealm, requiredIds)` and found that **105 of 441 single-field mutations still produced `armed:true`**: `mechanism` deleted (21) or null/blank (21), `descriptor` deleted (21), `error` deleted (21) or null/blank (21). The cause is permissive property access: `isCleanAbsence` read `r.descriptor === undefined` and `(r.error === null || r.error === undefined)` as the *absence signal*, so a **deleted** field was indistinguishable from a measured negative, and `mechanism` was never validated at all. By the owner's rule — "no missing measurement can produce `armed:true`" — the rev 26 contract still has a missing-measurement path, narrower than M-26 but of the same kind.

| Item | Change | Primary targets |
|---|---|---|
| 1 | **Closed, versioned per-realm evidence schema** (section B.2): an exact 11-key required own-property set, exact types and enumerations, **named sentinels** for "no error", "no descriptor", "no native constructor". **Absence of a field is always UNVERIFIED.** | rev 26 B.5, AC-091, ADR-0051 |
| 2 | **Snapshot → freeze → validate → decide order** (section B.6) so getters or post-validation mutation cannot change evidence | B.5/B.6, FC10 |
| 3 | **Reference `validateRecord` + `decide`** text, pure, no I/O (section B.5) | Developer handoff |
| 4 | **Table W6-T CONSOLIDATED and reprinted in full** (section C): the rev 25 + rev 26 split is superseded; **authoritative total 42 rows** | W6-T, checker, QA |
| 5 | **Exhaustive mutation sweep defined precisely** with schema-derived counts (section D): 1155 + 126 + 13 cases, **zero unexpected `armed:true`** | IC6, IC7, CONF-02 |
| 6 | **Browser identity by scratch executable wrapper + CDP corroboration** for section J; `browser.process()` and `ps` discovery are not acceptable; the product-side equivalent is an **OPEN design question** (`OPEN-BID-27`) | section J.2, IC8 |
| 7 | **FC2 defined exactly** so `fcDerived.fc2Pass` can never be reported as an unexplained flag (section J.4) | CONF-02 |
| 8 | Repository-wide contradiction search for the old permissive `decide()` text and the old 34/36 totals, every hit disposed in place (section K) | section K |

Nothing is weakened: every change either refuses in more input shapes or records a measurement obligation.

## Section B — the closed, versioned per-realm evidence schema

### B.1 Constraints

Pure CommonJS, no I/O, no clock, no network, no filesystem, no environment read inside `decide`. Deterministic for CI. No new public surface (OWNER-25). `Logger.*` only at the call site; `fs.promises.*` for any evidence write. The function must be **total**: every input shape yields a decision, never a throw.

### B.2 Schema `sharedWorkerRealmEvidence` version 1

A realm record is evidence **only if** it is a plain object whose own property names are **exactly these 11, in this canonical order**, each a **data property**:

| # | Key | Type | Allowed values |
|---|---|---|---|
| 1 | `schemaVersion` | number (integer) | exactly `1` |
| 2 | `id` | string | one of `F1`..`F21` |
| 3 | `mechanism` | string | `page.evaluate` \| `frame.evaluate` \| `popup.page.evaluate` \| `serviceworker.probe` \| `unavailable` |
| 4 | `measurable` | boolean | `true` \| `false` |
| 5 | `error` | string | sentinel `none` \| `threw` \| `timeout` \| `not-created` \| `frame-not-found` \| `unexpected-success-no-allow-scripts` \| `unreachable` |
| 6 | `timedOut` | boolean | `true` \| `false` |
| 7 | `typeofSharedWorker` | string | `undefined` \| `function` \| `object` \| `other` \| `unreadable` |
| 8 | `descriptor` | string | sentinel `absent` \| `present-data` \| `present-accessor` \| `unreadable` |
| 9 | `nativeCtor` | string | sentinel `absent` \| `present` \| `mismatch` \| `uncaptured` |
| 10 | `constructed` | boolean | `true` \| `false` |
| 11 | `repetitionsConsistent` | boolean | `true` \| `false` |

**Named sentinels, and why strings.** "No error", "no descriptor" and "no native constructor" are represented by the **string** sentinels `'none'`, `'absent'` and `'absent'`, not by `undefined`, `null`, `''` or a missing key, and not by an object such as `{state:'absent'}`. Strings are chosen over objects because: a string has exactly one canonical form, survives `JSON` round-trip and `structuredClone` unchanged, cannot carry hidden own keys, accessors or a prototype, is comparable with `===` in one step, and needs no nested validation (an object sentinel would reintroduce the same open-shape problem one level down). The cost is that the sentinel shares the value space of the other enumeration members — accepted, because each field's enumeration is closed and validated exactly.

**`nativeCtorValue` and `nativeCtorMatched` are withdrawn** and replaced by `nativeCtor`. The rev 26 `hasOwnProperty(r,'nativeCtorValue') && r.nativeCtorValue === undefined` idiom is withdrawn: it stores the absence claim in an `undefined` value, which `JSON` drops and a delete imitates.

**Clean absence** (the only armable realm state) is exactly:
`measurable===true && error==='none' && timedOut===false && typeofSharedWorker==='undefined' && descriptor==='absent' && nativeCtor==='absent' && constructed===false && repetitionsConsistent===true && mechanism!=='unavailable'`.

**Measured presence** is exactly: a schema-valid record with `typeofSharedWorker==='function' || constructed===true`.
Any schema-valid record that is neither clean absence nor measured presence is **unverified**.

**Note on F21.** The service-worker realm is not queryable today, so its real record carries `mechanism:'unavailable'`, `measurable:false`, `error:'unreachable'` and can never be clean absence — exactly the REQUIRED FAIL-CLOSED outcome of W6-T. `mechanism:'serviceworker.probe'` exists in the enumeration only so the **synthetic** all-absent positive control (IC3/IC6 base) is expressible at unit level. No measurement produces it today, and the patch does not claim otherwise.

### B.3 Rejection rules (all ⇒ `armed:false`, exit 18, `shared_worker_block_unverified`)

Non-array `perRealm` or `requiredIds`; a **sparse array** or an array with extra own keys (`Object.keys(perRealm).length !== perRealm.length`); a record that is not a **plain object** (`Object.getPrototypeOf(r) !== Object.prototype`, which rejects class instances and, by explicit decision, **null-prototype objects**: requiring exactly `Object.prototype` is one total check and is what a snapshot always produces); any **symbol** own key; any **accessor** (getter or setter) own property; any **missing** key; any **extra** key; any **inherited** key (only own names are read, and the own-name set must match exactly, so a prototype-supplied value cannot substitute for a missing own key); **non-canonical key order**; a value of the wrong **type**; a value outside its **enumeration**; an **unknown `schemaVersion`**; a **duplicate realm id**; a record whose **two structural reads disagree**. The rev 26 `requiredIds` exact-set rules (no missing, duplicate, extra or unknown id; every required id exactly once in `perRealm`) stay in force verbatim.

### B.4 Precedence (unchanged in order, widened in step 1)

1. invalid, incomplete or unverified evidence ⇒ `armed:false`, exit **18**, `shared_worker_block_unverified`;
2. otherwise any **measured presence** ⇒ `armed:false`, exit **18**, `shared_worker_present`;
3. only complete, valid, **unanimous** validated absence ⇒ `armed:true`, exit 0 — and then only if OWNER-24 (B.1 of rev 26, same-process rule) holds.

### B.5 Reference text (pure functions, no I/O)

**SUPERSEDED BY REV 28 (ARCH-28, CONF-02): the heading's "pure functions" claim is WITHDRAWN and the code block below is superseded by rev 28 section B.5. `decide()` is a deterministic Node-side decision function that captures `isProxy` ONCE at module initialization from `node:util` and rejects a Proxy at every accepted container boundary BEFORE any property enumeration, prototype inspection, descriptor access, snapshot, clone or freeze. CONF-02 executed the text below and measured a pass-through Proxy ARMING, which the owner's rule forbids. Also changed by rev 28: the own-descriptor/accessor check now runs BEFORE the canonical-key-order check, and the unreachable `disagreement` branch is deleted. The text below stays as history**

Normative behaviour; the implementation may differ in style but not in outcome.

```js
// Pure, synchronous, no I/O. Closed and total: every input shape yields a decision.
const SCHEMA_VERSION = 1;

const CANONICAL_REQUIRED_REALM_IDS = Object.freeze([
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11',
  'F12','F13','F14','F15','F16','F17','F18','F19','F20','F21'
]);

// Canonical key order is part of the contract.
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

// --- step 1: structural inspection of the CALLER's object; invokes no user value code ---
function inspectRecordShape(r) {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return 'record-not-plain-object';
  if (Object.getPrototypeOf(r) !== Object.prototype) return 'record-prototype-invalid';
  if (Object.getOwnPropertySymbols(r).length !== 0) return 'record-symbol-key';
  const names = Object.getOwnPropertyNames(r);
  if (names.length !== REQUIRED_KEYS.length) return 'record-keys-mismatch';
  for (let i = 0; i < REQUIRED_KEYS.length; i += 1) {
    if (names[i] !== REQUIRED_KEYS[i]) return 'record-key-order';
  }
  for (const k of REQUIRED_KEYS) {
    const d = Object.getOwnPropertyDescriptor(r, k);
    if (!d) return 'record-keys-mismatch';
    if (!Object.prototype.hasOwnProperty.call(d, 'value')) return 'record-accessor-property';
  }
  return null; // shape accepted
}

// --- step 2: inert snapshot. JSON round-trip yields a plain, prototype-Object, data-only
//     object graph that is not a Proxy and shares no identity with the caller's object.
//     A key whose value is `undefined` disappears here, which the key check then refuses. ---
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

function hasMeasuredPresence(v) {
  return v.typeofSharedWorker === 'function' || v.constructed === true;
}

function decide(perRealm, requiredIds) {
  // (1) input shape
  if (!Array.isArray(perRealm) || !Array.isArray(requiredIds)) return UNVERIFIED('input-not-array');
  if (Object.keys(perRealm).length !== perRealm.length) {
    return UNVERIFIED('array-sparse-or-extra-keys'); // holes and extra own keys both refuse
  }
  // (2) requiredIds must equal the canonical set exactly (rev 26 rules, unchanged)
  const req = requiredIds.slice();
  const canonical = CANONICAL_REQUIRED_REALM_IDS;
  if (req.length !== canonical.length || new Set(req).size !== req.length) {
    return UNVERIFIED('required-id-set-malformed');
  }
  for (const id of req) if (!canonical.includes(id)) return UNVERIFIED('required-id-unknown');
  for (const id of canonical) if (!req.includes(id)) return UNVERIFIED('required-id-missing');

  // (3) snapshot -> freeze -> validate, per record, BEFORE any decision is taken
  const validated = new Map();
  for (let i = 0; i < perRealm.length; i += 1) {
    const raw = perRealm[i];
    const shape = inspectRecordShape(raw);
    if (shape) return UNVERIFIED(shape + ':index-' + i);
    const snapA = snapshotRecord(raw);
    const snapB = snapshotRecord(raw);          // second independent read
    if (snapA === null || snapB === null) return UNVERIFIED('record-not-snapshotable:index-' + i);
    if (JSON.stringify(snapA) !== JSON.stringify(snapB)) {
      return UNVERIFIED('record-unstable:index-' + i); // varying getter or Proxy trap
    }
    const bad = validateRecord(snapA);
    if (bad) return UNVERIFIED(bad + ':index-' + i);
    const frozen = Object.freeze(snapA);
    if (!req.includes(frozen.id)) return UNVERIFIED('realm-unknown-or-extra:' + frozen.id);
    if (validated.has(frozen.id)) return UNVERIFIED('realm-duplicate:' + frozen.id);
    validated.set(frozen.id, frozen);
  }
  for (const id of req) if (!validated.has(id)) return UNVERIFIED('realm-missing:' + id);

  // (4) precedence step 1: anything neither clean absence nor measured presence is unverified
  for (const id of req) {
    const v = validated.get(id);
    if (!isCleanAbsence(v) && !hasMeasuredPresence(v)) {
      return UNVERIFIED('realm-not-affirmatively-validated:' + id);
    }
  }
  // (5) precedence step 2: any measured presence refuses as present
  for (const id of req) {
    if (hasMeasuredPresence(validated.get(id))) {
      return { armed: false, exit: 18, reason: 'shared_worker_present', detail: 'realm:' + id };
    }
  }
  // explicit invariant, redundant after (4)
  if (new Set(req.map((id) => validated.get(id).typeofSharedWorker)).size > 1) {
    return UNVERIFIED('disagreement');
  }
  // (6) only complete, valid, unanimous validated absence arms
  return { armed: true, exit: 0, reason: 'shared_worker_absent_all_realms' };
}
```

The returned object carries `detail` but **not** the caller's array; the reporter receives the frozen snapshots from the probe layer, so no page-influenced object graph is forwarded.

### B.6 Order of operations, stated as a rule

**snapshot → validate the snapshot → freeze → decide on the snapshot.** The caller's object is read only by `inspectRecordShape` (descriptor reads) and by the two `JSON.stringify` passes. Every value the decision reads comes from the frozen snapshot. Therefore mutating the caller's record **after** validation and **before** the decision cannot change the decision; the decision is either unchanged or, if the mutation is visible across the two snapshot reads, a refusal (`record-unstable`). Chosen over `structuredClone` because `JSON` round-trip is CommonJS-safe on Node 22 and 24 without feature detection, drops `undefined`-valued keys into a refusal, and maps `NaN`/`Infinity` to `null`, which the type checks then refuse; it also cannot clone functions or class instances. Dates, maps and sets are not part of the schema.

### B.7 Stated residual: Proxy

**SUPERSEDED BY REV 28 (ARCH-28, CONF-02): SECTION B.7 IS WITHDRAWN IN PLACE. `PROXY-27` is not a residual any more and NO PROXY EXCEPTION EXISTS: rev 28 section B.7 replaces it with a rule - `isProxy` captured once at module initialization from `node:util`, applied to `perRealm`, `requiredIds`, every realm record and every non-primitive own value, before any trap-triggering operation, so transparent, trapping, revoked, array-level, `requiredIds`-level, nested-value and post-validation proxies all return `shared_worker_block_unverified`, exit 18, `armed:false`, with no uncaught exception. `isProxy` identifies a Proxy, including a revoked one, without triggering a trap. What honestly remains is narrower: the rule is Node-only, an intrinsic captured at initialization cannot protect against an already-compromised process that patched `node:util` earlier, and a NON-Proxy exotic object with malicious getters is covered instead by the own-data-property, prototype, symbol-key, key-order, enumeration and two-read stability checks**

Pure JavaScript **cannot** distinguish a Proxy that is observationally identical to a conforming frozen plain record from that record. Rev 27 does not claim detection. It claims: every structural read happens twice and disagreement refuses; a trap that throws, reports an accessor, hides or adds a key, breaks canonical key order or varies a value refuses; `decide` never decides on the caller's object, only on its own inert snapshot, which is not a Proxy. A Proxy supplying exactly the values of a valid record therefore yields the same decision as that record. Recorded as openItem `PROXY-27` for Security to rule on; no text may upgrade it to a detection claim.

### B.8 Interfaces

- **Internal, changed:** `decide(perRealm, requiredIds)` → `{ armed, exit, reason, detail }`. Pure, synchronous, total; the primary unit seam. The rev 26 return field `perRealm` is **removed** from the result.
- **Internal, new:** `validateRecord(snapshot)` → `null | detailString`; `inspectRecordShape(record)` → `null | detailString`; `snapshotRecord(record)` → plain object or `null`. All pure and individually unit-testable.
- **Internal, changed:** `SharedWorkerCapabilityProbe.measure(...)` must emit records conforming to schema version 1 (11 keys, canonical order, sentinels). Emitting a non-conforming record is a refusal, not a coercion opportunity: the probe must never fill a missing measurement with a default.
- **Internal, unchanged:** `BrowserIdentity.assert(browser, expected)` (rev 26 B.6), still refusing with exit 18 `shared_worker_block_unverified` on any mismatch. Its **mechanism** is the subject of `OPEN-BID-27` and is not decided here.
- **Public surface:** unchanged — no CLI flag, no environment variable, no config key (OWNER-25). CommonJS throughout.
- **Observability:** one `Logger.error` naming code, exit, reason, `detail` and realm id; the structured `sharedWorkerCapability` report block carries the frozen validated snapshots, the schema version, the per-realm `detail` and the browser identity record. `detail` strings are drawn from the closed list in the `exitCodes` note and are never page-supplied.

### B.9 Trust boundaries and data flow

Boundary 1: browser → Node. Values cross only as the results of Falcon's own `evaluate` expression against a Falcon-authored local document before any external target access (rev 26 B.3; `evaluate` runs in the page's **main world**). Boundary 2: probe layer → `decide`. Rev 27 makes this boundary **schema-checked and one-way**: the probe hands over candidate records; `decide` snapshots, validates, freezes and decides, and returns a verdict with no object identity shared with the probe. Boundary 3: `decide` → `NetworkGate.install`, which refuses before any navigation on a non-armed verdict and additionally requires the OWNER-24 same-process validation before acting on `armed:true`. No page-supplied string reaches a reason, a `detail` or a log line.

## Section C — table W6-T, CONSOLIDATED (single source, reprinted in full)

**This table is the single source of SharedWorker realm and case ids, counts and expected results.** It supersedes the split of rev 25 section C (C.1–C.4) and rev 26 section C; those remain only as history. **Authoritative row count after rev 27: 42 rows.**

**SUPERSEDED BY REV 28 (ARCH-28, CONF-02): the authoritative row count is **44 rows** and the single source is the full reprint in rev 28 section C; FC12 (proxy rejection) and IC9 (the 7-case proxy battery) are added**

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
| F13 | popup, same-origin (`window.open`) | `popup.page.evaluate` | present ⇒ `shared_worker_present` 18; construction confirmation owed, an unconfirmable popup is fail-closed |
| F14 | popup, cross-origin, `noopener` | `popup.page.evaluate` | as F13 |
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
| F22 | dedicated-worker global scope | informational only; `typeof SharedWorker === 'undefined'` observed (W6); **must never appear in `perRealm`**; contributes neither a pass nor a refusal; re-check on Chromium upgrade |

### C.3 Decision-function and mechanism cases (FC1..FC11) — 11 rows

| Id | Case | Expected result | Coverage |
|---|---|---|---|
| FC1 | pre-author-script native-constructor capture via `addInitScript`, compared with the evaluate-time read in every measurable realm | must match; mismatch ⇒ `nativeCtor:'mismatch'` ⇒ `shared_worker_block_unverified` 18 | W6 (matched) |
| FC2 | page-mutation evasion (five sub-observations, section J.4) | decision unchanged and the pre-captured native reference still usable; otherwise `shared_worker_block_unverified` 18 | W6 (confirmed); `fc2Pass` to be re-derived by CONF-02 |
| FC3 | no page-supplied value influences the decision | structural: the decision reads only Falcon's own `evaluate` results against a Falcon-authored document (main world) and only through the validated snapshot; a forged "absent" verdict changes nothing | W7 |
| FC4 | probe timeout in a required realm | `timedOut:true` ⇒ `shared_worker_block_unverified` 18 | W7 |
| FC5 | required realm cannot be created | `error:'not-created'` ⇒ `shared_worker_block_unverified` 18 | W7 |
| FC6 | realm results disagree | `shared_worker_block_unverified` 18 | W7 |
| FC7 | the capability check itself throws | `error:'threw'` ⇒ `shared_worker_block_unverified` 18 | W7 |
| FC8 | `requiredIds` contract: must equal `F1..F21` exactly; non-array, missing, duplicate, extra or unknown id rejected | `shared_worker_block_unverified` 18 with the matching `detail` | W7 |
| **FC9** (new) | **per-realm evidence schema contract:** exact 11-key own-property set, canonical key order, data properties only, plain-object prototype, no symbol key, no inherited key, exact types and enumerations | every violation ⇒ `shared_worker_block_unverified` 18 with the matching `detail`; **absence of a field is always unverified** | W7 / CONF-02 |
| **FC10** (new) | **order and immutability:** snapshot → validate snapshot → freeze → decide; mutating the caller's record after validation | decision **unchanged**, or refusal `record-unstable`; never `armed:true` created by the mutation | W7 / CONF-02 |
| **FC11** (new) | **schemaVersion gating:** only version `1` is accepted | `0`, `2`, `'1'`, missing or non-integer ⇒ `shared_worker_block_unverified` 18 (`schema-version-unknown` / `record-value-type:schemaVersion`) | W7 / CONF-02 |

### C.4 Control fixtures (IC1..IC8) — 8 rows

| Id | Fixture | Expected result | Coverage |
|---|---|---|---|
| IC1 | positive control: `new SharedWorker(url)` against the loopback fixture | the fixture's HTTP log records the shared-worker **script fetch** (probe is not vacuous) | W6 (measured) + CONF-02 |
| IC2 | inversion at browser level: a configuration in which `typeof SharedWorker` is `'undefined'` in every measurable realm | the rule **still refuses** while any required realm is unmeasurable | W6 (measured) + CONF-02 |
| IC3 | inversion at unit level, synthetic `perRealm`: 21 fully schema-valid clean-absence records ⇒ `armed:true` exit 0 (**authorised positive control; the only place `armed:true` is exercised, never against a customer target**); one present ⇒ 18 `shared_worker_present`; one unmeasurable / timed-out / errored ⇒ 18 `shared_worker_block_unverified`; disagreement ⇒ 18; empty array ⇒ 18 | as stated | W7 / CONF-02 |
| IC4 | inversion: probe disabled or removed | execute mode must **not** arm; removing the gate must fail the test | W7 |
| IC5 | `decide()` negative-case battery: missing realm, duplicate id, extra id, unknown id, `undefined` `measurable`, `null` typeof, `'object'` typeof, malformed record, non-array input, conflicting repetitions | every case ⇒ 18 `shared_worker_block_unverified`, `armed:false` | W7 / CONF-02 |
| **IC6** (new) | **exhaustive single-field mutation sweep** (section D): 21 × 11 × 5 = **1155** malformed cases, plus 21 × 6 = **126** valid-negative substitutions | **1155** ⇒ 18 `shared_worker_block_unverified`; of the 126: 42 ⇒ 18 `shared_worker_present`, 84 ⇒ 18 `shared_worker_block_unverified`; **zero unexpected `armed:true`** | W7 / CONF-02 |
| **IC7** (new) | **structural rejection battery**, 13 named cases (section D.3) | every case ⇒ 18 `shared_worker_block_unverified` with the expected `detail` | W7 / CONF-02 |
| **IC8** (new) | **browser process identity** established before the run and re-verified immediately before the simulated run step (section J.2) | identity established and unchanged, or ⇒ 18 `shared_worker_block_unverified`; **it never arms** | CONF-02 |

### C.5 Carried worker-WebSocket case — 1 row

| Id | Case | Expected result | Coverage |
|---|---|---|---|
| FW-1 | dedicated-worker-initiated WebSocket against a fixture with a real WS upgrade | **WebSocket behaviour remains UNMEASURED** and FW-1 stays an independent arming blocker; its **required fail-closed decision** (unmeasured ⇒ `shared_worker_block_unverified` 18, `armed:false`) is executed 3× per Node version | CONF-02 (decision only) |

**Authoritative total: 21 (F1..F21) + 1 (F22) + 11 (FC1..FC11) + 8 (IC1..IC8) + 1 (FW-1) = 42 rows.**

**SUPERSEDED BY REV 28 (ARCH-28, CONF-02): the authoritative total is 21 (F1..F21) + 1 (F22) + **12** (FC1..FC12) + **9** (IC1..IC9) + 1 (FW-1) = **44 rows**, reprinted in full in rev 28 section C** SPIKE-W6 covers 15 decision realms plus FC1, FC2, IC1 and IC2; every other row is owed to SPIKE-W7 and the section J gate. The rev 25 "34 rows" and the rev 26 "36 rows" totals are superseded by **42**. C6-T stays **27 / 5** and the two inventories stay disjoint.

## Section D — the exhaustive sweep, defined precisely

### D.1 Base array `B27`

`B27` is the synthetic array of **21** records, one per `CANONICAL_REQUIRED_REALM_IDS` entry, each schema-valid and in clean absence: `schemaVersion:1`, `id` the realm id, `mechanism` the realm's C.1 mechanism (`serviceworker.probe` for F21, synthetic by construction), `measurable:true`, `error:'none'`, `timedOut:false`, `typeofSharedWorker:'undefined'`, `descriptor:'absent'`, `nativeCtor:'absent'`, `constructed:false`, `repetitionsConsistent:true`. `decide(B27, CANONICAL_REQUIRED_REALM_IDS)` must return `armed:true`, exit 0 — this is the **single authorised positive control** and the only permitted `armed:true` outcome in the whole sweep.

### D.2 Sweep A — malformed single-field mutations (1155 cases)

For **every** realm index (21) × **every** required key (11) × **every** mutation (5), apply the mutation to a deep copy of `B27` and call `decide`. The mutation table is fixed so the checker can derive counts from the schema constants:

| Mutation | Definition |
|---|---|
| `delete` | `delete rec[key]` |
| `null` | `rec[key] = null` |
| `blank` | `rec[key] = ''` |
| `typeChange` | string-valued key ⇒ `true`; boolean-valued key ⇒ `1`; `schemaVersion` ⇒ `'1'` |
| `invalidValue` | out-of-enumeration value of the right type: `schemaVersion` ⇒ `2`; `id` ⇒ `'F22'`; `mechanism` ⇒ `'absent'`; `error` ⇒ `'no-error'`; `typeofSharedWorker` ⇒ `'undef'`; `descriptor` ⇒ `'none'`; `nativeCtor` ⇒ `'none'`; boolean keys ⇒ `'yes'` |

**Count: 21 × 11 × 5 = 1155.** Expected for **every** case: `armed:false`, exit **18**, reason `shared_worker_block_unverified`. Semantically valid negatives are deliberately **excluded** from Sweep A so the "every malformed case refuses with `shared_worker_block_unverified`" assertion is exact.

### D.3 Sweep B — valid-but-negative substitutions (126 cases) and Sweep C — structural battery (13 cases)

Sweep B: for every realm (21) × these 6 in-schema substitutions: `measurable:false`, `timedOut:true`, `repetitionsConsistent:false`, `error:'threw'`, `typeofSharedWorker:'function'`, `constructed:true`. **Count 21 × 6 = 126.** Expected: all `armed:false`, exit 18; the 42 presence cases (`typeofSharedWorker:'function'`, `constructed:true`) ⇒ `shared_worker_present`; the other 84 ⇒ `shared_worker_block_unverified`.

Sweep C (13 named cases, each applied to `B27`) **- SUPERSEDED BY REV 28: 20 named cases (the 13 below plus 7 proxy cases C14..C20), so the schema-derived totals become Sweep A 1155 + Sweep B 126 + Sweep C 20 = 1301 refusals plus exactly 1 authorised `armed:true` across 1302 `decide()` invocations; the C3/C4 expected detail is `record-accessor-property`, not `record-key-order`, because the accessor check now runs first**: C1 extra own property on a record; C2 inherited property (`Object.create(validRecord)` with the own key deleted); C3 getter for a required key; C4 setter for a required key; C5 Proxy whose trap varies between reads; C6 symbol own key; C7 sparse array (`delete arr[7]`); C8 extra own key on the array; C9 class-instance record; C10 null-prototype record; C11 non-canonical key order; C12 duplicate realm id; C13 post-validation mutation (mutate the caller's record after validation, before the decision). Expected: **every** case `armed:false`, exit 18, `shared_worker_block_unverified` with the expected `detail`; for C13 the decision must be **unchanged** relative to the unmutated base, or a refusal — never a new `armed:true`. Unknown `schemaVersion` is covered by Sweep A `invalidValue`/`typeChange` and by FC11.

**Checker assertions, derived from the schema:** `|CANONICAL_REQUIRED_REALM_IDS| = 21`, `|REQUIRED_KEYS| = 11`, `|MUTATIONS| = 5`, `|VALID_NEGATIVES| = 6`, `|STRUCTURAL| = 13` ⇒ Sweep A `21*11*5 = 1155`, Sweep B `21*6 = 126`, Sweep C `13`, total **1294 refusals** plus **exactly 1** `armed:true` (the `B27` control) across **1295** `decide` invocations. The sweep **must report ZERO unexpected `armed:true`**; one unexpected arming is a gate failure, not a warning.

## Section E — alternatives considered

| Alternative | Tradeoff | Verdict |
|---|---|---|
| Add required-field presence checks to the rev 26 `isCleanAbsence` only | Smallest diff; closes `mechanism`/`error`/`descriptor` deletion but leaves the open record shape, accessors, symbol keys, extra keys and version drift | **Rejected** — fixes the five observed classes, not the class of defect |
| Keep `undefined`/falsy as the absence signal and require `hasOwnProperty` for each key | No schema version, no enumerations; `undefined` still vanishes through any serialisation and a `null` still coerces | **Rejected** — absence of a field must never be a valid negative |
| Object sentinels (`descriptor:{state:'absent'}`, `error:{state:'none'}`) | Self-describing; but each sentinel becomes another open object needing shape validation, and object identity reopens the getter/Proxy surface | **Rejected** — string sentinels give one canonical form and one comparison |
| JSON Schema / a validation library | Declarative; adds a runtime dependency, is not pure CommonJS-trivial, and hides the refusal reasons behind library messages | **Rejected** — the validator is 60 lines and must be auditable |
| `structuredClone` instead of JSON round-trip | Preserves more types; needs no feature detection on Node 22/24 but preserves `undefined` values and `null`-prototype shapes, weakening two refusals | **Rejected** for this schema; JSON round-trip refuses more |
| **Closed, versioned per-realm evidence schema with snapshot → validate → freeze → decide** | Longest validation prologue; every refusal is attributable, the whole contract is unit-testable without a browser, and absence of a field can never arm | **Chosen** |
| `browser.process()` or `ps` discovery for identity | Zero scaffolding; CONF-01 measured `ps` discovery finding **zero** candidates, and `browser.process()` is undefined for connected browsers | **Rejected** for the gate |
| **Scratch executable wrapper + CDP corroboration (measurement scaffolding only)** | Needs a wrapper binary and a scratch identity file; gives a PID recorded by the process itself, unchanged by the `exec`, plus independent CDP corroboration | **Chosen for CONF-02 only**; the product-side equivalent stays `OPEN-BID-27` |

## Section F — failure modes, fallback, observability, rollback

| Failure mode | Behaviour |
|---|---|
| any schema violation, missing/extra/inherited key, accessor, symbol key, key-order change, wrong type, out-of-enum value | exit 18 `shared_worker_block_unverified`, `detail` naming the violation and the record index |
| unknown `schemaVersion` | same, `schema-version-unknown` — a future probe version cannot arm against an older decider |
| record not snapshotable (cycle, BigInt, function value) | same, `record-not-snapshotable` |
| two structural reads disagree (varying getter or Proxy trap) | same, `record-unstable` |
| caller mutates a record after validation | decision unchanged (decision reads the frozen snapshot) or `record-unstable` |
| probe throws, hangs, times out, or a realm cannot be created | same, via `error`/`timedOut` sentinels |
| capability present in any validated realm | exit 18 `shared_worker_present`, realm id named |
| browser identity not established or any value changed | exit 18 `shared_worker_block_unverified`; **never arms** |
| probe removed or disabled | execute mode must not arm (IC4); the test fails |

**Fallback:** none to a weaker mode; the only fallback is refusal. **Rollback:** design rollback only — no code ships from rev 27. Reverting restores the rev 26 `decide`, which CONF-01 measured arming on 105 of 441 mutations, so a revert requires a fresh owner decision. **Observability:** B.8; the `detail` list is closed and page-independent. **Determinism:** `decide`, `validateRecord`, both sweeps and all of FC8..FC11, IC3, IC5, IC6, IC7 are pure and need **no browser**, so they are safe CI unit tests on Node 22 and 24.

## Section G — compatibility and migration

No public surface change; no exit code added; precedence unchanged (`2 > 3 > 18 > 17 > 16 > 15 > 13 > 12 > 11 > 14 > 10 > 1 > 0`). CommonJS only; no new dependency. Migration is internal and documentation-only today (no caller exists in the tree): (1) the probe must emit schema-version-1 records — the rev 26 field list and `nativeCtorValue`/`nativeCtorMatched` are withdrawn in favour of `nativeCtor`; (2) `decide`'s result no longer echoes `perRealm`; (3) the W6-T checker must assert the **42**-row id set and the sweep counts. CI must continue to expect exit 18 from pilot execute mode, must not treat the refusal as a flake, and must match the reason **set** rather than a single string; on the current build the reason is `shared_worker_block_unverified`. Any harness or fixture that builds `perRealm` by hand must be regenerated from the schema, because a hand-written record missing a key now refuses.

## Section H — test seams and acceptance-criteria mapping

| Seam | Rows | Browser needed |
|---|---|---|
| `inspectRecordShape` | FC9, IC7 (C1..C12) | no |
| `validateRecord` | FC9, FC11, IC5, IC6 Sweep A | no |
| `snapshotRecord` + freeze order | FC10, IC7 C5/C13 | no |
| `decide` | FC3, FC4..FC8, IC3, IC5, IC6, IC7 | no |
| probe → schema conformance | F1..F21, FC1, FC2, IC1, IC2 | yes |
| `BrowserIdentity.assert` | IC8 | yes |
| `NetworkGate.install` refusal before navigation | IC4, F-row gate runs | yes |

**AC mapping.** `P18-AC-091` carries the rev 27 schema, sentinel, ordering and precedence requirements (edits JSON `ac[]`). The W6-T 42-row inventory and the sweep counts are carried by the `counts.rev27Note`; the `detail` vocabulary by `exitCodes.rev27Note`. M-26 maps to FC9, FC10, FC11, IC6 and IC7; M-25 maps to the complete section J execution; `OPEN-BID-27` maps to IC8 and is explicitly **not** satisfied by rev 27.

## Section I — ADR-0051 (short ADR; durable and cross-cutting)

**ADR-0051 — SharedWorker arming evidence is a closed, versioned per-realm schema; absence of a field is always unverified.**
*Status:* Accepted (design). **Amends ADR-0050**, which stays in force for the required-id-set rules, the same-process rule and the no-exception rule.
*Context:* CONF-01 executed the ADR-0050 / rev 26 `decide()` and measured 105 of 441 single-field mutations arming, because a deleted `descriptor` or `error` was indistinguishable from a measured negative and `mechanism` was never validated.
*Decision:* a realm record is evidence only if it is a frozen-snapshot plain object with exactly the 11 required own data keys in canonical order, `schemaVersion === 1`, and every value matching an exact type or closed enumeration; "no error", "no descriptor" and "no native constructor" are the named string sentinels `'none'`, `'absent'`, `'absent'`; `decide` snapshots, validates and freezes before deciding; every other input shape refuses with `shared_worker_block_unverified`, exit 18. Precedence stays unverified → present → armed.
*Consequences:* the probe must emit schema-conforming records and may never default a missing measurement; a probe schema bump cannot silently arm; `armed:true` exists only for the synthetic authorised positive control; Proxy indistinguishability is a stated residual (`PROXY-27`); table W6-T is consolidated at 42 rows.

**SUPERSEDED BY REV 28 (ARCH-28, CONF-02): ADR-0051 is AMENDED by ADR-0052 (rev 28 section I): the Proxy residual is withdrawn and replaced by the `isProxy` rejection rule, `decide()` is a deterministic Node-side function rather than a pure JavaScript one, and table W6-T is 44 rows**
*Alternatives rejected:* section E. *Failure modes, fallback, rollback, observability:* section F.

## Section J — executed W6-T conformance gate (CONF-02), required before Security

**SUPERSEDED BY REV 28 (ARCH-28, CONF-02): CONF-02 has EXECUTED and returned PARTIAL (`docs/phase-18-conf02-results.md`): a pass-through Proxy armed, FC1 and IC4 were not executed as independent rows, and F13/F14 were not created. The live gate is **CONF-03**, rev 28 section J, over 44 rows**

CONF-01 is **superseded, not upgraded**. Rev 27 executes nothing; `CONF-02` and `W6T-GATE` stay NOT EXECUTED / NOT SATISFIED.

### J.1 Executed-gate spec (consistent with rev 26 section J)

1. **Coverage:** every row of the consolidated 42-row table C, each row executed **independently at least 3 times on Node 22.19.0 and at least 3 times on Node 24.21.0**. CONF-01 ran F1..F21 as one array per run; that does not satisfy this.
2. **Per-row record:** row **ID**, **expected**, **actual**, **reason**, **exit**, **armed**, **Node version and browser identity**, **repetition index**, and the **target/network observation** for that repetition.
3. **Real-browser rows:** fresh isolated state per run — a **unique browser profile directory and a unique process group per run**, fresh empty context, explicit close, and **cleanup verified** (no browser or harness process and no profile directory left behind; the verification command and its output are recorded).
4. **Network:** **zero non-loopback requests and no external target access in every refusal run**, counted and recorded as `n of N` as CONF-01 did.
5. **Arming:** the **only** `armed:true` outcomes permitted anywhere in the gate are the explicitly authorised all-absent **positive controls with complete valid evidence** (`B27` / IC3). The sweeps must report **zero unexpected `armed:true`**.
6. **FW-1:** keeps its honest statement that **WebSocket behaviour is unmeasured**; its required fail-closed **decision** is executed **3× per Node version** and recorded as a decision row, never as a WebSocket measurement.
7. **Outcome rule:** a refusal is a **PASS** when it is the expected outcome. If any row is unmeasured the gate reports **PARTIAL** and arming stays refused. Documentation alone must not close M-25 or M-26.
8. **Output:** one evidence document plus the per-row table; input to M-25 and M-26 closure together with a Security review.

### J.2 Browser identity (measurement scaffolding only — never product code)

`browser.process()` and `ps`-heuristic discovery are **not used**: CONF-01's `ps` discovery found **zero** candidates and left the same-process rule unexercised.

1. **Scratch executable wrapper.** A small wrapper executable, created in the scratch directory and passed as Playwright's `executablePath`, (a) records **its own PID**, its **process start time**, its **normalized argument vector** and a **random per-run identity token** into a private scratch file with owner-only permissions, then (b) **`exec`s the real pinned Chromium binary so the PID is unchanged**. It is not a launcher-and-waiter: after `exec` the recorded PID *is* the browser process. It must print nothing to the browser's stdio and must expose **no credentials and no sensitive paths** in any finding; findings quote the token, the PID, the start time, the normalized args and the hash only.
2. **Independent hash.** The real Chromium executable is hashed independently of the wrapper and the hash recorded; the wrapper's own hash is recorded separately so the two are never conflated.
3. **CDP corroboration.** After Playwright connects, identity is corroborated via **`Browser.getVersion`** and, where supported, **`SystemInfo.getProcessInfo`**; the corroborated values are recorded next to the wrapper-recorded values.
4. **Re-verification.** **Immediately before the simulated run step**, the harness verifies that the **same PID is alive**, has the **same start time**, has the **expected normalized arguments**, and **corresponds to the connected browser** (token plus CDP corroboration).
5. **Failure rule.** If identity cannot be established, or **any** value changes, the expected outcome is **`shared_worker_block_unverified`, exit 18** — row IC8 — and **it never arms**.
6. **Product-side equivalent (OPEN, not decided).** Falcon must establish the same identity **without a wrapper**, through the launch API it already uses, and must refuse when identity cannot be established or any value changes. Which mechanism satisfies that is openItem **`OPEN-BID-27`**; the Developer must not invent one, and no wrapper may enter product code.

### J.3 Pure-function rows

FC8..FC11, IC3, IC5, IC6 and IC7 need no browser. They run on both Node versions, 3 repetitions each, and their results are recorded in the same per-row table with `browser identity: n/a (pure)`.

### J.4 FC2 and `fc2Pass`, resolved

**FC2** = page-mutation evasion. **FC2 PASSES only when, in every measurable realm, each of the five sub-observations holds:** (1) `delete window.SharedWorker`, (2) `Object.defineProperty` / `Reflect.defineProperty` redefinition, (3) plain assignment, (4) prototype and `__proto__` manipulation, (5) `with`-scope shadowing — each leaves the **pre-captured native constructor reference usable** (`new NativeCtor(...)` still constructs) **and** leaves the **decision byte-identical to the pre-mutation decision**. `fcDerived.fc2Pass` is the conjunction of those five per realm, over all measurable realms. **Expected result:** PASS on the current pinned Chromium, since SPIKE-W6 measured that pre-capture defeats page mutation. CONF-02 **must** emit the five sub-observations per realm so that a `false` is attributable to a named sub-observation; the CONF-01 `fc2Pass:false` is **UNEXPLAINED and must not be carried as a result**. FC2 is never an arming input on its own: a failing FC2 is `shared_worker_block_unverified`, exit 18.

## Section K — repository-wide contradiction and stale-reference search

Command form: `git grep -nI -- "<pattern>" 7d2c1de -- docs/` over `decide(perRealm`, `isCleanAbsence`, `descriptor === undefined`, `nativeCtorValue`, `nativeCtorMatched`, `34 rows`, `36 rows`, `36-row`, `table W6-T (36 rows)`, `MEASURED-PASS`, `SPIKE-W2 IS REQUIRED`. The untracked rev 24 drafts are excluded. Every hit and its disposition:

| Hit | Disposition |
|---|---|
| `phase-18-rev26-patch.md` B.5 heading and code block (permissive `isCleanAbsence`, `descriptor === undefined`, `nativeCtorValue`) | **LIVE → fixed.** In-place SUPERSEDED note at the B.5 heading naming the CONF-01 measurement; the code stays as history |
| `phase-18-rev26-patch.md:8` "34 rows → 36 rows" | **LIVE → fixed** (in-place note: 36 → 42, consolidated into rev 27 section C) |
| `phase-18-rev26-patch.md:168` totals "superseded by 36" | **LIVE → fixed** (in-place note: authoritative total 42, single source is rev 27 section C) |
| `phase-18-rev26-patch.md:221` section J "(36 rows), at least 3 repetitions per row" | **LIVE → fixed** (in-place note: 42 rows, each row executed independently ≥3× per Node; CONF-01's single-array run does not satisfy it) |
| `phase-18-rev26-patch.md:263` QA handoff "now 36 rows" | **LIVE → fixed** (in-place note: 42 rows; add FC9..FC11, IC6..IC8) |
| `phase-18-rev25-patch.md:145` totals "= 34 rows" | **LIVE → fixed** (in-place note: no longer the single source; 42 rows in rev 27 section C) |
| `phase-18-rev25-patch.md:74` `decide(perRealm)` signature and record field list | **LIVE → fixed** (in-place note: signature withdrawn; fields superseded by the 11-key schema; `nativeCtorValue`/`nativeCtorMatched` replaced by `nativeCtor`) |
| `phase-18-spike-w6-findings.md:46` "Decision function (Falcon-equivalent)" + the permissive harness `decide(perRealm)` | **LIVE → fixed** (in-place note: factual record of what was executed, measurements stand, **not** the live contract) |
| `phase-18-rev23-patch.md:64` "closed `decide(perRealm, requiredIds)` outcome against table W6-T (36 rows)" | **LIVE → fixed** (in-place correction: versioned schema; 42 rows) |
| `phase-18-rev23-patch.md:209` gate 1 "(rev 25 section C as amended by rev 26: 36 rows)" | **LIVE → fixed** (in-place correction: consolidated rev 27 table, 42 rows) |
| `phase-18-acceptance-criteria.json:33` openItem `SPIKE-W`: "SPIKE-W2 IS REQUIRED BEFORE 18C MERGES ... MEASURED-PASS" | **LIVE → fixed, and a process finding: the rev 26 `appendText` for this item was NOT applied at `7d2c1de`** (the file contains no "SUPERSEDED BY REV 25 AND REV 26" text). Rev 27 re-specifies the in-place note with the rev 27 contract and the 42-row total |
| `phase-18-acceptance-criteria.json:327` `rev25Note` "34 rows", `:328` `rev26Note` "36 rows" | **Historical applied notes → disposed by addition.** `counts.rev27Note` states that every live "34 rows" statement and every standalone "36 rows" total is superseded by **42** and that the single source is rev 27 section C. The older notes are not rewritten, so the applied-note history stays readable |
| `phase-18-acceptance-criteria.json:1229` AC-091 requirement (rev 26 `decide()` text with `descriptor===undefined`) | **LIVE → fixed** by the rev 27 `ac[]` `appendText`, which states the schema, the sentinels, the ordering rule and the withdrawal of `nativeCtorValue`/`nativeCtorMatched` |
| `phase-18-rev25-edits.json:116`, `phase-18-rev26-edits.json:10,20,45,93,119,127` | **Historical machine-edit specs of superseded revisions; not re-edited** — rewriting an applied edit spec would rewrite history rather than the design. Their targets now carry in-place notes |
| `phase-18-w6t-conformance-results.md` (105/441, `fc2Pass`, "36-row matrix") | **LIVE → disposed by an in-place DISPOSITION note**: rev 27 resolves the field-presence and identity design, defines `fc2Pass`, and re-points the re-run at the 42-row CONF-02. The document stays the record of CONF-01 and is **not** upgraded to a pass |
| `phase-18-design-review-23.md:24` (SEC-24 M-26 text quoting the permissive fix) | **Evidence document, left as written.** A Security review is a record of what the reviewer found; rev 27 answers it in the design, not by editing the review |
| `shared_worker_blocked`, `POLICY_SHARED_WORKER_BLOCKED`, `setAutoAttach`, `W2-1..W2-16`, `isolated world`, `tmpfs admitted` | Already disposed in place by rev 25 and rev 26 (rev 26 section K); re-checked at `7d2c1de`, **no new live hit**; no further edit |

## Section L — handoff constraints

- **Developer:** implement `inspectRecordShape`, `snapshotRecord`, `validateRecord` and `decide(perRealm, requiredIds)` exactly as section B.5 — pure, synchronous, total, no I/O, CommonJS, `Logger.*` only, `fs.promises.*` for evidence writes. The probe must emit schema-version-1 records and **must never default, coerce or fill a missing measurement**. Do not add a field, do not accept `undefined`/`null`/`''` as a negative, do not add a flag, environment variable, exemption or warning mode (OWNER-25), do not cache or transfer a probe result across browser processes (OWNER-24), never emit `shared_worker_blocked`. Do **not** implement any browser-identity mechanism: `OPEN-BID-27` is undecided, and the section J wrapper is scaffolding that must never enter product code.
- **QA:** fixtures from the consolidated **42-row** table C only; the checker asserts the id set, the 42-row total and the sweep counts derived from the schema constants (1155 / 126 / 13; 1294 refusals + exactly 1 authorised `armed:true`). Generate sweep records **from the schema**, not by hand. F5, F7, F11 and F21 stay required fail-closed and must never be rewritten into passes. `armed:true` only at unit level. Pure rows on both Node versions, 3 repetitions; browser rows per section J.1.
- **Security:** review scope is the B.2 schema and its sentinel choice, the B.3 rejection set, the B.6 ordering rule, the **B.7 proxy-rejection RULE of rev 28** (`PROXY-27` withdrawn; review the `isProxy` capture-at-initialization rule, the boundary coverage and the honestly stated Node-only and process-integrity assumptions), the section D sweep definition and whether any input shape can still arm, the section J.2 identity scaffolding and the honesty of `OPEN-BID-27`, the section J.4 FC2 definition, the section K dispositions including the unapplied rev 26 `SPIKE-W` note, and the M-25/M-26 closure conditions (executed CONF-02 **plus** your review; documentation alone must not close either).
- **DevOps:** no workflow or `NODE_OPTIONS` change in rev 27; GoogleSearchTest stays out of CI; the pure-function rows are deterministic and browser-free and are the only part suitable for CI today; CI must expect exit 18, must not treat the refusal as a flake, and must match the reason set. CONF-02 is a scratch run, not a CI job: unique profile and process group per run, cleanup verified, no non-loopback request, no secret written.

## Needs anchors (not applied by rev 27)

Every `old` anchor in `phase-18-rev27-edits.json` was verified by exact string count to occur **exactly once** in its target file at `7d2c1de` (script-verified, 0 failures). Short SHAs only; no 40-character SHA; no AI attribution. `docs/pilot/limitations.md` still does not exist, so the rev 26 section G obligations stay DOC-gate obligations. Nothing in this revision is committed and nothing is executed.
