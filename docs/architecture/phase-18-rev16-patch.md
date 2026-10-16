# Phase 18 architecture — revision 16 patch (ARCH-16): R-7 = Option C

Author role: Solution Architect (`claude-opus-5`). Base revision: `574f580` on `docs/phase-18-architecture` (architecture rev 2 plus the [rev 3](phase-18-rev3-patch.md) to [rev 15](phase-18-rev15-patch.md) patches). Purpose: integrate the owner's **R-7 = Option C** decision (ledger **OWNER-12**) into the design.

**This patch is design only. Nothing in it authorises implementation, merge, tag, publication or deployment of any Phase 18 PR.** It records one owner decision (R-7), accepts no residual, and selects no new mechanism. Section numbering continues from rev 15: this patch is section **10**.

**Node v22.19.0 remains the only runtime for which any fact in rev 3 to rev 16 is established. Node 24 is UNVERIFIED (H-8), carried forward unchanged. Rev 16 ran no runtime probe; it is a scope reduction, and every fact it relies on is already recorded in rev 13 to rev 15 or in SPIKE-R.**

---

## 10.0 The decision, as binding text

OWNER-12 selects **Option C**: *Phase 18 does not ship protected non-GET actions against customer applications.* The owner's operative requirements, restated normatively and without widening:

1. A `POST`, `PUT`, `PATCH` or `DELETE` step classified **protected** against a customer application is **refused before transmission**. The refusal is deterministic, non-recoverable and fails closed.
2. **Supported in Phase 18:** read actions; assertions; explicitly permitted **non-protected** actions; authenticated discovery and dry-run planning; deterministic **detection and refusal** of denied or protected state-changing actions.
3. On refusal there is **no click or submission, no network transmission, no route armed, no provider invocation, no healing attempt and no approval-token consumption**.
4. Reports and the dashboard show the affected pages and steps as **lost coverage**; such a step is **never PASS** and the run is never exit 0 on that path.
5. The capability claim is: *protected state-changing actions are detected and refused; execution support is deferred until request semantics, redirect control and outcome verification are proven.* Non-pilot behaviour is unchanged (`2572e73` parity, AC-076).

Option C was presented in rev 13 section 7g.4, rev 14 section 8a.4 and rev 15 section 9e as one of three options with no recommendation. The architecture now implements the owner's selection; it does not re-argue it.

---

## 10a. Normative refusal rule (NEW; supersedes the arming path for protected non-GET)

### 10a.1 Classification is unchanged

`ActionClassifier` and the **closed positive permit set** of OWNER-07 / D11 (rev 9) are retained in full. Nothing in rev 16 changes how an action becomes *protected*: an unknown state-changing action is protected by default, and only a manifest-declared, positively permitted, non-protected action is permitted. Option C changes what happens *after* classification, not classification itself.

### 10a.2 The refusal, before transmission

For a step whose resolved HTTP method is non-GET (`POST`, `PUT`, `PATCH`, `DELETE`, and any other non-GET method) **and** whose classification is **protected**:

1. The step is refused at **plan validation and step dispatch time** — before `click()`, before `fill()` submission, before `request.*`, before any route is armed and before any browser action that could dispatch a request.
2. Stable reason code: **`POLICY_PROTECTED_ACTION_UNSUPPORTED`**, mapped to the existing policy-refusal exit code **18** (the code already used by `POLICY_REDIRECT_UNOBSERVABLE`, `POLICY_PROTECTED_CROSS_ORIGIN_UNSUPPORTED` and `POLICY_PROTECTED_INITIATOR_UNSUPPORTED`). No new exit code is introduced; the merged-rank rules of residual 21 are unchanged.
3. The refusal is **not** `APPROVAL_REQUIRED` (exit 14). Exit 14 means *an approval would make this proceed*; under Option C no approval can, so reusing it would be a false affordance. Exit 14 remains correct for the shard-mode and CI cases of OD-23 and AC-084, which are reached on paths where a protected action is detected without a method-resolved customer dispatch.
4. The audit entry records: step id, plan digest, classification verdict and the rule that produced it, resolved method, normalised target origin and canonical path, manifest digest, build id, and `transmitted: false`. It records **no** approval id and **no** token reference, because none is created or consumed.
5. **Negative obligations, each independently testable:** zero requests observed at the target server; no `route.*` handler registered for the step; no arming lease minted; no `ApprovalStore` consume call; no provider (OpenAI or other LLM) invocation; no healer tier entered; no write to any locator or healing store (already guaranteed by OD-17-Q1).
6. The refusal is **non-recoverable**: not retried, not downgraded to a warning, not skipped. The step fails, the page is torn down and the run fails.

