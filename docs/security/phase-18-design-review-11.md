# Phase 18 Security Design Re-review 11 (SEC-12)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `8e96c27` on `docs/phase-18-architecture` (architecture rev 2 plus the [rev 3](../architecture/phase-18-rev3-patch.md) to [rev 12](../architecture/phase-18-rev12-patch.md) patches; base `2572e73`). Scope: the rev 12 delta only (ARCH-12 sections 6.0 to 6m), checked against [re-review 10](phase-18-design-review-10.md) (SEC-11: M-16, m-34..m-38). This record supersedes re-review 10. It is a design review only. No 18D code exists. Runtime facts come from standalone scratch models of the rev 12 text, not from Falcon code; the models are kept in the session scratchpad and are not committed.

**Verdict: APPROVE WITH CONDITIONS for 18E, 18A, 18C, 18B, 18D, 18F and DOC.** No P0. **Blockers: 0. Majors: 0.** M-16 is CLOSED. m-34 and m-35 are CLOSED with new precision minors; m-36, m-37 and m-38 are CLOSED. New minors: 7 (m-39..m-45). **The owner's requirement "Security reports zero blockers and zero majors on the revised design" is met, with one stated dependency:** m-39 is Minor only because post-load replacement of a built-in method (`Function.prototype.call`) is in the OWNER-10 out-of-scope class (code or intrinsic modification). Rev 12's own P4 claim and case L8 treat post-load intrinsic changes as in scope. If the owner rules that class in scope, m-39 is Major (P1 for 18D) and the requirement is not met. That scope ruling belongs to the owner. No risk is accepted here.

## Runtime probes (Node v22.19.0; Node 24 UNVERIFIED)

| # | Probe against the rev 12 text as written | Result |
|---|---|---|
| S1 | M-16 set: `Object.getPrototypeOf(a)`, `a.constructor`, `Reflect.construct(fn, [], isLedgerApproval)`, `class extends isLedgerApproval` | `null`, `undefined`, TypeError, TypeError. There is no constructor to reach |
| S2 | assign, spread, `structuredClone`, JSON round trip, `Object.create(a)`, `setPrototypeOf`, Proxy, revoked Proxy, predicate `.call`/`.apply`/`.bind` | all false, none throw |
| S3 | `Object.prototype` pollution before and after load; sloppy write to a nested path | not visible on approvals; write is a silent no-op, value unchanged |
| S4 | registry loaded twice (`require.cache` cleared) | instance 2 does not recognise instance-1 approvals. Fails closed |
| S5 | **post-load `Function.prototype.call` hook, then `isLedgerApproval({})`** | **leaks `LEDGER_REGISTRY`; a forged object then satisfies the predicate. No genuine approval is needed** (m-39) |
| S6 | same hook against uncurried captures (`Function.prototype.call.bind(WeakSet.prototype.has)`) | no leak, forge false |
| S7 | `WeakSet.prototype.has`/`add` replaced **before** the store loads | forges with either capture form (needs a require-order guarantee; OWNER-10 class) |
| S8 | entry-only writer: `process.mainModule` forged; `node -e`; `node --require` | all refuse (`isEntry:false`) |
| S9 | **writer source re-evaluated through `vm` with a made-up `module`/`require`; `Module.prototype._compile` hook; `require.cache` pre-seeded** | **the writer surface is reachable in-process in all three** (m-40) |
| S10 | `node approve-action.js` run directly; run under `script` (a pty) from `child_process` | entry true; `tty.isatty(0/1)` true under a pty. The isatty syscall check does not stop a pty that a test allocates (m-42) |
| S11 | fixture registry: prototype-built fake; close and reopen | fake refused; epoch goes 1 to 2 and the port changes, so it is refused |
| S12 | **registered fixture server with its `request` listener replaced by a forwarder** | **reference, epoch and port all still match, and it serves the forwarded target** (m-43) |
| S13 | dangling-symlink root | realpath ENOENT, lstat ok, `existsSync` false. lstat is mandatory; `existsSync` must not be used |
| S14 | `min(w+5000, 30000)` at NaN, -1, Infinity, `"5"` | NaN, 4999, 30000, 30000 (via string concatenation) (m-44) |
| S15 | AC JSON | valid; 94 criteria (Must 85, Should 6, Could 3); unique IDs; `counts` matches; AC-094 present; AC-085/086/090/092/093 rev 12 text present; R-9 and H-7 in `openItems` |

## Item status

