# Phase 18 SPIKE-W findings — dedicated/shared worker interception

Owner-authorized read-only experiment. Base revision: `f9ca928` on
`docs/phase-18-architecture`. No product code was changed.

## Environment

| Item | Value |
|---|---|
| OS | macOS 26.5.1 (Darwin 25.5.0), darwin arm64 |
| Node | v22.19.0 |
| npm | 10.9.3 |
| Playwright (`playwright`/`@playwright/test`) | 1.64.0 (package.json pin `^1.64.0`) |
| Chromium | 156.0.8078.4 (via `browser.version()`) |
| Fixture | hermetic loopback-only HTTP server, two ports, no external network |

Scratch evidence (raw, not committed): fixture + runner + results live in the
scratch dir referenced in the task packet (`spike-w/fixture-server.js`,
`spike-w/run-spike-w.js`, `spike-w/results.json`, `spike-w/run-output.log`,
`spike-w/run-output2.log`).

Commands run:
```
node -e "require('playwright').chromium.launch()...browser.version()"   # 156.0.8078.4
NODE_PATH=<repo>/node_modules node run-spike-w.js   # run 1 (initial), run 2 (added routesSeen probe for blob case)
```

## Per-case results

All cases ran against a `page.route('**/denied-sink', ...)` /
`**/denied-worker-script.js` handler armed on the `BrowserContext`, with
`serviceWorkers: 'block'` and a preventive `context.addInitScript(...)`
installed, matching the rev 3/rev 4 design. 3 repetitions for every decisive
case; fewer reps for exploratory/control cases, noted below. All reps were
consistent run-to-run (no flake observed).

| Case | Reps | Result vs design assumption | Fixture mutation counter |
|---|---|---|---|
| `neg-control-no-route` (no handler armed) | 1 | Fetch succeeds, 200 — confirms fixture is valid and the block in other cases is caused by the route, not the fixture | 1 (expected) |
| `pos-worker-fetch-post-routed` — dedicated Worker `fetch(POST)` | 3 | **PASS.** `route` fires, `route.abort()` blocks it, worker observes `Failed to fetch` | 0 |
| `pos-worker-script-load-routed` — Worker script load from denied route | 3 | **PASS.** `route` fires for the worker's own script fetch, abort blocks the load, `worker.onerror` fires | scriptLoadHits 0 |
| `pos-worker-fetch-route-continue` — same as above but `route.continue()` | 3 | **PASS (sanity).** Request passes through normally (200), proving the route handler genuinely intercepts worker traffic rather than coincidentally matching page traffic | 1 |
| `pos-worker-xhr-post-routed` — sync XHR POST inside worker | 3 | **PASS.** Intercepted/blocked the same way as `fetch` | 0 |
| `pos-worker-importscripts-routed` — `importScripts()` to denied route | 3 | **PASS.** `route` sees the request, load is blocked, `importScripts` throws | scriptLoadHits 0 |
| `pos-nested-worker-routed` — worker spawns a child worker that fetches | 3 | **PASS.** Child worker's fetch is also intercepted/blocked; 2 `worker` events fire (parent + child) | 0 |
| `pos-blob-worker-routed` — Worker from `URL.createObjectURL(Blob)` | 3 | **PASS.** Route fires once per rep (`routesSeen:1`), fetch blocked | 0 |
| `pos-data-worker-routed` — Worker from `data:` URL | 3 | **PASS (by pattern).** Same `Failed to fetch` outcome and 0 mutation as the proven `blob`/`fetch-post` cases; `routesSeen` was not separately instrumented for this case, so this is corroborated by consistency, not a direct route-hit count — see OPEN RISK below | 0 |
| `pos-module-worker-routed` — Worker with `{type:'module'}` | 3 | **PASS (by pattern), same caveat as above** | 0 |
| `pos-sharedworker-fetch-routed` — `SharedWorker` fetch | 3 | **FAIL — contradicts rev 3's explicit claim "`SharedWorker` is treated as a dedicated worker by the same handler."** The route never fired; fetch succeeded (200); mutation counter incremented to 1 every rep. `page.on('worker')` also never fired for the SharedWorker (`workerEventCount: 0`) | **1 (leak)** |
| `pos-worker-beacon-routed` — `navigator.sendBeacon` inside worker | 3 | **N/A — API absent.** `sendBeacon` is not exposed on `navigator` inside a dedicated worker on this Chromium (`sendBeacon is not a function`), so this exfiltration channel does not exist here regardless of Playwright | 0 |
| `pos-worker-eventsource-routed` — `EventSource` (GET) inside worker | 1 | **PASS.** Request matched the same route glob and was aborted; worker got `eventsource-error` | 0 |
| `pos-worker-event-fires` — `page.on('worker')` | 3 | **PASS.** Fires once per dedicated worker created, with the worker's URL; event does not expose a `frame()`-equivalent itself, but the associated network `request.frame()` call (below) did not throw | n/a |
| `request.frame()` on a worker-initiated request | 3 (embedded in case 1) | **Did not throw; returned a frame object** (`frame-present`). We did not independently verify the returned frame is the *correct* owning frame vs. an incidental top frame — see OPEN RISK | n/a |
| `pos-addinitscript-reaches-worker` — preventive `addInitScript` marker visible inside worker global scope | 1 | **FAIL as a worker control.** `context.addInitScript()` sets the marker on the page (`window.__FALCON_MARK__ === true`), but the dedicated worker's `self.__FALCON_MARK__` is **absent**. The preventive init script does not execute in worker global scope at all on this Playwright/Chromium pairing | n/a |
| `pos-cross-origin-worker-routed` — Worker script loaded from a different origin (port) | 3 | **Browser-level same-origin restriction, not a Playwright behaviour.** `new Worker(crossOriginUrl)` throws synchronously (`SecurityError`/`cannot be accessed from origin`) before any network/route layer is reached | n/a |
| `neg-worker-created-before-handlers-armed` — worker created, then route armed afterward | 3 | **PASS.** A route added after worker creation still intercepts the worker's *subsequent* request (`lateRouteSeen: true`, mutation 0). Route scope is evaluated per-request, not per-worker-lifetime | 0 |

