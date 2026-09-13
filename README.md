# Falcon-Automation — AI-Powered Test Automation Framework

> **Status:** Active development · Phase 3 competitive features on `feat/phase-3-competitive-features`.

---

## Overview

Falcon is an open-source test automation framework built on Playwright that integrates a genuine LLM-powered self-healing engine.  Unlike most "AI testing" tools that use static heuristics or hardcoded fallback maps, Falcon's three-tier healing chain falls back to a live OpenAI inference call when all attribute-based alternatives have been exhausted.

**Core capabilities:**

- **UI automation** via Playwright (Chromium, Firefox, WebKit)
- **Three-tier self-healing** — direct attempt (AdaptiveRetry) → LocatorStore → LLM inference (gpt-4o-mini)
- **Autonomous UI exploration** — recursive crawler (ClickExplorer) + DOM-based defect detection (ExploratoryAI)
- **AI test generation** — PageAnalyser maps the DOM; TestGenerator creates scenarios; TestRunner executes them with full healing
- **Visual regression testing** — pixel-level screenshot comparison with diff images and cumulative summary
- **Real-time live dashboard** — express + socket.io stream every test event to a browser UI at `localhost:3000`
- **Accurate reporting** — structured pass/fail/skip tallying + Allure HTML report via `allure-playwright`
- **Database testing** — PostgreSQL via `pg` Pool with full mTLS support
- **CI/CD ready** — GitHub Actions pipeline with Allure report upload

---

## Project Structure

```
Falcon-Automation/
├── src/
│   └── core/
│       ├── AIHealer/
│       │   ├── AIHealer.js          # Three-tier self-healing engine (Tier 3: OpenAI)
│       │   ├── HealingReport.js     # Audit log for all healing events
│       │   ├── LocatorStore.js      # Persisted alternative locators (Tier 2 cache)
│       │   ├── AdaptiveRetry.js
│       │   └── AIAnalyser.js
│       ├── BaseTest.js              # Dependency injection base class
│       ├── BrowserManager.js        # Playwright wrapper (chromium/firefox/webkit)
│       ├── ClickExplorer.js         # Recursive autonomous crawler
│       ├── ConfigManager.js         # JSON + env config singleton
│       ├── DBClient.js              # PostgreSQL pool with mTLS support
│       ├── ErrorHandler.js
│       ├── ExploratoryAI.js         # DOM-based UI defect detector
│       ├── Middleware.js
│       ├── ReportManager.js         # Accurate pass/fail/skip reporting
│       └── TestRunner.js            # Scenario + exploratory test orchestrator
├── tests/
│   └── ui/
│       └── LoginTest.js             # End-to-end login with post-login assertions
├── utils/
│   └── Logger.js                    # Async file logging (non-blocking)
├── data/
│   └── locator_store.json           # Persisted LocatorStore entries
├── reports/                         # Generated at runtime
│   ├── execution.log
│   ├── test-report.json
│   ├── exploratory_test_results.json
│   └── healing_logs.json
├── falcon.js                        # Main entry point
├── package.json
└── .env                             # Local secrets (not committed)
```

---

## Installation

### 1. Clone

```sh
git clone https://github.com/eddieir/Falcon-Automation.git
cd Falcon-Automation
```

### 2. Install dependencies

```sh
npm install
npx playwright install chromium firefox webkit
```

### 3. Configure environment variables

Copy the template and fill in your values:

```sh
cp .env.example .env
```

```ini
# Browser
BROWSER=chromium           # chromium | firefox | webkit
HEADLESS=true

# OpenAI — required for Tier 3 AI healing
OPENAI_API_KEY=sk-...

# PostgreSQL — required only for DB tests
DB_HOST=your_db_host
DB_PORT=5432
DB_USER=your_db_user
DB_PASS=your_db_password
DB_NAME=your_db_name
DB_SSL=true                # set to false to disable TLS

# SSL/mTLS — required only when DB_SSL=true and using client certs
SSL_CA_FILE=./certs/ca.pem
SSL_KEY_FILE=./certs/client.key
SSL_CERT_FILE=./certs/client.crt
SSL_REJECT_UNAUTHORIZED=true
```

