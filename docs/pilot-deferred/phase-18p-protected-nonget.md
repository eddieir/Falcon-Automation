# 18P-PROTECTED-NONGET — deferred design record (tracked, self-contained)

**Status: NON-NORMATIVE for Phase 18. Non-production. Unshipped. Not scheduled, not authorised, not implemented.**

Nothing in this document is a Phase 18 capability, obligation, claim or merge condition. Every requirement, clause, finding and test obligation recorded here is **deferred work for the future item 18P-PROTECTED-NONGET** and is retained unweakened as design history. No Phase 18 gate reads this file; no Phase 18 code, workflow, script or report may reference it; no reachability root may reach it (it contains no executable code).

**Why this file exists.** Owner decisions OWNER-12 (Option C) and OWNER-13 (no production approval path) removed protected non-GET execution and the whole production approval path from Phase 18. The criterion text, threat findings, measurements and test obligations they removed must survive without depending on any git object that an ordinary consumer of the repository may not have. Earlier revisions preserved that text "verbatim at git revision `909d794`" and proposed an annotated tag. The owner has decided there is **no tag**. This document therefore copies the deferred text into tracked content so that it survives a squash merge, branch deletion, a shallow clone and an ordinary checkout. Commit identifiers appear below **only as historical context**; no live or deferred requirement depends on retrieving an unpushed tag or an orphanable commit. If a commit id in this file is unreachable, nothing in this file is lost.

**Self-containment rule (normative for this document).** Any future statement that defers work to 18P-PROTECTED-NONGET must either state its substance here or be unenforceable. A `deferredTextRef`, a plan row or a threat-model annotation may cite this file by path; it may not cite a commit or a tag as the sole source of deferred text.

## 1. Scoping: how the Phase 18 gates treat this file

1. **Claims grep.** `docs/pilot-deferred/` is excluded from the repository-wide claims grep by **exact path prefix with the trailing slash**, in the same class as `docs/security/phase-18-design-review*.md` and `docs/architecture/phase-18-rev*`. The exclusion is a scope rule, not a file-level blanket: the compensating control is this document's status header plus the prohibition that no live surface may cite it as a capability.
2. **`docs/pilot/**` is a different path.** The "blankets never apply" set includes `docs/pilot/` (operator-facing, live) and is matched by the exact prefix `docs/pilot/`. A glob such as `docs/pilot*` would wrongly capture `docs/pilot-deferred/` and is prohibited; implementations must match `docs/pilot/` with its trailing slash.
3. **AC JSON lint.** Unchanged: the lint reads live clause text only. This file is not JSON and is not read by the lint.
4. **Dependency-reachability check.** `docs/pilot-deferred/` holds no `.js`, `.cjs`, `.mjs`, `.sh` or `.json` artefact, is not a classification root, and is reachable from no script or workflow step. An added executable file under this directory must be classified like any other entry and is a forbidden target for production graphs.
5. **Operator documentation.** This file is not operator documentation and must not be linked from `docs/pilot/operator-guide.md`, `docs/pilot/limitations.md`, `README.md` or any report or dashboard surface.

## 2. Deferred acceptance criteria — full verbatim text

The text below is copied, not referenced. Source of each copy is stated. Priorities and ids are preserved; nothing is renumbered, deleted or reworded. None of these is a Phase 18 merge condition.

### 2.1 Wholly deferred criteria (`phase: "deferred-18P"`, `mergeCondition: false`), copied from `docs/phase-18-acceptance-criteria.json` at this revision

#### P18-AC-052 (Must, pr 18P, verification R) — copied from the AC JSON at HEAD
**requirement (verbatim):**
> No approval: `APPROVAL_REQUIRED`, zero clicks

**components (verbatim):**
> PolicyEngine step 7

`phase`: `"deferred-18P"`

`mergeCondition`: `false`

**deferralNote (verbatim):**

> DEFERRED to 18P-PROTECTED-NONGET under OWNER-13 (rev 18 section A1): the approval state machine, its consumer and the interactive-path test do not ship in Phase 18. Text retained unweakened as an 18P entry requirement.

#### P18-AC-053 (Must, pr 18P, verification U, R) — copied from the AC JSON at HEAD
**requirement (verbatim):**
> Approval bound to plan digest, manifest version, role, target origin, action ID; any mismatch `APPROVAL_MISMATCH`

**components (verbatim):**
> approval/Binding — eight fields

`phase`: `"deferred-18P"`

`mergeCondition`: `false`

**deferralNote (verbatim):**

> DEFERRED to 18P-PROTECTED-NONGET under OWNER-13 (rev 18 section A1): the approval state machine, its consumer and the interactive-path test do not ship in Phase 18. Text retained unweakened as an 18P entry requirement.

#### P18-AC-054 (Must, pr 18P, verification U, R) — copied from the AC JSON at HEAD
**requirement (verbatim):**
> Expired or pre-change approval: `APPROVAL_STALE`

**components (verbatim):**
> ApprovalStore staleness

`phase`: `"deferred-18P"`

`mergeCondition`: `false`

**deferralNote (verbatim):**

> DEFERRED to 18P-PROTECTED-NONGET under OWNER-13 (rev 18 section A1): the approval state machine, its consumer and the interactive-path test do not ship in Phase 18. Text retained unweakened as an 18P entry requirement.

#### P18-AC-055 (Must, pr 18P, verification R) — copied from the AC JSON at HEAD
**requirement (verbatim):**
> Consumed approval reused after process restart: `APPROVAL_REPLAYED`

**components (verbatim):**
> ApprovalStore durable exclusive consumption across restart and concurrency

`phase`: `"deferred-18P"`

`mergeCondition`: `false`

**deferralNote (verbatim):**

> DEFERRED to 18P-PROTECTED-NONGET under OWNER-13 (rev 18 section A1): the approval state machine, its consumer and the interactive-path test do not ship in Phase 18. Text retained unweakened as an 18P entry requirement.

#### P18-AC-056 (Must, pr 18P, verification U) — copied from the AC JSON at HEAD
**requirement (verbatim):**
> Approval for an unknown plan digest: `APPROVAL_UNKNOWN_PLAN`

**components (verbatim):**
> ApprovalStore lookup

`phase`: `"deferred-18P"`

`mergeCondition`: `false`

**deferralNote (verbatim):**

> DEFERRED to 18P-PROTECTED-NONGET under OWNER-13 (rev 18 section A1): the approval state machine, its consumer and the interactive-path test do not ship in Phase 18. Text retained unweakened as an 18P entry requirement.

#### P18-AC-057 (Must, pr 18P, verification U, R) — copied from the AC JSON at HEAD
**requirement (verbatim):**
> Every grant/refusal/consumption has one audit entry with timestamp, approver, digest, action, role, decision, code; no secrets

**components (verbatim):**
> AuditLog entry shape

`phase`: `"deferred-18P"`

`mergeCondition`: `false`

**deferralNote (verbatim):**

> DEFERRED to 18P-PROTECTED-NONGET under OWNER-13 (rev 18 section A1): the approval state machine, its consumer and the interactive-path test do not ship in Phase 18. Text retained unweakened as an 18P entry requirement.

