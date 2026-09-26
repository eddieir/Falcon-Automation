# Changelog

Detailed, per-bug engineering history for Falcon-Automation — every defect found, why it happened, and how it was fixed, phase by phase. This lives here instead of the README so the README can stay focused on what Falcon does and how to run it; this file is for anyone auditing exactly how it got there.

See [README.md](README.md) for the current feature set, architecture, and usage. See [Roadmap](README.md#roadmap) for what's next.

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

**Post-merge fix:** the CI workflow set `CI: "true"` with a comment claiming it disabled the dashboard, but nothing ever read that variable — the dashboard was actually disabled solely by the separate `--no-dashboard` flag on that one workflow step. `falcon.js` now genuinely reads `process.env.CI` and defaults the dashboard off when it's `"true"` (still overridable with `--dashboard`), so the comment is no longer aspirational and any other CI/script invocation is safe by default. A `healingEvent` handler existed, but nothing ever called `dashboard.emit("healingEvent", ...)` — self-healing activity from `AIHealer`/`HealingReport` never reached the dashboard. `HealingReport.log()` now calls a new `Middleware.emit()`, so every healing event (Tier 2 LocatorStore hit, Tier 3 LLM resolution, or exhausted) shows up live.

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

## Phase 4 — Repository Hygiene & Documentation Truth

A drift audit found several docs and tracked files out of sync with the actual repo. Resolved in `phase-4/repo-hygiene`.

- **`HANDOFF.md`** rewritten so every claim (branch/PR status, `.env` variable names, CI steps, known issues) is checked directly against the repo rather than re-typed from an earlier draft.
- **`.allure/history.jsonl`** (Allure's own run-history cache, not source) untracked via `git rm --cached` and `.allure/` added to `.gitignore`.
- **`tests/full_autoamtion.test.js`** renamed to `tests/full_automation.test.js` (typo fix); `package.json`'s `test:e2e` script and the doc comment in `playwright.config.js` updated to match.
- **Unused dependencies removed:** `selenium-webdriver`, `zaproxy`, `postgresql`, `io`, `@achannarasappa/locust` — confirmed zero call sites anywhere in `src/`, `tests/`, `utils/`, or `falcon.js`.
- **`src/core/ActionInterpreter.js`** deleted (confirmed dead — no import anywhere).
- **`.env.example`** documented `DASHBOARD_PORT`, `DASHBOARD_LINGER_MS`, and `DASHBOARD_URL`, which `falcon.js`/`Middleware.js` already read but were previously undocumented.
- Added a curated, public-facing **Roadmap** section to the README.

---

## Phase 5 — Self-Healing Consolidation

Falcon had two parallel, silently-diverging healing implementations: `AIHealer` (used by most tests) and an older `SelfHealingManager` (used only by `src/ui/pages/LoginPage.js`). Resolved in `phase-5/healing-consolidation`.

- **`src/ui/pages/LoginPage.js`** and **`src/core/SelfHealingManager.js`** deleted. A repo-wide check confirmed `LoginPage.js` had no callers anywhere in the test suite (it was itself dead code, not just a `SelfHealingManager` consumer worth migrating), so removing both was safe rather than requiring a migration.
- **`utils/AIHelper.js`** deleted — its only caller was `SelfHealingManager`; once that was removed, `AIHelper.js` became orphaned dead code.
- **`src/core/AIHealer/LocatorStore.js`** given bounded growth: each selector's alternatives list is capped and a global cap on distinct tracked selectors evicts least-recently-used entries first (see README's Self-Healing Architecture section). A legacy store (plain `{ original: [alt, ...] }`, no `lastUsed`) is migrated in place on load rather than treated as corrupt.
- Verified with a real Playwright run: a deliberately broken selector correctly exhausted Tier 1 retries, then resolved via a seeded `LocatorStore` alternative (Tier 2) and clicked the real element; a second selector with no Tier 2 alternative and no `OPENAI_API_KEY` correctly attempted Tier 3 and failed gracefully (clean thrown error, no crash).

---

## Phase 6 — CI Database Coverage

`tests/db/*.js` existed but never ran in CI — there was no Postgres there to run them against, so a real data-layer regression could ship without anyone finding out until someone happened to run the DB tests locally. Resolved in `phase-6/ci-database-coverage`.

- **A real, disposable `postgres:16-alpine` service container** added to `.github/workflows/ci.yml`, health-checked with `pg_isready` so later steps wait for it to actually accept connections. Credentials are throwaway, CI-only values with no relation to any production secret.
- **`scripts/db/ci-seed.sql`** — a minimal, idempotent schema applied before the DB test steps run: a `users` table with the exact row `UserDBTest.js` queries for (`username = 'test_user'`), and an `orders` table with the columns `OrderDBTest.js` checks for (`id, user_id, total, status, created_at`). No fixture data is seeded beyond what a test actually asserts.
- **`node tests/db/UserDBTest.js` and `node tests/db/OrderDBTest.js`** added as real CI steps, deliberately without `continue-on-error` — verified locally (see below) that a genuinely broken database (missing row, dropped column) makes these fail loudly, so a green CI check now means something.

**A repo-wide bug found and fixed along the way:** every scenario test file (`LoginTest`, `CheckoutTest`, `UserApiTest`, `ProductApiTest`, `UserDBTest`, `OrderDBTest`) reported an accurate `PASSED`/`FAILED` result on screen, but the Node process always exited `0` regardless — none of them ever called `process.exit()`. Since every CI step is a plain `run: node tests/....js` command with no separate result check, **a real test failure did not fail its CI step.** This has been true since Phase 1; it just had never been load-bearing until now, since Phase 6 is the first phase whose entire point is "these results must actually gate the pipeline." Fixed by setting `process.exitCode` in `ReportManager.generateReport()` based on the tallied outcome — verified with a real pass, a real failure (seed row deleted, schema column dropped), and a real skip (no DB configured) against a local Postgres container, confirming the process exit code matches the reported result in all three cases. This now has its own permanent regression test, `tests/unit/ReportManagerExitCode.check.js`, run as its own CI step so a future refactor of `ReportManager` can't silently bring this exact bug back.

**CI runtime bumped from Node 20 to Node 24.** Node 20 reaches its own upstream end-of-life in April 2026 — separately from a GitHub Actions runner-image deprecation notice that surfaced during this phase's CI runs — so pinning to it any longer wasn't defensible. Re-ran the entire suite (all six scenario tests, `falcon.js`, the Playwright native suite, and the new regression test above) against a real Node 24 environment before merging, specifically re-checking the `pixelmatch` ESM-only import that has bitten this project on a Node-version mismatch once before (Phase 3) — it worked cleanly.

`UserDBTest.js` was also launching a full headless Chromium browser for a test that only ever queries a database — an artifact of copying the browser-based test pattern without needing it. Removed; it now follows the same lean, browser-free pattern as `OrderDBTest.js`. Both DB tests now skip cleanly (reported as `skipped`, exit code `0`) rather than crash with `Cannot read properties of null` when no database is configured, which is the normal case for a contributor without local Postgres running.

The skip fix above has a sharp edge worth calling out on its own: "no database configured" and "database configured but broken" are different situations, and only the first one should ever produce a `skipped` result. A wrong password or an unreachable host must still fail loudly — treating either as a skip would silently hide the exact kind of regression this phase exists to catch. `tests/unit/DBConfigBehavior.check.js` locks this in permanently: it runs both DB test files as real child processes under three configurations (absent, wrong credentials, unreachable host) and asserts the exit code and reported status for each, so this distinction can't quietly blur in a future change.

---

## Phase 7 — Dashboard Hardening

The live dashboard (`src/core/Dashboard.js`) had no authentication at all — `POST /emit`, `GET /events`, and every socket.io connection were wide open, with CORS set to `origin: "*"`. Fine for a single laptop; not fine the moment `DASHBOARD_URL` points a CI run or a shared environment at it, since that means anyone who can reach the port can read every test result and healing event, or inject fake ones.

- **`DASHBOARD_TOKEN`** (optional env var) now gates `POST /emit`, `GET /events`, and the socket.io handshake. Unset — the default, unchanged local-dev behavior — everything works exactly as before, except `node falcon.js` now logs a loud startup warning so running unauthenticated isn't a silent accident. Set it, and an unauthenticated request or socket connection is rejected outright (`401` on HTTP, `connect_error` on the socket — never silently let through with no data).
- **CORS restricted** from `origin: "*"` to `DASHBOARD_ALLOWED_ORIGIN` (defaults to the dashboard's own localhost origin). This only affects cross-origin browser access — the bundled dashboard UI talks to its own server same-origin either way, so this doesn't change anything for the normal `node falcon.js` → open the printed URL flow.
- **The dashboard's own front-end** (`src/dashboard/index.html`) reads a `?token=` from the URL, saves it to `localStorage` so a page refresh doesn't need it re-pasted, and strips it from the visible URL. Verified in a real headless browser across all four cases: correct token → live and connected; reload with no token in the URL → still connects, from `localStorage`; no token at all → clear "Unauthorized" status shown; wrong token → same.
- **`Middleware.emit()`'s cross-process HTTP fallback** (the `DASHBOARD_URL` flow from Phase 3, used when a standalone test file like `node tests/ui/LoginTest.js` reports into an already-running dashboard) now sends the token automatically when `DASHBOARD_TOKEN` is set in that process's environment too — verified end-to-end against a real token-protected dashboard: a standalone test with the matching token gets its events through, one without the token gets silently rejected (the test itself still passes — dashboard reporting has never been allowed to break a test run, on purpose, and that didn't change here).
- **`tests/unit/DashboardAuth.check.js`** — new regression test, a real `Dashboard` instance on an ephemeral port with real HTTP requests and a real `socket.io-client` connection (added as a devDependency for exactly this). Covers both the no-token default and every rejection/acceptance path once a token is set. Confirmed it actually catches a regression by removing the socket auth check and watching the exact right two cases fail.

**GitHub's CodeQL scan caught something real on the first push of this PR:** both authenticated routes (`POST /emit`, `GET /events`) had no rate limiting — meaning `DASHBOARD_TOKEN` could be brute-forced by hammering either endpoint with guesses, since nothing capped how many attempts a single client could make. Fixed with `express-rate-limit` on both routes (120 requests/minute — generous for real dashboard traffic, still bounds brute-forcing), applied *before* the auth check so it throttles attempts generally, not just successful ones. CodeQL doesn't analyze socket.io's own handshake as an Express route, so it didn't flag the equivalent gap there, but the same brute-force risk applies — added a small in-memory sliding-window limiter for socket connection attempts too, same 120/minute budget, no new dependency needed for that half. While already in `_isAuthorized()`, also switched the token comparison from a plain `===` to `crypto.timingSafeEqual()` — a plain string comparison leaks how many leading characters matched via response-time differences, which matters for an auth token even when the practical exploit window over a network is narrow. Extended `DashboardAuth.check.js` with two more cases (130 rapid requests/connections, confirming at least one gets rejected specifically for rate limiting) and confirmed both catch a real regression the same way the rest of the suite does — pulled the HTTP limiter back out, reran, watched exactly that one case fail.

**`tests/ui/GoogleSearchTest.js` was also looked at this phase, but deliberately did not get wired into CI.** The original plan was simple — add a CI step for it. Running it locally first (never skip that step) showed it failing every time: Google's cookie-consent dialog covers the search box on a fresh browser profile, and no amount of selector healing fixes that, since the element AIHealer would be "healing" isn't broken, it's just obscured. That part got a real fix — dismissing the dialog via its stable `id` before searching. But running the fixed version a few more times from the same machine got Google's actual bot-detection system to serve a "confirm you're not a robot" block page instead of search results — confirmed directly, not assumed. GitHub Actions runner IPs are well-known to that system. Wiring this into CI would very likely produce a test that's red most of the time for reasons that have nothing to do with Falcon's own code, so it stays as a fixed, working, manual/local demonstration of `AIHealer` against a real third-party site — not a CI gate.

---

## Post-Phase-7 hardening pass

A comprehensive `node:test` + Playwright regression layer was added (183 + 30 tests, a second CI job), alongside a real selector-anchoring fix in `PageAnalyser`:

- **`PageAnalyser.uniqueSelectorFor` fallback generated unanchored selectors.** The nth-of-type structural path it built stopped at `<body>` instead of walking all the way to `<html>`, so a generated selector like `button:nth-of-type(1)` could match an unrelated element anywhere in the document that happened to share the same tag-and-position among its own siblings — `:nth-of-type` is evaluated per-element relative to its own siblings, not scoped by the selector string alone. Fixed by anchoring the path to `<html>`. Found by running the pipeline end-to-end against a real fixture, not by reading the code.
- Ten `node:test` failures and thirteen Playwright regression failures were closed across `PageAnalyser`, `TestRunner`, and `AIHealer`: realistic per-type input values instead of a generic placeholder, correct action ordering, checkbox/radio handling via `click` instead of `type`, exclusion of disabled/readonly/file/range/color inputs (including elements disabled via an ancestor `<fieldset disabled>`), the selector-anchoring fix above, ambiguous-selector detection in `AIHealer` (refusing to click when a healed selector matches more than one element, since `page.click()` silently clicks the first match otherwise), credential redaction (password field `value` attributes stripped from the DOM snapshot sent to the LLM), and a real `isElementVisible()` bug in `TestRunner` (`el.offsetParent !== null` is always `false` for `position:fixed` elements — replaced with a `getClientRects().length > 0` + computed-style check matching `PageAnalyser`'s own visibility test).
- An independent QA pass (separate from the work above) found and fixed four more real bugs: `.env.example` placeholders that broke the DB skip-vs-fail distinction from Phase 6, `reporting.check.cjs` TAP output corruption on Node 18, a missing `engines.node` field, and a regression fixture for the selector-anchoring fix above that didn't actually exercise the bug it was meant to catch (no nested colliding element in the original fixture).

---

## Phase 8 — Healing Trust

Every previous phase made the self-healing chain more capable (Tier 3 inference, retry tuning, a bounded cache) but left one gap the Roadmap had been calling out explicitly: a successful Tier 3 result was written straight into `LocatorStore` and trusted for reuse from that moment on, purely because it happened to click the right element once. Nobody had reviewed it. "Self-healing" meaning "silently trusted" is exactly the failure mode a QA team should not have to accept from a tool that's making DOM-level decisions on their behalf.

### `HealingTrust` — the approval gate

**New module, `src/core/AIHealer/HealingTrust.js`.** `AIHealer.healSelector()`'s Tier 3 success path no longer calls `LocatorStore.addLocator()` directly. It calls `HealingTrust.recordPending({ original, suggested, description })` instead, which persists the fix to `data/healing_pending.json` and emits a `healingPending` event. The click itself still happens immediately (the test still passes), but the fix earns no reuse rights yet.

A pending entry is keyed by the original selector: seeing the same broken selector again before it's been reviewed bumps `occurrences` and `lastSeen` in place rather than creating a duplicate row, so a flaky element that breaks repeatedly doesn't flood the review queue with copies of the same fix.

- `HealingTrust.approve(original)` writes the fix into `LocatorStore` (so Tier 2 picks it up from then on), removes it from the pending queue, and appends a decision record to `data/healing_decisions.json` with who approved it and when.
- `HealingTrust.reject(original)` discards the fix, never touching `LocatorStore`, but still records the decision, so a rejected guess doesn't quietly resurface with no memory of having been turned down before.
- Both files are gitignored, same as `locator_store.json` — this is per-checkout run state, not something to commit.

Until a human acts, the exact same broken selector pays the Tier 3 LLM cost again on every subsequent run. That's the intended behaviour, not a missed optimisation: a guess earns trust by being reviewed, not by having worked once. Verified end-to-end with a real browser against a real, external site (`docs/demo/healing-trust-axonradar-demo.js`, against axonradar.netlify.app): Tier 1 and Tier 2 genuinely fail, Tier 3 resolves and clicks the real element, `LocatorStore.getAlternatives()` is confirmed empty immediately afterward, the fix is confirmed sitting in `HealingTrust.list()`, and only after an explicit `approve()` call does `LocatorStore.getAlternatives()` return it.

### Reviewing pending fixes: dashboard panel and CLI

Two ways to review and decide on a pending fix, so this doesn't only work for whoever happens to have the live dashboard open:

- **Dashboard.** `src/core/Dashboard.js` gained `GET /healing/pending`, `GET /healing/trend`, `POST /healing/approve`, and `POST /healing/reject`, protected by the identical `DASHBOARD_TOKEN` auth check and `express-rate-limit` limiter already guarding `/emit` and `/events` (Phase 7). The dashboard front-end (`src/dashboard/index.html`) gained a "Healing trust" panel above the event feed: every pending fix listed with its suggested replacement and how many times it's recurred, with **Approve**/**Reject** buttons wired to those endpoints, plus a trend table backed by `GET /healing/trend`. Approving or rejecting from the panel is reflected instantly for every connected tab via the same `healingPending`/`healingApproved`/`healingRejected` socket events that update the pending list live as new fixes come in.
- **`scripts/healing/review.js`.** A small standalone CLI (`list` / `approve <selector>` / `reject <selector>` / `approve-all`) for headless environments where nobody has the dashboard open, e.g. reviewing what a CI run's local reproduction surfaced. Talks to the same `HealingTrust` module directly, no server required. Exposed as `npm run healing:pending` / `healing:approve` / `healing:reject`.

### `HealingReport.summary()` — the reviewable trend

The Roadmap also asked for healing to be "surfaced as a reviewable trend across a run (which selectors heal, how often, and via which tier)" rather than left as a flat, chronological event list nobody wants to read end to end. `HealingReport.summary()` aggregates the existing audit log (unchanged in how individual events are logged) into one row per original selector: total occurrences, a breakdown of how many times each tier resolved it, and its most recent outcome. Backing the dashboard's trend table and available to any script via `HealingReport.summary()` directly.

### Verification

`tests/regression/healing.check.cjs` gained coverage for `HealingTrust` directly (recording, occurrence bumping, approve/reject including their effect, or lack of it, on `LocatorStore`, unknown-selector no-ops, persistence across a reload, and recovery from corrupt pending/decision files) and for `HealingReport.summary()`'s aggregation. The existing "inferred locator is clicked then persisted and audited" test was rewritten to assert the new behaviour (not persisted to `LocatorStore`, sent to `HealingTrust` instead) rather than the old auto-trust behaviour it used to lock in. `tests/regression/browser.spec.js`'s equivalent real-browser test was similarly rewritten to prove, against a real Playwright page, that a second identical failure still consults the LLM (no trust yet) and that only an explicit `approve()` call makes the third attempt reuse Tier 2. `tests/unit/DashboardAuth.check.js` was extended with the same authenticated/unauthenticated matrix already applied to `/emit` and `/events`, now covering `/healing/pending` and `/healing/approve`. `tests/regression/dashboard-ui.check.cjs` gained a test exercising the three new socket event types end-to-end against the shipped front-end script, which is how a real gap (`addEventListener` was missing from that test's lightweight DOM stub) was caught and fixed before it could mask a future regression in the healing panel.

### Hardening pass — a real bug found, plus exhaustive edge-case coverage

Phase 8 is the approval gate standing between an LLM guess and a test suite trusting it, so it got a second pass explicitly looking for what the first pass missed: positive paths, negative paths, and every corner case a CSS selector or an HTTP request could actually produce.

**A real, reachable bug was found this way, not a hypothetical one.** `HealingTrust`'s `pending` map is a plain JS object, keyed directly by the selector string (`this.pending[original] = entry`). A selector literally named `__proto__` — an unusual but entirely legal CSS id/class an attacker or an unlucky refactor could produce — doesn't create a property when assigned via bracket notation; it repoints the object's own prototype instead, and the entry silently vanishes: `list()` never returns it, `approve()`/`reject()` can never find it again. `LocatorStore` already defends against exactly this (see Phase 2's "selectors matching object prototype keys" test); `HealingTrust`, written fresh for this phase, hadn't inherited that defense. Fixed with the same `Object.hasOwn()`/`Object.defineProperty()` pattern LocatorStore uses, via new `_hasPending`/`_getPending`/`_setPending` helpers, so every read, write, and delete on the pending map goes through a path that can't be redirected by a key like `__proto__`, `constructor`, `toString`, `hasOwnProperty`, or `valueOf`. Verified with a reproduction script before the fix (confirmed the entry really did disappear), then a fix, then coverage for all five collision-prone key names at both the module level and over the live dashboard's real HTTP API.

**A real, reproducible test-harness flake was found and fixed too, unrelated to Phase 8's own logic.** Once `tests/regression/dashboard.check.cjs` grew enough new Dashboard-instance start/stop cycles, the suite began intermittently crashing mid-run with `Unable to deserialize cloned data due to invalid or unsupported version` — a Node test-runner internal error, not an assertion failure. Root-caused to the same class of bug already documented and fixed once before in `reporting.check.cjs`: `Logger.info`/`Logger.warning` write raw lines straight to `console.log`/`console.warn`, and `node --test`'s reporter is reading this same process's stdout concurrently to report results — enough raw lines landing at the wrong moment corrupts its parser. Confirmed by running the exact same test logic directly via plain `node` (bypassing `node --test`'s harness) 4/4 times with zero flakiness, isolating the fault to the reporter interaction, not the tests' own correctness. Fixed the same way as before: silencing `console.log`/`console.warn` for the duration of this file's Dashboard-heavy tests. 10/10 clean runs confirmed afterward. A second, genuine ordering bug was found alongside it in one new test: registering a `socket.io-client` `once(socket, "event")` listener *after* triggering the action that causes the event, instead of before — on localhost, "connect" and a server's "replay" push can arrive in the same read event, so the event can already have fired (and been missed) by the time the listener attaches. Fixed by registering every listener before connecting, matching the pattern the original "real websocket replays history" test already used.

**Coverage added, systematically, across positive/negative/edge/corner cases:**
- `HealingTrust`: repeat `recordPending` overwrites `suggested`/`description` with the latest inference; default `description`/`decidedBy` values; double-approve and approve-after-reject (and the reverse) are no-ops that don't double-write `LocatorStore`; empty-string selectors; the decision ledger's insertion order across multiple selectors; two selectors tracked independently without interference; malformed JSON, wrong-shape JSON (array where an object was expected and vice versa), and `null`/non-object top-level JSON in both `data/healing_pending.json` and `data/healing_decisions.json`; write failures (path points at a directory) that must not lose in-memory state; ten concurrent `recordPending` calls for the same selector landing without a lost update; twenty concurrent `approve()` calls across different selectors all persisting.
- `HealingReport.summary()`: empty-log case; sorting by occurrence count descending; a selector that fails outright before later resolving via Tier 3; a 25-selector/12-round interleaved stress case (300 events) verifying no cross-selector misattribution.
- `AIHealer` integration: the default `"Element"` description flowing through to a pending entry when `healAndClick()` is called with no description argument; Tier 3 successes for multiple distinct selectors in one run tracked as separate pending entries, not merged; the pre-existing ambiguous-inferred-target test extended to also assert the rejected guess never reaches `HealingTrust`, not just `LocatorStore`.
- Dashboard front-end (`tests/regression/dashboard-ui.check.cjs`, testing the real shipped `<script>` from `index.html`, not a reimplementation): the panel renders/updates/clears correctly across pending → approved/rejected sequences, including two entries where only one changes; a repeat pending event for the same selector updates the existing row instead of duplicating it; approving or rejecting a selector with no matching entry is a harmless UI no-op; every rendered field (selector, suggestion, description) is HTML-escaped against injection, not just the pre-existing event-feed rows; a page load correctly fetches and renders the server's real pending/trend state; a failed fetch on load never throws and leaves the panel in a sane empty state; clicking Approve/Reject sends the right method, URL, auth header (present with a token, absent without one), and JSON body, and disables the button; a failed request (both an HTTP error response and a network-level rejection) re-enables the button and surfaces the error via `alert()`; clicking inside the panel but not on a button is a no-op; a non-JSON error body and an empty trend array are both handled without crashing or misrendering.
- Dashboard HTTP API (`tests/regression/dashboard.check.cjs`, a real `Dashboard` instance, real HTTP, real `HealingTrust`/`HealingReport` singletons, temp-directory-isolated per test): a full pending → approve HTTP round trip; reject never reaching `LocatorStore`; `GET /healing/trend` reflecting real aggregated data; approving/rejecting an unknown selector returning `404`, not a silent success; every non-string/missing shape for `original` (`undefined`, `42`, `null`, an array, a nested object) rejected without crashing; a genuinely malformed JSON body returning `400` and leaving the server still answering correctly afterward; the `__proto__`/`constructor` collision case working correctly over the real HTTP API, not just at the module level; a live end-to-end broadcast, an HTTP `POST` triggering a real socket event a connected client actually receives; and an unauthenticated request confirmed to have zero side effects, the entry it tried to touch is still sitting there afterward, not silently processed then hidden behind a 401.

Total regression suite after this pass: 240 `node:test` cases (up from 183 before Phase 8, 192 after the initial Phase 8 landing) and 30 Playwright specs, all green across repeated runs.

---

## Phase 9 — Flaky-Test Detection and Quarantine

Every previous phase treated a failing scenario as binary: `passed` or `failed`, nothing in between. That's honest as far as it goes, but it conflates two very different situations — a real regression, and an interaction that's simply unreliable — and a QA team that can't tell them apart either chases ghosts (re-running a genuinely broken test hoping it "passes this time") or, worse, starts distrusting red builds altogether. That's precisely the "shrug at red" failure mode described in the README's "Why Falcon exists" section, just from a different angle than Phase 8's selector-trust problem.

### `FlakinessTracker` — persistent history and classification

**New module, `src/core/FlakinessTracker.js`.** Every scenario `TestRunner.runScenario()` executes now feeds its outcome (`"passed"` or `"failed"`; `"skipped"` carries no signal about the interaction itself and is deliberately not recorded) into `FlakinessTracker.record()`, keyed by `<page url>::<action>::<locator>` — stable across a regenerated scenario description, unlike keying on the description text itself.

Classification looks only at the most recent 10 recorded outcomes for a scenario:
- **`new`** — fewer than 3 outcomes seen yet; not enough data to say anything.
- **`stable`** — every recent outcome passed.
- **`broken`** — every recent outcome failed. This is a real, consistent regression and must stay loud; it is never a quarantine candidate.
- **`flaky`** — a mix of passes and failures for the exact same interaction. This is the candidate list a human reviews.

History is capped at 20 entries per scenario and the tracker is bounded to 500 tracked scenarios total, least-recently-used evicted first — the same bounded-growth discipline `LocatorStore` established in Phase 5, applied here for the same reason (a long-running project shouldn't grow an unbounded file on disk).

### The quarantine gate — always a human decision, never automatic

Classifying something as flaky changes nothing on its own. A human quarantines a scenario explicitly (dashboard or `scripts/flakiness/review.js`); `TestRunner` then reports a subsequent failure of that exact scenario as `"quarantined"` instead of `"failed"` — a new, distinct status, not a reclassified failure and not a silent pass. `ReportManager` was extended accordingly: `quarantined` is tallied separately from `passed`/`failed`/`skipped`, is excluded from the failure count that drives `overallResult`/`process.exitCode`, and is never merged into `passed` either — a run with only quarantined failures (zero real ones) reports `PASSED` and exits `0`, but the summary line still honestly shows `Quarantined: N`. This mirrors Phase 8's HealingTrust principle exactly: "never silently trusted" for an AI-healed selector becomes "never silently hidden" for a known-unreliable scenario here.

### Reviewing flaky scenarios: dashboard panel and CLI

- **Dashboard.** `GET /flakiness/scenarios` (optionally `?classification=flaky`), `POST /flakiness/quarantine`, `POST /flakiness/unquarantine` — same `DASHBOARD_TOKEN` auth and `express-rate-limit` gate as every other dashboard route. The dashboard front-end gained a "Flaky tests" panel: every flaky or broken scenario listed with its classification, fail rate, recent pass/fail history (as a compact 🟢/🔴 sequence), and a Quarantine/Unquarantine button; an already-quarantined scenario stays visible even if its live classification has since recovered to stable, so the control to reverse the decision doesn't disappear. New tiles and a progress-bar segment for the "Quarantined" count; new socket events (`flakyDetected`, `scenarioQuarantined`, `scenarioUnquarantined`) keep every connected tab live.
- **`scripts/flakiness/review.js`.** `list [flaky|broken|stable|new]` / `quarantine <key>` / `unquarantine <key>`, the same headless-CLI pattern Phase 8 established for healing review. Exposed as `npm run flaky:list` / `flaky:quarantine` / `flaky:unquarantine`.

### A real bug found during implementation, not after

`keyFor()` and `classify()` were originally declared as `static` methods on the `FlakinessTracker` class — but the module exports a singleton *instance* (`module.exports = new FlakinessTracker()`, the same pattern `LocatorStore`/`HealingTrust` already use), and static methods live on the constructor, not on an instance. Every call site — `TestRunner.js`'s own `FlakinessTracker.keyFor(...)`, and the entire regression test suite — would have thrown `TypeError: FlakinessTracker.keyFor is not a function` at runtime. Caught by the very first test run of the new suite (`tests/regression/flakiness.check.cjs`), before any of it shipped. Fixed by making both regular instance methods, matching how every other method on the class already works.

### Verification

**`tests/regression/flakiness.check.cjs`** (new, 37 cases): `classify()` as a pure function across its exact boundary conditions (fewer than 3 samples, exactly 3, an unbounded-looking history correctly windowed to the most recent 10, null/undefined input, non-pass/fail statuses not counting toward sample size); `record()`'s occurrence accumulation, history capping, independent keys per url/action/locator, description fallback, and the `flakyDetected` event firing only on the *transition* into flaky (not on every subsequent flaky record, and re-firing correctly if a scenario goes stable then flaky again); quarantine/unquarantine round trips, idempotency, no-ops on unknown/non-quarantined keys, and decision-ledger ordering; the same prototype-pollution-safe-key hardening Phase 8's post-launch pass added to `HealingTrust` (`__proto__`/`constructor`/`toString`/etc. as a locator) built in from the start this time, with dedicated tests; malformed/wrong-shape/null JSON recovery for both `scenario_history.json` and `quarantine_decisions.json`; write-failure tolerance; ten concurrent `record()` calls and fifteen concurrent `quarantine()` calls across different scenarios, all verified to land without a lost update.

**`tests/regression/core.check.cjs`** gained 6 `TestRunner` integration cases: a passed scenario recorded with the correct url/action/locator/description/duration; a failed scenario recorded with a classified `errorType` (reusing `AdaptiveRetry.classify()`, previously computed only for Tier 1 retries inside `AIHealer`, now applied to any scenario's final failure regardless of action type); a quarantined scenario reporting `"quarantined"` while still being fed to `FlakinessTracker` as a real `"failed"` outcome (quarantining changes reporting, not tracking); the same failure reporting `"failed"` when not quarantined; confirmation that a *passed* scenario never even calls `isQuarantined()`; confirmation that skipped/unsupported actions are never fed to the tracker at all.

**`tests/regression/reporting.check.cjs`** gained 6 new tally combinations covering `quarantined` mixed with every other status (all-quarantined → `PASSED`/exit 0; quarantined + a real failure → `FAILED`/exit 1, proving quarantining one scenario never masks a genuine regression in another; quarantined + passed + failed → `PARTIAL`), plus an explicit test that `"quarantined"` is accepted as a valid status while a genuinely invalid one still throws.

**`tests/regression/dashboard.check.cjs`** gained 7 real end-to-end HTTP cases (a real `Dashboard`, a real `FlakinessTracker` singleton isolated to a temp directory per test): classification filtering over real HTTP, a full quarantine → unquarantine round trip, 404s on unknown keys, every malformed `key` shape rejected without crashing, unauthenticated requests confirmed to have zero side effects, and a live `flakyDetected` socket broadcast reaching a connected client end-to-end.

**`tests/regression/dashboard-ui.check.cjs`** gained 14 cases against the real shipped front-end script: panel rendering, the `new`/`stable` classifications correctly excluded from the actionable list while `broken` and already-quarantined-but-now-stable scenarios stay visible, HTML-escaping of every rendered field, the Quarantine/Unquarantine buttons' fetch calls (method, URL, auth header, body) and their success/failure paths, and replay-driven panel resets.

`tests/unit/DashboardAuth.check.js` was extended with the same authenticated/unauthenticated matrix already applied to every other dashboard route, now covering `/flakiness/scenarios` and `/flakiness/quarantine`.

**`docs/demo/flaky-test-detection-demo.js`** (new) demonstrates the entire gate end-to-end against a real, external site (axonradar.netlify.app): a real element is injected and removed from the live page across six real `TestRunner.executeTest()` calls, producing genuine, unstubbed pass/fail nondeterminism (only the Tier 3 LLM call is stubbed, the same convention Phase 8's demo already established, so this runs without an `OPENAI_API_KEY`); `FlakinessTracker` classifies the result as flaky from that real history; a quarantine decision is made; a seventh run confirms the scenario now reports `"quarantined"`, not `"failed"`; and a real `ReportManager.generateReport()` call confirms the run still reports `PASSED` with the quarantined count visible in the summary.

Total regression suite after this phase: 308 `node:test` cases (up from 240 after Phase 8's hardening pass) and 30 Playwright specs, all green across repeated runs.

---

## Phase 10 — Whole-App Coverage

Falcon's pitch has always been that you shouldn't have to hand-write a test for every new page. The shipped CLI covered exactly one.

### The defect: the crawler's results were thrown away

`falcon.js` ran `ClickExplorer.explore()`, collected every page it found into `visitedPages`, emitted each one to the dashboard, logged `→ N page(s) explored`, and then did this:

```js
// Re-navigate to the root to generate scenarios from the main page
await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
```

Every discovered page was discarded at that line. Scenario generation, execution and healing all ran against the entry URL alone. The file's own header comment claimed the opposite — "after ClickExplorer maps the site, PageAnalyser + TestGenerator produce a scenario plan **for each visited page**" — which had never been true of the code beneath it.

The flagship 184-scenario, 11-page demo was not evidence against this. It worked because `docs/demo/multi-page-axonradar-dashboard-demo.js` hardcodes an eleven-entry URL list and loops over it by hand. The mechanism was real; it just lived in a demo script rather than in the product.

### `SiteSweep` — the loop, promoted into the product

`src/core/SiteSweep.js` normalises and filters the discovered frontier, truncates it to a page cap, and walks what remains under a wall-clock budget, running each page through the existing `ExploratoryAI` → `TestGenerator` → `TestRunner` chain. A page that will not load is recorded and stepped over rather than taking the run down with it.

Three things it was given that the hand-rolled demo loop never had:

**Hard bounds.** `--max-pages` (default 20), `--budget-ms` (default 10 minutes), a same-origin restriction by default, and a per-page navigation timeout. Unbounded crawling of someone else's site is not a feature.

**Cross-page deduplication.** A navigation bar present on eleven pages previously generated the same scenario eleven times. Scenarios are signed on `action::locator::value::description`; the first occurrence runs and later ones are recorded as `deduped` with a `firstRunOn` pointer. They are never executed, so they never reach `FlakinessTracker`.

**An explicit account of what was not covered.** Every page Falcon did not test appears in the report with a reason — `max-pages`, `budget-exhausted`, `unreachable`. "What we deliberately didn't look at" is half of what a coverage number means, and a coverage feature that quietly omits it is worse than none.

### Discovery no longer depends on clicking

The first live run of the finished sweep tested one page and generated four scenarios — the phase, as built, was cosmetic. `ClickExplorer` discovers pages by *clicking*: it takes the first five text-bearing `a`/`button` elements, clicks each, recurses, and navigates back. It reads each element's `href` and never uses it. On a real site that routinely returns the entry page and nothing else, and a sweep with an empty frontier is the old single-page behaviour with extra steps.

`SiteSweep._harvestLinks()` reads the `href` attributes already sitting in the page's navigation, capped at 500 anchors, and unions them with whatever the click-based crawl found. `ClickExplorer` itself is untouched, so its exploratory-clicking behaviour and its thirty browser specs are unaffected.

Against `axonradar.netlify.app`, same command, `--max-pages=6`:

| | Pages tested | Scenarios generated |
|---|---|---|
| Before | 1 | 4 |
| After | 6 | 91 (17 deduped) |

### Defects found by review of the merged work

Three engineers implemented this in parallel against a written contract (`docs/PHASE-PLANS.md`) in separate worktrees. Integration and an independent code review caught the following, all fixed before merge.

**A run whose scenarios were all deduped exited 0.** `ReportManager` counted `deduped` rows in `total`, and both result branches gated on `total > 0`. A sweep that executed nothing therefore reported `PASSED` where an empty run would have reported `NO_TESTS_RUN` and exited 1. `quarantined` and `deduped` look similar and are not: a quarantined scenario ran and we agreed not to block on it; a deduped scenario never ran. The branches now count executed rows.

**A crash partway through a page discarded every verdict already reached on it.** `TestRunner` accumulates into `this.results` as it goes, but the runner was scoped inside the `try`, so a page that failed on scenario 13 of 30 lost the twelve before it — real failures included. The runner is hoisted and its results salvaged, and the breakage is recorded as a failed scenario so it reaches the exit code rather than living only in a page status nothing tallies.

**A page that would not load contributed nothing to the exit code.** Page status is tallied only into `coverage`, which nothing gates on, so a sweep where ten of eleven pages returned 500 and one static page passed exited 0. An unreachable page is now a failed scenario too.

**External links were counted as uncovered pages.** `mailto:` addresses and links to other origins were being recorded as pages of the app Falcon had failed to cover. An entry page with forty outbound links would report "11 of 53 pages tested" and fill the not-covered list with email addresses. They are counted separately as out-of-scope links, so nothing is hidden and the ratio still means something.

**The dedupe signature could collapse two genuinely different controls.** `PageAnalyser` falls back to `tag[type="..."]` when an element has no distinguishing attribute, so on a templated app `/users`' "Delete user" and `/reports`' "Export" both arrive as `button[type="submit"]`. Signing on locator alone collapsed them, leaving Export untested while the report claimed it was covered — the one thing a coverage feature must never do. `description` is now part of the signature, which is strictly more conservative; shared chrome still dedupes, because a nav link carries the same description on every page.

**A page could claim a dedupe signature and then never run it.** Signatures are claimed before execution so the rest of the page dedupes against them. If that page then threw, later pages reported the scenario as already covered somewhere it had never run. The claim is released on failure.

**Two seam defects between the parallel workstreams.** The `pageStart` payload carried a 0-based index while the dashboard treated `index <= 1` as "new sweep, reset the panel" — so the second page of every sweep would have wiped the first page's results mid-run. And nothing emitted an event carrying the skipped-page list: pages that are never opened emit no per-page events, so the not-covered list could never populate. Added `sweepComplete`.

### Reporting and the dashboard

`test-report.json` gains a `coverage` block (`pagesDiscovered`, `pagesTested`, `pagesSkipped`, `pagesUnreachable`, `scenariosGenerated`, `scenariosDeduplicated`, `budgetExhausted`, `linksOutOfScope`) and a per-page breakdown carrying each page's tally, UI-issue count and duration. The printed summary gains a coverage line. `--single-page` restores the pre-Phase-10 behaviour for anyone who wants it, and reports the pages that narrowing cost.

The dashboard gains a Coverage panel: pages tested against pages discovered, per-page results, and a separate not-covered list with humanised reasons. `GET /coverage` is token-gated with the same `authLimiter` + `_isAuthorized` treatment as every other route.

### Verification

`tests/regression/sitesweep.check.cjs` (new, 38 cases, no browser): frontier normalisation, cross-origin and scheme filtering, `max-pages` truncation, budget exhaustion mid-sweep, unreachable pages not aborting the sweep, dedupe collapse and its `firstRunOn` pointer, the shared-fallback-locator case above, and confirmation via the real `TestRunner` that deduped scenarios never reach `FlakinessTracker`.

`tests/regression/reporting.check.cjs` covers `deduped` across every status combination with `process.exitCode` asserted directly rather than inferred from the printed summary. `tests/unit/DashboardAuth.check.js` covers `/coverage` authenticated and unauthenticated.

Verified against real sweeps of `axonradar.netlify.app`: exit 1 on real failures, exit 1 against a domain that does not resolve, and a coverage block where `pagesDiscovered` equals tested plus skipped plus unreachable.

Total regression suite after this phase: 383 `node:test` cases (up from 308) and 30 Playwright specs.

---

## Phase 10 follow-up — the defects the Phase 10 verification found elsewhere

Re-verifying Phases 8 and 9 on real browsers, a real Postgres and real HTTP (written up in [docs/PHASE-PLANS.md](docs/PHASE-PLANS.md) §1) produced twelve findings. Seven of them are the substance of the phases that follow this one. These five were small enough to close immediately, and one of them was a live hole in the safety story quarantine exists to protect.

### A scenario that has never passed could be quarantined, which turns a red run green

**Problem:** quarantine exists so a genuinely unreliable interaction stops blocking CI. The module docblock and the README both say a `broken` scenario — one that fails every time — is never a quarantine candidate. Nothing enforced it. `FlakinessTracker.quarantine()` had no classification check, `POST /flakiness/quarantine` had none, and the dashboard rendered a working Quarantine button on `broken` rows. Reproduced end to end: quarantining a scenario that had failed three times out of three made a genuinely failing run exit 0.

**Fix:** a new `quarantineEligibility(key)` is the single rule, and all three surfaces defer to it. The rule is "has this scenario passed at least once in its retained history", not "is its classification `broken`" — a scenario that has only ever failed twice is still classified `new`, because two samples are under the verdict threshold, and hiding that is exactly as dangerous. `quarantine()` throws with `code: "QUARANTINE_REFUSED"` and changes nothing: no flag, no ledger row, no socket event. The route answers 409 with the reason and the classification rather than a bare 500, `scripts/flakiness/review.js` prints `Refused: …` and exits 1, and the dashboard shows "Not quarantinable" with the reason on hover instead of a button that exists to be rejected. There is deliberately no force flag. A scenario becomes quarantinable the moment it genuinely passes once, which is the point at which "unreliable" is the true description.

### Quarantining twice wrote two ledger rows for one decision

**Problem:** `data/quarantine_decisions.json` is an audit ledger. Re-applying a quarantine appended a second row with a second attribution, so the ledger counted clicks rather than decisions.

**Fix:** re-quarantining an already-quarantined scenario returns the entry and writes nothing. The first decision, and whoever made it, is what the ledger keeps.

### A repeat Tier 3 sighting erased the description a reviewer was looking at

**Problem:** `HealingTrust.recordPending()` defaults `description` to `""`, and every later sighting of the same selector overwrote the stored entry wholesale. A caller that omitted the description blanked one that was already there, so a pending fix could lose the human-readable label a reviewer needs to judge it.

**Fix:** the description falls back to the existing entry's, the same way `firstSeen` already did.

### The socket rate-limit assertion failed about one run in six

**Problem:** `tests/unit/DashboardAuth.check.js` fired 130 simultaneous socket.io connections and asserted at least one was rejected by the limiter. socket.io's default transport is HTTP long-polling, and a burst that size overwhelms the polling layer itself: connections failed with `xhr poll error` before the handshake reached the limiter, so the limiter's message never appeared. Two failures in eleven local runs, on a hard step in the `test` job — a flaky gate on the suite whose entire purpose is honest signal.

**Fix:** the burst forces the websocket transport and connects in serial batches of ten, so all 130 attempts are real handshakes. Fourteen consecutive local runs, zero failures. A handshake that still loses out to machine load is now reported as an informational line with its message rather than failing the build, because it says nothing about the limiter.

### Untracked what the tooling regenerates

`reports/test-report.json` and 38 files under `allure-report/` were tracked despite being gitignored, so the working tree went dirty on every run and every diff carried generated noise. Removed from the index; the ignore rules that were already there now apply.

### Four documentation claims that weren't true

`README.md` said the Playwright-native CI step carries `continue-on-error: true`; it doesn't, and hasn't since Phase 6 — a failure there fails the job, which is the more important thing to state correctly. The demo regeneration recipe passed `docs/demo/frames-axonradar` to `build-gif-list.js` while `capture-dashboard.js` only ever wrote to `docs/demo/frames`, so step 3 could not find step 2's output; `capture-dashboard.js` now takes the output directory as its third argument. That recipe also told you to wait for the dashboard before starting the capture, which lets a short run finish first and loses the empty and explore states — the capture script now waits for the port itself and the recipe starts both together. `scripts/flakiness/review.js list` was described as printing what's flaky, broken, or quarantined; it prints every tracked scenario and takes an optional classification filter. The Project Structure tree omitted `tests/regression/` entirely — the largest test directory in the repo.

### Three CodeQL alerts on the Phase 10 branch

CodeQL flagged `js/incomplete-url-substring-sanitization`, high severity, on three negative assertions in the regression suite — `assert.ok(!urls.includes("old.com"))` and two like it. No production code path was involved and no URL was being sanitized, but a substring host check is worth flagging wherever it appears, and an assertion is clearer as `assert.doesNotMatch(urls, /old\.com/)` anyway, which is the form the matching positive assertions already used.

### Verification

`tests/regression/flakiness.check.cjs` covers the eligibility rule directly: the `broken` case, the all-failing-but-still-`new` case, the refusal leaving no flag and no ledger row, and the scenario becoming quarantinable after one genuine pass. `tests/regression/dashboard.check.cjs` covers the 409 over real HTTP. `tests/regression/dashboard-ui.check.cjs` covers all three row states — no button, button, and Unquarantine on an already-quarantined row with no pass in history. `tests/regression/cli.check.cjs` gains the first coverage the review CLIs have had: the refusal exits 1 and writes no ledger, a genuinely flaky scenario quarantines and is attributed to `cli`, an unknown key exits 1, and `list` filters.

Total regression suite after this pass: 399 `node:test` cases (up from 383) and 34 Playwright specs.

---

## Phase 11 — Healing for Every Action, and No Silent Green

Verifying Phase 10 raised a question that had never been asked in quite this form: when a locator changes, does Falcon actually understand it and heal it? The answer was established by experiment rather than by reading code — the real `SiteSweep`, a three-page local site, a button renamed *after* the plan was generated, and a mock OpenAI endpoint so every Tier 3 call could be counted.

For a click, the answer was yes, and cleanly. Tier 1 exhausted its three adaptive retries, Tier 2 had nothing stored, Tier 3 read the live DOM and inferred the new selector, the scenario passed, and the fix landed in `HealingTrust` as pending rather than in `LocatorStore` — the Phase 8 trust gate holds inside a sweep. After approval, the same break healed at Tier 2 with no LLM call for that selector.

For everything else the answer was no, and the way it failed was the worst kind this project recognises.

### Healing applied to clicks only

**Problem:** `TestRunner.runScenario()` called `page.fill()` and `page.selectOption()` directly, inside a bare three-attempt loop, and `AIHealer` exposed healing for `click` alone. Every self-healing claim in the README was true only for a third of the actions Falcon supports.

**Fix:** `AIHealer` resolves a selector once and then performs the caller's action against it, rather than three near-copies of `healAndClick()`. Tier 2 and Tier 3 perform the *real* action — a fill fills, a select selects. Healing a form field by clicking it would report a pass for an interaction that never happened, which is worse than the failure it was hiding. The uniqueness guard that refuses an ambiguous healed selector applies to every action, not just clicks, and the Phase 8 trust gate is unconditional: a Tier 3 resolution for a fill waits for a human exactly as one for a click does. Healing records now name the action that was healed.

### A missing input was silently skipped, and a skip is not a failure

**Problem:** `executeTest()` marked any non-click scenario whose target wasn't visible as `skipped` before the healer was ever consulted. `skipped` doesn't fail a run, so this tally reported PASSED and exited 0:

```
skipped   Fill quantity — Element not visible
skipped   Choose size   — Element not visible
passed    Click buy
```

A renamed input id neither healed nor failed. It quietly removed coverage while the build stayed green — the exact class of false green Phase 6 exists to kill, reached through `skipped` instead of through a swallowed exception.

**Fix:** every supported action reaches the healing chain unconditionally. If the chain cannot resolve the target, the scenario `fails` and is recorded to `FlakinessTracker` with an error type. `skipped` is reserved for an action nobody implements. Alongside it, `ReportManager` gains one rule in the shape of Phase 10's `deduped` rule: `passed`, `failed` and `quarantined` are the only statuses that mean a verdict was reached, so a run with none of them is `NO_TESTS_RUN` and exits 1 exactly as an empty run does.

### Scenarios kept running after the page changed under them

**Problem:** once a navigation-type scenario clicked a link, every later scenario in that plan executed against the new page's DOM. Reproduced in a three-page fixture, where `Navigate: Account` failed for no reason other than the browser already being on `/cart`. Pre-existing, but Phase 10 multiplies it: every discovered page now contributes up to three navigation scenarios instead of only the entry page.

**Fix:** `TestRunner` compares the normalised URL before and after each scenario and returns to the plan's URL only when it actually drifted, so the common case costs no extra page loads. A failed return is logged and does not abort the remaining scenarios.

### Running without a local database is a declaration, not a verdict

**Problem:** the new exit-code rule caught something it shouldn't have. Both DB tests push a single `skipped` row when `DB_HOST`/`DB_USER` are unset — the Phase 6 convenience that lets a contributor without Postgres run the suite — so `npm run test:db` started exiting 1 locally, contradicting the repository's own contributor instructions.

**Fix:** the distinction moved to where the intent lives rather than softening the rule. With no database configured and CI unset, the test says plainly that nothing was verified and exits 0 without writing a report. With no database configured *while CI is set*, the workflow is broken — CI provisions a Postgres service container, so a missing configuration there means the job is silently testing nothing, and that is a real failure naming the missing configuration. `ReportManager` was not touched. Independent review then found the control could be fooled: `CI` is a convention, not a boolean, and some tooling exports `CI=false` specifically to turn CI behaviour off, which a truthiness check reads as "in CI". `false` and `0` are now not CI; `1` and `true` are. All five variants are asserted on the real process exit code.

### Verification

`tests/regression/healing.check.cjs` covers the generalised chain per action and the unconditional trust gate; `tests/regression/browser.spec.js` covers what a fake page object cannot model, driving real Chromium against renamed inputs and selects; `tests/regression/core.check.cjs` covers the runner's return-to-page behaviour and the cost-free common case; `tests/regression/reporting.check.cjs` and `tests/unit/ReportManagerExitCode.check.js` assert the exit code directly; `tests/unit/DBConfigBehavior.check.js` spawns the real DB scripts and asserts their process exit codes across every `CI` value.

Independent QA drove the healed interactions in a real browser and confirmed the fill genuinely landed in the renamed field and the select genuinely changed the option — a passed row is not proof an interaction happened — and re-ran a full multi-page sweep to confirm Phase 10 was not regressed.

Total regression suite after this phase: 414 `node:test` cases and 38 Playwright specs.

### The run summary counted healing attempts as healing successes

**Problem:** building the Phase 11 demo against the live site produced a run that printed `Self-healing events: 22`. It had repaired zero selectors. `ReportManager` printed `healingEvents.length`, and every attempt is logged — including a Tier 3 ask that resolves nothing because no API key is configured. The healing log for that run was 11 `LLM` entries and 11 `exhausted` entries, `resolved: 0` on all of them. Anyone reading the summary would have concluded 22 selectors were fixed. The README's own "15 selectors self-healed" figure came from the same counting method.

**Fix:** the line separates repairs from attempts — `Self-healing: 0 selector(s) repaired, 11 attempt(s) that resolved nothing`. Three regression cases cover a mixed run, a run that repaired nothing, and a clean run that mentions no failed attempts. The README's case-study figures were re-measured from a real run rather than carried forward.

### Demo

Three demo scripts were added or extended, each of which exits non-zero if its own assertions fail, so a demo cannot quietly succeed while the mechanism behind it is broken:

`docs/demo/phase-11-heal-every-action-demo.js` breaks the locators of two real controls on the live site — the `/news` search field and the second model dropdown on `/compare`, neither of which carries an id, name or test id — between analysis and execution, and proves the three-tier chain now repairs both. The typed value and the selected option are read back out of the live page, because a `passed` line is not evidence that an interaction happened. The LLM call is stubbed, and the script says so in its own output.

`docs/demo/honest-exit-code-demo.js` spawns each reporting case as a real child process and compares the reported result against the exit code the operating system actually saw, including the two cases that used to report PASSED: an all-skipped run and an all-deduplicated one.

`docs/demo/flaky-test-detection-demo.js` gains the guard that landed after Phase 10: a scenario that has never passed is refused quarantine, and becomes quarantinable only once it genuinely passes.

Measured against the previous release on the same 11-page site, the same command now reports 0 skipped where it reported 2 — two `Fill input field` scenarios that were silently dropped before reaching the healer, now resolved into one pass and one honest failure.

### A recorded UI suite, because the demos were all scripts

**Problem:** every demo above is a Node script that drives Playwright and prints assertions. That is good evidence for a reader who runs it, and no evidence at all for a reader who doesn't — and none of it looked like a test suite. Healing in particular was only ever shown through log lines and a stubbed LLM, so the obvious question ("does this actually work in a browser, without an API key?") had no answer anyone could watch.

**Fix:** `tests/demo/axonradar.ui.spec.js`, six Playwright tests against the live site, run with `npm run test:demo` and recorded by `playwright.demo.config.js` (`video: "on"`, so a passing run is recorded too, which is the point). Four are ordinary UI tests — every nav route loads, search narrows the feed to cards that genuinely contain the query, a category chip filters rather than reorders, the comparator grows a column. Two hand Falcon a selector that does not exist on the page (`#news-search`, `#model-2-select`) and assert the interaction lands anyway: the live feed filters, the comparison table updates, and `HealingReport` records one Tier 2 repair with the right action. Tier 2 needs no API key, so these are reproducible by anyone.

`docs/demo/build-ui-test-recording.js` turns the videos into the README's GIF and MP4. It locates each recording through `reports/ui-demo-results.json` rather than by walking the artefact directory, because Playwright names those directories after a truncated, hashed form of the test title and matching on them breaks silently the first time a title is edited. Reading the reporter's JSON also gives it each test's status, and it refuses to write either file if any test failed or any video is missing.

The suite is not in CI and is excluded from `npx playwright test` via `testIgnore` in `playwright.config.js`: it depends on a third-party deploy staying up, and this repo's engineering rules rule out uncontrolled third-party sites as a CI dependency. Last measured run: 6 passed in 32.5s.

---

## Phase 12 — Guarantees that survive CI

Flaky-test detection and quarantine work only when state persists. Phase 9 worked locally but evaporated between CI runs, the most common flake shape was invisible to the classifier, human decisions were silently evicted, and corrupt state voided every decision. Phase 10 made this urgent: many more pages means many more scenarios, evictions and decisions.

### Flaky-test detection is now inert in CI

**Problem:** `data/scenario_history.json` is never cached between Actions runs. Each scenario runs once per run against a 3-sample minimum, so every scenario in CI is permanently `new`. Nothing classifies as `flaky`, `flakyDetected` never fires, and local quarantines never reach CI.

**Fix:** The `test` job now restores four state files before the pipeline runs and saves them afterwards, keyed to the branch with fallback to the most recent cache on it: `data/scenario_history.json`, `data/quarantine_decisions.json`, `data/healing_pending.json`, `data/healing_decisions.json`. Deliberately not the whole `data/` directory — `data/locator_store.json` lives there too, and restoring approved Tier 2 selectors between CI runs would change how healing behaves in CI. State is saved even when the pipeline fails, because a failure is a sample. The cache tolerates its own write errors so a cold run that died before writing anything does not turn the job red.

### One run cannot reach the 3-sample minimum without cached history

**Problem:** Flakiness classification requires 3+ samples. A developer running `falcon.js` locally will never see a verdict on first run, and CI has no history at all.

**Fix:** `falcon.js` accepts a new `--repeat=N` flag that re-executes each page's generated test plan N times within one run, starting from a fresh page load each time. Each repetition is recorded as a distinct sample, so `--repeat=3` produces a verdict immediately. Valid values are integers 1–50. An invalid value (non-numeric, zero, negative, fractional, above 50, or the flag given twice with conflicting values) **fails the run with a non-zero exit code before the dashboard starts**. Unlike `--max-pages`/`--budget-ms`, which warn and fall back to their default, a silently-defaulted `--repeat` to 1 would be indistinguishable from a user not asking to repeat, and the samples would never be collected. With `--repeat=N`, the budget-ms is checked between pages and covers all repetitions collectively, so later pages may be skipped if time is exhausted.

### A sometimes-missing target now classifies as flaky, not stable

**Problem:** A sometimes-missing `type` or `select` target is marked `skipped` before the healer is consulted, and `skipped` is never recorded to `FlakinessTracker`. The textbook flake shape (present sometimes, absent others) has no signal in the history, so it classifies as `stable`, 0% fail rate.

**Fix:** Phase 11 deleted the silent skip and made unresolvable targets fail instead. Phase 12 adds a new outcome, `unavailable`, for a target that is not visible and cannot be healed. `unavailable` is distinct from `skipped` (an action type Falcon does not implement), recorded by `FlakinessTracker`, and counts as a failure for classification purposes. A target that is sometimes present and sometimes absent now classifies as `flaky`.

### Quarantine evicts human decisions

**Problem:** `_evictLeastRecentlyUsed()` sorts on `lastUsed` with no exemption for quarantined entries. Verified: quarantine + 600 new scenarios → decision gone, failures block again, nothing logged.

**Fix:** Quarantined entries and any entry referenced by the decision ledger are now protected from eviction. If eviction cannot bring the total back under the cap because too many entries are protected, the system warns once naming the tracked total, the protected count, how many were evicted and how far over the cap that leaves things, rather than dropping a human decision quietly.

### State files can be truncated by an interrupted write

**Problem:** All four state files are written with a plain `writeFile`, not temp-then-rename. An interrupted write truncates the file to zero bytes. `_loadJson` recovers to empty with no log line, silently voiding the entire review queue or every quarantine.

**Fix:** State files are now written to a temporary file in the same directory and renamed into place, making the write atomic at the filesystem level. `_loadJson` catches parse errors, logs a warning naming the file, preserves the original bytes beside it as `<name>.corrupt-<timestamp>-<pid>-<uuid>`, and starts from empty state. An existing sidecar is never overwritten. The operator should manually recover the decision from the sidecar and delete it once recovered.

### Durable, visible, and cross-run

State accumulated in CI now consists of samples, not decisions — nothing in CI can create a quarantine decision, because only the dashboard and `scripts/flakiness/review.js` can, and neither runs in the CI job. The `by` field recorded in `data/quarantine_decisions.json` is a free-text operator label, not a validated email address or user ID. State persists across CI runs via the workflow cache, carrying history between runs on the same branch and enabling a pull request to restore from its base branch.

A quarantine made locally was documented as "demonstrably applies on the next CI run" in Phase 12 milestone descriptions. That requires a developer's laptop state to enter the CI cache, which caching cannot do — the Actions cache can only restore what a previous Actions run saved. The truthful behavior is: state persists across CI runs on the same branch, and a pull request can restore from its base branch.

### Verification

491 regression tests passing, 43 browser tests passing, 94.70% statement coverage, measured on Node 22. Every measurement was performed locally (no remote or mocked calls). Coverage improved from the Phase 9 baseline of 93.17% statements.
