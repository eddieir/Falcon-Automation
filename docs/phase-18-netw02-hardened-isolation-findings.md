# Phase 18 - NETW-02 findings: hardened isolation measurement (coordinator reading of raw results)

**Status: MEASURED for gaps A and C (partly) and D (partly); NOT MEASURED for the rest; the "sandboxed" label in the raw files is WRONG.** The measuring agent stopped at its turn limit twice (the one retry is spent) without writing findings. This document is written by the coordinator from the raw result files (scratch, not tracked: `scratchpad/netw2/results/*`) and from one extra coordinator probe. Same environment as NETW-01: Docker 28.5.2 linux/arm64 (Docker Desktop VM on macOS), image `mcr.microsoft.com/playwright@sha256:06a9939e...e971f`, Chromium 156.0.8078.4, Playwright 1.64.0, `--internal` network `falcon-iso` for the browser container, dual-homed proxy, fixtures on a second network. NOT the GitHub x64 runner.

**Escapes: none.** The `escapes` list is empty in all three result files; the denied fixture's counters show `ws_upgrade=0` and `tls_ws_upgrade=0`.

## Gap A (m-110): allowed controls and denied TLS - MEASURED
- Runs: Node 22 root, Node 24 root, Node 24 "sandboxed" label (see the correction below); 3 reps each.
- **Allowed destination OPENED, denied destination ERRORED, 3 of 3 in every run, for:** dedicated worker ws, nested worker ws, blob worker ws, module worker ws, page ws, page wss, dedicated worker wss. The allowed fixture counted 47 `ws_upgrade` and 18 `tls_ws_upgrade`, so the workers did start and reached the allowed fixture through the proxy.
- `data:` worker: construction returned "alive" (3 of 3); a WebSocket from a `data:` worker was **not** measured.
- Denied fixture has a TLS listener now. Its TLS counter was shown capable of counting: deliberate control requests from outside the isolated network raised `tls_http` to 2, while the browser's denied `wss`/`https` attempts left `tls_ws_upgrade = 0`.

## Gap C (m-110, m-114, m-115): hardened proxy - PARTLY MEASURED
- Measured, 403 or blocked in all runs: CONNECT to denied host, allowed host on ports 25 and 22, absolute-URI, Host-header trick, IPv6 literal, decimal and octal IP, link-local, `host.docker.internal`; worker `fetch` and nested-worker `fetch` to the denied destination failed; the proxy status port was **unreachable** from the isolated runner (m-115); a challenge attempted from the runner was refused (403).
- **NOT recorded in the raw results:** DNS rebinding, redirect-to-denied (the harness logged an attempt but stored no result), mid-session kill of the proxy during open WebSockets, allowlist swap. These remain UNMEASURED. Whether the "production-style" proxy pins resolved IPs is therefore not shown.

## Gap D (m-112, m-113): verification - PARTLY MEASURED
- Challenge-response with the key held outside the browser container: correct response accepted, **replay refused (403), missing response refused (403), empty nonce refused (400), 3 of 3 reps.**
- The browser's proxy read-back confirmed the proxy was used; the canary attempts (denied TCP, external TCP, Docker gateway) all failed (`EAI_AGAIN`, `ENETUNREACH`).
- **NOT measured:** detection of a verified-then-changed environment. The change-detection script reached `WAITING_FOR_CHANGE` and recorded nothing further; the image has no `ip` or route command (route table and interface list came back as "no-route-cmd"/"no-ip-cmd"), so a route-table snapshot was **not obtained**.

## Gap B (m-111): sandbox - the agent's "sandboxed" run was NOT sandboxed (coordinator correction)
The runner never set `chromiumSandbox: true`; Playwright adds `--no-sandbox` unless that option is `true` (`playwright-core` line 44764), so **every NETW-01 and NETW-02 measurement ran with `--no-sandbox`**, including the run labelled sandboxed (uid 1001). The coordinator then probed directly (container, image above, `chromium.launch({chromiumSandbox:true})`):

| Container settings | Result |
|---|---|
| default seccomp, `--user pwuser` (uid 1001) | launch FAILS: "Chromium sandboxing failed!" |
| default seccomp, root | launch FAILS: same |
| `--user pwuser --security-opt seccomp=unconfined` | launches (version 156.0.8078.4), no `--no-sandbox` in argv |
| `--user pwuser --cap-add SYS_ADMIN` | launches, no `--no-sandbox` in argv |

So a genuinely sandboxed non-root run needs a relaxed container profile (unconfined seccomp or an added capability); a narrower custom seccomp profile was **not** tested. The isolated-network measurements were **not repeated** under a sandboxed browser; whether results change is UNMEASURED. Any claim from these measurements must say **no sandbox**.

## What was not measured (explicit)
x64 GitHub runner; DNS rebinding; redirect-to-denied result; mid-session proxy kill; allowlist swap; verified-then-changed detection; route-table and interface snapshots; `data:` worker WebSocket; service-worker, WebTransport and EventSource channels; a custom seccomp profile; the isolated-network topology under a sandboxed browser; Node 22 in the (relaxed) sandboxed configuration.

## Cleanup
No `netw` containers or networks remain (`docker ps -a` and `docker network ls` checked); the unrelated containers on the host were not touched.
