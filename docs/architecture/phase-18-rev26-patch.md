# Phase 18 architecture patch — revision 26 (ARCH-26)

Base: architecture rev 2 plus the rev 3..rev 25 patches, at `0063e78` on `docs/phase-18-architecture`.
Inputs: `docs/security/phase-18-design-review-23.md` (SEC-24: M-26 new, M-25 carried, m-87..m-90), `docs/architecture/phase-18-rev25-patch.md` and `phase-18-rev25-edits.json`, `docs/phase-18-spike-w6-findings.md` (SPIKEW-06, executed, with its coordinator note), `docs/architecture/phase-18-rev23-patch.md`, `docs/phase-18-acceptance-criteria.json`, plus the owner decisions OWNER-24 and OWNER-25 recorded in the ARCH-26 task packet.
Scope: design text only. No production source file, `package.json` script or workflow step is edited by rev 26.
Machine-applicable edits: `docs/architecture/phase-18-rev26-edits.json`; this document is normative for intent.

**Status carried forward.** Counts stay **98 total / 89 Must / 6 Should / 3 Could**. C6-T stays **27 / 5** with rev 23 section D.4 as its single source. **M-23 and M-24 stay closed. M-25 stays OPEN.** O-1 and the `PILOT_APPROVAL_RUN_TOKEN` text are untouched. Reason codes stay `snake_case`. Scope stays **Chromium only**; **no Linux filesystem is admitted**. Rev 26 **weakens nothing**, adds no bypass, and converts no unexecuted check into evidence. The untracked `phase-18-rev24-*` drafts are ignored. The only inventory change is inside table W6-T: **34 rows → 36 rows** (FC8 and IC5 added).

## Section A — what rev 26 changes

| Item | Change | Primary targets |
|---|---|---|
| 1 | **OWNER-24 and OWNER-25 recorded as DECIDED**, replacing the rev 25 OPEN items of the same ids: a supported browser must pass the complete W6-T gate in the same process the run uses; there is no runtime exception of any kind. The **supported-browser set is EMPTY today** | rev 25 section F.6, openItems OWNER-24/OWNER-25, plan, `docs/pilot/limitations.md` obligations |
| 2 | **M-26 closed by design:** `decide(perRealm, requiredIds)` becomes a **closed, total** function with exact required-id-set equality, affirmative field validation and deterministic precedence | rev 25 B.5, AC-091, W6-T, ADR-0050 |
| 3 | **m-87:** one reason-selection order is chosen and the difference from what SPIKEW-06 printed is stated openly | exit-code registry, section B.5 |
| 4 | **m-88:** the "isolated world" claim is **removed everywhere**; integrity is restated accurately, and the **same-process rule** is added | rev 25 B.2, B.6, FC3, SPIKE-W6 findings text |
| 5 | **m-89:** in-place SUPERSEDED notes for every remaining live SPIKE-W2 / `shared_worker_blocked` / CDP-enforcement / "every case MEASURED-PASS" requirement, with a repository-wide contradiction search (section K) | AC JSON `SPIKE-W` item, rev 23 patch lines 52, 64, gates 1, 2, 3, 8 |
| 6 | **m-90:** the rev 23 tmpfs residue corrected to "candidate; refused until accepted by owner and Security" | rev 23 patch line 16 (row 3), line 203 (LINUX-01 row), line 215 (gate 7) |
| 7 | **New: the executed W6-T conformance gate** (section J) required before the next Security review | section J, openItem `W6T-GATE`, QA and DevOps handoff |

---

## Section B — the arming decision, closed and total

### B.1 Owner posture (OWNER-24, DECIDED)

Phase 18 supports **only an exact browser binary and launch configuration that passes the complete W6-T SharedWorker conformance gate**. The capability probe must execute in the **same browser process, browser context configuration, executable, arguments, environment and security posture** the pilot run will use (the **same-process rule**). The currently pinned Chromium build is **UNSUPPORTED for arming** (SharedWorker present). Firefox and WebKit must not be substituted; no older browser may be selected; no undocumented feature flag may be used. **No operational browser may be claimed to exist until one passes the complete gate, and the supported-browser set is EMPTY today.** A safe refusal is an acceptable Phase 18 result: components that do not depend on arming may be implemented later in the approved PR sequence, but **no customer pilot may execute while the supported set is empty**. If the probed browser process exits, crashes, relaunches, changes executable or arguments, or creates a differently configured context, **the approval is INVALID** and the complete probe runs again before any target access. **No probe result may be transferred to another browser process or cached across launches.**

