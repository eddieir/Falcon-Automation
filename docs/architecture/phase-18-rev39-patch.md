# Phase 18 rev 39 - SEC-34 minors closed: a builtin-module allowlist for MG-13, an honest supervisor and a defined literal scan

Narrow addendum on rev 38 (`1c0063a`). **Docs-only. No implementation, merge, tag, release or customer claim is authorised.** Reviewed-against: Security **SEC-34** (`docs/security/phase-18-design-review-33.md`): blockers 0, majors 0, minors m-125 to m-128. It **supersedes**: rev 38 section 2 (the MG-13 refusal list), section 3 and 3.1 and 3.2 (the supervisor text, reference source and rows), the m-120 wording of rev 38 section 3, and rev 38 section 4 m-124 (the scan pattern). `decide32.js` (sha256 `e197ec58f6084f03508cac198e21630eb31eb3f2218023c227642fb898b3a522`) and `gate37.js` (sha256 `6c6d888ae0fca2fe865fba1907e1c7235838ef34e788fb84b434f8486469a5ae`) are **unchanged**. Owner rulings in force: OWNER-24 (empty supported-browser set), no identity uncertainty may arm, worker WebSocket traffic contained or refused and not excluded from claims, FW2-C1 rejected, no other mechanism without owner review. **No new mechanism is introduced by this revision.** Wording: OBSERVED = measured; INFERENCE = unproven reasoning; REQUIREMENT = design text.

## 1. m-125 - MG-13 becomes a builtin-module allowlist, and its claim is narrowed

**REQUIREMENT (MG-13, replaces the rev 38 section 2 refusal list).** The production-entry-point reachability checker is **allowlist-shaped**, not name-based. For every file in the production require graph:

1. **Builtin modules.** A `require`/`import` of a Node builtin **fails the build unless the exact specifier appears on the per-file allowlist** in the table below. Any other builtin is refused, with no exceptions for `vm`, `inspector`, `worker_threads`, `module`, `repl`, `v8`, `node:test` or `child_process` (`child_process` is allowed in the supervisor file only, and the supervisor is not in the product require graph).
2. **Repo files.** A `require` of a repository file is allowed only if that **path plus its sha256** is on the allowlist. A content change invalidates the entry and fails the build until it is re-reviewed.
3. **Specifier form.** Every `require`/`import` specifier must be a **string literal**. Any computed or non-literal specifier (`require(name)`, `require(a + b)`, `import(expr)`, `module.createRequire(...)(expr)`) is refused, because it cannot be keyed.
4. **Refused regardless of allowlisting** (these are forms, not modules, so no allowlist entry can permit them): `eval`, `new Function` / `Function(...)`, `.constructor(...)` and `(async () => {}).constructor` / `AsyncFunction` / `GeneratorFunction` forms, `Reflect.construct` onto any function constructor, `vm.*` (`Script`, `runInContext`, `runInNewContext`, `runInThisContext`, `compileFunction`), `inspector.*` (`open`, `Session`, `Runtime.evaluate`), `new Worker(..., { eval: true })`, `module.register`, `Module._compile`, `Module.prototype._compile`, `module.constructor`, `Module._load`, `Module._extensions`, `require.extensions`, **writes to `require.cache`**, **write-then-require** (writing a file and then requiring it, including via a literal specifier), computed member access on `globalThis` / `global` / `process` (`globalThis[x]`, `global[x](...)`), `process.binding`, `process.dlopen`, `child_process` execution of `node -e` / `--eval` / `--input-type` / `--require` / `--import` / `--experimental-loader`, and `WebAssembly` instantiation of bytes that are not pinned by sha256.
5. **Enforcement point.** The checker runs in CI over the graph rooted at the production entry points and **fails the build**; it is not a runtime control.

**Allowlist (exact, for the three reviewed files):**

| File | Allowed builtins | Allowed repo requires (path + sha256) | Refused |
|---|---|---|---|
| `decide32.js` | `node:util` (for `types.isProxy`) | none | everything else |
| `gate37.js` | `node:util` | `decide32.js` @ `e197ec58f6084f03508cac198e21630eb31eb3f2218023c227642fb898b3a522` | everything else |
| `supervisor39.js` (separate parent, not in the product graph) | `node:child_process` | none | everything else |

