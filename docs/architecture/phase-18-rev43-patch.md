# Phase 18 rev 43 - SEC-38 findings answered: C1 limits stated, the independence rule extended to the whole check, the trust register completed

Narrow addendum on rev 42 (`905462f`). **Docs-only. No implementation, no C1 or C2 code, no merge, tag, release or customer-readiness claim.** It answers `docs/security/phase-18-design-review-37.md` (SEC-38): REJECT, 0 blockers, 2 majors (M-3, M-4) and minors m-140 to m-142. The reviewer found Scope A appropriate and the withdrawal of the scanner claims honest, and asked for text changes only. **No gate is closed. No earlier evidence document is edited.** Where this addendum and rev 42 disagree, this addendum controls, and each superseded passage is named below.

Inputs (checked): `phase-18-rev42-patch.md` sha256 `a8727adab7cb5810cae3eea3d861f9a169fe64aac1193ffd4afcc3a43931ab26`; `phase-18-design-review-37.md` sha256 `617f5c1b70ea8905471c6e8e8b89efe66257cb43c060537bef06330598c77545`. No scratch reference file changed since rev 42 (hashes as listed there).

## 1. M-3 - C1 does not detect what rev 42 implied

**Root cause.** Rev 42 section 6 designed C1 as a top-level surface compare plus three baseline key deltas, `isProxy` to depth 2 and two canaries, then mapped fixtures a01 to a13 to it as if it covered every route to `createGate`. The reviewer ran an approximation of that design: **7 of 8 evasions returned PASS while `createGate` stayed reachable.** (The eighth was detected.) I have not re-run the probe; the reviewer's result is the evidence, and the probe is in the reviewer's scratchpad and is not committed.

**Claim withdrawn.** That C1, as designed in rev 42, is a credible detective control for gate-construction exposure through anything other than the entry point's own top-level exports and the three baseline prototypes.

**Superseded text.** Rev 42 section 2 row T1; section 6 "Design", C1-AC2 and C1-AC5; section 8 rows a01 to a13 (their statuses stay UNMEASURED and gain the limits below).

**Row T1 (replacement).** Original requirement: unchanged. Actual objective: unchanged. Enforcing control: C1 (limited, below) plus C2. **Remaining gap: an authorised first-party change that exposes `createGate` by any route in the C1 known-miss list is covered by neither C1 nor C2. UNRESOLVED; carried by code review under Scope A.** Independent verification: SEC-37 and SEC-38 both rejected the earlier claim.

**C1 limitations (stated, each to become a fixture).** C1 as specified in rev 42 does **not** detect, and rev 43 does not claim it detects:

| # | Route | Why C1 as designed misses it |
|---|---|---|
| L1 | A static member of an exported class or function | Descriptors are compared one level down from the exports object; statics are not walked |
| L2 | A method on the prototype of an exported class | Same; the `.prototype` of an export is not walked |
| L3 | A Proxy placed as the prototype of an exported value | `isProxy` looks at the value, not its prototype chain |
| L4 | Pollution of built-in prototypes other than `Object.prototype`, `Function.prototype`, `Array.prototype` (for example `String.prototype`) and of the `Module` prototype | The baseline delta list is three prototypes plus `globalThis` |
| L5 | Replacing an **existing** member of a baseline prototype | The check compares key sets, not descriptor or function identity |
| L6 | An export added after the snapshot (microtask, `setImmediate`, timer) | The snapshot is taken synchronously after load |
| L7 | Behaviour keyed on the working directory (hiding when the directory is empty) | The variation matrix varies environment variables, not the directory |
| L8 | Conditional behaviour on time, argv, network or call count | Already stated in rev 42; unchanged |

