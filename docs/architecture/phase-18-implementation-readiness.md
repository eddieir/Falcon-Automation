# Phase 18 Scope A implementation-readiness package

Documentation only. **No implementation, no change to GitHub protection rules, dependency versions, browser binaries or workflows, no merge, no customer-readiness claim.** It carries the owner's Scope A decisions (after SEC-39) into design text. It is not a new architecture revision: rev 42 and rev 43 stay as recorded and are **not edited**. Where this package corrects them, the correction is stated in section 6 and controls.

**Baseline sync (2026-10-22, `main` at `2f31076`).** Dependency-maintenance work that this package proposed or assumed has since merged to `main` by separate, owner-approved pull requests. This sync updates only the statements about that work (section 4, the section 8 table, section 9 item 5 and one re-observation line in section 3). It changes **no** security gate, finding, residual-risk record or classification: C1 to C5, T1 to T3, m-134, m-143 to m-146, m-151 and the open MG gates are exactly as stated below, and **C2 independence remains UNMET**. Merged to `main` since this branch's base: exact Playwright pin plus browser verification (#62), Playwright 1.64.1 (#69), Dependabot grouping with Playwright in its own group (#63) and the first grouped dependency updates (#67, #68), removal of `mysql2` (#64) and OpenAI client hardening (#70: `OPENAI_CUSTOM_HEADERS` is no longer applied and SDK logging is off). None of these implements C1, C2, C3, C4 or C5.

**Developer tooling merged by #71 (2026-10-22, merge commit `e2dce1b`).** Pull request #71 added a standalone local dashboard for observing Claude Code sessions and agents under `tools/agent-telemetry/` (33 tracked files) and one isolated CI job, `agent-telemetry`. It is **developer tooling, not a Phase 18 control**: it is not part of Falcon's product code, it does not implement, test or provide evidence for C1 to C5, it is not a sandbox or an isolation boundary, and it neither provides nor affects C2 independence. It was reviewed by agents only and merged under an owner waiver that is scoped to that pull request alone (recorded in the cycle ledger); that waiver is not C2 independence and accepts no residual risk, and it is not a precedent for any other pull request.

Inputs reused without re-checking: `phase-18-rev42-patch.md` (sha256 `a8727adab7cb5810cae3eea3d861f9a169fe64aac1193ffd4afcc3a43931ab26`), `phase-18-rev43-patch.md` (sha256 `59352e43ed3c89850ccff8614d77f8b4f10e826c1f388af4e87f8f5f3dec557c`), `phase-18-design-review-37.md` (SEC-38) and `phase-18-design-review-38.md` (SEC-39). New in this package: read-only inspection of the repository's GitHub settings, `ci.yml`, `package.json`, `package-lock.json` and the installed Playwright metadata (section 3 and 4).

Residual-risk records (all **OPEN - NOT ACCEPTED**): `docs/security/phase-18-residual-risk-T1.md`, `-T2.md`, `-T3.md`.

## 1. Scope A specification-authorship policy

**Policy (owner decision).**
- Only reviewed, Falcon-maintained executable test specifications and fixtures may execute in the trusted test process.
- Customer-supplied data and configuration are accepted only through strictly validated declarative schemas, and are treated as **data**, never as instructions or trusted executable code.
- Customer-authored executable JavaScript, dynamically loaded customer modules, arbitrary scripts and compromised dependencies are **not covered by Scope A**.
- A workflow that needs untrusted executable code stays **disabled or blocked** until an independently verified Scope B isolation boundary exists (C5, incomplete).

**Supported workflow.** An operator runs Falcon-maintained specifications from the reviewed repository against a customer target. The customer's influence on the run is limited to declarative inputs: the pilot manifest, the role plan and the storage state, each validated against a schema. The specification files matched by `testMatch` in `playwright.config.js` (`**/*.test.js`, `**/*.spec.js` under `./tests`) are repository files, not customer files.

