# Phase 14 Competitive Analysis: Self-Healing Test Automation

## Method and Limitations

**Access date:** 2026-09-29. **Source priority:** Official technical documentation > vendor articles > marketing pages. **Source freshness:** Dates are as recorded on the source page. When "last updated: not stated" appears below, no secondary freshness check (changelog, release notes, archived snapshot) was attempted; these sources are acceptable for an internal gate but require secondary freshness verification before external publication.

**Technical limitations of this research:**

- **mabl technical documentation unreachable.** Four official mabl help center paths returned HTTP 403 (access denied):
  - https://help.mabl.com/hc/en-us/articles/19078583792404-How-auto-heal-works
  - https://help.mabl.com/hc/en-us/articles/19078598947092-Auto-heal-FAQs
  - https://help.mabl.com/docs/auto-heal-faqs
  - https://help.mabl.com/docs/assertions-and-auto-heal
  
  Consequence: every mabl technical claim is recorded as **UNVERIFIED** — not confirmed, and emphatically not denied. Each capability mabl is reported to have is independently verified on another vendor's official documentation (see confidence notes below). This is an accepted permanent limitation of this research pass.

- **Several sources carry no last-updated date,** and secondary freshness checks were not performed (see source list).

- **Quoted text was audited for internal consistency only,** not re-fetched, by a reviewer with no web tools. This is weak-confidence clearance on summary accuracy, not a strong one. All quotes are marked with their source.

---

**Structured data:** the capability-by-capability matrix described in prose below is also published as schema-validated structured data at `docs/research/competitor-matrix.json`, one status cell per competitor per feature restricted to the six-value enum in the table immediately below, with no blank and no default. That file, not this prose, is the machine-checked source of truth for "every cell carries an honest status" (see `tests/regression/p14-claims.check.cjs`).

## Evidence Status Vocabulary

| Status | Meaning |
|--------|---------|
| **VERIFIED** | Read on the official vendor technical documentation page. |
| **PARTIALLY VERIFIED** | Found on an official page, but claims on the same page remain unverified. |
| **MARKETING CLAIM** | Sourced from a vendor marketing or press page, not technical documentation. Not independently verifiable. Must not be restated as fact or used as a comparison baseline. |
| **VENDOR ARTICLE** | Written by the vendor but published as a blog post or article, not official documentation. Lower priority than technical docs. |
| **NOT FOUND IN PUBLIC DOCUMENTATION** | Not stated on the official page reviewed. **This never means the competitor lacks the capability.** It means the claim was not found in the reviewed source. |
| **UNKNOWN** | The official page was silent on the question. |
| **NOT APPLICABLE** | The feature category does not apply to this product. |
| **FETCH BLOCKED** | The official documentation page could not be accessed. |

---

## Competitor Profiles

### BrowserStack — AI Self-Heal for Playwright

**Source:** Official documentation, https://www.browserstack.com/docs/automate/playwright/self-healing (VERIFIED). Last-updated: not stated on page.

**Healing trigger:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Stored historical model:** Stores element context: "securely stores key information about that element — including its locator, nearby attributes and the structure of the DOM". Storage location: UNKNOWN. Privacy statement: NOT FOUND.

**Matching behaviour:** Uses "historical context" and "AI signals"; algorithm detail NOT STATED. Selection is automatic; human approval before reuse NOT MENTIONED.

**Trust and governance:** Automatic healing; resilient-locator output is marked [Beta]; findElements healing marked [Beta]; some features in "limited capacity" for Playwright. Available only on Automate Pro plan.

**Validation:** Reports "Every healed locator and the reason it was applied, per build." Healings are reviewable in build dashboard and via REST API.

**Explainability:** Reason for each healed locator is reported.

**Storage and ownership:** Source update delivered via MCP direct-apply OR automatic GitHub PR for SDK users. Data location UNKNOWN.

**Operational behaviour:** Requires at least one successful test execution with the same elementIdentifier to capture correct element context. Performance overhead noted as a limitation. "Not all failures can be healed."