### B.2 No exception process (OWNER-25, DECIDED)

There is **no runtime exception and no bypass**: no CLI override, no environment-variable override, no manifest exemption, no target allowlist, no operator acknowledgement, no hidden flag, and **no downgrade from refusal to warning**. Supporting another browser or configuration requires measured evidence, an architecture revision, a Security review with **zero blockers and zero majors**, a normal code PR, green CI, and explicit owner approval.

### B.3 Probe integrity, stated accurately (m-88)

Playwright's `page.evaluate` and `frame.evaluate` **normally execute in the page's MAIN world**. The rev 25 B.2/B.6 claim of an "isolated world" is **withdrawn** and is corrected in place wherever it appears (section K lists every occurrence). Probe integrity rests on four properties, none of which is world isolation:

1. the probe runs against a **Falcon-authored local document before any external target access**;
2. the required **native references are captured before any mutable page code runs** (`addInitScript`, pre-author-script);
3. the **browser process, executable, arguments, environment and context configuration are validated** as exactly those the run will use (B.1 same-process rule);
4. **any inconsistency fails closed**.

F17 (a frame appended after the probe or after arming) and F18 (bfcache restore) require the same care and stay **fail-closed until measured**: a realm that comes into existence after the probe has not been covered by it.

### B.4 Reason selection and precedence (m-87, normative)

Evaluated across **all** required realms, never stopping at the first match:

1. **malformed, incomplete or unverified evidence** (invalid input, id-set mismatch, any required field not affirmatively validated, exception, timeout, disagreement, inconsistent repetitions) ⇒ `armed:false`, exit **18**, `shared_worker_block_unverified`;
2. otherwise **any measured presence** ⇒ `armed:false`, exit **18**, `shared_worker_present`;
3. only **complete, valid, unanimous measured absence** ⇒ `armed:true`, exit 0 — and then only if B.1 holds.

**What SPIKEW-06 actually exercised.** Its harness used a different order: a single pass that returned at the **first matching realm**, checking `measurable === false || error || timedOut` then `typeof === 'function' || constructed === true` per realm, then a disagreement check, then `armed:true`. On the default pinned Chromium build it returned **`shared_worker_present`** because F1 matched first, **even though F5, F7 and F11 were unmeasurable**. Under the flag configurations that removed the API it returned `shared_worker_block_unverified`. It never returned `armed:true` in any configuration. Under rev 26 precedence the default build's reason would be **`shared_worker_block_unverified`** instead, because the unmeasurable required realms are evaluated first. This is a **reason-code change relative to what SPIKEW-06 printed; both are exit-18 refusals** with identical arming outcome (`armed:false`) and identical exit code. No measurement is invalidated by the change.

### B.5 `decide(perRealm, requiredIds)` — reference text (pure function, no I/O)

Normative behaviour; the implementation may differ in style but not in outcome. The canonical required-realm set is **the required F-rows of table W6-T, by id: `F1`..`F21`** (F22 is informational and must never appear in `perRealm` as a decision input).

