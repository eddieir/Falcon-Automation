# Phase 18 Security Design Re-review 8 (SEC-09)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `35a64c7` on `docs/phase-18-architecture` (architecture rev 2 plus the [rev 3](../architecture/phase-18-rev3-patch.md) to [rev 9](../architecture/phase-18-rev9-patch.md) patches; base `2572e73`). Scope: the rev 9 delta only. That is the rev 9 patch (ARCH-09) and the edits it caused in the acceptance criteria, plan, threat model, [decision traceability](../phase-18-decision-traceability.md), [owner decision packet](../phase-18-owner-decisions.md) residual 4 and the rev 8 provenance lines. These are checked against [re-review 7](phase-18-design-review-7.md) (SEC-08). This record supersedes re-review 7.

**Verdict: APPROVE WITH CONDITIONS.** No P0 or P1. **Blockers: 0. Majors: 0 open.** M-13 and M-14 are CLOSED in the design. **New minors: 5 (m-24..m-28).** Two carried minors are PARTIAL (m-21, m-23), both documentation only. No Must criterion and no owner decision (OD-01..OD-19, OWNER-01..07) is weakened. No risk is accepted here.

## Facts verified

- **AC JSON is valid.** It has 91 criteria (Must 82, Should 6, Could 3), no duplicate IDs, and `counts` and `designRevision` match rev 9 A1. P18-AC-087 is rewritten as stated. P18-AC-089, 090 and 091 are present and all are Must, owned by 18B, 18D and 18C. The A3 edits to 042, 045, 051, 080, 084 and 085 are present. `openItems` holds OD-24-Q1, OD-20-Q1, SPIKE-FS, SPIKE-R (replaced) and H-1 as specified.
- **HealingTrust open-write is CONFIRMED by code.**
  - `src/core/AIHealer/HealingTrust.js:63`: the constructor calls `_reload()`.
  - `:98-120`: an over-cap decisions ledger queues `writeJsonAtomic(decisionsPath)`.
  - `:122-130`: pending eviction queues `writeJsonAtomic(pendingPath)`.
  - The writes are queued asynchronously, which matters for the test (item 4 below).
  - `locator_store.json` exists as a store file (`src/core/parallel/ShardMerge.js:344`). Which module evicts it on open was not checked (UNVERIFIED).
- **H-2 is answered.** The lease is armed only by `arm(ctx, approvedAction, …)` (rev 3/rev 4). A P1 permit therefore never arms, and an unarmed non-GET is aborted.
- **CI today:** one workflow, no `secrets.*` references, no `${{ }}` in `run:` lines and no lifecycle (`pre*`/`post*`/`prepare`/`install`) scripts in `package.json`. The practical exposure from item 2 is therefore low today.
- **Provenance:** no `OWNER-1x` citation remains in `docs/`. The rev 8 ADR lines read D1/OWNER-01, D2/OWNER-02, D4/OWNER-03, D7/OWNER-05 and D11/OWNER-07. 2c.10 reads D10/OWNER-06 and the OD-20 line reads D5/OWNER-04. Owner packet residual 4 is superseded in place. That D11 is an owner decision still cannot be verified from the repository (UNVERIFIED). The patch flags it honestly as owner-message provenance.

## Item status

### (1) M-14: CLOSED (design), with conditions m-26 and m-27

