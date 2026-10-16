# Phase 18 — Authenticated Pilots

Status: **DRAFT rev 2 plus the normative [rev 3 patch](phase-18-rev3-patch.md) [rev 4 patch](phase-18-rev4-patch.md) and [rev 5 patch](phase-18-rev5-patch.md) and [rev 6 patch](phase-18-rev6-patch.md) and [rev 7 patch](phase-18-rev7-patch.md) and [rev 8 patch](phase-18-rev8-patch.md), [rev 9 patch](phase-18-rev9-patch.md) and [rev 10 patch](phase-18-rev10-patch.md)** (rev 8 folds in the owner decisions OWNER-01..OWNER-07; see also [the decision traceability](../phase-18-decision-traceability.md)) (the rev 4 shard-refusal decision is replaced by rev 5), pending SEC-08 review of the rev 8 delta. The owner has decided BLOCKER-1, OD-17-Q1, OD-20 to OD-24 and the residual dispositions (policy direction only; no implementation, merge or publication is authorised); OD-24-Q1 and OD-20-Q1 remain open. Where the patches conflict with the text below, the later patch wins.

## 1. Context and constraints

Status: **DRAFT rev 2**, revised to close SEC-02. Pending the owner decision on BLOCKER-1 in [the plan](../phase-18-plan.md) and on the residual risks in section 6 of [the threat model](../security/phase-18-threat-model.md). Designed against `e589247`; code facts re-verified against the same tree.

Verified code facts this design is built on:

- Exit codes in use today are only `0`, `1` (test failure / config error / fatal), `2` (rejected input), `3` (merge state not durable — `falcon.js:558`, `src/core/parallel/Runner.js:80`). `ReportManager.js:283` sets `process.exitCode = overallResult === "PASSED" ? 0 : 1`.
- `src/core/parallel/Schemas.js:36-39` has `canonicalJson` (sorted keys, `JSON.stringify` leaves). It is consumed by `StateJournal.js:65`, `ShardMerge.js:229`, `Reducers.js:81,296`, `Planning.js:42` and `ParallelSweep.js:24`, so **its semantics are frozen**: changing it in place would alter Phase 16 digests. Phase 18 therefore does **not** reuse it for any Phase 18 digest (section 8, ADR-0027).
- `src/core/parallel/SafeFs.js:103-154` `readBoundedJson` already does `lstat` (refuses symlink and non-regular), `open(O_RDONLY|O_NOFOLLOW)`, `fstat`, same-fd bounded reads, fatal UTF-8 decode, depth scan and key screening, and **returns `{ok:false,code}` rather than throwing**. It does **not** check owner uid, `nlink` or mode. `writeAtomicPrivate` (`:161-184`) does temp-`wx`-0600 + `fh.sync()` + `rename` but **no directory fsync**. Section 2a extends both.
- `src/core/AIHealer/AIHealer.js` has four `_performAction` call sites (`:337` inside `this._retry.execute`, `:419` free-text Tier 3 locator, `:586`, `:652`); `_performAction` itself clicks with `await this.page.click(selector)` (`:368`), which re-queries and takes the first match.
- `src/core/ClickExplorer.js:75-88` `clickElement` does `page.click(element.selector)` and falls back to `page.getByText(element.text,{exact:true}).first().click()`; it is called from `ClickExplorer.js:121`, SiteSweep, ParallelDiscovery and `falcon.js`.
- `playwright.config.js` sets `screenshot: "only-on-failure"`, `video: "retain-on-failure"`, `retries: process.env.CI ? 1 : 0`, `testIgnore: ["**/regression/**","**/demo/**"]`.
- `src/core/PlanFile.js:96` screens plan text only with `isKeyShapedValue`; `:175` and `:219` use `fs.promises.stat`, which follows symlinks.
- `utils/Logger.js` redacts URL userinfo, `Authorization`, bearer tokens, `token=`/`password=` and strips control characters. It is an implementation, not a boundary.
- `src/core/locator/ElementFactsCollector.js` uses a fixed attribute allow-list and excludes input values, passwords, cookies and storage.
- `BrowserManager.newContext()` takes no options today. `Dashboard.js` is token-gated and loopback-default.

Constraints: deterministic CI; CommonJS; Node >= 22 (CI 24); no raw `console.log`; `fs.promises` on hot paths; provider access only through the SDK/provider registry with lazy init and a missing-key fallback; meaningful exit codes tested directly; no uncontrolled third-party sites in CI; Chromium only (OD-19).

**Fail-closed principle (E01).** Every Phase 18 refusal path is reached by *absence of an explicit permit*, never by a check returning false. Any internal error, thrown exception or rejected promise inside manifest loading, digesting, policy evaluation, auth classification, the action gate, the network gate, the approval store or the evidence boundary results in refusal with `PILOT_INTERNAL_ERROR` (exit 18) and zero clicks and zero non-GET requests. In particular, if `EvidenceBoundary.sanitize` or `assertClean` throws, **nothing is written** for that sink and the run refuses.

## 2. Module layout

```
src/core/pilot/
  FailureCodes.js            enum, numeric exit codes, report field, dashboard event
  Digest.js                  strict canonicaliser + domain-separated digests (ADR-0027)
  JsonStrict.js              duplicate-key-aware parser used by Digest and all loaders
  PilotRoots.js              fixed, non-configurable roots (auth, approvals, plans)
  Manifest.js                load, validate, normalise, revision digest
  ManifestSchema.js          strict schema; JSON Schema export (AC-081)
  Vocabulary.js              built-in destructive lexicon + manifest terms + confusable folding
  ActionClassifier.js        deterministic signal -> classification
  PolicyEngine.js            the ordered evaluation
  PilotActionGate.js         the single pre-click choke point (ADR-0028)
  NetworkGate.js             execute-mode request/redirect/WebSocket gate (ADR-0029)
  RouteMatch.js              route canonicalisation + fail-closed deny matching (N4)
  PlanDigest.js              material/excluded views over Digest
  PilotPlan.js               plan v2 document, actionId derivation, value references
  DryRun.js                  dry-run context construction and counters
  DryRunGuard.js             read-only page proxy + sink refusals
  BuildIdentity.js           falconBuild: git sha or source digest, never unknown (ADR-0034)
  auth/AuthRole.js           role model from the manifest
  auth/AuthStateStore.js     storageState import/export, 0600, fingerprints
  auth/LoginSetup.js         env-referenced credential login, exact selectors only (N7)
  auth/AuthEvidence.js       authenticated / anonymous / undetermined
  auth/StateCopyPool.js      per-(role,worker) copies, deterministic cleanup
  approval/ApprovalStore.js  durable store, exclusive consume markers, replay protection
  approval/ApprovalRecord.js record shape and binding
  approval/Binding.js        binding computation and comparison
  approval/RunToken.js       minted runId+nonce, used-runId ledger (ADR-0032)
  approval/AuditLog.js       append-only segments, hash chain, anchors (ADR-0033)
  evidence/EvidenceBoundary.js  the single sink gate
  evidence/SecretRegistry.js    known-value registration incl. encoded forms (L01)
  evidence/CanaryRegistry.js    test-only canary seeding and scanning
  evidence/Retention.js         segment-aware cleanup, lstat-only, confined (AC-068)
```

Edited existing files are listed per PR in the plan. Nothing in `src/core/pilot/` is imported by a non-pilot code path except `FailureCodes` (exit-code table), `EvidenceBoundary` (from the existing sinks) and `PilotActionGate` (from `AIHealer` and `ClickExplorer`, which in non-pilot mode call a pass-through gate that is the `2572e73` behaviour, AC-076).

### 2a. Extensions to existing security primitives

**`SafeFs` (owned by 18E, additive, no behaviour change for existing callers).** Three new exports:

- `readBoundedPrivateJson(file, { maxBytes, maxDepth, root, requireMode, requireOwner, parse })` — everything `readBoundedJson` already does, plus, on the open fd: owner uid equals `process.getuid()` (`READ_FOREIGN_OWNER`), `st.nlink === 1` (`READ_HARDLINKED`), and when `requireMode` is given, `(st.mode & 0o777) === requireMode` (`READ_MODE_UNSAFE`); plus `resolveUnder(root, ...)` applied to the path and an `lstat` of **every** parent component under `root` refusing symlinks (`READ_PATH_SYMLINK`); plus optional `parse: JsonStrict.parse` for duplicate-key rejection. Return shape stays `{ok, code, value, bytes, sha256}`; it never throws, so callers must treat `ok === false` as refusal. On Windows the uid/mode/`O_NOFOLLOW` checks are unavailable: pilot mode on `win32` is refused `PILOT_INTERNAL_ERROR` (Chromium-on-Linux/macOS only in Phase 18, consistent with OD-19 scope).
- `writeAtomicPrivateSynced(file, content)` — `writeAtomicPrivate` plus an `fsync` of the containing directory after the rename (F02, P02).
- `createExclusive(file, content)` — `open(file, "wx", 0o600)`, write, `fh.sync()`, close, directory `fsync`. `EEXIST` is returned as `{ok:false, code:"EXISTS"}` and is the primitive for approval consume markers.

**`PilotRoots` (fixed, not operator-configurable — confused deputy).** `authRoot = <repoRoot>/run/auth`, `approvalsRoot = <repoRoot>/run/approvals`, `plansRoot = <repoRoot>/run/plans`, `copiesRoot = <authRoot>/copies`, where `repoRoot` is derived once from `path.join(__dirname, "..", "..", "..")` and verified to contain `package.json` with `"name": "falcon-automation"`; otherwise `PILOT_INTERNAL_ERROR`. No flag, env var or manifest key can move any root. Every path that reaches these roots is produced by `SafeFs.resolveUnder(root, ...)`; a manifest `stateFile`, an `--auth-import` source, an export path or an approvals directory that does not resolve under its root is refused (`MANIFEST_INVALID` naming the JSON path for manifest inputs, `AUTH_STATE_MISSING` for CLI inputs), closing N3. `--auth-import` may read from outside the root (it is operator input) but only through `readBoundedPrivateJson` with `requireMode: 0o600`, and the imported copy is written under `authRoot`.

## 3. Interfaces