## OBSERVED FACT

1. On Playwright 1.64.0 / Chromium 156.0.8078.4, `BrowserContext.route()` **does** observe and can abort requests initiated from inside a dedicated `Worker` — covering `fetch`, sync `XHR`, `importScripts`, the worker's own script load, `EventSource`, nested (worker-in-worker) fetches, and workers constructed from `blob:` URLs, `data:` URLs, and `{type:'module'}`.
2. `BrowserContext.route()` does **not** observe requests initiated from inside a `SharedWorker` in this configuration: the fetch reached the fixture server and mutated it every repetition, with no route callback invoked and no `page.on('worker')` event.
3. `context.addInitScript()` does not execute inside a dedicated worker's global scope; the marker is visible on `window` but absent on `self` inside the worker.
4. `navigator.sendBeacon` does not exist inside a dedicated worker's global scope on this Chromium build.
5. Constructing a `Worker` with a cross-origin script URL throws synchronously in the page (browser same-origin policy), before Playwright's network layer is involved; this is independent of Playwright.
6. `request.frame()` on a worker-initiated request does not throw and returns a non-null value; we did not further validate its identity.
7. Route handlers armed after a worker is created still apply to that worker's subsequent requests (no "arming window" gap tied to worker creation time).
8. No flakiness: 3/3 repetitions were identical for every decisive case across two independent runs of the whole suite.

## INFERENCE

- The rev 3 design text's SharedWorker claim ("SharedWorker is treated as a dedicated worker by the same handler") is incorrect for the pinned Playwright/Chromium pair; it is not a close call, the fetch unconditionally reached the loopback fixture in all 3 reps.
- Because `addInitScript` does not reach worker scope, the rev 4 description of it as a defense-in-depth layer for workers has no practical effect inside the worker itself; whatever protection exists for dedicated-worker traffic comes entirely from the `route`/`routeWebSocket` network layer, not from the init script.
- Dedicated-worker network interception (fetch/XHR/importScripts/EventSource/nested/blob/data/module workers) is consistently positive, so SPIKE-W's "mandated fallback" (refuse the run via `page.on('worker')`) is **not required for dedicated workers** on this pinned version — but see the blocker below for SharedWorker.
- `sendBeacon` being unavailable in workers removes one of the N-3 exfiltration channels named in the spec, at least for this Chromium build; this should not be treated as a durable guarantee across Chromium versions.

## RECOMMENDATION (for the architect/owner, not self-approved here)

- Section 7a / the rev 3 SPIKE-W text must be corrected: strike "`SharedWorker` is treated as a dedicated worker by the same handler" — it is false on the pinned version. Either (a) extend the mandated fallback (`page.on('worker')` refusal) to also fire for `SharedWorker` creation (note: `page.on('worker')` itself did not fire for SharedWorker either in this spike, so the existing fallback mechanism cannot rely on that event — a different detection path, e.g. CDP `Target.attachedToTarget` or disabling SharedWorker via a Chromium launch/context flag, would need its own verification), or (b) refuse any run that creates a `SharedWorker` in execute mode until a verified interception/refusal path exists.
- The rev 4 "preventive `addInitScript`... defense in depth" framing for workers should be corrected to state plainly that the init script does not execute in worker scope and provides no in-worker defense; it only affects the page/frame.
- Document the `sendBeacon`-unavailable-in-workers and cross-origin-worker-constructor-throws facts in `docs/pilot/limitations.md` as Chromium-version-dependent observations, not as Falcon controls.
- `request.frame()` identity on worker-initiated requests needs a second, more targeted spike before any code relies on frame-scoping worker requests (e.g. to a specific pilot tab) — current evidence only shows it doesn't throw.

## Risk classification

- **BLOCKER**: the SharedWorker claim in rev 3/section 7a is empirically false; any implementation that relied on "the same handler" covering SharedWorker would silently allow an uncontained POST egress channel. This must be fixed in the design before 18C merges, consistent with the existing "18C may not merge without the recorded results of SPIKE-W" gate.
- **MAJOR**: the `addInitScript` defense-in-depth claim for workers is unsupported; downgrade it in the design text so nothing downstream assumes in-worker init-script protection exists.
- **MINOR**: `data:`/`module` worker cases were only corroborated by outcome pattern, not an independent route-hit counter; a follow-up instrumentation pass would close this gap cheaply.
- **RESIDUAL**: `sendBeacon` absence and cross-origin Worker-constructor throw are environment-dependent facts, useful as current evidence but not guaranteed across Chromium versions; re-verify on Chromium upgrades.

## What was not covered / limitations

- Only one WebSocket sub-case (`routeWebSocket`) was not separately exercised: the fixture does not implement a real WS upgrade handshake, so worker-initiated `WebSocket` traffic (`ws`) was dropped from the executed matrix rather than measured with a stub that could produce a misleading pass. This is an honest gap, not a converted-to-permissive result — it should be run as a fast follow using Playwright's `routeWebSocket` with a reflecting WS endpoint in the fixture.
- Service worker behavior (`serviceWorkers: 'block'`) was configured but no explicit service-worker registration/attempt was exercised in this run; it is out of SPIKE-W's stated scope (dedicated/shared workers), not re-verified here.
