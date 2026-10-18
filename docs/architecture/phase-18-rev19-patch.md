# Phase 18 architecture rev 19 patch (ARCH-19) — closes SEC-18 M-23 and m-65..m-69

Normative prose. **Nothing here authorises implementation, merge, publication, deployment or any tag push.** Design only: no browser, runtime, server or CI probe was run. **Node 24 is UNVERIFIED (H-8); Firefox and WebKit are UNVERIFIED.** OWNER-12 (Option C) and OWNER-13 (no production approval path) are binding and are not reopened. OWNER-13-Q1 (m-51) stays OPEN.

The machine-applicable edit set is `docs/architecture/phase-18-rev19-edits.json` (schema `phase-18-rev19-edits/1`: the rev 18 schema plus `openItemsAdd`, the per-criterion keys `prohibitedLiterals`, `prohibitedLiteralsNote` and `deferredTextRef`, plus `lintBaseline` and `coverage`). Where the two disagree, this prose is normative and the JSON is a defect. Every `old` string in the JSON was asserted by script to occur **exactly once** in its target field or file at the reviewed revision.

## 0. Why rev 18 failed review

SEC-18 found M-22 unclosed as M-23: the gate criterion still stated the rejected roots, section C2 had no rule for commands that are not repository code, and the classification was "(confirm)" rather than derived. Rev 19 adds no machinery. It (a) fixes the gate text, (b) adds one deterministic classification rule and one closed leaf rule, (c) narrows fail-closed to the production-reachable set, and (d) verifies by walking the current tree that the check passes with **zero exemptions** and **zero production-code changes**. This is the smallest design that makes the check implementable and passing today.

## 1. Context and constraints

- The AC JSON is the gate; a criterion with no `phase` and no `mergeCondition` is a live Must.
- Phase 18 ships detection and refusal only. One by-design refusal code: exit 18 with a mandatory reason code. Exit 14 is reserved and unreachable.
- No production source file is edited by rev 19. No file is moved. CommonJS, Node >= 22 locally, Node 24 in CI (UNVERIFIED).
- No criterion is deleted, renumbered or weakened.
- Reachability is a **CI check over repository text**, not a runtime feature, so it has no rollback surface beyond reverting the check.

## 2. Affected components and trust boundaries

| Area | Change in rev 19 | Trust boundary |
|---|---|---|
| AC JSON (AC-083/084/085/089/090/098, counts, open items) | gate text, clause alignment, structured `prohibitedLiterals` | merge gate |
| `docs/pilot/reachability-roots.json` (new, committed data) | classification of every script and `run:` step, plus the closed `externalExecutables` list | CI gate input |
| `.github/workflows/ci.yml` | two new fail-closed checks (18D/18F work, not added here) | CI |
| `src/**`, `falcon.js`, `scripts/**`, `package.json` | **unchanged by rev 19** | production |
| `tests/experimental/` | sole prototype location | test |

## 3. Section C (rev 19) — the production dependency-reachability check, implementable and passing today

Supersedes rev 18 section C and 11a.4/11d.5 for this control. Cite "rev 19 section C".

**C1. Roots (exact paths, no patterns).** Production roots are: `falcon.js`; `package.json` `main` (`falcon.js`) and every `bin` entry (none today); and every entry classified `production` in the committed file `docs/pilot/reachability-roots.json`, which must classify **every** `package.json` script (41 today) and **every** workflow `run:` step (33 today, each multiline block covering every command inside it). Legal values are exactly `production` and `test`; there is no exempt value and no third value. An unclassified, unknown or mis-valued entry **fails the check**.

**C2. Forbidden targets.** A production-classified root, and every module reachable from one, must not reach any path under `tests/`, any path under `tests/experimental/`, or any path under `scripts/fixture/`. Matching is by exact normalised repository path prefix. Test-classified roots are unconstrained. The `scripts/fixture/**` target is the rev 19 answer to owner check 4 (SEC-18 remediation 6, keep-in-place option): it is enforced for the graphs rooted at `falcon.js` and `package.json` `main`/`bin`, and for every module under `src/**`, so production code can never acquire a fixture dependency even though the fixture server stays outside `tests/`. **Flagged for owner confirmation; no move is proposed.**