```js
// FailureCodes.js
module.exports = { CODES, exitCodeFor(code), reportFieldFor(code),
                   dashboardEventFor(code), isKnown(code) };

// Digest.js  (ADR-0027)  — never reuses Schemas.canonicalJson
const DOMAINS = ["plan-v1","manifest-v1","approval-v1","action-v1","state-v1","audit-v1"];
function canonicalise(value)              // JCS-strict text; throws DigestError on reject
function digest(domain, value)            // -> "sha256:<64 hex>" over (domain + "\u0000" + canonicalise(value))
function digestBytes(domain, buf)         // for opaque file content (state fingerprints)
class DigestError extends Error {}        // { code: "DIGEST_INPUT_INVALID", path }

// JsonStrict.js
function parse(text, { maxDepth, maxBytes })  // duplicate keys, lone surrogates,
                                              // non-NFC material strings, __proto__ -> throw

// PilotRoots.js
module.exports = { repoRoot, authRoot, approvalsRoot, plansRoot, copiesRoot, assertUnder(root, p) };

// PilotActionGate.js  (ADR-0028) — the only path to a mutating interaction in pilot mode
async function perform(ctx, { handle, action, value, source })
// ctx: { manifest, role, page, boundary, policy, approvalArm, planRow, runToken }
// source: "healer-tier1"|"healer-tier2"|"healer-tier3"|"healer-direct"|"plan"|"explorer"|"sweep"
// -> { ok: true, evidence } | { ok: false, code }
function passthrough()                     // non-pilot mode: calls the legacy path unchanged
async function verifyIdentity(handle, approvedIdentity)  // one evaluate, no re-query
async function arm(ctx, approvedAction)    // arms NetworkGate for exactly one dispatch
function disarm(ctx)

// NetworkGate.js  (ADR-0029)
async function install(context, { mode, manifest, boundary })  // mode: "dry-run"|"execute"
function armed(gate)                       // -> { method, origin, path } | null
async function validateRedirectChain(gate, request)   // fallback path for SPIKE-R
const MAX_REDIRECTS = 10;

// RouteMatch.js  (N4)
function canonicalPath(rawPath)            // -> { ok, path } ; fail closed on ambiguity
function decide(manifestRoutes, canonicalPath, { method })  // -> "allowed"|"denied"
                                           // denied wins; unmatched is denied; undecodable is denied

// BuildIdentity.js  (ADR-0034)
function falconBuild()  // -> { packageVersion, policySemanticsVersion,
                        //      vcs: { kind: "git", sha } | { kind: "source", digest } }
                        // throws PilotInternalError if neither is determinate

// Manifest.js
async function load(file)                 // -> { ok, manifest, code, path }
function normalise(doc); function revision(manifest); function exportJsonSchema()

// ActionClassifier.js
function classify(signals, vocabulary)
// signals: { accessibleName, visibleText, role, inputType, autocomplete, title, ariaLabel,
//            ariaDescription, formAction, formMethod, destinationUrl, method,
//            duplicateCount, identityStable }   // NOTE: `ordinal` removed (B04)
// -> { classification, reasons: [{ signal, term, weight }] }

// PolicyEngine.js
function evaluate(ctx)  // -> { outcome, code, actionId, approvedIdentity }
function applyProviderAdvice(result, advice)   // may raise caution only (AC-045)

// PlanDigest.js
function digest(planV2); function materialView(planV2);
const MATERIAL_FIELDS, EXCLUDED_FIELDS;

// ApprovalStore.js
async function open({ root })                     // root is PilotRoots.approvalsRoot; verifies chain + anchors
async function propose(store, binding, { approver })   // -> { approvalId, state: "proposed" }
async function decide(store, approvalId, decision, { approver })
async function mintRunToken(store, approvalId)    // -> { runId, nonce }  (ADR-0032)
async function consume(store, approvalId, { runToken })  // exclusive marker; -> ok | code
async function lookup(store, binding)             // exact binding match only
async function verify(store)                      // -> { ok, code } (AC-058)

// RunToken.js
function format(token); function parse(text);     // "<runId>.<nonce>" base64url, 128 bits each
async function claim(store, runId)                // exclusive marker in runtokens/used/

// AuthStateStore.js
async function importState(file, { role })  // -> { role, cookieCount, earliestExpiry, fingerprint }
async function exportState(context, file)   // 0600, under PilotRoots.authRoot only
async function fingerprint(file)            // Digest.digestBytes("state-v1", bytes)

// AuthEvidence.js / StateCopyPool.js — unchanged from rev 1.

// EvidenceBoundary.js
function beginRun({ runId, mode })        // -> boundary (mode is per-boundary, not process-wide, N8)
function registerSecret(boundary, value, { kind })   // registers all encoded forms (L01)
function sanitize(boundary, value, { sink })
function sanitizeObject(boundary, obj, { sink, allowList })   // redacts keys as well as values
function assertClean(boundary, text, { sink })       // ALWAYS on, every mode (N6)
const MATERIAL_SINKS = ["planFile", "approvalAudit"];   // assertClean-refusal only, never substitution (N5)
const SINKS = ["log","report","dashboard","runHistory","locatorMemory","healingEvidence",
               "shardBundle","error","providerPrompt","screenshotMetadata",
               "approvalAudit","planFile","stderr","stdout"];
```

Ownership: manifest/policy/classifier/route/network gate 18C; auth 18A; digest/plan/dry-run/action gate 18B (gate interface stubbed by 18E so `AIHealer`/`ClickExplorer` edits land once); approval 18D; boundary, codes, `Digest`, `JsonStrict`, `PilotRoots`, `SafeFs` extension 18E.

## 4. Manifest schema v1

Strict: unknown keys at any depth are rejected `MANIFEST_INVALID` naming the JSON path, before any target request (AC-036). Unsupported `version` → `MANIFEST_VERSION_UNSUPPORTED` (AC-037). The file is read with `SafeFs.readBoundedPrivateJson` (`maxBytes: 64 * 1024`, `maxDepth: 8`, `parse: JsonStrict.parse`), so a symlinked, foreign-owned, hard-linked, duplicate-keyed, non-UTF-8 or oversized manifest is refused before parsing semantics (F01). Whole-file 64 KiB cap applies **before** the secret-literal screen (L07).

Document shape as rev 1, with these changes:

- `roles[].stateFile` is a **relative** path only, resolved via `SafeFs.resolveUnder(PilotRoots.authRoot, ...)`. An absolute path, any `..`, or a path escaping `authRoot` is `MANIFEST_INVALID` (N3).
- `baseUrl` and every entry of `allowedOrigins`/`allowedSubresourceOrigins` are rejected if they carry userinfo (`https://u:p@host`), a non-`https`/`http` scheme, a path, a query or a fragment (L07). `targetOrigin` everywhere in Phase 18 means the **WHATWG serialised origin** (`scheme://host[:port]`, default port omitted), so `http://localhost:3000` and `http://127.0.0.1:3000` are different origins and never match (P01).
- `artifacts` is restricted for any `authenticated: true` role (L03): `screenshots` defaults to `"none"`; `traces` accepts **only** `"none"`; `video`, `har` and `domSnapshots` accept only `"none"` and are structurally off regardless (section 7a). `"on-failure"` screenshots require non-empty `maskSelectors` **and** non-empty `screenshotRoutes`, else `MANIFEST_INVALID` (OD-05, AC-050). Independently of `maskSelectors`, every `input[type=password]` and every credential-semantic input (section 8a) is masked.
- `credentials` accepts only `*Env` keys, and the named env var must exist and be non-empty at manifest load, else `AUTH_LOGIN_FAILED` before any request.
- The secret-literal screen is unchanged in intent (OD-15, AC-005) and additionally applies the section 8a credential-semantic rule to `assertions[].locator` values and `vocabulary` terms.
- `git check-ignore` is run against the resolved `stateFile` and against any `--save-state` target; a path that is **not** ignored is refused `MANIFEST_INVALID` / `AUTH_STATE_MISSING`. If `git` is unavailable the check **fails closed** and refuses (L08). (`.gitignore` gains `run/auth/` and `run/approvals/` in the plan, so the normal case passes.)

Canonical normalisation (before hashing and before any comparison) as rev 1, plus: manifest strings are **NFC-normalised as a recorded policy** and the normalisation is applied *before* the digest, so the digest is of the normalised form; a manifest string that is not already NFC is accepted and normalised, and the fact is recorded in `manifestRef.normalised: true`. Plan **material** strings are not normalised — a non-NFC plan material string is refused `DIGEST_INPUT_INVALID` (D01).

Manifest is mandatory whenever a run selects a role or uses any pilot flag (OD-07). With no pilot flags at all nothing in this section executes (AC-076).

## 5. Policy evaluation order

Exactly this order, short-circuiting on the first non-permit, with no reordering under any flag. Steps 1–9 are *plan-level or navigation-level*; steps 10–12 run **per protected or permitted interaction, immediately before dispatch**, inside `PilotActionGate.perform` (B01, P03).

1. **Validate manifest** — schema, version, strict parse, normalisation, size cap, secret-literal screen, root confinement, ignore check. Fail: `MANIFEST_INVALID` / `MANIFEST_VERSION_UNSUPPORTED` / `MANIFEST_SECRET_LITERAL` / `MANIFEST_ROLE_UNKNOWN`. Zero target requests.
2. **Origin** — navigation or submission target origin in `allowedOrigins`; subresource origin in `allowedSubresourceOrigins` (OD-08). Fail: `POLICY_ORIGIN_DENIED`.
3. **Route** — `RouteMatch.decide`: denied patterns beat allowed; unmatched is denied; an undecodable or ambiguous path is denied. Fail: `POLICY_ROUTE_DENIED`. Evaluated before any interaction (AC-040).
4. **Role / auth** — role known; state present; auth evidence classified. Fail: `AUTH_*` as rev 1.
5. **Classify action** — `ActionClassifier.classify` on deterministic signals only.
6. **Deny** — manifest `actions.denied` or classifier `denied`. Fail: `POLICY_ACTION_DENIED`. Deny overrides protection *and* approval (OD-18, AC-048); no approval is consulted, no gate is armed.
7. **Require approval for protected** — look up an approval on exact binding match; validate the presented run token (section 9) and the TTL. Fail: `APPROVAL_REQUIRED` / `APPROVAL_MISMATCH` / `APPROVAL_STALE` / `APPROVAL_REPLAYED` / `APPROVAL_UNKNOWN_PLAN` / `APPROVAL_RUN_TOKEN_INVALID` / `APPROVAL_HISTORY_TAMPERED`.
8. **Validate plan digest** — recompute the plan-file material view and compare. Fail: `PLAN_DIGEST_MISMATCH`.
9. **Provisional permit** — outcome and reason recorded on the plan row (AC-035).
10. **Resolve exactly one element** — `locator.count()` must be `1` (`strictSelectors: true` on every pilot context). `0` or `>1` → `CONTROL_AMBIGUOUS`, or `PLAN_DRIFT` when a bound plan exists. Take the `ElementHandle` and hold it.
11. **Verify live identity on that handle** — one `evaluate` on the held handle returns `{ role, accessibleName, visibleText, inputType, autocomplete, formAction, formMethod, resolvedHref, resolvedOrigin, disabled, visible }`. Recompute `actionId` from it and compare with `approvedIdentity` (for protected) or with the planned identity (for permitted). Any difference → `PLAN_DRIFT`, zero clicks. **After this point there is no re-query, no healing, no retry and no selector string**: the click is dispatched on the held handle only.
12. **Arm and dispatch** — for a protected action, `ApprovalStore.consume` succeeds durably first (section 9), then `PilotActionGate.arm` arms `NetworkGate` for exactly one `{method, origin, path}`, then the handle is clicked, then `disarm` runs in a `finally`. For a permitted action the gate arms nothing, so any non-GET the click provokes is aborted (N1).

Healing and provider involvement are entered **only** for a step whose action reached step 9 as `permit`, and the healed candidate re-enters steps 10–12 before any click; the healer's own click path is replaced by the gate (section 5a). For a protected or denied action `AIHealer` is never entered, so no provider prompt is constructed (AC-047); enforced both by the existing entry guard (`policyOutcome === "permit"`) and by the gate, which refuses `source: "healer-*"` when `policy.outcome !== "permit"`.

Budgets (`POLICY_BUDGET_EXCEEDED`, AC-041) are checked at step 3 for page count, continuously by a monotonic deadline, and additionally per page: at most `maxActionsPerPage` controls collected, at most 256 KiB of extracted DOM text per page, at most `MAX_REDIRECTS = 10` hops per navigation, at most 1 MiB of approval ledger and 1 MiB of plan file (S01).

Provider advice is applied only to the output of step 5 via `applyProviderAdvice`, which can raise `permitted → protected` or `protected → denied` and can never lower (AC-045). Provider absent, erroring or out of budget yields the deterministic result unchanged; there is no default permit (AC-046). The Tier 3 free-text locator (`AIHealer.js:419`) is never executed in pilot mode, and in pilot mode the provider may only select from a policy-filtered index set of already-collected, already-permitted candidates (B05).

### 5a. The single choke point (B01)

`PilotActionGate.perform` is the only function in Falcon that may dispatch `click`, `fill`, `type`, `press`, `check`, `selectOption`, `setInputFiles`, `tap`, `dragTo` or `dispatchEvent` while pilot mode is active. Call-site changes:

- `src/core/AIHealer/AIHealer.js:362` `_performAction(action, selector, value)` gains a pilot branch: when `this._pilot` is set it refuses to accept a *selector string*. All four call sites (`:337`, `:419`, `:586`, `:652`) are rewritten to resolve a handle and call `PilotActionGate.perform({handle, action, value, source})`, which runs policy steps 10–12 on the **healed** candidate's live signals, not on the original step. The `:337` site stays inside `this._retry.execute`, but the gate records a one-shot token per `(planRow, attempt)`: a retry that re-enters after a successful identity verification is refused `PLAN_DRIFT` rather than re-verifying and re-clicking (P03 negative test "Tier 1 retry not re-entered"). `:419` (Tier 3 free text) is refused outright in pilot mode.
- `src/core/ClickExplorer.js:75-88` `clickElement` and its `getByText(...).first().click()` fallback **cannot** satisfy steps 10–11: the fallback is explicitly a first-of-many text match, and the explorer clicks every `a` and `button` without a reviewed plan row. **Decision: in pilot mode `ClickExplorer.clickElement`, `SiteSweep` and `ParallelDiscovery`'s click path are refused, not routed through the gate.** The refusal is `POLICY_ACTION_DENIED` with reason `unguarded_click_path`, raised at entry, before any element resolution. Rationale: routing them through the gate would require an approval per discovered control, which no operator can review, and would turn a bulk crawler into an approval-bypass surface; refusal costs only discovery breadth in pilot mode, which Phase 18 does not promise. Non-pilot behaviour is byte-identical to `2572e73` (AC-076). In pilot mode, discovery happens in dry-run (section 7), which is read-only by construction.
- `falcon.js` passes the gate (or `passthrough()`) explicitly; there is no module-level singleton that a test could leave armed.