---

## Running Tests

```sh
# Full pipeline: ExploratoryAI → ClickExplorer → TestRunner
node falcon.js

# Login scenario only
node tests/ui/LoginTest.js
```

---

## Self-Healing Architecture

Falcon's healing engine operates in three tiers, in order:

| Tier | Mechanism | API cost | Speed |
|------|-----------|----------|-------|
| 1 | Direct selector attempt (3 retries, 2 s timeout each) | None | Fast |
| 2 | LocatorStore — alternatives learned from prior runs | None | Fast |
| 3 | LLM inference — live DOM snapshot + OpenAI gpt-4o-mini | ~$0.001/call | ~1–2 s |

Successful Tier 3 results are written back to LocatorStore automatically.  On the next run the same fix is applied via Tier 2 at zero cost.

The healing engine captures a targeted DOM snapshot (interactive elements only, ≤ 6 KB) rather than the full page, keeping inference prompts small and latency predictable.

---

## Phase 1 — Stabilisation Changelog

The following defects were identified through a full code audit and resolved in `feat/phase-1-ai-core-foundation`.  All changes are committed individually with detailed messages.

### AIHealer — Tier 3 was non-functional

**Problem:** `getAlternativeSelector()` contained a two-entry hardcoded dictionary.  No OpenAI call was ever made despite the SDK being installed.  The entire Tier 3 chain was inoperative on any real application.

**Fix:** Replaced the dictionary with a live OpenAI `chat.completions.create()` call using `gpt-4o-mini`, a focused DOM snapshot of interactive elements, and a strictly constrained prompt that returns a raw CSS selector only.  Client is lazy-initialised.  Missing `OPENAI_API_KEY` produces a clear, actionable error.

---

### ReportManager — always reported success regardless of outcomes

**Problem:** `generateReport()` wrote `"result": "Tests Completed Successfully"` unconditionally.  Every test run ever executed by Falcon produced an inaccurate report, making CI results and stakeholder summaries unreliable.

**Fix:** Method now accepts `{ tests, uiIssues, healingEvents }`.  Tallies real `passed` / `failed` / `skipped` counts.  Derives top-level result: `PASSED`, `FAILED`, `PARTIAL`, or `NO_TESTS_RUN`.  Includes wall-clock duration and prints a structured summary to stdout.

---

### ClickExplorer — invalid CSS selectors broke all element interaction

**Problem:** Selectors were built as `button[innerText="Submit"]`.  `innerText` is a JavaScript DOM property, not an HTML attribute — CSS attribute selectors match markup attributes only.  `waitForSelector()` failed on these strings for every element on every real page, making the crawler unable to click anything.

**Fix:** Selectors are now derived from actual HTML attributes in priority order: `data-testid` → `id` → `aria-label` → `name` → `type`.  A `getByText()` text-based fallback handles elements with none of these attributes.  Priority order follows Playwright's recommended locator hierarchy.

---

### TestRunner — ReferenceError on every exploratory run

**Problem:** `executeExploratoryTest()` read `this.uiIssues` and `this.exploredPages`, which are never initialised on the instance.  `logResults()` used `fs` and `path` without importing them.  Any call to the exploratory pipeline threw `ReferenceError` before producing any output.

**Fix:** Added `fs` and `path` imports.  Method signature changed to `executeExploratoryTest({ uiIssues, exploredPages })` — values passed in from the caller (falcon.js) where they are produced.  Report JSON includes a typed summary block alongside raw arrays.

---

### DBClient — duplicate ssl key silently dropped certificate config

**Problem:** The `Pool` constructor contained two `ssl:` keys.  JavaScript overwrites duplicate object keys with the last value, so the second `ssl: { rejectUnauthorized: false }` replaced the block that loaded CA, client key, and certificate from disk.  mTLS was impossible; the driver never received cert data.

**Fix:** SSL config extracted to `_buildSSLConfig()`.  Activates full mTLS when all three cert env vars are set; falls back gracefully with a warning otherwise.  `rejectUnauthorized` defaults to `true`.  `client.release()` moved to a `finally` block to prevent connection leaks on query failure.

---

### Logger — synchronous file I/O blocked the event loop

