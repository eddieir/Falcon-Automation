# Phase 18 — pure-function W6-T conformance execution results (CONF-02A)

**Status: PARTIAL (by design — this slice is scoped to pure-function rows only). Zero unexpected `armed:true` observed. The browser-dependent rows are NOT executed here; they are explicitly out of scope for CONF-02A and remain owed to CONF-02B.**

Base revision: `2ab5f30` on `docs/phase-18-architecture`. Spec: `docs/architecture/phase-18-rev27-patch.md` sections B, C, D, J; prior result: `docs/phase-18-w6t-conformance-results.md` (CONF-01, PARTIAL, not modified by this run).

Reference module under test: `decide27.js`, a verbatim extraction of rev 27 section B.5, sha256 `4de3de242a613c0f2c860ecbe30c1764e61afb12ae5a1038b93315325e59b24d` (matched independently by this run — see Environment). Not edited.

Environment: macOS arm64; Node v22.19.0 and Node v24.21.0 (both confirmed via `node -v` at run time, matching the task's required versions exactly); pure CommonJS, no browser, no network, no filesystem I/O inside `decide()`.

Harness (scratch, not tracked): `scratchpad/conf02/harness.js`. Raw evidence (scratch, not tracked): `scratchpad/conf02/pure-results-node22.json`, `scratchpad/conf02/pure-results-node24.json`.

## Scope executed

Per section H's seam/row table, the rows that need **no browser** are: FC3, FC4, FC5, FC6, FC7, FC8, FC9, FC10, FC11 (9 rows); IC3, IC5, IC6, IC7 (4 rows, two of which — IC6/IC7 — are themselves the section D sweeps); plus FW-1's required fail-closed **decision** (executed, not a WebSocket measurement). That is **14 of the 42 W6-T table rows**. The remaining **28 rows require a real browser** and are classified `BROWSER (CONF-02B)`, not executed here:

F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12, F13, F14, F15, F16, F17, F18, F19, F20, F21, F22, FC1, FC2, IC1, IC2, IC4, IC8.

## Row-level results (3 repetitions each, both Node versions, identical outcomes)

All 25 pure sub-cases below (9 FC rows + 5 IC3 sub-cases + 10 IC5 sub-cases + FW-1) matched their expected `{armed, exit, reason}` on **every** repetition on **both** Node versions (75 invocations total, 0 failures). `detail` is reported for traceability.

| Row | Sub-case | Expected | Actual (both Nodes, all 3 reps) | detail |
|---|---|---|---|---|
| FC3 | forged extra key ("no page-supplied value influences the decision") | block_unverified 18 | PASS | `record-keys-mismatch:index-0` |
| FC4 | `timedOut:true` | block_unverified 18 | PASS | `realm-not-affirmatively-validated:F1` |
| FC5 | `error:'not-created'` | block_unverified 18 | PASS | `realm-not-affirmatively-validated:F1` |
| FC6 | realm disagreement | block_unverified 18 | PASS (see SPEC-AMBIGUOUS note below) | `realm-not-affirmatively-validated:F1` |
| FC7 | `error:'threw'` | block_unverified 18 | PASS | `realm-not-affirmatively-validated:F1` |
| FC8 | requiredIds missing one id (representative) | block_unverified 18 | PASS | `required-id-set-malformed` |
| FC9 | deleted `descriptor` key (representative) | block_unverified 18 | PASS | `record-keys-mismatch:index-0` |
| FC10 | value whose serialization varies across decide's two reads | block_unverified 18 | PASS | `record-unstable:index-0` |
| FC11 | `schemaVersion:2` (representative) | block_unverified 18 | PASS | `schema-version-unknown:index-0` |
| IC3-a | B27 base (authorised positive control) | **armed:true**, exit 0 | PASS | — |
| IC3-b | one realm present | present 18 | PASS | `realm:F1` |
| IC3-c | one realm unmeasurable | block_unverified 18 | PASS | `realm-not-affirmatively-validated:F1` |
| IC3-d | disagreement | block_unverified 18 | PASS (SPEC-AMBIGUOUS, see below) | `realm-not-affirmatively-validated:F1` |
| IC3-e | empty array | block_unverified 18 | PASS | `realm-missing:F1` |
| IC5-1 | missing realm | block_unverified 18 | PASS | `realm-missing:F1` |
| IC5-2 | duplicate id | block_unverified 18 | PASS | `realm-duplicate:F1` |
| IC5-3 | extra id (requiredIds, 22 entries) | block_unverified 18 | PASS | `required-id-set-malformed` |
| IC5-4 | unknown id | block_unverified 18 | PASS | `required-id-unknown` |
| IC5-5 | `measurable:undefined` | block_unverified 18 | PASS | `record-keys-mismatch:index-0` |
| IC5-6 | `typeofSharedWorker:null` | block_unverified 18 | PASS | `record-value-type:typeofSharedWorker:index-0` |
| IC5-7 | `typeofSharedWorker:'object'` | block_unverified 18 | PASS | `realm-not-affirmatively-validated:F1` |
| IC5-8 | malformed record (primitive) | block_unverified 18 | PASS | `record-not-plain-object:index-0` |
| IC5-9 | non-array `perRealm` (`{}`) | block_unverified 18 | PASS | `input-not-array` |
| IC5-10 | `repetitionsConsistent:false` | block_unverified 18 | PASS | `realm-not-affirmatively-validated:F1` |
| FW-1 | required fail-closed decision (WebSocket stays unmeasured) | block_unverified 18, armed:false | PASS | `fw1-websocket-unmeasured` (literal rule application; not a WS measurement) |

## Exhaustive mutation sweeps (section D), 3 full passes per Node version

Expected case counts were **derived independently from the schema constants** (`CANONICAL_REQUIRED_REALM_IDS.length=21`, `REQUIRED_KEYS.length=11`, 5 mutations, 6 valid-negative substitutions, 13 structural cases) and then compared with section D's stated counts:

| Sweep | Derived count | Section D stated | Match |
|---|---|---|---|
| A (malformed single-field) | 21×11×5 = **1155** | 1155 | yes |
| B (valid-but-negative) | 21×6 = **126** | 126 | yes |
| C (structural battery) | **13** | 13 | yes |

Each sweep was run **3 times per Node version** (6 full passes total per sweep):

- **Sweep A:** 1155 cases/pass × 3 reps × 2 Nodes = 6930 invocations. Every invocation: `armed:false`, exit 18, `shared_worker_block_unverified`. **0 unexpected.**
- **Sweep B:** 126 cases/pass × 3 reps × 2 Nodes = 756 invocations. 42/pass → `shared_worker_present` (the `typeofSharedWorker:'function'` and `constructed:true` substitutions, 21 each), 84/pass → `shared_worker_block_unverified`. Matches section D exactly on every pass, both Nodes. **0 unexpected.**
- **Sweep C:** 13 cases/pass × 3 reps × 2 Nodes = 78 invocations, all `shared_worker_block_unverified`. **0 unexpected.** Per-case detail (see raw JSON `perCase`): C1 `record-keys-mismatch`; C2 `record-prototype-invalid`; C3/C4 **`record-key-order`** (not `record-accessor-property` — see note below); C5 `record-unstable`; C6 `record-symbol-key`; C7/C8 `array-sparse-or-extra-keys`; C9/C10 `record-prototype-invalid`; C11 `record-key-order`; C12 `realm-duplicate:F1`; C13 `record-unstable`.

**Totals across both Nodes:** pure-row invocations 150 (25 sub-cases × 3 reps × 2 Nodes), Sweep A 6930, Sweep B 756, Sweep C 78 → **grand total 7914 `decide()` invocations.** Exactly one `armed:true` outcome occurred overall: IC3-a / B27, across its 6 repetitions (3 per Node) — the single authorised positive control, repeated as instructed. Zero unexpected `armed:true` anywhere.

## PROXY-27 residual (B.7), reported honestly, not hidden

A Proxy wrapping realm F1 with a pass-through `get` trap that returns **exactly** the same valid values on every read (observationally identical to the plain record it mimics), over an otherwise-valid B27, was tested once per the task's requirement. Result: `armed:true`, exit 0, `shared_worker_absent_all_realms` — **the Proxy arms**, exactly as B.7 states it would ("a Proxy supplying exactly the values of a valid record... yields the same decision as that record"). This is the **documented residual `PROXY-27`**, not a new finding and not a detection claim; it is listed here, labelled, as instructed, and is distinct from the Sweep C5/C13 cases (a **varying** trap), which correctly refuse with `record-unstable`.

## SPEC-AMBIGUOUS findings

1. **FC6 / IC3-d "disagreement."** The table expects a result attributable to "realm results disagree." `decide27.js`'s explicit disagreement branch (the block the source code itself comments "explicit invariant, redundant after (4)") is unreachable as written: it can only run after every required realm has already passed step (4) as either clean-absence or measured-presence, and after step (5) has found no measured presence — but clean absence forces `typeofSharedWorker === 'undefined'` for every such realm, so two "disagreeing" clean-absence realms cannot differ, and any genuinely differing, non-clean-absence realm is instead caught earlier at step (4) with detail `realm-not-affirmatively-validated`. The **outcome** (`armed:false`, exit 18, `shared_worker_block_unverified`) still matches the table's stated expected result, but the specific `disagreement` detail string is dead code given the surrounding logic. Reported for Security/Architect disposition, not silently resolved.
2. **FC10 / Sweep C13 "post-validation mutation."** `decide(perRealm, requiredIds)` is a single synchronous call with no externally reachable hook between its internal steps, so "the caller mutates the record after validation, before the decision" cannot literally be injected from outside the function. The closest faithful pure-function exercise of the same defence is a value whose serialization differs across `decide()`'s own two independent snapshot reads (the exact mechanism B.6 relies on), which was used for both FC10 and C13. Both correctly produce `record-unstable`. This is reported as an interpretation, not a gap in the implementation.
3. **Sweep C3/C4 (getter/setter) detail string.** Expected informally as `record-accessor-property`; the actual observed detail is `record-key-order`. Cause: `Object.defineProperty` on a previously-deleted key reinserts it at the **end** of the own-property-name insertion order, so `inspectRecordShape`'s key-order loop (which runs before its accessor-descriptor loop) refuses first. The row still fails closed as the table requires (`shared_worker_block_unverified`, exit 18); only the specific `detail` differs from a naive expectation. Not a defect, but worth the Architect/Security recording the exact mechanics.
4. **IC5 "extra id" sub-case.** The named battery item is ambiguous between a `requiredIds`-level extra id and a `perRealm`-level extra record. This run implemented it at the `requiredIds` level (22-entry array); the `perRealm`-level equivalent is already covered by Sweep C1/C8. Reported as an interpretation choice, not resolved unilaterally as "the" answer.

## Not executed (out of CONF-02A scope)

Classified `BROWSER (CONF-02B)`: F1–F22 (22 rows), FC1, FC2, IC1, IC2, IC4, IC8 (6 rows) — 28 rows total. These require real Chromium measurement, the scratch browser-identity wrapper (section J.2), and/or network observation, none of which this pure-function slice performs.

## Cleanup verification

No harness process or Node process started by this run remained after completion; both `node harness.js` invocations (Node 22 and Node 24) ran to completion and exited before the next command was issued, confirmed by `ps` showing no `conf02`/`harness.js` process under either Node binary at the end of the run. **Unrelated finding:** `ps` also showed two long-running processes (PIDs 62930/62932, started ~16:04, directory `scratchpad/conf01`, task CONF-01) still alive at the time of this check. These are **not** part of CONF-02A, were not started by this run, and were not terminated by this run (out of this task's authorized scope); flagged in Open Risks for the coordinator.

## OBSERVED FACT / INFERENCE

- OBSERVED: all 14 pure-function W6-T rows (25 sub-cases) pass as expected on both Node 22.19.0 and Node 24.21.0, 3 repetitions each, 150 invocations, 0 failures. All three section D sweeps execute at their schema-derived counts (1155/126/13, matching the document exactly), 3 full passes per Node version, 7764 sweep invocations, **0 unexpected `armed:true`**. The single authorised positive control (B27) is the only `armed:true` outcome anywhere in this run. The documented PROXY-27 residual reproduces exactly as B.7 describes it.
- INFERENCE: the rev 27 `decide()` as extracted (sha256 `4de3de24...`) satisfies the pure-function portion of the M-26 "no missing measurement can produce `armed:true`" property under this sweep definition; the browser-dependent portion (probe → schema conformance, FC1/FC2, IC1/IC2/IC4/IC8) is unaddressed by this document and must not be inferred from it.

## What remains (owed to CONF-02B)

28 browser rows (F1–F22, FC1, FC2, IC1, IC2, IC4, IC8), the section J.2 browser-identity wrapper and CDP corroboration, and the FC2 five-sub-observation battery. Gate outcome stays **PARTIAL** until CONF-02B executes and Security rules on PROXY-27, OPEN-BID-27, and the SPEC-AMBIGUOUS items above.