**Explicit refusal behaviour (requirement).** An attempt to run an executable file that is not a reviewed repository specification, to load a customer-supplied module, to pass code in configuration or to point the runner at a directory outside the reviewed tree must be refused before any browser launch, as a configuration error, with an actionable message and a non-zero exit through the existing exit-code classes. **The exact failure code is not chosen here**: adding a code changes the failure-code enum (P18-AC-012) and needs owner approval. Where untrusted code is requested, the message must say the workflow is blocked pending Scope B.

**Enforcement status (honest).**
- In CI, the executed-tree manifest of section 2 is the **planned** control (C2 is unbuilt): a specification file that is not in the reference manifest fails the check.
- For operator runs outside CI, **no enforcement exists today**, and the refusal logic above is **not implemented**. I did not inspect the code that selects spec paths. Whether the refusal needs a new mechanism or is a configuration check on an existing path is **undecided**, and is an owner and design decision before implementation (section 8). Until it exists, the policy is an operating assumption, not a control.

**Conflict check against mandatory acceptance criteria.** I filtered the 98 criteria in `phase-18-acceptance-criteria.json` for customer, author, script, specification and code wording and read the matches. The inputs named for the customer pilot are the manifest, the role plan (P18-AC-016) and storage state (P18-AC-001). **No criterion requires customer-authored executable JavaScript.** This is a keyword-filtered read, not a full read of every criterion; no conflict was found, and none is claimed to be impossible.

## 2. Trust and executed-tree inventory (C2 scope)

The C2 verified set is the union of (a) the final packaged artifact and (b) every input that materially affects a claim-bearing job. The inventory below is built from `git ls-files`, `ci.yml` (five jobs; `npm ci` at lines 36, 99, 389, 436 and 520; these are point-in-time facts at `70a615a`, superseded by the update after the table), `package.json` and the lockfile. **It is not proven complete.** No claim of complete repository or runtime coverage is made.

| Class | Items (tracked-file counts from `git ls-files` at the parent commit `70a615a`, unless stated) | Trust today | How C2 treats it |
|---|---|---|---|
| Source | `src/` (84 files, including `src/core`, `src/dashboard`, `src/config`, `src/production-cycle`), `falcon.js`, `utils/` (1) | Falcon-authored | Exact sha256 per file in the manifest |
| Scripts | `scripts/` (31 files: benchmark, db, demo, fixture, flakiness, healing, llm, production-cycle, review, `dashboard.js`, `history.js`) | Falcon-authored | Manifest |
| Tests and fixtures | `tests/` (209 files: `regression` 130, `fixtures` 64, `ui`, `api`, `db`, `unit`, `demo`, `full_automation.test.js`); preload files `tests/fixtures/*-preload.cjs` (4) | Falcon-authored; **these execute in the trusted process** | Manifest; preload files marked security-relevant |
| Configuration | `playwright.config.js`, `playwright.regression.config.js`, `playwright.demo.config.js`, `package.json`, `package-lock.json`, `.env.example`, `src/config/testConfig.json` | Falcon-authored | Manifest; canonical comparison of selected `package.json` fields |
| Workflows and automation | `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.claude/` (15 files) | Falcon-authored | Workflow files and the verifier are reference material loaded from the baseline (IND-1) |
| Documentation | `docs/` (214 files at the parent commit `70a615a`; 218 at `df694481` with the four files this package adds; 11 of them `.js`/`.cjs`) | Not executed by claim-bearing jobs unless named | The 11 script files are in the manifest or confirmed unexecuted before any claim |
| Dependencies | `node_modules/` from `npm ci` against the lockfile (267 integrity entries) | Trusted only as pinned | Lockfile sha256 in the manifest; integrity enforced by `npm ci` |
| **Generated or indirect inputs** | Restored caches (`vr-baselines-*`, `falcon-state-*`, `falcon-history-*`, keyed by branch name and run id); artifacts passed between jobs by `download-artifact`; Playwright browsers from `npx playwright install` (outside the lockfile); `apt` packages from `--with-deps`; the floating `ubuntu-latest` runner image; the digest-pinned `postgres:16-alpine`; GitHub Actions pinned by commit SHA; `.env` (local, untracked); LLM responses and the healing store | Mixed; cache, artifacts, browsers, apt and the runner image are **unverified** | Each needs an explicit rule or an explicit "not covered" line in the manifest design (sections 3 and 4). Restored caches and downloaded artifacts must be treated as untrusted input to any claim-bearing step until a rule says otherwise |

