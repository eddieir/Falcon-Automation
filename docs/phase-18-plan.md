# Phase 18 Plan — Safe Authenticated Customer Pilots

Status: **DRAFT rev 3.** Design is architecture rev 2 plus the rev 3..rev 11 patches. Owner decisions OWNER-01..OWNER-07 are recorded at 3741d42 and resolve BLOCKER-1, OD-17-Q1 and OD-20..OD-24; they authorise no implementation, merge or publication. Implementation stays blocked until the locator-cache test-reliability PR has merged, post-merge main is green, SEC-09 and SEC-10 have reviewed the rev 9 and rev 10 deltas, and OD-24-Q1, OD-20-Q1, OD-22-Q1 and OD-22-Q2 are answered (OWNER-09, OWNER-10, OWNER-11). Baseline for compatibility claims is 2572e73.

## 1. Scope

Phase 18 makes Falcon safe to evaluate against an authenticated **staging** application, proven on a hermetic local fixture. Six capability blocks:

1. Authentication lifecycle: storageState import/export, supported login-setup, auth-evidence detection, fail-closed auth classification, per-role/per-worker state isolation (18A).
2. Zero-mutation dry-run plus a stable plan digest and drift detection (18B).
3. A versioned pilot manifest and a deterministic, fail-closed policy engine with destructive-action classification (18C). Classification is total by inversion: only an exact manifest permit entry or a frozen read-only action is permitted; everything else is protected (D11/OWNER-07, rev 9 3a).
4. Revision-bound, run-scoped, replay-protected approval for protected actions (18D).
5. A single secret-safe evidence boundary through which every persisted or displayed artifact passes (18E).
6. A hermetic fixture and a Node 24 CI gate that runs every Must (18F/DOC).

## 2. Non-goals (restating and binding)

Production-safety certification; compliance claims; SSO/OIDC/SAML; multi-tenant RBAC; business-outcome contracts (Phase 19); measured healing accuracy (Phase 20); MFA/CAPTCHA/manual login (OD-09); secrets-manager integration; third-party staging apps as a gate; shared multi-machine approval; cross-browser controls (Chromium only, OD-19); an on-demand purge command (OD-14, deferred); GoogleSearchTest in CI (AC-075); distributed or CI-side approval of protected actions (D3, D4); any claim of browser egress isolation or certification of customer network controls (D6); pilot contribution to locator memory or healing trust (D2); pilot mode on overlayfs, virtiofs, drvfs, dev containers or WSL (D5).

No partial delivery may be described as pilot-ready (OD-16). The acceptance gate is conjunctive.

## 3. PR sequence, ownership, dependencies

Sequence: **18E → 18A → 18C → 18B → 18D → 18F → DOC**. 18E leads because every later PR writes artifacts and must write them through the boundary; retrofitting redaction afterwards is how leaks survive.

