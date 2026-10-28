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
