**Status: MEASURED, PARTIAL as an agent task (written by the measuring agent after one retry; published unedited below this banner). Coordinator reading: in the measured topology (Docker `--internal` network for Chromium, a dual-homed allowlist proxy, fixtures on a second network) no measured channel escaped: 0 handshakes and 0 requests reached the denied fixture across all phases, both Node versions and 3 repetitions. This is a measurement of an environment property, not yet a Falcon mechanism or a supported-browser claim.** Limits the coordinator adds: (1) it ran in a Docker Desktop linux/arm64 VM on macOS, not on the GitHub x64 runner; (2) the isolation is a property of the environment, so Falcon must VERIFY it is active at run time before arming (not assume it), and that verification is not designed or measured here; (3) NOT measured: `data:` workers, service-worker WebSockets, DNS rebinding, redirect from an allowed to a denied origin, WebTransport/HTTP3, killing the real proxy mid-session, and a hostile proxy-side Host-header; (4) the SharedWorker realm decision is unaffected, so the supported-browser set stays empty; (5) "viable for CI network containment" in the agent's conclusion is an inference. Per the owner rule, no other mechanism was tried. (6) **Every measurement in this document ran with Chromium's `--no-sandbox`** (Playwright adds it unless `chromiumSandbox: true` is set, and the runner never set it; verified later by the coordinator), as root; any claim derived from it must say so.

# NETW-01 Findings: Network Isolation + Proxy Containment of Chromium Channels

## ESCAPES: NONE DETECTED

Denied fixture final counts: http=1 (only the docker-exec /counts self-check), ws_upgrade=0, tls_http=0, tls_ws_upgrade=0. Zero unauthorized requests reached the denied fixture across all phases, both Node versions, all 3 repetitions per case.

## Environment

- Docker: 28.5.2, linux/arm64 (Docker Desktop VM on macOS Darwin 25.5.0)
- Image: mcr.microsoft.com/playwright sha256:06a9939...e971f (Ubuntu 24.04 aarch64)
- Node 24.21.0 (image), Node 22.19.0 (mounted read-only)
- Playwright 1.64.0, Chromium 156.0.8078.4 (chromium-1248, /ms-playwright)
- Networks: `docker network create --internal falcon-iso`, `docker network create falcon-out`

## Phase 1: Raw Network Isolation (from runner on falcon-iso)

OBSERVED (identical Node 22 and Node 24):

| Test | Result | Error |
|------|--------|-------|
| DNS denied fixture | FAIL | EAI_AGAIN |
| DNS allowed fixture | FAIL | EAI_AGAIN |
| DNS proxy | OK | Resolves to 172.18.0.2 (shared falcon-iso) |
| DNS host.docker.internal | FAIL | ESERVFAIL |
| DNS gateway | FAIL | ESERVFAIL |
| TCP 1.1.1.1:443 | FAIL | ENETUNREACH |
| TCP 8.8.8.8:53 | FAIL | ENETUNREACH |
| UDP 8.8.8.8:53 | FAIL | ENETUNREACH |
| UDP QUIC 1.1.1.1:443 | FAIL | ENETUNREACH |
| TCP6 ::1:80 | FAIL | ECONNREFUSED |
| TCP6 Google DNS | FAIL | ENETUNREACH |
| TCP 172.17.0.1 (docker gw) | FAIL | ENETUNREACH |
| TCP 192.168.65.1 (macOS host) | FAIL | ENETUNREACH |
| TCP host.docker.internal | FAIL | EAI_AGAIN |
| TCP proxy | OK | Proxy reachable on falcon-iso |
| TCP allowed fixture (direct) | FAIL | EAI_AGAIN |

INFERENCE: `--internal` network fully isolates the runner. Only the proxy (dual-homed on falcon-iso + falcon-out) is reachable. No DNS leakage for external or out-of-network names. No route to Docker host, gateway, or external IPs. IPv6 fully blocked.

