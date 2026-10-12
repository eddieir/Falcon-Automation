# Phase 17 Security Threat Model

Status: verdict **APPROVE WITH CONDITIONS** (ADR-0017, ADR-0018). Base commit: `023917306d28f85e677c866dedf48b77a2165beb`. Signed: OD-1=1a, OD-3=off, OD-5=enum, OD-6=yes, Entra ID unsupported.

## 1. Provider Security (ADR-0017)

Requirements S-01 through S-18 (source: Sec-00-requirements.md) are mandatory.

| ID | Requirement | Enforced/Tested |
|----|---|---|
| **S-01** | EndpointPolicy always-deny: cloud metadata (169.254/16, fe80::/10, Azure 168.63.129.16, Alibaba 100.100.100.200, AWS IPv6 fd00:ec2::254), loopback 0.0.0.0/8 and ::, multicast 224/4, broadcast 255.255.255.255, TEST, NAT64 64:ff9b::/96, 6to4 2002::/16, Teredo 2001::/32, deprecated fec0::/10; parse with WHATWG URL; reject IPv6 zone IDs, uppercase localhost w/o loopback opt-in, unsafe ports. | `src/core/llm/transport/EndpointPolicy.js`; test: `tests/regression/p17-endpoint-policy.check.cjs` |
| **S-02** | Pin validated IP in the same lookup the socket uses; all resolved addresses must pass policy; no redirects; Location never logged. Test rebinding double. | `guardedFetch` DNS callback pinning; test: `tests/regression/p17-endpoint-policy.check.cjs` |
| **S-03** | No proxy: dedicated https.Agent without proxy env; test HTTP_PROXY/ALL_PROXY/NODE_USE_ENV_PROXY at decoy → 0 requests. | `src/core/llm/transport/guardedFetch.js`; test: `tests/regression/p17-sdk-transport.check.cjs` |
| **S-04** | Accept-Encoding: identity; Content-Encoding != identity → MALFORMED_RESPONSE; reject early on Content-Length > cap; count bytes per chunk; >cap → OVERSIZED; 10MB body does not grow memory. | `guardedFetch`; test: `tests/regression/p17-bounds.check.cjs` |
| **S-05** | Budget counts HTTP attempts, not calls; 400/401/403 never retried; Retry-After clamped 2000ms. Document ceiling: workers × budget (~150 with 3 Phase 16 shards). | `RetryPolicy`; test: `tests/regression/p17-bounds.check.cjs` |
| **S-06** | Per-attempt TIMEOUT within T+1s; document worst case ~attempts × T + backoff. | `guardedFetch` AbortSignal; test: `tests/regression/p17-bounds.check.cjs` |
| **S-07** | rejectUnauthorized:true explicit; servername=hostname never IP; self-signed loopback still NETWORK_ERROR unless NODE_EXTRA_CA_CERTS. | `guardedFetch`; test: `tests/regression/p17-sdk-transport.check.cjs` |
| **S-08** | Provider fields ignored; only `/^\d{1,3}$/` parsed for range. | `AIHealer.js` numeric-only parse; test: `tests/regression/p17-healer-provider.check.cjs` |
| **S-09** | Cap 20 candidates & 8 KiB UTF-8 bytes (Buffer.byteLength); drop whole trailing candidates. DOM collection still 60. | `getAlternativeSelector` slice + byte cap; test: `tests/regression/p17-bounds.check.cjs` |
| **S-10** | Telemetry rebuilt field-by-field; modelLabel validated `^[A-Za-z0-9._:/-]{1,64}$`; token counts safe integers. | `LlmTelemetry.js`; test: `tests/regression/p17-config.check.cjs` |
| **S-11** | OPENAI_API_KEY read **only** for provider=openai when FALCON_LLM_API_KEY unset. Marker in it with openai-compatible/azure-openai never reaches mock. Only selected provider's creds read. | `LlmConfig.js` credential bridge; test: `tests/regression/p17-config.check.cjs` |
| **S-12** | SDK pinned (apiKey, baseURL, organization:null, project:null, maxRetries:0, timeout, fetch). Decoy test with OPENAI_BASE_URL/ORG_ID/PROJECT_ID/ADMIN_KEY → 0 requests, no OpenAI-Organization/OpenAI-Project headers. | `src/core/llm/providers/OpenAIProvider.js`; test: `tests/regression/p17-sdk-transport.check.cjs` |
| **S-13** | Response handed to SDK carries allowlisted headers only (content-type, retry-after). | `guardedFetch` response filtering; test: `tests/regression/p17-sdk-transport.check.cjs` |
| **S-14** | Unknown FALCON_LLM_* key names logged with control chars stripped, capped 64 chars. | `LlmConfig.js`; test: `tests/regression/p17-config.check.cjs` |
| **S-15** | SDK logger OFF (logLevel 'off'/no-op); with OPENAI_LOG=debug markers appear 0 times on stdout/stderr. | `OpenAIProvider.js` initialization; test: `tests/regression/p17-sdk-transport.check.cjs` |
| **S-16** | modelLabel and errorCode HTML-escaped in report and dashboard. | `HealingReport.js` encoding; test: `tests/regression/p17-pc-redact.check.cjs` |
| **S-17** | Catch-all logs fixed code + error class only, never err.message (page.evaluate errors can contain DOM text). | `AIHealer.js`; test: `tests/regression/p17-healer-provider.check.cjs` |
| **S-18** | No CI step holds LLM secret; grep -c OPENAI_API_KEY .github/workflows/ci.yml == 0; no FALCON_LLM_* secrets in CI. | `.github/workflows/ci.yml` (4 steps modified); verified at sign-off |

