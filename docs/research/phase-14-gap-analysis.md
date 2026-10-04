# Phase 14 Gap Analysis — Gate 0 (Solution Architect)

Repo: Falcon-Automation, branch `phase-14/evidence-based-locator-memory`, HEAD `11657cb1`.
Inputs: EP-1 (competitor sources), EP-2 (Falcon baseline, this revision), EP-3 (owner binding
constraints), EP-4/P14-06 (QA testability verdict). No production code was written or run to
produce this document. All "current Falcon state" statements are EP-2's verified findings at
this revision, not aspirational Phase 14 behaviour.

Status vocabulary follows EP-1: VERIFIED / MARKETING CLAIM / NOT FOUND IN PUBLIC DOCUMENTATION /
UNKNOWN / FETCH BLOCKED. "Not found" is never restated here as "competitor lacks it."

## Classification legend

- **BEHIND** — one or more verified competitors already document this; Falcon does not have it.
- **PARITY-TABLE STAKES** — building it only matches what verified competitors already document.
- **DIFFERENTIATED** — supportable by comparable benchmark evidence today. (Not used below: no
  Falcon-side benchmark exists yet, so this label cannot be honestly applied to anything in this
  document per EP-3's prohibition on superiority claims without evidence.)
- **POTENTIALLY DIFFERENTIATED** — no verified competitor source documents the same combination;
  becomes a real claim only once implemented and tested per QA's conditions.
- **UNPROVEN** — the underlying technical claim is contested or depends on a design/test control
  that does not exist yet (most often D3's privacy claim and D1's no-network claim).
- **OUT OF SCOPE** — required for Phase 14 compatibility/operations but not a competitive claim.

## Capability table

### 1. Element signature capture
- Current Falcon state: none. EP-2 item 17: zero hits for "signature" in the healer code; the
  Tier 3 DOM snapshot is built, used once for the LLM prompt, and discarded — never persisted.
- Strongest verified competitor: S-01 BrowserStack ("securely stores key information about that
  element — including its locator, nearby attributes and the structure of the DOM") and S-02
  Healenium (persists the successful locator as a baseline).
- Gap: Falcon has no persisted representation of "what this element looked like" at all today.
- Proposed response: versioned, scoped signature schema (AC-05, 16-21).
- Acceptance evidence: AC-16, 17, 18, 19, 20, 21.
- Cost/risk: moderate implementation; high risk if the allow-list is not enforced by a schema
  test (see capability 5).
- Phase 14: MUST (EP-3 MUST IMPLEMENT list).
- Classification: **BEHIND** — competitors already capture element context; Falcon does not.

### 2. Deterministic, local, evidence-based candidate scoring (D1)
- Current Falcon state: Tier 2 exists but is selector-REPLAY, not signature matching — it
  re-checks a previously human-approved literal selector string for `count()===1` (EP-2 item 18).
  No comparison of stored identity/content against a live candidate exists.
- Strongest verified competitor: none directly comparable. Testim's "locator score" (S-07) and
  Healenium's "LSC algorithm" (S-02) both compute some kind of match/health number, but neither
  page discloses whether the computation is local, network-free, or deterministic across runs.
- Gap: no evidence-vs-candidate scorer of any kind exists in Falcon today.
- Proposed response: a separate, statically analyzable Tier 2.5 module producing a score with
  inspectable per-evidence contributions, with no OpenAI/network reference in its import graph.
- Acceptance evidence: AC-22, 23, 51, 68 (determinism); QA's static import-graph check plus
  dynamic network-stub-with-key-present check are both required — an absent-API-key test alone
  does not satisfy this (P14-06 Section 1, D1).
- Cost/risk: high — this is the core new algorithm. Risk: correctness (false heals) if the
  scoring rules are not exercised against the boundary/adversarial fixtures QA specifies.
- Phase 14: MUST.
- Classification: **POTENTIALLY DIFFERENTIATED**, **UNPROVEN** until the static+dynamic no-network
  tests exist and pass. No competitor source confirms or denies a local-only architecture, so
  "differentiated" cannot be claimed yet — only "not verified elsewhere," which is a different,
  weaker statement.

### 3. Numeric confidence score exposure
- Current Falcon state: none. EP-2 item 19: zero hits for "confidence"; Tier 3 outputs only a
  bare selector string or `null`.
- Strongest verified competitor: S-07 Testim, a disclosed numeric locator score with an acted-on
  70% threshold.
- Gap: no score of any kind is computed or shown today.
- Proposed response: expose winning score, runner-up score, margin, and evidence contributions
  (AC-29, 45, 47).
- Cost/risk: moderate; mostly a serialization/UI concern once capability 2 exists.
- Phase 14: MUST.
- Classification: bare score existence = **PARITY-TABLE STAKES** (Testim already does this).
  The full contribution breakdown (winner/runner-up/margin/evidence, always shown, tied to a
  mandatory-approval gate rather than an auto-apply threshold) is **POTENTIALLY DIFFERENTIATED**
  — no verified competitor source documents exposing a contribution breakdown at this level of
  detail while also refusing to ever auto-apply.

### 4. Refusal as a first-class outcome, reason exposed (D2)
- Current Falcon state: none as a named outcome type. The only existing "gate" is the uniqueness
  check (`count===1`, EP-2 item 7) — structural, not a confidence/ambiguity refusal.
- Strongest verified competitor: S-13 Virtuoso (below-threshold candidates are held back from
  auto-apply and offered as a proposal, not silently applied) and S-08 Functionize (an "adjoint
  model" escalates as "self-heal validation failed" rather than proceeding on high uncertainty).
- Gap: Falcon has no tagged-outcome refusal path or named reasons today.
- Proposed response: a tagged result type (`accepted`/`refused`/`no_candidate`) with a reason
  enum (below-threshold, insufficient-margin, action-incompatible, tie, weak-evidence-only),
  surfaced identically on dashboard and CLI.
- Acceptance evidence: AC-24-29, 42, 43, 67.
- Cost/risk: moderate; risk is in the adversarial fixtures (two-equally-plausible-targets,
  contradictory-role/action) actually refusing rather than picking arbitrarily.
- Phase 14: MUST.
- Classification: the concept of "hold back and don't silently apply on low confidence" =
  **PARITY-TABLE STAKES** (Virtuoso, Functionize). The specific named-reason taxonomy exposed
  identically on two surfaces (dashboard + CLI) is **POTENTIALLY DIFFERENTIATED** — not verified
  as documented anywhere in EP-1 at this granularity.

### 5. Privacy-safe signature, no raw DOM, no entered values, no credentials (D3)
- Current Falcon state: no persisted signature exists at all. The one related control that exists
  today (Tier 3 DOM snapshot: interactive-tag-only query, strips `value` on `type="password"`,
  hard-truncates at 6000 chars) has **no test** for either control (EP-2 item 8; QA P14-06
  Section 1/D3 flags this as a real, currently-unguarded gap that Phase 14 should close, not
  defer again, since it touches the exact code path this phase extends).
- Strongest verified competitor for CONTRAST: S-02 Healenium, whose docs state persistence of
  "reference selector / healing / report / DOM." S-02's caveat that PostgreSQL was "NOT named on
  this page" is superseded: S-16 (Healenium's official overview page) VERIFIES the storage engine
  as PostgreSQL and states its purpose verbatim as "store reference selector / healing / report /
  DOM" (https://healenium.io/docs/overview). The "stores DOM" characterization is confirmed;
  Falcon's D3 contrast on persisted DOM is now cited against verified evidence. S-02's other
  UNKNOWNs (auto-trust vs. human review) remain unchanged.
- Gap: no signature schema, no allow-list enforcement, no adversarial secret test exist yet.
- Proposed response: an explicit allow-listed schema (named structural fields only — tag, role,
  a fixed whitelist of normalized attributes, structural position); a schema/shape test asserting
  no other keys exist; an adversarial secret-planting test that plants a real-looking secret in a
  password value AND in an unrelated attribute/text node, then greps the serialized signature and
  the on-disk JSON file for the literal string, asserting zero occurrences; a size-bound test.
- Acceptance evidence: AC-16, 20, 21, 59, 62.
- Cost/risk: moderate to build, but this is explicitly the claim "most likely to be attacked"
  per the assignment. Honest technical position (see the companion technical comparability
  review): a bounded, allow-listed structural projection is genuinely not the same thing as raw
  DOM, but only if "raw" keeps doing real work in every published sentence — an unqualified "no
  DOM" claim would be inaccurate, since a DOM-path-shaped signature is DOM-derived information by
  definition.
- Phase 14: MUST, and QA's adversarial tests plus closing the existing untested
  password-stripping/truncation gap should both be required exit conditions for this phase, not
  optional follow-ups.
- Classification: **UNPROVEN**. The distinction from raw-DOM storage is technically real but
  depends entirely on allow-list enforcement and adversarial-secret tests that do not exist yet.
  Until those tests exist and pass, "no raw or verbatim DOM — a bounded, schema-enforced projection"
  is a design intent, not a proven property.

### 6. Scoped identity (app + normalized origin + normalized page + action + selector) (D4)
- Current Falcon state: LocatorStore keys on the bare selector string alone, with no page,
  action, or application scoping (EP-2 item 2). Two different pages sharing a selector string
  share the same cache entry today.
- Strongest verified competitor: none. No EP-1 source discusses per-page/per-action/per-origin
  scoping at all — this is an evidence gap (nothing found), not a verified absence.
- Gap: complete — no scoping dimension of any kind exists in the current key.
- Proposed response: scoped identity key with normalized origin/page, URL credential/fragment/
  sensitive-query exclusion (AC-01-04, 44).
- Acceptance evidence: AC-01-04, 44 (login/.submit vs checkout/.submit isolation fixture).
- Cost/risk: moderate; this is also a security control (R2 in QA's risk ranking — a cross-scope
  leak is a correctness AND security regression), so the adversarial URL-credential fixture
  (AC-04) is load-bearing, not optional polish.
- Phase 14: MUST.
- Classification: **POTENTIALLY DIFFERENTIATED**. No competitor evidence either confirms or
  denies this exists elsewhere, so it cannot be called differentiated (no comparable benchmark)
  or parity (nothing verified matches it) — it stays a candidate until implemented and tested.

### 7. Rollback of approved locator decisions
- Current Falcon state: none. EP-2 item 21, confirmed by grep: no inverse/remove API exists on
  LocatorStore or HealingTrust; the only "undo" today is manual on-disk file editing.
- Strongest verified competitor: S-06 testRigor, explicit stated UI rollback ("you can always...
  rollback to the previous version if necessary").
- Gap: complete — wholly new surface area.
- Proposed response: an attributable rollback operation that writes an audit decision, stops
  future reuse of that specific alternative, and does not silently delete decision history.
- Acceptance evidence: AC-12.
- Cost/risk: moderate; risk is conflating "rollback" with "delete" (EP-3 explicitly requires the
  distinction — QA flags this in R9).
- Phase 14: MUST.
- Classification: **PARITY-TABLE STAKES** — testRigor already documents this.

### 8. Run-scoped-versus-persisted trust split (Tier 2.5 contract)
- Current Falcon state: no Tier 2.5 exists. Today's binary is Tier 1/2 (auto, no approval) vs
  Tier 3 (requires approval to promote) — EP-2 item 10.
- Strongest verified competitor: S-09 Momentic — the closest documented analogue found in EP-1
  ("The resolution applies to the current run and never edits the test" vs. triage that "delivers
  a repair only when it changes the test or a module").
- Gap/assessment: close on the conceptual axis (run-scoped vs. persisted) but not identical in
  mechanism — see the companion technical comparability review for the full analysis: Momentic's
  persisted output is a source-code change (PR by default) with implied-not-stated review, while
  Falcon's persisted output is a locator-memory promotion with an explicit, mandatory approval
  object, and Falcon does not rewrite source tests at all (EP-3 MUST NOT list).
- Acceptance evidence: AC-30-38.
- Cost/risk: this is the phase's central trust-contract logic; highest-ranked risk in QA's plan
  (R1 — silent trust escalation would make Falcon worse than table-stakes competitors).
- Phase 14: MUST.
- Classification: **PARITY** on the conceptual split (consistent with EP-3's own recorded Gate 0
  outcome), not a novel concept. The mandatory-approval, non-source-rewriting mechanism is
  **POTENTIALLY DIFFERENTIATED** relative to Momentic's PR-based, approval-implied model.

### 9. Published reproducible mutation benchmark, all four rates including failures (D5)
- Current Falcon state: none. No benchmark corpus, harness, or rate reporting exists today.
- Strongest verified competitor: none publish a comparable methodology. The only competitor
  numbers found (BrowserStack's unqualified 40% build-failure reduction, S-15; mabl's marketing
  95%, S-04) are explicitly ruled unusable as benchmarks — no stated population, methodology, or
  time period.
- Gap: complete; also the phase's only quantitative claim, so its absence is the highest-stakes
  gap in this table.
- Proposed response: author-controlled, ground-truth-labeled mutation corpus; harness comparing
  Tier 2.5's accepted candidate against the fixture's `data-benchmark-ground-truth-id` via DOM
  identity, never "the click did not throw"; per-case outcome log including losses, not just
  aggregates; AC-70 structured (schema-validated) competitor matrix data.
- Acceptance evidence: AC-64-70.
- Cost/risk: high. Correct-heal/false-heal rates are measurable ONLY within this synthetic,
  ground-truth-labeled corpus (EP-4 binding) — this bound must be stated next to every published
  rate, permanently, not as a temporary caveat.
- Phase 14: MUST, bounded to protected-replay option (C) — see decision below.
- Classification: **POTENTIALLY DIFFERENTIATED** on methodological transparency (no competitor
  publishes an equivalent reproducible corpus+methodology in the reviewed sources), **UNPROVEN**
  until built, run, and shown reproducible (AC-68).

### 10. CI state-persistence policy (approved cache scope)
- Current Falcon state: `data/healing_pending.json` and `data/healing_decisions.json` are cached
  across CI runs on the same branch; `data/locator_store.json` is explicitly excluded by comment
  (EP-2 item 14) so Tier 2 behaviour cannot silently drift via cache restoration.
- Gap: Phase 14 adds new signature state that needs the same explicit policy decision.
- Acceptance evidence: AC-54-58.
- Phase 14: MUST (operational compatibility), but this is not a competitive claim.
- Classification: **OUT OF SCOPE** for this gap analysis — an internal compatibility requirement,
  not a differentiation candidate.

## Sixteen required answers

**1. Would the original Phase 14 plan produce parity or leadership?**
Parity at best, on several axes independently, not leadership as the brief originally framed it.
Approval-before-reuse, confidence-gated non-automatic-application, refusal-on-low-confidence,
rollback, and the run-scoped-vs-persisted split are all independently documented on at least one
verified competitor (table above). What is not documented anywhere in EP-1 is the specific
*combination* Falcon proposes: mandatory approval with no confidence-based bypass, plus an
exposed deterministic per-repair score with contribution breakdown, plus a strictly local
no-network decision path, plus a bounded allow-listed signature, plus a published reproducible
ground-truth benchmark. That combination is a real candidate for differentiation, but it is
unverified until implemented and tested — nothing in the plan as written justifies a leadership
claim today.

**2. Which competitors already expose confidence?**
Testim exposes a numeric locator score with an acted-on threshold (S-07, VERIFIED). Virtuoso
computes and gates on a confidence level internally but does not display a number to users
(S-13, VERIFIED) — computed-but-hidden, not "exposed."

**3. Which already maintain element history?**
BrowserStack, via the requirement of at least one prior successful run to capture element context
(S-01/S-15). Healenium, persisting the successful locator as a baseline for later runs (S-02).
Testsigma, via a recorded "locator trace" of the full sequence the engine worked through (S-05).

**4. Which already refuse low-confidence heals?**
Virtuoso withholds automatic application below its confidence threshold and offers a proposal
instead (S-13) — a soft refusal (defer to human), not a hard no-action refusal. Functionize's
adjoint-model check escalates as "self-heal validation failed" on high uncertainty rather than
proceeding (S-08). Neither is documented as an unconditional hard-refusal-with-named-reason in
the way Falcon proposes.

**5. Which already show repair evidence?**
BrowserStack (per-build healed locator and reason, S-01/S-15); Healenium (report with screenshot
and feedback button, S-02); Katalon (Insights table: broken/proposed locator, recovered-by,
screenshot, S-03); Testsigma (before/after locator, healing method, duration, locator trace,
S-05); Testim (labeled revision, Revision History, Locators panel, S-07).

**6. Which already support rollback?**
testRigor, explicitly ("you can always see the differences in the UI and rollback to the
previous version if necessary," S-06). Testim's revision-history mechanism is reversible in
practice but is not documented on the reviewed page as a named "rollback" affordance.

**7. Which already update source tests or create PRs?**
BrowserStack (MCP direct-apply to test files, or automatic GitHub PR for SDK users, S-01/S-15).
Momentic (PR is the default delivery option for a persisted triage repair, among several
configurable options, S-09).

**8. Which already operate locally or self-hosted?**
Healenium is the one clear case — open-source, self-hosted, with its own PostgreSQL backend and
real adoption signals (167 stars, created 2021, not archived, per the GitHub measurement in
S-14). Every other verified source (BrowserStack, Katalon, mabl, Testsigma, testRigor, Testim,
Functionize, Momentic, Autify, Virtuoso) is a SaaS/cloud platform on the pages reviewed. No
self-host claim for those was found — recorded as NOT FOUND, not as absent, since self-host
support may exist and simply not be covered on the specific pages read.

**9. Which already support Playwright?**
BrowserStack, explicitly, though marked "presently in limited capacity" and with `findElements`
healing labelled Beta (S-01). No other verified source in EP-1 names Playwright support on the
page reviewed. S-14's GitHub measurement found no established, widely-adopted open-source
Playwright-specific self-healing library (every Playwright-named project measured had 0-2 stars,
two created the same day as the research) — Falcon's realistic open-source peer is Healenium
(Selenium/Appium-centric), not a Playwright equivalent.

**10. Which automatically trust repairs (no approval)?**
Testim (auto-improve replaces the degraded locator directly once the 70% threshold is crossed,
no approval mentioned, S-07). Virtuoso, above its internal confidence threshold (S-13). mabl
claims autonomous updates with human involvement "only when clarification is needed" — this is a
MARKETING CLAIM (S-04), not independently verified technically. BrowserStack's page describes
healing as applied automatically during the run and does not mention a pre-reuse approval step —
recorded as NOT FOUND IN PUBLIC DOCUMENTATION, not as confirmed automatic-without-approval
(S-01/S-15).

**11. Which already require approval?**
Katalon, explicitly (Self-healing Insights tab, "Approve" to save or "Discard" to reject, S-03).
Testsigma, explicitly ("Approve as Primary," "Ignore," or "Update," S-05).

**12. Is Falcon's pre-reuse human approval genuinely unique?**
No. Answered honestly and directly: Katalon and Testsigma both document mandatory-or-prominent
human approval before a healed locator persists, and EP-3's own recorded Gate 0 outcome already
states this is table stakes. The approval requirement in isolation is not a differentiator and
must not be claimed as one. What has not been found documented anywhere in EP-1, and so remains
a real (unproven) candidate, is the specific combination: approval that cannot be bypassed by any
confidence threshold (unlike Virtuoso and Testim, which both auto-apply above a threshold),
paired with an exposed deterministic score and contribution breakdown (unlike Katalon and
Testsigma, which show broken/proposed locators but no computed score) and a local, no-network
decision path. That combination, not the approval gate alone, is the only defensible candidate,
and it is unproven until built and tested.

**13. Is Falcon's proposed scoring model meaningfully different?**
From Testim's locator score: yes, in kind, not just degree. Testim's number is a longitudinal
degradation/health score tracked across runs for a given locator, acted on when it crosses a
static threshold over time. Falcon's proposed confidence is a point-in-time match score computed
fresh at repair time from stored evidence against live candidates for a single decision — it does
not track a locator's health across a history, does not decay, and (per EP-3's determinism
requirement, AC-23/68) must be identical for identical inputs rather than accumulated. Treating
these as the same kind of number would misrepresent both. From Virtuoso's confidence: not
determinable — Virtuoso's algorithm and threshold are undisclosed and the score itself is never
shown, so no like-for-like technical comparison is possible; record as UNKNOWN, not as "similar"
or "different."

**14. What must Falcon implement to be demonstrably better?**
(a) The deterministic, local, no-network matcher proven by both a static import-graph check and
a dynamic network-stub-with-key-present check, not an absent-API-key test. (b) Mandatory approval
with a verified absence of any confidence-based auto-bypass code path. (c) The bounded,
allow-listed signature schema plus adversarial secret-planting tests proving no raw DOM, entered
values, or credentials leak — including closing the pre-existing untested password-stripping and
6000-character-truncation gap in today's Tier 3 snapshot code. (d) Scoped-identity tests proving
cross-page/cross-action isolation, including the URL-credential/fragment/sensitive-query
exclusion adversarial fixture. (e) A published, reproducible, ground-truth-labeled mutation
benchmark reporting correct-heal, false-heal, refusal, and no-candidate rates, including a
per-case log of losses, reproducible to identical output on repeat runs. (f) Rollback that is
attributed, audited, provably stops reuse, and does not delete history. (g) The AC-70 structured,
schema-validated competitor-matrix data file, so "UNKNOWN vs. favourable-to-Falcon" is
machine-checked rather than asserted in prose alone.

**15. What can Falcon not reasonably outperform in one phase?**
Cloud-platform execution breadth (device/browser farm coverage, fleet-scale concurrent
execution, enterprise plan features such as BrowserStack's Pro-gated healing). Healenium's
multi-year production adoption and maturity signal (created 2021, 167 stars, sustained history)
against a brand-new Falcon feature. Any direct quantitative accuracy comparison against a real
competitor number — this is not a "not yet" limitation but a permanent one under protected-replay
option (C): Falcon has no controlled, reproducible access to any competitor's actual accuracy,
and this project's engineering rules forbid uncontrolled third-party access in CI regardless of
phase. Unqualified
marketing-scale numbers (BrowserStack's 40%, mabl's 95%) cannot be "beaten" with a Falcon number,
because the comparison itself is invalid — different, undisclosed methodology and population.

**16. What claims must Falcon avoid after Phase 14?**
Concrete prohibited-claims checklist, to be run against every externally published sentence:
- "Falcon is the only tool that requires approval before reuse" — false; Katalon and Testsigma
  already document this.
- "Falcon has the most/highest accuracy," "best self-healing framework," "safer than every
  competitor," "100 levels above competitors," or any unqualified superlative.
- Any specific accuracy/reduction percentage not measured on Falcon's own published benchmark
  under explicitly stated conditions and limitations (AC-69).
- "Zero false heals" / "no false heals" / "eliminates test maintenance."
- Any statement that a named competitor "lacks" a feature because it was not found in the
  documentation reviewed (this applies to every NOT FOUND / UNKNOWN row in EP-1, mabl's technical
  claims in particular).
- "Falcon stores no DOM," unqualified. Must always read "no raw or verbatim DOM — a bounded,
  schema-enforced projection" attached in the same sentence, per the D3 analysis above.
- Any claim that Falcon's confidence score is "more accurate than" or "better than" Testim's or
  Virtuoso's — the metrics are not the same kind of number, or the comparator is undisclosed.
- "Falcon guarantees multi-process write safety" or "atomic rename provides concurrent-writer
  safety" — explicitly prohibited by EP-3; unimplemented per EP-2 item 22.
- Any claim that Falcon's benchmark shows Falcon "beating" a named competitor — out of bounds
  under protected-replay option (C); the benchmark can only report Falcon's own numbers under
  Falcon's own conditions.
- "Falcon performs general DOM or visual understanding" — explicitly out of scope (EP-3 MUST NOT
  list).
- "Production-ready" or "production-grade superiority" while any P0/P1 defect remains open.
- Citing BrowserStack's unqualified 40% figure or mabl's 95% marketing figure as a benchmark,
  target, or comparison point (S-15 ruling, binding).

## Protected-replay decision — Solution Architect position

**CONCUR with option (C), benchmark-only.** This aligns with QA's P14-06 position and the
Product Owner's recommendation, and the reasoning stands independently from a design point of
view, not only a testability one:

- Options (A) full protected replay and (B) bounded local validation subset both require some
  execution surface against a competitor's actual product. That is by definition an uncontrolled
  third-party system, which this project's engineering rules forbid relying on in CI ("avoid
  uncontrolled third-party
  sites in CI"). No design change in Falcon's own architecture resolves that constraint — it is
  an external access problem, not an implementation problem.
- Option (D) defer leaves D5 unmeasured, and D5 is a Must per EP-3 and the phase's only
  quantitative claim; deferring it defeats the phase's own stated purpose.
- Option (C) is also the only option consistent with D1's design principle that the Tier 2.5
  decision path stays local and network-free: a benchmark that depended on live competitor
  execution would introduce exactly the kind of external dependency D1 is built to avoid, even if
  that dependency lived in the benchmark harness rather than the runtime decision path. Keeping
  the benchmark scoped to Falcon's own corpus and conditions keeps the whole system's trust
  boundary consistent, not just the runtime.
- Consequence for the design handed to Developer/QA/DevOps: the benchmark harness must not
  accept or require any competitor account, API key, or network target as an input. Its only
  external dependency should be the locally-authored fixture corpus.

