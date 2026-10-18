# Phase 18 — H8 findings: Node 24.21.0 facts vs Node 22.19.0

Status: OWNER-AUTHORIZED READ-ONLY MEASUREMENT. This document records
observed facts from a single macOS host comparing Node 24.21.0 against
Node 22.19.0. It is evidence, not an implementation and not an authorisation
to implement. No product code was changed, no tracked file other than this
one was written, and no commit/push/tag/merge was performed as part of this
measurement.

## Scope and inputs

- Base revision: `f9ca928` on `docs/phase-18-architecture`.
- Design inputs referenced: O-1 (CLI exit/stderr behaviour, see
  `docs/architecture/phase-18-rev21-patch.md` section B and the rev22
  patch), hypothesis H-8 (Node 24 facts), and the `src/core/history/GitInfo.js`
  child_process shape.
- Node 24 binary: `node-v24.21.0-darwin-arm64` at the owner-provided scratch
  path (npm 11.19.0), checksum-verified by the coordinator before this task
  started. Node 22 binary: the host default, `v22.19.0` / npm `10.9.3`
  (`nvm`-managed).
- Host: macOS (Darwin 25.5.0), arm64. **All results below are macOS
  arm64 results.** CI runs Node 24.21.0 on Linux x64 (ubuntu); that path is
  UNOBSERVED here (see "Not measured").
- Repo Playwright: `1.64.0` (`node_modules/playwright/package.json`,
  `node_modules/playwright-core/package.json`). Bundled Chromium
  (`node_modules/playwright-core/browsers.json`): revision `1248`,
  `browserVersion` `156.0.8078.4` ("Chrome for Testing").
- Harness scripts (scratch only, not committed):
  `h8/versions.js`, `h8/fsharness.js` (copy of the SPIKE-FS harness),
  `h8/childproc.js`, `h8/exitstderr.js`, `h8/babelcheck.js`.

## 1. Versions (OBSERVED FACT)

Command: `node h8/versions.js` run with each binary.

| Property | Node 22.19.0 (macOS arm64) | Node 24.21.0 (macOS arm64) |
|---|---|---|
| `process.version` | v22.19.0 | v24.21.0 |
| V8 | 12.4.254.21-node.29 | 13.6.233.17-node.53 |
| npm | 10.9.3 | 11.19.0 |
| platform/arch | darwin/arm64 | darwin/arm64 |
| Playwright (repo) | 1.64.0 (same install, both runs) | 1.64.0 (same install, both runs) |
| Chromium (repo) | 156.0.8078.4, rev 1248 (same install) | 156.0.8078.4, rev 1248 (same install) |

Observed fact: Playwright/Chromium versions are identical because both Node
binaries read the same `node_modules` tree; this is not evidence that
Playwright's Chromium launches correctly under Node 24 (see "Not measured").

## 2. Filesystem behaviour (OBSERVED FACT, macOS APFS only)

Command: `node h8/fsharness.js h8/fsroot` run with each binary, same
scratch root (`h8/fsroot`, APFS, device matches repo volume, `statfs.type`
= `26`).

| Check | Node 22.19.0 | Node 24.21.0 |
|---|---|---|
| `O_EXCL` single create (second attempt `EEXIST`) | PASS | PASS |
| `O_EXCL` 20-way contention (1 winner, 19 `EEXIST`) | PASS (1/19/0) | PASS (1/19/0) |
| Atomic same-dir rename | PASS | PASS |
| File `fsync` (`fs.fsyncSync`, maps to POSIX `fsync(2)`) | PASS | PASS |
| Directory `fsync` (open dir, fsync fd) | PASS | PASS |
| Lock-file visibility across processes | PASS | PASS |
| Symlink: `lstat` detects link | PASS | PASS |
| Symlink: `O_NOFOLLOW` open refused (`ELOOP`) | PASS | PASS |
| Symlink swap observable via `lstat` | PASS | PASS |
| Permissions: `0600` file / `0700` dir honoured under restrictive umask | PASS | PASS |
| SIGKILL leaves partial `.tmp`, no final/renamed file created | PASS | PASS |
| `fs.statfsSync(dir).type` | `26` (APFS) | `26` (APFS) |

