# Falcon M0 — Competitive Evidence Baseline
## Detailed implementation and Claude Pro execution plan

**Milestone:** M0 — Competitive evidence baseline  
**GitHub issues:** [#74](https://github.com/eddieir/Falcon-Automation/issues/74), [#75](https://github.com/eddieir/Falcon-Automation/issues/75), [#76](https://github.com/eddieir/Falcon-Automation/issues/76)  
**Priority:** P0. **Status:** APPROVAL-READY PLAN, not implementation evidence.  
**Reference:** `CLAUDE.md`, `.claude/skills/production-cycle/SKILL.md`, `docs/PHASE-PLANS.md`, `docs/research/competitor-matrix.json`, README, architecture docs.  
**Milestone gate:** The project can make comparative claims only when grounded in a versioned evidence register, a reproducible evaluation protocol, and a capability claim audit.

> **Hard separation:** Producing evidence and planning a benchmark is not the same as demonstrating competitive superiority. The existing Phase 18 security controls and C2 human-review prerequisite remain independent and unresolved unless separately evidenced. No M0 acceptance implies approval of later phases or customer pilots.

### M0 execution contract

1. Three small, reviewable branches/PRs, **one issue per PR**, in order #74 → #75 → #76. #75 protocol design can begin using the #74 register without waiting for external vendor trials; #76 uses verified claims from both.
2. **One fresh Claude Code session per issue and handoff.** A new session starts from a verified compact checkpoint or the issue brief, not a pasted historical transcript. Save relevant run identity, exact git revision, paths, decisions and evidence in the coordinator-owned ledger.
3. The **Production Director** runs on pinned `claude-sonnet-5-5` medium effort. Explicitly verify model routing before the first delegated task; never alias, `inherit`, automatically substitute models or use Fable.
4. Make the **smallest sufficient dispatch**. Docs-only lane: Technical Writer → independent Code Reviewer → Release Manager. Call Product Manager only for unresolved product positioning; QA only for testable fixtures/benchmark harness. Security only for risk-triggering executable fixtures, network calls, credentials, downloaded content, filesystem exposure or suspicious data. If a required review cannot fit the budget, stop with BLOCKED and obtain a new owner decision, not a fake PASS.
5. **Dispatch budgets:** #74 target 3, maximum 4 (FAST). #75 protocol-only up to 4 (FAST); if executable fixtures are approved, STANDARD maximum 8 with Developer + QA + Code Reviewer + Release Manager and Security if triggered. #76 target 3, maximum 4 (FAST). The ceilings count resumes and retries; no more than two concurrent specialists; prefer sequential dispatch to preserve context.
6. **Output policy:** Each specialist returns a packet ≤200 words with `TASK_ID, REVISION, STATUS, INPUTS, EVIDENCE_PATHS, RECIPIENT, DELTA, OPEN_RISKS`; detailed deliverables reside in files. No agent may launch nested agents. Read only cited paths. Fetch only material that could change a specific claim.
7. **Pro-plan research budget:** do not infer token cost from number of searches. For each #74 research tranche, at most 8 targeted search queries and 12 source pages; at most 5 deep comparisons, cache deduped URLs, and stop when evidence is insufficient. Additional tranches require owner authorization; do not scan the entire web or fetch every competitor's full documentation. Search budget is a work-scope limit, not a Claude subscription quota.
8. No paid vendor trials, paid API benchmarks, external app credentials, website login, uncontrolled crawling, or additional subscription purchases without a separate owner decision. Public competitor facts may be fetched from official pages and targeted independent sources. No secrets, DOM/customer data or private assets leave the repo.
9. Branch from current `main`, verify clean/dirty tree before editing, and stage only explicitly authorized paths. Open **Draft PRs**; do not merge, publish claims, accept residual risks or change governance without owner approval. Commit messages and PR bodies are human and concise.
10. Avoid full tests for pure Markdown/JSON editing unless a relevant gate or changed executable code requires them. Validate source URLs, Markdown links, schema and JSON parsing; run focused regression on newly added benchmark code, then required wider verification and CI.
11. Existing `docs/PHASE-PLANS.md` is the engineering planning authority; do not rewrite existing phase definitions or mark planned capabilities as shipped. M0 notes are companions. Resolve inconsistencies in small reviewed changes.
12. Completion means evidence + independent review + Release Manager verdict **on the final revision**, not just agent completion.

## M0 delivery dependencies and roadmap

| Sequence | Issue | Concrete artifact | Code impact | Review lane | Exit |
|---|---|---|---|---|---|
| 1 | #74 competitor evidence | Normalized `competitor-matrix.json` and research methodology/notes | None intended | Technical Writer, Code Reviewer, Release Manager | Every claim traceable to a dated source |
| 2 | #75 benchmark protocol | `docs/research/competitive-benchmark-protocol.md`, minimal deterministic fixture and tests *only if approved* | Optional bounded test-only code | Design: docs review; executable: Developer, QA, Code Reviewer, Release Manager, Security as risk dictates | Common evaluable protocol with adverse cases |
| 3 | #76 claim audit | `docs/research/falcon-capability-claims.md` plus surgical README/architecture/phase-plan corrections | Docs only | Technical Writer, Code Reviewer, Release Manager | No unsupported SHIPPED or superiority assertion |

**Provisional implementation window:** three short gated work packages, not a promised calendar duration. Stop at each PR for human acceptance. Do not execute all three in one accumulating Claude session.

---

## Issue #74 — Versioned competitor evidence register

**Issue:** https://github.com/eddieir/Falcon-Automation/issues/74  
**Job:** Create a source-of-truth register that makes it impossible to confuse a vendor's marketing claim with independently verified product functionality.

### Initial evidence inventory and target market

Start from the existing `docs/research/competitor-matrix.json`, not a blank spreadsheet. Preserve historical entries and provenance, including withdrawn conclusions and older access dates. The initial shortlist is **Playwright Test Agents**, **Momentic**, **mabl**, **Tricentis Testim**, **Testsigma**, **Katalon**, **testRigor**, **Healenium**, **Autify**, **Functionize**, **QA Wolf**, **BrowserStack self-healing**, and selected open-source browser automation agents. Treat each as a category-specific comparator, not necessarily feature-for-feature interchangeable.

Group:
- **Code-first/framework**: Playwright native agents, Cypress, Selenium ecosystem, Healenium.
- **AI-authored/maintained E2E SaaS**: Momentic, mabl, Testim, Testsigma, Katalon, testRigor, Autify, Functionize.
- **Managed QA/browser infrastructure**: QA Wolf, BrowserStack.
- **Adjacent**: visual verification, browser-agent frameworks, test observability; include only when a specific Falcon buyer job overlaps.

Competitive dimensions: suite creation method, code portability, stable semantic assertions, selector repair/approval/rollback, refusal behavior, reproducibility, local data/control, offline operation, browser support, CI integrations, debugging evidence, auth/stateful flows, performance, pricing transparency, and customer adoption friction.

### Steps

**74.1 Inventory and normalization — no research agent yet.**
- Inspect JSON schema, source IDs, duplicates, `accessStatus`, historical freshness, `independentlyVerified` and `reproducibility`. Preserve backward compatibility.
- Index existing verified claims and exact source links; identify coverage gaps rather than fetching everything again.
- Build a compact worklist of at most 5 unresolved material comparisons for the first research tranche.

**74.2 Evidence research — bounded.**
- Prioritize official product docs and changelogs; corroborate controversial/high-value claims with independent tests if possible.
- Capture `vendor`, `category`, `feature/claim`, `claimText`, `sourceUrl`, `sourceType`, `accessedAt`, `published/updated` where given, `version`, `accessStatus`, `verificationLevel`, `limitations`, `lastVerified`.
- Label evidence `VENDOR_CLAIM`, `OFFICIAL_DOCUMENTED`, `INDEPENDENTLY_TESTED`, `UNVERIFIED`, `STALE`, or `WITHDRAWN`.
- Don't translate absence of documentation into `NO FEATURE`; use `UNKNOWN`. Avoid competitor performance percentages without matching methodology.

**74.3 Documentation and schema check.**
- Add a lightweight methodology note at `docs/research/competitive-evidence-method.md` with freshness policy (recheck volatile claims before release), retrieval limits, citation standards and how to amend/retract a claim.
- Edit `docs/research/competitor-matrix.json` minimally. If format migration is necessary, propose it before writing and preserve readers/tests.
- Add schema-consistency tests or a deterministic local validation script *only if there is a suitable existing test framework and this does not substantially enlarge the scope*. Otherwise parse JSON and validate required fields manually with recorded commands.

### Issue-specific acceptance tests (AC-74)

- **AC74-01:** All source URLs and source IDs are unique or intentionally related; dedupe methodology documented.
- **AC74-02:** All material claims include product identity, evidence location, access date, and an explicit verification level.
- **AC74-03:** A stale or inaccessible page does not become a current product fact.
- **AC74-04:** A vendor press release cannot silently become independent benchmark evidence.
- **AC74-05:** Missing competitor feature evidence is UNKNOWN, not false.
- **AC74-06:** Historical withdrawn figures remain marked withdrawn and are not reused.
- **AC74-07:** Existing JSON consumers remain compatible or have a reviewed migration plan.
- **AC74-08:** Sources can be rechecked with a focused query instead of another full market search.

### Role handoffs

- Production Director: scope, source index, allowlist, run ledger, final evidence packet.
- Technical Writer (`claude-haiku-4-5`, 8 turns): source table/doc edits; verify links and JSON; does not decide product strategy.
- Code Reviewer (`claude-sonnet-4-6`, 16-turn front matter to verify): inspect provenance, schema and diff independently.
- Release Manager (`claude-sonnet-4-6`, actual maxTurns from current agent definition): check all ACs and final revision.
- Product Manager (`claude-haiku-4-5`) **only if** shortlist/strategic comparator selection is genuinely ambiguous.

**Owner permission:** draft PR only; no live competitor subscriptions. **Exit:** reviewed register with a machine-checkable provenance baseline, no claims of superiority.

---

## Issue #75 — Reproducible cross-product benchmark protocol

**Issue:** https://github.com/eddieir/Falcon-Automation/issues/75  
**Job:** Define a test that competitors can genuinely pass or fail and that yields comparable results. This is not permission to claim superiority without testing.

### Work packages

**75.A — Protocol and scoring (docs-only first).**
- Document the same test fixtures and setup for each tool; include exact version, provider settings, browser/OS, authentication, CI conditions, allowed manual assistance, trials consumed and monetary cost.
- Evaluate six families:
  1. Locator change: stable hook renamed but semantic identity remains.
  2. Ambiguous candidate: two visually/semantically similar controls; wrong click forbidden.
  3. Multi-step flow: search/filter/form submit with assertion on resulting state.
  4. Auth/role state: two users, privilege-protected page, isolated contexts.
  5. Failure reporting: skipped/unreachable/unasserted steps never become false green.
  6. CI economics: time-to-green, retries, triage, review, browser minutes, AI calls and setup effort.
- Use multiple seeds / bounded repeats where nondeterminism matters; publish `N`, variance and failures. No made-up confidence intervals from one run.
- Equalize human setup and intervention: record assisted and fully automated trials separately.
- Define denominator and semantics before testing: `healingPrecision = correctRepairs / attemptedRepairs`, `unsafeActionRate = wrongActions / repairAttempts`, `falseGreenRate = incorrectlyPassed / objectivelyFailed`, plus `recoveryRefusalRate`, operator minutes and evidence completeness. Protect undefined denominators with N/A.
- Weighting/rubric must be explicit; provide both dimensional outcomes and any weighted composite. Price claims require dated and applicable rate terms.
- A competitor with no accessible trial is `NOT_TESTED`, never zero.
- Store protocol under `docs/research/competitive-benchmark-protocol.md`; reserve a manifest in `docs/research/competitive-benchmark-runs/README.md` describing data, versions and evidence retention.

**75.B — Fixture design (implementation only after protocol review).**
- Reuse existing browser fixtures before adding a new app. Put fixtures under the established test fixture directory; avoid changing `src/core` or production code.
- Provide deterministic DOM cases: renamed ID, stable accessible name, misleading nearby candidate, hidden element, delayed render, navigation, role denied, no assertion, intentional failure, 404/500, flaky timing.
- Use explicit fixed seeds/fake clocks where feasible; no uncontrolled external HTTP; serve locally on a disposable port.
- Safely reset application state between attempts and never include real credentials.
- Include fixture manifest with fixture ID, expected behavior, test setup, human intervention budget and outcomes.
- Keep any harness generic enough to ingest independent vendor results without hard-coded winner.

**75.C — Reproducible local validation.**
- Run focused regression/fixture tests first. If executable logic changed, use the full relevant project gates under `CLAUDE.md`.
- Verify the evaluator penalizes false green and wrong actions, not just recovery speed.
- Simulate PASS, FAIL, REFUSE, PARTIAL, TIMEOUT, NOT_TESTED, and MISSING_EVIDENCE inputs.
- Demonstrate that reordered records, repeated runs, different versions and missing inputs do not silently change score semantics.
- Do not purchase vendor trials or run vendor automations without owner approval.

### Issue-specific acceptance tests (AC-75)

- **AC75-01:** Every workload has a versioned expected outcome and reproducible setup.
- **AC75-02:** Success and error rates have explicit numerators/denominators; N/A handled honestly.
- **AC75-03:** Each benchmark run records tool version, settings, browser/OS, cost and human assistance.
- **AC75-04:** Wrong action, false green and ambiguous match are first-class penalties.
- **AC75-05:** Refusal is measured separately from repair failure.
- **AC75-06:** Vendor not tested/unavailable is NOT_TESTED, not failed.
- **AC75-07:** Local benchmark uses disposable fixtures and does not transmit credentials or customer data.
- **AC75-08:** A reviewer can reproduce every Falcon measurement on the documented environment.
- **AC75-09:** Benchmark protocol and scoring are independently reviewed **before** any external comparison is announced.
- **AC75-10:** Distinct repetitions/runs and sample size documented; no unsupported significance claims.

### Agents and budget

- Protocol-only: Production Director → Technical Writer → Code Reviewer → Release Manager; FAST at most 4 specialist dispatches.
- Fixture implementation if approved: Production Director → Developer (`claude-sonnet-5`) → QA (`claude-sonnet-4-5`) → Code Reviewer (`claude-sonnet-4-6`) → Release Manager; STANDARD max 8 including retries, with Security (`claude-opus-5-5`) **only if** the changes introduce risk-triggered network, filesystem, secrets or executable parsing. No security gate may be skipped to meet budget.
- Prefer one Developer brief with AC IDs and a narrow allowlist. Reuse tests for reviews rather than rerunning heavy suites in each subagent.

**Implementation cut:** If fixture work is too large for one reviewed PR, issue #75 can deliver protocol in one PR and fixture harness in a second tightly linked PR without inflating agents. No benchmark product claim until both pass.

---

## Issue #76 — Falcon capability and marketing-claim audit

**Issue:** https://github.com/eddieir/Falcon-Automation/issues/76  
**Job:** Give potential customers a truthful answer to what Falcon does today, what is limited, and what is merely planned.

### Method

**76.1 Extract claims from Falcon-owned docs, not memory.**
- Read only the relevant sections of README, `docs/ARCHITECTURE.md`, `docs/PHASE-PLANS.md`, `CHANGELOG.md`, current CLI help and representative focused tests.
- Search by feature heading/keyword before reading entire large documents.
- Include generation, scoped locator recovery, approval/rollback, AI BYOK, code portability, multi-browser, auth/stateful flows, reports, parallel workers/shards, CI, visual regression, API/database, access controls and enterprise readiness.

**76.2 Classify every externally material statement.**
- `SHIPPED`: executed evidence or explicit source/test proof under a named revision; state supported modes.
- `PARTIAL`: implemented but limited mode, manual steps, incomplete platform coverage or mocked-contract tests only.
- `PLANNED`: specified in roadmap/issue without implementation evidence.
- `UNVERIFIED`: cannot reproduce or inspect evidence now; do not advertise as proven.
- `RETRACTED`: contradicted, obsolete or misleading assertion needing correction.
- For each claim record: wording, source location, current status, evidence path and test ID, supported environment, qualification, reviewer, revision, and proposed wording if correction needed.

**76.3 Address known high-risk marketing ambiguity.**
- Locator recovery action success **does not validate the customer's business outcome**; assertions remain essential.
- Generated scenarios are not guaranteed business-critical coverage.
- Firefox/WebKit availability is not the same as CI validation for all browsers.
- Mocked LLM provider contract tests are not live-model reliability certification.
- A local dashboard token is not multi-user enterprise RBAC.
- Human approval is not unique to Falcon; competitor products document approval/review paths.
- A proposed Phase 18 security design is not an implemented certified security control.
- `Open-source/self-hosted` is not equivalent to independently certified security.
- External comparison claims require dated references and benchmark parity.

**76.4 Edit only proven inaccuracies.**
- Create `docs/research/falcon-capability-claims.md` with concise table and evidence links.
- Suggest small README/architecture corrections where the evidence is adequate; avoid wholesale marketing rewrite.
- Correct broad or stale competitor statements in `docs/PHASE-PLANS.md` by adding explicit historical context and a link to issue #74 evidence rather than deleting important engineering design history.
- Preserve user-facing product positioning while removing absolute, inaccurate or unsupported comparisons.
- For claims lacking evidence, mark UNVERIFIED and create follow-up work; do not run a full test suite just to make a claim look green.

### Issue-specific acceptance tests (AC-76)

- **AC76-01:** Each material headline/value proposition has an explicit classification and evidence/unknown reason.
- **AC76-02:** README, architecture and plan docs no longer contradict one another on shipped vs planned.
- **AC76-03:** Every advertised browser/provider/security capability discloses the tested boundary.
- **AC76-04:** Human-approved locator recovery is not marketed as unique without differentiated evidence.
- **AC76-05:** Generated interactions are never mislabeled business assertions.
- **AC76-06:** No future phase is represented as shipped.
- **AC76-07:** Docs links, CLI examples and JSON references validate.
- **AC76-08:** All corrections trace to exact file, section and revision; unsupported facts remain UNVERIFIED.
- **AC76-09:** Reviews cover every final changed document.
- **AC76-10:** Final external claims are suitable for later independent benchmarking.

### Agents and budget

- Production Director → Technical Writer → independent Code Reviewer → Release Manager, FAST at most 4 dispatches.
- Product Manager only when wording changes strategic positioning and tradeoff decision is needed; QA only if concrete product assertions require new execution evidence, reclassifying the issue and obtaining approval.
- No Security Engineer for docs-only text unless risk-triggered claims, sensitive disclosure or permissions alter product security posture.

**Exit:** Reviewable, consistent customer-facing documentation and an audit table listing supported and unsupported claims.

---

## Compact per-issue Claude Code instructions

### Session A — Issue #74 (copy verbatim)

```text
FALCON M0 / ISSUE #74 — FIRST EXECUTION ONLY.
Read CLAUDE.md and .claude/skills/production-cycle/SKILL.md, then docs/research/competitor-matrix.json and the relevant M0 issue plan. Begin /production-cycle for #74 using the docs-only FAST lane. Do not read unrelated phase plans or transcripts.
Objective: preserve and normalize existing competitor provenance; research only up to five unresolved high-value comparison gaps in a bounded first tranche (8 web searches, 12 opened pages max). Dates/versions/source classification mandatory. Never interpret undocumented as absent; no paid vendor trials.
Deliver only minimal edits to docs/research/competitor-matrix.json and docs/research/competitive-evidence-method.md. Do not rewrite README unless a specific verified correction is required and owner approves expansion.
Preferred specialists: Technical Writer, independent Code Reviewer, Release Manager. No Product Manager unless ambiguity blocks the document. Model IDs must match CLAUDE.md; never Fable. Max 4 specialist dispatches. One bounded retry. Use existing evidence, delta-only packets and ledger.
Validate JSON, source provenance and links. Create Draft PR, never merge. Final answer <=350 words with PR URL, HEAD, AC74 matrix, reviewer verdicts, evidence paths, risk and next owner decision. Stop.
```

### Session B — Issue #75 (copy verbatim after #74 is reviewed)

```text
FALCON M0 / ISSUE #75 — PROTOCOL FIRST.
Use a fresh Claude Code session. Read CLAUDE.md, production-cycle skill, issue #75, the verified #74 competitor evidence index and relevant benchmark sections only.
Begin /production-cycle for the docs-only FAST protocol. Define six neutral fixture classes, precise outcomes, scoring denominators, refusal and false-green measures, run manifest, tool/version/cost variables and NOT_TESTED rules. No competing service purchases or live benchmarks.
Create docs/research/competitive-benchmark-protocol.md. Stage only scoped files. Use Technical Writer, independent Code Reviewer and Release Manager; max 4 specialist dispatches. Do not start Developer, QA or Security without a documented new implementation scope and owner approval.
Validate examples, links and scoring with deterministic illustrative data (clearly labeled), make Draft PR, never merge. Report AC75 protocol gate, missing evidence and exact next permission required to implement fixtures. Stop.
```

### Session C — Issue #76 (copy verbatim after evidence/protocol available)

```text
FALCON M0 / ISSUE #76 — CLAIM TRUTH AUDIT.
Use fresh Claude Code session. Read CLAUDE.md, production-cycle skill, issue #76, focused README/ARCHITECTURE/PHASE-PLANS sections, CHANGELOG only where needed, and #74/#75 verified evidence indices.
Begin /production-cycle FAST docs-only. Make docs/research/falcon-capability-claims.md, with every material claim tagged SHIPPED/PARTIAL/PLANNED/UNVERIFIED/RETRACTED, with exact code/test/doc evidence and revision. Correct only demonstrably misleading README/architecture/plan statements; preserve historic plan context and no absolute market superiority claims.
Specialists: Technical Writer, independent Code Reviewer and Release Manager; max 4 specialist dispatches. No broad suite run or full repo rescans. Follow verification/ledger/model routing rules, never Fable. Create Draft PR and stop before merge. Report AC76 matrix and unresolved claims <=350 words.
```

## Final milestone acceptance / human decision

M0 is COMPLETE only when:
- #74 establishes an up-to-date, source-grounded and versioned comparator set and correct source statuses.
- #75 supplies a reviewed and executable/reproducible protocol **or** clearly records a separate fixture implementation dependency and keeps milestone partial until resolved.
- #76 synchronizes Falcon marketing, architecture and phase-plan claims, with SHIPPED/PARTIAL/PLANNED/UNVERIFIED distinctions and evidence.
- Each PR has an independent review, applicable QA/Security review, Release Manager gate, and exact SHA.
- GitHub issues #74/#75/#76 have their acceptance boxes and milestone associations updated based on actual evidence (not automatically marked closed).
- No hidden skipped assertions, fabricated test results, invented competitor disadvantage or unsupported ranking claims.

**Owner first action:** Approve Issue #74 as the first bounded docs-only execution. Later issue execution requires a fresh session and separate scoped authorization. Changes to this plan are not implementation of the three issues.
