# Phase 18 Security Design Review 32 (SEC-33)

Reviewer role: Security Engineer (`claude-opus-5-5`), read-only. Revision reviewed: rev 37 at `c1773b7` (docs only). Condensed by the coordinator from the reviewer's report. Status: **DONE**.

**Verdict: APPROVE WITH CONDITIONS for the docs-only commit; no P0/P1. Majors: 3 (m-116 to m-118). Minors: 6 (m-119 to m-124).** MG-8 is NOT cleared. Not eligible for push under the owner's zero-blockers-and-zero-majors rule.

Confirmed: the `gate37`, `supervisor37`, supervisor-test and `decide32` hashes match and both code blocks match the files exactly; `gate37` differs from `gate34` only in the token; the no-sandbox correction is real (`coreBundle.js` lines 44764 to 44765); the escapes list is empty.

Majors:
- **m-116:** rev 37 sections 1 and 9 claim "dedicated worker wss: denied ERRORED". The raw `gapA` has only `dedicated-wss-allowed`; the only denied wss result is from the page. The TLS control proved `tls_http` counting, not `tls_ws_upgrade`.
- **m-117:** production code can rebuild `gate37` with `Module._compile` using names built at run time and obtain an arming gate (observed). CI checks 1 to 4 miss this; MG-13 must also refuse `vm`, `eval`, `Function`, `_compile` and `module.constructor`.
- **m-118:** an arm plus child status 1 maps to 18, so test failures are reported as refusals; a verdict written before an `exit` hook still gives 0 (observed), so the status check is not load-bearing.

Minors: **m-119** a grandchild holding fd 3 forges a verdict after a silent child exit, giving 0. **m-120** the SIGTERM timeout can be ignored (a 3 s timeout returned at 9 s) and grandchildren are orphaned. **m-121** stdout and stderr are thrown away and their 1 MiB cap causes false refusals. **m-122** a child's SIGUSR1 opened the supervisor's inspector, and `NODE_OPTIONS` is inherited. **m-123** the NETW-01 findings still omit no-sandbox. **m-124** the no-exemption scan has no defined pattern.

Closure: m-108 closed for in-child hooks, but the fd-3 boundary needs m-118 to m-122. m-109 partial. m-110 partial. m-111 closed (MG-17 owner decision). m-112 and m-113 honestly unmeasured, acceptable for a design gate. m-114 open. m-115 closed.

Open gates: MG-4, MG-9 and MG-11 to MG-17.
