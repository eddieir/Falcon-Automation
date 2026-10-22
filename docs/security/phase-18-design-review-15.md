# Phase 18 Security Design Re-review 15 (SEC-16)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `997f1a1` on `docs/phase-18-architecture` (architecture rev 2 plus the rev 3 to rev 16 patches). Scope: the rev 16 delta only, meaning ARCH-16 sections 10.0 to 10i and its edits to the AC JSON, the threat model, the owner decisions, the plan, the traceability file and the inline banners in the rev 13, rev 14 and rev 15 patches. It is checked against re-review 14 (SEC-15) and supersedes it for the rev 16 delta. This is a design review only. The reviewer ran no browser or runtime probe. It made three read-only repository checks: the commit stat and diff, an AC JSON count and field check, and an exit-code table read. A fourth, repository-wide phrase grep aborted on a shell expansion error and was not repeated, because the probe budget was spent. **Node v22.19.0 only. Node 24 is UNVERIFIED. Firefox and WebKit are UNVERIFIED.** The Security Engineer role is read-only, so the coordinator saved this text from the reviewer's report without changing its findings.

**Verdict: BLOCK for 18B, 18C, 18D, 18F and DOC.** Rev 16 does not change 18A or 18E, so the SEC-15 APPROVE WITH CONDITIONS stands for them. No P0.
- **Blockers: 0. Majors: 2 (M-19, M-20).** Both are design-integration defects, not objections to Option C.
- New minors: 6 (m-53 to m-58).
- **The owner's requirement "zero blockers and zero majors" is NOT met for the Option C design at 997f1a1.**
- On the merits, Security considers Option C sound: it removes the M1, M-17, M-18 and redirect residuals, and zero transmission can be checked against what the server actually receives. The defects are in how it was integrated.
- Nothing here risk-accepts anything. Risk acceptance belongs to the owner.

## Evidence checked

| # | Check | Result |
|---|---|---|
| E1 | AC JSON counts | 98 total, 89 Must, 6 Should, 3 Could. No duplicate IDs. `counts` matches. `deferredUnderOptionC: 3` is declared |
| E2 | `phase` tags | AC-096 and AC-097: `deferred-18P`. AC-051: `current`. **AC-086: no `phase` key.** It has a `phase-note` field, and the literal token `deferred-18P` is appended to the end of its `requirement` string |
| E3 | AC-086 requirement text | The rev 16 section 10f A3 deferral sentence and the window-validation retention sentence are **absent**. The full protected-lease, redirect-continuation, one-transmission-counter, chainDeadlineMs and origin/initiator arming text is still a live Must for 18D |
| E4 | AC-096 and AC-097 | Deferral text appended, unweakened. `pr` is still `"18C"` |
| E5 | AC-098 | `scope: internal-evidence`, Must, 18D. Its components say: "the approved half is proven in CI twice ... armed NetworkGate". Its inversion says: "the replay case must pass a protected action" |
| E6 | `exitCodes` | `internalError: 18`, `policy: 13`, `approval: 14`. There is no policy-refusal entry for 18 |
| E7 | Traceability | D4 row: "AC-051 approved half (OWNER-12 ...) ... tests-only executable for exit 0 and exit 14". The D7 row's supersession covers only "the origin and initiator gate". The lease and redirect tests neg-n2-arming (k)-(r), the one-transmission counter and "direct non-redirecting protected requests remain" are still live for 18B and 18D. The D3 row still cites AC-051 for the shard case |
| E8 | Plan | The 18C row's base text, "must land either the verified handler path or the mandated `route.fetch({maxRedirects:0})` fallback — the fallback is the default", is covered only by a generic "supersedes the arming, lease, redirect ... scope". The 18B row keeps neg-n2-arming (k)-(r). The 18D row keeps `falcon.js` `--approve-action` and `--emit-token-to`, ApprovalStore, RunToken and the production entry-only writer `approve-action.js`. The DOC row keeps "operator-guide.md (two-command approval workflow and run token handling)" |
| E9 | Threat model section 8 | The 18B row keeps "neg-n2-arming (k)-(r) redirect continuation". The 18D row keeps neg-n2-arming (k)-(r) and the chainDeadlineMs cap rows, with no deferral. The 18C row defers "the M-17, M-18 and SPIKE-R rows" as a whole. Item 20 still describes a production "persisted ... CLI approval". Item 22 still describes the production interactive approval prompt. The new item is numbered 26; the patch says 27 |
| E10 | Superseded banners | Rev 13 at two sites (diff hunks at lines 212 and 239). Rev 14 at one site (line 40). Rev 15 at two sites (line 26, before 9a; line 146, before 9e). Each says "the text below ... is not a Phase 18 requirement" and none says where its scope ends |
| E11 | README.md (read in full) | No Phase 18, approval or protected-action claim. Clean |

