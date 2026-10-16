# Phase 18 Security Design Re-review 9 (SEC-10)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `5752e87` on `docs/phase-18-architecture` (architecture rev 2 plus the [rev 3](../architecture/phase-18-rev3-patch.md) to [rev 10](../architecture/phase-18-rev10-patch.md) patches; base `2572e73`). Scope: the rev 10 delta only. That is ARCH-10 and the edits it caused to the acceptance criteria (AC-051, 074, 080, 084, 085, 086, 090 rewritten, 092 new), threat-model section 6 item 20, section 8 and section 9, the [decision traceability](../phase-18-decision-traceability.md), the [owner decision packet](../phase-18-owner-decisions.md) and the [plan](../phase-18-plan.md). These are checked against [re-review 8](phase-18-design-review-8.md) (SEC-09) and owner decisions OWNER-09, OWNER-10 and OWNER-11. This record supersedes re-review 8. It is a design review only. No code for 18D exists, so nothing below is a runtime observation.

**Verdict: APPROVE WITH CONDITIONS for 18E, 18A, 18C, 18F and DOC. BLOCK for 18D until M-15 is closed in the design.** No P0. **Blockers: 0. Majors: 1 open (M-15, P1 for 18D).** New minors: 5 (m-29..m-33). m-25 is CLOSED. **The owner's requirement "Security reports zero blockers and zero majors" is NOT met** because M-15 is open. No Must criterion, no OD-01..OD-19 and no owner decision is weakened. No risk is accepted here.

## Facts verified

- **AC JSON is valid.** It has 92 criteria (Must 83, Should 6, Could 3) and no duplicate IDs. `counts` matches the actual priorities, and `designRevision` reads rev 3..rev 10. P18-AC-092 is present (Must, 18D). AC-051, 074, 080, 084, 085, 086 and 090 carry the rev 10 A3 text. `openItems` contains OD-24-Q1 and OD-20-Q1 (both RESOLVED), SPIKE-R (now covering 301, 302, 303, 307 and 308) and OWNER-10-RESIDUAL.
- **Withdrawn terms.**
  - `FALCON_PILOT_TEST_RUNNER` and `mintFixtureScoped` now appear outside the rev 9 patch only in withdrawal text: AC-080, AC-084, AC-090, the OD-24-Q1 state, the owner packet, traceability and threat-model section 9.
  - The phrase "not a path to a staging mutation" now appears only in the rev 10 deletion instruction and in the traceability m-25 row, which quotes it to delete it. It also remains in rev 9 3b.1 (`phase-18-rev9-patch.md:89`). That section is covered by the rev 9 status-line SUPERSEDED pointer but is not marked at the line itself (m-33).
  - `CI=true` remains only in the rev 10 4a.5 accident-guard text and in the unrelated `docs/phase-15-plan.md:414`.
- **CODEOWNERS.** No `CODEOWNERS` file exists at the root, in `.github/` or in `docs/`. Every reference calls it recommended, and nothing claims it is enforced. This is CLOSED.
- **Threat model.** Section 6 item 20 carries the OWNER-10 limitation wording. The section 8 rows for 18B, 18D and 18E carry the new tests.
- **Plan.** The plan's 18D row lists the seam, the authority, the fixture server, the tests-only executable and the three tests. It labels them "rev 9 adds" when it should say rev 10 (m-33). The plan status line does not yet claim SEC-10, which is correct.
- **Production loading.** `falcon.js` and `src/` contain no non-literal `require`, and `LlmProviderRegistry.js:6` is explicitly non-dynamic. No config or argv value can load a module today. `scripts/*.js` use `require(path.join(<literals>))`, so the require-graph walker must resolve those (m-30).
- **Arg parsing.** `falcon.js:474-540` reads `process.argv.slice(2)` against literal flags. **Not checked:** whether it ignores unknown flags, as rev 10 states (UNVERIFIED in detail).
- **Package scripts.** No `package.json` script names `tests/pilot/bin/`. `test:regression` runs only `tests/regression/*.check.cjs`, so the executable is reached only through the spawning check. This matches R-3.
- **Approval objects.** The architecture specifies no brand, freezing or private slot for approval objects. `grep` for brand, WeakSet or frozen approval in the architecture docs finds the gated-page WeakSet only. This is the basis of M-15.

## Item status

### (1) Fixture-only approval boundary: PARTIAL (M-15 open, m-29)

What holds:

