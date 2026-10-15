# Phase 18 architecture — revision 9 patch (ARCH-09)

Normative addendum to the [rev 8 patch](phase-18-rev8-patch.md). It closes SEC-08 majors M-14 and M-13 and minors m-20..m-23. Base for compatibility claims is `2572e73`. No Must criterion, no OD-01..OD-19 and no recorded owner decision (OWNER-01..OWNER-07) is weakened; two controls are strengthened. Nothing here authorises implementation, merge, tag or publication. One owner choice (OD-24-Q1) is restated, costed and recommended, not decided.

Status: DRAFT rev 9, pending SEC-09 on the rev 9 delta only.

## 3a. M-14 — classification is total by inversion (REPLACES rev 8 2c.11 rule 3 and rule 4)

### 3a.1 The defect being removed

Rev 8 rule 3 enumerated element shapes that make a control "state-changing-capable" and defaulted only those to `protected`. An enumeration of shapes cannot be total: `role=button` divs with a JS `fetch` listener, controls owning a form through `form=`, form-associated custom elements (`ElementInternals`), shadow-DOM controls, and whole action *types* (`press("Enter")`, `press(" ")`, `setInputFiles`, `dragTo`, `selectOption`/`check` autosave, `contenteditable` input) all fall outside it, and a script-dispatched request's method is unobservable before activation. The fix is not a longer enumeration. The gate is inverted.

### 3a.2 Normative rule text (REPLACE rev 8 2c.11 rules 3 and 4 in full; keep rules 1, 2, 5, 6, 7, 8)

`ActionClassifier.classify({ elementIdentity, actionType, route, manifestPolicy })` returns exactly one of `{permitted, protected, denied, ambiguous}`. The function is **total**: it has no fall-through and no default branch that yields `permitted`.

**R3 — The permitted set is positive, closed and code-owned.** An `(elementIdentity, actionType)` pair is `permitted` only if it matches one of these two cases, and nothing else:

- **P1 — Explicit manifest permit.** A manifest permit entry whose `{route, method, actionKey}` exactly matches the resolved route, the method the manifest declares for that entry, and the action key derived for this pair. The matching entry id is recorded (rule 6, m-20 below).
- **P2 — A navigation-free read.** `actionType` is a member of a **frozen, code-owned enum** of observation-only operations that dispatch no activation event and no request: `textContent`, `innerText`, `innerHTML` (read), `getAttribute`, `inputValue`, `isVisible`, `isEnabled`, `isChecked`, `count`, `boundingBox`, `waitForSelector`, `waitForLoadState`, `evaluate` **only** through the fixed internal read helpers Falcon ships (never a caller-supplied expression), and the assertion primitives built on these. The enum is a `Object.freeze`d constant asserted by test; adding a member is a code change that requires a security review.

**R4 — Everything else is protected.** Every pair not in P1 ∪ P2 is `protected`. This includes, by construction and without being enumerated anywhere in the gate: `click`, `dblclick`, `tap`, `hover`-then-activate, `press` of any key including Enter and Space, `type`/`fill`/`pressSequentially`, `setInputFiles`, `dragTo`, `selectOption`, `check`/`uncheck`, `setChecked`, `focus`-then-activate, `dispatchEvent`, `goto`/`goBack`/`goForward`, `reload`, any `contenteditable` input, and any action on an element Falcon cannot describe. **Element shape is never the gate.** Roles, `tabindex`, listeners, `form`/`form=`/`ElementInternals`, `formaction`, shadow-DOM residence and observed or declared methods are inputs to the destructive-signal detector (rule 2) and may only **raise** an outcome to `denied`; they are never consulted to decide whether something is `protected`, because `protected` is already the default.

**R4a — Ambiguity.** `ambiguous` → `CONTROL_AMBIGUOUS`, **zero clicks**, when the element identity does not resolve to exactly one node, two candidates share the derived identity, or the derived action key is not computable. Ambiguity never yields `permitted` and never yields a silent activation. `CONTROL_AMBIGUOUS` is a refusal, not a downgrade.

**Consequence to state in the operator guide:** a manifest that declares no permit entries makes every interaction protected. That is the intended direction. Read and assert coverage still runs, because reads are P2.

### 3a.3 Classification can never be lowered indirectly (closes M-14(c))

1. **Recomputed at execution, never read from the plan.** `PilotActionGate.perform` calls `classify` again, against the **freshly loaded** manifest policy, on the element it is actually about to act on. The plan row's `classification` is **review metadata and a pre-flight input only**. It is used to *raise* (the shard static pre-flight refusal of 2c.3(a)) and never to lower.
2. **Effective classification is the maximum** over `{plan row, live recompute, provider advice}` on the total order `denied > protected > permitted`. A plan row saying `permitted` where the live recompute says `protected` executes as `protected` (approval required) and records `PLAN_CLASSIFICATION_DRIFT` in the policy reason chain and the receipt; it is never a `PLAN_DRIFT` hard refusal, because raising is safe and the operator should see the raise, not a crash.
3. **Healing and re-resolution force a recompute.** If a healed, substituted or re-resolved locator yields an element identity different from the one classified at plan time or at approval time, the gate re-runs `classify` on the new element. If the new effective classification is higher than the approved one, or the element identity differs from the identity bound into a consumed approval, the action is refused `APPROVAL_MISMATCH` reason `heal_changed_classified_element`, exit 14 (AC-047 and AC-053 unchanged; this is their composition, not a new code).
4. **Provider advice** remains monotonic-raising only (AC-045 unchanged), and may not supply the P1 permit.