**C3. Edge resolution.**
1. Edges are: `require`, `require.resolve`, `import()` with a literal argument, a `createRequire(...)` call with a literal argument, a `node`/`process.execPath` child-process argv entry naming a repository file, `worker_threads.Worker` with a literal path, and a Playwright config / `testDir` / `testMatch` load.
2. `path.join`/`path.resolve` built only from string literals and `__dirname` is resolved **only as the argument of an edge kind in (1)**. An `fs` data read is not an edge (SEC-18 remediation 7). This is what makes `HealingBenchmark.js:87` (`tests/fixtures/benchmark/`) a data path, not a violation.
3. `createRequire(__filename)` followed by a literal call is a literal require edge. A bare specifier resolving outside the repository is a **leaf**; one resolving inside it (self-reference or `imports`) is an edge (SEC-18 remediation 3). This makes the three `src/core/llm/providers/*` `createRequire(__filename)` plus `require("openai")` pairs, `import("openai")` and `import("pixelmatch")` leaves.
4. **Leaf rule (SEC-18 remediation 2), all three conditions required:** the executable is a literal on the closed `externalExecutables` list in the classification file; its argv holds no repository `.js`, `.cjs`, `.mjs` or `.sh` path; and it uses no `-e`, `--eval`, `-r`, `--require`, `--import` or `--loader`. The committed list for the current tree is exactly: `git`, `ps`, `ffmpeg`, `ffprobe`, `psql`, `curl`, `allure`, `mkdir`, `cp`, `mv`, `rm`, `tee`, `head`, `cat`, `seq`, `sleep`, `echo`. It is **data with a closed shape that exempts no repository code**; every addition is a reviewed change to a committed file. **This is OWNER-14-Q1: the owner must confirm it is not an "exemption" under 11a.4.**
5. Never leaves; resolved or fail closed: `node`, `bash`, `sh`, `npm`, `npx`, `yarn`, `pnpm`, `nohup`, `env`, `xargs`, `eval`, `exec`, command substitution, backticks, `find -exec`. `npm ci` and `npm audit` are leaves **only while the root `package.json` has no `pre*`, `post*`, `install` or `prepare` script** (true today); any such script must be classified. `npx <bin>` is a leaf only for a bin of a declared dependency or a member of `externalExecutables`; `npx playwright test` is resolved as a Playwright config-load edge.
6. **Shell parsing of `run:` blocks.** Only command words of simple commands are resolved. Shell control constructs (`for`, `while`, `if`, `then`, `do`, `done`, `fi`, `else`, test brackets, braces, variable assignment, redirection, `&`, `&&`, `||`, `|`, `exit`) are not invocations. A command substitution is resolved by resolving the command inside it; it is never skipped. `nohup node <literal>` resolves to `node <literal>`.
7. **Fail-closed scope (SEC-18 remediation 4, option 1).** Fail-closed applies to `falcon.js` and to every module reachable from a production-classified root. A non-literal edge there fails the check with file, line and edge kind. It does **not** apply to modules reachable only from test-classified roots; consequently `scripts/benchmark/parallel.js:71,92,150` and `scripts/demo/lib/env.js:154,239` need **no rewrite** and no 18F rewrite work is created. This is the option with no production-code change.
8. Matching is exact path and exact export name. The approval-export list is empty in Phase 18, so AC-098 (iii) passes vacuously and provably.

**C4. One deterministic classification rule (SEC-18 remediation 5). No "(confirm)" remains.** An entry (a `package.json` script or a workflow `run:` step) is **`test` if and only if at least one of R1..R4 holds**, otherwise `production`:
- **R1** some resolved command runs a repository file under `tests/`;
- **R2** some resolved command invokes a test runner: `playwright test`, `npx playwright test`, or `node --test`;
- **R3** every repository entry it resolves to is an npm script already classified `test` by R1..R4 (transitive, cycle-detected);
- **R4** some resolved command's entry file is under exactly one of four prefixes: `scripts/demo/`, `scripts/benchmark/`, `scripts/fixture/`, `docs/demo/`.

