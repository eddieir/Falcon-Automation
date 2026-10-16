# Phase 18 architecture — revision 17 patch (ARCH-17): SEC-16 integration fixes and OWNER-13

Author role: Solution Architect (`claude-opus-5`). Base revision: `e7f372f` on `docs/phase-18-architecture` (architecture rev 2 plus the [rev 3](phase-18-rev3-patch.md) to [rev 16](phase-18-rev16-patch.md) patches). Purpose: close the SEC-16 findings in [`docs/security/phase-18-design-review-15.md`](../security/phase-18-design-review-15.md) — majors **M-19** and **M-20**, minors **m-53** to **m-58**, and the nits — as **integration fixes to rev 16**, and integrate owner decision **OWNER-13**.

**OWNER-12 (R-7 = Option C) is binding and is not reopened. OWNER-13 is binding and is integrated, not re-argued.** Rev 17 selects no new mechanism and accepts no residual.

**This patch is design only. Nothing in it authorises implementation, merge, tag, publication or deployment of any Phase 18 PR.**  Section numbering continues from rev 16: this patch is section **11**.

**Node v22.19.0 remains the only runtime for which any fact in rev 3 to rev 17 is established. Node 24 is UNVERIFIED (H-8), carried forward unchanged. Firefox and WebKit remain UNVERIFIED.** Rev 17 ran **no** runtime, browser or server probe. It made three read-only repository probes, recorded in 11j.0 and 11f.0; every other fact it relies on is already recorded in rev 3 to rev 16, SPIKE-R or SEC-16.

---

## 11.0 What rev 17 fixes, in one table

| SEC-16 finding | Rev 17 section | Disposition |
|---|---|---|
| M-19 (a) absence-of-path rule | 11a | Normative text added |
| M-19 (b) AC-098 scope | 11b | Rev 16's execution-flavoured clauses removed; AC-098 then **reassessed under OWNER-13** (11d.3) |
| M-19 (c) production writer | 11d | **DECIDED: OWNER-13. The production approval writer does not ship in Phase 18.** The whole production approval path is out of scope and deferred with execution |
| M-19 (d) discriminator ban | 11c | Normative text added |
| M-20 clause-level deferral | 11e | A3 verbatim, `phase` split, `pr` fix, annotations, computed count |
| m-53 exit codes | 11f | `policyRefusal: 18`, mandatory reason code, lostCoverage on exit 17, single CI/shard code, dead phrase dropped |
| m-54 AC-051 inversions | 11g | Two inversions specified |
| m-55 request-level backstop | 11h | Request-level rule, named `route.abort` measurement, three runtime cases, annotations reconciled |
| m-56 healing reclassification | 11i | Ordering rule plus test |
| m-57 walker action sites | 11j | Sink-scan rule; HealingBenchmark settled by probe (**hypothesis confirmed**) |
| m-58 banner extents | 11k | Explicit extents and corrected wording |
| Nits | 11l | All five fixed |
| Check 4 "not searched" | 11m | Repository-wide grep run; stale claims listed with dispositions |

---

## 11a. M-19(a) — the absence-of-path rule (NORMATIVE)

**11a.1 The rule.** *No production module under `src/`, `falcon.js` or `scripts/` contains a code path that routes, performs, continues, fulfils, emulates or otherwise completes a protected non-GET request against any origin, under any input, including a valid approval, a minted run token, a configuration value, an environment variable, a CLI flag, a manifest entry or any combination of them.* The property is the **absence of the code path**, not the ordering of a check. No ordering claim, and no refusal that runs "first", is accepted as a substitute.

**11a.2 Gate surfaces.** For a protected non-GET step or request, the production `PilotActionGate` exposes exactly one outcome — **refusal** — and the production `NetworkGate` exposes exactly one outcome — **abort**. Neither exposes, returns, accepts a callback for, or can be parameterised into, a continue/fulfil/perform outcome for that class. There is no "armed" state for a protected non-GET in production: 10a.3's ordering statement is retained as defence in depth, and 11a.1 is the security property.

**11a.3 Consequence for rev 16 text.** This supersedes any reading of 10a.2/10a.3 under which a protected non-GET could proceed if the refusal check were bypassed, reordered or exempted. 10b.1's "no dormant transport" and 10e's rejection of flag-disabled transport are restated here as a property of the module surface, not of control flow.

**11a.4 Verification (design-level, for QA and Security).**
- AC-084 walker: zero findings on the 18B/18C/18D/18F file sets, **no exemptions, no allowlist entries**.
- Static surface check: no `route.continue`, `route.fulfill`, `route.fetch`, `request.post|put|patch|delete|fetch` or equivalent non-GET sink exists in `src/` at all for the protected class — see the 11j.0 probe, which found **zero** such sinks in `src/` today; the check is therefore "still zero", which is mechanically decidable.
- Export-surface check: `PilotActionGate` and `NetworkGate` export no symbol whose result can be a continuation for a protected non-GET.
- **Dependency-reachability check (new, from OWNER-13):** the production require graph rooted at `falcon.js` and every `package.json` script reaches **no** file under `tests/`, no experimental fixture directory, and no approval-creation, approval-persistence or approval-consumption module. The check runs in CI and fails closed (11d.5).

---

## 11b. M-19(b) — the execution-flavoured clauses are removed from AC-098

These removals are required by M-19 regardless of OWNER-13, and are applied first; 11d.3 then reassesses what remains of AC-098.

**11b.1 Removals.** Deleted from the Phase 18 record: **"the replay case must pass a protected action"** (AC-098 inversion); the **exit-0 tests-only executable case** and the words "tests-only executable for exit 0 and exit 14" (traceability **D4**); **"armed NetworkGate"** and **"the approved half is proven in CI twice"** (AC-098 `components`, AC-074 `components`). Removing the exit-0 case removes no obligation: no criterion asserted execution that survives OWNER-12.

**11b.2 Inversion wording (if any approval-state-machine criterion survives in any phase).** `"Inversion: allow a second consumption and the replay-refusal assertion must fail."` This wording replaces the rev 16 text verbatim and carries forward to 18P with the deferred machinery.

**11b.3 Test level (if any such criterion survives).** `ApprovalStore`/resolver level only. Any transport needed to express a replay case lives **entirely under `tests/`**, is never required, imported or re-exported from `src/`, `falcon.js`, `scripts/`, a `package.json` script or a workflow, and targets the loopback-literal fixture.

---

## 11c. M-19(d) — no discriminator

There is **no** customer-versus-fixture discriminator in production code for the refusal decision. The refusal predicate may **not** read, branch on or be influenced by: a request or page **origin** (including `127.0.0.1`, `localhost`, `::1` or any loopback literal — the README quick-start runs customer applications on loopback), a **configuration** key, an **environment** variable, a **CLI flag**, `NODE_ENV`, `CI`, a manifest "fixture" marker, or a build mode. The separation is **structural**: anything non-production lives under `tests/` or a clearly marked experimental fixture directory and is unreachable from the production dependency graph (11a.4, 11d.5). The `Origin`-header rule of 10a.3 is unaffected: it may add refusals and may never permit (11l).

---

## 11d. M-19(c) — DECIDED: OWNER-13, no production approval path in Phase 18

### 11d.1 The decision, as binding text

**OWNER-13 (binding).** The production approval writer **does not ship in Phase 18**. Option C covers the **whole production approval path**, not only transport. Restated normatively:

1. Production code exposes **none** of the following: an approval-create or approval-mint CLI; a dashboard approval action for protected mutations; a production approval-writer API; an approval-token creation path; a protected-action approval ledger; approval **consumption** for customer execution; a dormant flag or environment variable that would enable any of these; any fallback to A″ or B″.
2. **Customer-facing behaviour is detection and refusal only.**
3. **Human approval and protected-action execution are deferred together**, as one item, to `18P-PROTECTED-NONGET`. Neither is a Phase 18 capability and neither is partially shipped.
4. **No dormant production security machinery is shipped to satisfy an internal criterion.** An internal criterion that can only be met by shipping such machinery is amended or deferred (11d.3).
5. Research and security analysis are **preserved as deferred design history, clearly marked unshipped and non-normative for Phase 18**. Nothing is silently deleted.

### 11d.2 Required explicit statements (normative, to be carried into every affected document)