## M-19 (Major, new): the production approval and arming subsystem is still specified, so the AC-098 fixture path needs exactly the dormant transport that Option C forbids
- **Severity:** Major. **Likelihood:** high that the AC set as written is implemented this way. **Impact:** a production code path that performs a protected non-GET after an approval, held off only by the order in which the refusal check runs. Section 10e rejects this explicitly ("dormant transport ... would make the 'no reachable customer-facing protected non-GET path' check unprovable").
- **Evidence:**
  - AC-098 requires the replay inversion to "pass a protected action".
  - The D4 row requires the tests-only executable to reach **exit 0** through production pilot modules. AC-098's components name an "armed NetworkGate" (E5, E7).
  - Section 10a.3, however, puts the refusal **before approval resolution**, unconditionally.
  - The 10a.2 predicate (non-GET and protected) has **no fixture-versus-customer discriminator**.
  - So either production code carries a refusal exemption, or AC-098's runtime cases cannot be implemented (the replay case would return 18, not 14).
  - Any exemption keyed on a loopback origin would reach customer applications run locally on 127.0.0.1, which is the README's own quick-start pattern.
  - The plan's 18D row still ships a production approval mint: the `approve-action.js` writer, `--approve-action` and `--emit-token-to` (E8). Threat-model items 20 and 22 describe it as live (E9).
  - This contradicts AC-098 ("no production mint function exists") and section 10b.1 ("no customer-facing path consumes an approval").
  - The DOC row's "two-command approval workflow" is a customer-facing statement that an approval unlocks execution. Section 10d prohibits that.
  - The AC-084 walker extension must fail on "any reachable customer-facing code path that could route, perform, continue, fulfil or emulate a protected non-GET request". As specified, 18B (PilotActionGate arm) and 18D (lease consume) are such paths. The walker either fails on the plan's own scope or is weakened to assume unreachability.
- **Affected:** rev 16 sections 10a.2, 10a.3, 10b.1, 10b.2, 10c; AC-098; AC-084; plan rows 18B, 18D and DOC; traceability D4; threat-model items 20 and 22.
- **Remediation (design):**
  - (a) State that no production module contains a code path that continues, fulfils or performs a protected non-GET request under any input, including any approval. PilotActionGate and NetworkGate in production expose refusal and abort only for protected non-GET.
  - (b) Limit AC-098 to the approval state machine: create, bind the eight fields, consume once, refuse a replay with exit 14, and complete the audit chain. Test it at the ApprovalStore and resolver level, or through a tests-only transport that lives entirely under `tests/` and is never reachable from `src/`. Rewrite the inversion to: "allow a second consumption and the replay-refusal assertion must fail". Remove "pass a protected action" and the exit-0 executable case.
  - (c) Decide, and have the owner confirm, whether the production writer (`approve-action.js`, `--approve-action`, `--emit-token-to`, RunToken) ships in Phase 18 at all. If it ships, state that the approvals it mints cannot be consumed, and add a test that a minted approval still yields POLICY_PROTECTED_ACTION_UNSUPPORTED exit 18. If it does not ship, remove it from 18D and from the DOC operator guide.
  - (d) If any customer-versus-fixture discriminator is kept, it must not depend on origin, configuration, environment or a flag.