**Update after #71 (2026-10-22), not a refresh of the inventory.** The counts and `ci.yml` line numbers above were taken at the parent commit `70a615a` and are **not refreshed**; the `ci.yml` line numbers cited above were already out of date on `main` before #71. At `main` `e2dce1b`: the `npm ci` steps are at lines 36, 100, 393, 441 and 525, the Playwright verifier runs at lines 40, 106 and 395, and `ci.yml` has six jobs, the sixth being `agent-telemetry` (installs no packages, is not a claim-bearing job). `main` also gained a tracked developer-tooling directory, `tools/agent-telemetry/` (33 files: 20 `.js`, 9 `.json` fixtures, 2 `.md`, one `.html`, one `.css`). **Neither is classified by this inventory.** Whether `tools/` belongs in the C2 verified set or is excluded with a recorded reason is an **open design item for the C2 manifest**, and it must not be treated as covered. This is a further register gap of the kind m-146 records; it changes no finding's status.

Excluded from claims: the browser page content (OWNER-24 posture governs it), customer targets, and anything that runs only on an operator machine.

**Executed-tree check design (not implemented).**
- The verifier takes the candidate's tracked-file list and, for every path in the C2 verified set, requires an exact sha256 match with the trusted manifest. Extra, missing or changed paths in the set fail the check.
- It runs **after checkout and before any claim-bearing step**, so later steps run the tree that was checked. A check that runs on a different checkout from the one that is tested is void.
- **Intentional approved changes.** A pull request that changes a path in the set must change the manifest in the same diff. The verifier loads the trusted manifest and the verifier code from the **protected baseline ref**, so the head manifest is shown only as a proposed delta. A pass needs the manifest delta approved under section 3 by a non-author human. On merge the baseline moves, and later runs use the new manifest. There is no path by which a change certifies itself.
- **Bootstrap.** The first manifest and verifier are a trust-on-first-approval event: they need the same independent human approval, and until that approval exists nothing in this section may be called independent.
- **Generated files** (reports, state, history) are listed in the manifest as excluded with the reason, or as expected-pattern rules; they are not hashed.

## 3. C2 independence and protection design

**Observed GitHub state (read-only calls on 2026-10-21, no change made).**
- The repository is public, owned by the user account `eddieir`, with forking allowed. The only collaborator is `eddieir`, with admin rights. The authenticated session is that account.
- Branch protection on `main`: **none** (the API returned "Branch not protected").
- Re-observed read-only on 2026-10-22: unchanged. Branch protection on `main` is still none; ruleset `Eddie_main` still contains only `deletion` and `non_fast_forward` with the Admin bypass `always`; the only collaborator is still `eddieir`; no `CODEOWNERS` exists on `main`; open code-scanning and secret-scanning alerts: 0.
- One active repository ruleset, `Eddie_main`, targets the default branch and contains **only `deletion` and `non_fast_forward` rules**. It has **no required pull-request review, no required status check and no code-owner review**. Its bypass list has the repository **Admin** role with mode `always`.
- Actions: all actions allowed; SHA pinning not required by the setting (workflows pin by SHA by convention); default workflow permissions `read`; Actions may not approve pull-request reviews.
- One deployment environment named `copilot` exists; its purpose and protections were not inspected.
- No `CODEOWNERS` file exists. All commits carry one author email: SEC-39 checked 498 commits at `905462f`; the history holds 501 commits at the parent `70a615a`, and the single-author-email check was not repeated on the later commits.

**What this means.** With a single account, GitHub cannot supply an approval from someone other than the author, and the admin bypass means a rule could be bypassed by the same account. **C2 independence is therefore UNMET today and cannot be met by any repository setting alone.** It also cannot be met by a second AI agent, which the owner has excluded. The design below is achievable once an independent human exists; the missing prerequisite is the person, not the design.

