# Phase 18 Security Design Review 27 (SEC-28)

Reviewer role: Security Engineer (`claude-opus-5-5`), read-only. Revision reviewed: rev 33 at `183e341`. Condensed by the coordinator from the reviewer's report without changing findings. Status: **DONE**.

**Verdict: APPROVE WITH CONDITIONS (design only). Blockers: 0. Majors: 1 (M-1, overstated claim). Minors: 4 (m-100 to m-103).**

Verified: the gate text embedded in the rev 33 addendum is identical to the reference file; the `decide32.js` hash is unchanged. The reviewer's own bypass harness found:

- **M-1 (major, overstated).** If `decide` returns a lying but well-shaped frozen arm, the gate passes it. A Proxy over a frozen arm target is also passed, and the gate returns the Proxy itself; its traps ran 7 times. So rule 3 ("a Proxy" is refused) and ADR-0053 ("a lying `armed:true` would arm") claim more than the gate does: it checks shape only. The FC22f Proxy case used an empty target. Fix options: correct the claim, or detect Proxies with a captured `util.types.isProxy` and return a rebuilt frozen copy.
- **m-100.** The gate turns the FW-2 reason into `decision-result-malformed`. Still a refusal, but it breaks the stated precedence and the CI reason-set match; the design must say where FW-2 is evaluated.
- **m-101.** A live patch of `Object.hasOwn` plus an `Object.prototype.value` getter after load lets an accessor-backed result arm. The "only captured intrinsics" comment is false for the gate. Tracked as MG-3.
- **m-102.** Symbol and non-enumerable keys pass the shape check despite "wrong key count".
- **m-103.** For F19, Playwright's `frame.url()` is `""`; `about:blank` is `location.href`.

Rulings: the FW-2 fail-closed rule is sound, follows the owner rule and matches the raw data. The worker realm-table rows and the OPEN-BID-27 wording are accurate. Nothing is weaker than rev 32 and nothing implies customer availability.

Mandatory gates: MG-1 to MG-7, MG-9 and MG-10 are unmet. MG-8 clears only once M-1 is corrected.
