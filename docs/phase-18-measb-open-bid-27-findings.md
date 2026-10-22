**Status: PARTIAL (coordinator-stopped; written by the measuring agent, published unedited below this banner).** Not a pass of anything. The kill -9 observation (b) is flagged by the agent itself as possibly a wrong-pid artefact and is an inference until rerun with a process-tree-aware kill; the probe fingerprint was weaker than intended; `Browser.getCommandLine` was not probed; Linux was not measured. The conclusion that OPEN-BID-27 stays undecided is the only supported reading. No product design is implied.


# MEASB-01 findings — OPEN-BID-27 measurement spike

Task: can Falcon establish browser process identity WITHOUT a wrapper, through the launch API it already uses (`chromium.launch({ headless })`, Playwright 1.64.0, Chromium 156.0.8078.4)?

Repository HEAD: d608802 (branch `docs/phase-18-architecture`). No product code edited; this directory is scratch-only.

## Scope executed vs not executed

- Executed 3 reps per Node (22.19.0 and 24.21.0) with the probe in `probe.js`. Rep 0 used a 60 s inter-capture wait; reps 1–2 used 10 s (documented limit, see "Limits").
- STOPPED by coordinator before a third driver run that would have incorporated the two post-run probe fixes below. The findings for scenarios (c) relaunch and (d) config change are therefore based on the second driver run only, in which the probe fingerprint formula was weaker than it should be. The raw argv-level evidence is present in the raw JSONs regardless of the fingerprint.

Not completed:
- A clean re-run after the macOS-pgrep fix (switched to `ps -ax -o pid=,command=`) and a stronger fingerprint that includes argv and pid+start-time. The raw JSON written to disk is from the pre-fix run.
- Full statistical cross-run comparison across all 6 reps.

## Per-mechanism verdicts (OBSERVED on the pre-fix run)

