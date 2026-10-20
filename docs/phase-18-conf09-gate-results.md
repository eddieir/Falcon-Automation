# Phase 18 - CONF-09 gate and boundary test results (rev 34)

**Status: PASS (Node 22.19.0 and 24.21.0).** Written by the coordinator from raw test output (scratch, not tracked). Reference: `gate34.js` (verbatim in `architecture/phase-18-rev34-patch.md`, sha256 prefix 92ad5650c386f8a3) over the unchanged `decide32.js` (prefix e197ec58f6084f03). Test loader recompiles the gate source with the final export replaced by the private factory.

| Item | Node 22 | Node 24 |
|---|---|---|
| FC22 a-k (11 gate rows: production export, FW-2 refusal, evidence-only, pass-through, 13 injected throws, 25 stack exhaustions, post-decide throw, 29 malformed results, reason preservation, rebuild, documented scope) | 11 of 11 ok | 11 of 11 ok |
| Hostile thrown-value members / malformed-result traps and accessors run | 0 / 0 | 0 / 0 |
| FC18 built-in patching through the gate (784 properties, one at a time, then all together plus 125 inherited accessors) | 0 failures, 0 caller executions, only the authorised input arms | same |
| FC19 to FC21 against `decide32` and through the gate | all ok | all ok |
| Real stack exhaustion inside `decide` converted by the gate (FC20, 1001 depths) | 1 per run, 3 of 3 runs | 0 |
| Security's own sweep (SEC-29) | a `RangeError` escaped `gateDecide` 17 to 22 times per 5 sweeps with no arm and 0 conversions: the gate is not total near stack exhaustion (m-104); the caller must map any escaping exception to exit 18 | same |

Limits: macOS arm64 only; the gate has no product consumer yet (capture-once is verified against the module contract); the converted real exhaustion is JIT dependent and is evidence, not a deterministic fixture; FW-2 containment, OPEN-BID-27, Linux and the CI reachability checker remain open. The earlier Node-side matrix (CONF-06, CONF-07) and browser matrix (CONF-07) are unaffected because `decide32.js` did not change.
