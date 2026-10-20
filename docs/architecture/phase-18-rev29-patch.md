# Phase 18 — architecture revision 29 (ARCH-29)

**Base revision:** `7caef92` on `docs/phase-18-architecture` (rev 28 `4f9e2d5`, rev 27 `2ab5f30`).
**Inputs consumed:** `docs/phase-18-conf03-results.md` (CONF-03, EXECUTED, **PARTIAL**), `docs/phase-18-conf03a-nodeside-results.md`, `docs/phase-18-conf03b-browser-results.md`, `docs/architecture/phase-18-rev28-patch.md`, `phase-18-rev28-edits.json`.
**Machine-applicable edits:** `docs/architecture/phase-18-rev29-edits.json` (18 anchors, each verified by exact string count to occur exactly once at `7caef92`; no `docEdit` targets an evidence document).
**Status carried forward.** Counts stay **98 total / 89 Must / 6 Should / 3 Could**; C6-T stays **27 / 5**; M-23 and M-24 stay **closed**; M-25 and M-26 stay **OPEN**; O-1 and the `PILOT_APPROVAL_RUN_TOKEN` text are untouched; OWNER-24 and OWNER-25 stay **DECIDED**; `PROXY-27` stays **withdrawn**; the supported-browser set stays **EMPTY**; scope stays Chromium only. Rev 29 executes nothing and commits nothing.

## Section A — context, and what rev 29 changes

CONF-03 executed the rev 28 gate and returned PARTIAL on a required row. FC1 mismatch-injection produced `shared_worker_present`, detail `realm:F1` (3 of 3 repetitions on each Node version) where the contract requires `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:F1`. The cause is in the rev 28 reference `decide()`: `hasMeasuredPresence(v)` returned true on `typeofSharedWorker === 'function' || constructed === true` and the first validation loop accepted `isCleanAbsence(v) || hasMeasuredPresence(v)`, so a realm could be classified **present** while its captured-constructor evidence was a **mismatch**. Nothing armed, so there was no arming risk in that instance, but the reference text contradicted B.4 precedence, and the harness recorded `pass:true` against its own expectation rather than against the contract.

Rev 29 is narrow and makes four changes:

1. **Global validation before classification** in the reference `decide()` (supersedes rev 28 B.4/B.5).
2. A **validity matrix** (B.4a) that states exactly which `(typeofSharedWorker, descriptor, nativeCtor, constructed)` combinations are valid for an absent record and for a present record.
3. The **FC1 expectation is corrected** and the contradictory wording removed; new rows FC13, FC14, FC15, IC10 and a **META-TEST** row MT-1; a new **Sweep D**; **49 rows** authoritative.
4. Section J becomes the **CONF-04** gate.

Rev 29 weakens nothing. It only moves outcomes from `shared_worker_present` to `shared_worker_block_unverified`; no exit code, reason code, detail string, public surface, flag, environment variable, configuration key or bypass is added.

## Section B — the decision contract after rev 29

### B.1–B.3 (unchanged)

Constraints, the `sharedWorkerRealmEvidence` version-1 schema and the rejection set of rev 28 B.1–B.3 stay in force verbatim, including proxy rejection at every accepted container boundary ahead of everything else. Rev 29 adds **no** new `detail` string: an invalid record of any kind reports `realm-not-affirmatively-validated:<id>`.

### B.4 Precedence (restated, now enforced)

1. Any invalid, incomplete, inconsistent or unverified required record (including any proxy) ⇒ `armed:false`, exit **18**, `shared_worker_block_unverified`, `detail realm-not-affirmatively-validated:<id>` — this **wins over any presence**;
2. otherwise any **VALID-PRESENT** realm ⇒ `armed:false`, exit **18**, `shared_worker_present`, `detail realm:<id>`;
3. only when **every** required record is **VALID-ABSENT** ⇒ `armed:true`, exit 0, and then only if OWNER-24 (same-process rule) holds.

Classification may never precede validation. Presence is **not** evidence of validity; a present-looking record with unverified constructor evidence is unverified, not present.

### B.4a Validity matrix (normative, new)

Applied to every required record **after** proxy rejection, shape inspection, snapshotting, schema/type/enumeration validation and freezing, and **before** any presence inspection.

Common preconditions for **both** valid classes: `measurable:true`, `error:'none'`, `timedOut:false`, `repetitionsConsistent:true`, `mechanism !== 'unavailable'`.