**Commercial evidence:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Evidence confidence:** MEDIUM. Storage location, privacy model, and human-approval affordances remain undisclosed. Playwright support is acknowledged as "presently in limited capacity."

---

### Healenium

**Source:** Official documentation, https://healenium.io/docs/how_healenium_works (VERIFIED). Last-updated: not stated on page.

**Healing trigger:** NoSuchElement exception.

**Stored historical model:** Persists the "successful locator" as a baseline for later runs; retrieves "previous successful locator path" and compares against "current page state".

**Matching behaviour:** Retrieves historical successful locator and re-evaluates against current page. Selects locator with "the highest score". No threshold value stated. Whether healed locators are auto-trusted for later runs versus confirmed by a human: UNKNOWN (documentation is silent).

**Trust and governance:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Validation:** Report includes healed locator, screenshot, and a feedback button.

**Explainability:** Report surface exists; algorithm named "LSC algorithm" but not defined on the page.

**Storage and ownership:** Storage engine named in official documentation as PostgreSQL (S-16, verified via https://healenium.io/docs/overview). Stated purpose: "store reference selector / healing / report / DOM". S-02's caveat "storage engine NOT named on this page ... must verify" is superseded for the storage-engine question only; S-02's other UNKNOWNs (auto-trust vs. human review) stand. Healenium's overview page names Selenium and Appium support; Playwright is not mentioned on this page (recorded as not established from this page, not unsupported). Screenshots and method/class names are not mentioned as stored. Whether healed locators are automatically reused: UNKNOWN.

**Operational behaviour:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Commercial evidence:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Evidence confidence:** LOW-MEDIUM. Critical governance questions (auto-trust vs. human review, storage engine, persistence of healed locators) are undisclosed.

---

### Katalon — Self-healing tests in Katalon Studio

**Source:** Official documentation, https://docs.katalon.com/katalon-studio/maintain-tests/self-healing-tests-in-katalon-studio (VERIFIED). Last-updated: April 2026.

**Healing trigger:** User-prioritised fallback locator methods, applied in order when a method fails.

**Stored historical model:** User can configure two tiers: (1) ordered fallback locator methods, configured by drag-and-drop priority; (2) LLM-based analysis of "page source, accessibility tree, full-page screenshot, and element screenshots" with user-configurable signal set.

**Matching behaviour:** Tries locator methods from highest to lowest priority. LLM tier analyzes multiple signal sources; "Selecting more sources increases healing accuracy but may slightly increase processing time and cost."

**Trust and governance:** **Human approval required before persistence.** Once healing completes, "Katalon Studio suggests replacing the broken locator with the one that worked". The Self-healing Insights tab requires explicit "Approve" to save, or "Discard" to reject. Confidence score NOT MENTIONED.

**Validation:** Insights table shows Test Object ID, Broken Locator, Proposed Locator, Recovered By, and screenshot preview.

**Explainability:** "Recovered By" shows the healing method. Per-locator reason is explicit.

**Storage and ownership:** Persisted to project configuration after explicit approval.

**Operational behaviour:** On heal, "the test continues to run without interruption".

**Commercial evidence:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Evidence confidence:** HIGH. Human approval before reuse is explicitly documented; this directly contradicts the Phase 14 brief's premise that pre-reuse human approval is a Falcon differentiator.

---

### mabl — GenAI Test Automation with Self-Healing

**Source:** Vendor marketing page, https://www.mabl.com/auto-healing-tests (MARKETING CLAIM). No date shown. Companion source: mabl blog post, "Self-healing test automation — autonomous QA" (Abbey Charles, 2025-11-17), reviewed but contains no technical detail.

**Healing trigger:** UNVERIFIED. Official help documentation is inaccessible (HTTP 403).

**Stored historical model:** UNVERIFIED. Official documentation is inaccessible.

**Matching behaviour:** Marketing page states "Smarter Element Locators … use visual context and multiple attributes"; attribute count NOT disclosed. Described as "Adaptive Multi-Layer Auto-Healing"; "autonomously updates element locators and test steps".

**Trust and governance:** Marketing page states human involvement only "when clarification is needed". Broader governance model (thresholds, auto-vs-proposal split, persistence rules): UNVERIFIED.

**Validation:** UNVERIFIED.

**Explainability:** UNVERIFIED.

**Storage and ownership:** UNVERIFIED.

**Operational behaviour:** UNVERIFIED.

**Commercial evidence:** "eliminating up to 95% of test maintenance" — MARKETING CLAIM, not independently verifiable.

**Evidence confidence:** VERY LOW. Technical documentation is inaccessible. Every technical capability above is independently verified on another vendor's official documentation (see cross-references in other profiles), but mabl's own implementation details remain unknown. This is an accepted permanent limitation of this research pass. The marketing claim is recorded; it must not be restated as fact or used as a target or baseline.

---

### Testsigma — Auto-Healing

**Source:** Official documentation, https://testsigma.com/docs/auto-healing/auto-healing-insights (VERIFIED). Last-updated: not stated on page. Companion introductory page https://testsigma.com/docs/auto-healing/intro/ confirms auto-healing is a feature; technical model details are NOT stated there.

**Healing trigger:** (NOT FOUND ON INSIGHTS PAGE; introductory page does not clarify)

**Stored historical model:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Matching behaviour:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Trust and governance:** **Explicit human persistence control.** "Click Approve as Primary to make the healed locator the locator the test uses from now on"; "Click Ignore to leave the original locator in place"; "Click Update to apply the healed locator across every test case linked to the element". Healing happens automatically during execution; persistence requires explicit user action.

**Validation:** Shows healed element, "The locator that failed, struck through, followed by the locator that replaced it". "Every auto-heal event records a locator trace: the full sequence the engine worked through to arrive at a heal".

**Explainability:** Full locator trace is recorded and displayed.

**Storage and ownership:** User chooses per-locator persistence via Approve, Ignore, or Update actions.

**Operational behaviour:** Automatically identifies and updates broken element locators during execution.

**Commercial evidence:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Evidence confidence:** MEDIUM. Governance model (explicit approval for persistence) is very clearly documented. Healing trigger and historical matching strategy are NOT disclosed.

---

### testRigor — AI-Based Self-Healing

**Source:** Vendor official product page, https://testrigor.com/ai-based-self-healing/ (VERIFIED). No date shown.

**Healing trigger:** Two types: locator breakage and specification change (element renamed).

**Stored historical model:** Elements described "from the end-user's perspective"; wrapper records "the end-user's way of explaining your locator".

**Matching behaviour:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Trust and governance:** Heals apply automatically and are **reviewable and reversible** — not pre-approved. Vision AI requires explicit opt-in: "If you enable Vision AI and enable Auto-Healing for rules and single commands…".

**Validation:** Review affordances include "fixed-by-ai" label; "the steps that were self-healed will have a warning on them describing what exactly was changed"; "you can always see the differences in the UI and rollback to the previous version if necessary".

**Explainability:** Warning label describes what was changed. User can see exact differences.

**Storage and ownership:** Rollback capability is explicit. (Persistence mechanism: NOT FOUND IN PUBLIC DOCUMENTATION)

**Operational behaviour:** Automatic repair is reversible. Vendor honestly states: "some of the ways AI adapts will not be what you want".

**Commercial evidence:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Evidence confidence:** MEDIUM-HIGH. Reversibility and explanation are explicit. Persistence and historical model details are undisclosed.

---

### Tricentis Testim — Locators: Auto Improve

**Source:** Official documentation, https://docs.tricentis.com/testim/content/test-management/locators-auto-improve.htm (VERIFIED). Last-updated: not stated on page.

**Healing trigger:** Numeric threshold. "If a locator score drops below 70%" auto-improve activates.

**Stored historical model:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Matching behaviour:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Trust and governance:** **Automatic replacement, no approval required.** "Testim replaces the degraded locator with the improved locator"; human approval NOT mentioned or required. Scope limitation: applies "only to tests run on the master branch"; other branches excluded unless settings are changed.

**Validation:** Auditability provided: "Testim creates a test revision and labels it 'Testim auto improve'"; surfaced in Revision History, Locators panel and Test Library; an "Ai" icon shows for ~two weeks.

**Explainability:** Label identifies auto-improved revisions; icon distinguishes them for two weeks.

**Storage and ownership:** Locator is persisted automatically; revision history tracks the change.

**Operational behaviour:** Replaces degraded locators without user intervention; scoped to master-branch runs by default.

**Commercial evidence:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Evidence confidence:** HIGH. Numeric threshold (70%) and automatic replacement are explicitly documented. Testim is direct evidence that a competitor exposes a numeric locator score AND acts on a documented threshold. This contradicts the premise that Falcon's confidence-score approach is unique.

---

### Functionize — Self-Healing Tests Analysis

**Source:** Vendor technical article, https://www.functionize.com/blog/self-healing-tests-arent-magic-heres-whats-actually-happening-under-the-hood (VENDOR ARTICLE, not official documentation). Author Matt Young. Published 2026-03-30. Brief priority 8.

**Healing trigger:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Stored historical model:** Five fingerprint dimensions: attributes/properties, visual characteristics, hierarchy and relationships, state and interactions, content and metadata.

**Matching behaviour:** Similarity scoring over a "high-dimensional embedding"; thresholds NOT disclosed. Scale claim: "3,500 elements per page, with approximately 200 attributes evaluated per element"; "70 million data points per test run". These are VENDOR CLAIMS, not independently verified. (See vendor-claims register below.)

**Trust and governance:** Confidence thresholds, low-confidence failure, rollback: NOT on this page. **Safe-refusal equivalent exists:** an "adjoint model" performs a "reverse-likelihood check"; "If the adjoint model disagrees, or if the uncertainty score stays high, the system flags the result as 'self-heal validation failed' and escalates rather than silently proceeding"; "Failing loudly on genuine uncertainty is a feature, not a limitation."

**Validation:** Similarity scoring produces a confidence metric; adjoint model provides a second-opinion safety gate.

**Explainability:** Adjoint model acts as a validation gate. Safe refusal is explicit when confidence is low.

**Storage and ownership:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Operational behaviour:** "A similarity score of 94% doesn't mean the system found the right element, it means it found the closest match". Vendor-admitted limitation: "Self-healing is constrained by your verifications. It cannot override a failed verification."

**Commercial evidence:** Article is vendor-authored; claims about fingerprint dimensions and "70 million data points" originate here, not from independent test reports.

**Evidence confidence:** MEDIUM. Safe-refusal strategy is explicitly described. Scale claims ("70 million data points") are quantified but vendor-originated and unverified. Safe refusal is NOT unique to Falcon.

---

### Momentic — AI Test Maintenance

**Source:** Official documentation, https://momentic.ai/docs/reliability/auto-maintenance (VERIFIED). Last-updated: not stated on page.

**Healing trigger:** Four escalating layers: locator auto-healing, failure recovery, permanent healing (triage), quarantine.

**Stored historical model:** **Run-scoped versus persisted split, very close to Falcon's intended model.** "The resolution applies to the current run and never edits the test"; "Generated steps apply only to that run and never edit the test." Only triage "delivers a repair only when it changes the test or a module."

**Matching behaviour:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Trust and governance:** Delivery of persisted repairs is configurable, default being a PR: "Pull request (default): open a pull request with the repairs"; also draft PR, direct commit, patch, or nothing. Step cache applied "after an eligible successful run". Explicit pre-approval: NOT STATED (PR default implies review, but the page does not say approval is required). Recorded as NOT FOUND, not as absence.

**Validation:** Stops "after three recoveries in one run"; skips triage when "at least 20 failures and at least 50% of its tests failed"; excludes product regressions, config errors, network outages, 5xx, CAPTCHAs, browser crashes.

**Explainability:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Storage and ownership:** Persisted repairs delivered as configurable code change (PR, commit, patch, or none).

**Operational behaviour:** Run-scoped repairs never modify test code; persisted repairs require explicit approval by default (PR review).

**Commercial evidence:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Evidence confidence:** MEDIUM-HIGH. Run vs. persisted split is explicitly documented. This is direct evidence that Momentic already separates "repair this run only" from "persist the repair," which is the core of Falcon's proposed Tier 2.5 trust contract. Implementation details (matching strategy, confidence thresholds) are not disclosed.

---

### Autify — Self-Healing Test Automation

**Source:** Vendor blog article, https://autify.com/blog/self-healing-test-automation (VENDOR ARTICLE, not official documentation). Published 2025-08-22.

**Healing trigger:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Stored historical model:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Matching behaviour:** Element-characteristic description in the article is generic, not Autify-specific.

**Trust and governance:** "Autify lets you decide whether to apply the AI-suggested fixes after the tests have completed running." — deferred, user-decided application. Healing is suggested, not automatic.

**Validation:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Explainability:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Storage and ownership:** Persistence is user-initiated after test completion.

**Operational behaviour:** Vendor-admitted risk: self-healing "can sometimes 'successfully' adapt to changes that actually represent bugs".

**Commercial evidence:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Evidence confidence:** LOW. This is a blog post, not technical documentation. Healing model details are absent. Governance model (deferred, user-decided) is stated; technical implementation is not.

---

### Virtuoso QA — Elements and Self-Healing

**Source:** Official documentation, https://docs.virtuoso.qa/guide/making-the-most-of-virtuoso/elements/ (VERIFIED). Last-updated: 2026-07-30. Companion marketing claim on vendor site: "95% accuracy … only 5% of changes require human review" (MARKETING CLAIM, see vendor-claims register).

**Healing trigger:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Stored historical model:** Selector kinds: Hint, XPath, XPath ID, ID, CSS. Infers "more specific element identifiers (e.g., XPath, XPath ID, CSS)" during execution. ML comparison of an expected model to a found model: NOT STATED on technical page (asserted on vendor marketing pages only; do not upgrade to verified).

**Matching behaviour:** "Virtuoso not only considers the selectors, but it will also do a smarter analysis to infer the target element." Algorithm detail NOT STATED. **Confidence-gated split between auto-apply and human proposal:** "Above a certain confidence level, the change is applied automatically; below it, the change is offered as a proposal." Users see "Element healed automatically" or "Element can be healed" and may "Accept" or "Reject". Numeric score is NOT displayed to users.

**Trust and governance:** Confidence threshold gates automatic vs. proposed application. Healing disabled for elements "selected with low confidence"; deterministic-selector-only elements are not healed by design. Stated limitations: "Virtuoso will also never heal your hint selector".

**Validation:** User sees element healing outcome and can accept/reject proposal path.

**Explainability:** Outcome labels ("healed automatically" vs. "can be healed") are explicit.

**Storage and ownership:** (NOT FOUND IN PUBLIC DOCUMENTATION)

**Operational behaviour:** Operates on confidence threshold (undisclosed numeric value); applies automatically above threshold, offers proposal below.

**Commercial evidence:** "95% accuracy … only 5% of changes require human review" — MARKETING CLAIM, not independently verifiable.

**Evidence confidence:** MEDIUM-HIGH. Virtuoso is the closest documented analogue to Falcon's intended Tier 2.5 trust model found anywhere in this research. It already implements BOTH a confidence threshold that gates automatic application AND an explicit human Accept/Reject proposal path. Numeric confidence threshold is NOT disclosed to users.

---

## Vendor Claims Register

| Vendor | Claim (verbatim) | Qualification | Source |
|--------|------------------|---------------|--------|
| mabl | "eliminating up to 95% of test maintenance" | MARKETING CLAIM. "Up to" qualifier appears in marketing page only. No methodology, population, time period, or measurement approach stated. | Vendor marketing page; blog post contains no technical detail. |
| Virtuoso | "95% accuracy … only 5% of changes require human review" | MARKETING CLAIM. No population, time period, methodology, or measurement approach stated. | Vendor marketing page. |
| Functionize | "3,500 elements per page" | VENDOR CLAIM. Scale presented as example; not independently verified. | Vendor technical article (blog). |
| Functionize | "approximately 200 attributes evaluated per element" | VENDOR CLAIM. Presented as example; not independently verified. | Vendor technical article (blog). |
| Functionize | "70 million data points per test run" | VENDOR CLAIM. Presented as scale example; not independently verified. | Vendor technical article (blog). |
| BrowserStack | "40% reduction in automation build failures" | MARKETING CLAIM (unqualified). Who measured it — NOT SPECIFIED. Population — NOT SPECIFIED ("teams", generic). Time period — NOT SPECIFIED. Methodology — NONE PROVIDED. No sample size. Source: vendor press release (2025-11-17). Does NOT appear on technical documentation. | Vendor press release (https://www.prnewswire.com/news-releases/browserstack-unveils-ai-powered-self-healing-agent-to-keep-builds-green-302617102.html). Cross-checked against technical docs; figure absent. |

**Important note:** These quantitative claims must not be restated as facts, used as benchmark baselines, used as Falcon targets, or compared against any Falcon measurement. Falcon's own benchmark measures Falcon under Falcon's own published conditions and compares against nothing.

---

## Open-Source Survey

Candidate projects were identified on GitHub and measured via REST API on 2026-09-29.

| Project | Stars | Forks | Last Push | Created | License | Notes |
|---------|-------|-------|-----------|---------|---------|-------|
| healenium/healenium | 167 | 34 | 2026-03-31 | 2021-10-07 | Apache-2.0 | Only project with meaningful adoption signals and sustained history. Java/Selenium/Appium-centric, PostgreSQL-backed (S-16). |
| paulocoliveira/playwright-auto-heal | 2 | — | 2025-09-30 | — | No license | — |
| nagaqualizeal/playwright-self-heal-agent | 0 | — | 2026-09-16 | — | No license | — |
| Karthick-1501/playwright-agent | 0 | — | 2026-04-26 | — | No license | — |
| qosha1/healing-playwright | 0 | — | 2025-05-07 | — | Apache-2.0 | — |
| davidTharwat23/playwright-locator-self-healing | 0 | — | 2026-09-29 | 2026-09-29 | MIT | Created and pushed same day as research. |
| anshi43/autonomous-playwright-healer | 0 | — | 2026-09-29 | 2026-09-29 | No license | Created and pushed same day as research. |

**Honest reading, stated as measurement not judgment:** Healenium is the only project in this set with meaningful adoption signals and a sustained history. Every Playwright-specific project found has 0-2 stars, and two of them were created on the day of this research (2026-09-29). Low stars do NOT prove a project is unmaintained; creation date alone does not prove a project will not mature. This is not a completeness claim about GitHub — only a statement of what was found in reviewed sources.

**Conclusion:** **No established, widely-adopted open-source Playwright self-healing library was found meeting adoption or maturity signals in reviewed sources.** Recorded as "none found", not "none exists". Falcon's realistic open-source peer is Healenium (Selenium/Appium, Java-centric, PostgreSQL-backed per S-16), not a Playwright equivalent.

---

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

**RR-1 — Undated sources.** Sources S-01, S-02, S-05, S-07, S-09 record "last-updated: not stated on page". No secondary freshness check was attempted. Acceptable for an internal gate; must be closed before external publication.

**RR-2 — Quote audit scope.** Quoted text was audited for internal consistency only, because the reviewer has no web tools. This is weak-confidence clearance on summary accuracy, not a strong one.

**RR-3 — mabl technical documentation.** All mabl technical claims remain UNVERIFIED due to HTTP 403 access to four official help center pages. This is an accepted permanent limitation. No Falcon differentiation claim rests on mabl's absence; each capability is independently verified on another vendor's documentation.

**RR-4 — CLI test enumeration.** `scripts/healing/review.js` behavior was verified by direct reading; specific test names in `cli.check.cjs` were not individually enumerated. Treat as PARTIAL evidence on that subsection.

**RR-5 — HealingTrust implementation details.** Items on HealingTrust caps (200/500), eviction mechanics, and rejection-index behavior were not independently re-derived under this dispatch's turn budget; they were verified by direct code reading only.
