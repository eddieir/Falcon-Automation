# Phase 18 rev 40 - SEC-35 minors closed: honest MG-13 runtime-path boundary, an extended hash-pinned scan, an environment allowlist, pipe release and a reliable detached-survivor test

Narrow addendum on rev 39 (`50020ac`). **Docs-only. No implementation, merge, tag, release or customer claim. No new mechanism.** It answers the five minors of `docs/security/phase-18-design-review-34.md` (SEC-35, m-129 to m-133): 0 blockers, 0 majors. Reference code lives in the coordinator scratch area; only the supervisor text is reproduced here, with hashes for every file.

Files and sha256 (reference code, not product code):

| File | sha256 |
|---|---|
| `supervisor40.js` | `01c1f52f2bc625ad00f759e1675f70c597259c2b16260f660531bec6cf3f404b` |
| `supervisor-test40.js` | `9c9a402d1601de31684aaed6ea17cbd6276dc52946ac1c2f76cf88aa793bc397` |
| `retention-driver.js` | `3490ffcc287efffb9c642d6b1faa2dee02f1875e287f5b929431b7413171d4f1` |
| `supervisor-test.js.children.json` (unchanged from rev 38/39) | `40b74b8f6ad72c5fa652333525b6da316bd34df5984b42066784886b86a1fc5f` |
| `litscan40.js` | `a81618b32d5edd831bded6730aeab62e68d3b02da0e0dc4ad261364a12d1bdec` |
| `mg13forms40.js` | `b6f32e3c0f7512626baed59b9a7337aca3d675eeb2961baa13945fea811f0e82` |

`gate37.js` (`6c6d888ae0fca2fe865fba1907e1c7235838ef34e788fb84b434f8486469a5ae`) and `decide32.js` (`e197ec58f6084f03508cac198e21630eb31eb3f2218023c227642fb898b3a522`) are unchanged.

## 1. m-129 - runtime builtin-loading paths: reachability measured, claim narrowed

**Root cause.** The rev 39 MG-13 allowlist keyed only on `require`/`import` specifiers. Node offers other ways to obtain a builtin that never name a specifier.

**OBSERVED (`mg13forms40.js probe`, plain child, no flags, Node 22.19.0 and 24.21.0, macOS arm64 and Linux arm64 in the pinned Playwright image):** every one of these is reachable, identically on all four runs: `process.getBuiltinModule('node:vm')` and `('node:child_process')`, `process._linkedBinding`, `process.binding('natives')`, `process.dlopen`, `module.require('vm')`, `require.main.require('node:vm')`, `process.mainModule.require('vm')`, and a computed `globalThis['Fun'+'ction']`.

**Consequence and boundary (REQUIREMENT).** These paths exist for *any code already running in the process*, so **no static allowlist is a barrier against in-process code**; that is the standing process-integrity boundary. The MG-13 allowlist therefore claims only: *accidental or unreviewed inclusion of these forms in first-party production sources fails the CI build*. It does not claim completeness, does not constrain dependencies at runtime, and a regex checker cannot follow aliasing.

**MG-13 checker rules added (REQUIREMENT, in addition to rev 39 section 1):** refuse `getBuiltinModule`, `_linkedBinding`, `process.binding`, `process.dlopen`, `module.require`, `require.main`, `process.mainModule`, `require.cache`, `module.constructor/children/parent/paths`, `module.register`, `Module._load/_resolveFilename/_extensions`, `Worker(..., {eval:true})`, any computed member access on `process`, `module`, `require`, `globalThis`, `global`, `Reflect`, `Object`, any non-literal `require`/`import()` specifier, and any alias of `process`, `module`, `globalThis` or `require`.

**OBSERVED (forms scan, `mg13forms40.js`, both Nodes and both platforms):** 32 fixtures: 22 positives each flagged by the intended rule (F1 to F8), 7 negatives clean (literal builtin require, literal `import()`, ordinary `process.on/kill/env`, `Object.freeze/keys`, and the real `gate37.js`, `decide32.js` and `supervisor40.js`), **3 documented gaps not detected** (an alias through an array element, a global fetched by a built-up name via `this`, an arbitrary loader call). Those three are why the real checker must be **AST-based**; this regex scan is a specification fixture, not the checker. MG-13 stays **open**: no checker exists.

