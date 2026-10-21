**Status: MEASURED, PARTIAL as an agent task (written by the measuring agent; published unedited below this banner). Coordinator reading: the CSP-through-`context.route` mechanism ESCAPES and is a BLOCKER for that mechanism; worker WebSocket traffic therefore stays NOT CONTAINED and the fail-closed refusal (`worker_websocket_containment_unverified`) stays in force. No claim is weakened.** Corrections and limits the coordinator adds: (1) the agent's explanation that `context.route('**/*')` "appears to interfere with top-level WebSocket upgrades" is an unproven inference; what is observed is that the allowed-page control returned 0 handshakes in route mode and 3 of 3 in the server-header control, so every route-mode "CONTAINED" cell is UNVERIFIED, not a pass. (2) Server-delivered CSP contained every channel, but Falcon does not control a customer server's headers, so that result shows CSP semantics only, not an available Falcon mechanism. (3) `data:` worker loading was not independently confirmed; SharedWorker and service worker sockets were not measured; macOS only. (4) The nested-worker escape was measured in all 5 route phases on both Nodes (3 of 3 handshakes each).

# FW2SP-01 Findings — CSP connect-src containment of worker-originated WebSockets

Read-only measurement spike. Scratch-only. Loopback only. macOS Darwin 25.5.0, Playwright 1.64.0, Chromium 156.0.8078.4 via `chromium.launchPersistentContext`, Node 22.19.0 and Node 24.21.0. REPS=3. No product edits.

## Question (restated)
Can Falcon contain worker-originated WebSockets WITHOUT relying on `routeWebSocket` (which does not fire for dedicated/blob/nested workers) by injecting a `Content-Security-Policy: connect-src` restriction into EVERY required response through its routing handler (`context.route` + `route.fetch` + `route.fulfill` with added/merged header)?

## Short answer: NO (as implemented via `context.route`). ESCAPE in nested-worker case.

- `context.route('**/*', ...)` with `route.fetch()`+`route.fulfill()` **does NOT intercept** the HTTP fetch of worker scripts that are instantiated from inside another worker (nested worker). The inner worker script response reaches the browser **without** the injected CSP header, so the inner worker realm is unconstrained, and its `new WebSocket(...)` reaches the non-allowlisted origin.
- Delivered as a true HTTP response header by the origin server, the same CSP contains every tested channel including nested workers.

## Primary observation (ESCAPE / BLOCKER)
Fixture: two loopback HTTP origins with real `upgrade` handlers that increment a counter on each successful WS upgrade. Allowlist CSP: `connect-src ws://127.0.0.1:<origin1>` (also `wss://` when the HTTPS fixture is up).

With CSP injected only via `context.route` + `route.fulfill` headers (`fw2-harness.js`, phase `allowlist`):

| case | origin2 handshakes / 3 reps | verdict |
|---|---|---|
| nested-blocked (nested worker → inner worker → WS to origin2) | **3 / 3** | **ESCAPES** (BLOCKER) |

Same escape repeated across every CSP phase (`none`, `skip-worker-script`, `meta-weaken`, `double-csp`) and on both Node 22 and Node 24. ndjson: `stream-node22.ndjson`, `stream-node24.ndjson`. Raw: `results-node22.json`, `results-node24.json`.

## Decoupling controls (`fw2-controls.js`, no `context.route` installed)

Server returns CSP header natively; this is the "ideal" case Falcon would need to emulate perfectly for every response, including those requested from nested workers.

| mode | page-allowed (o1) | page-blocked (o2) | dedicated-blocked (o2) | nested-blocked (o2) |
|---|---|---|---|---|
| bare, no CSP | 3/3 | 3/3 | 3/3 | 3/3 |
| server-csp (header on every response) | 3/3 | **0/3** | **0/3** | **0/3** |

Reproduced identically on Node 22 and Node 24. See `ctrl-results-node22.json`, `ctrl-results-node24.json`, `ctrl-stream-node22.ndjson`, `ctrl-stream-node24.ndjson`.

Interpretation: CSP `connect-src` is capable of containing worker-originated WebSockets at every tested depth. The failure mode in the `context.route` approach is **not** CSP semantics; it is that `context.route` does not reach every required response (nested-worker script fetches bypass it in Playwright 1.64).

