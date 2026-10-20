# Phase 18 - CONF-07 conformance results (rev 32 reference, m-96 fix)

**Status: PASS (Node-side and browser, Node 22.19.0 and 24.21.0).** Written by the coordinator from raw result files (scratch, not tracked). Reference: `decide32.js`, sha256 `e197ec58f6084f03508cac198e21630eb31eb3f2218023c227642fb898b3a522` (verbatim text in `architecture/phase-18-rev32-patch.md`). The reference code changed from rev 30, so the complete Node-side and browser suites were rerun. Environment: macOS arm64; Playwright 1.64.0; Chromium 156.0.8078.4. Earlier results documents were not edited.

| Item | Node 22 | Node 24 |
|---|---|---|
| Node-side independent oracle failures / uncovered rows | 0 / 0 | 0 / 0 |
| MT-2 injected faults detected | 5 of 5 | 5 of 5 |
| Sweeps A / B / C / D / E | 1155 / 126 / 20 / 195 / 16 (+2 invariant controls), 0 mismatches | same |
| Refusals / invocations (computed = documented) | 1512 / 1513 | same |
| FC12, FC16 (incl. corrected d), FC17 | 0 failures | same |
| **FC18 built-in patching (new)** | 3 runs x (784 properties of 59 global roots patched one at a time, then all at once with 125 inherited accessors): **0 caller executions, 0 decision changes**; only the authorised all-absent input arms | same |
| FC18 control (rev 30 module under the same sweep) | detected: 8 single-property failures, 9 decision mismatches | same |
| Browser oracle (114 rows, 3 reps) failures | 0 | 0 |
| Browser gate runs refused (full gate) | 3 of 3 | 3 of 3 |
| Requests / non-loopback | 642 / 0 | 642 / 0 |
| Unexpected `armed:true` | 0 | 0 |
| FC2 `fc2Pass`; popup `isTrusted:true` records | 3 true, 0 false; 12 | same |

Arms present in the raw files are authorised: IC3-a, the FC16(d) clean control, post-validation caller-mutation rows and FC2/IC controls whose unmutated baseline arms. The browser run's 27 partial rows are the realms the pinned Chromium cannot measure (F5/F7/F11, F16-F21), which refuse, as in CONF-05B.

Matrix coverage is the rev 31 contract (52 schema rows) plus FC18 (53). Cleanup: no harness, isolated-process or scratch Chromium process remains (`pgrep` empty); stderr logs are empty.

**Limits:** the supported-browser set is still empty; F16-F21 real measurements, worker WebSocket (FW-1), OPEN-BID-27 and a browser without SharedWorker remain unmeasured. Compromise before module initialization is outside the module's guarantee (stated in the module header and rev 32 patch).