#### P18-AC-092 (Must, pr 18P, verification U, R, S) — copied from the AC JSON at HEAD
**requirement (verbatim):**
> Evaluated from the shipped test harness with every repository file unmodified and using only the public surface, the fixture approval authority cannot be made to target any non-loopback origin, cannot be pointed at any server object other than the one this authority received from PilotFixtureServer.start() in this process, compared by reference identity in a module-private registry and never by shape, with the recorded listen epoch, port and family equal to the live values, so a prototype-built fake on net.Server.prototype, an independently created real loopback server including a forwarding one, a server from another authority or another run, a server transferred from another process, and a closed or closed-and-reopened server are all refused, cannot yield its per-run capability, and cannot cause any write under run/, data/ or the repository: the filesystem is byte-identical after the attempt suite. The attempt surface is bounded and exhaustive: argument values; own-property assignment, deletion and defineProperty on every returned object; pollution of Object.prototype, Array.prototype and Function.prototype for the keys the design reads (scope, binding, server, listening, address, family, port, manifestDigest; capabilityProof is never read off the approval, which is null-prototype so prototype pollution is not even inherited-visible on it); duck-typed substitutes for the server, approval, source and resolver; wrapper and shadowing sources; serialisation, structured clone and cross-process replay; the proxy and forwarding paths; and literal require of every production module under src/core/pilot/ with adversarial arguments, including a call to the ledger writer, which must refuse. Out of scope as repository modification accepted under OWNER-10: monkeypatching intrinsics, require.cache, Module._load, createRequire or any non-literal require, process.binding, child_process, worker_threads or a pty from a new or edited test file, and any edit to a repository file. The authority's transitive literal require graph contains no fs, fs/promises, SafeFs, ApprovalStore, AuditLog, RunToken or child_process module, no src/ or scripts/ file requires any tests/ path, and the require-graph walker resolves require(path.join(<literals>)) and fails closed on any other non-literal require. Any demonstrated path to an arbitrary target or to persisted approval state within that bounded surface is a blocker that stops 18D.Every in-scope case is a named automated runtime test with its named inversion, enumerated in rev 12 sections 6h.1 and 6h.2: the M-16 forge set (prototype constructor, Reflect.construct with an attacker newTarget, class extends), copy, spread, structuredClone, JSON round trip, Object.create, prototype replacement, plain and revoked Proxy, predicate non-transfer, prototype pollution before and after module load, deep-frozen writes on every nested path asserted as value-unchanged rather than as a throw because a frozen write is a silent no-op in sloppy CommonJS, rejection of Date, Buffer and typed-array fields at seal, the eight binding-field substitutions, reuse of one consumed approval against a different plan, manifest, role, origin, action and build as six separate sub-cases, PilotRuntime option injection and non-singleton source, the PilotRuntime-built-gate refusal of an unbranded approval, the in-process writer refusal under both piped stdio and a pty, the runtime mint scan that calls every exported function under src/core/pilot/ with adversarial arguments and asserts no reachable object satisfies the predicate, the duck-typed, prototype-built, independently created, foreign-run, cross-process, closed and closed-and-reopened server cases, the 0.0.0.0 and ::ffff:127.0.0.1 binds, the full address-alias list, capability serialisation by JSON, structuredClone, v8.serialize and child-process transfer, a duck-typed authority and resolver, and the byte-identical filesystem assertion. A static assertion is additive defence in depth and never satisfies a case that can be run at runtime.. The fixture server registry additionally binds the fixture application's handler identity: the fixture module holds one module-scope request handler, creates the server with http.createServer of that handler inside the module, records at the listening event for every event name, both the listener count and the ordered array of raw listener function references, read through uncurried captured EventEmitter eventNames, listenerCount, listeners and rawListeners (baseline: request one, connection one and listening one), and at authority construction and at consume asserts that the request listener array has length exactly one and element zero is reference-identical to that handler, that the live snapshot is exactly equal, with the same name set, the same counts and element-wise reference identity in order, so that a listener replaced by a behaviour-preserving wrapper and a prependListener reordering with the genuine function are both refused and not only an added or removed listener, which also detects the timeout listener added by server.setTimeout that a fixed five-event count missed, because Node itself installs one connection listener, and that the server object has no own property shadowing any EventEmitter method, which is the only check that detects an own emit shadow leaving the listener array intact. Any failure is APPROVAL_REQUIRED exit 14, fixture_server_repurposed. A handler whose own body was edited in the fixture module source is not detectable by identity and remains repository trust under R-8. New runtime cases F14 forwarder by listener replacement, F15 forwarder by prependListener, F16 own-emit hijack and F17 an extra connection, upgrade or checkContinue listener, each with its inversion. It additionally asserts that the prototype of the server is reference-identical to the captured http.Server prototype, that the server's emit is reference-identical to the captured EventEmitter prototype emit and that the captured value is still reference-identical to the live EventEmitter prototype emit, that the server's _handle is present and that every own owner symbol on it references the server itself, and that the server's own IncomingMessage and ServerResponse symbols are reference-identical to the captured http classes, with absence of a symbol recorded at baseline treated as a failure rather than a pass. Any failure is APPROVAL_REQUIRED exit 14, fixture_server_repurposed. Further runtime cases F18 prototype swap, F19 post-load emit prototype patch, F20 _handle owner swap, F21 class-symbol swap and F22 setTimeout listener, each with its inversion, and F23 as a documented-limitation expected-failure case for a pre-load emit patch. Not detected, and stated as residuals under R-8: any pre-load tamper, a tamper after the consume check because checking is point-in-time, an edited handler body, socket-level interception that preserves the snapshot, and a compatible substituted _handle. It asserts the prototype of the server through a captured Object.getPrototypeOf called directly rather than uncurried, since a static function supplied with the server as its receiver and no argument throws for a genuine server; the normative distinction is that prototype methods are uncurried and static functions are called directly, and the control case requires a genuine untampered server to pass every assertion, with a crashing check surfacing as PILOT_INTERNAL_ERROR exit 18 and never as fixture_server_repurposed exit 14. It further captures an enumerated set of methods on the http ServerResponse and IncomingMessage prototypes, namely end, write, writeHead, setHeader, getHeader, removeHeader and flushHeaders, and on, setEncoding and destroy, and asserts each is still an own data property of its prototype holding the captured reference, using a captured getOwnPropertyDescriptor so an accessor cannot satisfy the comparison; the same descriptor requirement is applied to the EventEmitter prototype emit assertion. New runtime cases F24 for the wrapped listener with an unchanged count, F25 for a post-load patch of ServerResponse end, each with its inversion, and F25b as a documented-limitation expected-failure case for a patch of a method outside the enumerated set. Added to the stated residuals under R-8, not accepted: a post-load patch of any prototype method outside that enumerated list, which is enumerated and not exhaustive, and a wrap of the server handle onconnection, which preserves the owner linkage and changes no listener array.

**components (verbatim):**
> neg-fixture-no-arbitrary-target + neg-fixture-require-graph (rev 10 sections 4a.3, 4a.6, 4b; OWNER-10); the ten M-15 attempt cases of rev 11 section 5a.5 (relabel, binding mutation and defineProperty, wrapper source, duck-typed server, self-created real net.Server, prototype pollution, prototype-create and clone, runtime option injection, in-process ledger-writer call, export enumeration), each with its inversion (rev 11 sections 5a, 5c); the named runtime case map of rev 12 sections 6h.1 (L1-L16) and 6h.2 (F1-F13) with their inversions, replacing the ten-case list of rev 11 section 5a.5; rev 13 section 7c fixture handler identity binding and listener-count equality (closes SEC-12 m-43); rev 14 section 8c four repurposing assertions and the whole-snapshot listener equality (closes SEC-13 m-47 in part; the rest is stated under R-8); rev 15 sections 9b and 9c listener identity by reference, prototype-method capture set and corrected call form (closes SEC-14 m-49 and m-50)

`phase`: `"deferred-18P"`

`mergeCondition`: `false`

#### P18-AC-093 (Must, pr 18P, verification U, R, S) — copied from the AC JSON at HEAD
**requirement (verbatim):**
> No production code distinguishes a ledger approval from any other object by a scope string, a constructor, a prototype, an instanceof test or any value readable off the object: there is no class brand and no reachable constructor anywhere in the discriminator path. The sole discriminator is membership in a module-private WeakSet held in ApprovalStore's closure, whose add and has are captured from WeakSet.prototype at module load in uncurried form, by binding them through a Function.prototype.call reference taken before any other code runs, so that no captured primitive is ever invoked through a live .call, .apply or .bind property lookup or through the global Reflect.apply; the same uncurried capture form is mandatory for the gate-side capability WeakMap, the fixture server record WeakMap, the captured net.Server intrinsics, the captured EventEmitter listener accessors and crypto.timingSafeEqual, and a load-time assertion that every captured value is a function fails closed with PILOT_INTERNAL_ERROR exit 18, intrinsic_capture_failed and whose registering function is never exported, and registration happens only inside ApprovalStore's private verified-consumption path after chain, binding, build-identity, run-token, lock and exclusive-marker verification; the module exports the membership predicate only, and no brand, register, add, seal, mint, symbol, registry or writer surface exists anywhere in the module graph. Every approval is built with Object.create(null), carries no scope field, holds primitives only (no Date, Buffer, typed array, Map, Set or function — timestamps are epoch-millisecond integers), and is deep-frozen with every nested object also null-prototype and frozen; a failure of the frozen, null-prototype or field-type assertion is PILOT_INTERNAL_ERROR exit 18, approval_not_sealed. ApprovalStore exposes no writer; the interactive ledger writer is an entry-only module which, when loaded by Node's ordinary require in a process whose entry is something else and whose require.main has not been reassigned to a Module object for the writer's own resolved path, exports no callable member of any name (exit 1, approve_writer_not_entry); entry identity is not claimed to be unforgeable against in-process code, because re-evaluating the source through vm, or constructing a Module for the writer path and assigning it to process.mainModule before calling its load, makes the module body run, so the writer's refusals must each be self-sufficient (exit 1, approve_writer_not_entry), reached only by falcon.js --approve-action after falcon.js asserts it is itself the process entry (else exit 1, falcon_not_entry), and which refuses unless CI and GITHUB_ACTIONS are unset, tty.isatty(0) and tty.isatty(1) hold by syscall, a prompt bound to the plan digest, role, origin, method, canonical path, manifest digest, build id and approvals root real path is rendered before the challenge is generated, and that freshly generated random challenge is typed back on fd 0 with no parameter, option, environment key, config key or file by which it can be supplied; every prompt rendered, including each refusal, is appended to the audit chain. Any unbranded approval is fixture-class whatever it declares; in a PilotRuntime-built gate it is refused outright (APPROVAL_REQUIRED exit 14, fixture_approval_in_production_runtime), and in a directly constructed gate it is consumable only against a live loopback-literal origin and port read through net.Server intrinsics captured at module load (instanceof net.Server, net.Server.prototype.address and the prototype listening getter, whose absence fails closed exit 18) with a timing-safe capability proof held in a gate-side WeakMap keyed by the approval object and never present on the object; otherwise APPROVAL_REQUIRED exit 14. Captured net intrinsics authenticate nothing: they prevent own-property substitution only.. The writer itself, and not falcon.js on its behalf, runs the key-carrier-flag rejection and a literal closed argv allowlist before any prompt and before any filesystem access, refusing any other token including a bare positional, a repeated flag and an abbreviated flag, with exit 1 and the reason named.

**components (verbatim):**
> ApprovalStore closure-held ledger WeakSet with captured add/has and no exported registration surface + Object.create(null) approvals with primitives-only fields and total deep freeze + gate-side capability WeakMap + approve-action.js entry-only interactive writer with bound prompt and audited prompts + falcon.js entry assertion and spawnSync re-execution + PilotActionGate.perform ordered checks + PilotRuntime reference-identity source check, closed option allowlist and unbranded-approval refusal + PilotFixtureServer reference-identity server registry with listen epoch (rev 12 sections 6a-6d, 6g; closes SEC-11 M-16 and m-34, m-35, m-36)

`phase`: `"deferred-18P"`

