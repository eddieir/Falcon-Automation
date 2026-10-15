# Phase 18 — Authenticated Pilots

Status: **DRAFT** pending SEC-02 design review against [the threat model](../security/phase-18-threat-model.md) and the owner decision on BLOCKER-1 in [the plan](../phase-18-plan.md). Designed against `99bd7c5`.

## 1. Context and constraints

Falcon is CommonJS on Node >= 22 (CI Node 24), Playwright-driven, entry `falcon.js`. Existing facts this design is built on, verified in code:

- Exit codes in use today are only `0`, `1` (test failure / config error / fatal), `2` (rejected input: bad plan, bad merge argv), `3` (merge state not durable — `falcon.js:558`, `src/core/parallel/Runner.js:80`). `ReportManager.js:283` sets `process.exitCode = overallResult === "PASSED" ? 0 : 1`.
- `src/core/parallel/Schemas.js` already has `canonicalJson` (sorted keys, `JSON.stringify` leaves) and `redactText`/`storedUrl`/`stripUrlQueries`. Phase 18 reuses `canonicalJson` rather than inventing a second canonicaliser.
- `utils/Logger.js` already redacts URL userinfo, `Authorization`, bearer tokens and `token=`/`password=` pairs, and strips control characters. It is a redaction *implementation*, not a boundary: reports, dashboard events, shard bundles and locator memory each redact separately. Phase 18 unifies them.
- `src/core/locator/ElementFactsCollector.js` already uses a fixed attribute allow-list and excludes input values, passwords, cookies and storage. Phase 18 adds the enforcing test, not new filtering.
- `AIHealer.js` builds prompts from `descriptor.text` / allow-listed attributes via `_promptValue`; this is the provider-prompt sink that must pass the boundary (AC-063).
- `BrowserManager.newContext()` takes no options today; per-role storage state needs a parameter.
- `Dashboard.js` is token-gated, loopback-default, caps events; approval view reuses that gate.

Constraints: deterministic CI; no raw `console.log`; `fs.promises` on hot paths; OpenAI/provider access only through the SDK/provider registry with lazy init and a missing-key fallback; meaningful exit codes, tested directly; no uncontrolled third-party sites in CI; Chromium only (OD-19).

## 2. Module layout

```
src/core/pilot/
  FailureCodes.js            enum, numeric exit codes, report field, dashboard event
  Manifest.js                load, validate, normalise, revision digest
  ManifestSchema.js          strict schema; JSON Schema export (AC-081)
  Vocabulary.js              built-in destructive lexicon + manifest terms
  ActionClassifier.js        deterministic signal -> classification
  PolicyEngine.js            the ordered evaluation
  PlanDigest.js              canonical JSON, material/excluded fields
  PilotPlan.js               plan v2 document, actionId derivation
  DryRun.js                  dry-run context construction and counters
  DryRunGuard.js             request interception + sink refusals
  auth/AuthRole.js           role model from the manifest
  auth/AuthStateStore.js     storageState import/export, 0600, fingerprints
  auth/LoginSetup.js         env-referenced credential login on the target
  auth/AuthEvidence.js       authenticated / anonymous / undetermined
  auth/StateCopyPool.js      per-(role,worker) copies, deterministic cleanup
  approval/ApprovalStore.js  durable store, atomic write, replay protection
  approval/ApprovalRecord.js record shape and binding
  approval/Binding.js        binding computation and comparison
  approval/AuditLog.js       append-only history with integrity chain
  evidence/EvidenceBoundary.js  the single sink gate
  evidence/CanaryRegistry.js    test-only canary seeding and scanning
  evidence/Retention.js         age-based cleanup (AC-068)
```

Edited existing files are listed per PR in the plan. Nothing in `src/core/pilot/` is imported by a non-pilot code path except `FailureCodes` (for the exit-code table) and `EvidenceBoundary` (from the existing sinks).

## 3. Interfaces

```js
// FailureCodes.js
module.exports = {
  CODES,                       // frozen Set of code strings (the single enum, AC-012)
  exitCodeFor(code),           // -> integer, table in section 14
  reportFieldFor(code),        // -> { code, category, message }
  dashboardEventFor(code),     // -> { name: "pilotRefusal", payload: {...} }
  isKnown(code),
};

// Manifest.js
async function load(file)                 // -> Manifest | throws ManifestError{code, path}
function normalise(doc)                   // -> canonical manifest object
function revision(manifest)               // -> { version, digest }  (sha256 canonical JSON)
function exportJsonSchema()               // -> JSON Schema object (AC-081)

// ActionClassifier.js
function classify(signals, vocabulary)
// signals: { accessibleName, visibleText, role, inputType, formAction, destinationUrl,
//            method, ordinal, duplicateCount, identityStable }
// -> { classification: "permitted"|"protected"|"denied"|"ambiguous",
//      reasons: [{ signal, term, weight: "destructive"|"caution" }] }

// PolicyEngine.js
function evaluate(ctx)
// ctx: { manifest, role, authState, url, routeMatch, signals, planDigest, approvalLookup }
// -> { outcome: "permit"|"require-approval"|"deny"|"refuse",
//      code: string|null, reason: string, actionId: string|null }
function applyProviderAdvice(result, advice)   // may raise caution only (AC-045)

// PlanDigest.js
function digest(planV2)                   // -> "sha256:<hex>"
function materialView(planV2)             // -> the exact object that is hashed
const MATERIAL_FIELDS, EXCLUDED_FIELDS;   // documented arrays, asserted by test

// ApprovalStore.js
async function open({ dir })              // -> store; verifies integrity chain
async function propose(store, binding, { approver })   // -> ApprovalRecord (state "proposed")
async function decide(store, id, decision, { approver })// approved | rejected
async function consume(store, id, { runId })           // -> ok | APPROVAL_REPLAYED
async function lookup(store, binding)     // -> record | null  (exact binding match only)
async function verify(store)              // -> { ok, code }   (AC-058)

// AuthStateStore.js
async function importState(file, { role })  // -> { role, cookieCount, earliestExpiry, fingerprint }
async function exportState(context, file)   // 0600, outside tracked source
async function fingerprint(file)            // sha256 of canonical state
// Never returns or logs cookie names or values (OD-06).

// AuthEvidence.js
async function classify(page, role, manifest)
// -> { state: "authenticated"|"anonymous-expected"|"redirected-to-login"
//            |"unexpected-anonymous"|"undetermined", code }

// StateCopyPool.js
async function acquire({ role, workerId, runDir })   // -> { path, cleanup }
async function cleanupAll(runDir)                    // idempotent; called on exit and signals

// EvidenceBoundary.js
function beginRun({ runId })              // -> boundary
function registerSecret(boundary, value, { kind })    // known-value registration
function sanitize(boundary, value, { sink })          // -> sanitized value
function sanitizeObject(boundary, obj, { sink, allowList })
function assertClean(boundary, text, { sink })        // throws EVIDENCE_LEAK_DETECTED
const SINKS = ["log","report","dashboard","runHistory","locatorMemory",
               "healingEvidence","shardBundle","error","providerPrompt",
               "screenshotMetadata","approvalAudit","planFile"];
```

