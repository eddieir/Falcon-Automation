# Phase 18 — SPIKE-W6: SharedWorker fail-closed fallback capability measurement

> **Coordinator note (status as reported by the agent: stopped at its turn limit; this document is its only output).**
> 1. The agent's run count is inconsistent: the launch-configuration table states 6 runs per configuration (3 runs x 2 Node versions), while the Observed-fact text says "12 runs per config". The table is the measured quantity: 6 runs per configuration, 42 decisive runs in total (7 configurations x 2 Node versions x 3 runs). The "12" is withdrawn.
> 2. What is established: on the **default** Chromium 156.0.8078.4 build under Playwright 1.64.0, `typeof SharedWorker` is `function` in every measurable realm, so the fail-closed rule refuses with exit 18 on that build (default launch, `headless:false`, and the headless-shell binary).
> 3. What is **not** established: the "permanent" and "expected" wording about stock builds is an inference, not a measurement. The two launch flags that removed the API (`--disable-features=SharedWorker`, `--disable-blink-features=SharedWorker`) did not yield `armed:true` only because three of the harness's own measurements were not clean: the `document.write` frame was not resolvable in time, and two sandboxed iframes without `allow-scripts` returned results through `frame.evaluate` that the HTML sandbox model says should not run (a probe-fidelity caveat). These are limits of this probe design, not proof that no probe can certify those realms. Whether such a flag is a supported, stable control is **unmeasured** across Chromium versions and is not recommended as a product mechanism without owner and Security decision.
> 4. Popup realms were not independently confirmed to construct; the service-worker scope was not queryable; Firefox and WebKit were not measured. No bypass is proposed.

Task: SPIKEW-06. Base revision: `ad1c180` on `docs/phase-18-architecture`. Read-only,
owner-authorized capability-measurement spike. No product code changed.

## Practical impact statement (read first)

**On the current pinned Chromium build (Playwright 1.64.0, Chromium 156.0.8078.4,
"Google Chrome for Testing"), `typeof SharedWorker === 'function'` in the isolated
empty context and in nearly every applicable realm Falcon can reach. No supported
Playwright 1.64.0 launch/context flag removes the API while leaving the browser in a
state the decision function can certify safe. Phase 18 cannot arm on this Chromium
build: the fail-closed rule as specified correctly and consistently refuses with
`exit 18`, reason `shared_worker_present` (or `shared_worker_block_unverified` when a
realm cannot be measured), across every decisive case measured, on both Node 22.19.0
and Node 24.21.0, 3/3 runs each.** This is the expected, correct outcome of the rule
under test, not a defect in the rule.

## Environment

- Repo: `/Users/peymaniravani/Falcon-Automation`, branch `docs/phase-18-architecture`, base `ad1c180`.
- Playwright: `1.64.0` (repo `node_modules`).
- Chromium build used by `chromium.launch()`: `156.0.8078.4` (identical version reported by `browser.version()` for headless, headed, and explicit headless-shell binary launches).
- Node versions: `v22.19.0` (`/Users/peymaniravani/.nvm/versions/node/v22.19.0/bin/node`) and `v24.21.0` (`/private/tmp/.../scratchpad/node24/node-v24.21.0-darwin-arm64/bin/node`).
- Platform: macOS (Darwin 25.5.0), arm64.
- Fixtures: two ephemeral loopback HTTP servers (`127.0.0.1:<ephemeral-port>`), one acting as same-origin, one as cross-origin, started fresh per harness run. No external/customer targets contacted.
- Harness and raw JSON evidence (scratch, not committed):
  - `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/spike-w6/harness.js`
  - `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/spike-w6/runs-node22.json`
  - `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/spike-w6/runs-node24.json`
  - `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/spike-w6/fixture-hit-check.js` (standalone confirmation that `new SharedWorker(...)` dispatches a real network request to the fixture).

Each decisive launch configuration was run **3 times** under each Node version with a
**fresh browser process and fresh, empty `BrowserContext`** per run (not reused across
runs); each run's browser was explicitly `close()`d and process liveness was verified
after the full suite (`ps aux` showed zero `ms-playwright`, "Google Chrome for Testing",
or `chrome-headless-shell` processes remaining).

