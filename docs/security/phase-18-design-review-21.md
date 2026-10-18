# Phase 18 Security Design Confirmation 21 (SEC-22)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `435c23b` on `docs/phase-18-architecture` (rev 22 on top of `41af699`). Scope: focused confirmation of the rev 22 delta (`74768d8..435c23b`). The Security Engineer role is read-only; the coordinator saved this text from the reviewer's report in condensed form without changing findings.

**Verdict: APPROVE WITH CONDITIONS. Blockers: 0. Majors: 0. Minors: 3 (m-79, m-80, m-81). The design review stays PARTIAL until the implementation checker runs.** Accepting any residual risk is the owner's decision.

## Evidence

| Check | Result |
|---|---|
| M-24 | Closed. Script `scratchpad/c6t.py` (`python3 -I`): rev 22 table has X=25, unique, contiguous 1..25, P1..P3, no duplicates. The rev 20 C6 list's 14 rev-19 items each map to one id (X3..X7, X17..X25), plus explicit X1, X2, X8, X9, X10: 19 ids, matching "X1..X10 + X17..X25". The rev-19 Origin column also gives 14. The checker self-asserting count and id set is stated in B and AC-098 |
| m-77 | Closed. AC-098 (ii) and AC-090 both cite rev 21 C and C6-T; the "only section" claim is gone (the one remaining text in AC-090 is a negation) |
| m-76 | Closed. `utils/Logger.js:107/142/145` confirmed (logFilePath, mkdir, appendFile). AC-084 requires `process.stderr.write` and says `Logger.error` MUST NOT be used. The order test asserts exit 2, no file write, stderr only |
| m-78 | Mostly closed. AC-084 `occurrences: 1`, exactly one occurrence in one file; inversion test fails on a second occurrence. One stale line remains (m-79) |
| Weakening | Counts confirmed by script: 98/89/6/3. Removed lines are only the four targeted edits. M-23 not reopened. No live stale "fourteen"/"nineteen" outside the historical rev 19 to 22 patches |

## Findings (minor)

- **m-79:** `phase-18-rev21-patch.md` B.5 still says `neg-token-refusal-carveout` "(a third literal occurrence fails AC-084)". Should say "second".
- **m-80:** The AC-090 `components` field still names "rev 20 section C" as the check. Re-point to rev 21 C / C6-T.
- **m-81:** A second copy of the C6-T table remains in the rev 21 patch (lines 50 to 82). Its X10 is narrower (argv only), it collapses P1 and P2 into one row, and its line 82 obligation covers only X11..X16 and P3. Mark it superseded, or point to rev 22 B.

**Not executed:** the checker, all fixtures and controls, the token-refusal tests, the classification recompute, lint, sink analysis, and Node 24 CI. These remain mandatory 18D/18F gates.