### 3a.4 Script-dispatched requests are gated independently of classification

**APPEND to section 7a as rule 3a.** The execute-mode `NetworkGate` decision is a function of `(method, origin, canonical path, page, frame, resource type, body-size class, live lease)` **only**. It never reads a classification, a plan row, a provider verdict or an action record. Every request whose method is not `GET`/`HEAD`, and every `GET` to a route the manifest does not allow, is **aborted** unless it matches the single open armed lease triple. This holds identically for requests originated by `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, `form.requestSubmit()`, implicit form submission, a dynamically injected form, an `<a>` with `ping`, or any other page script path, because the gate observes the request and not its cause. A classification bug therefore produces a **mis-attributed refusal**, never a mutation.

**Residual H-1, unchanged and documented:** WebSocket frames and service-worker-originated requests are not reliably interceptable. The preventive `addInitScript` of section 7a ships regardless (SPIKE-W records the observed behaviour), and the residual stays in `docs/pilot/limitations.md` with the honest bound: a hostile page with an open WebSocket is not contained by Falcon; runner-level egress control is the operator's control (D6).

### 3a.5 PR ownership for the M-14 remediation

- **18C** — `ActionClassifier.js` (the P1/P2 positive set, the frozen read enum, totality), `Vocabulary.js`, `PolicyEngine.js` steps 5, 6, 9, the permit-traceability record, and the `NetworkGate` independence assertion (rule 3a).
- **18B** — the gate-side half: the plan row carries `classification` + permit justification as metadata; `perform` recomputes and takes the maximum; the heal/re-resolution recompute; the refusal of an unjustified `permitted` row.

### 3a.6 Negative tests (every one with its inversion; QA owns the inversions)

**`neg-c01-default-protected` (18C, U/R)** — each case classified `protected` with **no** manifest permit entry:

| # | Attack shape | Expected |
|---|---|---|
| 1 | `div`/`span`/`a href="#"` with `role=button|menuitem|switch|tab|checkbox` and a JS listener calling `fetch` | protected |
| 2 | same, listener calls `XMLHttpRequest`, `navigator.sendBeacon`, `form.requestSubmit()` | protected |
| 3 | `button form="f1"` outside `#f1` in the DOM | protected |
| 4 | form-associated custom element (`ElementInternals`) | protected |
| 5 | control inside an open and a closed shadow root | protected |
| 6 | `press("Enter")` and `press(" ")` in a text input inside a form (implicit submission) | protected |
| 7 | `setInputFiles` on `input[type=file]` | protected |
| 8 | `dragTo` / HTML5 drag-drop | protected |
| 9 | `selectOption` / `check` with a change-triggered autosave | protected |
| 10 | typing into `contenteditable` with autosave | protected |
| 11 | plain `button` with no `type` inside a form; `formaction`; POST-form submit; non-GET destination | protected |
| 12 | Unicode non-Latin labels "Löschen", "削除", "حذف", "Удалить", and a nonsense label, on a `role=button` div | protected |
| 13 | an unresolvable/duplicate-identity control | `CONTROL_AMBIGUOUS`, zero clicks |
| 14 | a fabricated `permitted` outcome with no manifest justification | `PILOT_INTERNAL_ERROR` exit 18 |
| 15 | a P2 read action on each of cases 1–12 | permitted, zero activation events |

**Inversion (required evidence):** reinstate any shape-enumerating predicate as the gate, or add a default `permitted` branch, and cases 1–12 must fail.

**`neg-c02-no-lowering` (18B, U/R)** — a plan row `classification: "permitted"` whose live recompute is `protected` executes as protected and records drift; a provider "safe" verdict on each of the 12 shapes lowers nothing; a heal that substitutes a different element identity under a consumed approval is refused `heal_changed_classified_element` exit 14. Inversion: read the class from the plan row and every case passes wrongly.

**`neg-n1-script-dispatch` (18C, R)** — on the loopback fixture, unarmed `fetch` POST, XHR PUT, `sendBeacon`, `requestSubmit()`, implicit Enter submission and a dynamically injected form are each aborted with zero server-side mutation, with the gate given a deliberately wrong `permitted` classification for the triggering control. Inversion: let the gate consult the classification and the aborts stop.

### 3a.7 m-20 — permit entries are re-validated, not merely present

1. **Justification shape.** A `permitted` plan row carries `permitJustification: {entryId, route, method, actionKey, manifestDigest}`. `entryId` is a stable, author-assigned string in the manifest.
2. **Re-validation at load and at perform.** `PlanFile.load` (pilot mode) and `gate.perform` both re-resolve `entryId` in the **freshly loaded** manifest and require exact equality of `route`, `method`, `actionKey` and the recorded `manifestDigest` against the resolved manifest.
3. **Permit surface constraints (new manifest surface, 18C).** `schemas/pilot-manifest.v1.json` gains `actions.permitted[]` with `{entryId, route, method, actionKey, note}`. `actionKey` must be an **exact** key; wildcard or pattern `actionKey` values are schema-invalid for any `actionType` outside the frozen P2 read enum. A pattern `route` is allowed; a pattern `actionKey` is not. Kept in sync with `docs/pilot/manifest-reference.md` under AC-038.
4. **Refusal codes.** Missing justification on a `permitted` row → `PLAN_PERMIT_UNJUSTIFIED`, **exit 2**, at `PlanFile.load`, before browser launch. Justification naming an absent entry, or an entry whose fields do not match → `PLAN_DRIFT`, **exit 2**. A live mismatch first detected at `perform` (manifest reloaded mid-run is not possible, so this is an internal inconsistency) → `PILOT_INTERNAL_ERROR`, **exit 18**.
5. `neg-b06-permit-traceability` (18B) gains: absent `entryId`; `entryId` present but route/method/actionKey mismatched; a wildcard `actionKey` on a non-P2 action rejected at manifest load (`MANIFEST_INVALID` naming the JSON path). Inversion: accept presence without re-validation and all three pass.