Observed fact: every filesystem property measured is identical between
Node 22.19.0 and Node 24.21.0 on this host/volume; Node's libuv-backed `fs`
layer shows no version-dependent behaviour here. Darwin `F_FULLFSYNC`
(true durability barrier) was **NOT MEASURED** under either version — Node
does not expose `fcntl(F_FULLFSYNC)` without a native addon, which this
spike did not add (same limitation recorded in the earlier SPIKE-FS run).

## 3. child_process and AST-checker behaviour (OBSERVED FACT)

Command: `node h8/childproc.js` run with each binary.

| Check | Node 22.19.0 | Node 24.21.0 |
|---|---|---|
| Default-parameter function reference (`exec = childProcess.execFileSync`, mirrors `GitInfo.js`) behaves identically to an explicit call | PASS (`git version 2.50.1`) | PASS (`git version 2.50.1`) |
| `execFileSync` literal argv, `shell:false` (default) | PASS | PASS |
| `execFileSync` on a nonexistent binary → `ENOENT` | PASS (`code=ENOENT`, `errno=-2`) | PASS (`code=ENOENT`, `errno=-2`) |
| `spawnSync` literal argv, `shell:false`, exit code propagation | PASS (`status=3`) | PASS (`status=3`) |
| `execFile` (async) on a nonexistent binary → `ENOENT` | PASS | PASS |
| `spawn`/`spawnSync` with `shell:true` and a non-empty `args` array | PASS (runs; status 0) | PASS (runs; status 0) **and emits `DEP0190` DeprecationWarning** |
| `DEP0190` deprecation warning (`shell:true` + array args) | **not emitted** | **emitted**: `[DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.` |
| Babel parse (`node_modules/playwright/lib/transform/babelBundle.js`, `babelParse`/`traverse`) on `falcon.js` + all of `src/**` (82 files) | 82/82 parsed, 0 failures | 82/82 parsed, 0 failures |

Observed fact / DIFFERENCE: Node 24.21.0 emits a `DEP0190` deprecation
warning for `child_process.spawn`/`spawnSync` calls that pass `shell:true`
together with a non-empty `args` array; Node 22.19.0 does not emit this
warning for the identical call. `GitInfo.js`'s own call
(`execFileSync` with `shell` unset, i.e. `false`) is not in the affected
shape and produced no warning under either version. Recommendation (not
implemented here): any future code that uses `shell:true` with array `args`
should be flagged in review; prefer `shell:false` with literal argv, which
is already this repo's documented pattern.

