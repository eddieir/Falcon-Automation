# Phase 18 Security Design Review 30 (SEC-31)

Reviewer role: Security Engineer (`claude-opus-5-5`), read-only. Revision reviewed: rev 35 at `cd9f843` (delta `538cf83..cd9f843`, docs only). Condensed by the coordinator from the reviewer's report. Status: **DONE**.

**Verdict: APPROVE WITH CONDITIONS (design only). Blockers: 0. Majors: 0. Minors: 2 (m-108, m-109).**

- **m-108 (minor):** the rev 35 text (section 3.2 and ADR-0055) says layer 2 "guarantees the process never exits 0". That is overstated. Against the reference caller the process exited 0 with: a listener added before the mapper that exits 0; `prependListener` after the mapper; `setUncaughtExceptionCaptureCallback`; an `unhandledRejection` listener added before the mapper that exits 0; `process.exit` patched to do nothing followed by a later `exitCode = 0`. A throw inside the mapper gave exit 7 and `removeAllListeners` gave exit 1. No case armed. A listener that only swallows still gave 18, so the statement that a pre-existing listener would suppress the mapper is inaccurate. Fix: limit the claim to the process-integrity boundary; at each gate call check that each event has exactly one listener and that no capture callback is set; capture `process.exit` when the mapper is installed.
- **m-109 (minor):** the corrected CI check can be defeated by renaming: a generated loader with another file name, a factory exported under another name, or a test-tree file required from production code when run from a checkout all pass items 1 to 3. Fix: make the `contained-for-test` grep blocking outside the test tree, exempting only the production gate by exact path and sha256; MG-11 cannot close without MG-13; add seeded rename and test-tree cases.

Closure: m-106 closed (the production gate is no longer flagged; m-109 remains). m-107 closed. Rulings: fail-closed behaviour is unchanged (`gate34.js` prefix 92ad5650 and `decide32.js` prefix e197ec58 match, FW-2 refusal still first); the FW2-C1 FAILED wording is honest, the candidates are unmeasured and server-header CSP is not presented as a Falcon mechanism; the OPEN-BID-27 wording and uncovered list are honest; the layer-2 inference limit is stated; agent findings bodies are unedited with accurate banners; no secrets found.

Remaining gates: MG-1 (partial), MG-2 to MG-7, MG-9 to MG-14, and owner authorisation.