```js
// Pure, synchronous, no I/O. Closed and total: every input shape yields a decision.
const CANONICAL_REQUIRED_REALM_IDS = Object.freeze([
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11',
  'F12','F13','F14','F15','F16','F17','F18','F19','F20','F21'
]);

const UNVERIFIED = (perRealm, detail) => ({
  armed: false, exit: 18, reason: 'shared_worker_block_unverified', detail, perRealm
});

function isCleanAbsence(r) {
  return r !== null && typeof r === 'object' && !Array.isArray(r)
    && r.measurable === true
    && (r.error === null || r.error === undefined)
    && r.timedOut === false
    && r.typeofSharedWorker === 'undefined'
    && r.descriptor === undefined
    && Object.prototype.hasOwnProperty.call(r, 'nativeCtorValue') && r.nativeCtorValue === undefined
    && r.constructed === false
    && r.repetitionsConsistent === true;
}

function hasMeasuredPresence(r) {
  return r !== null && typeof r === 'object'
    && (r.typeofSharedWorker === 'function' || r.constructed === true);
}

function decide(perRealm, requiredIds) {
  // (1) input shape
  if (!Array.isArray(perRealm) || !Array.isArray(requiredIds)) {
    return UNVERIFIED(perRealm, 'input-not-array');
  }
  // (2) requiredIds must equal the canonical set exactly: no missing, duplicate, extra or unknown id
  const req = requiredIds.slice();
  const canonical = CANONICAL_REQUIRED_REALM_IDS;
  if (req.length !== canonical.length || new Set(req).size !== req.length) {
    return UNVERIFIED(perRealm, 'required-id-set-malformed');
  }
  for (const id of req) {
    if (!canonical.includes(id)) return UNVERIFIED(perRealm, 'required-id-unknown');
  }
  for (const id of canonical) {
    if (!req.includes(id)) return UNVERIFIED(perRealm, 'required-id-missing');
  }
  // (3) every required realm present exactly once; no extras, no unknown ids, no malformed records
  const seen = new Map();
  for (const r of perRealm) {
    if (r === null || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string') {
      return UNVERIFIED(perRealm, 'realm-record-malformed');
    }
    if (!req.includes(r.id)) return UNVERIFIED(perRealm, 'realm-unknown-or-extra');
    if (seen.has(r.id)) return UNVERIFIED(perRealm, 'realm-duplicate');
    seen.set(r.id, r);
  }
  for (const id of req) {
    if (!seen.has(id)) return UNVERIFIED(perRealm, 'realm-missing');
  }
  // (4)+(5) precedence step 1: any realm that is not an affirmatively validated clean absence
  //          and is not a validated measured presence is UNVERIFIED.
  for (const id of req) {
    const r = seen.get(id);
    if (!isCleanAbsence(r) && !hasMeasuredPresence(r)) {
      return UNVERIFIED(perRealm, 'realm-not-affirmatively-validated:' + id);
    }
  }
  // (6) precedence step 2: any measured presence refuses as present
  for (const id of req) {
    if (hasMeasuredPresence(seen.get(id))) {
      return { armed: false, exit: 18, reason: 'shared_worker_present',
               detail: 'realm:' + id, perRealm };
    }
  }
  // disagreement guard (redundant after (4), kept as an explicit invariant)
  if (new Set(req.map((id) => seen.get(id).typeofSharedWorker)).size > 1) {
    return UNVERIFIED(perRealm, 'disagreement');
  }
  // (7) only complete, valid, unanimous measured absence arms
  return { armed: true, exit: 0, reason: 'shared_worker_absent_all_realms', perRealm };
}
```

**Consequences, stated plainly.** `null`, `'object'`, a missing or `undefined` `measurable`, a missing field, an exception, a timeout, disagreement, inconsistent repetitions **or any other value** yield `shared_worker_block_unverified`. A realm missing from `perRealm`, a duplicate id, an extra id, an unknown id, a malformed record and a non-array input **cannot arm**. The caller must additionally satisfy B.1 before an `armed:true` result may be acted on; `decide` itself never consults the environment, the filesystem, the clock or the network.

### B.6 Interfaces (replaces the rev 25 B.5 signature)

- **Internal, changed:** `decide(perRealm, requiredIds)` → `{ armed, exit, reason, detail, perRealm }`. Pure, synchronous, no I/O; the primary unit-test seam. The rev 25 single-argument `decide(perRealm)` is **withdrawn**.
- **Internal, new fields** on each `perRealm` record: `id`, `mechanism`, `typeofSharedWorker`, `descriptor`, `nativeCtorValue`, `nativeCtorMatched`, `constructed`, `measurable`, `error`, `timedOut`, `repetitionsConsistent`.
- **Internal, new:** `BrowserIdentity.assert(browser, expected)` → throws/refuses when executable path, executable hash, launch arguments, environment posture, process id or context configuration differ from the probed ones (B.1). Refusal is exit 18 `shared_worker_block_unverified` with the mismatch kind, never a page-supplied value.
- **Public surface:** unchanged — no new CLI flag, no new environment variable, no new config key (OWNER-25). CommonJS throughout; `Logger.*` only, no `console.log`; `fs.promises.*` for any evidence write.
- **Observability:** one `Logger.error` line naming code, exit, reason, `detail` and realm id, plus the structured `sharedWorkerCapability` report block extended with the browser identity record (executable path, executable hash, launch arguments, process id, context options, repetition counts). No target URL query or fragment, no page-supplied string, no secret.

