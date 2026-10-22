# Phase 18 Security Design Re-review 19 (SEC-20)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `cdc75ee` on `docs/phase-18-architecture` (rev 20 on top of `5c355cb`). This record supersedes SEC-19. The Security Engineer role is read-only; the coordinator saved this text from the reviewer's report in condensed form without changing findings. Task status as reported: **PARTIAL**. The design review is complete; the executable prototype covered only part of what was requested (see "Not executed").

**Verdict: APPROVE WITH CONDITIONS for 18A, 18B, 18C, 18D, 18E, 18F and DOC, as design only. Blockers: 0. Majors: 0 (M-23 closed as design, subject to m-73).** New minors: m-73, m-74, m-75. A small piece of m-68 is open. **The reachability checker does not exist yet and has not been run. It stays a mandatory implementation gate for 18D and 18F. No current-tree pass of it is claimed.** The zero-blockers, zero-majors requirement is met on design text only. Implementation authorisation belongs to the owner. **Node 24, Firefox and WebKit UNVERIFIED.**

## What the prototype executed (scratchpad `sec20/p.cjs`, not committed)

Command: `node p.cjs` from the scratchpad. It used Babel `babelParse` and `traverse` from `node_modules/playwright/lib/transform/babelBundle.js`, and `node_modules/yaml`, loaded by absolute path. No acorn or @babel/parser exists in the tree.

