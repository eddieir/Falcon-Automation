# Phase 18 Security Design Re-review 17 (SEC-18)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `0fbe099` on `docs/phase-18-architecture`. That is architecture rev 2 plus the rev 3 to rev 18 patches; the rev 18 content is `dd8b3da`, and `0fbe099` only trims whitespace.

Scope: the complete Phase 18 design after rev 18. That means `docs/architecture/phase-18-rev18-patch.md`, `phase-18-rev18-edits.json`, and their effect on six documents: the AC JSON, plan, threat model, traceability, owner decisions and architecture document. It is checked against re-review 16 (SEC-17) and supersedes it.

This is a design review only. No browser, runtime, server or CI probe was run. Five read-only shell probes were made, and every check below was run against the CURRENT files, not taken from the patch.
- P1: commit list, `package.json`, the `scripts/` and `src/core/locator/` inventory, and the diff stat `909d794..HEAD` (9 files).
- P2: a Python check of the AC JSON. It covered counts, phases, `mergeCondition` types and the deferred set. It scanned the live text for tokens, using `phaseClauses.current` for mixed criteria and the whole text otherwise. It also compared the text sentence by sentence against `909d794`.
- P3: the full text of AC-032, 051, 052, 085, 089, 094 and 095 and of the open items; a token `git grep` of the plan, threat model, traceability and owner decisions; a grep of the residual lines; and the repository-wide stale-claim `git grep`.
- P4: a parser listing every `ci.yml` `run:` step, including the contents of multiline blocks; references to `tests/` in production code; Playwright `testDir`/`testMatch`; the fixture server's requires and bind address. The P4 edge grep failed because of a flag-order error, so it was re-run in P5.
- P5: non-literal `require`, `import()`, `createRequire`, `child_process` and worker edges in `falcon.js`, `src/` and `scripts/`; the callers of HealingBenchmark, the fixture server and `_performAction`; action sinks in `scripts/` and `falcon.js`; the fixture server's dependencies; approval keys in `.env.example`.

Files were otherwise read with the read tool. **No Node runtime was exercised. Node 24 is UNVERIFIED (H-8). Firefox and WebKit are UNVERIFIED.** The Security Engineer role is read-only; the coordinator saves this text without changing its findings.

**Verdict: BLOCK for 18D and 18F. APPROVE WITH CONDITIONS for 18B, 18E and DOC.**
- 18A: unchanged. The SEC-15 APPROVE WITH CONDITIONS stands.
- 18C: no major. Conditions m-66 and m-69 apply.
- **Blockers: 0. Majors: 1 (M-23). New minors: 5 (m-65 to m-69). No P0.**
- **The owner's requirement "zero blockers and zero majors" is NOT met at 0fbe099.**
- M-21 is closed in the gate source of truth.
- Nothing here risk-accepts anything. Acceptance belongs to the owner alone.

## Evidence checked

