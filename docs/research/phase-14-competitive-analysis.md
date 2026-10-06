# Phase 14 Competitive Analysis: Self-Healing Test Automation

## Method and limitations

Reviewed on **2026-10-05**. The primary technical pages for all eleven profiles were reopened, including the previously inaccessible mabl help pages. Vendor articles remain separately labeled. Source metadata, exact URLs, page sections, publication/update dates where supplied, and retrieval limitations are in [the source register](phase-14-source-register.md).

“VERIFIED” means that a reviewed public source explicitly documents the precise behavior; it does not mean the product was independently exercised. “UNKNOWN” and “NOT_FOUND_IN_DOCS” never establish absence. Vendor descriptions are not comparable accuracy measurements. No accounts, paid features or competitor executions were used. Undated live pages have no established publication date; access date is not publication date. A separate independent review and owner Gate 0 decision remain required; this refresh does not fabricate either approval.

The structured [matrix](competitor-matrix.json) includes every requested A–J subdimension, with one explicit cell for each competitor. The original eight feature IDs remain for compatibility. Composite questions require all named subclauses: partial evidence leaves the status UNKNOWN and describes the known subset. UNKNOWN is an explicit insufficiency judgment, not a favorable default. Source linkage tests establish structure only, not evidentiary sufficiency.

## Evidence vocabulary

| Status | Meaning |
|---|---|
| VERIFIED | Explicitly documented behavior on the reviewed technical source. |
| UNKNOWN | Insufficient evidence for the exact requirement or composite question. |
| NOT_FOUND_IN_DOCS | No supporting statement in reviewed pages; not product absence. |
| MARKETING_CLAIM | Vendor article, marketing or press assertion; not independently measured. |
| ACCOUNT_ACCESS_REQUIRED | A verified access barrier requires an account. |
| FETCH_BLOCKED | Retrieval failed; not evidence about product capability. |

## Competitor profiles

### BrowserStack

**Sources:** S-01, exact URLs in source register.

**Strongest documented capability:** Historical locator, attribute and structure context supports in-run recovery; build reports explain repairs.

**Trust model:** In-run changes precede review. Source edits use MCP or an SDK pull request; mandatory pre-persistence approval is unknown.

**Evidence and storage:** Build reports and healed locators. Storage location and retention unknown.

**Advantage:** Hosted execution and a source-update workflow.

**Limitation:** Automate Pro entitlement; Playwright coverage is explicitly limited.

**Relevance to Falcon:** Compare reporting and source-update behavior, not accuracy.

**Evidence confidence:** Public technical evidence; undocumented details remain unknown and execution was not independently tested.

### Healenium

**Sources:** S-02, S-16, S-17, exact URLs in source register.

**Strongest documented capability:** Successful selectors provide a baseline; stored page context produces scored alternatives.

**Trust model:** Highest-score candidate is executed; mandatory approval is not established.

**Evidence and storage:** Screenshots and feedback; PostgreSQL stores selectors, reports and DOM.

**Advantage:** Open-source Selenium wrapper/proxy and customer-managed backend.

**Limitation:** Playwright Proxy belongs to Pro; do not attribute it to the free library.

**Relevance to Falcon:** Compare local ownership, storage and review controls.

**Evidence confidence:** Public technical evidence; undocumented details remain unknown and execution was not independently tested.

### Katalon

**Sources:** S-03, exact URLs in source register.

**Strongest documented capability:** Ordered fallback methods, then LLM-assisted matching using selected page, accessibility and screenshot signals.

**Trust model:** Run recovery continues execution; Approve saves a proposed default locator.

**Evidence and storage:** Broken/proposed locator, recovery method and screenshot; project object defaults.

**Advantage:** Documented review before changing the default locator.

**Limitation:** Active license required; image-locator limitations documented.

**Relevance to Falcon:** Approval alone is not a differentiator.

**Evidence confidence:** Public technical evidence; undocumented details remain unknown and execution was not independently tested.

### mabl

**Sources:** L-01, S-18, S-19, exact URLs in source register.

**Strongest documented capability:** Environment-scoped models, standard matching and cloud generative healing; weak matches fail.

**Trust model:** Passing plan runs update the model automatically; failed/ad-hoc/local runs do not.

**Evidence and storage:** Find summary, attribute history and insights; physical storage and retention unknown.

**Advantage:** Explicit model-update conditions and environment separation.

**Limitation:** Rollback deletes newer versions and does not prevent the same repair recurring.

**Relevance to Falcon:** Compare scope isolation, evidence and revocation semantics.

**Evidence confidence:** Public technical evidence; undocumented details remain unknown and execution was not independently tested.

### Testsigma