## 3b. M-13 — a code-enforced boundary for fixture approvals (AMENDS rev 8 2c.4a and 2d OD-24-Q1)

### 3b.1 The owner choice, restated and costed (NOT decided here)

- **Strict reading** — "no CI approval" covers the hermetic in-process fixture test too. Then AC-051's approved half becomes local-only and **AC-074 (zero skips) must be amended by the owner** to exempt exactly one named test. Cost: the single most security-relevant positive path (an approved protected submit succeeds, token absent from artifacts) loses continuous CI coverage and regresses silently; the owner must amend a Must.
- **Narrow reading + the boundary of 3b.2** — the fixture approval exists only where a loopback fixture server is running in the same process. No Must is amended; AC-051 and AC-074 both hold.

**Architect recommendation: the narrow reading with 3b.2 and 3b.3 made mandatory, and nothing weaker.** Rationale: the fixture path is the only one that proves the approved half, and 3b.2 turns `approver: "test-fixture"` from a label into a capability that cannot be forged from a workflow step or from production code. **Residual the owner is accepting if they choose this:** a workflow author with repository write access can still author a test that starts a loopback fixture and mints a fixture-scoped approval — but that approval is unusable against any non-loopback destination (3b.2 item 5), never persisted (item 6), and the static check of 3b.3 fails on any reachable approve path outside `tests/`. The exposure is therefore a self-contained in-repo test, not a path to a staging mutation. **If the owner chooses the strict reading, SEC and QA must be told that AC-074 is amended and that the approved half is local evidence only.** I do not choose.

### 3b.2 `ApprovalStore` fixture scope (18D; mandatory under either reading if any fixture approval exists at all)

`ApprovalStore.mintFixtureScoped({ binding })` is the **only** non-CLI mint path, and it **refuses** unless *all* of the following hold. Each refusal is `APPROVAL_FIXTURE_ONLY`, **exit 18**, with the failing condition named.

1. **Live in-process fixture server.** A module-level registry inside `FixtureServer.js` — populated **only** by `FixtureServer.start()`, never exported, never writable from outside the module — holds the live `net.Server` handles started by **this process**. `binding.destinationOrigin` must equal `http://<loopback literal>:<port>` of a **currently listening** registered handle. There is no file, env var, flag or argument that can add an entry. A process that has not started a fixture server cannot mint, by construction.
2. **Loopback literal only.** The host must be an IPv4 literal in `127.0.0.0/8` or `[::1]`. `localhost` and every hostname are refused (a hosts file can remap a name; it cannot remap a literal).
3. **Per-run fixture capability.** `FixtureServer.start()` generates a 32-byte random capability held in memory and returns it to its caller only; `mintFixtureScoped` requires the capability to match the registered handle's capability. The capability is never written to disk, never logged, never placed in an env var and never printed; the secret-boundary registration of section 9 applies to it.
4. **Manifest confinement.** `binding.manifestDigest` must be the digest of a resolved manifest **every** one of whose route origins is that same loopback origin. A manifest containing any non-loopback origin cannot produce a fixture-scoped approval.
5. **CI double gate.** When `CI=true` or `GITHUB_ACTIONS=true`, minting additionally requires `process.env.FALCON_PILOT_TEST_RUNNER === "1"` **and** `process.argv[1]` resolving under `<repoRoot>/tests/`. Both conditions, not either. `FALCON_PILOT_TEST_RUNNER` is set only by the dedicated pilot test runner entry point and is absent from `.env.example` (AC-080 extended to assert its absence there).
6. **Fixture approvals are in-memory only.** A `scope: "fixture"` approval is held in a process-local ledger. **No `run/approvals/` path, no audit chain file, no run-token file and no receipt is created for it**; 2c.3(d) and AC-084's "approvals path never created" both continue to hold verbatim in CI. It cannot be exported, replayed across processes or inspected after exit.
7. **Consumption is re-checked at `gate.perform`.** A `scope: "fixture"` approval is consumable only when the *live* destination origin is the same loopback literal and port, the live manifest digest matches, and the registry still holds that listening handle. Any other destination → `APPROVAL_REQUIRED`, **exit 14**, reason `fixture_approval_non_loopback`. The eight-field binding of section 9 is unchanged and additional.
8. **CLI defence in depth.** `--approve-action` and `--emit-token-to` refuse with **exit 1**, reason `approve_flag_in_ci`, when `CI=true` or `GITHUB_ACTIONS=true`. This guards accidents only; a workflow author controls those variables, and that limit is stated in the ADR.

### 3b.3 AC-084 static check — transitive resolution (18F)

The m-7 static check is extended from "scan `ci.yml` text" to a **reachability analysis**:

1. Parse every workflow file. For each `run:` block, tokenise each command line (handling `&&`, `||`, `;`, `|`, and line continuations).
2. Resolve transitively, with cycle detection and a bounded depth (default 16): `npm run X` / `npm X` / `yarn X` / `pnpm X` → the `scripts.X` command in `package.json`; `npx Y` → the resolved bin target; `node <path>` / `node --flag <path>` → that file; `bash <path>` / `sh <path>` → that file's command lines.
3. From every reachable JS entry point, walk static `require()` graphs (literal arguments only).
4. **Fail the gate** when the reachable set contains: any occurrence of `--approve-action`, `--emit-token-to`, `PILOT_APPROVAL_RUN_TOKEN`, `PILOT_APPROVAL_RUN_TOKEN_FILE`, or a path resolving under `run/approvals`; any `require` of `src/core/pilot/approval/*` from a file outside `src/core/pilot/` and `tests/`; any spawn of `falcon.js` with an approve flag; or any reference to `FALCON_PILOT_TEST_RUNNER` outside `tests/` and the pilot test runner entry.
5. **Fail closed on unresolvable commands.** A command whose target cannot be statically resolved (a shell variable, a dynamic string, a downloaded script) fails the gate with `UNRESOLVABLE_WORKFLOW_COMMAND` naming the file, the job and the line. A workflow may not hide an approve path behind indirection the checker cannot follow.
6. `neg-ci-no-approve-step` inversions (all must fail the gate): an approve flag inside an `npm run` script; inside a `node scripts/x.js` two hops deep; a `require` of the approval module from `scripts/`; a dynamic `$CMD` invocation; a non-loopback (staging-origin) fixture-scoped approval minted through the module API under `CI=true` (refused at mint and, if the mint check is removed, refused at consume).

## 3c. Minors

### m-21 — filesystem claims corrected (18E/DOC)

- **(a) DELETE** every numeric magic-constant claim from rev 8 2d and the traceability note, including "`tmpfs` and `ramfs` share magic `0x01021994`". **Replace with:** no numeric filesystem id may be asserted from a kernel header, from documentation or from reviewer knowledge; only values **observed by SPIKE-FS on the target platform and committed to the evidence table** are admissible. SPIKE-FS must additionally record whether the observed `tmpfs` id is shared with `ramfs` on each target platform; if it is, the shared-id consequence is a **new residual of the same kind as ext2/3/4** and must be documented. Separately recorded residual: a kernel built without `CONFIG_SHMEM` serves `tmpfs` mounts from ramfs, so a `tmpfs` admission may silently admit a ramfs-backed mount.
- **(b) REPLACE** 2c.5(a)(ii)'s "`fsync` … honoured". New text: "…that `fsync` on the file and on its parent directory each return success and that a subsequent read-back in a fresh process is consistent. **A behaviour test cannot establish durability across power loss or reboot, and no Falcon document may claim it does.**"
- **(c) Per-root allowlist (adopt if OD-20-Q1 is accepted).** `SafeFs.assertLocalFilesystem(dir, rootKind)` where `rootKind ∈ {auth, plans, approvals}`, with a **per-root** admitted-id set. `tmpfs` may appear in the `auth` and `plans` sets and **must not** appear in the `approvals` set. **AC-085 edit in 3d.** Still the owner's call; recommendation unchanged and supported by Security.

### m-22 — redirect-hop rules inside and after a lease (18B/18C; AMEND ADR-0042)

**APPEND to 2c.7 as item 8.** The lease is consumed by the first matching request. Later hops of **that same request** do not require a live lease, subject to all four conditions, each of which fails closed:

1. A **307/308** hop preserves method and body: the new `{origin, path}` must equal the approved `{origin, path}`, or the hop is aborted `POLICY_ROUTE_DENIED` reason `redirect_changed_approved_target`.
2. A **301/302/303** hop that degrades to `GET` follows ordinary GET route policy for the new target; it does not inherit the approval.
3. The whole chain stays under the section 7 redirect cap **and** under one overall deadline, measured from the first matching request, default `windowMs + 5000`, hard maximum 30000 ms. Exceeding either aborts the chain.
4. Hop handling depends on the SPIKE-R `route.fetch({maxRedirects: 0})` fallback; until SPIKE-R reports, 18C does not merge (open item unchanged).

Added to `neg-n2-arming` as cases (k)–(n), with inversions. **OD-22-Q1 (250 ms floor): recorded as confirmed-by-Security, pending owner confirmation; unchanged.**

### m-23 — provenance and stale text

**Provenance correction (REPLACE every `OWNER-10` and `OWNER-11` citation in rev 8 and in the traceability doc).** The ledger is OWNER-01..OWNER-07. Correct mapping:

| Design item | Ledger ID |
|---|---|
| D1 | OWNER-01 |
| D2 | OWNER-02 |
| D3, D4 | OWNER-03 |
| D5 | OWNER-04 |
| D6, D7 | OWNER-05 |
| D8, D9, D10 | OWNER-06 |
| D11 | OWNER-07 |

Therefore: rev 8 2c.10 reads `(D10/OWNER-06)`, not `OWNER-10`; ADR-0043 reads "accepted (owner D11/OWNER-07)", not `OWNER-11`; ADR-0041 reads `(owner D4/OWNER-03)`; ADR-0042 reads `(owner D7/OWNER-05)`. **Note recorded for audit:** the owner decision packet at `3741d42` does not contain D11's text; D11 exists in the owner's message recorded in the production-cycle ledger as OWNER-07, and `docs/phase-18-owner-decisions.md` residual 4 ("Novel vocabulary not in the manifest may classify as permit") is **superseded** by it. DOC must edit that residual in place with a pointer to ADR-0043 so the packet no longer contradicts the design.