**Problem:** `fs.appendFileSync()` on every log call stalled the Node.js event loop, degrading test execution time and interfering with Playwright's internal async scheduler.

**Fix:** Log lines are queued and flushed via a chained promise (serialised async writes, no interleaving).  `Logger.flush()` exported for use in teardown hooks.  `reports/` directory created lazily on first write.

---

### LoginTest — false-positive on failed login

**Problem:** The test clicked the login button and immediately logged "✅ Login Test Passed" without checking if the application actually authenticated the user.  A wrong password, network error, or UI regression would produce a green result.

**Fix:** Two post-login assertions added: (1) `waitForURL('**/inventory.html')` confirms the redirect completed; (2) `.inventory_list` visibility check confirms the dashboard rendered.  Both throw descriptive errors on failure.

---

## Phase 1 — Runtime Patch (post-PR fixes)

Four additional runtime defects were discovered when executing the Phase 1 deliverable and are resolved in the same branch.

### BaseTest — wrong ReportManager call signature in teardown()

**Problem:** `teardown()` called `reportManager.generateReport(this.testName)` — passing a plain string to a method whose signature is `generateReport({ tests, uiIssues, healingEvents })`.  The string landed in the `tests` slot and caused the tally logic to produce garbage on every run.  `startRun()` was also never called, so wall-clock duration was always 0.

**Fix:** `setup()` now calls `reportManager.startRun()`.  `teardown()` passes the correct object shape.  `BaseTest` accumulates results in `this._results` so sub-classes can push `{ name, status, duration, error }` entries during execution.

---

### BrowserManager — headless hardcoded to false

**Problem:** `launch()` passed `{ headless: false }` unconditionally, ignoring the `HEADLESS` environment variable.  Every CI run opened a visible browser window, breaking in headless-only environments.

**Fix:** `headless` is now derived from `process.env.HEADLESS !== "false"` — headless by default; set `HEADLESS=false` in `.env` for local visual debugging.

---

### falcon.js — three compounding bugs prevented any run

**Problem 1 — `const` reassignment:** `const uiIssues` was declared then immediately reassigned in the guard branch (`uiIssues = []`), throwing `TypeError: Assignment to constant variable` before any test ran.

**Problem 2 — TestRunner arity:** `new TestRunner(page, uiIssues, clickExplorer.visitedPages)` passed three arguments to a two-parameter constructor `(page, testPlan)`.  `uiIssues` silently replaced `testPlan`; `visitedPages` was discarded.

**Problem 3 — Missing executeExploratoryTest args:** Called with no arguments; both `uiIssues` and `exploredPages` defaulted to `[]` so the report was always empty.

**Fix:** `uiIssues` is now `let`.  `TestRunner` is constructed as `new TestRunner(page, {})`.  `executeExploratoryTest` is called with the correct named-argument object.  `--url=` is now optional; omitting it defaults to `https://www.saucedemo.com` so the framework can be exercised without arguments.  Both the inline `chromium.launch` call and `BrowserManager` now respect `HEADLESS`.

---

## Phase 2 — Stability & Coverage

A full code audit of the Phase 1 codebase identified 14 additional defects.  All are resolved in `feat/phase-2-stability-and-coverage`.

### HealingReport — `log()` method missing, wrong path, blocking I/O

**Problem:** `AIHealer` and `TestRunner` both call `HealingReport.log({…})` but only a three-arg instance method `logHealing()` existed — a `TypeError` on every healing event, precisely when audit data is most needed.  Additionally the file path resolved to `src/reports/` (not `reports/`), and `fs.writeFileSync` on a hot path stalled the event loop.

**Fix:** Static `HealingReport.log()` added, accepting a structured object.  Path corrected to project root.  Writes serialised through an async promise queue.  Directory created lazily before first write.

---

### LocatorStore — wrong path, no directory creation

**Problem:** Store path resolved to `src/data/locator_store.json` — a directory that does not exist.  Every successful Tier 3 healing result that should have been cached for Tier 2 was silently lost on write.

**Fix:** Path corrected to `<project-root>/data/`.  Directory created on first write.  Saves made async (serialised queue).