**Sources:** S-05, exact URLs in source register.

**Strongest documented capability:** Locator trace records the engine sequence; analysis explains a successful or failed heal.

**Trust model:** Approve as Primary changes future use; Ignore retains the original after a run-only heal.

**Evidence and storage:** Failed/replacement locators, duration, visual evidence and trace; storage backend unknown.

**Advantage:** Clear run-only versus future-use review workflow.

**Limitation:** Failed-heal explanation requires Analyzer V2.

**Relevance to Falcon:** The run/persistence split already has a documented analogue.

**Evidence confidence:** Public technical evidence; undocumented details remain unknown and execution was not independently tested.

### testRigor

**Sources:** S-06, exact URLs in source register.

**Strongest documented capability:** Vendor describes end-user intent and opt-in vision recovery.

**Trust model:** Automatic repairs have later review and rollback; mandatory pre-persistence approval is unknown.

**Evidence and storage:** Changed-step warnings and UI differences; backend storage unknown.

**Advantage:** Documented reversibility of repaired tests.

**Limitation:** Algorithm, matching thresholds and storage policy not established on this page.

**Relevance to Falcon:** Compare changed-step explanations; vendor behavior was not exercised.

**Evidence confidence:** Public technical evidence; undocumented details remain unknown and execution was not independently tested.

### Tricentis Testim

**Sources:** S-07, exact URLs in source register.

**Strongest documented capability:** Locator health below 70% triggers automatic improvement.

**Trust model:** Improved locator replaces the degraded one; mandatory human approval is not documented.

**Evidence and storage:** Labeled test revisions and UI indicators; backend unknown.

**Advantage:** Documented health threshold and revision history.

**Limitation:** Branch restrictions; page does not establish named rollback or candidate-score factors.

**Relevance to Falcon:** Locator health and candidate similarity are different metrics.

**Evidence confidence:** Public technical evidence; undocumented details remain unknown and execution was not independently tested.

### Functionize

**Sources:** S-08, exact URLs in source register.

**Strongest documented capability:** Vendor article describes multidimensional fingerprints and uncertainty validation.

**Trust model:** Pre-persistence approval unknown.

**Evidence and storage:** Article discusses attributes, visual and structural context; backend unknown.

**Advantage:** Detailed vendor explanation of its model.

**Limitation:** Article claims are not independent execution evidence or accuracy measurements.

**Relevance to Falcon:** Treat model descriptions as vendor claims, not superiority evidence.

**Evidence confidence:** Vendor article only; product behavior not independently verified.

### Momentic

**Sources:** S-09, exact URLs in source register.

**Strongest documented capability:** Temporary recovery is separate from permanent triage; triage tests changes in a browser.

**Trust model:** PR is default permanent delivery, but direct commit and on-disk modes exist; mandatory approval is unknown.

**Evidence and storage:** Classification/triage reasoning and repair validation; cache backend unknown.

**Advantage:** Configurable delivery and run-only recovery.

**Limitation:** A default PR is not proof of a universal approval gate.

**Relevance to Falcon:** Compare the conceptual split while distinguishing cache and source edits.

**Evidence confidence:** Public technical evidence; undocumented details remain unknown and execution was not independently tested.

### Autify

**Sources:** S-10, exact URLs in source register.

**Strongest documented capability:** Vendor article describes user-applied fixes after completed tests.

**Trust model:** Deferred suggested-fix application, as a vendor article claim.

**Evidence and storage:** Detailed evidence and storage unknown in this reviewed article.

**Advantage:** User control over applying fixes is described.

**Limitation:** Article does not establish a complete product validation/storage contract.

**Relevance to Falcon:** Do not infer implementation details from a general explainer.

**Evidence confidence:** Vendor article only; product behavior not independently verified.

### Virtuoso QA

**Sources:** S-13, exact URLs in source register.

**Strongest documented capability:** Confidence determines automatic changes, proposals or no healing.

**Trust model:** High-confidence changes apply automatically; proposals need acceptance; Reject reverts applied changes.

**Evidence and storage:** Execution report and healing review; numeric score and backend unknown.

**Advantage:** Conditional refusal and an explicit review/revert path.

**Limitation:** No numeric threshold disclosed; not a universal approval gate.

**Relevance to Falcon:** Compare confidence/refusal policy and operator control.

**Evidence confidence:** Public technical evidence; undocumented details remain unknown and execution was not independently tested.

## Commercial claims and survey limitations

BrowserStack's press-release reduction percentage and mabl's maintenance-reduction percentage remain vendor claims with no comparable public controlled methodology in the sources reviewed. They are not benchmark baselines, targets or independent evidence. Untraceable quantitative Virtuoso claims have been removed. Entitlements are recorded only when the technical source names them: BrowserStack Automate Pro, Katalon active Studio license, and Healenium Pro Playwright Proxy. Usage limits and exact pricing remain UNKNOWN.

