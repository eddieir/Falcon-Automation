# Phase 18 — SPIKE-W2 findings (SPIKEW-03, replanned narrow task)

> **Coordinator note (status PARTIAL; read before the rest).**
> 1. This document is a partial, harness-level negative result. The root cause of the paused page target was **not isolated** (the harness's own CDP session routing is a plausible cause), so the "BLOCKER" statements below describe this harness, not a proven property of the CDP design. The owner has ordered a separate staged feasibility probe (SPIKEW-04) to decide feasibility; no design conclusion is drawn from this document.
> 2. Wherever this document says the run was killed by `SIGKILL` / exit 137 and attributes it to resource exhaustion, that attribution is **withdrawn**: the coordinator terminated the stalled harness process (`kill`, then `SIGKILL`) after it produced no further output for about two minutes after the M3 cases. The log was preserved as `run-output.preserved-*.log` in scratch. There is no evidence of OS resource pressure. M4 and M5 were therefore not executed for a harness-stall reason that is itself undiagnosed.
> 3. The M3 stub-injection mechanism did not engage (the document already flags this as a harness defect); its results support no design statement.

**BLOCKER (stated up front, per task instructions):** CDP cannot reliably pause the
SharedWorker target before egress in this harness. Browser-level
`Target.setAutoAttach` with `waitForDebuggerOnStart: true` paused the **page
target itself** (not just the shared_worker target) in every run of both
mitigations tried, causing `page.goto` to hang until Playwright's 30s (M1
original run) / 8s (this run) timeout. A SharedWorker-scoped wait-for-debugger
auto-attach, as drafted, is not usable as-is and must not be treated as a
working containment control for rev 23 B.x statements without further design
work outside this spike's budget.

## Scope and environment

- Task: SPIKEW-03, read-only owner-authorized experiment, no product changes.
- Base revision: `1946785` on `docs/phase-18-architecture`.
- Playwright `1.64.0`, bundled Chromium, launched from repo `node_modules`.
- Node `v22.19.0` (darwin-arm64). The pinned Node 24.21.0 build under the
  scratch `node24/` directory was **not** exercised — budget was exhausted by
  the Node 22 runs and the M1/M2 diagnosis; this is an explicit gap, not a
  negative result for Node 24.
- Fixture: loopback-only `http.createServer` (`fixture-server.js`), synthetic
  shared-worker script served from `/shared-worker-script.js`, egress sink at
  `/denied-sink`. No external network, no providers.
- Harness: `run-spike-w2.js` (scratch), edited this session to (a) fix the
  prior M1 hang by adding a bounded `page.goto` timeout instead of letting the
  default 30s timeout abort the whole run, (b) try two mitigations for the
  page-pausing bug, (c) wrap each stage in `try/catch` so one failing case
  does not abort the rest, (d) raise M1/M2/M4/M5 to 3 runs each for repeat
  evidence per the task's "decisive cases ≥3 runs" instruction.
- Run log: scratch `run-output.log` (16 lines of `[RESULT]`/`[HARNESS]`
  entries plus two `playwright version:`/`node version:` lines). Process was
  killed with `SIGKILL` (exit 137, background-task wrapper reported `EXIT:137`)
  partway through, before M4 and M5 executed — most likely OS-level resource
  pressure from the accumulated sequential Chromium launches (9 full
  launch/close cycles completed before the kill); this was not diagnosed
  further given the remaining turn budget.

## Prior state carried in from SPIKEW-02

`run-output.log` originally contained only:

```
playwright version: 1.64.0
node version: v22.19.0
FATAL page.goto: Timeout 30000ms exceeded.
```

from the single, unmodified M1 run. That hypothesis (a browser-wide
`waitForDebuggerOnStart` pauses every new target, including the page) is
**OBSERVED FACT, now directly confirmed** by this session's instrumented runs
below, not merely inferred.

## M1 — CDP only, stub off (two mitigations tried, 3 runs each)

Strategy `filterCatchAll`: `targetFilter: [{type:'shared_worker',
exclude:false}, {exclude:true}]` — intent: only auto-attach (and therefore
only pause) `shared_worker` targets; everything else should fall through to
the catch-all `exclude:true` entry and never be attached by Falcon's session
at all.

Strategy `resumeOthers`: original include-only filter
(`[{type:'shared_worker', exclude:false}]`), plus an `attachedToTarget`
handler that calls `Runtime.runIfWaitingForDebugger` on any non-shared_worker
session that reports `waitingForDebugger: true`.

| Mode | Run | Result | Attached target type seen | waitingForDebugger | Outcome |
|---|---|---|---|---|---|
| M1 filterCatchAll | 1 | FAIL | `page` | true | `page.goto` timeout (8000ms) |
| M1 filterCatchAll | 2 | FAIL | `page` | true | `page.goto` timeout (8000ms) |
| M1 filterCatchAll | 3 | FAIL | `page` | true | `page.goto` timeout (8000ms) |
| M1 resumeOthers | 1 | FAIL | `page` | true | `page.goto` timeout (8000ms) |
| M1 resumeOthers | 2 | FAIL | `page` | true | `page.goto` timeout (8000ms) |
| M1 resumeOthers | 3 | FAIL | `page` | true | `page.goto` timeout (8000ms) |