**Proposed controls (not applied; every item needs owner approval and a separate change).**
1. **Independent human reviewer.** Identify an authorised person other than the author with write access, and name them in the owner decision record. Until then, record "independence UNMET" in every C2 and MG-13 status.
2. **`CODEOWNERS`** assigning that reviewer (a user or team) to: the verifier and C1 harness; the trusted manifest and export-surface file; `.github/workflows/`; `.github/dependabot.yml`; `package.json` and `package-lock.json`; the Playwright configs; `tests/fixtures/*-preload.cjs`; the gate source files; and the `CODEOWNERS` file itself.
3. **Repository ruleset on `main` and the release branches** requiring: a pull request; at least one approving review; code-owner review; approval of the most recent push by someone other than the pusher; dismissal of stale approvals on new commits; resolved conversations; required status checks including the verification job; blocked force pushes and deletions (already present). **The Admin bypass must be removed or limited to documented break-glass**, with each use recorded. **Whether a path-restriction rule, a required-workflow rule and a "last pusher cannot approve" option exist and behave as needed on a user-owned repository is unverified**, and must be confirmed against GitHub's documentation and by test before this design is relied on.
4. **Check that cannot be edited by the change under test.** Run the verifier and harness from the baseline ref (IND-1); keep `pull_request` for the C1 execution of the candidate in an unprivileged job with `contents: read` only (observed today at workflow and job level); do not use a base-ref workflow with write permissions that checks out and executes candidate code. Cover push-triggered runs, which also use the workflow file of the pushed commit (see m-145 in section 6).
5. **Effectiveness tests before any claim.** After the owner applies the controls, run, with the independent reviewer's participation: an author self-approval attempt (must fail); an approval followed by a new commit (must be dismissed); a change to a protected path without code-owner approval (must be blocked); an attempted bypass by the admin account (must be blocked or recorded); a pull request that edits `ci.yml` to skip the verifier (must be verified by the baseline version and blocked); a push-triggered and a manually dispatched (`workflow_dispatch`) run of an edited workflow (must not report a passing check for the verifier). Record dated evidence for each. Until these pass, independence stays UNMET.

**Feasibility.** The design can achieve independent trusted-baseline verification **if** a second human with write access exists and the ruleset is enforced without a standing bypass. **It cannot be achieved with the present single-account configuration.** This is a missing prerequisite, not a flaw in the design, and I report it at the top of the final report as the owner asked.

## 4. Playwright and browser pinning design

**Status on `main` (updated 2026-10-22; read-only inspection of `main` at `2f31076`).** Proposal items 1, 2 and 5 are implemented; items 3, 4 and 6 are not.
- **Implemented (item 1, exact version).** `package.json` declares `playwright` and `@playwright/test` as exactly `1.64.1` (no range operator); the lockfile resolves `playwright`, `playwright-core` and `@playwright/test` to `1.64.1`. The pin was introduced as exact `1.64.0` in #62 and moved to `1.64.1` by a separate upgrade PR, #69. No `overrides` entry pins `playwright-core`.
- **Implemented (item 2, browser revision).** `scripts/playwright/verify-pin.js` reads the reference file `scripts/playwright/expected-browser.json` (Playwright `1.64.1`, Chromium revision `1248`, browser version `156.0.8078.4`) and fails closed on any mismatch of the declared versions, the installed package versions, the `browsers.json` revision and version, or the version reported by a headless launch. `ci.yml` runs it after each of the three browser installs (lines 40, 106 and 395 on `main`), and `tests/regression/playwright-pin.check.cjs` proves that wrong reference values fail.
- **Implemented (item 5, no silent upgrades).** The Dependabot configuration keeps Playwright in its own group, so a Playwright bump is a separate pull request that must also update the reference file, or the verifier fails. The code-owner review this section assumed is **not** enforced: no `CODEOWNERS` file exists (section 3).
- **Not implemented (item 3, artifact hash list).** The merged verifier states that it is not a hash or provenance check of the browser binary.
- **Not implemented (items 4 and 6).** Browser jobs are not run in a digest-pinned container; `apt` packages and the `ubuntu-latest` runner image remain unpinned and unverified.
- **Independence.** The verifier, the reference file and the workflow are only as independent as the review of the pull request that changes them. With no independent human reviewer, this does not satisfy C2 independence (section 3).

