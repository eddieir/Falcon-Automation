# Phase 18 — CONF-05B browser-row results (rev 30)

Base: rev 30 `4b703fa` on `docs/phase-18-architecture`. Reference module `decide30.js` (frozen export `{ decide }` only; `decide(perRealm)` takes ONE argument — no caller-supplied `requiredIds`). Environment: macOS arm64, Node v22.19.0 and v24.21.0, Playwright-managed Chromium 156.0.8078.4 via the J.2 identity wrapper, loopback only.

Raw evidence (scratch, untracked): `scratchpad/conf05/browser-harness.js`, `browser-wrapper.sh`, `browser-run-node.sh`, `browser-oracle.js`, `decide30.js`, `expectations0.json`, `browser-results-node22.json`, `browser-results-node24.json`, `browser-oracle-node22.json`, `browser-oracle-node24.json`. `browser-harness.js` is adapted from `conf04/browser-harness.js` with the minimum change for the rev 30 contract: `require('./decide30.js')` and every `decide(arr, IDS.slice())` call site changed to `decide(arr)` (one argument, no `requiredIds`). It additionally records, for F13/F14 only, the popup-opening gesture: event source (Playwright `page.click` vs `evaluate`), the in-page `isTrusted` flag of the click event (captured by the fixture's own `onclick` handler before `window.open`/navigation), and the `context.waitForEvent('page')` outcome.

## Independent oracle

`browser-oracle.js` reads expected outcomes **only** from `conf05/expectations0.json` (rev 30, ARCH-30, C.6) — never the harness's own `expected`/`pass` fields. It recomputes each row's predicted `decide()` outcome from the raw recorded evidence (B.4a matrix: valid-absence / valid-presence / neither) and fails on any row or case with no matching `expectations0.json` entry, any skipped row, any unmeasured required row reported as a full pass (`unmeasuredRequiredRow: partial-and-refuse` — recorded as `partial`, not `fail`, provided the decision itself is still the correct refusal), and any non-loopback request or unexpected `armed:true`.

| Metric (per Node version) | node22 | node24 |
|---|---|---|
| Rows checked | 114 | 114 |
| Failures | **0** | **0** |
| Partial (fail-closed-by-design / unmeasured-today: F5, F7, F11, F16–F21 × 3 reps) | 27 | 27 |
| Loopback requests | 642 | 641 |
| Non-loopback requests | **0** | **0** |
| `armed:true` occurrences | **0** | **0** |
| Unexpected `armed:true` | **0** | **0** |
| 21-realm gate repetitions / all refused | 3 / **yes** | 3 / **yes** |

Required rows, all ≥3 reps, both Node versions:

| Row(s) | Outcome |
|---|---|
| F1–F4, F6, F8–F10, F12–F15 | `shared_worker_present`, armed:false, exit 18 (F13/F14 popups created and measured) |
| F5, F7, F11, F16–F21 | `shared_worker_block_unverified`, armed:false, exit 18 — required fail-closed/unmeasured-today rows (recorded `partial`, decision still correct) |
| F22 | informational only; never fed into `decide()` |
| Full 21-realm gate | `shared_worker_block_unverified`/`shared_worker_present`, armed:false, exit 18 in **every** repetition — current Chromium refuses every time |
| FC1 (agreement) | `nativeCtor` agrees with `typeof`; decision matches B.4a prediction |
| FC1 mismatch-injection | `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:F1`, **every** repetition (no `shared_worker_present` leak) |
| FC2 | `fc2Pass: true` every repetition (5 sub-observations: delete, defineProperty, assignment, prototype, with-shadow; native reference stays usable; decision unchanged) |
| IC1 | `constructed-ok`, script fetch observed (positive control) |
| IC2 | still refuses with `--disable-features=SharedWorker` |
| IC4 a (probe disabled) | `realm-missing:F1` |
| IC4 b (probe partial) | `realm-missing:<first omitted id>` |
| IC4 c (gate removed) | demonstrates the required arming defect when the `decide()` call is deleted (recorded as the expected failure scenario, not a false green) |
| IC8 base / kill-relaunch / different-args / different-context | all refuse; kill-relaunch ⇒ `identity-unverified:pid-not-alive`; different-args ⇒ `identity-unverified:args-mismatch`; different-context ⇒ `different-context-config-requires-fresh-evidence` |
| FW-1 | required fail-closed decision executed, `status: UNMEASURED` (WebSocket path stays unmeasured) |

## Popup gesture verification (F13/F14, new recording requirement)

For every F13/F14 repetition (both Node versions), the raw record's `_popupGesture` field shows: `eventSource: "page.click (trusted)"` (Playwright `page.click`, not `page.evaluate`), in-page `isTrusted: true` captured by the fixture's own `onclick` handler before any navigation, and `waitForEventOutcome: "resolved"` (`context.waitForEvent('page')` resolved concurrently with the click). All three fields were present and consistent in all 6 reps × 2 Node versions, so the gesture is **verified from raw data**, not asserted.

## Identity and same-process checks

Every gate/F-row repetition re-verified wrapper identity after the run (`identityVerifiedBeforeRun: true`, `reverify.ok: true`): same pid, same `lstart`, same real-Chromium executable path — no relaunch or process substitution occurred mid-row.

## Cleanup

After both runs completed: no `conf05`-scoped process remained (`ps aux` grep on the scratch path, empty), no Chrome-for-Testing process remained, `scratchpad/conf05/profiles/` was empty, and no `identity-*.txt` file remained in `scratchpad/conf05/`. Verified by direct inspection, not inferred.

## Not measured

F16–F21 as real measurements (fail-closed rows by design); worker WebSocket behaviour (FW-1); a browser in which `SharedWorker` is absent, so a real `armed:true` was never observed end to end; the product-side browser identity mechanism (OPEN-BID-27, unchanged from CONF-04B). The full node-side sweep (1515 invocations, all case classes A–E) is owned by CONF-05A and is out of scope here.
