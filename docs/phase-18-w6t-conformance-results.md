# Phase 18 — W6-T conformance execution results (CONF-01)

**Status: PARTIAL. The conformance run found a gap in the rev 26 `decide()` and did not capture browser process identity. The "no missing measurement can produce `armed:true`" confirmation is NOT obtained.**

This document was written by the coordinator from the raw result files because the agent that ran the harness stopped at its turn limit after leaving only a placeholder. It reports what the raw files contain and nothing else. The agent's final report was never delivered. Raw evidence (scratch, not tracked): `scratchpad/conf01/runs-node22.json`, `runs-node24.json`, `harness.js`. Base revision: `d79c213`. Spec: `phase-18-rev25-patch.md` table W6-T as amended by `phase-18-rev26-patch.md`.

Environment: macOS arm64; Node v22.19.0 and v24.21.0; Playwright 1.64.0; Chromium 156.0.8078.4 launched with `chromium.launch({headless:true})`; executable `Google Chrome for Testing`, SHA-256 `c8509aee32abd6977968e9999769980b7a420dea05402d90042d9e5b41db15ef`; loopback fixtures only.

## What was executed (identical outcomes on both Node versions)

| Item | Result |
|---|---|
| Real-browser gate runs (F realms through the harness, `decide(perRealm, requiredIds)` copied from rev 26) | 3 runs per Node. Every run: `armed:false`, exit 18, reason `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:F5` |
| Requests outside the loopback fixtures | **0** of 285 recorded requests (both Nodes) |
| IC1 positive control (the harness can see a SharedWorker request) | PASS: `constructed-ok`, the fixture saw the script fetch, 3 runs per Node |
| IC2 | the browser run with the captured native reference altered refuses (`armed:false`, 18), 3 runs per Node |
| Pure-function battery (synthetic records), 26 named cases: IC3 (all-absent, one-present, one-unmeasurable, disagreement, empty array), IC5 (missing realm, duplicate id, extra id, unknown id, undefined `measurable`, null typeof, `'object'` typeof, malformed record, non-array input, conflicting repetitions, positive control), FC4 (timeout), FC5 (cannot be created), FC6 (disagreement), FC7 (check throws), FC8 (non-array `requiredIds`, missing id, duplicate id, extra id, unknown id, malformed record with valid ids) | Every negative case: `armed:false`, exit 18, the expected reason (`shared_worker_present` for the present case, otherwise `shared_worker_block_unverified`). The synthetic all-absent and positive-control cases return `armed:true` **only in this pure-function test** |
| FW-1 (worker WebSocket) | UNMEASURED by design; recorded as refuse, not as a pass |
| F22 (dedicated worker) | informational only; `typeof SharedWorker` is `undefined` there and is never passed to `decide()` |
| Repetitions | 3 per execution path; the real-browser gate ran as one complete array per run, not as 21 separately repeated rows |

## What failed or is missing

1. **Mutation sweep: 105 of 441 mutations arm (both Nodes, identical).** The harness started from a valid all-absent synthetic array and deleted or blanked one field of one record in each required realm. These mutations produced `armed:true`:
   - `mechanism` deleted: 21; `mechanism` set null/blank: 21;
   - `descriptor` deleted: 21;
   - `error` deleted: 21; `error` set null/blank: 21.
   The first logged failure is F1 with `mechanism` deleted. The rev 26 `decide()` does not require these fields to be present. For `descriptor`, rev 26 treats an `undefined` descriptor as the absence signal, so a **deleted** field cannot be told apart from a measured "no descriptor". For `error`, a missing or null value reads as "no error". For `mechanism`, the record's identity of how it was measured is not validated at all.
   Interpretation (INFERENCE): by the owner's rule, "missing fields … produce `shared_worker_block_unverified`" and "no missing measurement can produce `armed:true`", these results show **the rev 26 `decide()` still has a missing-measurement path**, narrower than M-26 but of the same kind. Whether `mechanism` and `error` are in the required-field list is ambiguous in the rev 26 text (SPEC-AMBIGUOUS); `descriptor` and `error` are listed with "absent/falsy = good" semantics that make deletion indistinguishable from affirmation.
2. **Browser process identity was not captured.** In every real-browser run and in the same-process-rule check, `pid` and `startTime` are `null`, `psArgs` is `null`, and `candidateCount` is 0: the harness's `ps` discovery of the main Chromium process found no candidate. Only the executable path, its SHA-256 and the browser version were recorded. Consequently `sameProcessHeld:false`, `pidAliveAfterClose:null` and the run-versus-probe identity comparison **did not run as designed**. The same-process rule (OWNER-24) is therefore **not exercised by this run**.
3. **`fcDerived.fc2Pass` is `false`** in the run records with no explanation in the files read; its meaning was not established. It is reported as an unresolved flag, not as a result.
4. **Coverage:** this was not the 36-row matrix with each row run three times. F1 to F21 were run as one array per run; FC1 to FC3, FC7's browser variants and the remaining rows were covered only as far as the raw files show (the pure battery above, `fcDerived`, IC1/IC2). F16 to F21 unmeasured-realm behaviour was exercised only through the single failing F5 realm that triggered the refusal. Which of the 21 realms were individually measured versus unmeasurable was not tabulated by this run.
5. **Cleanup:** the agent's own cleanup check was not reported. At the time of writing no scratch Chromium process from this run was identified by the coordinator's `ps` check (a pattern search returned only shell wrappers).

## Practical supported-browser set

**Empty.** On the current pinned Chromium the gate always refuses. Under the rev 26 precedence the reason is `shared_worker_block_unverified` (exit 18), not `shared_worker_present`, because the F5 realm is not affirmatively validated.

## OBSERVED FACT / INFERENCE / RECOMMENDATION

- OBSERVED: refusal in every real-browser run; zero non-loopback requests; all 25 negative pure-function cases refuse as expected; 105 of 441 single-field mutations arm; no browser process identity recorded.
- INFERENCE: the `decide()` as written in rev 26 needs a required-field-presence rule (every field present with the exact expected type and value, `descriptor` expressed as an explicit marker rather than a missing key, `mechanism` and `error` required) before the "missing measurement cannot arm" property holds.
- RECOMMENDATION (not applied): a narrow rev 27 for the field-presence rule, a fix to the harness's process discovery, then a full re-run of the 36-row matrix with every row repeated, before any Security ruling on M-26.
