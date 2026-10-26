# Competitive benchmark harness

Isolated, dev-only harness behind [the protocol](../../docs/research/competitive-benchmark-protocol.md). It is not part of the Falcon package: Selenium and Cypress live only in this folder's `package.json` (exact versions, own lockfile).

```bash
cd benchmarks/competitive && npm ci && npx cypress install   # once
cd ../.. && node benchmarks/competitive/run.js --runs=3      # writes docs/research/competitive-benchmark-runs/
node benchmarks/competitive/report.js docs/research/competitive-benchmark-runs/<rev>-local.json
```

Everything runs on `127.0.0.1`. Adapters under `adapters/` hold only what a tool needs to act on a page; verdicts come from `lib/classify.js` and the page-side probe in `lib/server.js`, never from a tool's own report. To add a tool, add an adapter with `open`, `locators`, `flows`, `close` and `version`.