### 10a.3 Fail-closed ordering

Refusal is evaluated **before** approval resolution and **before** origin/initiator analysis. The rev 15 gate (9a.1) therefore never runs for a customer-facing protected non-GET request, because no such request reaches arming. The `Origin`-header rule of 9a.1 rule 4 is retained **only** as defence in depth for refusal *classification*; it may never be the basis for **permitting** a protected request. Any design text reading "Origin matches, therefore arm" is withdrawn by this patch.

### 10a.4 Reporting and dashboard

A `POLICY_PROTECTED_ACTION_UNSUPPORTED` step is rendered as **refused / coverage lost**, with the reason code, the step identity and the "execution deferred" claim string. It is never PASS, never SKIP-as-green, and never aggregated into a pass rate as a success. The reporter emits a per-run `lostCoverage` summary (count of refused protected steps, grouped by reason code) so that lost coverage is visible without opening the audit chain.

---

## 10b. What shrinks, what remains, what is deferred

### 10b.1 Shrinks (removed from Phase 18 customer-facing scope)

| Item | Disposition under Option C |
|---|---|
| **M1** (`route.fetch({maxRedirects: 0})` + `fulfil` as hop-0 performer) | **Not specified for Phase 18, in any form, including dormant or flag-disabled code.** No customer-facing transport code is written. |
| Options **A″ / B″** (rev 15 section 9e) and A′/B′ (rev 14 8a.4), A/B (rev 13 7g.4) | **Superseded by OWNER-12.** Marked superseded inline at their sites; **not deleted**, because they are the carry-forward requirement text for the deferred item. |
| Rev 14 **8a** and rev 15 **9a** M-17/M-18 origin and initiator **arming gate** | **Deferred-work requirements**, marked superseded/deferred inline. The *refusal* obligations they imply (cross-origin and unestablishable-initiator protected requests are refused) are subsumed by the stronger 10a.2 refusal. |
| **18C** NetworkGate arming path for protected non-GET; **arming lease** mint/consume/expiry for protected non-GET | Shrinks to the refusal path. The arming lease remains only where a *permitted non-protected* action needs request observation; its protected-action clauses are deferred. |
| **AC-086** protected-non-GET clauses (lease, redirect continuation, one-transmission counter, `chainDeadlineMs`) | **Deferred.** The window-validation clause (250/2000/10000 ms, out-of-range is a configuration error) is retained where a lease still exists. |
| **AC-096**, **AC-097** | **Deferred** to the later-phase item. Retained in the file, re-scoped, not deleted and not weakened. |
| **Approval consumption in customer execution** | Removed. No customer-facing path consumes an approval token in Phase 18. |
| **R-7**, **R-10**, **SPIKE-R** rows (rev 12 4d.2, rev 14 8d, rev 15 9d) | **Deferred.** They are no longer merge conditions for 18B or 18C, **except** any row that proves refusal/zero transmission. |
| **m-52** | Becomes a deferred-work requirement. Any refusal test proving zero transmission is **kept**. |

### 10b.2 Remains needed in Phase 18 (unchanged or strengthened)

`ActionClassifier` and the closed permit set (OWNER-07/D11); the refusal path of 10a; authenticated discovery and dry-run planning (AC-072 budget still OPEN-1); the evidence/bundle boundary and OD-17-Q1 no-healing-evidence rule; redaction and screenshot masking; filesystem admission (OD-20/OWNER-11); `serviceWorkers: 'block'`; AC-076 non-pilot parity; AC-084 (no approve step in CI); OD-23 shard refusal; **m-51** as a **mandatory 18D merge condition** (fixture identity, unchanged); and the **fixture approval state machine as internal security evidence only** (10c).

### 10b.3 Deferred item (new, clearly named)

