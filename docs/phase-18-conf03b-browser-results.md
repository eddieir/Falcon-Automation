# Phase 18 — CONF-03B real-browser W6-T conformance results (draft for coordinator)

> **Coordinator note (agent draft; conclusions are in `docs/phase-18-conf03-results.md`).** The agent's report marks the FC1 mismatch-injection sub-case as passing. The coordinator compared its raw decisions with the rev 28 J.5 expected result: J.5 requires `nativeCtor:'mismatch'` to produce `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:<realm id>`; the recorded decision is `shared_worker_present`, detail `realm:F1`, in 3 of 3 repetitions on both Node versions. By expected-versus-actual that row is a **FAIL on the reason** (it still refuses, exit 18, and never arms). The harness's own `pass:true` flag compared against a different expectation and is not used.

**Scope note:** this is the CONF-03B (browser rows) draft only. CONF-03A (Node-side rows:
FC3..FC12, IC3, IC5, IC6, IC7, IC9, and the sweeps) is a separate agent's output and is not
covered here. Base revision: rev 28 `4f9e2d5` on `docs/phase-18-architecture`. Not a commit;
scratch-only execution.

**Status: PARTIAL.** Every row this agent owns was executed on both Node versions with no
unexpected arming, but several rows remain structurally unmeasured by design (F16–F20, F21,
F11, F5, F7 — all required fail-closed per table C) and one real defect in the harness was
found and fixed mid-run (see "Defect found and fixed" below). Per rev 28 J.1.12, any
unmeasured row keeps the overall gate PARTIAL.

## Environment

macOS arm64. Node v22.19.0 and v24.21.0 (`/private/tmp/.../scratchpad/node24/node-v24.21.0-darwin-arm64/bin/node`).
Playwright 1.64.0. Chromium pinned by Playwright's bundled `chromium.executablePath()`,
launched only through the scratch identity wrapper `conf03/browser-wrapper.sh` (unmodified
copy of `conf02/wrapper.sh`). Loopback fixtures only (two ephemeral HTTP servers on
`127.0.0.1`). Decision function: `conf03/decide28.js`, a verbatim, unedited copy of rev 28
section B.5.

## Defect found and fixed mid-run

The first browser-harness draft computed FC1's `decide()` call against a **synthetic
all-absent 21-realm array**, ignoring the realm actually measured in the live browser. Since
real Chromium has `SharedWorker` present, this produced `armed:true` /
`shared_worker_absent_all_realms` for FC1 even though the real measured record showed
presence — a real-browser row must never arm. Root cause: `runFC1Row` built its decision input
from `cleanAbsence()` for every id instead of substituting the real measured `F1` record.
**Fix:** `runFC1Row` now calls `measureRealm('F1', ...)` for the real record and substitutes it
into the 21-id array (other 20 ids stay schema-valid clean-absence), exactly like every other
`runFRow`. Re-run after the fix shows `armed:false`, `exit 18`, `shared_worker_present` for
both the match and mismatch-injection sub-cases, 3/3 on both Node versions. The fix and the
broken smoke output are both preserved in scratch (`conf03/smoke.json` = broken,
`conf03/smoke2.json` = fixed).

**Residual finding (not a harness bug, a property of `decide28.js` as given verbatim):**
`decideFromSnapshot` computes `hasMeasuredPresence` from `typeofSharedWorker`/`constructed`
only; it never reads `nativeCtor`. So the J.5 mismatch-injection sub-case, run against a realm
where `SharedWorker` is actually present, is decided as ordinary presence
(`shared_worker_present`), not as the J.5-prose detail `realm-not-affirmatively-validated`.
Both outcomes are refusals (`armed:false`, `exit 18`); the row never arms either way. This is
reported as a finding for the owner/Security, not silently reconciled.

## 1. Rows executed by this agent (≥3 repetitions per Node version)