## 6. Deterministic classifier

Inputs, in priority order, all derived from the page, never from a provider: accessible name; visible text; `title` and `aria-label`/`aria-describedby` text (B03); ARIA/implicit role; `input[type]`; `autocomplete`; the owning form's `action` and `method`; navigation destination URL; manifest vocabulary; duplicate count and identity stability. **`ordinal` is not an input and is not part of identity** (B04): a control distinguishable only by its index is `ambiguous`, and index-based clicks are refused in pilot mode.

Normalisation before matching (B03): NFKC, Unicode case folding, strip zero-width (`U+200B-200F`, `U+FEFF`) and bidi control characters (`U+202A-202E`, `U+2066-2069`), map a fixed confusables table (Cyrillic/Greek homoglyphs for Latin `a c e o p x y i l n m s t b h k d`, full-width Latin, mathematical alphanumerics) to ASCII, collapse whitespace. A string whose normalised form differs from its raw form in a way that *removes* a destructive match is treated as destructive (fail closed).

Built-in destructive lexicon unchanged from rev 1.

Fail-closed rules, as rev 1, plus:

- JavaScript click handlers are invisible to the classifier. The classifier therefore never asserts "this control is inert"; the execute-mode network gate (section 7a, N1) is the control that makes a mis-classified permitted control non-mutating.
- `autocomplete` of `current-password`, `new-password`, `one-time-code` or `cc-*`, or `input[type=password]`, marks the control credential-semantic (section 8a).
- Two or more candidates sharing the derived identity, or an identity that changed since bind, → `ambiguous` → `CONTROL_AMBIGUOUS` (or `PLAN_DRIFT`) with zero clicks (AC-049).

`actionId = Digest.digest("action-v1", { route, role, accessibleName, roleAttr, inputType, autocomplete, formAction, formMethod, destinationPath, destinationOrigin })` truncated to the first 32 hex characters. No `ordinal`. Identity change changes `actionId`, which invalidates any approval (section 9).

## 7. Dry-run design

Allowed browser behaviour: launch Chromium headless; create a context with the role's state copy and `serviceWorkers: 'block'`, `acceptDownloads: false`, `strictSelectors: true`, `recordVideo` and `recordHar` **unset**, `tracesDir` unset, no persistent user-data directory (R01); `goto` allowed routes with GET; read the DOM; collect element facts; compute proposed actions; take no screenshot unless `artifacts.screenshots != "none"`.

Structurally enforced zeroes:

- **Network.** `NetworkGate.install(context, { mode: "dry-run" })` installs `route("**/*")` and `routeWebSocket("**/*")` before any navigation, plus the section 7a navigation and popup denials. The handler aborts any request whose method is not `GET` or `HEAD`; aborts any request whose origin is not allow-listed for its resource type; and — closing the AC-026 gap — aborts a `GET` whose canonical path is `denied` by `RouteMatch.decide`, even on an allowed origin. Aborts are counted by code.
- **Interaction.** The page handed to discovery is a `DryRunGuard` proxy exposing only read methods; `click`, `fill`, `type`, `press`, `check`, `selectOption`, `setInputFiles`, `tap`, `dragTo`, `dispatchEvent` and `evaluate` are absent, so a mutation is a `TypeError` at the call site. Identity collection uses a single internal `evaluate` reached through the gate's own privileged handle, not through the proxy. Counters for click/fill/type/submit/download are asserted `=== 0` and written to the report (AC-025).
- **Downloads and storage.** `acceptDownloads: false`; a `download` event increments a counter that must be 0; the fixture's data checksum and the state-file fingerprint are compared before and after (AC-028).
- **Provider.** Dry-run never constructs a provider. `DryRun.js` does not import `LlmProviderRegistry` and `AIHealer` is not instantiated. As an independent check, the **per-boundary** dry-run flag (`EvidenceBoundary.beginRun({ mode: "dry-run" })`) is passed to `guardedFetch` as an explicit argument on every call, **not** as process-wide state, so a mixed-mode process cannot be confused and a dry-run boundary cannot be disarmed by an execute boundary in the same process (N8). Any provider call on a dry-run boundary throws `DRYRUN_PROVIDER_BLOCKED`. The test asserts zero calls at the SDK boundary via a counting stub (AC-027).

Determinism: two identical dry-runs produce byte-identical plan files, by sorting discovered actions on `(routePath, actionId)` — not on `ordinal` (B04) — excluding timestamps, runId and host paths from the document body (they go to a sibling `*.meta.json`), and serialising with `Digest.canonicalise` (AC-029).

### 7a. Execute-mode network gate (N1, N01, ADR-0029)

`NetworkGate.install(context, { mode: "execute" })` runs on every pilot context and enforces, independently of policy:

1. **Context options**: `serviceWorkers: 'block'`, `acceptDownloads: false`, `strictSelectors: true`, no `recordVideo`, no `recordHar`, no `tracesDir`, no persistent profile.
2. **Navigation scheme denial**: any navigation or popup whose URL scheme is `javascript:`, `data:`, `blob:`, `file:`, `about:` (other than `about:blank`) or `view-source:` is denied; `page.on("popup")` closes the popup and records `POLICY_ORIGIN_DENIED`. Any URL carrying userinfo is denied.
3. **Non-GET gate**: in execute mode **every** request whose method is not `GET` or `HEAD` is aborted unless the gate is armed and the request's `{method, serialised origin, canonical path}` equals the armed triple exactly; the arming is consumed by the first matching request. This is what makes a mis-classified permitted "View" that fires a `fetch("POST", ...)` non-mutating, and it also closes the residual JS race in P03 (a swapped form action produces a request that does not match the armed triple and is aborted).
4. **`sendBeacon` and WebSocket**: beacons are `POST`s and are covered by (3). `routeWebSocket("**/*")` refuses any socket whose origin is not allow-listed, and in execute mode drops every outbound frame unless the gate is armed for a WebSocket action (Phase 18 never arms one, so all outbound frames are dropped and counted).
5. **Redirect cap and per-hop validation**: at most `MAX_REDIRECTS = 10` hops; exceeding it is `POLICY_REDIRECT_LIMIT`. **Per-hop origin/route validation is a declared spike, SPIKE-R.** Hypothesis H-R (Playwright route handlers may not fire for every redirect hop of an intercepted request) is **not verified**, and this design does not claim it either way. SPIKE-R (owner: 18C, before the 18C PR merges) must determine empirically, on the pinned Playwright version, whether a `route` handler observes each hop. If it does, hop validation is done in the handler. **Mandated fallback if it does not, or if the spike is inconclusive:** every intercepted request in a pilot context is fulfilled via `route.fetch(request, { maxRedirects: 0 })` in a Falcon-side loop that validates each `Location` hop against steps 2, 3 and the origin/route policy, caps at 10, and aborts on the first denied hop. The fallback is the default implementation unless the spike proves the simpler path; it is never left to be chosen at implementation time.
6. **Fail closed**: any throw inside a route handler aborts the request and refuses the run with `PILOT_INTERNAL_ERROR`.

### 7b. Playwright-runner artifacts (L03)

A pilot test executed through `@playwright/test` must not inherit the repository defaults (`playwright.config.js` sets `screenshot: "only-on-failure"` and `video: "retain-on-failure"`). `playwright.config.js` gains a dedicated `pilot` project (owned by 18F) whose `use` block sets `screenshot: "off"`, `video: "off"`, `trace: "off"`, `contextOptions: { recordVideo: undefined, recordHar: undefined }`, `outputDir` under `run/pilot-test-results/`, and `retries: 0`; the pilot project is the only project whose `testMatch` covers `tests/regression/pilot/**`. `VisualRegression` consults `manifest.artifacts` and refuses to capture when `screenshots === "none"` or when the role is authenticated and the route is not in `screenshotRoutes`. Negative test: a forced failure driven through the Playwright runner in the pilot project produces zero `*.png`, `*.webm`, `*.zip` and `*.har` under the output root **and** under `test-results/`.

## 8. Plan digest

`digest = Digest.digest("plan-v1", materialView(plan))`. **This does not use `Schemas.canonicalJson`** (ADR-0027, superseding the rev 1 reading of OD-03): OD-03 fixes SHA-256 over canonical JSON, and `Digest.canonicalise` is that canonical JSON, now strictly specified. `Schemas.canonicalJson` stays untouched so Phase 16 digests (`StateJournal`, `ShardMerge`, `Reducers`, `Planning`, `ParallelSweep`) are unchanged.

`Digest.canonicalise` implements JCS (RFC 8785) semantics and **rejects** rather than coerces: `undefined` anywhere (property value or array element), `NaN`, `±Infinity`, `-0`, any non-plain object (including `Date`, `Map`, `Set`, `RegExp`, `Buffer`, class instances), functions, symbols, `BigInt`, lone surrogates, strings that are not NFC, strings containing unescaped control characters, prototype-polluting keys, and cyclic references. Numbers must be finite and are serialised with the JCS/ECMAScript shortest round-trip form; integers outside `Number.isSafeInteger` are rejected. Objects are sorted by UTF-16 code-unit order of keys. Input is parsed by `JsonStrict.parse`, which **rejects duplicate keys** rather than resolving last-wins as `PlanFile.load` does today. Domain separation: the digested byte string is `domain + "\u0000" + canonicalText`, with `domain ∈ {plan-v1, manifest-v1, approval-v1, action-v1, state-v1, audit-v1}`, so a plan digest can never equal a manifest or binding digest over the same object. Golden vectors from TM18-D01 are a unit test (D01).

**Material** (changing any changes the digest): `version`; `manifestRef.{version, digest, manifestRevision, normalised}`; `role`; `targetOrigin` (WHATWG serialised origin); `journey`; ordered `actions[]` with, per action: `actionId`, `action`, `routePath` (canonical), `locator` (normalised string), `check`, `attribute`, `valueRef` (section 8a), `classification`, `requiresApproval`, `assertionDeclarations`.

**Excluded** (changing these must not change the digest, AC-030): `generatedAt` and every timestamp; `runId`; run tokens; worker and shard ids; absolute or host-specific paths; durations and timing; counters; report and artifact paths; dashboard event ids; provider id, model and telemetry; `falconBuild`; approval records; cookie, storage and header data of any kind; log text. `ordinal` is excluded and is not stored at all (B04).

Drift: at bind time the digest is recorded; before execution the plan-file material view is recompared (unequal → `PLAN_DIGEST_MISMATCH`) and the live per-action identity is recompared at policy step 11 (unequal → `PLAN_DRIFT`, which requires a new review and invalidates every approval bound to the old digest; no approval is reused) (AC-031, AC-032).

### 8a. Plan values and credential semantics (targeted question "plan values stored literally")

A `type`/`select`/`press` value is stored **literally and is material**, as rev 1 — a hash of a low-entropy field value protects nothing and hides drift. The credential exposure is closed structurally instead, replacing the undefined phrase "field semantics":