A secondary measurement artefact: in the `context.route` harness, `page-allowed` also returns 0 handshakes (control broken). Comparing against the bare controls, Playwright 1.64 `context.route('**/*')` appears to interfere with top-level WebSocket upgrade handshakes (likely by producing a fulfilled HTTP 200 response in place of a 101 Switching Protocols). This conflates "CSP contained it" with "route handler accidentally broke it" for every page/dedicated/blob/data/module case measured through the handler. That makes any such routing-based evidence of containment **UNVERIFIED**, independent of the nested escape.

## Per-case verdict matrix (final; mechanism noted)

| case | server-side CSP | via `context.route` CSP injection | mechanism |
|---|---|---|---|
| page WS allowlisted (control) | CONTAINED (opens, as expected) | UNMEASURED (route handler kills the upgrade handshake even for allowed URL) | — |
| page WS to non-allowlisted origin | CONTAINED (0/3; `securitypolicyviolation` fires) | CONTAINED on counts, but UNVERIFIED (route handler also blocks) | CSP in doc realm |
| dedicated worker (URL) WS to non-allowlisted origin | CONTAINED (0/3) | UNVERIFIED (0/3, but route handler also blocks) | CSP delivered on worker script response governs worker realm |
| nested worker inner WS to non-allowlisted origin | CONTAINED (0/3) | **ESCAPES (3/3) — BLOCKER** | inner-worker script fetch bypasses `context.route`; no CSP delivered; worker realm unconstrained |
| blob: worker WS to non-allowlisted origin | CONTAINED (0/3 in main harness; worker emits `error`) | UNVERIFIED (route handler also interferes) | blob worker inherits parent-document CSP |
| data: worker WS to non-allowlisted origin | CONTAINED (0/3 in main harness; worker runs and emits `error`) | UNVERIFIED | data worker inherits parent-document CSP (opaque origin) |
| module worker (`type:'module'`) incl. static import, WS to non-allowlisted origin | CONTAINED (0/3) | UNVERIFIED | CSP on module worker script response + its static import response |
| same-origin dedicated worker (URL) | n/a (same construction as above) | — | — |
| cross-origin dedicated worker (`new Worker(origin2+/dedicated-worker.js)`) | Forbidden by browser (TypeError: Script at '…' cannot be accessed from origin '…') | same | SOP, not CSP |
| wss: dedicated worker to non-allowlisted TLS origin | CONTAINED (0/3) using self-signed TLS fixture with `ignoreHTTPSErrors` | UNVERIFIED | CSP on worker script |
| ws: + wss: distinction | both measured; CSP `connect-src` entries matched protocol scheme | — | — |

The `ws:`/`wss:` fixture pair was feasible via `openssl req -x509` self-signed cert + `ignoreHTTPSErrors`; both schemes were exercised.

## Fail-closed measurements

1. Route handler throws for the top-page response (`route-throws` phase): all `page.goto` calls return `net::ERR_FAILED`; no case opens any realm; 0 handshakes anywhere. **Fail-closed: PASS** — a thrown route handler cannot smuggle a request through.
2. Route handler deliberately skips CSP injection on worker script responses (`skip-worker-script` phase): nested-blocked still shows 3/3 handshakes to origin2 (same escape as the base `allowlist` phase, because nested worker scripts never traverse `context.route` in either mode).
3. Response bypassing routing: the nested worker's inner `new Worker(...)` script fetch bypasses `context.route` — this is the ESCAPE above. No CSP header lands on that response; the worker realm has no `connect-src` restriction and reaches the server.
4. CSP cannot be verified from main realm: an in-realm canary (`securitypolicyviolation` on the top document, with a deliberately-blocked WS to a canary URL) detects whether CSP is armed in the main-document realm. Observed `violations.length >= 1` in every CSP mode and 0 in the `none`/`route-throws` modes. The canary is sufficient for the main-document realm. It is **NOT** sufficient for worker realms — a worker realm's `securitypolicyviolation` only fires inside that worker; the main-realm canary cannot see it. A Falcon that only canaries the main realm must treat worker containment as **UNVERIFIED** and refuse to arm.
5. Weakening attempts (`meta-weaken`: adding `<meta http-equiv="Content-Security-Policy" content="connect-src *">` injected into the top-page body; `double-csp`: appending a second CSP header): neither broadens containment. Meta can only tighten; multiple CSPs intersect (strictest wins). No additional handshakes observed in either mode on either Node.