Manifest and policy are owned by 18C; auth by 18A; digest/plan/dry-run by 18B; approval by 18D; boundary and codes by 18E.

## 4. Manifest schema v1

Strict: unknown keys at any depth are rejected with `MANIFEST_INVALID` naming the JSON path, before any target request (AC-036). Unsupported `version` → `MANIFEST_VERSION_UNSUPPORTED` (AC-037).

```json
{
  "format": "falcon-pilot-manifest",
  "version": 1,
  "manifestRevision": "staging-2026-10-15.1",
  "baseUrl": "https://staging.example.com",
  "allowedOrigins": ["https://staging.example.com"],
  "allowedSubresourceOrigins": [],
  "routes": {
    "allowed": ["/", "/dashboard", "/orders/*"],
    "denied": ["/admin/*", "/billing/*"]
  },
  "roles": [
    {
      "name": "customer",
      "authenticated": true,
      "loginRoute": "/login",
      "authenticatedMarker": { "kind": "selector", "value": "[data-test=user-menu]" },
      "stateFile": "run/auth/customer.json",
      "credentials": { "usernameEnv": "PILOT_ROLE_CUSTOMER_USERNAME",
                       "passwordEnv": "PILOT_ROLE_CUSTOMER_PASSWORD" }
    },
    { "name": "anonymous", "authenticated": false }
  ],
  "budgets": { "maxPages": 10, "maxActionsPerPage": 25,
               "runSeconds": 300, "authTimeoutSeconds": 15 },
  "actions": {
    "permitted": ["navigate", "expect"],
    "protected": ["submit"],
    "denied": ["delete", "pay", "transfer"]
  },
  "vocabulary": { "destructive": ["void invoice", "close account"],
                  "caution": ["archive"] },
  "assertions": { "required": [{ "route": "/orders", "check": "visible",
                                 "locator": "[data-test=order-list]" }] },
  "artifacts": { "screenshots": "none", "traces": "none",
                 "domSnapshots": "none", "maskSelectors": [],
                 "screenshotRoutes": [] },
  "planDigest": null
}
```

Canonical normalisation (all before hashing and before any comparison): lowercase scheme and host; strip default port; strip trailing slash except root; strip query and fragment from route patterns; NFC-normalise strings; sort `allowedOrigins`, route arrays, action arrays and vocabulary arrays; trim and collapse internal whitespace in vocabulary terms and lowercase them; reject duplicate role names; reject a role that is `authenticated: true` without both `loginRoute` and `authenticatedMarker`.

`credentials` accepts only `*Env` keys. A literal value in any field whose name matches `password|passwd|secret|token|apiKey|credential|cookie` (field semantics), or any value matching the bounded secret-pattern checks reused from `Schemas.SECRET_PATTERNS` plus the existing `isKeyShapedValue`, is rejected `MANIFEST_SECRET_LITERAL` with zero target requests and without echoing the value (OD-15, AC-005). Pattern checks are bounded: fixed anchored regexes, no backtracking, applied only to string leaves under a 4 KiB cap.

`screenshots` default for any authenticated role is `"none"`; `"on-failure"` requires non-empty `maskSelectors` and non-empty `screenshotRoutes`, else `MANIFEST_INVALID` (OD-05, AC-050).

Manifest is **mandatory** whenever a run selects a role or uses any pilot flag (OD-07). A run with no role is refused `AUTH_ROLE_REQUIRED` unless the manifest declares an `authenticated: false` role and the operator selects it (AC-014). With no pilot flags at all, nothing in this section executes (AC-076).

## 5. Policy evaluation order

Exactly this order, short-circuiting on the first non-permit, with no reordering under any flag:

1. **Validate manifest** — schema, version, normalisation, secret-literal screen. Fail: `MANIFEST_INVALID` / `MANIFEST_VERSION_UNSUPPORTED` / `MANIFEST_SECRET_LITERAL` / `MANIFEST_ROLE_UNKNOWN`. Zero target requests.
2. **Origin** — navigation or submission target origin must be in `allowedOrigins`; subresource origin must be in `allowedSubresourceOrigins` (OD-08). Fail: `POLICY_ORIGIN_DENIED`.
3. **Route** — denied patterns beat allowed patterns; a path matching neither is denied. Fail: `POLICY_ROUTE_DENIED`. Evaluated before any interaction (AC-040).
4. **Role / auth** — role known; state present for an authenticated role; auth evidence classified. Fail: `AUTH_STATE_MISSING` / `AUTH_STATE_UNDETERMINED` / `AUTH_REDIRECT_TO_LOGIN` / `AUTH_SESSION_EXPIRED` / `AUTH_UNEXPECTED_ANONYMOUS`.
5. **Classify action** — `ActionClassifier.classify` on deterministic signals only.
6. **Deny** — manifest `actions.denied`, or classifier `denied`. Fail: `POLICY_ACTION_DENIED`. Manifest deny overrides protection *and* approval (OD-18, AC-048); no approval is consulted.
7. **Require approval for protected** — classifier `protected`, or manifest `actions.protected`. Look up an approval with an exact binding match. Fail: `APPROVAL_REQUIRED` / `APPROVAL_MISMATCH` / `APPROVAL_STALE` / `APPROVAL_REPLAYED` / `APPROVAL_UNKNOWN_PLAN`.
8. **Validate plan digest** — recompute the material view of the live plan and compare. Fail: `PLAN_DIGEST_MISMATCH` / `PLAN_DRIFT`.
9. **Permit** — record outcome and reason on the plan row (AC-035).
10. **Only then** healing or provider involvement. Healing is entered only for a step whose action was permitted at step 9. For a protected or denied action, `AIHealer` is never entered, so no provider prompt is constructed (AC-047); enforced by a guard in the healer entry point that asserts `policyOutcome === "permit"`.

