# Phase 18 architecture rev 20 patch (ARCH-20) — closes SEC-19 M-23, m-70, m-71, m-72, m-68 and the nits

Normative prose. **Nothing here authorises implementation, merge, publication, deployment or any tag push.** Design only: **no browser, runtime, server, checker or CI run was performed by this revision, and none is claimed.** **Node 24 is UNVERIFIED (H-8); Firefox and WebKit are UNVERIFIED.** OWNER-12 (Option C) and OWNER-13 (no production approval path) are binding. The owner decisions relayed with this task — OWNER-13-Q1, OWNER-14-Q1, OWNER-14-Q2, the `PILOT_APPROVAL_RUN_TOKEN` rejection and the **no-tag** decision — are integrated and **not reopened**.

The machine-applicable edit set is `docs/architecture/phase-18-rev20-edits.json` (schema `phase-18-rev20-edits/1`: the rev 19 schema plus `openItems` for edits to existing open items and `exitCodes`). Where the two disagree, **this prose is normative and the JSON is a defect**. Every `old`/`replace` anchor in the JSON was asserted by script to occur **exactly once** in its target field or file at `5c355cb`.

**Secret hygiene (owner addendum).** Every commit identifier in this patch and in the tracked 18P record is an abbreviated 7-character id. Full 40-character SHAs are deliberately absent, because the receipt and ledger secret-shape screen refuses a full commit SHA as secret-shaped. **No part of this revision weakens, carves out, disables or narrows secret detection, redaction or the secret-shape screen**, and no design element depends on doing so.

## 0. Why rev 19 failed review, and what rev 20 changes

SEC-19 ran a Python model of rev 19 C1 to C7 and reported **M-23 still open**: under the rev 19 text the check **fails on the current tree** at `ci.yml:335` (`|| true`), `ci.yml:464` (`set -o pipefail`) and `src/core/history/GitInfo.js:34` (a `child_process` member passed as a value), and it **wrong-passes** on an inline `NODE_OPTIONS="--require ./tests/x.js" node falcon.js` step and on a production entry committed as `test`. Rev 20 adds no new machinery and no production-code change. It (a) closes the leaf-rule gaps, (b) makes the committed classification checkable against a derivation, (c) aligns the gate criteria to the accepted scope, (d) fixes the claims baseline method, (e) states the run-token rejection and the exit-13 policy refusal, and (f) replaces every dependency on commit `909d794` and the withdrawn tag with a tracked, self-contained document.

**Status of execution, stated plainly.** The rev 20 check is a **mandatory implementation gate for 18D and 18F**. No design revision, including this one, has executed it. SEC-19's Python prototype is an uncommitted scratchpad artefact and is **evidence for Security only, not a deliverable**. The normative definition of the algorithm is section C below plus the pseudo-spec in C8, which is committed **inside this patch**; no prototype source is committed. (Supports owner verification point 4.)

## 1. Context and constraints

- The AC JSON is the gate; a criterion with no `phase` and no `mergeCondition` is a live Must.
- Phase 18 ships detection and refusal only. **Phase 18 has two by-design refusal codes, not one**: `POLICY_PROTECTED_ACTION_UNSUPPORTED` at **exit 18** with a mandatory reason code, and `POLICY_PLAN_IDENTITY_DRIFT` at **exit 13** (`exitCodes.policy`) for a healed element that stays permitted but whose identity differs from the recorded plan row. Exit 14 is reserved and unreachable. Rev 19 section 1's "one by-design refusal code" is corrected here (SEC-19 m-71).
- A third Phase 18 refusal is a **configuration** refusal, not a policy one: `PILOT_CONFIG_REJECTED_ENV_KEY` at **exit 2** (section B).
- No production source file is edited by rev 20. No file is moved. CommonJS, Node >= 22 locally, Node 24 in CI (UNVERIFIED).
- No criterion is deleted, renumbered or weakened. Counts are unchanged: **98 total, 89 Must, 6 Should, 3 Could**; `deferredToPhase18P` 11; `deferredUnderOptionC` 5. OWNER-13-Q1's decision confirms AC-092's existing `deferred-18P` phase and `mergeCondition: false`, so it moves no count.
- Reachability is a **CI check over repository text**, not a runtime feature.

## 2. Affected components and trust boundaries

| Area | Change in rev 20 | Trust boundary |
|---|---|---|
| AC JSON (AC-083/084/085/089/090/095/074/098, `exitCodes`, open items, `lintBaseline`) | gate text, exit-code split, carve-out data, placeholder baseline | merge gate |
| `docs/pilot/reachability-roots.json` (new, committed data; 18D/18F work) | classification of every script and `run:` step, the closed `externalExecutables` list, the production-tooling roots | CI gate input |
| `docs/pilot-deferred/phase-18p-protected-nonget.md` (new, tracked, **NON-NORMATIVE**) | the deferred 18P design record | documentation only; excluded from the claims grep by exact prefix |
| `docs/pilot/limitations.md` (DOC work) | states the run-token rejection | operator-facing |
| `.github/workflows/ci.yml`, `package.json` | two fail-closed checks plus the baseline recompute step (18D/18F work, not added here) | CI |
| `src/core/pilot/PilotLifecycle.js` | **18C/18E work, not edited here**: the single run-token refusal site | production |
| `src/**`, `falcon.js`, `scripts/**` | **unchanged by rev 20** | production |
| `tests/experimental/` | sole prototype location | test |