- **Phase 18 refuses protected state-changing actions.** It does not execute them, and it does not approve them.
- **Human approval and protected-action execution are deferred together** to `18P-PROTECTED-NONGET`; shipping one without the other is not a Phase 18 option.
- **The existing locator-healing review feature is a different feature and is unchanged by OWNER-12 and OWNER-13.** Nothing in Phase 18 alters it.
- **"Approval" in healing documentation must not be confused with protected-action approval.** The healing docs' reviewer/approve wording refers to accepting a **locator-healing candidate** and has no relation to authorising a state-changing action. Every affected healing document and dashboard string gains a disambiguating sentence; the 10d prohibited-phrase check gains a rule that the bare word "approval" in a protected-action context must be qualified.

### 11d.3 AC-098 reassessed (owner's preferred option, adopted)

Rev 16's AC-098 was the approval state machine as internal evidence. Under OWNER-13 that machinery is deferred, so **AC-098 is rewritten in place** (not deleted, so the counts stay auditable) to the only obligation that remains a Phase 18 merge condition:

> **P18-AC-098 (rewritten; Must; 18D; verification U+R; `scope: non-reachability`).** No customer-facing or production path can reach any approval creation, persistence, consumption, replay or protected-action execution path, because none exists in production. Verified by: (i) the AC-084 walker with the 11j sink-scan rule and no exemptions; (ii) the production dependency-reachability check of 11a.4/11d.5, asserting that the require graph rooted at `falcon.js` and at every `package.json` script reaches no `tests/` file, no experimental fixture, and no approval module; (iii) an export-surface check that no production module exports an approval create, mint, persist or consume function; (iv) a runtime case that a protected non-GET step is refused with `POLICY_PROTECTED_ACTION_UNSUPPORTED` exit 18 with zero requests at the server and **no approval object, ledger entry, token or audit-approval record created anywhere**; (v) the prohibited-phrase and disambiguation checks of 10d and 11d.2. **Inversion:** add any production export that creates or consumes an approval, or any production require edge into `tests/` or the experimental fixture, and checks (i) to (iii) must fail.

The deferred half — approval **creation, persistence, consumption and replay** machinery, the eight-field binding, the single-consumption and replay-refusal evidence and the audit-chain completeness case — moves **unweakened** to `18P-PROTECTED-NONGET`, carrying the 11b.2 inversion wording and the 11b.3 test level.

### 11d.4 If a pure state-machine prototype is retained (permitted, not required)

A pure approval state-machine prototype may be retained for 18P design continuity **only** if all of the following hold, each independently checkable:

1. It lives entirely under `tests/` or a clearly named non-production experimental fixture directory.
2. It is **not imported** by `falcon.js`, by any file under `src/` or `scripts/`, by any `package.json` script, or by any workflow — directly or transitively.
3. It appears in **no** capability claim, release note, README, dashboard string, operator guide or marketing text.
4. It **does not count as shipped Phase 18 functionality** and is excluded from every Phase 18 capability statement and gate except the non-reachability checks of 11d.3.
5. **CI proves** that production dependency reachability cannot reach it (11d.5). The proof is a check, not an assertion.
6. It is labelled, in-file, `EXPERIMENTAL — NOT SHIPPED — non-normative for Phase 18`.

It is not a Phase 18 merge condition, and no Phase 18 criterion may depend on it.

### 11d.5 Dependency-reachability check (specification)

Rooted at `falcon.js` and every `package.json` script command, resolve the static CommonJS require graph (including dynamic `require` arguments that are string literals or template literals with literal prefixes; a non-resolvable dynamic `require` in `src/` fails the check). **Fail** if the graph contains: any path under `tests/`; any path under the experimental fixture directory; any file whose basename or directory matches the approval-module set (`approve-action`, `ApprovalStore`, `ApprovalRecord`, `AuditLog` *where it is the approval ledger*, `Binding`, `RunToken`, `RunTokenEmitter`, `LedgerLock`, approval-root helpers); or any occurrence of `--approve-action`, `--emit-token-to`, `PILOT_APPROVAL_RUN_TOKEN`, `PILOT_APPROVAL_RUN_TOKEN_FILE` in `src/`, `falcon.js`, `scripts/`, `package.json` or `.github/`. It runs in CI, is deterministic, and fails closed on an unresolvable edge. **Scope note for Developer:** `AuditLog` also serves the non-approval pilot audit chain; the check targets the approval ledger writer, and the shared audit-chain module stays in production with no approval-record shape.

### 11d.6 Decision cleanup — explicit reclassification per ADR, AC and open item

Everything below is **reclassified to `18P-PROTECTED-NONGET`, preserved in place, and marked unshipped and non-normative for Phase 18** unless the row says otherwise. Nothing is deleted; no history is rewritten.

| Item | Where | Disposition under OWNER-13 |
|---|---|---|
| **Interactive writer** `src/core/pilot/approval/approve-action.js` | plan 18D; rev 12 §6b; rev 13 §9 | **Deferred to 18P.** Removed from the 18D file set. Sections annotated per 11k. |
| `falcon.js --approve-action`, `--emit-token-to` | plan 18D; rev 3/4/8/9 | **Deferred.** Flags are not added; they become unknown flags (exit 1). The CI/non-interactive refusals (`approve_flag_in_ci`, `approve_flag_non_interactive`, `falcon_not_entry`, `key_carrier_flag`) are **vacuous for Phase 18**, retained as 18P text. |
| `RunToken`, `RunTokenEmitter`, `LedgerLock` | plan 18D; rev 3/4 | **Deferred.** Removed from the 18D file set. |
| **Approval-ledger filesystem policy** (approvals root, 0600 token file, admission rules) | OD-20 / OWNER-11; rev 4 | **Reclassified to 18P for the approval-specific clauses only.** The general filesystem-admission policy **stays live** for evidence, bundles and reports, which are shipped Phase 18 features. Annotate which clauses are which; do not defer the general policy. |
| **PTY production approval test** | rev 12 §6c; rev 13 §9a–9d; **AC-092** | **Deferred to 18P.** AC-092 `phase: "deferred-18P"`, `mergeCondition: false`, text unweakened. There is no human interface to exercise. |
| **Production approval brand / closure-held registry** | rev 11 §5; rev 12 §7; **AC-093** | **Deferred to 18P.** AC-093 constrained `ApprovalStore`, which does not ship. Text unweakened; it is a 18P entry requirement. |
| **Token consumption and replay** | rev 3 §; rev 8 3(c); rev 16 AC-098 | **Deferred to 18P** with the machinery (11d.3). Exit 14 survives **only** for the run-token-transport refusals of 11f.4, which remain live as defence in depth against a token presented to a build that cannot consume it. |
| **Production approval-root migration** | rev 4; rev 7 | **Deferred to 18P.** No approvals root is created, read or migrated in Phase 18. |
| **AC-090** (fixture authority structurally unavailable to production) | AC JSON | **Stays live and Must, retargeted**: it is now the structural-unavailability half of AC-098's non-reachability obligation and applies to any retained prototype (11d.4) as well as to `tests/` generally. If no prototype is retained it is satisfied vacuously **and still runs** as a check. |
| **AC-084** (no approve step in CI) | AC JSON | **Stays live and Must, strengthened**: the walker now fails on the **existence** of `--approve-action` or `--emit-token-to` anywhere under `src/`, `falcon.js`, `scripts/`, `package.json` or `.github/`, not merely on workflow reachability; plus 11j and 11d.5. Its CI case code becomes exit **18** (11f.4). |
| **ADR-0044** (fixture-scoped approvals) | ADRs | **AMEND to superseded-in-part**: `Superseded in part by OWNER-13. No production approval path — create, mint, persist, consume, replay or ledger — ships in Phase 18. The ledger brand, the no-registration surface, the eight-field binding and the fixture-authority boundary are preserved unweakened as entry requirements of 18P-PROTECTED-NONGET and are non-normative for Phase 18. AC-098 is rewritten as a non-reachability criterion; AC-092 and AC-093 are deferred.` |
| **ADR-0041** (CI may not approve) | ADRs | **AMEND**: `Vacuous for Phase 18 under OWNER-13, because no approval path exists to invoke in CI or anywhere else. Retained as an 18P entry requirement; AC-084 continues to enforce the stronger absence rule.` |
| **ADR-0045** (refusal of protected non-GET) | ADRs | **AMEND** per 11n B: extend to the whole approval path, add 11a.1, 11d.1 and 11d.2. |
| **ADR-0042**, **ADR-0043** | ADRs | As rev 16, plus the 11e.4 and 11i cross-references. |
| **m-51** (fixture genuine-server identity) | traceability, plan 18D, threat-model item 20 and the 18D gate row | **See 11d.7 — owner confirmation requested.** |
| **R-7, R-10, SPIKE-R, OD-23, OD-24-Q1** | open items | R-7 DECIDED (OWNER-12); OD-24-Q1 **moot** (no approved half exists to test); the rest as rev 16, except that the zero-transmission rows stay live (11h). |
| **Research and security analysis** (`docs/research/phase-18/`, rev 3–16 approval sections, SEC-03 to SEC-16 approval findings) | docs | **Preserved verbatim**, banner-annotated per 11k as deferred design history, unshipped, non-normative for Phase 18. |

