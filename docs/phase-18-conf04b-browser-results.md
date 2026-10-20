# Phase 18 — CONF-04B browser-row results (rev 29)

Status: the agent that ran the harness stopped at its turn limit without a report or document. This document was written by the coordinator from the raw result files and an independent oracle (below). Raw evidence (scratch, untracked): `scratchpad/conf04/browser-results-node22.json`, `browser-results-node24.json`, `browser-harness.js`, `browser-wrapper.sh`; reference module `decide29.js` (sha256 prefix `7f85cbee…`, assembled by the coordinator from rev 28 B.5 plus the rev 29 changes). Base: rev 29 `677fe69`. Environment: macOS arm64, Node v22.19.0 and v24.21.0, Playwright 1.64.0, Chromium 156.0.8078.4 via the identity wrapper, loopback only.

## Independent oracle result

The coordinator recomputed expectations from the rev 29 contract, not from the harness flags: measured-present realms ⇒ `shared_worker_present`; F5, F7, F11, F16 to F21, the full gate, the FC1 mismatch-injection sub-case, IC2, IC4 (probe disabled and partial), IC8 and FW-1 ⇒ `shared_worker_block_unverified`; every refusal exit 18, `armed:false`. Compared with the 99 recorded decisions per Node version (3 repetitions each): **0 mismatches, 0 armed, on both Node versions.**

| Row | Result (3 of 3 per Node) |
|---|---|
| F1 to F4, F6, F8 to F10, F12 to F15 | `shared_worker_present`, exit 18 (F13, F14 popups created and measured) |
| F5, F7, F11, F21; F16 to F20 | `shared_worker_block_unverified`, exit 18 |
| Full 21-realm gate | `shared_worker_block_unverified`, exit 18 (current Chromium refuses in every repetition) |
| FC1 (match) | `shared_worker_present`, `nativeCtor` agrees |
| FC1 mismatch-injection | `shared_worker_block_unverified`, detail `realm-not-affirmatively-validated:F1`, **every repetition** (the CONF-03 defect is fixed) |
| FC2 | `fc2Pass: true` in every repetition (five sub-observations: delete, defineProperty, assignment, prototype, with-shadow; the native reference stays usable) |
| IC1 | `constructed-ok` (the harness sees an unblocked request) |
| IC2, IC4 (probe disabled, probe partial) | `shared_worker_block_unverified` |
| IC4 gate-removed | arms without validation by construction; the suite records the required failure |
| IC8 | base: identity verified; kill-and-relaunch ⇒ `identity-unverified:pid-not-alive`; changed arguments ⇒ `identity-unverified:args-mismatch`; different context ⇒ `different-context-config-requires-fresh-evidence` |
| FW-1 | required fail-closed decision executed; WebSocket behaviour stays UNMEASURED |
| F22 | informational only |
| Identity | gate runs re-verified before the run step: `identityVerifiedBeforeRun: true`, `reverify.ok: true` in every repetition |
| Network | 642 loopback requests, **0 non-loopback**, per Node |

## Cleanup and listeners

No `conf04` process, wrapper, profile directory or identity file remained after the runs. Two pre-existing loopback listeners were identified read-only and not touched: pid 21319, started 2026-10-19 14:27 by parent 20370, command `node …/node_modules/@playwright/test/cli.js test-server -c playwright.config.js --host 127.0.0.1`, cwd the repository root (an editor/Playwright test-server process, not started by these spikes); pid 7294, started 2026-10-16 14:44, parent 1, `demo.mjs` from a different project's worktree, listening on `*:3456` (unrelated).

## Not measured

F16 to F21 as real measurements (fail-closed rows by design); worker WebSocket behaviour; a browser in which SharedWorker is absent, so a real `armed:true` was never observed end to end; the product-side browser identity mechanism (OPEN-BID-27).

## Supported-browser set

Empty.