**M-16: CLOSED.**
- The discriminator has no class, constructor or prototype (S1, S2). Copies, clones, proxies and lookalikes are refused.
- Choosing the registry over the class-with-key design is sound: it rests on one invariant, that `register` is never reachable.
- L15 (a runtime mint scan over every export) does test that invariant directly. It is not vacuous, as rev 11 case 10 was.
- The residual is unchanged: any holder of a genuine approval can pass it on.
- The capture mechanism has a call-site defect (m-39).

**m-34: CLOSED for the stated threat, with m-40.**
- The `require.main === module` identity check survives `process.mainModule` forgery, `-e` and `--require` (S8). The architect is right that SEC-11's path compare was forgeable.
- The patch claims object identity "cannot be forged". That holds only for Node's own loader. Re-evaluating the writer's source in-process, with no loader patching, reaches the writer, and its gates then prompt at a real terminal (S9).
- Prompts are bound and audited, so the outcome equals a child spawn: residual 25, the OWNER-10 class.

**m-35: CLOSED.** The production refusal is normative (L13). The reference registry and listen epoch defeat F2, F3 and F7 (S11). R-8 is acceptable as a stated residual. One precision gap remains: a registered fixture server can be repurposed (m-43). That is fixture-only, because production refuses fixture-class approvals.

**m-36: CLOSED.**
- The primitives-only schema, plus moving the proof into a gate-side WeakMap, removes the Buffer and Date defects.
- Nothing I relied on is weakened: the proof is still timing-safe compared, and it now cannot be serialised.
- The gate-side WeakMap needs the same uncurried capture as m-39.

**m-37: CLOSED.** The partition holds (S13). Condition: when the root is missing under a symlinked parent, both realpath and lstat give ENOENT. That case must fail the parent no-symlink rule of ADR-0030 and must not count as missing. Add it as an AC-085 row.

**m-38: CLOSED.** The 18D row at `docs/phase-18-plan.md:32` now reads `rev 10 adds` / `rev 12 adds`.

## New findings

**m-39 (Minor, 18D; conditional Major, see verdict). The captured `add`/`has` are invoked through `.call`, which is looked up live on `Function.prototype`.**
- *Evidence:* rev 12 6a.1 has `WeakSetHas.call(LEDGER_REGISTRY, v)`. AC-093 states that capture defeats monkeypatching. S5 leaks the registry on any predicate call and forges a ledger approval. That is worse than M-16, because no genuine approval is needed.
- *Remediation:*
  - Use uncurried captures. `const wsHas = Function.prototype.call.bind(WeakSet.prototype.has)`, or capture `Reflect.apply` at load.
  - Apply the same change to the gate's capability WeakMap, `SERVER_RECORDS`, and the captured net intrinsics.
  - Extend L16 so that ApprovalStore is loaded before any `tests/` module and its captures match the live natives.
  - Qualify P4 to say post-load prototype-method replacement only, and state that pre-load modification is OWNER-10 (S7).
- *Verification:* new case L17. Hook `Function.prototype.call`/`apply`/`bind` and `Reflect.apply`, before and after load, then assert predicate false and no leak. Inversion: revert to `.call` and L17 must fail.

**m-40 (Minor, 18D). The entry identity is unforgeable only under Node's loader, and the writer can be invoked directly.**
- *Evidence:* S9; S10 (`node approve-action.js` skips `falcon.js` `rejectKeyCarrierFlags` and the env allowlist).
- *Remediation:*
  - Restate 6b.2(1) as "not reachable by `require`". Re-evaluating the source is the OWNER-10 class, and the prompt audit bounds it.
  - `approve-action.js` must itself run the literal-argv allowlist and `rejectKeyCarrierFlags`, and must not trust `falcon.js` to have done so.
  - The 18F walker must treat any reference to `approve-action.js`, any `vm` or `Module.wrap` use on it, or any `_compile` reference in `tests/` as a finding.
- *Verification:* direct invocation with a key-carrier flag gives exit 1; S check for the re-evaluation patterns.

**m-41 (Minor, 18B/18C; input to R-7). The per-hop-class rules do not match SPIKE-R part 1.**
- *Evidence:* `scratchpad/spiker/findings.md`.
  - The route handler fires only for the originating request. No cell is ENFORCEABLE.
  - Events fire after the hop has been sent. 307/308 (and Chromium 301/302) carry the POST body, cross-origin included (form submit), before Falcon can observe.
  - The spike's two "UNOBSERVABLE" cells (cross-origin 307/308 `fetch`) are CORS-blocked with no transmission. That is not 6j's meaning.
- *Consequences:*
  - Rule 2's "`transmissions === 0`" can never hold at a hop, so OBSERVABLE-ONLY is in practice "abort after the body has already reached the next hop, possibly another origin".
  - Rule 4's "refuses when a hop of a refused class occurs" cannot be implemented for a class that cannot be observed.
