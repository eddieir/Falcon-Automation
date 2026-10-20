# Phase 18 — CONF-05 consolidated results (rev 30, `4b703fa`)

**Status: PARTIAL. Security is NOT dispatched.** The contract-derived oracle reported failures, and Node-side oracle output exists for Node 22 only. Agents stopped at their turn limits without reports; the coordinator read the raw files (`scratchpad/conf05/`). CONF-01 to CONF-04 are unchanged.

Reference module `decide30.js` (sha256 prefix `273747000d3750eb`): exports only a frozen `{decide}`; `decide(perRealm)` takes one argument.

## Passed
- **Browser (CONF-05B), Node 22 and 24:** 96 decisions per Node, 0 mismatches against `expectations0.json` (recomputed by the coordinator), 0 armed; 3 of 3 full-gate repetitions refuse; `fc2Pass` true; 0 non-loopback requests (642 / 641). Browser oracle file: 114 rows, 0 failures, 27 rows marked partial (the unmeasured or fail-closed F5, F7, F11, F16 to F21 rows, 3 repetitions each). **Popup gesture now verified from raw data:** `isTrusted: true` and `waitForEvent: resolved` recorded for the popup clicks.
- **Node-side (CONF-05A) sweeps, identical on Node 22 and 24:** A 1155, B 126, C 20, D 195 all match; 1514 refusals + 1 authorised control = 1515 (matches the formula); 0 mismatches, 107 row executions, 0 row failures by the harness's own flags; **FC16a (Security's exact `slice` reproduction) refuses with `array-sparse-or-extra-keys` and 0 caller-function invocations**; FC17 export keys are exactly `["decide"]`.

## Failed / not complete
1. **Contract oracle (MT-1) reports failures** (Node 22; no Node 24 oracle file was produced):
   - **FC16.d inherited-method:** the expectations file expects `realm-not-affirmatively-validated:F3` and `shared_worker_present` at `realm:F9`; the reference returns `input-prototype-invalid:perRealm` (a refusal, safe direction). Detail and one reason disagree with the contract-derived file.
   - **FC16.j accessor-length and Sweep E (16 of 18 executed):** the expectation assumes a constructible accessor-`length` Array; JavaScript refuses (`Cannot redefine property: length`), so two Sweep E cases are unreachable by construction.
2. **No oracle result for Node 24**, and no Node-side results document from the agent.
3. The oracle's coverage of the rows is otherwise listed as complete (52 rows in the schema, 1 uncovered), but the failures above mean the owner's "complete oracle coverage and zero failures" condition is not met.

## Not measured
Worker WebSocket; F16 to F21 as real measurements; a browser without SharedWorker (no real `armed:true` observed); product-side identity (OPEN-BID-27); the GitHub-hosted runner. Supported-browser set: empty.

## Next
A narrow rev 31: correct the expectations for the inherited-method case (contract text, not implementation, decides which refusal detail is canonical) and define the two unreachable Sweep E cases explicitly (equivalent reachable construction, or removed with a stated reason); then re-run the Node-side oracle on both Node versions. No browser re-run is needed unless the reference code changes.