- **Closed set.** R3/R4 invert the gate correctly. `classify` has no default `permitted` branch. P1 requires an exact `{route, method, actionKey}` match, re-validated (m-20). P2 is a frozen constant asserted by test, and a change to it needs security review. Element shape can only raise. This removes the enumeration defect entirely.
- **P2 members.** None of `textContent`, `innerText`, `innerHTML` (read), `getAttribute`, `inputValue`, `isVisible`, `isEnabled`, `isChecked`, `count`, `boundingBox`, `waitForSelector` or `waitForLoadState` dispatches an activation event or a request from Falcon's side. The risks they do carry are confidentiality and openness, not activation. See m-26.
- **Indirect lowering.** The maximum rule plus recompute-at-perform close the plan-row, provider and healing/re-resolution paths (3a.3, AC-089). One path is not named: Playwright's own locator re-resolution between `classify` and the actual action. See m-27.
- **NetworkGate independence (3a.4, AC-091).** This is sound. The decision inputs exclude classification, plan, provider and action record, and the lease is armed only from a consumed approval. A classifier defect therefore degrades to a refusal. The bounds that remain are H-1 (WebSocket and service worker) and the existing residual for destructive GETs on allowed routes.
- **Tests.** The 15 cases plus the inversions are sufficient, because the inversion ("add a default permit or a shape gate, and cases 1–12 fail") tests the property, not a list. Recommended additions:
  - page-level `page.mouse.click(x,y)` and `page.keyboard.press` with no element identity (expected: protected, or refused as undescribable);
  - a `<label for=…>` click that forwards activation;
  - a cross-origin iframe control.

### (2) M-13: CLOSED (design), subject to OD-24-Q1, with conditions m-24 and m-25

- **What holds.** 3b.2 items 1–4, 6 and 7 are code-enforced and robust against production code and workflow accidents. Two layers confine the approval:
  - **Mint.** Minting requires a live `net.Server` handle in a non-exported registry, a loopback literal, the capability returned by `start()`, and a manifest whose every origin is that loopback origin.
  - **Consume.** Consumption is re-checked against the live destination, the manifest digest and the handle.
- **Result.** An approval minted this way cannot authorise a non-loopback request through Falcon. A dependency or a test author who calls `FixtureServer.start()` obtains only a loopback-bound approval. That is by design.
- **Limits.** Item 5 (CI double gate) and item 8 (CLI refusal in CI) are **not** controls against in-process or repo-write code, as m-25 explains. The 3b.3 static check is literal-only and has coverage gaps (m-24). The architect's residual statement is honest about the loopback bound but overclaims in two places (m-25).

### (3) Minors from SEC-08

- **m-20: CLOSED (design).** The design re-validates `entryId`, route, method, `actionKey` and digest at load and at perform. A pattern `actionKey` is schema-invalid outside P2. The refusal codes are specified as `PLAN_PERMIT_UNJUSTIFIED`/`PLAN_DRIFT` exit 2, `MANIFEST_INVALID`, and exit 18 at perform.
- **m-21: PARTIAL (DOC).** (b) and (c) are closed in rev 9 and in AC-085/OD-20-Q1. (a) is **not applied in place**: the incorrect "`tmpfs` and `ramfs` share magic `0x01021994`" claim still stands in `docs/architecture/phase-18-rev8-patch.md:140` and `docs/phase-18-decision-traceability.md:46`. Rev 9 says "DELETE", but neither file was edited. See m-28.
- **m-22: CLOSED (design).** The four hop rules and the chain deadline (`windowMs + 5000`, hard maximum 30000 ms) are in place. Merge still depends on SPIKE-R (unchanged).
- **m-23: PARTIAL (DOC).** Closed:
  - the plan lines 32 and 91;
  - the threat-model §8 rows (table intact, 27 table rows, 18A dropped `neg-d1-boot-identity`, 18E sole owner);
  - the status lines;
  - provenance.

  Stale text remains:
  - rev 8 `:112` still says "(18E/18D)" and `:244` still adds `neg-d1-boot-identity` to 18A;
  - the traceability D2, D4 and D11 rows (`:10`, `:12`, `:19`) were not edited. A header pointer says rev 9 3d.E supersedes them, but readers of the rows see the old ACs and tests.

### (4) HealingTrust/LocatorMemory and the four-file no-write test: CLOSED (design), with one test condition