## Phase 2: Chromium with --proxy-server (3 reps each, Node 22 + Node 24)

OBSERVED:

| Channel | Allowed fixture | Denied fixture |
|---------|----------------|----------------|
| Page navigation | OK (200) | Proxy returns 403; 0 handshakes at denied |
| fetch/XHR | OK (200) | "Failed to fetch"; 0 at denied |
| Page WebSocket (ws) | OPEN | error event; 0 ws_upgrade at denied |
| Page WebSocket (wss) | OPEN via CONNECT tunnel | N/A (denied has no TLS) |
| Dedicated worker WS | OPEN via proxy | error; 0 at denied |
| Nested worker WS | OPEN via proxy | error; 0 at denied |
| Blob worker WS | N/A | error; 0 at denied |
| Module worker WS | N/A | error; 0 at denied |

INFERENCE: All Chromium channels -- including dedicated, nested, blob, and module workers -- route WebSocket through the configured proxy. The proxy allowlist blocks all denied-host requests. Proxy counts: allowed=128, denied=198, connect_allowed=24, connect_denied=48, errors=0.

## Phase 3: No Proxy / Bypass / QUIC (3 reps each)

OBSERVED:

| Config | nav-denied | fetch-denied | ws-denied | direct-ip |
|--------|-----------|-------------|-----------|-----------|
| no-proxy | ERR_NAME_NOT_RESOLVED | ERR_NAME_NOT_RESOLVED | ERR_NAME_NOT_RESOLVED | ERR_NAME_NOT_RESOLVED |
| --proxy-bypass-list=* | ERR_NAME_NOT_RESOLVED | ERR_NAME_NOT_RESOLVED | ERR_NAME_NOT_RESOLVED | ERR_NAME_NOT_RESOLVED |
| --proxy-bypass-list=\<-loopback\> | Proxy 403 (no escape) | "Failed to fetch" via proxy | error via proxy | opaque via proxy |
| --enable-quic | ERR_NAME_NOT_RESOLVED | ERR_NAME_NOT_RESOLVED | ERR_NAME_NOT_RESOLVED | ERR_NAME_NOT_RESOLVED |

INFERENCE: Without a proxy, Chromium cannot resolve any names on the --internal network (denied fixture is on falcon-out, unreachable). Bypass flags do not help because the network itself blocks egress. QUIC does not bypass the --internal network constraint. `<-loopback>` bypass still routes non-loopback through the proxy which denies them. Network isolation is the authoritative boundary, not proxy flags.

## Phase 4: Proxy Failure (3 reps each)

OBSERVED:

| Scenario | Result |
|----------|--------|
| Garbage proxy (returns invalid HTTP) | ERR_INVALID_HTTP_RESPONSE |
| Hanging proxy (accepts, never responds) | Timeout (8s) |
| Unreachable proxy (nothing listening) | ERR_PROXY_CONNECTION_FAILED |

INFERENCE: No direct fallback when proxy fails. Chromium does not attempt direct connections when the proxy is broken. Fail-closed confirmed.

## Phase 5: Proxy Bypass Attempts

OBSERVED:

| Attack | Status | Escaped? |
|--------|--------|----------|
| CONNECT denied-host:8080 | 403 | NO |
| CONNECT allowed-host:25 | 403 | NO |
| CONNECT allowed-host:22 | 403 | NO |
| Absolute-URI to denied | 403 | NO |
| Host-header trick (URL=allowed, Host=denied) | 200 | NO (reached allowed fixture, not denied) |
| IPv6 literal [::1]:80 | 403 | NO |
| Decimal IP 2130706433 | 403 | NO |
| Octal IP 0177.0.0.1 | 403 | NO |
| Link-local 169.254.169.254 | 403 | NO |
| host.docker.internal | 403 | NO |

INFERENCE: Proxy allowlist blocked all direct bypass attempts. The Host-header trick reached the allowed fixture (the proxy routes by URL, not Host header), which is correct behavior -- no request reached the denied fixture.