---

### GoogleSearchTest — AIHealer created before browser launch

**Problem:** `new AIHealer(this.browserManager.page)` was called before `await this.setup()`.  `setup()` is what creates the page — so the healer received `null`.  Every `healAndClick()` call threw on the null reference.

**Fix:** AIHealer construction moved to inside the try block, after `await this.setup()`.  Post-search assertions added (results container + first heading).

---

### SelfHealingManager — `this.baseTest` undefined

**Problem:** `safeClick()` called `this.baseTest.captureScreenshot()` and `this.baseTest.logTestResult()` on failure, but `this.baseTest` was never set in the constructor.  Every handled failure produced `TypeError: Cannot read properties of undefined`.

**Fix:** Removed the two undefined calls.  Screenshot capture belongs in `BaseTest` / `ErrorHandler`.  Replaced `console.*` with `Logger.*`.

---

### ConfigManager — wrong config file path

**Problem:** `path.join(__dirname, "..", "config")` resolved to `src/config/` — a directory that does not exist.  The actual config is at `<project-root>/config/`.  ConfigManager threw on startup whenever the file was absent.

**Fix:** Path corrected to `../../config` from `src/core/`.  Missing file now logs a warning and falls back to env vars rather than throwing, so CI environments that rely solely on env vars do not crash.

---

### AIAnalyser / AIHelper / self_healing.js — raw axios + TLS bypass + stale model

**Problem:** Three separate files called the OpenAI API via raw `axios` HTTP requests instead of the official SDK.  One of them set `rejectUnauthorized: false` on its HTTPS agent — disabling TLS certificate verification for every request.  All three used `gpt-4` (high cost, higher latency).

**Fix:** All three migrated to the official `openai` SDK (lazy-init, consistent with `AIHealer`).  `rejectUnauthorized: false` removed.  Upgraded to `gpt-4o-mini`.  `OPENAI_API_KEY` absence is handled gracefully — returns `null` rather than throwing.

---

### UserDBTest — MySQL placeholder in PostgreSQL query

**Problem:** Query used `?` as the placeholder (`SELECT * FROM users WHERE username = ?`).  The `pg` driver requires `$1`, `$2`, … numbered placeholders.  The query never executed — pg threw a syntax error instead.

**Fix:** Placeholder changed to `$1`.  Added Middleware hooks, ErrorHandler, and Logger for consistency with the rest of the suite.

---

### TestDBConnection — wrong DBClient import path

**Problem:** `require("../../core/DBClient")` resolved to a path that does not exist (the file is at `src/core/DBClient.js`).

**Fix:** Import corrected to `../../src/core/DBClient`.

---

### full_automation.test.js — import with trailing space + missing module

**Problem:** `require('../utils/db ')` contained a trailing space, causing `MODULE_NOT_FOUND` at parse time.  The referenced file (`utils/db.js`) does not exist at all.

**Fix:** Removed the bad import.  DB connectivity test rewritten to use `DBClient` directly, skipped when `DB_HOST` / `DB_USER` env vars are absent so the suite runs cleanly in CI without a database.

---

### CheckoutTest, ProductApiTest, OrderDBTest — empty files

Three test files were completely empty, making `npm run test:all` produce no results for checkout, product API, and order DB scenarios.

**Fix:** All three implemented with full action sequences, schema validation, and post-condition assertions.

---

### Missing config, CI workflow, and `.env.example`

**Problem:** `config/testConfig.json` did not exist; `ConfigManager` crashed on startup.  `.github/workflows/ci.yml` was referenced in the README but absent.  `.env.example` did not exist, making onboarding unnecessarily difficult.

**Fix:** All three files created.

---

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push to `New_era_Falcon`, `main`, and `feat/**` branches, and on pull requests:

```yaml
# .github/workflows/ci.yml
name: Falcon CI
on:
  push:
    branches: [New_era_Falcon, main, "feat/**"]
  pull_request:
    branches: [New_era_Falcon, main]
jobs:
  test:
    runs-on: ubuntu-latest
    env:
      HEADLESS: "true"
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: node tests/ui/LoginTest.js
      - run: node tests/ui/CheckoutTest.js
      - run: node tests/api/UserApiTest.js
      - run: node tests/api/ProductApiTest.js
      - run: node falcon.js
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: falcon-reports
          path: |
            reports/
            allure-report/
          retention-days: 14
```

