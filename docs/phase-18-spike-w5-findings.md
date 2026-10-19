# Phase 18 — SPIKE-W5 findings (SPIKEW-05): two-client CDP diagnostic

**VERDICT: INCONCLUSIVE.** The probe did not exercise any variant it was designed to test. Under the owner's decision rules, an ambiguous result after this probe means the fail-closed fallback is adopted and no further CDP spike is scheduled.

Status: the agent that ran the harness stopped at its turn limit without delivering a report; the harness itself ran to completion ("ALL DONE"). This document was written by the coordinator from the raw files in the scratch directory `spike-w5/` (harness, `run-output.log`, and `evidence/part1-report.json` plus 30 `part2-*.json` run records). It is a read-out of those files, not a re-run. Nothing was added to the harness or the raw evidence.

Environment: macOS arm64, Node v22.19.0, Playwright 1.64.0, Chromium `chromium-1248` (Google Chrome for Testing 156.0.8078.4), loopback fixture only, synthetic data, no external network.

## Part 1 — production transport check: NOT MEASURED

`evidence/part1-report.json` shows that the harness never obtained a browser process handle: `pid: null`, `launchArgs: "N/A (no process() handle)"`, `userDataDir: null`, `devToolsActivePortExists: "unknown"`, `listeningTCP`/`unixSockets`/`openFds`/`fd3and4` all `"N/A"`, `descendantPids: 0`. The only measured items are a failed `curl` to port 9222 and a failed probe of ports 9222 and 9229 (no listener on those two default ports), plus a source search:

- OBSERVED (source search): `falcon.js:637` and `falcon.js:665` both call `chromium.launch({ headless })` with no extra arguments; `playwright.config.js` `use{}` contains no `launchOptions`, `connectOptions` or `cdpEndpoint`; the repository source references no `PLAYWRIGHT_CHROMIUM_*` or CDP-port environment variables.
- NOT OBSERVED: Chromium's effective launch arguments, whether the transport is `--remote-debugging-pipe`, whether any independent process can discover or connect to the browser, descriptors, sockets, `DevToolsActivePort`. The two failed port probes do not prove non-reachability: they cover two default ports only and no real production browser was inspected.
- INFERENCE (unproven): Playwright's documented default launch uses a pipe. This was not verified here.

Consequence: the owner's rule "if production exposes an independent CDP endpoint, or Falcon cannot prove that it does not, treat the design as infeasible" cannot be evaluated in the favourable direction. Falcon has not proved non-exposure.

## Part 2 — true two-client experiment: NO VARIANT EXERCISED

All six variants (V1 to V6) ran five repetitions each (30 runs, fresh browser profile per run, distinct run id per run). In every one of the 30 run records inspected for pattern (`part2-V1-rep0`, `V4-rep0`, `V5-rep0` read in full; the run log lists the same outcome for the other 27):

- Client A sent `Target.setAutoAttach` with `{autoAttach:true, waitForDebuggerOnStart:true, flatten:true, filter:[{type:"shared_worker"},{exclude:true}]}` and received `result: {}` (accepted).
- Client A sent `Target.createTarget` for the fixture page and received a `targetId`.
- The notes in each record read: "A never received Target.attachedToTarget for shared_worker (timeout)" and "No worker target observed by A; variant action skipped." `events` is empty and `rawLogB` (Client B's log) is empty in the inspected records.
- `workerExecuted: false`, `fixtureHitCount: 0` in all 30 runs.

OBSERVED FACT: no SharedWorker target was ever reported to Client A, so Client B never discovered, attached to, detached from, or tried to resume any target. The experiment's central question (can a second client resume a paused SharedWorker?) was never put to the browser.

Likely harness causes (INFERENCE, not verified): the page was created with `Target.createTarget` without any session attached to it, and may not have run (or constructed the SharedWorker) in the way the earlier Playwright-driven probe did; nothing in the records shows the page's own script executing.

Important false signal: every record shows `falconEquivalentExitCode: 18`. The record is written even though no worker was observed, so that value does **not** show Client A detecting and refusing a worker. It must not be read as evidence that the refusal path worked.

`workerExecuted: false` with `fixtureHitCount: 0` in all 30 runs is therefore **vacuous**: there was no paused worker to resume and, as far as the records show, no worker was constructed. It is not evidence that discovering, attaching, detaching or resuming is safe. No positive control (a case proving the harness can see an unblocked SharedWorker request) was run in Part 2.

## What remains valid from earlier probes

- SPIKEW-04 Stage 1 and Stage 2 (committed in `e953852`): the corrected filter `[{type:"shared_worker"},{exclude:true}]` did not pause page, iframe, popup or dedicated-worker targets; a paused SharedWorker closed by `Target.closeTarget` produced zero fixture requests in 5 of 5 runs, with a Falcon-equivalent exit of 18. That evidence stands as measured, with its stated limits.
- SPIKEW-04 Stage 3(a): the single observation that the fixture received one request after a second `Target.attachToTarget` stays **unresolved**; this probe did not resolve it.

## Decision-rule outcome

| Owner rule | Result |
|---|---|
| Discovering, attaching or detaching resumes the worker → INFEASIBLE | not tested (no worker was observed) |
| Only a correctly routed `Runtime.runIfWaitingForDebugger` resumes it → check production reachability | not tested; production reachability not established (Part 1 failed to capture the browser) |
| Production exposes an independent endpoint, or non-exposure cannot be proved → INFEASIBLE | non-exposure **not proved** |
| Private pipe with no discoverable endpoint → enforced precondition | not established |
| Results ambiguous after this probe → adopt the fail-closed fallback, no further CDP spike | **applies** |

## Cleanup

The harness's own end-of-run check listed one scratch Chromium process tree (profile `falcon-spikew5-V1-r0-…`, a leftover from the first variant) that was still alive when the harness ended. The coordinator terminated that tree with a pattern kill scoped to `falcon-spikew5-`; a final `ps` search for that pattern then returned no scratch Chromium process.

## OBSERVED FACT / INFERENCE / RECOMMENDATION

- OBSERVED: the scoped filter is accepted; no shared_worker target was reported in any of the 30 two-client runs; Part 1 captured no browser process facts; every run record carries exit 18 regardless of detection.
- INFERENCE: the two-client harness did not construct the SharedWorker in a context where Client A's auto-attach could see it; the cause is unisolated.
- RECOMMENDATION (for the owner and Architect, not applied): per the owner's rule, adopt the fail-closed fallback — Falcon refuses to arm whenever SharedWorker capability is present, with its own separately measured, fail-closed, pre-author-script capability check in every relevant realm. Do not schedule another CDP spike. Treat SPIKEW-04 Stages 1 and 2 as feasibility context only. The CDP-based block, if it is ever revisited, would require an enforced launch precondition (no debugging port, address or inherited endpoint) that Security must review.
