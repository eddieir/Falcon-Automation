# Phase 18 Security Design Re-review 18 (SEC-19)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `91e05b0` on `docs/phase-18-architecture` (rev 19 applied on top of `63f80e4`). Scope: `phase-18-rev19-patch.md`, `phase-18-rev19-edits.json`, and their effect on the AC JSON, plan, threat model, traceability, owner decisions and architecture document. This record supersedes SEC-18. It applies the owner decisions relayed during the task (OWNER-13-Q1, OWNER-14-Q1, run-token rejection, no tag, executable prototype); none is reopened. The Security Engineer role is read-only; the coordinator saved this text from the reviewer's report. The condensed form below keeps every finding, verdict and the prototype result table.

**Verdict: BLOCK for 18D and 18F. APPROVE WITH CONDITIONS for 18A (unchanged), 18B, 18C, 18E and DOC. Blockers: 0. Majors: 1 (M-23 still open). The owner's zero-blockers, zero-majors requirement is NOT met.** New minors: m-70, m-71, m-72. m-68 stays open.

Read-only. No browser, runtime, server or CI probe. Node was not run. Python 3 (`-I`) ran over the working tree and `git show` output. **Node 24 UNVERIFIED (H-8). Firefox and WebKit UNVERIFIED.**

## What the prototype executed

A Python model (scratchpad `reach_proto.py`, not committed) of rev 19 C1 to C7: a `ci.yml` `run:` parser, a shell simple-command parser with C3.6 semantics, C3.4/C3.5 leaf rules, C4 derivation with R1 to R4, a JS edge analyser (literal `require`, `require.resolve`, `import()`, `path.join`/`path.resolve` from literals and `__dirname`, `createRequire`, `child_process` by binding, `Worker`), a transitive walk from `falcon.js`, `main` and every production entry, a scan of all `src/**`, the fixtures, the clause-aware lint with inversions, and a regex sink scan. Two modes: AS-WRITTEN (rev 19 exactly) and REMEDIATED (plus shell builtins, committed-classification-equals-derivation check, environment-injection check).

**Not executed:** an AST parser (regex and paren matching only); receiver-type sink analysis; Playwright config-load resolution (modelled as an edge into `tests/`); the `child_process`-member-as-value rule proposed in M-23 item 2; any Node or CI run. **No current-tree run passed in any mode.**

| Run | Result |
|---|---|
| Inventory | 41 scripts and 33 `run:` steps. No lifecycle script. Bins: `allure`, `dotenv`, `pixelmatch`, `playwright` |
| C4 derivation vs Appendix A | 0 differences, 0 tie-breaks. 21 production scripts, 20 production steps |
| Current tree, AS-WRITTEN | FAIL (3): step 334 `true` (`ci.yml:335`); step 462 `set` (`:464`); `GitInfo.js:34`, where `childProcess.execFileSync` is passed as a value into `runGit(execFile, cwd, argv)` (`:21`) |
| Current tree, REMEDIATED | FAIL (1): `GitInfo.js:34` (proposed rule not implemented) |
| Production-reachable set | 84 modules; none under `tests/`, `scripts/fixture/`, `scripts/demo/`, `scripts/benchmark/` or `docs/demo/`. `src/**`-wide scan clean. Child processes: `git` with literal argv in both production-cycle scripts, plus GitInfo |
| 14 inversion fixtures | all FAIL as required, in both modes |
| Positive controls (`execFile("git", ...)` literal argv, const argv, parameter argv) | all PASS (parameter argv only in lenient argv mode) |
| X1 inline `NODE_OPTIONS="--require ./tests/x.js" node falcon.js` | PASS under AS-WRITTEN (wrong-pass); FAIL under REMEDIATED |
| X2 step 226 and `start` committed as `test` | PASS under AS-WRITTEN (wrong-pass); FAIL under REMEDIATED |
| X5 `healing:benchmark` committed as `test` | PASS under AS-WRITTEN; C4 derives `production` |
| X3 dynamic executable; X4 `path.resolve` relative to cwd; X6 production script reaching `scripts/demo/`; X7 variable node argv | all FAIL as required |
| HealingBenchmark | no module outside `tests/` requires it; no workflow reaches it; `:87` is not an edge |
| Sinks | `falcon.js` 370, 371, 402, 456, 457; `_performAction` 364, 366, 368; no production `scripts/` module reaches `playwright` |
| Lint | 0 hits. Token injected into a current clause or a no-phase requirement is caught; into a deferred clause, `prohibitedLiterals`, a wholly deferred criterion, or the requirement field of a mixed criterion is not |
| Claims baseline at HEAD | fails on day one in 7 files (m-70) |

## Evidence checked