The items below describe the state **before** that work and are kept for the record; where they differ from the status above, the status above controls.

**Observed facts (read-only, as of 2026-10-21).**
- `package.json` declares `playwright` and `@playwright/test` as `^1.64.0`. `package-lock.json` resolves `playwright`, `playwright-core` and `@playwright/test` to **1.64.0** exactly.
- The installed `playwright-core` metadata (`browsers.json`) maps Chromium and `chromium-headless-shell` to **revision 1248, browser version 156.0.8078.4**.
- CI installs the browser with `npx playwright install --with-deps chromium` three times (`ci.yml` lines 39, 102 and 390). The browser download is not cached in the lockfile or verified by a hash; `--with-deps` installs `apt` packages from the runner image. The runner is the floating label `ubuntu-latest`. Actions are pinned by commit SHA. `postgres:16-alpine` is pinned by digest.

**Proposal (design only; items 1, 2 and 5 are now implemented on `main`, see the status above).**
1. **Exact Playwright version.** Change the two specifiers to exactly `1.64.0` (and consider an `overrides` entry pinning `playwright-core` to the same version). Because the lockfile already resolves 1.64.0, the intended effect is a specifier change only. **Validation before merge:** `npm ci` then `npm ls playwright playwright-core @playwright/test` unchanged; the lockfile diff contains only specifier strings; `npm run test:regression`, `npm run test:unit` and the browser suite pass as they do on the baseline commit. If any resolved version or hash moves, stop: that is an upgrade and needs its own security and regression evidence.
2. **Browser revision pin.** Record the expected revision (`1248`) and browser version (`156.0.8078.4`) in a reviewed reference file. A CI step compares them with the values read from the installed `playwright-core` metadata, fails on mismatch, and then **launches** the browser and compares the version string the running browser reports with the reference. This checks the artifact that is actually installed and launched, not the intended one.
3. **Artifact hash list, with its trust model stated.** After install on the protected baseline, record sha256 of the installed browser executable and its required files in a reference list under the same independent review as the manifest. **This hash detects a change from the recorded build; it does not prove the build is genuine.** Playwright downloads from its own CDN over HTTPS; I did not find or assess a published checksum for the binaries, so provenance beyond "what Playwright's installer fetched for revision 1248 on the recording day" is unestablished. Linux x64 hashes must be recorded on a Linux x64 runner; the only Linux browser-artifact evidence in this repository's reviews is arm64 (the one x64 runner observation, FS-RUNNER-01, launched no browser).
4. **Container images.** Keep the existing digest pin on `postgres`. A hosted `ubuntu-latest` runner cannot be digest-pinned. Running browser jobs inside a Playwright container pinned by digest is an option that changes the CI environment; it needs its own approval, a digest measured on x64, and a regression comparison. I do not know an x64 digest for such an image and propose none.
5. **No silent upgrades.** Dependabot opens weekly grouped npm pull requests that may include major versions (`.github/dependabot.yml`). An exact pin keeps the update path but makes every Playwright or browser bump a visible diff to the manifest, the reference file and the hash list, under the code-owner review of section 3. Any such upgrade carries the normal security and regression evidence.
6. **`apt` packages and the runner image** remain unpinned and unverified. They are listed as **not covered** until a separate decision.

## 5. C1 to C5 implementation-readiness matrix