`mergeCondition`: `false`

#### P18-AC-094 (Must, pr 18P, verification R, S) — copied from the AC JSON at HEAD
**requirement (verbatim):**
> The production interactive approval path is exercised by one automated test of the human interface, which creates no second approval mechanism and adds no code to src/: it spawns node falcon.js --approve-action under a pty against a hermetic loopback fixture, with fresh approvals and audit roots under os.tmpdir() passed as command arguments and never through an environment variable or flag, an environment stripped to an explicit allowlist with no key matching *_KEY, *_TOKEN, *_SECRET, *_PASSWORD, CI, GITHUB_*, proxy variables or NODE_OPTIONS and with HOME replaced, and a network gate asserting zero non-loopback requests. It parses the real prompt and asserts all eight bound values — plan digest, role, origin, HTTP method, canonical path, manifest digest, falconBuild id and approvals root real path — types the generated challenge exactly once through the pty, asserts exit 0 and exactly one verifying ledger entry, then asserts that replay yields APPROVAL_REQUIRED exit 14 and that each of the eight single-field binding substitutions yields exit 14, removes all approval state in teardown, and asserts the real run/ and data/ digest sets are byte-identical. A source scan asserts that no CLI flag, environment key, config key or file supplies the challenge or bypasses the interaction, consistent with OWNER-09. The test is local and manual only, because AC-084 fails on any approve flag reachable from a workflow; CI runs only the deterministic negative half — piped stdio, CI set, a wrong challenge and the in-process require refusal — and the AC-084 walker. Documentation states that it proves the production interaction path and does not authorise CI to approve real customer actions. Each assertion has a named inversion: removing the isatty gate, accepting a challenge from argv or environment, generating the challenge before rendering the prompt, omitting any bound prompt line, dropping the consumption marker, relaxing one binding field or dropping the environment allowlist must each make the test fail.. The pty helper cannot run in CI by structure, and environment detection is defence in depth only and never the primary control, consistent with OWNER-09. The helper and its test exist at exactly one path under tests/pilot/manual/, which no testMatch, testDir, npm script or workflow line reachable from .github/workflows/ci.yml resolves and which is excluded from the published package; the AC-084 walker fails the CI build on any transitive require, dynamic require, import, spawn or exec argument, npm, yarn or npx script or workflow run line from any workflow that reaches that directory or the string pty-approve; the helper refuses any approvals root or audit root whose real path is not under a directory it created itself in this process beneath the real path of os.tmpdir(), and refuses any path inside the repository, run/ or data/; and as defence in depth its first executable statement, before it builds the child environment allowlist and therefore before CI and GITHUB_ variables are stripped, throws pty_helper_refused_in_ci if its own environment has any of CI, GITHUB_ACTIONS, GITHUB_RUN_ID, GITHUB_WORKFLOW, CONTINUOUS_INTEGRATION, BUILD_ID or TF_BUILD set. A deterministic CI case asserts that requiring the helper with CI set throws, and that case is explicitly not the justification for the environment check being sufficient. Inversions: moving the helper to a CI-reachable path, or naming it in a workflow run line, must each fail the AC-084 walker; pointing it at the repository approvals root must be refused; removing the first-statement check must fail the CI case.

**components (verbatim):**
> tests/regression/pilot/approval-interactive-path.test.js + tests/pilot/bin/pty-approve.cjs + the 18F pilot-manual project and test:pilot-manual script excluded from .github/workflows/ci.yml + the bound prompt and audited prompts of rev 12 section 6b.2 (rev 12 section 6g); the tests/pilot/manual/ location, the extended AC-084 walker reachability rule and the tmpdir-root restriction of rev 13 section 7e (closes SEC-12 m-42)

`phase`: `"deferred-18P"`

`mergeCondition`: `false`

**deferralNote (verbatim):**

> DEFERRED to 18P-PROTECTED-NONGET under OWNER-13 (rev 18 section A1): the approval state machine, its consumer and the interactive-path test do not ship in Phase 18. Text retained unweakened as an 18P entry requirement.

#### P18-AC-096 (Must, pr 18P, verification U, R) — copied from the AC JSON at HEAD
**requirement (verbatim):**
> No protected request whose target origin differs from the page's top-level origin and the approved origin is ever routed, performed, continued, fulfilled or emulated by Falcon in Phase 18. The origin-equality gate is evaluated before the route is armed and before any request is issued, from the page's top-level origin, the origin recorded in the consumed approval and the origin of the hop-zero request URL, each computed with the WHATWG URL parser and compared as a serialized origin by string equality; inequality, an opaque origin and a non-fetchable scheme are each POLICY_PROTECTED_CROSS_ORIGIN_UNSUPPORTED exit 18 with the three origins audited. A manifest declaring a cross-origin protected route is refused at manifest load with the same reason. A runtime case places the page on one loopback origin and the protected POST target on a second loopback origin whose server answers the CORS preflight with 403, with a custom CSRF header, a JSON body, a SameSite Lax cookie on the target and serviceWorkers set to block, and asserts refusal before arming and zero transmissions at the target server, neither an OPTIONS nor a POST; the inversion removes the origin-equality check and the case must then record a POST, which is the reviewer's measured result. A second runtime case asserts the same-origin path still performs exactly one transmission with no landing hop and audits three equal origins. A third asserts that a top-level origin change between arming and dispatch is POLICY_PROTECTED_ORIGIN_CHANGED exit 18 and that the record does not claim the hop was prevented. A unit table covers uppercase hosts, present and omitted default ports, a trailing host dot, userinfo, IDNA and punycode pairs, http against https on one host, sibling subdomains, about blank, blob, data, file and null, and its inversion replaces the comparison with host-suffix or same-site matching so that the sibling-subdomain and scheme rows must fail. The equality required is between four origins, the initiator's, the page's top-level document's, the approved one and the hop-zero target's, and not between the last three alone; the rev 14 formulation keyed on the top-level origin is corrected, because a cross-origin iframe initiating a protected POST back to the top-level origin satisfied it and the request was transmitted with a cookie the browser withheld under SameSite while the frame read a response CORS would have blocked. A runtime case places a cross-origin iframe on the page, has the frame initiate the protected POST to the top-level origin with the target answering the CORS preflight 403, and asserts refusal before arming with the initiator origin named in the audit entry and zero POSTs at the target; its inversion restores the top-level-only gate and must then record a POST carrying the withheld cookie. A further case covers a nested chain whose outer and inner frames share the top-level origin but whose middle frame does not, and asserts refusal. A third asserts that a worker-initiated or service-worker-initiated protected request is refused with POLICY_PROTECTED_INITIATOR_UNSUPPORTED exit 18 and that the audit entry records why the initiator could not be established. In the origin-comparison unit table every row states its expected verdict explicitly: IDN and punycode spellings of one host, uppercase hosts, present and omitted default ports, and alternative numeric forms of one address each compare equal and arm, while sibling subdomains, differing schemes, differing ports, a trailing host dot, userinfo and the opaque and non-fetchable schemes each refuse, with the blob row refused by the scheme-first screen and a further inversion that reorders the screen so the blob row must fail. DEFERRED under owner decision OWNER-12 (Option C): no protected non-GET request reaches arming in Phase 18, so this gate has no Phase 18 trigger. The criterion is retained unweakened as an entry requirement of 18P-PROTECTED-NONGET. Its refusal obligations are subsumed by AC-051 as rewritten, which refuses earlier and more broadly.

**components (verbatim):**
> the origin-equality gate of rev 14 section 8a.1, the rewritten 6j.1(7) narrowing of section 8a.2 and cases 18C-M17-1 to 18C-M17-4 of section 8a.5 (rev 14 section 8a; closes SEC-13 M-17); rev 15 section 9a.1 rule 3 and cases 18C-M17-5 to 18C-M17-9 and the amended 18C-M17-4 of section 9a.4

`phase`: `"deferred-18P"`

`mergeCondition`: `false`

#### P18-AC-097 (Must, pr 18P, verification U, R) — copied from the AC JSON at HEAD
**requirement (verbatim):**
> No protected request is routed, performed, continued, fulfilled or emulated by Falcon unless its initiating frame is reference-identical to the main frame of the page under test. A request initiated by any other frame, including a frame whose own origin equals the top-level origin but whose ancestor chain does not, and including a same-origin nested frame, is refused before the route is armed and before any request is issued, with POLICY_PROTECTED_CROSS_ORIGIN_UNSUPPORTED exit 18 and the initiator origin audited alongside the top-level, approved and target origins. A request whose initiator cannot be established is refused before arming with POLICY_PROTECTED_INITIATOR_UNSUPPORTED exit 18: a service-worker-originated request, an initiator accessor that throws or yields a falsy, detached or unparsable frame, and a request from a popup or an opener; no such refusal is recoverable, retried or downgraded to a warning. The same initiator requirement is re-evaluated immediately before the hop-zero request and a failure there is labelled detection rather than prevention. Verification: a runtime case in the cross-origin-iframe topology asserting refusal before arming and zero POSTs at the target, whose inversion restores a top-level-only gate and must record a POST carrying the cookie the browser withheld; a nested-chain case; a worker-initiator case; an Origin-header cross-check case that also asserts an absent Origin header does not refuse; and a case detaching the initiator between arming and dispatch. The limitation text states that a protected action triggered from a same-origin nested frame is unavailable, and that on engines where the service-worker accessor is always null the reference-identity check is the only discriminator and blocked service workers remain mandatory. DEFERRED under owner decision OWNER-12 (Option C): no protected non-GET request reaches arming in Phase 18, so this gate has no Phase 18 trigger. The criterion is retained unweakened as an entry requirement of 18P-PROTECTED-NONGET. Its refusal obligations are subsumed by AC-051 as rewritten, which refuses earlier and more broadly.

