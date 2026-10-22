# Phase 18 — CONF-02B browser-dependent W6-T conformance results (DRAFT, IN PROGRESS)

> **Coordinator note (status: agent draft, superseded for conclusions by `docs/phase-18-conf02-results.md`).** The header and "in progress" wording below were written before the background runs finished and were never refined; the agent stopped at its turn limit without a report. The coordinator read the completed raw result files (`browser-results-node22.json`, `browser-results-node24.json`) and recorded the final results in `docs/phase-18-conf02-results.md`. Use that document for conclusions.

**Status at time of writing: EXECUTION IN PROGRESS.** This document is being written early per
instruction and will be refined as the Node 22.19.0 and Node 24.21.0 background runs complete.
Scope: TASK CONF-02B, the real-browser rows of the consolidated 42-row table (rev 27 section C):
F1..F21, F22 (informational), FC1/FC2 (browser-dependent), IC1, IC2, IC8 (browser identity,
including negative cases), FW-1 (decision row only). The PURE-function rows (FC8..FC11, IC3,
IC5, IC6, IC7) and the mutation sweeps are CONF-02A's scope, not this document's.

Gating function: `scratchpad/conf02/decide27.js`, used verbatim (confirmed byte-identical in
shape to rev 27 section B.5: `decide`, `SCHEMA_VERSION`, `CANONICAL_REQUIRED_REALM_IDS`,
`REQUIRED_KEYS`, `ENUMS`, `BOOLEAN_KEYS` all present; not edited by this task).

Harness: `scratchpad/conf02/harness-browser.js`, loopback fixtures only (two ephemeral HTTP
servers bound to `127.0.0.1` with OS-assigned ports). Every HTTP request is logged with a
loopback/non-loopback classification; the run asserts and reports `nonLoopback` count, which
must be 0.

## Browser identity (rev 27 J.2, scratch scaffolding only — never product code)

- A scratch executable wrapper (`scratchpad/conf02/wrapper.sh`, mode 700) is passed as
  Playwright's `executablePath`. It writes a private identity file (mode 600): its own PID
  (`$$`), `ps -o lstart=`, normalized argv (HOME/TMP replaced with `<HOME>`/`<TMP>`), and a
  random per-run token — then `exec`s the real pinned Chromium so the PID is unchanged.
- The real Chromium executable (`chromium.executablePath()`, Chromium 1248 / "Google Chrome for
  Testing") is hashed independently with SHA-256 by the harness (not by the wrapper).
- After connecting, identity is corroborated via `Browser.getVersion` over a CDP session
  (`context.newCDPSession(page)`). `SystemInfo.getProcessInfo` was attempted and found
  **unsupported on this CDP session type** (Playwright's `launchPersistentContext` exposes no
  browser-level target, only page-level sessions, so this method returns `"SystemInfo.getProcessInfo
  is only supported on the browser target"`). This is recorded as a stated limitation, per rev 27
  J.2.3's "where supported."
- Immediately before every simulated run step (the `decide()` call), the harness re-verifies:
  (1) the recorded PID is alive; (2) its `ps -o lstart=` is unchanged (compared with whitespace
  normalized — the raw `ps` output is right-padded and the harness trims/collapses before
  comparing); (3) **independently**, the live command line of that PID (`ps -o args=`) names the
  real Chromium executable path, not the wrapper script — a second, out-of-band corroboration
  that `exec` truly replaced the wrapper image. Any failure of (1)/(2)/(3) ⇒
  `shared_worker_block_unverified`, exit 18, and the row never arms.

### IC8 negative cases (identity never arms)

Four sub-cases, each executed independently, 3 reps per Node version:
- **IC8-base**: launch, build identity, re-verify immediately before the simulated run. Expected
  and (where completed) actual: `armed:false`, exit 18, `shared_worker_block_unverified` (the
  browser itself already refuses per F5/F21 et al.; identity verification is additionally
  confirmed `ok:true` in this case, which is the expected "nothing changed" branch).
- **IC8-kill-relaunch**: the recorded real-Chromium PID is sent `SIGKILL` between the probe and
  the simulated run. Expected: re-verification fails `pid-not-alive` ⇒ refusal. Confirmed in
  smoke testing.
- **IC8-different-args**: launch with an extra flag (`--mute-audio`) vs. a baseline launch with
  no extra flag; the normalized-args comparison must disagree ⇒ refusal `args-mismatch`.
- **IC8-different-context**: launch with a differently configured context (non-default
  viewport); treated as requiring fresh evidence, never a carried-over approval ⇒ refusal.

**No case is permitted to produce `armed:true`;** `armedWronglyTrue` is computed and asserted
false for every IC8 row in the result JSON.

## FC2 (rev 27 J.4), defined and executed exactly as specified

FC2 passes only when, in a measurable realm, each of the five sub-observations holds: (1)
`delete window.SharedWorker`, (2) `Object.defineProperty`/`Reflect.defineProperty`
redefinition, (3) plain assignment, (4) prototype/`__proto__` manipulation, (5) `with`-scope
shadowing (built via `new Function(...)` inside the page so the host harness file — itself
strict-mode CommonJS — never contains a literal `with` statement) — each leaves the
pre-captured native constructor reference usable (`new NativeCtor(...)` still constructs
against the loopback fixture's `shared-worker.js`) **and** leaves the decision byte-identical
(`JSON.stringify` equality) to the pre-mutation decision. In the Node 22 smoke run, all five
sub-observations reported `nativeUsable:true` and `decisionUnchanged:true`, so `fc2Pass:true` —
**matching the rev 27 expectation** ("PASS on the current pinned Chromium"). This explicitly
resolves the CONF-01 `fc2Pass:false` finding, which that report stated was unexplained: the
CONF-01 harness's `pageMutationDefeated` flag conflated "native ref still usable" with "typeof
read changed," which is not what J.4 defines. CONF-02B reports the five sub-observations
individually so no outcome is unexplained.

## Expected-vs-actual for the required fail-closed rows

F5, F7, F11, F21 are REQUIRED FAIL-CLOSED. In every completed run so far (Node 22 smoke,
pre-full-run), F5 and F21 correctly refuse (`shared_worker_block_unverified`); these are PASS
outcomes because refusal is the expected result, per rev 27 J.1.7 ("a refusal is a PASS when it
is the expected outcome"). No row has been rewritten into a pass.

## Network

All loopback-only by construction (two servers bound to `127.0.0.1`); every request is logged
and classified; `nonLoopback` must be 0 in every run. To be filled in with final totals.

## Final per-row table, full gate, cleanup verification

**TO BE COMPLETED** once `scratchpad/conf02/browser-results-node22.json` and
`-node24.json` finish writing. This section will be replaced with the final row-by-row table,
the 3x full-gate results per Node, cleanup verification (`ps`/`lsof` showing no leftover
browser/wrapper/profile/listener), and an explicit PARTIAL/COMPLETE statement per row.