Other m-23 edits:

- `docs/phase-18-plan.md:32` — replace "approval flags incl. `--approval-run-token=`" with "approval flags (`--approve-action`, `--emit-token-to`; `--approval-run-token=` never ships)".
- `docs/phase-18-plan.md:91` — `.gitignore` sentence gains `run/plans/` (line 96 already lists all three; the two lines must agree).
- `docs/security/phase-18-threat-model.md:256` — 18B row add `neg-b06-permit-traceability`, `neg-plan-mode-scope`, `neg-c02-no-lowering`. `:258` — 18D row add `neg-shard-protected-action`, `neg-fixture-approval-scope`. `:257` — 18C row add `neg-n1-script-dispatch`.
- **`neg-d1-boot-identity` has one owner: 18E** (it is a filesystem/host-identity behaviour test and belongs with `neg-fs-behaviour`). The threat-model 18A row and the plan 18D row drop it; the rev 8 "18E/18D" phrasing is corrected to 18E.

### HealingTrust open-write verification (closes the SEC-07/SEC-08 UNVERIFIED item for `HealingTrust`)

**CONFIRMED by code: opening `HealingTrust` can write `data/`.** `src/core/AIHealer/HealingTrust.js:63` — the constructor calls `_reload()`. `_reload()` queues an atomic write of `decisionsPath` when the loaded ledger exceeds `HEALING_DECISIONS_MAX_ROWS` (`:98-120`) and of `pendingPath` when `_evictPendingIfNeeded()` evicts (`:122-130`). Unlike `LocatorMemory` (which writes on a *fresh* store because it generates a salt, `LocatorMemory.js:243-253,315-317`), `HealingTrust` writes only when an existing ledger is **over cap** — a realistic operator state, since the caps are 500 rows and 200 entries. **Consequence: rev 8 2c.2(6) is mandatory for both modules, and m-17-Q1 closes only with a test that seeds an over-cap `healing_decisions.json`, an over-cap `healing_pending.json`, a salt-less `locator_memory.json` and an evictable locator store, runs a pilot, and asserts all four file digests unchanged** (plus no file created where none existed). Inversion: remove the pilot read-only/no-open path and the test must fail on each of the four. Owner: 18A, merge condition.

## 3d. Exact edit list

### A. `docs/phase-18-acceptance-criteria.json`

**A1. Metadata**
- `designRevision`: `"fbb1712 (architecture rev 2 plus rev 3..rev 9 patches)"`
- `counts`: `{"total": 91, "must": 82, "should": 6, "could": 3}`

**A2. `openItems` edits**
- `OD-24-Q1` — replace `state` with: `"owner must choose: (a) narrow reading plus the rev 9 section 3b.2 code-enforced fixture-capability boundary (no Must amended; architect recommendation), or (b) strict reading, which makes P18-AC-051's approved half local-only and requires the owner to amend P18-AC-074 to exempt one named test"`
- `OD-20-Q1` — append to `state`: `"; if accepted, admission becomes per root (tmpfs permitted for auth and plans, refused for approvals) and AC-085 states this"`
- `SPIKE-FS` — append: `"; no numeric id may be asserted from a kernel header or from documentation, only observed and committed values; SPIKE-FS also records whether the observed tmpfs id is shared with ramfs"`
- **New** `{"id":"SPIKE-R","ref":"architecture section 7 and rev 9 m-22","state":"redirect-hop behaviour unverified; route.fetch({maxRedirects:0}) fallback mandated; now also gates the four lease redirect-hop rules; 18C merge condition"}` (replaces the existing SPIKE-R entry)
- **New** `{"id":"H-1","ref":"rev 9 section 3a.4","state":"WebSocket frames and service-worker-originated requests are not reliably interceptable; preventive addInitScript ships regardless; documented residual, not a control"}`

**A3. Changed criteria**
- `P18-AC-042` — `components`: replace the trailing `" + rule 3 state-changing-capable predicate (ADR-0043)"` with `" + the closed positive permit set: only an exact manifest permit entry or a frozen read-only action is permitted, everything else is protected (ADR-0043 as amended by rev 9)"`
- `P18-AC-045` — `requirement`: append `"; and no classification is lowered indirectly, through a plan row, a healed or re-resolved element, or provider output — the effective class is the maximum of all three, recomputed at execution from the freshly loaded manifest"`
- `P18-AC-051` — `components`: replace the trailing `"; the approved half is proven through the in-process ApprovalStore API against the loopback fixture, subject to OD-24-Q1"` with `"; the approved half is proven through a fixture-scoped, in-memory-only approval that mints only in a process running a registered loopback-literal fixture server with a per-run in-memory capability, is consumable only for that origin, creates no run/approvals path, and additionally requires the dedicated test-runner flag when CI=true (rev 9 section 3b.2); subject to OD-24-Q1"`
- `P18-AC-084` — `requirement`: append `"; the static check resolves npm/yarn/npx script indirection and node/bash invocations transitively with cycle detection, walks static require graphs, fails on any reachable approve flag, token key, approvals path or approval-module import outside src/core/pilot/ and tests/, and fails closed on any command it cannot statically resolve"`
- `P18-AC-085` — `requirement`: append `"; admission is evaluated per root (auth, plans, approvals) against a per-root admitted-id set, and no id is admissible from a kernel header or documentation — only an observed, committed value"`
- `P18-AC-087` — `requirement`: **replace in full** with `"Classification is total by construction: only an exact manifest permit entry or a member of the frozen read-only action enum is permitted, and every other (element, action) pair is protected — no element-shape enumeration gates the decision; unresolvable or duplicate identities are CONTROL_AMBIGUOUS with zero clicks; unfamiliar vocabulary never yields a permit; every permitted outcome is traceable to a re-validated named manifest entry or the run refuses exit 18"`; `components`: `"ActionClassifier closed positive permit set + frozen read enum + PolicyEngine permit re-validation (D11/OWNER-07, ADR-0043 amended by rev 9); inversion required"`
- `P18-AC-080` — `components`: append `"; FALCON_PILOT_TEST_RUNNER is also asserted absent from .env.example"`

