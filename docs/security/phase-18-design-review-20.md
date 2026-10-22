# Phase 18 Security Design Confirmation 20 (SEC-21)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `41af699` on `docs/phase-18-architecture` (rev 21 on top of `3763891`). Scope: focused confirmation of the rev 21 delta (`cdc75ee..41af699`). The Security Engineer role is read-only; the coordinator saved this text from the reviewer's report in condensed form without changing findings. Status: **PARTIAL**. The design review stays PARTIAL until the implementation checker runs.

**Verdict: BLOCK (design gate). Blockers: 0. Majors: 1 (M-24). Minors: 3 (m-76, m-77, m-78).** The block comes from one wrong row range; the fix is one edit. O-1, m-73, m-74 and m-68 are closed. m-75 is mostly closed but left one contradiction (m-77).

## Confirmation points

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | m-73 | CLOSED in the design | `GitInfo.js:21` is the `execFile("git", argv, ...)` call; `:34` is the default value of the destructured parameter; `:39` and `:44` forward it to `runGit` with literal argv. The file is unchanged since 651ccfa. Rev 21 C3.4b and C3.4b.1 cover parameters, default parameters, assignments, object properties, returns, received-vs-invoked, never-invoked and unanalysable escapes (all fail closed). AC-090 and OWNER-14-Q1 match |
| 2 | m-74 | CLOSED | `exitCodes.policyNote`, open item EXIT-PRECEDENCE and threat-model item 15 give the rev 6 order unchanged. Residual 21 keeps its scope and is not accepted. `neg-merge-exit-precedence-matrix` is a table-driven test over every ordered pair (18F) |
| 3 | m-75 | PARTIAL | No live "fourteen" citation remains; the only ones are labelled verbatim 18P quotations. OWNER-13-Q1, OWNER-14-Q1, OWNER-14-Q2 say resolved at the end of `state`. Gap: m-77 |
| 4 | m-68 | CLOSED | No live AC entry cites the old commit or the tag. The 18P record (lines 263 and 423) marks those mentions as history only: "this copy, not that commit, is the authority" |
| 5 | O-1 | Text matches the owner decision | TOKEN-REFUSAL, `planInvalidNote`, the AC-084 carve-out (one file only) and patch B.1 to B.6. `falcon.js:50` is the dotenv load. Gaps: m-76, m-78 |
| 6 | M-23 / counts | FAIL on fixtures | Counts hold at 98/89/6/3. Fixture table: M-24 |
| 7 | Six owner verification points | Hold | No source, `package.json` or workflow changes in `cdc75ee..41af699` |

## Findings

- **M-24 (MAJOR, P1).** C6-T is declared the only source of fixture counts, but it lists 22 inversion fixtures (X1..X9, X10, X11..X16, X17..X22), not 25. Rev 20 required 19 (rev20-patch.md:91) and the table has slots for only 16 of them. No other document restates the count, so building to the table would drop three M-23 inversions, and the checker would still pass when it checks itself against the table. Fix: change the row to X17..X25 and map every rev 20 fixture to an id. Verify: the table enumerates 25 + 3.
- **m-77.** AC-098 (ii) still says rev 20 section C "is the only section any criterion cites", while AC-090 cites rev 21 C6-T and says it is the same section AC-098 (ii) cites.
- **m-76.** The design never says how the refusal message is emitted. The required `Logger.error` appends to `reports/execution.log` (`utils/Logger.js:107`, `:142` to `:145`), which breaks "no other filesystem access" before the refusal. `neg-token-refusal-order` would not catch it. Fix: name the channel (stderr) and assert that no file write happens before exit.
- **m-78.** The carve-out allows two occurrences of the key, but its pattern (one frozen array read by both refusal sites) produces only one. Specify exactly where each occurrence is allowed.

## Prototype (scratchpad only, `proto.js`, `node proto.js <repo>`)

Precedence string identical in all 4 files: pass. 156 ordered pairs checked: 17, 16, 15 and 18 each beat 13. GitInfo and `falcon.js` line facts: pass. The script's count of the C6-T ranges was wrong, so the 22 above is a manual count.

**Not run:** an AST resolver (no parser installed), every fixture, the token-refusal tests, the claims recount, Node 24 CI.

## Owner items

Accepting the risk of M-24 is the owner's call; it cannot be waived by an agent.