## 3. Section B (rev 20) — rejection of `PILOT_APPROVAL_RUN_TOKEN` (closes SEC-19 m-72)

Owner decision: the variable is **rejected**, not silently ignored.

**B1. Behaviour.** In pilot mode, if the environment contains the key `PILOT_APPROVAL_RUN_TOKEN`, the run is refused with a secret-safe configuration error: mandatory reason code **`PILOT_CONFIG_REJECTED_ENV_KEY`**, **exit 2**, raised in `PilotLifecycle` **before any browser launch, any context creation, any write under `run/` and any request to the target**. `PILOT_APPROVER` is unaffected: it is read nowhere.

**B2. Presence semantics.** The test is **key presence in the environment**, never a value test. A set-but-empty value refuses identically. The value is never read for content, compared, parsed, trimmed or defaulted.

**B3. Secret safety.** The **variable name** may appear in the message; the **value never appears anywhere** — not in a log line, a `Logger` call, a report, a receipt, a dashboard payload, an artefact, an exception message or a stack frame. The value is never copied into a variable that outlives the presence check. Nothing here weakens the existing secret-shape screen or redaction.

**B4. Exactly scoped refusal site.** One file, one pattern: `src/core/pilot/PilotLifecycle.js`, a single frozen array literal `REJECTED_ENV_KEYS` whose only member is the string `PILOT_APPROVAL_RUN_TOKEN`. AC-084's `prohibitedLiterals` prohibition is unchanged except for this one carve-out, recorded as structured data in that criterion's `prohibitedLiteralsCarveOut`. The walker and the claims grep both fail on a second occurrence anywhere, on an occurrence in any other file, on an occurrence outside that pattern, and on any read of the value.

**B5. Tests (five, each named).** `neg-token-refusal-present` (non-empty value → exit 2 with the reason code); `neg-token-refusal-empty` (empty value → identical refusal); `neg-token-refusal-order` (refusal strictly before browser launch, before any `run/` write and before any target request, asserted on the ordered event log); `neg-token-refusal-silence` (the value string occurs in no log, report, receipt, dashboard payload or artefact); `neg-token-refusal-carveout` (a second occurrence of the literal fails AC-084). Each has its inversion: remove the refusal and the run proceeds, which must fail the test.

**B6. Exit-2 overlap, reconciled.** Exit 2 is already `planInvalid` (`PLAN_INVALID`/`PLAN_NO_DIGEST` at `PlanFile.load`) and shard-merge input rejection. The three classes are disjoint and are distinguished **only** by the mandatory reason code, recorded in `exitCodes.planInvalidNote`. No new exit code is introduced.

**B7. Documentation.** `docs/pilot/limitations.md` states the rejection in operator terms, with no value example. The plan's "nothing reads one" wording at line 32 and line 100 is replaced (SEC-19 m-72, plan line 100 and section B).

(Supports owner verification points 1 and 6.)

## 4. Section C (rev 20) — the production dependency-reachability check

Supersedes rev 18 and rev 19 section C and 11a.4/11d.5 for this control. Cite **"rev 20 section C"** and nothing else. Rev 19 C1, C2, C3.1–C3.3, C3.5, C3.6, C3.8 and C7 are carried forward unchanged except where amended below.

**C0. Normative method (owner addendum).** The checker is **AST-based**, not regex-based. JavaScript edges are resolved from a parsed abstract syntax tree with scope and binding information; `run:` blocks are resolved by a shell simple-command parser; YAML is parsed, not grepped. The **sink scan is receiver-type based** (section H), resolving the receiver of every candidate call through local data flow and failing closed on an unresolvable receiver. A regex or substring implementation does not satisfy this control. SEC-19's regex-and-paren prototype therefore does not discharge it.

**C1. Roots (exact paths, no patterns) — all production roots.** `falcon.js`; `package.json` `main` (`falcon.js`) and every `bin` entry (none today); every entry classified `production` in the committed file `docs/pilot/reachability-roots.json`, which must classify **every** `package.json` script (41 today) and **every** workflow `run:` step (33 today, each multiline block covering every command inside it); and every **explicit production-tooling root**, which today are `healing:benchmark` (OWNER-14-Q2(2)) and the claims-baseline recompute script of F.3. Legal values are exactly `production` and `test`; there is no exempt value and no third value. An unclassified, unknown or mis-valued entry **fails the check**.

**C2. Forbidden targets.** A production-classified root, and every module reachable from one, must not reach any path under `tests/`, `tests/experimental/` or `scripts/fixture/`, by exact normalised repository path prefix.

