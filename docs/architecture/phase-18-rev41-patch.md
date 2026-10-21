# Phase 18 rev 41 - SEC-36 findings closed: an AST scanner replaces the regex scan, an explicit environment allowlist, tri-state process identity and fresh Linux evidence

Narrow addendum on rev 40 (`a17fb79`). **Docs-only. No implementation, merge, tag, release or customer claim.** It answers `docs/security/phase-18-design-review-35.md` (SEC-36): REJECT, 1 major (m-134) and minors m-135 to m-138. The regex scan of rev 39/40 (R1 to R9, `litscan40.js`) and the regex forms scan (`mg13forms40.js`) are **withdrawn**; the AST scanner below replaces both. Reference code lives in the coordinator scratch area; the supervisor text is reproduced in section 9 and every file is hashed.

| File | sha256 |
|---|---|
| `supervisor41.js` | `452a549aff6a9549a8599c113bd7f473e3ab7150b9f64722fc4054eeea8eb432` |
| `supervisor-test41.js` | `705ef4cd29d57c5241042a76a0e79888469403a48dc393b6f584bb1ec5d470d8` |
| `identify41.js` | `01af8b50a995c53ca65862e9d8ed3645e5bdc0f9ad1b1ebbe743fe3b5ce383b7` |
| `retention-driver.js` | `ecad7947219fe35f550bbfeab33402a63aaa32579c7690ff382a52aacd517168` |
| `scan41.js` | `9894d670dea8a605856413bd731b51bc991c4e6d314a82332e9bf55b76bdbc1b` |
| `scan41-test.js` | `491de211e10296bb04e38992fc197afac1f124d3deea595c7ac744192eb67c3c` |
| `sec36-adapter.js` | `310bc37927b646d973de6894c2501bc4579682afcf33a8e0ee7543b09364ebbf` |
| `supervisor-test.js.children.json` | `40b74b8f6ad72c5fa652333525b6da316bd34df5984b42066784886b86a1fc5f` |

Parser: the Babel parser bundled in the already-installed Playwright 1.64.0 (`node_modules/playwright/lib/transform/babelBundle.js`, sha256 `cd656ca6a9857b3efbbb7e015a2fa3abd4bc0e88956661cc9b14d9d7f142f093`), loaded by path with **no new dependency**. The scanner refuses to run (`parser-identity-mismatch`) if that file's hash differs from the pin, so a Playwright upgrade forces a reviewed re-pin. This is an undocumented internal path of a pinned dependency; adding a pinned parser package (for example `@babel/parser`) at implementation time is an **owner decision** (section 10). `gate37.js` (`6c6d888ae0fca2fe865fba1907e1c7235838ef34e788fb84b434f8486469a5ae`) and `decide32.js` (`e197ec58f6084f03508cac198e21630eb31eb3f2218023c227642fb898b3a522`) are unchanged.

## 1. m-134 - the literal scan becomes a parser-based scanner with a stated contract

**Root cause.** Regexes over comment-stripped text cannot tell strings, comments and syntax apart, and cannot enumerate export forms; rev 40's coverage claim was false (19 literal misses, string-hidden keys, altered repository text).

**Contract (REQUIREMENT).** `scan41.js` is **syntactic detection over a parsed tree, not runtime enforcement**. It makes no claim about arbitrary-code containment. Every in-scope file ends in exactly one status; **only CLEAN passes**, the other four are visible build failures:

| Status | Meaning |
|---|---|
| CLEAN | parsed and no rule fired |
| FINDING | a rule fired |
| UNRESOLVED | the file could not be decided (computed key, exports object aliased or passed to a call, `export *`, `Object.defineProperty(module, ...)`) |
| PARSE_FAIL | script and module parse both failed, malformed JSON, or an unbound ESM export; never reported clean |
| UNSUPPORTED | extension outside the table; `.tsx` and `.jsx` are unsupported until a reviewed addition |

