# Phase 18 Security Design Review 28 (SEC-29)

Reviewer role: Security Engineer (`claude-opus-5-5`), read-only. Revision reviewed: rev 34 at `0418106`. Condensed by the coordinator from the reviewer's report. Status: **DONE**.

**Verdict: APPROVE WITH CONDITIONS (design only). Blockers: 0. Majors: 0. Minors: 2 (m-104, m-105).**

The gate text in the rev 34 document is byte-identical to the reference (sha256 prefix 92ad5650); `decide32.js` is unchanged (prefix e197ec58); the loader differs only in its last line. Reruns of the earlier bypass attempts adapted to the new design: a Proxy over a frozen arm is refused with 0 traps run; accessor, setter, non-enumerable, symbol, arguments and async results are refused; post-load patches had no effect on the gate; hostile thrown values were touched 0 times.

- **m-104 (confirmed):** the gate is not total when the stack is nearly exhausted. After `decide` was entered, a `RangeError` escaped the gate 17 to 22 times per 5 sweeps on Node 22 and 24, with 0 conversions. It never armed. The rule "any exception becomes a refusal" and MG-1's "converted when it occurs" were overstated. Fix: say `gateDecide` may throw and map any throw from it to exit 18 at the process boundary, with a test.
- **m-105:** the test loader writes the arming factory (and `contained-for-test`) next to the production module. It must be test-only, excluded from the package, with a CI check. The production surface does not leak it. Nit: the `gateDecide` function object can be extended; no effect on behaviour.

Closure: M-1, m-100, m-102 and m-103 closed; m-101 closed in the design (implementation stays with MG-3). Ruling: MG-1 is not honest as "Met"; record it PARTIAL (the injection runs a stand-in function at shallow depth, not `decide32`).

Remaining mandatory gates: MG-1 to MG-7, MG-9 and MG-10; MG-8 clears after the m-104 wording (applied in the rev 34 document after this review).
