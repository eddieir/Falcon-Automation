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

1. **Auditable healing.** Falcon is the only one of these where an AI-inferred locator is *quarantined
   pending human approval* rather than silently trusted (Phase 8). That is the single most common
   objection to AI-assisted QA, and Falcon answers it by design.
2. **Coverage without authorship.** Falcon crawls a live app and generates the suite. No recording
   session, no production traffic, no test authoring.
3. **You own it.** Open source, self-hostable, no per-seat billing, no DOM leaving your network
   (Phase 14 closes the last dependency here).
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
CI green, 308 `node:test` + 30 Playwright, 94.79% statement coverage, zero open CodeQL alerts.

**Defects found.** These are the backlog the phases below are built around:

| # | Severity | Defect | Addressed by |
|---|---|---|---|
| D1 | Critical | A `broken` scenario (fails every time) can be quarantined in one click. No classification guard in `FlakinessTracker.quarantine()`, none on `POST /flakiness/quarantine`, and `renderFlaky()` renders `broken` rows with a working Quarantine button. Verified: quarantining a 3/3-failing scenario made a genuinely failing run exit 0. Contradicts the module docblock and README. | Immediate fix |
| D2 | Critical | Flaky detection is inert in CI. `data/` is never cached between runs, and each scenario runs once per run against a 3-sample minimum, so every scenario in CI is permanently `new`. Nothing classifies, `flakyDetected` never fires, local quarantines never reach CI. | Phase 11 |
| D3 | Critical | `falcon.js` discards the crawler's results — it re-navigates to root and generates for that page only. Its own header comment claims otherwise. | **Phase 10** |
| D4 | Major | `_evictLeastRecentlyUsed()` sorts on `lastUsed` with no exemption for quarantined entries. Verified: quarantine + 600 new scenarios → decision gone, failures block again, nothing logged. | Phase 11 |
| D5 | Major | A sometimes-missing `type`/`select` target is marked `skipped`, and `skipped` is never recorded — so the textbook flake shape classifies as `stable`, 0% fail rate. | Phase 11 |
| D6 | Major | `DashboardAuth.check.js`'s socket rate-limit assertion fails ~18% of runs (2 of 11): `xhr poll error` from the overloaded polling transport masks the limiter's own message. Hard step in the `test` job. | Immediate fix |
| D7 | Major | `HealingTrust.pending` and `.decisions` have no cap or eviction, nor does `quarantine_decisions.json`. 5,000 decisions → 1,500,329 bytes, full-file rewrite per decision, read synchronously at require time. `LocatorStore` stayed capped at 500 through the same test. | Phase 12 |
| D8 | Major | State saves are a plain `writeFile`, not temp+rename, and `_loadJson` recovers from corruption to empty with no log line — silently voiding the entire review queue or every quarantine. | Phase 11 |
| D9 | Minor | Rejection memory is written to disk and surfaced nowhere: not by `recordPending`, no route, not in `review.js list`. README claims otherwise. | Phase 12 |
| D10 | Minor | `reports/test-report.json` and 38 `allure-report/` files are tracked despite being gitignored; the tree goes dirty on every run. | Immediate fix |
| D11 | Minor | Four false doc claims: a `continue-on-error: true` that isn't in `ci.yml`; a demo regeneration recipe whose frame paths don't match; `review.js list` described as filtered when it isn't; Project Structure tree omits `tests/regression/`. | Immediate fix |
| D12 | Minor | `recordPending` resets an existing description to `""` when the caller omits one; double-quarantine appends a duplicate ledger row. | Immediate fix / Phase 12 |

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
    uiIssues: [ /* ExploratoryAI issues */ ],
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
2. Run `ClickExplorer.explore()` from the entry page to discover the frontier. Take
   `clickExplorer.visitedPages`, normalize each URL (strip hash, strip trailing slash, preserve
   query), and dedupe.
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
   - `ExploratoryAI.detectUIIssues()` (guarded; non-array → `[]`, matching current `falcon.js`)
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

`tests/regression/browser.spec.js` (added specs, real Chromium against `page.setContent` fixtures):

- a two-page fixture where both pages share a nav bar produces one nav scenario, not two
- per-page results aggregate correctly into the run total
- a page that 404s is recorded `unreachable` without failing the sweep

`tests/regression/reporting.check.cjs`: `deduped` is a valid status, excluded from every tally, and
does not affect the exit code.

### Acceptance criteria

1. `node falcon.js --url=<multi-page site>` tests every discovered page, bounded, in one run.
2. `test-report.json` contains a `coverage` block and a per-page breakdown.
3. Shared-chrome scenarios are deduplicated, and the count is reported rather than hidden.
4. Every page not tested appears with an explicit reason.
5. `--single-page` reproduces pre-Phase-10 behaviour exactly.
6. One dead page cannot abort a sweep.
7. Full local suite green; CI green on the real Actions run.

