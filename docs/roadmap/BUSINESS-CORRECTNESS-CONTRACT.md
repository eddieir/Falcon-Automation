# Business correctness contract (proposal for #79 and #77)

Status: **PROPOSED specification, not implemented.** Every name below is a design choice to be confirmed by the Solution Architect and the owner. Existing behaviour is cited from code on `f910c66`. Related: [M1 plan](M1-DETAILED-IMPLEMENTATION-PLAN.md), [strategy](EXECUTION-STRATEGY.md).

## 1. What exists today

| Piece | Where | Behaviour |
|---|---|---|
| Row statuses | `ReportManager.buildReport` | `passed`, `failed`, `skipped`, `quarantined`, `deduped`, `unavailable`. Any other value throws. |
| Run result | same | `NO_TESTS_RUN` if `passed+failed+quarantined+unavailable == 0`; `PASSED` if no `failed` and no `unavailable`; `FAILED` if nothing passed; else `PARTIAL`. |
| Exit code | `generateReport`, `falcon.js` | `0` only for `PASSED`; `1` otherwise; `2` for rejected plan or arguments; merge uses `0/1/2/3`. |
| Assertions | `PlanFile` `expect`, `TestRunner.runExpect` | Four checks: `visible`, `containsText`, `attributeExists`, `attributeEquals`. A failed assertion is reported, never healed. Rows carry an `assertion` object. |
| Quarantine | `FlakinessTracker`, `TestRunner` | Failing quarantined scenarios report `quarantined`, excluded from `failed`, cannot hide a never-passing scenario. |
| Shard merge | `ShardMerge`, `ShardBundle`, `Reducers` | Rejects incomplete bundles; tallies statuses. |
| Approval | `LocatorMemory`, review CLI/dashboard | Approve/reject/rollback of locators; records channel, not person. |

The gap: `passed` has one meaning ("the step did not throw"). Nothing says whether any business fact was checked.

## 2. Two orthogonal axes

Keep the legacy status and add a verification classification. Do not overload `passed`.

**Assertion outcome** (new, per assertion, produced only by the deterministic evaluator):

| Outcome | Meaning |
|---|---|
| `PASS` | The approved assertion was evaluated against sufficient evidence and held |
| `FAIL` | It was evaluated and did not hold |
| `INCONCLUSIVE` | It could not be evaluated: target missing, timeout, evidence absent, contradictory evidence, malformed record |
| `REFUSED` | A safety rule prevented the step or the evidence collection |
| `NOT_TESTED` | The assertion's scope never executed (earlier step failed, page skipped, shard missing) |

**Journey verification level** (new, per journey and per run):

| Level | Condition |
|---|---|
| `BUSINESS_VERIFIED` | At least one *required, approved* assertion exists and **every** required assertion is `PASS` |
| `INTERACTION_ONLY` | Steps ran without error; no required approved assertion exists |
| `UNVERIFIED` | Required assertions exist but any is `INCONCLUSIVE`, `REFUSED` or `NOT_TESTED` |
| `FAILED` | Any required assertion is `FAIL`, or a step error broke the journey |

Precedence for combining required assertions: `FAIL` > `REFUSED` > `INCONCLUSIVE` > `NOT_TESTED` > `PASS`. A set of zero required assertions is never `PASS`; it is `INTERACTION_ONLY` at best.

### Legacy mapping (compatibility)

| Legacy row status | New reading |
|---|---|
| `passed`, row has `assertion` and evaluator returned PASS | assertion `PASS` |
| `passed`, no assertion | interaction counted; contributes `INTERACTION_ONLY` |
| `failed` with `assertion` | assertion `FAIL` |
| `failed` without `assertion` | technical failure; journey `FAILED`; no assertion outcome |
| `unavailable` | with an `assertion`: `INCONCLUSIVE` (target not found). Without one: a technical step failure, so the journey is `FAILED` (WP-79a) |
| `skipped` | `NOT_TESTED` |
| `quarantined` | technical instability only. **A `FAIL` of a required business assertion is not quarantinable** (decision Q1) |
| `deduped` | excluded; never contributes to coverage |

Legacy `result` (`PASSED`/`FAILED`/`PARTIAL`/`NO_TESTS_RUN`) and the default exit code do not change in WP-79a/b. They are joined by a `verification` block.

### Contract-bound versus contractless assertion rows (WP-77F)

A row counts as a *required assertion* only if its assertion record is **contract-bound**: it carries its own `id` and `digest` (`sha256:` plus 64 hex digits) emitted by `verify` or by a shard row that preserved them. A PASS requires a valid id (1–64 chars), a valid digest, and check and locator evidence; otherwise it is `INCONCLUSIVE` with reason code `MALFORMED_ASSERTION`, never `PASS`.

A *contractless* UI `expect` row (assertion has neither id nor digest) is treated as an **interaction**, not a required assertion:

| Outcome | Behavior |
|---|---|
| passed | contributes to `INTERACTION_ONLY` at best |
| failed, unavailable, or quarantined | technical failure; journey is `FAILED`; exit codes unchanged |
| skipped | no contribution; not counted |

Contractless rows never increment `assertions.required`.

