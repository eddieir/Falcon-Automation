# Falcon-Automation — Engineering Handoff

> **For:** Any engineer or Claude Code session continuing this work
> **Author:** Peyman Iravani — QA Manager / Tech Lead
> **Last updated:** Phase 4 (repository hygiene) in progress
> **Repo:** https://github.com/eddieir/Falcon-Automation

---

## 1. Project in One Paragraph

Falcon is a Node.js test automation framework built on Playwright. Its differentiator is a genuine three-tier self-healing engine: when a selector fails, it retries with smart backoff (Tier 1), consults a persisted locator cache (Tier 2), and finally calls an OpenAI LLM to infer a working alternative selector at runtime (Tier 3). The framework also runs an autonomous crawl of any web app, generates its own test scenarios from the live DOM, compares screenshots pixel-by-pixel for visual regression, and streams all of this to a real-time browser dashboard.

---

## 2. Repository State

| Item | Value |
|---|---|
| `main` | Phases 1–3 merged (PR before Phase 2, PR #5, PR #6) |
| Open PRs | `docs/public-roadmap` (README roadmap section) · `phase-4/repo-hygiene` (this work) |
| Node version | 20 in CI (`node-version: "20"` in `ci.yml`); code must not assume Node ≥20.19 features — see the `pixelmatch` ESM lesson below |
| Test target | https://www.saucedemo.com |

### Branch History (high level)

```
main (current tip):
  fd0d4d8  allure history            ← accidental commit, .allure/history.jsonl untracked in Phase 4
  0434140  Merge PR #6 (Phase 3)
  ...      Phase 3 commits (AdaptiveRetry, VisualRegression, Dashboard, PageAnalyser/TestGenerator
           consolidation, Allure/CI fixes, review-round fixes)
  ...      Merge PR #5 (Phase 2 — reporting, ConfigManager, .env untracking, CI fixes)
  ...      Phase 1 (LLM-powered self-healing, ReportManager tallying, foundational fixes)
```

Two things worth knowing about this history if you're new to the repo:
1. A real Supabase DB password and an OpenAI key were at different points committed to `.env` on various branches. Both were treated as compromised and the user was told to rotate them — check with the user that this actually happened before assuming any credential in old history is safe.
2. One PR (`feat/phase-2-stability-and-coverage`) briefly had its git history rewritten to scrub a leaked secret, which severed shared ancestry with `main` and caused GitHub to auto-close the PR. **Lesson: never rewrite history on a branch with an open PR if the secret is already exposed elsewhere (e.g. already merged into `main`) — a plain `git rm --cached` + new commit is safer and doesn't break the PR relationship.**

---

## 3. `.env` Reference (verified against `.env.example` and actual code)

```ini
# ── Browser ──────────────────────────────────────────────────────────────
BROWSER=chromium           # chromium | firefox | webkit
HEADLESS=true              # true for CI; false to watch the browser locally

# ── OpenAI — optional, enables Tier 3 AI self-healing ──────────────────────
OPENAI_API_KEY=sk-...      # NOT strictly required: AIHealer/AIAnalyser/AIHelper
                            # all guard `if (!process.env.OPENAI_API_KEY) return null`
                            # and degrade gracefully — Tier 3 just never fires.

# ── API base URL — optional (defaults to jsonplaceholder) ─────────────────
API_BASE_URL=https://jsonplaceholder.typicode.com   # NOT "BASE_URL"

# ── Live dashboard — optional ──────────────────────────────────────────────
DASHBOARD_PORT=3000
DASHBOARD_LINGER_MS=60000
DASHBOARD_URL=http://localhost:3000   # set only on a standalone test process
                                       # (e.g. `node tests/ui/LoginTest.js`) to
                                       # report its events into an already-
                                       # running `node falcon.js` dashboard

# ── PostgreSQL — required only for DB tests ────────────────────────────────
DB_HOST=your_db_host
DB_PORT=5432
DB_USER=your_db_user
DB_PASS=your_db_password
DB_NAME=your_db_name
DB_SSL=true

# ── SSL/mTLS — only when DB_SSL=true and using client certs ────────────────
SSL_CA_FILE=./certs/ca.pem      # NOT "DB_SSL_CA"
SSL_KEY_FILE=./certs/client.key # NOT "DB_SSL_KEY"
SSL_CERT_FILE=./certs/client.crt # NOT "DB_SSL_CERT"
SSL_REJECT_UNAUTHORIZED=true
```

---

## 4. File Map (corrections from the last handoff draft only — see `.env.example` and `src/` for the full picture)

- `src/core/ActionInterpreter.js` — **deleted in Phase 4** (dead code, zero references anywhere).
- `src/core/PageAnalyser.js` / `src/core/TestGenerator.js` — **consolidated**. `TestGenerator` now delegates its DOM scan and action generation entirely to `PageAnalyser`; there is exactly one scanner, not two. `PageAI.js` (the original duplicate) was deleted in Phase 3.
- `src/core/SelfHealingManager.js` — **still exists**, still used by `src/ui/pages/LoginPage.js`. This is a second, older, two-tier healing path that has not been consolidated onto `AIHealer` (the three-tier engine used everywhere else). Scheduled for Phase 5.
- `src/core/APIClient.js` — **actively used** (registered in `ServiceContainer`, consumed by `tests/api/UserApiTest.js` and `tests/api/ProductApiTest.js` via `this.apiClient`). A previous handoff draft incorrectly listed this as dead code.
- `src/core/ServiceContainer.js` — a real but partial DI container: `browserManager`, `apiClient`, `dbClient` (optional — see `getOptional()`), and `reportManager` are registered here, but not every shared dependency in the codebase goes through it. Still an open inconsistency (Phase 5).
- `src/core/AIHealer/LocatorStore.js` — persists Tier 2 alternative selectors to `data/locator_store.json`. `addLocator()` only ever appends; there's no TTL or size cap, so this file grows unbounded over a long project history (Phase 5).
- `tests/full_automation.test.js` — **renamed** from `full_autoamtion.test.js` in Phase 4 (typo fix). `package.json`'s `test:e2e` script and `playwright.config.js`'s doc comment were updated to match.

---

## 5. How to Run

```bash
npm install
npx playwright install --with-deps chromium

cp .env.example .env
# OPENAI_API_KEY is optional — see §3. Set it to exercise Tier 3 healing.

node tests/ui/LoginTest.js
node tests/ui/CheckoutTest.js
node tests/api/UserApiTest.js
node tests/api/ProductApiTest.js

node falcon.js                # autonomous pipeline, live dashboard at :3000
node falcon.js --no-dashboard # same, no dashboard server (also the default
                               # whenever CI=true is set, unless --dashboard
                               # is passed explicitly)

npx playwright test           # native suite, allure-playwright reporter active

npx allure awesome allure-results -o allure-report   # NOT `allure generate ... --clean`
npx allure open allure-report                        # this beta CLI doesn't support --clean at all
```

---

## 6. Architecture — Three-Tier Self-Healing

```
healAndClick(selector, description)
    │
    ├── Tier 1: AdaptiveRetry
    │     waitForSelector → click
    │     On failure: classify error → exponential backoff with jitter → retry
    │     TIMEOUT ×2.0 · STALE_ELEMENT ×1.5 · NETWORK ×0.75 · HARD → bail immediately
    │
    ├── Tier 2: LocatorStore
    │     Look up alternative locators persisted from previous healing events
    │     Try each in order → on success, save to front of list
    │
    └── Tier 3: AIHealer (OpenAI gpt-4o-mini)
          Send DOM snapshot + original selector to LLM
          LLM returns best alternative CSS selector
          Try it → if it works, persist to LocatorStore for future Tier 2 hits
```

Every healing event (Tier 2 hit, Tier 3 resolution, or exhausted) is logged via `HealingReport.log()`, which also emits a `healingEvent` to the live dashboard (via `Middleware.emit()`, with an HTTP fallback for standalone test processes — see `DASHBOARD_URL` in §3).

This chain applies to everything that calls `AIHealer.healAndClick()`. **`src/ui/pages/LoginPage.js` does not** — it still goes through the older `SelfHealingManager` (see §4).

---

## 7. Architecture — Autonomous Pipeline (`falcon.js`)

```
1. Dashboard.start()              → http://localhost:3000 (skipped if --no-dashboard
                                     or CI=true; a bind failure logs a warning and
                                     continues without it rather than crashing)
2. ExploratoryAI.detectUIIssues() → array of detected UI issues
3. ClickExplorer.explore()        → Set of visited page URLs
4. TestGenerator.generateTestScenarios()
     (delegates internally to PageAnalyser.analyze() + generateActions())
5. TestRunner.executeTest()       → runs all generated scenarios with healing
6. TestRunner.executeExploratoryTest() → writes reports/exploratory_test_results.json
   Dashboard.emit(...) at every step
7. If the dashboard is running, it stays up for DASHBOARD_LINGER_MS (default 60s)
   for result review, then the process exits.
```

---

## 8. Architecture — Visual Regression

```
VisualRegression.snapshot(name):
  no baseline yet → captureBaseline(name) → reports/baselines/<name>.png
  baseline exists → compare(name)
      → new screenshot → reports/screenshots/<name>.png
      → pixelmatch diff → reports/diffs/<name>-diff.png
      → diffPercent ≤ threshold (default 0.5%)? "passed" : "failed"
      → appended to reports/visual-regression.json (writes serialised through
        a class-level queue to avoid a read-modify-write race)

Threshold: configurable per-VisualRegression-instance (threshold, diffThreshold).
A failed comparison is currently a logged warning, not a hard test failure —
LoginTest/CheckoutTest wrap the whole VR check in its own try/catch so an
infra failure there (corrupt PNG, disk full) can't misreport a real
functional pass as failed.
```

CI persists `reports/baselines/` across runs via `actions/cache@v4` keyed on the branch name, so `compare()` actually runs there instead of always re-capturing on a fresh runner.

---

## 9. Known Issues and Gaps (re-verified; superseded rows removed)

| Priority | Area | Issue | Target |
|---|---|---|---|
| P1 | `tests/ui/GoogleSearchTest.js` | Uses `AIHealer` correctly, but is not run in CI at all (`ci.yml` never invokes it). | Phase 7 |
| P1 | `tests/db/*.js` | Never run in CI — no Postgres available there; failures are invisible until someone runs them locally. | Phase 6 |
| P2 | `src/core/SelfHealingManager.js` | Parallel, older healing path used only by `LoginPage.js` — not consolidated with `AIHealer`. | Phase 5 |
| P2 | `src/core/ServiceContainer.js` | Partial DI — some shared deps go through it, others are constructed directly. | Phase 5 |
| P2 | `src/core/AIHealer/LocatorStore.js` | `data/locator_store.json` grows unbounded — no TTL or eviction. | Phase 5 |
| P3 | Dashboard | No auth — `POST /emit` and the socket connection accept unauthenticated writes/reads; `cors: { origin: "*" }`. Fine for a local dev tool, not for a shared/networked one. | Phase 7 |
| P3 | Self-healing trust | Every healing event is logged, but nothing surfaces it as a trend, and a Tier-3 (LLM) resolution is trusted and reused with no review step. | Phase 8 |

Resolved since the last draft of this document: the `full_autoamtion.test.js` typo (renamed), the unused-dependency list (`selenium-webdriver`, `zaproxy`, `postgresql`, `io`, `@achannarasappa/locust` removed — `axios` is genuinely used and was kept), `ActionInterpreter.js` (deleted, was dead), visual-regression baselines never persisting in CI (fixed via branch-keyed cache in Phase 3).

---

## 10. Coding Conventions

- **Never `console.log`** — always `Logger.info / Logger.warning / Logger.error` so everything lands in `reports/execution.log`.
- **Never `fs.writeFileSync`/`fs.readFileSync` on a hot path** — prefer `fs.promises.*`; where sync is unavoidable (e.g. one-time startup), say why in a comment.
- **Path construction**: always use `path.join(__dirname, ...)` with the correct number of `..` segments to reach the intended target from the file's *actual* location — get this wrong and the failure is silent (falls back to a default) more often than it throws, which is how several of these bugs went unnoticed for a while.
- **No raw axios calls to OpenAI** — always go through the `openai` SDK, lazy-initialised, guarded by `if (!process.env.OPENAI_API_KEY) return null` (see `utils/AIHelper.js`, `src/core/AIHealer/AIHealer.js`, `src/core/AIHealer/AIAnalyser.js`).
- **Error handling**: every test's `runTest()` wraps `Middleware.beforeTest`/`afterTest` in try/catch/finally, and pushes a real `{name, status, error?}` entry into `this._results` on both success and failure paths — a test that doesn't push a result will always report `NO_TESTS_RUN` regardless of what actually happened.
- **Git author**: Peyman Iravani / peyman.iravani@gmail.com — no Claude attribution in commits or PR descriptions for this repo.
- **Branching**: one branch per phase/feature off `main`, one PR per phase (not one giant PR) so review stays scoped.
- **Before merging any PR touching CI-sensitive code, verify on the actual GitHub Actions run, not just locally** — this project has twice shipped code that worked locally and broke in CI's actual Node version/environment (`pixelmatch`'s ESM-only build, `allure generate --clean` not existing on the installed CLI).