---

## Section C — table W6-T amendments (single source of ids and counts)

Rev 25 section C stays the table; rev 26 amends the following rows and the total. **No count may be restated in prose outside this section and the `counts` note, and the implementation checker asserts the W6-T id set and the total.**

| Id | Row | Rev 26 status |
|---|---|---|
| F1..F21 | required decision realms | unchanged; **this is the canonical required-realm set** of B.5 |
| F22 | dedicated-worker scope | unchanged; informational only, never a decision input, must never appear in `perRealm` |
| FC1..FC7 | mechanism cases | unchanged |
| **FC8** (new) | **`requiredIds` contract:** `requiredIds` must equal the canonical set `F1..F21` exactly; non-array input, a missing id, a duplicate, an extra, an unknown id or a malformed record is rejected | required outcome `shared_worker_block_unverified` with the matching `detail`; coverage **W7** |
| IC1, IC2, IC4 | control fixtures | unchanged |
| **IC3** (amended) | synthetic `perRealm` arrays into `decide`: all 21 required realms affirmatively clean ⇒ `armed:true` exit 0 (**the only place `armed:true` is ever exercised, never against a customer target**); one present ⇒ 18 `shared_worker_present`; one unmeasurable / timed-out / errored ⇒ 18 `shared_worker_block_unverified`; disagreement ⇒ 18; empty array ⇒ 18 | coverage **W7** |
| **IC5** (new) | **decide() negative-case battery, each case asserted independently:** missing realm, duplicate id, extra id, unknown id, `undefined` `measurable`, `null` typeof, `'object'` typeof, malformed record, non-array input, conflicting repetitions | every case ⇒ 18 `shared_worker_block_unverified`, `armed:false`; coverage **W7** |
| FW-1 | dedicated-worker-initiated WebSocket with a real WS upgrade | unchanged; still UNMEASURED, independent arming blocker |

**Totals, single source: 21 required decision realms (F1..F21) + 1 informational realm (F22) + 8 mechanism cases (FC1..FC8) + 5 control fixtures (IC1..IC5) + 1 carried worker-WebSocket case (FW-1) = 36 rows.** SPIKE-W6 covers **15 decision realms plus FC1, FC2, IC1 and IC2**; every other row is owed to SPIKE-W7 and to the section J gate. The rev 25 "34 rows" total is superseded by **36**; C6-T remains untouched at **27 / 5** and the two inventories stay disjoint.

---

## Section D — alternatives considered (rev 26 decision only)

| Alternative | Tradeoff | Verdict |
|---|---|---|
| Keep `decide(perRealm)` and add runtime assertions at the call site | Smaller diff, but the required-realm set would live outside the pure function, so the unit seam could still pass while production armed on a short array | **Rejected** (M-26 would stay open) |
| Treat a missing realm as presence (`shared_worker_present`) | Also fails closed, but reports a measurement that was never taken | **Rejected** — misreports evidence |
| Closed, total `decide(perRealm, requiredIds)` with unverified-first precedence | One extra argument and a longer validation prologue; every refusal reason is honest and the whole contract is unit-testable without a browser | **Chosen** |
| Allow an owner-acknowledged exception for a known-good browser | Would unblock a pilot sooner | **Rejected by OWNER-25** |

---

## Section E — failure modes, fallback, observability, rollback

| Failure mode | Behaviour |
|---|---|
| probe throws, hangs or times out | exit 18 `shared_worker_block_unverified`, before any navigation |
| a required realm cannot be created | same |
| evidence array malformed, short, duplicated or unknown-id | same, with the `detail` naming the shape error |
| browser process exits, crashes, relaunches, or changes executable/arguments/context | the approval is **INVALID**; re-probe or refuse (B.1) |
| capability present | exit 18 `shared_worker_present`, realm id named |
| probe removed or disabled | execute mode must **not** arm (IC4); the test fails |

