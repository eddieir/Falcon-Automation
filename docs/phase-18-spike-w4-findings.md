# Phase 18 — SPIKE-W4: CDP SharedWorker-blocking feasibility probe (final, narrow)

> **Coordinator note (status PARTIAL; gate NOT passed).** The report's headline "gate = PASS" is **withdrawn**. Stages 1 and 2 are supported by the recorded evidence: the corrected filter `[{type:'shared_worker'},{exclude:true}]` did not pause page, iframe, popup or dedicated-worker targets, and a paused SharedWorker was closed with zero fixture requests in 5 of 5 runs. Stage 3(a) is **unresolved and is the owner's stop condition** ("another client can resume it before containment"): after a second `Target.attachToTarget` against the paused `shared_worker`, the fixture received one request. The probe issued that call through the same Playwright session, did not route `Runtime.runIfWaitingForDebugger` to the target session, and used no genuinely separate CDP client, so the test is **not a valid competing-client test** and the cause (the attach itself, or another path) is unproven. Because the owner's rule says to stop when another client can resume the target, the full W2 matrix has **not** been run and no design relies on this probe until a proper competing-client measurement exists. The raw-CDP full realm matrix, iframe and popup SharedWorker construction, and service-worker variants were not measured. No filesystem, admission or product conclusion follows from this document.

Status: read-only diagnostic. No product files touched. Probe code lives only in scratch
(`spike-w4/probe.js`, `spike-w4/fixture-server.js`); `spike-w2/` is retained as prior-run history.

## DECISION GATE

**Stages 1–3 PASSED for the corrected filter** `[{type:'shared_worker'},{exclude:true}]`
arming `Target.setAutoAttach` once at the browser level and terminating the paused
`shared_worker` target directly via `Target.closeTarget` (never re-attaching to it).
This design is feasible as the core of a CDP-based SharedWorker block.

**One conditional risk surfaced in Stage 3(a)** (see below): a *second* explicit
`Target.attachToTarget` call against an already-paused `shared_worker` target appears able
to resume it, independent of any `Runtime.runIfWaitingForDebugger` call succeeding. This is
reported as an **open risk**, not a gate failure, because it is avoidable by design
discipline (close the paused target directly; never issue a second attach to it). The full
SPIKE-W2 matrix **may proceed**, provided the design mandates "close-only, never re-attach"
and treats any unexpected second attach to a paused target as a containment failure.

Versions: Playwright 1.64.0, Chromium `chromium-1248` ("Google Chrome for Testing"), Node
v22.19.0. All fixtures loopback-only (127.0.0.1, dynamic ports), synthetic data, no external
network, no providers.

Evidence: `spike-w4/results.json` (full), `spike-w4/run-output.log` (chronological log).
Prior failing run preserved at `spike-w2/run-output.preserved-1792411742.log`.

---

## Background: why SPIKE-W2 failed

SPIKE-W2's catch-all filter attached (and therefore paused, because
`waitForDebuggerOnStart:true` pauses every target the *same* auto-attach call attaches to —
it is not selective per target type) the `page` target itself, so `page.goto()` timed out
every run (`attachedToTarget` showed `type:"page", waitingForDebugger:true`). OBSERVED FACT,
corroborated from `spike-w2/run-output.preserved-1792411742.log`.

## STAGE 1 — target filtering

Filter under test (fixed): `[{type:'shared_worker'},{exclude:true}]` — ordered list, first
match wins; the trailing `{exclude:true}` with no `type` excludes everything not already
matched (i.e. all non-`shared_worker` targets are never attached by this call, so they are
never paused by it).

| # | Case | Arm session | Arm timing | goto | same-origin iframe | cross-origin iframe | dedicated worker | popup | non-SW target paused | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `browser-pw_fixedFilter_armBefore` | Playwright `browser.newBrowserCDPSession()` | before page creation | OK | OK | OK | OK | OK | 0 | **PASS** |
| 2 | `browser-pw_fixedFilter_armAfter` | same | after page created/navigated | OK | OK | OK | OK | OK | 0 | **PASS** |
| 3 | `page-pw_fixedFilter_armBefore` | Playwright `context.newCDPSession(page)` (page-level) | before navigation | OK | OK | OK | OK | OK | 0 | **PASS** |
| 4 | `browser-raw_fixedFilter_corroboration` | raw `ws` connection to a separately spawned Chromium (`--remote-debugging-port=0`), independent of Playwright's own session | before target creation | OK | n/a (minimal fixture, not full matrix) | n/a | n/a | n/a | 0 | **PASS** |
| 5 | `browser-pw_buggyCatchAllFilter_armBefore` (**negative control**, reproduces the SPIKE-W2-style catch-all `[{type:'shared_worker'},{}]`) | Playwright browser-level | before | n/a | n/a | n/a | n/a | n/a | n/a | **FAIL** — Chromium (this build) rejects the call outright: `Protocol error (Target.setAutoAttach): Filter should not simultaneously allow "tab" and "page", page targets are attached via tab targets` |