**components (verbatim):**
> the initiator and ancestor gate of rev 15 section 9a.1 rules 3 to 5 and 8, the rewritten 6j.1(7) of section 9a.2, and cases 18C-M17-5 to 18C-M17-9 of section 9a.4 (rev 15 section 9a; closes SEC-14 M-18)

`phase`: `"deferred-18P"`

`mergeCondition`: `false`

### 2.2 Deferred clauses of the mixed criteria

Each mixed criterion keeps live clauses in Phase 18. Only the clauses listed under `phaseClauses["deferred-18P"]` are deferred; they are copied verbatim below together with the criterion's current full requirement text, so this record is readable without the AC JSON.

#### P18-AC-032 — deferred clauses (verbatim, from `phaseClauses["deferred-18P"]` at HEAD)
- > ApprovalStore invalidation
- > no approval reused (no approval exists in Phase 18)

**full requirement text at HEAD (verbatim, for context; its live clauses are NOT deferred):**
> Material target change since dry-run: `PLAN_DRIFT`, new review required, no approval reused

`mergeCondition`: `{"plan-drift": true, "approval-invalidation": false}`

#### P18-AC-074 — deferred clauses (verbatim, from `phaseClauses["deferred-18P"]` at HEAD)
- > the former AC-051 approved half
- > the tests-only executable for exit 0
- > exit 14 as an expected outcome

**full requirement text at HEAD (verbatim, for context; its live clauses are NOT deferred):**
> Phase 18 matrix on Node 24 CI has zero skipped or expected-fail tests; a skip fails the job

`mergeCondition`: `{"zero-skip": true, "approved-half": false}`

#### P18-AC-083 — deferred clauses (verbatim, from `phaseClauses["deferred-18P"]` at HEAD)
- > the env and file run-token transport refusals
- > exit 14

**full requirement text at HEAD (verbatim, for context; its live clauses are NOT deferred):**
> In shard mode every protected step is refused POLICY_PROTECTED_ACTION_UNSUPPORTED (exit 18, mandatory reason code per rev 17 section 11f and rev 18 section D) — statically bound protected actions before any browser launch — no run-token transport exists in Phase 18, so there is nothing to refuse (the env and file run-token refusals are DEFERRED to 18P; rev 18 section B), and run/approvals is never created

`mergeCondition`: `{"shard-refusal": true, "run-token-transport": false}`

#### P18-AC-085 — deferred clauses (verbatim, from `phaseClauses["deferred-18P"]` at HEAD)
- > the approvals-root admitted-id set and approvals_root_not_durable
- > the missing-approval-history and APPROVAL_REQUIRED exit 14 rows
- > the genesis audit entry
- > approval_history_unverifiable
- > approvals_root_symlink including the symlinked-parent row

**full requirement text at HEAD (verbatim, for context; its live clauses are NOT deferred):**
> Filesystem admission is numeric and evidence-gated: tmpfs and zfs only with a recorded statfs id and passing O_EXCL, rename and fsync behaviour tests; overlayfs, virtiofs, drvfs and every unrecorded id are refused PILOT_INTERNAL_ERROR exit 18 with an actionable message naming the observed id and path, never a skip; admission is evaluated per root against a per-root admitted-id set: tmpfs may be admitted for run/auth and run/plans after the behaviour checks and is refused for run/approvals (exit 18, reason approvals_root_not_durable), zfs stays conditional on SPIKE-FS evidence, unknown ids fail closed on every root, and no id is admissible from a kernel header, documentation or reviewer knowledge — only an observed, committed value. DEFERRED to 18P-PROTECTED-NONGET under OWNER-13 (rev 18 section A2; inline marker added by rev 19 to close SEC-18 m-65 and m-67) - the following approval-root partition is unshipped design history with no Phase 18 trigger, because Phase 18 creates no approvals root, writes no ledger and has no approval history, and exit 14 is reserved and unreachable: A missing approval history — the resolved real path of the approvals root absent, which requires both realpath and lstat of the root path to give ENOENT, or the root present and an empty directory — yields APPROVAL_REQUIRED exit 14 and is never reconstructed from a receipt, bundle, report, cache, environment variable or second root, and a freshly initialised ledger writes a genesis audit entry recording that no prior history was found; anything present but not fully verifiable — zero-length or truncated ledger, segment or anchors file, missing or unparseable header, missing referenced segment, foreign build identity, broken chain, or any read failure other than ENOENT on the root — is PILOT_INTERNAL_ERROR exit 18, reason approval_history_unverifiable, and is never downgraded to exit 14; a dangling symlink at the root, where realpath gives ENOENT but lstat succeeds, is PILOT_INTERNAL_ERROR exit 18, reason approvals_root_symlink, and is never treated as missing; and a root that is present and non-empty but holds no verifiable chain, including one holding only a lock file, only a marker or only unknown files, is PILOT_INTERNAL_ERROR exit 18, reason approval_history_unverifiable; and when the approvals root is missing beneath a symlinked parent, where both realpath and lstat of the root give ENOENT but an ancestor of the root is a symlink, the parent no-symlink rule of ADR-0030 fails first and the state is PILOT_INTERNAL_ERROR exit 18, reason approvals_root_symlink, and is never counted as missing; existsSync is forbidden anywhere in this partition and lstat is mandatory

`mergeCondition`: `{"filesystem-admission": true, "approval-root-and-ledger": false}`

#### P18-AC-086 — deferred clauses (verbatim, from `phaseClauses["deferred-18P"]` at HEAD)
- > protected-action lease mint and consume
- > redirect continuation
- > one-transmission counter
- > chainDeadlineMs

**full requirement text at HEAD (verbatim, for context; its live clauses are NOT deferred):**
> Arming window defaults to 2000 ms with a hard maximum of 10000 ms and a minimum of 250 ms; any out-of-range, non-integer or non-numeric value is a configuration error refused before browser launch; one lease authorises exactly one protected-action attempt, is never refreshed or extended, and expiry fails closed; the first matching protected request consumes the lease and redirect continuation is part of that consumed attempt, minting and refreshing nothing: every hop is evaluated against the method actually observed on that hop and never inferred from the status code, a hop preserving a non-GET method must stay on the approved normalised origin, path and method (307/308 included), a hop observed to become GET is evaluated under ordinary GET route and origin policy and is never assumed side-effect-free, and expiry, ambiguity, an unobservable method, cross-origin movement, an unexpected path change or a method mismatch aborts the chain; every hop stays under the redirect cap and the chain under windowMs + 5000 ms with an absolute maximum of 30000 ms; at most one transmission of the approved non-GET body occurs per approval, enforced by a lease transmission counter and audited per transmission, so a same-target 307/308 continuation is aborted once a transmission has occurred (redirect_would_retransmit_approved_body); the chain deadline is min(windowMs + 5000, 30000) ms, computed by a pure total bounded function chainDeadlineMs(windowMs, graceMs, absoluteMaxMs) which first asserts, for each of its three arguments, that the value is a number, a safe integer and non-negative, and otherwise throws PILOT_INTERNAL_ERROR exit 18, invalid_chain_deadline_input, naming the offending parameter and never clamping, because unvalidated the function returns NaN for NaN and for undefined so that the deadline can never expire, 4999 for -1, 30000 for the string "5" and for Infinity and for 2 to the 53 plus 1, 5000 for the empty string and for null, 5001 for true, 5002.5 for 2.5, 5250 for an object with a valueOf, and a one-millisecond deadline when absoluteMaxMs is the string "1"; and which is unit-tested with synthetic inputs outside the configurable range, together with throw rows for NaN, -1, Infinity, -Infinity, the string "5", the empty string, null, undefined, true, 2.5, an array, an object with a valueOf, and 2 to the 53 plus 1, and throw rows for graceMs NaN and -1 and for absoluteMaxMs the string "1" (0, 250, 2000, 10000, 10001, 24999, 25000, 25001 and 1e9), so the 30000 ms cap is tested at the only place it is reachable while runtime configuration still refuses any windowMs outside 250..10000, non-integer or non-numeric before browser launch and never clamps; and the SPIKE-R outcome is applied per hop class from the filled table of rev 13 section 7g.1, in which no cell is enforceable: an observe-only class is detection and not prevention, so an observed hop on a protected attempt fails the step and the run and is audited as a post-send incident with the limitation stating that the hop had already been sent and that a 307 or 308 body had already reached the next hop, including a cross-origin one; an unobservable class alone is refused before arming (POLICY_REDIRECT_UNOBSERVABLE, exit 18); the only prevention claimed is that a protected non-GET is armed solely on a route the manifest declares non-redirecting, enforced before the request is issued from declared data and not from observation; serviceWorkers is set to block in every pilot context, because a controlling service worker follows a redirect internally while the route handler sees only the first request; Falcon never emulates, reconstructs, replays or continues a chain the browser did not expose; and a protected non-GET that is not redirected is unaffected A routed protected request is armed only when the serialized origin of the request URL at hop zero is equal to both the serialized origin of the page's top-level document and the origin recorded in the consumed approval, compared as scheme, host and port with the WHATWG URL parser, ASCII-lowercased, default port omitted, userinfo and a trailing host dot refused, by string equality and never by host suffix, eTLD-plus-one or same-site relaxation; any inequality, and any opaque or non-fetchable origin including about, blob, data, file and null, is refused before the route is armed and before any request is issued, with POLICY_PROTECTED_CROSS_ORIGIN_UNSUPPORTED exit 18 and the three origins named in the audit entry. This applies to every routed protected request under every scope option and not only to candidate mechanism M1, because plain route.continue already suppresses the CORS preflight. No cross-origin routed protected request exists in Phase 18: a manifest that declares one is refused at manifest load. The three origins are recomputed immediately before the hop-zero request as defence in depth, and a mismatch is POLICY_PROTECTED_ORIGIN_CHANGED exit 18, labelled detection and not prevention, because whether route.abort prevents transmission of hop zero itself is UNVERIFIED. If the hop-zero response is a 3xx whose Location resolves cross-origin, the response is discarded and no hop is performed. The origin comparison additionally covers the request's initiator: a routed protected request is armed only when the serialized origin of the initiating frame equals the page's top-level origin, the approved origin and the hop-zero target origin, and only when every ancestor frame of the initiator is same-origin with the top-level document, in the normative form that the initiating frame is reference-identical to the page's main frame. Every URL is screened scheme-first, refusing any protocol other than http and https before the serialized origin is read, because a blob URL exposes an inner origin rather than null; userinfo is refused by checking the username and password fields, since the serialized origin drops them, and a trailing host dot is refused by checking the hostname. Where an Origin request header is present it must parse and equal the top-level origin, while its absence is not by itself a refusal and no security property is claimed from it. The top-level origin is computed from Playwright's own main-frame URL and never from page-evaluated script. A request whose initiator cannot be established is refused before arming with POLICY_PROTECTED_INITIATOR_UNSUPPORTED exit 18: a service-worker-originated request, a frame accessor that throws or yields a falsy, detached or unparsable frame, and a request from a popup or an opener. The entire rule, including the initiator and Origin checks, is re-evaluated at the hop-zero re-check, which remains labelled detection and not prevention. DEFERRED under OWNER-12 (Option C) and OWNER-13: no protected non-GET request reaches arming in Phase 18, so the protected-action lease mint and consume, the redirect-continuation rules, the one-transmission counter and chainDeadlineMs have no Phase 18 trigger; they are retained unweakened as 18P-PROTECTED-NONGET entry requirements. Live in Phase 18: window validation only, in the form recorded in phaseClauses.current (250 ms minimum, 2000 ms default, 10000 ms maximum, out-of-range refused before browser launch, never clamped), in force only where a permitted-action (non-protected) lease exists. Under owner decision OWNER-12 (Option C) the protected-non-GET clauses of this criterion — lease mint and consume for a protected action, redirect continuation, the one-transmission counter and chainDeadlineMs — are DEFERRED to 18P-PROTECTED-NONGET and are not Phase 18 merge conditions. The window-validation clause remains in force wherever a lease exists for a permitted non-protected action: 250 ms minimum, 2000 ms default, 10000 ms maximum, out-of-range is a configuration error refused before browser launch and never clamped. (rev 16 section 10f A3 verbatim, applied by rev 18 section A5.)

