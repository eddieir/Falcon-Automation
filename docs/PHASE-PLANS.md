# Falcon — Engineering Phase Plans (10 onward)

> **Status:** Phases 1–9 merged. Phase 10 in implementation.
> **Purpose:** the durable, cross-machine engineering plan. `HANDOFF.md` is deliberately untracked
> (it holds local-only internal notes and has been lost once because of that), so everything a future
> session or a different machine needs in order to continue this work lives **here**, in the repo,
> and travels with `git clone`.
> **Companion docs:** [`README.md`](../README.md) for the product story, [`CHANGELOG.md`](../CHANGELOG.md)
> for the per-defect engineering history.

---

## 0. The bar

Every phase below is designed against one standard: **Falcon should not be marginally better than the
alternatives in the space it competes in — it should be in a different category.**

The competitive landscape as it actually stands:

| Tool | What it does | Where it stops |
|---|---|---|
| Testim, Mabl, Autify | ML-weighted "smart locators", automatic self-healing | Healing is silent and proprietary. A rewritten locator is trusted with no human ever seeing it. Closed SaaS. |
| Functionize | NLP-authored tests, self-healing | Same silent-healing trust model; tests still authored one at a time. |
| Applitools | Visual AI, excellent at rendering diffs | Visual only. No functional generation, no healing of interaction logic. |
| QA Wolf | Managed service: humans write and triage your tests | Fundamentally headcount, billed monthly. Not a capability you own. |
| Meticulous | Records real sessions, auto-generates visual assertions | Needs real production traffic first. No coverage for what nobody has used yet. |
| Playwright / Cypress / Selenium | The execution layer | No generation, no healing, no flake intelligence. You write and maintain everything. |

Falcon's structural advantages, which every phase must compound rather than dilute:

1. **Auditable healing.** An AI-inferred locator is *quarantined pending human approval* rather than
   silently trusted (Phase 8). Requiring approval before reuse is **not** a differentiator — Phase
   14's competitive research verified that Katalon and Testsigma both document an approval step of
   their own, so this is table stakes and this file previously claimed otherwise. What Phase 14's
   research did leave standing is narrower and checkable: the decision is deterministic and local
   with no model or network in its path, refusal is a first-class outcome that carries its reason,
   evidence is stored as privacy-safe signatures the operator owns, scope prevents a selector on one
   page authorising a repair on another, and the healing rates are published from a reproducible
   corpus that includes the cases Falcon gets wrong.
2. **Coverage without authorship.** Falcon crawls a live app and generates the suite. No recording
   session, no production traffic, no test authoring.
3. **You own it.** Open source, self-hostable, no per-seat billing, no DOM leaving your network.
   Phase 14 closed the dependency on an external call for healing itself; Phase 17 covers the case
   where a team wants an LLM tier but not a vendor-hosted one.
4. **Results that are true.** Real exit codes, real tallies, quarantine as its own visible bucket —
   not a green check that means "didn't crash" (Phases 6 and 9).

A phase that does not visibly extend one of those four is not worth doing.

---

## 1. Verification baseline

Phases 8 and 9 were independently re-verified on 2026-09-24 against `main` at `c3b90e2`, on three
isolated worktrees, driving real browsers, a real Postgres container and real HTTP requests. Every
finding below was **reproduced, not inferred from reading code**.

**Confirmed working:** Tier 3 never auto-trusts (verified by counting LLM calls across consecutive
runs); approve promotes to Tier 2 with zero further LLM calls; reject never reaches `LocatorStore`;
quarantine genuinely flips the process exit code 1 → 0 while keeping the failure its own bucket;
quarantining one scenario does not mask another regression (`PARTIAL`, exit 1); all eight new
dashboard routes return 401 unauthenticated with zero side effects; prototype-pollution defenses for
`__proto__`/`constructor`/`toString` keys genuinely hold; history caps hold (60 → 20, 700 → 500).
CI green, zero open CodeQL alerts.

**Defects found.** These are the backlog the phases below are built around:

| # | Severity | Defect | Addressed by |
|---|---|---|---|
| D1 | Critical | A `broken` scenario (fails every time) can be quarantined in one click. No classification guard in `FlakinessTracker.quarantine()`, none on `POST /flakiness/quarantine`, and `renderFlaky()` renders `broken` rows with a working Quarantine button. Verified: quarantining a 3/3-failing scenario made a genuinely failing run exit 0. Contradicts the module docblock and README. | **Closed** — Phase 10 follow-up |
| D2 | Critical | Flaky detection is inert in CI. `data/` is never cached between runs, and each scenario runs once per run against a 3-sample minimum, so every scenario in CI is permanently `new`. Nothing classifies, `flakyDetected` never fires, local quarantines never reach CI. | **Phase 12** |
| D3 | Critical | `falcon.js` discards the crawler's results — it re-navigates to root and generates for that page only. Its own header comment claims otherwise. | **Phase 10** |
| D4 | Major | `_evictLeastRecentlyUsed()` sorts on `lastUsed` with no exemption for quarantined entries. Verified: quarantine + 600 new scenarios → decision gone, failures block again, nothing logged. | **Phase 12** |
| D5 | Major | A sometimes-missing `type`/`select` target is marked `skipped`, and `skipped` is never recorded — so the textbook flake shape classifies as `stable`, 0% fail rate. | **Phase 11 (reporting) / Phase 12 (classification)** |
| D6 | Major | `DashboardAuth.check.js`'s socket rate-limit assertion fails ~18% of runs (2 of 11): `xhr poll error` from the overloaded polling transport masks the limiter's own message. Hard step in the `test` job. | **Closed** — Phase 10 follow-up |
| D7 | Major | `HealingTrust.pending` and `.decisions` have no cap or eviction, nor does `quarantine_decisions.json`. 5,000 decisions → 1,500,329 bytes, full-file rewrite per decision, read synchronously at require time. `LocatorStore` stayed capped at 500 through the same test. | **Closed** — Phase 13 |
| D8 | Major | State saves are a plain `writeFile`, not temp+rename, and `_loadJson` recovers from corruption to empty with no log line — silently voiding the entire review queue or every quarantine. | **Phase 12** |
| D9 | Minor | Rejection memory is written to disk and surfaced nowhere: not by `recordPending`, no route, not in `review.js list`. README claims otherwise. | **Closed** — Phase 13 |
| D10 | Minor | `reports/test-report.json` and 38 `allure-report/` files are tracked despite being gitignored; the tree goes dirty on every run. | **Closed** — Phase 10 follow-up |
| D11 | Minor | Four false doc claims: a `continue-on-error: true` that isn't in `ci.yml`; a demo regeneration recipe whose frame paths don't match; `review.js list` described as filtered when it isn't; Project Structure tree omits `tests/regression/`. | **Closed** — Phase 10 follow-up |
| D12 | Minor | `recordPending` resets an existing description to `""` when the caller omits one; double-quarantine appends a duplicate ledger row. | **Closed** — Phase 10 follow-up |
| D13 | Critical | `type` and `select` never reach the healing chain — `AIHealer` heals `click` only. Found by experiment during Phase 10 verification, not by reading code. | **Phase 11** |
| D14 | Critical | A run that verified nothing reports PASSED: a non-click target that isn't visible is `skipped` before the healer is consulted, and zero failures reads as a pass. Reproduced: 2 skipped + 1 passed → PASSED, exit 0. | **Phase 11** |
| D15 | Major | Scenarios keep executing after a navigation has changed the page under them, so they run against a DOM their plan was never generated from. | **Phase 11** |

