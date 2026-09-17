# Validation record — 17 September 2026

Base revision: `e2da11c` (main, Phase 7). Branch: `test/comprehensive-regression`.

## Executed successfully

- 114 new Node regression tests: 114 passed, zero failed or skipped.
- Existing ReportManager exit-code, database configuration, dashboard authentication and rate-limiting checks: all passed.
- Existing UserApiTest and ProductApiTest against JSONPlaceholder: both passed, including product creation.
- Playwright regression discovery: all 13 browser tests discovered successfully.
- Whitespace/error checks: `git diff --check` passed.

Node coverage includes test helpers and mocked subprocess paths; it is not whole-application coverage. Browser-only code requires the Chromium suite. The inference tests use controlled responses and do not validate live model accuracy or provider availability.

## Regressions reproduced and fixed

- Missing click selectors were skipped before autoheal could run.
- Main CLI navigation/scenario failures could exit successfully; browser launch failures were outside report handling. CLI query strings containing `=` were truncated.
- Page plans duplicated links, ignored their navigation limit, attempted to fill dropdowns, selected nonexistent hardcoded options, and omitted fixed-position controls.
- Crawler returned through browser history after clicks that did not navigate.
- Dashboard authorization could throw on Unicode token byte-length mismatch; generated token URLs did not escape reserved characters. Shutdown did not close active WebSockets or detach the middleware emitter.
- Dashboard event content was inserted as unescaped HTML, and reconnect replay doubled counters/history.
- Locator cache accepted malformed entries, mishandled object-prototype keys, exposed mutable alternatives, and failed to refresh read recency.
- Configured but unreadable database certificates became a silent skip. The standalone database connectivity script could exit successfully after connection failure.
- The existing report regression check accepted an expected result argument without asserting it.

The browser-only changes have test coverage authored but remain execution-pending as described below.

## Pending validation

- Chromium: all local launches were rejected by the macOS execution sandbox (`MachPortRendezvousServer: Permission denied`) before test bodies ran. The 13 browser tests are not recorded as passing.
- Live PostgreSQL: Docker is installed but its daemon is not running; no local PostgreSQL server is available. Connection-failure, configuration, TLS and driver lifecycle paths were tested locally. Successful database scenarios remain assigned to the seeded PostgreSQL CI service.
- GitHub CI/PR: pushing the branch returned HTTP 403 from both checkouts. No remote branch or pull request was created and no new CI run executed.
- External login, checkout, search and native browser scenarios therefore remain unverified in this run. Search is deliberately manual due to bot protection.
- Dependency audit: the standalone `npm audit --json` snapshot reported 55 findings (1 low, 21 moderate, 22 high, 11 critical), including transitive packages. Dependencies were not upgraded in this change. This is not a clean security audit.

Once repository write access is available, push the branch and run Falcon CI. Its separate regression job runs the Node coverage command and Chromium suite; the existing job provides PostgreSQL and external scenario checks. Native end-to-end failures now fail CI instead of being ignored.
