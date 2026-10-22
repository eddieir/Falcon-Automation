# Phase 18 — CONF-04A Node-side results (rev 29)

Status: the executing agent stopped at its turn limit without a report or document; the coordinator wrote this from the raw files (`scratchpad/conf04/nodeside-results-node22.json`, `-node24.json`; harness `harness.js`). Base: rev 29 `677fe69`; reference module `decide29.js` (sha256 prefix `7f85cbee…`). Node v22.19.0 and v24.21.0; no browser, no network.

| Item | Result (identical on both Nodes; the two files differ only in `meta`) |
|---|---|
| Independent row executions | **209 per Node** (71 distinct rows/sub-cases x 3 repetitions) |
| Failures / uncaught throws / unexpected arms | 0 / 0 / 0 |
| Sweep A (malformed single-field) | 1155 computed = documented; 0 mismatches |
| Sweep B (valid-but-negative) | 126 = 126; all 126 refuse (rev 29: no presence in this sweep) |
| Sweep C (structural battery) | 20 = 20 (21 entries with C18b), 3 passes |
| Sweep D (new: constructor-evidence mix) | 195 = 195; 21 `shared_worker_present` and 174 `shared_worker_block_unverified`, as the formula predicts |
| Totals | 1496 refusals (1475 unverified + 21 present) + 1 authorised armed control across 1497 |
| New rev 29 rows | FC13 (mismatch at F1, F11, F21), FC14a/b/c (invalid + valid-present; multiple invalid), FC15i to iv (post-validation changes via SEAM-28), IC3-f, IC10a to e (`nativeCtor` missing, `uncaptured`, `mismatch`, Proxy; present with `repetitionsConsistent:false`), FC1 mismatch-injection (Node-side) — all as the rev 29 contract expects |
| MT-1 meta-test | independent checker recomputing every row's pass from expected versus actual; its self-test (a deliberately wrong pass flag) is among the 71 rows and behaved as required |
| Proxy cases | all refuse (carried from rev 28 plus FC15iii/iv) |

**`armed:true` outcomes:** only the authorised all-absent control IC3-a, and the FC15 rows whose base is that same complete, valid all-absent array and whose post-validation mutation (via the test seam) leaves the decision byte-identical to the unmutated authorised decision (`AUTHORISED_ARMED_TRUE` in the raw rows). No malformed, mismatched, proxied or partial input armed.

**Spec-ambiguity items recorded by the run (4):** the FC10 "record-unstable" companion cannot be produced by a plain primitive value; the `realm-unknown-or-extra:ID` branch of IC5-3b; reachability of the `required-id-missing` detail; Sweep D-mix boundary positions (F1/F21) for "preceding or following required realm". Reported as recorded; not resolved.
