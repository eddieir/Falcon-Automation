# Phase 18 rev 38 - SEC-33 closed in the design: claim corrections, a hardened supervisor, and the dynamic-code refusal for MG-13

Narrow addendum on rev 37 (`c1773b7`). **Docs-only. No implementation, merge, tag, release or customer claim is authorised.** Reviewed-against: Security **SEC-33** (`docs/security/phase-18-design-review-32.md`): majors m-116 to m-118, minors m-119 to m-124. It **supersedes**: rev 37 sections 1 and 9 (the dedicated-worker wss wording), section 6 (the supervisor text and rows), section 7 CI check 3 and 4 wording, and the rev 37 gates table where stated below. `decide32.js` (sha256 prefix e197ec58) and `gate37.js` (sha256 `6c6d888ae0fca2fe865fba1907e1c7235838ef34e788fb84b434f8486469a5ae`) are **unchanged**. Owner rulings in force: OWNER-24 (empty supported-browser set), no identity uncertainty may arm, worker WebSocket traffic contained or refused and not excluded from claims, FW2-C1 rejected, no other mechanism without owner review. Wording: OBSERVED = measured; INFERENCE = unproven reasoning; REQUIREMENT = design text.

## 1. m-116 - the dedicated-worker wss claim is withdrawn

**OBSERVED (re-read of the raw NETW-02 `gapA`):** the only worker-wss case recorded is `dedicated-wss-allowed` (opened 3 of 3). The only **denied wss** result is from the **page** (`page-wss-denied`: error, 3 of 3). There is **no recorded denied `wss` from any worker**. The TLS control proved that the denied fixture's `tls_http` counter counts; it did **not** prove that `tls_ws_upgrade` counts (no control WebSocket upgrade over TLS was made from outside).

**Corrections (REQUIREMENT, replacing rev 37 sections 1 and 9 wording):** (a) "dedicated worker wss: denied ERRORED" is **withdrawn**; (b) the measured set is: allowed OPENED and denied ERRORED for dedicated, nested, blob and module worker **ws**, page **ws** and page **wss**; allowed OPENED only for dedicated worker **wss**; (c) **owed**: a denied `wss` from each worker type and a **control `wss` upgrade from outside the isolated network that raises `tls_ws_upgrade`**, so a zero on that counter becomes evidence. Until then `tls_ws_upgrade = 0` is **not** evidence of containment for worker `wss`.

## 2. m-117 - MG-13 must refuse every dynamic-code path

**OBSERVED (SEC-33):** production code can rebuild the gate source with `Module._compile` using names assembled at run time and obtain an arming gate; CI checks 1 to 4 of rev 37 do not see it.

**REQUIREMENT (MG-13, supersedes rev 37 section 7 item 4):** the production-entry-point reachability checker **fails the build** on any use, anywhere in the production require graph, of: `eval`, `new Function`, `Function(...)`, `vm.*` (`runInContext`, `runInNewContext`, `runInThisContext`, `compileFunction`, `Script`), `Module._compile`, `Module.prototype._compile`, `module.constructor`, `Module._load`, `Module._extensions`, `require.extensions`, `process.binding`, `process.dlopen`, any **computed or non-literal `require`/`import()` specifier**, `child_process` spawning of `node -e`/`--eval`/`--require`, and `WebAssembly` instantiation of non-pinned bytes. The check is **allowlist-shaped**: a use is permitted only if it is on a reviewed list keyed by file path and sha256, and the supervisor module is the only place `child_process` may appear. Because a **same-process attacker with code execution** can always rebuild code, this is **defence in depth against accidental or supply-chain inclusion**, not a barrier against hostile in-process code (the process-integrity boundary stands). MG-11 still cannot close without MG-13.

## 3. m-118..m-122 - the supervisor is hardened and its claims are narrowed

Reference text (verbatim) and rows below replace `supervisor37.js` and SV1..SV18.