**Tie-break (fail-closed):** if an entry resolves to both a test-classified repository entry and a production-classified one, it is **`production`** and every test entry it reaches is a violation. Appendix A is regenerated from this rule; the committed file is the authority.

**C5. The current tree passes with zero exemptions.** Generated by reading `package.json` and `.github/workflows/ci.yml` at this revision and walking every production-classified root's edges:
- Production scripts (22): `start`, `report`, `healing:benchmark`, `healing:pending|approve|reject`, `flaky:list|quarantine|unquarantine`, `review:status`, `review:status:strict`, `history:list|export|check`, `dashboard`, `production:event`, `production:dashboard`, `llm:profile:list|show|set|delete`.
- Test scripts by rule (19): `test:unit`, `test:login`, `test:checkout`, `test:search`, `test:ui`, `test:api`, `test:db`, `test:all`, `test:e2e`, `test`, `test:regression`, `test:browser`, `test:coverage`, `test:demo` (R1/R2/R3); `demo:gate`, `demo:record-run`, `demo:build`, `bench:parallel`, `fixture:serve` (R4); `demo:record` (R3 plus R4 via `docs/demo/`). 22 + 19 = 41.
- Production `run:` steps (20): 36, 38, 39, 99, 102, 133, 226, 270, 296, 324, 334, 389, 390, 402, 405, 436, 462, 476, 520, 530. Test `run:` steps (13): 40, 41 (R3); 110, 117, 125, 150, 153, 156, 159, 166, 169 (R1); 328 (R2); 392 (R4, `nohup node scripts/fixture/server.js`). 20 + 13 = 33.
- Edge walk of the production set, with every non-repository command shown to be a leaf under C3.4: `src/core/history/GitInfo.js:21` `execFile("git", argv)` — leaf; the `git rev-parse --git-common-dir` call via `execFileSync` in both `scripts/production-cycle/` scripts (`:221` and `:37`) — leaves; `createRequire(__filename)` plus `require("openai")` in the three LLM providers and `import("openai")` — leaves (C3.3); `import("pixelmatch")` in `src/core/VisualRegression.js:13` — leaf; `require(path.join(<literals>))` in `scripts/dashboard.js`, `scripts/history.js`, `scripts/healing/review.js`, `scripts/flakiness/review.js`, `scripts/review/status.js` and `scripts/llm/profile.js` — resolved; step 133 `psql ... -f scripts/db/ci-seed.sql` — leaf (`.sql` is not an argv `.js/.cjs/.mjs/.sh` path); steps 36/38/99/389/436/520 `npm ci` and `npm audit` — leaves (no lifecycle script); steps 39/102/390 `npx playwright install` and step 334 `npx allure` — leaves; blocks 270/296/405/462/476/530 — `mkdir`, `rm`, `mv`, `cp`, `tee`, `head`, `cat`, `echo` leaves plus the resolved `npm run history:export`, `node scripts/history.js check` and `node falcon.js merge` edges.
- Result: **no production-classified root reaches `tests/`, `tests/experimental/` or `scripts/fixture/`; no unresolvable edge remains; no exemption is required.** `ps`, `ffmpeg` and `ffprobe` are not reached from the production set at all (they sit under the test-classified `bench:parallel` and demo entries) and are on the closed list anyway.
- `src/core/locator/HealingBenchmark.js` stays **production** via `healing:benchmark`, under SEC-18's four conditions, all met here: a data read is not an edge (C3.2); the sink scan covers `:308-310` (section H); no production module requires it (SEC-18 E11), asserted as a committed check `neg-dep-hb-unrequired`; and that assertion answers H-b for the require graph. The script appears in no workflow and on no `falcon.js` path, so it has no pilot-mode invocation, which the same check asserts. **Flagged for owner confirmation**; classifying the script `test` without moving the file remains acceptable to Security and would also pass.