**C2a. Fixture server (OWNER-14-Q2(1), DECIDED).** `scripts/fixture/server.js` **stays in place** as an operator-facing local fixture walkthrough. Conditions, all enforced by the checker: `falcon.js` and the `src/**` production graphs must **never** reach `scripts/fixture/**`; the checker carries both a **positive test** (the current tree does not reach it) and an **inversion test** (`falcon.js` requiring it fails); `fixture:serve` may invoke it **only** through its explicitly classified script entry; the CI workflow reaches it only through classified step 392; **no pilot runtime may import, spawn or dynamically resolve it**; and any dynamic or non-literal reachability **fails closed**.

**C3.3a. Cwd-relative paths fail closed (SEC-19 nit).** A relative `worker_threads.Worker` path and a `path.resolve(...)` result built only from string literals (without `__dirname`) are **cwd-relative**, so their target is not determined by repository text: both **fail closed**. Only `path.join`/`path.resolve` anchored at `__dirname` resolve.

**C3.4. Leaf rule — all conditions required.** The executable is a literal on the closed `externalExecutables` list in the classification file; its argv holds no repository `.js`, `.cjs`, `.mjs` or `.sh` path; and it uses **no `-e`, `--eval`, `-p`, `--print`, `-r`, `--require`, `--import` or `--loader`** (`-p`/`--print` added per SEC-19). The committed list is exactly: `git`, `ps`, `ffmpeg`, `ffprobe`, `psql`, `curl`, `allure`, `mkdir`, `cp`, `mv`, `rm`, `tee`, `head`, `cat`, `seq`, `sleep`, `echo`. **OWNER-14-Q1 is DECIDED**: this is **closed executable classification data**, not a repository-code exemption, valid **only** while C3.4b, C3.6a and C3.9 are all enforced and every addition is a reviewed change to a committed file. The same argv conditions apply to **`npx <bin>`**.

**C3.4b. `child_process` by binding, including a member passed as a value (SEC-19 M-23 item 2, remediation (b)).** A child-process call is identified by **binding**, from the AST: the resolved binding of the callee must originate in a `require("child_process")` (or `node:child_process`) import, directly or through a member expression. Name matching is prohibited — it would misread the seven production-reachable `RegExp#exec` sites. When a `child_process` member is **passed as a value** into a parameter (`src/core/history/GitInfo.js:34` passes `childProcess.execFileSync` into `runGit(execFile, cwd, argv)`, which calls it at `:21`), the edge resolves **only if, within that module, every call of the receiving parameter has a literal executable on the `externalExecutables` list and argv resolving to a literal array at every call site**; otherwise it **fails closed**. On the current tree this rule is satisfied by `GitInfo.js` as written, so **no production edit is required**; the design makes no claim that it has been run.

**C3.6a. Closed shell-builtin list (SEC-19 M-23 item 1, remediation (a)).** The only shell builtins treated as non-invocations are **`set` (with option flags only, e.g. `set -o pipefail`, `set -e`), `true`, `false` and `:`**. Explicitly **excluded**, i.e. never leaves and always fail closed: `.`, `source`, `eval`, `exec`, `command`, `builtin`, `trap`. This resolves `ci.yml:335` (`|| true`) and `ci.yml:464` (`set -o pipefail`) in production steps 334 and 462 without adding either to `externalExecutables`. C5 and Appendix A.2 state both.

**C3.7. Fail-closed scope (unchanged from rev 19).** Fail-closed applies to `falcon.js` and to every module reachable from a production-classified root. It does **not** apply to modules reachable only from test-classified roots, so `scripts/benchmark/parallel.js:71,92,150` and `scripts/demo/lib/env.js:154,239` need **no rewrite**.

**C3.8. Absolute `src/**` prohibition (SEC-19 M-23 item 3, remediation (c)).** Independently of reachability, **no file under `src/**` may reach any path under `tests/**` or `scripts/fixture/**` by any edge kind**, and a non-literal edge in such a file that could resolve to either is a violation. This is true of the current tree per SEC-19's `src`-wide scan. AC-090's requirement and AC-084 are aligned to C3.7 **and** C3.8, removing the contradiction SEC-19 recorded at E6; AC-090's current clause regains the whole-`src/` scope it lost in rev 19.

**C3.9. Environment-injection rule (SEC-19 M-23 item 4, remediation (d)).** A **production** entry fails the check if `NODE_OPTIONS` or `NODE_PATH` is set in any of: an inline shell assignment preceding a command (`NODE_OPTIONS="--require ./tests/x.js" node falcon.js`), an `env` command argument, a **step, job or workflow `env:` block** (the YAML is parsed and all three scopes are read), or `.npmrc` `node-options`. This closes wrong-pass X1.

