# Phase 18 owner decision packet

Status: **DECIDED (policy direction only).** The owner's decisions were recorded in the production-cycle ledger as OWNER-01..OWNER-07 and are integrated in the [rev 8 patch](architecture/phase-18-rev8-patch.md) and the [decision traceability](phase-18-decision-traceability.md). They authorise no implementation, merge, tag or publication. The text below is the packet as presented; where it differs from the recorded decisions, the rev 8 patch wins (notably OD-24: CI may not self-approve, and the destructive-action residual is replaced by a default-protected policy). Two follow-up questions raised by rev 8 remain open: OD-24-Q1 and OD-20-Q1, plus OD-22-Q1, OD-22-Q2 and OD-23-Q1 for confirmation. Design revision: architecture rev 2 plus patches rev 3 to rev 7 (head of `docs/phase-18-architecture` when this was written). Security status: SEC-07 (`docs/security/phase-18-design-review-6.md`) reports 0 blockers and 0 open majors; every item below is an owner question, not a security finding. Base for compatibility claims: `2572e73`.

Product implementation of Phase 18 stays blocked until you have answered the items marked **required before first PR**, the locator-cache test-reliability PR has merged, and post-merge `main` is green.

## How to answer

Reply per item with `accept`, `reject` or `amend: <text>`. Each item lists what the design assumes, what accepting costs, what rejecting changes, and the first PR that depends on it.

## Required before the first PR (18E)

### BLOCKER-1: scope of the `PLAN_INVALID` refusal (AC-033 versus AC-076)

