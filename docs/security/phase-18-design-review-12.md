# Phase 18 Security Design Re-review 12 (SEC-13)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `ffb1ecd` on `docs/phase-18-architecture` (architecture rev 2 plus the [rev 3](../architecture/phase-18-rev3-patch.md) to [rev 13](../architecture/phase-18-rev13-patch.md) patches). Scope: the rev 13 delta only (ARCH-13 sections 7.0 to 7k, plus the matching edits to the acceptance criteria, threat model, owner decisions and traceability), checked against [re-review 11](phase-18-design-review-11.md) (SEC-12: m-39..m-45). This record supersedes re-review 11. It is a design review only. No 18D code exists. Runtime facts come from standalone scratch models on loopback, not from Falcon code. The models are kept in the session scratchpad (`sec13/`) and are not committed. **Node v22.19.0 only. Node 24 is UNVERIFIED (not installed on this host).**

**Verdict: BLOCK for 18B and 18C while options A or B of R-7 remain on the table. APPROVE WITH CONDITIONS for 18E, 18A, 18D, 18F and DOC.** No P0. **Blockers: 0. Majors: 1 (M-17). New minors: 3 (m-46..m-48).** m-39, m-40, m-42, m-44 and m-45 are CLOSED. m-41 is CLOSED as a table and rules restatement, but feeds M-17. m-43 is CLOSED IN PART (see m-47). **The owner's requirement "Security reports zero blockers and zero majors on the revised design" is NOT met on `ffb1ecd`.** M-17 has a design-only closure path, described below. No risk is accepted here.

## Runtime probes (Node v22.19.0; Node 24 UNVERIFIED)

| # | Probe | Result |
|---|---|---|
| T1 | 7a.1 store as written. After load, replace `Function.prototype.call`, `.apply`, `.bind`, global `Reflect.apply`, `WeakSet.prototype.add`/`has` all at once, plus `Object.prototype`, `Array.prototype` and `Function.prototype` pollution | forged object refused; genuine accepted; **0 hook invocations**; no hook ever saw a `WeakSet` |
| T2 | Stack overflow forced inside the predicate (321 RangeErrors), with `Error.prepareStackTrace` and `stackTraceLimit` inspecting `getThis()`/`getFunction()` on every frame | no frame exposed a `WeakSet` or a function object; no store frame visible |
| T3 | Proxy with get traps, accessor-property object, revoked Proxy passed to the predicate | all refused; **0 traps fired**; revoked Proxy does not throw |
| T4 | 7a.1(5) as literally written: `Function.prototype.toString(capture)` | returns `function () { [native code] }` for **any** argument, including a user arrow (m-46) |
| T5 | **Pre-load** behaviour-preserving `Function.prototype.bind` replacement (`node --require`), with `add`/`has` left genuine | load does not throw. The hook **obtains `uncurry`**, sees every capture target, and returns bound wrappers. Captures pass 7a.1(4), the own-names check and both toString forms. **The registry leaks and a forged approval is accepted** (in the disclosed pre-load class; contradicts the reading that a pre-load tamper "fails closed loudly", m-46) |
| T6 | Registered fixture `http.Server`, all three 7c.3 checks evaluated after each tamper | **checks pass and the server serves attacker content** for: (a) `Object.setPrototypeOf(server, P)` with `P.emit` inherited; (b) post-load patch of `EventEmitter.prototype.emit`; (c) `server._handle[owner_symbol] = evilServer`; (d) own `Symbol(ServerResponse)` replaced with a subclass. `server.setTimeout` adds a `timeout` listener outside the five counted events (m-47) |
| T7 | **M1 against a cross-site, non-simple POST** (page `http://localhost:A`, target `http://127.0.0.1:B`, `x-csrf` header, JSON body, `SameSite=Lax` cookie on B, server B answers preflight 403, `serviceWorkers:'block'`) | **no route:** browser sends only `OPTIONS`; preflight denied; **POST never sent**. **`route.continue()` only:** preflight never reaches B; **POST with body is sent**. **M1 (`route.fetch({maxRedirects:0})` plus fulfil):** POST with body sent, **`Cookie` attached although the browser withheld it**, `Sec-Fetch-Site` absent, and the page reads status 200 (M-17) |
| T8 | AC JSON | 95 criteria, 95 unique, `counts` 95/86/6/3 match, AC-095 present, R-10 and H-8 in `openItems` |

