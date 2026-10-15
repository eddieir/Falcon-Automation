# Phase 18 Plan — Safe Authenticated Customer Pilots

Status: **DRAFT.** Not accepted for implementation until the Security Engineer reviews the design (SEC-02) and the owner decides BLOCKER-1 (AC-033 versus AC-076, section 6). Designed against `99bd7c5`; baseline for compatibility claims is `2572e73`.

## 1. Scope

Phase 18 makes Falcon safe to evaluate against an authenticated **staging** application, proven on a hermetic local fixture. Six capability blocks:

1. Authentication lifecycle: storageState import/export, supported login-setup, auth-evidence detection, fail-closed auth classification, per-role/per-worker state isolation (18A).
2. Zero-mutation dry-run plus a stable plan digest and drift detection (18B).
3. A versioned pilot manifest and a deterministic, fail-closed policy engine with destructive-action classification (18C).
4. Revision-bound, run-scoped, replay-protected approval for protected actions (18D).
5. A single secret-safe evidence boundary through which every persisted or displayed artifact passes (18E).
6. A hermetic fixture and a Node 24 CI gate that runs every Must (18F/DOC).

## 2. Non-goals (restating and binding)

Production-safety certification; compliance claims; SSO/OIDC/SAML; multi-tenant RBAC; business-outcome contracts (Phase 19); measured healing accuracy (Phase 20); MFA/CAPTCHA/manual login (OD-09); secrets-manager integration; third-party staging apps as a gate; shared multi-machine approval; cross-browser controls (Chromium only, OD-19); an on-demand purge command (OD-14, deferred); GoogleSearchTest in CI (AC-075).

No partial delivery may be described as pilot-ready (OD-16). The acceptance gate is conjunctive.

## 3. PR sequence, ownership, dependencies

Sequence: **18E → 18A → 18C → 18B → 18D → 18F → DOC**. 18E leads because every later PR writes artifacts and must write them through the boundary; retrofitting redaction afterwards is how leaks survive.

| PR | Owns (create/edit) | Depends on | May run in parallel with |
|---|---|---|---|
| 18E | `src/core/pilot/evidence/EvidenceBoundary.js`, `.../CanaryRegistry.js`, `.../Retention.js`, `src/core/pilot/FailureCodes.js`; edits `utils/Logger.js`, `src/core/parallel/ShardBundle.js`, `src/core/parallel/Schemas.js`, `src/core/Dashboard.js`, `src/core/ReportManager.js`, `src/core/locator/ElementFactsCollector.js`, `src/core/AIHealer/HealingReport.js`; `tests/regression/pilot/evidence-*.test.js` | — | none (foundation) |
| 18A | `src/core/pilot/auth/{AuthRole,AuthStateStore,LoginSetup,AuthEvidence,StateCopyPool}.js`; edits `src/core/BrowserManager.js`, `src/core/parallel/Runner.js`, `falcon.js` (auth flags only) | 18E | 18C |
| 18C | `src/core/pilot/{Manifest,ManifestSchema,PolicyEngine,ActionClassifier,Vocabulary}.js`, `schemas/pilot-manifest.v1.json`; edits `falcon.js` (manifest flag only) | 18E | 18A |
| 18B | `src/core/pilot/{PlanDigest,PilotPlan,DryRun,DryRunGuard}.js`; edits `src/core/PlanFile.js` (additive v2 reader), `falcon.js` (dry-run flag) | 18A, 18C | — |
| 18D | `src/core/pilot/approval/{ApprovalStore,ApprovalRecord,AuditLog,Binding}.js`; edits `falcon.js` (approval flags), `src/core/Dashboard.js` (read-only view, Could) | 18B, 18C | — |
| 18F | `tests/fixtures/pilot-app/**`, `tests/regression/pilot/**` (non-18E files), `package.json` scripts, `.github/workflows/ci.yml` | 18A–18E | DOC |
| DOC | `docs/pilot/operator-guide.md`, `docs/pilot/manifest-reference.md`, `docs/pilot/retention.md`, `docs/ARCHITECTURE.md`, `README.md`, `.env.example` | 18A–18E | 18F |