**A4. New criteria (append; all Must)**
```json
{ "id": "P18-AC-089", "priority": "Must", "pr": "18B",
  "requirement": "Classification is recomputed at gate.perform from the freshly loaded manifest against the element actually acted on; the effective class is the maximum of plan row, live recompute and provider advice over denied > protected > permitted; a plan row can never lower a class (it records PLAN_CLASSIFICATION_DRIFT when it tries) and a healed or re-resolved element whose identity differs from the approved one is refused APPROVAL_MISMATCH exit 14",
  "components": "PilotActionGate.perform recompute + maximum rule + heal re-classification (rev 9 section 3a.3)",
  "verification": "U, R" },
{ "id": "P18-AC-090", "priority": "Must", "pr": "18D",
  "requirement": "A fixture-scoped approval mints only in a process holding a live registered loopback-literal fixture server with a matching per-run in-memory capability and a loopback-only manifest, additionally requires FALCON_PILOT_TEST_RUNNER=1 and a tests/ entry point when CI or GITHUB_ACTIONS is true, is held only in memory with no run/approvals path, file, audit chain or receipt created, and is refused at consumption for any non-loopback destination (APPROVAL_REQUIRED exit 14, reason fixture_approval_non_loopback); --approve-action and --emit-token-to refuse exit 1 in CI",
  "components": "ApprovalStore.mintFixtureScoped + FixtureServer in-module registry + gate.perform scope re-check (rev 9 section 3b.2, ADR-0044)",
  "verification": "U, R, S" },
{ "id": "P18-AC-091", "priority": "Must", "pr": "18C",
  "requirement": "The execute-mode network gate decides from method, origin, canonical path, page, frame, resource type, body-size class and the live lease only, and never from a classification, plan row, action record or provider verdict; every unarmed non-GET and every GET to a non-allowed route is aborted regardless of originator, including fetch, XMLHttpRequest, sendBeacon, form.requestSubmit, implicit Enter submission and a dynamically injected form, proven with a deliberately wrong permitted classification on the triggering control",
  "components": "NetworkGate independence (section 7a rule 3a) + neg-n1-script-dispatch; WebSocket and service-worker paths are documented residual H-1",
  "verification": "U, R" }
```
**New totals: total 91, Must 82, Should 6, Could 3.**

### B. `docs/phase-18-plan.md`

- **Status line** — replace the revision range with `rev 3..rev 9 patches`, and `SEC-08 has reviewed the rev 8 delta` with `SEC-09 has reviewed the rev 9 delta`.
- **§1 item 3** — replace the rev 8 append with: `Classification is total by inversion: only an exact manifest permit entry or a frozen read-only action is permitted; everything else is protected (D11/OWNER-07, rev 9 3a).`
- **§3 table, 18D row (line 32)** — replace `approval flags incl. --approval-run-token=` with `approval flags (--approve-action, --emit-token-to; --approval-run-token= never ships)`; add `neg-fixture-approval-scope`; remove `neg-d1-boot-identity` (now 18E only).
- **§3 table** — 18B gains `neg-c02-no-lowering`; 18C gains `neg-n1-script-dispatch` and the `actions.permitted` manifest surface; 18E gains `neg-d1-boot-identity`; 18F gains the transitive workflow reachability check.
- **§6 (line 91)** — `.gitignore` sentence gains `run/plans/` so it agrees with line 96.
- **§6** — append: `The classification revert direction is unsafe in both halves: restoring an element-shape gate or a permit default is a safety regression, so 18B and 18C defects are fixed forward.`

### C. `docs/security/phase-18-threat-model.md`