**Deferred design item `18P-PROTECTED-NONGET` — protected non-GET execution against customer applications.** Not a Phase 18 PR, not scheduled, not authorised. It carries forward, as explicit entry requirements: Falcon single-transmission transport; browser response-semantic mismatch (the 204-for-a-discarded-3xx and status pass-through of rev 15 9a.2); redirect handling across 301/302/303/307/308, same- and cross-origin; `Sec-Fetch-*` header differences (preserved under `route.continue`, dropped by `route.fetch`); PUT/PATCH/DELETE measurements (never measured, UNVERIFIED); multipart and large bodies; duplicate-send and socket-retry resend (H-7); service-worker behaviour; business-outcome verification; and Firefox/WebKit evidence. The rev 14 8a and rev 15 9a gate text, the A″/B″ option text, M1, R-7, R-10 and the SPIKE-R extension rows are its inputs and are preserved for that purpose.

---

## 10c. AC-051 — rewritten honestly and SPLIT

Rev 16 replaces AC-051 (`"approved protected submit succeeds with in-run token"`), which under Option C is false as a customer-facing claim.

- **AC-051 (rewritten, Must, 18C, verification R)** — the customer-pilot criterion: a CSRF-protected form whose submit is classified protected is **refused before transmission** with `POLICY_PROTECTED_ACTION_UNSUPPORTED` exit 18; **zero** requests of any method are recorded at the application server; no approval is created or consumed; no provider call; no healing attempt; the report and dashboard show the step as refused with coverage lost and never PASS.
- **AC-098 (new, Must, 18D, verification U+R)** — **internal security evidence only, on the hermetic loopback fixture**: approval creation, binding to the eight fields, **single consumption**, **replay refusal** and the audit chain, on the fixture authority of rev 10 section 4a with the rev 11 to rev 15 identity assertions. AC-098 is tagged `"scope": "internal-evidence"` and **must not** appear in any customer-facing capability claim, release note, README, dashboard string or marketing text. Its fixture target is loopback-literal and cannot be a customer origin.

Every design, AC, ADR and documentation sentence stating or implying that "an approved protected submit succeeds" is **withdrawn** unless it is prominently limited to the non-product hermetic fixture path. The m-25 prohibited-phrase check gains the phrases named in 10d.

---

## 10d. Claims policy (normative; enforced by the prohibited-phrase check)

**Permitted claims.** "Falcon detects and refuses protected state-changing actions before transmission." "Phase 18 supports read actions, assertions, explicitly permitted non-protected actions, authenticated discovery and dry-run planning." "Execution of protected non-GET actions is deferred until request semantics, redirect control and outcome verification are proven." "Non-pilot behaviour is unchanged."

**Prohibited phrases** (fail the DOC gate wherever they appear outside an explicitly fixture-scoped paragraph): "executes approved destructive actions"; "approved protected submit succeeds"; "revision-bound approval enables protected mutations"; "safely performs POST/PUT/PATCH/DELETE"; "destructive action support"; "approval unlocks execution"; any use of AC-098 or the fixture path as evidence of product capability; and any sentence crediting the rev 15 origin/initiator gate as a *permitting* control.

**Required adjacency.** Every mention of the approval state machine in customer-facing text must carry, in the same paragraph, the sentence that no customer-facing path consumes an approval in Phase 18.

---

## 10e. Alternatives considered (for the record; none chosen by the architecture)

A″ (M1, same-origin, main-frame-initiated subresource only) and B″ (A″ plus navigation, detection-only on a manifest violation) remain implementable as specified but depend on M1, the full 9a gate, and the unfinished SPIKE-R rows; both were on the owner's table and were not selected. A fourth possibility — shipping the gate as dormant, flag-disabled transport — is **rejected here on the owner's instruction and on design grounds**: dormant transport is reachable by configuration drift, cannot be proven unreachable by the AC-084 walker if it is wired at all, and would make the "no reachable customer-facing protected non-GET path" check unprovable. Option C's rationale is that it is the only option with zero new redirect residual, no M1 dependency, no M-17/M-18 dependency, no SPIKE-R extension condition, and a refusal obligation that is provable by zero-transmission ground truth at a test server.

**Failure modes and fallback.** The refusal path has no fallback by design: a classifier that cannot resolve a method or a verdict refuses (`POLICY_PROTECTED_ACTION_UNSUPPORTED`). A reporter failure still returns exit 17 (SEC-07 m-17). **Observability:** reason-code histogram, `lostCoverage` summary, audit entry with `transmitted: false`. **Rollback:** Option C is a scope reduction with no new runtime component; reverting it would reopen R-7 and is not a safe revert (plan section 6).

---

## 10f. Exact edit list (style of rev 15 section 9f)

### A. `docs/phase-18-acceptance-criteria.json`

