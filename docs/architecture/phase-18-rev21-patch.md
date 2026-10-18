# Phase 18 architecture patch — revision 21 (ARCH-21)

Base: architecture rev 2 plus the rev 3..rev 20 patches, at `3763891` on `docs/phase-18-architecture`.
Inputs: SEC-20 (`docs/security/phase-18-design-review-19.md`), owner decisions on O-1, m-73, m-74, m-75 and the m-68 residual.
Scope: design text only. No production source file, `package.json` script or workflow step is edited by rev 21.
Machine-applicable edits: `docs/architecture/phase-18-rev21-edits.json`. That file is applied by the coordinator's script with exact-match and schema checks; this document is normative for intent.

**Review status carried forward, unchanged by rev 21.** SEC-20 is APPROVE WITH CONDITIONS, 0 blockers, 0 majors, and its task label is **PARTIAL**: the design review is complete, the executable prototype covered only part of the requested checks. Rev 21 does not convert any unexecuted check into evidence. The following remain **mandatory 18D/18F implementation and release gates** and none has been run on any tree: committed-vs-derived classification, every inversion fixture and positive control, dynamic-executable validation, variable-argument validation, child_process escape tracking (new in rev 21), clause-aware lint, the claims recount, receiver-type sink analysis for `falcon.js` and `scripts/`, and the Node 24 CI run. A later implementation PR cannot receive GO on the strength of SEC-20. Firefox and WebKit stay documented **UNVERIFIED** and are **not** Phase 18 blockers: Phase 18 pilot scope is Chromium only. Counts stay 98 total / 89 Must / 6 Should / 3 Could. M-23 is not reopened.

## Section A — summary of the five changes

| Item | Change | Primary targets |
|---|---|---|
| O-1 | `PILOT_APPROVAL_RUN_TOKEN` refusal widened from "pilot mode, before any write under `run/`" to **every `falcon.js` invocation**, via a two-stage check around the existing `.env` load | AC-084 carve-out, open item TOKEN-REFUSAL, `exitCodes`, plan line 91, section B below |
| m-73 | `child_process` members modelled as an **escaped capability** through parameters, default parameters, assignments, object properties and returns; real two-hop `GitInfo` flow tracked; unknown escape paths fail closed | AC-090, AC-098, OWNER-14-Q1, fixture table C6-T |
| m-74 | rev 6 exit precedence `2 > 3 > 18 > 17 > 16 > 15 > 13 > 12 > 11 > 14 > 10 > 1 > 0` restored for exit 13; not a residual | `exitCodes.policyNote`, threat-model item 15, residual 21, new open item EXIT-PRECEDENCE |
| m-75 | stale rev-19 / "fourteen fixtures" citations retired; fixture counts sourced from table C6-T, not prose; OWNER-13-Q1, OWNER-14-Q1 and OWNER-14-Q2 `state` text marked resolved | AC-098, AC-090, threat-model 18D/18F rows, plan status line and 18F row, open items |
| m-68 | no requirement depends on a tag or a historical commit; the deferred text authority is the tracked 18P record | AC JSON open items, 18P record appendix |

## Section B — O-1: strict, invocation-wide refusal of `PILOT_APPROVAL_RUN_TOKEN`

**Decision (owner, final).** If `PILOT_APPROVAL_RUN_TOKEN` is **present**, every `falcon.js` invocation fails — pilot and non-pilot, execute and replay, dashboard and `--no-dashboard`, shard child and merge — with **exit 2** and the stable configuration reason code `PILOT_CONFIG_REJECTED_ENV_KEY`. This intentionally converts a previously **ignored** environment variable into an **explicit configuration error**. It is a deliberate, documented behaviour change versus rev 20 (which refused only in pilot mode and only before the first write under `run/`) and versus `2572e73` (which ignored the variable); it is in scope because no supported Phase 18 workflow sets the key, and a set key means the operator believes in an approval capability that does not exist.

**B.1 Two-stage check.** `falcon.js` performs, in this order, before anything else:

1. **Stage 1 — inherited environment.** Before the `.env` load, inspect the inherited `process.env` for the key. Present => refuse immediately.
2. **Load `.env`** through the existing configuration path (`dotenv` at `falcon.js:50`, unchanged). This single read is the only application filesystem access permitted before a refusal.
3. **Stage 2 — post-`.env`.** Inspect again. Present => refuse immediately, because `.env` introduced it.