Parallelism rule: at most two concurrent PRs with disjoint file sets. 18A and 18C both touch `falcon.js`; each adds a separate, clearly delimited flag block and the second to land rebases. No other overlap exists.

## 4. Per-PR gates

Every PR: `npm run test:unit`, `npm run test:regression`, and its own new tests. 18A/18B/18C/18D/18F additionally run `npm run test:pilot`. 18E additionally runs the canary suite. 18F additionally proves the CI job green on Node 24 with zero skips. Final gate: `npm run test:pilot` plus `npm test` plus `npm run test:coverage` plus `npm run test:browser`, all recorded with command and result.

No PR may weaken an existing test, and each bug fix inside Phase 18 carries a regression test that fails before the fix.

## 5. Rollback per PR

All Phase 18 behaviour is gated behind new flags (`--pilot-manifest=`, `--role=`, `--dry-run-plan=`, `--approve-*`). With none of them, the code path is the `2572e73` path (AC-076).

| PR | Rollback |
|---|---|
| 18E | Revert is unsafe to do alone once later PRs land (they call the boundary). Rollback is forward-only: fix the boundary. Before 18A lands, a plain revert is clean because the only behaviour change is additional redaction in existing sinks. |
| 18A | Revert the module directory and the `falcon.js` flag block; parallel `Runner.js` role assignment is behind `roleAssignment == null`. |
| 18C | Revert; absence of `--pilot-manifest` already means legacy behaviour. |
| 18B | Revert; plan v2 reading is additive, v1 plans keep working. |
| 18D | Revert; without the approval store, protected actions refuse with `APPROVAL_REQUIRED` — fail closed, never permit. |
| 18F | Revert the CI job and fixture; no production code depends on them. |
| DOC | Plain revert. |

Kill-switch for an operator mid-pilot: omit the pilot flags. There is no env var that re-enables pilot mode implicitly, deliberately (AC-014).

## 6. Migration

**PR #54 `--save-plan` output has no schema digest.** `PlanFile` today writes `{format:"falcon-test-plan", version:1, url, journey, scenarios}` and `PlanFile.load` rejects unknown top-level keys, so a digest cannot be bolted onto v1 without breaking old readers. Migration:

- `PlanFile` gains a v2 document: `version: 2`, plus `digest`, `digestAlgorithm`, `manifestRef`, `role`, `targetOrigin`, `actions[].actionId`. `TOP_KEYS` becomes version-dependent; v1 keeps exactly today's key set.
- `PlanFile.load` keeps accepting v1 and keeps throwing `PlanError("PLAN_INVALID")` → **exit 2** for malformed input, unchanged (AC-076).
- A v1 plan replayed with `--plan` and no pilot flags behaves exactly as today.
- A v1 plan replayed in pilot execute mode (`--pilot-manifest` present, or a role declared authenticated) is refused `PLAN_INVALID` with reason `PLAN_NO_DIGEST`, exit 2, before any browser launch.
- `--save-plan` in pilot mode writes v2. `--save-plan` without pilot flags keeps writing v1 so existing fixtures and docs stay valid. A documented one-shot upgrade path is `--dry-run-plan=` re-derivation, not a mechanical v1→v2 rewrite: a digest must be derived from an observed page, never minted from an unreviewed file.

**BLOCKER-1 (needs owner input, do not let me reinterpret it).** AC-033 reads "Plan lacking schema version or digest (including current `--save-plan` output) refused `PLAN_INVALID` for execute". Taken literally for *every* `--plan` execute, it forbids replaying existing v1 plans and therefore contradicts AC-076 (behaviour identical to `2572e73` with no Phase 18 flags) and breaks PR #54's shipped feature. The design above scopes the refusal to pilot execute mode. That is the only reading under which both criteria hold. Owner must confirm the scoping or accept breaking AC-076; I will not silently choose.

Other migrations: no DB schema change; no OpenAI configuration change; new `.env.example` keys (`PILOT_ROLE_*_USERNAME`, `PILOT_ROLE_*_PASSWORD`, `PILOT_APPROVER`) are added genuinely blank (AC-080). `.gitignore` gains `run/auth/` and `run/approvals/`.