T7 is one loopback run on the Chromium bundled with the repository's Playwright. Repetition, HTTPS, HSTS and proxy settings are UNVERIFIED.

## R-10: the M1 ruling (gating item)

**Ruling: M1, as specified in 7g.3, is not accepted. I do not accept the proposed narrowing of rev 12 6j.1(7) as written.**

- *On "emulation".* M1 does not reconstruct or continue a chain. On that narrow point the architect is right. But rev 11 gave its reason for the prohibition (rev 11 patch, R-7 text): an emulated request "would make Falcon the originator of a request the browser did not make". T7 shows M1 does exactly that whenever the browser's own policy would have changed or suppressed the request. In T7 the browser would have sent no POST at all. M1 sent one, with a cookie the browser withheld under SameSite and without Fetch Metadata. In substance that is the originator problem rev 11 prohibited. So for any request whose browser-computed security properties differ from what Playwright's fetch stack sends, I rule M1 to be emulation.
- *Residual differences (7g.3).* The list is **incomplete**, and the missing items go in the unsafe direction. 7g.3 says fidelity was observed good and that the only cookie divergence is the safer one. T7 contradicts both. Missing items:
  1. CORS preflight is not performed, so a server's refusal is bypassed. This applies to routing itself, not only to M1.
  2. SameSite cookie computation is replaced by the context jar, so cookies the browser withholds are attached.
  3. `Sec-Fetch-*` headers are absent, which defeats server-side Fetch Metadata CSRF defences.
  4. The page can read a response that CORS would have blocked.
  5. UNVERIFIED: HSTS upgrade, mixed-content blocking, Private Network Access, proxy and client-certificate parity.

  Items 1 to 3 are each disqualifying for a cross-site or cross-origin protected request.
- *Same-origin residue.* In the 4 same-origin POST cells of Q3, M1 did give one transmission and no landing hop. For a request whose origin equals the page's top-level origin and the approved origin, SameSite and CORS do not apply. The remaining differences are the network stack, header and TLS fidelity, the missing `Sec-Fetch-*` headers (a server may reject the request; that fails safe), the 204 behavioural divergence and the discarded `Set-Cookie`. **I would not object to a narrowing restricted to that case** (see M-17 remediation). This is an observation for the owner, not a choice.

## Item status

**m-39: CLOSED.**
- T1 to T3 confirm the post-load half with probes the architect did not run: stack-trace callsites, proxy and getter traps, and all replacements together.
- I agree no new owner ruling on post-load replacement is needed. The only remaining class is pre-load execution, through the three disclosed routes. The (b) disclosure (`--require`, `NODE_OPTIONS`) is accurate.
- L20 is the right form, kept as a documented-limitation case, and it should include the T5 bind-wrapper variant.
- The integrity assertion has a defect: m-46.

**m-40: CLOSED.**
- "Not reachable by `require`" is honest. 9e (reachable, then refused) is better than any claim of unreachability.
- The self-sufficient gates are complete for the stated threat: the writer's own argv checks, CI refusal, isatty syscall, prompt before challenge, fd-0-only challenge, and an audit entry for every prompt.
- Precision: the 7b.1(5) walker is a lint, not a boundary. `require("module")`, `Reflect.set`, `Object.defineProperty(process, "mainModule", …)` and computed property names evade literal patterns. Label it a hygiene check. Not a finding, because 7b.1(3) already concedes the boundary.