- **§5.5** — replace the rev 8 append with: `Classification is total by inversion. Only an exact, re-validated manifest permit entry or a member of the frozen read-only action enum is permitted; every other (element, action) pair is protected, so no element shape — ARIA role, JS listener, form= owner, form-associated custom element, shadow DOM, formaction — and no action type — press Enter/Space, setInputFiles, drag, selectOption/check, contenteditable input — can reach a permit by being unenumerated. Script-dispatched requests are gated at the NetworkGate from method, origin and path only, independent of classification, so a classification defect yields a mis-attributed refusal, not a mutation. No plan row, healed element or provider verdict can lower a class. NT: neg-c01-default-protected, neg-c02-no-lowering, neg-n1-script-dispatch, each with its inversion.`
- **§6 item 4** — append: `The element-shape predicate is withdrawn; unenumerated shapes are protected by default, not permitted.`
- **§6 new item 19** — `19. **WebSocket and service-worker egress (H-1).** Frames sent over an open WebSocket and service-worker-originated requests are not reliably interceptable. The preventive addInitScript ships, SPIKE-W records the observed behaviour, and runner-level egress control remains the operator's control (D6). Not a Falcon control.`
- **§6 new item 20** — `20. **Fixture-scoped approvals.** A repository-write attacker can author an in-repo test that mints one, but it is in-memory only, never persisted, and unusable against any non-loopback destination (rev 9 3b.2). Bounded to a self-contained test, not a path to a staging mutation.`
- **§8 gates table** — 18B: add `neg-b06-permit-traceability`, `neg-plan-mode-scope`, `neg-c02-no-lowering`. 18C: add `neg-n1-script-dispatch`, the frozen read-enum assertion. 18D: add `neg-shard-protected-action`, `neg-fixture-approval-scope`. 18E: add `neg-d1-boot-identity`. 18F: add the transitive workflow reachability check. 18A: remove `neg-d1-boot-identity`.
- **§9** — append: `SEC-08 majors M-13 and M-14 are closed in the design by rev 9: M-14 by inverting classification to a closed positive permit set with execution-time recomputation and NetworkGate independence; M-13 by the fixture-capability approval boundary and the transitive static check, subject to the owner's OD-24-Q1 choice. Minors m-20..m-23 are closed. H-1 remains a documented residual; H-2 is answered: no manifest entry permits a non-GET without arming, because the NetworkGate ignores the manifest permit surface entirely.`

### D. ADRs

- **AMEND ADR-0041** (CI may not approve) — append: `A fixture-scoped approval is admitted under the narrow reading only through the code-enforced boundary of rev 9 section 3b.2 (live in-process loopback-literal fixture server from a non-exported module registry, per-run in-memory capability, loopback-only manifest, in-memory-only ledger with no run/approvals path, test-runner flag plus tests/ entry point when CI=true, consumption re-checked for a loopback destination), and the static check resolves script indirection transitively and fails closed on unresolvable commands. --approve-action and --emit-token-to refuse exit 1 in CI as defence in depth against accidents only, since a workflow author controls those variables. If the owner takes the strict reading instead, this amendment is superseded, the approved half of AC-051 becomes local-only and AC-074 must be amended by the owner. Provenance corrected: owner D4/OWNER-03. Status: accepted (amended), pending OD-24-Q1.`
- **AMEND ADR-0043** (unknown state-changing actions default to protected) — replace the decision's rule 3 and rule 4 with: `classification is total by inversion. The permitted set is positive, closed and code-owned: an exact, re-validated manifest permit entry, or a member of a frozen read-only action enum. Every other (element, action) pair is protected. Element shape is never the gate; it may only raise to denied through the destructive-signal detector. Unresolvable or duplicate identities are CONTROL_AMBIGUOUS with zero clicks. The class is recomputed at execution from the freshly loaded manifest against the element actually acted on, and the effective class is the maximum of plan row, live recompute and provider advice; nothing can lower it.` Append consequences: `an enumeration of element shapes can never be complete, so it is removed from the decision path; the cost is that a thin manifest makes every interaction protected, which is the correct direction; reads still run because they are the positive read enum. Revert is unsafe in both halves: fix forward.` Provenance corrected: `owner D11/OWNER-07; the D11 text is in the owner's message recorded as OWNER-07, not in the owner decision packet, whose residual 4 is superseded.` Status: accepted (amended).
- **AMEND ADR-0042** (arming lease) — append the four redirect-hop rules of m-22 and the chain deadline (`windowMs + 5000`, hard maximum 30000 ms), noting dependence on SPIKE-R. Provenance corrected: owner D7/OWNER-05. Status: accepted (amended).
- **AMEND ADR-0030** (filesystem allowlist) — append: `admission is evaluated per root (auth, plans, approvals) with a per-root admitted-id set; if OD-20-Q1 is accepted, tmpfs appears in the auth and plans sets and never in the approvals set. No numeric id is admissible from a kernel header, documentation or reviewer knowledge — only an observed, committed SPIKE-FS value, which must also record whether the platform's tmpfs id is shared with ramfs. Behaviour tests establish atomicity, rename semantics and fsync success with consistent read-back; they cannot establish durability, and no document may claim they do.` Provenance corrected: owner D5/OWNER-04. Status: accepted (amended).
- **ADR-0044 (new) — fixture-scoped approvals are a process-local capability, not a label.** Context: the narrow reading of OD-24 exempts a hermetic in-process test that mints an approval through the `ApprovalStore` module API, but `approver: "test-fixture"` is a string any caller can supply, so the CI self-approval prohibition would be policy-only. Decision: fixture-scoped minting requires a live `net.Server` handle in a non-exported `FixtureServer` module registry bound to a loopback **literal**, a per-run in-memory capability, a loopback-only manifest digest, and — when `CI` or `GITHUB_ACTIONS` is true — both the dedicated test-runner flag and a `tests/` entry point; the approval is in-memory only, creates no `run/approvals` artifact, and is refused at consumption for any non-loopback destination. The static workflow check resolves script indirection transitively and fails closed on unresolvable commands. Consequences: a process that has not started a loopback fixture cannot mint, by construction; production code paths cannot reach the mint function without importing an approval module the static check forbids; the residual is an in-repo test authored by someone with write access, bounded to loopback. Alternative rejected: a shared secret or an env-var test mode, both forgeable from a workflow step. Status: proposed, pending the owner's OD-24-Q1 choice; **if the owner takes the strict reading this ADR is withdrawn and AC-074 is amended instead.**