**B.2 Refusal properties (both stages identical).** Exit 2, reason code `PILOT_CONFIG_REJECTED_ENV_KEY`; message states that *protected-action approval is not supported in Phase 18*. The message is written synchronously to **stderr** by a direct `process.stderr.write` call and the process then exits with code 2; **`Logger.error` is forbidden** here, because `utils/Logger.js:107` points `logFilePath` at `reports/execution.log` and the write path calls `fs.promises.mkdir` at `:142` and `fs.promises.appendFile` at `:145`, which would be a filesystem write before the refusal (rev 22 section D). The value is never printed, logged, hashed, digested, length-measured, compared, persisted, receipted, reported or forwarded; only the key name appears. No browser or context launch; no dashboard start; no pilot manifest read; no run artefact created, opened for writing, or modified; no target, provider or network contact; no other application filesystem access before refusal (the stage-2 `.env` read is the single accepted exception).

**B.3 Presence semantics.** Presence is an own-property test on the environment object, never a truthiness or value test, so a **set-but-empty** value refuses identically. No value is read into a variable.

**B.4 Code shape and AC-084 carve-out.** The carve-out is **exactly one occurrence in one file** (corrected by rev 22 section E; the rev 21 count of two was wrong), `src/core/pilot/PilotLifecycle.js`: one frozen array literal `REJECTED_ENV_KEYS` at module scope (sole member: the key string), plus **one refusal site per stage**, both of which *read* that array and therefore contain no literal. The walker fails on any second occurrence, on any occurrence in another file, on any occurrence outside that pattern, and on any read of the variable's value. Exact scoping and inversion tests are enumerated in the carve-out's `inversionTests`.

**B.5 Tests (18C/18E owned).** `neg-token-refusal-stage1-inherited`, `neg-token-refusal-stage2-dotenv`, `neg-token-refusal-empty` (both stages), `neg-token-refusal-nonpilot-run` (plain `node falcon.js --no-dashboard`), `neg-token-refusal-order` (refusal precedes browser launch, any `run/` write, any manifest read and any target request, asserted on the ordered event log; **and**, per rev 22 D.3, exit code is exactly 2, no file write occurs before exit - `reports/execution.log` neither created nor appended, nothing created or modified under `run/` - and the text appears on stderr, not stdout, with the case run against a clean `reports/` directory), `neg-token-refusal-silence` (the value string appears in no log line, report, receipt, dashboard payload or artefact), `neg-token-refusal-no-measure` (no hash or length of the value anywhere), `neg-token-refusal-carveout` (a second literal occurrence fails AC-084).

**B.6 Exit-2 overlap.** Exit 2 now covers four disjoint classes distinguished only by the mandatory reason code: `PLAN_INVALID`/`PLAN_NO_DIGEST` at `PlanFile.load`, shard-merge input rejection, and `PILOT_CONFIG_REJECTED_ENV_KEY` from stage 1 and stage 2 (one code, two sites). Recorded in `exitCodes.planInvalidNote`.

**B.7 Documentation.** `docs/pilot/limitations.md` must state, by the DOC gate, that the key is **rejected, not ignored**, in every invocation, with exit 2, and that no approval capability exists. The claims grep skips the carve-out occurrences by name (AC-084 `prohibitedLiterals` / `prohibitedLiteralsCarveOut`), so a rejection list cannot inflate the claims baseline; the baseline is recomputed at apply time and remains `PENDING-RECOMPUTE-AT-APPLY` until then.

## Section C — m-73: `child_process` as an escaped capability

**C3.4b replaced.** "Every call of the receiving parameter" is withdrawn: in the real tree the receiving binding is never called, so the old wording passes vacuously. A `child_process` member identified **by binding** (never by name) is a **capability value** tracked within its module through: parameters, **default parameter values**, `const`/`let` assignments and destructuring, **object properties**, array elements, and **returns**.

**C3.4b.1 Fail-closed escapes.** The checker fails when a tracked capability is returned from the module, exported, stored on a non-local object that escapes, passed to a non-local function, or **never invoked anywhere**. Any unknown or unanalysable escape path fails closed. The checker distinguishes **methods received** (a binding that holds the capability) from **methods actually invoked** (a call expression whose callee resolves to it); only the latter can satisfy the literal-executable and literal-argv conditions.

