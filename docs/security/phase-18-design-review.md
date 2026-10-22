# Phase 18 Security Design Review (SEC-02)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `e589247` (base `2572e73`). Inputs: [threat model](phase-18-threat-model.md), [architecture](../architecture/phase-18-authenticated-pilots.md), [plan](../phase-18-plan.md), [acceptance criteria](../phase-18-acceptance-criteria.json).

**Verdict: BLOCK (design).** Of the ten blockers, one is resolved, six are partially resolved and three are not addressed; the review also found eight new risks introduced by the design. Product implementation stays blocked until the architecture is revised and re-reviewed. No condition conflicts with an owner decision (OD-01..OD-19) or a Must criterion.

Status of each item below is as of `e589247`. This record is not updated when the design changes; the re-review (SEC-03) supersedes it.

## A. Blockers

| ID | Status | Missing design requirement | Required negative test |
|---|---|---|---|
| L01 known-value redaction | PARTIAL | (1) The redaction pipeline must also cover URL-encoded, form-encoded (`+`), base64, base64url, JSON-escaped and HTML-entity forms of every registered value; today encoded forms appear only in the test grep. (2) Specify registration timing: manifest env values at manifest load before browser launch; imported cookie and localStorage values individually, not as one state blob; cookies rotated by Set-Cookie during the run (response listener or `context.cookies()` diff before each sink flush); Authorization and CSRF values registered synchronously in the request handler. (3) Rule for values of 3 bytes or fewer (refuse the credential or document it). (4) `sanitizeObject` redacts keys too. (5) In pilot mode refuse or strip `DEBUG=pw:*`, which writes to stderr and bypasses `Logger`. (6) The sink-inventory scan also covers `fs.writeFileSync`, `appendFile`, `createWriteStream`, `res.json`/`res.send`, `process.stderr`, `console.*`, `screenshot({path})` and tracing | Six canaries in every encoded form across five run shapes, plus a cookie rotated mid-run and `DEBUG=pw:api`; zero hits; must fail when the registry is disabled |
| L03 screenshots, traces, HAR, video | PARTIAL | `traces` must accept only `"none"` for authenticated roles; HAR and video must be structurally off. `playwright.config.js` sets `screenshot: "only-on-failure"` and `video: "retain-on-failure"`, so a pilot test run through `@playwright/test` would retain authenticated pixels; the pilot project must override both. `VisualRegression` must consult the policy. Password and credential-semantic inputs are always masked regardless of `maskSelectors` | Forced failure through the Playwright runner produces zero png/webm/zip/har under the output root and `test-results/` |
| P01 approval forgery or edit | PARTIAL | The hash chain covers only `audit.log`; `approvals.json` is mutable, so state changes (approved to consumed) must be derived from the chain or chained themselves. Opening the store needs the F01 file checks. Specify the chain genesis value, domain separation for `bindingId` and `entryHash`, and tail-truncation detection with its stated limit. `targetOrigin` is the WHATWG serialised origin. Docs say "attribution, not authentication". ADR-0023 says seven binding fields but the binding has eight | One byte edited; a middle line deleted; `approvals.json` state flipped consumed to approved; `localhost` versus `127.0.0.1`; each gives a code and zero clicks |
| P02 replay | PARTIAL | No nonce: consumption keyed by deterministic `bindingId` means an action can never be re-approved. Use a random 128-bit `approvalId` as the consumption key. Concurrent consumption is not atomic (rename is last-writer-wins): use an exclusive `consumed/<approvalId>` marker created with `wx` plus fsync, plus a directory fsync, or restrict protected actions to sequential mode in Phase 18. No directory fsync after rename | SIGKILL between consume and click, then restart: `APPROVAL_REPLAYED`, zero POSTs; two concurrent consumers yield exactly one click; a re-issued approval for the same binding gets a new id |
| P03 TOCTOU | NOT ADDRESSED | Step 8 recomputes a plan-level view before execution, not per click; `_performAction` uses `page.click(selector)` (`AIHealer.js:368`), which re-queries and clicks the first match; Tier 1 wraps it in `_retry`. Required: immediately before each protected click, resolve, require count 1, take the ElementHandle, compute identity in one evaluate (role, accessible name, text, type, form action and method, resolved URL, origin), compare with the approved identity, click via that handle; no healing, retry or re-query after verification; `strictSelectors: true` on pilot contexts. The residual JS race needs the network gate N1 | Form action swapped 50 ms after verification; swap during an `await` gap; Tier 1 retry not re-entered; each gives `PLAN_DRIFT` and zero POSTs |
| P06 deny override | RESOLVED | None. Keep the AC-048 negative test | — |
| D01 canonicalisation | NOT ADDRESSED | The design reuses `Schemas.canonicalJson`, which produces the invalid text `{"a":undefined}`, maps `[undefined]` to `[]`, treats `-0` as `0`, turns `NaN` into `null`, serialises `new Date(0)` as `{}`, accepts lone surrogates, and `PlanFile.load` resolves duplicate keys last-wins; plan, manifest and binding digests have no domain separation. Changing `canonicalJson` in place would alter Phase 16 digests (StateJournal, ShardMerge, Reducers, Planning, ParallelSweep). Fix: a new strict `Digest` module with JCS semantics that rejects all of the above, parses with a duplicate-key-aware parser, and uses domain prefixes (plan-v1, manifest-v1, approval-v1, action). NFC normalisation of the manifest is acceptable only as a recorded policy; plan material strings must reject non-NFC | Golden vectors from TM18-D01 |
| N01 origin, network, redirects | PARTIAL | Execute mode has only the step-2 policy check and no context-level interception. Add `serviceWorkers: 'block'`; deny `javascript:`, `data:`, `blob:` navigations and popups; deny URL userinfo; handle WebSocket (`routeWebSocket`) and `sendBeacon`; cap redirect chains at 10. Dry-run aborts by origin only, but AC-026 requires GET only to allowed routes, so a GET to a denied route on an allowed origin must be aborted. Hypothesis H-R: Playwright route handlers may not fire per redirect hop; spike this or use `route.fetch({maxRedirects: 0})` and validate each hop | 302 to a second loopback origin; cross-origin form; `<img>`; service-worker registration; WebSocket send; `javascript:` popup; dry-run GET to a denied route; second server records zero requests |
| F01 file loading | NOT ADDRESSED | The design does not say how `AuthStateStore.importState`, `Manifest.load`, the v2 `PlanFile` reader or `ApprovalStore.open` read files; `PlanFile.load` still uses `stat`, which follows symlinks (`PlanFile.js:175`). Mandate an extended `SafeFs.readBoundedJson` (already lstat, O_NOFOLLOW, fstat, same-fd reads) adding owner uid equals process uid, nlink 1, mode 0600 for state, parent-component lstat via `resolveUnder`, size caps (manifest 64 KiB, state 1 MiB), strict cookie schema with domain inside manifest origins. Manifest `stateFile` resolves under a fixed auth root (N3) | As in TM18-F01, for all four loaders |
| B01 single choke point | PARTIAL | The healer guard requires `policyOutcome === "permit"` but evaluates the original step, not the healed element; `_performAction` has four call sites (`AIHealer.js:337,419,586,652`) and none re-evaluates the healed candidate. The design ignores `ClickExplorer.clickElement` (`ClickExplorer.js:80,88`), used by SiteSweep, ParallelDiscovery and `falcon.js`, which clicks every `a` and `button` and falls back to `getByText(...).first().click()`. Required: one `PilotActionGate.perform(handle, action, value)` below every path evaluating the resolved handle's signals; in pilot mode ClickExplorer and sweep are refused or routed through the gate | AC-047 View-to-Delete across all four tiers, plus a sweep under an authenticated role; zero clicks and zero prompts |