- **No production path to the authority.** The authority is a test-only class. Nothing under `src/`, `scripts/` or `falcon.js` requires it, there is no dynamic loader, and no environment variable, flag, config key or manifest field selects a source.
- **`ApprovalStore` has no mint surface.** Its constructor is closed. `mintFixtureScoped` is withdrawn in text everywhere it is load-bearing.
- **The authority is confined to loopback for a well-behaved caller.** It derives its origin from a live loopback-literal server, holds a per-run capability compared with `timingSafeEqual`, and has no `fs` module in its require graph. It accepts no URL, and IPv4-mapped (`::ffff:127.0.0.1`), `localhost` and DNS names all fail the literal check closed. WHATWG normalisation of `127.1` or decimal hosts yields `127.0.0.1`, which is still the same local host.
- **The executable's case enum is sufficient** for a well-behaved caller. It takes a frozen case id, creates its own server and has no URL surface.
- **The "AND" reading (R-1) is correct.** "Or verifies its capability" alone would require adopting a server created elsewhere, which is a registration surface.
- **R-3 is acceptable from the security side.** A user who runs `npm run test:regression` reaches only the frozen loopback cases. The owner still confirms intent; this is not a risk acceptance.
- **Prototype pollution of `Object.prototype`** cannot supply own properties to a frozen or private-slot object. That is exactly why M-15 requires one.
- **`process.binding`, `require.cache`, `Module._load`, built-in monkeypatching and `child_process` from a new test** all mean modifying repository code in effect. They fall in the OWNER-10 accepted class, and the AC-092 wording must say so (m-30).

What fails is M-15 below: the claim "within the unmodified repository the authority cannot reach an arbitrary target" is not guaranteed by the design as written.

### (2) Arbitrary-target resistance (AC-092): PARTIAL (M-15, m-30)

The AC-092 tests are the right shape: public surface only, a byte-identical filesystem, a static require graph and required inversions. But:

- the attempt list does not include the relabel, binding-mutation, wrapper-source and duck-typed-server cases of M-15;
- the claim "resists prototype mutation" is unfalsifiable against arbitrary in-process code unless the attempt surface is bounded (m-30).

### (3) Redirect continuation (4d.2): PARTIAL (m-31, m-32), SPIKE-R dependent

What holds:

- **The method rule.** Observed, never inferred; one consumption; no hop mints or refreshes a lease; a hop that becomes GET falls back to ordinary GET policy with the destructive-GET residual unchanged; ambiguity fails closed. The lease cannot be consumed twice as a lease.
- **The cap and deadline together** bound time and hop count.

What does not:

- **m-31: same-target non-GET continuation can repeat the mutation.** Rule 3 and case (k) allow a 307/308 to the identical target to continue. Each such hop re-transmits the approved body, so one approval can deliver up to `MAX_REDIRECTS = 10` mutating requests (`authenticated-pilots.md:260`).
- **m-32 (a): the fallback may not be implementable.** Playwright route handlers are believed not to be called for browser-followed redirect hops (hypothesis H-5). In that case "abort as ambiguous" has no interception point, and the hop proceeds unobserved.
- **m-32 (b): the main document contradicts rev 10.** `phase-18-authenticated-pilots.md:645` still names the `route.fetch({maxRedirects:0})` fallback as "the shipped implementation", which R-4 rejects.
- **m-32 (c): one test cannot be built.** `windowMs` is at most 10000, so `windowMs + 5000` is at most 15000, and the 30000 ms absolute limit is unreachable with valid config. The second half of case (q) cannot be constructed as written.

### (4) tmpfs separation and missing versus broken history: CLOSED, with m-29(c)

- **The per-root split is sound.** tmpfs is refused for `run/approvals` with exit 18. The R-5 uid, `0700`, no-symlink and real-path checks still apply to `run/auth`, and a memory-backed auth root helps confidentiality.
- **Deleting the ledger is not exploitable.** It yields exit 14. All prior approvals vanish with it, nothing is reconstructed, and nothing replays, so the effect is denial plus loss of accountability, not a bypass.
- **Rolling back to an older valid prefix** together with a run token needs the same uid, and that actor can already approve interactively (a pseudo-TTY defeats the TTY guard). This adds no capability beyond existing residuals.
- **"Missing" is not defined precisely.** See m-29(c).

### (5) Documentation consistency: PARTIAL (m-33)

The AC JSON, threat model, traceability and owner packet are consistent. The stale items are listed in m-33.

## Findings

**M-15 (Major, P1 for 18D; design). The gate distinguishes ledger from fixture approvals only by a self-declared `scope` string on a mutable object.**
- *Evidence:*
  - Rev 10 4a.3 item 8 applies the loopback re-check only to "a `scope: "fixture"` approval".
  - Section 4a.2 refuses non-ledger sources in `PilotRuntime` by `scope !== "ledger"`.
  - Section 4a.4(a) has the test construct `PilotApprovalResolver` directly and drive the real `PilotActionGate`, so the gate accepts a caller-supplied resolver.
  - No section freezes the approval or brands ledger approvals. The `perform` signature (`authenticated-pilots.md:97`) takes no store.
- *Abuse case (public surface, unmodified source, as AC-092 itself permits):*
  1. Resolve a genuine loopback fixture approval.
  2. Assign `approval.scope = "ledger"` and replace `approval.binding` with a staging binding.
  3. Return it from a wrapper source `{scope: "ledger", resolve}` in a directly constructed resolver.
  4. The gate then skips the fixture re-check, and binding equality passes on the mutated binding. The result is an authorised non-loopback POST through Falcon's authenticated context, which is the OWNER-10 blocker condition.
