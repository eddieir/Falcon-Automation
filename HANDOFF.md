# Falcon-Automation — Engineering Handoff

> **For:** Any engineer or Claude Code session continuing this work
> **Author:** Peyman Iravani — QA Manager / Tech Lead
> **Last updated:** post-Phase-12. Phase 13 ("Decisions that can't rot") implementation in progress on branch `phase-13/decisions-cant-rot`, pending review and merge authorization.
> **Repo:** https://github.com/eddieir/Falcon-Automation

---

## 0. This file is not committed — a note on why it disappeared once

`HANDOFF.md` is intentionally untracked (added to `.gitignore` in Phase 6 — this repo is public, and this doc has internal notes that shouldn't be). It lives only on disk. At the start of Phase 7 this file was found missing entirely from the working tree, with no trace in git (expected, since it was never tracked) — most likely local environment state didn't persist across a session boundary. A stale pre-Phase-4 copy turned up in `~/Downloads/Claude outputs/HANDOFF.md`, but rather than patch a nine-phases-stale draft, this is a full rewrite verified fresh against the current repo, same approach as the original Phase 4 rewrite. If you're reading this because it happened again: check `~/Downloads/Claude outputs/` for the last thing the user was handed, but verify everything in it before trusting it — don't assume it's current.

---

## 1. Project in One Paragraph

Falcon is a Node.js test automation framework built on Playwright. Its differentiator is a genuine three-tier self-healing engine: when a selector fails, it retries with smart backoff (Tier 1), consults a persisted locator cache (Tier 2), and finally calls an OpenAI LLM to infer a working alternative selector at runtime (Tier 3). The framework also runs an autonomous crawl of any web app, generates its own test scenarios from the live DOM, compares screenshots pixel-by-pixel for visual regression, streams all of this to a real-time browser dashboard, and (as of Phase 6) runs its DB test suite against a real Postgres in CI with results that actually gate merges.

---

## 2. Repository State

| Item | Value |
|---|---|
| `main` | Phases 1–12 merged (at ac27825). Phase 13 ("Decisions that can't rot") is implemented on branch `phase-13/decisions-cant-rot`, uncommitted, pending review and merge authorization. |
| Node version | 24 in CI (`node-version: "24"` in `ci.yml`, bumped in Phase 6). **Node 20.19+ required locally** — `package.json` declares `engines.node`, since `test:regression`/`test:coverage` use `node:test` flags that don't exist on older Node. |
| Test target | https://www.saucedemo.com (UI/DB scenarios), https://jsonplaceholder.typicode.com (API scenarios), https://www.google.com (GoogleSearchTest — not run in CI, see §9), plus inline HTML fixtures for `tests/regression/*` suite (no real target site, deterministic) |

Two things worth knowing about this history if you're new to the repo:
1. A real Supabase DB password and an OpenAI key were at different points committed to `.env` on various branches early on. Both were treated as compromised and the user was told to rotate them.
2. One PR (`feat/phase-2-stability-and-coverage`) briefly had its git history rewritten to scrub a leaked secret, which severed shared ancestry with `main` and caused GitHub to auto-close the PR. **Lesson: never rewrite history on a branch with an open PR if the secret is already exposed elsewhere — a plain `git rm --cached` + new commit is safer.**

---

## 3. `.env` Reference (verified against `.env.example` and actual code)

```ini
# ── Browser ──────────────────────────────────────────────────────────────
BROWSER=chromium           # chromium | firefox | webkit
HEADLESS=true               # true for CI; false to watch the browser locally

# ── OpenAI — optional, enables Tier 3 AI self-healing ──────────────────────
OPENAI_API_KEY=              # every call site guards `if (!process.env.OPENAI_API_KEY) return null`.
                              # Ships blank now — see the QA-hardening note below on why a
                              # placeholder string here used to be actively harmful.

# ── API base URL — optional (defaults to jsonplaceholder) ─────────────────
API_BASE_URL=https://jsonplaceholder.typicode.com

# ── Live dashboard — optional ──────────────────────────────────────────────
DASHBOARD_PORT=3000
DASHBOARD_LINGER_MS=60000
DASHBOARD_URL=http://localhost:3000   # standalone test process → already-running dashboard

# Phase 7 — dashboard auth, both optional, unset = current unauthenticated behavior
DASHBOARD_TOKEN=                      # required on POST /emit, GET /events, and the
                                       # socket handshake once set. Open the dashboard
                                       # at http://localhost:3000/?token=<value>.
DASHBOARD_ALLOWED_ORIGIN=             # socket.io CORS origin; defaults to the
                                       # dashboard's own localhost origin

# ── PostgreSQL — required only for DB tests ────────────────────────────────
DB_HOST=                     # blank = tests/db/*.js skip cleanly (exit 0). See QA-hardening
DB_PORT=5432                 # note below — do NOT put placeholder text like "your_db_host"
DB_USER=                     # here, DBClient only checks truthiness, not content.
DB_PASS=
DB_NAME=
DB_SSL=false                 # set true only if your Postgres actually requires TLS

# ── SSL/mTLS — only when DB_SSL=true and using client certs (commented out
#    by default so DB_SSL=false is the truly-unconfigured, truly-quiet path)
# SSL_CA_FILE=./certs/ca.pem
# SSL_KEY_FILE=./certs/client.key
# SSL_CERT_FILE=./certs/client.crt
# SSL_REJECT_UNAUTHORIZED=true
```

**QA-hardening pass, real bug fixed:** `.env.example` used to ship `DB_HOST=your_db_host`, `DB_USER=your_db_user`, `DB_SSL=true`, `SSL_CA_FILE=./certs/ca.pem` — all non-empty strings. `DBClient`'s "is this configured" check (`!process.env.DB_HOST || !process.env.DB_USER`) is truthiness-based, so those placeholders looked configured, and `ServiceContainer.js` rethrows when `DB_HOST && DB_USER` are both truthy rather than treating it as "no DB" — so a contributor who ran `cp .env.example .env` exactly as instructed and then `node tests/db/UserDBTest.js` got a hard crash (`ENOENT: ./certs/ca.pem`), not the clean skip the Phase 6 fix was supposed to guarantee. `tests/unit/DBConfigBehavior.check.js` never caught this because it forces `DB_HOST=""` directly rather than exercising the shipped file. Found by an independent QA pass that actually ran `cp .env.example .env` fresh rather than assuming the Phase 6 fix covered this case. Fixed by making every optional/DB placeholder genuinely blank.

---

## 4. File Map (recent changes only — see `.env.example` and `src/` for the full picture)

- `src/core/Dashboard.js` — **Phase 7**: `POST /emit`, `GET /events`, and the socket.io handshake all now require `DASHBOARD_TOKEN` when it's set (header `X-Dashboard-Token`, query param `?token=`, or socket `auth: { token }`). Unauthorized socket connections are rejected outright (`connect_error`), not silently allowed through. CORS restricted from `origin: "*"` to `DASHBOARD_ALLOWED_ORIGIN` (default: the dashboard's own localhost origin). When `DASHBOARD_TOKEN` is unset, behavior is unchanged from Phase 3–6, but `start()` now logs a loud warning. Also fixed: `this.port` wasn't updated after `listen(0)` (ephemeral port), so `dashboard.url` printed the wrong port when port 0 was used (only matters for the regression test, which uses ephemeral ports to avoid colliding with a real dashboard).
- `src/core/Middleware.js` — **Phase 7**: `emit()`'s HTTP `POST /emit` fallback now sends `X-Dashboard-Token` when `DASHBOARD_TOKEN` is set, so a standalone test process (`DASHBOARD_URL=...`) can still report into a token-protected dashboard. No token configured → no header sent → unchanged from before.
- `src/dashboard/index.html` — **Phase 7**: reads `?token=` from the URL on load, persists it to `localStorage` (best-effort, wrapped in try/catch) and strips it from the visible URL via `history.replaceState`, then passes it into `io({ auth: { token } })`. Falls back to `localStorage` on reload if the URL has no token. Shows a clear "Unauthorized" status label on `connect_error` instead of just silently failing to connect.
- `tests/ui/GoogleSearchTest.js` — **Phase 7 fix, not wired into CI** (see §9). Was failing 100% of the time locally due to Google's cookie-consent dialog covering the search box (confirmed: an Italian-language "Prima di continuare su Google" overlay, region-dependent). Fixed by dismissing it via its `id` (`#L2AGLb`, Google's "Accept all" button — stable across locales, unlike the visible text) before searching, with a short timeout + catch since not every region/profile shows it.
- `tests/unit/DashboardAuth.check.js` — **new in Phase 7**. Spins up a real `Dashboard` instance on an ephemeral port and makes real HTTP requests + real `socket.io-client` connections against it — proves both that the no-token default is unchanged and that every one of `POST /emit` / `GET /events` / the socket handshake actually rejects unauthenticated and wrong-token attempts when `DASHBOARD_TOKEN` is set. Confirmed it catches a real regression by temporarily removing the socket auth middleware and watching it fail. Also covers rate limiting — see below.
- `src/core/Dashboard.js` — **CodeQL follow-up, same PR**: the first push of this branch triggered a real CodeQL finding — `POST /emit` and `GET /events` performed authorization but had no rate limiting, so `DASHBOARD_TOKEN` could be brute-forced by hammering either endpoint. Fixed with `express-rate-limit` (120 req/min, applied before the auth check) on both routes, plus a matching hand-rolled sliding-window limiter on the socket.io handshake (CodeQL doesn't analyze socket.io as an Express route, so it didn't flag that half, but the same risk applies there — no new dependency needed, ~15 lines). Also switched `_isAuthorized()`'s token comparison from `===` to `crypto.timingSafeEqual()` while already in that function, for the same general class of issue (timing side-channel, not something CodeQL flagged this time, but cheap to close while touching the exact function).
- `socket.io-client` — **new devDependency** (Phase 7), needed only to write the regression test above.

