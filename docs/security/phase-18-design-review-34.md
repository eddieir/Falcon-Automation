# Phase 18 Security Design Review 34 (SEC-35)

Reviewer role: Security Engineer (`claude-opus-5-5`), read-only. Revision reviewed: rev 39 at `50020ac` (docs only). Condensed by the coordinator from the reviewer's report. Status: **DONE**.

**Verdict: APPROVE WITH CONDITIONS. Blockers: 0. Majors: 0. Minors: 5 (m-129 to m-133).** Eligible for push under the owner's zero-blockers-and-zero-majors rule. MG-8 stays open until these are closed.

Confirmed: all hashes match and the document's supervisor text is verbatim.

Minors:
- **m-129:** MG-13 gates only `require`/`import`. `process.getBuiltinModule('node:vm'|'child_process')` loads refused builtins with no require (confirmed on Node 22 and 24). `process._linkedBinding` is not refused; `module.require` and `require.main.require` are not covered.
- **m-130:** the scan misses `module.exports['createGate']=`, a comment before `{`, a nested object before the key (so "any key order" overclaims), ESM `export {createGate}` / `export default` (.mjs and .ts are in scope) and getter forms. The R7 exemption matches on basename only, so "zero-exemption" is not true. MG-13 does not inspect exports.
- **m-131:** `OPENSSL_CONF` is not scrubbed; it reaches the child through the supervisor and Node tries to load a native provider from it (confirmed). `LD_AUDIT`, `GLIBC_TUNABLES`, `GCONV_PATH` and `MALLOC_*` are also unscrubbed (read from code; not run on Linux).
- **m-132:** a detached grandchild holding stdout or stderr keeps the supervisor alive after it resolves (4.7 s measured, the grandchild's lifetime). The verdict is still correct.
- **m-133:** SV27 takes the maximum over reps, checks cleanup on the last rep only and checks `why` on rep 0 only. On Linux `pgrep -f` also matches the sh wrapper.

Closure: m-125 partial (m-129). m-126 closed. m-127 partial (m-130). m-128 closed (m-131 extends the scrub list).

Open gates: MG-8 pending m-129 to m-133; MG-1, MG-4, MG-9 to MG-17 unchanged.