- **Verification:**
  - AC-084 walker run against the 18B/18C/18D file sets with zero findings, without exemptions.
  - A static check that no `route.continue`, `route.fulfill`, `route.fetch` or `request.*` non-GET call in `src/` is reachable after a protected verdict.
  - A runtime case: a production-minted approval plus a protected non-GET step gives exit 18 and zero requests at the server.

## M-20 (Major, new): deferred clauses are still live normative text, so deferred items read as live merge conditions
- **Severity:** Major. **Likelihood:** high, because the AC JSON is the merge-condition source of truth and is consumed field by field. **Impact:** 18B and 18D are directed to build protected-lease mint and consume, redirect continuation, the one-transmission counter and the chainDeadlineMs cap for protected requests, which is customer-facing transport that Option C forbids. Owner check 5 fails as written.
- **Evidence:**
  - E2 and E3: AC-086 has no `phase` key, a stray token, and is missing both the A3 deferral text and the retained window-validation clause. A filter on `phase === "deferred-18P"` finds 2 criteria, not the declared 3.
  - E4: AC-096 and AC-097 still carry `pr: "18C"`.
  - E7: the D7 row supersedes only the gate, not the lease and redirect tests.
  - E8: the plan's 18C row keeps the "route.fetch fallback — the fallback is the default" text without naming it superseded, and the 18B row keeps neg-n2-arming (k)-(r).
  - E9: the threat model's 18B and 18D gate rows keep neg-n2-arming (k)-(r) and the chainDeadlineMs cap rows, without deferral.
- **Remediation:**
  - Apply the 10f A3 text to AC-086 verbatim. Remove the stray token. Add `phase` with a clause-level split: the deferred clauses tagged `deferred-18P`, and the window-validation clause (250/2000/10000 ms, refused before launch, never clamped) kept live only where a permitted-action lease exists.
  - Set `pr` to `18P` on AC-096 and AC-097, or add `mergeCondition: false`.
  - Annotate the D7 row and the threat model's 18B and 18D gate rows so that neg-n2-arming (k)-(r), the one-transmission counter and the chainDeadlineMs cap rows are deferred.
  - Name M1 and `route.fetch` explicitly as withdrawn in the plan's 18C row.
  - Keep each deferred text unweakened as 18P input.
- **Verification:**
  - A JSON check that `deferredUnderOptionC` equals the number of criteria tagged `deferred-18P` (clause-level for AC-086).
  - A grep showing that no live gate row names neg-n2-arming (k)-(r) or chainDeadlineMs for a protected request.

## m-53 (Minor): the exit-code mapping is right against 14 but under-specified
- Exit 18 is correct and exit 14 is wrong for this refusal, for the reason the architecture gives: no approval can make the step proceed. Security agrees with 18 over 14.
- **The label is wrong.** The `exitCodes` table labels 18 `internalError` (E6). A deterministic, by-design refusal therefore looks like PILOT_INTERNAL_ERROR from the exit code alone. Add a `policyRefusal: 18` entry, or document that 18 covers both, and require the reason code in the report.
- **Rank masking.** Under the rank order 2>3>18>17>16>15>13>12>11>14>10>1>0, a reporter failure (17) in the same run as a refusal (18) reports 18. The lost-coverage summary may then be missing while the exit code does not say so. Require the lostCoverage summary to be written on the exit-17 path as well, or state how the two combine.
- **Non-determinism between 14 and 18.** Section 10a.2 item 3 keeps exit 14 for CI and shard paths "without a method-resolved customer dispatch", which is undefined. Section 10e refuses an unresolved method with 18. Define a single code for a protected non-GET step in CI and in shards.
- **Exit 0 is impossible on this path:** confirmed by 10a.2 item 6 and the rank order (any non-zero code outranks 0).

## m-54 (Minor): the AC-051 inversion is ill-defined
- "Remove the refusal and the case must record a request." With the refusal removed, the NetworkGate's abort of unarmed non-GET requests (threat-model 18B N01, plan DOC "background non-GET requests aborted") still applies. So the inversion either records no request, or it needs a production transmit path (M-19).
- Specify two inversions:
  - (i) remove the step refusal: the case must record a NetworkGate abort and zero server hits;
  - (ii) remove both layers in a tests-only harness: the case must record exactly one POST.