The September repository-star survey had no committed response snapshots. Its quantitative adoption conclusions are withdrawn. Exact per-repository API endpoints are registered for future reproduction; they are not a fresh measurement, completeness claim, or proof of maturity. The newly reviewed Healenium Pro page explicitly documents Playwright, so a blanket Selenium-only comparison is invalid.

## Required A–J coverage

- **A. Product model:** 10 exact prompt subdimensions in the structured matrix.
- **B. Healing trigger:** 7 exact prompt subdimensions in the structured matrix.
- **C. Stored historical model:** 12 exact prompt subdimensions in the structured matrix.
- **D. Matching behavior:** 13 exact prompt subdimensions in the structured matrix.
- **E. Trust and governance:** 11 exact prompt subdimensions in the structured matrix.
- **F. Validation:** 8 exact prompt subdimensions in the structured matrix.
- **G. Explainability:** 7 exact prompt subdimensions in the structured matrix.
- **H. Storage and ownership:** 12 exact prompt subdimensions in the structured matrix.
- **I. Operational behavior:** 9 exact prompt subdimensions in the structured matrix.
- **J. Commercial evidence:** 7 exact prompt subdimensions in the structured matrix.

Every undocumented storage, business-outcome-validation, false-heal-metric, concurrent-writer, privacy or approval detail stays UNKNOWN. Falcon benchmark results cannot be compared to a competitor without matched execution conditions and ground truth.

## Falcon's Current Capabilities (Revision `11657cb`)

**Source:** Direct code reading, repository Falcon-Automation, branch `phase-14/evidence-based-locator-memory`, HEAD `11657cb`. All capability statements describe shipped behavior only, not Phase 14 proposals.

### Healing Trigger and Layers

**Tier 1 — Original-selector retry:** Direct action on the original selector with up to 3 retry attempts. Exponential backoff with error-type-specific multipliers (TIMEOUT 2.0, STALE_ELEMENT 1.5, NETWORK 0.75, default 1.0) and ±20% jitter, capped at 8000ms. HARD errors (non-recoverable) stop immediately. Implemented in `AdaptiveRetry.execute()`.

**Tier 2 — Stored alternative selector replay:** Human-approved selectors persisted in `LocatorStore`. Stored alternatives are attempted in order after Tier 1 fails. Each alternative is checked for uniqueness (must resolve to exactly one element) before use; skipped if not unique. Trigger for advancement to Tier 2: requires prior human approval of a Tier 3 suggestion, as it is never created without user decision.

**Tier 3 — LLM-suggested selector:** On Tier 1 and Tier 2 failures, Falcon calls an LLM (OpenAI API) with a DOM snapshot and the broken selector, requesting a single CSS selector. Suggested selector is checked for uniqueness; if not unique it is skipped. If unique, the suggestion is NOT auto-persisted; it is queued for human review in `HealingTrust` pending entries.

### Trust and Governance

**Human approval required for persistence.** Tier 3 suggestions are recorded as pending and require explicit human approval via dashboard (`POST /healing/approve`, `GET /healing/pending`) or CLI (`scripts/healing/review.js approve`) before they are persisted to `LocatorStore`. Once approved, the alternative is treated as Tier 2 for future runs (automatic replay, no per-run approval).

Trusted without per-run approval: Tier 1 (original selector) and Tier 2 (previously approved alternatives).

**Pending queue cap:** 200 entries maximum, LRU eviction by `lastSeen` timestamp.

**Decision ledger:** Append-only record of all approve/reject decisions, capped at 500 rows, oldest dropped first.

### Stored Historical Model

**LocatorStore key:** Raw selector string alone, with NO page/action/application scoping. Two different pages/tests sharing the same selector string (e.g. `#submit`) share the same cache entry.

**Alternative limit:** Maximum 5 alternatives per selector; maximum 500 tracked selectors total. Least-recently-used eviction when limits are exceeded.

**Persistence:** Stored in `data/locator_store.json`, written via `fs.promises.writeFile` (NOT atomic temp-file+rename). On corrupt-file load, silently falls back to empty store with NO logging.

### Matching Behaviour

**Replay-based matching only.** Tier 2 and Tier 3 candidates are matched by re-running the selector string against the live DOM's current state, not by any stored element identity, signature, or content comparison.

**No signature capture.** Element signatures, visual fingerprints, or semantic descriptions are not captured or persisted.

**No deterministic historical matching.** There is no comparison of "does this element resemble the one we saw before" beyond "does this exact selector string still resolve to exactly one node."