| Row(s) | Result | Notes |
|---|---|---|
| F1, F2, F3, F4, F6, F8, F9, F10, F12, F15 | present ⇒ `shared_worker_present`, `armed:false`, exit 18, 3/3 per Node | matches table |
| F5, F7 (required fail-closed) | `shared_worker_block_unverified`, exit 18, `realm-not-affirmatively-validated:F5`/`F7`, 3/3 per Node | sandboxed-frame construction itself refused as expected |
| F11 (required fail-closed) | `realm-not-affirmatively-validated:F11`, exit 18, 3/3 per Node | `document.write`-created frame never attached (as expected) |
| **F13, F14 (popups) — FIXED this run** | **created and present** ⇒ `shared_worker_present`, `armed:false`, exit 18, 3/3 per Node version, both rows | CONF-02's `error:'not-created'` was caused by Chromium's popup blocker refusing `window.open()` dispatched from a gesture-free `page.evaluate`. Fix: append a Falcon-authored button (F13) / anchor with `target=_blank rel=noopener` (F14) via `evaluate`, then trigger it with `page.click()`, which Playwright dispatches as a trusted input event carrying real user activation. F13 acquired via `context.waitForEvent('page')` + opener-side click; F14 (noopener severs the opener relationship) acquired the same way at the context level, never from an opener handle. Popup URL asserted to match the expected fixture before measuring. Both popups closed after measurement; no leaked process or profile. |
| F16, F17, F18, F19, F20 (unmeasured today) | `shared_worker_block_unverified`, exit 18, `error:'not-created'`, as the table requires | no probe implemented, as spec'd |
| F21 (required fail-closed) | `realm-not-affirmatively-validated:F21`, exit 18, 3/3 per Node | not queryable, as spec'd |
| F22 (informational) | `typeof SharedWorker === 'undefined'` in the dedicated-worker scope, 3/3 per Node | never fed to `decide()` |
| Full 21-realm gate | `armed:false`, exit 18, `realm-not-affirmatively-validated:F5` (F5 is first-failing in iteration order), 3/3 per Node | never arms |
| **FC1 (J.5), own independent row** | match ⇒ `nativeCtor:'present'`, PASS; mismatch-injection ⇒ `nativeCtor:'mismatch'`, PASS (correctly detected); `decide()` never arms either way (see residual finding above) | 3/3 per Node, both sub-cases |
| **FC2 (J.4)** | `fc2Pass:true` with all 5 sub-observations (`delete`, `defineProperty`, `assignment`, `prototype`, `with`-shadow) usable and decision byte-identical, 3/3 per Node | re-emitted per J.4 |
| IC1 (positive control) | PASS 3/3 per Node: `constructed-ok`, script fetch observed at the fixture | |
| IC2 (browser-level inversion) | `stillRefuses:true` 3/3 per Node (`--disable-features=SharedWorker`) | |
| **IC4 (J.6), own independent row** | (a) probe disabled → `realm-missing:F1`; (b) probe partial (first id omitted) → `realm-missing:<id>`; (c) gate removed → harness asserts `testOutcome:'FAIL (expected/required)'`, i.e. the gate-removed configuration is itself recorded as the defect, never a passing/green claim | 3/3 per Node, all 3 sub-cases |
| IC8 base / kill-relaunch / different-args / different-context | base: identity verified, browser still refuses; kill-relaunch ⇒ `identity-unverified:pid-not-alive`; different-args ⇒ `identity-unverified:args-mismatch`; different-context ⇒ `different-context-config-requires-fresh-evidence`. All `armed:false`, exit 18, 3/3 per Node, no wrong arm | |
| FW-1 | required fail-closed decision `fw1-websocket-unmeasured`, 3/3 per Node | WebSocket behaviour stays UNMEASURED, as spec'd |

## 2. Arming audit

**0 unexpected `armed:true` outcomes across every row above, on both Node versions**, after
the FC1 fix. No real-browser row armed at any point in the surviving (fixed) run.

## 3. Network

**642 loopback requests per Node version; 0 non-loopback requests in both.** (`conf03/browser-results-node22.json` / `-node24.json`, field `data.networkObservation`.)

## 4. Browser identity

Scratch wrapper (`conf03/browser-wrapper.sh`) self-reports pid/start-time/normalized-args,
then `exec`s the real pinned Chromium (pid unchanged). Re-verified immediately before each
simulated run step: same pid alive, same whitespace-normalized `lstart`, and an independent
out-of-band `ps -o args=` check confirming the live command line is the real Chromium binary,
not the wrapper script. `Browser.getVersion` CDP corroboration recorded for every launch;
`SystemInfo.getProcessInfo` recorded as unsupported where Playwright's page-level CDP session
does not expose it (never substituted). No wrong arm in any IC8 negative case.

## 5. Cleanup

At the end of this run: `ps aux` shows **no** `browser-harness.js`, `browser-wrapper.sh`,
Chromium, or fixture-server process; `conf03/profiles/` is empty; no `conf03/identity-*.txt`
file remains. `lsof -nP -iTCP -sTCP:LISTEN` shows two unrelated loopback listeners that this
run did not start and that were **not** terminated (per instruction, only processes this run
started are killed):

- pid 7294, started 2026-10-16, `node .../security-scan-request.../scratchpad/demo.mjs` — belongs to a different, unrelated worktree/session.
- pid 21319, started 2026-10-19, `node node_modules/@playwright/test/cli.js test-server ...` — a Playwright test-server, not a CONF process.

No stale CONF-01 or CONF-02 processes were found (the two CONF-01 fixture-server pids
previously reported, 47744 and 62932, are no longer present).

## 6. What was not measured (owed to a future run)

F16–F20 (no probe implemented, as the table requires today); F21 (service-worker scope,
not queryable); FW-1's actual WebSocket behaviour (decision-only, as required); any browser
other than the pinned Chromium; Linux or the GitHub-hosted runner. FC12/IC9 (proxy
battery) are explicitly out of this agent's scope (Node-side, CONF-03A).

## 7. Raw evidence

`conf03/browser-results-node22.json`, `conf03/browser-results-node24.json` (full per-row,
per-repetition records), `conf03/smoke.json` (pre-fix, shows the FC1 defect),
`conf03/smoke2.json` (post-fix verification), `conf03/browser-harness.js`,
`conf03/browser-wrapper.sh`, `conf03/decide28.js` (verbatim). Stderr logs for both full runs
are empty (no fatal errors).
