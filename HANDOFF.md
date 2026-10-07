# Falcon-Automation — Engineering Handoff

> **For:** Any engineer or Claude Code session continuing this work
> **Author:** Peyman Iravani — QA Manager / Tech Lead
> **Last updated:** Phase 15 ("Run history and trend") implemented on `phase-15/run-history-and-trend` and open for review. Phases 1–14 are merged and verified on `main`.
> **Repo:** https://github.com/eddieir/Falcon-Automation

---

## 0. This file is tracked and ships with the repository

`HANDOFF.md` is committed and tracked in git, so it is part of the repository shipped to all clones. It must not carry anything that should stay private. This file is regenerated and reviewed at phase transitions; when in doubt, verify its content against the current repository state rather than relying on a stale local copy.

---

## 1. Project in One Paragraph

Falcon is a Node.js test automation framework built on Playwright. Its differentiator is a genuine layered self-healing engine: when a selector fails, it retries with smart backoff (Tier 1), replays a persisted locator cache (Tier 2), scores live candidates against the element's stored signature using a deterministic local matcher with no model and no network (Tier 2.5, added in Phase 14), and finally calls an OpenAI LLM to infer a working alternative selector at runtime (Tier 3). The framework also runs an autonomous crawl of any web app, generates its own test scenarios from the live DOM, compares screenshots pixel-by-pixel for visual regression, streams all of this to a real-time browser dashboard, and (as of Phase 6) runs its DB test suite against a real Postgres in CI with results that actually gate merges.

---

## 2. Repository State

| Item | Value |
|---|---|
| `main` | Phases 1–14 merged and verified. Phase 15 is implemented on `phase-15/run-history-and-trend` and open for review, not merged. Its plan of record, including definitions, trend rules, acceptance criteria and release gates, is [docs/phase-15-plan.md](docs/phase-15-plan.md). |
| Node version | 24 in CI (`node-version: "24"` in `ci.yml`, bumped in Phase 6). **Node 20.19+ required locally** — `package.json` declares `engines.node`, since `test:regression`/`test:coverage` use `node:test` flags that don't exist on older Node. |
| Test target | https://www.saucedemo.com (UI/DB scenarios), https://jsonplaceholder.typicode.com (API scenarios), https://www.google.com (GoogleSearchTest — not run in CI, see §9), plus inline HTML fixtures for `tests/regression/*` suite (no real target site, deterministic) |

Two things worth knowing about this history if you're new to the repo:
1. A real Supabase DB password and an OpenAI key were at different points committed to `.env` on various branches early on. Both were treated as compromised and the user was told to rotate them. A private key (`client.key`) was also committed in March 2025 and deleted a month later, but stayed in history. The Supabase project it dates from had been paused since 16 March 2025 and was deleted on 6 October 2026, so nothing still accepts that credential. CI never used it: DB tests run against the job's own Postgres service. `.gitignore` now ignores key and certificate files.
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

# ── Live dashboard (optional) ──────────────────────────────────────────────
DASHBOARD_PORT=3000                   # port for `node falcon.js`'s live dashboard
DASHBOARD_HOST=                       # blank = 127.0.0.1 (this machine only). Set a LAN address
                                       # or 0.0.0.0 only together with DASHBOARD_TOKEN — the
                                       # dashboard refuses to start otherwise.
DASHBOARD_LINGER_MS=60000             # how long the dashboard stays up after a run finishes
# DASHBOARD_URL=http://localhost:3000  # set on a standalone test run (e.g.
                                        # `node tests/ui/LoginTest.js`) to report
                                        # its events into an already-running dashboard

# DASHBOARD_TOKEN=              # optional on the default loopback bind (unset =
                                 # unauthenticated, logs a warning on startup).
                                 # REQUIRED when DASHBOARD_HOST is not loopback —
                                 # it's then required on every API route and the
                                 # socket connection, via an Authorization: Bearer
                                 # or X-Dashboard-Token header or the dashboard cookie.
                                 # ?token= is NOT accepted on API routes. Open
                                 # http://localhost:3000/?token=<value> once; the
                                 # dashboard sets an HttpOnly cookie and redirects.