**A1. Metadata**
- `designRevision`: `"574f580 (architecture rev 2 plus rev 3..rev 16 patches)"`.
- `counts`: `{"total": 98, "must": 89, "should": 6, "could": 3, "deferredUnderOptionC": 3}`.
  **Recomputation from 97/88/6/3:** AC-051 is rewritten in place (no count change); **AC-098 is added as a Must** (+1 total, +1 must) → **98 / 89 / 6 / 3**. No criterion is deleted, renumbered or weakened. `deferredUnderOptionC: 3` names **AC-086** (protected-non-GET clauses only), **AC-096** and **AC-097**, which remain in the file with `"phase": "deferred-18P"` and are still counted in the totals.

**A2. `openItems` edits**
- `R-7` — append to `state`: `"; DECIDED by the owner (ledger OWNER-12): Option C. Phase 18 ships no protected non-GET action against a customer application. Options A-double-prime and B-double-prime are superseded and become inputs to the deferred item 18P-PROTECTED-NONGET. R-7 is no longer a merge condition for 18B or 18C."`
- `R-10` — append to `state`: `"; deferred with R-7. M1 is not specified for Phase 18 in any form, including dormant or flag-disabled code; the ruling is preserved as an input to 18P-PROTECTED-NONGET."`
- `SPIKE-R` — append to `state`: `"; deferred under Option C. No SPIKE-R row is a merge condition for 18B or 18C, except any row that proves refusal and zero transmission, which is retained as a refusal test."`
- `R-8`, `R-9`, `H-7`, `H-8` — unchanged and still open; rev 16 accepts nothing on them.
- **New item `18P-PROTECTED-NONGET`** — `state`: the ten carry-forward requirements of section 10b.3, with `"status": "deferred, not scheduled, not authorised"`.

**A3. Changed criteria**
- `P18-AC-051` — **replace** `requirement` with the customer-pilot refusal criterion of section 10c (refusal before transmission, `POLICY_PROTECTED_ACTION_UNSUPPORTED` exit 18, zero requests at the application server, no approval created or consumed, no provider call, no healing attempt, report and dashboard show coverage lost and never PASS, inversion: remove the refusal and the case must record a request). `pr`: `"18C"`. `components`: `"the refusal rule of rev 16 section 10a (OWNER-12, Option C)"`. `verification`: `"R"`.
- `P18-AC-086` — **append**: `"Under owner decision OWNER-12 (Option C) the protected-non-GET clauses of this criterion — lease mint and consume for a protected action, redirect continuation, the one-transmission counter and chainDeadlineMs — are DEFERRED to 18P-PROTECTED-NONGET and are not Phase 18 merge conditions. The window-validation clause remains in force wherever a lease exists for a permitted non-protected action: 250 ms minimum, 2000 ms default, 10000 ms maximum, out-of-range is a configuration error refused before browser launch and never clamped."` `phase`: `"deferred-18P"` for the deferred clauses.
- `P18-AC-096` and `P18-AC-097` — **append to each**: `"DEFERRED under owner decision OWNER-12 (Option C): no protected non-GET request reaches arming in Phase 18, so this gate has no Phase 18 trigger. The criterion is retained unweakened as an entry requirement of 18P-PROTECTED-NONGET. Its refusal obligations are subsumed by AC-051 as rewritten, which refuses earlier and more broadly."` `phase`: `"deferred-18P"`.
- `P18-AC-084` — **append**: `"The walker additionally fails on any reachable customer-facing code path that could route, perform, continue, fulfil or emulate a protected non-GET request, including any dormant, flag-disabled or configuration-reachable M1 or route.fetch fallback, so that the absence of such a path is checked and not assumed."`

**A4. New criterion (append; Must)**
```json
{ "id": "P18-AC-098", "priority": "Must", "pr": "18D", "scope": "internal-evidence",
  "requirement": "On the hermetic loopback fixture only, and as internal security evidence that is never a customer-facing capability claim: an approval is created with the eight binding fields, is bound to the plan digest, role, origin, method, canonical path, manifest digest, build id and approvals root, is consumable exactly once, is refused on replay with APPROVAL_REQUIRED exit 14, and every creation, consumption and refusal appends to the audit chain. The fixture target is loopback-literal and cannot be a customer origin; no production require graph reaches the authority; no enabling environment variable, CLI option or production mint function exists. Verification: unit cases for binding and single consumption, a replay-refusal runtime case, an audit-completeness case, and the prohibited-phrase check asserting that no customer-facing document, release note, README or dashboard string cites this criterion as product capability. Inversion: allow a second consumption and the replay case must pass a protected action.",
  "components": "the fixture approval state machine of rev 10 section 4a with the rev 11 to rev 15 identity assertions, re-scoped as internal evidence by rev 16 section 10c",
  "verification": "U, R" }
```