**Contradictory approval evidence**: If bound rows in a single run carry more than one distinct valid digest, no bound row can achieve `PASS`. All become `INCONCLUSIVE`, and `reasonCodes` includes the new code `APPROVAL_MISMATCH` (additive).

**Binding-failure row**: The special row with `id: "binding"` and no digest remains `INCONCLUSIVE` / `UNVERIFIED`.

**Compatibility**: Reports are unchanged in shape; the `verification` block is additive. Before this change, a plan with only a passing UI `expect` could be reported `BUSINESS_VERIFIED`. That was a defect against the rule already stated here: a plan with `expect` steps but no contract is `INTERACTION_ONLY`.

## 3. Aggregation invariants (enforced in code and tests)

1. A run is `BUSINESS_VERIFIED` only if it has ≥1 journey, every journey in scope is `BUSINESS_VERIFIED`, and no required assertion is anything but `PASS`.
2. Aggregation is a pure function of rows; reordering rows or adding `deduped` rows changes nothing.
3. A `FAIL` can never be reduced by merging, sharding, quarantine, retry or rerun.
4. A required assertion that did not execute is `NOT_TESTED`, never absent from the count.
5. Contradictory input (the same assertion id twice with different outcomes; an outcome without a contract digest; `PASS` with no evidence object) makes the artifact **invalid**; the consumer rejects it (exit 2 for merge input, per existing merge semantics) instead of choosing one.
6. An `ai-proposed` or unapproved assertion never contributes to any count except a separate `proposedUnapproved` tally.
7. A partial shard set yields `UNVERIFIED` for the missing scope, not a smaller denominator.
8. Optional assertions (`required: false`) are reported and counted separately; an optional `FAIL` produces a warning outcome and never `PASS`-to-fail on its own unless the contract says `severity: "blocking"`. Default is `required: true`; optionality must be written explicitly.

## 4. CLI and CI mapping

| Situation | Default | `--require-verified` (opt-in, proposed) |
|---|---|---|
| All journeys `BUSINESS_VERIFIED` | exit 0 | exit 0 |
| Required assertion `FAIL` | exit 1 | exit 1 |
| `UNVERIFIED` | exit 1 if the legacy result is non-PASSED, otherwise 0 with a printed warning | exit 1 |
| `INTERACTION_ONLY` | exit 0 with a printed notice and `verification.level` in the report | exit 1 |
| Invalid or contradictory result artifact | exit 2 (merge) / exit 1 (run) | same |

No new exit codes are introduced in WP-79; `verification.reasonCodes` in `reports/test-report.json` carries machine-readable detail. Exit 18 (Phase 18 refusal) is reserved by that design and untouched. Changing the default is decision D8 and needs its own announced release.

## 5. Machine-readable shapes (illustrative)

Report extension (additive; existing keys unchanged):

```json
"verification": {
  "schemaVersion": 1,
  "level": "INTERACTION_ONLY",
  "journeys": { "total": 3, "businessVerified": 0, "interactionOnly": 3, "unverified": 0, "failed": 0 },
  "assertions": { "required": 0, "pass": 0, "fail": 0, "inconclusive": 0, "refused": 0, "notTested": 0, "proposedUnapproved": 2 },
  "reasonCodes": ["NO_REQUIRED_ASSERTIONS"]
}
```

Contract file (extends the plan format, versioned; the Solution Architect decides whether it lives inside the plan file or beside it):

```json
{
  "schemaVersion": 1,
  "journeyId": "checkout-basic",
  "requirementId": "CHECKOUT-001",
  "revision": 3,
  "digest": "sha256:…",
  "approval": { "status": "approved", "channel": "cli", "at": "2026-11-02T10:00:00Z", "supersedes": 2 },
  "assertions": [
    { "id": "A1", "required": true, "check": "textEquals", "locator": "[data-testid=order-status]",
      "expected": "confirmed", "provenance": { "source": "spec", "ref": "CHECKOUT-001#status" } },
    { "id": "A2", "required": true, "check": "moneyEquals", "locator": "[data-testid=order-total]",
      "expected": { "minor": 4999, "currency": "USD" }, "provenance": { "source": "independent-calc", "ref": "price table v7" } }
  ]
}
```

Rules: `schemaVersion` unknown → reject. Unknown keys → reject (consistent with `PlanFile` allowed-key lists). `moneyEquals` stores integer minor units and a currency; the parser reads the page value as a decimal string and converts without `parseFloat`; non-integer minor units or floats in the contract are rejected. `digest` is SHA-256 of the canonical JSON without `digest` and `approval`. Because the digest excludes `approval`, **approval state is never read from the contract file**. It lives in a separate approval store keyed by digest; a contract whose digest has no approved entry is `proposed`, whatever its file says. Contracts and the store are parsed with strict JSON that rejects duplicate keys.

## 6. Provenance and approval

Allowed `provenance.source`: `spec`, `human-confirmed`, `fixture`, `independent-calc`, `external-reference`. **`observed` is not allowed** and the validator rejects any value whose `ref` points at a run artifact. A proposal derived from an observed page is stored as `status: "proposed"`, `proposedBy: "ai" | "heuristic"`, and its `expected` field must be supplied or edited by a person before approval; Falcon may suggest *what to check* (locator, check type) but a person supplies *the expected value* unless it is a literal visible in a trusted spec the person cites.

