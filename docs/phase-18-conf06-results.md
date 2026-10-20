# Phase 18 - CONF-06 Node-side conformance results (rev 30 reference, rev 31 test contract)

**Status: PASS (Node-side oracle). Browser half reused from CONF-05B.** Written by the coordinator from raw result files (scratch, not tracked). Reference: `decide30.js` sha256 `273747000d3750eb...2eba`, byte-identical to the file CONF-05B ran (cmp identical; same hash as recorded in `phase-18-conf05-results.md`). Rev 30 commit `4b703fa`. No reference change, so CONF-05B (`phase-18-conf05b-browser-results.md`: 96 decisions per Node, 0 mismatches, 0 arms, popup `isTrusted:true`) stays valid and was not rerun. Contract corrections: `architecture/phase-18-rev31-patch.md`. Evidence docs of earlier CONF runs were not edited.

Environment: macOS arm64; Node v22.19.0 and v24.21.0; stderr empty on both; result files identical apart from `meta`.

| Item | Node 22 | Node 24 |
|---|---|---|
| Independent contract oracle (MT-1) failures | 0 | 0 |
| Rows covered / uncovered | 58 / 0 | 58 / 0 |
| MT-2 (5 injected faults detected) | 5 of 5 | 5 of 5 |
| Sweep A / B / C / D | 1155 / 126 / 20 / 195, 0 mismatches | same |
| Sweep E | 16 executable, 0 mismatches, 2 invariant controls (construction throws) | same |
| Refusals / invocations (computed = documented) | 1512 / 1513 | same |
| FC16 (12 sub-cases x 2 bases, 3 reps; d x 3 bases) | 75 records, 0 failures, caller counter 0 | same |
| FC12 a-g x 3 | 21 records, 0 failures | same |
| FC17 a-e (c sloppy via `new Function`, strict via child process) | 15 records, 0 failures | same |
| Unexpected `armed:true` | 0 | 0 |

Arms are all authorised: IC3-a and the FC16(d) clean control (named controls), and 30 caller-side post-validation mutation rows plus Sweep C `C13`/`C20`, whose unmutated baseline also arms and is unchanged. `shared_worker_present` never appears where a refusal is required, other than the contract-stated `BP30(8)` outcomes.

**Defects in my earlier analysis, corrected here:** CONF-05 also had three FC17(c) failures (the harness's "sloppy" step ran in strict mode) and an uncovered FC12 row; neither was reported in the CONF-05 results. Both were harness defects, fixed here (FC17c run through `new Function`; FC12 added). I also had to correct the FC16(d) premise: the reference does not return `input-prototype-invalid` for it.

**Cleanup:** no harness or isolated-process leftovers (`pgrep` empty). No network, no browser in this run.

**Not covered / unchanged limits:** supported-browser set is empty; F16-F21 real measurements, worker WebSocket (FW-1), OPEN-BID-27 and a browser without SharedWorker remain unmeasured; the CONF-05B popup result is a CONF-05B observation.
