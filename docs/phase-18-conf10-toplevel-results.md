# Phase 18 - CONF-10 top-level caller test results (rev 35 reference)

**Status: PASS for what is stated (Node 22.19.0 and 24.21.0, macOS arm64).** Written by the coordinator from raw test output (scratch, not tracked). Reference `toplevel34.js` is reproduced in `architecture/phase-18-rev35-patch.md`; the gate (`gate34.js`, prefix 92ad5650) and decision function (`decide32.js`, prefix e197ec58) are unchanged.

| Row | Result (both Nodes) |
|---|---|
| TL1 injected throws from the gate (Error, RangeError, null, hostile getter) | canonical refusal, exit 18, hostile getter never run |
| TL2 normal verdict passes through the caller | authorised arm untouched |
| TL3 near-stack-limit sweep through caller plus real gate | 3242 (Node 22) and 3836 (Node 24) calls, 0 arms on invalid input, 0 escapes of either layer, 0 mapped by the catch |
| TL4 process-level mapper in child processes | uncaught sync throw 18, unhandled rejection 18, late timer throw 18, clean exit 0 |

Limits: TL3 did not reproduce the escape Security saw (17 to 22 per 5 sweeps), so layer 2's coverage of the real exhaustion case is inference from the synthetic escapes in TL4. No product consumer exists. Linux and CI unmeasured.