**C6. Inversion fixtures — fourteen, each must fail the check; plus one positive control that must pass.** The rev 18 C4 six: `require(path.join("..","tests","x"))` in `scripts/` reachable from a production root; `import("../../tests/x")` in `src/`; `spawn(process.execPath,["tests/x.js"])` from a production root; a `production`-classified step running `node tests/experimental/x.js`; a new unclassified `package.json` script; a new unclassified `ci.yml` `run:` step. The eight added by SEC-18 remediation 8: `createRequire(__filename)("../../tests/x")` in `src/`; `new Worker("./tests/x.js")` in `scripts/` reachable from a production root; a production step `bash -c "node tests/x.js"`; a production step `nohup node tests/x.js &`; a production step `npx playwright test`; a classification value other than `production`/`test`; an unclassified `pre`/`post` lifecycle script; `falcon.js` requiring `scripts/fixture/server.js`. **Positive control:** `execFile("git", argv)` in `src/` passes. The single count used everywhere is **fourteen inversion fixtures and one positive control**, closing the five-versus-six drift of SEC-18 m-67.

**C7. Verification.** A recorded CI run of `neg-dep-reachability` over the current tree with zero exemptions; every one of the fourteen fixtures failing; the positive control passing; AC-098 (ii) and AC-090 citing this section.

## 4. Section D (rev 19) — the m-27 exit code (closes SEC-18 m-66, first bullet)

A DOM swap of a classified element during the actionability wait has two Phase 18 outcomes, both with zero requests:
- the swapped element **reclassifies to protected**: `POLICY_PROTECTED_ACTION_UNSUPPORTED`, **exit 18**, reason `heal_changed_classified_element`;
- the swapped element **stays permitted but its identity differs from the recorded plan row**: `POLICY_PLAN_IDENTITY_DRIFT`, **exit 13** (`exitCodes.policy`), reason `heal_changed_permitted_element`. Exit 13 is chosen so the permitted-element case is distinguishable from both the by-design protected refusal and `PILOT_INTERNAL_ERROR` (both 18); it adds no exit code.

`APPROVAL_MISMATCH` and exit 14 are deferred to 18P. `neg-c02-no-lowering` asserts both rows with one inversion each.

## 5. Section F (rev 19) — a deterministic JSON lint and a non-vacuous claims grep (closes m-65)

- **(a) Lint scope.** For `phase: "mixed"` criteria the lint reads **`phaseClauses.current` only**. For `phase: "current"` and for criteria with no `phase` it reads the whole text (`requirement`, `components`, `verification`). Keys the lint **skips by name**: `phaseClauses.deferred-18P`, `deferralNote`, `deferredTextRef`, `prohibitedLiterals`, `prohibitedLiteralsNote`, `countsNote`, `approvalNote`, `policyRefusalNote` and `openItems[].state`.
- **(b) AC-084's forbidden literals move into a structured `prohibitedLiterals` array** on that criterion, which the lint skips by key; the requirement prose refers to the array instead of quoting the literals. The prohibition is unchanged and still fails on the literals' existence.
- **(c) Per-file hit baseline.** The claims grep is no longer satisfiable by a blanket. Token list: the rev 18 section F list plus `exit 14`. Baseline occurrence counts, computed by script over the tracked tree excluding `docs/security/phase-18-design-review-*.md` and `docs/architecture/phase-18-rev*`: `docs/phase-18-acceptance-criteria.json` 90; `docs/phase-18-plan.md` 83; `docs/architecture/phase-18-authenticated-pilots.md` 80; `docs/phase-18-decision-traceability.md` 65; `docs/security/phase-18-threat-model.md` 47; `docs/phase-18-owner-decisions.md` 38; `tests/regression/p16-locator-merge.check.cjs` 11; `docs/research/phase-18/proposed-scope-and-criteria.md` 6; `docs/PHASE-PLANS.md` 1; `tests/regression/p14-memory.check.cjs` 1. The check **fails on any increase in any file**, and each new hit needs an inline marker in the same line or table cell. Counts are text occurrences, not lines; they are measured before the rev 19 edits are applied, so the baseline is recomputed once on application and that recomputed number is committed. The two `tests/regression/*` entries are locator-healing review text and the bare word `approver`: baselined, never exempted.
- **(d) Blankets never apply** to `README.md`, `docs/pilot/**`, `src/`, `scripts/`, `.github/`, `package.json` or `.env.example`. A hit in any of those fails regardless of any file-level annotation. The five existing blankets (plan:116, threat model:311, traceability:283, owner decisions:197, architecture document:681) stay valid only for design-history files and only together with (c).

