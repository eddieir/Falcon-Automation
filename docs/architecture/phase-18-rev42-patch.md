# Phase 18 rev 42 - trust-scope reconciliation after SEC-37: the scanner becomes advisory and MG-13 is restated as control-based verification

Narrow addendum on rev 41 (`ed65d9a`). **Docs-only. No implementation, no C1 or C2 code, no merge, tag, release or customer-readiness claim.** It answers `docs/security/phase-18-design-review-36.md` (SEC-37): REJECT, 0 blockers, 2 majors (M-1 = m-134, M-2 = the MG-13 forms bypass) and 4 minors. It was authorised by the owner as a Scope A reconciliation with the conditions recorded in section 10. **No gate is closed by this document, and no earlier evidence document is edited.**

Reference files are unchanged from rev 41 and remain scratch-only evidence (not committed):

| File | sha256 |
|---|---|
| `scan41.js` | `9894d670dea8a605856413bd731b51bc991c4e6d314a82332e9bf55b76bdbc1b` |
| `scan41-test.js` | `491de211e10296bb04e38992fc197afac1f124d3deea595c7ac744192eb67c3c` |
| `supervisor41.js` | `452a549aff6a9549a8599c113bd7f473e3ab7150b9f64722fc4054eeea8eb432` |
| `atk37.js` (Security's SEC-37 corpus) | `ac5a47aba6f4ea5e9bbc77b67cf08c2ea7f9a4e86ffcb3994ca59251209982e3` |
| `rt37.js` (Security's runtime probe) | `93e4a9ed04882989bd32ab67f796662d3ec2d9f01344105235e2b74031d3a8d3` |
| `out-v22.19.0.json` | `2e35c3fe2bcc71c8d638060ed645533c14029fec26934ff7a76e146ed82c8485` |
| `out-v24.21.0.json` | `8f76fcc6d0e7d8fd424ffc22fed65f2ca55326e7e8112370e1f6811d8553f152` |

Committed documents this revision builds on: `phase-18-rev41-patch.md` sha256 `d9ff317de26ea0f3875fa8b2f0ffa0a22be5f568461dfcf28bf090a12929828b`; `phase-18-design-review-36.md` sha256 `bb99abb57d0178f8fbdf1ac9a947db5f62fe5f00b1791f29f248b27f72df57eb`. The two SEC-37 output files differ only in the timing of the two deep-nesting rows.

**Correction of the framing used in rev 39 to 41.** MG-8 is, in every revision document (rev 33 to 41), "Security review of this revision document". It is a review gate, not a scanner requirement. The scanner requirements sit under **MG-13** and finding **m-134**. This document therefore amends MG-13 and m-134, leaves the MG-8 definition as it is, and states in section 2 what must be true before MG-8 can be cleared.

## 1. Revised threat-boundary description (Scope A)

**Measured fact (rev 41, SEC-37).** On Node 22.19 and 24.21, macOS and Linux arm64, every builtin-loading path (`process.getBuiltinModule`, `_linkedBinding`, `process.binding`, `process.dlopen`, `process.execve`, `module.require`, `require.main.require`, `process.mainModule`) is reachable by JavaScript already executing in the process. **No in-process control, including a scanner or an export check, can stop that code.**

**Scope A (approved for the Phase 18 design milestone).**
- Falcon-authored code and **explicitly pinned** dependencies are trusted inside the documented process-integrity boundary (the supervisor, the fd-3 verdict, the environment allowlist, tri-state process identity).
- Artifact verification, export checks and static analysis **detect defined deviations**. They do not sandbox arbitrary JavaScript.
- Malicious JavaScript already executing in the trusted process is **outside Scope A**.
- Customer-authored tests, third-party scripts, compromised dependencies and any other untrusted execution **must not be silently treated as trusted** (register below).
- If a supported customer-pilot workflow lets such code execute inside the Node process, **Scope B isolation is required before that workflow can be enabled** (section 3, C5). Scope B stays a separately tracked requirement. **No Scope B network, process, PID-namespace or cgroup evidence is marked complete by this document.**

**Execution-trust register (default is UNTRUSTED until classified).**

| Executed or consumed input | Where it runs | Status under Scope A | Required before a pilot workflow may use it |
|---|---|---|---|
| Falcon core (`src/core/`, `falcon.js`) | Node test process | Trusted, verified by C2 and C1 once implemented | C1 and C2 implemented and passing |
| Dependencies in `package.json` | Node test process | Trusted **only when explicitly pinned**. Current state: caret ranges with a `package-lock.json`; this is **not yet conforming** | Exact pins or `npm ci` against the lockfile with integrity, enforced by C2 |
| Spec and test files | Node test process | **Author not yet classified by any Phase 18 document; treated as untrusted** | Owner classification per workflow; Scope B if customer-authored |
| Customer configuration and environment | Node test process | Untrusted input; limited by the supervisor environment allowlist | Allowlist plus value validation (rev 41 section 5) |
| Third-party page scripts and target-site JavaScript | Chromium, not the Node process | Not covered by Scope A; contained only by the OWNER-24 browser posture and the FW-2 refusal | FW2-C6 measurements C6-O1 to O7; MG-15 |
| Compromised or malicious dependency | Node test process | **Outside Scope A** | Scope B isolation |

No Phase 18 document currently states that any supported workflow forbids customer-authored code in the Node process. **That is an open owner decision (section 9).** Until it is made, the pilot enablement gate must treat spec files as untrusted.

## 2. MG-8 / MG-13 / m-134 traceability matrix

"Independent verification" means a Security review of the exact revision, or a run by someone other than the author. "Original requirement" is quoted from the rev 41 text (section 1 and section 8 of `phase-18-rev41-patch.md`).

| # | Original requirement | Actual security objective | Enforcing control | Evidence now | Known limitations | Independent verification | Remaining gap | Owner decision |
|---|---|---|---|---|---|---|---|---|
| T1 | m-134: the scan flags every form that exports `createGate` (rev 41 section 1, 94 export fixtures) | No module of the shipped package exposes an unauthorised gate-construction interface | **C1** (exports observed in a fresh process) plus **C2** (any unauthorised file change rejected) | rev 41 scanner results (advisory); SEC-37 corpus a01 to a25 | C1 is observational; C2 cannot judge a reviewed and manifest-approved change | SEC-37 **rejected** the coverage claim; C1 and C2 not yet reviewed | C1 and C2 unimplemented and unmeasured | Approve the amended contract (section 5) |
| T2 | R1, R2, R7 token rules block the private identity token outside the gate | The private gate identity cannot be forged or reused outside the gate module | **C2** for unauthorised change; code review for authorised change | scanner token results (advisory) | Split, escaped and encoded tokens evade any literal rule (SEC-37 a17 to a22) | Not reviewed | **Authorised first-party change using a split token: no enforceable or detective control. UNRESOLVED** | Accept as review-only, or require a stronger control |
| T3 | MG-13: refuse the dynamic-code and builtin-loading set; specifier allowlist per file | Disallowed builtins are not loaded by shipped code | Scope A trust assumption plus **C2**; **Scope B (C5)** for untrusted code | scanner forms results (advisory); SEC-37 f01 to f03 loaded `child_process` | Unreachable-by-construction is impossible in process | SEC-37 **rejected** the claim that aliasing and non-literal `require` are findings | **Authorised first-party code that loads a builtin by an evading form: UNRESOLVED under Scope A** | Confirm Scope A; decide whether to propose load-time observation (section 9) |
| T4 | Exit code decided once, by a process the test code cannot influence | A hostile or crashing child cannot flip or hide the CI exit | **C3** (`supervisor41.js`) | 41 process rows and 24 unit rows, 0 failures, Node 22 and 24, macOS and Linux arm64 | `setsid` grandchild survives the process-group kill (residual); no x64, runner or Windows run | SEC-37 closed m-136 and m-137 on review | C5 PID containment unmeasured; MG-12 needs CI | None new |
| T5 | Production state `unmeasured` refuses with `worker_websocket_containment_unverified`, exit 18 | No bypass flag, variable or warning mode | **C4** (`gate37.js`, unchanged) | gate37 tests in rev 37 to 41 | Detects nothing about browsers (supported set is empty) | Reviewed in SEC-34 to SEC-37 without a finding | Linux x64 and runner parity | None new |
| T6 | Env allowlist and value validation (m-138) | Hostile environment variables do not reach the child | **C3** | 12 environment unit rows | `TZ` accepts an absolute path while `TZDIR` is denied; `LC_*` path forms unvalidated; win32 logic unit-tested only | SEC-37 closed with conditions | **`TZ` and `LC_*` OPEN until measured or independently assessed** | None new |
| T7 | Isolated execution where untrusted code must run | Untrusted code cannot reach the network, host or other processes | **C5** (Scope B) | NETW-01: `--internal` network plus allowlist proxy, 0 escapes (arm64 Docker Desktop only) | Not measured on x64 or a runner; PID and cgroup containment not measured; not wired to Falcon | None | **Scope B incomplete** | Decide which pilot workflows need it |
| T8 | MG-8: Security review of each revision document | The design is reviewed at its exact revision | Security Engineer review | SEC-34 to SEC-37 | A review of a design is not proof that unimplemented controls pass | SEC-38 will review this revision | **Not cleared**; clears only on Security's review of the final revision and its recorded evidence | None new |

## 3. C1 to C5 control matrix

| Control | What it verifies | Detects or prevents | Status |
|---|---|---|---|
| **C1** behavioral export verification | The built artifact's real export surface, in a fresh controlled process | **Detective, observational.** Cannot prove absence of malicious behavior | **Specified in section 6. Not implemented. Not measured.** |
| **C2** package integrity verification | The final tarball against an **independently trusted** reference manifest | **Detective gate** on unauthorised artifact change. Not a judge of reviewed content | **Specified in section 7. Not implemented. Not measured.** |
| **C3** process integrity | Supervisor decides the exit code from one fd-3 verdict line; environment allowlist; tri-state identity; pipes released at the decision | **Fail-closed** exit under a hostile child (within the stated boundary) | **Measured** on macOS and Linux arm64, Node 22 and 24. No x64, runner or Windows evidence |
| **C4** runtime refusal | `gate37.js` refuses while the FW-2 state is `unmeasured` | **Fail-closed**; no bypass | **Unchanged and measured** |
| **C5** Scope B isolation | Network, process, PID-namespace and cgroup containment of untrusted execution | **Prevention** (OS-enforced), where the threat model needs it | **Network part measured on arm64 only (NETW-01). PID, cgroup and runner parity not measured. Not complete** |
| Advisory scanner (`scan41.js`, forms rules, `litscan`) | Syntactic patterns | Diagnostic only | Section 4 |

C1 and C2 together do **not** prevent arbitrary code execution. C3 and C4 do not contain code in the test process. C5 is the only control class that can, and it is not complete.

## 4. Static scanner policy (advisory defence in depth)

`scan41.js`, the MG-13 forms rules and the associated literal and token rules are **advisory**.
- They make no exhaustive syntax-coverage claim.
- They make no claim of preventing arbitrary in-process module loading, exported functions, aliases or runtime mutation.
- **A CLEAN result does not establish security.** A FINDING remains useful diagnostic evidence.
- Existing findings, tests and evidence are preserved unchanged. The scanner is **not extended** to chase further syntax bypasses.
- Playwright's undocumented internal Babel path (`node_modules/playwright/lib/transform/babelBundle.js`) is **not a production or CI dependency**. It stays a local-analysis convenience. Including any supported parser in CI needs a separate justification and owner approval; the smallest option, if ever wanted, is one pinned `@babel/parser` in `devDependencies`. This revision does not add it.

**Supported scanner extensions: `.js`, `.cjs`, `.mjs` only.** Repository inspection supports the narrower scope: `git ls-files` lists 144 `.js` and 133 `.cjs` files and **zero** `.mjs`, `.ts`, `.mts`, `.cts`, `.tsx` or `.jsx` files. `.ts`, `.mts`, `.cts`, `.tsx` and `.jsx` are UNSUPPORTED. This corrects the rev 41 text, which listed `.ts`, `.mts` and `.cts` as parsed while the repository-scan regex omitted `.mts` and `.cts` (SEC-37 minor). `.json`, `.yml`, `.yaml` and `.html` token checks are diagnostic text greps, not supported scanner extensions. SEC-37 showed the reference scanner returning CLEAN for `.mts` and `.cts` syntax (a23, a24): **its behavior outside the three supported extensions is unspecified**, and the file-set check of C2 is what rejects such files.

Until Security accepts the amended contract (section 5), the **existing MG-13 requirement text stays in force** (no CI checker exists, so nothing is currently gated by it).

## 5. MG-13 revised acceptance contract (PROPOSED, not accepted)

This replaces the claim "the scanner reports CLEAN for every reachable form" with a control-based contract. **It is conditionally approved by the owner and is not an accepted replacement until Security reviews it** (SEC-38). MG-13 implementation is **not** complete while C1 and C2 are only specified.

- **MG-13-C1:** the C1 acceptance criteria of section 6 hold on Node 22 and 24 for the final built artifact.
- **MG-13-C2:** the C2 acceptance criteria of section 7 hold for the final package artifact.
- **MG-13-C3C4:** the supervisor and refusal behavior of rev 41 is unchanged, and no claim of containment exceeds what was measured.
- **MG-13-ADV:** the scanner results are published as diagnostic output only and do not gate.
- **MG-13-MAP:** every adversarial fixture in section 8 is mapped to a control and an expected rejection mechanism; **a fixture with no enforceable or detective control stays listed as UNRESOLVED**.
- **MG-13-SCOPE:** the register of section 1 is current, and no workflow that runs untrusted code in the Node process is enabled without C5 evidence.

## 6. C1 design (behavioral export verification) and acceptance criteria

**Design (not implemented).**
- Input: the extracted final package plus its production dependencies installed from the lockfile (`npm ci --omit=dev --ignore-scripts`). The reference export surface (`export-surface.json`) is a reviewed file obtained under the same independence rule as the C2 manifest (section 7).
- For each module listed in the reference, spawn a **fresh process** with the supervisor environment allowlist, an empty working directory, no preload and no inspector. The harness captures the primordials it needs (`util.types.isProxy`, `Object.getOwnPropertyDescriptors`, `Reflect.ownKeys`, the baseline own-key lists of `Object.prototype`, `Function.prototype`, `Array.prototype` and `globalThis`) **before** it loads the artifact.
- After loading, it records: own keys in order; for each key the descriptor (`enumerable`, `configurable`, `writable`, accessor or data, `typeof`, function `name` and `length`); the prototype identity; `Object.isFrozen` state; `isProxy` for the exports object and, to a bounded depth with cycle protection, for each property value; two canary property names that must read `undefined` (this catches a `get` trap that returns values for names it does not list); the post-load deltas of the baseline own-key lists. Accessors are read as descriptors and are **not invoked**.
- Result channel: one JSON line on a dedicated file descriptor, with the same discipline as the fd-3 verdict (bounded, single line, nothing else trusted). **Missing, malformed or oversized output, a non-zero exit, a signal or an abort (for example `process.execve` failure) is a rejection.**
- Variation matrix: the same load under `NODE_ENV` in {unset, `production`, `test`}, `CI` in {unset, `true`}, `HEADLESS` in {unset, `0`, `1`}, and `TZ`/`LANG` variants. Any difference in the recorded surface between cells is a rejection.
- Comparison: exact equality with the reference. Any extra, missing or changed key or descriptor, any accessor not in the reference, any Proxy, any canary that is not `undefined`, any new key on a baseline prototype or `globalThis`, and any module in the reference that fails to load, is a rejection. A conditional export that does not trigger inside the matrix is **not detected**.

**Acceptance criteria.**
- **C1-AC1** The check runs against the extracted final tarball, not the working tree.
- **C1-AC2** It rejects each fixture assigned to C1 in section 8, on Node 22 and 24, with the stated rejection mechanism.
- **C1-AC3** It passes the unmodified package and the real reference modules.
- **C1-AC4** A deterministic conditional-export fixture (on `NODE_ENV`, `CI`, `HEADLESS`, `TZ`) is rejected by the variation matrix.
- **C1-AC5** Fail-closed on missing, malformed, oversized or aborted results, including a fixture that calls `process.execve` at load.
- **C1-AC6** The check takes no path, name or expected value from the artifact under test.
- **C1-AC7** The document-level limitation is repeated in the implementation README: **observational; cannot prove absence of malicious behavior; time-, argument-, network- and call-count-dependent behavior is not covered**.

**Open design item.** `falcon.js` has load-time side effects. Whether C1 loads it, stubs it, or leaves it to C2 alone is undecided and must be settled in the implementation design. Until then it is verified by C2 only.

## 7. C2 design (package integrity verification) and acceptance criteria

**Design (not implemented).**
- Input: the tarball produced by `npm pack --json --ignore-scripts`. The verifier reads it as untrusted bytes.
- **Reference manifest** (`release-manifest.json`): per path the sha256, size and mode; the canonical form of the `package.json` fields `name`, `version`, `main`, `bin`, `exports`, `files`, `engines`, `scripts`, `dependencies`, `optionalDependencies`, `peerDependencies`, `bundledDependencies`; and the lockfile sha256.
- **Independence rule.** The manifest used for a pass is read from the **protected base ref** (or, for a release, from the reviewed release commit), never from the tarball, the build output or an unreviewed branch head. A pull request that changes a packaged file must also change the manifest in the same reviewed diff; the head manifest is used only to show the proposed delta, and a pass requires that the delta carries a recorded approval from a reviewer who is not the author. **A manifest generated from the artifact under test is not integrity evidence and never satisfies this check.**
- Checks: exact file set (extra and missing files, including any `.ts`, `.mts`, `.cts`, `.tsx` and `.jsx` file); exact sha256 per file; tar-entry hygiene (no symlink or hardlink, no absolute or `..` path, no duplicate entry, no case collision, no special mode bits); exact equality of the manifest-listed `package.json` fields; **no lifecycle scripts** (`preinstall`, `install`, `postinstall`, `prepare`, `prepack`, `postpack` and the `pre`/`post` forms of any script that runs on install); dependency specifiers equal to the reference and resolved by `npm ci` against the lockfile with its integrity hashes; two independent `npm pack` runs yield identical content hashes.

**Current repository facts (read-only inspection) that C2 would reject or must first fix.**
- `package.json` has **no `files` allowlist** and no `.npmignore`, so `npm pack` would currently ship most tracked paths.
- Dependencies use **caret ranges** (for example `playwright ^1.64.0`); a `package-lock.json` exists.
- There are **no lifecycle scripts** in `package.json`.
- There is **no `CODEOWNERS` file** in the repository. Branch-protection, ruleset and required-reviewer state on the remote **was not inspected**.

**Acceptance criteria.**
- **C2-AC1** Verification runs on the final tarball for the exact release candidate commit.
- **C2-AC2** The reference manifest is obtained as in the independence rule, and an attempted pass using an artifact-derived manifest fails.
- **C2-AC3** Every fixture assigned to C2 in section 8 is rejected with the stated mechanism.
- **C2-AC4** A one-byte change to any packaged file, an added file, a removed file, a changed `scripts` entry and a changed dependency specifier are each rejected.
- **C2-AC5** The check refuses a tarball with a symlink, hardlink, traversal path or duplicate entry.
- **C2-AC6** Reproducibility of two packs is demonstrated on Node 22 and 24, or the difference is explained and normalised in the design.
- **C2-AC7** The limitation is documented: **C2 proves the artifact equals what was approved; it does not judge the approved content, and it does not cover registry publication.**

## 8. Adversarial fixtures mapped to controls

Source: Security's SEC-37 corpus (`atk37.js`). "Observed" is the reference scanner result in `out-v22.19.0.json` and `out-v24.21.0.json` (identical on both). **The control column is design intent. No fixture has yet been run through C1 or C2; every C1 and C2 entry is UNMEASURED.**

| Fixture | Observed scanner result | Underlying risk | Primary control and expected rejection mechanism | Secondary | Status |
|---|---|---|---|---|---|
| a01 reassign after declaration | CLEAN | gate-construction function exported | C1: `createGate` appears in the recorded own keys and in the exports comparison | C2 hash mismatch if the file is not in the manifest | UNMEASURED |
| a02 destructuring assignment target | CLEAN | same | C1 as a01 | C2 | UNMEASURED |
| a03 array destructuring target | CLEAN | same | C1 as a01 | C2 | UNMEASURED |
| a04 for-of target | CLEAN | same | C1 as a01 | C2 | UNMEASURED |
| a05 `arguments[0]` assignment | CLEAN | same | C1 as a01 | C2 | UNMEASURED |
| a06 `arguments[2]` (`module`) | CLEAN | same | C1 as a01 | C2 | UNMEASURED |
| a07 `module` in object literal | CLEAN | same | C1 as a01 | C2 | UNMEASURED |
| a08 `module` via ternary | CLEAN | same | C1 as a01 | C2 | UNMEASURED |
| a09 `module` via sequence | CLEAN | same | C1 as a01 | C2 | UNMEASURED |
| a10 `require.cache[__filename].exports` | CLEAN | same | C1 as a01 | C2 | UNMEASURED |
| a11 `__defineGetter__` | CLEAN | same, as an accessor | C1: accessor present that the reference does not list (descriptor compare; the getter is not invoked) | C2 | UNMEASURED |
| a12 local `Proxy` with a `get` trap | CLEAN | hidden export behind a trap | C1: `isProxy` on exports or on a property, and the canary read returns a value | C2 | UNMEASURED; nested or indirect Proxy forms may not be detectable |
| a13 `createGate` defined on `Object.prototype` | CLEAN | inherited export, prototype pollution | C1: new key on a baseline prototype after load, and `createGate` readable through inheritance | C2 | UNMEASURED |
| a14 `.mjs` HTML-comment-wrapped export | FINDING | same as a01 | C1 (namespace import of the `.mjs` file) | C2; scanner finding | UNMEASURED |
| a15 `.mjs` HTML-comment-wrapped private token | FINDING | private identity token outside the gate | C2 for unauthorised change; **no control for an authorised change** | scanner finding (advisory) | **UNRESOLVED for an authorised first-party change** |
| a16 TypeScript `export import createGate =` | CLEAN | export in an unsupported file type | C2: file not in the manifest set (the repository has no TypeScript file) | supported-extension rule | UNMEASURED |
| a17 token split by concatenation (R1) | CLEAN | private token outside the gate | C2 for unauthorised change | none | **UNRESOLVED for an authorised first-party change** |
| a18 token via `join` (R7) | CLEAN | same | C2 | none | **UNRESOLVED (as a17)** |
| a19 token via template (R2) | CLEAN | same | C2 | none | **UNRESOLVED (as a17)** |
| a20 YAML `\x5f` escape (R7) | CLEAN | same, in a data file | C2: file set and hash | none | **UNRESOLVED (as a17)** |
| a21 HTML `&#95;` entity (R7) | CLEAN | same | C2 | none | **UNRESOLVED (as a17)** |
| a22 duplicate JSON key (R7) | CLEAN | same | C2; C2 canonical `package.json` comparison for that file | none | **UNRESOLVED (as a17)** |
| a23 `.mts` TypeScript syntax | CLEAN | unsupported file type | C2: file set | extension scope (section 4) | UNMEASURED |
| a24 `.cts` TypeScript syntax | CLEAN | unsupported file type | C2: file set | extension scope (section 4) | UNMEASURED |
| a25 plain positive control | FINDING | export | C1 and scanner both expected to reject | C2 | UNMEASURED for C1 |
| deep3000, deep30000 | PARSE_FAIL | resource exhaustion in the analyser | Scanner fails visibly (advisory). C1: a package that cannot load is a rejection | none | Accepted by Security as a visible failure; C1 behavior UNMEASURED |
| f01 `arguments[1]('child_process')` | CLEAN | a disallowed builtin loaded | Scope A trust plus C2 for unauthorised change; **Scope B (C5) for untrusted code** | none | **UNRESOLVED for an authorised first-party change** |
| f02 `(0, require)('child_process')` | CLEAN | same | as f01 | none | **UNRESOLVED (as f01)** |
| f03 `require?.('child_process')` | CLEAN | same | as f01 | none | **UNRESOLVED (as f01)** |
| f04 `.mjs` HTML-comment-wrapped import | FINDING | same | as f01 | scanner finding | **UNRESOLVED (as f01)** |
| f05 computed `process.execve` | FINDING | process image replacement | C1 and C3: if it runs at load, the result channel is absent or the process aborts, which is a rejection; a later trigger is not covered | scanner finding | UNMEASURED; **UNRESOLVED for a later trigger** |
| f06 `this.module.require` | FINDING | same as f01 | as f01 | scanner finding | **UNRESOLVED (as f01)** |
| f07 plain `require` control | FINDING | allowlist negative control | scanner finding (advisory) | none | Advisory only |

Where a row says UNRESOLVED, no enforceable or detective control covers an **authorised, first-party, reviewed** change. Under Scope A that residual is carried by code review. Under Scope B it is carried by C5.

## 9. SEC-37 finding disposition

No finding is closed by this document. Each stays at its SEC-37 status until Security assesses the underlying risk.

**M-1 = m-134 (coverage claim false).**
- *Claim invalid:* that the AST scanner flags every form that exports `createGate` and that R1, R2 and R7 token rules are a barrier. SEC-37 produced 11 export forms, three further forms and six token evasions that return CLEAN.
- *Requirement amended:* the m-134 acceptance criterion changes from scanner completeness to MG-13-C1, MG-13-C2 and MG-13-MAP (section 5).
- *Control addressing the risk:* C1 (observed surface) and C2 (unauthorised change). Token-forging by an **authorised** change stays UNRESOLVED (T2).
- *Evidence missing:* every fixture of section 8 run through C1 and C2; a reference manifest process with a demonstrated independence property; C1 and C2 implementation.
- *Security's view:* not yet assessed. It is recorded in `docs/security/phase-18-design-review-37.md` after SEC-38.

**M-2 (forms specifier allowlist bypassed).**
- *Claim invalid:* that aliasing `require` or calling it non-literally is a finding, and that the per-file specifier allowlist prevents loading a disallowed builtin.
- *Requirement amended:* MG-13 is no longer "refuse the builtin-loading set by static check". It is MG-13-SCOPE plus the T3 row.
- *Control addressing the risk:* C2 for unauthorised change; Scope A trust for authorised first-party code; **C5 for untrusted code**.
- *Evidence missing:* the owner classification of spec-file authorship; for any workflow that runs untrusted code, C5 evidence including x64 and runner parity and PID containment.
- *Security's view:* not yet assessed.

**Minors (SEC-37).**
- `TZ` and `LC_*`: **OPEN**. `TZ` accepts an absolute path while `TZDIR` is denied, and `LC_*` path-form values are not validated. Both are hypotheses. Closure needs a Linux measurement of what the C library and Node read for each value, or an independent assessment. This revision does not close them.
- `.mts` and `.cts` scope: corrected in section 4 by narrowing the documented scope after repository inspection. This is a claim correction. Security must decide whether the risk (an unsupported file type reaching the package) is controlled by the C2 file-set check; it is not treated as closed until then.
- Deep nesting `PARSE_FAIL`: accepted by Security as a visible failure; unchanged.
- Process-identity and Linux evidence: preserved as recorded in rev 41; arm64 only; Linux x64, runner and Windows verification stay open.

## 10. Owner conditions carried into this revision

1. Scope A approved; Scope B tracked separately; no Scope B evidence marked complete.
2. The MG-13 contract is conditionally approved and requires Security review before it is an accepted replacement.
3. The scanner is advisory; no expansion; no Playwright internal path as a production dependency; any CI parser needs separate approval.
4. Supported extensions `.js`, `.cjs`, `.mjs`, confirmed by repository inspection (section 4).
5. `TZ` and `LC_*` stay open. SEC-37 history is preserved.
6. Docs-only; no C1 or C2 implementation; main session only; one independent Security review; push to Draft PR #60 only after required checks and independent Security approval of the exact final revision; PR #60 stays Draft; no merge, deploy, publication or product implementation.

## 11. Remaining measurement and implementation gates

- **C1**: implementation, fixture runs on Node 22 and 24, the `falcon.js` load decision, the variation matrix.
- **C2**: implementation; a `files` allowlist; exact dependency pins or lockfile-integrity enforcement; the independent manifest process (reviewer rule, `CODEOWNERS`, branch protection and ruleset state, none of which was inspected); pack reproducibility.
- **C5**: wiring to Falcon, Linux x64 and runner parity, PID and cgroup containment of a `setsid` grandchild, the wss controls (MG-15).
- **Environment**: `TZ` and `LC_*` measurement.
- **Platform**: Linux x64, GitHub runner, Windows. All evidence so far is arm64.
- **Unchanged open gates**: MG-1 (partial), MG-4, MG-9, MG-10, MG-11, MG-12 (needs CI and Linux), MG-13 (implementation), MG-14, MG-15, MG-16, MG-17; the FW2-C6 measurements C6-O1 to O7; OPEN-BID-27; the empty supported-browser set (OWNER-24). **MG-8 is not cleared.**

## 12. Limitations and non-goals

- No claim that any shipped control sandboxes JavaScript, or defends against code already running in the trusted process.
- No claim that C1 or C2 passes: neither exists.
- No claim about browsers; the supported-browser set is empty.
- No Windows, Linux x64 or runner claim.
- No customer-availability claim.
- Non-goals: extending the scanner; adding a parser dependency; adopting the Node permission model or a process-load observation check (a possible C1 extension is listed as an owner decision, section 13, and is **not** part of the contract); implementing any control; changing `gate37.js`, `decide32.js` or the supervisor.

## 13. Decision record - why scanner completeness is no longer the security objective

**Context.** Rev 39 to 41 tried to make a static syntactic scanner the evidence that no module exposes a gate-construction interface and no code loads a disallowed builtin. Security found, in SEC-36 and SEC-37, new evasions each round: 19 literal misses, then 11 export forms, three structural forms, six token encodings and three `require` aliasings.

**Decision.** Completeness of a static scanner is not an achievable security objective for JavaScript, and it is withdrawn as a requirement and as a claim. The objective is restated as observable, verifiable properties of the shipped artifact (C1, C2), the preserved fail-closed behavior (C3, C4), and an explicit isolation requirement for untrusted execution (C5).

**Reasons.**
1. The language lets code construct any name or reach any builtin at runtime; a measured reachability probe shows every loader path available to in-process code.
2. A scanner can only add evasion cases; each reviewed round produced new ones. The cost of the line grows without a bound on its coverage.
3. Behavioral observation of the real artifact needs no model of the syntax. A package hash comparison needs no model of the code.
4. Where untrusted code must run, only an isolation boundary outside the process is an honest control.

**Consequences.** The scanner stays as diagnostic evidence. Authorised first-party changes that evade every detective control (rows marked UNRESOLVED) rely on code review under Scope A. The acceptance contract for MG-13 changes (section 5), and Security must accept that change before it is treated as a replacement. This is both a **correction** of inaccurate claims (the m-134 coverage claim; the aliasing claim for MG-13) and a **material change** to the MG-13 acceptance criterion.

**Owner decisions still open.**
1. Classify spec-file authorship per supported workflow; any workflow permitting customer-authored code in the Node process requires C5 before enablement.
2. Whether to propose, as a separate reviewed change, a load-time observation of `process.moduleLoadList` as an additional C1 check (it would detect eager builtin loading at load time only; it is **not** in this contract and has not been measured).
3. Whether `CODEOWNERS`, branch protection or rulesets are the independence mechanism for the C2 manifest, and who the non-author reviewer is.
4. Whether to adopt exact dependency pins or lockfile-integrity enforcement for the Scope A "explicitly pinned" requirement.
5. Whether any parser enters CI (separate justification; not part of this revision).