| `typeofSharedWorker` | `descriptor` | `nativeCtor` | `constructed` | Classification |
|---|---|---|---|---|
| `undefined` | `absent` | `absent` | `false` | **VALID-ABSENT** |
| `function` | `present-data` or `present-accessor` | `present` | `true` or `false` | **VALID-PRESENT** |
| `function` | any | `absent`, `mismatch` or `uncaptured` | any | **INVALID** |
| `function` | `absent` or `unreadable` | any | any | **INVALID** |
| `undefined` | any | `present`, `mismatch` or `uncaptured` | any | **INVALID** |
| `undefined` | any | any | `true` | **INVALID** |
| any | any | `!== 'present'` | `true` | **INVALID** |
| `object`, `other` or `unreadable` | any | any | any | **INVALID** |
| any | `unreadable` | any | any | **INVALID** |
| any violated common precondition | — | — | — | **INVALID** |

**Agreement rule.** `nativeCtor` MUST be `'present'` **iff** `typeofSharedWorker` is `'function'`, and MUST be `'absent'` **iff** `typeofSharedWorker` is `'undefined'`. `'mismatch'` and `'uncaptured'` are **never** valid. Every INVALID row ⇒ `armed:false`, exit 18, `shared_worker_block_unverified`, `detail realm-not-affirmatively-validated:<id>`. The matrix is total: every schema-valid combination is classified VALID-ABSENT, VALID-PRESENT or INVALID, so `decide` stays total.

### B.5 Reference text (reprinted; supersedes rev 28 B.5)

Normative behaviour; the implementation may differ in style but not in outcome or in **order of checks**. Everything in rev 28 B.5 from the intrinsic capture through `snapshotAndValidate` is **unchanged and still normative** (`isProxy` captured once at module initialization; proxy rejection first; shape inspection with accessor before key order; two snapshot reads; schema validation; freeze). Only the classification layer changes:

```js
// --- unchanged from rev 28 B.5: intrinsic capture, SCHEMA_VERSION,
// CANONICAL_REQUIRED_REALM_IDS, REQUIRED_KEYS, ENUMS, BOOLEAN_KEYS, UNVERIFIED,
// proxyFault, inspectRecordShape, snapshotRecord, validateRecord, snapshotAndValidate.

const PRESENT_DESCRIPTORS = Object.freeze(['present-data', 'present-accessor']);

// common preconditions for BOTH valid classes
function basePreconditionsHold(v) {
  return v.measurable === true
    && v.error === 'none'
    && v.timedOut === false
    && v.repetitionsConsistent === true
    && v.mechanism !== 'unavailable';
}

// VALID-ABSENT: affirmative proof of absence (rev 28 isCleanAbsence, renamed)
function isValidAbsence(v) {
  return basePreconditionsHold(v)
    && v.typeofSharedWorker === 'undefined'
    && v.descriptor === 'absent'
    && v.nativeCtor === 'absent'          // agreement with typeof 'undefined'
    && v.constructed === false;
}

// VALID-PRESENT: presence with VERIFIED captured-constructor evidence.
// REPLACES rev 28 hasMeasuredPresence, which ignored nativeCtor (the CONF-03 FC1 defect).
function isValidPresence(v) {
  return basePreconditionsHold(v)
    && v.typeofSharedWorker === 'function'
    && PRESENT_DESCRIPTORS.includes(v.descriptor)
    && v.nativeCtor === 'present'         // agreement with typeof 'function';
                                          // 'mismatch' / 'uncaptured' / 'absent' are INVALID
    && (v.constructed === true || v.constructed === false);
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

  // PASS 1 - GLOBAL VALIDATION. EVERY required record must be classifiable as
  // VALID-ABSENT or VALID-PRESENT before ANY presence is inspected. Refuses at the
  // FIRST offending id in requiredIds order, so the detail is deterministic.
  for (const id of snapshot.requiredIds) {
    const v = byId.get(id);
    if (!v) return UNVERIFIED('realm-missing:' + id);
    if (!isValidAbsence(v) && !isValidPresence(v)) {
      return UNVERIFIED('realm-not-affirmatively-validated:' + id);
    }
  }

  // PASS 2 - CLASSIFICATION. Reached only when every required record is valid.
  for (const id of snapshot.requiredIds) {
    if (isValidPresence(byId.get(id))) {
      return { armed: false, exit: 18, reason: 'shared_worker_present', detail: 'realm:' + id };
    }
  }

  // PASS 3 - arm only when every required record affirmatively proves absence.
  for (const id of snapshot.requiredIds) {
    if (!isValidAbsence(byId.get(id))) {
      return UNVERIFIED('realm-not-affirmatively-validated:' + id);   // defence in depth
    }
  }
  return { armed: true, exit: 0, reason: 'shared_worker_absent_all_realms' };
}

function decide(perRealm, requiredIds) {
  const v = snapshotAndValidate(perRealm, requiredIds);
  return v.ok ? decideFromSnapshot(v.snapshot) : v.result;
}

module.exports = {
  decide,                                  // the ONLY product entry point
  snapshotAndValidate, decideFromSnapshot, // exported for tests (SEAM-28)
  inspectRecordShape, snapshotRecord, validateRecord,
  isValidAbsence, isValidPresence          // exported for tests only
};
```

