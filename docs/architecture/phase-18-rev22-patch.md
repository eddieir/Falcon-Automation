# Phase 18 architecture patch — revision 22 (ARCH-22)

Base: architecture rev 2 plus the rev 3..rev 21 patches, at `74768d8` on `docs/phase-18-architecture`.
Inputs: SEC-21 (`docs/security/phase-18-design-review-20.md`) — M-24 (major), m-76, m-77, m-78.
Scope: design text only. No production source file, `package.json` script or workflow step is edited by rev 22.
Machine-applicable edits: `docs/architecture/phase-18-rev22-edits.json`; this document is normative for intent.

**Review status carried forward.** SEC-21 is BLOCK at the design gate with 0 blockers, 1 major (M-24) and 3 minors; its task label stays **PARTIAL**. Rev 22 fixes exactly those four findings. **M-23 is not reopened and nothing is weakened.** Every check listed as unexecuted by rev 21 remains a mandatory 18D/18F gate and none has been run on any tree: committed-vs-derived classification, every inversion fixture and positive control, dynamic-executable validation, variable-argument validation, `child_process` escape tracking, clause-aware lint, the claims recount, receiver-type sink analysis, and the Node 24 CI run. Counts stay **98 total / 89 Must / 6 Should / 3 Could**. Firefox and WebKit stay UNVERIFIED and non-blocking; pilot scope is Chromium only.

## Section A — the four changes

| Item | Change | Primary targets |
|---|---|---|
| M-24 | table C6-T corrected: the row range `X17..X22` becomes `X17..X25` and **every** rev 20 fixture is mapped to an id with a one-line description, so the table enumerates **25 inversion fixtures + 3 positive controls** with no gaps and no duplicates | rev 21 section C table C6-T (section B below) |
| m-77 | the AC-098 (ii) / AC-090 contradiction removed: **both** criteria cite rev 21 section C and its table C6-T; the rev 20 "only section any criterion cites" wording is dropped | AC-098 `requirement`, AC-090 `requirement` |
| m-76 | the refusal message is emitted on **stderr by a direct `process.stderr` write**, never `Logger.error`; the ordering test asserts that **no file write** happens before exit and that the exit code is 2 | rev 21 B.2/B.5, AC-084 carve-out, TOKEN-REFUSAL |
| m-78 | the carve-out is pinned to **exactly one** literal occurrence (the frozen array), read by both stage checks; carve-out count, AC-084 text and the inversion test now agree | rev 21 B.4, AC-084 `prohibitedLiteralsNote` and `prohibitedLiteralsCarveOut` |

## Section B — M-24: table C6-T, complete and gap-free

Rev 21's C6-T declared twenty-five inversion fixtures but enumerated only twenty-two slots, so three of the nineteen rev 20 fixtures had no id and a checker validating itself against the table would still pass. The table below **replaces** the rev 21 row set. It remains **the single source of truth for fixture ids and counts**; prose must not restate a count. **The checker asserts its own fixture directory against this table — both the count and the id set — and fails on any extra, missing or duplicate id.**