---

## 11. CI Pipeline Summary (`.github/workflows/ci.yml`, verified against current file)

Runs on push/PR to `main`, `New_era_Falcon`, `feat/**`:

1. Checkout → `actions/setup-node@v4` (Node 20, npm cache) → `npm ci` → `npx playwright install --with-deps chromium`
2. **Restore visual regression baselines** — `actions/cache@v4`, keyed on `vr-baselines-${{ github.ref_name }}`
3. `node tests/ui/LoginTest.js`
4. `node tests/ui/CheckoutTest.js`
5. `node tests/api/UserApiTest.js`
6. `node tests/api/ProductApiTest.js`
7. `node falcon.js --no-dashboard` (redundant-but-explicit; `CI=true` alone now also disables the dashboard)
8. `npx playwright test` (`continue-on-error: true`)
9. `npx allure awesome allure-results -o allure-report || true` (NOT `allure generate ... --clean` — that doesn't work on the installed `allure@3.0.0-beta.9` CLI at all)
10. Upload `reports/` + `allure-report/` as the `falcon-reports` artifact (14-day retention)

No DB test step exists yet (Phase 6). `GoogleSearchTest.js` is not run in CI (Phase 7).

Required secret: `OPENAI_API_KEY` (optional at runtime per §3, but wired as a secret so Tier 3 healing is exercised in CI when set).