Lifecycle: `proposed → approved | rejected`; `approved → superseded` (new revision, new digest). Any change to `expected`, `locator`, `check` or `required` is a material change: the digest changes and status returns to `proposed`. The store is append-only with a hash chain; if the history cannot be verified (truncated, reordered) Falcon fails closed and treats every contract as unapproved. A rejected or superseded digest cannot regain `approved`; re-approval creates a new revision. Approval records `channel` (cli/dashboard) and a timestamp, and states that no authenticated identity is proven (see CAP-08, CAP-12). Assertion approval is a separate store from locator approval (`LocatorMemory`) and neither can approve the other.

**Store trust boundary (WP-77P).** The hash chain is keyless. It detects accidental corruption and some unauthorized edits (mid-line truncation, reordering, altered events). It does not detect truncation at a line boundary or rollback of the whole store, which can restore an older approved state. It does not authenticate who approved a contract, and a party with write access to the store directory can rebuild a valid-looking history. A digest binds approval to exact contract content, not to a verified approver. Each mutation derives its lifecycle state and baseline fingerprint from one validated read of `events.jsonl` and re-fingerprints the live file once before writing; any difference fails with `LOCK_LOST` and writes nothing. HMAC, signatures or an identity service are out of scope here and require a separate CTO decision.

## 7. Missing evidence

| Situation | Outcome |
|---|---|
| Locator never attached within the timeout | `INCONCLUSIVE` (`TARGET_UNAVAILABLE`), legacy `unavailable` |
| Locator matches more than one element and the check needs one | `INCONCLUSIVE` (`AMBIGUOUS_TARGET`) |
| Evaluator throws or the page closed | `INCONCLUSIVE` (`EVALUATION_ERROR`) |
| Earlier step in the journey failed | later assertions `NOT_TESTED` |
| Evidence object absent or lacking `check`/`locator` on a `PASS` record | `INCONCLUSIVE` (`MALFORMED_ASSERTION`); never PASS (WP-79a) |

## 8. Fixtures (extends M0 harness; oracle is server-side, never the tool's report)

Existing: checkout app (W3), `authServer.js` (W4), `silentSaveServer.js` (W5). New fixtures live next to them and each defect has an independently defined oracle written *before* the assertion is written.

| Family | Cases | Oracle |
|---|---|---|
| Checkout | correct total; wrong total; confirmation without persistence; duplicate order | server order table |
| Authorization | allowed user succeeds; denied user denied; restricted action wrongly succeeds | server action log |
| Form | valid persists; saved banner but data unchanged; invalid input accepted | server record |
| Partial execution | required step skipped; evidence inaccessible; action ok, outcome unknown | harness expectation of `NOT_TESTED` / `INCONCLUSIVE` |
| Safety | destructive action blocked; sensitive op needs authorization; refusal appears in the journey result | harness expectation of `REFUSED` |

Persistence and duplicate-order cases can be asserted from the UI after a reload or on a list page in Stage A. The server oracle belongs to the harness, not to Falcon. Falcon asserting server state directly is Stage B.

## 9. Security implications

- Contracts are data. They are validated, never evaluated as code. No `eval`, no custom JS in contracts in Stage A (custom Playwright assertions are Stage C).
- `provenance.source` is a label the writer chooses, so it proves nothing alone; the reviewer confirms it and the approval record stores who confirmed it by channel. AI proposals carry no `provenance`.
- Evidence masking: report evidence is length-capped and values from input fields (`valueEquals`) are masked, never stored raw as `actual`. `Redact.js` refuses rather than masks and its 40-hex rule would flag `sha256:` digests, so the report path needs its own masking, specified and tested in WP-79a/77b.
- Page text is untrusted. Evidence stored in reports is length-capped and redacted by the existing redaction path (`src/production-cycle/Redact.js` is the model; the report path needs its own check).
- AI proposals are untrusted input: schema-validated, `expected` stripped unless a person supplies it, never executed as required before approval.
- Stage B adapters (API, database) must use their own configured credentials and an allowlist; the browser agent gets no direct database or secret access.
- Mock provider tests do not certify live provider behaviour (G-04).

## 10. Migration

Plans and reports from before this change load unchanged. A report without `verification` is read as `level: "UNKNOWN"`. Saved plans gain nothing implicitly: a plan with `expect` steps but no contract is `INTERACTION_ONLY` until an approved contract binds the steps. Rollback: the `verification` block is additive, and `--require-verified` is opt-in, so reverting the change does not invalidate stored reports.

## 11. Open questions for the owner

Q1 non-quarantinable business FAIL (recommended yes). Q2 whether optional-assertion failures may ever block (recommended: only with explicit `severity: "blocking"`). Q3 default flip timing (D8). Q4 contract placement: Architect review recommends beside the plan, bound by `journeyId` and `digest` (owner to confirm).

## WP-77a implementation status