**Claim (corrected).** This checker is **defence in depth against accidental or unreviewed inclusion of a dynamic-code path**. It is **not** a barrier against a hostile in-process attacker: code already executing in the process can rebuild any function and replace anything the gate captured, which is the stated process-integrity boundary. The word **"supply-chain"** is **withdrawn** from the rev 38 wording: the checker inspects the first-party production require graph and does not verify dependency provenance, so it does not substantiate a supply-chain claim. MG-13 is **open**: no checker exists yet (INFERENCE only that the allowlist is implementable as specified). MG-11 still cannot close without MG-13.

## 2. m-126 - the supervisor's kill claim is corrected and the survivor is measured

**Correction (REQUIREMENT, replaces the rev 38 m-120 wording).** The child runs in its own process group and at exit and at timeout the supervisor sends SIGKILL to **that process group only**. A **grandchild that calls `setsid`** (`spawn(..., { detached: true })`) leaves the group and is **out of reach of the group kill**: it can outlive the supervisor. The rev 38 sentence "no child process survives (`pgrep` count 0)" is **withdrawn**.

**OBSERVED (macOS arm64, Node 22.19.0 and 24.21.0):** row SV27 and the reused SEC-34 attacks (`gc-detached-orphan-survives`, `gc-detached-writes-DURING-run`, `gc-single-write-during-run`) each leave **1 surviving detached process** after the group SIGKILL, on both Nodes. In every case the supervisor's exit code is still **decided only from the canonical fd-3 line** (SV27: `why = verdict-refusal`, exit 18 in 3 of 3 reps on both Nodes).

**Boundary and residual.** The survivor is **inside the process-integrity boundary**: a child that can run code can spawn a detached process, and the supervisor neither claims nor can provide process-tree containment. This is **residual risk, not contained**. The supervisor's own source states this and makes no availability or "no process survives" claim.

**Owed (new row, no new mechanism claimed):** a **Linux measurement of containment by cgroup (`cgroup.kill`) or a PID namespace** in CI, showing whether a detached grandchild is reaped there; until that measurement exists, the detached-survivor residual stands on every platform. Choosing and adopting such a mechanism requires owner review and is **not** authorised by this revision.

