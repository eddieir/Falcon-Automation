# Phase 18 Security Design Review 24 (SEC-25)

Reviewer: Security Engineer (`claude-opus-5-5`), read-only. Head reviewed: `8fba1c6` (rev 29 = `677fe69`, plus CONF-04 evidence commits). The coordinator saved this text from the reviewer's report in condensed form without changing findings. Status: **PARTIAL** until a real implementation checker and an armed browser exist.

**Verdict: APPROVE WITH CONDITIONS (design only). Blockers 0. Majors 1 (M-26 still open). New minors 5 (m-91 to m-95).**

## Rulings
- **M-26: OPEN, with a working reproduction.** The B.4a validity matrix is total and correct for every record that passes schema validation: no combination of (typeof, descriptor, nativeCtor, constructed, mechanism, error) arms or is classified wrongly, and `decide29.js` matches the rev 29 B.5 text. The hole is in `requiredIds` handling inherited from rev 28 B.5 (`requiredIds.slice()`, then `req.slice()` for the snapshot): the decision calls methods on the caller's array. If `slice` is overridden (non-enumerable own property or swapped prototype) the snapshot's `requiredIds` can be cut to `['F1']`; the scratch run returned `armed:true` with F2 valid-present, F3 `nativeCtor:'mismatch'` and F21 unmeasured (script `scratchpad/sec25/adv.js`). Fix: never call methods on caller arrays; read each index once through its property descriptor; require `getPrototypeOf === Array.prototype`; make `decideFromSnapshot` loop over `CANONICAL_REQUIRED_REALM_IDS`; add these cases to Sweep C. Inputs that failed closed correctly: `vm`-context records, `toJSON`, inherited and Proxy records, NaN/BigInt values, `__proto__` ids, 1e6 records; frozen records and `vm` arrays are accepted.
- **M-25: CLOSED as a DESIGN finding.** The executed gate is honest. Mandatory implementation gates that stay: F16 to F21 as real measurements; the worker WebSocket case FW-1; OPEN-BID-27 product identity; a browser that lacks SharedWorker; the GitHub-hosted runner.
- **m-87, m-88, m-89, m-90: CLOSED.** The `git grep` hits are edits-JSON "old" strings, disposition tables or correction notes; no live contradiction.

## New minors
- **m-91:** `Object.freeze(module.exports)` runs before `module.exports` is reassigned, so the exports are not frozen and `decide` can be swapped (confirmed). Normative text, rev 28 line 72.
- **m-92:** `decideFromSnapshot` with empty `requiredIds` returns `armed:true`, and that function is exported.
- **m-93:** MT-1 is not independent: it lives in the harness and checks results against the harness's own recorded `expected*` fields, not the contract, so it would not have caught the CONF-03 FC1 wrong expectation; it also skipped 34 of 237 rows, including the `isProxy` rows. The consolidated CONF-04 claim of an "independent" MT-1 overstates it.
- **m-94:** getters on `requiredIds` indices run caller code.
- **m-95:** the Sweep D "preceding/following" reading for F1/F21 was the agent's own interpretation; the Architect should state it.

## Evidence honesty and checks
The CONF-04 consolidated doc correctly says the popup gesture was not independently verified (`browser-harness.js:346-393` uses `page.click`, but the raw results do not record how the popup was opened). Held: counts 98/89/6/3; no 40-hex SHAs in rev 26 to 29; deletions since `9bedb43` are replaced by stricter wording; no src/tests/CI changes; O-1 untouched; M-23/M-24 closed. Not executed: browser rows (no re-run).

## Owner decision
Whether the process-integrity residual covers caller-controlled `requiredIds`. Security recommends no: fix it.