# DASHBOARD_ALLOWED_ORIGIN=      # optional. Restricts the dashboard's socket.io
                                 # CORS policy; defaults to the dashboard's own
                                 # localhost origin. Only matters for cross-origin
                                 # browser access — same-origin (the bundled UI)
                                 # is unaffected either way.

# Phase 14 — Tier 2.5 locator memory, both optional and blank by default.
# Deliberately absent from src/config/testConfig.json: ConfigManager.get()
# resolves this.config[key] ?? process.env[key], so a key present in that
# file would permanently and silently beat the environment variable.
FALCON_APPLICATION_ID=                # scopes locator identities to a chosen
                                       # application name instead of the page
                                       # origin; use when one app is served
                                       # from several hostnames. Validated;
                                       # falls back to the normalised origin.
FALCON_LOCATOR_SALT=                  # HMAC salt for identity-bearing
                                       # attribute values. Leave blank and a
                                       # salt is generated and persisted in
                                       # data/locator_memory.json's own
                                       # header — i.e. in the same file as the
                                       # hashes it protects, so low-entropy
                                       # values stay brute-forceable offline
                                       # by anyone who can read it. Setting
                                       # this keeps the salt out of the file.
                                       # Changing it invalidates every stored
                                       # signature (they simply stop matching
                                       # and fall through to Tier 3).

# Phase 15 — run history and trend, all optional and blank by default.
FALCON_RUN_HISTORY=              # blank = on. "off" (or "0"/"false") stops falcon.js
                                 # recording runs to data/run_history.json and makes
                                 # the history commands report "disabled".
FALCON_TREND_BASELINE_N=         # blank = 10. How many previous complete runs on the
                                 # same branch and repeat count form the baseline (1-500).
FALCON_TREND_MIN_BASELINE=       # blank = 10. How many of those runs must exist
                                 # before any trend flag can be raised (1-500).

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

**Phase 14 — `src/core/locator/` (new subsystem). No OpenAI reference anywhere inside it.**
- `LocatorIdentity.js` — builds and serialises the scoped identity (application, origin, pathname, action, original selector) via `JSON.stringify`, so no delimiter can be smuggled through a selector to collide two identities. Refuses `about:`, `data:` and `file:`, whose `.origin` is the literal string `"null"` and would otherwise share one scope. Never touches branch, credentials or query string.
- `ElementSignature.js` — bounded capture. `capture(descriptor, { salt })` **throws without a salt**, deliberately: falling back to unsalted hashing or to plaintext would be a silent privacy regression. Identity-bearing attribute values become salted HMAC-SHA256 hashes from a fixed allow-list; accessible name and own text stay bounded plaintext behind redaction patterns because similarity cannot run on a hash. Descriptor keys are `accessibleName`, `ownText` and `boundingBoxBucket` — that last one a validated string such as `"top-right:small"`, **not** an object; passing the wrong shape silently yields null fields and makes a healthy matcher look broken.
- `CandidateMatcher.js` — pure scoring. **Zero `require` statements**, enforced as a structural property so the verdict is reproducible from its inputs alone. Gates before scoring (action compatibility, state, contradictory role, conflicting stable identity), then a structural ambiguity rule, then the confidence floor and winner margin. `MIN_CONFIDENCE` 0.85 and `WINNER_MARGIN` 0.15 are **provisional and uncalibrated**.
- `SelectorBuilder.js` — synthesises and validates the winner's concrete selector. Also zero requires.
- `LocatorMemory.js` — the store behind `data/locator_memory.json`. Trust is `trusted | unproven | revoked`. `entries`, `legacy` and the rejection index are all `Map`-backed, so a key like `"__proto__"` cannot reach `Object.prototype`. Caps on load **and** on mutation, LRU by `lastSeen` with ascending-key tie-breaks for determinism.
- `ElementFactsCollector.js` — the only DOM-facing module. One bounded `page.evaluate` over the interactive-element query Tier 3 already uses, capped at 200 candidates truncated in document order. Degrades quietly to "no facts" when `page.evaluate` is absent or throws — which happens for real during navigation races, observed repeatedly in `test:browser`.
- `HealingBenchmark.js` — the mutation-corpus harness. Imports `CandidateMatcher`; **never imported by the runtime healing path**. `npm run healing:benchmark`.
- `sharedLocatorMemory.js` — the process-wide instance both `AIHealer` and `Dashboard` default to. This exists because two instances over one file each held their own copy and never reloaded, so a single dashboard approval serialised its stale map and destroyed evidence written during the run. Injection is still supported for tests.

