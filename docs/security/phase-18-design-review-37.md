# Phase 18 Security Design Review 37 (SEC-38)

Reviewer role: Security Engineer (`claude-opus-5-5`), read-only. Revision reviewed: rev 42 at `905462f` (docs only; `phase-18-rev42-patch.md` sha256 `a8727adab7cb5810cae3eea3d861f9a169fe64aac1193ffd4afcc3a43931ab26`, checked). Condensed by the coordinator from the reviewer's report. Status: **DONE**.

**Verdict: REJECT. Blockers: 0. Majors: 2. Minors: 3 (m-140 to m-142).** Not eligible for push. The reviewer states the rejection is narrow and needs text changes only. Scope A is appropriate, the withdrawal of the scanner claims is honest, and the direction is right, but two parts of the new argument still overclaim.

Majors:
- **M-3 (C1 does not cover what the document says; confirmed against an approximation of the section 6 design).** The reviewer built a probe following the C1 design (top-level surface, baseline key deltas, `isProxy` to depth 2, canaries). It reported PASS in 7 of 8 evasions while `createGate` stayed reachable: a static on an exported class, a Proxy set as a value's prototype, `String.prototype` and `Module.prototype` pollution, a replaced existing `Object.prototype` member, an export added in a microtask, an export hidden when the working directory is empty, and a method on a class prototype. Row T1 lists no residual for an authorised first-party change, although T2 and T3 do. Fix: mark that T1 residual UNRESOLVED, list these C1 limitations, and add the fixtures to C1-AC2.
- **M-4 (the independence rule is incomplete).** It covers the manifest and the export-surface file only. The verifier, the C1 harness and `ci.yml` run from the pull-request head (`pull_request`, `ci.yml` lines 3 to 7), so a pull request can change its own check. For a release, the manifest comes from the release commit, which is not independent of the artifact. The non-author reviewer rule is not enforced: there is no `CODEOWNERS`, remote protections were not inspected, and every commit has the same git identity. Fix: load the verifier, the workflow and the references from the base ref, and enforce a non-author review.

Minors:
- **m-140:** the trust register omits `scripts/`, `src/dashboard`, `src/config`, the development dependencies (`@playwright/test` loads spec files), browsers installed by `npx playwright install` (outside the lockfile), and LLM responses and the healing store. The register says C2 verifies the core, but C2 checks the tarball while CI runs the working tree.
- **m-141:** CI already runs `npm ci` against a lockfile with 267 integrity entries, yet the register calls dependencies "not yet conforming". It must state which criterion counts as conforming.
- **m-142:** load-time `process.execve` was checked on macOS, Node 22 only. Descriptor 3 is not inherited (ENXIO, EBADF), so a forged result line fails and a missing line gives a rejection. Linux and Node 24 are unchecked. Add a C1-AC5 fixture that execs a process which forges the line.

Dispositions:
- m-134: the claim correction is accepted; stays **OPEN** until M-3 is fixed and C1 and C2 are built.
- M-2: the claim correction is accepted; the leftover risk (T3, UNRESOLVED) needs owner risk acceptance and a ruling on who writes spec files. With those, the control is sufficient for Scope A.
- `TZ` and `LC_*`: correctly left OPEN.
- `.mts` and `.cts`: closed as a claim correction (0 such files).
- Deep nesting: closed.
- Linux evidence: open, arm64 only.

Verified by the reviewer: every hash the document cites; 144 `.js`, 133 `.cjs` and no other script types; no `files` allowlist and no `.npmignore`; caret ranges with a lockfile; no lifecycle scripts; no `CODEOWNERS`; GitHub Actions pinned by SHA; the host is arm64.
Unchecked: Node 24 (not installed), Linux, remote branch protection, and the reachability fact (taken from SEC-37).

Design for Scope A: right direction, not acceptable as written. Open risks: C1 and C2 not built; C5 incomplete; non-author review not enforced.
