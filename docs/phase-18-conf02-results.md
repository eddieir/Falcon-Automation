# Phase 18 — CONF-02 consolidated W6-T conformance results

**Status: PARTIAL. Do not send to Security.** Two stop conditions in the owner's instruction are met: (1) a malformed-input case arms (a pass-through Proxy, the documented `PROXY-27` residual, arms), and (2) two table rows were not executed as independent rows (FC1 and IC4). No other malformed mutation armed, browser identity was established, `fc2Pass` is explained, and cleanup is verified.

Base revision: rev 27 `2ab5f30` (rev 26 was `d79c213`). CONF-01 (`docs/phase-18-w6t-conformance-results.md`) is unchanged and remains PARTIAL. Raw evidence stays in scratch (`scratchpad/conf02/`): `pure-results-node22.json`, `pure-results-node24.json`, `browser-results-node22.json`, `browser-results-node24.json`, `decide27.js` (verbatim extraction of rev 27 section B.5, sha256 `4de3de24…`), harnesses and the identity wrapper. Two agents ran the work (CONF-02A pure rows and sweeps; CONF-02B real-browser rows); the coordinator read the raw result files to write this document. The two agent drafts are `docs/phase-18-conf02a-pure-results.md` and `docs/phase-18-conf02b-browser-results.md`.

Environment: macOS arm64; Node v22.19.0 and v24.21.0; Playwright 1.64.0; Chromium 156.0.8078.4 (`Google Chrome for Testing`, executable SHA-256 `c8509aee32abd6977968e9999769980b7a420dea05402d90042d9e5b41db15ef`), launched through the scratch wrapper; loopback fixtures only. This is not the GitHub-hosted runner.

## 1. Rows executed (independently, 3 repetitions per Node version)

| Row(s) | Executed by | Result |
|---|---|---|
| F1, F2, F3, F4, F6, F8, F9, F10, F12, F15 | CONF-02B | measured present ⇒ `shared_worker_present`, exit 18, `armed:false` (matches the table) |
| F5, F7, F11, F21 (required fail-closed) | CONF-02B | `shared_worker_block_unverified`, exit 18 (errors `unexpected-success-no-allow-scripts`, `frame-not-found`, `unreachable`); never rewritten into passes |
| F16, F17, F18, F19, F20 (unmeasured today) | CONF-02B | `shared_worker_block_unverified`, exit 18, as the table requires |
| F13, F14 (popups) | CONF-02B | `shared_worker_block_unverified`, exit 18, error `not-created`: the harness did not create the popup realms in this run, so the table's primary expectation ("present ⇒ `shared_worker_present`") was **not** observed; the fail-closed branch of the same row ("an unconfirmable popup is fail-closed") fired. SPIKEW-06 earlier recorded popups as present. Classified: refusal as expected for the fail-closed branch, **realm not measured here** |
| F22 (informational) | CONF-02B | `typeof SharedWorker` is `undefined` in the dedicated-worker scope; never passed to `decide()` |
| Full 21-realm gate | CONF-02B | `armed:false`, exit 18, `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:F5` (3 of 3 per Node) |
| FC2 | CONF-02B | `fc2Pass: true` in every recorded battery (see section 3) |
| IC1 (harness can see an unblocked SharedWorker request) | CONF-02B | PASS 3 of 3 per Node: `constructed-ok`, script fetch seen at the fixture |
| IC2 | CONF-02B | altered native reference refuses (`armed:false`, 18) 3 of 3 per Node |
| IC8 (identity) base / kill-relaunch / different arguments / different context | CONF-02B | base: identity verified, gate still refuses; kill-relaunch ⇒ `identity-unverified:pid-not-alive`; different args ⇒ `identity-unverified:args-mismatch`; different context ⇒ `different-context-config-requires-fresh-evidence`. All `armed:false`, exit 18, 3 repetitions each per Node, no wrong arm |
| FC3 to FC11, IC3, IC5, IC6, IC7 (the last two are the sweeps), FW-1 decision | CONF-02A | all as expected, 3 repetitions per Node (150 invocations over 25 sub-cases) |
| Sweeps A (1155), B (126), C (13) | CONF-02A | derived counts match section D exactly; 7764 invocations over 3 repetitions per Node; **0 unexpected `armed:true` except the Proxy case below** |
| FW-1 | both | decision executed 3 times per Node; status `UNMEASURED` retained (worker WebSocket behaviour is not measured) |

