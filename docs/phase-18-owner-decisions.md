# Phase 18 owner decision packet

Status: **DECIDED (policy direction only), with OD-24-Q1, OD-20-Q1, OD-22-Q1, OD-22-Q2 and the m-25 boundary statement now answered (ledger OWNER-09, OWNER-10, OWNER-11) and integrated by the rev 10 patch; OD-23-Q1 resolved earlier by residual 15. Rev 11 closes SEC-10 M-15 and minors m-29..m-33; one new owner item (R-7) is raised. Rev 12 closes SEC-11 M-16 and minors m-34..m-38 and integrates four owner requirements (the AC-094 interactive-path test, the named runtime case map, the tested 30000 ms cap, and the per-hop-class restatement of branch B). R-7 is explicitly NOT decided by the architecture. Two items are recorded for awareness without requesting a decision: R-9 (the pty test is local/manual because CI would fail AC-084) and H-7.** Rev 13 closes SEC-12 minors m-39 to m-45. No new owner ruling on post-load intrinsic replacement is required: rev 13 section 7a removes the defect and re-probes it. R-7 is still NOT decided; rev 13 section 7g.4 presents three bounded scope options with their consequences and chooses none. One new item requires a Security ruling before the owner can select a scope: R-10, candidate mechanism M1 and the narrowing of the rev 12 withdrawal of route.fetch. R-9 is escalated from awareness to an owner confirmation at Security's request. H-8 records that Node 24 is UNVERIFIED. The owner's decisions were recorded in the production-cycle ledger as OWNER-01..OWNER-07 and are integrated in the [rev 8 patch](architecture/phase-18-rev8-patch.md) and the [decision traceability](phase-18-decision-traceability.md). They authorise no implementation, merge, tag or publication. The text below is the packet as presented; where it differs from the recorded decisions, the rev 8 patch wins (notably OD-24: CI may not self-approve, and the destructive-action residual is replaced by a default-protected policy). Two follow-up questions raised by rev 8 remain open: OD-24-Q1 and OD-20-Q1, plus OD-22-Q1, OD-22-Q2 and OD-23-Q1 for confirmation. Rev 8 design baseline: architecture rev 2 plus patches rev 3 to rev 7. Security status: SEC-07 (`docs/security/phase-18-design-review-6.md`) reports 0 blockers and 0 open majors; every item below is an owner question, not a security finding. Base for compatibility claims: `2572e73`. Rev 14 closes SEC-13's major M-17 and minors m-46, m-47 and m-48 in the design. R-10 is RULED by Security: M1 as rev 13 specified it is not accepted, and a same-origin-only form is. R-7 is still NOT decided; rev 14 section 8a.4 re-presents the three options with M-17 applied (A-prime, B-prime, C) and chooses none. R-8 gains the m-47 scope with five named residuals. R-9 is unchanged and still awaits the owner's confirmation. H-8 is extended to the rev 14 probes; Node 24 remains UNVERIFIED. Rev 15 closes SEC-14's major M-18 and minors m-49 and m-50 in the design, together with SEC-14's nits. The origin gate now keys on the request's initiator and its ancestor chain, not on the top-level document alone. R-7 is still NOT decided; rev 15 section 9e re-presents the three options as A-double-prime, B-double-prime and C and chooses none. R-8 gains two further stated residuals. R-9 is unchanged and still awaits the owner's confirmation. H-8 is extended to SEC-14's probes; Node 24 remains UNVERIFIED. Rev 16 records owner decision OWNER-12: R-7 is DECIDED as Option C. Phase 18 ships no protected non-GET action against a customer application; such actions are refused before transmission. R-10 and the SPIKE-R rows are deferred with R-7. AC-051 is split into a customer refusal criterion and an internal fixture-evidence criterion. m-51 stays a mandatory 18D merge condition; m-52 becomes deferred work. R-8, R-9 and H-8 are unchanged and still open.` Then: `Design revision: architecture rev 2 plus patches rev 3 to rev 16. Rev 17 integrates the SEC-16 findings and owner decision OWNER-13: no production approval path ships in Phase 18. Phase 18 refuses protected state-changing actions; human approval and protected-action execution are deferred together to 18P-PROTECTED-NONGET. The locator-healing review feature is a different feature and is unchanged. One owner confirmation is open: the m-51 disposition (rev 17 section 11d.7). Design revision: architecture rev 2 plus patches rev 3 to rev 17.

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
4. **Destructive-action detection.** SUPERSEDED by owner decision OWNER-07 (see ADR-0043 as amended by the rev 9 patch): unknown state-changing actions are protected by default and the permitted set is positive and closed. The remaining residual is an application that violates its declared behaviour; destructive GETs on allowed routes still depend on manifest authoring, which Falcon does not verify. Annotation (rev 18, correcting the misapplied annotation found as SEC-17 m-61, per rev 17 section 11l(3)): residual 4 REMAINS OPEN and DOES have a Phase 18 trigger, because a state-changing GET on a permitted route executes in Phase 18; the rev 17 text pasted here belonged to residual 21 and is removed from residual 4, where it now stands only at residual 21. Nothing newly accepted.
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
15. **Unbound request body inside an open arming lease** for UI-dispatched actions. Annotation (rev 18, superseding the rev 16 annotation per rev 17 section 11h.4 and SEC-16 m-55, closing SEC-17 m-61): the arming lease survives for permitted, non-protected actions, so the request body inside an open permitted-action lease is still unbound and residual 15 DOES have a Phase 18 trigger; only its protected-action half is moot under Option C. Nothing newly accepted.
16. **Opaque-origin frames** whose storage is inaccessible are counted, not scanned.
17. **ext2 and ext3 admitted** as a consequence of sharing a magic number with ext4.
18. **`bootId` derived from `os.uptime()` buckets** where procfs is unavailable (macOS).
19. **Bundles and receipts are unauthenticated and self-attested.** An attacker with write access to the staging directory of the same run, commit, config fingerprint and manifest digest can substitute a refusal bundle; the result is still non-zero and the pages are reported lost, never passed. Bundle signing is out of Phase 18.
20. **A pilot that includes any anonymous page can never exit 0.**
21. **Exit 14 masks exit 1** in the merged rank when both occur. Annotation (rev 16, OWNER-12): the protected-non-GET execution residual has no Phase 18 trigger under Option C; nothing is newly accepted and nothing is deleted. Annotation (rev 17): residual 21 now also covers exit 18 masking exits 17 and 1; the lostCoverage summary is written on those paths (11f.3). Nothing newly accepted.
22. **A false exit 17** can be produced by a concurrent local writer to the locator or healing stores during a pilot merge (fails closed; the receipt records it).
23. **Pilot runs contribute nothing to locator memory or healing** (the consequence of OD-17-Q1 as designed).