6/6 runs across two independent mitigations FAIL identically. `requestsAtFixture`
was `[]` in all six runs (the page never loaded, so the shared worker was
never constructed; zero egress is expected and uninformative here — it is not
evidence of successful containment, only evidence the navigation itself never
completed).

- OBSERVED FACT: in `filterCatchAll`, the `attachedToTarget` event for the
  `page` target still arrived on Falcon's own `browserCdp` session even though
  the filter's only matching rule for a non-`shared_worker` type is an
  `exclude: true` catch-all. The filter did not prevent Falcon's session from
  auto-attaching to (and thereby pausing) the page target.
- OBSERVED FACT: in `resumeOthers`, the handler's
  `Runtime.runIfWaitingForDebugger` call (sent via
  `browserCdp.send('Runtime.runIfWaitingForDebugger', {}, params.sessionId)`)
  did not unblock the page. No `HARNESS` error was recorded for these runs, so
  the call did not throw; it simply did not resume the target.
- INFERENCE: Playwright's public `CDPSession.send(method, params)` API (used
  here) does not accept a `sessionId` as a third positional argument to route
  a command to a *different*, flattened child session; the extra argument is
  most likely ignored, so `resumeOthers`'s resume call was effectively sent on
  Falcon's own top-level browser session rather than on the paused page's
  session, and had no effect. This is a credible, UNVERIFIED (not traced into
  playwright-core's transport code within budget) explanation for why
  `resumeOthers` failed identically to `filterCatchAll`. It does not by itself
  explain why `filterCatchAll`'s targetFilter failed to exclude the page
  target in the first place — that remains unexplained within this spike's
  budget.
- INFERENCE: the `filterCatchAll` failure is the more fundamental one: even
  granting that `resumeOthers`'s resume command was mis-routed, the filter
  approach should not have attached to the page target in the first place,
  independent of any resume logic. Something about Playwright's own internal
  CDP usage (Playwright attaches its own session to drive the page) and
  Falcon's sibling browser-level session appear to interact such that a
  `waitForDebuggerOnStart: true` request from the Falcon session pauses the
  page regardless of Falcon's own filter. This was not root-caused at the
  Chromium-protocol level within the available turns.
- RECOMMENDATION: do not adopt a browser-level
  `Target.setAutoAttach({waitForDebuggerOnStart: true, targetFilter: [...]})`
  design for shared-worker containment until a mitigation is demonstrated to
  work in this harness. Candidate follow-ups (untested): (a) issue
  `Target.setAutoAttach` on a **page-scoped** CDP session
  (`context.newCDPSession(page)`) instead of the browser-level session, so
  Playwright's own page-driving session is not sharing fate with Falcon's
  auto-attach request; (b) use `Target.setDiscoverTargets` plus manual
  `Target.attachToTarget` only for targets already confirmed to be type
  `shared_worker` (reactive attach after discovery, not auto-attach before
  creation) at the cost of a race window; (c) directly trace
  playwright-core's `CRConnection`/`CDPSession` source to find the correct
  flattened-session routing API instead of guessing the `send(method, params,
  sessionId)` signature.

## M2 — both enabled (stub + CDP), 3 runs

Same browser-level auto-attach bug applies: all 3 runs hit `page.goto`
timeout (8000ms) before the stub or the CDP layer could be exercised.
`constructError: null` in all 3 (never reached — the page never loaded) and
`requestsAtFixture: []` in all 3. The `targetFilter` catch-all fix was applied
here too (`[{type:'shared_worker', exclude:false}, {exclude:true}]`) and
failed identically to M1's `filterCatchAll`, reinforcing that this is one
underlying bug, not case-specific.

| Mode | Run | Result | Outcome |
|---|---|---|---|
| M2 | 1 | FAIL | `page.goto` timeout (8000ms) |
| M2 | 2 | FAIL | `page.goto` timeout (8000ms) |
| M2 | 3 | FAIL | `page.goto` timeout (8000ms) |

M2's stub-vs-CDP interaction question ("does the throw silently block target
creation before CDP ever sees it?") is **UNAVAILABLE** — not measured, because
the page never loaded in any run.

## M3 — stub + CDP-installed `Runtime.addBinding` signal (1 run per case; not repeated 3x, budget)

| Case | Result | Outcome | Egress to `/denied-sink` |
|---|---|---|---|
| mainFrame | FAIL (stub not active) | `constructed-no-throw` | 1 POST recorded |
| deleteGlobal | UNCLEAR | `deleteResult-typeofAfter:undefined` | none |
| tryCatchSuppress | FAIL (stub not active) | `suppressed-ok` | 1 POST recorded |
| aboutBlankIframe | HARNESS ERROR | `page.waitForTimeout: Target page, context or browser has been closed` | not measured |
| popup | FAIL (stub not active) | `constructed-in-popup` | 1 POST recorded |

- OBSERVED FACT: `bindingCalls` was empty (`[]`) in every M3 case. Falcon's
  `__falconNotify` binding was never invoked, consistent with the stub itself
  never taking effect.
- OBSERVED FACT: in `mainFrame`, `tryCatchSuppress`, and `popup`, `new
  SharedWorker(...)` succeeded and the worker's `fetch()` reached the fixture
  (`/denied-sink` POST recorded), i.e. the throwing stub installed via
  `Page.addScriptToEvaluateOnNewDocument` + `Runtime.addBinding` on a
  `context.newCDPSession(page)` had no effect on the real navigated page.
- INFERENCE: this is a harness defect, not a tested security property of the
  design. The `mainFrame` case alone is enough to show the stub mechanism
  used in this script did not attach to the real page (if it had, `mainFrame`
  would show `threw:...`, not `constructed-no-throw`). Candidate causes
  (untested): `runImmediately: true` may not be a real/accepted parameter on
  `Page.addScriptToEvaluateOnNewDocument` in this CDP version (silently
  ignored rather than erroring); or the CDP session built from
  `context.newCDPSession(await context.newPage())` may not be the same
  session/target Playwright's `context.pages()[0]` subsequently navigates.
  This was not root-caused within the remaining turn budget.
- `deleteGlobal`'s result (`typeof` is `undefined` after `delete`) is also
  consistent with the stub never having been installed in the first place
  (there would be nothing to delete), not with `configurable:false`
  successfully resisting deletion. So this case is **UNCLEAR** rather than a
  positive attack-resistance result.
- `aboutBlankIframe` crashed the harness (`Target page, context or browser has
  been closed`) before producing a usable result — **UNAVAILABLE**. Not
  retried within budget.
- Attack variants listed in the task (nested depth 2, `data:`/`srcdoc`
  iframe, removed-and-reinserted iframe, `defineProperty` shadowing, aliased
  constructor, `document.write`, `javascript:` URL) were **not implemented**
  in the existing harness and were **not added** this session — out of
  budget. This is an explicit gap.
- RECOMMENDATION: M3's results cannot be used to support or contradict any
  rev 23 B.x statement about stub robustness against the listed attacks,
  because the stub-injection mechanism itself is not confirmed working. Fix
  the injection mechanism first (verify with a trivial case that `mainFrame`
  throws as expected) before drawing any conclusion from the attack-variant
  cases.

## M4 — competing CDP client resuming a paused target

**UNAVAILABLE.** The harness process was killed (`SIGKILL`, exit 137) before
reaching M4, after completing M1 (6 runs), M2 (3 runs), and M3 (5 cases). Not
re-run within budget. The M4 code path itself was edited this session (bounded
`page.goto` timeout, error capture) but never executed, so even the edited
code is unverified.

## M5 — inversion (both controls off)

**UNAVAILABLE.** Not reached for the same reason as M4. In the prior
(unedited) harness state, M5's logic is unchanged from the original script
and was never exercised either in SPIKEW-02 or this session.

## Rev 23 B.x statement impact

- Any B.x statement that currently treats "browser-level
  `Target.setAutoAttach` with `waitForDebuggerOnStart: true` scoped via
  `targetFilter` to `shared_worker`" as a working or sufficient containment
  mechanism is **CONTRADICTED** by the M1/M2 evidence above (6 + 3 = 9/9
  runs FAIL identically across two independent mitigation attempts).
- Any B.x statement relying on M3's attack-variant results (defineProperty
  shadowing resistance, iframe/popup containment, etc.) as evidence of stub
  robustness is **UNSUPPORTED** — the stub-injection mechanism used to
  produce those results was not confirmed functional, and the one directly
  checkable case (`mainFrame`) shows it did not take effect.
- No B.x statement can currently be marked SUPPORTED by M4 or M5 evidence;
  both are UNAVAILABLE this session.

## What remains (explicit PARTIAL scope)

1. Root-cause why `targetFilter` with an explicit catch-all `exclude: true`
   entry still allows the `page` target to attach and pause on Falcon's
   browser-level session (Chromium protocol internals, or Playwright/Chromium
   version-specific behavior).
2. Find and use the correct Playwright API to send a CDP command on a specific
   flattened child session (not a guessed 3-arg `send()` call), or move to a
   page-scoped CDP session for the auto-attach call entirely, then re-run M1.
3. Fix the M3 stub-injection mechanism (verify `mainFrame` throws) before any
   attack-variant conclusions are drawn; add the untested attack variants
   listed in the task.
4. Run M4 and M5 at least 3 times each once M1 is unblocked.
5. Repeat the decisive modes once under the pinned Node 24.21.0 build in the
   scratch `node24/` directory, per the task's "if budget allows" instruction
   — not attempted this session.
6. Diagnose the `SIGKILL`/exit-137 resource exhaustion so future spike runs
   don't lose partial results mid-run.

None of the above was completed in this session; they are carried forward as
open items, not silently dropped.