| PR | Owns (create/edit) | Depends on | May run in parallel with |
|---|---|---|---|
| 18E | `src/core/pilot/evidence/{EvidenceBoundary,SecretRegistry,CanaryRegistry,Retention}.js`, `src/core/pilot/{FailureCodes,Digest,JsonStrict,PilotRoots,BuildIdentity}.js`, `src/core/pilot/PilotActionGate.js` (interface + `passthrough()` only), `src/core/pilot/PilotLifecycle.js`; edits `src/core/parallel/SafeFs.js` (additive: `readBoundedPrivateJson`, `writeAtomicPrivateSynced`, `createExclusive`), `utils/Logger.js`, `src/core/parallel/ShardBundle.js`, `src/core/parallel/Schemas.js` (comment only — `canonicalJson` is frozen), `src/core/Dashboard.js`, `src/core/ReportManager.js`, `src/core/TestRunner.js` (error triple), `src/core/locator/ElementFactsCollector.js`, `src/core/AIHealer/HealingReport.js`; `tests/unit/pilot/{digest,jsonstrict,safefs-private}.test.js`, `tests/regression/pilot/evidence-*.test.js`, `neg-l01-*`, `neg-l02`, `neg-l04`, `neg-l05`, `neg-n5`, `neg-n6`, `neg-x01`, `neg-e01`, `neg-f01-loaders` (loader half), `neg-f02-planted`, `neg-f03-orphans`, `neg-fs-behaviour`, `neg-healing-counter-schema` | — | none (foundation); rev 10 adds: `neg-d1-boot-identity` (sole owner); rev 10 adds: per-root filesystem admission (approvals root refuses tmpfs, exit 18 approvals_root_not_durable) |
| 18A | `src/core/pilot/auth/{AuthRole,AuthStateStore,LoginSetup,AuthEvidence,StateCopyPool}.js`; edits `src/core/BrowserManager.js` (`newContext(options)`), `src/core/parallel/Runner.js`, `falcon.js` (auth flags only); `neg-n3-statefile`, `neg-n7-login`, `neg-l08-ignored`, auth half of `neg-f01-loaders` | 18E | 18C |
| 18C | `src/core/pilot/{Manifest,ManifestSchema,PolicyEngine,ActionClassifier,Vocabulary,RouteMatch,NetworkGate}.js`, `schemas/pilot-manifest.v1.json`; edits `falcon.js` (manifest flag only); `neg-n01-network`, `neg-n1-fetch-post`, `neg-n4-routes`, `neg-b03-homoglyph`, `neg-b05-provider-index`, `neg-l07-userinfo`, `neg-l03-runner-artifacts` (manifest half), `neg-s01-caps` (policy half), `neg-c01-default-protected`, extended AC-042/043 matrices; **owns SPIKE-R** (redirect-hop behaviour) and must land either the verified handler path or the mandated `route.fetch({maxRedirects:0})` fallback — the fallback is the default | 18E | 18A; rev 9 adds: `neg-n1-script-dispatch`, the `actions.permitted` manifest surface, the closed positive permit set and frozen read enum, NetworkGate independence |
| 18B | `src/core/pilot/{PlanDigest,PilotPlan,DryRun,DryRunGuard}.js`, full `src/core/pilot/PilotActionGate.js` implementation; edits `src/core/PlanFile.js` (additive v2 reader, `stat`→privileged loader, credential-semantic value screen), `src/core/AIHealer/AIHealer.js` (all four `_performAction` call sites `:337,:419,:586,:652` route through the gate; `:419` refused in pilot mode), `src/core/ClickExplorer.js` (pilot-mode refusal at `clickElement`), `src/core/SiteSweep.js` and `src/core/parallel/ParallelDiscovery.js` (pilot-mode refusal), `falcon.js` (dry-run flag); `neg-p03-swap`, `neg-b01-gate`, `neg-b04-ordinal`, `neg-q-plan-values`, `neg-d01-vectors` (plan half), `neg-n2-review`, `neg-n8-mixed-process`, `neg-r01-userdatadir`, `neg-b06-permit-traceability`, `neg-plan-mode-scope` | 18A, 18C | —; rev 9 adds: `neg-c02-no-lowering` (recompute at perform, maximum rule, heal re-classification) and permit re-validation (`PLAN_PERMIT_UNJUSTIFIED`); rev 10 adds: neg-n2-arming (k)-(r) method-observed redirect continuation (gated on SPIKE-R) |
| 18D | `src/core/pilot/approval/{ApprovalStore,ApprovalRecord,AuditLog,Binding,RunToken}.js`; edits `falcon.js` (approval flags (`--approve-action`, `--emit-token-to`; `--approval-run-token=` never ships)), `src/core/Dashboard.js` (read-only view, Could); `neg-p01-chain`, `neg-p01-truncate`, `neg-p02-replay`, `neg-q-runscope`, `neg-q-prune`, `neg-q-roots`, `neg-p04-build` (extended), `neg-q-retention`, `neg-arming-window-config`, approval half of `neg-f01-loaders` and `neg-s01-caps` | 18B, 18C | —; rev 9 adds: the `PilotApprovalResolver` injection seam, `tests/pilot/approval/FixtureApprovalAuthority`, `tests/pilot/fixtures/PilotFixtureServer`, `tests/pilot/bin/approved-fixture-case.cjs`; `neg-fixture-approval-scope`, `neg-fixture-no-arbitrary-target` (blocker gate), `neg-fixture-require-graph`; ADR-0044 accepted with owner decision OWNER-09/OWNER-10 |
| 18F | `tests/fixtures/pilot-app/**`, `tests/regression/pilot/**` (non-18E/18B/18C/18D files), **`playwright.config.js` (new `pilot` project: `screenshot/video/trace` off, `recordVideo`/`recordHar` unset, `outputDir` under `run/pilot-test-results/`, `retries: 0`, `testMatch` for `tests/regression/pilot/**`)**, `package.json` scripts, `.github/workflows/ci.yml`; `neg-ci-no-approve-step`, `neg-pilot-store-concurrent-writer`, the `--expect-config-fp` static check, SPIKE-FS runner assertion | 18A–18E | DOC; rev 9 adds: the transitive workflow reachability check that fails closed on unresolvable commands |
| DOC | `docs/pilot/operator-guide.md` (two-command approval workflow and run token handling), `docs/pilot/manifest-reference.md`, `docs/pilot/retention.md` (segments and anchors), `docs/pilot/limitations.md` (**new**: audit log is attribution and tamper-evidence not authentication; same-uid rollback limit; no Windows pilot; bulk sweep refused in pilot mode; background non-GET requests aborted), `docs/ARCHITECTURE.md`, `README.md`, `.env.example`; compatibility matrix, two-feature plan documentation split, expected egress allowlist, full D10 limitations list | 18A–18E | 18F |

