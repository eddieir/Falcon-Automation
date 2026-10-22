# Phase 18 — CONF-03A Node-side conformance results (rev 28)

**Status: DONE for its scope (Node-side rows and sweeps); the browser rows are CONF-03B's.** This document was written by the coordinator from the raw result files because the executing agent stopped at its turn limit without a report. It reads what the files contain and nothing else. Raw evidence (scratch, not tracked): `scratchpad/conf03/nodeside-results-node22.json`, `nodeside-results-node24.json`, `node22.log`, `node24.log`, `harness.js`, and `decide28.js` (verbatim extraction of rev 28 section B.5; sha256 `a7933e0756fd6ce1eabd58b51cf9aa767c54dbb08b8654a7245e8aef7cfc994e`).

Base revision: rev 28 `4f9e2d5`. Environment: macOS arm64; Node v22.19.0 and v24.21.0. No browser, no network, no filesystem access by the decision function.

## Results (identical on both Node versions; the two result files differ only in the `meta` block)

| Item | Result |
|---|---|
| Independent row executions | **145 per Node** (49 distinct rows/sub-cases x 3 repetitions, each with its own constructed input) |
| Failures / uncaught throws / unexpected arms | **0 / 0 / 0** on both Nodes |
| Sweep A (malformed single-field mutations) | 1155 computed = 1155 documented; 1155 executed; 0 mismatches |
| Sweep B (valid-but-negative substitutions) | 126 computed = 126 documented; 126 executed; 42 measured-presence and 84 unverified, as expected; 0 mismatches |
| Sweep C (structural battery) | 20 cases (21 entries with C18b) computed = documented; 3 full passes per Node; 0 failures |
| Only `armed:true` outcome | IC3-a "21 clean-absence (AUTHORISED positive control)", 3 repetitions per Node |
| FW-1 | the required fail-closed decision executed 3 times per Node; the "WebSocket behaviour unmeasured" statement is retained |
| `isProxy` captured once | verified by a dedicated row: replacing `util.types.isProxy` after module load did not change `decide()` (a proxy record still refused with `record-proxy:index-0`) |

### Rows executed (3 repetitions per Node each)
FC3; FC4; FC5; FC6 (two variants); FC7; FC8 (non-array, missing id, duplicate id, extra id, unknown id); FC9 (deleted `descriptor`, wrong boolean type, out-of-enum `mechanism`, non-primitive value, symbol key); FC10 (SEAM-28: mutate a data value, delete a key, install a getter, substitute a field with a Proxy, substitute the whole record with a Proxy); FC11 (`schemaVersion` 0, 2, `'1'`, missing, 1.5); FC12 (Proxy as `perRealm`, as `requiredIds`, as a record, as a nested value, and post-validation substitution through the seam); IC3-a to IC3-e; IC5-1 to IC5-10 including the split IC5-3a (`requiredIds`-level extra id) and IC5-3b (`perRealm`-level extra record); FW-1; the `isProxy` capture row.

### Proxy cases (all refuse, `shared_worker_block_unverified`, exit 18, none threw)
Transparent pass-through record Proxy (`record-proxy:index-0`); trapping record Proxy whose `get`/`getOwnPropertyDescriptor` throw (`record-proxy:index-0`); revoked record Proxy (`record-proxy:index-0`); `perRealm` as a Proxy over a valid array (`input-proxy:perRealm`); `requiredIds` as a Proxy and as an array containing a Proxy element (`input-proxy:requiredIds`); a nested structured value holding a Proxy (`record-value-proxy:mechanism:index-0`); a varying-trap Proxy (`record-proxy:index-0`); post-validation substitution through SEAM-28. The pass-through Proxy that armed in CONF-02 now refuses.

### Structural battery detail strings (rev 28 canonical order: accessor check before key-order check)
Getter and setter for a required key refuse with `record-accessor-property:index-0` (resolving the CONF-02 ambiguity); inherited property, class instance and null-prototype record refuse with `record-prototype-invalid:index-0`; extra own property with `record-keys-mismatch:index-0`; non-canonical key order with `record-key-order:index-0`; sparse array or extra array key with `array-sparse-or-extra-keys`; duplicate realm id with `realm-duplicate:F1`.

## Not executed here
The 28 browser-dependent rows are listed in the raw file as not executed by this task (F1 to F22, FC1, FC2, IC1, IC2, IC4, IC8); they belong to CONF-03B.

## Spec-ambiguity notes recorded by the run (3)
The raw file records three items (for example, that under the rev 28 reference text `inspectRecordShape` already requires primitive data values before the two snapshot reads, so the "record-unstable" companion of FC10 cannot be produced by a plain value). These are reported as the agent recorded them; the coordinator did not resolve them.

## Cleanup
The two background runs completed and exited; no CONF-03A process was found by the coordinator's `ps` check.

## OBSERVED FACT / INFERENCE
- OBSERVED: for the Node-side decision function in rev 28, every malformed, mutated and Proxy input in the defined sweeps and rows refused with exit 18 and nothing threw; the only arm was the authorised positive control.
- INFERENCE (not proven): the real-browser behaviour, browser identity and the popup, FC1 and IC4 rows are not covered by this document; none of the results here shows that a browser build exists on which the pilot can arm.
