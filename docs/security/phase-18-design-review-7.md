# Phase 18 Security Design Re-review 7 (SEC-08)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `0cc4feb` on `docs/phase-18-architecture` (architecture rev 2 plus the [rev 3](../architecture/phase-18-rev3-patch.md) to [rev 8](../architecture/phase-18-rev8-patch.md) patches; base `2572e73`). Scope: the rev 8 delta only, which covers the rev 8 patch (ARCH-08), [decision traceability](../phase-18-decision-traceability.md), the edited acceptance criteria, plan and threat model, checked against [re-review 6](phase-18-design-review-6.md) (SEC-07) and the [owner decision packet](../phase-18-owner-decisions.md). This record supersedes re-review 6.

**Verdict: APPROVE WITH CONDITIONS.** No P0 or P1. **Blockers: 0. New majors: 2 (M-13, M-14).** Both block only the PRs named in them (18C, 18D, 18F). Neither blocks 18E. **New minors: 4 (m-20..m-23).** No Must criterion and no owner decision (OD-01..OD-19, OWNER-01..07) is weakened. No risk is accepted here. Every owner item below stays with the owner.

## Facts verified

- **AC JSON is valid.** It has 88 criteria (Must 79, Should 6, Could 3), no duplicate IDs, and `counts` matches. P18-AC-083..088 are present and all are Must. The changed criteria (023, 033, 042, 043, 051, 060, 067, 072, 073, 074, 078) match rev 8 A3. `openItems` matches A2.
- **m-17-Q1 is now CONFIRMED by code, not hypothetical.** `src/core/locator/LocatorMemory.js:243-253` generates a salt on load when `FALCON_LOCATOR_SALT` and the file salt are both absent. `:315-317` then calls `this._persist()` from the load path when a salt was generated, entries were quarantined, rejections were trimmed or entries were evicted. Opening `LocatorMemory` can therefore write `data/locator_memory.json`. In pilot mode this would raise a false exit 17 and break AC-088. 2c.2(6) is required, not optional. HealingTrust's open behaviour was not checked (UNVERIFIED).
- **The traceability IDs do not match the ledger.** The ledger is OWNER-01..07, but rev 8 cites `OWNER-10` (2c.10) and `OWNER-11` (ADR-0043). The owner packet contains no D11 text; its residual 4 still reads "may classify as permit". Whether D11 is an owner decision cannot be verified from the repository (UNVERIFIED). D11 strengthens the control, so the security risk is low, but the provenance gap is real (m-23).

## Item status (SEC-07 carry-over)

- **m-15: CLOSED (design).** The exit code is 2 and the fs-spy no-read check is kept. Verification: extended `neg-shard-refusal-bundle`.
- **m-16: CLOSED (design).** The design adds a mandatory `--expect-config-fp=<hex64>`, which is never taken from a bundle, and the static check covers it. Condition: a malformed value (not 64 lowercase hex characters) exits 2.
- **m-17: CLOSED (design).** (a) and (b) are normative. The new evidence above makes (b) and 2c.2(6) mandatory. Condition for 18A: **pilot mode does not construct `LocatorMemory`/`HealingTrust` at all** (preferred), or it uses a read-only constructor option that disables `_persist` in `_reload`. The test seeds no salt, an over-limit rejections ledger and an evictable store, then asserts all three digests are unchanged. Inversion: remove the option and the test fails.
- **m-18: CLOSED (design).** Condition: pilot versus non-pilot mode is decided by the merge's own argv (`--pilot-manifest`), never by receipt content.
- **m-19: CLOSED (design)** through 2c.2(3) and AC-088.
- **m-10: PARTIAL, unchanged** (SPIKE-R).

## Specific asks

### (1) D11 classification policy (2c.11, ADR-0043)

**M-14 (Major, 18C merge; 18B for the plan half). The state-changing-capable predicate is form- and element-centric and misses common attack shapes.** Rule 3 keys on forms, button types, `formaction` and a "declared or observed method". The method of a script-dispatched request cannot be observed before activation. As written, these cases are not state-changing-capable:

- a `div`/`span`/`a href="#"` with `role=button|menuitem|switch|tab|checkbox` or a JS click listener that calls `fetch`, XHR, `sendBeacon` or `form.requestSubmit()`;
- a control associated with a form through the `form=` attribute but outside it in the DOM;
- a form-associated custom element (`ElementInternals`), or a control inside shadow DOM;
- action types rather than elements: `press("Enter")`/`press(" ")` in a text field (implicit submission), `setInputFiles` (file upload), `dragTo`/drag-drop, `selectOption`/`check` with change-triggered autosave, and typing into `contenteditable` with autosave;
- a WebSocket send triggered by a click (the network gate does not see it; hypothesis H-1).

Two further gaps:

- **The rule set is not total.** It defines no outcome for a control that is not state-changing-capable, not ambiguous and not explicitly permitted. An implementer could resolve that case with a default "read" permit, which reintroduces the fall-through.
- **The plan row is an unbounded input.** Nothing states that the plan row's recorded classification cannot lower the live classification at `gate.perform`, or that a healed (AI-substituted) element is re-classified.

Mitigating backstops: unarmed non-GET requests are aborted (section 7a rule 3), and rule 6 traceability applies. Today the impact is therefore mostly a mis-attributed refusal, not a mutation. That changes if any manifest entry can allow a non-GET without arming (UNVERIFIED in this scope).

Remediation:

- **(a) Define the predicate over the (element, action type) pair.** Treat as state-changing-capable: any element with an interactive ARIA role, a JS activation listener or `tabindex`; any form owner resolved through `element.form`, including `form=` and form-associated custom elements; and the action types `press` Enter/Space, `setInputFiles`, drag, `selectOption`/`check` and `contenteditable` input.
- **(b) Make classification total:** every outcome that is not explicitly permitted is `protected`, `denied` or `CONTROL_AMBIGUOUS`. Nothing reaches `permitted` except through rule 6.
- **(c) Define the effective classification as the maximum** of plan row, live re-classification and provider advice over the order denied > protected > permitted. `CONTROL_AMBIGUOUS` means zero clicks. Re-classify the element that is actually acted on after any healing.
- **(d) Add these cases to `neg-c01-default-protected`,** including Unicode non-Latin labels ("Löschen", "削除", "حذف") on role=button divs, with an inversion.

**Provider lowering.** Rule 5 and AC-045 close the direct path. The indirect paths (healed element, plan row) are covered by M-14(c).

**m-20 (Minor, 18C/18B). Permit traceability must be re-validated, not only shown to exist.** `neg-b06` checks for a missing justification or a justification naming an absent entry. Add the following:

- the cited entry must actually match the row's route, method and action key, re-evaluated against the freshly loaded manifest;
- the manifest schema must forbid wildcard or pattern permits that cover state-changing-capable controls, or require an exact action key for them;
- the refusal code for an unjustified plan row must be specified.

The manifest permit surface does not exist yet (traceability item 7). 18C must add it to `schemas/pilot-manifest.v1.json` and to the reference, kept in sync under AC-038.

### (2) m-15/m-16/m-18 and 2c.2(6)

All three are CLOSED as stated above. **2c.2(6) is PARTIAL:** the design is correct, the code shows the write exists, and it closes only with the 18A test named under m-17.

### (3) 2c.4/ADR-0041 and OD-24-Q1

**M-13 (Major, 18D/18F merge). The narrow reading is sound only with a code-enforced boundary, and AC-084's static check misses indirection.** As written, the narrow reading exempts tests that mint an approval through the `ApprovalStore` module API. Nothing in code limits that API to the loopback fixture. `approver: "test-fixture"` is a label, not a control (2c.4a(3)). A CI step such as `npm run x` or `node script.js` can call the module API, or `falcon.js --approve-action`, without any flag or key appearing in `ci.yml` text. The CI self-approval prohibition is therefore policy-only.

Remediation:

- **(a)** An approval minted outside the CLI approve path is consumable only for a loopback destination origin and the fixture manifest digest, and `gate.perform` enforces this.
- **(b)** Extend the static check to `package.json` scripts and every script a workflow invokes. Also fail on any `require` of `src/core/pilot/approval/*` outside `src/core/pilot/` and `tests/`.
- **(c)** Defence in depth: `--approve-action`/`--emit-token-to` refuse with exit 1 when `GITHUB_ACTIONS=true` or `CI=true`. This guards against accidents only, because a workflow author controls those variables.
- **(d)** Add an inversion: a staging-origin approval minted through the module API in CI is refused.

Without (a) and (b), the narrow reading is a self-approval loophole. **The choice between the narrow and strict readings belongs to the owner.** I do not choose it.