### 11d.7 m-51 and the fixture identity conditions — honest disposition, owner confirmation requested

**What the owner earlier required:** m-51 was kept as a **mandatory 18D merge condition** because genuine-server identity checks matter to the **fixture approval boundary** — the fixture had to be provably a real loopback server rather than a stub, so that approval evidence obtained against it could not be fabricated.

**Honest assessment now:** that boundary is **deferred** with the approval machinery (11d.1, 11d.3). Nothing shipped in Phase 18 depends on the authenticity of a fixture **approval** authority, because there is no approval authority. Therefore:

- **m-51 and the rev 11–rev 15 fixture-identity assertions are marked DEFERRED to `18P-PROTECTED-NONGET` together with the approval machinery, and are no longer 18D merge conditions.** Their text is preserved unweakened as an 18P entry requirement.
- **Stated for owner confirmation:** this reverses the owner's earlier "m-51 stays mandatory for 18D" instruction, and it is reversed **only** because the thing m-51 protected is itself deferred. If the owner prefers to keep m-51 mandatory anyway — for example to keep the identity harness warm, or because a retained prototype (11d.4) will be exercised locally — say so and m-51 returns as an 18D condition at no design cost. **Until the owner confirms, the plan, traceability and threat model carry m-51 as `DEFERRED WITH THE APPROVAL MACHINERY — PENDING OWNER CONFIRMATION`, and no document asserts it as satisfied or as unnecessary.**
- **Not affected, and still live:** any genuine-server identity requirement that a shipped Phase 18 feature needs for its own reason — specifically the loopback fixture used by the AC-051 refusal and zero-transmission cases (11g, 11h) must still be a **real server that records what it receives**, otherwise the zero-transmission proof is vacuous. That obligation is restated as part of AC-051 rather than inherited from m-51, so deferring m-51 cannot weaken it. This is the one place where fixture authenticity remains a Phase 18 merge condition, and it is justified by zero-transmission ground truth, not by approvals.

---

## 11e. M-20 — deferred clauses must not read as live merge conditions

**11e.1 AC-086.** Apply the rev 16 **10f A3** AC-086 text **verbatim** (the deferral sentence *and* the retained window-validation sentence). Remove the stray literal token `deferred-18P` from the end of the `requirement` string. Replace the `phase-note` field with a **clause-level** split:

```json
"phase": "mixed",
"phaseClauses": {
  "deferred-18P": ["protected-action lease mint and consume", "redirect continuation", "one-transmission counter", "chainDeadlineMs"],
  "current": ["window validation: 250 ms minimum, 2000 ms default, 10000 ms maximum, out-of-range refused before browser launch, never clamped — in force only where a permitted-action (non-protected) lease exists"]
}
```

The window-validation clause is live **only** where a lease exists for a permitted non-protected action; it has no application to a protected non-GET, because no such lease is minted (11a.2).

**11e.2 AC-096, AC-097.** Set `pr: "18P"` **and** add `"mergeCondition": false`. (SEC-16 allows either; both are specified because `pr` is read by the plan and `mergeCondition` by the gate tooling, and a single change leaves the other reader stale.) The appended deferral text of rev 16 10f A3 is unchanged and unweakened.

**11e.3 Computed count.** `deferredUnderOptionC` is defined as: *the number of criteria carrying `phase: "deferred-18P"`, or `phase: "mixed"` with a non-empty `phaseClauses["deferred-18P"]`.* Under OWNER-12 plus OWNER-13 that set is exactly `["P18-AC-086","P18-AC-092","P18-AC-093","P18-AC-096","P18-AC-097"]`, so the value is **5**, not the 3 declared at `e7f372f`. An explicit `"deferredIds"` array with those five ids is added next to `counts`, and the check is a **set comparison** so that a filter cannot silently return a smaller number (the SEC-16 E2 failure). The field is renamed `deferredUnderOptionC` → **`deferredToPhase18P`** with a note naming both OWNER-12 and OWNER-13, because the deferral now has two causes; the old key is retained for one revision with the same value to avoid breaking a reader, and both must agree.

**11e.4 Annotations so no live row reads as a live condition.**
- **Traceability D7 row** — append: `Deferred with the gate: the lease tests neg-n2-arming (k)-(r), the one-transmission counter and the chainDeadlineMs cap for a protected request. "Direct non-redirecting protected requests remain" describes 18P, not Phase 18: in Phase 18 such a request is refused and aborted. Text retained unweakened as 18P-PROTECTED-NONGET input.`
- **Threat model section 8, 18B gate row** — annotate: `neg-n2-arming (k)-(r) redirect-continuation rows: DEFERRED (OWNER-12). Retained for 18B: the refusal and zero-transmission rows, including the repeated route.abort measurement named in rev 17 section 11h.2.`
- **Threat model section 8, 18D gate row** — annotate: `neg-n2-arming (k)-(r) and the chainDeadlineMs cap rows: DEFERRED (OWNER-12). The approval machinery rows, AC-092, AC-093 and m-51 are DEFERRED (OWNER-13; m-51 pending owner confirmation, rev 17 section 11d.7). Retained: AC-098 as rewritten (non-reachability), AC-090 and the dependency-reachability check.`
- **Plan 18C row** — the base text `must land either the verified handler path or the mandated route.fetch({maxRedirects:0}) fallback — the fallback is the default` is **named superseded**: `WITHDRAWN by OWNER-12. M1 and the route.fetch({maxRedirects:0}) fallback are not specified for Phase 18 in any form, including dormant or flag-disabled code. Neither is a default, a fallback or a merge condition. Both are inputs to 18P-PROTECTED-NONGET.`
- **Plan 18B row** — `neg-n2-arming (k)-(r): DEFERRED. Merge conditions retained: the refusal cases, the request-level abort rule of rev 17 section 11h and the repeated route.abort measurement.`
- **Plan 18D row** — the 11e.4 annotation plus the OWNER-13 file-set removals of 11d.6.

**11e.5 Nothing is weakened.** Every deferred text stays in its file, unedited except for the deferral annotation, as declared 18P input.

---

## 11f. m-53 — exit-code mapping

**11f.0 Probe (read-only).** The `exitCodes` contract in `docs/phase-18-acceptance-criteria.json` is: `internalError: 18`, `manifest: 10`, `authSetup: 11`, `authLoss: 12`, `policy: 13`, `approval: 14`, `planBinding: 15`, `identity: 16`, `safetyInvariant: 17`, `planInvalid: 2`. SEC-16 E6 is confirmed: there is **no** policy-refusal entry for 18, and 18's only label is `internalError`.

**11f.1 Label.** Add `"policyRefusal": 18` to `exitCodes`, with the contract note: `18 covers two disjoint classes — PILOT_INTERNAL_ERROR and by-design policy refusal (POLICY_PROTECTED_ACTION_UNSUPPORTED, POLICY_REDIRECT_UNOBSERVABLE, POLICY_PROTECTED_CROSS_ORIGIN_UNSUPPORTED, POLICY_PROTECTED_INITIATOR_UNSUPPORTED). No new exit code is introduced; OD-10 is unchanged. The two classes are distinguished only by the reason code.`

**11f.2 Reason code mandatory.** A **non-empty, enumerated reason code is mandatory** in the run report and the audit entry for every exit 18. An exit 18 without a reason code is itself a reporting defect that fails the 18C gate. The reason-code histogram of 10e covers both classes.