### B. ADRs

- **NEW ADR-0045 — "Phase 18 refuses protected non-GET actions against customer applications" (status: accepted, owner decision OWNER-12).** Context: SPIKE-R found no enforceable redirect hop class; the route layer transmits requests the browser would refuse; PUT/PATCH/DELETE, multipart, duplicate-send, service workers and non-Chromium engines are unmeasured. Decision: Option C. Consequences: refusal before transmission with `POLICY_PROTECTED_ACTION_UNSUPPORTED` exit 18; no customer-facing transport code, dormant or otherwise; the approval state machine survives only as internal fixture evidence; coverage loss is reported, never passed; A″/B″/M1/R-7/R-10/SPIKE-R become inputs to the deferred item 18P-PROTECTED-NONGET.
- **AMEND ADR-0042** (arming lease and redirect policy) — append: `Superseded in part by ADR-0045 and OWNER-12. The arming lease, redirect continuation, one-transmission counter and the rev 14/rev 15 origin and initiator gate have no Phase 18 trigger, because no protected non-GET request reaches arming; a protected non-GET step is refused before transmission. The gate text is retained as a deferred-work requirement of 18P-PROTECTED-NONGET and is marked superseded/deferred inline rather than deleted. The Origin-header rule may remain defence in depth for refusal classification and is never a basis for permitting a protected request.`
- **AMEND ADR-0043** (action classification) — append: `Unchanged by OWNER-12. Classification and the closed positive permit set are retained in full; Option C changes only what follows a protected verdict for a non-GET method.`
- **AMEND ADR-0044** (fixture-scoped approvals) — append: `Re-scoped by OWNER-12 to internal security evidence only. m-51 remains a mandatory 18D merge condition. No customer-facing Phase 18 path creates or consumes an approval, and the fixture path may not be cited as product capability; AC-051 is split so that the customer criterion proves refusal and AC-098 carries the fixture evidence.`

### C. `docs/security/phase-18-threat-model.md`

- **section 6 item 21** — append: `Rev 16: owner decision OWNER-12 selects Option C. No protected non-GET request is routed, performed, continued, fulfilled or emulated against a customer application in Phase 18; such a step is refused before transmission with POLICY_PROTECTED_ACTION_UNSUPPORTED exit 18. The unenforceable redirect classes therefore have no Phase 18 trigger and the redirect residual does not arise; the measurements remain inputs to the deferred item 18P-PROTECTED-NONGET.`
- **section 6 item 24** — append: `Rev 16: closed for Phase 18 by scope removal rather than by a gate. Falcon never originates a protected non-GET request against a customer application, because the step is refused before any dispatch. The rev 15 gate is retained only as deferred-work text and the Origin cross-check is defence in depth for classification, never a permit.`
- **section 6 item 25** — append: `Rev 16: no Phase 18 trigger; the initiator question arises only for a protected non-GET request that reaches arming, which Option C removes. Carried to 18P-PROTECTED-NONGET.`
- **section 6 item 20** — append: `Rev 16: the fixture approval authority is re-scoped as internal security evidence (AC-098) and is excluded from every customer-facing capability claim. m-51 remains mandatory for 18D. Nothing is accepted anew.`
- **section 6 new item 27** — `27. **Lost coverage presented as success (rev 16 section 10a.4).** A refused protected step is a coverage gap; a reporter or dashboard that renders it as pass, skip-as-green or an unexplained absence would misrepresent assurance. Control: the step is rendered refused with its reason code, a per-run lostCoverage summary is emitted, exit 0 is impossible on that path, and the prohibited-phrase check of rev 16 section 10d fails any document implying execution. Not accepted as a risk; closed by reporting obligation.`
- **section 8 gates table** — 18C: replace the protected-non-GET arming rows with `AC-051 as rewritten (refusal before transmission, zero requests at the application server, no approval, no provider call, no healing attempt) and the AC-084 no-reachable-path walker extension`; 18D: keep m-51 and add `AC-098 as internal evidence only`; DOC: add `the rev 16 section 10d claims policy and prohibited-phrase list`; mark the AC-096/AC-097 rows **deferred**.
- **section 9** — append: `Rev 16 integrates OWNER-12. M-17, M-18 and the SPIKE-R extension rows have no Phase 18 trigger under Option C and are deferred with their text preserved; m-52 becomes a deferred-work requirement while every refusal test proving zero transmission is kept; m-51 stays mandatory for 18D. Carried open and unchanged: m-21, m-23, m-24, m-26, m-27, m-28, m-30, H-1, H-3, H-7, H-8, R-8 and R-9. Nothing here risk-accepts them.`