24. **Repository-write trust (OWNER-10).** The fixture approval boundary does not defend against an author who can modify repository code, tests or workflows; code review, protected branches and repository write governance are the required controls and Falcon verifies no GitHub setting. A CODEOWNERS file is recommended, not claimed as enforced. Within the unmodified repository the fixture authority cannot reach a non-loopback target or persist approval state, and that is tested (AC-092). Disclosure, not a widening: rev 13 section 7a.2 states that the one remaining class against the approval discriminator is code executing in the Falcon process before ApprovalStore's first statement, and that it is reachable with no repository change at all through the Falcon process's own node --require flag or NODE_OPTIONS, as well as through repository modification or a modified Node binary or node_modules. No detective control is specified, because pre-load code erases process.execArgv and NODE_OPTIONS indistinguishably from a clean process. Annotation (rev 18, OWNER-13): the fixture approval boundary, ApprovalStore, the approval discriminator and AC-092 are DEFERRED to 18P, so this residual has no Phase 18 trigger for the approval discriminator; the repository-write trust limitation itself is unchanged and now applies to the gate, the hermetic fixture and the rev 18 section C dependency-reachability check. The owner is asked to note this disclosure; OWNER-10 itself is unchanged and nothing new is accepted. Rev 14 adds two further consequences of the same pre-load class, as disclosure and not as a widening: a behaviour-preserving pre-load replacement of Function.prototype.bind lets a planted bound wrapper pass every capture smoke check and a forged approval be accepted, and a pre-load patch of EventEmitter.prototype.emit, http.Server.prototype or the http classes defeats all four new fixture assertions, because the captured and live references then agree. Both are encoded in the suite as documented-limitation cases so the limit cannot silently drift. Nothing new is accepted.

25. **Human-gated ledger writer (rev 11 section 5a.2 item 4).** The only path to a branded ledger approval is an interactive approval at a real terminal with a typed random challenge. A human who types it, or an actor who allocates a pty in a child process, is an approver by definition — the same residual already recorded for same-uid interactive approval. No in-process caller can create one. Annotation (rev 18, OWNER-13, closing the duplicate-26 fragment found as SEC-17 m-61): the interactive ledger writer does not ship in Phase 18, so residual 25 is DEFERRED to 18P and has no Phase 18 trigger; its text is retained as unshipped design history.