`mergeCondition`: `{"window-validation": true, "lease-redirect-transmission-deadline": false}`

#### P18-AC-089 — deferred clauses (verbatim, from `phaseClauses["deferred-18P"]` at HEAD)
- > the comparison against the approved element identity
- > APPROVAL_MISMATCH exit 14

**full requirement text at HEAD (verbatim, for context; its live clauses are NOT deferred):**
> Classification is recomputed at gate.perform from the freshly loaded manifest against the element actually acted on; the effective class is the maximum of plan row, live recompute and provider advice over denied > protected > permitted; a plan row can never lower a class (it records PLAN_CLASSIFICATION_DRIFT when it tries) and a healed or re-resolved element that reclassifies to protected, or whose identity differs from the recorded plan-row identity, is refused POLICY_PROTECTED_ACTION_UNSUPPORTED exit 18 with its mandatory reason code (rev 17 section 11i, rev 18 section D); the comparison against an approved identity is DEFERRED to 18P, because no approval exists in Phase 18

`mergeCondition`: `{"recompute-and-maximum": true, "approved-identity": false}`

#### P18-AC-090 — deferred clauses (verbatim, from `phaseClauses["deferred-18P"]` at HEAD)
- > the fixture approval authority and its loopback capability
- > the ApprovalStore constructor and PilotRuntime frozen ledger source and resolver
- > consumption re-checked at gate.perform
- > the approve flags, the TTY writer and the ledger/fixture WeakSet discriminator
- > every APPROVAL_REQUIRED exit 14 refusal of this criterion

**full requirement text at HEAD (verbatim, for context; its live clauses are NOT deferred):**
> Structural unavailability (the live half of AC-098 under OWNER-13): no production path reaches any approval creation, persistence, consumption or protected-action execution code, because none exists. Any retained approval or protected-action prototype lives at exactly one permitted location, tests/experimental/, and no file under src/, scripts/, falcon.js, package.json or any workflow reaches it by a require, require.resolve, literal import(), createRequire, child-process node <literal>, worker, Playwright config or workflow run: edge; every non-literal such edge in src/, scripts/ and falcon.js fails closed. The check admits no exemption, runs even when no prototype is retained, and is verified by the roots, edge-resolution rules, deterministic classification rule, forbidden targets and fourteen inversion fixtures with one positive control of rev 19 section C, which supersedes rev 18 section C and is the same section AC-098 (ii) cites. The remainder of the rev 17 AC-090 text (the fixture approval authority, the ApprovalStore constructor, the PilotRuntime ledger source and resolver, consumption at gate.perform, the approve flags, the TTY writer and the ledger discriminator) is DEFERRED to 18P-PROTECTED-NONGET under OWNER-13, retained unweakened as unshipped design history and preserved verbatim at git revision 909d794 in this file under P18-AC-090 (rev 18 section A4).

`mergeCondition`: `{"structural-unavailability": true, "fixture-authority-and-consumption": false}`

#### P18-AC-095 — deferred clauses (verbatim, from `phaseClauses["deferred-18P"]` at HEAD)
- > the ApprovalStore.js and PilotFixtureServer.cjs capture sets
- > WeakSet.prototype.add and has and the ledger-predicate runtime cases L17 to L20
- > crypto.timingSafeEqual for the fixture capability
- > the net.Server and EventEmitter fixture captures

**full requirement text at HEAD (verbatim, for context; its live clauses are NOT deferred):**
> Every JavaScript intrinsic and built-in method on which a pilot gate or filesystem decision depends (the approval and fixture-authority capture sets, and the ledger-predicate cases L17 to L20, are DEFERRED to 18P under OWNER-13) is captured once at module load in uncurried form, bound through a Function.prototype.call reference taken before any other code in the module runs, and is thereafter invoked only by direct call, never through a live .call, .apply or .bind property lookup and never through the global Reflect.apply. The captured set is at least WeakSet.prototype.add and has, WeakMap.prototype.get, set and has, the net.Server.prototype address method and listening getter, EventEmitter.prototype.listeners and listenerCount, Object.prototype.hasOwnProperty, crypto.timingSafeEqual and every fs.promises method used on a pilot hot path. A load-time assertion that each captured value is typeof function fails closed with PILOT_INTERNAL_ERROR exit 18, intrinsic_capture_failed. A runtime case, labelled in the suite as a smoke check for misconfiguration and careless tampering and never as an integrity control, asserts for each capture that uncurry(Function.prototype.toString) applied to it reports native code, that its own property names are exactly length and name, and that inspecting it with hidden properties at depth four does not reveal the bound receiver. A runtime case replaces Function.prototype.call, Function.prototype.apply, Function.prototype.bind, the global Reflect.apply, WeakSet.prototype.add and WeakSet.prototype.has after module load, each alone and all together, and pollutes Object.prototype, Array.prototype and Function.prototype, and asserts that the ledger predicate's verdict is unchanged, that no value passed to any replacement is a WeakSet or a registry, that no forged object can be registered, and that the replacements record zero invocations; the inversion is that reverting any one capture to the dotted call form must make this case fail. A further case, marked in the suite as a documented limitation and never as a passing control, replaces WeakSet.prototype.add and has before the module loads and asserts the documented outcome that a forged approval is then accepted, so that the pre-load scope statement cannot silently drift. A static check asserts that no file under src/core/pilot/ (there is no src/core/pilot/approval/ directory in Phase 18) contains the substrings .call(, .apply(, .bind( or Reflect.apply( other than the single uncurry definition line, and that the capture block is the first executable statement group after "use strict". The architecture claims no integrity property for this check: a genuine uncurried capture is itself a bound function, so it stringifies as native code and has own property names exactly length and name, and a behaviour-preserving bound wrapper planted before module load is indistinguishable from it on every one of those signals, the only observed difference being the own name property, which is configurable on a bound function and therefore attacker-settable. The load-time assertion fails loudly only for a careless pre-load tamper that leaves a captured value non-callable; a behaviour-preserving pre-load tamper does not fail at all and a forged approval is then accepted, and the documented-limitation case covers both the WeakSet-replacement variant and the pre-load Function.prototype.bind bound-wrapper variant.

`mergeCondition`: `{"gate-capture-set": true, "approval-and-fixture-capture-sets": false}`

### 2.3 Rev 17 text of the criteria that lost sentences

Historical context only: the following text was the state of these criteria before the OWNER-12/OWNER-13 reductions, at the commit recorded in design history as `909d794` (an unpushed, orphanable commit; **this copy, not that commit, is the authority**). It is reproduced verbatim so that the withdrawn sentences are recoverable from tracked content. It is unshipped design history and is not a requirement of any kind.

#### P18-AC-074 — rev 17 requirement (verbatim copy)
> Phase 18 matrix on Node 24 CI has zero skipped or expected-fail tests; a skip fails the job

**rev 17 components (verbatim copy):**