## 6. Section G (rev 19) — m-67 and m-68

- **m-67:** AC-089's `phaseClauses.current` gains the plan-row-identity refusal (the live substance of m-27). AC-090's current clause is narrowed to `tests/experimental/` only, matching its requirement and C2. AC-085's requirement gains an inline deferral marker before the approval-root partition. The fixture count is fourteen plus one positive control everywhere.
- **m-68 (tag).** Proposed annotated tag name: **`phase-18-design-rev17-text-909d794`** on commit `909d794`, message "Phase 18 design rev 17 criterion text preserved for 18P-PROTECTED-NONGET". **It is NOT created and NOT pushed by this task.** It is a coordinator action requiring explicit owner authorisation to push; until it exists, the deferred text's survival depends on `909d794` staying reachable (H-d, unverified). Every criterion that lost text (AC-074, 083, 084, 085, 089, 090, 095) gains a non-normative `deferredTextRef` naming the commit, the file, the criterion id and the proposed tag; the lint skips that key.

## 7. Section H (rev 19) — the sink scan (closes m-69)

- **(a)** The scan covers **`falcon.js`**, `src/**`, and those `scripts/**` modules reachable from a production-classified root that can build a pilot context. `falcon.js:371,402,457` (`page.goto`) are in scope.
- **(b)** Receiver types: `Page`, `Frame`, `Locator`, `ElementHandle`, `APIRequestContext`, `Route`, **`Mouse`, `Keyboard`, `Touchscreen`, `BrowserContext`** (`context.route`, `context.request`, `context.newPage`), and the **`evaluate`, `evaluateHandle`, `$eval`, `$$eval`, `setContent`** family. A receiver bound through a local assignment (`const m = page.mouse; m.click()`) is resolved by local data flow inside the module; an unresolvable receiver **fails closed**.
- **(c)** A JSDoc annotation may only **add** a sink, never remove one. Removing a candidate requires syntactic proof that the receiver is an array: an array literal, `new Array` or `Array.from`. That is what discharges `EndpointPolicy.js:117`.
- **(d) `_performAction` (closes m-69(d) now, not at implementation time).** `AIHealer` is exported (`AIHealer.js:1134`) and `_performAction` (`:362`) is a prototype method callable on any instance, so the rev 18 "no other caller and not exported" proof **cannot be discharged**. The rule therefore fails closed to the callee: **the gate call lives inside `_performAction`**. The plan's 18B row is rewritten accordingly in this patch's edit set; the four former call sites keep their pilot-mode behaviour.
- **(e) `scripts/` discharge rule.** The scan is limited to modules reachable from a production-classified root **that can build a pilot context**, i.e. that can reach a Playwright `browser`, `context` or `page` constructor through resolved edges. Today no `scripts/` module qualifies, so the demo sinks (`scripts/demo/lib/gate.js:50,148,157,286`, `hydration.js:30`, `media/build.js:65`, `media/poster.js:36`, `media/render.js:122,130,131`, `record-run.js:32`) are out of scope **by rule, not by exemption**, because every demo entry is test-classified under C4/R4. If a production-classified module ever reaches a pilot context, its sinks become in scope and must route through the gate or be refused; the scan fails closed on that change.

## 8. Nits

- `counts.deferredUnderOptionC` keeps the value 5 and gains a stated definition: the OWNER-12 set `{086, 092, 093, 096, 097}`, i.e. criteria deferred by Option C whatever their rev 18 phase, which is why AC-086 is counted while being `mixed`. It is not a subset of `deferredIds`.
- Owner decisions residual 25a: the rev 12 writer-prompt body is marked as mis-pasted design history belonging to residual 25, and the withdrawn sentence is replaced in place.
- Plan status line moves to rev 19; plan lines 55 and 100 are corrected; architecture document line 561 is annotated.

## 9. Alternatives considered