## In-realm canary results

| phase | canary violations in main doc | canary handshakes reached origin2 |
|---|---|---|
| allowlist (via `context.route`) | 1/1 (CSP armed) | 0 |
| none | 0 (no CSP) | 0 (route handler incidentally blocks) |
| skip-worker-script | 1/1 | 0 |
| route-throws | 0 (nav failed) | 0 |
| meta-weaken | 1/1 | 0 |
| double-csp | 2/2 | 0 |

The canary is a necessary but **insufficient** readiness check: it proves the main-document CSP is in place, not that CSP is in place in every worker realm the page can spawn. Combined with the nested-worker escape, this means Falcon cannot soundly declare worker containment based on a main-realm canary alone.

## Conclusions (observed vs inferred)

Observed:
- `context.route('**/*')` with `route.fetch`+`route.fulfill` injection of `Content-Security-Policy` is **not** a complete mechanism for worker-WS containment in Playwright 1.64 / Chromium 156. **Nested worker scripts bypass the route handler**; those workers get no CSP and their WebSockets reach non-allowlisted origins (3/3 handshakes, both Node 22 and Node 24).
- `context.route('**/*')` also appears to interfere with top-level WebSocket upgrades, breaking the allowed-WS control case and conflating CSP containment with routing-interference blocking in the remaining cases.
- When CSP is delivered as a native HTTP response header by the server (bypassing `context.route`), the same `connect-src` policy contains page WebSockets, dedicated/blob/data/module worker WebSockets, and nested worker inner WebSockets (0/3 handshakes). The allowed control still opens as expected (3/3). This matches the CSP3 spec.

Inferred:
- To make the CSP approach work in Playwright, Falcon would need a mechanism that guarantees every worker-script response — including script fetches initiated by other workers — carries a Falcon-set CSP header. `context.route` is not that mechanism; a loopback MITM proxy or a wrapper around `fetch`/`importScripts`/`new Worker(...)` would be. Any approach that cannot verify the CSP landed on every realm's script response must refuse to arm.

## Limits / caveats

- macOS only, Darwin 25.5.0, Apple Silicon. Not cross-OS.
- Playwright 1.64.0 only; behavior of `context.route` with WS upgrade handshakes may change in later versions.
- Chromium 156.0.8078.4 headless only. Did not test Firefox or WebKit.
- `SharedWorker` not tested (headless Chromium disables it; previous MEASA2 result; out of scope here).
- Self-signed TLS fixture is loopback-only; wss containment was measured only with `ignoreHTTPSErrors: true`.
- The data: worker case ran and reported an `error` event; whether the data: worker actually loaded (vs being rejected by Chromium's data-URL worker policy) was not directly measured here — treat as "CSP sufficient when data: worker exists; data: worker construction itself may be blocked by browser policy".
- Not measured: WebSocket from a Shared Worker (SharedWorker absent in headless Chromium); WebSocket from a Service Worker.

## Cleanup

- All HTTP/HTTPS fixture servers were closed; `closeAllConnections` + `close()` called; harness ends with `setTimeout(process.exit(0), 100).unref()`.
- All chromium processes cleaned (`pgrep -lf chromium` empty at end of run).
- Profile directories removed via `fs.rmSync(..., recursive, force)`.

## Evidence files (absolute paths)

- Harness: `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/fw2/fw2-harness.js`
- Controls: `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/fw2/fw2-controls.js`
- Raw results: `/private/tmp/.../scratchpad/fw2/results-node22.json`, `results-node24.json`, `ctrl-results-node22.json`, `ctrl-results-node24.json`
- ndjson streams: `/private/tmp/.../scratchpad/fw2/stream-node22.ndjson`, `stream-node24.ndjson`, `ctrl-stream-node22.ndjson`, `ctrl-stream-node24.ndjson`
- Fixture TLS: `/private/tmp/.../scratchpad/fw2/cert.pem`, `key.pem`
- Stderr logs: `stderr-node22.log`, `stderr-node24.log`, `ctrl-stderr-node22.log`, `ctrl-stderr-node24.log`