| Check | Result |
|---|---|
| Inventory (package.json; ci.yml via YAML) | 41 scripts, 33 `run:` steps, no lifecycle scripts |
| C3.9 NODE_OPTIONS / NODE_PATH | 0 in workflow, job or step `env:`; 0 inline; no `.npmrc`. Tree clean |
| Shell command words in `run:` blocks (rough splitter) | All are listed executables, C3.6a builtins (`true` once, `set` once), node/npm/npx, or shell keywords; leftovers `nohup` (C3.6) and splitter artefacts. Indicative only, not the C3.6 parser |
| AST parse of falcon.js, src/**, scripts/**, utils/** | 0 parse failures |
| child_process calls by scope binding | GitInfo plus git, ps, npm, ffmpeg, ffprobe sites under scripts/. Non-literal executables only in `scripts/benchmark/parallel.js:92,150` and `scripts/demo/lib/env.js:239` (test-only; C3.7 does not apply) |
| Real GitInfo shape | `:34` `childProcess.execFileSync` is the default value of destructured parameter `exec` (AssignmentPattern), not an argument to `runGit`. `exec` is passed to `runGit` at `:39` and `:44` and called as `execFile("git", argv)` at `:21`: two hops (m-73) |
| C3.8 literal require from src/ into tests/ or scripts/fixture/ | 0 |
| 18P record self-containment | All 11 deferred criteria verbatim (string equality); all deferred clauses of the 8 mixed criteria verbatim; no 40-char SHA |
| `909d794` / tag still in AC JSON | 2 hits (AC-090 "preserved verbatim at git revision 909d794" and the tag name) |
| lintBaseline placeholder | present (`PENDING-RECOMPUTE-AT-APPLY`); rules say fail closed |

**Not executed:** the full transitive walk from every root (SEC-19's 84-module result reused, not re-run); C4 derivation and committed-vs-derived comparison (no committed classification file yet); the 19 inversion fixtures and 3 positive controls; dynamic-executable and variable-argv validation; fixture-server prohibition; HealingBenchmark classification; clause-aware lint; claims recount; receiver-type sink analysis for falcon.js and scripts/ (SEC-19's regex sink result reused). No CI, browser or runtime run.

## SEC-19 findings: status

- M-23 item 1 (builtins): closed (C3.6a, A.4).
- M-23 item 2 (GitInfo): closed as design, condition m-73. Binding-based detection mandated, name matching banned. The AST shows only 2 `.exec` member calls; SEC-19 counted 7 RegExp sites; the difference is not reconciled.
- M-23 item 3 (gate text): closed; AC-084 and AC-090 aligned to C3.7/C3.8.
- M-23 item 4 (wrong-pass): closed (C4.1, `test` alternative withdrawn, C3.9 four scopes).
- Remediations (a) to (e): present; fixtures X1, X2, X8, X9, X10 and controls P1 to P3 added.
- m-70: closed as design. A placeholder baseline is acceptable only because the gate fails while it is present; F.3 must land before any DOC gate run and the recompute command and output must be recorded at apply time. Not recounted.
- m-71: closed (AC-089 requirement matches). The merge rank is wrong: m-74.
- m-72: closed in design (B1 to B7, `prohibitedLiteralsCarveOut`). Narrower than the owner's wording: O-1.
- m-68: mostly closed; residual: the two AC JSON hits must be removed or marked historical-only.
- Nits: closed; two leftovers covered by m-75.

## New findings

**m-73 (Minor, mandatory before the checker is built).** C3.4b says "every call of the receiving parameter", but the receiving binding `exec` is never called, only forwarded; a literal reading passes vacuously, forwarding to another module or storing would wrong-pass (X10 would not catch it), and a strict one-hop reading fails the current tree. The patch also misdescribes the flow. Remediation: track the value within the module through default initializers, `const` aliases and call arguments to local functions; fail closed on any escape (returned, stored, exported, passed to a non-local function) and on a value never called. Add fixture X11 (forwarding escape) and a control using the real two-hop shape. Verification: X11 fails, P3 (real shape) passes.

**m-74 (Minor, a weakening as written).** The exit-13 merge rank contradicts the established order `2 > 3 > 18 > 17 > 16 > 15 > 13 > ...` (rev 6, `neg-merge-exit-precedence`; rev 17 11f.3). `exitCodes.policyNote` and threat-model item 15 place 13 "immediately below 18 and above 17", which would let 13 mask 17, 16 and 15 while claiming it cannot mask a safety-invariant failure. Remediation: keep the rev 6 order and fix both texts; otherwise the owner must decide it as a new residual.

**m-75 (Minor).** Citations and counts disagree: AC-098 says rev 20 is the only section cited yet still cites rev 19 sections C1 to C5 and rev 19 section C in components; threat-model rows 18D/18F still say fourteen fixtures and one control; the plan 18F row cites rev 19 section C; the plan status line still lists SEC-19, OWNER-14-Q1 and Q2 as pending; AC JSON openItems OWNER-14-Q1/Q2 `state` still read "Owner confirmation requested". Remediation: cite rev 20 section C and "nineteen fixtures and three controls" everywhere; mark decided items DECIDED.

## Owner verification points

1. No writer reachable: PASS in design. 2. No consumer reachable: PASS. 3. No dormant transport reachable: PASS (carried). 4. Fixture or research code cannot enter production: PASS in design, conditional on m-73; the checker is the gate. 5. Refusal before click, submission, network, provider or healing: PASS, conditional on m-74. 6. Public claims describe refusal only: PASS in design; `docs/pilot-deferred/` excluded by exact prefix, `docs/pilot/` matched with trailing slash, `docs/pilot*` prohibited; not recounted.

Nothing weakened versus `63f80e4` except m-74 as written. Counts 98/89/6/3. AC-051 dropping "armed" is consistent with OWNER-12.

## Owner items

- **O-1.** B1 refuses only "in pilot mode" and "before any write under run/"; the owner decision said before filesystem access. dotenv reads `.env` at `falcon.js:50` before any check can run; deciding pilot mode can require reading the manifest; outside pilot mode the variable is silently ignored. The owner should confirm this narrowing, or require refusal on presence in every falcon.js run immediately after dotenv loads.
- OWNER-13-Q1, OWNER-14-Q1/Q2: DECIDED, not reopened; only stale `state` text remains (m-75).
- Carried, not accepted: residual 21, R-8, H-8 and the SEC-19 carried list. Acceptance is the owner's decision alone.

**Final: APPROVE WITH CONDITIONS. Blockers 0, Majors 0.**