### D. `docs/phase-18-decision-traceability.md`

- **New row OWNER-12** — Decision: R-7 = Option C. Design: rev 16 sections 10a to 10d. ACs: `AC-051 (rewritten)`, `AC-098 (new)`, `AC-084 (extended)`, `AC-086/096/097 (deferred)`. Tests: the AC-051 refusal case with its inversion, the AC-084 walker extension, the AC-098 fixture cases, the prohibited-phrase check.
- **D7 row** — append: `Superseded for Phase 18 by OWNER-12: the origin and initiator gate has no Phase 18 trigger and is deferred to 18P-PROTECTED-NONGET with its text preserved and marked superseded/deferred inline.`
- **m-25 row** — append: `plus the rev 16 section 10d prohibited-phrase list, including "approved protected submit succeeds", "executes approved destructive actions" and "revision-bound approval enables protected mutations", and the required adjacency sentence for every customer-facing mention of the approval state machine.`
- **m-51 row** — unchanged: mandatory 18D merge condition.
- **m-52 row** — append: `Deferred-work requirement under OWNER-12; the refusal test proving zero transmission is retained.`
- **Unsound-or-underspecified list — new item 35**: `AC-051 as written claimed a customer-facing capability ("approved protected submit succeeds") that Phase 18 does not ship under OWNER-12, and that no measurement supported for PUT, PATCH, DELETE, multipart bodies, duplicate sends, service workers or non-Chromium engines. Found by the owner; corrected in rev 16 section 10c by splitting it into a Must refusal criterion and a separate internal-evidence fixture criterion.`
- **New named-test map** — add the AC-051 refusal case and its inversion, the AC-084 reachability extension, and the AC-098 fixture cases; mark the 18C-M17-* and M-18 cases **deferred**.

### E. `docs/phase-18-owner-decisions.md` (record the decision; nothing else changes meaning)

- **Status line** — append before the design-revision sentence: `Rev 16 records owner decision OWNER-12: R-7 is DECIDED as Option C. Phase 18 ships no protected non-GET action against a customer application; such actions are refused before transmission. R-10 and the SPIKE-R rows are deferred with R-7. AC-051 is split into a customer refusal criterion and an internal fixture-evidence criterion. m-51 stays a mandatory 18D merge condition; m-52 becomes deferred work. R-8, R-9 and H-8 are unchanged and still open.` Then: `Design revision: architecture rev 2 plus patches rev 3 to rev 16.`
- **R-7 item** — prepend `**DECIDED (OWNER-12): Option C.**` and append the binding requirements of section 10.0 verbatim in substance.
- **R-10 item** — append: `Deferred with R-7; the ruling is preserved as an input to 18P-PROTECTED-NONGET.`
- **Residual list** — residuals 4, 15, 21 and 26 annotated: the protected-non-GET execution residuals have no Phase 18 trigger under Option C; nothing is newly accepted and nothing is deleted.

### F. `docs/phase-18-plan.md`

- `:3` status line — append: `Owner decision OWNER-12 selects Option C for R-7. Rev 16 integrates it as a scope reduction: no protected non-GET execution against customer applications, refusal before transmission, no dormant transport code. 18C shrinks to the refusal path; 18B loses the SPIKE-R extension conditions; 18D keeps m-51 and carries AC-098 as internal evidence. Implementation remains blocked pending SEC-16 on the rev 16 delta, SPIKE-W, SPIKE-FS, the persistence-test PR, green main and explicit owner authorisation.` and `rev 3..rev 15 patches` -> `rev 3..rev 16 patches`.
- **18C row** — replace the arming/gate scope with `the refusal rule of rev 16 section 10a, AC-051 as rewritten, the AC-084 reachability extension and the lost-coverage reporting of section 10a.4`; mark the M-17/M-18 cases deferred.
- **18B row** — remove the SPIKE-R extension rows as merge conditions; keep any refusal/zero-transmission measurement.
- **18D row** — unchanged for m-51 and the fixture identity cases; add `AC-098 (internal evidence only)`; the Node 24 confirmation (H-8) still gates merge.
- **DOC row** — add `the rev 16 section 10d claims policy, the prohibited-phrase list and the superseded/deferred inline annotations on the rev 14 8a and rev 15 9a gate text`.
- **New section** — `18P-PROTECTED-NONGET (deferred, not scheduled, not authorised)` with the ten carry-forward requirements of section 10b.3.
- **section 6** — append to the no-safe-revert sentence: `, and re-enabling any protected non-GET execution path, dormant or active, reverses owner decision OWNER-12 and requires a fresh owner decision and a fresh Security review.`