**C4. One deterministic classification rule.** Unchanged from rev 19: an entry is `test` **iff** at least one of R1..R4 holds, otherwise `production`; R1 repository file under `tests/`; R2 a test runner (`playwright test`, `npx playwright test`, `node --test`); R3 transitive over already-`test` npm scripts, cycle-detected; R4 entry file under exactly one of `scripts/demo/`, `scripts/benchmark/`, `scripts/fixture/`, `docs/demo/`. Fail-closed tie-break: an entry resolving to both a test- and a production-classified entry is **`production`**, and every test entry it reaches is a violation.

**C4.1. Committed equals derived (SEC-19 M-23 item 4, remediation (d)).** The checker **recomputes** C4 for every entry and **fails whenever a committed value differs from the derived value**, naming the entry, the committed value, the derived value and the rule that fired. The committed file remains the review artefact, but it is no longer self-certifying, so labelling a production entry `test` is no longer a de facto exemption (wrong-pass X2 closed). **The rev 19 alternative of classifying `healing:benchmark` as `test` is WITHDRAWN**: the checker has one rule and no alternative (OWNER-14-Q2(2)).

**C5. Figures for the current tree (SEC-19 nit corrected).** **21 production scripts and 20 test scripts** (41 total; the rev 19 "22/19" was wrong, the Appendix A.1 table was right). **20 production `run:` steps and 13 test steps** (33 total). Steps 334 and 462 pass only through C3.6a. `GitInfo.js:34` passes only through C3.4b. No production-classified root reaches `tests/`, `tests/experimental/` or `scripts/fixture/`; `ps`, `ffmpeg` and `ffprobe` are not reached from the production set at all. **These figures are read off repository text by the design; they are not a checker run.**

**C5a. `healing:benchmark` (OWNER-14-Q2(2), DECIDED).** `src/core/locator/HealingBenchmark.js` stays **production tooling** under the four conditions, all of which the checker asserts: it is **inside the sink scan** (section H); `neg-dep-hb-unrequired` proves **no production runtime module requires it**; it is **never invoked in pilot mode**; and it is an **explicit production-tooling root with bounded external effects**. A data read alone is **not** a dependency edge (so `:87` reading `tests/fixtures/benchmark/` is not a violation), and this classification **does not authorise pilot-runtime reachability**.

**C6. Fixtures: nineteen inversion fixtures, each of which must fail the check, and three positive controls, each of which must pass.** The rev 19 fourteen, unchanged: `require(path.join("..","tests","x"))` in `scripts/` from a production root; `import("../../tests/x")` in `src/`; `spawn(process.execPath,["tests/x.js"])` from a production root; a `production` step running `node tests/experimental/x.js`; a new unclassified `package.json` script; a new unclassified `ci.yml` `run:` step; `createRequire(__filename)("../../tests/x")` in `src/`; `new Worker("./tests/x.js")` in `scripts/` from a production root; a production step `bash -c "node tests/x.js"`; a production step `nohup node tests/x.js &`; a production step `npx playwright test`; a classification value other than `production`/`test`; an unclassified `pre`/`post` lifecycle script; `falcon.js` requiring `scripts/fixture/server.js`. **Five added by SEC-19 remediation (e):** **X1** inline `NODE_OPTIONS="--require ./tests/x.js" node falcon.js` in a production step (and its `env:`-block twin); **X2** a production entry committed as `test` (step 226 and `start`), which C4.1 must reject; **X10** the GitInfo shape, i.e. a `child_process` member passed as a value whose receiving parameter is called somewhere with a non-literal executable or non-literal argv; **X8** `|| true` relied on as an unknown executable; **X9** `set -o pipefail` relied on as an unknown executable. (X8 and X9 are inversions in the sense that removing C3.6a must fail the current tree, which is itself the test.) **Positive controls (three):** **P1** `execFile("git", ["rev-parse","--git-common-dir"])` with a literal argv in `src/`; **P2** the same with a module-level `const` argv array; **P3** the `GitInfo.js` parameter-argv shape where **every** call site is literal. The single count used everywhere is **nineteen inversion fixtures and three positive controls**.

**C7. Verification obligations (owed, not discharged).** A recorded CI run of `neg-dep-reachability` over the tree with **zero exemptions**; all nineteen fixtures failing; all three positive controls passing; C4.1 recomputation reported for every entry; AC-098 (ii) and AC-090 citing this section. **UNVERIFIED here.**

**C8. Normative pseudo-spec (committed in this patch).** The implementer must follow this order; nothing in it is optional.