## Docker Commands Used

```bash
docker network create --internal falcon-iso
docker network create falcon-out
docker run -d --name netw-allowed --network falcon-out -e FIXTURE_LABEL=allowed -e FIXTURE_PORT=8080 -e FIXTURE_TLS_PORT=8443 -e FIXTURE_CERT=/app/cert.pem -e FIXTURE_KEY=/app/key.pem -v .../fixture.js:/app/fixture.js:ro -v .../tls-cert.pem:/app/cert.pem:ro -v .../tls-key.pem:/app/key.pem:ro IMAGE node /app/fixture.js
docker run -d --name netw-denied --network falcon-out -e FIXTURE_LABEL=denied -e FIXTURE_PORT=8080 -v .../fixture.js:/app/fixture.js:ro IMAGE node /app/fixture.js
docker run -d --name netw-proxy --network falcon-out -e PROXY_ALLOWED_HOST=netw-allowed -e PROXY_ALLOWED_PORT=8080 -e PROXY_ALLOWED_TLS_PORT=8443 -e PROXY_PORT=3128 -v .../proxy.js:/app/proxy.js:ro IMAGE node /app/proxy.js
docker network connect falcon-iso netw-proxy
docker run --name netw-runner24 --network falcon-iso [env vars] IMAGE node /app/runner.js
docker run --name netw-runner --network falcon-iso [env vars] IMAGE /opt/node22/bin/node /app/runner.js
```

## Caveats

1. **arm64 Docker Desktop VM**: This measurement ran on macOS Docker Desktop (linux/arm64 VM), NOT on the GitHub Actions x64 runner (ubuntu-latest). The `--internal` network behavior is enforced by the Linux kernel iptables/nftables rules inside the Docker Desktop VM; the macOS host networking stack is not involved. The x64 runner uses a real Linux host where the same `--internal` network semantics apply, but kernel version and iptables configuration may differ.

2. **DNS behavior**: On `--internal` networks, Docker's embedded DNS server returns EAI_AGAIN for containers not on the same network. This is the mechanism that prevents name resolution of denied/external hosts from the runner. On a non-Docker-Desktop Linux host, the embedded DNS behavior is identical per Docker documentation but was not independently verified.

3. **Host-header trick**: The proxy routes by URL, not Host header. A more hardened proxy could validate Host header matches the URL hostname. This is defense-in-depth, not an escape, since the request reached the allowed fixture (correct behavior).

## What Was NOT Measured

- **data: worker**: Not tested as a separate Chromium case (data: URIs for Worker constructors are restricted in modern Chromium; blob: worker was tested as the equivalent)
- **Service Worker WebSocket**: Not tested (service worker registration requires HTTPS or localhost; the fixture serves plain HTTP through the proxy)
- **DNS rebinding**: Docker's embedded DNS on --internal networks prevents external name resolution, making traditional DNS rebinding untestable in this topology
- **Redirect from allowed to denied origin**: Not tested at the HTTP redirect level (only noted as inherently proxy-gated since each subrequest goes through the proxy)
- **WebTransport/HTTP3**: Not tested (requires QUIC which is blocked at the network level)
- **Real proxy stop/kill mid-request**: Phase 4 tested proxy failure at startup (garbage/hang/unreachable) but did not stop the real proxy mid-session

## Conclusion

OBSERVED: Docker `--internal` network + allowlist proxy contains ALL tested Chromium network channels (page, fetch, ws, wss, dedicated worker, nested worker, blob worker, module worker WebSockets) with no direct fallback. Zero requests reached the denied fixture across 5 phases, 2 Node versions (22+24), 3 repetitions per decisive case.

INFERENCE: This topology is viable for Falcon CI network containment. The network boundary (not the proxy) is the authoritative enforcement layer; the proxy provides allowlisting within the reachable set.
