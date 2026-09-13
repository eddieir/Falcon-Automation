# Falcon-Automation — AI-Powered Test Automation Framework

> **Status:** Active development · Branch `feat/phase-1-ai-core-foundation` contains Phase 1 stabilisation fixes.

---

## Overview

Falcon is an open-source test automation framework built on Playwright that integrates a genuine LLM-powered self-healing engine.  Unlike most "AI testing" tools that use static heuristics or hardcoded fallback maps, Falcon's three-tier healing chain falls back to a live OpenAI inference call when all attribute-based alternatives have been exhausted.

**Core capabilities:**

- **UI automation** via Playwright (Chromium, Firefox, WebKit)
- **Three-tier self-healing** — direct attempt → LocatorStore → LLM inference
- **Autonomous UI exploration** — recursive crawler (ClickExplorer) + DOM-based defect detection (ExploratoryAI)
- **Accurate reporting** — structured pass/fail/skip tallying with wall-clock duration and healing audit trail
- **Database testing** — PostgreSQL via `pg` Pool with full mTLS support
- **CI/CD ready** — GitHub Actions workflow included

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

## CI/CD

GitHub Actions workflow runs on every push to `main` and on pull requests:

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: node falcon.js
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          HEADLESS: true
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