**Provider error codes** (frozen, closed enumeration):
CONFIG_PROVIDER_REQUIRED, CONFIG_UNSUPPORTED_PROVIDER, CONFIG_CONFLICT, CONFIG_MISSING_CREDENTIALS, CONFIG_INVALID, CONFIG_ENDPOINT_OPT_IN_REQUIRED, PROVIDER_DISABLED, ENDPOINT_POLICY_REJECTED, REDIRECT_REJECTED, BUDGET_EXHAUSTED, AUTH_FAILED, BAD_REQUEST, RATE_LIMITED, PROVIDER_ERROR, TIMEOUT, NETWORK_ERROR, MALFORMED_RESPONSE, OVERSIZED, UNSUPPORTED_CAPABILITY.

**Planted markers** (0 occurrences; tested in redaction suite):
1. FALCON_LLM_API_KEY value
2. OPENAI_API_KEY value
3. Full "Bearer <key>"
4. DOM text outside candidates (hidden div, script, comment, password value, meta)
5. Cookie/localStorage values
6. Unrelated env token (DB_PASS style)
7. Token in endpoint userinfo or query
8. Token in originalSelector/description (allowed in payload, 0 in logs)
9. Token in provider 4xx/5xx error body
10. Token in 302 Location
11. Token in Azure resource name
12. Token in arbitrary response header
13. Token in page.evaluate error message
14. Tokens in OPENAI_ORG_ID/OPENAI_PROJECT_ID (also never sent)

## 2. Dashboard Security (ADR-0018)

Requirements D-01 through D-24 (source: Sec-00b-dashboard-requirements.md) are mandatory.

