# Phase 18 Security Design Review 38 (SEC-39)

Reviewer role: Security Engineer (`claude-opus-5-5`), read-only. Revision reviewed: rev 43 at `09927e9` (docs only; `phase-18-rev43-patch.md` sha256 `59352e43ed3c89850ccff8614d77f8b4f10e826c1f388af4e87f8f5f3dec557c`, verified). Condensed by the coordinator from the reviewer's report. Status: **DONE**.

**Verdict: APPROVE WITH CONDITIONS (design text only, Scope A). Blockers: 0. Majors: 0. Minors: 4 (m-143 to m-146).** Eligible for push under the owner's zero-blockers-and-zero-majors rule. The reviewer states this approval does not show that C1 or C2 works, because neither has been built. MG-8 and MG-13 are NOT cleared.

Dispositions:
- **M-3:** accepted. L1 to L7 cover all seven SEC-38 evasions; DETECT and KNOWN-MISS are kept apart honestly; T1 now carries an UNRESOLVED residual. The list is incomplete (m-143).
- **M-4:** accepted. IND-1 to IND-4 are sound as requirements, and the independence-UNMET and "design incomplete" status are correctly carried into C2 and MG-13. Two wording issues remain (m-144, m-145).
- **m-140:** accepted. The tarball versus executed-tree gap is stated without papering over it. The register still has gaps (m-146).
- **m-141:** closed. 267 integrity entries, none missing, no non-registry `resolved`, lockfileVersion 3; five `npm ci` calls, one in each of the five jobs.
- **m-142:** closed as a specification. The forged-line `execve` fixture is adequate; Linux and Node 24 behaviour is still unverified.
- **m-134:** stays OPEN. **M-2:** unchanged (T3 UNRESOLVED; owner acceptance needed).

New minors:
- **m-143 (confirmed on Node 22, macOS):** the rev 42 C1 approximation lets five more routes through while `createGate` stays reachable: `process.x = createGate`; statics on built-in constructors (`Object.x`); writing onto another module's exports (`require('path').x`); a `require.cache` entry; a `process.on` listener that hands the gate out. None is in L1 to L8. Fix: say C1 detects only the DETECT routes and everything else is a known miss, add L9, and pin them as fixtures.
- **m-144:** the claim that job-level `permissions` blocks "differ" is wrong. All three (lines 368, 425, 512) are `contents: read`; `regression` and `test` inherit the top-level `contents: read`. No `secrets.` references were found.
- **m-145:** the trigger wording is loose. `pull_request` covers only `main` and `New_era_Falcon`, while `push` covers `feat/**` and `test/**`. IND-4 should also cover push-triggered runs of an edited workflow on the same commit, which could report a same-named check (hypothesis; GitHub behaviour not verified).
- **m-146:** the register is missing `playwright.demo.config.js` and `playwright.regression.config.js` (each with its own `testMatch`), the `tests/fixtures/*-preload.cjs` files, 11 tracked `.js` files under `docs/`, `.env` and `src/config/testConfig.json`, `ProfileStore`, and Dependabot as a lockfile author under IND-2.

Verified: the HEAD, rev 42 and review-37 hashes; no `CODEOWNERS`; 498 commits at `905462f`, all with one author email (two name spellings; GitHub is the committer on 49). Unchecked: Node 24, Linux, remote protections and rulesets, GitHub required-check semantics; the `n1` return-value evasion was rejected only by a name and length fingerprint and is not demonstrated.

Sufficient for Scope A as a design, once m-143 to m-146 are fixed and the owner accepts T1 to T3 and the unmet independence. Open risks: C1 and C2 not built; IND-2 unenforceable with a single contributor; browser binaries unpinned; C5 incomplete.