## m-55 (Minor): the request-level backstop and its zero-transmission proof are not named
- The 10a.2 predicate is per step. These requests are not steps:
  - a page-load or timer-driven JS `fetch` POST;
  - a form-submit navigation POST triggered as a side effect of a permitted click;
  - a POST issued during a permitted action's lease.
- Their zero transmission rests on NetworkGate `route.abort`. The only evidence is SEC-15 V11: 12 incidental requests, single run, Chromium.
- The repeated hop-zero `route.abort` row is a zero-transmission row. The plan's 18B row keeps such rows generically, but the threat model's 18C row defers "the SPIKE-R rows" as a whole. The two are inconsistent.
- Remediation:
  - State the request-level rule in 10a: every protected non-GET request is aborted regardless of any lease.
  - Retain the repeated `route.abort` measurement (at least ten runs, with server-side transmission records) **by name** as an 18C merge condition.
  - Add AC-051 runtime cases for the three request types above.
- The residual-15 annotation ("no Phase 18 trigger") is inaccurate while leases remain for permitted actions. Correct it.

## m-56 (Minor): ordering of healing reclassification
- Under neg-c02, a step classified non-protected at plan time can become protected after a heal. The provider was already called by then, so the 10a.2 "no provider invocation" obligation cannot hold for that step.
- State that a step reclassified as protected after a heal is refused before the action with POLICY_PROTECTED_ACTION_UNSUPPORTED, that the provider call is audited, and that the healed candidate is neither persisted nor proposed.
- Add a test.

## m-57 (Minor; partly a hypothesis): the walker must cover every action site
- Plan 18B lists the AIHealer sites (four), ClickExplorer, SiteSweep and ParallelDiscovery. The owner named HealingBenchmark. Whether it, or any other site, issues browser actions reachable in pilot mode is UNVERIFIED: the probe that would have checked it aborted.
- Require the AC-084 extension to find action sites by scanning `src/` for every Playwright action and request sink (click, fill, press, check, selectOption, dispatchEvent, evaluate, setInputFiles, request.*, goto) rather than from a fixed list. Any site not routed through the gate fails closed.

## m-58 (Minor): the superseded banners do not bound their scope
- Each banner says "the text below ... is not a Phase 18 requirement" without saying where it ends (E10).
- The rev 15 banner before 9a can be read to cover 9b and 9c, which are the live 18D fixture-authenticity requirements under m-51. The rev 14 banner before 8a can likewise be read to cover 8b and 8c (F18 to F23, live).
- The opposite misreading also exists: the 9d SPIKE-R zero-transmission row sits under the 9a banner.
- Remediation: give each banner an explicit extent, for example "applies to section 9a only; 9b and 9c remain normative for 18D".
- Placement is otherwise inline and correct, and the banners delete nothing.

## Nits
- The threat-model item is numbered 26; the patch says 27.
- The plan's 18P heading repeats its own title.
- Owner-decisions residuals 4 and 21 are annotated "no Phase 18 trigger". Residual 4 (destructive GETs depend on manifest authoring) remains, as 10g flag 4 says correctly. Residual 21's rank-masking issue now also covers exit 18 masking 17 and 1 (m-53).
- The Origin rule "for refusal classification" (10a.3) has nothing to act on at step-level refusal, because no request exists yet. It can only add refusals at request level. Say so.
- The D3 row should cite AC-083 and the rewritten AC-051, not a "zero-POST half".