Budgets (`POLICY_BUDGET_EXCEEDED`, AC-041) are checked at step 3 for page count and continuously by a monotonic deadline; on breach, no further actions are attempted and the run reports the code.

Provider advice is applied only to the *output* of step 5 via `applyProviderAdvice`, which can raise `permitted → protected` or `protected → denied` and can never lower (AC-045). Provider absent, erroring, or out of budget yields the deterministic result unchanged; there is no default permit (AC-046).

## 6. Deterministic classifier

Inputs, in priority order, all derived from the page, never from a provider: accessible name; visible text; ARIA/implicit role; `input[type]`; owning form's `action` and `method`; navigation destination URL; manifest vocabulary; duplicate ordinal and identity stability.

Built-in destructive lexicon (matched on normalised tokens, whole-word, case-insensitive, with a small morphological set): `delete, remove, destroy, erase, drop, purge, wipe`; `pay, checkout, charge, purchase, order`; `transfer, withdraw, send money, remit`; `publish, deploy, release, go live`; `send, email, notify, broadcast`; `submit, confirm, apply, save changes`; `revoke, disable, deactivate, suspend, terminate, cancel subscription`; `refund, chargeback, credit`; `invite, add user, grant access, share`.

Fail-closed rules:

- Any single destructive signal wins, regardless of how many benign signals exist. A control named "Cancel" or "View" whose form action or destination URL contains a destructive term is protected (AC-043).
- `method` in `{POST, PUT, PATCH, DELETE}` is itself a destructive signal when the control submits a form.
- A manifest `vocabulary.destructive` term matching any signal makes the control protected (AC-044); a `vocabulary.caution` term raises caution only.
- `submit` is at least protected in authenticated mode, never permitted.
- If two or more candidate elements share the derived identity, or the identity changed since the plan was bound, the outcome is `ambiguous` → `CONTROL_AMBIGUOUS` (or `PLAN_DRIFT` when a bound plan exists) with zero clicks (AC-049).
- A control with no stable identity is refused, reusing the existing `insufficient_identity_evidence` concept, before classification scoring.
- Unknown label plus unknown method plus cross-origin destination → `denied`, not `permitted`.

`actionId = sha256("falcon-action:" + canonicalJson({ route, role, accessibleName, roleAttr, inputType, formAction, destinationPath, ordinal })).slice(0,32)`. Identity change therefore changes `actionId`, which invalidates any approval (section 9).

## 7. Dry-run design

Allowed browser behaviour: launch Chromium headless; create a context with the role's state copy; `goto` allowed routes with GET; read the DOM; collect element facts; compute proposed actions; take no screenshot unless `artifacts.screenshots != "none"`.

Structurally enforced zeroes:

- **Network.** The context installs `route("**/*")` first, before any navigation. The handler aborts any request whose method is not `GET` or `HEAD`, aborts any request whose origin is not allow-listed (navigation vs subresource lists applied separately), and otherwise continues. Aborts are counted by code. Because interception is installed on the context, a request issued by page script cannot bypass it.
- **Interaction.** The page handed to discovery is a `DryRunGuard` proxy exposing only read methods. `click`, `fill`, `type`, `press`, `check`, `selectOption`, `setInputFiles`, `tap`, `dragTo`, `dispatchEvent` and `evaluate` are absent from the proxy; calling one is a `TypeError` at the call site, not a runtime policy check. Counters for click/fill/type/submit/download are asserted `=== 0` at the end of the run and written to the report (AC-025).
- **Downloads and storage.** `acceptDownloads: false`; `context.on("download")` increments a counter that must be 0; the fixture's data checksum and the state-file fingerprint are compared before and after (AC-028).
- **Provider.** Dry-run never constructs a provider. `DryRun.js` does not import `LlmProviderRegistry`, and `AIHealer` is not instantiated at all in the dry-run path. As a second, independent check, `EvidenceBoundary.beginRun` sets a dry-run flag that `src/core/llm/transport/guardedFetch` reads; any call in dry-run throws `DRYRUN_PROVIDER_BLOCKED`. The test asserts zero calls at the SDK boundary via a counting stub (AC-027).

Determinism: two identical dry-runs produce byte-identical plan files. Achieved by sorting discovered actions by `(routePath, ordinal, actionId)`, excluding timestamps/runId/host paths from the document body (they go to a sibling `*.meta.json`), and writing with the existing canonical serialiser (AC-029).

## 8. Plan digest

`digest = "sha256:" + sha256(canonicalJson(materialView(plan)))` reusing `Schemas.canonicalJson` (OD-03).

**Material (changing any of these changes the digest):** `version`; `manifestRef.version`; `manifestRef.digest`; `manifestRef.manifestRevision`; `role`; `targetOrigin`; `journey`; ordered `actions[]` with, per action: `actionId`, `action`, `routePath`, `locator` (normalised string), `check`, `attribute`, `value`, `classification`, `requiresApproval`, `assertionDeclarations`.