1. Parse `package.json`; collect `main`, every `bin`, every script. Parse every workflow YAML; collect every `run:` block with its line, plus step, job and workflow `env:` maps. Parse `docs/pilot/reachability-roots.json`.
2. For every entry, derive the classification by C4 (cycle-detected, fail-closed tie-break). Compare with the committed value; **any difference fails** (C4.1).
3. For every `run:` block, parse the shell into simple commands (C3.6). Apply C3.6a to builtins. Apply C3.9 to the entry's environment from all three `env:` scopes, inline assignments, `env` arguments and `.npmrc`.
4. For every command word: if it is a repository entry, follow it; if it is `node`/`process.execPath`, resolve the argv file as an edge; if it satisfies C3.4 (with `npx <bin>` included), mark it a leaf; otherwise **fail closed**.
5. For every JavaScript module, build the AST; for each edge kind of C3.1, resolve the target (C3.2, C3.3, C3.3a). Identify child-process calls by binding (C3.4b), including the member-as-value rule. **Fail closed** on any unresolved edge inside `falcon.js` or the production-reachable set.
6. Walk transitively from every root of C1. Fail on any path reaching a forbidden target of C2.
7. Independently of the walk, scan **all** of `src/**` for any edge to `tests/**` or `scripts/fixture/**`, including non-literal edges that could resolve to either (C3.8).
8. Run the sink scan of section H (receiver-type based, failing closed).
9. Emit, for every failure, the file, line, edge kind or command word, and the rule id. Exit non-zero. No exemption mechanism exists in the implementation.

## 5. Section D (rev 20) — the m-27 exit codes (closes SEC-19 m-71)

A DOM swap of a classified element during the actionability wait has two Phase 18 outcomes, both with **zero requests**:

- the swapped element **reclassifies to protected** → `POLICY_PROTECTED_ACTION_UNSUPPORTED`, **exit 18**, reason `heal_changed_classified_element`;
- the swapped element **stays permitted but its identity differs from the recorded plan row** → `POLICY_PLAN_IDENTITY_DRIFT`, **exit 13** (`exitCodes.policy`), reason `heal_changed_permitted_element`.

AC-089's **requirement text** said exit 18 for identity drift while its current clause said exit 13; because the clause-scoped lint cannot see a mixed criterion's requirement field, the contradiction survived. Rev 20 fixes the requirement text itself. **Merge rank**, recorded in `exitCodes.policyNote` next to residual 21: exit 13 ranks immediately below 18 and above 17 and 1, so a policy refusal can neither be masked by an ordinary failure nor mask a safety-invariant failure; residual 21 (exit 18 masking 17 and 1) is stated and **still not accepted**. `APPROVAL_MISMATCH` and exit 14 stay deferred. `neg-c02-no-lowering` asserts both rows with one inversion each. (Supports owner verification points 2 and 5.)

## 6. Section F (rev 20) — the claims baseline (closes SEC-19 m-70)

**F.1 Counting method, defined once.** Case-insensitive, **leftmost-longest, non-overlapping** alternation over the token list: scan left to right; at each position take the longest matching token, count one and advance past it; otherwise advance one character. Overlaps therefore count once (`approver` inside `PILOT_APPROVER`; `RunToken` inside `RunTokenEmitter`; `PILOT_APPROVAL` inside `PILOT_APPROVAL_RUN_TOKEN`). Counts are occurrences, not lines.

**F.2 Scope and self-exclusion.** Tracked files, excluding **`docs/security/phase-18-design-review*.md`** (the rev 19 glob `-*.md` missed `docs/security/phase-18-design-review.md` and its 4 hits), `docs/architecture/phase-18-rev*` and **`docs/pilot-deferred/`** (exact prefix, trailing slash). For `docs/phase-18-acceptance-criteria.json` the file is parsed, the **`lintBaseline` subtree** and every criterion's **`prohibitedLiterals`** array are removed, and the count is taken over the concatenation of the remaining keys and string values in document order; the baseline and the prohibition data can therefore no longer inflate the file's own count, and the result does not depend on JSON formatting. **`docs/pilot/` remains a live surface** and must be matched with its trailing slash: a glob such as `docs/pilot*` would wrongly capture `docs/pilot-deferred/` and is prohibited.

**F.3 Recompute script.** A committed Node script, classified **production tooling** in `docs/pilot/reachability-roots.json` (C1), reading only tracked files, writing nothing, printing per-file counts as JSON, exiting non-zero when any file exceeds its baseline **or when the placeholder is still present**.

**F.4 Numbers.** The applying commit does not exist while this edit set is written, and the rev 20 edits themselves change the counts, so **no baseline numbers are committed**. `lintBaseline.counts` is the explicit placeholder **`PENDING-RECOMPUTE-AT-APPLY`** and the DOC gate **fails closed** while it is present. **Documented resolution step (coordinator, at apply time):** run F.3 on the applying commit, replace the placeholder with its output, record the command and its result. **Informative only**, measured at `5c355cb` by this method before the rev 20 edits are applied: AC JSON 89, plan 83, architecture document 80, traceability 64, threat model 52, owner decisions 38, `tests/regression/p16-locator-merge.check.cjs` 11, research document 6, `docs/PHASE-PLANS.md` 1, `tests/regression/p14-memory.check.cjs` 1. These are evidence, not the baseline.

**F.5 Unchanged.** Fail on any increase in any file; each new hit needs an inline marker in the same line or table cell; no file-level blanket applies to `README.md`, `docs/pilot/`, `src/`, `scripts/`, `.github/`, `package.json` or `.env.example`; the two `tests/regression/*` entries are baselined and never exempted. (Supports owner verification point 6.)