## The owner's five checks
1. **Refusal before transmission:** PASS in principle for steps. Section 10a.2 places the refusal before click, fill, `request.*`, route arming, approval, provider and healer. The six negative obligations are complete and individually testable against what the server receives. There are gaps: requests that are not steps (m-55), healing reclassification (m-56), the AC-051 inversion (m-54) and the exit-code details (m-53). Residual 4 (state-changing GETs) still depends on manifest authoring, is not closed, and is not accepted here.
2. **No reachable customer-facing protected non-GET path:** FAIL (M-19, M-20). The extension wording of the AC-084 walker is good, but the plan and ACs still specify the paths it must reject. Dormant M1 and `route.fetch` are withdrawn in 10b.1, but the plan's 18C base text was not explicitly superseded. Shard mode refuses (OD-23). The healing and provider paths are covered except for m-56. ClickExplorer, SiteSweep and ParallelDiscovery are listed; HealingBenchmark is UNVERIFIED (m-57).
3. **Fixture cannot become production capability:** FAIL (M-19). The AC-098 tag, the loopback-literal target, the prohibited phrases and the adjacency rule are correct as documentation controls; 10g flag 3 is honest that they are not technical controls. But AC-098's exit-0 inversion and the production mint keep a technical promotion path.
4. **Claims:** PARTIAL. Found:
   - "approved protected submit succeeds": rev 16 patch and traceability item 35, quoted as withdrawn. Permitted.
   - "approved half": traceability D4 and AC-098 components, in fixture-scoped paragraphs. Permitted.
   - "two-command approval workflow": plan DOC row, customer-facing. **Violates 10d.**
   - Threat-model items 20 and 22 present the production approval writer as live.
   - D3, D4 and D7 cite AC-051 in lease and approval contexts.
   - README: clean.
   - **Not searched:** the full text of the rev 3 to rev 15 patches, the ADR files, docs/ARCHITECTURE.md, docs/phase-18-spike-r-findings.md and the full owner-decisions text. A repository-wide grep must be run before DOC can be approved.
5. **No dormant fallback for A''/B'':** FAIL because of M-19 and M-20. The banners are inline and delete nothing, but their scope is unbounded (m-58). AC-086 can be read as live. AC-096 and AC-097 are retained unweakened, so they cannot be read as removed. Their `pr: 18C` can be read as live (M-20).

## Other required statements
- **m-51:** still a mandatory 18D merge condition (traceability, plan 18D row, threat-model item 20 and the 18D gate row). Confirmed.
- **m-52:** deferred, with the refusal and zero-transmission tests kept (traceability append). Confirmed. Note that the threat model's 18C row defers SPIKE-R as a whole, which conflicts with this (m-55).
- **Nothing was silently dropped from the counts:** 98/89/6/3 are recomputed correctly, and no criterion was deleted or renumbered. The `deferredUnderOptionC` tagging is inconsistent (M-20).
- **The Origin header never permits:** in Phase 18, yes. Section 10a.3 withdraws "Origin matches, therefore arm", and no arming path survives once M-19 is fixed. The AC-097 text "absence is not a refusal" is deferred text only.
- **10g flags that should rise above Minor:** flag 1 (unreachability is a property of absent code paths) underlies M-19, and flag 3 (fixture disclosure) underlies M-19. Flags 2 (m-53), 4 (residual 4), 5 and 6 are accurate as stated.

## Hypotheses (not verified)
- HealingBenchmark, or another `src/` module, performs browser actions reachable in pilot mode (m-57).
- Repeated `route.abort` on a non-GET request gives zero server transmissions in Chromium across at least ten runs. It is measured only incidentally, in V11.
- The repository docs not searched contain more stale execution claims.

## Carried, unchanged, not accepted
m-21, m-23 (UNVERIFIED); m-24, m-26, m-27, m-28, m-30; m-51 (mandatory, 18D); m-52 (deferred; refusal tests kept); H-1, H-3, H-7 (carried to 18P); H-8 (Node 24 UNVERIFIED); residuals 4, 13, 15, 21, 24, 25 and 26 (the annotations on 4, 15 and 21 need correcting); R-8 (including X3 and the m-51 boundary); R-9. R-7 is DECIDED (OWNER-12, Option C). R-10 and SPIKE-R are deferred, except the zero-transmission rows (m-55). New: M-19, M-20, m-53 to m-58. Nothing here risk-accepts any item; acceptance is the owner's alone.

**Final: BLOCK.**