---

## Phase 3 — Competitive Features

A full audit of the Phase 2 codebase identified 4 remaining bugs and 6 missing competitive features. All are resolved in `feat/phase-3-competitive-features`.

### ErrorHandler — wrong reports path, synchronous write

**Problem:** `path.join(__dirname, '..', 'reports')` resolved to `src/reports/` (never existed). Every test failure silently lost its error report. `fs.writeFileSync` on the error handler blocked the event loop.

**Fix:** Path corrected to two `../` segments from `src/core/` to reach project root. Writes converted to `fs.promises.writeFile`. Lazy `mkdir` before first write. Filename sanitised to remove characters that break some filesystems.

---

### Middleware — console.log bypassed the log file

**Problem:** `beforeTest` / `afterTest` used `console.log`, so lifecycle messages never appeared in `reports/execution.log`, making per-test timing invisible in CI output.

**Fix:** Replaced with `Logger.info`. Added `Middleware.setEmitter(fn)` so the dashboard can subscribe to lifecycle events without modifying call sites.

---

### AdaptiveRetry — empty stub implemented

**Problem:** `AdaptiveRetry.js` was completely empty — no code at all. AIHealer's Tier 1 used a raw `for` loop with no delay between attempts, meaning three rapid-fire retries against a slow page were effectively one attempt.

**Fix:** Full implementation with exponential backoff (base 500ms, capped at 8 s), ±20% jitter to prevent thundering-herd collisions, and four error-type classifiers: `TIMEOUT` (wait longer), `STALE_ELEMENT` (let DOM settle), `NETWORK` (retry quickly), `HARD` (bail immediately — no amount of waiting helps). Integrated into AIHealer Tier 1; Tier 2/3 unchanged.

**Post-merge fix:** `TestRunner.runScenario()` wrapped `AIHealer.healAndClick()` in its own raw 3-attempt loop, on top of `healAndClick()`'s own internal `AdaptiveRetry` + Tier 2/3 healing chain — so a single failing click could trigger the full retry-and-heal chain (including live OpenAI calls) up to 3 times instead of once. `click` scenarios now get exactly 1 attempt at the `TestRunner` level; `type`/`select` (which have no internal retry) keep the 3-attempt loop. Also removed the dead, unreachable `HARD` entry from `_calcDelay()`'s multiplier table (`execute()` throws immediately on `HARD` before that method is ever called with it).

---

### Visual Regression Testing — new capability

**Feature:** `VisualRegression.js` adds pixel-level screenshot comparison to any test that extends `BaseTest`.

- `captureBaseline(name)` — saves a golden reference to `reports/baselines/`
- `compare(name)` — diffs the current page against the baseline using `pixelmatch`; writes a red-highlighted diff image to `reports/diffs/`
- Results appended to `reports/visual-regression.json` (cumulative across runs)
- Configurable per-pixel tolerance and overall diff-percentage threshold
- Wired automatically into `BaseTest.setup()` via `this.visualRegression`
- `LoginTest` and `CheckoutTest` capture a baseline on first run; compare on subsequent runs
- A visual diff is currently a logged warning, not a hard test failure — `compare()`'s result is inspected but doesn't fail the test on mismatch

**Post-merge fix:** `pixelmatch@7` ships ESM-only. The original `require("pixelmatch")` throws `ERR_REQUIRE_ESM` on Node <20.19 — it only appeared to work because CI happened to resolve a Node 20.20.x patch that added unflagged `require(esm)` support, silently depending on a Node version newer than the workflow's own `node-version: "20"` pin guarantees. Fixed to a lazy `await import("pixelmatch")`, which works on any supported Node version. Verified locally on Node 18.16.0.

**Post-merge fix (CI):** `reports/` is gitignored with no cache step, so every CI run used to start with no baseline on disk — `LoginTest`/`CheckoutTest` always took the "capture baseline" branch there, meaning `compare()` never ran in CI. Fixed by caching `reports/baselines` in `ci.yml` keyed on the branch name, so a baseline captured on one run is restored for the next run on the same branch and `compare()` now actually executes there.