**Uniqueness gate only.** The only pre-condition checked before acting is DOM cardinality (`count === 1`). Post-action success is determined by whether the Playwright action (click, fill, selectOption) resolves without throwing. No visual comparison, text/label/role assertion, or post-action state check is performed.

### DOM Snapshot (Tier 3 Input)

Elements captured: `input, button, a, select, textarea, label, [data-testid], [aria-label]` only (not the whole DOM).

Per element: `<tag attr="val" ...>` for every attribute EXCEPT `value` is stripped when `type="password"` (never send entered credential values).

Character cap: Hard-truncated to 6000 characters (not token-aware, not element-aware; could truncate mid-tag).

Storage: NOT persisted. Snapshot exists only during a single `getAlternativeSelector()` call and is discarded after the prompt is sent.

### Explainability

**Reported information:**
- Each healed locator (Tier 2 or Tier 3 after approval).
- The tier / method by which it was healed (Tier 1 retry, Tier 2 stored, Tier 3 LLM).
- Pending suggestions with their metadata (original, suggested, description, occurrences, lastSeen, tier3Invocations, previously-rejected count).
- Decision history (approve/reject ledger with timestamps and actor).

**NOT reported:**
- Confidence score or probability from the LLM.
- Full locator trace or chain-of-reasoning from the LLM.
- Visual or semantic analysis details.
- Rollback capability for a previously-approved alternative.

### Validation

**Pre-action:** Uniqueness gate only (`count === 1`).

**Post-action:** Action resolves without throwing. No semantic validation, verification against original-selector intent, or post-state check.

**No safe-refusal equivalent:** If a Tier 3 response produces a selector that is not unique, it is silently skipped; no escalation or user notification occurs.

### Storage and Ownership

- `data/locator_store.json` — Tier 2 approved alternatives. Singleton file, NOT atomic writes. Corrupt-file recovery is silent.
- `data/healing_pending.json` — Tier 3 pending review queue (max 200 entries). Atomic writes via `AtomicJsonStore`. Cross-process write safety: NOT coordinated (no locks; two processes racing to write could clobber each other's in-memory state).
- `data/healing_decisions.json` — Approve/reject ledger (max 500 rows, append-only). Atomic writes via `AtomicJsonStore`. Same cross-process caveat as pending file.

**CI caching:** `healing_pending.json` and `healing_decisions.json` are cached across CI runs on the same branch. `locator_store.json` is explicitly excluded and NOT cached (by design: cached approved Tier-2 selectors would silently change healing behavior between runs).

### Operational Behaviour

- Healing is run-scoped by default; only approved Tier 3 suggestions transition to persisted Tier 2.
- Pending entries older than a configured threshold (default NOT SPECIFIED, resolved server-side from ConfigManager) can be listed via `GET /healing/pending/stale` (CLI: `scripts/healing/review.js` does not expose this).
- No cross-process coordination for concurrent writes; single-process concurrency is serialized via internal `_queue` chains.
- No rollback capability for persisted (Tier 2) entries. Manual disk edit only.

### Review Surfaces

**Dashboard:** `GET /healing/pending` (list pending entries), `POST /healing/approve` (approve by original selector), `POST /healing/reject`, `GET /healing/trend` (healing trend report), `GET /healing/pending/stale` (stale pending entries). All endpoints gated by token authorization.

**CLI:** `scripts/healing/review.js` commands: `list` (default, no-arg), `approve "<selector>"`, `reject "<selector>"`, `approve-all`. Unknown command exits with code 1.

### Known Gaps (Current Revision)

The following capabilities are NOT present in Falcon as shipped:

- **No element signatures.** Visual, structural, or content-based element identifiers are not captured or persisted.
- **No semantic validation.** Healing does not verify that a repaired selector targets the same element logically or semantically as the original; it only checks cardinality and action success.
- **No confidence score.** Tier 3 LLM responses are treated as binary (selector or null); no probability, confidence, or score is produced or surfaced.
- **No safe-refusal equivalent for Tier 3.** Low-confidence or ambiguous LLM responses are not escalated; they are either accepted (if unique) or skipped silently.
- **No rollback.** Persisted Tier 2 alternatives cannot be revoked via API or CLI; manual disk edit is required.
- **No cross-process write coordination.** Two Falcon processes racing to write healing state could clobber each other's in-memory copies. This is untested.

---

## Research Residual Risks

## Remaining research gates

The Falcon baseline above remains the recorded pre-Phase-14 revision `11657cb1`; it is not a statement of the repaired branch. Independent source interpretation review, acceptance-criteria review and owner Gate 0 approval must be recorded separately. A green source-linkage test does not satisfy those gates.
