# Running Falcon tests

Use Node.js 24, run `npm ci`, then `npx playwright install chromium`.

- `npm test`: deterministic framework regression suite and Chromium integration tests.
- `npm run test:coverage`: Node regression tests with native coverage reporting.
- `npm run test:unit`: existing exit-code, database configuration, dashboard authentication, and rate-limit checks.
- `npm run test:all`: all of the above plus the existing external UI/API/database/native scenarios.

The deterministic suites require no provider credentials and use temporary files, local HTTP servers, controlled failure responses, and browser fixtures. The browser suite uses real Chromium and a controlled provider response for inference. It validates the recovery plumbing and actual DOM interaction, not live provider availability or model accuracy.

| Area | Checks |
| --- | --- |
| Autoheal | Direct click, retry classification/backoff, ordered stored alternatives, inference response handling, successful-only persistence, exhausted recovery, real changed DOM, audit events |
| Locator storage | Legacy migration, corrupt JSON, deduplication, alternative cap, 500-selector eviction, persistence, write failures |
| Scenario execution | Click/type/select, retry limits, unsupported actions, missing-selector recovery, failed outcomes |
| Page generation | Visibility including fixed controls, selector escaping/priority, submit inputs, dropdown values, duplicate links and link bounds |
| Exploration | DOM issue detection, recursive navigation, visited-page deduplication, depth bounds, text fallback |
| Dashboard | HTTP/socket authentication, replay/live events, rate limiting, Unicode tokens, URL encoding, shutdown with open sockets |
| API | Real local GET/POST, headers, payloads, HTTP errors, standalone user/product scenarios with valid and invalid responses |
| Database | Credentials, TLS/mTLS, parameter forwarding, release on success/failure, pool shutdown; existing CI runs against seeded PostgreSQL |
| Lifecycle | Service registry, browser drivers, base setup/teardown, configuration precedence/errors, lifecycle event forwarding |
| Reports | Outcome counts, exit codes, durations, CLI fatal/scenario failures, query-string preservation, diagnostics and queued logging |
| Visual regression | First baseline, identical/changed pixels, dimension mismatch, missing baseline, concurrent summaries, corrupt summary recovery |

GitHub CI runs the regression suite separately from external-service scenarios. PostgreSQL integration uses the disposable seeded service in `.github/workflows/ci.yml`. External website/API failures are reported as failures, not silently accepted. Search-engine checks remain manual (`npm run test:search`) because CAPTCHA and bot protection make unattended results unreliable.

Coverage from the Node command covers loaded modules and subprocesses. Browser-only DOM code is validated by the separate Chromium suite and is not included in that percentage; the reported aggregate also includes test helpers. It is not a claim of complete application coverage.