## B. Major and minor threats

| ID | Status | Missing requirement |
|---|---|---|
| L02 | PARTIAL | Persisted errors use `{code, errorClass, boundedRedactedMessage}`; `TestRunner` row `error.message` passes the boundary; verify H1 (fill value in call log) |
| L04 | PARTIAL | The merger must refuse excluded types (state, locator memory, healing) |
| L05 | PARTIAL | State that fill values are never stored, scored or hashed into identity; exclude credential-semantic select values |
| L06 | RESOLVED | Redaction at the SDK transport boundary |
| L07 | PARTIAL | Whole-file 64 KiB cap before the screen; explicit userinfo rejection on `baseUrl` |
| L08 | PARTIAL | `git check-ignore` refusal for `--save-state` and manifest `stateFile`; fail closed |
| P04 | PARTIAL | Dirty-worktree marker; `falconBuild` "when available" fails open: with no git, refuse or use a source content hash |
| P05 | RESOLVED | Writes are CLI-only; the read view depends on the X02 token |
| B02 | RESOLVED | — |
| B03 | PARTIAL | NFKC, case folding, strip zero-width and bidi characters, confusables, `title`/`aria-*` signals; JS click handlers are invisible to the classifier, so the N1 gate is needed |
| B04 | PARTIAL | Remove `ordinal` from identity or forbid index clicks; strictSelectors |
| B05 | PARTIAL | Provider picks only from a policy-filtered index set; the free-text Tier 3 locator (`AIHealer.js:419`) is never executed in pilot mode |
| R01 | RESOLVED | Add "no persistent user-data dir" |
| F02 | PARTIAL | Verify or repair mode of pre-existing dirs and files (`run/`, `execution.log`, H4); directory fsync |
| F03 | PARTIAL | Startup orphan sweep (PID liveness, age); uncaught and unhandled-rejection paths; `beforeExit` does not fire on `process.exit` |
| X01 | PARTIAL | Escape all five HTML characters; enum-validate code fields before render |
| S01 | PARTIAL | Per-page caps on controls and DOM text; redirect cap of 10 or fewer; approval ledger and plan size caps (`open()` re-verifies the full chain every run) |
| E01 | PARTIAL | Fail-closed rule for approval, digest, auth and boundary errors (if `sanitize` throws, nothing is written); add an internal-error code to the enum and exit table |
| X02, R02, N02, S02 | open minor | As in the threat model |

