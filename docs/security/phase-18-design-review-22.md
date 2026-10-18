# Phase 18 Security Design Review 22 (SEC-23)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `96b1b84` on `docs/phase-18-architecture` (rev 23, on top of `ba8421d`). Scope: the rev 23 patch and edits JSON, `git diff f9ca928..96b1b84`, and the four measurement documents (SPIKE-W, SPIKE-FS, H-8, Linux). The Security Engineer role is read-only; the coordinator saved this text from the reviewer's report in condensed form without changing findings. Status: **PARTIAL**.

**Verdict: APPROVE WITH CONDITIONS, PARTIAL. Blockers: 0. Majors: 1 (M-25). Minors: 5 (m-82 to m-86).** The design gate stays PARTIAL until the implementation checker and SPIKE-W2 run. Accepting any residual risk is the owner's decision.

## Evidence (read-only, all on `96b1b84`)

| Check | Result |
|---|---|
| C6-T ids, counted with `grep -oE '^\| X[0-9]+ '` (and for `P`, `W2-`) | 27 X rows, 5 P rows, 16 W2 rows; matches "27/5" and "16 cases" |
| Stale counts across all docs (quoted patterns) | Rev 20/21/22 hits are marked superseded or are history; rev21:52 and rev22:54 are marked SUPERSEDED. No live stale count |
| JSON validity | Edits JSON and AC JSON parse. Counts 98/89/6/3; deferred 11 and 5 |
| 40-hex strings in the diff | Only three action pins inside the proposed workflow in the Linux findings doc (supply-chain practice, not git SHAs). Image digests are truncated |
| m-79 | Fixed |
| m-81 | Fixed (rev21:50 superseded header) |
| m-80 | Partly regressed (m-83) |
| M-23 / M-24 | Not reopened; nothing weakened |
| Reason-code naming | Flagged for the owner correctly in B.3 |
| Worker WebSocket | W2-15 and W2-16 labelled UNMEASURED; the pilot refuses to arm until measured. Correct |
| Not executed | Any browser or CDP measurement, the checker, the GitHub-hosted runner job |

## Findings

- **M-25 (Major, P2; condition before SPIKE-W2 is accepted).** Layer 2 (CDP auto-attach paused on start) is described as "the actual control", but no B.5 case tests it alone. The inversion fixtures disable both layers at once; if Layer 1 holds, every W2 case passes even with Layer 2 broken. B.4 makes arming depend only on the B.5 cases, so unlisted realms would rely on an untested Layer 2. B.5 also drops cases rev4:134 listed (`data:` iframes, `document.write`) and omits `javascript:` URLs, `object`/`embed`, nesting depth of 2 or more, and re-inserted iframes. The multi-client `waitForDebuggerOnStart` case is untested: Playwright's own session might resume the paused target. Fix: run every case three ways (Layer 1 only, Layer 2 only, both off), add the missing realms, and add a case where a second CDP client resumes the target.
- **m-82.** W2-11 says "API ABSENT is not a pass", but B.4 requires MEASURED-PASS for every case, so execute mode can never arm. Define how an absent API is treated.
- **m-83.** AC-090 `components` names "rev 21 section C" as the single source and `phaseClauses` names "rev 20 section C"; both should point to rev 23 D.4.
- **m-84.** Contradicting text is live in rev 4: line 135 still says "the same case with `SharedWorker`" is a counted denial; line 134 item 3 still says "documented in limitations.md" and "defence in depth", which conflicts with B.4's "never a documented residual"; line 132 stubs the dedicated `Worker` constructor, against "network layer only".
- **m-85.** Two overclaims: B.1 item 4 and rev4:131 list `data:`/module workers as measured without SPIKE-W's "by pattern" caveat, and EventSource had one rep, not three; B.2 says the binding notifies "synchronously" but `exposeBinding` is async, and the stub must capture the binding in a closure at install.
- **m-86.** Admission is contradictory: rev4:178 says Linux "none admitted", C.2 says "Rev 23 adds no id", C.3 says Linux and CI refuse; E.2.1 admits tmpfs `0x1021994` (ephemeral roots only, approvals refused: correct scope) on Docker Desktop evidence; E.2.3 denies ext4 that same Docker Desktop evidence ("target runner required"). APFS 26 matches rev4:177 and HFS+ 25 is observation only.

## Owner items

Whether Docker Desktop evidence is enough to admit tmpfs (and the ramfs-ambiguity residual); `shared_worker_blocked` vs `POLICY_*` naming; how a W2-11 "API ABSENT" result is treated; the GitHub-hosted ubuntu x64 runner is still required and unmeasured.
