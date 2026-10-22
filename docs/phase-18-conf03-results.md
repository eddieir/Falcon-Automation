# Phase 18 — CONF-03 consolidated W6-T conformance results (rev 28)

**Status: PARTIAL. Security is NOT dispatched.** Stop condition met: a required row (FC1 mismatch-injection) does not produce its specified result. Everything else the owner listed passed: all malformed and Proxy inputs refuse, no browser row armed, identity was verified, FC1 and IC4 ran independently, the popup realms were created and measured, cleanup succeeded.

Base revision: rev 28 `4f9e2d5` (rev 27 `2ab5f30`, rev 26 `d79c213`). Evidence documents: `docs/phase-18-conf03a-nodeside-results.md` (Node-side rows and sweeps) and `docs/phase-18-conf03b-browser-results.md` (browser rows; agent draft with a coordinator note). Raw files stay in scratch (`scratchpad/conf03/`). Both agents stopped at their turn limits; the coordinator read the raw result files and the agent's final report to write this document. CONF-01 and CONF-02 remain PARTIAL and are untouched.

Environment: macOS arm64; Node v22.19.0 and v24.21.0; Playwright 1.64.0; Chromium 156.0.8078.4 launched through the identity wrapper; loopback fixtures only; reference module `decide28.js` sha256 `a7933e0756fd6ce1…` (verbatim from rev 28 B.5).

## Passed (identical on both Node versions)

| Area | Result |
|---|---|
| Node-side rows, sweeps, proxies (CONF-03A) | 145 independent row executions per Node; sweeps 1155 / 126 / 20 match the formulas; 0 failures, 0 uncaught throws, 0 unexpected arms; every Proxy case refuses (transparent, trapping, revoked, array, `requiredIds`, element, record, nested, post-validation via SEAM-28); `isProxy` captured once at module init verified |
| Browser rows, decisions | 96 recorded decisions per Node, **0 armed** |
| F1 to F4, F6, F8 to F10, F12, F13, F14, F15 | measured present, `shared_worker_present`, exit 18 (3 of 3 per Node). F13 and F14 popups are now created (a real user-gesture `page.click()` replaced the gesture-free `evaluate`) and measured present, closing the CONF-02 `not-created` gap |
| F5, F7, F11, F21 (required fail-closed); F16 to F20 (unmeasured by design) | `shared_worker_block_unverified`, exit 18 |
| Full 21-realm gate | `armed:false`, exit 18, `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:F5`, 3 of 3 per Node |
| FC2 | five sub-observations, `fc2Pass: true` (3 of 3 per Node); explained |
| IC1 | PASS: the harness sees an unblocked SharedWorker request |
| IC2 | refuses |
| IC4 (probe disabled / partial / gate removed) | probe disabled and partial refuse with `realm-missing:F1` as expected; the gate-removed sub-case arms by construction and the suite reports the required failure ("FAIL (expected/required)"), which is the defined result of J.6 |
| IC8 identity | base verified (pid, start time, args, exec check); kill-and-relaunch, changed arguments and different context all refuse; 0 wrong arms |
| FW-1 | required fail-closed decision executed 3 times per Node; "WebSocket behaviour unmeasured" retained |
| Network | 642 loopback requests, **0 non-loopback**, per Node |
| Cleanup | no CONF-03 process, profile or identity file remains; two pre-existing loopback listeners not started by this run were left alone (reported with pids by the agent) |

## What failed

**FC1 mismatch-injection (required row): FAIL on the reason, 3 of 3 repetitions on each Node.** J.5 requires that when the live constructor disagrees with the pre-captured reference (`nativeCtor:'mismatch'`) the decision is `armed:false`, exit 18, `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:<realm id>`. The recorded decision is `shared_worker_present`, detail `realm:F1`. It still refuses and never arms, so there is no arming risk in this instance, but the contract and the reference text disagree. The cause is in the reference `decide()` (rev 28 B.5, `decideFromSnapshot`): a realm measured as present is classified present without checking `nativeCtor` (the agent also reported this). By B.4 precedence ("invalid or unverified evidence first"), a native-reference mismatch should win over presence. This is a defect in the rev 28 reference text, not in the harness. The harness's `pass:true` for this row used a different expectation and is not accepted.

A second CONF-03B mid-run defect was fixed before the final run: the FC1 row had been fed a synthetic all-absent array and returned `armed:true` for a realm that was measured present; it now uses the real measured record. The corrected run shows 0 armed.

## Not measured

F16 to F21 as real measurements (by design they are fail-closed rows); worker WebSocket behaviour; any browser in which SharedWorker is absent (so a real `armed:true` path is still not observed end to end); the product-side browser identity mechanism (open item OPEN-BID); Linux or the GitHub-hosted runner for these rows.

## Practical supported-browser set

**Empty.** The current pinned Chromium refuses in every real-browser gate run.

## RECOMMENDATION

Do not send rev 28 to Security. Issue a narrow rev 29 that makes the validation of every realm record (including `nativeCtor` agreement with `typeofSharedWorker`) run before presence classification, so `mismatch`, `uncaptured` or any disagreement yields `shared_worker_block_unverified` even for a present realm, add the corresponding sweep and row expectations, then re-run only the affected rows (FC1 mismatch, the gate, the sweeps that exercise `nativeCtor`) and the Node-side matrix on both Node versions before any Security ruling.