1. **Move `scripts/fixture/server.js` to `tests/fixture/`** (SEC-18 remediation 6, option 1). Rejected for rev 19: a file move plus three reclassifications, where the forbidden-target rule gives the same coverage for owner check 4 with no move. The owner may still choose it.
2. **Rewrite the `parallel.js` and `env.js` spawns as named 18F work** (remediation 4, option 2). Rejected: code change for entries that are test-classified anyway.
3. **Classify `healing:benchmark` as `test`.** Acceptable to Security and still open to the owner; rejected as the default because it silently changes what the script is for.
4. **An exemption list.** Rejected: 11a.4 bans exemptions. The closed `externalExecutables` list exempts no repository code and is reviewed data (OWNER-14-Q1).
5. **Semantic sink or module matching.** Rejected again as non-deterministic.

## 10. Failure modes, fallback, observability, rollback

| Failure | Behaviour | Observability |
|---|---|---|
| Unclassified or mis-valued script or `run:` step | check fails | names the entry and its file |
| Unresolvable edge in the production-reachable set | check fails, no exemption | file, line, edge kind |
| Executable not on `externalExecutables`, argv carrying a repository script, or an eval/require flag | check fails | step, command word, reason |
| Production root reaches `tests/`, `tests/experimental/` or `scripts/fixture/` | check fails | the whole path chain |
| Sink with an unresolvable receiver | fails closed | file, line, receiver expression |
| Claims-grep count increase in any file | DOC gate fails | file, delta, each new hit |
| Protected step reached at runtime | exit 18 with mandatory reason, lost coverage reported, never PASS | `Logger.warning` plus receipt |

Rollback: rev 19 is text in six documents plus one new committed data file and two CI checks; reverting restores rev 18 exactly. No runtime surface changes.

## 11. Compatibility and migration

No schema, DB, OpenAI, CLI or exit-code surface change (exits 13 and 18 already exist). No production source edit. One new committed data file, `docs/pilot/reachability-roots.json`. `package.json` and `ci.yml` gain entries only when the checks land (18D/18F). Baseline for compatibility claims stays `2572e73`. `GoogleSearchTest` stays out of CI (`test:search` is test-classified and must appear in no workflow step). After this lands, adding any script or `run:` step requires a classification entry in the same change.

## 12. Test seams and acceptance mapping

| Seam | Criterion / finding |
|---|---|
| `reachability-roots.json` plus resolver plus fourteen inversion fixtures plus the positive control | AC-098 (ii), AC-090 (live clause), AC-084, M-23 |
| `neg-dep-hb-unrequired` (no production module requires `HealingBenchmark.js`) | AC-098 (ii), M-23 item 6, H-b |
| forbidden-target fixture (`falcon.js` requires the fixture server) | owner check 4, M-23 item 5 |
| empty approval-export list check | AC-098 (iii) |
| AST sink scanner with receiver cases and array false-positive fixtures | AC-084, AC-089, m-69 |
| `_performAction` callee-gate case | AC-089, m-69(d) |
| `neg-c02-no-lowering` exit-18 and exit-13 rows | m-27, AC-089 |
| clause-scoped JSON lint plus per-file claims baseline | section F, AC-098 (v), m-65 |
| exit-18 shard and CI assertions | AC-083, AC-084, AC-074 |

## 13. ADR-0047 — Production reachability is proven from committed roots with a closed external-executable leaf rule

**Status:** proposed (durable, cross-cutting). **Context:** the only technical control behind "fixture or research code cannot enter production dependency graphs" failed on the current tree in three successive revisions, because its roots were wrong, it had no rule for commands that are not repository code, and its classification was advisory. **Decision:** (1) roots are exact paths from `package.json` plus a committed two-valued classification of every script and `run:` step; (2) classification follows one deterministic rule (C4) with a fail-closed tie-break; (3) a child-process or `run:` command is a leaf only under three simultaneous conditions over a closed, committed `externalExecutables` list that exempts no repository code; (4) fail-closed applies to the production-reachable set only, so no production code is rewritten to satisfy the checker; (5) forbidden targets are `tests/**`, `tests/experimental/**` and `scripts/fixture/**` by exact path, with no file move; (6) `path.join` is resolved only as an edge argument, so `fs` data reads are not edges. **Consequences:** adding a script, a `run:` step, a lifecycle script or an external executable requires a reviewed classification change; dynamic edges in the production-reachable set must be literal; the check passes today with zero exemptions. **Alternatives:** file moves, production rewrites, exemption lists and semantic matchers, all rejected above.

