# Phase 18 Security Design Re-review 10 (SEC-11)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `f1ec8ae` on `docs/phase-18-architecture` (architecture rev 2 plus the [rev 3](../architecture/phase-18-rev3-patch.md) to [rev 11](../architecture/phase-18-rev11-patch.md) patches; base `2572e73`). Scope: the rev 11 delta only. That is ARCH-11 section 5h items 1 to 4, plus the documentation edits of 5e and 5f. These are checked against [re-review 9](phase-18-design-review-9.md) (SEC-10: M-15, m-29..m-33, H-5). This record supersedes re-review 9. It is a design review only. No 18D code exists. The runtime facts below come from standalone probes in a scratch directory, not from Falcon code.

**Verdict: BLOCK for 18D. APPROVE WITH CONDITIONS for 18E, 18A, 18C, 18B, 18F and DOC.** No P0. **Blockers: 0. Majors: 1 open (M-16, P1 for 18D).** M-15 is PARTIAL: the scope-string defect is closed, and the remaining defect is re-raised as M-16. New minors: 5 (m-34..m-38). **The owner's requirement "Security reports zero blockers and zero majors on the revised design" is NOT met.** No Must criterion, no OD-01..OD-19 and no owner decision is weakened. No risk is accepted here.

## Runtime probes (Node v22.19.0 and v25.6.1, identical results; Node 24 UNVERIFIED, bracketed)

| Probe | Result |
|---|---|
| `#b in x` for a real instance | true |
| `#b in x` for `Object.create(C.prototype)`, `Object.create(realInstance)`, `new Proxy(realInstance, {})`, `structuredClone(real)`, primitives, `null` | all false; the try/catch form never throws |
| Static block inside the class | parses and runs |
| **`new (Object.getPrototypeOf(real).constructor)(attackerFields)`** | **branded true** |
| **`Reflect.construct(real.constructor, [...])`, `class S extends real.constructor {}`** | **branded true** |
| Constructor guarded by a module-private key object, with `Object.setPrototypeOf(this, null)` before freeze and `delete C.prototype.constructor` | direct call and subclass refused; the brand predicate still true on the genuine instance |
| `Object.freeze(Buffer.alloc(32))` | throws `TypeError: Cannot freeze array buffer views with elements` |
| `fake = Object.create(net.Server.prototype)` with own `_handle.getsockname` writing 127.0.0.1:4444 | `fake instanceof net.Server` is true; the captured `net.Server.prototype.address.call(fake)` returns `{address:"127.0.0.1",family:"IPv4",port:4444}`; the captured `listening` getter returns true |
| `net.Server.prototype` `listening` descriptor | an accessor with get and set (the claim holds) |

## Item status

### (1) M-15 closure (5a): PARTIAL, giving new major M-16 and minors m-34, m-35, m-36

What holds:
- Trust inversion. No production read of `scope`, and unbranded objects are fixture-class.
- Deep freeze removes relabel, re-bind, `defineProperty` and own-property pollution on approval objects.
- The private field is unreadable and uncopyable. Prototype-create, Proxy and clone all fail.
- `PilotRuntime` checks the source by reference identity and validates options against a closed allowlist. `falcon.js` parses literal flags only (re-verified in rev 11; accepted).
- There is no in-process ledger writer in `ApprovalStore`.

What fails:
- **The brand is mintable by anyone who holds one branded instance** (M-16). The private-field mechanism is sound. The constructor that installs the field is not private.
- **The captured intrinsics do not defeat a duck-typed server.** They defeat only a plain object (m-35).

The pty question:
- A child process can allocate a pty (`script`, `python3 -m pty` via `child_process`). It can read the printed challenge and type it back. That is inside the OWNER-10 accepted class only when it is spawned from a new or edited test file.
- Separately, an in-process call made from a developer's real terminal sees `isatty(0) && isatty(1)` as true, so the gate prompts. It does not refuse (m-34).

### (2) Bounded AC-092 surface (5c): PARTIAL (m-35)

The in-scope/out-of-scope split is the right OWNER-10 boundary: public-surface misuse is in scope, and code or intrinsic modification is out. The in-scope list is **not exhaustive**. It omits:
- objects whose prototype is set to a real class prototype (`Object.create(net.Server.prototype)`, `Object.setPrototypeOf`);
- recovery of a class reference through `.constructor`, plus `Reflect.construct` and subclassing;
- a duck-typed fixture authority or capability holder;
- a Proxy around a genuine approval.

R-8 is acceptable as a stated residual **only if** m-35(c) is made normative. Without it, a hand-built unbranded approval with a prototype-built server reaches any loopback port, including a pre-existing port-forward, with no new server code.

