# Phase 18 owner decision packet

Status: **DECIDED (policy direction only), with OD-24-Q1, OD-20-Q1, OD-22-Q1, OD-22-Q2 and the m-25 boundary statement now answered (ledger OWNER-09, OWNER-10, OWNER-11) and integrated by the rev 10 patch; OD-23-Q1 resolved earlier by residual 15. Rev 11 closes SEC-10 M-15 and minors m-29..m-33; one new owner item (R-7) is raised. Design revision: architecture rev 2 plus patches rev 3 to rev 12. Rev 12 closes SEC-11 M-16 and minors m-34..m-38 and integrates four owner requirements (the AC-094 interactive-path test, the named runtime case map, the tested 30000 ms cap, and the per-hop-class restatement of branch B). R-7 is explicitly NOT decided by the architecture. Two items are recorded for awareness without requesting a decision: R-9 (the pty test is local/manual because CI would fail AC-084) and H-7. Design revision: architecture rev 2 plus patches rev 3 to rev 12.** The owner's decisions were recorded in the production-cycle ledger as OWNER-01..OWNER-07 and are integrated in the [rev 8 patch](architecture/phase-18-rev8-patch.md) and the [decision traceability](phase-18-decision-traceability.md). They authorise no implementation, merge, tag or publication. The text below is the packet as presented; where it differs from the recorded decisions, the rev 8 patch wins (notably OD-24: CI may not self-approve, and the destructive-action residual is replaced by a default-protected policy). Two follow-up questions raised by rev 8 remain open: OD-24-Q1 and OD-20-Q1, plus OD-22-Q1, OD-22-Q2 and OD-23-Q1 for confirmation. Design revision: architecture rev 2 plus patches rev 3 to rev 7 (head of `docs/phase-18-architecture` when this was written). Security status: SEC-07 (`docs/security/phase-18-design-review-6.md`) reports 0 blockers and 0 open majors; every item below is an owner question, not a security finding. Base for compatibility claims: `2572e73`.

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

24. **Repository-write trust (OWNER-10).** The fixture approval boundary does not defend against an author who can modify repository code, tests or workflows; code review, protected branches and repository write governance are the required controls and Falcon verifies no GitHub setting. A CODEOWNERS file is recommended, not claimed as enforced. Within the unmodified repository the fixture authority cannot reach a non-loopback target or persist approval state, and that is tested (AC-092).

25. **Human-gated ledger writer (rev 11 section 5a.2 item 4).** The only path to a branded ledger approval is an interactive approval at a real terminal with a typed random challenge. A human who types it, or an actor who allocates a pty in a child process, is an approver by definition — the same residual already recorded for same-uid interactive approval. No in-process caller can create one.` and `26. **Forwarding fixture server (R-8).** Production code cannot distinguish a loopback server that forwards to a remote target from one that does not. The shipped harness refuses any server it did not create, and writing a forwarding server requires a new test file, which is the OWNER-10 accepted class. Stated, not accepted anew. Rev 12 bounds this: no in-process caller can prompt at all, because the writer exposes no callable writer unless it is the process entry; reaching a prompt requires spawning a process, which is the OWNER-10 accepted class; and every prompt rendered, including each refusal, is appended to the audit chain with the eight binding fields, so solicitation is visible after the fact. The prompt is rendered before the challenge is generated.

26. **Fixture server authenticity (R-8).** Rev 12 makes the production side independent of server authenticity: a PilotRuntime-built gate refuses every unbranded approval (exit 14), so the fixture branch is never evaluated in production, and the fixture module refuses any server object it did not create, by reference identity with a listen epoch. Security accepted R-8 conditional on this being normative; it now is. Stated, not accepted anew.

## Open spikes and conditions (not owner decisions)

- SPIKE-R (redirect hops and a pre-buffer response-size bound), SPIKE-W (worker interception), SPIKE-FS (statfs numbers) must report before the PRs that depend on them merge.
- SEC-07 minors m-15 to m-19 are conditions on 18A, 18E and 18F: a missing expect flag exits 2 (not 1); the standalone merge needs a named source for the config fingerprint; a failed receipt write must still return exit 17; receipt replay must be bound to pilot versus non-pilot mode and `shardCodes` cross-checked; healing counters must meet the five conditions in the review.
- Security closure of M-11 and M-12 is recorded in SEC-07 against rev 7. If you want a further independent confirmation after the minors are folded in, say so.

## Not decided here

Merge of PR #58, merge of the architecture documents, any tag, publication, deployment or announcement. None is authorized.

## Reconciliation of owner decisions (recorded after the ledger entries OWNER-01..OWNER-07)