**11f.3 Rank masking (residual 21).** Under the rank order `2 > 3 > 18 > 17 > 16 > 15 > 13 > 12 > 11 > 14 > 10 > 1 > 0`, exit 18 masks 17 (reporter/safety) and 1. Therefore: **the `lostCoverage` summary is written on the exit-17 path as well as the exit-18 path**, and on exit 1, before the reporter's own failure is reported; it is emitted from the refusal accounting, not from the reporter's success path, so a reporter failure cannot suppress it. The report records both the ranked exit code and the full set of codes that occurred in the run. Residual 21's annotation is corrected per 11l(3).

**11f.4 Single code for CI and shards.** Rev 16 10a.2 item 3 kept exit **14** for the OD-23 shard and AC-084 CI cases "without a method-resolved customer dispatch". That phrase is **dropped as undefined**, and the mapping is unified: **a protected non-GET step in CI or in shard mode is refused with `POLICY_PROTECTED_ACTION_UNSUPPORTED` exit 18**, like every other protected non-GET step. Exit **14** survives only for **run-token-transport** refusals, which remain live as defence in depth even though nothing can consume a token: `APPROVAL_RUN_TOKEN_INVALID` / `run_token_in_shard_mode` (rev 8 3(c)), and a run-token transport presented in CI or in any mode. The AC-098 replay case that previously used 14 is deferred with the machinery (11d.3). Affected text: 10a.2 item 3; **AC-084 `components`** (`docs/phase-18-acceptance-criteria.json:737`, currently "asserts exit 14 as its expected outcome") → **exit 18**; **OD-23**; traceability **D3** (11l(5)); plan 18F row. Determinism: one code per cause, no mode-dependent branch, as AC-023 and the rank table require.

**11f.5 Exit 0.** Impossible on the refusal path (10a.2 item 6 and the rank order). Confirmed, restated, not re-derived.

---

## 11g. m-54 — the AC-051 inversion, specified as two

The single inversion `"remove the refusal and the case must record a request"` is **replaced** by two:

- **(i) Production inversion — step refusal removed only:** with the 10a step refusal disabled, the case must record a **`NetworkGate` abort of the non-GET request and zero hits at the application server**. This proves the request-level backstop of 11h exists and is independent of the step check.
- **(ii) Tests-only inversion — both layers removed, entirely under `tests/`:** with both the step refusal and the request-level abort disabled in a tests-only harness against the loopback fixture, the case must record **exactly one POST** at the fixture server. This proves the test can observe a transmission, so a passing zero-transmission assertion is not vacuous. It uses no production transport (11a.1) and no discriminator (11c), and the harness is subject to 11b.3 and 11d.4–11d.5.

Both inversions are named in the AC-051 `requirement` and in the traceability named-test map. AC-051 also carries the genuine-recording-server obligation of 11d.7.

---

## 11h. m-55 — the request-level backstop and its zero-transmission proof

**11h.1 Request-level rule (NORMATIVE, added to 10a).** *Independently of step classification and regardless of any lease, the `NetworkGate` aborts every non-GET request classified protected, and every non-GET request for which classification cannot be resolved, including requests Falcon did not originate: page-load and timer-driven `fetch`/`XHR`, form-submit navigations, `sendBeacon`, and any request issued while a permitted non-protected action holds a lease.* A lease never widens the rule: a permitted-action lease admits only the observed request class it was minted for, and never a protected non-GET. Abort is the only outcome available at this surface (11a.2).

**11h.2 Named merge condition (18C).** The **repeated hop-zero `route.abort` measurement** is retained **by name** as an 18C merge condition: at least **ten runs**, with **server-side transmission records** (not browser-side observation) showing **zero** transmissions for the aborted non-GET request, on Node v22.19.0/Chromium. SEC-16 is right that the only current evidence is SEC-15 V11 (12 incidental requests, single run, Chromium); V11 is **not** sufficient and is not treated as proof. Firefox/WebKit remain UNVERIFIED and are not gated here.

**11h.3 AC-051 runtime cases (added).** (a) a page-load or timer-driven JS `fetch` POST; (b) a form-submit navigation POST arising as a side effect of a **permitted** click; (c) a POST issued during a permitted action's lease window. Each asserts: the request aborted at hop zero, **zero** server-side records, the run not exit 0, and the step/page accounted in `lostCoverage`. Case (b) additionally asserts that the permitted click is not retroactively refused — the request is aborted, the step outcome is recorded with its reason code, and coverage loss is reported.

**11h.4 Annotations reconciled.** Owner-decisions **residual 15** is re-annotated: `Not "no Phase 18 trigger". Leases remain for permitted non-protected actions, so the lease-window request classes of rev 17 section 11h remain live and are covered by the request-level abort rule and the named route.abort measurement. The protected-action lease clauses are deferred. Nothing newly accepted.` **Threat model section 8, 18C row** is corrected: it currently defers "the M-17, M-18 and SPIKE-R rows" **as a whole**, contradicting 10b.1 and m-52; replace with: `M-17, M-18 and the SPIKE-R extension rows are deferred EXCEPT every row that proves refusal or zero transmission, which is retained as a Phase 18 merge condition — specifically the repeated hop-zero route.abort measurement of rev 17 section 11h.2.` The m-52 traceability row gains the same exception wording so the two cannot drift.

---

## 11i. m-56 — healing reclassification ordering

Under **neg-c02** a step classified non-protected at plan time can become protected after a heal, by which time the provider has already been called, so the 10a.2 "no provider invocation" obligation cannot hold for that step as written. Rev 17 states the ordering:

1. A healed candidate is **re-classified before any action is attempted**, using the same `ActionClassifier` and the same closed positive permit set (10a.1). A healed locator never inherits "permitted" from the pre-heal step.
2. If the re-classification is **protected** and the resolved method is non-GET, the step is **refused before the action** with `POLICY_PROTECTED_ACTION_UNSUPPORTED` exit **18**. No click, fill, submission or request occurs.
3. The **provider call that already happened is audited** — provider id, invocation id, token accounting, `reclassifiedProtected: true` — and the 10a.2 negative obligation is restated for this path as: *no provider invocation occurs **after** the protected verdict, and no second provider call is made for the refused step.* The pre-heal call is disclosed, not hidden.
4. The **healed candidate is neither persisted nor proposed**: no write to any locator or healing store (OD-17-Q1), no healing-evidence record beyond the audit entry, no dashboard proposal, no inclusion in a locator update bundle. (This is the locator-healing review feature of 11d.2, which is otherwise unchanged; the candidate is withheld from it, not approved or rejected by it.)
5. **Test (new, named `neg-heal-reclassified-protected`, 18C merge condition):** a step that heals from a non-protected to a protected non-GET action yields exit 18, zero server requests, one audited provider call with `reclassifiedProtected: true`, and a byte-identical locator/healing store before and after. Inversion: persist the healed candidate and the store-digest assertion must fail.

---

## 11j. m-57 — the walker finds action sites by scanning, not from a list

**11j.0 Probe (read-only, `src/` only; settles the SEC-16 hypothesis).** A grep of `src/` for Playwright action and request sinks found action sites in **eleven** files, ranked by occurrence: `src/core/locator/HealingBenchmark.js` (9), `src/core/AIHealer/AIHealer.js` (7), `src/core/TestRunner.js` (4), `src/core/parallel/ParallelSweep.js` (3), `src/core/ClickExplorer.js` (3), `src/core/parallel/ParallelDiscovery.js` (2), `src/core/SiteSweep.js` (2), `src/core/PageAnalyser.js` (2), `src/core/locator/ElementFactsCollector.js` (1), `src/core/llm/transport/EndpointPolicy.js` (1), `src/core/DOMIssueScanner.js` (1).

- **The owner's HealingBenchmark question is settled: it is a real action site.** `src/core/locator/HealingBenchmark.js:308-310` performs `target.fill(...)`, `target.selectOption(...)` and `target.click(...)` against a live page, and `:366` calls `page.evaluate`. Whether it is reachable in **pilot** mode is still UNVERIFIED (no runtime probe), which is exactly why the walker must not rely on a reachability judgement.
- The plan's 18B fixed list (AIHealer ×4, ClickExplorer, SiteSweep, ParallelDiscovery) **misses at least six files**: `HealingBenchmark.js`, `ParallelSweep.js`, `TestRunner.js`, `PageAnalyser.js`, `DOMIssueScanner.js`, `ElementFactsCollector.js`. SEC-16's m-57 is upheld on evidence, not hypothesis.
- A grep for **request/route sinks** (`page.route`, `context.route`, `route.continue|fulfill|fetch|abort`, `request.get|post|put|patch|delete|fetch`) in `src/` returned **zero matches**. Today `src/` contains **no** transport sink at all, which makes the 11a.4 static check a "still zero" assertion and makes any future sink a diffable event.