## 2. m-130 - the literal scan is extended and its exemption is hash-pinned

**Corrections.** (a) comments are stripped before matching, so a comment before `{` no longer hides a key; (b) R4 now matches `createGate` anywhere after an `exports` assignment up to 600 characters or `;`, which covers nested objects, spreads and any key order (the rev 39 "any key order" claim is withdrawn in favour of this definition); (c) new R3 bracket form `exports['createGate']`, R8 ESM forms (`export { createGate }`, `export default ... createGate`, `export const|function|class createGate`), R9 getters and quoted keys; (d) **R7 is exempt only for the exact repository path plus sha256 of the production gate** (`EXEMPT` map); the same content under another path, or other content at that path, is flagged. The words **"zero-exemption" are withdrawn**: the rule is *one hash-pinned exemption, for R7 only*.

**Scope (corrected).** Every tracked `.js`, `.cjs`, `.mjs`, `.ts`, `.json`, `.yml` and `.html` file outside `tests/` and `docs/`.

**OBSERVED (`litscan40.js`, Node 22.19.0 and 24.21.0, macOS arm64 and Linux arm64):** 49 fixtures: **35 positives** (including bracket, comment, nested, ESM, getter, quoted-key, spread, impostor-path and changed-content cases) all flagged, **10 negatives** clean, **4 documented gaps** unflagged as documented (concatenated bracket key, key in a variable, indirection through another module, unicode-escaped identifier). The scan over the repository's **126** tracked files of those extensions gave **0 hits**.

**Claim limit.** Defence in depth only. Computed, aliased, indirect or runtime-built forms are not detected (the four gap rows); the primary controls remain the behavioural export-surface assertion and the package-contents assertion.

## 3. m-131 - the child environment is an allowlist

**Root cause.** A denylist cannot anticipate every loader or library-configuration variable (`OPENSSL_CONF` was confirmed by Security to reach the child).

**Correction (REQUIREMENT).** The child receives only: exact names `PATH, HOME, USER, LOGNAME, TMPDIR, TMP, TEMP, TZ, LANG, LANGUAGE, CI, DISPLAY, XDG_RUNTIME_DIR, XDG_CACHE_HOME, XDG_CONFIG_HOME, XDG_DATA_HOME` and prefixes `LC_, FALCON_, PLAYWRIGHT_, GITHUB_, RUNNER_`. A hard deny wins over the allowlist: prefixes `NODE_, DYLD_, LD_, OPENSSL_, GLIBC_, MALLOC_` and names `GCONV_PATH, LOCPATH, NLSPATH, TZDIR`, compared case-insensitively. **Compatibility note:** proxy, certificate and other variables (for example `HTTP(S)_PROXY`, `SSL_CERT_*`) are dropped unless added to the list; any addition is a reviewed change.

**OBSERVED (`supervisor-test40.js`, 3 reps, both Nodes, macOS arm64 and Linux arm64):** a child probe sees none of `NODE_OPTIONS, LD_PRELOAD, LD_LIBRARY_PATH, DYLD_INSERT_LIBRARIES, DYLD_LIBRARY_PATH, OPENSSL_CONF, LD_AUDIT, GLIBC_TUNABLES, GCONV_PATH, MALLOC_PERTURB_, MALLOC_CHECK_` or an unlisted `SV_UNLISTED_VARIABLE`, and does see the allowlisted `FALCON_SV_CONTROL` (control, exit 0).

**Limits.** These are **presence** tests: they prove the variables are not passed, not what each variable would do to a child. Behavioural effects of `LD_*`, `GLIBC_TUNABLES`, `GCONV_PATH` and `MALLOC_*` on Linux, and Windows environment handling, are **unmeasured** and any such claim stays open. The supervisor's own environment is not scrubbed (it is the trusted parent).