**Fixture handling (replacement for C1-AC2).** Every C1 fixture is classed either **DETECT** (C1 must reject, with the stated mechanism) or **KNOWN-MISS** (C1 is expected to pass it; the fixture is kept as a pin that documents the residual and fails the build if C1 silently starts claiming it). The two classes are never mixed in one criterion.
- **C1-AC2 (replacement):** each DETECT fixture is rejected on Node 22 and 24 with its stated mechanism, and each KNOWN-MISS fixture is recorded as UNRESOLVED with its limitation number, never as a pass. DETECT fixtures: a01 to a11 (exports of the entry point's own surface), a12 (the exports object or an immediate property is a Proxy), a13 (new key on one of the three baseline prototypes), a14, a25 and the conditional-on-`NODE_ENV`/`CI`/`HEADLESS`/`TZ` fixture. KNOWN-MISS fixtures: one per limitation L1 to L7, built from the SEC-38 evasions.
- **Possible C1 extensions (NOT in the contract; owner decision, section 5):** walk statics and `.prototype` members of exported functions to a bounded depth (L1, L2); check prototype chains for Proxy (L3); extend the baseline prototype list and compare descriptor and function identity (L4, L5); take a second snapshot after event-loop turns (L6); repeat the load from a non-empty directory (L7). None is designed, measured or approved here. Each would still be observational, and adding all of them would not make C1 a barrier.

**Dispositions.** m-134 stays **OPEN** (as SEC-38 states) until M-3's text is accepted and C1 and C2 are built and measured. Rev 42 rows a01 to a13 keep status UNMEASURED; the fixture map gains the class column above.

## 2. M-4 - the independence rule covers the references but not the check

**Root cause.** Rev 42 section 7 made the **manifest** independent, and said the same for the export-surface file. It did not say who controls the **verifier, the C1 harness and the workflow that runs them**. `ci.yml` triggers on `pull_request` and `push` for `feat/**` and `test/**` (lines 3 to 7), and a workflow run on a pull request uses the definition in the change under test, so a change can edit or skip its own check. For a release, rev 42 read the manifest from the release commit itself, which is not independent of the artifact. And non-author review was asserted but not enforced: the repository has no `CODEOWNERS`, remote protections were not inspected, and all 499 commits carry one author identity.

**Claim withdrawn.** That the C2 independence rule, as written in rev 42, makes a pass trustworthy.

**Superseded text.** Rev 42 section 7 "Independence rule" and C2-AC2; section 5 MG-13-C2.

**Replacement independence requirements (REQUIREMENT, not implemented).**
- **IND-1 (the checking code is a reference too).** The verifier, the C1 harness, the workflow definition that invokes them, the manifest and the export-surface file are all **reference material**. For a pull request they are read from the **protected base ref**, never from the change under test. A change that touches any of them is verified by the **base** version of the check, and additionally needs the review in IND-2. The change under test is treated as data to read, and its code runs only inside C1's fresh, unprivileged process.
- **IND-2 (review is enforced by rule, not convention).** Changes to the reference material need an approving review from a person who is **not the author of the change and not the last pusher**, with stale approvals dismissed on new commits, and no bypass for the paths in IND-1. The mechanism (a `CODEOWNERS` file plus a repository ruleset or branch protection) is an owner decision and **was not inspected**; its state is unmeasured.
- **IND-3 (release).** A release candidate must be a commit on the protected branch whose reference material equals the version approved under IND-2. The verifier and references come from the protected branch, not from the candidate. A pass whose references were taken from the candidate itself, or generated from the artifact, is void.
- **IND-4 (required, not skippable).** The verification result must be a required status that the change under test cannot satisfy, rename or remove by editing its own workflow. Candidate mechanisms: a repository ruleset that requires a named workflow from the base ref; or a base-ref workflow that reads the change only as data (the tarball bytes) and never executes it, with C1's execution of the artifact in a separate unprivileged job. **Availability and behaviour of both are unverified, and a base-ref workflow that checks out untrusted code with write permissions is itself a known hazard; the design must run with `contents: read` only.** The current `ci.yml` default permission is `contents: read` (observed), but `ci.yml` has five `npm ci` invocations and job-level `permissions` blocks that differ; none of that has been reviewed for this purpose.

**Honest limit.** With one commit identity in the repository, IND-2 cannot be satisfied by the existing contributors. **Until an independent reviewer exists and the rule is enforced, C2's independence property is UNMET** and the C2 status is "design incomplete", not "specified". This is an owner decision (section 5).

## 3. m-140 - the execution-trust register is completed, and what C2 covers is stated

**Replacement for the rev 42 section 1 register.** Additions (verified present in the repository unless marked):

| Input | Where it runs | Status under Scope A | Required before a pilot workflow may use it |
|---|---|---|---|
| `scripts/` (healing, llm, db, flakiness, history and others) | Node, started by operators or CI | Falcon-authored and trusted; not packaged unless a `files` allowlist includes it | Place in the C2 verified set (below) |
| `src/dashboard/` (served UI and server) and `src/config/` | Node and the operator's browser | Falcon-authored and trusted | Same |
| `src/production-cycle/` and `scripts/production-cycle/` | Node, development and ledger tooling | Trusted, development only | Declare out of any customer-facing artifact |
| Development dependencies (`@playwright/test`, `allure`, `socket.io-client`) | Node; **`@playwright/test` loads spec files** matched by `testMatch` in `playwright.config.js` (`**/*.test.js`, `**/*.spec.js` under `./tests`) | Trusted only as pinned by the lockfile | Same pin rule as production dependencies |
| Browsers from `npx playwright install` | Downloaded at install time, **outside the lockfile** | Unclassified; Playwright's own download checks are **not assessed** | Owner decision on pinning and verifying browser binaries; browser posture stays OWNER-24 |
| LLM responses and the healing store | Data read by Node | **Untrusted data, never code**; must not be evaluated or loaded as a module | The healing safety design; outside this scope, and not assessed here |

**What C2 covers versus what CI runs (SEC-38 m-140).** C2 as specified checks the **tarball**. CI runs the **working tree**, which includes `tests/`, `scripts/` and other trees a future `files` allowlist may exclude. A tarball check therefore does **not** verify what CI executes. **Requirement:** the C2 verified set is defined as the union of (a) the packaged files and (b) every tracked file executed by any job that supports a security or readiness claim; CI jobs that support such a claim must either run from the extracted verified artifact or run after a working-tree check that every file in (b) matches the reference manifest byte for byte. Until that is designed and implemented, **C2 does not cover the executed tree, and no claim may say it does.** Enlarging the C2 scope is an owner decision (section 5).

## 4. m-141 and m-142

**m-141 - "pinned" gets a definition.** For Scope A, dependencies count as **explicitly pinned** when all of these hold:
1. A lockfile with integrity hashes is committed (observed: `package-lock.json`, 267 `integrity` entries).
2. Every CI job that installs dependencies uses `npm ci` (observed: five `npm ci` invocations in `ci.yml`), so a lockfile mismatch fails the job.
3. The C2 manifest records the sha256 of the lockfile (specified, not implemented).
Under this definition, caret ranges in `package.json` do not by themselves violate the pin requirement, because the lockfile decides what is installed. **Against this definition the CI install path currently satisfies (1) and (2); (3) is unimplemented.** Not covered: local `npm install`, the browser download, and any consumer's install of a published package (no publication exists or is planned). The rev 42 register wording "not yet conforming" is withdrawn and replaced by this statement.

**m-142 - the `execve` fixture.** C1's result channel is a dedicated descriptor. SEC-38 checked load-time `process.execve` on **macOS, Node 22**: descriptor 3 is not inherited into the new image (ENXIO, EBADF on writes), so a forged result line fails and an absent line is a rejection. **Linux and Node 24 are unchecked.** Added to **C1-AC5**: a fixture in which the artifact calls `process.execve` at load into a program that (i) writes a well-formed forged result line to descriptors 1, 2 and 3 and (ii) exits 0. The check must reject it. Status: UNMEASURED on every platform by me; the one macOS Node 22 observation is the reviewer's.

## 5. Contract, matrix and gate deltas

**MG-13 contract (proposed; supersedes rev 42 section 5 where they differ).** MG-13-C1 now reads: DETECT fixtures rejected, KNOWN-MISS fixtures recorded as UNRESOLVED (C1-AC2 above). MG-13-C2 now requires IND-1 to IND-4 and the executed-tree rule of section 3, in addition to the rev 42 criteria. MG-13-MAP is unchanged except for the class column. MG-13-SCOPE uses the completed register. **The amended contract remains unaccepted until Security accepts it. MG-13 implementation is not complete. MG-8 is not cleared.**

**C1 to C5 status (replacement for rev 42 section 3, status column).** C1: specified, limits L1 to L8 stated, unimplemented, unmeasured. C2: specified, **independence UNMET** (IND-2), executed-tree coverage not designed, unimplemented, unmeasured. C3, C4: unchanged and measured (arm64). C5: not complete.

**SEC-38 disposition.** M-3: answered in sections 1 and 5; open until Security accepts. M-4: answered in section 2; open until Security accepts, and the independence property remains UNMET until the owner decides. m-140, m-141, m-142: answered in sections 3 and 4; m-142's Linux and Node 24 behaviour is unchecked. SEC-37 history is preserved: m-134 OPEN, M-2 correction accepted by Security with T3 UNRESOLVED, `TZ` and `LC_*` OPEN, `.mts` and `.cts` closed as a claim correction, deep nesting closed, Linux evidence arm64 only.

**Owner decisions (consolidated; additions to rev 42 section 13 marked new).**
1. Classify spec-file authorship per workflow; customer-authored code in the Node process requires C5.
2. **New:** accept T1, T2 and T3 as review-carried residuals under Scope A, or require a stronger control.
3. **New:** does an independent, non-author reviewer exist, and which mechanism enforces IND-2 and IND-4 (`CODEOWNERS`, ruleset, required workflow)? Until decided, C2 independence is UNMET.
4. **New:** enlarge the C2 verified set to the executed tree (section 3)?
5. **New:** adopt any of the C1 extensions in section 1, individually, or accept the stated limits.
6. Whether to propose a `process.moduleLoadList` check (rev 42 section 13; unchanged).
7. Pinning and verification of Playwright browser binaries (section 3).
8. Whether any parser enters CI (unchanged).

## 6. Remaining gates, limitations

Unchanged from rev 42 section 11 and section 12, plus: IND-1 to IND-4 enforcement; the executed-tree rule; the KNOWN-MISS fixture pins; the Linux and Node 24 `execve` observation. All earlier evidence is arm64; there is no Linux x64, runner or Windows evidence. There is no browser claim (empty supported set). There is no customer-availability claim. **A zero-blocker, zero-major review of this text would not show that C1 or C2 works; neither exists.**