**C3.4b.2 Real `GitInfo` flow (verified in `src/core/history/GitInfo.js` at `3763891`).** `exec = childProcess.execFileSync` is the **default value of a destructured parameter** of `getGitInfo` at `:34` (an `AssignmentPattern`, not an argument). It is forwarded as an argument to the local function `runGit` at `:39` and `:44`, and invoked inside `runGit` at `:21` as `execFile("git", argv, {...})`. The checker must resolve **both hops** and then validate at `:21`: literal executable `"git"` on the closed `externalExecutables` list, and argv resolving to literal arrays at **both** call sites (`["rev-parse","HEAD"]`, `["rev-parse","--abbrev-ref","HEAD"]`). The rev 20 patch text describing `:34` as an argument to `runGit` is corrected here.

**SUPERSEDED BY REV 22 SECTION B (m-81): this table is retained as history only. The authoritative C6-T is the **rev 23 section D.4** table (X1..X27 and P1..P5), which supersedes the rev 22 table (X1..X25 and P1..P3); where this copy differs (X10 scope, P1/P2 collapsed, the line-82 obligation), rev 22 wins.**

**C6 fixture table C6-T — the single source of truth for fixture counts.** Rev 21 adds six fixtures and keeps the rev 20 set, giving twenty-five inversion fixtures and three positive controls (**SUPERSEDED: the authoritative totals are the rev 23 section D.4 printing of C6-T, twenty-seven inversion fixtures and five positive controls, adding X26, X27, P4 and P5 for rule C3.10**). Prose must not restate counts; AC text and the threat model point at this table, and the checker asserts its own fixture directory against this table - both the count and the id set - and fails on any extra, missing or duplicate id (rev 22 section B completes the enumeration: X1..X25 contiguous plus P1..P3, with the nineteen rev 20 fixtures at X1..X10 and X17..X25 and the rev 19 fourteen at X3..X7 and X17..X25).

| Id | Kind | Shape | Expected |
|---|---|---|---|
| X1 | inversion | inline `NODE_OPTIONS="--require ./tests/x.js" node falcon.js` in a production step and its `env:`-block twin (C3.9) | fail |
| X2 | inversion | a production entry committed as `test` (step 226 and `start`), rejected by C4.1 recomputation | fail |
| X3 | inversion | `require(path.join("..","tests","x"))` in `scripts/` from a production root | fail |
| X4 | inversion | `import("../../tests/x")` in `src/` | fail |
| X5 | inversion | `spawn(process.execPath,["tests/x.js"])` from a production root | fail |
| X6 | inversion | a `production` step running `node tests/experimental/x.js` | fail |
| X7 | inversion | `createRequire(__filename)("../../tests/x")` in `src/` | fail |
| X8 | inversion | `|| true` relied on as an unknown executable (removing C3.6a must fail the current tree) | fail |
| X9 | inversion | `set -o pipefail` relied on as an unknown executable (same sense as X8) | fail |
| X10 | inversion | `GitInfo`-shaped default-parameter capability with a non-literal argv | fail |
| X11 | inversion | forwarding escape: capability passed to a **non-local** function | fail |
| X12 | inversion | capability **returned** from the module | fail |
| X13 | inversion | capability stored as an **object property** that escapes | fail |
| X14 | inversion | capability **assigned** to an alias then called with variable argv | fail |
| X15 | inversion | capability as a **default parameter** that is never invoked | fail |
| X16 | inversion | X11-shaped escape via a worker/`createRequire` edge (unanalysable) | fail |
| X17 | inversion | `new Worker("./tests/x.js")` in `scripts/` from a production root | fail |
| X18 | inversion | a production step `bash -c "node tests/x.js"` | fail |
| X19 | inversion | a production step `nohup node tests/x.js &` | fail |
| X20 | inversion | a production step `npx playwright test` | fail |
| X21 | inversion | a new unclassified `package.json` script | fail |
| X22 | inversion | a new unclassified `ci.yml` `run:` step | fail |
| X23 | inversion | a classification value other than `production`/`test` | fail |
| X24 | inversion | an unclassified `pre`/`post` lifecycle script | fail |
| X25 | inversion | `falcon.js` requiring `scripts/fixture/server.js` | fail |
| P1, P2 | positive control | rev 20 controls | pass |
| P3 | positive control | **the real two-hop `GitInfo` shape** (`:34` default param -> `:39`/`:44` forward -> `:21` call, literal argv) | pass |

Verification obligation: X11 to X16 fail and P3 passes, on the real shape, before 18D or 18F can claim the gate.

## Section D — m-74: exit precedence