25a. **Forwarding fixture server (R-8).** Production code cannot distinguish a loopback server that forwards to a remote target from one that does not. The shipped harness refuses any server it did not create, and writing a forwarding server requires a new test file, which is the OWNER-10 accepted class. Stated, not accepted anew. Rev 12 bounds this: no in-process caller can prompt at all, because the writer exposes no callable writer unless it is the process entry; reaching a prompt requires spawning a process, which is the OWNER-10 accepted class; and every prompt rendered, including each refusal, is appended to the audit chain with the eight binding fields, so solicitation is visible after the fact. The prompt is rendered before the challenge is generated. Rev 13 narrows the rev 12 bound: entry identity is not a boundary against in-process code. Constructing a Module object for the writer's path, assigning it to process.mainModule and calling its load makes the writer body run through Node's own loader, with no vm and no loader patching. What still holds is that reaching the body yields nothing without a human at a real terminal who reads the bound eight-field prompt and types a freshly generated challenge on fd 0, and that every prompt rendered, including each refusal, is audited. Annotation (rev 18, OWNER-13): residual 25a is DEFERRED to 18P with the fixture approval authority and has no Phase 18 trigger; it is renumbered 25a rather than 26 so that no existing residual number moves. The rev 12 sentence "no in-process caller can prompt at all" is withdrawn and replaced by "no in-process caller can approve without a human".

26. **Fixture server authenticity (R-8).** Rev 12 makes the production side independent of server authenticity: a PilotRuntime-built gate refuses every unbranded approval (exit 14), so the fixture branch is never evaluated in production, and the fixture module refuses any server object it did not create, by reference identity with a listen epoch. Security accepted R-8 conditional on this being normative; it now is. Stated, not accepted anew. Rev 13 adds handler identity, exact listener-count equality and an own-property sweep over the EventEmitter methods, which closes the repurposing of a registered fixture server by listener replacement, by prependListener, by an own emit shadow and by an extra connection listener. What remains under R-8 is a handler whose own body was edited in the fixture module source, which identity cannot detect. Stated, not accepted anew. Rev 14 closes by assertion the four repurposing routes Security demonstrated against rev 13 (prototype swap, post-load emit prototype patch, _handle owner swap, class-symbol swap) and the server.setTimeout listener gap. Five residuals remain under R-8, stated and not accepted: any pre-load tamper of the same references; a tamper applied after the consume check, because checking is point-in-time and not continuous; a FIXTURE_HANDLER whose own body was edited in the fixture source; socket-level interception from Node's own connection listener or the clientError path that preserves the listener snapshot; and a compatible substituted _handle that preserves the owner linkage. Rev 15 closes two further routes Security demonstrated against rev 14: a listener replaced by a behaviour-preserving wrapper with an unchanged count, and a post-load patch of a body-carrying method on the http ServerResponse or IncomingMessage prototypes. Two residuals are added, stated and not accepted: a post-load patch of any prototype method outside the enumerated capture set, which is enumerated and not exhaustive and excludes the OutgoingMessage, net.Socket and stream.Writable prototypes; and a wrap of the server handle's onconnection, which preserves the owner linkage and changes no listener array. Annotation (rev 18, OWNER-13): the fixture approval authority, its server-authenticity assertions and AC-092 are DEFERRED to 18P, so residual 26 has no Phase 18 trigger and its text is unshipped design history. Annotation (rev 16, OWNER-12): the protected-non-GET execution residual has no Phase 18 trigger under Option C; nothing is newly accepted and nothing is deleted.

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

### R-7 (DECIDED by the owner: OPTION C, OWNER-12)

**DECIDED (OWNER-12): Option C.** Policy direction only; it authorises no implementation, merge or publication. The binding requirements follow (rev 16 section 10.0), then the earlier analysis, kept for the record and now superseded.

OWNER-12 selects **Option C**: *Phase 18 does not ship protected non-GET actions against customer applications.* The owner's operative requirements, restated normatively and without widening:

1. A `POST`, `PUT`, `PATCH` or `DELETE` step classified **protected** against a customer application is **refused before transmission**. The refusal is deterministic, non-recoverable and fails closed.
2. **Supported in Phase 18:** read actions; assertions; explicitly permitted **non-protected** actions; authenticated discovery and dry-run planning; deterministic **detection and refusal** of denied or protected state-changing actions.
3. On refusal there is **no click or submission, no network transmission, no route armed, no provider invocation, no healing attempt and no approval-token consumption**.
4. Reports and the dashboard show the affected pages and steps as **lost coverage**; such a step is **never PASS** and the run is never exit 0 on that path.
5. The capability claim is: *protected state-changing actions are detected and refused; execution support is deferred until request semantics, redirect control and outcome verification are proven.* Non-pilot behaviour is unchanged (`2572e73` parity, AC-076).

Option C was presented in rev 13 section 7g.4, rev 14 section 8a.4 and rev 15 section 9e as one of three options with no recommendation. The architecture now implements the owner's selection; it does not re-argue it.

---

**Earlier text (superseded):**

If SPIKE-R reports that Chromium exposes no enforcement point for one or more redirect hop classes, Falcon fails closed for those classes only. SPIKE-R fills a table over 301/302/303/307/308 crossed with same-origin and cross-origin and with method-preserving and GET-converted hops, classifying each cell as enforceable, observable-only or unobservable. An enforceable class ships the method-observed rules with the one-transmission counter; an observable-only class permits a hop only when the observed method, origin and canonical path equal the approved triple and no transmission has occurred, and otherwise aborts, with Falcon claiming abort-after-observation rather than prevention; an unobservable class is refused before arming (POLICY_REDIRECT_UNOBSERVABLE, exit 18) and named. Protected non-GET is not removed wholesale: a protected request that is not redirected is unaffected, and the loopback fixture path is unaffected. The architecture does not choose the acceptable cell set; the owner decides after SPIKE-R. Depends: 18B, 18C.

Rev 13 fills the table (section 7g.1): no cell is enforceable; 302 was measured in part 1 as observe-only (POST converted to GET) but not in the M1 part 2 cells; 301, 302 and 303 converted POST to GET while 307 and 308 preserved the body, cross-origin included, before Falcon could observe. Three bounded scope options are presented and none is chosen: (A) protected non-GET for subresource fetch and XHR only via candidate mechanism M1, with navigation-triggered protected actions refused before arming; (B) Option A plus navigation-triggered protected actions under four named conditions, accepting an unprevented cross-origin body transmission on a manifest violation, detection only; (C) no protected non-GET in Phase 18, with zero new redirect residual and no dependency on M1. Options A and B require the Security ruling of R-10 first.

Rev 14 applies M-17 to every option: a routed protected request is armed only when the hop-zero target origin equals both the page's top-level origin and the approved origin, otherwise it is refused before arming (POLICY_PROTECTED_CROSS_ORIGIN_UNSUPPORTED, exit 18), and no cross-origin routed protected request exists in Phase 18 under any option. Option A becomes A-prime (subresource fetch and XHR only, via M1, same-origin only; navigation refused before arming). Option B becomes B-prime (A-prime plus navigation under five named conditions, accepting an unprevented transmission on a manifest violation, detection only). Option C is unchanged and is the only option with no M-17 dependency, no 6j.1(7) restatement and no SPIKE-R extension condition. The Option A gain "no cross-origin body leak in those cells" is struck as unsupported. Security has ruled; the choice is the owner's.

Rev 14, section 8a.3 row 3: in the permitted same-origin case a routed protected request carries no Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest or Sec-Fetch-User header. Against a server that requires Fetch Metadata this fails safe, because the server rejects the request. Against a server that treats absence as a legacy non-browser client it is not a protection. Disclosed in the limitation text, not accepted as a residual and not claimed as a control.

Rev 15 applies M-18 to every option: a routed protected request is armed only when the page's own main frame initiated it and the initiator, top-level, approved and target origins are all equal, with an unestablishable initiator refused before arming (POLICY_PROTECTED_INITIATOR_UNSUPPORTED, exit 18). A-prime becomes A-double-prime and B-prime becomes B-double-prime, each differing only by carrying the full gate; in B-double-prime the initiator rule provides no additional protection, because a navigation is main-frame-initiated by construction. Option C is unchanged and remains the only option with no M-17 or M-18 dependency. Security has not yet reviewed this correction; the choice remains the owner's and no option is recommended.

Rev 15, section 9a.3 row 3: the absence of Sec-Fetch headers is a property of route.fetch and not of routing in general, since route.continue preserves the browser's own Sec-Fetch headers. Row 10: a protected action initiated from a same-origin nested frame is refused by the reference-identity form of the initiator rule, a deliberate over-refusal that reduces functional reach in the safe direction, disclosed in the limitation text and not accepted as a residual.
### R-9 (MOOT under OWNER-13; rev 18 section A1)