`src/core/outcome/Contract.js` (strict parse, canonical digest) and `src/core/outcome/ContractStore.js` (hash-chained approval log) are implemented. Nothing executes assertions yet and no plan, runner or report path reads them.

Known limitations, recorded from the WP-77a security review and not yet fixed:

- **P2 resolved.** Every mutating call now takes a per-journey lock file (`events.jsonl.lock`, `wx`, mode 0600, `{pid, token, at}`) before reading state, re-reads and re-verifies the whole chain under that lock, and re-checks lock ownership plus an events-file content fingerprint immediately before the final atomic write; mismatch aborts with `LOCK_LOST` and writes nothing. Two processes racing to approve/reject (or approve/approve) the same digest no longer lose an event: one wins, the other observes the committed state or a clean `INVALID_TRANSITION` or `LOCK_TIMEOUT` error. Covered by `tests/unit/ContractStoreConcurrency.check.js` using real child processes.
- **Stale-lock steal race (found and fixed in the follow-up review of PR #122).** The first implementation stole a stale lock by renaming it aside. Two waiters that judged the same stale lock stale could displace the winner's live lock; a third writer could then take the lock while the winner was between its final ownership check and its rename, and both would commit (a lost event). `tests/unit/ContractStoreConcurrency.check.js` reproduces this deterministically with separate processes and pause points (it fails 5 of 5 on the rename-based logic and passes 10 of 10 on the fix). Stealing is now serialized by a short-lived mutex file (`events.jsonl.lock.steal`): under it the lock is re-read and unlinked only if it is still the exact stale content judged earlier. While a stale lock file exists nobody can create a fresh one, so only a mutex holder can change it. No `.stale-*` files are created any more.
- Residual limits, documented in `ContractStore.js`: single host and one pid namespace (not NFS-safe); no external anchor (whole-store rollback to an earlier self-consistent copy is undetected); cutting the log at a line boundary is undetected; no identity is authenticated (`channel` and `at` are labels). Live-owner exclusivity, including the gap between the final ownership check and the rename in `writeChain`, relies on: (a) `wx` being an atomic exclusive create; (b) `process.kill(pid, 0)` reporting liveness truthfully; (c) the steal mutex is never recovered automatically (issue #125, R1-B; former residual R1 is retired): no process unlinks a mutex it does not hold, so a delayed recoverer can no longer remove a fresh mutex, which was the former P3 double-hold path. A leftover mutex (dead owner, empty or unparseable) makes writes to that journey fail closed with `LOCK_TIMEOUT` until an operator removes it by hand (availability only, data stays safe; this widens the availability residual R2); (d) nobody with write access to the store directory deleting a live lock by hand. The final rename has no compare-and-swap, so a live owner wrongly judged dead can lose to a later writer. A hung live holder is never stolen from and makes other writers fail closed with `LOCK_TIMEOUT`.
- Approving an older never-approved revision supersedes a newer approved one (revision order is enforced at propose only). Approvals on the `test` channel count in `isApproved`. Error text for internal failures can include a raw exception message. For in-memory object input, validation and digest read the object at different times.

Conditions for WP-77b: the store must not be committed to the repository (a committed self-consistent chain would be a forged approval); the executor must recompute the digest from the contract it actually runs, with that contract's own `journeyId`.

Residual P3 findings from the PR #122 hardening security review (revision 38e2ec2, no P0/P1/P2), accepted for WP-77a and to be addressed before WP-77b wires the store into execution or the dashboard:

- **Partially resolved (G77B-01, issue #125).** A FIFO, directory, socket, device or oversized file at `events.jsonl` (or the lock file) no longer blocks or exhausts memory: `readStoreFile`, `fileFingerprint` and `readLockRaw` open with `O_NONBLOCK`, decide the file type from the open handle's own `fstat`, enforce `MAX_STORE_BYTES`, and compare a post-open `lstat` (dev, ino) against the handle. Follow-up hardening (issue #125, PR #126): the `readStoreFile` size cap and the post-open identity check of both readers have standalone mutation-killing tests (FH11-FH13); `fileFingerprint` reads through a bounded loop, and any `err:*` fingerprint aborts the write with `LOCK_LOST` instead of comparing equal. Still open: `loadChain` and `fileFingerprint` each read the file (a second read), so a non-cooperating writer could change it between them. This is a required WP-77b prerequisite (derive the fingerprint from the bytes `loadChain` read).
- **Resolved (G77B-02, issue #125).** `lockTimeoutMs`, `lockStaleMs` and `lockRetryMs` are validated (safe integers only; timeout and stale 1 to 300000 ms, retry 1 to 60000 ms and never above the timeout). Invalid values return `INVALID_LOCK_OPTION` before any lock or file access, so they cannot bypass locking. Defaults are unchanged.
- A recycled pid, a future-dated lock mtime, or a hung live holder blocks writes to that journey until the holder exits or the lock is removed by an operator. Containers with separate pid namespaces are not covered.
- **Resolved (G77B-03, issue #125).** `ContractStore.defaultStoreRoot()` resolves to `<repoRoot>/data/outcome-approvals` (`repoRoot` derived via `path.join(__dirname, '..', '..', '..')`); `resolveStoreRoot(overrideRoot, repoRoot)` is the fail-closed gate a caller uses to get either that default or a validated override, rejecting a non-string/empty value, embedded NUL bytes, a literal `..` traversal segment, a non-absolute override, or (for the default only) a `data`/`outcome-approvals` ancestor replaced by a symlink leading outside `repoRoot` — all with `{ ok: false, code: "INVALID_STORE_ROOT" }`. `propose`/`approve`/`reject`/`status`/`isApproved` are unchanged: they still take an explicit `root` and never call this default themselves. The default directory is covered by the repo's broad `data/` `.gitignore` rule and by its own narrow, anchored `/data/outcome-approvals/` entry so it survives if the broader rule is ever narrowed; it is not in `package.json`'s publish set and is never uploaded as a CI artifact (CI only restores/uploads specific allowlisted `data/*.json` tracker files). Covered by `tests/unit/ContractStoreDefaultLocation.check.js` (GS01-GS11), including a real `git check-ignore`/`git status` check against this checkout and a hand-forged-file-presence-is-not-approval regression. Operator note: the default directory does not exist until first use; create it (`mkdir -p data/outcome-approvals`) or let the first `resolveStoreRoot()`-based caller do so before calling `propose`, same as any other store root. Follow-up (issue #125): for the default root, `resolveStoreRoot` now rejects ANY symlink among the `data` / `data/outcome-approvals` components, including one that points at another directory inside the repository.
- **Out of scope here, required before WP-77b (G77B-03 downstream gate, issue #125):** execution-time digest binding. A valid, hash-chained, git-ignored `APPROVED` event for a digest says nothing about whether the executor is about to run the *same* contract body that digest was computed from. WP-77b must recompute the digest from the exact contract it executes (same `journeyId`) and compare it before trusting any `isApproved` result for that run; this file's `isApproved`/`status` only certify the store's own internal history, never the caller's input.
- Windows and NFS/shared filesystems were not examined and are unsupported.

### Operator recovery for a stuck steal mutex or lock file

This is the only way to clear these files: Falcon never removes a leftover steal mutex itself. Applies when writes to one journey fail with `LOCK_TIMEOUT` and an `events.jsonl.lock.steal` file (empty, unparseable, or left by a dead process) or an old `events.jsonl.lock` file sits in `<store root>/<journeyId>/`. The failure is fail-closed: nothing is written, committed events are unchanged, and the lock files hold only a pid, a random token and a timestamp (no contract content).

1. Stop every process that may use the store, or confirm none is running. If the file is parseable, check its `pid` with `kill -0 <pid>`; a live pid means wait, do not remove.
2. List the directory (`ls -la <store root>/<journeyId>/`). Remove only `events.jsonl.lock.steal` and, if its pid is dead, `events.jsonl.lock`. Never delete or edit `events.jsonl`.
3. Check the history before resuming writes: `node -e 'require("./src/core/outcome/ContractStore").status(process.argv[1],process.argv[2],process.argv[3]).then(r=>console.log(JSON.stringify(r)))' <store root> <journeyId> <digest>`. `integrity` must be `ok`. If it is `broken`, stop and treat the store as untrusted: every contract in it stays unapproved until the history is explained.
4. Resume normal operation. Record the incident (time, journey, what was removed) in the operator log.

## Navigation assertions (WP-77N)

Scope: two deterministic checks on a journey plan, `pathEquals` (final URL pathname) and `textEquals` on a heading element. Data-value, permission and side-effect assertions are not implemented. Every other contract check type is reported `unavailable` by the runtime, never passed. Only `required: true` assertions are supported; a contract containing an optional assertion fails binding (`optional_assertion_unsupported`).

Workflow (no LLM at runtime, no auto-approval):

1. Write the contract JSON (`NavigationProposal.buildNavigationProposal` builds one). Propose it: `node falcon.js --contract-propose=contract.json [--store-root=/abs/dir]`. A proposal is unapproved.
2. Review the printed assertions and digest, then approve: `--contract-approve=contract.json` (type the full digest at the prompt) or non-interactively `--confirm-digest=sha256:...`, which must equal the recomputed digest. Without a terminal and without the flag the command refuses. `--contract-reject=...` records a rejection.
3. Reference the contract from a journey plan: top-level `contract` (path relative to the plan) and `journeyId`, plus one `verify` step after the interaction. `journey` must be `true`.
4. Run `node falcon.js --plan=plan.json [--store-root=/abs/dir]`.

Execution binding (GS12) happens before the browser starts: the contract file is read with bounded, symlink-refusing I/O, validated against the strict schema, its digest recomputed, its `journeyId` compared with the plan's, and the store must report that exact digest `APPROVED` with a verifiable chain. Any failure (`NOT_APPROVED`, `JOURNEY_MISMATCH`, `STORE_MISSING`, `STORE_BROKEN`, `STORE_ROOT_INVALID`, `CONTRACT_UNREADABLE`, `CONTRACT_INVALID`) leaves the interaction steps running but makes the `verify` step report one `unavailable` assertion row: verification level `UNVERIFIED` and a failing exit code. The frozen contract used for the digest check is the object evaluated; the file is not re-read.

Comparison rules: the path is `new URL(page.url()).pathname` compared for exact equality (no decoding, trailing slash significant, query/fragment ignored). Heading text is NFC-normalised with whitespace runs collapsed and trimmed, then compared exactly (case-sensitive). The locator must match exactly one heading element. A timeout is never a pass. Failed approved checks are never healed and expected values are never rewritten.

Evidence: each assertion row carries `assertion.id`, `assertion.digest`, `journeyId`, `required`, the check, the bounded outcome (`actual` is capped at 200 characters and only present on failure). Shard bundles preserve `id` and `digest` when they validate.

Limits: the digest binds the contract, not the plan's URL or steps, and `pathEquals` ignores origin (the journey's same-origin guard limits this). A required `verify` that cannot run (earlier step failed or quarantined, binding failed) is reported `unavailable`, which fails the run. The digest binds content, not an approver identity (see the store trust boundary above). `--store-root` must be an absolute path without `..`; the default root is Git-ignored. Plans using `contract` cannot be combined with `--workers`/`--shard`.

## Data-value assertions (WP-77D)

`valueEquals`, `countEquals` and `moneyEquals` run through the same path as WP-77N: approved contract, digest binding, `verify` step, `DataEvaluator`. No LLM, no healing, no rewriting of `expected`. Contract schema and digest semantics are unchanged.

| Check | Locator | Expected (approved) | Comparison |
|---|---|---|---|
| `valueEquals` | exactly one visible `<input>`, `<textarea>` or `<select>` (checkbox, radio, file, hidden and button inputs are unsupported) | non-empty string | current `.value` property, strictly equal: no trim, no case folding, no coercion |
| `countEquals` | any selector | integer 0..10000 (enforced at approval) | count of ALL matching elements, hidden ones included |
| `moneyEquals` | exactly one visible element (rendered text) | `{minor, currency}` | displayed amount parsed to integer minor units (BigInt) and compared with the approved `minor` and `currency` |

Money format (locale-independent, never guessed from the host or browser): one amount with one explicit currency, ISO 4217 code or `€`/`£`, before or after the amount. `,` groups thousands in groups of exactly three, `.` is the decimal point; decimals are either absent or exactly the currency's minor-unit digits (JPY 0, USD 2, KWD 3). `$`, `¥`, `kr` and other ambiguous symbols, a missing currency, `1.234,50`, `12,50`, `12.5`, exponents, signs, NaN and Infinity are `unavailable`, never a pass. A wrong amount or a different explicit currency is `failed`. No conversion, no exchange rates. Negative amounts are not approvable (`minor` must be >= 0). The exponent table covers the common zero-, three- and four-decimal currencies; other codes use two.

Outcomes: `failed` means the page was read and disagrees; `unavailable` means there is no usable evidence (missing or ambiguous target, unsupported element, malformed or ambiguous amount, read error). Both fail the run; neither can reach `BUSINESS_VERIFIED`.

Settle policy: a pass needs two consecutive passing reads 100 ms apart, so a transient DOM state cannot go green. Polling is bounded (default 5000 ms, clamped 100..30000); the confirming read of a first pass may run up to one poll interval past that deadline. A timeout itself never passes. A passing assertion costs about one extra poll interval.

Privacy: report rows for these checks carry only id, contract digest, check, locator, a fixed outcome code, match count and a fixed reason. Neither the approved `expected` nor any page value is written to the report, the shard payload, logs or terminal output of a run. Limits: the approved contract and the event store stay readable to local users, and `--contract-propose`/`--contract-approve` still print the exact expected values to the operator so approval is informed; do not run them where the terminal is captured if the values are sensitive. Browser traces, screenshots and videos can still contain page values.

Known limits: an empty `valueEquals` expectation cannot be approved (the schema requires a non-empty string; an empty page value against an approved value is a failure). Optional (`required:false`) assertions remain unsupported. Permission and side-effect checks (`enabled`, `disabled`, `absent`) remain unsupported and resolve to `unavailable`.

Residual (accepted limits): `countEquals` with expected 0 also passes when the selector is stale or wrong; Playwright's default action timeout can extend a single read past the clamped deadline; CSS-generated content (`::before`/`::after`) is not part of `innerText`.
Sampling limit: reads are 100 ms apart, so a value that flickers at a rate that aliases with the poll interval can still produce two matching reads; the settle rule is a best-effort guard, not proof of a stable final state.

## Side-effect assertions (WP-77S)

`backendEquals`, `backendCountEquals` and `backendExists` verify a business side effect from a trusted local backend source that Falcon reads itself, not from anything the page shows. A page that reports success while the backend state is wrong fails business verification (`FAILED`, nonzero exit). They use the same approved-contract path as the other checks: propose, explicit approval, digest binding (GS12), `verify` step, then `BackendEvaluator`. No LLM, no healing, and no page object is passed to the evaluator.

Each backend assertion carries a `source` (required, allowed only on these checks) and the fixed locator `backend:state`:

| Check | `expected` | Comparison |
|---|---|---|
| `backendEquals` | string (max 2000), safe integer, boolean or null | strict type and value at the JSON pointer; no coercion (`"5"` is not `5`) |
| `backendCountEquals` | integer 0..10000 | the value at the pointer must be an array of exactly that length |
| `backendExists` | boolean | presence of the pointer (own properties only) equals `expected` |

Source grammar (part of the digest, so the approver sees exactly where Falcon will read):
- `{"kind":"http-json","url":"http://127.0.0.1:PORT/path","pointer":"/a/b"}`. Host must be a literal `127.0.0.1`, `[::1]` or `localhost`; no userinfo, query, fragment, `%` or `..`; port 1..65535.
- `{"kind":"file-json","path":"rel/state.json","pointer":"/a/b"}`. Relative POSIX path under the run's base directory.
- The pointer is RFC 6901, at most 8 segments; `__proto__`, `constructor` and `prototype` segments are rejected.

Trust model: loopback only. No DNS lookup, no proxy variables, redirects are refused, the socket peer address must be loopback, the response must be HTTP 200 without content-encoding, the body is capped at 64 KiB and each request at 2 s. File sources use `O_NOFOLLOW`, a dev/ino check and a realpath containment check. Existing contracts and their digests are unchanged.

Outcomes: `failed` means the source was read and disagrees (value, type, count or presence); `unavailable` means there is no usable evidence (unreachable, redirect, non-200, oversized, invalid JSON, unsafe file, invalid expected). Both fail the run and neither can reach `BUSINESS_VERIFIED`. Settle policy matches the data checks: two consecutive passing reads 100 ms apart, bounded polling, a timeout never passes.

Privacy: rows carry only id, digest, check, the constant locator, a fixed outcome code and `matches` (0 or 1). The expected value, the observed value, the URL, the path and the pointer never appear in rows, shard payloads, logs or terminal output of a run; error text is replaced by a fixed string. `--contract-propose` and `--contract-approve` print the source and expected values (JSON-escaped) so the approver can review them.

Additional hardening: each HTTP read is bounded by a wall-clock deadline (a trickling response cannot extend it), file sources resolve against the run's base directory and never the working directory, non-loopback literals are refused before any socket opens, and display-unsafe characters (format characters such as bidi overrides and zero-width, plus U+2028/U+2029) and dot-segment file paths are rejected at approval.

Residual limits: some invisible characters outside Unicode category Cf (for example U+3164) are still accepted in pointers and expected strings; `provenance.ref` is not checked for display-unsafe characters (the CLI does not print it); URL dot segments (`/a/./b`) are normalized by the URL parser, so the requested path can differ textually from the approved one on the same host; containment of file sources is verified after the open (symlinks, directories and special files are still refused); paths such as `node_modules/...` are not blocked, so an approved contract could probe a local JSON file by pass/fail; many assertions with long timeouts can stretch a run; duplicate keys in a backend JSON response resolve last-wins; an attacker who controls the local port is out of scope (same local trust boundary as the approval store); eventual consistency beyond the timeout fails closed; the confirming read may run up to one poll interval past the deadline.

## Permission assertions (WP-77R)

`visible`, `enabled`, `disabled` and `absent` verify UI state; `accessEquals` probes authorization. Both use the same approved-contract path: propose, approval, digest binding (GS12), `verify` step, then runtime evaluators. No LLM, no healing, no page passed to the evaluator.

### UI-state checks

Each check carries a Playwright locator string and no `expected` field:

| Check | Semantics | Failure |
|---|---|---|
| `visible` | exactly one DOM match and `.isVisible()` true | zero matches (unavailable), >1 match (unavailable), found but not visible (failed) |
| `enabled` | exactly one DOM match and `.isEnabled()` true | zero matches (unavailable), >1 match (unavailable), found but not enabled (failed) |
| `disabled` | exactly one DOM match and `.isDisabled()` true | zero matches (unavailable), >1 match (unavailable), found but not disabled (failed) |
| `absent` | zero DOM matches (including hidden elements) | any match found (failed) |

**Critical:** UI state is not authorization. A hidden or disabled control proves nothing about backend permission. Absence in the DOM (zero matches) is different from presence-but-hidden; `absent` only passes on zero DOM matches.

Settle policy: two consecutive passing reads 100 ms apart, bounded timeout (default 5000 ms, clamped 100..30000); timeout never passes.

### Authorization checks (`accessEquals`)

Asserts grant or denial via HTTP status probe. Carries fixed locator `authz:access`, expected `"allowed"` or `"denied"`, and required `source`:

```json
{"kind": "http-status", "url": "http://127.0.0.1:PORT/path", "identity": {"id": "viewer", "role": "viewer"}}
```

Runtime: GET the URL with `Authorization: Bearer <token>` from fixture identities (`fixtures/identities.json`, map id → {role, token, origins}). `origins` is a required non-empty list of exact `scheme://host:port` origins the token may be sent to. Per read:
- Identity unknown (id not in fixtures or missing token), role mismatch, or source origin not listed in the identity's `origins` (missing or empty list included) → unavailable, no request. This stops a contract from steering a token to another local listener.
- Status 200 → observed `"allowed"`.
- Status 401 or 403 → observed `"denied"`.
- Any other status (404, 5xx, 3xx, timeout, network error) → unavailable.
- Observed matches expected → passed.
- Expected "denied" but observed "allowed" → failed (`access_granted_unexpectedly`).
- Expected "allowed" but observed "denied" → failed (`access_denied_unexpectedly`).

Settle policy: identical to UI checks.

### Contract contradiction rules

Within a single contract, these assertions are mutually exclusive (schema rejects at approval):

1. Same locator: cannot have both `enabled` and `disabled`.
2. Same locator: cannot have `absent` with any of `visible`, `enabled`, `disabled`.
3. Same URL + identity: cannot have conflicting `expected` values.
4. Same URL + identity: cannot have mismatched `role` values.

Identity charset: `[a-z][a-z0-9_-]{0,31}` (32 chars max, lowercase, alphanumeric + underscore + hyphen). Digest covers source and identity.

### Outcomes and example contract

| Outcome code | Trigger |
|---|---|
| `ui_visible`, `ui_not_visible` | matched 1 element; visibility test result |
| `ui_enabled`, `ui_not_enabled` | matched 1 element; enabled test result |
| `ui_disabled`, `ui_not_disabled` | matched 1 element; disabled test result |
| `ui_absent`, `ui_present` | zero matches (pass) or >0 matches (fail) |
| `access_as_expected`, `access_granted_unexpectedly`, `access_denied_unexpectedly` | identity resolved, status probe completed |
| `identity_unknown`, `identity_mismatch`, `identity_origin_mismatch`, `status_inconclusive` | identity missing, role mismatch, or origin not allowed for the identity; or status not 200/401/403 |
| `target_unavailable`, `target_ambiguous`, `read_failed` | UI element not found, duplicate match, or Playwright error |

Example contract assertion:

```json
{
  "id": "A3",
  "required": true,
  "check": "accessEquals",
  "locator": "authz:access",
  "expected": "denied",
  "source": {"kind": "http-status", "url": "http://127.0.0.1:3000/admin/delete", "identity": {"id": "viewer", "role": "viewer"}},
  "provenance": {"source": "spec", "ref": "RBAC-003"}
}
```

### Privacy, limits and planned features

Report rows carry only id, digest, check, fixed outcome code and match count; tokens, URLs, identity strings, HTTP status and response body never appear. Fixture token files live under `fixtures/` (repo root) and must hold test-only tokens for local fixture servers, never real credentials; do not commit them. Falcon does not check the file's permissions; keep it owner-readable only (0600).

Residual limits: UI state reads only measure current DOM/rendering state at poll time; transient states can be missed or matched by both reads if they alias with the 100 ms poll interval. Authorization probes depend on fixture availability and network conditions; a slow or missing endpoint blocks other assertions. The confirm read may run one poll interval past the deadline. An approved `accessEquals` contract is not proof of authorization enforcement—only that the endpoint status matched the expectation at test time.

Planned (not yet implemented): `accessEquals` on other HTTP probing patterns (POST, path discrimination, multi-tenant identity scoping), UI automation as prerequisite to authorization checks (login flow within a journey), role-based output masking in reports.

## Optional assertions, proposal drafting, and deferred items (WP-77I)

**Optional assertions:** An assertion with `required: false` is digest-bound like any other and passes only if its id and digest are valid, `required===false`, approval provenance is proven (not "unproven"), and no contradictory digests exist in the run; otherwise the claim is treated as REQUIRED (fail closed, reason code `OPTIONAL_CLAIM_UNTRUSTED`). Optional outcomes (pass/fail/unavailable/skipped/quarantined) are tallied in `verification.assertions.optional` with counts `{total, pass, fail, inconclusive, notTested}` (present only when optional rows exist); a quarantined optional counts as fail. Optional failures do not change the run result or exit code; they are exposed in `summary.optionalNotPassed` and reason codes `OPTIONAL_FAILED` / `OPTIONAL_UNVERIFIED`. A plan with only optional assertions and no required approved assertions resolves to `INTERACTION_ONLY` (reason `NO_REQUIRED_ASSERTIONS`), never `BUSINESS_VERIFIED`.

**Draft CLI:** `--contract-draft=<spec.json> --out=<contract.json>` builds a deterministic, schema-validated proposal from a plain spec file (ProposalBuilder; no LLM, no network, no clock). It refuses to overwrite, rejects unknown checks, duplicate ids, observed provenance sources, and smuggled approval/status/digest keys. It writes no approval state and never touches the ContractStore. The output prints assertions and `digest sha256:...` once. Subsequent approval uses `--contract-propose` and `--contract-approve --confirm-digest` on the draft file (no runtime LLM approval).

**Shards:** Unchanged. ShardMerge sets approval provenance to "unproven" (WP-77H), so shard-merged rows can never yield `BUSINESS_VERIFIED` and an optional claim from a shard is untrusted. Legacy contractless shards are unchanged.

**DEFERRED (state plainly; no promised dates):** Executing contracts inside shard workers (requires merge-time ContractStore re-verification; CTO decision); dashboard approval UI; `severity: "blocking"` optional failures.