**m-41: CLOSED (table and rules); the table check is below.** Rules 1, 2 and 4 are replaced correctly. Rule 4 (prevention only from the manifest's non-redirecting declaration) is the only sound prevention claim. In practice rule 3 is subsumed by rule 4, because a hop class is only known after the response.

**m-42: CLOSED.** Demoting the environment check to defence in depth is the correct reading of OWNER-09. The AC-084 transitive walker running in CI is the right primary control. The tmpdir-root refusal makes an accidental run inert. R-9 remains an owner confirmation.

**m-43: CLOSED IN PART.** Handler identity, exact counts and the own-property sweep defeat Q18 to Q21. T6 shows four routes that preserve all three checks (m-47).

**m-44: CLOSED.**
- The validation set is complete.
- `-0` passes (`isSafeInteger(-0)` is true) and is harmless.
- A large safe `windowMs` plus grace can exceed 2^53, but `Math.min` returns the exact cap. That too is harmless.

**m-45: CLOSED as a specification.** The ten sites are listed; applying them is DOC work and is UNVERIFIED here. I withdraw my own SEC-12 m-41 parenthetical "(and Chromium 301/302)". The raw part 1 data shows 301/302/303 POST converted to GET with `b=0`. Correction 10 of 7f is therefore closed by this record.

## Table check (7g.1 against raw data)

- **302: confirmed measured in part 1.** `spiker/findings.md` has 302 same and cross, GET and POST, form and fetch, all OBSERVE_ONLY, with POST converted to `GET /landing b=0`. It is absent only from part 2 Q3: the harness matrix is `[301,303,307,308]`. The coordinator's correction stands, and footnote 2 is right.
- Q3 confirmed: 16 sanitized cells, 1 transmission each, 0 landing requests, the page saw 204. Cookie, x-csrf, Referer, content-type and body were present on POST, and Origin on POST only. Baseline: 8 of 16 landed. All 8 cross-origin baselines were `Failed to fetch`.
- **Cross-origin M1 cells do not discriminate.** The cross-origin baselines had no landing hop either, so Q3 does not show that M1 prevents a cross-origin body leak. The 7g.4 Option A gain "no cross-origin body leak in those cells" overstates the evidence (m-48).
- **PUT, PATCH and DELETE were never measured.** Both parts used GET and POST only, although rev 12 6j.2 required all four. Under the Fetch standard, 301/302 rewrite only POST, so a PUT or DELETE through 301/302 would keep its method and body. Footnote 1's "did not produce this hop class" therefore holds for POST only. The cell is probably real for other methods: UNVERIFIED (m-48).
- 301/302/303 GET-origin hops are method-preserved (GET to GET) and OBSERVE_ONLY. The UNOBSERVABLE¹ label is correct only for non-GET.
- Q26 is one GET navigation cell with millisecond timestamps, and the comparisons are ties. "At or after" is the correct reading. The part 1 abort experiment is the stronger evidence for "no pre-send gate".
- Raw data inconsistency: the part 1 summary rows show `serverGotLanding true` for cross 307/308 POST fetch, while the terminal table shows `(none)`. Rev 13 relies on `(none)`, which part 2 corroborates. The JSON was not re-checked (UNVERIFIED).
- Q3 ran with the default service-worker mode. M1 combined with `serviceWorkers:'block'` is measured only in T7.

## New findings

**M-17 (Major, P1 for 18B/18C if R-7 option A or B is selected). M1 and the 6j.1(7) narrowing let Falcon transmit protected requests that the browser would refuse, or would send with weaker credentials.**
- *Likelihood:* high for any cross-site or cross-origin non-simple protected request. *Impact:* a credentialed, approved-body mutation reaches a server whose CORS policy denied it, with a cookie the browser withholds and no Fetch Metadata. This is what rev 11 prohibited. Plain `route.continue()` already suppresses the preflight (T7), so the route layer is affected for every option that arms routed protected requests.
- *Evidence:* T7; `scratchpad/spiker2/harness.js` (Q3 used only same-origin protected URLs).
- *Remediation (design only; one of):*
  1. Restrict M1, and any routed protected non-GET, to requests whose origin equals both the page's top-level origin and the approved origin. Refuse anything else before arming (`POLICY_PROTECTED_CROSS_ORIGIN_UNSUPPORTED`, exit 18). Restate the 6j.1(7) narrowing to permit `route.fetch` only in that case. Add the missing-`Sec-Fetch-*` and 204 divergences to the limitation text. Extend SPIKE-R with a same-origin cookie and header parity row, and with HTTPS/HSTS rows.
  2. Option C.
- *Verification:* a T7-style case in 18C. With a cross-origin protected target whose preflight is denied, assert refusal before arming and zero server transmissions. Inversion: drop the origin equality check and the case must record a POST.

**m-46 (Minor, 18D). The 7a.1(5) and L18 "capture integrity assertion" is not an integrity control.**
- *Evidence:* T4, because the literal `Function.prototype.toString(capture)` ignores its argument; and T5, because a pre-load bound wrapper passes typeof, own names, toString and functional checks.
- *Remediation:* write it as `uncurry(Function.prototype.toString)(capture)`. Relabel 7a.1(5) and L18 as smoke checks, not controls. Remove "integrity" wording from AC-095. State in 7a.1(4) that only a careless tamper fails loudly. Add the T5 variant to L20.
- *Verification:* a planted pre-load bind wrapper passes L18 and is accepted in L20, as documented.

**m-47 (Minor, 18D; R-8). Fixture repurposing routes survive all three 7c.3 checks.**
- *Evidence:* T6 (a) to (d).
- *Remediation:* at construction and at consume, also assert:
  - `Object.getPrototypeOf(server) === captured http.Server.prototype`;
  - `server.emit === captured EventEmitter.prototype.emit`, and that the captured prototype `emit` is unchanged;
  - `server._handle` and its owner symbol reference `server`;
  - the `IncomingMessage`/`ServerResponse` symbols equal the captured `http` classes.
  Or record (b) (global prototype patching) under R-8 explicitly. Correct the 7c.4 coverage sentence either way.
- *Verification:* F18 to F21 with inversions.

**m-48 (Minor, 18B/18C/DOC). SPIKE-R coverage gaps not stated in rev 13.**
- PUT, PATCH and DELETE were not measured.
- The cross-origin Q3 cells do not discriminate.
- *Remediation:* add both to the 7g.3 non-coverage list and to the SPIKE-R `openItems` text. Strike "no cross-origin body leak" from Option A's gains. Measure PUT and DELETE through 301/302 before any option other than C.

Nit: AC JSON `designRevision` names `5a8f152` while the patch is at `ffb1ecd`.

## ARCH-13 section 7i flags

- Flag 2 (M1 is the withdrawn call) is raised to **Major**, as M-17.
- Flags 1, 3, 4, 5 and 6 are Minor and correctly stated.
- Flags 7, 8, 9 and 11 are informational. Flag 7 should also mention T5.
- Flag 10 stands.

## Hypotheses and UNVERIFIED

- Node 24 for T1 to T7 (H-8).
- HSTS, mixed-content, PNA, proxy and client-certificate parity under `route.fetch`.
- T7 repetition.
- PUT/PATCH/DELETE redirect behaviour.
- Application of the 7f annotations.
- Still carried: m-21 and m-23 (UNVERIFIED); m-24, m-26, m-27, m-28 and m-30 (open design merge conditions); H-1, H-3 and H-7 (UNVERIFIED). H-8 is new.

## Verdict per PR

| PR | Blockers / majors | Merge conditions; may start? |
|---|---|---|
| 18E | 0/0 | AC-085 symlinked-parent row, m-29(c), m-26(b), SEC-07 conditions. May start |
| 18A | 0/0 | Unchanged. May start |
| 18C | 0/1 | M-17 (origin equality before arming for routed protected requests), m-48, serviceWorkers block case. Blocked until M-17 is closed in the design or option C is selected |
| 18B | 0/1 | M-17, m-27, m-31, m-48, owner R-7 after R-10, H-7. Blocked as for 18C |
| 18D | 0/0 | m-46, m-47, m-30, H-8 Node 24 check. May start |
| 18F | 0/0 | m-24, dotted-invocation and capture-order checks, walker additions, labelled as hygiene |
| DOC | 0/0 | 7f annotations, m-48 non-coverage text, M-17 divergence text if M1 survives |

## Owner items (none accepted)

- R-10: Security has ruled. M1 as specified is not accepted. A same-origin-only form would be acceptable to Security as a design, subject to M-17's verification.
- R-7: options A, B and C remain the owner's choice. A and B are presently blocked by M-17. C carries no M-17 dependency for protected actions.
- R-8, now with the m-47 scope.
- R-9 confirmation.
- Residuals 24 and 25 (note the T5 pre-load route).
- Every residual carried from re-reviews 6 to 11.

**Closure statement:** on `ffb1ecd`, Security reports **0 blockers and 1 major (M-17)** on the rev 13 delta. The owner's zero-major condition is not met until M-17 is closed in the design or option C is selected.