MOOT: AC-094 and Falcon's production interactive approval path are DEFERRED to 18P under OWNER-13, so no CI-gating confirmation is owed; no owner decision is requested and nothing is accepted. Historical text follows. Owner confirmation requested (escalated by SEC-12 m-42 from awareness). The positive half of AC-094 is automated but not CI-gated, so a regression in Falcon's production interactive approval path is caught only by a manual run. CI runs the deterministic negative half and the AC-084 walker. Whether this meets the owner's intent that the test automate the production path rather than add a second mechanism is the owner's to confirm. The architecture does not propose amending AC-084 and offers no alternative that would.

### R-10 (RULED by Security in SEC-13; R-7 not decided)

RULED by Security (SEC-13). M1 as specified in rev 13 is not accepted, and the rev 13 narrowing of the rev 12 withdrawal of route.fetch is not accepted as written: measurement showed a cross-site non-simple POST that the browser suppressed entirely being transmitted by Playwright's fetch stack, with a cookie the browser withheld under SameSite, with no Fetch Metadata headers, and with the page reading a status the CORS policy would have blocked. For any request whose browser-computed security properties differ from what the fetch stack sends, M1 is emulation as rev 11 prohibited. Security would not object to a narrowing restricted to requests whose origin equals the page's top-level origin and the approved origin, and rev 14 section 8a specifies exactly that. Nothing further is owed to the owner on R-10; what remains is the R-7 scope choice.

Deferred with R-7; the ruling is preserved as an input to 18P-PROTECTED-NONGET.

### OWNER-13 (DECIDED): the production approval writer does not ship in Phase 18

Policy direction only; it authorises no implementation, merge or publication. Option C applies to the complete production approval path. Phase 18 production code does not expose an approval-create or mint CLI command, a dashboard approval action for protected mutations, a production approval-writer API, an approval token creation path, a protected-action approval ledger, approval consumption for customer execution, a dormant feature flag or environment variable enabling these paths, or a fallback to the superseded A-double-prime or B-double-prime designs. Customer-facing behaviour is detection and refusal. Phase 18 refuses protected state-changing actions; human approval and protected-action execution are deferred together to 18P-PROTECTED-NONGET. The existing locator-healing review is a different feature and is unchanged; "approval" in healing documentation must not be confused with protected-action approval. Reclassification of approval-writer-specific decisions: rev 17 section 11d.6 (research and security analysis preserved as deferred design history).

### OWNER-13-Q1 (OPEN): m-51 disposition

Owner confirmation requested (OWNER-13-Q1): m-51 and the rev 11 to rev 15 fixture-identity assertions are carried as DEFERRED WITH THE APPROVAL MACHINERY, pending owner confirmation, because the fixture approval boundary they protected is itself deferred. This reverses the earlier instruction that m-51 stays a mandatory 18D merge condition, only because the thing m-51 protected is deferred; if the owner prefers to keep it mandatory it returns as an 18D condition at no design cost (rev 17 section 11d.7). The genuine-recording-server obligation for the AC-051 zero-transmission cases is unaffected and stays live.



## Rev 18 (ARCH-18) normative annotation, OWNER-13

Every occurrence in this file of ApprovalStore, ApprovalRecord, ApprovalCliWriter, PilotApprovalResolver, approve-action, emit-token-to, RunToken, RunTokenEmitter, LedgerLock, a ledger approval, an approvals or approval root, APPROVAL_REQUIRED, APPROVAL_MISMATCH, APPROVAL_STALE, APPROVAL_REPLAYED, an approved half, a tests-only executable for exit 0, PILOT_APPROVER, PILOT_APPROVAL_RUN_TOKEN, replay-protected approval, an approver string, a pty approval helper or exit 14 for a protected step is, unless it is explicitly marked live above, **unshipped design history deferred to 18P-PROTECTED-NONGET under OWNER-13**, or a **prohibition** that Phase 18 enforces. It is not a Phase 18 capability, obligation or claim. Phase 18 behaviour is detection and refusal only: a protected step is refused POLICY_PROTECTED_ACTION_UNSUPPORTED with exit 18 and a mandatory reason code, no approval object, ledger entry, token or audit-approval record is created anywhere, and no approvals root is created. This annotation is normative for this file and is enforced by the standing claims grep of rev 18 section F. Nothing here authorises implementation; Node 24 is UNVERIFIED (H-8).