- E1 AC JSON: 98 criteria, 89 Must / 6 Should / 3 Could. Phases: 77 none, 2 current (051, 084), 8 mixed, 11 `deferred-18P`. `mergeCondition`: 78 absent, 1 true, 8 objects, 11 false (equals `deferredIds`). No ID, priority, phase or `mergeCondition` changed since `0fbe099`.
- E2 Sentences lost since `0fbe099`: AC-083, 084, 089, 090, 098 equal or stricter except the AC-090 current-clause narrowing and the AC-098 (ii) root narrowing (M-23 items 3, 4).
- E3 m-66 edits present (threat-model items 9, 12, 14, 15, 23; plan lines 3, 55, 100; traceability m-27 row; AC-083 components; architecture line 561; residual 25a).
- E4 Plan 18B row: gate inside `_performAction`; `AIHealer.js` method at `:362`, export `:1134`, callers 337, 419, 586, 652.
- E5 Garbled text: AC-090 components and plan line 32 read "rev 18 section C, of rev 19 section C"; AC-084 still cites "rev 18 section C".
- E6 AC-090 live requirement: "every non-literal such edge in src/, scripts/ and falcon.js fails closed".
- E7 AC-089 requirement says exit 18 for identity drift; its current clause says exit 13 `POLICY_PLAN_IDENTITY_DRIFT`.
- E8 No `phase-18*` tag. `909d794` is contained only in the local `docs/phase-18-architecture` branch.
- E9 README, `src/`, `scripts/`, `.github/`, `package.json`, `.env.example`, `falcon.js` have zero token or literal hits. `docs/pilot/` has no tracked files.

## M-23 (Major): still OPEN, narrowed. The check does not pass the current tree as specified

Same failure mode as M-22/M-23: the check either fails on day one or the implementer picks the rule. It is the only technical control behind owner check 4. Likelihood certain for items 1 to 3 (each run).

Validated by execution: roots and the 41/33 inventory; C4 derivation matches Appendix A; all 14 fixtures fail and positive controls pass; the `scripts/fixture/**` target works; HealingBenchmark meets the four conditions; C3.7 removes the need to rewrite `parallel.js` and `env.js`.

Open items:
1. **Shell builtins.** `|| true` (`ci.yml:335`) and `set -o pipefail` (`:464`) in production steps 334 and 462 are neither on `externalExecutables` nor among the C3.6 constructs; C5 and Appendix A.2 omit them.
2. **GitInfo shape.** `execFile("git", argv)` at `:21` calls an injected parameter; the real `child_process` member is passed as a value at `:34` with parameter argv. C3 has no rule for a `child_process` function passed as a value, nor for how C3.4 condition 2 applies to non-literal argv. A fail-closed binding-tracking resolver fails here; a name-matching one passes by luck and would also misread the 7 production-reachable `RegExp#exec` sites.
3. **Gate text states the rejected scope.** AC-090's live requirement (E6) and AC-084 ("fails closed on any command it cannot statically resolve") contradict C3.7; `parallel.js:92,150` and `env.js:154,239` fail under that wording (X6). AC-090's current clause narrowed `src/**` from "no file under src/" to production-reachable modules, weakening it for unreachable `src/` modules.
4. **Wrong-pass: the committed file is the authority and nothing checks it.** Labelling a production entry `test` passes (X2), a de facto exemption. The patch's own `healing:benchmark`-as-`test` alternative contradicts C4 (X5). Inline `NODE_OPTIONS`/`NODE_PATH` assignments are skipped by C3.6 (X1); step, job and workflow `env:` blocks are never read.

Remediation: (a) closed builtin list `set` (option flags only), `true`, `false`, `:`; explicitly exclude `.`, `source`, `eval`, `exec`, `command`, `builtin`, `trap`. (b) Identify `child_process` calls by binding; a member passed as a value resolves only if, within the module, every call of the receiving parameter has a literal listed executable and argv resolving to literal arrays at every call site; otherwise fail. No production edit needed. (c) Align AC-090 requirement and AC-084 to C3.7; keep `tests/**` and `scripts/fixture/**` forbidden for all of `src/**` regardless of reachability (true today per the src-wide scan). (d) The check recomputes C4 and fails whenever a committed value differs from the derived one; drop the `healing:benchmark`-as-`test` alternative or make it a rule; fail production entries on `NODE_OPTIONS` or `NODE_PATH` in inline assignments, `env` arguments, `env:` blocks and `.npmrc` `node-options`. (e) Add fixtures for X1, X2, the GitInfo shape, `|| true`, `set -o pipefail`. Verification: the checker passes the current tree with zero exemptions; the 14 fixtures plus new ones fail; controls pass; a recorded CI run.

## m-70 (Minor, new; m-65(c) not closed): claims baseline not reproducible, fails on day one