**11j.1 Rule (replaces the fixed list in plan 18B and in AC-084).** The AC-084 walker **discovers** action sites by scanning every file under `src/`, `falcon.js` and `scripts/` for Playwright action and request sinks — at minimum `click`, `dblclick`, `fill`, `type`, `press`, `check`, `uncheck`, `selectOption`, `setChecked`, `hover`, `tap`, `dragTo`, `focus`, `blur`, `dispatchEvent`, `setInputFiles`, `evaluate`, `evaluateHandle`, `goto`, `reload`, `goBack`, `goForward`, `waitForNavigation`, `page.route`, `context.route`, `route.continue`, `route.fulfill`, `route.fetch`, `route.abort`, and any `request.*` method — on a `page`, `frame`, `locator`, `elementHandle`, `context` or `apiRequestContext` receiver, including aliased receivers and dynamic property access (`page[name](...)`).

**11j.2 Fail-closed.** Any discovered site not routed through `PilotActionGate` (actions) or `NetworkGate` (requests) **fails the walker**. The walker has **no fixed allowlist of modules** and **no exemption**; a site excluded as unreachable in pilot mode must be excluded by a structural property the walker can check (not reachable from the pilot entry graph), recorded per site, and re-checked on every run. A sink the walker cannot resolve fails closed.

**11j.3 Plan and AC edits.** Plan 18B's fixed site list becomes `the sink-scan rule of rev 17 section 11j (no fixed list); the rev 17 section 11j.0 scan is the current, non-authoritative snapshot`. AC-084 gains the 11j.1/11j.2 sentences. **Note for Developer:** this is a scope increase for 18B relative to rev 16 — at least six additional modules must be gated or structurally excluded — and it is a merge condition, not a best effort.

---

## 11k. m-58 — banner extents (and corrected wording)

Each superseded/deferred banner gains an **explicit extent** and loses the unbounded phrase "the text below ... is not a Phase 18 requirement".

- **Rev 15 patch, before section 9a (line ~26):** `DEFERRED by OWNER-12 (rev 16 section 10b.1). **Extent: section 9a only (9a.1 and 9a.2), including the 9d SPIKE-R rows that section 9a introduces — except the zero-transmission rows, which are retained (rev 17 section 11h.2).** Sections 9b and 9c remain NORMATIVE for 18D (fixture authenticity) except as re-scoped by rev 17 section 11d.7. Text retained unweakened as 18P-PROTECTED-NONGET input; not deleted.`
- **Rev 15 patch, before section 9e (line ~146):** `SUPERSEDED by OWNER-12: Option C was selected from the options presented here. **Extent: section 9e only.** Retained as 18P input.`
- **Rev 14 patch, before section 8a (line ~40):** `DEFERRED by OWNER-12. **Extent: section 8a only.** Sections 8b and 8c remain NORMATIVE (F18 to F23 live). Retained unweakened as 18P input.`
- **Rev 13 patch, both sites (~212, ~239):** same form, each naming its own single section as the extent and the adjacent sections that remain normative.
- **Rev 12 sections 6b, 6c and rev 13 section 9 (writer):** `DEFERRED by OWNER-13: no production approval path ships in Phase 18. **Extent: section 6b and 6c only** (rev 13: section 9 only). The ApprovalStore ledger-brand requirements of rev 11 section 5 and rev 12 section 7 are likewise deferred with the machinery (rev 17 section 11d.6) and are non-normative for Phase 18. This is preserved design history, unshipped; nothing is deleted and no history is rewritten.`
- **`docs/research/phase-18/` and every approval section of rev 3 to rev 16:** the same form, marked `preserved design history — unshipped — non-normative for Phase 18`.

Every banner states: its extent; which adjacent sections remain normative; that the text is retained unweakened as 18P input; and that nothing is deleted and no history is rewritten. Banners remain inline, which SEC-16 confirmed is the correct placement.

---

## 11l. Nits (all five)

1. **Threat-model item number.** The new lost-coverage item is **26** in the file; rev 16 10f C called it 27. The item is **26**; every citation is corrected to 26. No item is renumbered.
2. **Plan 18P heading.** Remove the duplicated title: `18P-PROTECTED-NONGET (deferred, not scheduled, not authorised)`.
3. **Owner-decisions residuals 4 and 21.** Residual **4**: `Open and unchanged. A state-changing GET on an allowed route still depends on manifest authoring (rev 16 section 10g flag 4). Option C does not close it and nothing here accepts it. "No Phase 18 trigger" is withdrawn as inaccurate for this residual.` Residual **21**: `Extended: the rank order also lets exit 18 mask 17 and 1 (rev 17 section 11f.3). Mitigation: lostCoverage is written on the 17 and 1 paths and the report records every code that occurred. Not accepted.` Residual **15** per 11h.4. Residual 26 unchanged.
4. **Origin rule (10a.3).** Annotate: `At step-level refusal there is no request yet, so the Origin rule has nothing to act on; it can only add refusals at the request level (rev 17 section 11h.1), where a protected or unresolvable non-GET request is aborted. It is never a basis for permitting, at either level.`
5. **Traceability D3 row.** Replace the `zero-POST half` citation with `AC-083 and AC-051 as rewritten (refusal before transmission, zero requests at the server)`, and align the shard code with 11f.4: **exit 18** for a protected non-GET step in shard mode; exit 14 only for a run-token transport presented in shard mode.

---

## 11m. Repository-wide stale-claim grep (SEC-16 check 4 "not searched")

A repository-wide `git grep` over `docs/` and `README.md` for `approved protected submit`, `approved half`, `two-command approval`, `approve-action`, `--emit-token-to`, `approval unlocks`, `executes approved` was run (security reviews excluded as reviewer text). **Live documents are corrected; superseded patches and research are banner-annotated, never rewritten.**