**Fallback:** none to a weaker mode; the only fallback is refusal. **Rollback:** design rollback only — no code ships from rev 26; reverting restores the rev 25 single-argument `decide`, which SEC-24 M-26 showed can arm on a missing measurement, so a revert requires a fresh owner decision. **Observability:** as B.6. **Determinism:** `decide` is pure, so CI needs no browser for IC3, IC5 and FC8.

## Section F — compatibility and migration

No public surface changes; no exit code added; precedence unchanged (`2 > 3 > 18 > 17 > 16 > 15 > 13 > 12 > 11 > 14 > 10 > 1 > 0`). CommonJS only. The only migration is internal: callers of the rev 25 `decide(perRealm)` must pass `requiredIds`; no such caller exists in the tree, so the migration is documentation-only today. CI must continue to expect pilot execute mode to refuse with exit 18 and must not treat that refusal as a flake; after rev 26 the refusal **reason** on the current build is `shared_worker_block_unverified` rather than `shared_worker_present`, so any assertion must match the reason set, not a single string.

## Section G — scope and limitations (updated)

1. **The supported-browser set is EMPTY.** Phase 18 cannot arm execute mode on the current pinned Chromium build, and no other browser has passed the complete gate.
2. `docs/pilot/limitations.md` (still absent) must carry, in addition to the rev 25 section G obligations (a)..(g): (h) Falcon supports **only** a browser binary and launch configuration that has passed the complete conformance gate **in the same process the run uses**, and that set is empty today, so **no armed pilot runs at all**; (i) there is **no** override, exemption, allowlist, acknowledgement or warning-only mode; (j) if the browser process changes, exits or relaunches, the run re-probes or refuses; (k) a refusal is the expected, supported outcome, not a defect.
3. Chromium only; Firefox and WebKit unverified and out of pilot scope. No Linux filesystem admitted.
4. Plan impact: 18C delivers the probe, the pure `decide`, the browser-identity assertion and the refusal path; **no customer pilot is scheduled while the supported set is empty**.

## Section H — ADR-0050 (short ADR; durable and cross-cutting)

**ADR-0050 — Arming requires a closed, total decision over a fixed required-realm set, measured in the same browser process the run uses, with no exception path.**
*Status:* Accepted (design). **Amends ADR-0049**; records OWNER-24 and OWNER-25.
*Context:* SEC-24 M-26 showed that `decide(perRealm)` could return `armed:true` when a required realm was missing or reported `null`/`'object'`, and that the harness order reported presence before unverifiability. The owner further decided that only a browser passing the complete gate, probed in the same process and configuration as the run, is supported, and that no runtime exception exists.
*Decision:* `decide(perRealm, requiredIds)` is pure, closed and total: exact canonical required-id-set equality (`F1..F21`), rejection of missing/duplicate/extra/unknown ids, malformed records and non-array input, affirmative validation of every required field for an absence verdict, and precedence unverified → present → armed. Arming additionally requires the OWNER-24 same-process validation. No CLI flag, environment variable, exemption, allowlist, acknowledgement or warning mode exists.
*Consequences:* the supported-browser set is empty, so Phase 18 ships a refusal path, a probe and a pure decision function; the reason code on the current build changes from `shared_worker_present` to `shared_worker_block_unverified` with no change to exit code or arming; `armed:true` is exercised only at unit level (IC3).
*Alternatives rejected:* see section D.
*Fallback, rollback, failure modes, observability:* see section E.

## Section J — Executed W6-T gate (required before Security)

The coordinator executes this conformance run in the scratch directory before the next Security review; rev 26 **does not** execute it (openItem `W6T-GATE`).

1. **Coverage:** every row of table W6-T (36 rows), **at least 3 repetitions per row**, on **Node 22.19.0 and Node 24.21.0**, hermetic loopback fixtures only, a fresh browser process and fresh empty context per run.
2. **Per-row record:** expected versus actual **reason**, **exit code** and **arming outcome**; a row is a PASS only when actual equals expected on every repetition.
3. **Realm inventory:** the full list of realm ids actually created and measured, with the unmeasurable ones named (today: F5, F7, F11, F21 and the unmeasured F16..F20).
4. **Browser identity:** process id, executable path, **executable hash**, launch arguments, environment posture, context options, and the repetition count — recorded per run, proving the same-process rule of B.1 held.
5. **Expected outcome today:** the current Chromium **always refuses**. **A refusal is a PASS when it is the expected outcome.** No missing measurement may arm; if any row is unmeasured the gate reports PARTIAL and arming stays refused.
6. **Hygiene:** no browser or harness process is left running after the suite (verified, as SPIKEW-06 verified it); no customer target is contacted; no secret written.
7. **Output:** one evidence document plus the per-row table; it is the input to M-25 closure together with a Security review. Documentation alone must not close M-25.