**Excluded (changing these must not change the digest, AC-030):** `generatedAt` and every timestamp; `runId`; worker and shard ids; absolute or host-specific paths; durations and timing; counters; report and artifact paths; dashboard event ids; provider id, model and telemetry; Falcon build revision; approval records; cookie, storage and header data of any kind (never present in the first place); log text.

Values: a `type`/`select` value is **material and stored literally**. It is not hashed, because a hash of a low-entropy field value offers no real protection and would hide drift. Credential literals are excluded structurally instead: `PlanFile.checkText` already rejects key-shaped values, and Phase 18 adds the same field-semantics screen used for the manifest. A plan that needs a secret references an env var.

Drift: at bind time the digest is recorded; before execution the material view is recomputed from the live page and compared. An unequal digest with the same plan file is `PLAN_DIGEST_MISMATCH`; an unequal material view derived from a changed target is `PLAN_DRIFT`, which requires a new review and invalidates every approval bound to the old digest — no approval is reused (AC-031, AC-032).

## 9. Approval store and binding

**Binding (OD-01).** `binding = canonicalJson({ planDigest, manifestVersion, manifestDigest, manifestRevision, role, targetOrigin, actionId, falconBuild })`, and `bindingId = sha256(binding)`. `falconBuild` is the release identifier (`package.json` version plus, when available, the git SHA from the existing `src/core/history/GitInfo`); using a release identifier instead of a raw SHA is permitted, but any change to policy semantics — manifest schema version, classifier lexicon version, or policy-engine version — is itself part of `falconBuild` as `policySemanticsVersion`, so approval is invalidated when policy semantics change even if the release identifier is reused.

Any field mismatch → `APPROVAL_MISMATCH` (AC-053). Unknown `planDigest` → `APPROVAL_UNKNOWN_PLAN` (AC-056). Approval granted before a manifest/plan change → `APPROVAL_STALE` (AC-054). Approval is run-scoped: a record carries `grantedForRunId`, and lookup in a different run fails `APPROVAL_STALE` (OD-02). Approver is an operator-supplied non-secret string (`--approver=` or `PILOT_APPROVER`); it is validated as printable ASCII, max 64 chars, and screened for secret shape. No SSO.

**Persistence.** `run/approvals/approvals.json` plus `run/approvals/audit.log`, both mode 0600, written through the existing `SafeFs.writeAtomicPrivate` pattern (temp file + `fsync` + `rename`). Replay protection survives restart because consumption is recorded durably *before* the action is dispatched: `consume` writes `state: "consumed"` with `consumedAt`, `runId` and a monotonic sequence number, flushes, then returns. A second `consume` of the same `bindingId` returns `APPROVAL_REPLAYED` whether or not the process restarted (AC-055).

**Audit history.** One append-only entry per grant, refusal and consumption: `{ seq, timestampIso, approver, bindingId, planDigest, actionId, role, decision, code }`. No cookie names, no tokens, no credential values, no CSRF tokens (AC-057).

**Integrity.** Each entry stores `prevHash` and `entryHash = sha256(prevHash + canonicalJson(entry))`; the store file records the head hash. `verify()` recomputes the chain at `open()`; a broken chain or an edited record yields `APPROVAL_HISTORY_TAMPERED`, and the run refuses with zero clicks (AC-058).

**Dashboard (Could, AC-059).** A read-only `GET /api/approvals` behind the existing token gate returning records with `approver`, `decision`, `bindingId`, `actionId`, `role`, timestamps and codes — never a plan value and never a secret. No mutation endpoint.

## 10. Secret-safe evidence boundary

One module, `evidence/EvidenceBoundary.js`. Every sink in `SINKS` must route through it: `Logger` (`info`/`warning`/`error`), `ReportManager` field writes, `Dashboard.emit`, run history, screenshot metadata, `locator/LocatorMemoryWriter`, `AIHealer/HealingReport`, `parallel/ShardBundle`, error serialisation, and `AIHealer` prompt construction.

Pipeline, in order: (1) known-value substitution — every value registered via `registerSecret` (cookie values, `Authorization` values, password env values, URL tokens, localStorage values, state-file contents) replaced with `[redacted]`, longest-first, on the raw string; (2) pattern redaction reusing `Schemas.SECRET_PATTERNS` and `Logger.redactUrlUserinfo`; (3) URL normalisation to origin+path via `storedUrl`; (4) control-character and ANSI stripping (AC-066); (5) length capping; (6) for the dashboard and reports, HTML-escaping so application text is inert (AC-066).

Enforcement, not convention:
- `assertClean` is called on every artifact immediately before write in debug/test mode; a hit throws `EVIDENCE_LEAK_DETECTED` and fails the run rather than writing.
- A unit test enumerates the modules that write to disk, stdout or the dashboard (by static scan of `fs.promises.write*`, `process.stdout`, `dashboard.emit` call sites) and asserts each imports `EvidenceBoundary`. A new sink that forgets the boundary fails CI.
- `ElementFactsCollector`'s existing attribute allow-list and value exclusion are asserted by test: no `input.value`, no cookie, no storage (AC-065).
- `ShardBundle` gains an explicit artifact allow-list; storage-state files, locator memory and healing evidence with application-derived identity are excluded by construction (OD-17, AC-022, AC-067).

**Canary strategy (AC-060..067).** The fixture seeds six distinct high-entropy canaries, one per channel: a cookie value, an `Authorization` header value, a password field value, a URL query token, a `localStorage` value, and an env credential. `CanaryRegistry` knows the six strings only inside the test harness. After each of five run shapes — execute, dry-run, failed login, expired session, shard — the suite greps every produced byte: all files under the run directory, the report, the dashboard events JSON and rendered HTML, the run history, the locator memory, the shard bundles, captured stdout and stderr, and the provider-prompt capture taken at the SDK transport boundary. Expected occurrences: zero, everywhere. The grep is on raw bytes and also on base64 and URL-encoded forms of each canary. An exception constructed with an `Authorization` value is thrown deliberately and its serialised form is scanned (AC-064).

## 11. Auth lifecycle state machine

States: `absent → imported | logged-in → active → (lost) → terminal`.

