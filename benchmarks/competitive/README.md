# Competitive benchmark harness

Isolated, dev-only harness behind [the protocol](../../docs/research/competitive-benchmark-protocol.md). It is not part of the Falcon package: Selenium and Cypress live only in this folder's `package.json` (exact versions, own lockfile).

```bash
cd benchmarks/competitive && npm ci --ignore-scripts && node install-cypress.js   # once
cd ../.. && node benchmarks/competitive/run.js --runs=3      # writes docs/research/competitive-benchmark-runs/
node benchmarks/competitive/report.js docs/research/competitive-benchmark-runs/<rev>-local.json
```

Every page and flow is on `127.0.0.1`, and the harness refuses any request whose Host is not its own loopback origin. `install-cypress.js` downloads the Cypress binary and installs it only if its SHA-256 matches `cypress-binary.sha256.json` (pinned for darwin-arm64; any other platform is refused until a reviewed change adds its hash). Cypress publishes no checksum, so the pin is trust-on-first-use, confirmed by two independent downloads. Selenium Manager still downloads a chromedriver for your Chrome on first use; that driver is not pinned. `run.js` switches off vendor telemetry (`SE_AVOID_STATS`, `CYPRESS_CRASH_REPORTS`) and removes credential-style environment variables. Adapters under `adapters/` hold only what a tool needs to act on a page; verdicts come from `lib/classify.js` and the page-side probe in `lib/server.js`, never from a tool's own report. To add a tool, add an adapter with `open`, `locators`, `flows`, `close` and `version`.