**Post-merge fix:** `LoginTest`/`CheckoutTest` each duplicated the same inline "does a baseline exist yet" check with their own `fs.existsSync`/`path.join` calls. Consolidated into a single `VisualRegression.snapshot(name)` method that owns this policy internally; both tests now make one call. The visual-regression block is also now wrapped in its own try/catch in both tests, so a screenshot/PNG I/O failure (corrupt baseline, disk full) is logged and ignored instead of marking an otherwise-successful login/checkout as failed.

---

### Real-time Live Dashboard — new capability

**Feature:** `Dashboard.js` wires the already-installed `express` and `socket.io` dependencies (previously unused) into a WebSocket-backed dashboard at `http://localhost:3000`.

- Test start/pass/fail/skip and explorer-page events from the `falcon.js` autonomous pipeline are emitted in real time
- Summary tiles, animated progress bar, and a timestamped event feed update live in the browser
- Late-joining tabs receive a full event replay so the dashboard is always complete
- Use `node falcon.js --no-dashboard` to disable in CI environments
- `DASHBOARD_PORT` env var overrides the default port
- `DASHBOARD_LINGER_MS` overrides the 60s post-run wait (default `60000`)
- `CI=true` now defaults the dashboard off on its own (see below); pass `--dashboard` to force it back on

**Post-merge fix:** `Dashboard.start()`'s `server.listen()` had no `'error'` listener, and `falcon.js` awaited it before its own try/catch began — a bound port (e.g. two overlapping runs during the linger window) crashed the whole process before a browser even launched. `start()` now rejects properly on a listen error, and `falcon.js` catches it and continues the run without a dashboard instead of crashing.

**Post-merge fix:** the CI workflow set `CI: "true"` with a comment claiming it disabled the dashboard, but nothing ever read that variable — the dashboard was actually disabled solely by the separate `--no-dashboard` flag on that one workflow step. `falcon.js` now genuinely reads `process.env.CI` and defaults the dashboard off when it's `"true"` (still overridable with `--dashboard`), so the comment is no longer aspirational and any other CI/script invocation is safe by default. and `healingEvent` handler existed, but nothing ever called `dashboard.emit("healingEvent", ...)` — self-healing activity from `AIHealer`/`HealingReport` never reached the dashboard. `HealingReport.log()` now calls a new `Middleware.emit()`, so every healing event (Tier 2 LocatorStore hit, Tier 3 LLM resolution, or exhausted) shows up live.

That also fixes the separate-process gap: `tests/ui/LoginTest.js` etc. each run as their own `node` process, so the in-process emitter `Dashboard.start()` registers on `Middleware` never reached them. `Middleware.emit()` now falls back to an HTTP `POST /emit` on the dashboard's own server when no in-process emitter is set — set `DASHBOARD_URL=http://localhost:3000` (or wherever `node falcon.js` is already running) before invoking a standalone test file, and its `testStart`/`testEnd`/healing events show up on the live dashboard too. Verified locally: ran `DASHBOARD_URL=http://localhost:3000 node tests/api/UserApiTest.js` against an already-running `node falcon.js --dashboard`, and its events landed on `/events`.

---

### AI Test Generation — wired into autonomous pipeline

**Problem:** `PageAnalyser`, `TestGenerator`, and `TestRunner` all existed as standalone classes but nothing connected them. The autonomous pipeline in `falcon.js` skipped test generation entirely.

**Fix:** `falcon.js` now runs a five-step pipeline:
1. ExploratoryAI detects UI issues
2. ClickExplorer maps all click paths
3. TestGenerator produces a test plan from the root page's DOM
4. TestRunner executes the generated plan with AI healing
5. Exploratory report written to disk

Results from step 4 are emitted to the live dashboard in real time.

`PageAI.js` (exact duplicate of PageAnalyser with minor formatting differences) deleted. `PageAnalyser.js` gained a selector-priority chain (`data-testid` → `id` → `aria-label` → `name` → `type`, each value `CSS.escape()`d) and the combined `analyze()` + `generateActions()` surface.