### (3) Redirect continuation (5d): CLOSED for design, SPIKE-R dependent
- Under branch A, the transmission counter bounds a same-target 307/308 loop to one mutation, and case (k) is the right test.
- Branch B is the correct H-5 fallback. Refusing all protected non-GET before arming is stricter than SEC-10 required, and it is R-7 for the owner.
- `route.fetch({maxRedirects:0})` is withdrawn at `authenticated-pilots.md:260` and `:645`.
- Case (q), which uses an injected clock and leaves the unreachable 30000 ms bound documented but untested, is acceptable.
- New hypothesis H-7: Chromium may resend a non-idempotent request on a failed reused socket, below the route layer. SPIKE-R should record whether any such resend is observable.

### (4) Missing versus unverifiable and the genesis entry (5b item 3): PARTIAL (m-37)
- **Deleting the ledger to reset replay protection is safe.** It yields exit 14. Nothing is reconstructed, and new trust needs an interactive approval.
- **Rollback to an older valid snapshot without consumption markers** is the existing same-uid residual, unchanged.
- **A read cannot initialise a root**, and the genesis entry gives visibility of initialisation. It is not tamper evidence against same-uid deletion, because deleting again erases it too; this is stated, not accepted.
- **"Missing" can be induced while history exists.** Two cases do it: a dangling symlink at the root, because realpath gives ENOENT; and a root holding only non-ledger files (a lock or marker), because "no ledger object" is undefined (m-37).

### (5) Documentation: PARTIAL (m-38)
These edits are confirmed:
- **AC JSON** is valid. It has 93 criteria (Must 84, Should 6, Could 3) with unique IDs, and `counts` and `designRevision` match. AC-093 is Must. The AC-085, 086, 090 and 092 text is present. H-5 and R-7 are in `openItems`.
- **Rev 9 withdrawals.** Rev 9 `:89`, `:93`, `:183`, `:192` and `:216` carry the WITHDRAWN marker. The overclaim survives only struck through with its withdrawal annotation, or quoted inside deletion text.
- **Remaining references.** `FALCON_PILOT_TEST_RUNNER` and `mintFixtureScoped` appear only in withdrawal text. `CI=true` appears only in the unrelated `phase-15-plan.md:414`.
- **Other documents.** The threat-model item 21, the owner packet residuals 25 and 26 with R-7, the traceability M-15 table and the main-document status lines are present.
- **Plan.** The 18E and 18B rev 10 edits are applied, and the plan does not yet claim SEC-11, which is correct.

## Findings

**M-16 (Major, P1 for 18D; design). The `LedgerApproval` constructor is reachable from any branded instance, so the brand can be minted.**
- *Evidence:*
  - Rev 11 5a.2 item 1 declares an unguarded `constructor(sealedFields)` that sets the field.
  - Item 3 claims the design "survives an attacker holding a genuine branded instance".
  - The probe gives `Object.getPrototypeOf(a).constructor === LedgerApproval`. A new instance built with attacker fields is branded. `Reflect.construct` and subclassing also brand.
  - Deep freeze does not hide `.constructor`.
  - 5a.5 case 10 enumerates exports only, so it passes vacuously.
- *Abuse case:* the in-scope surface allows a literal `require` of `ApprovalStore` and calls with adversarial arguments.
  1. A test opens the real approvals root while a human-approved entry is pending, or code in the process during an approved run holds a genuine approval.
  2. It constructs ledger-class approvals with any binding (staging origin, any method and path).
  3. These skip every loopback rule and the single-use consumption marker.
- *Likelihood:* low. *Impact:* high. One human approval becomes unlimited authorised mutations.
- *Remediation:*
  - **(a)** The constructor requires a module-private, never-exposed key object (`if (key !== SEAL_KEY) throw`).
  - **(b)** Inside the constructor, call `Object.setPrototypeOf(this, null)` before the deep freeze, and `delete LedgerApproval.prototype.constructor`.
  - **(c)** AC-093 and 5a.2 state (a) and (b) normatively.
- *Verification:*
  - New attempt cases: `new (Object.getPrototypeOf(a).constructor)(...)`, `Reflect.construct`, `class extends`, and `Object.getPrototypeOf(a) === null`.
  - Inversion: drop the key check, and the case must fail.
  - Extend the S check from exports to reachable constructors of returned objects.

**m-34 (Minor, 18D). The in-process writer refusal is wrong at a real terminal.**
- 5a.5 case 9 expects `approve_flag_non_interactive`. When the test runs from a developer terminal, fds 0 and 1 are TTYs, so the writer prompts. That makes the test nondeterministic, and it lets a malicious test solicit the developer's typed challenge for a binding the attacker chose.
- *Remediation:*
  - `write()` also refuses unless `require.main` is the `falcon.js` module (real path captured) and the `--approve-action` flag was parsed.
  - The prompt shows method, origin, canonical path and manifest digest before the challenge.
  - Case 9 runs with piped stdio and under a pty, and both refuse.