| From | Event | To | Code / effect |
|---|---|---|---|
| absent | `--auth-import` valid file | imported | record role, cookie count, earliest expiry, sha256 fingerprint only (AC-002) |
| absent | login-setup with env credentials, success | logged-in | write state 0600 under `run/auth/` (AC-003) |
| absent | login-setup, bad credentials | terminal | `AUTH_LOGIN_FAILED`; no new file; existing file untouched; password absent from all output (AC-004) |
| absent | authenticated role selected, no state | terminal | `AUTH_STATE_MISSING` before any target request (AC-006) |
| imported/logged-in | first navigation, marker present | active | zero login requests thereafter (AC-015) |
| active | landed on `loginRoute` | terminal | `AUTH_REDIRECT_TO_LOGIN`; later steps not counted; status never PASS (AC-007) |
| active | session cookie expired / 401 on allowed route | terminal | `AUTH_SESSION_EXPIRED` (AC-008) |
| active | no marker, no login redirect | terminal | `AUTH_UNEXPECTED_ANONYMOUS` (AC-009) |
| any | neither marker nor login route observable within `authTimeoutSeconds` | terminal | `AUTH_STATE_UNDETERMINED`; never classified authenticated (AC-010) |
| any | process exit, normal or failed, SIGINT, SIGTERM | cleaned | every per-run state copy deleted (AC-019) |

Loss at step k of N: steps k..N are recorded `not_executed`, authenticated coverage counts only steps `< k`, and the run status is not PASS (AC-011). "Inconclusive authentication evidence" is the human-readable form of `AUTH_STATE_UNDETERMINED` and appears with that code in output, report and dashboard event.

**Isolation.** `StateCopyPool.acquire` copies the source state into `run/auth/copies/<runId>/<role>-<workerId>.json` at 0600; the source file is opened read-only and its fingerprint re-checked after the run to prove it was not mutated (AC-017). Each Playwright context gets its own copy, so a cookie mutated by one worker is invisible to another (AC-018). Sequential runs carry only the selected role's state (AC-020). Worker mode honours per-test role assignment and must produce the same coverage set as sequential (AC-021). A shard with a missing state exits `AUTH_STATE_MISSING`, and the merged report shows lost coverage rather than a pass (AC-023). `BrowserManager.newContext(options)` is extended to accept `{ storageState }`; the no-argument call keeps today's behaviour.

## 12. Plan lifecycle state machine

`draft → reviewed → bound → executing → (completed | drifted | refused)`.

| From | Event | To | Code |
|---|---|---|---|
| — | dry-run writes plan v2 | draft | — |
| draft | operator review recorded (approver string + plan path) | reviewed | — |
| reviewed | digest computed and recorded with manifest revision | bound | — |
| bound | execute, recomputed digest equal | executing | — |
| bound | execute, plan file digest unequal | refused | `PLAN_DIGEST_MISMATCH` |
| bound/executing | live target material view differs | drifted | `PLAN_DRIFT`; all bound approvals invalidated |
| bound | plan has no version or digest in pilot execute mode | refused | `PLAN_INVALID` (`PLAN_NO_DIGEST`) |
| executing | all steps resolved | completed | — |

## 13. Approval lifecycle state machine

`proposed → approved | rejected → consumed | expired | revoked`.

| From | Event | To | Code |
|---|---|---|---|
| — | protected action with no record | — | `APPROVAL_REQUIRED` (AC-052) |
| — | operator proposes | proposed | — |
| proposed | decide approve | approved | — |
| proposed | decide reject | rejected | `APPROVAL_REQUIRED` at use |
| approved | binding matches, first use | consumed | audit entry |
| approved | binding mismatch | — | `APPROVAL_MISMATCH` |
| approved | different run / manifest or plan changed since grant | expired | `APPROVAL_STALE` |
| consumed | second use, same or new process | — | `APPROVAL_REPLAYED` |
| any | manifest denies the action | revoked | `POLICY_ACTION_DENIED` (deny beats approval, OD-18) |
| any | audit chain broken | — | `APPROVAL_HISTORY_TAMPERED` |

CSRF case (AC-051): an approved protected submit is executed with the token the page itself issued in-run; the token is registered with `EvidenceBoundary` as a secret before the submit, so it cannot reach any artifact. Unapproved: zero POSTs, because the refusal happens at policy step 7, before any dispatch.

## 14. Failure and result codes

Numeric exit codes are chosen not to collide with `0/1/2/3` (OD-10). Report field is `result.pilot.code`; dashboard event is `pilotRefusal` with `{ code, category, route, role, actionId }` — never a value.

| Code | Exit | Category |
|---|---|---|
| `MANIFEST_INVALID`, `MANIFEST_VERSION_UNSUPPORTED`, `MANIFEST_ROLE_UNKNOWN`, `MANIFEST_SECRET_LITERAL` | 10 | manifest |
| `AUTH_STATE_MISSING`, `AUTH_LOGIN_FAILED`, `AUTH_ROLE_REQUIRED` | 11 | auth setup |
| `AUTH_REDIRECT_TO_LOGIN`, `AUTH_SESSION_EXPIRED`, `AUTH_UNEXPECTED_ANONYMOUS`, `AUTH_STATE_UNDETERMINED` (inconclusive authentication evidence) | 12 | auth loss (distinct from 1 and 2, AC-013) |
| `POLICY_ORIGIN_DENIED`, `POLICY_ROUTE_DENIED`, `POLICY_BUDGET_EXCEEDED`, `POLICY_ACTION_DENIED` | 13 | policy |
| `APPROVAL_REQUIRED`, `APPROVAL_MISMATCH`, `APPROVAL_STALE`, `APPROVAL_REPLAYED`, `APPROVAL_UNKNOWN_PLAN`, `APPROVAL_HISTORY_TAMPERED` | 14 | approval |
| `PLAN_DIGEST_MISMATCH`, `PLAN_DRIFT` | 15 | plan binding |
| `PLAN_INVALID` | 2 | rejected input (unchanged from today) |
| `CONTROL_AMBIGUOUS` | 16 | identity |
| `EVIDENCE_LEAK_DETECTED`, `DRYRUN_PROVIDER_BLOCKED`, `DRYRUN_MUTATION_ATTEMPTED` | 17 | safety invariant |