| Site | Text | Disposition |
|---|---|---|
| `docs/architecture/phase-18-authenticated-pilots.md:406` | `CSRF case (AC-051): an approved protected submit executes with the token the page itself issued in-run` | **CORRECT in place**: `CSRF case (AC-051, rewritten by rev 16 section 10c under OWNER-12): the submit is classified protected and REFUSED before transmission with POLICY_PROTECTED_ACTION_UNSUPPORTED exit 18; zero requests of any method reach the application server; no approval is created or consumed, and under OWNER-13 no production approval path exists to create one.` |
| `docs/architecture/phase-18-authenticated-pilots.md:307` | `--approve-action` / `mintRunToken` / token-printing paragraph | **Banner-annotate as deferred (OWNER-13)**: unshipped, non-normative for Phase 18, preserved as 18P input. |
| `docs/research/phase-18/proposed-scope-and-criteria.md:100` | `P18-AC-051 | M | CSRF-protected form: approved protected submit succeeds with in-run token ...` | **Annotate, do not rewrite research**: `SUPERSEDED by OWNER-12 and OWNER-13: AC-051 now requires refusal before transmission with zero requests at the server, and no production approval path ships. Retained as the research record, non-normative for Phase 18.` |
| `docs/phase-18-plan.md:34` (DOC row) | `operator-guide.md (two-command approval workflow and run token handling)` | **DELETE and REPLACE** (OWNER-13): `operator-guide.md (protected state-changing actions are detected and refused; no approval workflow, approval CLI, approval ledger or run token ships in Phase 18; human approval and protected-action execution are deferred together to 18P-PROTECTED-NONGET; the locator-healing review feature is a separate, unchanged feature and its use of the word "approval" is not protected-action approval).` |
| `docs/phase-18-plan.md:32` (18D row) | approval flags, `RunToken` | **Remove the approval writer, the flags and `RunToken`/`RunTokenEmitter`/`LedgerLock`** per 11d.6; keep the non-approval 18D scope; add the 11e.4 annotation. |
| `docs/phase-18-decision-traceability.md:12` (D4) | `... AC-051 approved half ... tests-only executable for exit 0 and exit 14` | **CORRECT**: delete "approved half" and the exit-0 clause; cite `AC-098 as rewritten (non-reachability, rev 17 section 11d.3)`; CI code exit **18** (11f.4). |
| `docs/phase-18-decision-traceability.md:46` | `D4 makes AC-051's approved half untestable in CI` | **Annotate**: `Moot under OWNER-12 and OWNER-13: AC-051 has no approved half and no production approval path exists. OD-24-Q1 is closed by scope reduction; AC-074's zero-skip rule is satisfied because no approval-execution case exists to skip.` |
| `docs/phase-18-acceptance-criteria.json:737` (AC-084 `components`) | protected step `asserts exit 14 as its expected outcome` | **CORRECT to exit 18** (11f.4). |
| `docs/phase-18-acceptance-criteria.json:933` (AC-098 `components`) | `the approved half is proven in CI twice ... armed NetworkGate` | **REPLACE** per 11b.1 and 11d.3. |
| AC-074 `components` | `the AC-051 approved half runs inside the normal regression gate` | **CORRECT**: `the AC-051 refusal case and its two inversions (rev 17 section 11g) run inside the normal regression gate; no approval-execution case exists`. |
| `docs/phase-18-acceptance-criteria.json:865` (AC-090), `:889`/`:890` (AC-093), `:897` (AC-092) | fixture-authority and ledger-brand text | Per 11d.6: AC-090 live and retargeted; AC-092 and AC-093 deferred, text unweakened. |
| rev 3 `:217`/`:221`/`:301`/`:400`, rev 4 `:233`/`:332`/`:352`, rev 6 `:75`/`:94`, rev 8 `:38`/`:48`/`:51`/`:139`/`:148`/`:191`/`:251`, rev 9 `:86`/`:102`/`:111`/`:152`/`:170`/`:179`/`:192`/`:206`/`:222`, rev 10 `:27`/`:67`/`:85`/`:93`/`:187`/`:188`/`:192`/`:206`/`:219`/`:222`/`:255`, rev 11 `:45`/`:149`/`:153`/`:170`, rev 12 `:73`/`:74`/`:83`–`:85`/`:134`/`:141`/`:147`/`:153`/`:203`/`:239`/`:275`/`:276`/`:288`/`:336`/`:358`, rev 13 `:99`/`:100`/`:105`/`:207`/`:326` | writer, flags, token, ledger, brand, "approved half" | **BANNER-ANNOTATE ONLY** per 11k, extent-bounded, naming OWNER-12 and OWNER-13. **No history is rewritten.** |
| `docs/phase-18-decision-traceability.md:150`, `:174` | writer/registry conditions (m-34, m-40) | **Reclassify to 18P** per 11d.6 with the condition text preserved. |
| Healing documentation and dashboard strings using "approve"/"approval" for locator candidates | `docs/` and `src/dashboard/index.html` | **Add the 11d.2 disambiguation sentence.** The healing review feature is unchanged; only the wording is clarified. |
| `README.md` | — | Clean (SEC-16 E11, re-confirmed). |
| `docs/ARCHITECTURE.md`, `docs/phase-18-spike-r-findings.md`, ADR files | no match for the searched phrases | Clean for these phrases. The grep did **not** cover prose implying execution without these literals; the 10d prohibited-phrase check plus the 11d.2 disambiguation rule remain standing DOC merge conditions. |

---

## 11n. Exact edit list (style of rev 16 section 10f)

### A. `docs/phase-18-acceptance-criteria.json`

**A1. Metadata**
- `designRevision`: `"e7f372f (architecture rev 2 plus rev 3..rev 17 patches)"`.
- `counts`: **unchanged at** `{"total": 98, "must": 89, "should": 6, "could": 3}`. **Recomputation:** rev 17 adds **no** criterion and deletes **none**. AC-051, AC-074, AC-084, AC-086, AC-090, AC-098 are edited in place; AC-092, AC-093, AC-096, AC-097 are **re-phased**, which changes no count. → **98 / 89 / 6 / 3**, unchanged. Re-phasing is not deletion: deferred criteria remain in the file and in the totals.
- **`deferredToPhase18P`: 5**, with `"deferredIds": ["P18-AC-086","P18-AC-092","P18-AC-093","P18-AC-096","P18-AC-097"]` and the computation rule of 11e.3; the legacy key `deferredUnderOptionC` is retained for one revision with the same value **5**, and the check asserts both agree. `deferredUnderOptionC: 3` at `e7f372f` is **wrong after OWNER-13** and is corrected here.
- `exitCodes`: add `"policyRefusal": 18` with the contract note of 11f.1.

**A2. `openItems`**
- **New `OWNER-13` (DECIDED)** — `state`: the five binding clauses of 11d.1, the explicit statements of 11d.2, the AC-098 reassessment of 11d.3, the prototype conditions of 11d.4 and the reclassification table of 11d.6. `"status": "DECIDED (owner); integrated by rev 17"`.
- **New `OWNER-13-Q1` (OPEN)** — `state`: the m-51 disposition of 11d.7, awaiting owner confirmation. `"status": "OPEN — owner confirmation requested; m-51 carried as DEFERRED PENDING CONFIRMATION in the meantime"`.
- `18P-PROTECTED-NONGET` — append: `Under OWNER-13 it additionally carries the whole production approval path: the rev 12 section 6b/6c interactive writer, the rev 13 section 9 hardening, the --approve-action and --emit-token-to flags, RunToken, RunTokenEmitter, LedgerLock, the approvals root and its migration, the approval-ledger filesystem clauses of OD-20/OWNER-11, the closure-held ledger brand, token consumption and replay, AC-092, AC-093, m-51 and the fixture-identity assertions, and the approval state machine formerly carried by AC-098.`
- `OD-24-Q1` — `"status": "MOOT (OWNER-12 + OWNER-13)"` with the 11m wording.
- `R-7` (DECIDED, OWNER-12), `R-8`, `R-9`, `R-10`, `H-7`, `H-8`, `SPIKE-R` — unchanged. Rev 17 accepts nothing on them.

**A3. Changed criteria**
- `P18-AC-051` — append the two inversions of 11g, the three runtime request cases of 11h.3, the request-level abort rule reference (11h.1) and the genuine-recording-server obligation of 11d.7. `pr` `"18C"`, `verification` `"R"` unchanged.
- `P18-AC-074` — `components` per 11m.
- `P18-AC-084` — append the sink-scan and fail-closed sentences (11j.1/11j.2), the no-exemption sentence (11a.4), and the flag-existence clause of 11d.6; `components` exit **18** per 11f.4.
- `P18-AC-086` — rev 16 10f A3 **verbatim**; delete the stray `deferred-18P` token; `phase: "mixed"` plus `phaseClauses` (11e.1).
- `P18-AC-090` — **live, Must**, retargeted per 11d.6 (structural unavailability of `tests/` and of any retained prototype).
- `P18-AC-092` — `phase: "deferred-18P"`, `pr: "18P"`, `mergeCondition: false`; text unweakened.
- `P18-AC-093` — `phase: "deferred-18P"`, `pr: "18P"`, `mergeCondition: false`; text unweakened.
- `P18-AC-096`, `P18-AC-097` — `pr: "18P"`, `mergeCondition: false` (11e.2).
- `P18-AC-098` — **rewrite in place** to the non-reachability criterion of 11d.3 (`scope: "non-reachability"`, Must, 18D, `U, R`), with its stated inversion. Its deferred state-machine text moves verbatim into the `18P-PROTECTED-NONGET` open item, carrying the 11b.2 inversion and the 11b.3 test level. The phrases removed in 11b.1 do not survive anywhere as live text.
- **New test references only (no new criteria):** `neg-heal-reclassified-protected` (11i.5), the three AC-051 request-level cases, the two AC-051 inversions, the named repeated `route.abort` measurement, the dependency-reachability check (11d.5). None changes `counts`.