- **Conflict.** AC-033 says a plan without a schema version or digest, including current `--save-plan` output, is refused `PLAN_INVALID` for execute. Taken literally for every `--plan` execute, that breaks replay of existing v1 plans (the feature shipped in PR #54) and contradicts AC-076 (behaviour identical to `2572e73` when no Phase 18 flags are used).
- **Design assumption.** The refusal applies to pilot execute mode only. Non-pilot `--plan` behaviour is unchanged.
- **If you accept.** Both criteria hold. AC-033 is worded as "in pilot mode".
- **If you reject.** Either AC-076 is amended (existing v1 plans stop replaying outside pilot mode) or AC-033 is dropped; both are real product changes.
- **Depends:** 18B, 18C, 18D.

### OD-17-Q1: no healing evidence in pilot bundles

- **Design assumption.** Pilot bundles carry no healing evidence of any kind, including the earlier reduced `{strategyId, outcome, locatorKeyDigest}` record. Pilot runs write nothing to `healing_pending.json`, `locator_store.json`, `locator_memory.json`, `healing_decisions.json` or `reports/healing_logs.json`; only aggregate counters (attempts, successes, failures per tier, refusal-reason histogram) go to the log, with no selectors, URLs or key digests.
- **If you accept.** No application-derived identity crosses a process boundary and the CI state cache cannot be fed by a pilot run. Cost: authenticated pages never improve locator memory or healing statistics.
- **If you amend OD-17.** Name the exact record to admit. It returns as a sixth bundle shape with its own closed schema and its own security review.
- **Depends:** 18A, 18E.

### OD-23: protected actions are refused in shard mode

- **Design assumption.** Authenticated pilots run in shard mode (read, assert and non-protected permitted actions). Any protected (destructive or approval-bearing) step is refused `APPROVAL_REQUIRED` (exit 14) in a shard, and a run token present in a shard is itself refused. Plans containing protected actions run in sequential or `--workers` mode.
- **Why.** An approval is a human-reviewed record in a local ledger protected by a local lock and a token claimed once per process. No cross-runner transport avoids a long-lived shared secret, a multiply claimed token, a forked ledger or self-approval.
- **If you accept.** No Must criterion is weakened. Cost: destructive-action pilots cannot be spread across runners.
- **If you reject.** The alternative is not "allow it". It is commissioning a shared, human-attested approval service, which is outside Phase 18 and needs its own security review.
- **Depends:** 18D, 18F.

### OD-24: may CI approve its own protected actions

- **Question.** Whether a CI job may mint an approval and then consume it in the same run.
- **Design assumption.** Not decided. The CI job transports the run token through a `0600` file, never stdout, and runs on an allowlisted filesystem. Whether it may self-approve at all is yours.
- **Considerations.** Self-approval by the automation that consumes it is not a human approval. Accepting it means the approval step is a policy control, not an authentication of a person (the approver string is a non-secret run-scoped label, OD-02).
- **If you accept.** Document it as a limitation and keep CI protected actions behind the manifest allow-list. **If you reject.** Protected actions in CI are refused; they run only interactively with a human approver.
- **Depends:** 18D, 18F.

## Required before the PR that depends on it

### OD-20: filesystem allowlist for pilot state

- **Current design.** A numeric `fs.statfs().type` allowlist per platform (macOS value 26 is verified on the development host; Linux values are recorded by SPIKE-FS on the CI runner before 18F merges). Unknown types are refused with a clear environment error, never a silent skip.
- **Moot points.** ext2 and ext3 share a magic number with ext4, so they are admitted whenever ext4 is. HFS+ is refused until a value is observed.
- **Your decision.** (a) May `tmpfs` and `zfs` be admitted once SPIKE-FS records their numbers. (b) May `overlayfs`, `virtiofs` and `drvfs` (containers, dev containers, WSL) be admitted, accepting that the `O_EXCL` and `fsync` durability assumptions of the approval ledger are not established there. (c) Until decided, pilot mode cannot run in those environments, including any containerised CI runner.
- **Depends:** 18E (the check), 18F (CI).

### OD-21: WebRTC exfiltration residual

- Data channels are not interceptable through Playwright routing. Chromium is launched with `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, which still allows TCP TURN, so this is a weak mitigation and is not claimed as a control. Decide whether to accept the residual or require a hardened browser profile or network-level egress control for pilots.
- **Depends:** 18C.

### OD-22: arming window for UI-dispatched protected actions

- A UI action is armed for a bounded window so single-page-app requests that fire after `click()` resolves are not blocked. Default 2000 ms, maximum 10000 ms. A longer window widens exposure, and the request body is not bound by the approval for a UI-dispatched action (the page generates it after the click), so the window is the main bound on body tampering by an already-hostile page.
- **Decide** the default (2000 ms proposed) and the maximum.
- **Depends:** 18D.

## OPEN-1: dry-run CI budget (AC-072)

The numeric budget needs a measurement from the hermetic fixture first (OD-13 protocol). Nothing to decide yet; this is recorded so the budget is not guessed.

## Residual risks for explicit acceptance

None of these is accepted by the design. Accepting each means documenting it in `docs/pilot/limitations.md`.

1. **Application-derived text.** Known-value redaction catches only values the registry knows; unknown secrets in page text can reach reports, the dashboard, prompts and screenshots.
2. **Screenshots when enabled.** Masking is selector-based; secrets in unmasked regions, canvas or images are not detected.
3. **Same-uid tamper.** The approval hash chain is tamper-evident only; a same-uid insider can rewrite it consistently. Same-uid rollback is bounded by the token TTL and wall-clock trust. The approver string is not authentication.
4. **Destructive-action detection.** SUPERSEDED by owner decision OWNER-07 (see ADR-0043 as amended by the rev 9 patch): unknown state-changing actions are protected by default and the permitted set is positive and closed. The remaining residual is an application that violates its declared behaviour; destructive GETs on allowed routes still depend on manifest authoring.
5. **Provider-side retention** of prompts (which may contain redacted application text) is outside Falcon's control.
6. **Short secret values** (3 bytes or fewer) cannot be redacted without false positives.
7. **Chromium only** (OD-19); other engines untested.
8. **PII in literal plan values.**
9. **No Windows pilot support.**
10. **Run-token leak impact** is limited to the same uid.
11. **Mixing builds against one approvals root.**
12. **Tokens in IndexedDB, non-JSON or oversize bodies** are not scanned.
13. **`node_modules` is outside the build identity.**
14. **Retention re-lstat to unlink TOCTOU window** (same-uid attacker).
15. **Unbound request body inside an open arming lease** for UI-dispatched actions.
16. **Opaque-origin frames** whose storage is inaccessible are counted, not scanned.
17. **ext2 and ext3 admitted** as a consequence of sharing a magic number with ext4.
18. **`bootId` derived from `os.uptime()` buckets** where procfs is unavailable (macOS).
19. **Bundles and receipts are unauthenticated and self-attested.** An attacker with write access to the staging directory of the same run, commit, config fingerprint and manifest digest can substitute a refusal bundle; the result is still non-zero and the pages are reported lost, never passed. Bundle signing is out of Phase 18.
20. **A pilot that includes any anonymous page can never exit 0.**
21. **Exit 14 masks exit 1** in the merged rank when both occur.
22. **A false exit 17** can be produced by a concurrent local writer to the locator or healing stores during a pilot merge (fails closed; the receipt records it).
23. **Pilot runs contribute nothing to locator memory or healing** (the consequence of OD-17-Q1 as designed).

## Open spikes and conditions (not owner decisions)

- SPIKE-R (redirect hops and a pre-buffer response-size bound), SPIKE-W (worker interception), SPIKE-FS (statfs numbers) must report before the PRs that depend on them merge.
- SEC-07 minors m-15 to m-19 are conditions on 18A, 18E and 18F: a missing expect flag exits 2 (not 1); the standalone merge needs a named source for the config fingerprint; a failed receipt write must still return exit 17; receipt replay must be bound to pilot versus non-pilot mode and `shardCodes` cross-checked; healing counters must meet the five conditions in the review.
- Security closure of M-11 and M-12 is recorded in SEC-07 against rev 7. If you want a further independent confirmation after the minors are folded in, say so.

## Not decided here

Merge of PR #58, merge of the architecture documents, any tag, publication, deployment or announcement. None is authorized.
