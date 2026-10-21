# Phase 18 - CONF-11 gate (no test literal) and supervisor test results (rev 37 references)

**Status: PASS for what is stated (Node 22.19.0 and 24.21.0, macOS arm64).** Written by the coordinator from raw test output (scratch, not tracked). `decide32.js` is unchanged (prefix e197ec58).

**Gate change (m-109).** `gate37.js` (sha256 `6c6d888ae0fca2fe865fba1907e1c7235838ef34e788fb84b434f8486469a5ae`) differs from `gate34.js` in one respect: the "contained" state is a private frozen object `FW2_CONTAINED` known only inside the module, instead of the string `contained-for-test`. The production file contains no test literal, so there is nothing to build at run time and no exemption is needed; the recompiling test loader appends an export of the token for tests only. The production export is still the single frozen key `gateDecide`, and while the FW-2 state is the production constant it still refuses every input with `worker_websocket_containment_unverified`, detail `fw2:unmeasured`, exit 18.

| Item | Node 22 | Node 24 |
|---|---|---|
| FC22 gate rows against `gate37.js` (11 rows: export, FW-2 refusal, evidence-only, pass-through, 13 injected throws, 25 stack exhaustions, post-decide throw, 29 malformed results, reason preservation, rebuild, documented scope) | 11 of 11 | 11 of 11 |
| Built-in patching sweep through the gate (784 properties, one at a time then all together plus 125 inherited accessors) | 0 caller executions, 0 decision changes | same |
| FC19 to FC21 through the gate | pass | pass |

**Supervisor (m-108).** `supervisor37.js` decides the exit code seen by CI in a separate parent process: the child reports exactly one canonical verdict line on an inherited pipe (fd 3); anything else (no verdict, malformed, two lines, extra key, signal, an arm with a non-zero child status) is exit 18. Test results, 3 reps per child on each Node: all 17 refusal and bypass children give **18 in every repetition** (a listener that exits 0, `prependListener`, a capture callback, a no-op `process.exit`, a patched `process.reallyExit`, an `'exit'` listener setting `exitCode = 0`, patched `listeners`/`listenerCount`, `removeAllListeners`, a throw inside a mapper, an unhandled-rejection listener that exits 0, a silent exit 0 with no verdict, two verdict lines, an extra key, an arm with child status 1, a SIGKILL); the authorised arm child gives 0. Zero wrong exit-0 results.

Limits: a child that can execute code and write fd 3 can forge a verdict, which is the process-integrity boundary; the supervisor must itself be small, separate and loaded without product code; no product consumer exists; macOS only; Linux and CI unmeasured.