| Control | Specified | Implemented | Measured | Independently reviewed | Still blocked on |
|---|---|---|---|---|---|
| **C1** behavioral export check | Yes (rev 42 section 6, rev 43 section 1); limits L1 to L9 stated | No | No | Design text only (SEC-39, with conditions); SEC-38 approximations missed 12 evasion routes | Owner decision on C1 extensions (accept the limits or approve specific ones); the `falcon.js` load decision; Linux and Node 24 `execve` check; m-143 text correction applied (section 6) |
| **C2** package and executed-tree integrity | Yes (rev 42 section 7, rev 43 section 2, this package sections 2 and 3) | No | No | Design text only | **Independence UNMET:** no independent human reviewer; no required review or status check on `main`; admin bypass `always`; no `CODEOWNERS`. Also a `files` allowlist, exact pins, the baseline-loaded verifier, bootstrap approval |
| **C3** supervisor and process integrity | Yes | Reference code only (rev 41); not shipped | Yes: 41 process rows and 24 unit rows, Node 22 and 24, macOS and Linux arm64 | SEC-37 closed m-136 and m-137 | Linux x64, runner and Windows evidence; `TZ` and `LC_*` open; the `setsid` grandchild residual |
| **C4** runtime refusal (`gate37`) | Yes | Reference text only | Yes, arm64 | Reviewed across SEC-34 to SEC-39 without a finding on its behaviour | Parity evidence; it keeps refusing while the FW-2 state is `unmeasured` |
| **C5** Scope B isolation | Partly | No | Network containment only (NETW-01, arm64 Docker Desktop, 0 escapes) | No | PID and cgroup containment, Linux x64 and runner parity, wiring to Falcon, wss controls (MG-15). Required before any workflow runs untrusted executable code |

Nothing is implementation-ready in the sense of "approved and unblocked". C1 and C2 are **specifications**; neither is implemented, measured or accepted.

## 6. Resolution mapping for m-143 to m-146

These are narrow corrections to the text and acceptance contract of rev 42 and rev 43. They do not restart scanner-bypass enumeration and they preserve every stated limitation. The scanner stays advisory, and **a CLEAN scan does not establish runtime safety**.