`FailureCodes.CODES` is the single enum; a code outside it is a programming error that fails a unit test (AC-012). Every refusal emits through `Logger` and appears in exit output, report and dashboard event (AC-071).

## 15. Per-component failure behaviour, migration, rollback

| Component | On failure | Migration | Rollback |
|---|---|---|---|
| Manifest | refuse before any request; name the JSON path, never the value | new file, no legacy form | remove flag |
| PolicyEngine | refuse; never permit on internal error | none | remove flag |
| ActionClassifier | unknown signals → denied | lexicon version in `falconBuild` | revert lexicon, approvals invalidate |
| PlanDigest / PilotPlan | `PLAN_INVALID`/mismatch, exit before browser work where possible | v1 plans still read | v2 reader is additive |
| DryRun | abort request, count, refuse run | none | flag removal |
| ApprovalStore | unreadable or tampered store → refuse all protected actions | store created on first use | delete `run/approvals/`; protected actions then refuse |
| AuthStateStore / StateCopyPool | missing or unreadable state → `AUTH_STATE_MISSING`; cleanup always runs | import existing Playwright state files as-is | delete `run/auth/` |
| EvidenceBoundary | leak detected → fail the run, do not write | existing sinks keep working with stricter redaction | forward-only once dependents land |

## 16. Hermetic fixture (18F)

A local Node HTTP server on `127.0.0.1` with an ephemeral port, started and stopped by the test, serving: `/login` with a working credential pair and a failing pair; a short-lived session cookie for the expiry case; three roles (`administrator`, `customer`, `readonly`) with role-restricted pages that 403 or redirect; a CSRF-protected form requiring a per-session token; destructive controls (`Delete account`, `Pay now`, `Transfer funds`, `Publish`, `Send invoice`, `Submit order`, `Revoke token`, `Refund`, `Invite user`) varied across accessible name, visible text, `input[type]`, form action and destination URL; misleading labels ("Cancel" posting to `/account/delete`, "View" linking to `/orders/1/refund`); duplicate controls with identical names; a control replaced by JavaScript after load; a cross-origin link and a cross-origin form post to a second loopback port treated as a different origin; a protected submission endpoint; server-side mutation counters exposed at `/__counters`; a provider-request counter in the test harness; an oracle manifest listing the exact set of controls a correct dry-run must propose (AC-034); the six canaries. Zero non-loopback outbound requests (AC-073). The existing `fixture:serve` script pattern is reused.

## 17. Process lifecycle and cleanup

A single `PilotLifecycle` registry collects disposers: the browser, the fixture server, the dashboard, state copies, temp plan files. `SIGINT`, `SIGTERM`, `beforeExit` and the `finally` of the main IIFE all run `cleanupAll` once, idempotently, with a 5 s bound; `process.exitCode` is preserved rather than overwritten, matching the existing `ReportManager` reasoning. Signal handlers are installed once and removed on normal completion so tests do not leak listeners. Cleanup deletes every per-run auth copy even on a crash path (AC-019); the approval store and audit log are deliberately **not** deleted (they are the audit record) and are governed by retention instead.

Retention (AC-068, OD-14): `evidence/Retention.js` deletes artifacts under the run directory older than a documented default of **7 days**; the audit log is kept **90 days**. An on-demand purge command is deferred; the documented manual deletion steps cover it.

## 18. Architecture decision records

### ADR-0020 — Auth state is owned by Falcon, copied per (role, worker), and never shared.
Context: `BrowserManager` creates contexts with no storage state; parallel workers and shards share a process tree; a shared mutable state file would let one worker's cookie rotation break another and would make coverage claims unreliable. Decision: the operator-supplied state file is read-only input; every context receives a private 0600 copy under `run/auth/copies/<runId>/`, deleted deterministically at exit and on signals; only role, cookie count, earliest expiry and a sha256 fingerprint are ever recorded; cookie names are never recorded. Consequences: extra file copies per run (bounded by roles × workers); source-file immutability is provable by fingerprint; a crash leaves nothing because cleanup is signal-driven; operators must put state outside tracked source. Status: accepted.

### ADR-0021 — A mandatory manifest and a fixed policy order; deny beats everything.
Context: ad-hoc flags cannot express origin, route, role, budget and action policy coherently, and a reorderable policy chain is unauditable. Decision: a strict versioned manifest is mandatory for any pilot run; the evaluation order is validate → origin → route → role/auth → classify → deny → require-approval → plan digest → permit → healing/provider, fixed in code with no flag that reorders it; manifest denial overrides protection and approval. Consequences: a legitimate action can be blocked by a sloppy manifest, which is the intended direction of error; unauthenticated legacy runs are untouched; the schema needs a documentation-sync CI check. Status: accepted.

### ADR-0022 — SHA-256 over canonical JSON of an explicit material view; drift invalidates approvals.
Context: a reviewed plan must be provably the executed plan, but timestamps, run ids and host paths change every run. Decision: reuse `Schemas.canonicalJson`; hash an explicit `materialView` whose field list is code-owned and test-asserted; exclude all run-scoped metadata to a sibling meta file; recompute from the live page before execution and treat any difference as `PLAN_DRIFT`, invalidating every bound approval. Consequences: adding a material field is a breaking change that must bump `policySemanticsVersion`; false drift is possible on genuinely dynamic pages and is the safe failure; plan values are stored literally, so credential literals must be structurally prevented rather than hashed away. Status: accepted.

### ADR-0023 — Approval binds plan digest, manifest identity, role, origin, action ID and Falcon policy semantics; consumption is durable before dispatch.
Context: a narrow binding lets an approval be reused after a meaningful change; an in-memory consumption marker lets a restart replay it. Decision: the binding is the canonical JSON of all seven fields including `falconBuild` with an embedded `policySemanticsVersion`; records are written atomically and consumption is flushed to disk *before* the action is dispatched; the audit log is a hash-chained append-only file verified at open. Consequences: upgrading Falcon or changing the classifier lexicon invalidates outstanding approvals, which is intended; a crash between consumption and dispatch loses the action rather than repeating it, which is the correct bias; no shared multi-machine approval. Status: accepted.