- *What is safe on part 1 evidence (not a decision):*
  - the loopback fixture;
  - non-redirecting protected requests on routes the manifest declares non-redirecting, with any observed 3xx treated as a post-send incident (run failure, audited, documented as not prevented);
  - anything more depends on SPIKE-R part 2 (route.fetch mediation), which is UNVERIFIED.
- *Remediation:* restate rules 2 to 4 as detection, not prevention. Map spike verdicts to 6j terms. Record per cell whether the body was transmitted. Give the owner this framing for R-7.

**m-42 (Minor, 18D/18F). The AC-094 pty helper is a ready-made self-approval kit.**
- *Evidence:* the helper reads and types the challenge (6g.2). Its env allowlist strips `CI`/`GITHUB_ACTIONS`, which disables gate (ii). A pty passes the isatty syscall (S10). Any CI-run test that requires it reaches an approval with no human; only static checks and repository trust stop that.
- *Remediation:*
  - The helper refuses, before stripping, if its own process has `CI` or `GITHUB_ACTIONS` set.
  - The helper refuses any approvals root that is not under the `os.tmpdir()` root the test created.
  - The 18F walker fails if any CI-reachable module requires `pty-approve.cjs`.
  - Add a CI case: requiring the helper with `CI=true` throws.
- **R-9:** keeping the positive half local and manual is consistent with AC-084, and with the owner's "automation of the production path, not a second mechanism". The positive path stays automated, but it is not CI-gated, so regressions there are caught only by manual runs. Whether that meets the owner's intent is an owner confirmation, not just an awareness note.

**m-43 (Minor, 18D). A registered fixture server can be repurposed.**
- *Evidence:* S12. AC-092 says forwarding servers are refused, but that holds only for independently created ones.
- *Remediation:* `start()` captures its request handler. Authority construction and consume both assert that `listeners('request')` is exactly that handler and that no `connection` listener was added. Add case F14, or record this under R-8.

**m-44 (Minor, 18B). `chainDeadlineMs` is not total, and it is not fail-closed.**
- *Evidence:* NaN in gives NaN out, so a NaN deadline can never expire. `"5"` passes through string concatenation (S14).
- *Remediation:* throw (exit 18) unless every argument is a finite non-negative integer.
- *Verification:* add NaN, -1, Infinity and `"5"` rows.

**m-45 (Minor, DOC).** `docs/architecture/phase-18-rev11-patch.md:14-16` (and the ADR-0044 text at `:170`) still assert the "unforgeable private-field brand" and "a duck-typed server cannot lie" without WITHDRAWN markers. Under the m-25 prohibited-phrase rule they must be annotated, as was done for rev 9.

## Named case map (owner requirement 2)
L1-L16 and F1-F13 cover every SEC-11 (d) case. Gaps:
- L17 (m-39);
- direct-entry and re-evaluation writer cases (m-40);
- F14 (m-43);
- the CI refusal of the pty helper (m-42);
- the symlinked-parent row for AC-085 (m-37 condition);
- the non-finite deadline rows (m-44).

## Hypotheses and UNVERIFIED
- SPIKE-R part 2 (route.fetch mediation, service workers) and H-7.
- Node 24 for S1 to S14.
- H-1 and H-3.
- m-21 and m-23 stay UNVERIFIED.
- Carried open: m-24, m-26, m-27, m-28, m-30 (design).

## Verdict per PR

| PR | Blockers / majors | Merge conditions; may start? |
|---|---|---|
| 18E | 0/0 | m-37 parent-symlink row, m-29(c), m-26(b), SEC-07 conditions. May start |
| 18A | 0/0 | Unchanged. May start |
| 18C | 0/0 | SPIKE-R part 2, m-41. May start |
| 18B | 0/0 | m-27, m-31, m-41, m-44, owner R-7 decision, H-7. May start; may not merge before R-7 |
| 18D | 0/0 (m-39 conditional) | m-39, m-40, m-42, m-43, m-30, Node 24 check. May start once the owner confirms the m-39 scope ruling |
| 18F | 0/0 | m-24, walker additions (m-40, m-42), "use strict" and require-order checks |
| DOC | 0/0 | m-45, m-41 framing in `docs/pilot/limitations.md` |

## Owner items (none accepted)
- R-7, with the m-41 framing.
- The m-39 scope ruling.
- R-8 (now acceptable as a stated residual).
- R-9 confirmation.
- Residual 25.
- Every residual carried from re-reviews 6 to 10.

**Closure statement:** on `8e96c27`, Security reports **0 blockers and 0 majors**, subject to the owner's m-39 scope ruling. M-16 is closed.
