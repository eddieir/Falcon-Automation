# Competitive benchmark harness

Isolated, dev-only harness behind [the protocol](../../docs/research/competitive-benchmark-protocol.md). It is not part of the Falcon package: Selenium and Cypress live only in this folder's `package.json` (exact versions, own lockfile).

```bash
cd benchmarks/competitive && npm ci --ignore-scripts && npx cypress install   # once
cd ../.. && node benchmarks/competitive/run.js --runs=3      # writes docs/research/competitive-benchmark-runs/
node benchmarks/competitive/report.js docs/research/competitive-benchmark-runs/<rev>-local.json
```

Every page and flow is on `127.0.0.1`, and the harness refuses any request whose Host is not its own loopback origin. Installing the tools downloads Selenium's browser driver and Cypress's binary (version-pinned; the Cypress binary has no checksum in the lockfile). `run.js` switches off vendor telemetry (`SE_AVOID_STATS`, `CYPRESS_CRASH_REPORTS`) and removes credential-style environment variables. Adapters under `adapters/` hold only what a tool needs to act on a page; verdicts come from `lib/classify.js` and the page-side probe in `lib/server.js`, never from a tool's own report. To add a tool, add an adapter with `open`, `locators`, `flows`, `close` and `version`.