### B. ADRs
- **AMEND ADR-0045** — append: `Rev 17 restates the security property as the absence of a code path (11a.1) and extends Option C, per OWNER-13, to the entire production approval path: no approval create/mint CLI, no dashboard approval action for protected mutations, no production approval-writer API, no token creation, no protected-action approval ledger, no approval consumption, no dormant flag or environment variable enabling them, and no fallback to A-double-prime or B-double-prime. Customer behaviour is detection and refusal only. Human approval and protected-action execution are deferred together to 18P-PROTECTED-NONGET. Refusal applies at request level regardless of any lease (11h.1). Exit 18 is labelled both internalError and policyRefusal with a mandatory reason code (11f). No discriminator on origin, configuration, environment or flag is permitted (11c). The locator-healing review feature is unaffected, and "approval" in healing documentation is not protected-action approval (11d.2).`
- **AMEND ADR-0044**, **AMEND ADR-0041** — texts in 11d.6.
- **ADR-0042** — the 11e.4 deferral wording plus the Origin note of 11l(4). **ADR-0043** — unchanged plus the 11i cross-reference.
- **No new ADR.** OWNER-13 is recorded as an amendment to ADR-0045 plus the ADR-0044/0041 supersessions, because it narrows an existing accepted decision rather than introducing a new mechanism. **Short ADR text, if the owner prefers a standalone record:** *ADR-0046 — "Phase 18 ships no production approval path". Context: under OWNER-12 no approval can authorise a protected non-GET, so a shipped approval path would be dormant security machinery whose only effect is a false affordance and an unproven promotion target. Decision (OWNER-13): no production approval create, mint, persist, consume, replay, ledger, CLI or dashboard action ships in Phase 18; human approval and protected-action execution are deferred together to 18P-PROTECTED-NONGET. Consequences: AC-098 becomes a non-reachability criterion; AC-092 and AC-093 are deferred; m-51 is deferred pending owner confirmation; the writer, flags, token, ledger and brand work of rev 3 to rev 13 is preserved as unshipped design history; a CI dependency-reachability check proves production cannot reach any approval or fixture code.*

### C. `docs/security/phase-18-threat-model.md`
- **item 20** — append: `Rev 17 (OWNER-13): no production approval authority exists in Phase 18. The fixture approval authority and m-51 are deferred with the machinery (rev 17 sections 11d.6 and 11d.7; m-51 pending owner confirmation). The residual this item described has no Phase 18 trigger because the subsystem is not shipped, not because a control was added. Nothing is newly accepted.`
- **item 22** — append: `Rev 17 (OWNER-13): the production interactive approval prompt is not shipped in Phase 18; deferred to 18P-PROTECTED-NONGET with its hardening text preserved.`
- **item 26** (the lost-coverage item; **not** 27 — 11l(1)) — append the exit-17/exit-1 `lostCoverage` obligation of 11f.3.
- **new item 27** — `27. **A healed candidate that becomes protected (rev 17 section 11i).** Control: re-classification before any action, refusal with POLICY_PROTECTED_ACTION_UNSUPPORTED exit 18, the prior provider call audited with reclassifiedProtected, and the candidate neither persisted nor proposed; test neg-heal-reclassified-protected. Not accepted as a risk.`
- **new item 28** — `28. **Requests that are not steps (rev 17 section 11h).** Control: the request-level abort rule of 11h.1 and the named repeated route.abort measurement of 11h.2 (>=10 runs, server-side records) as an 18C merge condition. Residual: measured on Chromium/Node v22.19.0 only.`
- **new item 29** — `29. **Non-production code entering the production dependency graph (rev 17 sections 11d.4 and 11d.5).** A tests-only or experimental approval prototype could be reached by a stray require, a package.json script or a dynamic require. Control: the CI dependency-reachability check, which fails closed on an unresolvable edge, plus AC-090 and AC-098 as rewritten. Not accepted as a risk.`
- **section 8 gates table** — 18B, 18C and 18D rows per 11e.4 and 11h.4; 18D loses the approval-machinery rows and m-51 (pending confirmation) and gains AC-098 as rewritten, AC-090 and the dependency-reachability check; DOC gains the 11m DOC wording, the 10d additions and the 11d.2 disambiguation rule.
- **section 9** — append: `Rev 17 closes SEC-16 M-19, M-20 and m-53 to m-58 by integration, with OWNER-13 deciding M-19(c) by removing the production approval path. One owner confirmation is open: the m-51 disposition (rev 17 section 11d.7). Carried open and unchanged: m-21, m-23, m-24, m-26, m-27, m-28, m-30, H-1, H-3, H-7, H-8, R-8, R-9, residuals 4, 13, 15, 21, 24, 25, 26. Nothing here risk-accepts them.`

### D. `docs/phase-18-decision-traceability.md`
- **D3** per 11l(5); **D4** per 11m; **D7** per 11e.4.
- **m-51 row** — `DEFERRED to 18P-PROTECTED-NONGET with the approval machinery (OWNER-13); PENDING OWNER CONFIRMATION (rev 17 section 11d.7). The genuine-recording-server obligation for the zero-transmission cases is restated in AC-051 and is unaffected.`
- **m-52 row** — the refusal/zero-transmission exception wording of 11h.4.
- **m-34, m-40 rows** — reclassified to 18P per 11d.6, condition text preserved.
- **New row OWNER-13** — decision, design sections 11a to 11d, ACs (AC-084, AC-090, AC-092, AC-093, AC-098), ADR-0045 amended plus ADR-0044/0041 superseded in part, tests (the dependency-reachability check, the export-surface check, the AC-051 refusal cases, the prohibited-phrase and disambiguation checks).
- **New row OWNER-13-Q1 (OPEN)** — the m-51 question.
- **Unsound-or-underspecified list — new items 36 to 40**: 36, rev 16's AC-098 inversion required passing a protected action and D4 required a tests-only executable reaching exit 0, together implying a production transport exemption (SEC-16 M-19); corrected in 11b. 37, deferred clauses were left as live normative text with `pr: 18C` (M-20); corrected in 11e. 38, the plan's fixed action-site list omitted at least six `src/` modules including `HealingBenchmark.js`, which performs `fill`, `selectOption` and `click`; corrected in 11j. 39, exit 18 was labelled only `internalError` and the CI/shard code was undefined (m-53); corrected in 11f. 40, rev 16 kept a production approval mint whose output nothing could consume — dormant security machinery retained to satisfy an internal criterion; corrected by OWNER-13 and 11d.
- **Named-test map** — add every test named in 11d.3, 11d.5, 11g, 11h.2, 11h.3 and 11i.5; mark the approval state-machine, PTY and brand cases **deferred**.

### E. `docs/phase-18-owner-decisions.md`
- **Status line** — append: `Rev 17 integrates the SEC-16 findings and owner decision OWNER-13: no production approval path ships in Phase 18. Phase 18 refuses protected state-changing actions; human approval and protected-action execution are deferred together to 18P-PROTECTED-NONGET. The locator-healing review feature is a different feature and is unchanged. One owner confirmation is open: the m-51 disposition (rev 17 section 11d.7). Design revision: architecture rev 2 plus patches rev 3 to rev 17.`
- **New item OWNER-13 (DECIDED)** — the five clauses of 11d.1 verbatim in substance, the explicit statements of 11d.2, and the reclassification table of 11d.6 by reference.
- **New item OWNER-13-Q1 (OPEN)** — the m-51 question of 11d.7, stating what the owner earlier required and why the architecture now proposes deferral.
- **Residual list** — residuals 4, 15, 21 per 11l(3) and 11h.4; nothing newly accepted, nothing deleted.

