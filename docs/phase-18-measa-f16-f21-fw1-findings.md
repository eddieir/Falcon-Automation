# Phase 18 - MEASA-01 findings: F16 to F21 and FW-1 real browser measurements

**Status: MEASURED for the rows below; PARTIAL as an agent task.** The measuring agent stopped at its turn limit without a report; the coordinator reran the agent's harness (3 repetitions on each of Node 22.19.0 and 24.21.0) and read the raw record stream. Environment: macOS arm64, Playwright 1.64.0, Chromium 156.0.8078.4 via `launchPersistentContext`, loopback fixtures only, reference decision `decide32.js`. Raw evidence (scratch, not tracked): `scratchpad/measa/stream-node22.ndjson`, `stream-node24.ndjson` and the harness. Results are identical across repetitions and Node versions (3 of 3 each).

| Row | Realm | Measurement | Gate outcome |
|---|---|---|---|
| F16 | srcdoc iframe | measurable; `typeof SharedWorker` = `function`; descriptor present | `shared_worker_present` (refuse) |
| F17 | iframe appended after top load (the capture init script was not pre-installed in this late frame, so the probe was injected inline; capture-versus-live comparison is unreliable here) | measurable; `function` | `shared_worker_present` |
| F18 | back-navigation realm (bfcache restoration NOT independently confirmed: the harness flag rests on a URL check only, no `pageshow.persisted` probe) | measurable; `function` | `shared_worker_present` |
| F19 | `javascript:` URL frame | **UNMEASURABLE**: no navigable frame was produced (`frame-not-found`) | `shared_worker_block_unverified` (refuse) |
| F20 | `<object>` document | measurable; `function` | `shared_worker_present` |
| F21 | service worker scope | measurable; `typeof SharedWorker` = `undefined` | see note |
| FW-1 | dedicated worker opens a WebSocket to a loopback fixture | **OBSERVED: the WebSocket opened** (`ws:open`) in 3 of 3 runs on both Nodes; Playwright's `context.on('websocket')` reported **no** WebSocket (`playwrightSawWs:false`) | n/a (not a decision row) |

**F21 note.** `SharedWorker` is not exposed in service worker scope, so the absence is structural and says nothing about the page's capability. The harness recorded `mechanism: 'sw.postMessage'`, which is not in the closed schema enum, so `decide32` refused it (`record-value-enum:mechanism`); with the schema's `serviceworker.probe` the same record is a valid absence (checked directly against `decide32.js`). That is a harness mapping defect, not a gate result; the schema-valid mechanism string must be used in the real measurement.

**Consequence for the supported-browser set.** F16, F17, F18 and F20 are SharedWorker-present on the pinned Chromium, as in every earlier measured realm; F19 stays unmeasurable. The set stays empty and these rows add no armed path.

**New finding for Architect and Security (not yet ruled on): FW-1.** A dedicated worker can open a WebSocket to a loopback origin and Playwright's context-level `websocket` event does not report it. WebSocket traffic is not covered by `context.route()`. The control (a page-level WebSocket observed by the same event listener) was not run, so whether the event would have reported a page-level socket is unmeasured; the result shows only that nothing was observed here. Any design claim that all customer-bound network traffic is observed or refused through Playwright routing must not include WebSocket traffic from workers until this is resolved (the design's existing protected-request containment does not rely on observing WebSockets, but this must be confirmed by Security).

**Harness limits.** The agent's harness did not exit by itself after the last row (a teardown hang, cause not isolated); the raw stream was complete before it was stopped, and no Chromium or harness process remained afterwards. The agent's run stopped before its own findings were written; the numbers above come from the raw stream, not from the agent's report. Linux and GitHub-runner coverage of these rows remain unmeasured.