**Post-merge fix:** the live pipeline above actually called `TestGenerator`, which had its own separate, older selector logic (bare tag-name fallback, no escaping) — so the improved `PageAnalyser` logic above never reached a real run. Confirmed locally: `node falcon.js` against saucedemo.com generated a `type` scenario for the login `<input type="submit">` button, which failed every attempt with "Input of type submit cannot be filled." Fixed by making `TestGenerator` delegate entirely to `PageAnalyser` instead of duplicating the scan — there is now exactly one DOM-scanning implementation, and `PageAnalyser.generateActions()` also correctly classifies `<input type="submit"|"button"|"reset">` as clickable rather than fillable, and now emits `select` actions for `<select>` elements too (previously only `TestGenerator` did, and `TestRunner` silently treated `select`/any unrecognized action as an immediate pass — it's now handled directly via `page.selectOption()`, and any truly unknown action is now recorded `skipped` instead of `passed`). Re-verified locally: the same run now generates a `click` scenario for the login button and all 3 generated scenarios pass.

---

### Dead code removed

Four files that had no call path and contained security-relevant issues were deleted:

| File | Problem |
|------|---------|
| `utils/self_healing.js` | Raw `axios` OpenAI call, `gpt-4`, no auth header rotation |
| `utils/ai_test_generator.js` | Same raw axios pattern, `gpt-4`, never imported |
| `utils/RetryHandler.js` | Completely empty file |
| `src/core/PageAI.js` | Exact duplicate of PageAnalyser |

---

### Allure reporting + `playwright.config.js` — new capability

**Problem:** `allure-playwright` was listed as a dependency but `playwright.config.js` did not exist, so the reporter never activated and `npx allure generate` had nothing to process.

**Fix:** `playwright.config.js` added with `allure-playwright` in the reporters array alongside the JSON reporter. Screenshot on failure, video retention on failure, one CI retry. CI workflow updated to generate an Allure report and upload it alongside the raw `reports/` artefact.

**Post-merge fix:** `playwright.config.js` requires `"@playwright/test"` directly, but `package.json` only declared `"playwright"` — `@playwright/test` was present only as an auto-installed transitive peer dependency of `allure-playwright`. On an install that doesn't auto-install peers, `npx playwright test` would fail with `Cannot find module '@playwright/test'`. Added `@playwright/test` explicitly to `devDependencies`.

**Post-merge fix:** the documented/CI command, `allure generate <dir> --clean -o <out>`, doesn't work at all on the installed `allure@3.0.0-beta.9` CLI — `--clean` isn't a recognized flag on this beta's `generate` command, and even without it, `generate` throws `TypeError: The "path" argument must be of type string` before producing any output (a bug in this beta release's positional-argument handling). CI's step had a silent `|| true`, so it always "succeeded" while uploading an empty/missing report. The working command on this CLI version is the `awesome` report plugin instead: `npx allure awesome allure-results -o allure-report`. Both `package.json`'s `report` script and CI have been switched to this; verified locally to produce a real `index.html`.

---

## Running Tests

```sh
# Full autonomous pipeline with live dashboard
node falcon.js

# Autonomous pipeline without dashboard (CI / headless environments)
node falcon.js --no-dashboard

# Individual scenario tests
node tests/ui/LoginTest.js
node tests/ui/CheckoutTest.js
node tests/api/UserApiTest.js
node tests/api/ProductApiTest.js

# Same, but reporting into an already-running `node falcon.js` dashboard
# (each test file is its own process, so this needs the explicit URL)
DASHBOARD_URL=http://localhost:3000 node tests/ui/LoginTest.js

# Playwright native suite (allure-playwright reporter active)
npx playwright test

# Generate and open Allure report
npx allure awesome allure-results -o allure-report
npx allure open allure-report
```

---

## Contributing

1. Branch off `New_era_Falcon` — not `main`
2. One logical change per commit; write the commit body as a tech-lead-quality explanation of *why*, not just *what*
3. Update this README for any new capability or changed behaviour
4. All tests must pass in headless mode before opening a PR

---

## License

MIT — see [LICENSE](LICENSE)
