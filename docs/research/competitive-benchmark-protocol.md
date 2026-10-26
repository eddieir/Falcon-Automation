# Competitive benchmark protocol (v1.0.0)

Status: protocol, scorer, fixtures and a local comparison run of Falcon, Playwright, Selenium and Cypress are implemented. SaaS vendors, LLM-driven agents and Healenium are not covered. This document defines how a comparison is run and what it can and cannot show; the results are not evidence that Falcon is better than anything.

Related: [workloads](competitive-benchmark-workloads.json), [scorer](../../scripts/benchmark/competitive-score.js), [run manifest](competitive-benchmark-runs/README.md), [evidence register](competitive-evidence-method.md).

## Rules for every tool, Falcon included

1. Same workloads, same fixture revision, same machine class and browser for every tool in a comparison.
2. Fixtures are local, disposable and bound to `127.0.0.1`. No external sites, no real credentials, no customer data.
3. Record per run: tool, exact tool version, provider/model settings, browser and OS, CI or local, fixture git revision, seed, run number, mode, cost and operator minutes.
4. **Automated** and **assisted** runs are scored separately and never pooled. Any human step beyond the documented setup makes the run assisted.
5. A tool that cannot be run without a paid trial, account or credentials is `NOT_TESTED`. It is excluded from every denominator and is never scored zero. Paid trials need a separate owner decision.
6. Repeat each workload at least 3 times with distinct run numbers when behaviour can vary. With fewer than 3 distinct runs the scorer withholds intervals. No significance claims are made from a single run.

## Workload families

| Family | What it tests | Pass condition |
|---|---|---|
| `locator-change` | A hook is renamed but the element is the same | Correct element acted on |
| `ambiguous-candidate` | Two plausible controls, or a changed action | The tool refuses; any click is a wrong action |
| `multi-step-flow` | Fill, submit, assert resulting state | Final state asserted and correct |
| `auth-role-state` | Two users, a privilege-protected page | Denied user stays denied in an isolated context |
| `failure-reporting` | Missing target, unasserted step | The run is reported as failed, never green |
| `ci-economics` | Time-to-green, retries, triage, browser minutes, AI calls, setup effort | Measured from the run manifest |

Each workload in the workloads file is `IMPLEMENTED` (a fixture or harness exists and its objective oracle is stated) or `PLANNED` (design only). Planned workloads must not be scored or cited as measured. All workloads are currently `IMPLEMENTED`.

Fixtures are tool-neutral servers on `127.0.0.1`: the healing corpus in `tests/fixtures/benchmark/`, the checkout app (W3), `tests/fixtures/competitive/authServer.js` (W4, two seeded users, no passwords) and `tests/fixtures/competitive/silentSaveServer.js` (W5, a page that never shows its result). Each has a server-side oracle, so a result is judged by state, not by what a tool reports. No tool adapter exists: a comparison still needs each tool's flow written and run by the owner of that tool's setup.

## Metrics

Every rate carries its numerator and denominator. A zero denominator gives `null` (N/A), never 0 and never 1.

| Metric | Definition |
|---|---|
| `healingPrecision` | correct repairs / attempted repairs |
| `unsafeActionRate` | wrong actions / attempted repairs |
| `falseGreenRate` | objectively failing runs reported as passed / objectively failing runs |
| `correctRefusalRate` | refusals where refusal was expected / runs where refusal was expected |
| `unnecessaryRefusalRate` | refusals where a repair was expected / runs where a repair was expected |
| `evidenceCompleteness` | runs with evidence / runs actually tested |
| `passRate` | passes (not objectively failing) / scored runs, with a Wilson interval from 3 distinct runs |

Refusal is measured separately from repair failure: a correct refusal is neither a failed repair nor a pass. `MISSING_EVIDENCE` runs count against completeness and are excluded from correctness rates. `TIMEOUT`, `FAIL` and `PARTIAL` are scored and never count as repairs unless the record says a repair was attempted.

The Wilson interval is descriptive and assumes independent trials; it is not a test of significance.

## Scoring and composites

