# Phase 18 Security Design Review 33 (SEC-34)

Reviewer role: Security Engineer (`claude-opus-5-5`), read-only. Revision reviewed: rev 38 at `1c0063a` (docs only). Condensed by the coordinator from the reviewer's report. Status: **DONE**.

**Verdict: APPROVE WITH CONDITIONS. Blockers: 0. Majors: 0. Minors: 4 (m-125 to m-128).** Eligible for push under the owner's zero-blockers-and-zero-majors rule. MG-8 is NOT cleared until m-125 to m-128 are closed.

Confirmed: the document text matches `supervisor38.js` exactly; the `supervisor-test38`, `gate37` and `decide32` hashes are right; the supervisor test passes all 26 rows on Node 22 and 24 with the timeout row at 1507 to 1508 ms; nothing is weakened and there is no availability claim.

Attacks rerun on both Nodes: 50 MB stderr, split verdict, unterminated verdict, SIGUSR1 flood, `_debugProcess` and a `NODE_OPTIONS --require` preload all behave correctly. 0 of 300 false refusals in the exit-versus-data race. Port 9229 stays closed. A grandchild writing fd 3 after the child exits gives 18; writing during the run gives 0, which is the documented process-integrity boundary.

Minors:
- **m-125:** the MG-13 refusal list misses Worker `eval:true`, `inspector` `Runtime.evaluate`, `.constructor`/AsyncFunction, `Reflect.construct`, computed `globalThis[...]`, `module.register`, `require.cache` and write-then-literal-require. It is name-based, not an allowlist, and "supply-chain" overclaims. Fix: a builtin-module allowlist.
- **m-126:** a `detached:true` (setsid) grandchild outlives the process-group SIGKILL (confirmed). "No child process survives" overclaims and the pgrep check misses it.
- **m-127:** the m-124 scan pattern misses `Object.freeze({createGate})`, `exports.createGate=` and reordered keys.
- **m-128:** the "bounded buffers" comment is untrue (`MAX_CAPTURE` is unused). `LD_PRELOAD` and `DYLD_*` are not scrubbed (hypothesis, not measured).

Closure: m-116 closed (matches raw `gapA`). m-117 partial (m-125). m-118 closed. m-119, m-121 and m-122 closed. m-120 partial (m-126). m-123 closed. m-124 partial (m-127).

Open gates: MG-8 pending m-125 to m-128; MG-12 needs CI and Linux; MG-13 needs a checker; MG-15 needs the wss controls. MG-4, MG-9, MG-11, MG-14, MG-16 and MG-17 unchanged.