| Id | Kind | Shape | Origin | Expected |
|---|---|---|---|---|
| X1 | inversion | inline `NODE_OPTIONS="--require ./tests/x.js" node falcon.js` in a production step, and its `env:`-block twin (C3.9) | rev 20 | fail |
| X2 | inversion | a production entry committed as `test` (step 226 and `start`), which C4.1 recomputation must reject | rev 20 | fail |
| X3 | inversion | `require(path.join("..","tests","x"))` in `scripts/` from a production root | rev 19 | fail |
| X4 | inversion | `import("../../tests/x")` in `src/` | rev 19 | fail |
| X5 | inversion | `spawn(process.execPath,["tests/x.js"])` from a production root | rev 19 | fail |
| X6 | inversion | a `production` step running `node tests/experimental/x.js` | rev 19 | fail |
| X7 | inversion | `createRequire(__filename)("../../tests/x")` in `src/` | rev 19 | fail |
| X8 | inversion | `|| true` relied on as an unknown executable (removing C3.6a must fail the current tree) | rev 20 | fail |
| X9 | inversion | `set -o pipefail` relied on as an unknown executable (same sense as X8) | rev 20 | fail |
| X10 | inversion | `GitInfo`-shaped default-parameter capability with a non-literal executable or non-literal argv | rev 20 | fail |
| X11 | inversion | forwarding escape: capability passed to a **non-local** function | rev 21 | fail |
| X12 | inversion | capability **returned** from the module | rev 21 | fail |
| X13 | inversion | capability stored as an **object property** that escapes | rev 21 | fail |
| X14 | inversion | capability **assigned** to an alias then called with variable argv | rev 21 | fail |
| X15 | inversion | capability as a **default parameter** that is never invoked | rev 21 | fail |
| X16 | inversion | X11-shaped escape via a worker/`createRequire` edge (unanalysable) | rev 21 | fail |
| X17 | inversion | `new Worker("./tests/x.js")` in `scripts/` from a production root | rev 19 | fail |
| X18 | inversion | a production step `bash -c "node tests/x.js"` | rev 19 | fail |
| X19 | inversion | a production step `nohup node tests/x.js &` | rev 19 | fail |
| X20 | inversion | a production step `npx playwright test` | rev 19 | fail |
| X21 | inversion | a new unclassified `package.json` script | rev 19 | fail |
| X22 | inversion | a new unclassified `ci.yml` `run:` step | rev 19 | fail |
| X23 | inversion | a classification value other than `production`/`test` | rev 19 | fail |
| X24 | inversion | an unclassified `pre`/`post` lifecycle script | rev 19 | fail |
| X25 | inversion | `falcon.js` requiring `scripts/fixture/server.js` | rev 19 | fail |
| P1 | positive control | `execFile("git", ["rev-parse","--git-common-dir"])` with a literal argv in `src/` | rev 20 | pass |
| P2 | positive control | the same with a module-level `const` argv array | rev 20 | pass |
| P3 | positive control | the real two-hop `GitInfo` shape (`:34` default param -> `:39`/`:44` forward -> `:21` call, literal argv) | rev 21 | pass |

**Totals: 25 inversion fixtures (X1..X25, contiguous, no duplicate id) and 3 positive controls (P1..P3).** **SUPERSEDED BY REV 23 SECTION D.4: the totals are now 27 inversion fixtures (X1..X27) and 5 positive controls (P1..P5), adding X26, X27, P4 and P5 for rule C3.10 (DEP0190). The rev 23 section D.4 printing is the single source of fixture ids and counts; this table is retained as history.** Mapping check: the nineteen rev 20 fixtures are `X1..X10` plus `X17..X25`; the rev 19 fourteen inside them are `X3..X7` plus `X17..X25`; rev 21 added `X11..X16`. Verification obligation (unchanged, still owed): all 25 fail and all 3 pass, on the real shapes, before 18D or 18F can claim the gate.

## Section C — m-77: one consistent citation

AC-098 (ii) and AC-090 now both cite **rev 21 section C and its table C6-T** for this control. The rev 20 clause asserting that rev 20 section C "is the only section any criterion cites for this control" is **deleted**: it was false once AC-090 cited rev 21 section C, and uniqueness-of-citation was never the property that mattered. The property that matters is retained and unweakened: **one superseding section (rev 21 section C, superseding rev 18, rev 19 and rev 20 section C) and one fixture table (C6-T) as the single source of fixture ids and counts.** No criterion asserts that it is the only citing criterion.

## Section D — m-76: emission channel for the refusal

**D.1 Channel (normative).** The refusal message is written **synchronously to `process.stderr`** by a direct `process.stderr.write(...)` call in the refusal path, followed by exit with code 2. **`Logger.error` must not be used**, and no other logger, reporter, receipt or dashboard path may be used. Reason (verified at `74768d8`): `utils/Logger.js:107` sets `logFilePath` to `path.join(__dirname, "..", "reports", "execution.log")`, and the write path does `fs.promises.mkdir(dir, { recursive: true })` at `:142` and `fs.promises.appendFile(Logger.logFilePath, line, ...)` at `:145`. A `Logger.error` call in the refusal path would therefore create or append `reports/execution.log`, breaking B.2's "no other application filesystem access before refusal" (the stage-2 `.env` read stays the single accepted exception) and leaving the violation invisible to the rev 21 ordering test.