`isCleanAbsence` and `hasMeasuredPresence` are **withdrawn as names and as behaviour**; no code may implement `hasMeasuredPresence`. Pass 3 is redundant given passes 1 and 2 and is kept as defence in depth so that a future edit to pass 2 cannot produce an arming decision from a non-absent record. `module.exports` stays frozen; the two new exports are test seams only and cannot influence a production decision.

### B.6 Order of operations (amended)

**reject proxies → inspect shape (accessor before key order) → snapshot twice → compare → validate the snapshot schema → freeze → validate EVERY required record against the B.4a matrix → only then inspect presence → arm only on unanimous VALID-ABSENT.** Post-validation mutation immunity is unchanged: the decision reads only the frozen snapshot, so replacing a captured reference, a field or a whole record in the caller's objects after validation (SEAM-28) leaves the decision unchanged or produces a refusal, never a new `shared_worker_present` and never a new `armed:true`.

### B.7–B.9 (unchanged)

The proxy-rejection rule, the interface list and the trust boundaries of rev 28 stay as written, with two additions: `isValidAbsence`/`isValidPresence` join the SEAM-28 internal exports, and `SharedWorkerCapabilityProbe.measure(...)` must emit `nativeCtor` **only** from the FC1 comparison — never defaulted, inferred or copied from another realm.

## Section C — table W6-T, rev 29 delta (49 rows)

**Rows not listed below are unchanged from the rev 28 section C reprint and stay exactly as listed there** (F1..F21, F22, FC2..FC5, FC7..FC12, IC1, IC2, IC4, IC7, IC8, IC9, FW-1). Changed and new rows:

| Id | Case | Expected result (rev 29) |
|---|---|---|
| FC1 (changed) | independently executable row (J.5): pre-author-script native-constructor capture compared with the evaluate-time read, per measurable realm per repetition, plus a mismatch-injection sub-case | agreement ⇒ the row PASSES with `nativeCtor` `present` or `absent` as measured **and** the record classified by the B.4a matrix. **Mismatch-injection sub-case expects EXACTLY `armed:false`, exit 18, `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:<realm id>` — and nothing else.** `shared_worker_present` is a FAILURE for that sub-case. The oracle is the rev 29 contract only; a harness expectation is never the oracle |
| FC6 (unchanged wording, re-anchored) | realm results disagree | `realm-not-affirmatively-validated:<id>`; `disagreement` must never be emitted |
| **FC13** (new) | **validation before classification**: a base of 20 VALID-ABSENT records plus one record with `typeofSharedWorker:'function'`, `descriptor:'present-data'`, `nativeCtor:'mismatch'`, injected in the **first** (`F1`), **middle** (`F11`) and **last** (`F21`) required realm | all three sub-cases ⇒ `armed:false`, exit 18, `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:F1` / `:F11` / `:F21`. Position must not change the outcome; `shared_worker_present` is a failure |
| **FC14** (new) | **invalid plus present, and multiple invalid**: (a) one INVALID record (`nativeCtor:'mismatch'`) at `F3` **combined with a VALID-PRESENT record** at `F8`; (b) the same with the VALID-PRESENT record ahead of the invalid one (`F3` present, `F8` mismatch); (c) three INVALID records (`F2` `uncaptured`, `F11` `mismatch`, `F20` `typeofSharedWorker:'object'`) | every sub-case ⇒ `shared_worker_block_unverified`, exit 18, **never `shared_worker_present`**. The detail names the **first** invalid id in `requiredIds` order: (a) `:F3`, (b) `:F8`, (c) `:F2` |
| **FC15** (new) | **captured reference changed after validation** through SEAM-28: `snapshotAndValidate` succeeds, the test then (i) flips `nativeCtor` to `'mismatch'`, (ii) flips it to `'present'` on an absent record, (iii) replaces the field with a Proxy, (iv) replaces the whole record, in the caller's original array, then calls `decideFromSnapshot` | decision **byte-identical** to the unmutated decision, or a refusal (`snapshot-proxy:*` / `record-unstable:index-N`). Never a new `shared_worker_present`, never a new `armed:true` |
| IC3 (changed) | inversion at unit level, synthetic `perRealm` | (a) 21 VALID-ABSENT records ⇒ `armed:true` exit 0 (**the only authorised `armed:true`**); **(b) one VALID-PRESENT record (`typeof:'function'`, `descriptor:'present-data'`, `nativeCtor:'present'`) ⇒ 18 `shared_worker_present` detail `realm:<id>`; a present-looking record with any other `nativeCtor` belongs to (f), not (b)**; (c) one unmeasurable ⇒ 18 `realm-not-affirmatively-validated:<id>`; (d) disagreement ⇒ same detail; (e) empty array ⇒ 18 `realm-missing:F1`; **(f) new: one present-looking record with `nativeCtor` `mismatch`, `uncaptured` or `absent` ⇒ 18 `realm-not-affirmatively-validated:<id>`** |
| IC5 (changed) | `decide()` negative-case battery | cases (1)–(10) unchanged; **(11) new: `typeofSharedWorker:'function'` with `descriptor:'absent'` ⇒ `realm-not-affirmatively-validated:F1`; (12) new: `constructed:true` with `typeofSharedWorker:'undefined'` ⇒ `realm-not-affirmatively-validated:F1`** |
| IC6 (changed) | sweep rows | Sweep A **1155** ⇒ all `shared_worker_block_unverified`; Sweep B **126** ⇒ **all** `shared_worker_block_unverified` (the rev 28 split "42 present / 84 unverified" is **withdrawn**: substituting `typeofSharedWorker:'function'` or `constructed:true` into a clean-absence record leaves `nativeCtor:'absent'`, which is INVALID); Sweep D **195** ⇒ 21 `shared_worker_present` + 174 `shared_worker_block_unverified`; **zero unexpected `armed:true`**, **zero unexpected `shared_worker_present`** |
| **IC10** (new) | **present-record constructor-evidence battery**, each over an otherwise-valid base with one present realm: (a) `nativeCtor` field **missing** ⇒ `record-keys-mismatch:index-N`; (b) `nativeCtor:'uncaptured'` (substituted/never captured) ⇒ `realm-not-affirmatively-validated:<id>`; (c) `nativeCtor:'mismatch'` (look-alike substituted) ⇒ same; (d) `nativeCtor` holding a **Proxy** ⇒ `record-value-proxy:nativeCtor:index-N`; (e) inconsistent evidence (`nativeCtor:'present'` with `repetitionsConsistent:false`) ⇒ `realm-not-affirmatively-validated:<id>` | every case ⇒ `armed:false`, exit 18, `shared_worker_block_unverified` with the stated `detail`; no uncaught exception; 3 repetitions per Node version |

### C.6 META-TEST — 1 row (new)

| Id | Case | Expected result |
|---|---|---|
| **MT-1** | **meta-test on the harness itself.** For every recorded row, an **independent checker** — separate from the harness that produced the row, reading its oracle from rev 29 sections B.4, B.4a and B.5 — recomputes the pass flag from `expected` versus `actual` (`reason`, `exit`, `armed`, `detail`) | the gate **FAILS** if any row's recorded pass flag disagrees with the recomputed verdict, or if a row records a pass while its expected reason, exit code, armed value or detail differ from the contract. Harness-authored pass flags are advisory only. The CONF-03 FC1 `pass:true` is the motivating defect and is **not accepted** |

**Authoritative total: 21 (F1..F21) + 1 (F22) + 15 (FC1..FC15) + 10 (IC1..IC10) + 1 (FW-1) + 1 (MT-1) = 49 rows.** The rev 25 "34 rows", rev 26 "36 rows", rev 27 "42 rows" and rev 28 "44 rows" totals are superseded by **49**. C6-T stays **27 / 5** and the two inventories stay disjoint.