**m-35 (Minor, 18D). The claim that "a duck-typed server cannot lie" is false.**
- `Object.create(net.Server.prototype)` with an own `_handle` passes 5a.3(b), (c) and (d) (probe above).
- The source of the expected value in 5a.3(f) is unspecified. Production code cannot require the test-side capability WeakMap, so the expected value must come from a caller-supplied object, which can be duck-typed.
- *Remediation:*
  - **(a)** Correct 5a.3, AC-093, ADR-0044 and threat-model item 20.
  - **(b)** Add the prototype-built server, duck-typed authority, Proxy and class-reference cases to the AC-092 in-scope list and to 5a.5.
  - **(c)** Make it normative that a gate constructed by `PilotRuntime` refuses every unbranded approval (exit 14), so the fixture class exists only for a gate that test code constructed directly. Test this with an inversion.

**m-36 (Minor, 18D).** 5a.3(a) requires every nested object to be frozen, but `capabilityProof` is a `Buffer`, and freezing a Buffer throws. Hold the proof in a gate-side WeakMap or another non-freezable-exempt slot, and state the exemption.

**m-37 (Minor, 18E).**
- Define missing as: realpath of the root gives ENOENT **and** `lstat` of the root path gives ENOENT, or the root is an empty directory.
- A dangling symlink is exit 18 under the no-symlink rule.
- Any entry of any kind, including a lock, a marker or an unknown file, without a verifiable chain is exit 18.
- Add these three states to the AC-085 matrix.

**m-38 (Minor, DOC).** Rev 11 5e item 2 is not applied: `docs/phase-18-plan.md:32` (the 18D row) still reads `rev 9 adds:` for rev 10 content.

## Hypotheses (unverified)
- **H-5.** Unchanged; SPIKE-R decides.
- **H-7.** A Chromium socket-retry resend of a non-GET is not visible to route handlers. This is relevant to branch A.
- **Node 24.** The intrinsic and brand behaviour was not run on Node 24. It is identical on 22 and 25, and the DevOps check before 18D stands.
- **H-1 and H-3.** Carried.

## Verdict per PR

| PR | Blockers / majors | Merge conditions; may start? |
|---|---|---|
| 18E | 0/0 | m-37, m-29(c), m-26(b) and the SEC-07 conditions. **May start.** |
| 18A | 0/0 | Unchanged |
| 18C | 0/0 | Unchanged plus SPIKE-R |
| 18B | 0/0 | m-27, m-31 (designed), SPIKE-R branch selection and H-7 |
| **18D** | **0/1** | **May not start until M-16 is closed in the design.** Then m-34, m-35, m-36 and m-30 |
| 18F | 0/0 | m-24 and the walker |
| DOC | 0/0 | m-38 and the m-35(a) text corrections |

Previous findings: M-15 PARTIAL (it becomes M-16). m-29(a)/(b), m-30 (design), m-31, m-32 and m-33 are CLOSED, except the m-38 residue. m-29(c) is PARTIAL (m-37). m-24, m-26, m-27 and m-28 stay open. m-21 and m-23 are UNVERIFIED.

## Owner items (none accepted)
- R-7, for branch B.
- R-8, conditional on m-35(c).
- Residual 25: a pty driving the challenge.
- Every residual carried from re-reviews 6 to 9.

## Owner scope addition: executable probes and required tests

The probes ran on Node v22.19.0 against a scratch model of rev 11 5a.2 to 5a.3 as written. The model has a non-exported private-field class, an exported predicate only, a deep freeze and captured intrinsics. The model and its attack script are kept in the session scratchpad and are not committed. The model's `__test_seal` export stands in for a human-approved consumption only.

### (a) Brand and export: results
- **Fail as intended** (the predicate returns false): `Object.assign`, spread, `structuredClone`, JSON round-trip, prototype replacement, Proxy, `Object.create(proto)`, and calling the predicate on an object (it cannot transfer the brand).
- **Pollution has no effect.** `Object.prototype` pollution before and after module load is visible only as an inherited, non-own property, and it is harmless because nothing reads `scope`. An inversion that reads `approval.scope` must fail.
- **Freeze works for plain values.** Re-binding is a silent no-op in sloppy mode and throws in strict mode. Arrays and nested objects are immutable.
- **New defect (folded into m-36).** A `Date` inside a frozen binding is still mutable through `setTime`, because the freeze does not cover the internal slot. Buffers cannot be frozen at all. Bindings must therefore hold primitives only (epoch numbers or ISO strings) and must never be `Date` or typed arrays.
- **Confirms M-16.** The constructor recovered from the prototype minted a branded approval for `https://staging.example`.
- **The export list cannot detect M-16.** Enumerating exports, including through `require.cache`, shows only the exported names.
- **Reuse against another plan, manifest, role, origin, action or build: UNVERIFIED by probe.** This is eight-field binding equality, which is unchanged from rev 9 3a.3. It needs one runtime case per field (see below).

