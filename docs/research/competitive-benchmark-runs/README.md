# Competitive benchmark runs

Run files produced under the [protocol](../competitive-benchmark-protocol.md). Each `<revision>-local.json` holds the run metadata, the neutral locators, every scored record and the scores; `<revision>-results.md` is rendered from it by `benchmarks/competitive/report.js` and checked by a regression test.

| Revision | Tools | Runs | Mode | Cost |
|---|---|---|---|---|
| `d11c9e2` | Falcon, Playwright, Selenium, Cypress | 3 | automated, local | $0, no AI calls |

Reproduce: `npm ci --ignore-scripts` and `node install-cypress.js` (checksum-pinned) in `benchmarks/competitive/`, then `node benchmarks/competitive/run.js` from the repository root. Publish only runs made on a clean relevant tree (`meta.dirtyRelevantTree` is `false`).

Network check for this run: a once-per-second sampler of the benchmark processes' connections saw no non-loopback connection during the whole run (a deliberate outbound connection from `node` was detected as a positive control). Connections shorter than a second could be missed, and drivers and binaries were already installed, so a first-time install does download them: the Cypress binary is checksum-pinned, Selenium's chromedriver is not.

Not covered, and not claimed: SaaS vendors, LLM-driven agents (browser-use, Stagehand), Healenium and any assisted run. They need accounts, spend or infrastructure that has not been approved.

Retention: keep raw evidence outside the repository unless deliberately committed as a fixture. Never commit credentials, customer data or generated reports.