## Section D — sweeps (counts by formula)

Constants: `|IDS| = 21`, `|REQUIRED_KEYS| = 11`, `|MUTATIONS| = 5`, `|VALID_NEGATIVES| = 6`, `|STRUCTURAL| = 20`, `|CTOR_NEGATIVES| = 3` (`absent`, `mismatch`, `uncaptured`), `|DESC_NEGATIVES| = 2` (`absent`, `unreadable`), `|POS| = 3` (`F1`, `F11`, `F21`), `|PARTNER| = 2`.

- **Sweep A** (unchanged): `21 × 11 × 5 = 1155` ⇒ all `shared_worker_block_unverified`.
- **Sweep B** (expectation corrected): `21 × 6 = 126` ⇒ **all** `shared_worker_block_unverified`.
- **Sweep C** (unchanged): **20** structural cases ⇒ all `shared_worker_block_unverified` with the rev 28 D.3 details.
- **Sweep D** (new). Base `BP29(i)` = `B27` with record `i` replaced by a **VALID-PRESENT** record (`typeof:'function'`, `descriptor:'present-data'`, `nativeCtor:'present'`, `constructed:true`).
  - `D-pos` = `|IDS|` = **21** ⇒ `shared_worker_present`, detail `realm:<id>` (the authorised presence controls; `armed:false`).
  - `D-ctor` = `|IDS| × |CTOR_NEGATIVES|` = **63**: `BP29(i)` with `nativeCtor` substituted ⇒ `realm-not-affirmatively-validated:<id>`. This is the new mutation of `nativeCtor` in present records.
  - `D-desc` = `|IDS| × |DESC_NEGATIVES|` = **42**: `BP29(i)` with `descriptor` substituted ⇒ same refusal.
  - `D-absctor` = `|IDS| × 3` = **63**: `B27` with record `i`'s `nativeCtor` set to `present`, `mismatch` or `uncaptured` while `typeofSharedWorker` stays `'undefined'` ⇒ same refusal.
  - `D-mix` = `|POS| × |PARTNER|` = **6**: one INVALID record at `F1`, `F11` or `F21` combined with a VALID-PRESENT record at the preceding or following required realm ⇒ `shared_worker_block_unverified`, **never** `shared_worker_present`.
  - **Sweep D total = `21 + 63 + 42 + 63 + 6 = 195`.**

**Checker assertions (formulas, not literals):** `1155 + 126 + 20 + 195 = 1496` refusals — **1475** `shared_worker_block_unverified` and **21** `shared_worker_present` — plus **exactly 1** `armed:true` (the `B27` control) across **1497** `decide` invocations. The harness must derive these from the schema constants and then compare them with this document. **Zero unexpected `armed:true` and zero unexpected `shared_worker_present` are gate conditions, not warnings.**

## Section E — alternatives considered

| Alternative | Tradeoff | Verdict |
|---|---|---|
| Keep rev 28 classification and change the FC1 row expectation to `shared_worker_present` | Zero code change; but it legitimises arming-adjacent classification from unverified constructor evidence and contradicts B.4 precedence | **Rejected** (owner decision) |
| Check `nativeCtor` only inside the presence branch | Smallest diff; but leaves "classify, then validate" as the shape of the function, so the next field added repeats the defect | **Rejected** |
| Treat `nativeCtor:'mismatch'` as presence (it proves *something* exists) | Superficially fail-closed; but it reports a measured capability from evidence known to be untrustworthy, and `uncaptured` would still be unclassifiable | **Rejected** |
| Global validation pass before classification, with an explicit validity matrix | Two passes over 21 frozen records; a few more rows and 195 more sweep cases; makes the precedence order structural rather than incidental | **CHOSEN** |

## Section F — failure modes, fallback, observability, rollback

Unchanged from rev 28 F, with three additions. **Failure mode:** a probe that cannot capture the native constructor emits `nativeCtor:'uncaptured'`; under rev 29 that realm is unverified, so a probe regression now refuses the whole run instead of reporting presence — this is the intended fail-closed direction and must be visible in the report, not silent. **Observability:** the single `Logger.error` keeps naming code, exit, reason, `detail` and realm id; the `sharedWorkerCapability` report block must additionally carry, per realm, the classification (`valid-absent` / `valid-present` / `invalid`) and the `nativeCtor` value that produced it, so an operator can tell a mismatch from an ordinary absence. **Rollback:** reverting rev 29 restores rev 28 behaviour, which refuses in every measured case today; the only behavioural delta is which refusal reason is reported, so rollback is safe but reintroduces the CONF-03 defect and must not be done silently.