## 4. m-132 - the supervisor no longer waits for a detached grandchild's pipes

**Root cause (OBSERVED).** `child.stdout`/`stderr` pipes inherited by a detached grandchild kept the supervising process alive after the verdict was decided: a driver that never calls `process.exit` took **5.1 s** (the grandchild's lifetime) with `supervisor39.js`.

**Correction.** At decision time the supervisor destroys the child's stdout, stderr and fd-3 pipes and calls `child.unref()`. The caller must still pass the returned code to `process.exit`; **no process-containment claim is added** (the detached survivor remains residual, section 5).

**OBSERVED (`retention-driver.js`, 3 reps per supervisor and Node):** `supervisor39.js` (control) wall time 5086 to 5239 ms on macOS and 5103 to 5285 ms on Linux; `supervisor40.js` **37 to 235 ms**. The verdict and exit code are unchanged (`verdict-refusal`, 18).

## 5. m-133 - SV27 uses real process identity and checks every rep

**Root cause.** The rev 39 row took the maximum over reps, cleaned up on the last rep only, checked `why` on rep 0 only, and identified survivors with `pgrep -f`, which on Linux also matches the `sh` wrapper.

**Correction.** The child writes the pid returned by `spawn` to a per-rep pidfile and passes a unique per-rep marker in argv. Identity comes from `kill(pid, 0)` plus `ps -o stat=, command=, pgid=`: **dead** (ESRCH or zombie), **alive-verified** (command contains the marker *and* pgid equals pid, i.e. a `setsid` leader), otherwise **identity-uncertain**, which is never a pass. Every rep must give `why = verdict-refusal`, exit 18, `alive-verified` before cleanup and `dead` after the pid kill (polled up to 2 s). `pgrep -f` and the "lingering from the child directory" count are removed; no general "nothing lingers" claim is made.

**OBSERVED:** 3 of 3 reps `alive-verified` then `dead` on both Nodes, macOS arm64 and Linux arm64 (the container has no init reaper, so zombies were exercised and counted as dead).

## 6. Test results

| Suite | Node 22.19.0 mac | Node 24.21.0 mac | Node 22.19.0 Linux arm64 | Node 24.21.0 Linux arm64 |
|---|---|---|---|---|
| Supervisor (38 rows plus retention probe) | allOk | allOk | allOk | allOk |
| Literal scan (49 fixtures) | allOk | allOk | allOk | allOk |
| MG-13 forms (32 fixtures + reachability) | allOk | allOk | allOk | allOk |
| SEC-34 attack corpus (11 rows, 0/300 race) | 0 mismatches | 0 mismatches | not run | not run |

Timeout row 1510 to 1553 ms; 0 inspector listeners. The single-write detached fd-3 variant still exits 0 (the documented boundary). **Linux x64 and the GitHub runner are not measured** (arm64 Docker Desktop only).

## 7. Closure table for SEC-35

| Finding | Status |
|---|---|
| m-129 (`getBuiltinModule` and sibling paths) | **closed as a claim correction**: paths measured reachable; allowlist claim narrowed; forms rules specified and fixture-tested; checker unbuilt (MG-13 open) |
| m-130 (scan forms; basename exemption; "zero-exemption") | **closed in the design**: R3, R4, R8, R9 extended, comments stripped, hash-pinned exemption, wording withdrawn; four gaps documented |
| m-131 (`OPENSSL_CONF`, `LD_AUDIT`, `GLIBC_TUNABLES`, `GCONV_PATH`, `MALLOC_*`) | **closed in the design** by allowlist; presence verified on macOS and Linux arm64; behavioural effects unmeasured |
| m-132 (pipe retention) | **closed**: 5.1 s to under 0.25 s, measured on both platforms |
| m-133 (SV27 reliability) | **closed**: per-rep identity checks, no `pgrep -f` |

## 8. Gates (open set unchanged)

**MG-1** (partial), **MG-4**, **MG-9**, **MG-10**, **MG-11**, **MG-12**, **MG-13** (no checker; AST-based needed), **MG-14**, **MG-15**, **MG-16**, **MG-17**, the FW2-C6 measurements C6-O1 to O7, OPEN-BID-27, Linux x64 and runner parity, and an empty supported-browser set. MG-8 is cleared only by Security after this revision.

## 9. Reference supervisor (verbatim `supervisor40.js`)

```js
'use strict';
// Reference supervisor (rev 40; m-108, m-118..m-122, m-126, m-128, m-131, m-132). The exit code seen by CI is decided by this
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
//   * The child's environment is built from an ALLOWLIST (m-131): only the exact names and prefixes below are
//     passed, and a hard deny (NODE_, DYLD_, LD_, OPENSSL_, GLIBC_, MALLOC_ prefixes and GCONV_PATH, LOCPATH,
//     NLSPATH, TZDIR) wins even over an allowlisted name. Everything else, including variables nobody has thought
//     of yet, is dropped. The supervisor also registers a no-op SIGUSR1 handler (which suppresses the default
//     inspector activation), so a child cannot open the inspector of this process (m-122).
//   * When the supervisor decides it destroys the child's stdout, stderr and fd-3 pipes and unrefs the child, so a
//     detached grandchild that still holds them cannot keep THIS process alive (m-132). The caller must still pass
//     the returned exit code to process.exit; no process-containment claim is made.
//   * The child exit STATUS is a consistency/diagnostic aid, NOT a security control (m-118): a child able to write a
//     valid verdict before its exit hooks run is already inside the process-integrity boundary.
// Any missing, malformed, duplicated, late or inconsistent verdict, any signal or timeout => exit 18.
const { spawn } = require('node:child_process');
const REFUSAL_EXIT = 18;
const MAX_VERDICT_BYTES = 4096;
const ENV_ALLOW_EXACT = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'TZ', 'LANG', 'LANGUAGE', 'CI', 'DISPLAY', 'XDG_RUNTIME_DIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'];
const ENV_ALLOW_PREFIX = ['LC_', 'FALCON_', 'PLAYWRIGHT_', 'GITHUB_', 'RUNNER_'];
const ENV_DENY_PREFIX = ['NODE_', 'DYLD_', 'LD_', 'OPENSSL_', 'GLIBC_', 'MALLOC_'];
const ENV_DENY_EXACT = ['GCONV_PATH', 'LOCPATH', 'NLSPATH', 'TZDIR'];
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
function startsWithAny(k, list) {
  for (let i = 0; i < list.length; i += 1) { if (k.indexOf(list[i]) === 0) return true; }
  return false;
}
function isDeniedEnvName(k) {
  const u = k.toUpperCase();
  for (let i = 0; i < ENV_DENY_EXACT.length; i += 1) { if (u === ENV_DENY_EXACT[i]) return true; }
  return startsWithAny(u, ENV_DENY_PREFIX);
}
function isAllowedEnvName(k) {
  for (let i = 0; i < ENV_ALLOW_EXACT.length; i += 1) { if (k === ENV_ALLOW_EXACT[i]) return true; }
  return startsWithAny(k, ENV_ALLOW_PREFIX);
}
function scrubbedEnv(base) {
  const env = {};
  for (const k of Object.keys(base)) { if (isDeniedEnvName(k) || !isAllowedEnvName(k)) continue; env[k] = base[k]; }
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
    const finish = (r) => {
      if (done) return; done = true; clearTimeout(timer); killGroup();
      try { child.stdio[3].destroy(); } catch (e) {}
      try { child.stdout.destroy(); } catch (e) {}      // a grandchild holding these pipes must not keep us alive (m-132)
      try { child.stderr.destroy(); } catch (e) {}
      try { child.unref(); } catch (e) {}
      resolve(r);
    };
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
module.exports = Object.freeze({ supervise: supervise, parseVerdictLine: parseVerdictLine, scrubbedEnv: scrubbedEnv });
```
