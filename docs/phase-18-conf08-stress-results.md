# Phase 18 - CONF-08 focused stress and export-capture tests (rev 32 reference)

**Status: PASS for what is stated; one honest limit on stack exhaustion.** Reference `decide32.js` (sha256 prefix `e197ec58f6084f03`) is unchanged. Test code is scratch (not tracked). Node 22.19.0 and 24.21.0, macOS arm64. Rows FC19 to FC21 extend the rev 32 matrix; they are not yet in `phase-18-rev32-expectations.json`.

| Row | Case | Result (both Nodes) |
|---|---|---|
| FC19a-b | record value that references itself; array that contains itself | refused (`record-value-type`, `record-not-plain-object`), no throw, 0 ms |
| FC19c-d | 200000-deep nested array / object as a record value | refused in about 1 ms, no recursion, no throw |
| FC19e | 5000-deep Proxy chain as a record | refused (`record-proxy`), no trap run |
| FC19f-g | sparse array with length 1e9; 1025 records | refused (`input-length-excessive`) before any allocation |
| FC19h | 50 MB string value | refused (`record-value-enum`) |
| FC20 | decide called at 1001 stack depths between 4000 and 11000 frames, valid and invalid input | no wrong decision, no arm on invalid input; the valid input armed except 1 `RangeError` (Node 22; none on Node 24) |
| FC20b | 301-depth window around the measured overflow boundary | 0 wrong decisions, 0 arms on invalid input; the overflow itself could not be reproduced inside the window (stack frame size varies with JIT tier) |
| FC21 | capture-once export | export frozen with the single key `decide`; strict assignment, `defineProperty` and `delete` throw `TypeError`, sloppy assignment is ignored; `require` returns the same frozen object; a `decide` reference captured at the consumer's load is unaffected by later assignment attempts or by deleting the require cache entry (a fresh `require` after cache removal is a different instance) |

**Limits, stated plainly**
- `decide` has no try/catch, so engine stack exhaustion inside it surfaces as a `RangeError` (observed once, on Node 22). It never produced a wrong or armed decision, but "total" does not extend to engine resource exhaustion. **Rule for the future gate:** call `decide` inside a try/catch and treat any exception as `shared_worker_block_unverified` (refuse). This is a caller requirement, not a guarantee of the module (logged as minor m-99 for Security).
- Capture-once is a consumer rule: the gate module must `const { decide } = require(...)` once at its own load and never re-require. There is no product code yet, so this is verified against the module contract only. Pre-load or require-cache compromise before the consumer captures `decide` is the documented process-integrity boundary.