### (b) Captured intrinsics and server identity: results
- **Fail as intended:**
  - a plain duck-typed server (untrusted);
  - a `0.0.0.0` bind and a `::ffff:127.0.0.1` bind (non-loopback);
  - a server that was closed (not live). Close and reopen therefore invalidates the old server object.
- **Pass when they should fail:**
  - **a prototype-built fake** (m-35);
  - **a real loopback `net.Server` the test created itself**. Production code accepts it, and only the harness's `isFixtureServer` refuses it (R-8, m-35(c)).
- **Address aliases.** WHATWG normalises `127.1` and `2130706433` to `127.0.0.1`, which is the same host and does not widen the boundary. `localhost`, `0.0.0.0` and `[::ffff:7f00:1]` stay distinct and fail the literal compare. `[0:0:0:0:0:0:0:1]` normalises to `[::1]`.
- **Intrinsics captured before hostile code.** This holds only if the gate module is required before any test code runs. A require-order assertion is needed: the gate module is loaded first and the captured values match the real ones. Otherwise it is UNVERIFIED.
- **UNVERIFIED (the fixture harness is not modelled):** whether the capability can be serialised or sent to another process, and whether a fixture server from another run fails.

### (c) PTY approval test: sound with conditions; lives in 18D, with 18F wiring
It is sound **only as test automation of the single production interface**. The conditions:
- It spawns `node falcon.js --approve-action` under a pty, with a temporary approvals/audit root passed as a constructor-level config. It never uses an environment variable or flag.
- The environment is stripped to an allowlist (no `*_KEY`, `*_TOKEN`, `CI`, `GITHUB_ACTIONS`, proxy variables or HOME credentials).
- The target is a hermetic loopback fixture. A network gate asserts zero non-loopback requests.
- It parses the prompt and asserts the plan digest, role, origin, method and path, and the build id. It types the challenge exactly once.
- It then asserts that replay and each single-field binding substitution give exit 14.
- It asserts the temporary root is removed and that the real `run/` digest is unchanged.
- **Negative half:** piped stdio refuses with exit 1, `CI` set refuses, a wrong challenge refuses, and a source grep finds no flag or environment key that supplies the challenge.
- It must not add any code path to `src/`. The pty helper lives in `tests/` only.
- It must be documented as proving the production interaction path only. It does not authorise CI to approve real actions.
- **Whether it runs in CI** is an owner decision. It is an OWNER-10-class pty, so I recommend local/manual plus the static negative half in CI.

### (d) Required tests, by named case (runtime unless marked S)
- **18D `neg-fixture-approval-scope` / `neg-ledger-brand` (AC-093):**
  - M-16 forge (constructor, `Reflect.construct`, `class extends`; the prototype is null);
  - assign, spread, clone, JSON, prototype replacement, Proxy and `Object.create`;
  - pollution before and after load;
  - deep-freeze write on every nested path;
  - no `Date` or typed array in a binding;
  - eight binding-field substitutions (plan, manifest, role, origin, method, path, build, run token), each giving exit 14;
  - a `PilotRuntime` unknown option and a non-singleton source;
  - a `PilotRuntime`-built gate that refuses an unbranded approval (m-35(c));
  - in-process `write()` under piped stdio and under a pty (m-34).
- **18D `neg-fixture-no-arbitrary-target` (AC-092):**
  - a plain duck-typed server, a prototype-built server, a self-created real server, a `0.0.0.0` bind and a mapped bind;
  - the alias list above;
  - a closed-then-reopened server;
  - a server from another run;
  - capability serialisation and a child-process transfer;
  - a duck-typed authority;
  - a byte-identical filesystem afterwards.
- **18D:** the PTY approval test of (c).
- **18F:** the S checks (export enumeration, reachable-constructor scan, walker fail-closed) and the require-order intrinsic assertion. S checks alone do not satisfy any runtime case above.

### (e) Redirect deadline
- Test `chainDeadlineMs(windowMs)` as a pure function with synthetic inputs (0, 250, 10000, 25000, 1e9), asserting `min(windowMs+5000, 30000)`.
- Test that config validation rejects `windowMs > 10000` at arming.
- Keep the injected-clock runtime case (q).
- This is sufficient: the cap is reachable only through the pure function, and the function is tested.

**Closure statement:** on `f1ec8ae`, Security reports **0 blockers and 1 major (M-16)**. **M-15 does not close.**