---

## 10g. Flags (nothing is silently resolved)

1. **Rev 16 is a scope reduction, not a new control.** The security property rests on the absence of a code path, which is why the AC-084 walker is extended to prove unreachability rather than assume it.
2. **Exit-code choice.** `POLICY_PROTECTED_ACTION_UNSUPPORTED` maps to **exit 18**, not 14, deliberately (10a.2 item 3). If Security prefers 14 for continuity with OD-23, say so; the architecture's reason for 18 is that no approval can make the step proceed.
3. **AC-098 is internal evidence and a disclosure risk.** Its existence can be misread as product capability; the mitigation is the claims policy of 10d and a prohibited-phrase check, which is a documentation control and not a technical one.
4. **Over-refusal.** A GET-like but actually state-changing action on an allowed route still depends on manifest authoring (residual 4, unchanged). Option C does not close it.
5. **Carried open, unchanged, nothing accepted:** m-21, m-23 (UNVERIFIED); m-24, m-26, m-27, m-28, m-30; m-51 (mandatory); H-1, H-3, H-7, H-8; residuals 13, 24, 25, 26; R-8 and R-9 as owner items.
6. **No runtime probe.** Node 24 remains wholly UNVERIFIED.

---

## 10h. SEC-16 handoff — focused scope (the owner's five checks)

Review the **rev 16 delta only**, against exactly these five questions:

1. **Refusal before transmission.** Is the refusal point of 10a.2 early enough — before `click`, submission, `request.*` and any route registration — and are the six negative obligations of 10a.2 item 5 complete and individually testable with server-side zero-transmission ground truth?
2. **No reachable customer-facing protected non-GET path.** Does the AC-084 walker extension (edit A3) actually prove unreachability, including configuration- and flag-reachable paths, and is the absence of M1 and of any `route.fetch` fallback checkable rather than assumed?
3. **Fixture cannot be mistaken for, or promoted to, production capability.** Is AC-098's boundary sufficient — no production require graph, no enabling variable, no production mint function, loopback-literal target — and can the fixture authority be promoted by configuration, environment or a documentation change alone?
4. **Claims and criteria no longer imply execution.** Are the permitted claims, the prohibited phrases and the required adjacency of 10d sufficient, and is the AC-051 split honest (customer criterion proves refusal; fixture criterion is internal evidence)?
5. **No dormant fallback can enable A″/B″.** Confirm that nothing in rev 16 leaves a dormant transport, gate or lease path that could re-enable a protected non-GET transmission, and that marking the rev 14/rev 15 gate text superseded/deferred inline (rather than deleting it) creates no implementable path.

Also state explicitly: whether rev 16 reaches **zero blockers and zero majors** on the rev 16 delta; whether any flag in 10g should be raised above Minor; and which of m-21, m-23, m-24, m-26, m-27, m-28, m-30, m-51, H-1, H-3, H-7 and H-8 you still carry.

---

## 10i. Sequencing note (coordinator)

Nothing in this patch authorises implementation. Phase 18 implementation remains blocked until Security reports zero blockers and zero majors on the revised design, SPIKE-W and SPIKE-FS have finished, the persistence-test PR has merged, `main` is green, the Node 24 position (H-8) is confirmed, and the owner authorises it explicitly. SPIKE-R is no longer a blocking dependency for 18B or 18C. Recipients: **Developer** (refusal path, reporter lost-coverage summary, AC-084 walker extension — design only until authorised), **QA** (AC-051 refusal case and inversion, AC-098 fixture cases, prohibited-phrase check), **Security** (SEC-16, the five checks of 10h), **DevOps** (no CI approve step, deterministic exit-18 behaviour, no SPIKE-R gate on 18B/18C).