Note: my initial `babelParse(code, { sourceType: 'unambiguous' })` call used
the wrong signature for this bundle's exported `babelParse(code, filename,
isModule)` and failed identically (82/82 "failures") under both Node
versions before correction — recorded here because it was a harness bug,
not a Node-version difference, and the corrected call (`babelParse(code, f,
false)`) is what produced the 82/82 pass rows above.

## 4. CLI exit and stderr behaviour (OBSERVED FACT)

Command: `node h8/exitstderr.js` (writes a 5000-char line + a marker line to
`process.stderr` synchronously, then `process.exit(2)`; does not create any
file itself) run under three stderr destinations, both Node versions.

| Destination | Node 22.19.0 | Node 24.21.0 |
|---|---|---|
| Pipe (`2>file \| cat`), exit code via `PIPESTATUS[0]` | PASS: exit=2, 5082 bytes, marker line intact, `WRITE_RETURNED=true` | PASS: exit=2, 5082 bytes, marker line intact, `WRITE_RETURNED=true` |
| Plain file redirect (no TTY) | PASS: exit=2, 5082 bytes, byte-identical to pipe case | PASS: exit=2, 5082 bytes, byte-identical to pipe case |
| Pseudo-TTY (`script -q typescript node ...`) | PASS: exit=2, full message + marker present, `WRITE_RETURNED=true` | PASS: exit=2, full message + marker present, `WRITE_RETURNED=true` |
| No truncation in any destination | PASS | PASS |
| Exit code exactly 2 in all three destinations | PASS | PASS |

Env var and no-file-created checks (both Node versions, identical results):
- Reading a missing env var (`FALCON_H8_MISSING_VAR`) yields `undefined`;
  reading a present one yields its string value. Order of evaluation
  (missing first, then present) matches source order and does not change
  between Node versions. PASS on both.
- Running the script from an empty scratch directory and listing that
  directory before and after: directory was empty before and remained
  empty after, under both Node 22.19.0 and Node 24.21.0 — confirms the
  stderr-write-then-exit(2) path creates no file by itself. (Separate
  manual shell redirects used earlier to capture output for inspection are
  shell-created files, not files created by the script, and are not
  counted here.)
- Dotenv-style load ordering was not separately exercised with a real
  `.env` file in this task (out of the ~16-turn budget); the env-var
  presence/absence ordering above is the directly measured proxy for "env
  var read + fallback" behaviour and showed no Node-version difference.

`node falcon.js --help` style non-network invocation was **not attempted**:
I could not confirm from `falcon.js` alone within budget that a `--help`
path exists and is guaranteed not to start the dashboard or a browser, so
per the task's own instruction ("if unsure, skip and say so") this was
skipped. Separately, `node -e "require('./falcon.js')"` was correctly **not
executed**, per instruction.

## 5. Differences between Node 22.19.0 and Node 24.21.0 relevant to Phase 18

1. **`DEP0190` deprecation warning** on `spawn`/`spawnSync(cmd, args,
   {shell:true})` with non-empty `args`: present under Node 24.21.0, absent
   under Node 22.19.0. Relevant to any Phase 18 AST-checker or
   child-process-security assumption that currently treats Node 22 and 24
   as behaviourally identical for `shell:true` usage. `GitInfo.js`'s actual
   call shape (`execFileSync`, `shell` unset/false) is unaffected.
2. V8 version differs (12.4.254.21-node.29 vs 13.6.233.17-node.53) and npm
   differs (10.9.3 vs 11.19.0); no behavioural difference was observed in
   any of the measured filesystem, child_process, Babel-parse, or CLI
   exit/stderr checks that could be attributed to the V8/npm version
   change.
3. No other difference was observed in this measurement set. Every
   filesystem check, every child_process/ENOENT/exit-code check, the 82/82
   Babel parse result, and every exit/stderr-destination check were
   identical between the two Node versions on this host.

## Not measured (explicit)

- **Linux / CI runner (ubuntu, Node 24.21.0 x64)**: this entire measurement
  ran on macOS arm64 only. Nothing here should be read as a claim about
  Linux ext4/xfs/btrfs/overlayfs/tmpfs filesystem semantics, Linux
  `child_process` behaviour, or the actual GitHub Actions runner. The
  earlier SPIKE-FS findings (`docs/phase-18-spike-fs-findings.md`) already
  recorded this same Linux/ZFS gap for the filesystem checks; it applies
  identically here.
- **Playwright Chromium launch under Node 24.21.0**: not attempted in this
  task (budget). The repo's installed Chromium build (rev 1248 /
  156.0.8078.4) was identified and is identical under both Node binaries
  because they share `node_modules`, but no browser was actually launched
  under either Node version as part of this task.
- **Darwin `F_FULLFSYNC`**: not measured under either Node version (Node
  does not expose it without a native addon).
- **Dotenv file-based load ordering** with an actual `.env` file and
  `require('dotenv')`: not separately exercised; only direct
  `process.env` read ordering was measured.
- **`node falcon.js --help`**: skipped per the task's own "if unsure, skip"
  instruction, because it could not be confirmed safe/non-network within
  budget from reading the entry point alone.
- Full `npm run test:unit` / other suite runs: intentionally not run, per
  task instructions.

## Raw evidence

Harness scripts and raw JSON/text output are kept in the session scratch
directory (`h8/versions.js`, `h8/fsharness.js`, `h8/childproc.js`,
`h8/exitstderr.js`, `h8/babelcheck.js`, and their captured stdout/stderr),
not committed to the repository. This file is the sanitized, committed
record.