- *Second abuse case:* a duck-typed `server` (`{listening: true, address: () => ({family: "IPv4", address: "127.0.0.1", port: P})}`) points a fixture approval at a loopback service the test did not create, such as a port-forward. That violates AC-092(ii).
- *Likelihood:* low; it needs test code. *Impact:* high; it defeats the property the owner made a blocker.
- *Remediation (design text before 18D):*
  - **(a)** `ApprovalStore.consume` returns a frozen approval and adds it to a module-private `WeakSet` brand that `PilotActionGate` checks. The brand is never exported, and `scope` is never trusted.
  - **(b)** Any approval without the ledger brand is treated as fixture-scoped whatever its declared scope, and must pass the loopback, liveness and port re-check.
  - **(c)** Binding and server references are held in private slots or a gate-side `WeakMap`, not in mutable own properties.
  - **(d)** The gate requires `server instanceof net.Server` and reads the address through `net.Server.prototype.address` captured at module load. It accepts only the port of that object.
  - **(e)** The `PilotRuntime` refusal checks class identity or the brand, not the `scope` string.
- *Verification:* the AC-092 attempt suite adds the relabel, binding-mutation, `defineProperty`, wrapper-source and duck-typed-server cases, each with an inversion (remove the brand check and the case must fail).

**m-29 (Minor, 18D/18E).**
- **(a)** The in-process check in 4a.4(a) builds a `ledgerSource`. Its `ApprovalStore` must use a temporary approvals root outside `run/`, or opening the store will create `run/approvals` and contradict the "absent" assertion.
- **(b)** "No filesystem dependency at all" (rev 10 line 10) overstates. The executable reaches production pilot modules and fixture files. Only the authority and the fixture server are fs-free; restate it.
- **(c)** Define "missing" approval history exactly: approvals root absent. Treat any zero-length, partial or headless store as unverifiable (exit 18). Have a freshly initialised ledger write a genesis entry noting that no prior history was found, so a reset is visible in audit.

**m-30 (Minor, 18D/18F).** AC-092 must bound its attempt surface. In scope: argument values, own-property assignment, deletion and `defineProperty` on returned objects, `Object.prototype` pollution of the relevant keys, duck-typed substitutes, wrapper sources, and serialisation or cross-process replay. Out of scope, as repository modification under OWNER-10: monkeypatching built-ins, `require.cache`, `Module._load` or `process.binding`. The require-graph walker resolves `require(path.join(<literals>))` and fails closed on any other non-literal require (ties to m-24(e)).

**m-31 (Minor, 18B).** At most one transmission of the approved non-GET per approval. Abort a non-GET same-target continuation hop, or allow exactly one, and record every transmission in audit. Case (k) gains a self-redirect loop asserting a mutation count of at most 1.

**m-32 (Minor, 18B/DOC; SPIKE-R).**
- SPIKE-R must also prove that an **enforcement point** exists for each hop. If none exists, protected non-GET actions that receive a 3xx are NO-GO, rather than relying on an abort that cannot be performed.
- Correct `authenticated-pilots.md:645`.
- Fix case (q): drop the unreachable 30000 ms half, or drive it with an injected clock.

**m-33 (Minor, DOC).**
- Mark rev 9 `:89`, `:93-99`, `:183`, `:192-193` and `:216` inline as withdrawn.
- Correct the plan's 18D row from "rev 9 adds" to "rev 10 adds".

## Hypotheses (unverified)

- **H-5.** Playwright `route` handlers are not invoked for browser-followed redirect hops. SPIKE-R decides.
- **H-6.** Chromium sends loopback through a configured proxy only with `<-loopback>`. The m-25(c) proxy refusal stands regardless.
- **Carried.** H-1 and H-3 are unchanged.

## Verdict per PR

| PR | Blockers / majors | Merge conditions |
|---|---|---|
| 18E | 0/0 | m-29(c), m-26(b) and the SEC-07 conditions |
| 18A | 0/0 | Four-file post-exit digest test |
| 18C | 0/0 | m-20, m-26, SPIKE-R and H-3 documentation |
| 18B | 0/0 | m-22, m-27, m-31, m-32 and SPIKE-R |
| **18D** | **0/1** | **Blocked from starting until M-15 is designed.** Then m-29(a)/(b) and m-30 |
| 18F | 0/0 | m-24 and m-30 (walker) |
| DOC | 0/0 | m-32(b) and m-33 |

Previous findings: m-25 CLOSED. m-21 and m-23 are unchanged from SEC-09 (not re-verified; UNVERIFIED). m-24, m-26, m-27 and m-28 stay open.

## Owner items (none accepted)

R-3 confirmation; R-6 intent; H-1; OWNER-10 is recorded as the owner's acceptance and is not re-accepted here; every residual carried from re-reviews 6 to 8.