## 14. Handoffs

**SEC-19 (Security Engineer).** Re-review scope: this patch, `phase-18-rev19-edits.json`, and their effect on the six documents. Specifically: (a) is M-23 closed — are C1..C7 implementable and fail-closed, and does the C5 walk establish that the current tree passes with zero exemptions; (b) is the closed `externalExecutables` leaf rule acceptable as data rather than an 11a.4 exemption (OWNER-14-Q1 is raised for the owner regardless); (c) is the `scripts/fixture/**` forbidden target an acceptable substitute for moving the fixture server; (d) is the `HealingBenchmark.js` production classification acceptable under your four conditions as discharged in C5; (e) m-65 lint determinism and the per-file baseline, including the `tests/regression/*` entries; (f) m-66 leftovers — the exit-13 choice for the permitted-element swap, the five threat-model annotations, plan lines 55 and 100, AC-083 components, architecture line 561, the plan status line; (g) m-67, m-68 (tag not created), m-69 (a) to (e), including placing the gate inside `_performAction`; (h) carried items m-21, m-23, m-24, m-26 to m-28, m-30, H-1, H-3, H-7, H-8, R-8, R-10 and residuals 4, 13, 15, 21, 24, 25, 25a, 26 — none accepted here.

**Developer.** Implement nothing until the owner authorises. When authorised: no production source change for this control; write `docs/pilot/reachability-roots.json` from C4; implement the resolver with C3's rules; place the pilot gate inside `AIHealer._performAction`; `Logger` only; CommonJS; `fs.promises` on hot paths; exit 18 with a mandatory reason, exit 13 for permitted-element identity drift.

**QA.** Build the fourteen inversion fixtures, the positive control, `neg-dep-hb-unrequired`, the forbidden-target fixture, the exit-18 and exit-13 `neg-c02-no-lowering` rows, the sink-scanner receiver and array fixtures, and the lint and baseline cases. Do not weaken a test to make the tree pass: an unclassified script, an unknown executable and an unresolvable receiver must each fail.

**Security.** See SEC-19 above. Nothing in this patch risk-accepts anything; acceptance is the owner's alone.

**DevOps.** Two fail-closed, deterministic checks, no uncontrolled third-party site, no new network dependency. The claims-grep baseline is a committed file, recomputed once when rev 19 applies. **Node 24 remains UNVERIFIED (H-8)**; confirm before any 18D/18F-equivalent merge. Do **not** create or push `phase-18-design-rev17-text-909d794` without recorded owner authorisation.

**Owner.** Confirmations requested, each flagged in place: **OWNER-14-Q1** (the closed `externalExecutables` list is reviewed data, not an 11a.4 exemption); **OWNER-14-Q2** (keep the fixture server in place with the `scripts/fixture/**` forbidden target instead of moving it; keep `healing:benchmark` classified `production`; authorise pushing the m-68 annotated tag). **OWNER-13-Q1 (m-51) remains OPEN** and is unaffected by this patch.

## Appendix A (regenerated from the C4 rule) — classification of every entry

### A.1 `package.json` scripts (41). `main` is `falcon.js`; there is no `bin`; there are no `pre*`, `post*` or `prepare` scripts.