- **m-118 (claim corrected).** The child **exit status is a consistency and diagnostic aid, not a security control.** OBSERVED: a child that writes a valid arm verdict and then sets its exit code to 0 in an exit hook obtains exit 0 (row SV25); that child has already written a valid verdict, so it is **inside the process-integrity boundary** and is not a bypass of a *missing* verdict. The supervisor keeps "arm with non-zero status => 18" as fail-closed behaviour and **now returns the reason (`why`) so that a test failure is distinguishable from a refusal in logs and CI output**; the numeric exit code stays 18 by contract.
- **m-119.** Only bytes received **before the child's own `exit` event** are considered; the verdict pipe is destroyed at exit; a grandchild holding fd 3 cannot add a verdict later (row SV19: grandchild forges 400 ms after a silent child exit => 18).
- **m-120.** The child runs in its **own process group**; at exit and at timeout the **whole group is SIGKILLed** (not SIGTERM). Row SV20: a child ignoring SIGTERM with a 1500 ms timeout returned at **1507 to 1510 ms** (the earlier `spawnSync` returned at 9 s on a 3 s timeout); no child process survives (`pgrep` count 0).
- **m-121.** stdout and stderr are **drained into counters and discarded**; their volume never causes a refusal (rows SV21/SV22: 2 MB of output followed by a legitimate refusal gives 18 and by a legitimate arm gives 0).
- **m-122.** The supervisor registers a `SIGUSR1` handler at module load (a registered handler suppresses inspector activation) and **scrubs the child's environment** of `NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS` and every `NODE_*` variable. Row SV23 (`SIGUSR1` to the parent): 18, **no inspector listener on port 9229** afterwards; row SV24 (`NODE_OPTIONS` preload set in the parent): the child does not see it.
- **Boundary restated.** A child that can run code and write fd 3 **before it exits** can still forge a verdict; the supervisor does not and cannot close that. The supervisor must be separate, minimal and free of product code.

### 3.1 Reference supervisor (verbatim `supervisor38.js`, sha256 `783ffda485871ae4a3127f0c7edab83729a5902d7e228021443255a52d5a6a88`)