**Test-check correction.** The `pgrep` check no longer asserts "no child survives". It now reports two separate numbers: `detachedGrandchild.observedSurvivors` (expected **>= 1**, the honest record) and `lingeringFromChildDirAfterCleanup` (expected 0, measured **after** SV27's cleanup kills the survivor **by pid**). SV27 fails if the survivor is absent, if cleanup leaves it running, or if the verdict is not `verdict-refusal`.

## 3. m-127 - the literal scan pattern is defined and tested

**REQUIREMENT (replaces rev 38 section 4 m-124).** The zero-exemption literal scan (defence in depth only) runs over **every tracked `.js`, `.cjs`, `.mjs`, `.json`, `.ts`, `.yml` and `.html` file outside `tests/` and `docs/`** and fails the build on any match of:

```
R1  /contained-for-test/
R2  /-testloader\.generated/
R3  /\b(?:module\.)?exports\s*\.\s*createGate\b/
R4  /(?:module\.exports|(?:^|[;{}\s])exports)\s*=\s*(?:[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\(\s*)?\{[^{}]*\bcreateGate\b(?!\s*\()/m
R5  /\bObject\s*\.\s*assign\s*\(\s*(?:module\.exports|exports)\b[^;]{0,400}?\bcreateGate\b/
R6  /\bObject\s*\.\s*definePropert(?:y|ies)\s*\(\s*(?:module\.exports|exports)\b[\s\S]{0,400}?createGate/
R7  /\bFW2_CONTAINED\b/        (skipped only for the production gate file itself, which owns the token)
```
Design notes: R4 matches `createGate` **in an export position with any key order** - the `[^{}]*` window stays inside one object literal, the optional call wrapper covers `Object.freeze(...)` and any alias such as `ObjectFreeze(...)`, and the `(?!\s*\()` lookahead is what keeps the **production** export line (`module.exports = ObjectFreeze({ gateDecide: createGate(CAPTURED_DECIDE, FW2_PRODUCTION_STATE) })`) clean while flagging `{ createGate }`, `{ createGate: createGate }` and `{ token: T, createGate: createGate }`. R7 catches the private token escaping the gate file.

**OBSERVED (`litscan39.js`, run on Node 22.19.0 and 24.21.0):** 26 fixtures, **18 positive / 8 negative, 26 of 26 as expected on both Nodes**, 0 failures. The same scan over the repository's **126 tracked non-test non-docs files of those extensions produced 0 hits**, so **no exemption list exists**.

| Fixture | Expected | Pattern(s) fired |
|---|---|---|
| P01 `module.exports = { createGate: createGate, FW2_CONTAINED: ... }` | flag | R4, R7 |
| P02 reordered keys (`FW2_CONTAINED` first) | flag | R4, R7 |
| P03 `module.exports = Object.freeze({ createGate })` | flag | R4 |
| P04 `Object.freeze({ token: T, createGate: createGate })` | flag | R4 |
| P05 aliased freeze `ObjectFreeze({ createGate: createGate })` | flag | R4 |
| P06 `exports.createGate = createGate` | flag | R3 |
| P07 `module.exports.createGate = ...` | flag | R3 |
| P08 `module . exports . createGate = ...` | flag | R3 |
| P09 `Object.assign(module.exports, { other: 1, createGate: ... })` | flag | R5 |
| P10 `Object.defineProperty(module.exports, 'createGate', ...)` | flag | R6 |
| P11 `Object.defineProperties(exports, { createGate: ... })` | flag | R6 |
| P12 `exports = { createGate: createGate }` | flag | R4 |
| P13 `'contained-for-test'` | flag | R1 |
| P14 `require('./gate37-testloader.generated.js')` | flag | R2 |
| P15 `FW2_CONTAINED` imported into a non-gate file | flag | R7 |
| P16 multiline exported literal, `createGate` last | flag | R4, R7 |
| P17 the real generated test loader, whole file | flag | R4, R7 |
| P18 the real sweep module, whole file | flag | R2, R7 |
| N01 the production gate export line | clean | - |
| N02 the real `gate37.js`, whole file | clean | - |
| N03 `function createGate(decideFn, fw2State) {...}` | clean | - |
| N04 internal call `createGate(CAPTURED_DECIDE, ...)` | clean | - |
| N05 `module.exports = Object.freeze({ supervise, parseVerdictLine })` | clean | - |
| N06 `'createGateway'` | clean | - |
| N07 `const FW2_PRODUCTION_STATE = 'unmeasured'` | clean | - |
| N08 the real `supervisor39.js`, whole file | clean | - |

**Claim limit (unchanged).** The scan is **defence in depth only**. The primary controls stay the behavioural export-surface assertion and the package-contents assertion; a **renamed or runtime-built** form is MG-13's job (section 1), and MG-13 has no checker yet.

## 4. m-128 - the supervisor is made honest about buffering and scrubs loader variables

- **Buffering.** `MAX_CAPTURE` was **unused**, so the "bounded buffers" comment was untrue. `MAX_CAPTURE` is **deleted** and the comment now says what the code does: stdout and stderr are drained into **byte counters and discarded** - no buffering and no capture limit, so output volume can never cause a refusal and the counters are diagnostics only. The 50 MB stderr attack and rows SV21/SV22 still behave as before.
- **Environment scrub (widened).** The child environment now drops every `NODE_*` and every `DYLD_*` variable and the exact names `LD_PRELOAD` and `LD_LIBRARY_PATH`. The rev 38 hypothesis is now **measured**: rows SV28 to SV31 set `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES` and `DYLD_LIBRARY_PATH` in the supervisor's own environment and each child reports an arm verdict **if it can see the variable**; all four give **18 in 3 of 3 reps on both Nodes**, i.e. the child does not see them. **SV32 is the control**: a non-denied variable (`FALCON_SV_CONTROL`) **is** visible to the child and yields exit 0, so the four scrub rows are not vacuous.
- **Not claimed.** Scrubbing the environment does not stop an attacker who already runs code in the child, and `DYLD_*` behaviour under macOS SIP is not characterised here. Linux `LD_*` behaviour is **unmeasured**.

### 4.1 Reference supervisor (verbatim `supervisor39.js`, sha256 `710b90454bfe184d780b98f0b4662238a920e809556f8b3b35de7e602d51195a`)

```js
'use strict';
// Reference supervisor (rev 39; m-108, m-118..m-122, m-126, m-128). The exit code seen by CI is decided by this
// SEPARATE parent. The child reports ONE canonical verdict line on an inherited pipe (fd 3).
//   * Only bytes received BEFORE the child's own exit event are considered; the pipe is destroyed at exit, so a
//     grandchild that keeps fd 3 open cannot add a verdict later (m-119).
//   * The child runs in its own process group; at exit and at timeout that GROUP is SIGKILLed, so a child ignoring
//     SIGTERM cannot extend the run (m-120). The kill reaches ONLY the child's process group: a grandchild that
//     calls setsid (spawn with detached:true) leaves the group and CAN outlive the supervisor. That survivor is
//     inside the process-integrity boundary and is residual, not contained; Linux cgroup or PID-namespace
//     containment is owed and unmeasured (m-126). This file makes no "no process survives" claim.
//   * stdout/stderr are drained into byte COUNTERS and discarded - no buffering, no capture limit, so output volume
//     can never cause a refusal and the counters are diagnostics only (m-128).
//   * The child's environment is scrubbed of every NODE_* and DYLD_* variable and of LD_PRELOAD and
//     LD_LIBRARY_PATH, and the supervisor registers a no-op SIGUSR1 handler (which suppresses the default
//     inspector activation), so a child cannot preload code into, or open the inspector of, this process (m-122).
//   * The child exit STATUS is a consistency/diagnostic aid, NOT a security control (m-118): a child able to write a
//     valid verdict before its exit hooks run is already inside the process-integrity boundary.
// Any missing, malformed, duplicated, late or inconsistent verdict, any signal or timeout => exit 18.
const { spawn } = require('node:child_process');
const REFUSAL_EXIT = 18;
const MAX_VERDICT_BYTES = 4096;
const ENV_DENY_PREFIX = ['NODE_', 'DYLD_'];
const ENV_DENY_EXACT = ['LD_PRELOAD', 'LD_LIBRARY_PATH'];
function parseVerdictLine(text) {
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length !== 1) return null;
  let v;
  try { v = JSON.parse(lines[0]); } catch (e) { return null; }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (v.armed === true) {
    return keys.length === 3 && v.exit === 0 && v.reason === 'shared_worker_absent_all_realms' ? { armed: true, exit: 0 } : null;
  }
  if (v.armed === false) {
    const okReason = v.reason === 'shared_worker_block_unverified' || v.reason === 'shared_worker_present' || v.reason === 'worker_websocket_containment_unverified';
    return keys.length === 4 && v.exit === 18 && okReason && typeof v.detail === 'string' && v.detail.length <= 256 ? { armed: false, exit: 18 } : null;
  }
  return null;
}
function isDeniedEnvName(k) {
  for (let i = 0; i < ENV_DENY_EXACT.length; i += 1) { if (k === ENV_DENY_EXACT[i]) return true; }
  for (let i = 0; i < ENV_DENY_PREFIX.length; i += 1) { if (k.indexOf(ENV_DENY_PREFIX[i]) === 0) return true; }
  return false;
}
function scrubbedEnv(base) {
  const env = {};
  for (const k of Object.keys(base)) { if (isDeniedEnvName(k)) continue; env[k] = base[k]; }
  return env;
}
// never let a child open this process's inspector: a registered SIGUSR1 handler suppresses the default activation
process.on('SIGUSR1', () => {});
function supervise(childArgs, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 20000;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'pipe', 'pipe', 'pipe'], detached: true, env: scrubbedEnv(process.env) });
    } catch (e) { resolve({ exit: REFUSAL_EXIT, why: 'spawn-error' }); return; }
    let verdictBuf = ''; let verdictOverflow = false; let exited = false; let done = false; let timedOut = false;
    let outBytes = 0, errBytes = 0;
    // kills the child's process group only; a setsid grandchild is out of reach (m-126)
    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (e2) {} } };
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); killGroup(); try { child.stdio[3].destroy(); } catch (e) {} resolve(r); };
    child.stdio[3].on('data', (d) => { if (exited) return; if (verdictBuf.length + d.length > MAX_VERDICT_BYTES) { verdictOverflow = true; return; } verdictBuf += d.toString('utf8'); });
    child.stdio[3].on('error', () => {});
    child.stdout.on('data', (d) => { outBytes += d.length; });   // counted and discarded: never a refusal cause
    child.stderr.on('data', (d) => { errBytes += d.length; });
    child.on('error', () => finish({ exit: REFUSAL_EXIT, why: 'spawn-error' }));
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
    child.on('exit', (status, signal) => {
      exited = true;                                       // bytes after this point are ignored (m-119)
      const verdict = verdictOverflow ? null : parseVerdictLine(verdictBuf);
      let r;
      if (timedOut) r = { exit: REFUSAL_EXIT, why: 'timeout' };
      else if (signal !== null) r = { exit: REFUSAL_EXIT, why: 'child-signal' };
      else if (verdict === null) r = { exit: REFUSAL_EXIT, why: 'no-valid-verdict' };
      else if (verdict.armed === true) r = status === 0 ? { exit: 0, why: 'verdict-arm' } : { exit: REFUSAL_EXIT, why: 'arm-with-nonzero-child-status' };
      else r = { exit: REFUSAL_EXIT, why: 'verdict-refusal' };
      r.childStatus = status; r.stdoutBytes = outBytes; r.stderrBytes = errBytes;
      finish(r);
    });
  });
}
module.exports = Object.freeze({ supervise: supervise, parseVerdictLine: parseVerdictLine });
```

### 4.2 Rows SV1..SV32 (`supervisor-test39.js`, sha256 `4d158eea7f1bc5a104a85f94ee5c39d2991d032de14002f530a8757082fedaab`; fixture corpus `supervisor-test.js.children.json`, sha256 `40b74b8f6ad72c5fa652333525b6da316bd34df5984b42066784886b86a1fc5f`)

SV1..SV26 are the rev 38 rows **unchanged and still required green** (listener exits 0, `prependListener`, capture callback, no-op `process.exit`, patched `reallyExit`, exit-listener `exitCode = 0`, patched `listeners`/`listenerCount`, `removeAllListeners`, throw in mapper, unhandled-rejection listener exit 0, silent exit 0 with no verdict, silent exit 0 after work, two verdict lines, extra key, arm with child status 1, SIGKILL, legitimate refusal, legitimate arm, grandchild forges after silent exit, ignores SIGTERM until timeout, large output then legitimate refusal, large output then legitimate arm, `SIGUSR1` to parent, `NODE_OPTIONS` scrubbed, arm then exit-hook status 0, oversize verdict).

| Row | Child | Required | OBSERVED Node 22.19.0 / 24.21.0 |
|---|---|---|---|
| SV1..SV26 | rev 38 corpus | per rev 38 (exit 0 only for the legitimate arm, large-output arm and the SV25 boundary case) | all as required, 3 of 3 reps, both Nodes |
| SV27 | spawns a `detached:true` (setsid) grandchild that ignores SIGTERM, writes a **legitimate refusal** on fd 3, exits 18 | exit **18**, `why = verdict-refusal`; **>= 1 detached survivor recorded**; cleanup kills it **by pid** and the post-cleanup count is 0 | 18/18/18; survivors observed **1**; after pid kill **0**; both Nodes |
| SV28 | reads `LD_PRELOAD`, arms if visible | 18 (not visible) | 18/18/18 both Nodes |
| SV29 | reads `LD_LIBRARY_PATH`, arms if visible | 18 | 18/18/18 both Nodes |
| SV30 | reads `DYLD_INSERT_LIBRARIES`, arms if visible | 18 | 18/18/18 both Nodes |
| SV31 | reads `DYLD_LIBRARY_PATH`, arms if visible | 18 | 18/18/18 both Nodes |
| SV32 | **control**: reads the non-denied `FALCON_SV_CONTROL`, arms if visible | **0** (proves env inheritance works, so SV24 and SV28..SV31 are not vacuous) | 0/0/0 both Nodes |

**OBSERVED (macOS arm64, 3 reps per row, 32 rows):** Node 22.19.0 `allOk: true`, timeout row 1505 ms, slowest row 1505 ms, whole suite 10.2 s; Node 24.21.0 `allOk: true`, timeout row 1507 ms, slowest row 1507 ms, whole suite 10.2 s. Exit 0 appears only for the four legitimate/boundary/control rows (`LEGIT-authorised-arm`, `LARGE-OUTPUT-then-legit-arm`, `VERDICT-arm-then-exit-hook-status-0`, `CONTROL-nondenied-env-is-visible`); **zero wrong exit-0 results among the bypass rows**; 0 inspector listeners on port 9229; 0 lingering processes from the child directory after SV27's pid cleanup.

**OBSERVED (SEC-34 attack corpus reused unchanged against `supervisor39.js`, both Nodes):** 50 MB stderr then arm = 0; split verdict in two writes = 0; unterminated split verdict = 18; `_debugProcess` on the parent = 18; `SIGUSR1` flood = 18; detached orphan = 18; same-group orphan = 18; detached fd-3 holder ignoring SIGTERM = 18; closed fd 3 then hang = 18; `NODE_OPTIONS` probe = 18; **0 of 300 false refusals** in the exit-versus-data race. A detached grandchild writing fd 3 **during** the run reproduced the documented boundary (exit 0, `why = verdict-arm`) in the single-write variant; the multi-write variant returned 18 in this rerun, which is timing-dependent and is **not** evidence that the boundary is closed. 1 detached survivor in each detached case (m-126).

**UNMEASURED:** Linux, CI, cgroup or PID-namespace containment of a detached grandchild, `LD_*` behaviour on Linux, `DYLD_*` under SIP, kernels where process-group kill differs, and a forged-fd-3 child before exit (the standing boundary).

## 5. Closure table for SEC-34

| Minor | Status in rev 39 | Where |
|---|---|---|
| m-125 (name-based dynamic-code list, missing forms, "supply-chain" overclaim) | **closed in the design**: MG-13 restated as a builtin-module allowlist keyed by path and sha256, the missing forms enumerated as always-refused, the claim narrowed to defence in depth, "supply-chain" withdrawn. MG-13 itself stays open (no checker). | section 1 |
| m-126 (detached grandchild outlives the group SIGKILL; `pgrep` check overclaims) | **closed in the design**: claim withdrawn, survivor measured and recorded as residual inside the process-integrity boundary, Linux cgroup / PID-namespace measurement added as owed, SV27 reproduces it and the check reports two separate numbers. | section 2, SV27 |
| m-127 (scan pattern missed `Object.freeze({createGate})`, `exports.createGate=`, reordered keys) | **closed**: R1..R7 defined and run; 18 positive and 8 negative fixtures pass on both Nodes; 126 tracked files, 0 hits, no exemptions. | section 3 |
| m-128 (`MAX_CAPTURE` unused so the "bounded buffers" comment was untrue; `LD_*`/`DYLD_*` unscrubbed) | **closed**: constant and comment removed in favour of what the code does, loader variables scrubbed, SV28..SV31 measure it and SV32 is the non-vacuity control; all 26 earlier rows still green. | section 4 |

## 6. Gates (open set unchanged)

Open and unchanged by this revision: **MG-1** (partial), **MG-4**, **MG-9**, **MG-10**, **MG-11**, **MG-12** (needs CI and Linux), **MG-13** (needs a checker; now specified as an allowlist), **MG-14**, **MG-15** (needs the wss controls), **MG-16**, **MG-17**. **FW2-C6 remains owed.** **OPEN-BID-27 remains open.** The **supported-browser set stays empty** (OWNER-24). **MG-8** (Security review) requires a review of **rev 39**; m-125 to m-128 are addressed here but MG-8 is not self-cleared by this document. New owed row added in section 2 (Linux cgroup or PID-namespace measurement). No gate is closed by this revision.

## 7. Delta versus rev 38

MG-13 refusal list replaced by a builtin-module allowlist with an exact three-file table and the "supply-chain" claim withdrawn (m-125); the process-group kill claim corrected, the detached survivor measured as residual, a Linux containment measurement added as owed, SV27 added and the `pgrep` check split into two honest numbers (m-126); the literal scan defined as R1..R7 with a 26-fixture table actually run on both Nodes (m-127); `MAX_CAPTURE` and its false comment deleted, `LD_PRELOAD`, `LD_LIBRARY_PATH` and `DYLD_*` scrubbed with rows SV28..SV31 plus the SV32 control (m-128); rows SV1..SV32 replace SV1..SV26; `supervisor39.js` replaces `supervisor38.js`. Nothing is weakened: every rev 38 row and every SEC-34 attack still gives the same result.

## 8. Still unmeasured

Everything listed in rev 38 section 7, plus: cgroup or PID-namespace containment of a detached grandchild on Linux, `LD_*` scrub behaviour on Linux, `DYLD_*` behaviour under macOS SIP, and the MG-13 allowlist checker (still does not exist).