**Phase 14 — modified existing files**
- `src/core/AIHealer/AIHealer.js` — Tier 2.5 inserted between Tier 2 and Tier 3. With no trusted evidence for the identity it falls through immediately, performing **zero DOM query**, which is the dominant cost saver since most identities never reach this point. Tier 1 and Tier 2 successes record ground-truth evidence fire-and-forget, so a slow or failing capture cannot add latency or a new failure mode to Tier 1.
- `src/core/AIHealer/HealingReport.js` — `_log()` now persists `status` and `reason` additively. They were being accepted and silently dropped, which left a refusal's reason absent from the very audit log that is supposed to show it.
- `src/core/util/AtomicJsonStore.js` — `writeJsonAtomic` resolves `{ok, error?}` instead of `undefined` and still **never rejects by design**, so the serialised write chain cannot be poisoned. Adds `WriteFailureTracker`, a per-path failure ledger: a later successful write to a different path must not mask an earlier failure.
- `src/core/AIHealer/LocatorStore.js` — migrated onto `AtomicJsonStore`. It had never used it: `_save()` called `fs.promises.writeFile` directly and swallowed errors in a bare catch, and the corrupt-file path emitted **nothing**. External API unchanged.
- `src/core/util/OutputSafe.js` (new) — the terminal render boundary. `stripControlChars` for output genuinely allowed to span lines, `sanitizeField` for a value rendered as one line in a per-entry listing. The second exists because a raw newline in a page-derived field forges an extra listing row that reads as a legitimate trusted entry.
- `scripts/healing/review.js`, `scripts/review/status.js`, `scripts/flakiness/review.js`, `utils/Logger.js` — every page-derived string printed to a terminal now goes through `sanitizeField`. `review.js` also gains `locator-list`, `locator-show`, `locator-approve`, `locator-reject`, `locator-rollback`.
- `src/core/Dashboard.js`, `src/dashboard/index.html` — six `/locator/*` routes behind the same token gate and rate limiter as every other route, plus a panel for the same decisions. Hashed values are never rendered; the surfaces name *which* field matched.

- `src/core/Dashboard.js` — **Phase 7**: `POST /emit`, `GET /events`, and the socket.io handshake all now require `DASHBOARD_TOKEN` when it's set (header `X-Dashboard-Token`, query param `?token=`, or socket `auth: { token }`). *(Superseded after Phase 14: `?token=` is refused on API routes and only exchanged for a cookie on `GET /`; see §7.)* Unauthorized socket connections are rejected outright (`connect_error`), not silently allowed through. CORS restricted from `origin: "*"` to `DASHBOARD_ALLOWED_ORIGIN` (default: the dashboard's own localhost origin). When `DASHBOARD_TOKEN` is unset, behavior is unchanged from Phase 3–6, but `start()` now logs a loud warning. Also fixed: `this.port` wasn't updated after `listen(0)` (ephemeral port), so `dashboard.url` printed the wrong port when port 0 was used (only matters for the regression test, which uses ephemeral ports to avoid colliding with a real dashboard).
- `src/core/Middleware.js` — **Phase 7**: `emit()`'s HTTP `POST /emit` fallback now sends `X-Dashboard-Token` when `DASHBOARD_TOKEN` is set, so a standalone test process (`DASHBOARD_URL=...`) can still report into a token-protected dashboard. No token configured → no header sent → unchanged from before.
- `src/dashboard/index.html` — **Phase 7**: reads `?token=` from the URL on load, persists it to `localStorage` (best-effort, wrapped in try/catch) and strips it from the visible URL via `history.replaceState`, then passes it into `io({ auth: { token } })`. Falls back to `localStorage` on reload if the URL has no token. Shows a clear "Unauthorized" status label on `connect_error` instead of just silently failing to connect. *(Superseded after Phase 14: the token now travels in an HttpOnly cookie and is no longer stored in `localStorage`; see §7.)*
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