Dimension results are the primary output. A weighted composite is computed only when weights are supplied explicitly, are positive and sum to 1. Lower-is-better rates are inverted. If any weighted dimension is N/A the composite is `null`. Reordering records, or adding `NOT_TESTED` records, does not change a score. Two records with the same tool, version, workload, mode and run are rejected.

## Local comparison run (implemented)

`node benchmarks/competitive/run.js` runs Falcon, plain Playwright, plain Selenium (Chrome) and plain Cypress (Electron) over the same fixtures and oracles on one machine, then scores the records. It needs no account, key or network beyond loopback, and costs nothing. Selenium and Cypress are installed only under `benchmarks/competitive/` (exact versions, own lockfile); run `npm ci` there, then `npx cypress install`. Results: [run files](competitive-benchmark-runs/README.md).

How a locator workload is judged:

1. **One neutral locator per fixture.** It targets the first hook (data-testid, id, name, aria-label) that differs between `pre.html` and `post.html`, because the workload is "a hook the test relied on changed". If the mutation changes no hook, it uses the first hook present in `pre.html`, then a structural CSS path. The same string goes to every tool. The choice of locator strongly affects every result; a data-testid-first rule leaves almost nothing to repair.
2. **The tool's default API acts on the changed page.** Plain tools get no healing. Playwright and Cypress error on ambiguous matches; Selenium takes the first match. That is each tool's default, not a judgement.
3. **The page reports what was touched.** An injected probe sends the element that received the click, input or change to the harness. The tool's own report is never used as the oracle.
4. **Falcon tries the same locator first.** Only when that fails does Falcon's healing path (`HealingBenchmark.runFixture`) run on the same page, as `AIHealer` does.

A click on any unintended element, or any click where refusing is required or the target is gone, is a **false green** (the tool reports a pass on an objectively wrong run). An unsafe repair is a wrong element chosen by a repair attempt. Flows W3 to W5 use the checkout, auth and silent-save fixtures with server-side oracles; W6 is the wall time of one full pass including tool and browser startup.

### Disclosures

- The healing corpus was written by Falcon's maintainers, and Falcon's matcher was developed against it. It is not an independent or neutral test set. Falcon's results here show behaviour on these cases only and say nothing about real applications.
- Falcon is evaluated through its healing library path on static pages, not through its CLI pipeline or an LLM provider. Selenium and Cypress are evaluated in their default configuration, without their healing add-ons or any AI plugin.
- The three tools run different browser engines (Chromium, Chrome, Electron). Timing is not comparable across engines.
- The cases are deterministic, so repeats were identical in every run. Pooled counts are not independent samples, and the Wilson intervals the scorer emits are therefore too narrow to quote. No significance claim is made.
- Cases where the original locator still resolves (to the right or wrong element) never trigger Falcon's healing, so Falcon behaves like the plain tools there, including silent wrong clicks.
- No tool, including Falcon, detects a flow that asserts nothing (W5): all report a green run while the server shows nothing was saved.

## Running the scorer

```bash
node scripts/benchmark/competitive-score.js records.json   # exit 0 scored, 2 invalid input
node --test tests/regression/m0-75-benchmark-protocol.check.cjs
```

`records.json` is an array of records or `{ "records": [...], "weights": {...} }`. Record fields are validated in `scripts/benchmark/competitive-score.js`.

## Limits and review

- The scorer is generic and names no winner. The regression tests use synthetic records; the local comparison run above is the only real data.
- The regression suite proves the fixtures behave as documented (reference driver over HTTP) and that the scorer follows these rules. It does not run any product through them.
- CI economics (`ci` object on each record: `timeToGreenSec`, `retries`, `triageMinutes`, `browserMinutes`, `aiCalls`, `setupMinutes`) is reported per field as `n`, `total` and `median`, and is N/A when no record reports it. Costs from vendors need dated plan terms in the run manifest.
- This protocol and the scoring rubric must pass independent review before any external comparison is announced. SaaS vendors, LLM-driven agents (browser-use, Stagehand) and Healenium are not covered: they need accounts, spend or extra infrastructure that the owner has not approved.