| # | Check | Result |
|---|---|---|
| E1 | AC JSON counts (P2) | 98 total: 89 Must, 6 Should, 3 Could. No IDs were added or removed. `mergeCondition: false` is set on exactly 11 criteria: {052, 053, 054, 055, 056, 057, 092, 093, 094, 096, 097}. This equals `counts.deferredIds` and `deferredToPhase18P` (11). Phases: 77 have no phase, 2 are `current` (AC-051, AC-084), 8 are `mixed` (032, 074, 083, 085, 086, 089, 090, 095; equal to `mixedPhase18PIds`), 11 are `deferred-18P`. `mergeCondition` types: 78 absent, 1 `true` (AC-084), 8 objects (the mixed set), 11 `false`. Nit: `deferredUnderOptionC` is still 5, but the wholly deferred non-OWNER-13 set is now 4 (092, 093, 096, 097), presumably because AC-086 is now mixed. The count needs a stated definition |
| E2 | `exitCodes` | `policyRefusal: 18`, plus `policyRefusalNote`. `approval: 14` is kept, and its `approvalNote` marks it RESERVED and unreachable in Phase 18. Every live criterion uses exit 18 for a protected-step refusal. The leftover exit 14 text is outside the JSON (m-66) |
| E3 | Token scan of live text (P2). Tokens: ApprovalStore, ApprovalRecord, ApprovalCliWriter, PilotApprovalResolver, approve-action, emit-token-to, RunToken, LedgerLock, ledger approval, approval(s) root, APPROVAL_MISMATCH/REQUIRED/STALE/REPLAYED, approved half, tests-only executable, PILOT_APPROVAL, PILOT_APPROVER, replay-protected, pty-approve, approver, approval unlocks, exit 14 | **Zero hits in any `phaseClauses.current` of the 8 mixed criteria.** No hit in any no-phase criterion. One `current` criterion has hits: AC-084 (`approve-action`, `emit-token-to`, `tests-only executable`), all in a prohibition context. The bodies of the mixed criteria (requirement and components) still carry tokens: AC-032, 074 and 090 inside deferral annotations; AC-095 inside a deferral parenthetical; **AC-085's requirement keeps the whole approval-root partition (`APPROVAL_REQUIRED exit 14`, genesis entry, approvals root) with no inline marker**. In AC-085 only the components field and the clause-level `mergeCondition` mark it deferred (m-65, m-67) |
| E4 | Sentence diff against `909d794` (P2) | Text missing from the current file. Intended removals: AC-051's superseded inversion, AC-085's "operator guide states why the approval root must be durable", and AC-086's stray `deferred-18P` token. Rewritten to exit 18 or replaced by a short `phaseClauses` label with no verbatim copy: AC-074 (2 sentences), AC-083 (1), AC-084 (3), AC-089 (1), AC-095 (3). AC-090 (13 sentences) is preserved by git reference, as A4 states. AC-052 to AC-057 and AC-094 each show exactly one changed "sentence", which is the ID, priority and `pr` prefix (18D changed to 18P). The requirement text of AC-052 and AC-094 was read and is intact. **No live obligation was weakened:** AC-084 dropped its carve-out (stricter), and AC-095's static check widened from `approval/` plus the gate to all of `src/core/pilot/` (stricter). But the deferred text of six criteria now exists only in git history (m-68) |
| E5 | Pairwise live-Must contradictions | AC-084 against AC-090 is resolved: AC-090 no longer requires the flags. AC-098 against AC-055 and AC-095 is resolved (AC-055 deferred; AC-095's current clause covers only the gate). AC-094 is deferred. AC-083, AC-084, AC-089 and AC-074 all use exit 18. **New contradiction: AC-098 (ii) against section C and AC-090 (M-23).** Smaller ones: AC-090's requirement against its own current clause, and AC-089's requirement against its own current clause (m-67) |
| E6 | AC-098 (P2) | Unchanged. (ii) still reads: "the require graph rooted at `falcon.js` and at every `package.json` script reaches no `tests/` file, no experimental fixture". It cites 11a.4/11d.5, not section C (M-23) |
| E7 | `package.json` (P1) | 41 scripts. `main` is `falcon.js`; there is no `bin`; there are no `pre*`, `post*` or `prepare` lifecycle scripts. This matches Appendix A.1 |
| E8 | `ci.yml` `run:` steps (P4) | **33**, matching Appendix A.2 line for line, so the list is complete. Multiline blocks: 270 (`npm run history:export`), 296 (`node scripts/history.js check`), 334 (`npx allure`), 392 (`nohup node scripts/fixture/server.js ... &`, `curl`, `seq`, `sleep`), 405 and 476 (shell only), 462 and 530 (`node falcon.js merge`). Steps that run something other than repository code: 36, 99, 389, 436 and 520 (`npm ci`); 38 (`npm audit`); 39, 102 and 390 (`npx playwright install`); 133 (`psql`) |
| E9 | Edges (P5) | `require(path.join("..", ...))` uses only literal segments in `scripts/dashboard.js`, `flakiness/`, `healing/`, `history.js`, `llm/`, `review/`, so C2 resolves them. `spawn(process.execPath, [path.join(ROOT, ...)])` with a variable `ROOT` is at `scripts/benchmark/parallel.js:92`. `spawn(process.execPath, ['falcon.js', ...], {cwd: dir})` is at `parallel.js:150` and `scripts/demo/lib/env.js:239`. `spawn("npm", ["run","dev",...])` is at `env.js:154`. Spawns of executables other than node: `ps` (`parallel.js:71`); `ffmpeg`/`ffprobe` (`scripts/demo/media/{build,capture,poster,render}.js`); `git` (`scripts/production-cycle/{append-event,dashboard}.js`, and **`src/core/history/GitInfo.js:21` `execFile("git", argv)`**). `createRequire(__filename)` plus `import("openai")` appear in three `src/core/llm/providers/*`, and `import("pixelmatch")` in `src/core/VisualRegression.js:13` |
| E10 | References to `tests/` from production code (P4) | Only comments, the directory-skip list at `scripts/demo/lib/env.js:117`, and **`HealingBenchmark.js:87` `path.join(__dirname,"..","..","..","tests","fixtures","benchmark")`**, which is a data path read through `fs` |
| E11 | Callers (P5) | Nothing in `falcon.js`, `src/` or `scripts/` requires `HealingBenchmark.js` (the only other mention is a comment at `CandidateMatcher.js:108`). `scripts/fixture/server.js` is spawned only by `parallel.js:92` and `ci.yml:393`; `falcon.js` does not reach it. The fixture server requires only `node:http` and listens on `127.0.0.1` (`:90`). **`AIHealer` is exported as a class (`AIHealer.js:1134`), and `_performAction` (`:362`) is a prototype method** |
| E12 | Action sinks in `scripts/` and `falcon.js` (P5) | `falcon.js:371, 402, 457` (`page.goto`). `scripts/demo/lib/gate.js:50, 148, 157` (`goto`) and `:286` (`.mouse.click`). `scripts/demo/lib/hydration.js:30` (`click`). `scripts/demo/media/build.js:65` and `scripts/demo/record-run.js:32` (`goto`). No `request.post/put/patch/delete/fetch` in `scripts/` or `falcon.js`. Hypothesis H-a is now partly confirmed (m-69) |
| E12a | `.env.example` (P5) | No `PILOT_` key (rc=1) |
| E13 | Plan (read) | Section 1 item 4 is detection and refusal (closed). The 18D row defers the approval file set by name, adds `neg-dep-reachability`, and names six inversion fixtures. The 18E row defers the approvals-root rows. The 18F row defers the pilot-manual project and script. **Line 100 still adds `PILOT_APPROVER` and `PILOT_APPROVAL_RUN_TOKEN` to `.env.example`, which contradicts line 91, section B and section 14. Line 55 lists `--approve-*` among the Phase 18 flags** (m-66). The status line (line 3) still says "rev 3..rev 17" (nit). A file-level blanket annotation is at line 116 |
| E14 | Threat model (read) | The 18D row enumerates the deferred rows exactly (closes SEC-17 E12). The 18E row enumerates the approvals-root rows. The DOC row defers the approver-string limitation and the durable-root rationale. **Section 6 items 9 ("refused in shard mode and in CI, exit 14 ... approver label"), 12 ("approval ledgers"), 14 ("approval history ... approver") and 15 ("Exit 14 may outrank") have no inline OWNER-13 marker, and the DOC row requires items 8 to 18 to be published in `docs/pilot/limitations.md`.** Item 23 has no inline marker (m-66). A blanket annotation is at line 311 |
| E15 | Traceability (read) | D3 uses exit 18. D4 marks the approved half and its exit-0 executable as withdrawn. Items 41 to 45 are added. **The `m-27` row (line 64), which is a carried open 18B merge condition, still requires "refusing `APPROVAL_MISMATCH` (`heal_changed_classified_element`, exit 14)" and a test "refused with exit 14"** (m-66). A blanket annotation is at line 283 |
| E16 | Owner decisions (read) | Residual 4 has its own 11l(3) text: open, with a Phase 18 trigger. Residual 15's annotation is superseded per 11h.4: it has a Phase 18 trigger. Residuals 24, 25 and 26 have OWNER-13 annotations. 25a is promoted. R-9 is MOOT (also in the JSON open items). Nit: 25a's body carries residual 25's rev 12/13 writer-prompt text ("no in-process caller can prompt ...", entry identity, `process.mainModule`), which is about the writer, not the forwarding server. Line 30 (the OWNER-era design assumption, exit 14) is owner-record history and is covered only by the blanket |
| E17 | Architecture document (stale-claim grep) | Lines 52, 55, 98, 141, 145, 146, 150, 152, 307, 309, 312 and 495 have inline DEFERRED markers. Line 406 is SUPERSEDED. Lines 207, 443, 542, 561, 564 to 566, 594 and 615 rely on the blanket at line 681. Line 561 maps the **live** AC-051 to "ApprovalStore + run token" |

## M-21 (SEC-17): CLOSED in the gate source of truth

- **Classification.** Every criterion named in M-21, plus AC-052, 053 and 057, is classified wholly deferred or clause by clause (E1). Every live clause is token-free (E3). No live Must contradicts AC-084 or AC-098's prohibitions (E5). The run-token transport conflict is removed by section B.
- **Plan, threat-model and traceability rows.** M-21's own verification asked for zero un-deferred hits. That holds only because of the file-level blankets (see m-65(b)).
- **Leftover text,** none of which reintroduces a live approval obligation in the JSON: m-66 (exit 14 and approval text outside the JSON) and m-67 (consistency inside the JSON).

## M-23 (Major, new): M-22 is not closed. The dependency-reachability check is still unimplementable on the current tree, and the gate criterion still states the rejected roots

**Severity:** Major. This check is the only technical control behind owner check 4 and AC-098 (ii). **Likelihood:** certain for items 1 and 2. **Impact:** the check either fails on day one or gets implementer-chosen leaf and exemption rules. That is the same failure mode, with the same consequences, as M-22. Section 11a.4 bans exemptions.

**Evidence:**
1. **The gate text was not changed.** AC-098 (ii), a live Must with no phase and no `mergeCondition`, still roots the graph "at every `package.json` script" and forbids reaching "no `tests/` file, no experimental fixture" (E6). Six test scripts run files under `tests/` (`test:unit`, `test:ui` through `test:login`/`test:checkout`, `test:api`, `test:db`, `test:regression`, `test:coverage`), so AC-098 (ii) fails on day one. It also contradicts section C1 and AC-090, which root the graph at classified entries. This is M-22 item 1 left in the source of truth, which is the M-21 defect class.
2. **C2 has no rule for commands that are not repository code, and its literal rule fails on the current tree.** C2 makes "every other ... `createRequire`, `child_process` spawn ... execFile" fail closed; only `node <literal path>` is a graph edge. Run against the current tree:
   - `src/core/history/GitInfo.js:21` `execFile("git", argv)` (production `src/`);
   - `createRequire` in all three LLM providers;
   - `execFileSync("git", ...)` in both production-classified production-cycle scripts;
   - `spawnSync("ps")` (`parallel.js:71`);
   - `ffmpeg` and `ffprobe` (four demo modules).
   All of these fail. None can be "rewritten" into a literal node edge, and rewriting `src/` modules is a production change outside Phase 18 scope.
   The workflow resolver also "fails closed on anything unresolvable", yet steps 36, 38, 39, 99, 102, 133, 389, 390, 436 and 520 run executables that are not repository code (`npm ci`, `npm audit`, `npx playwright install`, `psql`), and block 392 uses `nohup`, `&`, `curl`, `for`/`seq`.
   C5's statement that "the current tree must pass with zero exemptions" is therefore not true as specified. The architect states that the `run:` steps were "not otherwise read in full".
3. **Some argv values are non-literal and C2 offers no constant propagation:** `parallel.js:92` (`ROOT` variable), `parallel.js:150` and `env.js:239` (`'falcon.js'` relative to a variable `cwd`), and `env.js:154` (`npm run dev` in another package's `cwd`). C2 applies fail-closed to all of `src/`, `scripts/` and `falcon.js`, whatever the root classification, so these must be rewritten before the check can pass. The patch does not list them.
4. **The classification is internally inconsistent.**
   - C5 lists `fixture:serve`, `demo:gate`, `demo:record-run`, `demo:build` and `bench:parallel` as **test**.
   - Appendix A.1, the "generated inventory the classification file must cover", proposes all five as **production (confirm)**.
   - C3 proposes the fixture server as **production**.
   - Of 41 script rows and 33 step rows, every proposal not marked test carries "(confirm)". No deterministic rule produces the classification.
5. **Relocating the fixture server or not changes coverage.** While `scripts/fixture/server.js` is outside `tests/`, the "no production root reaches `tests/`" rule cannot detect `falcon.js` or `src/` reaching fixture code. That is owner check 4's case. It does not happen today (E11), but nothing would catch it.
6. **The path-resolution rule could misfire as written.** C2 says "resolve ... `path.join`/`path.resolve` expressions built only from string literals and `__dirname`", without restricting this to edge arguments. `HealingBenchmark.js:87` is exactly such an expression and points into `tests/`. C3 says data reads are not edges, but C2's wording does not say so.

**Remediation (design):**
1. Rewrite AC-098 (ii) to section C. The roots are `falcon.js`, `main`/`bin`, and the production-classified entries of `docs/pilot/reachability-roots.json`. Matching is by exact path, and the citation is "rev 18 section C", not 11a.4/11d.5. Keep the AC-098 inversion.
2. Add a deterministic leaf rule to C2. A child-process call or `run:` command is a leaf only if all three hold:
   - its executable is a literal on a closed `externalExecutables` list committed in the classification file (for example `git`, `ps`, `ffmpeg`, `ffprobe`, `psql`, `curl`, `mkdir`, `cp`, `mv`, `rm`, `tee`, `head`, `cat`, `seq`, `sleep`, `echo`);
   - its argv holds no repository `.js`, `.cjs`, `.mjs` or `.sh` path;
   - it uses no `-e`, `--eval`, `-r`, `--require`, `--import` or `--loader`.

   These are never leaves; they are resolved or fail closed: `node`, `bash`, `sh`, `npm`, `npx`, `yarn`, `pnpm`, `nohup`, `env`, `xargs`, `eval`, `exec`, `$(...)`, backticks, `find -exec`. `npm ci`/`npm audit` are leaves only while the root package has no lifecycle scripts; any `pre`, `post`, `install` or `prepare` script must be classified. `npx <bin>` is a leaf only for a declared dependency's bin; `npx playwright test` is resolved as a Playwright config-load edge.

   Security accepts such a list because it is data with a closed shape that exempts no repository code, and every addition is a reviewed change. The owner must confirm it is not an "exemption" under 11a.4.
3. `createRequire(__filename)` followed by a literal call is a literal require edge. A bare specifier that resolves outside the repository is a leaf. One that resolves inside it, through self-reference or `imports`, is an edge.
4. Apply fail-closed to every module reachable from a production-classified root. Alternatively, list the `parallel.js:92,150` and `env.js:154,239` rewrites as named 18F work. Choose one.
5. Adopt one deterministic classification rule and regenerate Appendix A from it. For example: `test` if and only if the command runs a file under `tests/`, a Playwright test runner, or a test-classified npm script; otherwise `production`. Remove "(confirm)" and make C3, C5 and Appendix A agree.
6. Fixture server. Either move it to `tests/fixture/server.js` and classify `fixture:serve`, the `parallel.js:92` spawn target and step 392 as `test`, or keep it and add an exact forbidden target, `scripts/fixture/**`, for the `falcon.js` and `src/**` graphs. Security accepts either. The owner chooses.
7. State that `path.join`/`path.resolve` is resolved only as an argument of an edge kind (`require`, `require.resolve`, `import()`, a `createRequire()` call, a `node` spawn argv entry, `Worker`). An `fs` data read is not an edge.
8. Add inversion fixtures beyond C4's six. Each must fail:
   - `createRequire(__filename)("../../tests/x")` in `src/`;
   - `new Worker("./tests/x.js")` in `scripts/`;
   - a production step `bash -c "node tests/x.js"`;
   - a production step `nohup node tests/x.js &`;
   - a production step `npx playwright test`;
   - a classification value other than `production`/`test`;
   - an unclassified `pre`/`post` lifecycle script;
   - `falcon.js` requiring the fixture server (if it is not moved).

   Add one positive control, which must pass: `execFile("git", argv)` in `src/`.

**Verification:** a recorded CI run of the check over the current tree with zero exemptions; every inversion fixture failing; AC-098 (ii) and AC-090 citing the same section C rule.

## m-65 (Minor, new): the section F JSON lint and claims grep are not deterministic as written
- (a) The lint says "no `mergeCondition != false` text contains a token". Read literally, it fails today on:
  - AC-084 (`current`, `true`): `approve-action`, `emit-token-to`, `tests-only executable`, all prohibitions;
  - the bodies of AC-032, 074, 085, 090 and 095, whose criterion-level `mergeCondition` is an object.
  "Prohibition context" and "deferral annotation" need a semantic judgement, which is the matcher class C2 itself rejected.
- (b) The file-level blanket annotations (plan:116, threat model:311, traceability:283, owner decisions:197, architecture document:681) declare every token occurrence in the file unshipped "unless explicitly marked live". Any hit in those files therefore satisfies the grep, now and after any future regression, so the grep is vacuous there.
- **Remediation:**
  - Lint `phaseClauses.current` for mixed criteria, and the whole text for `current` and no-phase criteria.
  - Move AC-084's forbidden literals into a structured `prohibitedLiterals` array that the lint skips by key.
  - Record per-file hit counts at rev 18 and fail on any increase, with each new hit needing an inline marker in the same line or cell.
  - Never let a blanket apply to `README.md`, `docs/pilot/**`, `src/`, `scripts/`, `.github/`, `package.json` or `.env.example`.

## m-66 (Minor, new; leftover from m-60 and m-62): exit 14 and approval text remains outside the JSON on live paths
- Traceability `m-27` row (line 64): an open 18B merge condition requires `APPROVAL_MISMATCH` exit 14 for a DOM swap of a classified element. Section D requires exit 18. Choose a Phase 18 code and reason for the permitted-element swap case, and use exit 18 `POLICY_PROTECTED_ACTION_UNSUPPORTED` when the swap reclassifies the element to protected.
- Threat model section 6 items 9, 12, 14 and 15 (exit 14, approver label, approval ledgers, approval history), with item 23 alongside. The DOC row requires items 8 to 18 to be published, so this text would reach `docs/pilot/limitations.md`. Annotate each item inline and give the Phase 18 wording.
- Plan line 100 (the approval env keys) and plan line 55 (`--approve-*` as a Phase 18 flag): delete or annotate them inline.
- AC-083 components: "token refusal". The architecture document's line 561 maps the live AC-051 to "ApprovalStore + run token". Plan status line 3: update to rev 18.

## m-67 (Minor, new): inconsistencies inside the AC JSON's live clauses
- AC-089: the requirement keeps the refusal of "identity differs from the recorded plan-row identity" (the substance of m-27), but `phaseClauses.current` omits it. Under a clause-scoped lint it would not be a merge condition. Add it.
- AC-090: the requirement and C3 allow exactly one prototype location, `tests/experimental/`. The current clause says "only under tests/ or tests/experimental/". Align it to `tests/experimental/`.
- AC-090 says "five inversion fixtures", while the plan 18D row, the threat-model rows 18D and 18F, and C4 say six.
- AC-085's requirement carries the deferred approval-root partition with no inline marker. This is acceptable only once m-65 scopes the lint to clauses.

## m-68 (Minor, new): the deferred text is preserved only by a git reference that may not survive the merge
- A4 preserves AC-090 by reference to `909d794`.
- AC-074, 083, 084, 089 and 095 lost sentences that were replaced by short labels, and they carry no git-reference pointer (E4).
- A squash merge followed by branch deletion can leave `909d794` unreachable from `main`.
- **Remediation:** an annotated tag on `909d794` pushed to the remote, cited by every criterion that lost text. Alternatively, a verbatim, non-normative `deferredText` field that the lint skips by key. Security accepts the tag approach for A4. No verbatim copy is required.

## m-69 (Minor, new; partial closure of m-63): gaps in the sink-scan definition
- (a) The scan covers `src/` and `scripts/`. It does not cover `falcon.js`, which has `page.goto` at `:371`, `:402` and `:457`.
- (b) The list of receiver types leaves out `Mouse`, `Keyboard`, `Touchscreen`, `BrowserContext` (`context.route`, `context.request`), and the `evaluate`, `$eval` and `setContent` family. Example: `scripts/demo/lib/gate.js:286` `.mouse.click`. Something like `const m = page.mouse; m.click()` is not clearly covered.
- (c) A JSDoc annotation may only add a sink, never remove one. Removal needs syntactic proof, such as an array literal, `new Array` or `Array.from`.
- (d) The `_performAction` proof obligation cannot be discharged. `AIHealer` is exported (`:1134`) and `_performAction` is a prototype method callable on any instance, so the rule as written puts the gate inside `_performAction`. Update the plan's 18B row now rather than at implementation time.
- (e) Scanning `scripts/` will hit the demo sinks (E12), which have no pilot mode. Give a deterministic discharge rule, such as limiting the scan to modules reachable from production-classified roots that can build a pilot context. Otherwise the scan fails on day one.
- The AST scan, the receiver awareness, the removal of comment and string false positives, the self-test fixtures and fail-closed on unresolvable receivers are acceptable.

## Decisions requested by ARCH-18 (Security position; none is an acceptance for the owner)
- **(a) M-21:** closed (see above).
- **(b) Section C:** not yet implementable (M-23).
  - Fixture server: either option in remediation 6 is acceptable.
  - `HealingBenchmark.js`: Security accepts the `production` classification of `healing:benchmark` under four conditions:
    - remediation 7 (a data read is not an edge);
    - the sink scan covers `:308-310`;
    - an assertion that no production module requires it (true today, E11);
    - hypothesis H-b (reachable in pilot mode) is answered by that assertion.

    Classifying the script `test` without moving the file is also acceptable. The owner decides.
- **(c) Section B (silent ignore of `PILOT_APPROVAL_RUN_TOKEN`):** acceptable to Security **as a design**. Nothing reads the variable. The literal is absent from `src/`, `falcon.js`, `package.json`, `scripts/`, `.github/` and `.env.example` (no hit in the repository-wide grep outside docs; E12a). A protected step is still refused loudly, with exit 18, its reason code and lost coverage. A refusal module would reintroduce the literal that AC-098 must fail on. Conditions:
  - plan line 100 is fixed (m-66);
  - `docs/pilot/limitations.md` states in a prohibition context that Phase 18 has no approval environment variable;
  - AC-084 keeps failing on a run-token env key in workflows.

  The residual, that an operator gets no feedback on the variable itself, is stated, not accepted. The owner confirms.
- **(d) A4:** acceptable once m-68 is met.
- **(e) m-63:** partly closed (m-69).

## SEC-17 findings: status
- **M-21:** closed (leftover text in m-66 and m-67).
- **M-22:** not closed; superseded by M-23.
- **m-59:** closed. AC-086 has its clause-level `mergeCondition`, the stray token is gone, and the deferral and window sentences are present. The coordinator's diff of AC-086 against 11e.1 A3, requested in A5, was not evidenced to Security at the time of review. AC-051's old inversion sentence is deleted.
- **m-60:** closed in the JSON. Leftover text: m-27 row and threat-model item 9 (m-66).
- **m-61:** closed. Nit: the body of 25a (E16).
- **m-62:** closed for the architecture document, plan section 1 and AC-085. Leftover text in m-66.
- **m-63:** partial (m-69).
- **m-64:** closed (OWNER-13-Q1 corrected; traceability item 44).

## The owner's six verification points
1. **No production approval writer is reachable: PASS in design, with condition m-66.**
   - AC-094, the writer clauses of AC-090, and the plan's 18D approval file set are deferred.
   - `falcon.js`, `src/`, `scripts/`, `package.json` and `.github/` have no stale-claim token: the repository-wide grep hits only `docs/`.
   - Plan lines 55 and 100 must be fixed.
2. **No approval consumer is reachable: PASS in design, with condition m-66.**
   - AC-054, 055 and 056 are deferred. The approved-identity clause of AC-089 and the consumption clauses of AC-090 are deferred.
   - The traceability m-27 row still names `APPROVAL_MISMATCH`.
3. **No dormant A''/B'' transport is reachable: PASS.**
   - AC-086 is clause-gated with only window validation live. AC-096 and AC-097 are `mergeCondition: false`. The plan's 18C row withdraws M1 and `route.fetch`.
   - No `request.*` sink in `scripts/` or `falcon.js` (P5). The `src/` route and request finding is carried from SEC-17 E7 and was not re-run.
4. **Fixture or research code cannot enter production dependency graphs: FAIL (M-23).**
   - Today's tree: no production code edge into `tests/` (only the `fs` data path at `HealingBenchmark.js:87`), and `falcon.js` does not reach the fixture server.
   - But the control cannot yet be implemented, and AC-098 (ii) contradicts it.
5. **Refusal before click, submission, network, provider or healing: PASS in design, with conditions m-66 (m-27 exit code), m-67 (AC-089 clause) and m-69.**
6. **Public claims describe refusal only: PASS for the public surfaces, with conditions m-65 and m-66.**
   - README: no hit. `docs/pilot/` was not re-listed this run; per SEC-17 E16 it had no tracked files.
   - Threat-model items 9, 12, 14 and 15 are slated for publication and must be annotated first.
   - Repository-wide `git grep -nIiE` for `approved protected submit|approved half|enables protected|executes approved|destructive.action support|two-command approval|approval unlocks|approve-action|emit-token-to|RunToken|ApprovalStore`, excluding the design reviews and rev patches. Every live hit and its disposition:
     - Architecture document:
       - 52, 55, 98, 141, 145, 146, 150, 152, 307, 309, 312, 495: inline DEFERRED, acceptable.
       - 406: SUPERSEDED, acceptable.
       - 207, 443, 542, 564, 565, 566, 594, 615: blanket only, acceptable as history subject to m-65(b).
       - 561: blanket only. **It maps the live AC-051 to ApprovalStore and a run token** (m-66).
       - 681: the blanket itself.
     - AC JSON:
       - 68, 85: MOOT or accepted open-item history, acceptable.
       - 127: the 18P item, acceptable.
       - 452, 464 (AC-032): deferral, acceptable.
       - 649, 660, 671 (AC-054 to AC-056): deferred, acceptable.
       - 821, 834 (AC-074): deferral, acceptable.
       - 931 (AC-084): prohibition, acceptable (m-65(a)).
       - 1032, 1033, 1047 (AC-090): deferral, acceptable.
       - 1066, 1076, 1077 (AC-092, AC-093): deferred, acceptable.
       - 1086 (AC-094): deferred, acceptable.
       - 1098, 1111 (AC-095): deferral, acceptable.
     - Traceability:
       - 12 (D4): partly inline, rest by blanket, acceptable.
       - 46: MOOT, acceptable.
       - 62: prohibited-phrase history, acceptable.
       - 89, 150, 174, 253: history, acceptable.
       - 283: the blanket.
       - Outside the pattern: line 64 (m-27), **violation** (m-66).
     - Owner decisions:
       - 96: annotated, acceptable.
       - 126: history, acceptable.
       - 197: the blanket.
     - Plan:
       - 3: status line, acceptable (nit: rev 18).
       - 32: deferral, acceptable.
       - 34: prohibition list, acceptable.
       - 110: 18P, acceptable.
       - 116: the blanket.
       - Outside the pattern: lines 55 and 100, **violations** (m-66).
     - Research doc 100: annotated, acceptable.
     - Threat model:
       - 244 (item 20): annotated, acceptable.
       - 248 (item 23): blanket only (m-66).
       - 276: enumerated deferral, acceptable.
       - 311: the blanket.
       - Outside the pattern: items 9, 12, 14 and 15 (m-66).
     - No live hit for "enables protected", "executes approved", "destructive action support", "two-command approval" or "approval unlocks".

## Other required statements
- **OWNER-13-Q1 (m-51): OPEN, pending owner confirmation.**
  - The correction is applied: AC-092 carries m-51's substance and has `mergeCondition: false`; the PTY test is AC-094, also deferred.
  - Security's SEC-17 condition, that deferral is acceptable only if no fixture approval authority stays in scope, is now met: AC-090's fixture authority and the plan's `FixtureApprovalAuthority` are deferred.
  - Security therefore does not object to the deferral.
  - The genuine-recording-server obligation stays live in AC-051.
  - The decision is the owner's.
- **Counts:** 98/89/6/3 confirmed. 11 wholly deferred. 8 mixed. No deletion or renumbering of IDs. Exit 14 is reserved and exit 18 is used in every live criterion.

## Hypotheses (not verified)
- H-b: answered for the require graph (no production module requires HealingBenchmark). It is not answered for runtime pilot-mode invocation of the script.
- H-c: repeated hop-zero `route.abort` with zero server transmissions over at least 10 runs. Still unmeasured.
- H-d (new): GitHub keeps PR refs, so `909d794` may stay reachable after a squash merge, but this was not verified (m-68).

## Carried, unchanged, not accepted
- Findings: m-21; m-23 (UNVERIFIED); m-24; m-26; m-27 (now with the exit-code defect in m-66); m-28; m-30.
- H-1, H-3, H-7 (carried to 18P). H-8: Node 24 UNVERIFIED.
- R-8: deferred with the fixture authority; residual text in 25a and 26. R-9: MOOT (verified). R-10: deferred.
- Residuals:
  - 4: open, with a Phase 18 trigger (verified);
  - 13: carried, not re-inspected;
  - 15: has a Phase 18 trigger (verified);
  - 21: exit 18 masking 17 and 1, still not accepted;
  - 24: annotated; the repository-write limitation now also covers the section C check;
  - 25: deferred;
  - 25a: deferred (nit, E16);
  - 26: deferred.
- New: M-23, m-65 to m-69.
- Nothing here risk-accepts any item. Acceptance is the owner's alone.

**Final: BLOCK** (M-23). The owner's zero-blocker, zero-major requirement is not met.