## 7. Section G (rev 20) — the deferred record replaces the commit and the tag (closes SEC-19 m-68)

**No tag is created, pushed or proposed.** The rev 19 proposal `phase-18-design-rev17-text-909d794` is **withdrawn**. All deferred design that 18P-PROTECTED-NONGET needs now lives in **`docs/pilot-deferred/phase-18p-protected-nonget.md`**: tracked, self-contained, **NON-NORMATIVE for Phase 18**, non-production, unshipped. It survives squash merge, branch deletion, shallow clone and ordinary checkout because it is file content, not a git reference.

It contains, copied rather than referenced: purpose and status; the gate-scoping rules of section 1; the **verbatim** deferred criteria AC-052, 053, 054, 055, 056, 057, 092, 093, 094, 096, 097 and the **verbatim deferred clauses** of the mixed criteria AC-032, 074, 083, 085, 086, 089, 090, 095, with each criterion's full current requirement text for context; the **verbatim rev 17 text** of the seven criteria that lost sentences (AC-074, 083, 084, 085, 089, 090, 095), copied from the design-history commit; the OWNER-12 and OWNER-13 deferred-work lists (single-transmission transport, browser response-semantic mismatch, redirect handling, `Sec-Fetch-*` differences, PUT/PATCH/DELETE measurements, multipart and large bodies, duplicate-send and socket retry, service workers, business-outcome verification, Firefox/WebKit evidence); the approval-writer research moved to 18P (approval-ledger filesystem policy, the PTY approval test, the production brand and registry, token consumption and replay, approval-root migration); the relevant SEC-04 to SEC-19 findings, including **m-51's full remediation** and **m-52's four conditions**; the SPIKE-R facts copied verbatim; and the deferred test obligations.

**Every dependency on `909d794` and the withdrawn tag is removed**: the seven `deferredTextRef` keys, AC-090's "preserved verbatim at git revision …" sentence (rev 18 A4) and AC-090's requirement now cite the file by path. **Commit ids appear only as historical context**; if one is unreachable, nothing is lost. **Scoping, so lint and reachability stay consistent:** `docs/pilot-deferred/` is excluded from the claims grep by exact prefix with its trailing slash (F.2), is **not** matched by the `docs/pilot/` live-surface rule, is linked from no operator document, report or dashboard, and contains no executable file; an added executable file there would need classification like any other entry and remains a forbidden target for production graphs. (Supports owner verification point 6.)

## 8. Section H (rev 20) — the sink scan

Unchanged from rev 19 H(a)–(e), with C0 made explicit: the scan is **receiver-type based over an AST**, not regex-based. Receivers are `Page`, `Frame`, `Locator`, `ElementHandle`, `APIRequestContext`, `Route`, `Mouse`, `Keyboard`, `Touchscreen`, `BrowserContext`, and the `evaluate`, `evaluateHandle`, `$eval`, `$$eval`, `setContent` family; a receiver bound through a local assignment is resolved by local data flow; an unresolvable receiver **fails closed**. A JSDoc annotation may only **add** a sink; removal requires syntactic array proof. The pilot gate call lives **inside `AIHealer._performAction`** (`:362`; `AIHealer` is exported at `:1134`), not at its callers. `scripts/**` modules are in scope only when reachable from a production-classified root **and** able to build a pilot context; none qualifies today. `HealingBenchmark.js:308-310` is in scope (C5a).

## 9. Nits closed (SEC-19)

C5 figures corrected to **21 production / 20 test** scripts. **`demo:record` is R4 only**, not R3 plus R4 (Appendix A.1). The garbled "rev 18 section C, of rev 19 section C" is removed from AC-090 `components`, plan line 32's 18D row and AC-084, each now citing **rev 20 section C** alone. The plan status line no longer says "m-65 to m-69 all closed"; it records SEC-19's verdict, M-23 open, m-70/m-71/m-72 new and m-68 carried. `-p`/`--print` added to the flag list (C3.4). The C3.4 argv conditions apply to `npx <bin>` (C3.4). Relative `Worker` paths and literal-only `path.resolve` fail closed (C3.3a).

## 10. Alternatives considered

1. **Commit SEC-19's prototype as the normative spec.** Rejected as code; its logic is instead stated as the normative pseudo-spec **C8 inside this patch**, because the prototype is regex-based and C0 requires AST analysis, so committing it would under-specify the control while appearing to satisfy it.
2. **Add `true` and `set` to `externalExecutables`.** Rejected: they are shell builtins, not executables; the closed builtin list C3.6a keeps the executable list honest.
3. **Name-matched `child_process` detection.** Rejected: it passes `GitInfo.js` by luck and misreads seven `RegExp#exec` sites. C3.4b uses bindings.
4. **Keep "classify `healing:benchmark` as `test`" as an alternative.** Rejected and withdrawn: two permissible answers make C4.1 unenforceable.
5. **Move the claims baseline into a new committed file.** Rejected for rev 20: the self-exclusion rule of F.2 achieves the same result without adding a file the coordinator's apply script cannot create.
6. **Keep a tag or a commit reference for the deferred text.** Rejected by owner decision; section G replaces it.
7. **Silently ignore `PILOT_APPROVAL_RUN_TOKEN`.** Rejected by owner decision: silent acceptance of an approval-shaped variable is indistinguishable from support for it.