The committed `lintBaseline` holds `63f80e4` numbers, not recomputed when rev 19 was applied. HEAD increases in 7 files (AC JSON 90 to 128, plan 83 to 91, threat model 47 to 54, architecture 80 to 82, traceability 65 to 66, owner decisions 38 to 40). `docs/security/phase-18-design-review.md` (4 hits) is neither excluded by the `-*` glob nor in the baseline. Security's recount at `63f80e4` gives 91/91/82/67/49/40, not 90/83/80/65/47/38; the overlap rule is undefined (`approver` inside `PILOT_APPROVER`; `RunToken` inside `RunTokenEmitter`). The token list in the AC JSON inflates its own count. Remediation: define the count as a case-insensitive, leftmost-longest, non-overlapping alternation; exclude the `lintBaseline` key or move the baseline to a file excluded by name; fix the exclusion glob; recompute with a committed script at the applying commit.

## m-71 (Minor, new): AC-089 requirement contradicts its current clause on the exit code

The clause-scoped lint cannot see a mixed criterion's requirement text (prototype inversion f). Fix the requirement; reword section 1's "one by-design refusal code" to allow the exit 13 policy refusal. Exit 13 for the permitted-element swap is accepted (zero requests, distinguishable from 18) provided its merge rank is documented next to residual 21. Leftover from m-66 and m-67.

## m-72 (Minor, new): the owner's run-token rejection is not yet in the design

Owner decision: reject `PILOT_APPROVAL_RUN_TOKEN` with exit 2 before any browser, filesystem or target access. At `91e05b0`: AC-084 `prohibitedLiterals` and the claims grep (no blanket in `src/`) would fail on the refusal code itself; plan line 100 and section B say "nothing reads one"; exit 2 is also `planInvalid` and shard-merge rejection. Required design text: an exactly scoped refusal site (one file, one pattern) with an inversion test, written into AC-084 and the claims grep; a mandatory reason code; presence semantics including set-but-empty; the variable named but its value never echoed or written to a log, report, dashboard or receipt; an ordering test (refusal before browser, filesystem or target access); the rejection stated in `docs/pilot/limitations.md`.

## m-68 (Minor, carried; owner decision: no tag)

Still depends on `909d794`: AC-090's requirement ("preserved verbatim at git revision 909d794"), seven `deferredTextRef` keys naming the commit and the proposed tag, and rev 18 A4. `909d794` is reachable locally only from a local branch. The item closes when the tracked self-contained 18P documents land and every reference points to them. No requirement may depend on a tag or an orphanable commit.

## SEC-18 findings: status

M-21 closed (re-verified). M-23 open. m-65 (a), (b) closed by execution; (d) stated and surfaces clean; (c) open as m-70. m-66 closed (leftover m-71). m-67 closed. m-68 open. m-69 (a) to (e) closed in design; sinks were scanned by regex, receiver typing not prototyped.

## The owner's six verification points

1. No writer reachable: PASS in design; condition m-72 (refusal-only reader, not a writer).
2. No consumer reachable: PASS in design; condition m-71.
3. No dormant transport reachable: PASS (carried; the `src/` route and request check not re-run).
4. Fixture or research code cannot enter production graphs: tree state PASS by execution; the control FAIL (M-23).
5. Refusal before click, submission, network, provider or healing: PASS in design; condition m-71.
6. Public claims describe refusal only: PASS for public surfaces (E9); conditions m-70 and m-72.

Repository-wide stale-claim `git grep` (excluding design reviews and rev patches): no violations remain (architecture, AC JSON data-only hits, traceability, owner decisions, plan, research document, threat model; `design-review.md:21` history, see m-70).

## Owner items

- OWNER-13-Q1: decided (m-51 and AC-092 deferred with 18P); the AC JSON still says OPEN and must be updated.
- OWNER-14-Q1: decided (list is classification data under the validation conditions, not an exemption); the JSON still says OPEN. M-23 item 2's argv rule is part of the conditions that must be validated.
- OWNER-14-Q2: (1) fixture server in place acceptable (F14); (2) `healing:benchmark` as `production` acceptable, conditions met by execution, the `test` alternative needs a C4 rule (M-23 item 4); (3) tag superseded by the no-tag decision and not acceptable as a dependency (m-68).

## Nits

C5 says 22 production / 19 test scripts; the correct figures are 21 and 20 (the A.1 table is right). `demo:record` is R4 only, not R3. Garbled citations (E5). The plan status line says "m-65 to m-69 all closed". Add `-p`/`--print` to the flag list. Apply the C3.4 argv conditions to `npx <bin>`. A relative `Worker` path and `path.resolve` built from literals are both cwd-relative: say they fail closed.

## Hypotheses (not verified)

H-b answered for the require graph and workflow invocation. H-c unmeasured. H-d overtaken by the no-tag decision.

## Carried, not accepted

m-21, m-23 (UNVERIFIED), m-24, m-26, m-27 (now exit 18 or 13), m-28, m-30; H-1, H-3, H-7; H-8 (Node 24 UNVERIFIED); R-8, R-10; residuals 4, 13, 15, 21, 24, 25, 25a, 26; new m-70, m-71, m-72. Nothing here risk-accepts anything; acceptance belongs to the owner alone.

**Final: BLOCK (M-23 open; confirmed by the prototype run). Blockers 0, majors 1.**