## Section G — compatibility and migration

No schema change (`schemaVersion` stays `1`), no public surface, no CLI flag, no environment variable, no configuration key, no dependency and no lockfile change; CommonJS throughout. No stored evidence is invalidated: CONF-03 records stay valid as records of what rev 28 did. Migration is contract-only — QA regenerates Sweep B expectations and adds Sweep D; Developer replaces two helpers. The rev 28 section G item 5 obligation (`docs/pilot/limitations.md` still does not exist) stays a DOC-gate obligation.

## Section H — test seams and acceptance-criteria mapping

| Seam | Rows / sweeps | AC |
|---|---|---|
| `decide(perRealm, requiredIds)` | FC1, FC13, FC14, IC3, IC5, IC6, IC10, Sweeps A–D | P18-AC-091 |
| `snapshotAndValidate` + `decideFromSnapshot` (SEAM-28) | FC10, FC15, C13, C20 | P18-AC-091 |
| `isValidAbsence` / `isValidPresence` (test-only exports) | the B.4a matrix, row by row | P18-AC-091 |
| independent checker | MT-1 | P18-AC-091, W6T-GATE |
| probe `nativeCtor` emission | FC1, IC10 | P18-AC-091 |

## Section I — ADR-0053 (short ADR; durable and cross-cutting)

**Context.** CONF-03 measured a required-row failure: the rev 28 reference `decide()` classified a realm present while its captured-constructor evidence was a mismatch, contradicting the stated precedence that unverified evidence wins.
**Decision.** Validation of **every** required realm record — containers, required-ID set, complete inventory, schema, types, descriptors, captured-constructor agreement, repetitions, consistency — runs to completion **before** any presence is inspected, governed by an explicit validity matrix. Presence is never evidence of validity. `hasMeasuredPresence` is withdrawn. A harness pass flag is never an oracle; an independent checker recomputes it (MT-1).
**Consequences.** One extra pass over 21 frozen records; Sweep B loses its presence cases and Sweep D (195 cases) gains them; the authoritative table is 49 rows; the executed gate is CONF-04. ADR-0051 and ADR-0052 stay in force and are **amended** by this ADR only on the classification order. No exit code, reason code, detail string or public surface changes.

## Section J — executed W6-T conformance gate (CONF-04), required before Security

CONF-01, CONF-02 and CONF-03 are **superseded, not upgraded**; all three stay **PARTIAL** records and are not edited. Rev 29 executes nothing; `CONF-04` and `W6T-GATE` stay NOT EXECUTED / NOT SATISFIED. CONF-04 inherits rev 28 J.1 items 2–5, 8–12 and sections J.2, J.4, J.6, J.7 and J.8 verbatim, and adds or tightens:

1. **Full matrix rerun.** All **49** rows on **Node 22.19.0 and Node 24.21.0**, **≥3 repetitions per required row**, each row executed independently; a row covered only inside another row's array run does not count. No row may be carried over from CONF-03.
2. **Node-side rows.** Every Node-side row (FC3..FC15, IC3, IC5, IC6, IC7, IC9, IC10, the FW-1 decision, MT-1) executed on both Node versions, recorded with `browser identity: n/a (node-side)`.
3. **Sweeps and proxies.** Sweeps A 1155, B 126, C 20, D 195, counts re-derived from the schema constants before comparison, 3 full passes per Node version; all seven FC12/IC9 proxy cases including **revoked** and **throwing** traps, each asserting explicitly that no exception escaped `decide`.
4. **Browser rows and the 21-realm gate.** Every browser row plus the full 21-realm gate, with the **current pinned Chromium refusing in every full-gate repetition**; if it ever arms, the gate fails and Security is not dispatched.
5. **Independent rows.** **FC1, FC2, IC1, IC2, IC4 and IC8** executed independently per J.5, J.4, their fixture definitions and J.6 — not inferred from any other row.
6. **FC1.** `shared_worker_block_unverified`, exit 18, `armed:false`, detail `realm-not-affirmatively-validated:<id>` in **every repetition** of the mismatch-injection sub-case on both Node versions. Any `shared_worker_present` there is a gate failure.
7. **FC2.** `fc2Pass: true` with its five sub-observations re-emitted **per realm** and explained.
8. **Popups.** F13 and F14 created by a **real user gesture** (`page.click()` on a Falcon-authored loopback fixture), never a gesture-free `evaluate`; acquisition mechanism, URL and timeout recorded.
9. **Identity and same-process.** J.2 identity wrapper plus CDP corroboration, re-verified immediately before the simulated run step, and the OWNER-24 same-process check recorded for every browser row.
10. **Zero-tolerance counters.** Zero unexpected `armed:true`, zero unexpected `shared_worker_present`, zero uncaught throws, zero skipped required rows, zero non-loopback requests (counted `n of N` per repetition).
11. **MT-1.** An independent checker recomputes every row's pass flag from expected versus actual against this document; any disagreement with a recorded pass flag, expected reason, exit code, armed value or detail fails the gate.
12. **Unmeasured items stay labelled.** F16..F21 and the worker-WebSocket case (FW-1) are recorded by **measured/unmeasured status**, never as passes, and their **fail-closed decision paths are executed and tested** (3× per Node version each).
13. **Cleanup and read-only identification.** Remove every CONF-04-owned process, profile directory, identity file, fixture server and scratch listener, and verify removal with a recorded command and output. The **two pre-existing loopback listeners** are **identified read-only** — pid, owner process, command, and relation to any CONF run — and **nothing CONF-04 did not start may be terminated**.
14. **Outcome rule.** A refusal is a PASS when it is the expected outcome. Any unmeasured required row ⇒ **PARTIAL**, arming stays refused, Security is not dispatched. Documentation alone must not close M-25 or M-26.

## Section K — repository-wide stale-reference search

Command form: `git grep -nI -- "<pattern>" 7caef92 -- docs/` over `44 rows`, `44-row`, `hasMeasuredPresence`, `isCleanAbsence`, `42 presence`, `shared_worker_present`, `CONF-03`. Evidence documents (`docs/phase-18-conf0*-results.md`, `docs/phase-18-w6t-conformance-results.md`, `docs/phase-18-spike-*-findings.md`) are **not edited**: they record what was executed and are referenced from this patch. The untracked rev 24 drafts are excluded.

| Hit | Disposition |
|---|---|
| `phase-18-rev28-patch.md` "Authoritative row count after rev 28: 44 rows" and the 44-row total | **LIVE → fixed** (two in-place notes: 49 rows; single source is rev 29 section C) |
| `phase-18-rev28-patch.md` B.4 heading, B.5 heading, `hasMeasuredPresence(v)`, B.6 heading | **LIVE → fixed.** Four in-place notes: precedence now enforced; the B.5 code block is superseded by rev 29 B.5; `hasMeasuredPresence` is withdrawn and must not be implemented; the order rule gains validation before classification |
| `phase-18-rev28-patch.md` Sweep B "the 42 presence cases ⇒ `shared_worker_present`", the IC6 row and the checker-assertions paragraph | **LIVE → fixed** (three in-place notes: 126 all refusals; Sweep D carries presence; 1155/126/20/195 and 1496 + 1 across 1497) |
| `phase-18-rev28-patch.md` FC1 table row and J.5 "Expected result" | **LIVE → fixed.** The contradictory expectation is removed in place: the mismatch sub-case expects `shared_worker_block_unverified` with `realm-not-affirmatively-validated:<id>` and nothing else; `shared_worker_present` is a failure |
| `phase-18-rev28-patch.md` C.3, C.4, C.5 headings and the section J heading | **LIVE → fixed** (FC1..FC15 / IC1..IC10 / new C.6 MT-1; the live gate is CONF-04) |
| `phase-18-rev27-patch.md:10` "superseded by **44 rows**" | **LIVE → fixed** in place to 49 rows (rev 29) |
| `phase-18-rev26-patch.md:223` and `:265` ("AGAIN BY REV 28: 44 rows") | **LIVE → fixed** in place: 49 rows, gate CONF-04, sweep counts 1155 / 126 / 20 / 195 |
| `phase-18-rev27-patch.md:259`, `:330`, `:415`, `:420`; `phase-18-rev23-patch.md:64`, `:209`; `phase-18-rev25-patch.md:145` | **Disposed by chain.** These are supersession notes that point at rev 28 section C, which now carries the rev-29 note at both totals. Rewriting a twice- or thrice-superseded revision would rewrite history. **No edit** |
| `phase-18-acceptance-criteria.json` AC-091 requirement, `counts.rev28Note` (44 rows), `exitCodes.rev28Note` | **Disposed by addition:** the rev 29 `ac[] appendText`, `counts.rev29Note` and `exitCodes.rev29Note`. Earlier notes are not rewritten, so the applied-note history stays readable |
| `phase-18-acceptance-criteria.json` openItems `CONF-03`, `W6T-GATE`, `M-25`, `M-26` | **Fixed by `openItems` `appendText`**; `CONF-04`, `VALID-29` and `META-29` added by `openItemsAdd` |
| `phase-18-rev26-patch.md` / `phase-18-rev27-patch.md` `hasMeasuredPresence`, `isCleanAbsence` | **Superseded-revision code blocks already carrying supersession notes at their B.5 headings; the live withdrawal is stated in rev 29 B.5 and in the rev 28 in-place note. No further edit** |
| `docs/phase-18-conf03b-browser-results.md` `hasMeasuredPresence`; all CONF/SPIKE evidence documents | **Evidence, left as written.** Rev 29 answers them in the design and references them |
| `phase-18-plan.md`, `docs/security/phase-18-threat-model.md` | Checked for `44 rows`, `hasMeasuredPresence`: **no live hit. No edit** |