## 2. What blocks the gate

1. **A pass-through Proxy arms.** A Proxy that returns exactly the values of a valid, all-absent record produces `armed:true`. A Proxy whose traps vary or throw refuses. The rev 27 B.7 text predicted this and records it as residual `PROXY-27`; the owner's instruction requires every malformed case, proxies included, to refuse. `util.types.isProxy` exists in this Node (checked) and would detect the case, but it is not in the rev 27 reference text and changes the "pure function" statement. **Owner decision required.**
2. **FC1 and IC4 were not executed as independent rows.** FC1 (pre-author-script native-constructor capture compared with the evaluate-time read) is carried inside every realm record (`nativeCtor`), but no separate row run with its own expected/actual was produced. IC4 (probe disabled or removed: execute mode must not arm) was not executed. The owner's instruction treats a skipped row as a stop condition.
3. **Four SPEC-AMBIGUOUS items from CONF-02A** (details in its draft): the "disagreement" branch (FC6/IC3-d) is unreachable, so the case refuses through the field-validation path instead; FC10 and sweep C13 have no externally reachable hook between `decide`'s internal steps; the `detail` for some cases records record-key order rather than the accessor property; how IC5's "extra id" is interpreted.

## 3. `fc2Pass` explained

CONF-01 printed `fc2Pass: false` without explanation. Rev 27 J.4 defines FC2 as five sub-observations (page mutation evasion: delete, override, defineProperty, try/catch suppression and a clean constructor from another realm) where the decision must stay unchanged and the pre-captured native reference must remain usable. In CONF-02, every recorded FC2 battery has `fc2Pass: true` with its sub-observations listed. The CONF-01 `false` is attributable to that run's harness (it also had no browser identity and a different decision function); it is not a property of the design and is not reinterpreted here.

## 4. Browser identity, network, cleanup

- **Identity:** the scratch wrapper wrote its PID, start time, normalized arguments and a random token, then `exec`'d the real Chromium. Before the simulated run step the harness re-verified the same PID alive, the same normalized start time (whitespace normalized; this fixed a CONF-02B smoke-run comparison bug) and matching arguments (3 of 3 per Node). `SystemInfo.getProcessInfo` was unavailable on the page-level CDP session used by Playwright's persistent context; `Browser.getVersion` corroboration is reported by the harness. No wrong arm occurred in any identity negative case.
- **Network:** 561 loopback requests per Node version; **0 non-loopback requests** in both.
- **Cleanup:** at the end no `conf02` process, wrapper process, Chromium process, profile directory or scratch listener remained. During the final check I found two **leftover CONF-01 fixture-server processes** (pids 47744 and 62932, started 2026-10-19 15:59 and 16:04 by the earlier CONF-01 runs, still listening on loopback). The earlier CONF-01 note that no scratch process remained was therefore wrong for those two. I terminated them; no other CONF-01 process was found.

## 5. Practical supported-browser set

**Empty.** Every real-browser gate run on the current pinned Chromium refuses with exit 18 (`shared_worker_block_unverified` under the rev 26/27 precedence). The only `armed:true` outcomes in the work are the pure-function all-absent positive controls (6 repetitions) and the pass-through Proxy case in section 2.

## 6. What was not measured

FC1 and IC4 as independent rows; the popup realms (F13, F14) in this run; worker WebSocket behaviour; `SystemInfo.getProcessInfo`; any browser other than the pinned Chromium; Linux or the GitHub-hosted runner; a browser in which SharedWorker is absent (so a real `armed:true` path was never observed end to end).

## 7. RECOMMENDATION

Do not dispatch Security on rev 27. A narrow rev 28 should: decide the Proxy rule (reject Proxies via `util.types.isProxy` in addition to the structural checks, or accept `PROXY-27` explicitly), resolve the four spec ambiguities, and define FC1 and IC4 as independently executable rows; then run FC1, IC4 and the popup realms and re-run the matrix before any Security ruling.