## Section K — repository-wide contradiction search (m-89, m-90)

Command form: `git grep -nI -- "<pattern>" 0063e78 -- docs/` over `shared_worker_blocked`, `SPIKE-W2`, `setAutoAttach`, `W2-1..W2-16`, `MEASURED-PASS`, `isolated world`, `isolated-world`, `tmpfs admitted`, `is accepted`, `Layer 2`, `exposeBinding`, `construction block`, across the architecture document, the rev 3/rev 4/rev 23/rev 25 patches, the plan, the threat/decision traceability document, the owner decisions, the acceptance-criteria JSON and the spike findings. The untracked rev 24 drafts are excluded. Every hit and its disposition:

| Hit | Disposition |
|---|---|
| `docs/phase-18-acceptance-criteria.json` openItem `SPIKE-W` (line ~33): "SPIKE-W2 IS REQUIRED BEFORE 18C MERGES ... MEASURED-PASS", plus the CDP/`shared_worker_blocked` design consequence | **LIVE → fixed.** rev 26 `openItems` `appendText` adds the in-place SUPERSEDED note (the rev 25 note was specified but never applied to this item) |
| `phase-18-rev23-patch.md:52` `shared_worker_blocked` refusal sentence | **LIVE → fixed** (in-place note; reason withdrawn) |
| `phase-18-rev23-patch.md:64` "every case in B.5 ... MEASURED-PASS" | **LIVE → fixed** (in-place note; requirement withdrawn, refuse-to-arm kept) |
| `phase-18-rev23-patch.md:209` gate 1 (W2-1..W2-16) | **LIVE → fixed** (withdrawn; replaced by W6-T required rows + section J) |
| `phase-18-rev23-patch.md:210` gate 2 (`shared_worker_blocked` test) | **LIVE → fixed** (withdrawn; replaced by IC3/IC5 and the conformance run) |
| `phase-18-rev23-patch.md:211` gate 3 (trigger = "SPIKE-W2 evidence") | **LIVE → fixed** (trigger restated as W6-T evidence; test kept) |
| `phase-18-rev23-patch.md:216` gate 8 (W2-15/W2-16) | **LIVE → fixed** (ids withdrawn; carried as FW-1) |
| `phase-18-rev23-patch.md:16` row 3 "tmpfs admitted" | **LIVE → fixed** (m-90: candidate; refused until accepted by owner and Security) |
| `phase-18-rev23-patch.md:203` LINUX-01 row "tmpfs admitted" | **LIVE → fixed** (same correction) |
| `phase-18-rev23-patch.md:215` gate 7 "the admission test that tmpfs ... is accepted" | **LIVE → fixed** (rewritten as a refusal test; the gate no longer encodes admission) |
| `phase-18-rev25-patch.md:41` B.2 "in an isolated world" | **LIVE → fixed** (m-88 correction in place) |
| `phase-18-rev25-patch.md:81` B.6 "isolated-world reads" / "in an isolated world" | **LIVE → fixed** (m-88 correction in place, including the same-process rule) |
| `phase-18-rev25-patch.md:129` FC3 "isolated-world results" | **LIVE → fixed** (m-88 correction in place) |
| `phase-18-spike-w6-findings.md:65` "in an isolated world" | **LIVE → fixed** (correction note added in place; measurements untouched) |
| `phase-18-rev23-patch.md:36,39,41,43,44` Layer 1/Layer 2/`setAutoAttach`/`exposeBinding` | **Already superseded in place** by the applied rev 25 note at line 41 ("SUPERSEDED BY REV 25 ... THE CDP ENFORCEMENT DESIGN IS NOT ACCEPTED"); no further edit |
| `phase-18-rev23-patch.md:68,74..89` B.5 matrix header and W2 rows | **Already superseded in place** (header marked "(WITHDRAWN)", line 68 carries the rev 25 note); no further edit |
| `phase-18-rev23-patch.md:99,102` supersession tables | Historical mapping rows; already describe withdrawn text as withdrawn; no edit |
| `phase-18-rev23-edits.json` lines 54, 90, 99, 114, 132, 148, 157, 196 | Historical machine-edit spec of a superseded revision; its `SPIKE-W2` item is superseded by the **applied** rev 25 `openItems` set (AC JSON line ~191) and its docEdit targets now carry in-place notes. Not re-edited: editing an applied edit-spec would rewrite history rather than the design |
| `phase-18-acceptance-criteria.json:191` `SPIKE-W2`, `:212` `M-25`, `:247-248` exit-code notes, `:1197` AC components | Already carry the applied rev 25 supersession text; rev 26 adds only the `rev26Note` reason-selection correction and the AC-091 `decide()` text |
| `phase-18-authenticated-pilots.md:259` "construction block ... of rule 1" | Already carries "subsumed by rev 25" and "the 16-case SPIKE-W2 matrix ... is WITHDRAWN"; no further edit |
| `phase-18-spike-w2/w4/w5-findings.md` `setAutoAttach` hits | **Evidence documents**: factual records of the CDP experiments, not requirements. Left as measured; rev 25 B.1 already records what they do and do not support |
| `phase-18-decision-traceability.md:63` (`m-26` row, unrelated older finding), `:13`, `:165`, `:204` | False positives of the `tmpfs`/`is accepted`/`isolated` patterns on unrelated rows; no contradiction |
| `phase-18-owner-decisions.md:70,96,177`, `phase-18-plan.md:3`, `phase-18-acceptance-criteria.json:88,148,149,180,201,222` | False positives of "is accepted"/"tmpfs" in unrelated contexts; the OWNER-24/OWNER-25 items at `:222` and its neighbour are replaced by the rev 26 `openItems` sets |
| `POLICY_SHARED_WORKER` | Only in "must not appear" or historical text; unchanged |