### (4) 2c.5 double gate (D5/OD-20)

The double gate is sound in structure: a numeric ID, then behaviour tests, then fail-closed with an actionable message.

**m-21 (Minor, 18E/DOC):**

- **(a) The tmpfs/ramfs magic claim appears incorrect.** Per Linux `include/uapi/linux/magic.h`, `TMPFS_MAGIC` is `0x01021994` and `RAMFS_MAGIC` is `0x858458f6`. This is reviewer knowledge and is UNVERIFIED in the repository; SPIKE-FS must confirm it. The real residual is different: a kernel built without `CONFIG_SHMEM` serves `tmpfs` mounts from ramfs. Record the observed ID only.
- **(b)** 2c.5(a)(ii) says the tests verify that `fsync` is "honoured". Behaviour tests can show only that `fsync` succeeds; they cannot show durability. Reword this.
- **(c)** If the OD-20-Q1 recommendation is adopted, the allowlist must be **per root** (`approvalsRoot` excludes tmpfs). AC-085 must state this. I support the recommendation. The owner decides.

### (5) 2c.7 lease

**OD-22-Q1:** a 250 ms floor is supported. It guards against misconfiguration, not a security bound; the 10000 ms maximum is the security bound. Closed from the security side, pending owner confirmation.

**OD-22-Q2: PARTIAL, m-22 (Minor, 18B/18C).** Accepting this needs four conditions:

- A 307/308 hop preserves method and body. It must match the approved `{origin, path}` or be refused.
- A 301/302/303 hop that changes to GET follows GET route policy.
- The whole chain stays under the redirect cap and one overall deadline.
- Hop handling depends on the SPIKE-R `maxRedirects:0` fallback.

Add these cases to `neg-n2-arming`.

### (6) The six 2d items

| Item | Status |
|---|---|
| OD-24-Q1 | Owner item. Gated by M-13 |
| OD-20-Q1 | Owner item. Recommendation supported; m-21 corrects it |
| OD-22-Q1 | Supported |
| OD-22-Q2 | Partial; see m-22 |
| m-17-Q1 | Confirmed by code; closes only by test |
| OD-23-Q1 | Owner item |

On OD-23-Q1, I recommend keeping exit 14, with the distinct receipt and log reason `approval_not_bindable_in_shard`. A new exit code would reopen OD-10.

### (7) Consistency of the edited plan, threat model and AC

**m-23 (Minor, DOC/coordinator):**

- `docs/phase-18-plan.md:32`: the 18D row still says "approval flags incl. `--approval-run-token=`", which contradicts rev 8 2e ("still never ships").
- The plan §6 `.gitignore` line omits `run/plans/`.
- Threat model §8: the 18B row lacks `neg-b06-permit-traceability` and `neg-plan-mode-scope`, and the 18D row lacks `neg-shard-protected-action`.
- `neg-d1-boot-identity` has three owners: 18A in the threat model, 18D in the plan, 18E/18D in rev 8.
- `OWNER-10`/`OWNER-11` are cited but absent from the ledger.

No CI approve path survives in the plan, threat model or AC. The threat model gates table is intact and extended.

## Hypotheses (unverified)

- **H-1:** WebSocket frames and service-worker-originated requests bypass the arming triple (partly SPIKE-W).
- **H-2:** some manifest entry permits a non-GET without arming, which would raise M-14's impact.

## Verdict per PR

- **18E: may start from the security side (0/0).** Conditions before merge:
  - the m-21 rewording and per-root allowlist if OD-20-Q1 is adopted;
  - the SEC-07 18E conditions.
- **18A: 0/0.** Merge requires the m-17 no-write test above.
- **18C: 0 blockers / 1 major (M-14).** Merge also requires m-20.
- **18B: 0 blockers / 1 major (M-14(c)).** Merge also requires m-20 and m-22.
- **18D/18F: 0 blockers / 1 major (M-13).** Merge also requires the OD-24-Q1 owner answer and m-22.
- **DOC: 0/0.** Merge requires m-23.

## Owner items (none accepted)

These stay open with the owner:

- OD-24-Q1
- OD-20-Q1
- OD-22-Q1 and OD-22-Q2
- OD-23-Q1
- the D11 provenance in the ledger
- the four D10 items that are not accepted
- every residual carried forward from re-review 6