Scope and handling by type: `.js .cjs .mjs .ts .mts .cts` are parsed (script first, module second, TypeScript syntax by extension); `.json` is parsed as data and its keys and strings checked for the tokens and the name; `.yml .yaml .html` are text-checked for the tokens and the name (any mention is a finding, since they cannot export). Tracked files outside `tests/` and `docs/` with these extensions: **126** in this repository. Comments are not stripped; they are simply not code, so a token inside a comment is not a finding and a string containing `//` or `/*` hides nothing.

**Rules (AST patterns).** Tokens (strings, template parts, regex patterns, identifiers, keys): `R1` `contained-for-test`, `R2` `-testloader.generated`, `R7` `FW2_CONTAINED`. Name `createGate` (static keys fold string concatenation and constant templates, and unicode-escaped identifiers are decoded by the parser):
- **E1** assignment into `exports`, `module.exports` or top-level `this` (member or bracket, any depth), with the assigned value inspected.
- **E2** `exports = X`, `module.exports = X` and TypeScript `export = X`: `X` is inspected through calls, spreads, nested objects, arrow and function bodies, class members (method, static, accessor, property) and same-file bindings to depth 4.
- **E3** ESM: named declarations and specifiers (including `as` renames, re-export `from`, `as default`), `export default` values; `export *` is UNRESOLVED.
- **E4** `Object.assign/defineProperty/defineProperties/setPrototypeOf` and `Reflect.set/defineProperty` on the exports object; `module` itself mutated is UNRESOLVED.
- **E6** the exports object aliased (`const e = module.exports`) or passed to a call: UNRESOLVED.
- **E7** any assignment to a member named `createGate` on any object (covers a property set on an exported function).
A call `createGate(...)` is a use, not an export. Computed keys that cannot be folded are UNRESOLVED.

**R7 exemption (kept, narrowed).** R7 is skipped only for the **exact path string and sha256** in `EXEMPT_R7` (the reference `gate37.js` at `src/core/gate.js`); the same content under another path, other content at that path, and other spellings of the path (`./src/core/gate.js`, `src/core/../core/gate.js`, different case) are **not** exempt. Callers must pass repository-relative paths exactly as `git ls-files` prints them. No other rule has an exemption, and the exempt file must still be CLEAN for E1 to E7.

**Blind spots (stated, tested as CLEAN).** The scan does not follow values from imports or parameters (each tracked file is scanned on its own, so the module that defines the name is flagged where it exports it); values read by computed name from another object (`lib[name]`), delegation (`module.exports = require('./other.js')`), `Object.assign(module.exports, imported)`, and a `Proxy` over an imported target are not detected. Runtime-built code (`eval`, `Function`, `vm`) is the MG-13 forms rules, not this scan. Same-file binding resolution stops at depth 4.

**OBSERVED (`scan41-test.js`, Node 22.19.0 and 24.21.0, macOS arm64 and Linux arm64):** 94 export fixtures, 0 failures: 63 FINDING (every SEC-36 form: method shorthand, async method, inline and bound class static, `Reflect.set`, `Reflect.defineProperty`, TypeScript `export =`, top-level `this`, semicolon inside the expression, key more than 1500 properties after the assignment, `/*` and `//` inside strings, template and concatenated keys, unicode-escaped identifiers, BOM with CRLF, ESM renames and re-exports, impostor path and changed content), 7 UNRESOLVED, 18 CLEAN (14 negatives plus 4 documented blind spots), 4 PARSE_FAIL (malformed JavaScript, unbound ESM export, malformed JSON, binary garbage) and 2 UNSUPPORTED. The parser-pin mismatch throws. **The SEC-36 bypass corpus (`sec36/litbypass.js`, 20 forms) is run unchanged: 0 missed, 20 flagged on all four runs.** The repository scan: **126 of 126 files CLEAN**.

## 2. m-135 - `process.execve` measured and added to the MG-13 forms

**OBSERVED (`scan41-test.js probe`, plain child, no flags; all four runs):** `process.execve` is a function on Node 22.19.0 and 24.21.0. A failing call (nonexistent path) is **not catchable**: the process aborts (SIGABRT, status null) despite a surrounding `try/catch`. A successful call **replaces the process image** without `child_process` (a child that calls `process.execve('/bin/echo', ...)` printed the replacement output and exited 0). All the rev 40 paths are still reachable.