## Section L — handoff constraints

- **Developer:** implement `decide(perRealm, requiredIds)` exactly as B.5 (pure, no I/O, closed, total) plus `BrowserIdentity.assert`; the rev 25 single-argument `decide` is withdrawn. Never emit `shared_worker_blocked`; never add a flag, environment variable, exemption or warning mode (OWNER-25); never cache or transfer a probe result across browser processes (OWNER-24). CommonJS, `Logger.*`, no `console.log`, `fs.promises.*`. Nothing from rev 23 section B.
- **QA:** fixtures from **table W6-T only**, now **36 rows**; the checker asserts the id set and the 36-row total. Add FC8 and IC5; amend IC3 to the 21-realm array. F5, F7, F11 and F21 stay **required fail-closed** and must never be rewritten into passes. `armed:true` only at unit level. Every browser row on Node 22.19.0 and 24.21.0, 3 repetitions, hermetic loopback only. Assert the reason **set**, not the SPIKEW-06 string: the current build now yields `shared_worker_block_unverified`.
- **Security:** review scope is the B.5 closed contract (does any input shape still arm?), the B.4 precedence and its honest reason-code consequence, the m-88 main-world restatement plus the same-process rule, the OWNER-24/OWNER-25 records, the m-90 tmpfs corrections, the section K dispositions, and the M-25 closure conditions (executed section J gate **plus** your review; documentation alone must not close it).
- **DevOps:** no workflow or `NODE_OPTIONS` change in rev 26; GoogleSearchTest stays out of CI; CI must expect exit 18 and must not treat the refusal as a flake, and must tolerate the reason change; the section J gate is a scratch run, not a CI job, and leaves no processes behind.

## Needs anchors (not applied by rev 26)

Every `old` anchor in `phase-18-rev26-edits.json` was verified by exact string count to occur **exactly once** in its target file at `0063e78` (script-verified, 0 failures). Short SHAs only; no 40-character SHA; no AI attribution. `docs/pilot/limitations.md` still does not exist, so section G is a DOC-gate obligation rather than an edit. Nothing in this revision is committed.
