# Phase 18 Security Design Review 31 (SEC-32)

Reviewer role: Security Engineer (`claude-opus-5-5`), read-only. Revision reviewed: rev 36 at `52e3c94` (delta `538cf83..52e3c94`, docs only). Condensed by the coordinator from the reviewer's report. Status: **DONE**.

**Verdict: APPROVE WITH CONDITIONS on the framing; no P0/P1. Majors: 4 (m-110 to m-113). Minors: 2 (m-114, m-115).** MG-8 stays open until the majors are fixed. Not eligible for push under the owner's zero-blockers-and-zero-majors rule.

Rulings that hold: FW2-C6 is framed honestly (the gate still refuses with `fw2:unmeasured`, exit 18; no bypass flag; ADR-0054 not weakened; nothing implies customer availability; nothing weaker than rev 35). The raw data supports "0 escapes": the denied fixture's cumulative counter shows only `http=1`, the `/counts` self-check. The Linux reconciliation is accepted: 6 of 6 swap-restore runs show the pinned executable, uid 0 and `--no-sandbox`, so refusing is correct.

Majors:
- **m-110:** rev 36 overstates the positive controls. Only the dedicated worker and the page `ws`/`wss` have an allowed case that opened. Nested, blob and module workers were only tested against denied destinations, which proves nothing if those workers never started (the FW2-C1 lesson). The denied fixture has no TLS listener, so `tls_*=0` shows nothing. The bypass battery tested a 187-line test proxy, not a production proxy.
- **m-111:** NETW-01 ran as root with an explicit `--no-sandbox`, and neither the rev 36 document nor the NETW-01 findings say so. That breaks rev 36's own rule 2.2.4.
- **m-112:** C6-O1 accepts a per-run token "echoed by the proxy", which can be replayed or spoofed. It should require challenge-response with a key that is not in the browser container.
- **m-113:** a verified-then-changed environment goes undetected. Only proxy liveness is re-checked per step; the route table, canaries and the browser's proxy config are not, and a fixed canary list can be blocked selectively.

Minors: **m-114** the hostname allowlist does not check resolved IPs or DNS rebinding. **m-115** the proxy status port 3129 is reachable from `falcon-iso`.

Prior findings: **m-108 NOT CLOSED.** On Node 22, patching `process.reallyExit`, an `'exit'` listener that sets `exitCode = 0`, and patched `listeners`/`listenerCount` each pass all four integrity checks and still exit 0; the checks need intrinsics captured at install time and coverage of the exit path. No arm path was found. **m-109 PARTIAL:** the literal check is defeated by building the string at runtime; it is acceptable only together with MG-13, and MG-13 must refuse dynamic requires.

Gates: MG-1 to MG-16 open; MG-8 and MG-12 need the fixes above.