**D.2 Message content.** Unchanged from B.2: the stable reason code `PILOT_CONFIG_REJECTED_ENV_KEY`, the key **name** only, and the statement that protected-action approval is not supported in Phase 18. The value is never printed, logged, hashed, digested, length-measured, compared, persisted, receipted, reported or forwarded.

**D.3 Test strengthening.** `neg-token-refusal-order` additionally asserts, for both stages: (a) the process exit code is exactly **2**; (b) **no file write occurs before exit** — specifically `reports/execution.log` is neither created nor appended (assert its absence, or an unchanged size and mtime when it pre-exists), and no file is created or modified under `run/`; (c) the refusal text appears on **stderr** and not on stdout; (d) the rev 21 ordering assertions (refusal precedes browser launch, dashboard start, any pilot manifest read, any `run/` write and any target request) still hold on the ordered event log. The case runs with a clean `reports/` directory so (b) is decisive.

## Section E — m-78: exactly one permitted literal occurrence

**E.1 Decision.** The carve-out pattern is **one literal occurrence**, not two. In `src/core/pilot/PilotLifecycle.js`, at module scope, exactly one frozen array literal — `REJECTED_ENV_KEYS = Object.freeze(["PILOT_APPROVAL_RUN_TOKEN"])` — contains the key string. **Both** the stage-1 check (before the `.env` load) and the stage-2 check (after it) read that same frozen array, and the refusal message takes the key name from that array; neither refusal site contains the literal. This is the pattern rev 21 B.4 described; its occurrence count of two was wrong, because a refusal site that reads the array contributes no literal.

**E.2 Consequences (all three must agree).** `prohibitedLiteralsCarveOut.occurrences` becomes **1**; `prohibitedLiteralsNote` says **one occurrence in one file** instead of two; the walker fails on any **second** occurrence of the literal anywhere (same file or another file), on the single occurrence appearing outside the `Object.freeze` array-literal initialiser at module scope, on more or fewer than one refusal site per stage, and on any read of the environment **value**. `neg-token-refusal-carveout` is inverted accordingly: adding a second literal occurrence — the clearest case being the key string hard-coded into the stage-2 refusal message instead of read from the array — must fail AC-084, as must moving the one permitted occurrence out of the frozen array literal or into another file.

**E.3 Dependent counts.** The only count changes in rev 22 are inside the carve-out (2 -> 1) and inside table C6-T (22 enumerated inversion rows -> 25). Criterion counts are untouched: **98 / 89 / 6 / 3**, deferred counts unchanged, no criterion added, removed or re-phased.

## Section F — ADR note

No new ADR. M-24 and m-78 are arithmetic corrections inside rev 21's own controls; m-77 removes a contradiction; m-76 pins an emission channel already implied by B.2's filesystem rule. The durable statements live where implementers look: table C6-T (fixtures), the AC-084 carve-out (literal budget and channel), and the TOKEN-REFUSAL open item.

## Section G — handoff constraints

- **Developer:** stderr via a direct `process.stderr.write`, then exit 2; never `Logger.error` in the refusal path; exactly one key literal, in the frozen array, read by both stages; `.env` load path unchanged.
- **QA:** build fixtures from table C6-T only (rev 23 section D.4 printing: **X1..X27, P1..P5**; the rev 22 range X1..X25, P1..P3 is superseded); the checker must self-assert count and id set; strengthen `neg-token-refusal-order` per D.3; do not weaken any inversion fixture to pass.
- **Security:** rev 22 claims no execution; every gate listed in the status paragraph stays owed. SEC-21's own prototype limits still apply.
- **DevOps:** Node 24 CI, Chromium-only pilot scope; the fixture suite and the token-refusal suite must run in CI with a clean `reports/` tree.

## Needs anchors (not applied by rev 22)

Nothing was guessed: every `old` anchor in `phase-18-rev22-edits.json` was verified to occur exactly once in its target field or file at `74768d8`. `docs/pilot/limitations.md` still does not exist, so the B.7 documentation obligation remains a DOC-gate obligation rather than an edit. The plan 18D-row citation of rev 21 section C is correct as written and is not re-edited here. Short SHAs only; no 40-character SHA is introduced.