- **Credential-semantic input** is defined exactly: a resolved element with `type="password"`, or `autocomplete` matching `^(current-|new-)?password$|^one-time-code$|^cc-`, or an `aria-label`/`name`/`id` matching the existing `password|passwd|secret|token|apiKey|credential|otp|cvv` set, or an input inside a form whose action matches `/login|/signin|/auth|/token`.
- Any plan action whose target resolves to a credential-semantic input **must** carry `valueRef: { env: "NAME" }`. A literal string there is refused with the new code **`PLAN_VALUE_LITERAL_CREDENTIAL`** (exit 15), raised in two places: at dry-run plan write (the resolved element is known, so this is exact) and at v2 plan load in pilot execute mode (where resolution is not yet available, the refusal is driven by the recorded `classification`/`inputType`/`autocomplete` of the planned action, which are material). Plus the existing `isKeyShapedValue` and `Schemas.SECRET_PATTERNS` screens on every literal value, bounded to string leaves under 4 KiB with fixed anchored regexes.
- The digest covers the **reference name**, never the value: `valueRef: {env:"PILOT_ROLE_CUSTOMER_PASSWORD"}` is material; the resolved value is registered with `EvidenceBoundary` before the fill and never enters the plan, the report, the audit log or a prompt.
- Values of 3 bytes or fewer cannot be reliably redacted (L01 item 3). **A registered credential whose resolved value is ≤ 3 bytes is refused** `AUTH_LOGIN_FAILED` (for credentials) or `MANIFEST_SECRET_LITERAL` (for manifest-sourced values) with no echo, rather than being redacted best-effort. A CSRF or session value of ≤ 3 bytes is registered but additionally suppresses the entire field from every artifact (the field is dropped, not substituted).
- **OWNER DECISION required:** personally identifying information in literal non-credential plan values (names, emails, order numbers typed into forms) remains a residual risk. The design makes it visible (literal values are in the plan file and in the digest) and bounded (plan files live under `PilotRoots.plansRoot`, 0600, git-ignored, 7-day retention), but it does not eliminate it. The owner must accept this residual risk or direct that all `type` values be env references, which would make most realistic journeys unauthorable.

## 9. Approval store, binding, run scope and TTL

**Binding (OD-01).** Eight fields, which is the authoritative count (ADR-0023 in rev 1 said seven; corrected here and in ADR-0023 below):

```
binding = { planDigest, manifestVersion, manifestDigest, manifestRevision,
            role, targetOrigin, actionId, falconBuild }
bindingId = Digest.digest("approval-v1", binding)
```

`targetOrigin` is the WHATWG serialised origin, so `http://localhost:3000` never matches an approval granted for `http://127.0.0.1:3000` (P01 negative test). `falconBuild` comes from `BuildIdentity.falconBuild()` and always contains `policySemanticsVersion` (manifest schema version + classifier lexicon version + policy-engine version), so a policy-semantics change invalidates outstanding approvals even when the release identifier is reused.

**`falconBuild` without git (P04, ADR-0034).** The rev 1 phrase "when available" fails open. Decision: `falconBuild.vcs` is either `{kind:"git", sha, dirty}` — from the existing `src/core/history/GitInfo`, with `dirty: true` recorded when the worktree is not clean, and a dirty worktree is itself part of the binding so an approval never survives an edit — or, when `git` is absent or the tree is not a repository, `{kind:"source", digest}` where `digest = Digest.digest("plan-v1", { files: [...] })` over the sorted list of `{relPath, sha256}` for a **fixed, code-owned file list**: everything under `src/core/pilot/`, `src/core/AIHealer/`, `src/core/ClickExplorer.js`, `src/core/PlanFile.js`, `src/core/parallel/SafeFs.js`, `utils/Logger.js` and `package.json`. If neither is computable, protected actions refuse with `PILOT_INTERNAL_ERROR`. There is no `"unknown"` build identity.

**Identity and consumption key (P02).** Each record carries a random 128-bit `approvalId` (base64url), minted at `propose`. **Consumption is keyed by `approvalId`, not by `bindingId`**, so the same binding can be re-approved later and receives a new id; `lookup(store, binding)` returns the newest `approved`, unconsumed, unexpired record for that `bindingId`.

**Run scope (OD-02, "run scope and TTL are inconsistent"). Decision: the approve command mints a run token which exactly one subsequent execute presents once.** Mechanism:

1. `falcon.js --approve-action=<actionId> --plan=<file> --pilot-manifest=<file> --approver=<name>` proposes and decides in one CLI invocation, then calls `mintRunToken`, which generates `runId` (128-bit) and `nonce` (128-bit), stores `{approvalId, runIdHash: Digest.digest("approval-v1",{runId}), grantedAt}` in the record, and prints **`<runId>.<nonce>` once, to stdout only** (never to a log, report, dashboard event or audit entry — the token is registered as a secret with the boundary so a later accidental sink write is refused).
2. The execute run is started with `--approval-run-token=<runId>.<nonce>` (or `PILOT_APPROVAL_RUN_TOKEN`). The run adopts `runId` as its own `runId`, so `grantedForRunId` matches by construction — this is what makes the rev 1 "`grantedForRunId` always fails" problem disappear without weakening OD-02.
3. At first use, `RunToken.claim` creates `run/approvals/runtokens/used/<runId>` with `SafeFs.createExclusive`. `EEXIST` → `APPROVAL_RUN_TOKEN_INVALID`. A token whose `nonce` does not verify, or that names an unknown `approvalId`, is `APPROVAL_RUN_TOKEN_INVALID`. So one approval command yields exactly one usable execute, and the approval remains strictly run-scoped: a second execute has a new runId and no token, and fails `APPROVAL_STALE`.
4. **TTL is measured from `grantedAt`**, the grant timestamp in the record, using a stored wall-clock ISO timestamp plus the monotonic clock for in-run checks. The cap is 1800 s (OD-04, equal to the run-budget maximum). An approval consumed after 1800 s from grant is `APPROVAL_STALE`, checked at step 7 and again immediately before `consume`.

**Concurrency. Decision: exclusive consume markers, not a sequential-mode restriction.** `consume(store, approvalId, {runToken})` creates `run/approvals/consumed/<approvalId>` with `SafeFs.createExclusive` (`open(..., "wx", 0o600)`, write `{consumedAt, runId, seq}`, `fh.sync()`, close, **directory fsync**), then appends the audit entry, then returns — all **before** the click is dispatched. `EEXIST` → `APPROVAL_REPLAYED`. Two concurrent consumers therefore yield exactly one click, and a `SIGKILL` between consume and click loses the action rather than repeating it (the correct bias). `approvals.json` is still rewritten with `writeAtomicPrivateSynced`, but it is a **derived cache, not the authority**: the marker directory and the audit chain are the authority. Rationale for rejecting the alternative: restricting protected actions to sequential mode would make worker-mode coverage differ from sequential coverage and so would break **AC-021** (equal coverage sets) and constrain **AC-051** (approved CSRF submit under workers). With exclusive markers, AC-021 and AC-051 are unaffected: worker mode executes the same protected actions, and at most one worker wins each marker. Residual, documented: the marker directory must be on a POSIX filesystem where `O_EXCL` is atomic; NFS is unsupported for `PilotRoots.approvalsRoot` and a non-local filesystem is detected (`statfs` type) and refused.

**State derived from the chain (P01).** Rev 1 left `approvals.json` mutable while chaining only `audit.log`. Corrected: an approval's state is **derived**, in this precedence: (a) `consumed` iff `consumed/<approvalId>` exists; (b) otherwise the last `decision` for that `approvalId` in the verified audit chain; (c) `approvals.json` is only an index for fast lookup and is **rebuilt from the chain at `open()`** — if it disagrees with the chain, the chain wins and the file is rewritten. Flipping `consumed` to `approved` inside `approvals.json` therefore has no effect, and deleting a marker is caught because the chain still holds the consumption entry (mismatch → `APPROVAL_HISTORY_TAMPERED`).

**Chain construction (P01).** Genesis `prevHash = "sha256:" + 64 × "0"`. `entryHash = Digest.digest("audit-v1", { prevHash, entry })` — domain-separated from `bindingId`, which uses `approval-v1`, so no entry hash can be mistaken for a binding id. Each entry stores `seq` (strictly increasing from 1), `prevHash` and `entryHash`. Tail truncation is detected by two independent facts: the head hash and `seq` recorded in `audit.anchors` (below), and the existence of a `consumed/<approvalId>` marker with no corresponding chain entry. **Stated limit:** an attacker with write access who truncates the tail *and* the matching anchor *and* deletes the matching markers in a single consistent edit cannot be detected by the ledger alone, because every artifact is same-uid writable; detection then depends on CI artifact retention and filesystem auditing. This is the "same-uid ledger rollback" residual risk, and it is an **OWNER DECISION** to accept. Docs must say the audit log provides **attribution and tamper-evidence, not authentication**.

**Audit retention vs the chain (confused deputy). Decision: segmented log with anchors.** `audit.log` becomes `audit/<segmentId>.log`, where a segment is sealed when it reaches 4096 entries or 30 days, whichever first. Sealing appends one anchor record to `audit/anchors.log` — itself a hash chain, 0600, `writeAtomicPrivateSynced`, never pruned, ~200 bytes per segment (so ~2.4 KiB/year at one segment per 30 days) — containing `{segmentId, firstSeq, lastSeq, entryCount, headHash, sealedAt, prevAnchorHash, anchorHash}`. Retention (90 days, OD-14) prunes **whole sealed segment bodies only**; `verify()` then verifies the anchor chain end to end plus the live segments, and a pruned segment is proven present-and-unaltered by its anchor rather than by its body. Pruning a segment body is recorded as a `segment-pruned` entry in the live segment. This removes the rev 1 choice between a denial of service (never prune) and relaxing verification. `S01`: `open()` verifies the anchor chain (O(segments), tiny) plus live segments under a 1 MiB cap, not the whole history, so startup cost does not grow without bound.

**Audit entry shape.** `{ seq, timestampIso, approver, approvalId, bindingId, planDigest, actionId, role, targetOrigin, decision, code, prevHash, entryHash }`. No cookie names, no tokens, no credential values, no CSRF tokens, no run token, no plan values (AC-057). `approvalAudit` is a **material sink**: it is written through `EvidenceBoundary.assertClean` only — substitution is forbidden there, because silently substituting inside a chained record would alter material content and break verification (N5). A leak assertion failure refuses the write and the run.

**Store opening (F01).** `open({ root: PilotRoots.approvalsRoot })` reads every file with `SafeFs.readBoundedPrivateJson` (`requireMode: 0o600`, `requireOwner: true`, `nlink === 1`, root-confined, `JsonStrict.parse`). Any refusal → `APPROVAL_HISTORY_TAMPERED` with zero clicks (AC-058). The approvals root is fixed by `PilotRoots` and is **not** configurable, so an operator cannot point it at a pre-consumption copy (confused deputy).

**Dashboard (Could, AC-059).** Read-only `GET /api/approvals` behind the existing token gate, returning `approver`, `decision`, `approvalId`, `bindingId`, `actionId`, `role`, timestamps and codes — never a plan value, never a run token, never a secret. Code fields are enum-validated against `FailureCodes.CODES` before render and all five HTML metacharacters (`& < > " '`) are escaped (X01). No mutation endpoint (P05).

## 10. Secret-safe evidence boundary

One module, `evidence/EvidenceBoundary.js`, plus `evidence/SecretRegistry.js`. Every sink in `SINKS` routes through it: `Logger` (`info`/`warning`/`error`), `ReportManager` field writes, `Dashboard.emit`, run history, screenshot metadata, `locator/LocatorMemoryWriter`, `AIHealer/HealingReport`, `parallel/ShardBundle`, error serialisation, `AIHealer` prompt construction, and raw `process.stdout`/`process.stderr` writes from pilot paths.

**Registration — what, and exactly when (L01 item 2).** `registerSecret` is called:

| Value | Registered at |
|---|---|
| Role credential env values | manifest load, **before browser launch** |
| Imported cookie values | during `importState`, **one call per cookie value**, never as one state blob |
| Imported localStorage values | during `importState`, one call per value |
| `storageState` file bytes | at import, as an opaque blob, in addition to the per-value registrations |
| Cookies set during the run | a `response` listener parses `Set-Cookie` and registers each value synchronously; additionally `context.cookies()` is diffed and newly seen values registered **before every sink flush** |
| `Authorization` header values | synchronously in the `route`/`request` handler, before the request is allowed to continue |
| CSRF tokens and URL tokens | synchronously in the request handler and on form extraction |
| Approval run token | at mint and at parse |

**Encoded forms (L01 item 1).** `SecretRegistry.register(value)` derives and indexes, for every registered value: raw UTF-8; `encodeURIComponent` and `encodeURI` forms; form-encoded form (space → `+`); base64 and base64url, with and without padding; JSON-escaped form (`JSON.stringify(value).slice(1,-1)`); HTML-entity form (numeric and named escapes of `& < > " '`); percent-encoded-twice form; and the lowercase/uppercase hex of the raw bytes. Substitution runs **longest-match-first across all derived forms** on the raw string, before pattern redaction. Derivation is bounded: a registered value above 8 KiB is hashed and only the first 8 KiB is expanded, and the registry is capped at 512 values with the cap breach refusing the run (`PILOT_INTERNAL_ERROR`) rather than silently dropping a registration.