The test design is adequate: an over-cap `healing_decisions.json`, an over-cap `healing_pending.json`, a salt-less `locator_memory.json` and an evictable locator store; all four digests unchanged; no files created; inversion required. **Condition:** because the HealingTrust writes are queued promises, the digests must be taken **after the pilot process exits** (or after an explicit queue drain). Otherwise a late write lands after the assertion and the test passes falsely. The inversion must demonstrate this ordering. 18A merge condition.

### (5) Document consistency

AC JSON is valid and consistent. The plan, threat model and owner packet are updated. Stale or contradictory text is listed under m-21 and m-23 and collected in m-28. No CI approve path appears in the plan, threat model or AC.

## New findings

**m-24 (Minor, 18F merge). The 3b.3 reachability check has coverage gaps.**
- *Likelihood:* low (no current workflow uses these).
- *Impact:* an approve path hidden from the gate.
- *Remediation:* the check must also handle each of the following:
  - **(a)** `uses:` steps: local composite actions (`./.github/actions/*`) and reusable workflows are resolved recursively. Any `uses:` with an inline script input (for example `actions/github-script`) and any unpinned third-party action fails closed.
  - **(b)** Any `${{ … }}` expression inside `run:`, including `matrix`/`include` values, is `UNRESOLVABLE_WORKFLOW_COMMAND`, unless the checker expands a fully literal matrix.
  - **(c)** npm `pre<X>`/`post<X>` hooks and the root `prepare`/`install`/`postinstall` hooks run by `npm ci` are part of the resolution.
  - **(d)** `node -e`/`-p`, `node --require`/`--import`, `NODE_OPTIONS` and `env:` blocks that set them, and `shell:` overrides are unresolvable unless literal and followed.
  - **(e)** In reachable JS, a non-literal `require`, `import()`, `module.createRequire`, `child_process.*` with a non-literal command or args, or `process.execPath` spawning fails closed outside `tests/`. In `tests/` it is listed in the check output.
  - **(f)** Test runner configs (`playwright.config.js`, `globalSetup`) are walked as entry points.
- *Verification:* one inversion per item a–f must fail the gate.

**m-25 (Minor, 18D/DOC). The residual statement and ADR-0044 overclaim. Items 5 and 8 are accident guards only.**
- **Forgeable gates.** `process.argv[1]` and `process.env` are writable by any in-process code. Any test can spawn `falcon.js` with `env: {CI: ''}` and a computed flag string (`'--appr'+'ove-action'`), which evades the literal static check. That path produces a **persisted, non-loopback-bound CLI approval**. The statement "not a path to a staging mutation" is therefore true only of the fixture mint path, not of a repo-write author in general.
- **Forwarding.** A fixture server whose handler proxies upstream, or a browser launched with a proxy that does not bypass loopback, forwards a loopback-approved request onward.
- *Likelihood:* low; the actor is a repo-write insider, and CI holds no secrets today.
- *Remediation:*
  - **(a)** ADR-0041/0044 and threat-model §6 item 20 state that the boundary protects against production code and workflow accidents, not against a malicious repo-write author, whose control is code review and branch protection. This is an owner-acceptance item.
  - **(b)** 3b.2 item 5 is labelled defence in depth, like item 8.
  - **(c)** `FixtureServer.start()` accepts no caller-supplied handler, upstream or proxy option and serves only the fixed fixture app. A pilot run that consumes a fixture approval refuses a launch `proxy` setting.
  - **(d)** Add `--approve-action` requiring `process.stdin.isTTY && process.stdout.isTTY` as an extra accident guard; this does not change OD-24.
- *Verification:* `neg-fixture-approval-scope` adds a test for handler/upstream refusal and the TTY refusal.