**Correction.** The MG-13 forms are now evaluated on the AST (`scan41.js forms()`): banned members `getBuiltinModule, _linkedBinding, dlopen, execve, mainModule, _load, _resolveFilename, _extensions, _compile, _cache`, `process.binding`, `module.require/constructor/children/parent/paths/register`, `require.main/cache`, computed non-literal access on `process, module, require, globalThis, global, Reflect`, `eval`, `Function`, `.constructor(...)`, `Reflect.construct`, `Worker(..., {eval})`, non-literal `require`/`import()`, aliasing or passing of `process/module/globalThis/global/require`, and a **per-file specifier allowlist** (a builtin or package specifier not listed is a finding; repo-relative requires are listed for hash pinning by the checker). Boundary unchanged: these paths are reachable to any code already running, so this is defence in depth against accidental inclusion, not a barrier.

**OBSERVED:** 41 forms fixtures, 0 failures: 29 positives (including `execve`, banned names after strings containing `//` and `/*`, destructuring, aliasing through an array element and a call argument), 9 negatives (allowlisted builtin, ordinary `process.on/kill/env`, names only in comments and strings, repo-relative require, and the real `gate37.js`, `decide32.js` and `supervisor41.js`), 3 documented gaps (a global fetched by a built-up name via `this`, an arbitrary loader call, a value returned by a function). MG-13 stays **open**: no CI checker exists.

## 3. m-136 - process identity has three states

`identify41.js` returns **dead** (ESRCH or zombie), **alive-verified** (marker in the command and process group equal to the pid) or **unknown** (EPERM, `ps` missing or failing while the pid is still signalable, empty or unparsable output, marker absent, pgid differs). Unknown is never a pass and never dead; `waitDead` keeps polling and the row fails if the state is still unknown. 12 unit rows inject `kill` and `ps` to exercise every branch (including `ps` missing while alive, `ps` status 1 while alive, and a pid that disappears between the two checks).

## 4. m-137 - Linux evidence from a fresh directory

The Linux runs wrote into a **newly created directory** (`rev41-out-linux-<time>`), one file per suite, per Node, with its own exit-code file. All 10 exit codes are 0 and all stderr files are 0 bytes. The rev 40 Linux scan stderr files (a `git ls-files` failure from the first container attempt) are **retained unmodified** under `rev40-out/` for investigation and are not used as evidence. Environment: Docker 28.5.2 on Docker Desktop, image `mcr.microsoft.com/playwright@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f` (Ubuntu 24.04.5, `aarch64`), Node 24.21.0 from the image and Node 22.19.0 linux-arm64 mounted, run as root without an init reaper. **This is Linux arm64 only: not Linux x64 and not the GitHub-hosted runner.**

## 5. m-138 - the child environment is an explicit per-variable allowlist

**Root cause (OBSERVED in the repository).** The `FALCON_` prefix group would have passed `FALCON_LLM_API_KEY`, and `GITHUB_*` would have passed `GITHUB_TOKEN` and `GITHUB_ENV`.

**Correction (REQUIREMENT).** `supervisor41.js` passes only these 14 names: `PATH, HOME, TMPDIR, TMP, TEMP, TZ, LANG, LANGUAGE, LC_ALL, LC_CTYPE, CI, HEADLESS, BROWSER, PLAYWRIGHT_BROWSERS_PATH`. There are no prefix groups; `DISPLAY`, `XDG_*`, `USER`, `LOGNAME`, `GITHUB_*`, `RUNNER_*`, `FALCON_*`, proxy and certificate variables are dropped, and each addition is a reviewed change. The hard deny (prefixes `NODE_ DYLD_ LD_ OPENSSL_ GLIBC_ MALLOC_`; names `GCONV_PATH LOCPATH NLSPATH TZDIR`) still wins. Values are validated: no NUL, at most 4096 characters; `HOME TMPDIR TMP TEMP PLAYWRIGHT_BROWSERS_PATH` must be absolute (the browsers path may also be the literal `0`); `PATH` loses relative and empty entries and is dropped if none remain.