Pipeline, in order: (1) known-value substitution over all derived forms; (2) pattern redaction reusing `Schemas.SECRET_PATTERNS` and `Logger.redactUrlUserinfo`; (3) URL normalisation to origin+path via `storedUrl`; (4) control-character and ANSI stripping (AC-066); (5) length capping; (6) for dashboard and reports, escaping of all five HTML metacharacters so application text is inert (AC-066, X01). `sanitizeObject` applies the same pipeline to **keys as well as values** (L01 item 4) and drops any key that reduces to `[redacted]`.

**Enforcement, not convention:**

- `assertClean` runs on **every** artifact immediately before write, in **every** mode — not only debug/test (N6). A hit throws `EVIDENCE_LEAK_DETECTED`; nothing is written and the run refuses. For the two **material sinks** (`planFile`, `approvalAudit`) only `assertClean` is permitted — substitution there would silently alter digested or chained content (N5).
- If `sanitize` or `assertClean` itself throws, nothing is written and the run refuses `PILOT_INTERNAL_ERROR` (E01 fail-closed rule).
- **Sink inventory scan (L01 item 6).** The static-scan unit test enumerates call sites of `fs.promises.write*`, `fs.writeFileSync`, `fs.appendFile`/`appendFileSync`, `fs.createWriteStream`, `process.stdout.write`, `process.stderr.write`, `console.*`, `res.json`/`res.send`/`res.end`, `dashboard.emit`, `page.screenshot({path})`, `context.tracing.*`, `recordVideo` and `recordHar`, and asserts each reachable-from-pilot site either imports `EvidenceBoundary` or is on a reviewed, test-asserted exclusion list. A new sink that forgets the boundary fails CI.
- **`DEBUG=pw:*` (L01 item 5).** Playwright's debug logging writes to stderr outside `Logger` and would print headers and payloads. In pilot mode, if `process.env.DEBUG` is set to anything matching `pw:` (or `DEBUG` is `*`), the run is **refused** `PILOT_INTERNAL_ERROR` with a message naming `DEBUG`; the variable is additionally deleted from the child environment Falcon passes to Chromium. Refusal rather than stripping, because stripping an operator's explicit debug request silently is worse than telling them pilot mode forbids it.
- Persisted errors use `{code, errorClass, boundedRedactedMessage}` (L02). `TestRunner`'s report row currently passes `error.message` straight through; that row is rewritten to the same triple, and hypothesis H1 (a fill value reaching the Playwright call log inside an error message) is a required negative test: a failed `fill` with a registered canary value must produce zero canary bytes in the report.
- `ShardBundle` gains an explicit artifact allow-list; storage-state files, locator memory and healing evidence are excluded by construction, and the **merger refuses** a bundle that contains an excluded type rather than merging it (L04, OD-17, AC-022, AC-067).
- Fill values are **never** stored, scored or hashed into identity; credential-semantic `select` values are excluded from locator memory and from healing evidence (L05). Asserted by test over `ElementFactsCollector` and `LocatorMemoryWriter` (AC-065).

**Canary strategy (AC-060..067).** Six distinct high-entropy canaries, one per channel: cookie value, `Authorization` value, password field value, URL query token, `localStorage` value, env credential. After each of five run shapes — execute, dry-run, failed login, expired session, shard — the suite greps every produced byte (all files under the run directory, report, dashboard events JSON and rendered HTML, run history, locator memory, shard bundles, captured stdout and stderr, Playwright output dirs, and the provider-prompt capture at the SDK transport boundary) for **every derived encoded form** of each canary, not only raw/base64/URL. Expected: zero, everywhere. Additional required cases: a cookie **rotated mid-run** by `Set-Cookie` (the rotated value must also be absent), a run with `DEBUG=pw:api` (must refuse, and produce zero canary bytes), and an exception deliberately constructed with an `Authorization` value whose serialised form is scanned (AC-064). The whole suite must **fail** when the registry is disabled — that inversion is itself a test (L01 required negative test).

## 11. Auth lifecycle state machine

States and transitions as rev 1 (`absent → imported | logged-in → active → (lost) → terminal`), with these additions:

- Every state file read or written uses `SafeFs.readBoundedPrivateJson` / `writeAtomicPrivateSynced` with `requireMode: 0o600`, `requireOwner`, `nlink === 1`, a 1 MiB cap, root confinement under `PilotRoots.authRoot`, and `JsonStrict.parse` (F01).
- `importState` validates a **strict cookie schema**: `{name, value, domain, path, expires, httpOnly, secure, sameSite}` only, with `domain` required to be inside the manifest's `allowedOrigins` host set (a cookie for an unrelated domain is refused `AUTH_STATE_MISSING`), `path` canonical, and `value` length-capped. `origins[].localStorage` entries are likewise strict. Unknown keys refuse.
- **`LoginSetup` field location (N7).** Login uses **exact operator-supplied selectors only** — `roles[].login.{usernameSelector, passwordSelector, submitSelector}` in the manifest, required when `credentials` is present. No healing, no AI, no `getByText`, no text heuristics, no index selection; `strictSelectors: true` means each must resolve to exactly one element. Before the password fill the gate requires: the field is in the **top frame**, is `type="password"`, is visible and enabled, and the page's current origin is in `allowedOrigins`. After any off-origin redirect, **no fill happens** and the run terminates `AUTH_LOGIN_FAILED`. The password value is registered with the boundary before the fill and is never part of a plan, report, prompt or audit entry.
- `AUTH_STATE_UNDETERMINED` is never classified as authenticated (AC-010), and "inconclusive authentication evidence" is its human-readable form.
- Isolation as rev 1: per-(role, worker) 0600 copies under `PilotRoots.copiesRoot/<runId>/`, source opened read-only and fingerprinted before and after (AC-017, AC-018, AC-020, AC-021, AC-023). `BrowserManager.newContext(options)` is extended to accept `{ storageState, serviceWorkers, strictSelectors, acceptDownloads }`; the no-argument call keeps today's behaviour.

## 12. Plan lifecycle state machine

`draft → reviewed → bound → executing → (completed | drifted | refused)`. **Review is recorded against the digest, not the path (N2):** the digest is computed first, and the review record is `{approver, planDigest, reviewedAt}` with no path component, so re-pointing a path cannot carry a review forward.

| From | Event | To | Code |
|---|---|---|---|
| — | dry-run writes plan v2 under `PilotRoots.plansRoot` | draft | — |
| draft | digest computed and recorded with manifest revision | bound-candidate | — |
| bound-candidate | operator review recorded **against the digest** | bound | — |
| bound | execute, recomputed file digest equal | executing | — |
| bound | execute, plan file digest unequal | refused | `PLAN_DIGEST_MISMATCH` |
| bound/executing | live per-action identity differs at step 11 | drifted | `PLAN_DRIFT`; all bound approvals invalidated |
| bound | plan has no version or digest in pilot execute mode | refused | `PLAN_INVALID` (`PLAN_NO_DIGEST`) — see BLOCKER-1 |
| bound | literal value for a credential-semantic input | refused | `PLAN_VALUE_LITERAL_CREDENTIAL` |
| bound | strict-canonicalisation reject (duplicate key, non-NFC, `NaN`, …) | refused | `DIGEST_INPUT_INVALID` → reported as `PLAN_INVALID` for load-time input, `PILOT_INTERNAL_ERROR` for internally constructed values |
| executing | all steps resolved | completed | — |

## 13. Approval lifecycle state machine

`proposed → approved | rejected → consumed | expired | revoked`. State is **derived from the audit chain and the consume markers** (section 9), never read as authoritative from `approvals.json`.

| From | Event | To | Code |
|---|---|---|---|
| — | protected action with no record | — | `APPROVAL_REQUIRED` (AC-052) |
| — | operator proposes (CLI) | proposed | — |
| proposed | decide approve, run token minted | approved | — |
| proposed | decide reject | rejected | `APPROVAL_REQUIRED` at use |
| approved | binding matches, valid unclaimed run token, within TTL, marker created | consumed | audit entry, then dispatch |
| approved | binding mismatch (any of the eight fields) | — | `APPROVAL_MISMATCH` |
| approved | no token, bad nonce, or token already claimed | — | `APPROVAL_RUN_TOKEN_INVALID` |
| approved | different runId, or manifest/plan changed since grant | expired | `APPROVAL_STALE` |
| approved | more than 1800 s since `grantedAt` | expired | `APPROVAL_STALE` |
| consumed | second consume attempt (same or new process, concurrent or after `SIGKILL`) | — | `APPROVAL_REPLAYED` |
| approved | same binding re-approved later | new record, new `approvalId` | — |
| any | manifest denies the action | revoked | `POLICY_ACTION_DENIED` (deny beats approval, OD-18) |
| any | chain, anchor or file check fails | — | `APPROVAL_HISTORY_TAMPERED` |

CSRF case (AC-051): an approved protected submit executes with the token the page itself issued in-run; the token is registered as a secret before the submit; the network gate is armed for exactly that `{method, origin, path}`, so the submit succeeds and nothing else does. Unapproved: zero POSTs, because refusal happens at step 7 before any dispatch **and** the gate is never armed.

## 14. Failure and result codes

Report field `result.pilot.code`; dashboard event `pilotRefusal` with `{ code, category, route, role, actionId }` — never a value. Exit codes do not collide with `0/1/2/3` (OD-10).

| Code | Exit | Category |
|---|---|---|
| `MANIFEST_INVALID`, `MANIFEST_VERSION_UNSUPPORTED`, `MANIFEST_ROLE_UNKNOWN`, `MANIFEST_SECRET_LITERAL` | 10 | manifest |
| `AUTH_STATE_MISSING`, `AUTH_LOGIN_FAILED`, `AUTH_ROLE_REQUIRED` | 11 | auth setup |
| `AUTH_REDIRECT_TO_LOGIN`, `AUTH_SESSION_EXPIRED`, `AUTH_UNEXPECTED_ANONYMOUS`, `AUTH_STATE_UNDETERMINED` | 12 | auth loss (distinct from 1 and 2, AC-013) |
| `POLICY_ORIGIN_DENIED`, `POLICY_ROUTE_DENIED`, `POLICY_BUDGET_EXCEEDED`, `POLICY_ACTION_DENIED`, **`POLICY_NETWORK_BLOCKED`**, **`POLICY_REDIRECT_LIMIT`** | 13 | policy |
| `APPROVAL_REQUIRED`, `APPROVAL_MISMATCH`, `APPROVAL_STALE`, `APPROVAL_REPLAYED`, `APPROVAL_UNKNOWN_PLAN`, `APPROVAL_HISTORY_TAMPERED`, **`APPROVAL_RUN_TOKEN_INVALID`** | 14 | approval |
| `PLAN_DIGEST_MISMATCH`, `PLAN_DRIFT`, **`PLAN_VALUE_LITERAL_CREDENTIAL`** | 15 | plan binding |
| `PLAN_INVALID` | 2 | rejected input (unchanged from today) |
| `CONTROL_AMBIGUOUS` | 16 | identity |
| `EVIDENCE_LEAK_DETECTED`, `DRYRUN_PROVIDER_BLOCKED`, `DRYRUN_MUTATION_ATTEMPTED` | 17 | safety invariant |
| **`PILOT_INTERNAL_ERROR`** | **18** | internal fail-closed (E01) |

Six new codes. `PILOT_INTERNAL_ERROR` gets its **own** exit code 18 rather than joining 17: 17 means "a safety invariant was violated and caught", which a CI consumer may treat as a product defect, whereas 18 means "Falcon could not establish that the action was safe and refused", which may be an environment problem (no git, `win32`, `DEBUG=pw:*`, unreadable ledger, non-local filesystem). Conflating them would make 17 un-actionable. `DIGEST_INPUT_INVALID` is **not** an enum code: `DigestError` is mapped by its caller to `MANIFEST_INVALID` (manifest input), `PLAN_INVALID` (plan-file input) or `PILOT_INTERNAL_ERROR` (internally constructed value), so each exit stays meaningful.