## 11. Failure modes, fallback, observability, rollback

| Failure | Behaviour | Observability |
|---|---|---|
| Unclassified, mis-valued, or committed-differs-from-derived entry | check fails | entry, file, committed value, derived value, rule id |
| Unresolvable edge in `falcon.js` or the production-reachable set | check fails, no exemption | file, line, edge kind |
| `src/**` file reaching `tests/**` or `scripts/fixture/**` | check fails regardless of reachability | file, line, target |
| Executable not on the closed list, argv carrying a repository script, or an eval/require/print flag | check fails | step, command word, reason |
| Unknown shell builtin or construct | fails closed | step, word |
| `NODE_OPTIONS`/`NODE_PATH` on a production entry | check fails | entry, scope (inline, `env` arg, `env:` block, `.npmrc`) |
| Sink with an unresolvable receiver | fails closed | file, line, receiver expression |
| Claims baseline placeholder present, or a count increase | DOC gate fails closed | file, delta, each new hit |
| `PILOT_APPROVAL_RUN_TOKEN` present in pilot mode | exit 2, `PILOT_CONFIG_REJECTED_ENV_KEY`, before browser, filesystem or target access | reason code and variable **name** only; value never emitted |
| Protected step reached at runtime | exit 18 with mandatory reason, coverage reported lost, never PASS | `Logger.warning` plus receipt |
| Permitted element identity drift | exit 13, `POLICY_PLAN_IDENTITY_DRIFT`, zero requests | reason `heal_changed_permitted_element` |

Rollback: rev 20 is text in six documents plus one new tracked non-normative record; reverting restores rev 19 exactly. The only new runtime surface is the B1 refusal, whose rollback is removing one frozen array and its call — which the `neg-token-refusal-*` inversions detect.

## 12. Compatibility and migration

No schema, DB, OpenAI or CLI surface change. **No new exit code**: 2, 13 and 18 already exist; the three uses of exit 2 are disambiguated by mandatory reason codes. No production source edit in this revision. One new tracked documentation file. `docs/pilot/reachability-roots.json`, the two CI checks and the baseline recompute step land with 18D/18F. Baseline for compatibility claims stays `2572e73`. `GoogleSearchTest` stays out of CI. After this lands, adding a script, a `run:` step, a lifecycle script, an external executable or a production-tooling root requires a classification entry in the same change, and adding any claims-token hit requires an inline marker and a baseline recompute.

## 13. Test seams and acceptance mapping

| Seam | Criterion / finding |
|---|---|
| `reachability-roots.json` + AST resolver + C4.1 recomputation + nineteen inversion fixtures + three positive controls | AC-098 (ii), AC-090 (live clauses), AC-084, M-23 (a)–(e) |
| C3.6a builtin fixtures X8, X9 | M-23 item 1 |
| C3.4b binding fixtures X10, controls P1–P3 | M-23 item 2 |
| `src/**`-wide scan (C3.8) | M-23 item 3, AC-090, AC-084 |
| C3.9 environment-injection fixtures X1 (inline and `env:`) | M-23 item 4 |
| X2 committed-as-`test` fixture | M-23 item 4, C4.1 |
| `neg-dep-hb-unrequired`, no-pilot-invocation assertion | AC-098 (ii), OWNER-14-Q2(2) |
| fixture-server positive + inversion tests | owner check 4, OWNER-14-Q2(1) |
| receiver-type AST sink scanner with array false-positive fixtures | AC-084, AC-089 |
| `_performAction` callee-gate case | AC-089 |
| `neg-c02-no-lowering` exit-18 and exit-13 rows | m-27, AC-089, m-71 |
| `neg-token-refusal-present|empty|order|silence|carveout` | AC-084, m-72, owner checks 1 and 6 |
| clause-scoped JSON lint + F.1/F.2 baseline + placeholder fail-closed | section F, AC-098 (v), m-70 |
| exit-18 shard and CI assertions | AC-083, AC-084, AC-074 |

## 14. ADR-0048 — Deferred design lives in tracked, self-contained documentation; no requirement may depend on a git reference