### ADR-0024 — One evidence boundary, enforced by a sink inventory test.
Context: redaction already exists in four places (`Logger`, `Schemas`, `ShardBundle`, `ElementFactsCollector`) with different rules; divergence is how a leak appears. Decision: a single `EvidenceBoundary` performs known-value substitution, pattern redaction, URL normalisation, control/ANSI stripping, capping and escaping; every sink routes through it; a static-scan unit test fails CI when a writing module does not import it; six channel canaries are grepped across all persisted bytes after five run shapes. Consequences: a hot-path cost on every log and report field; one module becomes security-critical and needs careful review; application-derived secret text remains irreducible and is handled by known-value redaction plus documentation. Status: accepted.

### ADR-0025 — Dry-run safety is structural, not policy-checked.
Context: a dry-run that merely declines to click can still mutate through page script, downloads or a healing provider call. Decision: context-level request interception installed before any navigation aborts every non-GET and every non-allow-listed origin; the page object exposed to discovery is a proxy without mutating methods, so a mutation is a `TypeError`; downloads are disabled; no provider is constructed and a transport-level guard throws if one is reached; counters are asserted zero and written to the report. Consequences: some discovery techniques needing `evaluate` are unavailable in dry-run; interception adds latency to every request; two independent provider blocks are redundant on purpose. Status: accepted.

### ADR-0026 — A closed failure-code enum mapped to new exit codes 10–17.
Context: today only 0/1/2/3 exist, and auth loss must be distinguishable from a test failure and from a config error. Decision: one frozen enum in `FailureCodes.js` maps each code to a numeric exit code in 10–17, a report field and a dashboard event name; `PLAN_INVALID` keeps exit 2 for backward compatibility; a code outside the enum fails a unit test; every refusal goes through `Logger`. Consequences: CI consumers must learn new codes; the ranges are coarse by design so that adding a code inside a category does not change an exit contract; documentation and the enum are kept in sync by a CI check. Status: accepted.

## 19. Traceability (P18-AC-001..082)

Verification types: U = unit, R = regression (hermetic fixture), I = integration/CI job, S = static/CI check, D = doc check.

| AC | Component | Verif |
|---|---|---|
| 001 | AuthStateStore.exportState, EvidenceBoundary | R + canary |
| 002 | AuthStateStore.importState | U, R |
| 003 | LoginSetup, AuthStateStore (0600) | R |
| 004 | LoginSetup, FailureCodes(AUTH_LOGIN_FAILED), EvidenceBoundary | R |
| 005 | Manifest secret-literal screen (OD-15) | U, R |
| 006 | PolicyEngine step 4, AuthStateStore | R |
| 007 | AuthEvidence, ReportManager coverage | R |
| 008 | AuthEvidence | R |
| 009 | AuthEvidence | R |
| 010 | AuthEvidence (fail closed), fixture oracle | R |
| 011 | AuthEvidence + ReportManager step marking | R |
| 012 | FailureCodes enum | U, S, D |
| 013 | FailureCodes.exitCodeFor (12 vs 1/2) | U, R |
| 014 | PolicyEngine AUTH_ROLE_REQUIRED, Manifest anonymous role | R |
| 015 | AuthEvidence + fixture login-request counter | R |
| 016 | Manifest roles + PolicyEngine route/role | R |
| 017 | StateCopyPool + source fingerprint | U, R |
| 018 | StateCopyPool per-context copies | R |
| 019 | PilotLifecycle cleanup (exit + signals) | U, R |
| 020 | StateCopyPool sequential path | R |
| 021 | parallel/Runner role assignment; coverage equality | R, I |
| 022 | ShardBundle allow-list (OD-17) | U, R + canary |
| 023 | parallel shard auth check + ShardMerge | R |
| 024 | Manifest MANIFEST_ROLE_UNKNOWN | U, R |
| 025 | DryRunGuard counters | R |
| 026 | DryRunGuard interception | R |
| 027 | DryRun no-provider path + transport guard | R |
| 028 | DryRun fingerprint/checksum compare | R |
| 029 | PilotPlan deterministic serialisation | R |
| 030 | PlanDigest material/excluded lists | U |
| 031 | PolicyEngine step 8 | R |
| 032 | PlanDigest drift + ApprovalStore invalidation | R |
| 033 | PilotPlan v2 reader — **see BLOCKER-1** | U, R |
| 034 | DryRun vs fixture oracle manifest | R |
| 035 (S) | Plan row policy outcome + summary counts | U, R |
| 036 | ManifestSchema strict | U |
| 037 | ManifestSchema version | U |
| 038 | docs/pilot/manifest-reference.md sync check | S |
| 039 | PolicyEngine step 2 (incl. subresources, OD-08) | R |
| 040 | PolicyEngine step 3 | R |
| 041 | Budget enforcement | R |
| 042 | ActionClassifier matrix | U, R |
| 043 | ActionClassifier any-destructive-signal rule | U, R |
| 044 | Vocabulary from manifest | U, R |
| 045 | applyProviderAdvice monotonic | U, R |
| 046 | PolicyEngine provider-absent path | U, R |
| 047 | AIHealer entry guard (`policyOutcome === "permit"`) | U, R |
| 048 | PolicyEngine step 6 before step 7 | U, R |
| 049 | ActionClassifier ambiguity, CONTROL_AMBIGUOUS | R |
| 050 (S) | Manifest artifacts policy | R |
| 051 | ApprovalStore + CSRF fixture + EvidenceBoundary | R |
| 052 | PolicyEngine step 7 | R |
| 053 | approval/Binding | U, R |
| 054 | ApprovalStore staleness | U, R |
| 055 | ApprovalStore durable consumption across restart | R |
| 056 | ApprovalStore lookup | U |
| 057 | AuditLog entry shape | U, R |
| 058 (S) | AuditLog hash chain + verify() | U, R |
| 059 (C) | Dashboard read-only approvals view | R — **OPEN-2: Could, descoped unless budget allows** |
| 060 | EvidenceBoundary + CanaryRegistry, 5 run shapes | R |
| 061 | EvidenceBoundary on stdout/stderr | R |
| 062 | Dashboard events + HTML escaping | R |
| 063 | provider-prompt capture at SDK transport boundary | R |
| 064 | error serialisation through boundary | U, R |
| 065 | ElementFactsCollector + HealingReport | U, R |
| 066 | HTML escaping + ANSI/control stripping | U, R |
| 067 | ShardBundle allow-list | U, R |
| 068 (S) | Retention.js + docs | U, D |
| 069 | docs/pilot/retention.md | D |
| 070 (C) | purge command — **deferred by OD-14; not a Must** | — |
| 071 | FailureCodes + Logger on every refusal | U, R, S |
| 072 (S) | CI timing gate — **OPEN-1: number after measurement (OD-13)** | I |
| 073 | fixture loopback-only assertion | R |
| 074 | CI job: skip or expected-fail fails the job | I, S |
| 075 | CI grep asserting no GoogleSearchTest invocation | S |
| 076 | baseline comparison vs `2572e73` exit codes and reports | R, I |
| 077 | `npm run test:pilot` called by ci.yml | S, I |
| 078 | docs prohibited-phrase check | S, D |
| 079 (S) | operator guide commands executed on fixture | R |
| 080 | `.env.example` blank-value check | S |
| 081 (C) | ManifestSchema.exportJsonSchema + `schemas/pilot-manifest.v1.json` | U |
| 082 | release-candidate CI run, every Must green, no open P0/P1 | I |

