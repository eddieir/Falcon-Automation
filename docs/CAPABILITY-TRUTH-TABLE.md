# Falcon capability truth table

Audit of what README, ARCHITECTURE and the phase plans promise, checked against the code and the tests on this revision (M0, issue #76). It states what Falcon does today, not what it aims to do.

**Status vocabulary**

| Status | Meaning | Required evidence |
| --- | --- | --- |
| `SHIPPED` | Implemented, with a deterministic test that exercises the claim, including a refusal or failure path where one exists. | At least one existing test file. |
| `PARTIAL` | Implemented, but the test or the scope is narrower than the wording a reader would infer. | At least one existing test file, and the limit stated. |
| `PLANNED` | Described in a plan; no implementation. Never counts as a feature. | The plan document that describes it. |
| `UNVERIFIED` | Claimed or probably true, but no executable evidence exists. | A gap ID from the register below. |

A `SHIPPED` row proves the behaviour the test asserts and nothing wider. Evidence paths are relative to the repository root; `tests/regression/*.check.cjs` files run under `npm run test:regression`, `tests/unit/*.check.js` under `npm run test:unit`.

## Capabilities

| ID | Capability | Claimed in | Status | Executable evidence | Known limits |
| --- | --- | --- | --- | --- | --- |
| CAP-01 | Playwright browser execution on Chromium | README: Browser automation | SHIPPED | `tests/regression/browser.spec.js`, `.github/workflows/ci.yml` | Chromium only is installed and exercised in CI. |
| CAP-02 | Firefox and WebKit through `BrowserManager` | README: Browser automation | PARTIAL | `tests/regression/core.check.cjs` | The test uses a mocked lifecycle for each engine; no real Firefox or WebKit launch is tested. See G-01. |
| CAP-03 | Bounded site discovery | README: Discovery and generation | SHIPPED | `tests/regression/sitesweep.check.cjs` | Cannot reach state-dependent or unlinked journeys. |
| CAP-04 | Generated interaction scenarios and DOM issue scanning | README: Discovery and generation | PARTIAL | `tests/regression/core.check.cjs` | Scenarios are structural interaction checks; no business assertion is generated. |
| CAP-05 | Retry, then scoped approved replay | README: Locator recovery | SHIPPED | `tests/regression/healing.check.cjs`, `tests/regression/p14-memory.check.cjs` | Scope is application, origin, pathname, action and original selector. |
| CAP-06 | Local evidence matching that refuses weak or ambiguous matches | README: Locator recovery | SHIPPED | `tests/regression/p14-matcher.check.cjs`, `tests/regression/p14-tier25.check.cjs` | Confidence and margin thresholds are provisional. |
| CAP-07 | Optional Tier 3 candidate selection by an LLM, with local revalidation | README: Optional AI providers | SHIPPED | `tests/regression/p17-healer-provider.check.cjs`, `tests/regression/tier3-allowlist.check.cjs` | Tested against mocked providers. Live model quality is CAP-19. |
| CAP-08 | Human approve, reject and rollback of recovered locators | README: How self-healing works | SHIPPED | `tests/regression/p14-surfaces.check.cjs`, `tests/regression/review-status.check.cjs` | Decisions record the channel (CLI or dashboard), not an authenticated person. |
| CAP-09 | Visual regression with diff images | README: Visual regression | PARTIAL | `tests/regression/visual.check.cjs` | Baselines and tolerances are environment-specific. |
| CAP-10 | API scenario examples | README: API and database testing | PARTIAL | `tests/regression/api.check.cjs` | `tests/api/` holds examples; endpoints and assertions are the user's. |
| CAP-11 | PostgreSQL testing with TLS and mTLS configuration | README: API and database testing | PARTIAL | `tests/unit/DBConfigBehavior.check.js`, `tests/regression/database-scenarios.check.cjs` | The SSL configuration builder is tested; CI seeds a plain-TCP Postgres, so no TLS or mTLS handshake is exercised. See G-02. |
| CAP-12 | Live dashboard that refuses non-loopback exposure without a token | README: Review and reporting | SHIPPED | `tests/regression/dashboard-exposure.check.cjs`, `tests/unit/DashboardAuth.check.js` | A shared token, not an identity or role system. |
| CAP-13 | Run history and trend detection | README: Review and reporting | SHIPPED | `tests/regression/p15-trend.check.cjs`, `tests/regression/p15-ledger.check.cjs` | Local files; trends need enough recorded runs. |
| CAP-14 | Flaky-scenario tracking and quarantine that cannot hide a never-passing scenario | README: Investigate unstable tests | SHIPPED | `tests/regression/flakiness.check.cjs`, `tests/regression/cli.check.cjs` | Classification needs a minimum sample count. |
| CAP-15 | Allure output | README: Review and reporting | PARTIAL | `playwright.config.js`, `.github/workflows/ci.yml` | The reporter is wired and CI uploads results, but no test asserts the Allure content. See G-03. |
| CAP-16 | Page-level parallel workers | README: Parallel execution | SHIPPED | `tests/regression/p16-runner.check.cjs`, `tests/regression/p16-scheduler.check.cjs` | Scenarios within a page stay sequential; worker session state is not synchronized. |
| CAP-17 | Deterministic CI sharding and merge that rejects incomplete input | README: Parallel execution | SHIPPED | `tests/regression/p16-merge.check.cjs`, `tests/regression/p16-merge-reject.check.cjs` | Merge validates bundles; it does not repair them. |
| CAP-18 | Provider routes: OpenAI, Anthropic, Gemini, Azure OpenAI, OpenAI-compatible | README: Optional AI providers | SHIPPED | `tests/regression/p17-provider-contract.check.cjs`, `tests/regression/m17-byok-anthropic.check.cjs`, `tests/regression/m17-byok-gemini.check.cjs` | Mocked protocols only. No Vertex AI, Entra ID or Bedrock. |
| CAP-19 | Live provider behaviour and model quality | README: Optional AI providers | UNVERIFIED | none | No test calls a live provider. See G-04. |
| CAP-20 | BYOK profiles that store a credential variable name, never the key | README: Optional AI providers | SHIPPED | `tests/regression/m17-byok-profiles.check.cjs`, `tests/regression/m17-byok-credentials.check.cjs` | Isolation is per invocation. |
| CAP-21 | Saved-plan replay, ordered journeys and element-level `expect` actions | PHASE-PLANS: Delivered baseline after PR #54 | PARTIAL | `tests/regression/plan-file.check.cjs`, `tests/regression/plan-expect.check.cjs`, `tests/regression/plan-cli.check.cjs` | Element checks only. No business-outcome contract, side-effect check or network, download or API verification. |
| CAP-22 | Honest exit codes and no false green | README: Results your team can review | SHIPPED | `tests/regression/cli.check.cjs`, `tests/regression/gate-result.check.cjs` | Reflects what ran; skipped or omitted pages are reported, not counted as passes. |
| CAP-23 | Customer demo: approved recovery and refusal without identity evidence | README: See Falcon in action | PARTIAL | `tests/regression/customer-demo-fixture.check.cjs` | One control and one kind of change on a local copy. Not a benchmark. |
| CAP-24 | Published healing accuracy from a reproducible corpus | PHASE-PLANS: Phase 14 | PARTIAL | `tests/regression/p14-benchmark.check.cjs` | Corpus is Falcon-authored; no external or live-application accuracy. See G-05. |
| CAP-25 | Neutral competitive benchmark harness and one local run | README: Documentation | PARTIAL | `tests/regression/m0-75-benchmark-harness.check.cjs`, `tests/regression/m0-75-workload-fixtures.check.cjs` | One local run against Playwright, Selenium and Cypress. It is not a market ranking. |
| CAP-26 | Authenticated customer pilots (Phase 18) | PHASE-PLANS: Phase 18 | PLANNED | `docs/PHASE-PLANS.md` | Implementation has not started. |
| CAP-27 | Assertion-aware healing: an outcome contract gating reuse (Phase 19) | PHASE-PLANS: Phase 19 | PLANNED | `docs/PHASE-PLANS.md` | Only the element-level part exists (CAP-21). |
| CAP-28 | Open healing benchmark and live certification (Phase 20) | PHASE-PLANS: Phase 20 | PLANNED | `docs/PHASE-PLANS.md` | None. |
| CAP-29 | Team control plane, identity and role-based access (Phases 21, 26) | README: Review and reporting | PLANNED | `docs/PHASE-PLANS.md` | Falcon ships no managed control plane, identity service or RBAC. |
| CAP-30 | Governed agentic test creation, failure classification, cross-browser depth (Phases 23-25) | PHASE-PLANS: Phases 23-25 | PLANNED | `docs/PHASE-PLANS.md` | None. |

## Evidence gaps

| Gap | Affects | What is missing |
| --- | --- | --- |
| G-01 | CAP-02 | A browser smoke test that launches real Firefox and WebKit, run in CI or documented as manual. |
| G-02 | CAP-11 | A TLS-enabled Postgres in CI that proves the certificate path and a rejected untrusted certificate. |
| G-03 | CAP-15 | A test that reads generated Allure results and asserts the expected fields. |
| G-04 | CAP-19 | Opt-in, secret-gated live provider checks outside the default CI gate. |
| G-05 | CAP-24 | Accuracy measured on applications Falcon's authors did not write. |

Gaps are tracked here until they are filed as issues. A gap is closed only when a test lands and its row changes status in the same change.

## Corrections made in this audit

| Where | Was | Now |
| --- | --- | --- |
| `docs/PHASE-PLANS.md` section 0 | Playwright, Cypress and Selenium: "No generation, no healing, no flake intelligence." | Describes them as the execution layer and points to the evidence register. Playwright ships Test Agents with a Healer, and Playwright reports flaky tests after retries. |
| `docs/PHASE-PLANS.md` section 0 | Testim, Autify, Mabl and others: healing is "silent and proprietary", "trusted with no human ever seeing it". | Removed. The competitor evidence register does not establish this, and it records that Katalon and Testsigma document an approval step. |
| `docs/PHASE-PLANS.md` section 0 | "Falcon ... should be in a different category" and "is not an incremental improvement on any of them. It is a different offer." | Stated as a design aim. Comparative claims are limited to what `docs/research/competitor-matrix.json` verifies. |

An absence of evidence about a competitor is not evidence of absence. See the [evidence method](research/competitive-evidence-method.md).

## Keeping this table true

`tests/regression/m0-76-capability-truth-table.check.cjs` fails when a `SHIPPED` or `PARTIAL` row cites a file that does not exist, a `PARTIAL` row states no limit, a `PLANNED` row cites no plan, an `UNVERIFIED` row has no gap, a README capability has no row, or the corrected comparative wording returns. Change a status only together with the evidence that justifies it.