```js
'use strict';
// Reference supervisor (rev 38; m-108, m-118..m-122). The exit code seen by CI is decided by this SEPARATE parent.
// The child reports ONE canonical verdict line on an inherited pipe (fd 3).
//   * Only bytes received BEFORE the child's own exit event are considered; the pipe is destroyed at exit, so a
//     grandchild that keeps fd 3 open cannot add a verdict later (m-119).
//   * The child runs in its own process group; at exit and at timeout the whole group is SIGKILLed, so an ignored
//     SIGTERM cannot extend the run and no orphan survives (m-120).
//   * stdout/stderr are drained into bounded buffers and never cause a refusal by overflow (m-121).
//   * The child's environment is scrubbed (NODE_OPTIONS and friends removed) and the supervisor ignores SIGUSR1,
//     so a child cannot open the supervisor's inspector (m-122).
//   * The child exit STATUS is a consistency/diagnostic aid, NOT a security control (m-118): a child able to write a
//     valid verdict before its exit hooks run is already inside the process-integrity boundary.
// Any missing, malformed, duplicated, late or inconsistent verdict, any signal or timeout => exit 18.
const { spawn } = require('node:child_process');
const REFUSAL_EXIT = 18;
const MAX_VERDICT_BYTES = 4096;
const MAX_CAPTURE = 65536;
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
function scrubbedEnv(base) {
  const env = {};
  for (const k of Object.keys(base)) {
    if (k === 'NODE_OPTIONS' || k === 'NODE_PATH' || k === 'NODE_EXTRA_CA_CERTS' || k.indexOf('NODE_') === 0) continue;
    env[k] = base[k];
  }
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
    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (e2) {} } };
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); killGroup(); try { child.stdio[3].destroy(); } catch (e) {} resolve(r); };
    child.stdio[3].on('data', (d) => { if (exited) return; if (verdictBuf.length + d.length > MAX_VERDICT_BYTES) { verdictOverflow = true; return; } verdictBuf += d.toString('utf8'); });
    child.stdio[3].on('error', () => {});
    child.stdout.on('data', (d) => { outBytes += d.length; });   // drained, bounded, discarded: never a refusal cause
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

### 3.2 Rows SV1..SV26 (`supervisor-test38.js`, sha256 `14439bba57968d970415a2bddbfed76c79103109be0505cb6dd1cecd8f9d888a`)

SV1..SV18 are the rev 37 children (listener exits 0, `prependListener`, capture callback, no-op `process.exit`, patched `reallyExit`, exit-listener `exitCode = 0`, patched `listeners`/`listenerCount`, `removeAllListeners`, throw in mapper, unhandled-rejection listener exit 0, silent exit 0 with no verdict, silent exit 0 after work, two verdict lines, extra key, arm with child status 1, SIGKILL, legitimate refusal, legitimate arm). New: **SV19** grandchild forges after silent exit; **SV20** ignores SIGTERM until timeout; **SV21** large output then legitimate refusal; **SV22** large output then legitimate arm; **SV23** `SIGUSR1` to parent; **SV24** `NODE_OPTIONS` scrubbed; **SV25** valid arm verdict then an exit hook sets status 0 (documented boundary case, exit 0); **SV26** oversize verdict (9000 bytes) => 18.

**OBSERVED (macOS arm64, Node 22.19.0 and 24.21.0, 3 reps per row):** every row gives its required exit; exit 0 appears only for SV18, SV22 and SV25 (legitimate arms and the documented boundary case); **zero wrong exit-0 results among the bypass rows**; timeout row 1507 to 1510 ms; 0 lingering child processes; 0 inspector listeners. **UNMEASURED:** Linux and CI, a forged-fd-3 child (boundary), kernels where process-group kill differs.

## 4. m-123 and m-124

- **m-123.** The NETW-01 findings banner now states that every NETW-01 measurement ran with `--no-sandbox` (see rev 37 section 2). The measuring agent's body is unchanged.
- **m-124 (the scan pattern is defined).** The zero-exemption literal scan (defence in depth only) runs over **all tracked files outside the test tree and outside `docs/`** and fails on any match of the regular expression `contained-for-test|-testloader\.generated|module\.exports\s*=\s*\{\s*createGate`. The production gate contains none of these (its private token is an object identity), so **no exemption list exists**. The primary controls remain the behavioural export-surface assertion and the package-contents assertion; a renamed or runtime-built form is the job of MG-13 (section 2).

## 5. Gates delta (supersedes the changed rows of rev 37 section 8)

MG-12: supervisor with SV1..SV26 green on both Nodes **and in CI**; status is diagnostic only. MG-13: refuses the dynamic-code set of section 2 (allowlist keyed by path and sha256). MG-15 adds: a control `wss` upgrade from outside the isolated network and a denied `wss` from every worker type (section 1). MG-8: Security review of rev 38 pending. All other rev 37 gates unchanged: MG-1 partial, MG-4, MG-7, MG-9, MG-11, MG-14, MG-16, MG-17 open; the supported-browser set stays empty.

## 6. Delta versus rev 37

m-116 claim withdrawn and a control owed; m-117 dynamic-code refusal list added to MG-13; m-118 status demoted to diagnostics with `why` reported and the boundary case recorded as SV25; m-119 to m-122 closed in the supervisor reference with rows SV19 to SV24 (observed); m-123 sandbox note added to the NETW-01 banner; m-124 pattern defined; rows SV1..SV26 replace SV1..SV18.

## 7. Still unmeasured

Everything listed in rev 37 section 10, plus: denied worker `wss` and a `tls_ws_upgrade` control (new), the supervisor on Linux and in CI, and MG-13 itself (no checker exists).
