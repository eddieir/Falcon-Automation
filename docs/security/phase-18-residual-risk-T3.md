# Phase 18 residual-risk record T3 - disallowed builtin module loaded by an authorised first-party change

**Status: OPEN - NOT ACCEPTED.** No owner acceptance, downgrade or closure has been given. This record states the risk; it does not decide it. Severity below is a proposed rationale for the owner, not a rating Security has assigned.

Sources: `phase-18-rev42-patch.md` (row T3, section 8 rows f01 to f07), `phase-18-rev41-patch.md` (forms rules), `phase-18-design-review-36.md` to `-38.md`.

| Field | Content |
|---|---|
| **Threat** | Shipped code loads a Node builtin that the design treats as disallowed (for example `child_process`), or loads code dynamically, by a form that no static check recognises. |
| **Affected assets** | The process-integrity boundary around the test process: the supervisor's assumption that code in the test process does not spawn processes, replace the process image or reach loader internals. Also any property of the run that depends on that assumption. |
| **Prerequisites** | An **authorised** first-party change (Scope A), or any untrusted code already running in the process (outside Scope A, covered only by C5). |
| **Exploit conditions** | A loader call spelled as `arguments[1]('child_process')`, `(0, require)('child_process')`, `require?.('child_process')`, `this.module.require(...)`, or one of the builtin-loading paths (`process.getBuiltinModule`, `_linkedBinding`, `process.binding`, `process.dlopen`, `process.execve`, `module.require`, `process.mainModule`). Reference scanner output: f01 to f03 CLEAN, loading `child_process` on Node 22 (SEC-37); f04 to f07 flagged. A load-time `process.execve` replaces the process image. |
| **Existing controls** | Code review. The supervisor (C3) derives the exit code from a verdict line on a descriptor that a replaced image does not inherit (macOS, Node 22, per SEC-38; Linux and Node 24 unchecked). Environment allowlist. C2 for unauthorised change (unbuilt, independence unmet). The advisory scanner. C5 isolation for untrusted code (incomplete). |
| **Evidence** | SEC-37 f01 to f07; SEC-37 reachability probe (every builtin-loading path is reachable to in-process code on Node 22.19.0 and 24.21.0, macOS and Linux arm64); SEC-38 `execve` observation (macOS, Node 22). |
| **Severity rationale (proposed, not assigned)** | Impact is high if untrusted code can run, because loading `child_process` gives arbitrary process execution. Under Scope A, impact is limited to a first-party change that was reviewed; likelihood is low. The risk is unresolved because it cannot be prevented from inside the process. For untrusted code the rationale becomes "not covered": Scope A excludes it and Scope B is incomplete. |
| **Limitations** | No in-process control can stop code that is already executing; this is a measured fact, not a gap in a particular check. No Linux x64, runner or Windows evidence exists. |
| **Mitigation options** | (a) Accept as a review-carried residual under Scope A (owner decision; **not taken**). (b) Scope B isolation (network, process, PID and cgroup containment) for any workflow that could run untrusted code (C5; incomplete; separately tracked). (c) Evaluate a load-time observation check or Node's permission model as an additional layer (new mechanisms; owner review first; neither is a boundary). |
| **Affected gates** | MG-8 (not cleared), MG-13 (implementation not done; M-2 residual), M-2 disposition (claim correction accepted; residual open), and the C5 gate (incomplete). |