## Section L — handoff constraints

- **Developer:** implement `basePreconditionsHold`, `isValidAbsence`, `isValidPresence` and the three-pass `decideFromSnapshot` exactly as B.5, keeping rev 28's proxy, shape, snapshot and schema layers byte-for-byte in order. Do **not** implement `hasMeasuredPresence`; do not check `nativeCtor` only inside the presence branch; do not add a `detail` string, exit code, flag, environment variable, configuration key, hook or exemption (OWNER-25); keep `module.exports` frozen; never default, infer, coerce or copy a missing `nativeCtor`. Report the per-realm classification in the `sharedWorkerCapability` block. `Logger.*` only, `fs.promises.*` for evidence writes, CommonJS.
- **QA:** fixtures from the 49-row table (rev 28 section C rows as listed there, plus the rev 29 section C delta and C.6). Generate Sweep A/B/C/D from the schema constants and assert 1155 / 126 / 20 / 195 and 1496 refusals + exactly one authorised `armed:true` across 1497 invocations. Regenerate Sweep B expectations (no presence cases remain). Add FC13 (first/middle/last mismatch), FC14 (invalid + present in both orders, multiple invalid), FC15 (post-validation reference substitution via SEAM-28 only), IC10 and IC3-f, IC5-11/12. Build the MT-1 checker **independently of the harness**, reading its oracle from B.4/B.4a/B.5. `armed:true` only at unit level, only for IC3-a/`B27`. FC1's mismatch sub-case must assert the exact reason, exit, armed value and detail — nothing weaker.
- **Security:** review scope is B.4a (is the matrix total, and can any combination with unverified constructor evidence reach presence or arming?), the three-pass `decideFromSnapshot` and whether pass 3 is genuinely redundant, the withdrawal of `hasMeasuredPresence`, the new test-only exports as an influence surface, Sweep D's coverage of `nativeCtor` and `descriptor` negatives, the MT-1 independence requirement, the CONF-04 conditions in section J, and the M-25/M-26 closure conditions (executed CONF-04 **plus** your review). CONF-03 must not be accepted as a pass.
- **DevOps:** no workflow, dependency, lockfile or `NODE_OPTIONS` change; GoogleSearchTest stays out of CI. The Node-side rows and sweeps stay the only CI-suitable part and must run under **both** Node 22.19.0 and Node 24.21.0; CI must expect exit 18, must not treat the refusal as a flake and must match the unchanged reason set. CONF-04 is a scratch run, not a CI job: unique profile and process group per run, verified cleanup of CONF-04-owned artefacts only, read-only identification of the two pre-existing loopback listeners, no non-loopback request, no secret written.

## Needs anchors (not applied by rev 29)

Every `old` anchor in `phase-18-rev29-edits.json` was verified by exact string count to occur **exactly once** in its target file at `7caef92` (script-verified, 18 anchors, 0 failures). No `docEdit` targets an evidence document. Short SHAs only; no 40-character SHA; no AI attribution. Nothing in this revision is committed and nothing is executed.