Everything from Phase 6 (DB tests in CI, the exit-code fix, `HANDOFF.md` untracking) is unchanged — see the Phase 6 PR (#10) and README's Phase 6 section for that detail; not re-derived here.

**PR #13 — comprehensive regression suite + community-health files** (this is the one this file previously had zero record of):
- New `tests/regression/*.check.cjs` (9 files, `node:test`, ~1,700 lines) + `tests/regression/browser.spec.js` (275 lines, 30 Playwright specs against inline HTML fixtures — no real target site, fast and deterministic). New `playwright.regression.config.js`, npm scripts `test:regression`/`test:browser`/`test:coverage`, and a second CI job (`regression`) running them — see §11.
- Real code changes alongside the tests: `PageAnalyser.js`, `LocatorStore.js`, `AdaptiveRetry.js`, `Dashboard.js`, `BrowserManager.js`, `TestRunner.js`, `VisualRegression.js` all got fixes found by writing this suite (not itemized individually here — see PR #13's diff for specifics).
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md` — standard GitHub community-health files, all present and substantive (verified, not just present).

**PR #14 — real selector-anchoring fix**: `PageAnalyser.js`'s duplicate-label/bare-tag fallback generated unanchored selectors like `button:nth-of-type(1)` — `:nth-of-type` only looks at an element's own siblings, so that selector matches ANY first-of-type button anywhere in the document, not just the intended one (e.g. one nested inside an unrelated disabled `<fieldset>`, which is also first-of-type among its own siblings). Fixed by walking the parent chain all the way to `<html>` instead of stopping at `<body>`, so the full selector is `>`-anchored end to end. **QA-hardening pass, gap found and closed:** the fix itself is genuine (independently re-verified with a positive repro and a negative control against the pre-fix code), but its own regression test (`browser.spec.js:234`) didn't actually exercise the bug — its fixture had no nested colliding element, so it would have passed on the old buggy code too. Strengthened by adding exactly that nested-fieldset case to the fixture; reconfirmed it now fails on a reverted copy of the fix and passes on the real one.

**PR #15 — README demo**: `docs/demo/` (GIF + 3 stills + `capture-dashboard.js` + `gif-list.txt`), regenerated as part of this QA-hardening pass to reflect the current repo state (see §5).

**QA-hardening pass (this work) — 4 real bugs found by an independent full scenario re-verification, all fixed here:**
1. `.env.example` placeholder crash — see §3.
2. `tests/regression/reporting.check.cjs` crashed node:test's own TAP parser (`ERR_TAP_LEXER_ERROR`) on Node 18.16.0 — the `ReportManager.generateReport()` call under test prints a real `⚠️`/`✅`/`❌` summary straight to `console.log`, and that raw output (specifically the `⚠️` variation-selector sequence) isn't valid TAP and corrupted the reporter's own parsing, failing the test for a reason unrelated to what it checks. Fixed by silencing `console.log` for the duration of the call under test (same "mock the noisy side channel" pattern already used elsewhere in that file for `Logger`) — production behavior (`node tests/...js` run directly) is untouched.
3. No declared Node version — `test:regression`/`test:coverage` silently require Node 20.19+ (their `node:test` flags don't exist on older builds) with no `engines` field anywhere to say so. Added `engines.node: ">=20.19.0"` to `package.json`.
4. PR #14's regression test coverage gap — see above.

---

## 5. How to Run

```bash
npm install
npx playwright install --with-deps chromium

cp .env.example .env
# OPENAI_API_KEY is optional — see §3.

node tests/ui/LoginTest.js
node tests/ui/CheckoutTest.js
node tests/api/UserApiTest.js
node tests/api/ProductApiTest.js
node tests/db/UserDBTest.js       # skips cleanly if no DB configured
node tests/db/OrderDBTest.js

npm run test:unit                 # 3 fast regression checks, no browser, no DB

npm run test:regression           # 183 node:test cases (needs Node 20.19+)
npm run test:browser              # 30 Playwright specs against inline fixtures
npm run test:coverage             # same as test:regression, with coverage

node falcon.js                    # autonomous pipeline, live dashboard at :3000
node falcon.js --no-dashboard     # same, no dashboard (also the CI=true default)

# Dashboard with auth (Phase 7):
DASHBOARD_TOKEN=some-secret node falcon.js --dashboard
# → open the printed URL, which includes ?token=some-secret

npx playwright test                                  # native suite
npx allure awesome allure-results -o allure-report   # NOT `allure generate ... --clean`
```

`node tests/ui/GoogleSearchTest.js` also works (the consent-dialog fix is real), but it's a manual/local-only tool — see §9 for why it's deliberately not in CI.

---

## 6. Architecture — Three-Tier Self-Healing

```
healAndClick(selector, description)
    ├── Tier 1: AdaptiveRetry — backoff + jitter, error-classified
    ├── Tier 2: LocatorStore — cached alternatives (bounded, LRU-evicted — Phase 5)
    └── Tier 3: AIHealer (OpenAI gpt-4o-mini) — live DOM snapshot → CSS selector
```

Single healing engine everywhere since Phase 5 (`SelfHealingManager` deleted). Every event logged via `HealingReport.log()`, which emits to the live dashboard.

---

## 7. Architecture — Dashboard Auth (Phase 7)

```
No DASHBOARD_TOKEN set (default):
  POST /emit, GET /events, socket connections — all open, as before.
  start() logs a loud warning so this isn't a silent accident.

DASHBOARD_TOKEN set:
  POST /emit, GET /events   → require X-Dashboard-Token header OR ?token= query param
  socket.io connection      → io.use() middleware requires auth.token in the handshake;
                               mismatch/missing → connect_error, connection refused
  CORS                      → DASHBOARD_ALLOWED_ORIGIN (default: this dashboard's own
                               localhost origin) instead of "*"

Front-end (src/dashboard/index.html):
  ?token=<value> in the URL → read once, saved to localStorage, stripped from the
  visible URL, sent as the socket auth token. Missing on reload → falls back to
  localStorage. Neither present → socket connects unauthenticated → connect_error →
  UI shows "Unauthorized — check the dashboard URL/token".

Middleware.emit()'s cross-process HTTP fallback (DASHBOARD_URL) sends
X-Dashboard-Token automatically when DASHBOARD_TOKEN is set in that process's env.
```

Verified end-to-end, not just at the unit level: real `falcon.js --dashboard` run with a token set, confirmed via `curl` that unauthenticated `GET /events` is 401 and authenticated is 200; confirmed a standalone `DASHBOARD_URL=... node tests/api/UserApiTest.js` with the matching `DASHBOARD_TOKEN` successfully reports events into the protected dashboard, and without the token its events are silently rejected (best-effort — the test itself still passes, matching the pre-Phase-7 "dashboard reporting must never break a test run" design).

---

## 8. Architecture — Autonomous Pipeline (`falcon.js`)

Unchanged since Phase 3/5 apart from the scanner's name: `Dashboard.start()` → `DOMIssueScanner` (named `ExploratoryAI` until Phase 12) → `ClickExplorer` → `TestGenerator` (delegates to `PageAnalyser`) → `TestRunner.executeTest()` → `TestRunner.executeExploratoryTest()`. Dashboard stays up for `DASHBOARD_LINGER_MS` (default 60s) after the run for review, then the process exits. `dashboard.url` (a getter, Phase 7) is what gets printed — includes `?token=` automatically when one's configured.

---

## 9. Known Issues and Gaps (re-verified for the post-Phase-7 QA-hardening pass)

| Priority | Area | Issue | Target |
|---|---|---|---|
| — | `tests/ui/GoogleSearchTest.js` | **Deliberately not run in CI.** Fixed the cookie-consent bug, but running it locally repeatedly gets bot-detection blocks. GitHub Actions runner IPs are well-known to bot-detection systems; wiring into CI would mean a test red most of the time for reasons unrelated to Falcon. Decision (explicit): keep the fix, don't add to CI. Kept as a manual/local demonstration of `AIHealer` against a real third-party site. | Resolved (won't add to CI) |
| P2 | `src/core/ServiceContainer.js` | Partial DI — some shared deps go through it, others constructed directly. | Unscheduled |
| P3 | `ReportManager.generateReport()` | A skip-only run reports `result: "PASSED"` — technically correct but misleading. Not fixed since Phase 6 because it changes what `npm run test:db` prints for contributors without local Postgres. | Unscheduled |
| P2 | `Dashboard._socketConnectAttempts` | Grows unboundedly per distinct IP over a very long-running dashboard process — no pruning of stale/inactive IPs. Low-priority for a local-first tool. | Unscheduled |

Resolved in Phase 7: dashboard had no auth at all — now gated behind `DASHBOARD_TOKEN` when set.

Resolved in Phase 8: unreviewed Tier 3 fixes gate behind human approval; rejection memory added in Phase 13.

Resolved in Phase 9: flaky-test detection and quarantine gating.

Resolved in Phase 13: staleness thresholds and rehabilitation candidates for quarantined scenarios; rejection memory surfaced; decision ledgers and pending fixes bounded and capped.

---

## 10. Coding Conventions

- **Never `console.log`** — always `Logger.info / Logger.warning / Logger.error`.
- **Never `fs.writeFileSync`/`fs.readFileSync` on a hot path** — prefer `fs.promises.*`.
- **Path construction**: `path.join(__dirname, ...)` with the correct `..` count — get it wrong and it fails silently more often than it throws.
- **No raw axios calls to OpenAI** — always the `openai` SDK, lazy-initialised, `if (!process.env.OPENAI_API_KEY) return null`.
- **Error handling**: every test's `runTest()` wraps `Middleware.beforeTest`/`afterTest` in try/catch/finally and pushes a real `{name, status, error?}` entry — a test that doesn't push a result reports `NO_TESTS_RUN`.
- **Process exit codes matter** (Phase 6): `ReportManager.generateReport()` sets `process.exitCode` from the tallied outcome — verify actual exit codes when testing CI-sensitive changes, not just the printed summary.
- **DB-dependent tests must check `this.dbClient` before using it**, and skip (not fail) if it's `null` (Phase 6 pattern, `tests/db/*.js`).
- **Before touching CI or shared infrastructure, verify the actual behavior first, not just the code** — this is how the Phase 6 exit-code bug, the Phase 7 dashboard-CORS-vs-same-origin distinction, and the Phase 7 Google bot-detection block were all found. Reading the code and assuming it's fine has repeatedly missed real, verifiable problems on this project.
- **Don't trust an external, uncontrolled third-party site as a CI dependency** (Phase 7, `GoogleSearchTest.js`) — no determinism, active bot-blocking, and failures there don't tell you anything about your own code.
- **Git author**: Peyman Iravani / peyman.iravani@gmail.com — no Claude attribution in commits or PR descriptions for this repo, and PR/commit text should read as if written by a person in one sitting, not a structured audit report.
- **Branching**: one branch per phase/feature off `main`, one PR per phase.
- **Before merging any PR touching CI-sensitive code, verify on the actual GitHub Actions run, not just locally.**
- **`.env.example` values must be genuinely blank for anything optional, never placeholder text** (QA-hardening pass) — `DBClient`/`ServiceContainer` and similar "is this configured" checks are truthiness-based, so `DB_HOST=your_db_host` reads as "configured" and breaks the intended skip path. If a value is optional, ship it empty.
- **A regression test that calls real production code must account for what that code prints**, not just what it returns (QA-hardening pass, `reporting.check.cjs`) — `node:test`'s TAP reporter parses this process's own stdout, so unmocked `console.log`/`Logger` output from the code under test can corrupt the test run itself, for a reason that has nothing to do with the assertion. Silence it for the call under test the same way `Logger` is already mocked elsewhere in that file.
- **A regression test for a specific bug needs a fixture that actually reproduces the bug** (QA-hardening pass, PR #14's `browser.spec.js:234`) — confirm this by checking the test fails against the pre-fix code, not just that it passes against the fix.

---

## 11. CI Pipeline Summary (`.github/workflows/ci.yml`, verified against current file)

Runs on push/PR to `main`, `New_era_Falcon`, `feat/**`. **Two independent jobs since PR #13** — this file previously (incorrectly) documented only one.

**`regression` job** (~1 min, no Postgres needed):
1. Checkout → `actions/setup-node@v4` (Node 24, npm cache) → `npm ci` → `npx playwright install --with-deps chromium`
2. `npm run test:coverage` — 183 `node:test` cases, `tests/regression/*.check.cjs`
3. `npm run test:browser` — 30 Playwright specs, `tests/regression/browser.spec.js`, against inline HTML fixtures (no real target site)
4. Upload `reports/` as the `regression-reports` artifact

**`test` job** (~1.5 min, the original scenario/E2E pipeline):
1. **`services.postgres`** — `postgres:16-alpine`, disposable, recreated fresh every run, health-checked with `pg_isready`.
2. Checkout → `actions/setup-node@v4` (Node 24, npm cache) → `npm ci` → `npx playwright install --with-deps chromium`
3. `node tests/unit/ReportManagerExitCode.check.js` — exit-code regression (Phase 6)
4. `node tests/unit/DBConfigBehavior.check.js` — DB skip-vs-fail regression (Phase 6)
5. `node tests/unit/DashboardAuth.check.js` — dashboard auth regression (Phase 7)
6. **Seed test database** — `psql ... -f scripts/db/ci-seed.sql`
7. **Restore visual regression baselines** — `actions/cache@v4`
8. `node tests/ui/LoginTest.js`
9. `node tests/ui/CheckoutTest.js`
10. `node tests/api/UserApiTest.js`
11. `node tests/api/ProductApiTest.js`
12. `node tests/db/UserDBTest.js` (no `continue-on-error`)
13. `node tests/db/OrderDBTest.js` (same)
14. `node falcon.js --no-dashboard`
15. `npx playwright test` (`continue-on-error: true`)
16. `npx allure awesome allure-results -o allure-report || true`
17. Upload `reports/` + `allure-report/` as the `falcon-reports` artifact (14-day retention)

`GoogleSearchTest.js` is deliberately not in either job — see §9.

Required secret: `OPENAI_API_KEY` (optional at runtime, `test` job only). `DB_*` vars for the CI Postgres are plain job-level `env:` values (disposable, no real-secret relation). No `DASHBOARD_TOKEN` is set in CI — the dashboard itself isn't started there (`falcon.js --no-dashboard`), so auth isn't exercised end-to-end by a real CI browser session, only by `DashboardAuth.check.js`'s direct HTTP/socket-client tests against an ephemeral in-process instance.

**Verified against a real run, not assumed**, as part of the QA-hardening pass: the latest actual `main` run (triggered by the PR #15 merge) shows both jobs green — `regression` reporting `tests 183 / pass 183 / fail 0` and "30 passed", `test` reporting all 19 steps green including the autonomous pipeline (3/3 generated scenarios) and the native Playwright suite (4/4 passed against the real seeded CI Postgres — the same suite's DB test only shows as "skipped" when run locally with no DB configured, which is the correct, intended difference).