`FailureCodes.CODES` is the single frozen enum; a code outside it fails a unit test (AC-012). Every refusal emits through `Logger` and appears in exit output, report and dashboard event (AC-071). ADR-0026 is amended from "10–17" to "10–18".

## 15. Per-component failure behaviour, migration, rollback

| Component | On failure | Migration | Rollback |
|---|---|---|---|
| Manifest | refuse before any request; name the JSON path, never the value | new file, no legacy form | remove flag |
| Digest / JsonStrict | `DigestError` → caller-mapped refusal; never a coerced digest | new module; `Schemas.canonicalJson` untouched, Phase 16 digests unchanged | delete module; nothing else depends on it |
| PilotRoots / SafeFs ext | refuse (`PILOT_INTERNAL_ERROR` or the loader's code); never read an unverified file | additive exports; existing `readBoundedJson`/`writeAtomicPrivate` callers unchanged | revert the three new exports |
| PolicyEngine | refuse; never permit on internal error | none | remove flag |
| ActionClassifier | unknown signals → denied | lexicon version in `falconBuild` | revert lexicon; approvals invalidate |
| PilotActionGate | refuse, zero clicks; no selector-string path in pilot mode | `passthrough()` is the `2572e73` path | revert to `passthrough()` everywhere |
| NetworkGate | abort the request, count, refuse the run | none | flag removal |
| ClickExplorer / SiteSweep | refused in pilot mode (`POLICY_ACTION_DENIED`, `unguarded_click_path`) | unchanged outside pilot mode | revert the entry guard |
| PlanDigest / PilotPlan | `PLAN_INVALID`/mismatch before browser work where possible | v1 plans still read | v2 reader is additive |
| DryRun | abort request, count, refuse run | none | flag removal |
| ApprovalStore | unreadable, tampered, non-local FS, or marker-chain disagreement → refuse all protected actions | store created on first use; anchors created on first seal | delete `run/approvals/`; protected actions then refuse |
| AuthStateStore / StateCopyPool | missing or unreadable state → `AUTH_STATE_MISSING`; cleanup always runs | import existing Playwright state files through the strict cookie schema | delete `run/auth/` |
| BuildIdentity | no git and no source digest → `PILOT_INTERNAL_ERROR` | none | none needed |
| EvidenceBoundary | leak or internal throw → refuse the run, write nothing | existing sinks keep working with stricter redaction | forward-only once dependents land |
| playwright.config pilot project | absent project → pilot regression tests do not run, and 18F's CI step fails the job | additive project | delete the project |


## 16. Hermetic fixture (18F)

A local Node HTTP server on `127.0.0.1` with an ephemeral port, started and stopped by the test, serving: `/login` with a working credential pair and a failing pair; a short-lived session cookie for the expiry case; three roles (`administrator`, `customer`, `readonly`) with role-restricted pages that 403 or redirect; a CSRF-protected form requiring a per-session token; destructive controls (`Delete account`, `Pay now`, `Transfer funds`, `Publish`, `Send invoice`, `Submit order`, `Revoke token`, `Refund`, `Invite user`) varied across accessible name, visible text, `input[type]`, form action and destination URL; misleading labels ("Cancel" posting to `/account/delete`, "View" linking to `/orders/1/refund`); duplicate controls with identical names; a control replaced by JavaScript after load; a cross-origin link and a cross-origin form post to a second loopback port treated as a different origin; a protected submission endpoint; server-side mutation counters exposed at `/__counters`; a provider-request counter in the test harness; an oracle manifest listing the exact set of controls a correct dry-run must propose (AC-034); the six canaries. Zero non-loopback outbound requests (AC-073). The existing `fixture:serve` script pattern is reused.

## 17. Process lifecycle and cleanup

A single `PilotLifecycle` registry collects disposers: browser, fixture server, dashboard, state copies, temp plan files, network gates. `SIGINT`, `SIGTERM`, the `finally` of the main IIFE, **and explicit invocation immediately before every `process.exit` call site** all run `cleanupAll` once, idempotently, with a 5 s bound. `beforeExit` is registered as a convenience only, with the documented fact that **it does not fire on `process.exit`** (F03), which is why the exit call sites call cleanup themselves. `uncaughtException` and `unhandledRejection` handlers run `cleanupAll`, log through the boundary, and exit with the mapped code (`PILOT_INTERNAL_ERROR` if none is known) rather than leaving state behind. `process.exitCode` is preserved rather than overwritten. Signal handlers are installed once and removed on normal completion so tests do not leak listeners.

**Pre-existing directories and files (F02).** At startup, `run/`, `run/auth/`, `run/approvals/`, `run/plans/` and `execution.log` are **verified or repaired, not trusted**: each must be a directory/regular file owned by the process uid with mode `0700`/`0600` and `nlink === 1`, reached through `resolveUnder`, with every parent component `lstat`-ed for symlinks; a mismatch is repaired with `chmod` when the owner matches and refused `PILOT_INTERNAL_ERROR` when it does not. Directory creation is followed by a directory `fsync`. Hypothesis H4 (an operator-planted `execution.log` symlink) is a required negative test.

**Startup orphan sweep (F03).** `copiesRoot/<runId>/` directories from previous runs are swept at startup: a directory whose recorded PID is not live (`process.kill(pid, 0)`), or whose mtime is older than 24 h, is deleted. A live-PID directory is left alone. The sweep is bounded (at most 1000 entries per run) and logged through the boundary.

Cleanup deletes every per-run auth copy even on a crash path (AC-019). The approval store, audit segments and anchors are deliberately **not** deleted — they are the audit record — and are governed by retention.

**Retention (AC-068, OD-14).** `evidence/Retention.js` deletes artifacts under `PilotRoots` older than a documented default of **7 days**; audit **segment bodies** older than **90 days** are pruned as whole sealed segments only; `anchors.log` is never pruned (section 9). Retention is confined: every candidate is produced by `resolveUnder`, every candidate is `lstat`-ed and a symlink is skipped and reported (never followed, never unlinked through), directories are removed only when empty, and nothing outside `PilotRoots` is ever a candidate (confused deputy). An on-demand purge command stays deferred (OD-14); documented manual steps cover it.

## 18. Architecture decision records

ADR-0020, ADR-0021, ADR-0024 and ADR-0025 stand as written in rev 1, with ADR-0025 extended by ADR-0029. Amendments:

### ADR-0022 (amended) — SHA-256 over a *strict* canonical JSON of an explicit material view; drift invalidates approvals.
Amended: the canonicaliser is `pilot/Digest.js`, not `Schemas.canonicalJson` (see ADR-0027). Everything else stands: an explicit code-owned, test-asserted `materialView`; run-scoped metadata excluded to a sibling meta file; live identity recomputed per action before the click and any difference is `PLAN_DRIFT`, invalidating every bound approval. `ordinal` is removed from the material view and from identity (B04). Status: accepted (amended).

### ADR-0023 (amended) — Approval binds **eight** fields; consumption is durable and exclusive before dispatch.
Amended: the binding has eight fields — `planDigest`, `manifestVersion`, `manifestDigest`, `manifestRevision`, `role`, `targetOrigin`, `actionId`, `falconBuild` — correcting rev 1's "seven". Consumption is keyed by a random `approvalId`, not by `bindingId` (ADR-0031), and is an exclusive `O_EXCL` marker with file and directory `fsync` before dispatch. Status: accepted (amended).

### ADR-0026 (amended) — A closed failure-code enum mapped to new exit codes **10–18**.
Amended: the range is 10–18; 18 is `PILOT_INTERNAL_ERROR` (fail-closed internal/environment refusal), kept distinct from 17 (a caught safety-invariant violation) so CI consumers can tell a product defect from an environment problem. `PLAN_INVALID` keeps exit 2. Status: accepted (amended).

### ADR-0027 — A new strict `Digest` module with JCS semantics and domain separation; `Schemas.canonicalJson` is frozen.
Context: `Schemas.canonicalJson` (`src/core/parallel/Schemas.js:36-39`) emits the invalid text `{"a":undefined}`, maps `[undefined]` to `[]`, folds `-0` to `0`, turns `NaN` into `null`, serialises `new Date(0)` as `{}` and accepts lone surrogates; `PlanFile.load` resolves duplicate keys last-wins. Any of these lets two different plans share a digest, which defeats the whole approval binding. Changing it in place would alter Phase 16 digests in `StateJournal.js:65`, `ShardMerge.js:229`, `Reducers.js:81,296`, `Planning.js:42` and `ParallelSweep.js:24`. Decision: add `src/core/pilot/Digest.js` implementing RFC 8785 (JCS) semantics that **reject** rather than coerce every case above, parse input with a duplicate-key-aware `JsonStrict.parse`, and prefix the hashed bytes with a domain label and `\u0000` (`plan-v1`, `manifest-v1`, `approval-v1`, `action-v1`, `state-v1`, `audit-v1`). Manifest strings are NFC-normalised as recorded policy before digesting; plan material strings that are not NFC are refused. `Schemas.canonicalJson` is untouched and gains a comment pinning it to Phase 16. Consequences: two canonicalisers coexist, which must be documented so nobody "unifies" them; TM18-D01 golden vectors become a required unit test; some operator JSON that today loads will now be refused, which is the intended direction of error. Status: accepted.

### ADR-0028 — One `PilotActionGate` below every interaction path; unguarded click paths are refused in pilot mode.
Context: `AIHealer._performAction` (`AIHealer.js:362`) clicks with `page.click(selector)` (`:368`), which re-queries and takes the first match, and has four call sites (`:337` inside `_retry.execute`, `:419`, `:586`, `:652`), none of which re-evaluates the healed candidate; `ClickExplorer.clickElement` (`ClickExplorer.js:75-88`) clicks every `a`/`button` and falls back to `getByText(...).first().click()`. A policy check on the original step is therefore not a control at all. Decision: `PilotActionGate.perform({handle, action, value, source})` is the only path to a mutating interaction in pilot mode; it resolves exactly one element (`strictSelectors: true`), verifies the live identity of the **held handle** in one `evaluate`, compares it with the approved identity, and clicks **that handle** with no re-query, no healing and no retry after verification; a `_retry` re-entry after a verified attempt is `PLAN_DRIFT`. `ClickExplorer`, `SiteSweep` and `ParallelDiscovery`'s click path are **refused** in pilot mode (`POLICY_ACTION_DENIED`, reason `unguarded_click_path`) rather than routed through the gate, because a bulk crawler would need an unreviewable approval per control and would become an approval-bypass surface. Non-pilot behaviour is the `2572e73` path via `passthrough()`. Consequences: pilot mode loses bulk discovery (dry-run covers discovery read-only); four healer call sites and one explorer entry point change, which is a wide but shallow edit; the gate becomes security-critical and is reviewed as such. Status: accepted.

### ADR-0029 — An execute-mode network gate armed per approved action.
Context: a classifier cannot see JavaScript click handlers, and the DOM can change inside an `await` gap, so "we only clicked a permitted control" does not imply "nothing mutated". Decision: every pilot context installs `NetworkGate` before any navigation: `serviceWorkers: 'block'`; `javascript:`/`data:`/`blob:`/`file:`/`view-source:` navigations and popups denied; URL userinfo denied; `routeWebSocket` installed with all outbound frames dropped; redirects capped at 10; and in execute mode **every non-GET is aborted unless it matches the single currently armed `{method, origin, canonical path}`**, armed only after a durable approval consume and disarmed in a `finally`. Dry-run additionally aborts GETs to denied routes on allowed origins (AC-026). Per-hop redirect validation is SPIKE-R with a mandated `route.fetch({maxRedirects: 0})` fallback loop. Consequences: a legitimate background `POST` the application makes during a permitted action is aborted, which may surface as application errors in pilot mode and must be documented; interception cost on every request; the gate, not the classifier, is the load-bearing anti-mutation control. Status: accepted.

### ADR-0030 — Fixed pilot roots and a privileged `SafeFs` loader for every pilot file read.
Context: `SafeFs.readBoundedJson` already refuses symlinks and bounds size but does not check owner uid, `nlink` or mode, and `PlanFile.js:175,219` uses `fs.promises.stat`, which follows symlinks; a configurable approvals directory would let an operator (or a confused deputy) point the ledger at a pre-consumption copy; a manifest-chosen `stateFile` is an arbitrary write target. Decision: `PilotRoots` fixes `run/auth`, `run/approvals` and `run/plans` relative to a verified repository root, with no flag, env var or manifest key able to move them; every pilot read goes through `SafeFs.readBoundedPrivateJson` (uid, `nlink === 1`, mode `0600` for state and ledger files, parent-component `lstat`, `resolveUnder`, size caps — manifest 64 KiB, state 1 MiB, ledger 1 MiB — and `JsonStrict.parse`); every pilot write goes through `writeAtomicPrivateSynced` (adds the directory `fsync` missing today) or `createExclusive`; pilot mode is refused on `win32`, where the uid/mode/`O_NOFOLLOW` checks do not exist. Consequences: operators lose the ability to place the ledger elsewhere, which is the point; three additive `SafeFs` exports, no change for existing callers; Windows pilot support is explicitly out of scope and must be stated in the docs. Status: accepted.

### ADR-0031 — Approval identity is a random `approvalId`; state derives from the chain; consumption is an exclusive marker.
Context: keying consumption on the deterministic `bindingId` means an action can never legitimately be re-approved; `approvals.json` was mutable while only `audit.log` was chained, so flipping `consumed` to `approved` in the index would have re-enabled a consumed approval; `rename` is last-writer-wins, so two concurrent consumers could both proceed. Decision: a random 128-bit `approvalId` per record is the consumption key, so re-approving the same binding yields a new id; consumption is `open(consumed/<approvalId>, "wx", 0600)` + file `fsync` + directory `fsync`, completed **before** dispatch, so `EEXIST` is `APPROVAL_REPLAYED` under concurrency and across `SIGKILL`; state is derived — marker, then the verified audit chain — and `approvals.json` is a cache rebuilt from the chain at `open()`. Exclusive markers are chosen **over** restricting protected actions to sequential mode because the sequential restriction would make worker-mode coverage differ from sequential and break **AC-021**, and would constrain **AC-051**; with markers both criteria hold unchanged. Consequences: the approvals root must be on a local POSIX filesystem (checked, non-local refused); a crash between consume and dispatch loses the action, which is the correct bias; the marker directory grows and is covered by retention. Status: accepted.

### ADR-0032 — Run scope is a minted run token claimed exactly once.
Context: OD-02 requires run-scoped approval, but a run that hits `APPROVAL_REQUIRED` exits 14 and a later run has a different runId, so `grantedForRunId` could never match and every approval would be permanently `APPROVAL_STALE`; the runId's source was undefined. Decision: the approve command mints `runId` and `nonce` (128 bits each), records `runIdHash` and `grantedAt` in the record, and prints `<runId>.<nonce>` once to stdout; the execute run presents it via `--approval-run-token=` and **adopts `runId` as its own run id**, so `grantedForRunId` matches by construction; first use creates `runtokens/used/<runId>` with `O_EXCL`, so exactly one execute can use it and a replay is `APPROVAL_RUN_TOKEN_INVALID`. TTL is 1800 s measured from `grantedAt`, checked at policy step 7 and again immediately before consume. Consequences: approval becomes a two-command workflow that must be documented in the operator guide; the token is a short-lived bearer secret and is registered with the evidence boundary so it cannot reach an artifact; CI must pass the token through a step output, not a log. Status: accepted.

### ADR-0033 — Audit segments with a never-pruned anchor chain instead of chain-breaking retention.
Context: a single hash-chained `audit.log` plus 90-day pruning is self-contradictory — pruning breaks the chain, so verification either fails forever (denial of service) or must be relaxed (which removes the control) — and re-verifying an unbounded history at every `open()` is itself a growth problem. Decision: the log is segmented (sealed at 4096 entries or 30 days); sealing appends a ~200-byte anchor `{segmentId, firstSeq, lastSeq, entryCount, headHash, sealedAt, prevAnchorHash, anchorHash}` to a separate, never-pruned, hash-chained `anchors.log`; retention prunes whole sealed segment bodies only and records a `segment-pruned` entry in the live segment; `verify()` verifies the anchor chain plus the live segments. Consequences: pruned entries are no longer individually readable, only provably unaltered, which is an accepted loss of detail; `open()` cost is bounded; the anchor file becomes the single most integrity-critical file and its loss is `APPROVAL_HISTORY_TAMPERED`. Status: accepted.

### ADR-0034 — `falconBuild` is always determinate: git SHA with a dirty marker, or a fixed-file-list source digest.
Context: rev 1's "the git SHA when available" fails open — an exported tarball or a CI checkout without `.git` would silently drop the field and let an approval survive a Falcon change; an uncommitted edit to the classifier would also survive. Decision: `BuildIdentity.falconBuild()` returns `{packageVersion, policySemanticsVersion, vcs}` where `vcs` is `{kind:"git", sha, dirty}` (with `dirty` part of the binding, so any uncommitted edit invalidates outstanding approvals) or, when git is unavailable, `{kind:"source", digest}` over the sorted `{relPath, sha256}` list of a fixed, code-owned set of security-relevant files; if neither is computable the run refuses `PILOT_INTERNAL_ERROR`. There is no `"unknown"`. Consequences: developers with a dirty worktree must re-approve after every edit, which is correct but noisy and must be documented; the fixed file list is a maintenance obligation asserted by a unit test; `git` absence costs one directory walk at startup. Status: accepted.

## 19. Traceability (P18-AC-001..082)

Verification types: U = unit, R = regression (hermetic fixture), I = integration/CI job, S = static/CI check, D = doc check.

Rows below merge the revision 1 table with the revision 2 amendments (rev 2 wins where both exist).

| AC | Component | Verif |
|---|---|---|
| 001 | AuthStateStore.exportState, EvidenceBoundary, SecretRegistry encoded forms | R + canary |
| 002 | AuthStateStore.importState (strict cookie schema, readBoundedPrivateJson) | U, R |
| 003 | LoginSetup (exact selectors, top-frame password, origin check), AuthStateStore 0600 | R |
| 004 | LoginSetup, FailureCodes(AUTH_LOGIN_FAILED), EvidenceBoundary | R |
| 005 | Manifest secret-literal screen + 64 KiB pre-screen cap (OD-15) | U, R |
| 006 | PolicyEngine step 4, AuthStateStore | R |
| 007 | AuthEvidence, ReportManager coverage | R |
| 008 | AuthEvidence | R |
| 009 | AuthEvidence | R |
| 010 | AuthEvidence (fail closed), fixture oracle | R |
| 011 | AuthEvidence + ReportManager step marking | R |
| 012 | FailureCodes enum incl. the six new codes | U, S, D |
| 013 | FailureCodes.exitCodeFor (12 vs 1/2; 18 vs 17) | U, R |
| 014 | PolicyEngine AUTH_ROLE_REQUIRED, Manifest anonymous role | R |
| 015 | AuthEvidence + fixture login-request counter | R |
| 016 | Manifest roles + PolicyEngine route/role | R |
| 017 | StateCopyPool + source fingerprint | U, R |
| 018 | StateCopyPool per-context copies | R |
| 019 | PilotLifecycle cleanup (exit call sites, signals, uncaught, unhandled) | U, R |
| 020 | StateCopyPool sequential path | R |
| 021 | parallel/Runner role assignment; coverage equality **under exclusive consume markers** | R, I |
| 022 | ShardBundle allow-list + merger refusal of excluded types (OD-17) | U, R |
| 023 | parallel shard auth check + ShardMerge | R |
| 024 | Manifest MANIFEST_ROLE_UNKNOWN | U, R |
| 025 | DryRunGuard counters | R |
| 026 | NetworkGate dry-run mode incl. GET-to-denied-route abort | R |
| 027 | DryRun no-provider path + per-boundary transport guard | R |
| 028 | DryRun fingerprint/checksum compare | R |
| 029 | PilotPlan deterministic serialisation via Digest.canonicalise, no `ordinal` | R |
| 030 | PlanDigest material/excluded lists + TM18-D01 golden vectors | U |
| 031 | PolicyEngine step 8 (file digest) | R |
| 032 | PlanDigest drift at step 11 + ApprovalStore invalidation | R |
| 033 | PilotPlan v2 reader — **BLOCKER-1 unchanged, owner input still required** | U, R |
| 034 | DryRun vs fixture oracle manifest | R |
| 035 (S) | Plan row policy outcome + summary counts | U, R |
| 036 | ManifestSchema strict | U |
| 037 | ManifestSchema version | U |
| 038 | docs/pilot/manifest-reference.md sync check | S |
| 039 | PolicyEngine step 2 (incl. subresources, OD-08) | R |
| 040 | PolicyEngine step 3 | R |
| 041 | Budget enforcement | R |
| 042 | ActionClassifier matrix incl. NFKC/confusable/bidi cases, no `ordinal` | U, R |
| 043 | ActionClassifier any-destructive-signal rule | U, R |
| 044 | Vocabulary from manifest | U, R |
| 045 | applyProviderAdvice monotonic | U, R |
| 046 | PolicyEngine provider-absent path | U, R |
| 047 | PilotActionGate across all four healer tiers + explorer refusal | U, R |
| 048 | PolicyEngine step 6 before step 7 | U, R |
| 049 | ActionClassifier ambiguity, CONTROL_AMBIGUOUS | R |
| 050 (S) | Manifest artifacts policy + playwright.config pilot project | R, S |
| 051 | ApprovalStore + run token + CSRF fixture + armed NetworkGate | R |
| 052 | PolicyEngine step 7 | R |
| 053 | approval/Binding — eight fields | U, R |
| 054 | ApprovalStore staleness | U, R |
| 055 | ApprovalStore durable exclusive consumption across restart and concurrency | R |
| 056 | ApprovalStore lookup | U |
| 057 | AuditLog entry shape | U, R |
| 058 (S) | AuditLog chain + anchors + verify() after a prune | U, R |
| 059 (C) | Dashboard read-only approvals view | R — **OPEN-2: Could, descoped unless budget allows** |
| 060 | EvidenceBoundary + CanaryRegistry, 5 run shapes, all encoded forms, rotation, DEBUG | R |
| 061 | EvidenceBoundary on stdout/stderr | R |
| 062 | Dashboard events + HTML escaping | R |
| 063 | provider-prompt capture at SDK transport boundary | R |
| 064 | error serialisation through boundary | U, R |
| 065 | ElementFactsCollector + HealingReport | U, R |
| 066 | HTML escaping + ANSI/control stripping | U, R |
| 067 | ShardBundle allow-list | U, R |
| 068 (S) | Retention.js segment-aware, lstat-only, confined + docs | U, D |
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

**New components added by rev 2** (each needs its own rows): `Digest`, `JsonStrict`, `PilotRoots`, `SafeFs` extension, `PilotActionGate`, `NetworkGate`, `RouteMatch`, `BuildIdentity`, `RunToken`, `SecretRegistry`, audit anchors, `playwright.config.js` pilot project.

### 19a. SEC-02 item → design section → negative test

Every negative test lives under `tests/regression/pilot/` (or `tests/unit/pilot/` where marked U) and must **fail** against this design with the named control removed.

| SEC-02 item | Design section | Negative test |
|---|---|---|
| L01 encoded forms | 10 | `neg-l01-encoded-forms` — six canaries in every derived encoded form across five run shapes; zero hits; **fails when the registry is disabled** |
| L01 registration timing | 10 | `neg-l01-rotation` — cookie rotated mid-run by `Set-Cookie`; rotated value absent from every artifact |
| L01 short values | 8a, 10 | `neg-l01-short-secret` (U) — a 3-byte credential is refused, not redacted |
| L01 `sanitizeObject` keys | 10 | `neg-l01-secret-key` (U) — a registered value used as an object **key** is redacted |
| L01 `DEBUG=pw:*` | 10 | `neg-l01-debug-pw` — run with `DEBUG=pw:api` refuses `PILOT_INTERNAL_ERROR` (exit 18), zero canary bytes on stderr |
| L01 sink inventory | 10 | `neg-l01-sink-scan` (U/S) — a planted module using `fs.writeFileSync`/`console.log`/`res.json`/`screenshot({path})` without the boundary fails the scan |
| L03 artifacts | 4, 7a, 7b | `neg-l03-runner-artifacts` — forced failure through the Playwright runner's pilot project: zero `png`/`webm`/`zip`/`har` under the output root **and** `test-results/`; `traces: "trace-on"` in a manifest for an authenticated role is `MANIFEST_INVALID` |
| P01 forgery / edit | 9 | `neg-p01-chain` — one byte edited; a middle line deleted; `approvals.json` `consumed`→`approved`; a deleted consume marker; `localhost` vs `127.0.0.1`; each yields a code and zero clicks |
| P01 truncation | 9 | `neg-p01-truncate` — tail truncation detected via anchors and marker/chain disagreement |
| P02 replay | 9, 13 | `neg-p02-replay` — `SIGKILL` between consume and click then restart → `APPROVAL_REPLAYED`, zero POSTs; two concurrent consumers → exactly one click; re-issued approval for the same binding gets a new `approvalId` |
| P03 TOCTOU | 5 (10–12), 5a | `neg-p03-swap` — form action swapped 50 ms after verification; swapped during an `await` gap; Tier 1 `_retry` re-entry; count > 1 at resolve; each → `PLAN_DRIFT`/`CONTROL_AMBIGUOUS` and zero POSTs |
| D01 canonicalisation | 8, ADR-0027 | `neg-d01-vectors` (U) — TM18-D01 golden vectors: `undefined`, `[undefined]`, `-0`, `NaN`, `Date`, lone surrogate, duplicate key, non-NFC, cross-domain collision attempt; each refused or distinct |
| N01 origin/network/redirects | 7, 7a | `neg-n01-network` — 302 to a second loopback origin; cross-origin form post; `<img>` to a denied origin; service-worker registration; WebSocket send; `javascript:` popup; URL userinfo; dry-run GET to a denied route on an allowed origin; 11-hop redirect; second server records zero requests |
| F01 file loading | 2a, 9, 11, ADR-0030 | `neg-f01-loaders` — for all four loaders (`importState`, `Manifest.load`, v2 `PlanFile` reader, `ApprovalStore.open`): symlink, symlinked parent component, foreign owner, `nlink > 1`, mode `0644`, oversize, non-UTF-8, duplicate key, path escaping the root; each refused with a code and zero target requests |
| B01 choke point | 5a, ADR-0028 | `neg-b01-gate` — AC-047 View-to-Delete across all four healer tiers (`:337`, `:419`, `:586`, `:652`), plus a `SiteSweep`/`ClickExplorer` run under an authenticated role; zero clicks and zero provider prompts |
| L02 error text | 10 | `neg-l02-error` — `TestRunner` row with a failed `fill` carrying a canary value; report holds `{code, errorClass, boundedRedactedMessage}` and zero canary bytes (H1) |
| L04 shard merge | 10 | `neg-l04-merger` (U) — a bundle containing state / locator memory / healing evidence is refused, not merged |
| L05 fill values | 10 | `neg-l05-fill-identity` (U) — fill values and credential-semantic `select` values absent from locator memory, scores and identity |
| L07 baseUrl | 4 | `neg-l07-userinfo` (U) — `https://u:p@host` in `baseUrl` or any allow-list entry refused; 65 KiB manifest refused before the secret screen |
| L08 ignore check | 4 | `neg-l08-ignored` — a `stateFile`/`--save-state` path not covered by `git check-ignore` is refused; with `git` removed from `PATH` the run also refuses (fails closed) |
| P04 build identity | 9, ADR-0034 | `neg-p04-build` — dirty worktree invalidates an approval; `.git` removed → source digest used and a modified source file invalidates; neither available → `PILOT_INTERNAL_ERROR` |
| B03 confusables | 6 | `neg-b03-homoglyph` (U) — Cyrillic-`е` "Delete", zero-width-joined "De​leteValue", bidi-wrapped label, `title`-only destructive term; each classified protected |
| B04 ordinal | 6, 8 | `neg-b04-ordinal` (U/R) — two identical controls → `CONTROL_AMBIGUOUS`; `ordinal` absent from `actionId`, the material view and the serialised plan |
| B05 provider scope | 5 | `neg-b05-provider-index` (U) — provider advice naming an out-of-index locator is ignored; Tier 3 free-text locator never executed in pilot mode |
| R01 profile | 7, 7a | `neg-r01-userdatadir` (U) — no persistent user-data dir on any pilot context |
| F02 pre-existing paths | 17 | `neg-f02-planted` — planted `execution.log` symlink (H4), `0777` `run/auth`, foreign-owned `run/approvals`; each repaired or refused; directory `fsync` asserted via a spy |
| F03 orphans and exits | 17 | `neg-f03-orphans` — stale copy dir with a dead PID swept, live PID left; `process.exit`, `uncaughtException` and `unhandledRejection` paths all clean up (asserting `beforeExit` is not relied upon) |
| X01 dashboard | 9, 10 | `neg-x01-escape` — all five HTML metacharacters escaped; a non-enum `code` field is rejected before render |
| S01 caps | 5, 9 | `neg-s01-caps` — per-page control and DOM-text caps; 11-hop redirect; 1 MiB+ ledger and plan refused; `open()` cost bounded by anchors after a prune |
| E01 fail closed | 1, 14 | `neg-e01-internal` — injected throw in `sanitize`, in `Digest`, in the approval store and in a route handler: nothing written, zero clicks, exit **18** (`PILOT_INTERNAL_ERROR`), and 18 ≠ 17 asserted |
| Plan values (question C) | 8a, 14 | `neg-q-plan-values` — `Summer2026!` as a `type` value for a `type=password` target refused `PLAN_VALUE_LITERAL_CREDENTIAL` (exit 15) at both dry-run write and v2 load; `{env:NAME}` accepted; digest covers the name, not the value |
| Confused deputy — Retention | 17 | `neg-q-retention` — planted symlink inside the run dir is skipped and reported, never followed; nothing outside `PilotRoots` is a candidate |
| Confused deputy — audit pruning | 9, ADR-0033 | `neg-q-prune` — prune a sealed segment, then `verify()` still passes via anchors; tamper with a pruned segment's anchor → `APPROVAL_HISTORY_TAMPERED` |
| Confused deputy — fixed roots | 2a, ADR-0030 | `neg-q-roots` — `--approvals-dir`/env/manifest attempts to move the approvals root are rejected (the flag does not exist; a pre-consumption copy placed elsewhere is never read) |
| Run scope / TTL | 9, ADR-0032 | `neg-q-runscope` — approve mints a token; one execute consumes it; a second execute with the same token → `APPROVAL_RUN_TOKEN_INVALID`; no token → `APPROVAL_STALE`; consume at 1801 s from grant → `APPROVAL_STALE`; token absent from every artifact |
| N1 non-GET gate | 7a | `neg-n1-fetch-post` — permitted "View" firing a JS `fetch` POST: aborted, `POLICY_NETWORK_BLOCKED`, server mutation counter 0 |
| N2 review vs digest | 12 | `neg-n2-review` (U) — a review recorded for digest A does not carry to a different plan file with digest B |
| N3 stateFile root | 2a, 4 | `neg-n3-statefile` (U) — `stateFile: "../../etc/x"`, an absolute path, and a symlinked parent each refused |
| N4 route canonicalisation | 5, RouteMatch | `neg-n4-routes` (U) — `%61dmin`, `/Admin`, `//admin`, `/admin;x=1`, `/admin/`, `/admin/..%2f`, over-long encodings: all denied; undecodable denied |
| N5 material sinks | 10 | `neg-n5-material` (U) — a canary reaching `planFile` or `approvalAudit` refuses the write; substitution is not attempted (asserted by spying that `sanitize` is not called for those sinks) |
| N6 assertClean always on | 10 | `neg-n6-production-mode` — with `NODE_ENV=production` and no debug flag, a planted leak still refuses |
| N7 LoginSetup | 11 | `neg-n7-login` — password fill attempted in an iframe, on a non-password field, after an off-origin redirect, or with a text-heuristic locator: each refused, zero fills |
| N8 per-boundary dry-run | 7 | `neg-n8-mixed-process` (U) — a dry-run boundary and an execute boundary in one process: the provider call on the dry-run boundary is blocked regardless of order |
| SPIKE-R | 7a | `spike-r-redirect-hops` — records the observed Playwright behaviour; if hops are not individually intercepted, the `route.fetch({maxRedirects:0})` fallback is the shipped implementation and `neg-n01-network`'s 302 case must pass through it |

Flags: **BLOCKER-1** (AC-033 vs AC-076 — owner must confirm the scoping; unchanged by this revision). **OPEN-1** (AC-072 budget number requires measurement first, protocol in OD-13). **OPEN-2** (AC-059 Could; AC-070 deferred by OD-14; AC-035/050/058/068/072/079 are Should). **OWNER-RISK** (section 6 threat-model residual risks, PII in literal plan values, same-uid ledger rollback, and Windows pilot being out of scope — none accepted yet). **SPIKE-R** (redirect hops, fallback mandated).

No Must criterion is unsatisfiable as written, with the single exception recorded as BLOCKER-1. No change in this revision weakens a Must criterion or any of OD-01..OD-19.

## 20. Resolved parameters

**OD-03 — digest.** SHA-256 over `Digest.canonicalise(materialView(plan))` with the domain prefix `plan-v1`, output `"sha256:<64 hex>"`. `Schemas.canonicalJson` is **not** used by Phase 18 (ADR-0027); OD-03's requirement is "SHA-256 over canonical JSON", which `Digest` satisfies strictly. Material: `version`, `manifestRef.{version,digest,manifestRevision,normalised}`, `role`, `targetOrigin`, `journey`, and per action `actionId`, `action`, `routePath`, `locator`, `check`, `attribute`, `valueRef`, `classification`, `requiresApproval`, `assertionDeclarations`. Excluded: all timestamps, `runId`, run tokens, worker/shard ids, absolute and host paths, durations, counters, artifact and report paths, dashboard event ids, provider id/model/telemetry, `falconBuild`, approval records, log text, `ordinal`, and anything credential-bearing. Manifest revision digest uses the same construction with domain `manifest-v1` over the normalised manifest; binding uses `approval-v1`; `actionId` uses `action-v1`; audit entries use `audit-v1`; state fingerprints use `state-v1`.

**OD-04 — numeric defaults and hard maxima.** Table as rev 1 (`maxPages` 10/100, `maxActionsPerPage` 25/200, `runSeconds` 300/1800, `authTimeoutSeconds` 15/60, approval cap 1800 s, artifact retention 7 days, audit retention 90 days), plus:

| Parameter | Default | Hard max | Justification |
|---|---|---|---|
| approval TTL measured from | `grantedAt` | 1800 s | removes the rev 1 ambiguity; equals the run-budget max |
| redirect hops per navigation | 10 | 10 | S01/N01; exceeding is `POLICY_REDIRECT_LIMIT` |
| manifest file size | — | 64 KiB | checked before any content screen (L07) |
| state file size | — | 1 MiB | storageState with a realistic cookie set |
| approval ledger / plan file size | — | 1 MiB each | bounds `open()` and load cost (S01) |
| registered secrets | — | 512 values | breach refuses the run rather than dropping a registration |
| per-page DOM text extracted | — | 256 KiB | S01 |
| audit segment seal | 4096 entries or 30 days | — | bounds `verify()` at `open()` (ADR-0033) |
| orphan sweep age | 24 h | 1000 entries | F03 |

Any manifest value above its hard max is `MANIFEST_INVALID`; each maximum has a max and max+1 test, matching the Phase 16 convention.

**OD-10 — exit codes.** 10 manifest, 11 auth setup, 12 auth loss, 13 policy, 14 approval, 15 plan binding, 16 identity, 17 safety invariant, **18 internal fail-closed**. `PLAN_INVALID` stays 2. `0/1/2/3` keep today's meanings.

**OD-12 — npm script and CI gate.** As rev 1, plus: the `pilot` CI job runs `npm run test:pilot` through the `playwright.config.js` **`pilot` project** (so the artifact overrides in section 7b are the ones under test), adds a step asserting zero `png`/`webm`/`zip`/`har` under `run/pilot-test-results/` and `test-results/` after the job, and adds a step that fails if `DEBUG` is set in the job environment. GoogleSearchTest stays out of CI (AC-075).

**OD-13 — dry-run budget measurement protocol.** Unchanged from rev 1 (10 runs, discard warm-up, p95 × 1.5 rounded up to 10 s, hard upper bound 180 s, re-measure on material change). The number is still absent until the measurement exists (OPEN-1).