**Status:** proposed (durable, cross-cutting). **Context:** three revisions preserved withdrawn-but-deferred criterion text "verbatim at git revision `909d794`" and proposed an annotated tag. That commit is reachable only from a local branch; a squash merge, a branch deletion or a shallow clone destroys the only copy, and the owner has decided there is no tag. **Decision:** (1) deferred requirements, findings, decisions and test obligations are copied into tracked documentation (`docs/pilot-deferred/phase-18p-protected-nonget.md`); (2) no live or deferred requirement may depend on retrieving a commit, tag or branch; (3) commit ids may appear only as historical context; (4) the deferred record is explicitly NON-NORMATIVE and non-production, excluded from the claims grep by exact path prefix, and not matched by the `docs/pilot/` live-surface rule; (5) a deferral that is not written down in that record is unenforceable. **Consequences:** deferral costs documentation work rather than git archaeology; the claims grep needs one exact-prefix exclusion; design-history files grow. **Alternatives:** an annotated tag (rejected by the owner, and unverifiable before push), relying on branch retention (rejected: orphanable), deleting the deferred text (rejected: it is an entry requirement for 18P).

ADR-0047 (rev 19) stands, amended by C0, C3.4b, C3.6a, C3.9 and C4.1: reachability is proven from committed roots by an **AST-based** checker whose committed classification is recomputed and compared, with a closed external-executable list and a closed builtin list, neither of which exempts repository code.

## 15. Handoffs

**Developer.** Implement nothing until the owner authorises. When authorised: no production source change for the reachability control; write `docs/pilot/reachability-roots.json` from C4 and C1; implement the checker per C0 and the C8 pseudo-spec (AST, bindings, shell parser, YAML `env:` scopes); place the pilot gate inside `AIHealer._performAction`; implement the single B4 refusal site exactly as scoped, presence-only, value never read or emitted; `Logger` only, no `console.log`; CommonJS; `fs.promises` on hot paths; exit 18 with a mandatory reason, exit 13 for permitted-element identity drift, exit 2 with `PILOT_CONFIG_REJECTED_ENV_KEY`.

**QA.** Build the nineteen inversion fixtures and three positive controls of C6, the C4.1 committed-vs-derived cases, `neg-dep-hb-unrequired`, the fixture-server positive and inversion tests, the exit-18 and exit-13 `neg-c02-no-lowering` rows, the five `neg-token-refusal-*` cases with their inversions, the receiver-type sink cases, and the F.1/F.2 baseline cases including the placeholder-fails-closed case. **Do not weaken a test to make the tree pass**: an unclassified script, an unknown executable, an unknown builtin, a `NODE_OPTIONS` production entry, a mis-committed classification and an unresolvable receiver must each fail.

**Security (SEC-20).** Re-review scope: this patch, `phase-18-rev20-edits.json`, the new 18P record, and their effect on the six documents. Specifically: (a) do C0, C3.4b, C3.6a, C3.8, C3.9, C4.1 and C8 close M-23 items 1 to 4 and remediations (a) to (e) **as design**, given that no run is claimed; (b) is the C6 fixture and control set sufficient; (c) does section F make the baseline reproducible, and is the fail-closed placeholder acceptable; (d) does section B satisfy m-72 in full, including ordering, presence semantics and secret safety; (e) does section G close m-68, and is the `docs/pilot-deferred/` scoping consistent with the lint, the claims grep and the reachability docs; (f) is the exit-13 merge rank acceptable; (g) carried items m-21, m-23, m-24, m-26 to m-28, m-30, H-1, H-3, H-7, H-8, R-8, R-10 and residuals 4, 13, 15, 21, 24, 25, 25a, 26 — **none accepted here**.

**DevOps.** Two fail-closed deterministic checks plus the F.3 baseline recompute step; no uncontrolled third-party site; no new network dependency. The AST checker needs a parser dependency: declare it and keep `npm ci` free of lifecycle scripts, otherwise C3.5 stops treating `npm ci` as a leaf. **Node 24 remains UNVERIFIED (H-8).** **Create and push no tag.** At apply time, run F.3 and record the command and result; a gate run with the placeholder present must fail.

**Owner.** No new confirmation is requested. OWNER-13-Q1, OWNER-14-Q1 and OWNER-14-Q2 are recorded as **DECIDED** with their validation conditions; the run-token rejection and the no-tag decision are integrated. Residual 21 and the R-8 residuals remain **stated and not accepted**; acceptance is yours alone.

## Appendix A — amendments to the rev 19 appendix

**A.1** Unchanged except: `demo:record` is **R4** only. Totals: **21 production, 20 test** (41).

**A.2** Unchanged except: step 334's `|| true` and step 462's `set -o pipefail` are **shell builtins under C3.6a**, not executables, and are annotated as such.

**A.3** The closed `externalExecutables` list is unchanged: `git`, `ps`, `ffmpeg`, `ffprobe`, `psql`, `curl`, `allure`, `mkdir`, `cp`, `mv`, `rm`, `tee`, `head`, `cat`, `seq`, `sleep`, `echo`. Accepted under OWNER-14-Q1 as **closed executable classification data**, valid only while C3.4b, C3.6a and C3.9 are enforced.

**A.4 (new)** Closed shell-builtin list: `set` (option flags only), `true`, `false`, `:`. Excluded and always fail closed: `.`, `source`, `eval`, `exec`, `command`, `builtin`, `trap`.

**A.5 (new)** Production-tooling roots: `healing:benchmark` (C5a) and the F.3 claims-baseline recompute script.