## C. Targeted questions

- **Plan values stored literally.** `isKeyShapedValue` matches only key shapes, so a password such as `Summer2026!` passes; "field semantics" is undefined for plan rows. Any `type` value aimed at a resolved credential-semantic input (`type=password`, or `autocomplete` of `*password`, `one-time-code`, `cc-*`) must be `{env: NAME}`; literals are refused with a new code at both dry-run and load. The digest covers the reference name, not the value. PII in literal values is a residual risk for the owner to accept.
- **Confused deputy.** `Retention.js` must lstat, never follow symlinks, and stay confined via `resolveUnder`. The 90-day audit pruning breaks the hash chain, which means either a denial of service or pressure to relax verification; it needs a signed-anchor or checkpoint design. The approvals directory must be a fixed root, not cwd-relative or configurable, or the operator could point it at a pre-consumption copy. Manifest `stateFile` and the export path go under a fixed root (N3).
- **Run scope and TTL are inconsistent.** A run that hits `APPROVAL_REQUIRED` exits 14; a later run has a new runId, so `grantedForRunId` always fails `APPROVAL_STALE`, and the runId source is undefined. Fix: the approval command mints a random runId and nonce which execute presents once (used-runId ledger), or approval is interactive within the run. Define the 1800 s TTL as measured from grant. This is consistent with OD-02.

## D. New risks introduced by the design

- **N1.** Execute mode has no non-GET network gate, so a permitted "View" with a JavaScript fetch POST mutates. Require that in execute mode every non-GET is aborted unless it matches the currently armed approved action's method, origin and path. This also closes the P03 residual race.
- **N2.** Plan lifecycle records review against the plan path before the digest is bound. Compute the digest first and record the review against the digest.
- **N3.** A manifest-chosen `stateFile` is an arbitrary write target; require `resolveUnder` a fixed auth root.
- **N4.** Route matching lacks a canonicalisation spec (`%61dmin`, `/Admin`, `//admin`, `;` params, trailing slash). Deny matching must fail closed.
- **N5.** `planFile` and `approvalAudit` are boundary sinks; substituting values there silently alters material content. Use `assertClean` refusal there, not `sanitize`.
- **N6.** `assertClean` runs only in debug and test mode, so production artifacts get no leak assertion.
- **N7.** LoginSetup does not say how fields are located. Require exact selectors, no healing or AI, a top-frame `type=password` field on an allowed origin before the fill, and no fill after an off-origin redirect.
- **N8.** The dry-run flag on the global `guardedFetch` is process-wide; mixed runs in one process need it per boundary.

## E. Conditions to lift the BLOCK

Close D01, F01 and P03 fully. Add the missing requirements for L01, L03, P01, P02, N01 and B01, including ClickExplorer. Resolve the plan-values, confused-deputy and run-scope items above, N1 to N7, and E01's internal-error code. Every item needs its negative test in the section 8 security gates of the threat model.

## F. Residual risk the owner must accept (not yet accepted)

The residual risks in section 6 of the threat model, plus PII in literal plan values and same-uid ledger rollback. No risk has been accepted by the owner.