**OBSERVED (3 reps, both Nodes, macOS and Linux arm64):** child probes see none of `FALCON_LLM_API_KEY, FALCON_SV_CONTROL, GITHUB_TOKEN, GITHUB_ENV, PLAYWRIGHT_DOWNLOAD_HOST, OPENSSL_CONF, LD_AUDIT, GLIBC_TUNABLES, GCONV_PATH, MALLOC_*, NODE_OPTIONS, LD_PRELOAD, LD_LIBRARY_PATH, DYLD_*`; the allowlisted `TZ` is seen (control). 12 `scrubbedEnv` unit rows cover path validation, NUL, oversize, prefix groups, deny precedence and case.

**Windows.** Name comparison is case-insensitive when the platform is `win32` and that code path is covered **only by unit rows with the platform injected**. There was **no Windows run**: no Windows claim is made, and variables Windows needs (for example `SystemRoot`) are dropped, so Windows support is out of scope until measured. Behavioural effects of the denied variables remain unmeasured (presence tests only).

## 6. Test results

| Suite | Node 22.19.0 macOS arm64 | Node 24.21.0 macOS arm64 | Node 22.19.0 Linux arm64 | Node 24.21.0 Linux arm64 |
|---|---|---|---|---|
| Supervisor (41 process rows plus the pipe-retention probe) | 41 rows, allOk | 41 rows, allOk | 41 rows, allOk | 41 rows, allOk |
| Unit rows (`scrubbedEnv`, `identify`) | 24 of 24 | 24 of 24 | 24 of 24 | 24 of 24 |
| Scanner (94 export + 41 forms fixtures, 126-file repo scan) | allOk | allOk | allOk | allOk |
| SEC-36 bypass corpus (20) | 0 missed | 0 missed | 0 missed | 0 missed |
| SEC-34 attack corpus (11 rows, race 0/300) | 0 mismatches | 0 mismatches | 0 mismatches | 0 mismatches |

Pipe retention (m-132, rev 40 behaviour re-verified): control `supervisor39.js` 5.09 to 5.27 s, `supervisor41.js` 37 to 251 ms. Timeout row 1507 to 1564 ms; 0 inspector listeners. The single-write detached fd-3 variant still exits 0 (the documented boundary); the `atk3` harness still counts survivors with `pgrep -f` and reports 1 on macOS and 2 on Linux (the shell wrapper), which is why SV27 uses `identify` and not that harness. Unaffected earlier cases (gate and decision function) were not re-run.

## 7. Closure table for SEC-36

| Finding | Status |
|---|---|
| m-134 (scan claim false, comment stripping) | **closed in the design**: parser-based scanner with a stated contract, failure behaviour and blind spots; 94 fixtures plus the 20-form SEC-36 corpus; regex scans withdrawn |
| m-135 (`process.execve`) | **closed**: measured and added to the AST forms |
| m-136 (`ps` failure as dead) | **closed**: tri-state with unit rows |
| m-137 (stale Linux artifacts) | **closed**: fresh directory, exit codes and empty stderr recorded; old files retained |
| m-138 (`GITHUB_*` / `PLAYWRIGHT_*` / `FALCON_*`) | **closed in the design**: explicit 14-name allowlist, value validation; Windows unmeasured |

## 8. Gates (open set unchanged)

**MG-1** (partial), **MG-4**, **MG-9**, **MG-10**, **MG-11**, **MG-12**, **MG-13** (no CI checker exists; this scanner is the reference), **MG-14**, **MG-15**, **MG-16**, **MG-17**, the FW2-C6 measurements C6-O1 to O7, OPEN-BID-27, Linux x64 and runner parity, Windows, and an empty supported-browser set. MG-8 is cleared only by Security after this revision.

## 9. Reference supervisor (verbatim `supervisor41.js`)