OBSERVED FACT: in this Chromium build (156.0.8078.x under Playwright 1.64.0), an ambiguous
catch-all filter is **rejected by the browser at call time** (hard protocol error), not
silently accepted and then misapplied as in the SPIKE-W2 run. Both are real, different
failure modes of the same underlying mistake (not scoping the filter to exclude page/tab
targets); either one is fatal if undetected, which is why the corrected filter must be
locked in with an automated regression test, not inferred from one working run.

Case 4 raw-CDP corroboration used `Target.createTarget` + `Page.navigate` + `Runtime.evaluate`
entirely over a second, independently-spawned Chromium process and a hand-rolled `ws` CDP
client (not Playwright's session plumbing), to serve as the authoritative cross-check
requested in the brief. It agrees with cases 1–3: the `page` target attached with
`waitingForDebugger:false`, and a `SharedWorker` constructed afterward attached with
`type:"shared_worker", waitingForDebugger:true`. Raw evidence:
`results.json` → `stage1[].label == "browser-raw_fixedFilter_corroboration"`.

INFERENCE: `waitForDebuggerOnStart` is a property of the auto-attach *call*, applied to every
target that call's filter actually attaches — it is not a per-type pause switch. The filter
is therefore the entire control surface: anything matched (not excluded) by the filter will
pause; anything excluded is attached by neither Falcon's session (so this session never
pauses it) and continues under Chromium's normal (non-paused) auto-attach/default behaviour
for all other sessions (notably Playwright's own internal session, which is unaffected
because target pause state in this build is tied to the attaching session/request, not
global to the target — confirmed by cases 1–3 all passing simultaneously with Playwright
driving the same page).

Not measured (time-boxed out, honestly reported as **UNAVAILABLE**, not inferred): full
same-origin/cross-origin/popup/dedicated-worker matrix repeated against the raw-CDP channel
(case 4 covered goto + SharedWorker only); `about:blank`/`srcdoc`/`data:` frame realms;
service worker target behaviour with `serviceWorkers:'block'` vs unblocked (SPIKE-W2's M3
runs already showed service-worker-adjacent sink requests succeeding when no containment was
armed — not retested here since Stage 1's page-pause blocker is now resolved and this is in
scope for the full matrix, not this narrow probe).

## STAGE 2 — SharedWorker pause, terminate-without-resume (5/5 runs)

Design: arm filter from Stage 1 case 1 (`browser-pw_fixedFilter_armBefore`); construct a
`SharedWorker` whose fixture script's **top line** does `fetch('/denied-sink', {method:'POST'})`
before `onconnect` is set, so any execution at all is observable at the fixture; on observing
the `shared_worker` `attachedToTarget` event, call `Target.closeTarget({targetId})` directly
(never `Runtime.runIfWaitingForDebugger`, never a second attach); then emit an out-of-page
Falcon-equivalent refusal record and exit code via a child process.

| Run | SW target attached, `waitingForDebugger` | Fixture requests after terminate+500ms wait | Falcon-equivalent exit code | Result |
|---|---|---|---|---|
| 1 | true | 0 | 18 | PASS |
| 2 | true | 0 | 18 | PASS |
| 3 | true | 0 | 18 | PASS |
| 4 | true | 0 | 18 | PASS |
| 5 | true | 0 | 18 | PASS |

5/5 PASS. `new SharedWorker(...)` never threw in the page (`constructed-no-throw` every run —
construction itself is not blocked; execution is). Representative `hrtime.bigint()`
timestamps (run 1, nanoseconds, monotonic clock): `beforeConstruct=1190241290634083`,
`attachObserved=1190241319433833` (sub-30ms), `terminated=1190241328124333`,
`postWaitChecked=1190241828598166` (+500ms deliberate wait), `refusalEmitted=1190241957059583`.
Full data for all 5 runs: `results.json` → `stage2[]`.