| ID | Requirement | Enforced/Tested |
|----|---|---|
| **D-01** | Hash chain: each event has prevHash = sha256 of previous line; reader flags TAMPERED on break / dup / gapped seq; --verify exits 5. | `EventReader.js`; test: `tests/regression/p17-pc-redact.check.cjs` |
| **D-02** | UI label "ledger-asserted, not authenticated"; HUMAN OWNER to add deny rules for non-coordinator agent writes to `.git/production-cycle/**`. Test raw append → TAMPERED. | Recommendation in `docs/architecture/phase-17-production-cycle-dashboard.md`; test: `tests/regression/p17-pc-schema.check.cjs` |
| **D-03** | Server runs Redact.scan on every event it reads (not only CLI); failures counted, never rendered. | `Server.js` EventReader; test: `tests/regression/p17-pc-redact.check.cjs` |
| **D-04** | All Redact/validator patterns applied only after 4096-byte cap, no nested/adjacent overlapping quantifiers; DOM-dump = single-pass counter, not regex. Adversarial strings <50ms. | `Redact.js`; test: `tests/regression/p17-pc-redact.check.cjs` (ReDoS test) |
| **D-05** | Redact only on free-text fields (summary, openRisks, requestedLabel); valid 40-hex targetRevision accepted. | `EventValidator.js` field mapping; test: `tests/regression/p17-pc-schema.check.cjs` |
| **D-06** | Run-id also rejects trailing ".", Windows device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9, case-insensitive), leading "-"; lstat production-cycle dir not symlink & owner=uid; events.jsonl nlink===1. | `RunPaths.js`; test: `tests/regression/p17-pc-runpaths.check.cjs` |
| **D-07** | Open O_RDONLY\|O_NOFOLLOW; fstat dev/ino == startup lstat; on inode change full re-check, mismatch → 403 and stop serving. | `EventReader.js`; test: `tests/regression/p17-pc-routes.check.cjs` |
| **D-08** | "Unrecognized" lane shows only count, line number, byte length—never content. | `Server.js` JSON response; test: `tests/regression/p17-pc-routes.check.cjs` |
| **D-09** | Never send partialBytes content. | `EventReader.js` JSON; test: `tests/regression/p17-pc-reader.check.cjs` |
| **D-10** | Build objects field-by-field on Object.create(null); reject __proto__/constructor/prototype; length check before parse, types after. | `EventValidator.js`; test: `tests/regression/p17-pc-schema.check.cjs` |
| **D-11** | Every request: reject missing/non-allowlisted Host; reject Origin present but not same-origin; reject Sec-Fetch-Site not same-origin\|none; reject Sec-Fetch-Mode: navigate for /api/*; all BEFORE rate bucket; application/json; charset=utf-8. | `Server.js` middleware; test: `tests/regression/p17-pc-server-security.check.cjs` |
| **D-12** | Single combined polling endpoint OR bucket >=600/min; rejected cross-site requests do not consume bucket; test 2 tabs 60s → 0x429. | `Server.js` rate limiter; test: `tests/regression/p17-pc-server-security.check.cjs` |
| **D-13** | maxConnections + headersTimeout < requestTimeout; slowloris socket closed <5s. | `Server.js` http.createServer options; test: `tests/regression/p17-pc-server-security.check.cjs` |
| **D-14** | Lock contents {pid, startTime, hostname, nonce}; before breaking re-read same inode+nonce; break by rename to unique name; after acquire re-check last seq. CLI --break-lock. | `EventLog.js` append primitive; test: `tests/regression/p17-pc-append.check.cjs` |
| **D-15** | Validator rejects U+2028/2029, U+200B-200F, U+202A-202E, U+2066-2069, U+061C, U+FEFF in all strings; OutputSafe.sanitizeField gets same list (regression test). | `EventValidator.js`, `src/core/util/OutputSafe.js`; test: `tests/regression/p17-outputsafe-unicode.check.cjs` |
| **D-16** | evidenceRefs never rendered as href. | `src/production-cycle/ui/index.html` textContent only; test: `tests/regression/p17-pc-ui-static.check.cjs` |
| **D-17** | nonce = crypto.randomBytes(16) base64 NEW PER RESPONSE; static test no style= attributes, no nonce reuse. | `Server.js` CSP generation; test: `tests/regression/p17-pc-ui-static.check.cjs` |
| **D-18** | Static test CSP header string exact. | Test: `tests/regression/p17-pc-ui-static.check.cjs` |
| **D-19** | REMOVE --allow-remote: non-loopback --host exits 1 (coordinator decision: mandate only required opt-in+auth IF ever allowed). | `scripts/production-cycle/dashboard.js` argument handling; test: `tests/regression/p17-pc-cli.check.cjs` |
| **D-20** | Ledger dir 0700, files 0600 (umask at creation); test with stat. | `EventLog.js`, `RunPaths.js` initialization; test: `tests/regression/p17-pc-routes.check.cjs` |
| **D-21** | Error responses fixed code only, never path/value. | `Server.js` handlers; test: `tests/regression/p17-pc-routes.check.cjs` |
| **D-22** | Hostile packet FALCONMARK06 via CLI: refused OR JSON-escaped in /api/state and shown as text, window.__xss undefined. | `Redact.js`, `Server.js`; test: `tests/regression/p17-pc-redact.check.cjs`, `tests/regression/p17-pc-server-security.check.cjs` |
| **D-23** | Each new test file <=5s on mkdtemp (CI cost). | `tests/regression/p17-pc-*.check.cjs`; test runner checks elapsed time |
| **D-24** | Only Sec-01 re-verifies at final head. | Sign-off: Security Engineer to re-check at final review commit |

**Dashboard error codes** (reference):
SCHEMA_* (validator errors, never echoes values), LOCK_TIMEOUT, LEDGER_FULL.

**Planted markers** (0 occurrences in ledger bytes, API, HTML, stderr, errors):
M01–M12 as per provider threat model, plus:
- M07: Secret written to file bypassing CLI
- M08: Secret in malformed line
- M09: Secret in trailing partial line
- M10: U+2028 line forge
- M11: __proto__ key
- M12: Marker inside evidenceRef

## 3. Acceptance sign-off

- **OD-1=1a** (conditions: S-11; CONFIG_PROVIDER_REQUIRED warned once per process; CHANGELOG names breaking change).
- **OD-3=off** (ALLOW_PRIVATE_ENDPOINT default off; single configured host only; metadata/link-local always denied).
- **OD-5=enum** (provider derived from validated RESOLVED ADDRESS, not hostname strings).
- **OD-6=yes** ("none" alias for disabled accepted).
- **AIAnalyser removal**: Public-interface change (AC17) documented.
- **OPENAI_API_KEY removal**: From 4 CI steps (owner should delete/rotate repo secret).
- **Entra ID unsupported**: Docs state "unsupported"; no @azure/identity dependency.

## 4. Known residual risks

1. **R1 (CLI forgery)**: Different --from-role not preventable by hash chain; mitigation: owner deny-rules on `.git/production-cycle/**`.
2. **R2 (short secrets)**: Patterns do not detect short/unprefixed secrets; mitigation: secrets should follow known patterns (sk-, api_, etc.).
3. **R3 (Azure v1 verified against mock)**: Production deployments must be tested by operators; not verified on real Azure.
4. **R4 (Cooperating public-host SSRF)**: Accepted residual risk when custom endpoints enabled; opt-in required.
5. **R5 (Prompt cap 60→20)**: May shift outcomes; benchmark before/after advised; tension with AC17.

## 4a. Resolved

- **R5 (OutputSafe Unicode, D-15)**: Fixed; sanitizeField now strips U+2028/2029, U+200B-U+200F, U+061C, U+FEFF (test: p17-outputsafe-unicode.check.cjs).

## 5. Out of scope

- User authentication/authorization for the dashboard (the server is loopback-only; there is no remote mode and no token).
- Healing quality or outcome bias introduced by provider selection.

## 5a. Scan evidence: baseline versus final

Baseline is the base commit `0239173`; final is the Phase 17 head. A scanner that could not run is reported as BLOCKED / NOT RUN and is never counted as a pass.

| Check | Baseline | Final | Disposition |
|---|---|---|---|
| `npm audit --audit-level=high` | 0 vulnerabilities | 0 vulnerabilities | Pass |
| Snyk `test --all-projects --dev` | 261 dependencies, 0 vulnerable paths | 261 dependencies, 0 vulnerable paths | Pass (no dependency changed) |
| Snyk Code (`snyk code test`) | BLOCKED / NOT RUN: organisation not enabled (SNYK-CODE-0005, 403) | BLOCKED / NOT RUN, same reason | Prevents an unconditional GO until the owner enables it or accepts the gap |
| Snyk IaC and container | Not applicable: no IaC or container files | Not applicable | n/a |
| TruffleHog | 0 verified, 0 unverified (committed content) | 0 verified; 6 unverified, all fake `user:pass@host` fixtures in test files | Pass; fixtures only |
| gitleaks (working tree) | 3 findings | 3 findings, identical | No new finding (two are git-ignored paths; one is the deliberate fake key in a redaction test) |
| gitleaks (history) | 5 findings | 5 findings, identical | No new finding |
| CodeQL (hosted) | 0 alerts on `0239173` | 3 high alerts on the first PR head, all in test code; fixed and re-run is recorded in the PR | See the PR for the re-run result |

The three CodeQL findings were fixed rather than dismissed: an incomplete escape in a redaction test (now `JSON.stringify`), comment stripping that did not repeat until stable (now repeats), and a test that set `NODE_TLS_REJECT_UNAUTHORIZED` on the test process (now runs the relaxed environment in a child process and asserts `rejectUnauthorized` is still `true`).

## Test index

| Test file | Coverage |
|---|---|
| `p17-provider-contract.check.cjs` | Provider interface schema |
| `p17-isolation.check.cjs` | Three loopback servers, zero cross-talk |
| `p17-sdk-transport.check.cjs` | SDK pinning, decoy server, redirect/oversize/hang |
| `p17-config.check.cjs` | Config validation, conflict detection |
| `p17-endpoint-policy.check.cjs` | SSRF table, IP denial, DNS rebinding |
| `p17-bounds.check.cjs` | Prompt slicing, response size, timeout, budget |
| `p17-healer-provider.check.cjs` | AC08/S-17 planted-marker absence from prompt, request, logs and report rows |
| `p17-healer-provider.check.cjs` | Healing flow with provider |
| `p17-pc-schema.check.cjs` | Event schema, validator, forbidden keys |
| `p17-pc-append.check.cjs` | Concurrent append, lock, seq guarantee |
| `p17-pc-cli.check.cjs` | CLI flags, dry-run, exit codes |
| `p17-pc-routes.check.cjs` | Server endpoints, status codes, inode checks |
| `p17-pc-reader.check.cjs` | EventReader delta, partial lines, dedup |
| `p17-pc-redact.check.cjs` | Redact patterns, ReDoS, FALCONMARK |
| `p17-pc-ui-static.check.cjs` | CSP, nonce, no innerHTML/script |
| `p17-pc-server-security.check.cjs` | Headers, rate limiting, Sec-Fetch |
| `p17-pc-runpaths.check.cjs` | Run-id validation, symlink checks, chmod |
| `p17-outputsafe-unicode.check.cjs` | Unicode sanitization (D-15) |

All loopback-only; no external site calls; each <=5s.
