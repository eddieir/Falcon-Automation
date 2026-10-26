# Competitive benchmark runs

No cross-product runs have been recorded. This directory is reserved for run manifests produced under the [protocol](../competitive-benchmark-protocol.md).

Each run file is a JSON array of records accepted by `scripts/benchmark/competitive-score.js`, named `<fixture-revision>-<tool>-<tool-version>.json`.

A run manifest must state, per tool: exact version, provider and model settings, browser and OS, local or CI, fixture git revision, seeds, number of distinct runs, assisted versus automated mode, cost with the date and plan it applies to, and where raw evidence (reports, screenshots) is kept.

Retention: keep evidence outside the repository unless it is deliberately committed as a fixture. Never commit credentials, customer data or generated reports.