| Finding | Correction (controlling text) | Affects Scope A design? | Affects a mandatory release gate? | Status |
|---|---|---|---|---|
| **m-143** five more routes pass the C1 approximation (`process.x = createGate`, statics on built-in constructors, writes onto another module's exports, a `require.cache` entry, a `process.on` listener that hands the gate out) | C1 claims detection **only** for routes classed DETECT. **Limit L9** is added covering these five routes; each becomes a KNOWN-MISS fixture pinned under C1-AC2. The statement "everything not classed DETECT is a known miss" replaces any wording that implies wider coverage. T1 lists L9 | Yes, text only: the T1 residual grows | Yes: MG-13-C1 acceptance wording | **Unresolved** until Security accepts |
| **m-144** "job-level `permissions` blocks differ" is wrong | Corrected fact: the workflow-level default is `contents: read` (line 16) and the three job-level blocks (lines 368, 425 and 512) are also `contents: read`; the `regression` and `test` jobs inherit the default. I found no `secrets.` reference in `ci.yml`. Rev 43 section 2 (IND-4) wording that the blocks "differ" is withdrawn | No | No (wording) | **Unresolved** until Security accepts |
| **m-145** trigger wording | Corrected fact: `pull_request` triggers on `New_era_Falcon` and `main`; `push` triggers on `New_era_Falcon`, `main`, `feat/**` and `test/**` (lines 3 to 7); `workflow_dispatch` (line 14) also lets the admin account run a workflow, including an edited one, from any ref. IND-4 is extended to say the independence check must hold for push-triggered and manually dispatched runs of a changed workflow too, including a same-named check on the same commit, and the section 3 effectiveness tests must include a dispatch run of an edited workflow; **the GitHub behaviour is unverified** and must be tested (section 3, item 5) | Slightly: IND-4 | MG-13-C2 independence when implemented | **Unresolved** until Security accepts |
| **m-146** register gaps | The register of rev 42 section 1 and rev 43 section 3 is extended by section 2 of this package: both extra Playwright configs (`playwright.demo.config.js`, `playwright.regression.config.js`); the four `tests/fixtures/*-preload.cjs` files; the 11 tracked `.js`/`.cjs` files under `docs/`; `.env` (local, untracked) and `src/config/testConfig.json`; `src/core/llm/ProfileStore.js`; Dependabot as an author of lockfile changes, so its pull requests need the same code-owner review (IND-2) | Yes: completeness of the trust register | Yes: MG-13-SCOPE | **Unresolved** until Security accepts |

None of the four is closed by this package. Security has not reviewed these corrections.

## 7. Remaining security and implementation gates

- **Open:** MG-1 (partial), MG-4, MG-8 (not cleared), MG-9 to MG-17, MG-13 (implementation and accepted contract), FW2-C6 (C6-O1 to O7), OPEN-BID-27, the empty supported-browser set (OWNER-24).
- **Findings:** m-134 OPEN; M-2 residual (T3) OPEN; m-143 to m-146 unresolved; `TZ` and `LC_*` OPEN.
- **Residual risks:** T1, T2, T3 OPEN - NOT ACCEPTED.
- **Platform evidence:** all measured conformance evidence for C1 to C5 is arm64 (macOS and Linux arm64); there is no Linux x64, hosted-runner or Windows evidence for those controls. The only x64 runner observation is FS-RUNNER-01 (one GitHub-hosted `ubuntu24` run: filesystem observations only, no browser launched, admits nothing; see `docs/phase-18-linux-runner-evidence-findings.md`).
- **Governance:** C2 independence UNMET (section 3).
- **Scope B:** incomplete (C5).

## 8. Proposed implementation pull-request sequence and acceptance criteria

Every item below needs its own owner approval before work starts. None begins from this document. Changes to workflows, dependency versions, browser binaries or GitHub settings are separate approvals.

| Order | Change | Acceptance criteria | Depends on |
|---|---|---|---|
| **0** (not a pull request) | Governance: name the independent human reviewer; apply `CODEOWNERS` and the ruleset (section 3); remove the standing admin bypass | The five effectiveness tests of section 3, item 5, pass and are recorded with dates | Owner decision; an independent person |
| **1** | **COMPLETED on `main` (#62; version later moved to 1.64.1 by #69; see the section 4 status).** Exact Playwright pin plus browser-revision verification step (section 4, items 1 and 2) | Resolved versions and lockfile hashes unchanged; the verification step fails on a deliberately wrong reference value and passes on the right one; regression, unit and browser suites match the baseline commit | Workflow change approval |
| **2** | C2: manifest, baseline-loaded verifier, packaged-artifact check and executed-tree check (sections 2 and 3, rev 42 section 7 criteria C2-AC1 to AC7 with the amended IND rules) | Each C2 fixture rejected with its stated mechanism; a self-generated manifest never passes; a change to `ci.yml` is verified by the baseline version | PR 0 for any independence claim; PR 1 for the browser rows |
| **3** | C1 harness (rev 42 section 6, with L1 to L9 and DETECT/KNOWN-MISS fixtures) | C1-AC1 to AC7 as amended; KNOWN-MISS fixtures recorded as UNRESOLVED, never as passes | Owner decision on C1 extensions; the `falcon.js` load decision |
| **4** | Scope A specification refusal (section 1) | Each refusal case in section 1 exits before browser launch with an actionable message and the chosen existing exit class | Owner decision on the failure code and on whether enforcement is a new mechanism |
| **later** | C5 measurements and wiring | PID and cgroup containment, x64 and runner parity | Separate approval |

**PR 1 is complete on `main`** (section 4 status). It did not provide independence and must not be described as doing so. No remaining row is unblocked: row 2 needs PR 0 for any independence claim, and rows 3 and 4 need the owner decisions in section 9.

## 9. Owner decisions needed

1. Who is the independent human reviewer, and does that person get write access to this repository?
2. Do you approve removing or limiting the Admin bypass on `main` when the ruleset is applied?
3. Which failure code and exit class does the Scope A specification refusal use, and is its enforcement a new mechanism that needs separate security review?
4. Do you accept or adjust the C1 limits (L1 to L9), or approve specific C1 extensions?
5. ~~Approve PR 1 (exact Playwright pin and browser-revision verification) as the first implementation step?~~ **Resolved: PR 1 was approved and merged (#62, then #69). Retained for the record.**
6. Whether to run browser jobs in a digest-pinned container (needs an x64 digest I do not have).