**m-26 (Minor, 18C/18E). P2 is activation-free but not confidentiality-free, and one phrase leaves it open.**
- **(a)** "and the assertion primitives built on these" must be replaced by an explicit list inside the frozen constant. Otherwise the enum is not literally closed.
- **(b)** Values from `innerHTML`, `getAttribute`, `inputValue` and `textContent` can carry CSRF tokens (`input[type=hidden]` value attributes), prefilled credentials, or session data. All P2 results must pass `EvidenceBoundary` before any log, report or receipt. `inputValue`/`getAttribute('value')` on `type=password`, `type=hidden` and `autocomplete=one-time-code|current-password` must be redacted at source.
- **(c)** The `evaluate` helpers run in an isolated or utility world where Playwright supports it, so page-overridden prototypes or getters cannot run page code on Falcon's read. If a getter does trigger a request, NetworkGate still bounds it.
- **(d)** `waitForSelector`/`waitForLoadState` take a bounded timeout.
- *Verification:* the frozen-enum test asserts the exact member list. `neg-l0x` adds a hidden-CSRF-input `innerHTML` read and a password `inputValue` read, and asserts zero token bytes in artifacts.

**m-27 (Minor, 18B). Classify and act must refer to the same node.**
- Playwright locators re-resolve during auto-wait. A page can swap the node between `classify` and `click`, and 3a.3(3) only covers Falcon-initiated healing or re-resolution.
- *Remediation:* act on the `ElementHandle` that was classified, or re-verify identity atomically immediately before dispatch, with the refusal `APPROVAL_MISMATCH`/`heal_changed_classified_element` exit 14.
- *Verification:* `neg-c02-no-lowering` adds a DOM swap during actionability wait.
- The impact is bounded by NetworkGate for non-GET requests.

**m-28 (Minor, DOC). Stale text.** Apply the rev 9 3d.E edits in place:
- delete the magic claim at rev 8 `:140` and traceability `:46`;
- correct rev 8 `:112` and `:244` (`neg-d1-boot-identity` is 18E only);
- update traceability rows D2, D4 and D11 rather than relying on the header pointer.

## Hypotheses (unverified)

- **H-1 (residual, unchanged).** WebSocket frames and service-worker requests are not covered. Also confirm in SPIKE-W whether dedicated and shared worker `fetch` is routed by the context-level route. Per rev 4 N-2, such a request never consumes a lease, so it is aborted only if the route fires at all.
- **H-3.** If `actionKey` is derived only from page-controlled text, a hostile page can relabel a control to match a P1 key. This is bounded by NetworkGate (non-GET aborted) and by the destructive-GET residual. 18C should document how the key is derived.

## Verdict per PR

- **18E: may start from the security side (0 blockers / 0 majors).** Merge requires m-21(c) if OD-20-Q1 is adopted, m-26(b) for the EvidenceBoundary half, and the SEC-07 18E conditions.
- **18A: 0/0.** Merge requires the four-file no-write test with the post-exit digest condition.
- **18C: 0/0.** Merge requires m-20, m-26, SPIKE-R and the H-3 documentation.
- **18B: 0/0.** Merge requires m-20, m-22 and m-27.
- **18D: 0/0.** Merge requires the OD-24-Q1 owner answer and m-25(c)/(d).
- **18F: 0/0.** Merge requires the OD-24-Q1 owner answer and m-24.
- **DOC: 0/0.** Merge requires m-25(a)/(b) and m-28.

**No blocker or major remains.** The open owner decisions are OD-24-Q1, OD-20-Q1, OD-22-Q1, OD-22-Q2 and OD-23-Q1. Two items also need owner acceptance:

- the m-25(a) residual: a malicious repo-write author is outside the code boundary;
- H-1.

The remaining security items are the minors listed above, which are merge conditions, not start gates.

## Owner items (none accepted)

- OD-24-Q1. I take no position on narrow versus strict. If the owner picks the narrow reading, m-24 and m-25 must be met.
- OD-20-Q1, OD-22-Q1, OD-22-Q2 and OD-23-Q1.
- The m-25(a) residual and H-1.
- The D11 provenance.
- The four D10 items that are not accepted.
- Every residual carried forward from re-reviews 6 and 7.