Parallelism rule unchanged (at most two concurrent PRs, disjoint file sets). Note the new overlap: 18B and 18C both touch `falcon.js`; so do 18A and 18D. Each PR adds a separate, clearly delimited flag block and the later one rebases. `src/core/pilot/PilotActionGate.js` is created by 18E (interface plus `passthrough()`) and implemented by 18B — the only intentional two-PR file, sequenced so the `AIHealer`/`ClickExplorer` edits land exactly once.


## 4. Per-PR gates

Every PR: `npm run test:unit`, `npm run test:regression`, and its own new tests. 18A/18B/18C/18D/18F additionally run `npm run test:pilot`. 18E additionally runs the canary suite. 18F additionally proves the CI job green on Node 24 with zero skips. Final gate: `npm run test:pilot` plus `npm test` plus `npm run test:coverage` plus `npm run test:browser`, all recorded with command and result.

No PR may weaken an existing test, and each bug fix inside Phase 18 carries a regression test that fails before the fix.

### Revision 2 gate additions

Every PR additionally runs its own `neg-*` tests from architecture section 19a and must show each one failing with the relevant control removed (the inversion is part of the evidence, not optional). 18C may not merge without SPIKE-R's recorded result or the fallback implementation. 18E's `neg-l01-*` suite must be shown failing with the secret registry disabled.

### Revision 3 gate additions

m-15..m-19 are mandatory. No PR affected by a gate may be recorded as done, and no GO may be recorded for it, without a named automated test, its command and its result. Every neg-* test must additionally be shown failing with its control removed.

## 5. Rollback per PR

All Phase 18 behaviour is gated behind new flags (`--pilot-manifest=`, `--role=`, `--dry-run-plan=`, `--approve-*`). With none of them, the code path is the `2572e73` path (AC-076).

| PR | Rollback |
|---|---|
| 18E | Revert is unsafe to do alone once later PRs land (they call the boundary). Rollback is forward-only: fix the boundary. Before 18A lands, a plain revert is clean because the only behaviour change is additional redaction in existing sinks. |
| 18A | Revert the module directory and the `falcon.js` flag block; parallel `Runner.js` role assignment is behind `roleAssignment == null`. |
| 18C | Revert; absence of `--pilot-manifest` already means legacy behaviour. The classification revert direction is unsafe in both halves (restoring an element-shape gate or a permit default is a safety regression, so 18B and 18C defects are fixed forward). D11 is forward-only once merged: restoring the permit-by-default fall-through is a safety regression, so a defect is fixed forward. |
| 18B | Revert; plan v2 reading is additive, v1 plans keep working. |
| 18D | Revert; without the approval store, protected actions refuse with `APPROVAL_REQUIRED` — fail closed, never permit. |
| 18E | Narrowing the filesystem allowlist is forward-only for the same reason. |
| 18F | Revert the CI job and fixture; no production code depends on them. |
| DOC | Plain revert. |

Kill-switch for an operator mid-pilot: omit the pilot flags. There is no env var that re-enables pilot mode implicitly, deliberately (AC-014).

### Revision 2 rollback additions

| PR | Rollback addition |
|---|---|
| 18E | The three `SafeFs` exports are additive and independently revertable; `Schemas.canonicalJson` is unmodified, so Phase 16 digests cannot regress. |
| 18B | Reverting restores `passthrough()` at every gate call site, i.e. the `2572e73` click path; `ClickExplorer`/`SiteSweep` refusals disappear with the pilot flag. |
| 18D | Reverting leaves `run/approvals/` on disk; protected actions then refuse `APPROVAL_REQUIRED`. Run tokens become inert. |
| 18F | Reverting the `pilot` Playwright project removes the pilot regression project; the repository defaults are then the only config, so pilot tests must not be run through the runner until it is restored. |

## 6. Migration