Sources: production-cycle ledger events OWNER-01..OWNER-07 (the owner's message), this packet, the rev 8 and rev 9 patches, and SEC-07 to SEC-09.

### Accepted exactly as stated

BLOCKER-1; OD-17-Q1; OD-23; OD-24 (CI may not self-approve, no CI approve step in Phase 18); OD-20(b); OPEN-1 (acknowledged, no budget chosen); m-15 to m-19 as mandatory gates; the 18 listed residual risks (accepted with documentation and bounded claims); residual 15 (exit 14 may outrank an ordinary failure), which also resolves the earlier OD-23-Q1.

### Accepted with the owner's amendments

OD-20(a) (tmpfs and ZFS only after SPIKE-FS numeric ids and O_EXCL, rename and fsync behaviour tests, never from a name or assumed magic); OD-21 (documented residual plus the operator egress-control condition; the WebSocket and service-worker paths of H-1 fall under the owner's wording "other browser-visible network paths may remain" and are recorded as the same residual); OD-22 (2000 ms default, 10000 ms hard maximum, out-of-range is a configuration error, one lease per attempt, no refresh, expiry fails closed, body not cryptographically bound); the destructive-action residual (replaced by the default-protected policy, OWNER-07).

OD-24-Q1 (OWNER-09: a strictly fixture-scoped, in-memory, per-process approval authority outside every production require graph, injected by the test harness; no enabling environment variable, CLI option or production mint function; ApprovalStore.mintFixtureScoped and FALCON_PILOT_TEST_RUNNER withdrawn; AC-051 fully tested in CI and AC-074 unchanged); OD-20-Q1 (OWNER-11: per-root admission, tmpfs for run/auth and run/plans only, refused for run/approvals, zfs on SPIKE-FS evidence, unknown ids fail closed, missing approval history yields APPROVAL_REQUIRED and restores trust from nothing, operator-guide rationale required); OD-22-Q1 (OWNER-11: 250 ms minimum, 2000 ms default, 10000 ms maximum, out-of-range is a configuration error, never clamped); OD-22-Q2 (OWNER-11: method-based redirect rules of rev 10 section 4d.2, SPIKE-R must verify 301, 302, 303, 307 and 308 before GO).

### Not accepted as residuals (close only by implementation evidence)

Build and approval-root mixing; filesystem identification and admitted-type behaviour; boot identity fallback; concurrent-writer exit-17 behaviour.

### Security conditions (implementation gates, not residual risks)

SEC-09 m-24 to m-28, H-3 and the four-file test condition are mapped to first PRs and observable tests in the [decision traceability](phase-18-decision-traceability.md).

### Delta packet: answered

All five delta items are now answered: OD-24-Q1 (OWNER-09), the m-25 boundary acceptance (OWNER-10), and OD-20-Q1, OD-22-Q1 and OD-22-Q2 (OWNER-11). No item in the delta packet remains open. The open implementation conditions are SEC-09 m-24, m-26, m-27, m-28, H-3 and the four-file test condition, plus SPIKE-R, SPIKE-W and SPIKE-FS.

### Not owner decisions, disclosed

D11's mechanism (inverting classification to a closed positive permit set) was chosen by the architect to make the rule total; it strengthens OWNER-07's intent and weakens nothing, but it is an architect mechanism and not owner text.

Pointers: OD-24 and the fixture approval boundary are in the rev 10 patch section 4a; OD-20 filesystem admission in section 4c; OD-22 arming window and redirect continuation in section 4d. The sections above are kept as presented and are superseded by those where they differ.

### New owner item R-7 (conditional on SPIKE-R; not decided)

If SPIKE-R reports that Chromium exposes no enforcement point for one or more redirect hop classes, Falcon fails closed for those classes only. SPIKE-R fills a table over 301/302/303/307/308 crossed with same-origin and cross-origin and with method-preserving and GET-converted hops, classifying each cell as enforceable, observable-only or unobservable. An enforceable class ships the method-observed rules with the one-transmission counter; an observable-only class permits a hop only when the observed method, origin and canonical path equal the approved triple and no transmission has occurred, and otherwise aborts, with Falcon claiming abort-after-observation rather than prevention; an unobservable class is refused before arming (POLICY_REDIRECT_UNOBSERVABLE, exit 18) and named. Protected non-GET is not removed wholesale: a protected request that is not redirected is unaffected, and the loopback fixture path is unaffected. The architecture does not choose the acceptable cell set; the owner decides after SPIKE-R. Depends: 18B, 18C.

### R-9 (recorded for awareness; no decision requested)

Recorded for awareness, no decision requested: the AC-094 interactive-approval pty test is local and manual only, because AC-084 (Must) fails on any approve flag reachable transitively from a workflow. CI runs the deterministic negative half and the AC-084 walker. Making it run in CI would require amending AC-084, which the architecture will not propose.