npm run test:regression           # 850 node:test cases (needs Node 20.19+)
npm run test:browser              # 43 Playwright specs against inline fixtures
npm run test:coverage             # same as test:regression, with coverage

node falcon.js                    # autonomous pipeline, live dashboard at :3000
node falcon.js --no-dashboard     # same, no dashboard (also the CI=true default)

# Dashboard with auth (Phase 7):
DASHBOARD_TOKEN=some-secret node falcon.js --dashboard
# → open the printed URL once; its ?token= is exchanged for an HttpOnly cookie

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
    └── Tier 3: AIHealer (OpenAI gpt-4o-mini) — numbered list of eligible, visible
                candidates → model replies with an index → locally built selector,
                re-verified before use (README: "What Tier 3 sends to OpenAI")
```

Single healing engine everywhere since Phase 5 (`SelfHealingManager` deleted). Every event logged via `HealingReport.log()`, which emits to the live dashboard.

---

## 7. Architecture — Dashboard Auth (Phase 7, revised after Phase 14)

```
Binding:
  DASHBOARD_HOST, default 127.0.0.1. A non-loopback host without DASHBOARD_TOKEN
  is refused at start() and falcon.js exits 1.

No DASHBOARD_TOKEN set (loopback only):
  API routes and socket connections are open. start() logs a loud warning.
  Host guard: a request whose Host is not localhost / 127.0.0.1 / [::1] / the
  configured loopback host on the listening port gets 403 (DNS rebinding).
  A state-changing request or socket handshake with a foreign Origin gets 403;
  no Origin (a Node reporter) is allowed. DASHBOARD_ALLOWED_ORIGIN is honoured.

DASHBOARD_TOKEN set:
  API routes and socket → Authorization: Bearer, X-Dashboard-Token, or the
                          HttpOnly SameSite=Strict cookie falcon_dashboard_token.
                          The socket also accepts auth: { token }.
                          ?token= is refused everywhere except GET /.
  GET /?token=<value>   → valid token: Set-Cookie + 303 to "/" (clean URL).
  Comparison            → SHA-256 of both sides, then timingSafeEqual.
  CORS                  → DASHBOARD_ALLOWED_ORIGIN (default: own localhost origin).
  Every response        → Referrer-Policy: no-referrer.

Front-end (src/dashboard/index.html):
  Stores nothing and sends no token itself; same-origin requests and the socket
  carry the cookie. An old token left in localStorage is removed on load.

Middleware.emit()'s cross-process HTTP fallback (DASHBOARD_URL) sends
X-Dashboard-Token automatically when DASHBOARD_TOKEN is set in that process's env.
```

Verified end-to-end, not just at the unit level: real `falcon.js --dashboard` run with a token set, confirmed via `curl` that unauthenticated `GET /events` is 401 and authenticated is 200; confirmed a standalone `DASHBOARD_URL=... node tests/api/UserApiTest.js` with the matching `DASHBOARD_TOKEN` successfully reports events into the protected dashboard, and without the token its events are silently rejected (best-effort — the test itself still passes, matching the pre-Phase-7 "dashboard reporting must never break a test run" design).

---

## 8. Architecture — Autonomous Pipeline (`falcon.js`)

Unchanged since Phase 3/5 apart from the scanner's name: `Dashboard.start()` → `DOMIssueScanner` (named `ExploratoryAI` until Phase 12) → `ClickExplorer` → `TestGenerator` (delegates to `PageAnalyser`) → `TestRunner.executeTest()` → `TestRunner.executeExploratoryTest()`. Dashboard stays up for `DASHBOARD_LINGER_MS` (default 60s) after the run for review, then the process exits. `dashboard.url` (a getter, Phase 7) is what gets printed — includes `?token=` when one's configured, which `GET /` exchanges for a cookie on first load.

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
2. `npm run test:coverage` — 850 `node:test` cases across 25 `tests/regression/*.check.cjs` files
3. `npm run test:browser` — 43 Playwright specs, `tests/regression/browser.spec.js`, against inline HTML fixtures (no real target site)
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