---

## Phase 11 — Guarantees that survive CI

**Closes:** D2, D4, D5, D8.

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

A quarantine made locally demonstrably applies on the next CI run; the D5 fixture classifies `flaky`;
the D4 fixture retains its decision; no state file can be truncated by an interrupted write.

---

## Phase 12 — Decisions that can't rot

**Closes:** D7, D9, D12, and the roadmap's own stated next item.

### Why

Both gates create queues and nothing makes anyone empty them. An unreviewed Tier 3 fix pays the LLM
bill again on every run, forever, in silence. A quarantine has no route back, so the list only grows.
Both ledgers grow without bound.

### Competitive angle

This is the phase that turns "human-in-the-loop" from a feature into a discipline. No competitor has
this because no competitor exposes the decision at all — but a review queue nobody empties is exactly
how good governance features die in practice, and Falcon should be the tool that refuses to let that
happen quietly.

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

---

## Phase 13 — Run history and trend

### Why

A QA manager's real question is "are we getting better or worse?" Falcon cannot answer it. The
dashboard is live-only and evaporates when the process exits; `test-report.json` is overwritten every
run. Phase 9 gave per-scenario history; there is nothing at suite level.

### Competitive angle

Mabl and Testim's dashboards are their stickiest feature and the main thing the subscription buys.
Falcon can offer the same trend intelligence as a local artifact the team owns, diffable in the repo,
with no vendor holding the history hostage.

### Implementation specification

- An append-only run ledger (`data/run_history.json`, bounded, one record per run): timestamp, git
  SHA and branch, pages tested, scenario counts by status, heal counts by tier, pending-review depth,
  quarantine count, total duration.
- A trend view in the dashboard that outlives the run, served from the ledger.
- **Trend-level regression detection**, which is the genuinely differentiated part: a rising heal
  rate means the application is drifting underneath the suite. That is a finding about the product,
  not about the tests, and no competitor surfaces it as such. Also flag duration regressions and
  pass-rate decay.
- Export (JSON + CSV) for the reporting a QA lead already has to produce.

### Acceptance criteria

Ten consecutive runs produce a readable trend; a deliberately induced heal-rate spike is flagged.

---

## Phase 14 — Healing without a third party

### Why

Falcon's own flagship demo honestly discloses that 7 of its 8 failures went unhealed for want of an
`OPENAI_API_KEY`. For any evaluator who doesn't set one, the headline feature is inert — and for many
organisations, sending DOM snapshots to a third party is a procurement blocker that ends the
evaluation regardless of how good the tool is.

### Competitive angle

This is the phase with the largest commercial consequence. Testim, Mabl, Functionize and Autify are
all SaaS: your DOM goes to their cloud, full stop. A Falcon that heals well with **no external call
at all**, and can optionally use a self-hosted or Azure-tenanted model when you want the LLM tier, is
deployable inside organisations that cannot legally evaluate any of them.

### Implementation specification

- **Tier 2.5, a deterministic local matcher**, between the locator cache and the LLM. Score every
  candidate element against the failed selector's last-known signature: normalized text, ARIA role,
  accessible name, tag, stable attributes (`data-testid`, `name`, `type`), DOM-path distance and
  geometric proximity. Require a configurable confidence margin between the best and second-best
  candidate, and refuse to act on an ambiguous match — the same "ambiguity is a failure, not a guess"
  rule the existing healer already applies.
- Capture and persist the signature of every element Falcon successfully interacts with, so Tier 2.5
  has something to match against on a later run.
- **Route Tier 2.5 results through the Phase 8 approval gate.** A heuristic guess is still a guess.
- **Pluggable LLM providers**: an adapter interface with OpenAI, Azure OpenAI, and
  OpenAI-compatible/self-hosted endpoints, selected by config. No provider hardwired.
- Publish measured healing rates with and without a key, so the demo numbers stay honest.

### Acceptance criteria

A locator that only Tier 3 could previously resolve is resolved by Tier 2.5 with no network call;
ambiguous matches are refused; the provider adapter passes the same suite against a mock endpoint.

---

## Phase 15 — Parallel execution

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
Phase 10 ──┬── Phase 11 ──┬── Phase 12
           │              ├── Phase 13
           │              └── Phase 15
           └── (Phase 14 is independent and can run in parallel)
```

Phase 10 first: it is the largest gap between what Falcon promises and what it ships, and it
multiplies the data volume every later phase must survive. Phase 11 before 12, 13 and 15: staleness
signals, trend history and parallel workers are all only worth building on state guarantees that
actually hold. Phase 14 touches only the healing chain and can proceed independently at any point.

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