The rev 6 order stands and is verified in `docs/architecture/phase-18-rev6-patch.md:54` and rev 17 11f.3 (`docs/architecture/phase-18-rev17-patch.md:185`): **`2 > 3 > 18 > 17 > 16 > 15 > 13 > 12 > 11 > 14 > 10 > 1 > 0`**. Exit 17 outranks 16, 15 and 13. Exit 13 (`POLICY_PLAN_IDENTITY_DRIFT` and the pre-existing policy refusals) therefore **cannot mask** 18, 17, 16 or 15, and in particular **must never mask a pilot-store integrity violation**. The rev 20 wording "immediately below 18 and above 17 and 1" is **withdrawn as a weakening**; it is corrected, not accepted as a residual. Residual 21 remains exactly what it was (exit 18 masking 17 and 1), carried and not accepted.

**Test (new, 18F-owned; acceptance ids AC-098 inversion and the AC-089 traceability row).** `neg-merge-exit-precedence-matrix`: a **table-driven** unit test over the merged shard rank that asserts, for **every ordered pair** of the relevant codes `{2, 3, 18, 17, 16, 15, 13, 12, 11, 14, 10, 1, 0}`, that the merge result is the higher-ranked code, including the pairs (13, 17), (13, 16), (13, 15) and (13, 18); it extends, and does not replace, rev 6's `neg-merge-exit-precedence`. Owner PR: **18F**.

## Section E — m-75: citations, counts and resolved open items

Every live stale citation found with `git grep` is retired: AC-098 `requirement` (`rev 19 sections C1 to C5`) and `components` (`rev 19 section C`); AC-090 `requirement` and `components` fixture-count prose; threat-model rows 18D and 18F ("fourteen inversion fixtures with one positive control", one of them still citing rev 19 section C); the plan status line (SEC-19, OWNER-14-Q1/Q2 listed as pending) and the plan 18F row. `rev 19 section H(d)`, `rev 19 section D as corrected by rev 20 section D` and `rev 19 section F(b)` are **not** stale: those sections were never superseded and stay as written. OWNER-13-Q1, OWNER-14-Q1 and OWNER-14-Q2 keep their recorded decisions and now say so in `state`, not only in `status`; the original request wording is retained for traceability, prefixed as resolved.

## Section F — m-68: no dependency on a tag or a commit

`docs/pilot-deferred/phase-18p-protected-nonget.md` is the sole authority for deferred text. The two remaining AC JSON references are removed: the 18P-PROTECTED-NONGET open item now points at that record, and OWNER-14-Q2 choice (3) is recorded as **withdrawn** with no tag name and no commit identifier. No requirement, acceptance criterion or merge condition depends on any tag or historical commit remaining reachable; history-only mentions elsewhere (earlier rev patches, security reviews, and the 18P record's own history note) are clearly marked non-dependencies and are left intact so the record stays verbatim. Rev 21 appends to the 18P record an appendix stating the authority rule, the withdrawn tag option and the rev 21 corrections (C3.4b capability model, exit precedence, fixture table C6-T) so the record stays self-contained. Short SHAs only anywhere; no 40-character SHA is introduced.

## Section G — ADR note

No new ADR. O-1 is an amendment to the OWNER-13 no-approval decision already recorded in rev 18 section B and rev 20 section B; m-73, m-74 and m-75 are corrections inside rev 20's own controls. The durable, cross-cutting part — "a present `PILOT_APPROVAL_RUN_TOKEN` is a configuration error in every invocation" — is recorded in `exitCodes.planInvalidNote`, the AC-084 carve-out and the TOKEN-REFUSAL open item, which is where implementers will look.

## Section H — handoff constraints

- **Developer:** B.1 ordering is normative; one refusal site per stage; no value read; `.env` load path unchanged; `exit 2` plus reason code only.
- **QA:** B.5 and section D name the required tests; fixture counts come from table C6-T; do not weaken any inversion fixture to pass.
- **Security:** rev 21 claims no execution; the unexecuted checks listed above stay gates.
- **DevOps:** Node 24 CI, Chromium-only pilot scope; Firefox/WebKit stay UNVERIFIED and non-blocking.

## Needs anchors (not applied by rev 21)

Nothing was guessed: every `old` anchor in the edits file was verified to occur exactly once in its target at `3763891`. Two intended edits are deliberately left to the applying coordinator because their full target text was not read in this task and no anchor is asserted: (1) the plan 18D-row citation of rev 20 section C, correct as written but due to read "supersedes rev 18, rev 19 and rev 20 section C" once rev 21 section C lands; (2) `docs/phase-18-decision-traceability.md:64`, whose rev 19 section D citation is accurate and needs no change. `docs/pilot/limitations.md` does not exist yet, so B.7 is an obligation on the DOC gate, not an edit.