Flags: **BLOCKER-1** (AC-033 vs AC-076, section A §6 — owner must confirm scoping). **OPEN-1** (AC-072 budget number requires measurement first, protocol in Section E). **OPEN-2** (AC-059 Could; AC-070 deferred by OD-14; AC-035/050/058/068/072/079 are Should and are included but are the first to descope if the budget runs out — none of them is a Must).

No Must criterion is unsatisfiable as written, with the single exception recorded as BLOCKER-1.

## 20. Resolved parameters


**OD-03 — digest.** SHA-256 over `Schemas.canonicalJson(materialView(plan))`, output `"sha256:<64 hex>"`. Material: `version`, `manifestRef.{version,digest,manifestRevision}`, `role`, `targetOrigin`, `journey`, and per action `actionId`, `action`, `routePath`, `locator`, `check`, `attribute`, `value`, `classification`, `requiresApproval`, `assertionDeclarations`. Excluded: all timestamps, `runId`, worker/shard ids, absolute and host paths, durations, counters, artifact and report paths, dashboard event ids, provider id/model/telemetry, Falcon build revision, approval records, log text, and anything credential-bearing (never present). Manifest revision digest uses the same construction over the normalised manifest.

**OD-04 — numeric defaults and hard maxima** (conservative; authenticated runs touch real staging data, so each default is roughly half the existing unauthenticated default and every maximum is bounded to keep CI deterministic).

| Parameter | Default | Hard max | Justification |
|---|---|---|---|
| `budgets.maxPages` | 10 | 100 | half today's `--max-pages=20`; 100 keeps a sweep inside the run budget |
| `budgets.maxActionsPerPage` | 25 | 200 | 200 matches `PlanFile.MAX_SCENARIOS`, so a plan can always be serialised |
| `budgets.runSeconds` | 300 | 1800 | half today's `--budget-ms=600000`; 30 min is the longest a run-scoped approval may plausibly stay open |
| `budgets.authTimeoutSeconds` | 15 | 60 | long enough for a slow staging login, short enough that `AUTH_STATE_UNDETERMINED` is reached promptly |
| approval wall-clock cap | 1800 s | 1800 s | equals the run-budget max; prevents an indefinitely long run from holding a stale approval |
| artifact retention | 7 days | — | documented default (AC-068) |
| audit-log retention | 90 days | — | audit value outlives artifacts |

Any manifest value above the hard max is `MANIFEST_INVALID`; each maximum has a max and max+1 test, matching the Phase 16 convention.

**OD-10 — exit codes.** 10 manifest, 11 auth setup, 12 auth loss, 13 policy, 14 approval, 15 plan binding, 16 identity, 17 safety invariant. `PLAN_INVALID` stays 2. 0/1/2/3 keep today's meanings.

**OD-12 — npm script and CI gate.** New scripts: `test:pilot` (the whole Phase 18 matrix: unit + regression + fixture integration, Chromium only, `--forbid-only --forbid-skip` semantics), `test:pilot:fixture` (serve the fixture for manual work, mirroring `fixture:serve`), `pilot:schema` (write `schemas/pilot-manifest.v1.json` and fail on drift). New CI job `pilot` in `.github/workflows/ci.yml`, Node 24, `npm ci`, `npm run pilot:schema`, `npm run test:pilot`, plus a step that fails the job if the test output reports any skipped or expected-failure test, plus the docs/`.env.example`/no-GoogleSearchTest static checks. `pilot` is a required check; `test:pilot` is the only entry point, so AC-077 holds by construction.

**OD-13 — dry-run budget measurement protocol.** On a clean GitHub-hosted `ubuntu-latest` Node 24 runner, run the hermetic dry-run against the fixture **10 times** in a single job with no other job on the runner, discarding the first run as warm-up. Record wall-clock milliseconds for the dry-run phase only (fixture start to plan written). Take p95 of the 9 remaining samples. Budget = `ceil(p95 × 1.5 / 10 s) × 10 s`, with a **hard upper bound of 180 s**; if the computed budget would exceed 180 s, the design is too slow and must be optimised rather than the budget raised. Re-measure whenever the fixture or the discovery path changes materially. The number is intentionally absent from this document until the measurement exists (OPEN-1).