| # | Mechanism | Verdict | Observed evidence |
|---|---|---|---|
| 1 | `browser.process()` | UNAVAILABLE (confirmed) | `typeof browser.process === 'function'` is true, but it returns `null`. Playwright 1.64 client API does not expose a Node child-process handle for the Chromium process. Reproduced on Node 22 and Node 24. |
| 2 | CDP via `browser.newBrowserCDPSession()` | WORKS | `Browser.getVersion` returns `product: "HeadlessChrome/156.0.8078.4"`, `revision: "@f842f52ef39f (Chromium build revision, shortened)"`, `jsVersion: "15.6.75"`. `SystemInfo.getProcessInfo` returns a `processInfo` array with CDP-internal process ids (not host OS pids) for `browser`, `GPU`, `network.mojom.NetworkService`. `Target.getTargets` returns a target list. |
| 3 | `chromium.executablePath()` + sha256 of binary | WORKS | `/Users/peymaniravani/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, sha256 prefix `c8509aee32abd697…`. Stable across reps and Node versions. "Agreement" between the launched binary and `chromium.executablePath()` is tautological on a single-process probe: this mechanism proves build identity, not run identity. |
| 4 | `ps`/`pgrep` discovery by unique `--user-data-dir` argument | NOT APPLICABLE for `chromium.launch()` | `chromium.launch({ args: ['--user-data-dir=…'] })` **throws** in Playwright 1.64: `Pass userDataDir parameter to 'browserType.launchPersistentContext(...)' instead`. `falcon.js` uses `launch()`, not `launchPersistentContext()`, so this mechanism cannot be driven from the current launch API. Playwright does assign its own temp UDD, but on macOS the browser top-level process we observed via `ps` did not carry `--user-data-dir=` in its own argv (helpers do, under `--type=`). |
| 5 | Combination | PARTIALLY SUFFICIENT; the ONLY candidate | Only mechanism 2 (CDP) + 3 (binary hash) can be run from the existing launch API without a wrapper. See scenarios for what the combination does and does not detect. |

## Per-scenario verdicts

| Scenario | Chosen combo detects change? | Observed |
|---|---|---|
| (a) normal, two captures 60 s apart (rep 0) and 10 s apart (reps 1–2) | n/a (stability check) | CDP version fields stable; binary sha256 stable; `fingerprintStable: true`. Observation: identity values are stable across time within one browser process. |
| (b) kill -9 the browser pid | PARTIALLY — unreliable from CDP alone | `aliveAfterKill: false` for the pid we killed, but `brA.newBrowserCDPSession()` **still returned a valid `Browser.getVersion`** afterward, and the `disconnected` event did NOT fire within 2 s. INFERENCE: the host pid we identified via `ps` filter was not the sole process backing the CDP channel (Playwright's node driver / helper layer still routed the call), or Chromium's parent-child supervision kept CDP responsive briefly. A CDP call alone is NOT a reliable crash signal. The `disconnected` event is the correct signal to wait for, but it may be debounced; see OPEN RISKS. |
| (c) relaunch — new process must get a different identity | WOULD NOT DETECT with CDP+sha256 alone | Two sequential `chromium.launch()` of the same pinned build yield identical `Browser.getVersion` and identical binary sha256. Observed: pid changed (77127 → 77376) but the probe fingerprint (CDP product+revision + binary sha256) did not. INFERENCE: identity-by-build is not identity-by-run; without a per-run token minted into the launch (which requires either `launchPersistentContext` for a custom UDD, or a wrapper, or a CDP-side marker injected after connect), relaunch is INDISTINGUISHABLE from the same run. |
| (d) config change between probe and run (extra launch arg) | WOULD NOT DETECT with CDP+sha256 alone | `chromium.launch({ args: ['--disable-gpu','--window-size=1024,768'] })` yielded the same CDP product/revision and the same binary sha256; the extra args did not appear in the top-level browser's `ps` argv on macOS (they are propagated to helper `--type=` processes). INFERENCE: on this platform, extra args are not visible via top-level argv inspection, and are not reflected in CDP's `Browser.getVersion`. Detecting a config change requires either (i) capturing the exact `args`+`env` the harness passed to `launch()` as part of the identity, or (ii) a CDP-side probe such as `Browser.getCommandLine` (not measured — see OPEN RISKS). |
| (e) pid reuse | Partially addressable | Record `(pid, lstart)` with whitespace normalisation; refuse if `kill -0 pid` fails or `lstart` differs. Limit: `lstart` is 1-second resolution; not forgery-proof on a hostile host. Also requires knowing the OS pid, which this launch API does not surface directly (only via `ps` lookup by executablePath / helper tree, which is noisy on CI). |

## Conclusion for OPEN-BID-27 (honest)

Through the launch API `falcon.js` already uses (`chromium.launch({ headless })`), the probe measured that:

- Only mechanisms (2) CDP and (3) binary sha256 run without a wrapper.
- They establish **build identity** (what Chromium is this) with high confidence.
- They do NOT by themselves establish **run identity** sufficient to refuse on relaunch (c) or config change (d). Pids are not visible from the client API; `--user-data-dir` cannot be injected via `launch()` in Playwright 1.64; extra args are not reflected in CDP version calls.
- Crash detection (b) is only reliable via the `disconnected` event; a reactive CDP call alone was observed to still succeed after `kill -9` of the pid we identified via `ps`.

Therefore: no mechanism in the measured set satisfies the stated contract ("refuse if identity cannot be established or any value changes") when driven purely from `chromium.launch()`. The minimum additional ingredient would be to also fingerprint the exact `(args, env, nodeVersion, playwrightVersion)` passed to `launch()` on the harness side (observed, not from the browser), plus a per-run nonce injected into the first navigated page and read back via CDP, plus wiring `browser.on('disconnected')` as the authoritative liveness signal. The product-side equivalent of the section J wrapper would thus be: `(harness-captured launch spec) ⨁ (CDP version+revision) ⨁ (binary sha256) ⨁ (per-run nonce round-tripped through CDP) ⨁ (disconnected-event liveness)`. The spike cannot assert this is sufficient without executing it; the rev 27 characterization that `OPEN-BID-27` is undecided is upheld.

## Observed-vs-inference boundary

- OBSERVED: `browser.process()` returns null; `--user-data-dir` is rejected by `launch()`; CDP calls succeed and return the recorded fields; binary sha256 is stable; two sequential launches yield identical build identity; extra args do not appear in the top-level browser's `ps` argv on macOS; a CDP call still succeeded after `kill -9` of the ps-identified pid.
- INFERENCE (not independently proven): that the ps-identified pid is actually the sole backing process; that `disconnected` event timing is the correct liveness signal; that `Browser.getCommandLine` (not called) would reflect extra args.

## Limits

- Only rep 0 at 60 s wait on each Node, reps 1–2 at 10 s wait (budget pressure).
- macOS only; Linux CI behaviour of `ps` and process-tree supervision not measured here.
- Probe fingerprint formula was weaker than ideal (no argv, no pid+lstart); the raw JSONs still contain the per-pid and per-argv observations.
- No network traffic was generated beyond localhost CDP.

## Cleanup

Verified with `pgrep -lf chromium-1248` at end: empty output. Any chromium process spawned by the probe has been reaped (the probe's end-of-run `kill -9` sweep plus a final shell-level `pkill -9 -f chromium-1248`). No scratch Chromium binary was created; the pinned Playwright-managed binary was used read-only.

## Evidence files

- `probe.js`, `run.sh`
- `raw-node22-rep{0,1,2}.json`, `raw-node24-rep{0,1,2}.json`
- `log-n22-r{0,1,2}.txt`, `log-n24-r{0,1,2}.txt`
- `pre-chromium-pids.txt`