| script | rule | classification |
|---|---|---|
| `start` | none | production |
| `test:unit` | R1 | test |
| `test:login` | R1 | test |
| `test:checkout` | R1 | test |
| `test:search` | R1 | test |
| `test:ui` | R3 | test |
| `test:api` | R1 | test |
| `test:db` | R1 | test |
| `test:all` | R3 | test |
| `test:e2e` | R1, R2 | test |
| `demo:gate` | R4 | test |
| `demo:record-run` | R4 | test |
| `demo:build` | R4 | test |
| `test:demo` | R2 | test |
| `demo:record` | R3, R4 | test |
| `report` | none (`allure` leaf) | production |
| `test` | R3 | test |
| `test:regression` | R1, R2 | test |
| `test:browser` | R2 | test |
| `test:coverage` | R1, R2 | test |
| `healing:benchmark` | none | production |
| `healing:pending` | none | production |
| `healing:approve` | none (locator healing, a different feature) | production |
| `healing:reject` | none | production |
| `flaky:list` | none | production |
| `flaky:quarantine` | none | production |
| `flaky:unquarantine` | none | production |
| `review:status` | none | production |
| `review:status:strict` | none | production |
| `history:list` | none | production |
| `history:export` | none | production |
| `history:check` | none | production |
| `dashboard` | none | production |
| `fixture:serve` | R4 | test |
| `bench:parallel` | R4 | test |
| `production:event` | none | production |
| `production:dashboard` | none | production |
| `llm:profile:list` | none | production |
| `llm:profile:show` | none | production |
| `llm:profile:set` | none | production |
| `llm:profile:delete` | none | production |

### A.2 `ci.yml` `run:` steps (33). A multiline block is classified once at its `run:` line and covers every command inside it.

| line | command | rule | classification |
|---|---|---|---|
| 36 | `npm ci` | none | production |
| 38 | `npm audit --omit=dev --audit-level=high` | none | production |
| 39 | `npx playwright install --with-deps chromium` | none | production |
| 40 | `npm run test:coverage` | R3 | test |
| 41 | `npm run test:browser` | R3 | test |
| 99 | `npm ci` | none | production |
| 102 | `npx playwright install --with-deps chromium` | none | production |
| 110 | `node tests/unit/ReportManagerExitCode.check.js` | R1 | test |
| 117 | `node tests/unit/DBConfigBehavior.check.js` | R1 | test |
| 125 | `node tests/unit/DashboardAuth.check.js` | R1 | test |
| 133 | `psql ... -f scripts/db/ci-seed.sql` | none | production |
| 150 | `node tests/ui/LoginTest.js` | R1 | test |
| 153 | `node tests/ui/CheckoutTest.js` | R1 | test |
| 156 | `node tests/api/UserApiTest.js` | R1 | test |
| 159 | `node tests/api/ProductApiTest.js` | R1 | test |
| 166 | `node tests/db/UserDBTest.js` | R1 | test |
| 169 | `node tests/db/OrderDBTest.js` | R1 | test |
| 226 | `node falcon.js --no-dashboard --repeat=3` | none | production |
| 270 | block: `mkdir`, `rm`, `npm run history:export`, `mv`, `echo` | none | production |
| 296 | block: `node scripts/history.js check`, `head`, `echo` | none | production |
| 324 | `node scripts/review/status.js` | none | production |
| 328 | `npx playwright test` | R2 | test |
| 334 | block: `npx allure awesome ...` | none | production |
| 389 | `npm ci` | none | production |
| 390 | `npx playwright install --with-deps chromium` | none | production |
| 392 | block: `nohup node scripts/fixture/server.js`, `curl`, `seq`, `sleep`, `cat`, `echo` | R4 | test |
| 402 | `node falcon.js --no-dashboard --url=... --shard=... --run-id=...` | none | production |
| 405 | block: `mkdir`, `cp`, `echo` | none | production |
| 436 | `npm ci` | none | production |
| 462 | block: `mkdir`, `node falcon.js merge`, `tee` | none | production |
| 476 | block: `mkdir`, `echo` | none | production |
| 520 | `npm ci` | none | production |
| 530 | block: `mkdir`, `cp`, `node falcon.js merge`, `echo` | none | production |

### A.3 Closed `externalExecutables` (OWNER-14-Q1)

`git`, `ps`, `ffmpeg`, `ffprobe`, `psql`, `curl`, `allure`, `mkdir`, `cp`, `mv`, `rm`, `tee`, `head`, `cat`, `seq`, `sleep`, `echo`. Data with a closed shape; exempts no repository code; every addition is a reviewed change.