### E. `docs/phase-18-decision-traceability.md` — mapping rows

- Correct the header note to: `maps each recorded owner decision (OWNER-01..OWNER-07; D1=OWNER-01, D2=OWNER-02, D3 and D4=OWNER-03, D5=OWNER-04, D6 and D7=OWNER-05, D8/D9/D10=OWNER-06, D11=OWNER-07) ...` and record that D11's text is in the owner's message recorded as OWNER-07, not in the owner decision packet.
- **D4 row** — AC(s) `AC-084, AC-051, AC-074, AC-090 (new)`; ADR `ADR-0041 (amended), ADR-0044 (new)`; tests add `neg-fixture-approval-scope` (U/R/S: mint without a registered server; `localhost` host; hostname host; wrong capability; non-loopback manifest origin; `CI=true` without the runner flag; `CI=true` with the flag but a non-`tests/` entry; consumption against a staging origin; assertion that no `run/approvals` path exists) and the transitive reachability inversions of 3b.3(6).
- **D11 row** — AC(s) `AC-087 (rewritten), AC-042, AC-043, AC-045 (extended), AC-048, AC-089 (new), AC-091 (new)`; tests add `neg-c01-default-protected` (15 cases of 3a.6), `neg-c02-no-lowering`, `neg-n1-script-dispatch`, each with its inversion.
- **D2 row** — tests: replace `m-17(b) open-write verification` with `the four-file no-write test of rev 9 3c (over-cap healing_decisions.json, over-cap healing_pending.json, salt-less locator_memory.json, evictable locator_store.json; all four digests unchanged; inversion required)`. Note: `HealingTrust` open-write is now **CONFIRMED by code** at `HealingTrust.js:63,98-120,122-130`.
- **D5 row** — add the per-root admission and the `ramfs`/`CONFIG_SHMEM` recording duty; `neg-d1-boot-identity` owner is **18E** only.
- **D7 row** — add the four redirect-hop cases and the chain deadline to `neg-n2-arming` (k)–(n).
- **New row** — `| m-20 permit re-validation | AC-087, AC-038 | ADR-0043 (amended) | 18C (schema) + 18B (plan) | neg-b06-permit-traceability extended: absent entryId → PLAN_PERMIT_UNJUSTIFIED exit 2; mismatched entry → PLAN_DRIFT exit 2; wildcard actionKey on a non-read action → MANIFEST_INVALID at load. Inversion required |`
- **Unsound-or-underspecified list** — item 2: delete the magic-number claim and replace with the SPIKE-FS observation duty; item 7: mark resolved by the `actions.permitted` surface of 3c m-20; **new item 9**: `D11 as written gated on element shape, which cannot be made total; rev 9 inverts the rule rather than extending the enumeration. This strengthens OWNER-07's intent and weakens nothing, but it is an architect-chosen mechanism, not owner text, and is flagged as such.`

## 3e. Handoffs

- **Developer.** Implement nothing until the coordinator dispatches a PR. 18C: the positive permit set, the frozen read enum, `actions.permitted` schema surface, NetworkGate independence. 18B: recompute-at-perform, the maximum rule, heal re-classification, permit re-validation. 18D: `mintFixtureScoped` and the `FixtureServer` registry — do not add a flag, env var or argument that can register a server or supply a capability. 18F: the transitive reachability check. Do not write an element-shape predicate as a gate anywhere.
- **QA.** New/extended tests: `neg-c01-default-protected` (15 cases), `neg-c02-no-lowering`, `neg-n1-script-dispatch`, `neg-fixture-approval-scope`, `neg-b06-permit-traceability` (extended), `neg-n2-arming` (k)–(n), the four-file pilot no-write test, the transitive static-check inversions. Every `neg-*` needs its inversion demonstrated failing. Do not weaken any case to make a shape pass.
- **Security (SEC-09).** Review only the rev 9 delta: is the positive permit set (P1/P2) genuinely closed and is the frozen read enum free of any member that can activate or dispatch; does 3a.3's maximum rule close every indirect lowering path; is the 3b.2 fixture boundary unforgeable from a workflow step; does 3b.3 resolve the indirection you would use; are m-20..m-23 closed. H-1 and the 3b.2 residual are not risk-accepted by me.
- **DevOps.** `ci.yml`: no approve step and no token key anywhere (unchanged); the static check becomes a reachability analysis over `package.json` scripts and every invoked script, and **fails closed on commands it cannot resolve** — expect to make existing workflow commands statically resolvable. `FALCON_PILOT_TEST_RUNNER=1` is set only by the pilot test runner entry point and only for the pilot test job. SPIKE-FS must record the `tmpfs`/`ramfs` id relationship per platform. GoogleSearchTest stays out of CI.
- **Owner.** One decision needed: OD-24-Q1 per 3b.1. Recommendation: narrow reading with 3b.2/3b.3 mandatory. Also pending confirmation: OD-20-Q1 (per-root allowlist), OD-22-Q1 (250 ms floor), OD-22-Q2 (m-22's four conditions), OD-23-Q1 (keep exit 14).