```js
'use strict';
// Reference supervisor (rev 41; m-108, m-118..m-122, m-126, m-128, m-131, m-132, m-138). The exit code seen by CI is decided by this
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
//   * The child's environment is an EXPLICIT per-variable allowlist (m-131, m-138): only the names in ENV_ALLOW are
//     passed, with no prefix groups, so FALCON_LLM_API_KEY, GITHUB_TOKEN, GITHUB_ENV and every other secret-bearing or
//     loader variable is dropped. A hard deny (NODE_, DYLD_, LD_, OPENSSL_, GLIBC_, MALLOC_ prefixes and GCONV_PATH,
//     LOCPATH, NLSPATH, TZDIR) wins even over an allowlisted name, and values are validated: no NUL, bounded length;
//     path variables must be absolute and PATH loses relative and empty entries. The supervisor also registers a
//     no-op SIGUSR1 handler (which suppresses the default inspector activation), so a child cannot open the
//     inspector of this process (m-122).
//   * When the supervisor decides it destroys the child's stdout, stderr and fd-3 pipes and unrefs the child, so a
//     detached grandchild that still holds them cannot keep THIS process alive (m-132). The caller must still pass
//     the returned exit code to process.exit; no process-containment claim is made.
//   * The child exit STATUS is a consistency/diagnostic aid, NOT a security control (m-118): a child able to write a
//     valid verdict before its exit hooks run is already inside the process-integrity boundary.
// Any missing, malformed, duplicated, late or inconsistent verdict, any signal or timeout => exit 18.
const { spawn } = require('node:child_process');
const REFUSAL_EXIT = 18;
const MAX_VERDICT_BYTES = 4096;
const MAX_VALUE = 4096;
// each name is individually justified: PATH to find tools; HOME and TMPDIR/TMP/TEMP for browser profile and temp files;
// TZ, LANG, LANGUAGE, LC_ALL, LC_CTYPE for locale; CI for CI behaviour; HEADLESS and BROWSER (documented in .env.example)
// for browser launch; PLAYWRIGHT_BROWSERS_PATH for the browser location. Anything else needs a reviewed addition.
const ENV_ALLOW = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'TZ', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'CI', 'HEADLESS', 'BROWSER', 'PLAYWRIGHT_BROWSERS_PATH'];
const ENV_ABSOLUTE_PATH = ['HOME', 'TMPDIR', 'TMP', 'TEMP', 'PLAYWRIGHT_BROWSERS_PATH'];
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
const isAbsolute = (v, platform) => (platform === 'win32' ? /^(?:[A-Za-z]:[\\/]|\\\\)/.test(v) : v.charAt(0) === '/');
// platform defaults to the running platform; the argument exists so the key and path logic is unit-testable. On win32
// names compare case-insensitively (the code path is exercised only by unit tests; no Windows run is claimed).
function scrubbedEnv(base, platform) {
  const plat = platform || process.platform;
  const env = {};
  for (const k of Object.keys(base)) {
    const name = plat === 'win32' ? k.toUpperCase() : k;
    if (isDeniedEnvName(k) || ENV_ALLOW.indexOf(name) < 0) continue;
    const v = base[k];
    if (typeof v !== 'string' || v.length > MAX_VALUE || v.indexOf('\u0000') >= 0) continue;
    if (ENV_ABSOLUTE_PATH.indexOf(name) >= 0 && !(name === 'PLAYWRIGHT_BROWSERS_PATH' && v === '0') && !isAbsolute(v, plat)) continue;
    if (name === 'PATH') {
      const sep = plat === 'win32' ? ';' : ':';
      const kept = v.split(sep).filter((e) => e.length > 0 && isAbsolute(e, plat));
      if (kept.length === 0) continue;
      env[plat === 'win32' ? k : name] = kept.join(sep); continue;
    }
    env[k] = v;
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

## 10. Owner decisions

None are needed to close the findings. For the implementation phase: whether the checker depends on the Playwright-bundled parser (pinned by hash) or on an added pinned parser package.