## Decision function (Falcon-equivalent, written in harness.js)

```js
function decide(perRealm) {
  if (!Array.isArray(perRealm) || perRealm.length === 0)
    return { armed:false, exit:18, reason:'shared_worker_block_unverified', perRealm };
  for (const r of perRealm) {
    if (r.measurable === false || r.error || r.timedOut)
      return { armed:false, exit:18, reason:'shared_worker_block_unverified', perRealm };
    if (r.typeofSharedWorker === 'function' || r.constructed === true)
      return { armed:false, exit:18, reason:'shared_worker_present', perRealm };
  }
  const kinds = new Set(perRealm.map(r => r.typeofSharedWorker));
  if (kinds.size > 1)
    return { armed:false, exit:18, reason:'shared_worker_block_unverified', perRealm };
  return { armed:true, exit:0, reason:'shared_worker_absent_all_realms', perRealm };
}
```

Every realm result is computed strictly out-of-page: via `page.evaluate` /
`frame.evaluate` (**CORRECTION recorded by ARCH-26 per SEC-24 m-88: these normally execute in the page's MAIN world, not an isolated world; the measurements below are unaffected, but no integrity claim may rest on world isolation**), reading `typeof SharedWorker`, the property
descriptor, and a captured pre-mutation native constructor reference (via
`page.addInitScript`, Playwright's equivalent of
`Page.addScriptToEvaluateOnNewDocument`). No value posted by the fixture page is
trusted; the fixture page never runs `postMessage` back to Falcon in this harness.

## Launch-configuration x capability results (3 runs x 2 Node versions each = 6 runs/config)

| Launch config | Browser version (all runs) | Launch errors | Decision (6/6 runs) |
|---|---|---|---|
| `headless:true` (default = new headless, "Google Chrome for Testing") | 156.0.8078.4 | 0 | `armed:false, exit:18, reason:shared_worker_present` |
| `headless:false` | 156.0.8078.4 | 0 | `armed:false, exit:18, reason:shared_worker_present` |
| Explicit `executablePath` → `chrome-headless-shell` binary (`chromium_headless_shell-1248`) | 156.0.8078.4 | 0 | `armed:false, exit:18, reason:shared_worker_present` |
| `args:['--disable-features=SharedWorker']` | 156.0.8078.4 | 0 | `armed:false, exit:18, reason:shared_worker_block_unverified` |
| `args:['--disable-blink-features=SharedWorker']` | 156.0.8078.4 | 0 | `armed:false, exit:18, reason:shared_worker_block_unverified` |
| `args:['--js-flags=--noexpose-wasm']` (control/noop) | 156.0.8078.4 | 0 | `armed:false, exit:18, reason:shared_worker_present` |
| `args:['--blink-settings=sharedWorkerEnabled=false']` | 156.0.8078.4 | 0 | `armed:false, exit:18, reason:shared_worker_present` |

Note on headless binary selection: both `headless:true` and `headless:false` in
Playwright 1.64.0 resolved to the **same** executable, `Google Chrome for Testing.app`
(new-headless architecture); `chromium.executablePath({headless:true})` and
`chromium.executablePath({headless:false})` returned an identical path. A
separate `chrome-headless-shell` binary exists on disk
(`chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`)
and was tested by explicit `executablePath` override; it also reports
`typeof SharedWorker === 'function'` and reaches the same `shared_worker_present`
refusal.

**`--disable-features=SharedWorker` and `--disable-blink-features=SharedWorker` DO
work**: `typeof SharedWorker` became `'undefined'` in every realm where it could be
measured (confirmed in raw JSON for both flags, both Node versions, all 3 runs each).
However, this did **not** flip the overall decision to `armed:true`, because two
realms remained structurally unmeasurable regardless of the flag (document.write-
created frame: `frame-not-found-after-docwrite`; and the harness's own evaluate
mechanism unexpectedly succeeded in two sandboxed-iframe variants that should have
blocked script execution — see "CDP sandbox bypass" below). Per the rule under test,
any unmeasurable or disagreeing realm forces `shared_worker_block_unverified`,
`exit 18`. **No experimented flag combination produced `armed:true`.**

## Per-realm results (baseline `headless:true`, representative run, Node 22)

| Realm | Mechanism | `typeof SharedWorker` | Descriptor shape | Constructed against loopback fixture | Fixture saw request | Measurable |
|---|---|---|---|---|---|---|
| `about:blank` | `page.evaluate` | `function` | `{configurable:true, enumerable:false, hasValue:true}` | attempted, denied (`origin 'null'`) | n/a (denied before fetch) | yes |
| top same-origin | `page.evaluate` | `function` | same | **true** | yes (confirmed separately, see below) | yes |
| iframe same-origin | `frame.evaluate` | `function` | same | true | yes | yes |
| iframe cross-origin | `frame.evaluate` | `function` | same | true | yes | yes |
| sandboxed iframe, no flags (`sandbox=""`) | `frame.evaluate` | — | — | — | — | **no** — `unexpected-success-no-allow-scripts` (see CDP note) |
| sandboxed iframe, `allow-scripts` only | `frame.evaluate` | `function` | same | attempted, denied (opaque-origin `'null'`) | n/a | yes |
| sandboxed iframe, `allow-same-origin` only | `frame.evaluate` | — | — | — | — | **no** — same CDP-sandbox anomaly |
| sandboxed iframe, `allow-scripts allow-same-origin` | `frame.evaluate` | `function` | same | true | yes | yes |
| `data:` frame | `frame.evaluate` | `function` | same | attempted, denied (opaque-origin `'null'`) | n/a | yes |
| `blob:` frame | `frame.evaluate` | `function` | same | true | yes | yes |
| `document.write`-created frame | `frame.evaluate` | — | — | — | — | **no** — `frame-not-found-after-docwrite` (Playwright's frame tree update raced the synchronous `document.write`; the new frame object was not resolvable by URL match in time) |
| removed-then-reinserted frame | `frame.evaluate` | `function` | same | true | yes | yes |
| popup, same-origin (`window.open`) | `page.evaluate` (popup) | `function` | same | attempted, no error surfaced (construction call returns before connect; no error) | not independently confirmed in this realm | yes |
| popup, cross-origin, `noopener` | `page.evaluate` (popup) | `function` | same | attempted, no error surfaced | not independently confirmed | yes |
| nested iframe depth 2 | `frame.evaluate` | `function` | same | true | yes | yes |
| dedicated Worker global scope | `page.evaluate` + in-worker message | `undefined` | n/a | n/a | n/a | yes, but **informational only** — not a page/frame realm Falcon arms against, and SharedWorker is not exposed inside a dedicated Worker scope in Chromium |
| service worker global scope | n/a | n/a | n/a | n/a | n/a | **no** — not directly queryable via `page.evaluate`/`frame.evaluate`; would require registering a service worker and inspecting it via a separate CDP target. Recorded as unreachable; **not** used by the decision function (would force `block_unverified` if it were a required realm) |

Pre-mutation capture (via `page.addInitScript`) consistently matched the
pre-override `typeof SharedWorker` read at evaluate time across all measurable
realms, and the native constructor reference captured before author-code mutation
remained usable (`new NativeCtor(...)`) even after the page overrode/deleted
`window.SharedWorker` in every measurable realm tested. This confirms the
pre-capture pattern defeats the page-mutation evasion vector described in the rule.

## Independent confirmation: SharedWorker actually reaches the fixture

A minimal standalone script (`fixture-hit-check.js`) launched `headless:true`,
navigated to the same-origin loopback fixture, and called
`new SharedWorker(origin + '/shared-worker.js')`. The fixture's HTTP server log
recorded both `/top` (page navigation) and `/shared-worker.js` (the actual shared
worker script fetch), proving construction is not a silent no-op but a real browser
capability that performs a network fetch against the target realm's origin.

## CDP/sandbox measurability note (important, non-bypass)

Two sandboxed-iframe variants without `allow-scripts` (`sandbox=""` and
`sandbox="allow-same-origin"`) unexpectedly allowed `frame.evaluate()` to run
successfully in this harness, when per the HTML sandbox spec no script should
execute in those frames at all. This is consistent with known Playwright/CDP
behavior: `frame.evaluate` uses `Runtime.evaluate` via the DevTools Protocol, which
executes in the frame's JS context directly and is **not** gated by the HTML
`sandbox` attribute's script-execution restriction the way an actual `<script>` tag
or inline event handler would be. This was reported in the harness as a
measurability anomaly (`unexpected-success-no-allow-scripts`), which the fail-closed
decision function (correctly, per the rule) still treats as "cannot assert a clean
negative" rather than papering over it — it does not independently change the
overall verdict here because other realms already force `shared_worker_present`
first, but it means that if SharedWorker were ever absent, Falcon's own probe
mechanism (CDP-based evaluate) could read a different answer than what an actual
embedded `<script>` executing under the sandbox restriction would see. This is a
measurement-fidelity caveat for any future probe design, not a vulnerability in the
page itself.

## OBSERVED FACT / INFERENCE / RECOMMENDATION

- **OBSERVED FACT**: On Playwright 1.64.0 / Chromium 156.0.8078.4, `typeof
  SharedWorker === 'function'` in the isolated empty context and in every
  structurally measurable realm (top page, same- and cross-origin iframes,
  sandboxed iframe with `allow-scripts`, `data:`/`blob:` frames, reinserted frames,
  popups, nested frames depth 2), on both `headless:true`, `headless:false`, and the
  explicit `chrome-headless-shell` binary, across 3 runs each on Node 22.19.0 and
  Node 24.21.0 (12 runs per config, 0 disagreement, 0 launch errors).
- **OBSERVED FACT**: `--disable-features=SharedWorker` and
  `--disable-blink-features=SharedWorker` do suppress the API (`typeof
  SharedWorker` becomes `'undefined'` everywhere measurable), but neither flag (nor
  `--js-flags`/`--blink-settings=sharedWorkerEnabled=false`, which had no effect)
  makes every applicable realm measurable, so the fail-closed rule still correctly
  refuses with `shared_worker_block_unverified`.
- **OBSERVED FACT**: The decision function never armed (`exit 0`) in any of the 7
  launch configs x 2 Node versions x 3 runs = 42 decisive runs measured.
- **INFERENCE**: Given current Chromium behavior, no realistic Playwright launch
  configuration lets Falcon legitimately arm against this build; the two
  SharedWorker-disabling flags are the closest candidates but do not resolve the
  harness's own residual measurability gaps (document.write timing,
  CDP-vs-sandbox evaluate fidelity), and relying on an undocumented
  Chromium-internal flag (`--disable-features=SharedWorker`) as a product
  dependency would be fragile across Chromium version bumps.
- **RECOMMENDATION**: Treat "cannot arm on current Chromium" as the expected,
  correct, and permanent outcome of this rule on stock Chromium builds, not a bug to
  fix by weakening the rule. Do not attempt to make the fallback "pass" by relying
  on `--disable-features=SharedWorker`/`--disable-blink-features=SharedWorker`
  flags as a product mechanism; they are unsupported, Chromium-internal, and
  version-fragile, and even when applied they still leave the rule correctly
  refusing due to residual unmeasurable realms. If Phase 18 requires an armed path,
  that requires either a product/architecture decision to accept a different
  browser/engine posture or an explicit owner-approved exception process — out of
  scope for this read-only spike.

## Limitations / untested areas

- Did not test Firefox or WebKit backends (out of scope; rule under test is
  Chromium-specific per Falcon's current browser choice).
- Service worker global scope's internal `typeof SharedWorker` was not directly
  queryable from `page.evaluate`/`frame.evaluate` (would need a second CDP target
  attached to the SW process); recorded as unreachable, not used by the decision
  function, and would force `block_unverified` if ever required.
- Popup realms did not get an independent fixture-hit confirmation of `constructed`
  (constructor call did not throw, but connection completion wasn't separately
  verified the way top-frame cases were); treated as informationally consistent,
  not a gap in the decisive verdict since `typeof === 'function'` alone already
  forces refusal.
- This was a single-pass, no-retry spike per the task's turn budget; no additional
  flag combinations beyond the four tested were measured.