**PR #54 `--save-plan` output has no schema digest.** `PlanFile` today writes `{format:"falcon-test-plan", version:1, url, journey, scenarios}` and `PlanFile.load` rejects unknown top-level keys, so a digest cannot be bolted onto v1 without breaking old readers. Migration:

- `PlanFile` gains a v2 document: `version: 2`, plus `digest`, `digestAlgorithm`, `manifestRef`, `role`, `targetOrigin`, `actions[].actionId`. `TOP_KEYS` becomes version-dependent; v1 keeps exactly today's key set.
- `PlanFile.load` keeps accepting v1 and keeps throwing `PlanError("PLAN_INVALID")` → **exit 2** for malformed input, unchanged (AC-076).
- A v1 plan replayed with `--plan` and no pilot flags behaves exactly as today.
- A v1 plan replayed in pilot execute mode (`--pilot-manifest` present, or a role declared authenticated) is refused `PLAN_INVALID` with reason `PLAN_NO_DIGEST`, exit 2, before any browser launch.
- `--save-plan` in pilot mode writes v2. `--save-plan` without pilot flags keeps writing v1 so existing fixtures and docs stay valid. A documented one-shot upgrade path is `--dry-run-plan=` re-derivation, not a mechanical v1→v2 rewrite: a digest must be derived from an observed page, never minted from an unreviewed file.

**BLOCKER-1 is decided (D1/OWNER-01).** The `PLAN_INVALID` refusal of AC-033 applies **only** to pilot execute mode, i.e. a run in which `--pilot-manifest` is present **or** the selected `--role` is declared `authenticated: true` in a resolved manifest. In that mode a plan without `version: 2`, without `digest`, or without `digestAlgorithm` — including every plan written by `--save-plan` at `2572e73` — is refused `PLAN_INVALID` with reason `PLAN_NO_DIGEST`, **exit 2**, at `PlanFile.load`, before any browser launch, any context creation and any network activity. Outside pilot mode `--plan` replay of a v1 plan is **byte-identical to `2572e73`**: same acceptance, same `PlanError("PLAN_INVALID")` → exit 2 for malformed input, same `isKeyShapedValue` screen, no digest requirement, no new refusal. AC-033 and AC-076 both hold with no amendment to AC-076. The mode test is a single predicate, `PilotLifecycle.isPilotExecute(argv, manifest)`, computed once before `PlanFile.load` is called and passed in as an argument; it is never re-derived inside the loader and never read from the plan file itself, so a plan cannot elect its own mode.

Other migrations: no DB schema change; no OpenAI configuration change; new `.env.example` keys (`PILOT_ROLE_*_USERNAME`, `PILOT_ROLE_*_PASSWORD`, `PILOT_APPROVER`) are added genuinely blank (AC-080). `.gitignore` gains `run/auth/`, `run/approvals/` and `run/plans/`. No CI approve step exists, so there is nothing to migrate for CI approvals; --expect-config-fp is a new pilot-only merge flag; the compatibility matrix is a new committed artifact.

### Revision 2 migration additions


- **No new configuration surface for roots.** `run/auth/`, `run/approvals/` and `run/plans/` are fixed by `PilotRoots` and are not configurable; `.gitignore` gains all three. An operator with an existing approvals directory elsewhere must move it.
- **Audit log format.** The log is segmented from the start (`run/approvals/audit/<segmentId>.log` plus `anchors.log`); there is no legacy single-file form to migrate.
- **Plan v2 values.** A credential-semantic literal in a v2 plan is refused `PLAN_VALUE_LITERAL_CREDENTIAL` (exit 15). v1 plans outside pilot mode keep today's `isKeyShapedValue` screen and exit 2, so AC-076 is unaffected.
- **Platform.** Pilot mode requires POSIX uid/mode/`O_NOFOLLOW` support and a local filesystem for `run/approvals`; `win32` and network filesystems are refused `PILOT_INTERNAL_ERROR` (exit 18). This is a documented Phase 18 limitation, not a regression of any existing path.
- **New env keys** (`.env.example`, genuinely blank): `PILOT_ROLE_*_USERNAME`, `PILOT_ROLE_*_PASSWORD`, `PILOT_APPROVER`, `PILOT_APPROVAL_RUN_TOKEN`.

The fixture approval seam has no revert path that is safe: restoring a production mint function or an environment-variable test mode is a security regression, so 18D defects there are fixed forward.

The approval brand has no safe revert path: replacing the private-field brand with a scope string, exporting any brand or writer surface, or removing the deep freeze reopens SEC-10 M-15, so 18D defects there are fixed forward.