**Closed in the Phase 10 follow-up (see [CHANGELOG.md](../CHANGELOG.md)):** D1, D6, D10, D11, D12. D1 is enforced in one place — `FlakinessTracker.quarantineEligibility()` — with the route, the CLI and the dashboard all deferring to it, and the rule is "has passed at least once", not "isn't classified `broken`", so an all-failing scenario still under the sample threshold can't be hidden either. The seven remaining defects are carried by the phases named against them; none of them has moved.

**Phase 12 verification:** 491 regression tests passing, 43 browser tests passing, 94.70% statement
coverage, measured on Node 22. Every measurement was performed locally (no remote or mocked calls).
Coverage improved from the pre-Phase-12 baseline of 93.17% statements. The locally-known limitation:
the cache's actual cross-run restore behavior and the hosted GitHub Actions run for the final commit
were not verified (Node 22 is CI's version; local Node was 18.16, incompatible with test runner flags).

---

## Phase 10 — Whole-app coverage

**Closes:** D3.

### Why this is the first phase

Falcon's entire pitch is "you don't have time to write tests for the new pages, so Falcon writes
them." The shipped CLI covers exactly one page. The flagship demo's 184 scenarios across 11 pages
come from `docs/demo/multi-page-axonradar-dashboard-demo.js`, which hardcodes a URL list and loops
manually. The mechanism is proven; it simply is not in the product.

### Competitive angle

Every competitor requires per-test authorship: you record a session (Testim, Autify), you write it
(Playwright, Cypress), you wait for production traffic (Meticulous), or you pay someone (QA Wolf).
Pointing a tool at a URL and receiving a bounded, deduplicated, self-healing suite covering the whole
application — with a coverage map of what it reached and what it deliberately didn't — is not an
incremental improvement on any of them. It is a different offer.

### Implementation specification

**New module: `src/core/SiteSweep.js`**

```js
class SiteSweep {
    /**
     * @param {import('playwright').BrowserContext} context
     * @param {Object} opts
     * @param {number}  [opts.maxPages=20]          Hard cap on pages tested
     * @param {boolean} [opts.sameOriginOnly=true]  Refuse to leave the entry origin
     * @param {number}  [opts.budgetMs=600000]      Total wall-clock budget for the sweep
     * @param {number}  [opts.pageTimeoutMs=20000]  Per-page navigation timeout
     * @param {boolean} [opts.dedupe=true]          Skip scenarios already run on an earlier page
     * @param {Function}[opts.onEvent]              (name, payload) => void, for dashboard streaming
     */
    constructor(context, opts = {}) {}

    /** @returns {Promise<SweepResult>} */
    async run(entryUrl) {}
}
```

`SweepResult`:

```js
{
  entryUrl: string,
  pages: [{
    url: string,
    status: "tested" | "skipped" | "unreachable",
    reason?: string,                 // present when status !== "tested"
    scenariosGenerated: number,
    scenariosDeduplicated: number,
    results: [ /* TestRunner result objects */ ],
    uiIssues: [ /* DOMIssueScanner issues */ ],
    durationMs: number
  }],
  coverage: {
    pagesDiscovered: number,
    pagesTested: number,
    pagesSkipped: number,
    pagesUnreachable: number,
    scenariosGenerated: number,
    scenariosDeduplicated: number,
    budgetExhausted: boolean
  }
}
```

**Sweep algorithm**

1. Navigate to `entryUrl` in a fresh page; record it as page 1 of the frontier.
2. Discover the frontier two ways, and union them. **As built, the `href` harvest does nearly all
   the work** — this differs from the original plan and is the reason the phase functions at all:
   - Read every `a[href]` off the entry page (capped at 500 anchors). A site's navigation already
     names its own pages, and the `href` IDL property resolves them absolute.
   - Run `ClickExplorer.explore()` and take `clickExplorer.visitedPages`. This was the original
     plan's only mechanism, but `ClickExplorer` discovers pages by *clicking* the first five
     text-bearing elements, which on a real site typically returns the entry page and nothing
     else. Against axonradar it contributes one page where the harvest finds thirty.

   Normalize every URL (strip hash, strip trailing slash, preserve query) and dedupe.
3. Filter the frontier: drop cross-origin URLs when `sameOriginOnly`; drop non-HTTP(S) schemes
   (`mailto:`, `tel:`, `javascript:`); keep insertion order so the entry page is always first.
4. Truncate to `maxPages`. Everything dropped is recorded as `status: "skipped"`, `reason: "max-pages"`
   — **never silently discarded**, since "what Falcon deliberately didn't cover" is part of the
   coverage story.
5. For each remaining URL, on its own `page` from the shared context:
   - `goto(url, { waitUntil: "load", timeout: pageTimeoutMs })`; on failure record
     `status: "unreachable"`, `reason: error.message`, and continue — one dead page must never abort
     the sweep.
   - `emit("pageStart", { url, index, total })`
   - `DOMIssueScanner.detectUIIssues()` (guarded; non-array → `[]`, matching current `falcon.js`)
   - `TestGenerator.generateTestScenarios()`
   - Apply deduplication (below)
   - `new TestRunner(page, testPlan).executeTest()`
   - `emit("pageComplete", { url, summary })`, then close the page
   - Check the budget; if exhausted, mark every remaining URL `status: "skipped"`,
     `reason: "budget-exhausted"`, set `coverage.budgetExhausted = true`, and stop.
6. Return the aggregate.

**Deduplication**

A navigation bar present on 11 pages currently generates 11 identical scenarios. Dedupe signature:

```js
`${scenario.action}::${scenario.locator}::${scenario.value ?? ""}`
```

The first occurrence runs. Later occurrences are **not executed** and are recorded on their page as
`{ name, status: "deduped", firstRunOn: <url> }`. `deduped` is a reporting-only status: it is counted
in `coverage.scenariosDeduplicated`, excluded from the pass/fail tally, and never written to
`FlakinessTracker`. `--no-dedupe` disables it entirely.

Rationale for a conservative rule: deduping on `action + locator + value` only collapses scenarios
that are byte-identical instructions. It cannot collapse two genuinely different interactions.

**`falcon.js` changes**

- Replace steps 2–4 with a `SiteSweep` call.
- New flags: `--max-pages=N`, `--budget-ms=N`, `--no-dedupe`, `--single-page` (restores pre-Phase-10
  behaviour verbatim, for anyone depending on it), `--allow-cross-origin`.
- Aggregate every page's results into one array for `ReportManager`, and pass `coverage` and `pages`
  through to the report.
- **Correct the false header comment** (it already claims per-page generation).

**`ReportManager` changes**

- Accept and persist `coverage` and `pages` in `test-report.json`.
- Accept `"deduped"` as a valid status, excluded from `passed`/`failed`/`skipped`/`quarantined`
  tallies and from the pass/fail branches, exactly as `quarantined` is handled.
- Print a coverage line: `Pages: 11 tested, 2 skipped (max-pages) | Scenarios: 184 generated, 93 deduped`.

**Dashboard changes**

- Handle `pageStart` / `pageComplete` events.
- A "Coverage" panel: pages tested vs discovered, a per-page row with its pass/fail counts, and an
  explicit list of what was skipped and why.

**Demo scripts**

`docs/demo/multi-page-axonradar-dashboard-demo.js` and `multi-page-axonradar-demo.js` become thin
wrappers over `SiteSweep`, so the demo and the product are provably the same code path.

### Test plan

`tests/regression/sitesweep.check.cjs` (new, `node:test`, no browser — inject a fake context):

- frontier normalization: hash stripping, trailing slash, query preservation, duplicate collapse
- cross-origin filtering on and off; `mailto:`/`tel:`/`javascript:` always dropped
- `maxPages` truncation records skipped pages with `reason: "max-pages"`
- budget exhaustion marks the remainder and sets `budgetExhausted`
- an unreachable page yields `status: "unreachable"` and the sweep continues
- dedupe signature collapses identical scenarios and records `firstRunOn`; `dedupe: false` disables it
- `deduped` results never reach `FlakinessTracker`

`tests/regression/browser.spec.js` (added specs, real Chromium against routed `sweep.test` fixtures):

- a three-page fixture is swept end to end and per-page results aggregate into the run total
- the nav bar repeated on all three pages is deduplicated, with every deduped row carrying `firstRunOn`
- a page returning a real HTTP 404 is recorded `unreachable`, not `tested`, and surfaces as a failure
- a page returning 500 does not abort the sweep; the pages after it are still tested

The 404 case matters specifically because Playwright's `goto()` **resolves** on an HTTP error
response rather than rejecting — an error page arrives at the sweep looking exactly like a healthy
one. That is a browser-level truth a fake page cannot model, which is why it needs a real-Chromium
spec and not only a unit test.

`tests/regression/reporting.check.cjs`: `deduped` is a valid status, excluded from every tally, and
does not affect the exit code.

### Acceptance criteria

1. `node falcon.js --url=<multi-page site>` tests every discovered page, bounded, in one run.
2. `test-report.json` contains a `coverage` block and a per-page breakdown.
3. Shared-chrome scenarios are deduplicated, and the count is reported rather than hidden.
4. Every page not tested appears with an explicit reason.
5. `--single-page` reproduces pre-Phase-10 behaviour. **As built, the tested pipeline is verbatim
   — verified side by side against `main` across all six CLI modes, with identical exit codes and
   identical `result`/`tests`/`uiIssues`/`healingEvents`/`summary` fields — but the report also
   gains the `coverage` block and lists the crawl's other pages as `skipped`/`single-page`. That
   is a deliberate choice: narrowing the sweep is a decision, and the report should say what it
   cost rather than pretend those pages were never seen.**
6. One dead page cannot abort a sweep.
7. Full local suite green; CI green on the real Actions run.

---

## Phase 11 — Healing for every action, and no silent green

**Closes:** D13, D14, D15 (below), and the reporting half of D5.

### Why this comes before everything else

Phase 10's verification asked a question nobody had asked in this form: if a locator changes, does
the system understand it and heal it? The answer was established by experiment — the real
`SiteSweep`, a three-page local site, a button renamed after the plan was generated, and a mock
OpenAI endpoint so every Tier 3 call could be counted.

For a `click`, the answer is yes, and cleanly: Tier 1 exhausted its three adaptive retries, Tier 2
had nothing stored, Tier 3 inferred the new selector from the live DOM and clicked it, the scenario
passed, and the fix landed in `HealingTrust` as pending rather than in `LocatorStore` — the Phase 8
trust gate holds inside a sweep. After approval, the same break healed at Tier 2 with zero LLM calls
for that selector.

For everything else, the answer is no, and the failure mode is the worst one this project recognises:

```
skipped   Fill quantity — Element not visible
skipped   Choose size   — Element not visible
passed    Click buy
LLM calls made: 1        ← only the click reached the healing chain
```

That tally reports **PASSED, exit 0**. A renamed input id does not heal and does not fail. It quietly
removes coverage, and the build stays green over it. Falcon exists to stop exactly that.

### Defects

| # | Severity | Defect |
|---|---|---|
| D13 | Critical | `type` and `select` never reach the healing chain. `TestRunner.runScenario()` calls `page.fill()`/`page.selectOption()` directly inside a bare 3-attempt loop; `AIHealer` exposes healing for `click` only. A locator change on any input silently costs coverage that a click would have kept. |
| D14 | Critical | A run that verified nothing reports PASSED. `executeTest()` marks a non-click scenario whose target isn't visible as `skipped` before the healer is ever consulted, and `ReportManager` treats zero failures as PASSED regardless of whether anything actually executed. Reproduced: 2 skipped + 1 passed → `PASSED`, exit 0. |
| D15 | Major | Scenarios keep executing after the page has changed under them. Once a navigation-type scenario clicks a link, every remaining scenario for that page runs against the new page's DOM. Reproduced: `Navigate: Account` failed only because the browser was already on `/cart`. Pre-existing, but Phase 10 multiplies it — every discovered page now contributes up to three navigation scenarios instead of just the entry page. |

### Competitive angle

Every vendor in the self-healing market advertises healing as a property of the product. In practice
it is a property of each individual interaction, and the ones that get the engineering attention are
clicks. A suite that heals clicks and silently skips inputs is not a healing suite; it is a healing
demo. Falcon's claim is narrower and checkable: the same three tiers, the same trust gate, and the
same audit record for every action type it supports — and when healing genuinely cannot resolve
something, the build goes red rather than quiet.

### Implementation specification

- **Generalise the healer.** `AIHealer` resolves a selector once and then performs the caller's
  action against the resolved selector, instead of three near-copies of `healAndClick`. Tier 2 and
  Tier 3 must perform the *actual* action — `fill`/`selectOption`, not a click, which would otherwise
  report a healed pass for an interaction that never happened. The uniqueness guard (`_matchCount`
  must be exactly 1) applies to every action, not just clicks.
- **The trust gate is unconditional.** A Tier 3 resolution for a `type` or `select` goes to
  `HealingTrust.recordPending()` and never straight into `LocatorStore`, identically to `click`.
  `HealingReport` records which action was healed, so the digest distinguishes "healed a click" from
  "healed a form fill".
- **Delete the silent skip.** A `type`/`select` target that isn't visible reaches the healing chain.
  If the chain can't resolve it, the outcome is `failed`, recorded to `FlakinessTracker` with an
  `AdaptiveRetry.classify()` error type. `skipped` survives only for a genuinely unknown action type.
- **A run that verified nothing is not a pass.** `ReportManager.generateReport()` gains one rule, in
  the shape of the `deduped` rule Phase 10 added: zero passed, zero failed, zero quarantined, with
  everything skipped or deduped, is `NO_TESTS_RUN` and exit 1. What PASSED, FAILED and PARTIAL mean
  for a run that did verify something does not change.
- **Return to the page under test.** `TestRunner` compares the normalised URL before and after each
  scenario (`SiteSweep.normalizeUrl` already exists) and navigates back only when it actually
  changed, so the common case costs no extra page loads. A failed return is a `Logger.warning` and
  does not abort the remaining scenarios.

### Test plan

Real Chromium, because a fake page object cannot model `page.fill()` against a missing element: an
input renamed between generation and execution heals at Tier 3 and the fill lands in the *new* field;
the same break heals at Tier 2 after approval with no LLM call; a `select` heals the same way and the
option is genuinely selected; an unresolvable input fails rather than skips, and appears in
`FlakinessTracker` with an error type; an all-skipped run exits 1; a plan whose second scenario
navigates away still executes its third scenario against the original page.

### Acceptance criteria

A renamed input id is healed exactly as a renamed button id is, with the same trust gate and the same
audit trail. No combination of skips can produce a green run. No scenario executes against a page its
plan was not generated from. The existing suite stays green, with any test that encoded the old
behaviour updated to the corrected contract and called out as such.

---

## Phase 12 — Guarantees that survive CI

**Status:** ✅ Delivered.

**Closes:** D2, D4, D8. (D5's reporting half is closed by Phase 11; what remains here is the classification half.)

### Why

A human-in-the-loop gate that only functions on a laptop is not a gate. Phase 9 is currently inert in
CI, quarantine decisions evaporate under LRU eviction, the most common flake shape is invisible to
the classifier, and corrupt state silently voids every decision ever made. Phase 10 makes this
urgent: many more pages means many more scenarios, evictions and decisions.

### Competitive angle

Mabl and Testim detect flakes server-side because they own the infrastructure. Falcon has to earn the
same reliability on someone else's CI runner — and in exchange offers something they don't: the flake
history and the quarantine decisions are *yours*, in your repo, auditable and diffable.

### Implementation specification

- **Persist state across CI runs.** Cache and restore `data/scenario_history.json`,
  `data/quarantine_decisions.json`, `data/healing_pending.json` and `data/healing_decisions.json`
  with `actions/cache@v4`, branch-keyed with a `restore-keys` fallback, mirroring the existing
  `reports/baselines` step added in Phase 3 for precisely this reason.
- **Reach the sample minimum in CI.** A scenario needs ≥3 samples to classify. Add an opt-in
  `--repeat=N` to `falcon.js` (and a CI job input) that re-executes the generated plan N times within
  one run, so a single CI run can produce a verdict without depending on cached history. Record each
  repetition as a distinct sample.
- **Record unavailability as signal (D5).** Introduce an `unavailable` outcome for a `type`/`select`
  target that is not visible, distinct from a deliberate `skipped`. `unavailable` is recorded by
  `FlakinessTracker` and counts as a failure for classification purposes while remaining its own
  reporting bucket. A target that is sometimes present and sometimes not must classify as `flaky`.
- **Protect human decisions from eviction (D4).** Split rolling history from decision state:
  `_evictLeastRecentlyUsed()` must never evict an entry with `quarantined === true` or any entry
  referenced by the decision ledger. If the cap is reached and every entry is protected, log loudly
  rather than silently dropping.
- **Durable writes (D8).** All four state files move to write-temp-then-`rename`. `_loadJson`'s catch
  must `Logger.warning` with the file path and the parse error, and write the corrupt file aside as
  `<name>.corrupt-<timestamp>` before starting fresh, so an operator can recover it.

### Test plan

Restoring a cached `scenario_history.json` into a fresh checkout yields the same classifications;
`--repeat=3` produces a verdict from one run; an alternating present/absent target classifies `flaky`
rather than `stable`; a quarantined entry survives 600 new scenarios; a truncated state file produces
a warning, a `.corrupt-*` sidecar, and a clean start.

### Acceptance criteria

State persists across CI runs that share the same `ref_name` (successive pushes to the same branch,
or successive runs of the same pull request), but a pull request's cache lineage is separate from
its base branch's (state cannot transfer from a developer laptop into CI, as the Actions cache can
only restore what a previous Actions run saved); the D5 fixture classifies `flaky` using the new
`unavailable` outcome; the D4 fixture retains its quarantine decision under 600 new scenarios; no
state file can be truncated by an interrupted write; corrupt state produces a `.corrupt-*` sidecar
with the original bytes.

### Decisions for Phase 13 and beyond

- `--repeat` upper bound: 50. Beyond this, wall-clock cost becomes prohibitive and a scenario
  becomes practically indistinguishable from "broken" in terms of classification signal.
- Budget coverage with `--repeat`: the wall-clock budget (`--budget-ms`, default 600000) is checked
  between pages and covers all repetitions of a page collectively. With `--repeat=3` each page takes
  roughly three times as long, so the budget can be exhausted sooner and later pages reported as
  `skipped` with reason `budget-exhausted`.
- Cache scope and limitation: state is persisted across CI runs via `actions/cache@v4` on the same
  `ref_name` (branch or PR). `data/locator_store.json` is deliberately not cached to preserve the
  integrity of CI healing behavior. A pull request's first run has no prior CI history to restore;
  `--repeat` is the mechanism to produce a same-run verdict on that first run.
- Known limitation carried to Phase 13: if eviction cannot bring the total under the cap because too
  many entries are protected by quarantine decisions, the protected pool itself becomes unbounded
  (D7 scope).

---

## Phase 13 — Decisions that can't rot

**Status:** ✅ Implemented. Pending review and merge authorization.

**Closes:** D7, D9, D12, and the roadmap's own stated next item.

### Why

Both gates create queues and nothing makes anyone empty them. An unreviewed Tier 3 fix pays the LLM
bill again on every run, forever, in silence. A quarantine has no route back, so the list only grows.
Both ledgers grow without bound.

### Competitive angle

This is the phase that turns "human-in-the-loop" from a feature into a discipline. Whether any
competitor surfaces queue staleness was **not** established by the reviewed public documentation, so
nothing here claims they do not — absence of evidence in a vendor's docs is not evidence the vendor
lacks the capability. The defensible point stands on its own: a review queue nobody empties is
exactly how good governance features die in practice, and Falcon should be the tool that refuses to
let that happen quietly.

### Implementation specification

- **Staleness thresholds.** Configurable age limits for an unreviewed pending fix and an unreviewed
  flaky scenario. A new `scripts/review/status.js` exits non-zero when anything is past threshold, so
  it can be wired into CI as a soft warning or a hard gate (`--fail-on-stale`).
- **Quarantine rehabilitation.** Surface any quarantined scenario that has passed its last N
  consecutive runs as a rehabilitation candidate, in the CLI, the API and the dashboard panel.
  Never auto-unquarantine — that would repeat exactly the mistake Phase 8 exists to prevent.
- **Real rejection memory (D9).** `recordPending` consults the decision ledger; a fix previously
  rejected is flagged `previouslyRejected: { count, lastRejectedAt, lastRejectedBy }` and rendered
  distinctly everywhere it appears. `review.js list` prints it.
- **Cost visibility.** Track Tier 3 invocations per pending selector since `firstSeen` and display
  the running count, so the price of not deciding is legible.
- **Bound both ledgers (D7).** A `MAX_DECISIONS` ring buffer keeping the newest N, and an LRU cap on
  `pending`, mirroring `LocatorStore`'s Phase 5 discipline. Eviction from a ledger must be logged.
- **Fix D12.** Fall back to the existing description; make double-quarantine idempotent in the ledger.

### Acceptance criteria

A pending fix older than threshold fails `status.js --fail-on-stale`; a re-suggested rejected fix is
flagged; neither ledger exceeds its cap under 10,000 decisions.

### Shipped

**1. Staleness thresholds.** Three optional env vars with integer validation (1-3650 or 1-20, reject invalid
with a message naming the setting):
- `HEALING_PENDING_STALE_DAYS` (default 14): age from `firstSeen`
- `FLAKY_UNREVIEWED_STALE_DAYS` (default 14): age from `flakySince`
- `REHAB_CANDIDATE_WINDOW` (default 5): consecutive passes to surface a candidate
Boundary rule: stale iff `age > threshold` (on-threshold is NOT stale).

**2. Review status CLI (`scripts/review/status.js`)** with fixed exit-code contract:

| Situation | Exit |
|---|---|
| Nothing stale | 0 |
| Something stale, no flag | 0 (findings printed) |
| Something stale, with `--fail-on-stale` | 1 |
| Invalid configuration | 2 |
| Unrecognized argument | 3 |
| State files missing/empty | 0 |
| State file corrupt | 0 (recovered to empty, warned, original preserved) |

Accepts exactly one flag, `--fail-on-stale`, and deliberately no file-path flag.

**3. CI wiring — documented choice.** The check runs in the `test` job in soft-warning mode (no flag,
no `continue-on-error`). NOT a hard gate. Reasons, both verified: the state cache is branch-scoped
and restores only from the same `ref_name` — on a fresh PR branch the cache misses, making a gate
vacuous; and the `test` job's current red means "a test failed", so gating would give one status two
unrelated meanings. Promotion to hard-gate (`--fail-on-stale`) is appropriate once the check runs in
a `main`-scoped or scheduled context under its own check name. Note: as of this phase, the ci.yml
step itself may not yet be present — the choice is documented here; if absent, that is a separate
owner's responsibility.

**4. Quarantine rehabilitation.** A quarantined scenario whose most recent `REHAB_CANDIDATE_WINDOW`
recorded outcomes **from after it was quarantined** (timestamp at or after `quarantinedAt`) have all
passed surfaces as a rehabilitation candidate in:
- `scripts/flakiness/review.js rehab` (read-only subcommand)
- `GET /flakiness/rehabilitation` dashboard route
- Dashboard "Flaky tests" panel
- `npm run review:status` output

Never auto-unquarantined. A scenario needs at least N recorded outcomes to be a candidate. Any failure
resets the counter. `unavailable` (target not visible) counts as failure.

**5. Rejection memory (closes D9).** A pending fix now carries `previouslyRejected: { count, lastRejectedAt, lastRejectedBy }`,
rendered distinctly by the CLI and dashboard. When a selector-suggestion pair is proposed again,
the history is flagged. **Documented limitation worth stating:** rejection memory is computed by folding
the decision ledger, capped at 500 rows. Once a rejection ages out, the pair can be proposed again as
if new. This is a deliberate consequence of binding both ledgers to a single source of truth.

**6. Tier 3 invocation visibility.** A pending fix carries `tier3Invocations`, counted at the real Tier 3
call boundary — every call to the selector-inference step, including calls that return nothing or whose
healed action fails. Displayed by the CLI and dashboard. **Terminology is binding: INVOCATION COUNT, never
cost.** No dollar figure, token count, or pricing data is captured or displayed.

**7. Bounded state (closes D7).** Both decision ledgers are newest-N ring buffers at 500 rows; pending
healing entries are LRU-capped at 200 by `lastSeen`. Eviction is logged. Ledgers and pending queue are
capped on load and persisted to disk, so an already-oversized file is genuinely repaired rather than
re-trimmed on every start. Newest 200 pending entries by `lastSeen` survive; entries without usable
`lastSeen` sort oldest (deterministic). Every eviction is logged by selector identity.

**8. D12.** Already fixed before this phase (decision ledger double-writes and description resets); now
protected by explicit regression tests. Do NOT describe D12 as newly fixed in Phase 13.

---

## Phase 14 — Evidence-based locator matching and scoped memory — IMPLEMENTED, UNDER REVIEW

Promoted ahead of run history, and ahead of the provider-adapter work it was originally bundled
with, because the healing chain's weakest link was not its reporting: between a locator cache that
only replays a selector it was handed and an LLM tier that needs a key and a network, there was
nothing. An evaluator without `OPENAI_API_KEY` got two tiers, and the second only worked if the
exact replacement had been approved earlier.

### What shipped

A deterministic local tier between the cache and the model. No model, no network and no randomness
in the decision path — `CandidateMatcher` has no `require` statement at all, which is enforced as a
structural property rather than a convention.

- **Scoped identity.** An entry is keyed by application, origin, pathname, action and the original
  selector, serialised through `JSON.stringify` so no delimiter can be smuggled through a selector
  to collide two identities. A selector on one page therefore cannot authorise a repair on another.
  `about:`, `data:` and `file:` are refused outright, because their origin is the literal string
  `"null"` and every such page would otherwise share one scope.
- **Signatures that are not the DOM.** Identity-bearing attribute values are stored as salted
  HMAC-SHA256 hashes from a fixed allow-list. Accessible name and own text stay as bounded
  plaintext, because fuzzy similarity cannot run on a hash. Never stored: input or textarea values,
  passwords, hidden tokens, cookies, storage, authorization data, raw `outerHTML`, full DOM,
  scripts, complete forms, URL credentials, raw queries, unrestricted `data-*`, unbounded text.
- **Three trust states.** `trusted` evidence comes from a successful action with the developer's
  own selector or explicit approval of the current scoped proposal. A score alone grants no trust. A candidate the
  matcher accepts becomes `unproven` and is promoted solely by an explicit durable decision tied to
  its proposal ID. The approved selector and decision channel remain in bounded audit history. `revoked`
  stops reuse immediately while keeping the prior signature and an attributed revocation history,
  and regains trust only through a fresh ground-truth pass, never by re-approving the evidence that
  was rejected.
- **Refusal as a first-class result, carrying its reason.** Below the confidence floor, inside the
  margin, action-incompatible, contradictory role, ambiguous stable identity: each is reported
  distinctly and persisted to the healing log, and each falls through to the LLM exactly as an empty
  cache would. A refusal never fails a run.
- **A published mutation benchmark**, scored against ground truth authored into each fixture rather
  than against whether a click threw.

### Acceptance criteria — validation required

A locator that previously only the LLM tier could resolve is resolved locally with no network call;
ambiguous matches are refused; repeated identical inputs produce identical rankings and identical
score contributions across separate process invocations.

### Measured results, including the unflattering ones

The expanded corpus contains 27 cases. Run `npm run healing:benchmark` for current counts,
per-case expected outcomes, false heals, repeat agreement, selector resolution and measured bytes
of an actual persisted memory snapshot. Ground truth is fixture-authored, and these results do not
establish a healing rate for arbitrary applications. Runtime regression tests separately cover
actual actions, scope isolation and review persistence. No release verdict is implied by corpus
results alone.

### ADR — why a deterministic tier rather than a stronger Tier 3

**Context.** Tier 2 replays a stored selector gated on it resolving exactly one element; Tier 3 asks
a model. Between them sat the whole class of change where the element is plainly still present and
recognisable — a regenerated id, an inserted wrapper, reworded copy — but no approved replacement
exists yet.

**Decision.** Insert a deterministic, local, evidence-based tier, and give it the authority to
refuse. Keep it free of I/O so its verdict is reproducible from its inputs alone, and expose per-
dimension score contributions so a human can see why a candidate won rather than being told that it
did.

**Alternatives rejected.** Tuning Tier 3's request to the model leaves the key and the network on
the critical path, and a model's answer is not reproducible evidence. Auto-persisting any candidate
above a confidence threshold was rejected outright: it is the one design that converts a scoring
mistake into permanent trust, and it contradicts the approval gate Phase 8 exists to provide.
Lowering Tier 2's uniqueness requirement would have widened an existing tier by weakening the only
check it has.

**Consequences, accepted.** `MIN_CONFIDENCE` 0.85 and `WINNER_MARGIN` 0.15 are provisional and
uncalibrated; the benchmark is the instrument for calibrating them, and it already caused two
changes to the matcher during this phase. Refusals remain expected, and the LLM tier still earns its place. Scoring sits behind a structural rule — a stable key shared by two candidates
identifies neither, so that case refuses regardless of score or margin — specifically so the
protection survives any later recalibration of those two constants.

### Acceptance criteria

The phase's 70 acceptance criteria are registered in
`docs/phase-14-acceptance-criteria.json`, each with the file that implements it and the test that
asserts it. `tests/regression/p14-traceability.check.cjs` checks the register itself: all 70 ids
present with no gaps, every implementation path resolving to a real file, and every named test
genuinely existing in the file that claims to hold it, with a negative control proving the check
can fail. 68 are carried by executing tests. Two are not, and say why in their own words: AC-57
is a property of GitHub Actions' restore-step semantics rather than of anything this project
decides, and AC-63 ("no P0/P1 remains") is a process criterion evidenced by review verdicts.

The register exists because its absence hid a real defect. The criteria lived only in the phase
brief, so nothing could check whether any one of them had an implementation at all, and AC-18 did
not — evidence was captured after the interaction, which for a click that navigates described an
element on the page the browser had already moved to. Writing the register down is what surfaced
it.

### Honest limitations

- **The salt sits with the hashes it protects** unless `FALCON_LOCATOR_SALT` is set. Low-entropy
  values therefore remain brute-forceable offline by anyone who can read the file. The runtime says
  so on first use. Hashed values are **not** irrecoverable, and nothing in this project may claim
  they are.
- **Redaction of accessible name and text is a shape heuristic, not a guarantee.** A short
  OTP-style secret is not caught by it, and matches are replaced in place, so a meaningful prefix
  can survive (`SUPER-SECRET-…` becomes `SUPER-[REDACTED]`). The phase's own tests assert this
  rather than hiding it.
- **Concurrent writers are detected, not merged.** An exclusive adjacent lock covers the durable
  digest check and atomic replacement. A stale instance fails rather than overwriting new state;
  restart it to reload. Recover a crashed lock manually only after verifying its owning process has
  exited. Review decisions are installed only after persistence succeeds.
- **Review is scoped and revision-bound.** Legacy `LocatorStore` and `HealingTrust` approvals do not
  authorise automatic replay. Fresh scoped evidence and the current proposal ID are required.
  Rollback requires the current revision. See the CLI examples in [README](../README.md#scoped-healing-and-review)
  and the [correction ADR](architecture/phase-14-correction-decisions.md).
- **Locator memory is local-only.** `data/locator_memory.json` is gitignored and is deliberately
  **not** cached by CI, so it never crosses a branch boundary. The exact-key cache entry can never
  hit on restore, so every restore falls back to a branch prefix — which would let one branch
  inherit another's approved evidence. Revisit only alongside a same-branch-provenance check inside
  the store itself, never as a CI configuration change.
- **It acts only on elements carrying a stable identifier.** With no `id`, `data-testid`, `data-test` or
  `data-qa` in the stored evidence it refuses with `insufficient_identity_evidence` before
  scoring. This is a limit of the evidence model, not an omission: with no identifier in the stored
  snapshot nothing can separate "the real element changed" from "a different element still matches
  the old snapshot," and attempting it produced a wrong-element action on ordinary markup during
  review. Applications without test ids will see this tier decline and Tier 3 do the work.
- **Refusing on ambiguity is a suppression channel.** A second element sharing the stored
  `data-testid` forces a refusal regardless of how well the real element scores, so anyone able to
  inject a visible, action-compatible element into the page under test can disable this tier at
  will. Assessed as an acceptable trade: the outcome is a refusal that falls through to Tier 3,
  never a wrong-element action, and arbitrary DOM injection into the application under test is a
  far larger problem on its own. Recorded so that "no fix needed" is not mistaken for "not
  considered."
- **This is matching, not comprehension.** Scores compare captured signals. No general DOM
  understanding is involved.
- **A quarantined row is kept as metadata, not as its contents.** A row that fails validation is
  replaced on first load by a digest and the reason it was set aside, and that replacement is
  written back, so the original content is gone from the file from then on. This is deliberate —
  keeping raw historical rows would reintroduce exactly the unbounded, page-derived values this
  phase forbids storing — but it does mean "preserved for inspection" is narrower than it sounds:
  an operator can see that a row was rejected and why, and cannot recover what it held. The one
  exception is a file that will not parse at all, whose bytes are kept in a `.corrupt-*` sidecar.
  A file whose whole envelope is unreadable is reported separately, through a warning naming the
  reason and through `envelopeStatus()`, because it parses into no rows and so has nothing to
  quarantine — without that it was indistinguishable from an empty store.
- **A DOM mutation between the read and the interaction is not detected.** The element is read
  immediately before the interaction, so a re-render in that window — under 150 ms, and without a
  URL change, since a navigation is handled correctly — can leave the stored evidence describing
  the element that was behind the selector a moment earlier rather than the one finally acted on.
  Reproduced during the final security review with a page double that flips the element between the
  two steps. Neither ordering closes this: capturing after the action raced the same mutation from
  the other side. `_matchCount` guards the Tier 2, Tier 2.5 and Tier 3 paths but deliberately not
  Tier 1, which acts on the selector the developer wrote. Assessed P3 and left open rather than
  papered over: closing it means re-reading identity after the action and comparing, which is a
  slice of its own.
- **Evidence capture is bounded, so it can be skipped.** The element is read before the interaction
  it describes, because a click that navigates has already replaced the document by the time it
  returns — reading afterwards described whatever the landing page put behind the same selector and
  keyed it to the landing page's URL, which recorded a trusted fact about an element nobody had
  interacted with and left the page the click happened on with no evidence at all. Reading first
  puts that query in front of the interaction, so it is capped (150 ms) and every failure resolves
  to "no evidence": on a slow page an interaction can legitimately produce no evidence at all,
  and this tier then declines later for want of a stored signature. Losing evidence is always
  preferred to delaying the interaction or recording a fact about the wrong element.
- **This phase makes an existing `node --test` flake much likelier on single-file runs.** The
  runner intermittently dies with `Unable to deserialize cloned data due to invalid or unsupported
  version.`, with a stack entirely inside `node:internal/test_runner`'s IPC frame parser; the
  signature is a varying total test count. It is pre-existing and reproduces on this phase's base
  commit. Measured on `tests/regression/core.check.cjs`, which this phase does not modify:
  2/10 runs failed at base `11657cb`, 9/10 at `b333584`. The cause is not output volume — that file
  emits byte-for-byte the same 246 lines on both commits — and is unexplained; do not repeat the
  Phase 8 console-silencing remedy here on the assumption that it is. Two things bound the impact.
  Run under plain `node` instead of `node --test` and the same file passed 10/10, so the tests and
  the code under them are sound and the fault is in the runner's IPC layer. CI never invokes a
  single file: `test:coverage` runs the whole directory in one process, and on that measure this
  phase is no worse than its base (2 failures in 4 full-suite runs at base, 1 in 4 at `b333584`,
  both consistent with the pre-existing rate). So the practical cost is local iteration on one
  file, with a working alternative. Investigating the runner itself was out of scope for this phase
  and is not claimed to be done.

---

## Phase 15 — Run history and trend — DELIVERED

The detailed plan of record is [phase-15-plan.md](phase-15-plan.md): definitions, run record,
architecture and ADR, trend rules with worked examples, CLI, dashboard and serve mode, CI, security
requirements SEC-01 to SEC-15, acceptance criteria, test strategy, delivery plan, release gates
and rollback.

### Why

A QA manager's real question is "are we getting better or worse?" Falcon cannot answer it. The
dashboard is live-only and evaporates when the process exits; `test-report.json` is overwritten every
run. Phase 9 gave per-scenario history; there is nothing at suite level, and no run records the
commit it tested.

### Competitive angle

Mabl and Testim's dashboards are their stickiest feature and the main thing the subscription buys.
Falcon can offer the same trend intelligence as a local artifact the team owns, with no vendor
holding the history. `data/` is not committed, so the durable forms are the exported JSON/CSV in the
CI artifact and the ledger itself in a per-branch cache.

### Implementation specification (summary)

- A bounded run ledger, `data/run_history.json` (≤500 runs, ≤1 MB), one allow-listed record per
  `node falcon.js` run: commit and branch, repeat count, outcome counts, coverage, heals and failed
  heal attempts by tier, review-queue depth, quarantine count, duration, and an incomplete marker for
  crashed runs. No URLs, selectors, page text, error messages, scenario names or identities.
- **Trend-level regression detection**, the most valuable part: a rising heal rate means the
  application is drifting underneath the suite. Also pass-rate decay, duration regression, review
  backlog and quarantine growth. Rules use the median and MAD of the previous 10 complete runs on the
  same branch with absolute floors, so a stable baseline does not flag a trivial change. Flags are
  advisory and never change a run's exit code.
- A History panel in the dashboard, and `npm run dashboard` to serve it without a run.
- `history:list`, `history:export` (JSON/CSV, formula-safe) and `history:check [--strict]`.

### Acceptance criteria

Ten consecutive runs produce a readable trend; a deliberately induced heal-rate spike is flagged.
The full set of criteria is in the detailed plan and will be enforced by
`docs/phase-15-acceptance-criteria.json` and its traceability check.

---

## Phase 17 — Pluggable LLM providers

Renumbered and reduced. This was "Healing without a third party", and the larger half of it — a
deterministic local tier that heals with no external call — shipped as Phase 14. What remains is the
provider question, which is a procurement blocker rather than a capability gap, so it no longer
needs to sit ahead of run history or parallel execution.

### Why

For many organisations, sending DOM snapshots to a third party ends an evaluation regardless of how
good the tool is. Phase 14 means such an organisation now gets three working tiers with no external
call at all, rather than two. This phase is about the remaining case: teams that *do* want an LLM
tier but cannot use a vendor-hosted one.

### Implementation specification

- An adapter interface with OpenAI, Azure OpenAI, and OpenAI-compatible/self-hosted endpoints,
  selected by config. No provider hardwired.
- Keep the Phase 8 approval gate unchanged: whichever provider answers, an inferred selector is
  still a guess and is still reviewed before reuse.
- Publish measured healing rates with and without a key, so the demo numbers stay honest. Phase 14's
  benchmark is the mechanism; this phase adds the provider dimension to it.

### Acceptance criteria

The adapter passes the same suite against a mock endpoint; no provider is reachable except the one
configuration selects.

---

## Phase 16 — Parallel execution

**Status: in review, not merged.** Branch `phase-16/parallel-execution`. Hosted CI for head 42fac1a: Falcon CI run 37792596841 succeeded on all seven jobs (see docs/phase-16-operations.md).

### Why

184 scenarios one at a time is a demo, not a pipeline. Phase 10 makes this acute: covering every page
multiplies the work, and sequential execution is where it stops being viable.

### Competitive angle

Table stakes against every competitor — but the interesting part is that Falcon's three state
singletons were all written for a single process, so doing this properly means solving concurrent
access to healing and flake state. Get that right and Falcon scales across runners while keeping the
audit trail coherent, which the SaaS tools achieve only by centralising it on their servers.

### Implementation specification

- A worker pool across pages and scenarios, each worker with an isolated browser context.
- CI sharding by page, with deterministic shard assignment.
- **Cross-process-safe state.** `HealingTrust`, `FlakinessTracker` and `LocatorStore` all perform
  whole-file read-modify-write behind an *in-process* promise queue — a lost-update race the moment
  there are two processes. Options to evaluate: an advisory lock file with a fair queue, per-worker
  journals merged at run end, or an append-only log compacted on read. The journal-merge approach is
  the current favourite because it is lock-free and naturally fits sharded CI.
- Deterministic report merging, so a sharded run produces byte-identical aggregate output regardless
  of worker completion order.

### Acceptance criteria

A sweep runs N× faster at N workers within measurement noise; no state file loses a write under
concurrent workers; a sharded CI run and a single-runner run produce identical aggregate reports.

---

## Sequencing

```
Phase 10 ── Phase 11 ──┬── Phase 12 ──┬── Phase 13 ── Phase 14 (delivered)
                       │              ├── Phase 15
                       │              └── Phase 16
                       └── (Phase 17 is independent and can run in parallel)
```

Phase 10 first: it is the largest gap between what Falcon promises and what it ships, and it
multiplies the data volume every later phase must survive. Phase 11 next, and ahead of everything
else, because it is the only item on this list that can currently produce a green build over lost
coverage — no amount of later work is worth building on top of a run that can report PASSED without
having verified anything. Phase 12 before 13, 15 and 16: staleness signals, trend history and
parallel workers are all only worth building on state guarantees that actually hold.

Phase 14 was then taken out of order, ahead of run history, because the gap it closed was in the
healing chain rather than in the reporting on top of it: an evaluator with no `OPENAI_API_KEY` had
two usable tiers, and the second only fired when an approved replacement already existed. Phase 17
is what remains of the phase Tier 2.5 was originally bundled with, and it is a procurement concern
rather than a capability gap, so it can proceed independently at any point.

---

## Working agreement

- One branch per phase off `main`, one PR per phase. Align with `main` by **merge**, never by
  rewriting history — a force-push on a branch with an open PR has already cost this project a PR.
- Every phase is implemented by a full production team: implementation, independent code review,
  independent QA verification against real browsers/databases, and documentation.
- Nothing merges on a green checkmark alone. Verify the actual GitHub Actions run, and verify real
  behaviour locally — reading the code and assuming it is fine has repeatedly missed real defects on
  this project.
- This file is the durable plan of record. Update it as phases land, so a session starting on a
  different machine can pick up from a clean `git clone`.