> CI job: skip or expected-fail fails the job; a pilot job whose fixture plan contains a protected step asserts exit 14 as its expected outcome and is never skipped; the AC-051 approved half (OWNER-12: the former AC-051 approved half is now the fixture-only internal evidence of AC-098, not a customer-facing capability claim) runs inside the normal regression gate on Node 24 — in-process plus a tests-only executable for the exit codes — and is neither skipped nor expected-fail, so OWNER-09 amends nothing here; OWNER-13: the former AC-051 approved half no longer exists as a Phase 18 test; the regression gate proves refusal and non-reachability instead (rev 17 section 11m)

#### P18-AC-083 — rev 17 requirement (verbatim copy)
> In shard mode every protected step is refused APPROVAL_REQUIRED (exit 14) — statically bound protected actions before any browser launch — a run token in env or file is refused without being opened, and run/approvals is never created

**rev 17 components (verbatim copy):**

> plan projection pre-flight refusal + gate.perform refusal + token refusal (OD-23, ADR-0038 amended)

#### P18-AC-084 — rev 17 requirement (verbatim copy)
> No workflow contains an approve step, approve flag, run-token env key, token file or approvals path; a protected action reached in CI is refused APPROVAL_REQUIRED exit 14; the static check resolves npm/yarn/npx script indirection and node/bash invocations transitively with cycle detection, walks static require graphs, fails on any reachable approve flag, token key, approvals path or approval-module import outside src/core/pilot/ and tests/, and fails closed on any command it cannot statically resolve; it additionally fails on any require of a tests/ path from src/ or scripts/ and on any workflow invocation of a tests-only executable outside the test gate. This static check is defence in depth: the primary control is the structural fixture boundary of rev 10 section 4a (no production require path to the approval authority, no enabling environment variable, no production mint function) The walker additionally fails on any reachable customer-facing code path that could route, perform, continue, fulfil or emulate a protected non-GET request, including any dormant, flag-disabled or configuration-reachable M1 or route.fetch fallback, so that the absence of such a path is checked and not assumed. The walker finds action sites by scanning src/ for every Playwright action and request sink rather than from a fixed list, and any site not routed through the gate fails closed; it admits no exemption; and it fails on the existence of --approve-action or --emit-token-to anywhere under src/, falcon.js, scripts/, package.json or .github/ (rev 17 sections 11a, 11d.6, 11j).

**rev 17 components (verbatim copy):**

> static ci.yml check over every job + CI pilot job expected-exit assertion (OD-24, ADR-0041); FALCON_PILOT_TEST_RUNNER is withdrawn and must not reappear

#### P18-AC-085 — rev 17 requirement (verbatim copy)
> Filesystem admission is numeric and evidence-gated: tmpfs and zfs only with a recorded statfs id and passing O_EXCL, rename and fsync behaviour tests; overlayfs, virtiofs, drvfs and every unrecorded id are refused PILOT_INTERNAL_ERROR exit 18 with an actionable message naming the observed id and path, never a skip; admission is evaluated per root against a per-root admitted-id set: tmpfs may be admitted for run/auth and run/plans after the behaviour checks and is refused for run/approvals (exit 18, reason approvals_root_not_durable), zfs stays conditional on SPIKE-FS evidence, unknown ids fail closed on every root, and no id is admissible from a kernel header, documentation or reviewer knowledge — only an observed, committed value. A missing approval history — the resolved real path of the approvals root absent, which requires both realpath and lstat of the root path to give ENOENT, or the root present and an empty directory — yields APPROVAL_REQUIRED exit 14 and is never reconstructed from a receipt, bundle, report, cache, environment variable or second root, and a freshly initialised ledger writes a genesis audit entry recording that no prior history was found; anything present but not fully verifiable — zero-length or truncated ledger, segment or anchors file, missing or unparseable header, missing referenced segment, foreign build identity, broken chain, or any read failure other than ENOENT on the root — is PILOT_INTERNAL_ERROR exit 18, reason approval_history_unverifiable, and is never downgraded to exit 14; a dangling symlink at the root, where realpath gives ENOENT but lstat succeeds, is PILOT_INTERNAL_ERROR exit 18, reason approvals_root_symlink, and is never treated as missing; and a root that is present and non-empty but holds no verifiable chain, including one holding only a lock file, only a marker or only unknown files, is PILOT_INTERNAL_ERROR exit 18, reason approval_history_unverifiable; and when the approvals root is missing beneath a symlinked parent, where both realpath and lstat of the root give ENOENT but an ancestor of the root is a symlink, the parent no-symlink rule of ADR-0030 fails first and the state is PILOT_INTERNAL_ERROR exit 18, reason approvals_root_symlink, and is never counted as missing; existsSync is forbidden anywhere in this partition and lstat is mandatory

**rev 17 components (verbatim copy):**

> SafeFs.assertLocalFilesystem + SPIKE-FS evidence table + filesystem behaviour tests (OD-20, ADR-0030 amended); rootKind column in the compatibility matrix; operator guide states why the approval root must be durable (OD-20-Q1 resolved by OWNER-11)

#### P18-AC-089 — rev 17 requirement (verbatim copy)
> Classification is recomputed at gate.perform from the freshly loaded manifest against the element actually acted on; the effective class is the maximum of plan row, live recompute and provider advice over denied > protected > permitted; a plan row can never lower a class (it records PLAN_CLASSIFICATION_DRIFT when it tries) and a healed or re-resolved element whose identity differs from the approved one is refused APPROVAL_MISMATCH exit 14

**rev 17 components (verbatim copy):**

> PilotActionGate.perform recompute + maximum rule + heal re-classification (rev 9 section 3a.3)

#### P18-AC-090 — rev 17 requirement (verbatim copy)
> The fixture approval authority is structurally unavailable to production: it lives under tests/, no file under src/, scripts/, falcon.js, package.json or any workflow requires it, the ApprovalStore constructor accepts no authority, source, mint callback or test hook, PilotRuntime constructs exactly one frozen ledger source, admits a resolver only when every source is that singleton instance by reference identity, validates its options against a closed key allowlist that contains no sources, resolver, authority, gate or store key (unknown key → PILOT_INTERNAL_ERROR exit 18, unknown_runtime_option), and exposes no injection API, so no environment variable, CLI option, config key, manifest field or argv path adds a source and nothing can be passed through falcon.js. The authority is constructible only from a live net.Server object created by the tests-only pilot fixture server in this process plus that server's per-run 32-byte in-memory capability (timing-safe compared, never serialised, logged or exported); it accepts no host, port, origin or URL and derives the origin from server.address(), requiring an IPv4 127.0.0.1 or IPv6 ::1 literal and a listening server at construction and on every resolve; it requires a manifest all of whose route origins are that same loopback origin; it serves only the fixed fixture app with no handler, upstream or proxy option, and a pilot context resolving a fixture approval refuses any browser proxy setting (exit 18); it resolves at most once per binding and a serialised copy is refused (exit 14, fixture_approval_not_live). Consumption is re-checked in production code at gate.perform and any non-loopback destination is refused APPROVAL_REQUIRED exit 14, reason fixture_approval_non_loopback. ApprovalStore.mintFixtureScoped and FALCON_PILOT_TEST_RUNNER are withdrawn; --approve-action and --emit-token-to still refuse exit 1 in CI and --approve-action requires a TTY, both as accident guards only.No approval object carries a scope field and no production code reads one as a trust input; the ledger/fixture distinction is membership in a module-private WeakSet registered only by ApprovalStore's private verified-consumption path, with no class, constructor or prototype in the discriminator path, which also deep-freezes the approval and its binding, and ApprovalStore exposes no writer or mint surface of any kind — the ledger writer is reachable only through falcon.js's interactive --approve-action path, which requires tty.isatty on fds 0 and 1 and a typed random challenge with no programmatic supply path.; a PilotRuntime-built gate additionally refuses every unbranded approval (APPROVAL_REQUIRED exit 14, fixture_approval_in_production_runtime), so production never evaluates the fixture branch Under OWNER-13 this is the structural-unavailability half of AC-098: it applies to tests/ and to any retained experimental approval prototype, and still runs as a check if no prototype is retained (rev 17 section 11d.6).

**rev 17 components (verbatim copy):**

> PilotApprovalResolver injection seam + tests/pilot/approval/FixtureApprovalAuthority + tests/pilot/fixtures/PilotFixtureServer + tests/pilot/bin/approved-fixture-case.cjs + PilotActionGate consumption re-check (rev 10 section 4a, ADR-0044 accepted-with-owner-decision, OWNER-09); ApprovalStore closure-held ledger registry + isLedgerApproval predicate + ApprovalCliWriter + PilotFixtureServer.isFixtureServer (rev 11 section 5a) (rev 12 section 6a, 6c.3)