### F. `docs/phase-18-plan.md`
- `:3` status line — append: `Rev 17 closes SEC-16 M-19, M-20 and m-53 to m-58. Owner decision OWNER-13 removes the entire production approval path from Phase 18: no approval CLI, dashboard approval action, writer API, token creation, protected-action ledger, consumption or dormant enabling flag; customer behaviour is detection and refusal only; human approval and protected-action execution are deferred together to 18P-PROTECTED-NONGET. 18D loses the approval writer, the approval flags, RunToken, RunTokenEmitter, LedgerLock, AC-092, AC-093 and (pending owner confirmation) m-51, and gains AC-098 as a non-reachability criterion plus the CI dependency-reachability check. 18B grows: the AC-084 walker discovers action sites by scanning src/ for Playwright sinks (rev 17 section 11j) rather than from a fixed list, adding at least six modules. 18C gains the request-level abort rule, three request-level AC-051 cases, neg-heal-reclassified-protected and the named repeated route.abort measurement. Implementation remains blocked pending SEC-17 on the rev 17 delta, the m-51 owner confirmation, SPIKE-W, SPIKE-FS, the persistence-test PR, green main, the Node 24 position (H-8, UNVERIFIED) and explicit owner authorisation.` and `rev 3..rev 16 patches` -> `rev 3..rev 17 patches`.
- **18B row** — the 11j.3 replacement; `neg-n2-arming (k)-(r)` deferred (11e.4); refusal and zero-transmission rows kept.
- **18C row** — M1 and `route.fetch({maxRedirects:0})` **named withdrawn** (11e.4); add the request-level abort rule, the three AC-051 request cases, `neg-heal-reclassified-protected` and the named `route.abort` measurement (>=10 runs, server-side records).
- **18D row** — per 11m and 11d.6: remove `approve-action.js`, the `falcon.js` approval flags, `RunToken`, `RunTokenEmitter`, `LedgerLock`; keep the non-approval scope; add AC-098 as rewritten, AC-090 and the dependency-reachability check; carry `m-51: DEFERRED PENDING OWNER CONFIRMATION`; H-8 still gates merge.
- **18F row** — exit 18 per 11f.4; the walker's no-exemption rule; the dependency-reachability check.
- **DOC row** — `:34` replaced per 11m, plus the 10d prohibited-phrase additions (`"two-command approval workflow"`, `"approval unlocks"`, `"approve and then run"`, `"approved action runs"`), the 11d.2 disambiguation rule for healing docs, the banner-extent annotations of 11k, and the repository-wide claims grep as a standing DOC merge condition.
- **18P section** — heading de-duplicated (11l(2)); contents extended with the whole approval path per 11d.6 and A2.
- **section 6** — append: `, and adding any production approval create, mint, persist, consume or ledger path, or re-adding the approval CLI or a dashboard approval action for protected mutations, reverses OWNER-13 and requires a fresh owner decision and a fresh Security review.`

### G. Operational guide drafts
`docs/pilot/operator-guide.md` — the approval workflow section is **replaced** by `Protected state-changing actions (detection and refusal)`, containing: what is refused and when; the `POLICY_PROTECTED_ACTION_UNSUPPORTED` reason code and exit **18** with the double-label note (11f.1); the `lostCoverage` summary and where to read it; the explicit statements of 11d.2, including that no approval mechanism exists in Phase 18 and that the healing review feature's "approval" is unrelated; and the permitted claims of 10d. `docs/pilot/limitations.md` — add the deferral of protected non-GET execution **and** of human approval as one item. No operator document describes, implies or links an approval workflow.

---

## 11o. Flags (nothing is silently resolved)

1. **One owner confirmation is open:** the m-51 disposition (11d.7). It is carried as deferred-pending-confirmation and is asserted neither satisfied nor unnecessary.
2. **11j is a scope increase for 18B**, discovered by probe: at least six `src/` modules beyond rev 16's list contain action sites, and `HealingBenchmark.js` performs real `fill`/`selectOption`/`click`. Pilot-mode reachability is **UNVERIFIED**; the walker fails closed rather than relying on a reachability judgement.
3. **`src/` currently contains no route or request sink at all** (11j.0), which makes the 11a.4 static check cheap today and any future sink a visible diff. It is a property of the current tree, not a guarantee.
4. **Exit 18 is double-labelled.** `internalError` and `policyRefusal` share a code, discriminated only by the mandatory reason code (11f.2). An operator reading exit codes alone cannot distinguish a by-design refusal from an internal error; a new code was judged worse (OD-10, rank-table churn). Security may disagree.
5. **Rank masking is mitigated, not removed** (11f.3, residual 21).
6. **The zero-transmission proof is Chromium-only** on Node v22.19.0. Firefox, WebKit and Node 24 remain UNVERIFIED (H-8).
7. **The claims controls are documentary**, except the dependency-reachability and walker checks, which are technical. 11m found live stale claims by grep, which is why the grep becomes a standing DOC merge condition.
8. **A retained prototype (11d.4) is optional and carries a residual**: even unreachable, it is a promotion target for a future stray require. Mitigation is the CI check, which is why the check fails closed on unresolvable edges. The architecture does not require a prototype to be retained.
9. **Residual 4 is open** (state-changing GETs depend on manifest authoring). Not closed, not accepted.
10. **Deferring the approval machinery removes Phase 18 evidence that the machinery is correct.** That is the intended consequence of not shipping it; it is recorded so no later reader mistakes the absence of evidence for approval of the design. The machinery re-enters review at 18P.
11. **No runtime probe.** Rev 17 made three read-only repository probes only.

---

## 11p. SEC-17 handoff — focused scope

Review the **rev 17 delta only** (sections 11a to 11o and the edits in 11n), and report explicitly on each of these:

1. **No production approval writer reachable.** Is there any path — CLI flag, dashboard action, exported API, `package.json` script, workflow, dynamic require — by which production code could create, mint or persist an approval after the 11d.6 removals, and is the 11d.5 dependency-reachability check sufficient and deterministic (including its dynamic-require and `AuditLog` scope notes)?
2. **No approval consumer reachable.** Is any consumption, replay or token-resolution path left in `src/`, including the exit-14 run-token-transport refusals retained in 11f.4? Those refusals must be refusals only, with nothing to consume.
3. **No dormant A″/B″ transport reachable.** Confirm 11a.1, 11a.2, 11a.4 and 11e.4's named withdrawal of M1 and `route.fetch({maxRedirects:0})` leave no dormant, flag- or configuration-reachable transport, and that the banner-extent annotations of 11k create no implementable path.
4. **Fixture and research code cannot enter production dependency graphs.** Are 11d.4 (prototype conditions), 11d.5 (CI proof), AC-090 and AC-098 as rewritten sufficient, and is AC-098's non-reachability formulation a real merge condition rather than a restatement of AC-084?
5. **Refusal before click, submission, network, provider or healing.** Is the refusal point early enough (10a.2 as amended by 11a, 11h.1, 11i), are the negative obligations complete and individually testable against server-side ground truth, and do 11g's two inversions and 11h's three request-level cases close m-54 and m-55?
6. **Public claims describe refusal only.** Are the 11m dispositions, the 10d additions, the 11d.2 explicit statements and the healing-"approval" disambiguation sufficient, and should the repository-wide grep be a standing DOC merge condition?

Also state: whether rev 17 reaches **zero blockers and zero majors** on the rev 17 delta with only the m-51 confirmation open; whether the m-51 deferral of 11d.7 is security-acceptable or must stay an 18D condition; whether any flag in 11o should be raised above Minor; and which of m-21, m-23, m-24, m-26, m-27, m-28, m-30, H-1, H-3, H-7, H-8, R-8, R-9 and residuals 4, 13, 15, 21, 24, 25, 26 you still carry.

---

## 11q. Sequencing and recipients

Nothing in this patch authorises implementation. Phase 18 implementation remains blocked until Security reports zero blockers and zero majors on the rev 17 design, the m-51 confirmation (OWNER-13-Q1) is recorded, SPIKE-W and SPIKE-FS have finished, the persistence-test PR has merged, `main` is green, the Node 24 position (H-8, UNVERIFIED) is confirmed, and the owner authorises it explicitly.

- **Developer** — design only until authorised: the gate surfaces of 11a.2, the request-level abort rule (11h.1), the reclassification ordering (11i), the sink-scan walker (11j, a real 18B scope increase), the exit-18 reason-code and `lostCoverage` obligations (11f), the dependency-reachability check (11d.5). **Do not implement any approval create, mint, persist, consume or ledger path, and do not add `--approve-action` or `--emit-token-to`.** Do not change the locator-healing review feature.
- **QA** — the two AC-051 inversions (11g), the three request-level cases (11h.3), the named repeated `route.abort` measurement (>=10 runs, server-side records, 11h.2), `neg-heal-reclassified-protected` (11i.5), the AC-098 non-reachability cases and the export-surface check (11d.3), the dependency-reachability check (11d.5), and the repository-wide claims grep plus the healing-"approval" disambiguation check as DOC gates. Do not weaken any inversion to make a case pass.
- **Security** — SEC-17, the six questions of 11p, plus a position on the m-51 deferral.
- **DevOps** — exit 18 is deterministic and now also means a by-design policy refusal with a mandatory reason code; the single CI/shard code (11f.4); `lostCoverage` emitted on the exit-17 and exit-1 paths; the dependency-reachability check wired as a deterministic CI gate that fails closed; no approve step and no approval flags anywhere in CI; no SPIKE-R gate on 18B/18C except the retained zero-transmission measurement; CI remains the authority for Node 24, which is UNVERIFIED.