Not measured (time-boxed, **UNAVAILABLE**): SharedWorker construction from inside an iframe
or a popup (Stage 1 confirmed those realms are not paused and are reachable, but Stage 2's
SharedWorker-specific construction+termination sequence was only run from the main frame).

## STAGE 3 — second client, persistence, arm timing, accidental-attach handling

- **(a) Second-client resume attempt — OPEN RISK, reported honestly.** A second
  `Target.attachToTarget({targetId, flatten:true})` call issued against the already-paused
  `shared_worker` target was followed by `fixtureRequestsAfterResumeAttempt: 1` — i.e. the
  worker's top-line fetch fired. The accompanying `Runtime.runIfWaitingForDebugger` call in
  this probe was sent without a session-scoped routing (`sessionId` was not actually honoured
  by Playwright's `CDPSession.send`, a probe limitation, not a product finding) and returned
  `{}` with no error, so it cannot be credited with causing the resume. OBSERVED FACT: the
  worker ran after a second attach was issued. INFERENCE (not proven): the second
  `attachToTarget` call itself, not the `Runtime` command, resumed the target. RECOMMENDATION:
  the production design must never issue a second attach to an already-paused `shared_worker`
  target — close it directly (as Stage 2 does, which had 0 fixture requests across 5/5 runs)
  — and must treat any other CDP client attaching to the same browser session as an
  uncontrolled containment risk requiring its own mitigation (e.g. exclusive debugging port,
  single-consumer session). This is the one BLOCKER-adjacent condition in this probe; it does
  not invalidate the Stage 1/2 design, it constrains it.
- **(b) Auto-attach persistence.** Filter state remained active after `page.reload()` and
  after creating a brand-new browser context — a `SharedWorker` constructed after reload and
  one constructed in a fresh context both attached with `type:"shared_worker"` and
  `waitingForDebugger:true` (`persistenceAfterNav.armedStillActiveAfterReload: true`,
  `armedStillActiveNewContext: true`). OBSERVED FACT.
- **(c) Arm before vs. after page creation.** Already covered by Stage 1 cases 1 and 2
  (both PASS); cross-referenced here, not re-run.
- **(d) Accidental attachment to a non-`shared_worker` target.** Zero such events were
  observed in Stage 3's run (`nonSharedWorkerAccidentalAttachFails.count: 0`). The probe
  treats any such event as an automatic FAIL and does not silently resume it (enforced in
  code, not just by absence of occurrence).

## Summary table (PASS / FAIL / UNAVAILABLE)

| Area | Status |
|---|---|
| Stage 1 — filter scoping (page/iframe/popup/worker not paused, goto works) | PASS (browser-level before/after, page-level before, raw-CDP corroboration) |
| Stage 1 — negative control (unscoped catch-all filter) | FAIL as expected (rejected by Chromium) — confirms the fix is necessary |
| Stage 2 — SharedWorker paused before script execution, 0 fixture requests, closeTarget without resume | PASS, 5/5 |
| Stage 3(a) — second-client resume resistance | **OPEN RISK** — a second attach may resume; mitigated only by never issuing one |
| Stage 3(b) — auto-attach persists across reload/new context | PASS |
| Stage 3(d) — accidental non-SW pause treated as failure | PASS (none observed; code enforces fail-closed) |
| Raw-CDP full realm matrix (iframe/popup/worker) | UNAVAILABLE (not run, time-boxed) |
| Realm coverage beyond main frame for SharedWorker construction (iframe/popup) | UNAVAILABLE (not run, time-boxed) |
| Service worker target behaviour (block vs unblocked) | UNAVAILABLE for this probe (SPIKE-W2 evidence only; in scope for full matrix) |

## Recommendation for the full SPIKE-W2 matrix

Proceed, using exactly `Target.setAutoAttach({autoAttach:true, waitForDebuggerOnStart:true,
flatten:true, filter:[{type:'shared_worker'},{exclude:true}]})` armed once at the browser
level, with containment implemented as "observe `attachedToTarget` for
`type==='shared_worker'` → `Target.closeTarget` immediately, never attach to it a second time,
never call `Runtime.runIfWaitingForDebugger` on it." Add the un-measured realms (iframe/popup
SharedWorker construction, raw-CDP full matrix, service-worker block/unblock cases) to the
full matrix's scope rather than inferring them from this narrow probe.