#### P18-AC-095 — rev 17 requirement (verbatim copy)
> Every JavaScript intrinsic and built-in method on which a pilot approval, gate, fixture or filesystem decision depends is captured once at module load in uncurried form, bound through a Function.prototype.call reference taken before any other code in the module runs, and is thereafter invoked only by direct call, never through a live .call, .apply or .bind property lookup and never through the global Reflect.apply. The captured set is at least WeakSet.prototype.add and has, WeakMap.prototype.get, set and has, the net.Server.prototype address method and listening getter, EventEmitter.prototype.listeners and listenerCount, Object.prototype.hasOwnProperty, crypto.timingSafeEqual and every fs.promises method used on a pilot hot path. A load-time assertion that each captured value is typeof function fails closed with PILOT_INTERNAL_ERROR exit 18, intrinsic_capture_failed. A runtime case, labelled in the suite as a smoke check for misconfiguration and careless tampering and never as an integrity control, asserts for each capture that uncurry(Function.prototype.toString) applied to it reports native code, that its own property names are exactly length and name, and that inspecting it with hidden properties at depth four does not reveal the bound receiver. A runtime case replaces Function.prototype.call, Function.prototype.apply, Function.prototype.bind, the global Reflect.apply, WeakSet.prototype.add and WeakSet.prototype.has after module load, each alone and all together, and pollutes Object.prototype, Array.prototype and Function.prototype, and asserts that the ledger predicate's verdict is unchanged, that no value passed to any replacement is a WeakSet or a registry, that no forged object can be registered, and that the replacements record zero invocations; the inversion is that reverting any one capture to the dotted call form must make this case fail. A further case, marked in the suite as a documented limitation and never as a passing control, replaces WeakSet.prototype.add and has before the module loads and asserts the documented outcome that a forged approval is then accepted, so that the pre-load scope statement cannot silently drift. A static check asserts that no file under src/core/pilot/approval/ or src/core/pilot/PilotActionGate.js contains the substrings .call(, .apply(, .bind( or Reflect.apply( other than the single uncurry definition line, and that the capture block is the first executable statement group after "use strict". The architecture claims no integrity property for this check: a genuine uncurried capture is itself a bound function, so it stringifies as native code and has own property names exactly length and name, and a behaviour-preserving bound wrapper planted before module load is indistinguishable from it on every one of those signals, the only observed difference being the own name property, which is configurable on a bound function and therefore attacker-settable. The load-time assertion fails loudly only for a careless pre-load tamper that leaves a captured value non-callable; a behaviour-preserving pre-load tamper does not fail at all and a forged approval is then accepted, and the documented-limitation case covers both the WeakSet-replacement variant and the pre-load Function.prototype.bind bound-wrapper variant.

**rev 17 components (verbatim copy):**

> the uncurried capture block of rev 13 section 7a.1 in ApprovalStore.js, PilotActionGate.js and PilotFixtureServer.cjs + cases L17, L18, L19 and L20 of rev 13 section 7a.3 + the 18F dotted-invocation and capture-order static checks (rev 13 section 7a; closes SEC-12 m-39); rev 14 section 8b smoke-check relabelling and the L20 bind-wrapper variant (closes SEC-13 m-46)

## 3. OWNER-12 and OWNER-13 deferred-work list

### 3.1 Protected non-GET execution (OWNER-12, Option C) — entry requirements

Carried forward as explicit entry requirements for 18P-PROTECTED-NONGET; none is measured or verified today:

1. **Falcon single-transmission transport.** A transport that provably transmits a protected non-GET request exactly once, with no duplicate send.
2. **Browser response-semantic mismatch.** The 204-for-a-discarded-3xx behaviour and status pass-through recorded in rev 15 section 9a.2.
3. **Redirect handling** across 301, 302, 303, 307 and 308, same-origin and cross-origin, including method and body rewriting.
4. **`Sec-Fetch-*` header differences:** preserved under `route.continue`, dropped by `route.fetch`.
5. **PUT/PATCH/DELETE measurements:** never measured. UNVERIFIED.
6. **Multipart and large bodies.**
7. **Duplicate-send and socket-retry resend** (H-7).
8. **Service-worker behaviour.**
9. **Business-outcome verification:** proving the application state actually changed, not only that a request left.
10. **Firefox and WebKit evidence:** UNVERIFIED on every item above; all measurements to date are Chromium-only.

Inputs preserved for that work: the rev 14 section 8a and rev 15 section 9a gate text, the A''/B'' option text, candidate mechanism M1, R-7, R-10 and the SPIKE-R extension rows. Phase 18 specifies none of them in any form, including dormant or flag-disabled code.

### 3.2 The production approval path (OWNER-13)

Deferred in full: the interactive approval writer (`approve-action`), the approval CLI and any dashboard approval action, the approval flags (`--approve-action`, `--emit-token-to`), `RunToken`, `RunTokenEmitter`, `LedgerLock`, `ApprovalStore`, `ApprovalRecord`, `Binding`, `AuditLog`, the `PilotApprovalResolver` seam, the closure-held ledger registry and brand, the gate-side capability `WeakMap`, the `PilotRuntime` unbranded-approval refusal, the approvals root and its migration, the approval-ledger filesystem clauses, token consumption and replay, the approval state machine formerly carried by AC-098, and exit 14 (`APPROVAL_REQUIRED`, `APPROVAL_MISMATCH`, `APPROVAL_STALE`, `APPROVAL_REPLAYED`). Exit 14 is reserved and unreachable in Phase 18 and returns only with this item.

### 3.3 Approval-writer research moved to 18P

- **Approval-ledger filesystem policy.** Per-root admission for an approvals root: durability, `O_NOFOLLOW`, uid and mode requirements, the empty-root, dangling-symlink, non-empty-without-chain and symlinked-parent rows of the AC-085 matrix, `approvals_root_symlink` and `approval_history_unverifiable`, and the `approvals_root_not_durable` refusal. Phase 18 creates no approvals root; the prohibition on `existsSync` and the mandatory `lstat` are retained for every live root.
- **PTY approval test (AC-094).** The interactive-path test and its pty helper, local/manual only; deferred with the writer.
- **Production brand and registry.** The closure-held ledger registry, `isLedgerApproval`, the null-prototype approval object, the total deep freeze, and the entry-module identity check for the writer.
- **Token consumption and replay.** Single-use consumption re-checked at `gate.perform`, replay rejection against a different plan, manifest, role, origin, action and build.
- **Approval-root migration.** `run/approvals/` is never created in Phase 18; its `.gitignore` entry and any migration are deferred with the root.
- **Audit log format.** Segmented from the start with a never-pruned anchor chain; no segment or anchor format is migrated in Phase 18.
- **Rollback position.** The fixture approval seam and the approval discriminator have no safe revert path: restoring a production mint function or an environment-variable test mode, reinstating a class brand or declared scope, exporting any registration, brand or writer surface, returning the capability proof to the approval object, relaxing the writer's entry-module identity check to a path compare, admitting a server by shape, or removing the total deep freeze each reopens a closed Security major. Defects there are fixed forward, not reverted.

## 4. Relevant threat findings (SEC-04 to SEC-19), condensed and attributed

These are the findings whose subject matter is deferred. They are recorded here so that 18P does not restart from zero. None is accepted; acceptance belongs to the owner alone.

- **M-15 (SEC-10, PARTIAL).** The approval discriminator's scope-string defect; the remaining defect was re-raised as M-16. The ten attempt cases of rev 11 section 5a.5 (relabel, binding mutation and `defineProperty`, wrapper source, duck-typed server, self-created real `net.Server`, prototype pollution, prototype-create and clone, runtime option injection, in-process ledger-writer call, export enumeration), each with an inversion, are its test obligation.
- **M-16 (SEC-11, CLOSED in design).** A forgeable ledger brand: `Object.getPrototypeOf(a)`, `a.constructor`, `Reflect.construct(fn, [], isLedgerApproval)` and `class extends isLedgerApproval` must all fail to reach a constructor. Closure held registry plus a null-prototype, deep-frozen approval. The closure must not leak the registry on any predicate call: a leak is worse than M-16 because no genuine approval is needed.
- **M-17 / M-18 (SEC-13, SEC-14).** The origin gate keyed on the top-level origin and ignored the request's initiator. Closed in design by the initiator-and-ancestor gate in reference-identity form, `POLICY_PROTECTED_INITIATOR_UNSUPPORTED`, scheme-first URL screening and the `Origin` cross-check. The arming, lease and gate scope this protected is deferred with protected non-GET execution.
- **M-19 (SEC-15).** The production approval and arming subsystem was still specified, so the AC-098 fixture path needed exactly the dormant transport Option C forbids. Resolved by OWNER-13's removal, which is what this document carries.
- **M-20 (SEC-15).** Deferred clauses were still live normative text, so deferred items read as live merge conditions. The clause-level `phaseClauses` split and this document are the remedy.
- **m-51 (SEC-14, Minor; OWNER-13-Q1 DECIDED: deferred with 18P).** Section 9c.2 item 1 required each enumerated `http` prototype method to be "an own data property of the prototype" it names, but 9 of 10 are inherited, so a genuine server fails the check as written. Its remediation, which is the deferred test obligation: at load, record each method's owning prototype by walking the chain with a captured `getPrototypeOf` and `hasOwnProperty`; capture the owner's descriptor and the chain links; at each check assert that the owner's descriptor is still an own data property holding the capture, that no prototype between the named one and the owner has gained an own property of that name, and that every chain link is unchanged; add `OutgoingMessage.prototype._send` and `_writeRaw` and `ServerResponse.prototype._implicitHeader`; repoint F25b at a method genuinely outside the set (for example `net.Socket.prototype` or `stream.Writable.prototype.write`); add F25c, a shadowing own `end` planted on `ServerResponse.prototype`, expecting refusal, with an F18-style control in which a genuine server passes. The substance of m-51 is carried by AC-092 (section 2.1), not by AC-094.
- **m-52 (SEC-14, Minor) — conditions carried forward.** (a) A dedicated worker owned by the main frame is attributed to that frame and is treated as main-frame-initiated; a worker owned by any other frame is refused through that frame; restate 18C-M17-7 as service worker refused, worker owned by a cross-origin iframe refused (UNVERIFIED, case required), same-origin dedicated worker arms. (b) Make the `Origin` cross-check a co-equal normative guard: for a protected request whose method is not GET or HEAD, require `Origin` to be present, read from `await request.allHeaders()`. (c) State that the URL-derived origin is a proxy and that opaque origins are refused through `Origin: null`. (d) Add case 18C-M17-10: a CSP-sandboxed top document and a `data:` worker each POSTing to origin A, asserting refusal and zero transmissions, with the inversion dropping the rule so both arm.
- **R-7, R-10, H-7, R-8 and residuals 20, 25, 25a and 26** remain the owner's open positions on protected non-GET execution, M1, socket-level resend and repository trust. R-8 in particular bounds what fixture-identity checking can detect: a pre-load tamper, a tamper after a point-in-time consume check, an edited handler body, socket-level interception that preserves the listener snapshot, a compatible substituted `_handle`, a post-load patch of any prototype method outside the enumerated list, and a wrap of the server handle `onconnection` are **not detected** and are stated residuals.
- **Pre-load intrinsic replacement (threat-model item 23).** Code executing in the Falcon process before the approval store's first statement can replace the intrinsics the design captures. Deferred with the store; no Phase 18 trigger.
- **Approval history is attribution and tamper-evidence, not authentication**, and the approver label is metadata, not identity. Deferred; never published as a Phase 18 limitation.

## 5. SPIKE-R facts (copied verbatim from `docs/phase-18-spike-r-findings.md`)

The redirect measurements that 18P depends on are Chromium-only and experimental. Copied here so this record stands alone.

```markdown
# SPIKE-R findings: redirect hops in Chromium under Playwright 1.64.0

Status: experimental measurement, Chromium only, Node v22.19.0, macOS, loopback servers only (two origins on 127.0.0.1). Not a design decision: R-7 remains an owner item and the architecture patches decide how these results are used. Raw per-cell data was produced in scratch directories and is not committed.

## Part 1: does the route handler see or stop redirect hops?

Matrix: statuses 301, 302, 303, 307, 308; same-origin and cross-origin target; GET and POST; triggered by navigation, form submit and `fetch()`. 58 of 60 cells ran (a `page.goto` cannot issue a POST navigation). Ground truth is what the target server actually received.

| Finding | Result |
|---|---|
| `context.route` handler invocations | Only for the first request. Redirect hops never reach the handler (0 of all measured hops). |
| `route.abort` on the first request | Does not stop a later hop that the browser then follows; the landing request still arrived at the server. |
| `request` / `response` events | Expose each hop through `redirectedFrom()` ancestry, but only after the hop is sent. No pre-send evidence. |
| Method actually carried | Matched Playwright's report in every cell: 301, 302 and 303 converted POST to GET and dropped the body (landing request `GET /landing`, body length 0); 307 and 308 preserved POST and body. **Corrected (rev 13 section 7g.0):** an earlier summary said Chromium preserves the method for 301/302; the server-side ground truth does not support that. |
| Classification | Every class is OBSERVE_ONLY. Two cells are UNOBSERVABLE (307/308 cross-origin POST via `fetch`: the browser's CORS check blocked the follow, so no landing hop was issued). Zero cells are ENFORCEABLE per hop. |

## Part 2: service workers and alternative approaches

| Question | Result |
|---|---|
| Service workers | `serviceWorkers: 'block'` reliably prevented registration and service-worker fetches. With workers allowed, a worker follows redirects internally and the handler sees only the first request. |
| Fulfil the 3xx and let the browser continue | Does not help: the next hop is still browser-followed and the handler never saw it (0 of 20 cells). |
| Falcon performs the single approved request and replaces any 3xx with a non-redirect response | 16 of 16 sanitized cells (301, 303, 307, 308; same and cross origin; GET and POST; `fetch` trigger only; 302 was not in this set) showed exactly one server transmission and no landing request; the page saw a 204; cookies, Origin, Referer, a custom CSRF-style header and form/JSON bodies were sent on the single transmission only. The request carries the first-hop credentials to the redirect source, as the browser would. |
| Events as a gate | Event timestamps are at or after server receipt; there is no pre-send gate. |
| Launch arguments that disable redirects | None found (baseline and five candidates all followed the redirect). |

## Not covered

Firefox and WebKit; multipart and very large bodies; top-level navigation redirect policing (a 204 aborts the navigation and does not police it); service-worker message-port fetches; `route` re-registration races; whether Chromium can resend a non-idempotent request on a failed reused socket below the route layer (H-7).

## What this does and does not establish

- It establishes that the earlier design of policing each hop in the route handler (branch A) is not viable in this Chromium/Playwright combination.
- It shows one mechanism, performing the single approved request in Falcon without following redirects and returning a sanitized response, that gave exactly one transmission in the measured cells. This is a measurement, not proof that Falcon's request matches the browser's in every respect, and `route.fetch` replay is not treated as proof of browser behaviour.
- It does not decide R-7. The smallest safe scope, and which hop classes fail closed, is for the owner to decide after the architect and Security evaluate the mechanism.
```

## 6. Test obligations deferred with this item

Deferred test and case sets, each with its named inversion, none of which is a Phase 18 merge condition:

- `neg-p01-chain`, `neg-p01-truncate`, `neg-p02-replay`, `neg-q-runscope`, `neg-q-prune`, `neg-q-roots`, `neg-q-retention`, and the approval halves of `neg-f01-loaders` and `neg-s01-caps`.
- `neg-fixture-approval-scope`, `neg-fixture-no-arbitrary-target`, `neg-fixture-require-graph`.
- The named ledger-brand case map L1 to L20 and the fixture case map F1 to F25, F25b and the F25c added by m-51's remediation, each with its inversion, including: the M-16 forge set (prototype constructor, `Reflect.construct` with an attacker `newTarget`, `class extends`), copy, spread, `structuredClone`, JSON round trip, `Object.create`, prototype replacement, plain and revoked `Proxy`, predicate non-transfer, prototype pollution before and after module load, deep-frozen writes asserted as value-unchanged rather than as a throw, rejection of `Date`, `Buffer` and typed-array fields at seal, the eight binding-field substitutions, the six reuse sub-cases, `PilotRuntime` option injection and non-singleton source, the unbranded-approval refusal, the in-process writer refusal under both piped stdio and a pty, the runtime mint scan, the duck-typed, prototype-built, independently created, foreign-run, cross-process, closed and closed-and-reopened server cases, the `0.0.0.0` and `::ffff:127.0.0.1` binds, the address-alias list, capability serialisation by JSON, `structuredClone`, `v8.serialize` and child-process transfer, and the byte-identical filesystem assertion.
- The approval-interactive-path test and its pty helper (AC-094), local and manual only.
- `neg-n2-arming` rows (k) to (r): method-observed redirect continuation, gated on SPIKE-R.
- Cases 18C-M17-1 to 18C-M17-9, the amended 18C-M17-4, and 18C-M17-10 from m-52(d).
- The pilot-manual Playwright project and a `test:pilot-manual` script. Phase 18 adds neither to `package.json` nor to `playwright.config.js`.
- PUT/PATCH/DELETE, multipart, large-body, duplicate-send, service-worker, business-outcome and Firefox/WebKit measurements from section 3.1, none of which has ever been run.

## 7. Reactivation checklist

18P-PROTECTED-NONGET may not be started without, at minimum: a fresh owner decision reversing OWNER-12 and OWNER-13 for the specific scope being restored; a fresh Security review of the restored design; the section 3.1 measurements performed on Chromium, Firefox and WebKit; a verified Node position (H-8 is UNVERIFIED); and the section 6 test obligations planned with their inversions. Re-enabling any protected non-GET execution path, dormant or active, or adding any production approval create, mint, persist, consume or ledger path, is a reversal of an owner decision and not a design change.

## 8. Historical context (non-authoritative commit identifiers)

`909d794` (rev 17 criterion text), `0fbe099`, `dd8b3da`, `63f80e4`, `91e05b0` and `5c355cb` on the local branch `docs/phase-18-architecture` are cited in design history only. No tag exists or is proposed. Nothing in this document or in any live requirement depends on retrieving them.


## Appendix R21 (rev 21, closing the SEC-20 m-68 residual)

**Authority rule.** This tracked document is the sole authority for every deferred 18P-PROTECTED-NONGET text. No acceptance criterion, requirement, merge condition or open item depends on any tag or historical commit remaining reachable. Short commit identifiers that appear in this record, including inside text preserved verbatim from earlier revisions, are **historical context only and are not dependencies**; the earlier proposal of an annotated tag carrying the rev 17 criterion text is **WITHDRAWN** - no such tag is created, pushed, cited or relied on.

**Deferred content check.** The verbatim copies required by the 18P-DOC merge condition are unchanged by rev 21: the eleven wholly deferred criteria, the deferred clauses of the eight mixed criteria, the rev 17 text of the seven criteria that lost sentences, the OWNER-12 and OWNER-13 deferred-work lists, the approval-writer research, the relevant SEC-04 to SEC-20 findings including the m-51 and m-52 conditions, the SPIKE-R facts and the deferred test obligations. Rev 21 adds nothing to the deferred scope and removes nothing from it.

**Rev 21 corrections that touch quoted text here.** Where a preserved copy cites "fourteen inversion fixtures with one positive control" or "rev 19 section C", the quotation is left **verbatim** because its purpose is preservation; the live rules are rev 21 section C (C3.4b child_process capability-escape model and fixture table C6-T, the single source of truth for fixture ids and counts) and rev 21 section D (the unchanged rev 6 exit precedence, under which exit 13 masks none of 18, 17, 16 or 15 and never masks a pilot-store integrity violation). `PILOT_APPROVAL_RUN_TOKEN` is, in Phase 18, rejected on presence in every `falcon.js` invocation with exit 2 and reason `PILOT_CONFIG_REJECTED_ENV_KEY`; nothing in this deferred record authorises reading, measuring, storing or forwarding its value.

**Status.** Non-normative for Phase 18, non-production, unshipped, not authorised and not scheduled.

