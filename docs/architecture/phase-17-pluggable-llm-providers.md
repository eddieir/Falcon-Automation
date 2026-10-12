# Phase 17 Architecture: Pluggable LLM Providers

Status: implemented on branch `phase-17/pluggable-llm-providers` (no merge claim). Base commit: `023917306d28f85e677c866dedf48b77a2165beb`. Risk tier: full. Acceptance criteria: P17-AC18 (accurate docs), AC10, AC14.

## 1. Context and constraints

Falcon's Tier-3 healing invokes a language model to suggest locator fixes. Earlier releases hardcoded the OpenAI SDK with `OPENAI_API_KEY` as the only credential source. Phase 17 replaces this with a pluggable provider registry supporting OpenAI, Azure OpenAI, and custom-endpoint models, with explicit configuration and a disabled mode.

Key constraints:
- Only bounded locally-built candidate descriptors cross page-to-model; never raw DOM, cookies, env, or error text.
- Exactly one egress chokepoint (`guardedFetch`) owned by Falcon, not SDK environment defaults.
- Configuration validation rejects unknown keys with logged warnings, not exceptions.
- Transport layer (IP validation, redirect rejection, size/timeout caps) enforced before any provider call.
- Provider interface is frozen; error codes are closed and versioned.

## 2. Invariants and trust boundaries

**I1.** Provider selection happens once per process and is memoized; `FALCON_LLM_PROVIDER` must be set explicitly (blank or missing → `CONFIG_PROVIDER_REQUIRED`).

**I2.** `OPENAI_API_KEY` is read only as a credential source for `provider=openai` when `FALCON_LLM_API_KEY` is unset; the legacy key alone does not select a provider.

**I3.** Only numeric responses pass through the Tier-2 range check; all provider JSON fields (e.g., `approved:true`) are never read.

**I4.** Logs, reports, and ledger carry an allowlist only: provider name, model label, endpoint class, latency, attempts, outcome, error code (never prompt text, URLs, or provider error bodies).

## 3. Flow

1. `getAlternativeSelector` slices the prompt candidate list to `maxPromptCandidates` (20 by default) and caps the payload at `promptMaxBytes` (8 KiB UTF-8).
2. `provider = Registry.resolve(config)` is invoked and memoized per process; unknown provider names are rejected at startup.
3. `provider.canSend()` checks budget and endpoint policy **before** recording any tier-3 invocation, so locally-refused calls do not inflate counters.
4. `provider.complete({prompt, maxOutputTokens:80, temperature:0})` never throws for provider/transport conditions; it returns `{ok:true, ...}` or `{ok:false, errorCode, ...}`.
5. HealingTrust and HealingReport record only allowlisted telemetry fields (Section 6).

## 4. Provider interface and ownership

File: `src/core/llm/LlmProvider.js` (base class); implementations in `src/core/llm/providers/`.

```
class LlmProvider {
  id: string                          // openai, azure-openai, openai-compatible, disabled
  modelLabel: string                  // validated ^[A-Za-z0-9._:/-]{1,64}$
  endpointClass: string               // openai_public, azure, custom_loopback, custom_private, custom_public
  async complete(request): LlmResult   // request: {prompt, maxOutputTokens, temperature}
  async close(): void
}

type LlmResult =
  | {ok: true, text, provider, modelLabel, latencyMs, attempts, usage: {promptTokens, completionTokens}}
  | {ok: false, errorCode, provider, modelLabel, latencyMs, attempts, retryable}
```

**Ownership:**
- `LlmProvider`, `LlmProviderRegistry`, `LlmConfig`: define interface and configuration.
- `src/core/llm/transport/guardedFetch`: HTTP enforcement (Section 5).
- `src/core/llm/transport/EndpointPolicy`: IP validation, SSRF defense.
- Individual provider implementations: protocol binding.
- `AIHealer.js`: calls `provider.complete()`; logs error code only (not message body).
- `HealingReport.js`: appends allowlisted fields.

## 5. Transport guard

`guardedFetch` (no undici dependency; uses Node.js `http` and `https` with `node:dns`):

- **Protocol**: HTTPS only, except for loopback HTTP (opt-in with `FALCON_LLM_ALLOW_HTTP_LOOPBACK`).
- **URL validation**: POST only; path `/chat/completions` relative to base URL; no query string, fragment, userinfo, or unsafe ports. Base URL must end `/v1`.
- **IP validation**: `dns.lookup()` resolves all addresses; denies 169.254/16 (AWS metadata), fe80::/10 (link-local), Azure 168.63.129.16, Alibaba 100.100.100.200, AWS IPv6 fd00:ec2::254 always. Allows loopback (127/8, ::1) and private (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7) only when opted in. DNS-rebinding defense: pins the validated IP via lookup callback; Host header always equals hostname.
- **Redirect policy**: 3xx responses rejected as `REDIRECT_REJECTED`; Location header never logged.
- **Response handling**: Accept-Encoding set to `identity` only; any Content-Encoding != identity returns `MALFORMED_RESPONSE`. Bytes counted per chunk; exceeding `maxResponseBytes` (default 65 KiB) returns `OVERSIZED`. Request timeout (default 10 s) aborts DNS, connect, TLS, and body reads.
- **No proxy support**: Dedicated `https.Agent` without proxy environment variables; `HTTP_PROXY`, `ALL_PROXY`, `NODE_USE_ENV_PROXY` are ignored.
- **TLS verification**: `rejectUnauthorized:true` explicit; overrides `NODE_TLS_REJECT_UNAUTHORIZED=0`. Self-signed loopback certificates still fail unless `NODE_EXTRA_CA_CERTS` is set.

## 6. Configuration table

All settings via environment variables; validated by `ConfigManager.get()`:

| Key | Type | Default | Range | Notes |
|---|---|---|---|---|
| `FALCON_LLM_PROVIDER` | string (enum) | (required) | `openai`, `azure-openai`, `openai-compatible`, `disabled` | Case-sensitive; blank rejected. Selects provider. |
| `FALCON_LLM_API_KEY` | string | (unset) | — | Credential for provider. If unset, `OPENAI_API_KEY` read for `provider=openai` only. |
| `FALCON_LLM_MODEL` | string | `gpt-4o-mini` | — | Model identifier. For Azure, sent as deployment name; for others, sent as model param. |
| `FALCON_LLM_ENDPOINT` | string | (unset) | Absolute URL ending `/v1` | Custom endpoint. Requires `FALCON_LLM_ALLOW_CUSTOM_ENDPOINT=true`. |
| `FALCON_LLM_ALLOW_CUSTOM_ENDPOINT` | string | (unset) | Exactly `true` | Opt-in for custom endpoints. Ignored if provider != `openai-compatible`. |
| `FALCON_LLM_AZURE_RESOURCE` | string | (unset) | `[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?` | Azure resource name. Requires `provider=azure-openai`. |
| `FALCON_LLM_AZURE_DEPLOYMENT` | string | (unset) | — | Sent as model in request. Requires `provider=azure-openai`. |
| `FALCON_LLM_AZURE_HOST_SUFFIX` | string | (required for azure-openai) | `openai.azure.com`, `services.ai.azure.com` | Azure endpoint suffix. |
| `FALCON_LLM_ALLOW_HTTP_LOOPBACK` | string | (unset) | Exactly `true` | Opt-in for plain HTTP on `127.0.0.1`, `localhost`, or `::1`. |
| `FALCON_LLM_ALLOW_PRIVATE_ENDPOINT` | string | (unset) | Exactly `true` | Opt-in for RFC 1918 addresses (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7). Default: off. |
| `FALCON_LLM_TIMEOUT_MS` | integer | `10000` | 1000–60000 | Per-attempt timeout. |
| `FALCON_LLM_MAX_ATTEMPTS` | integer | `2` | 1–3 | Retry attempts for transient errors. |
| `FALCON_LLM_RUN_BUDGET` | integer | `50` | 1–500 | Max HTTP requests per process. Effective ceiling under Phase 16 parallel: budget × workers. |
| `FALCON_LLM_MAX_RESPONSE_BYTES` | integer | `65536` | 4096–1048576 | Reject responses larger than this. |
| `FALCON_LLM_MAX_PROMPT_CANDIDATES` | integer | `20` | 1–60 | Slice prompt candidates to this count. |
| `FALCON_LLM_CONCURRENCY` | integer | `2` | 1–4 | In-flight requests (semaphore). |

**Conflict rules**: `CONFIG_CONFLICT` if:
- Any `AZURE_*` key set when `provider != azure-openai`.
- `ENDPOINT` or `ALLOW_CUSTOM` set when `provider != openai-compatible`.
- `MODEL` and `AZURE_DEPLOYMENT` both set.
- Any `FALCON_LLM_*` key set when `provider=disabled`.
- `ALLOW_HTTP_LOOPBACK=true` with HTTPS endpoint (safety check).

Unknown `FALCON_LLM_*` keys trigger a logged warning; they do not block startup.

## 7. Legacy OPENAI_API_KEY decision

**Breaking change:** `OPENAI_API_KEY` alone no longer selects or enables healing. If set, it is read as a credential source **only if** `FALCON_LLM_API_KEY` is unset **and** `provider=openai` is explicitly configured. Otherwise, healing is disabled.

**Rationale:** Explicit provider selection prevents silent fallback and reduces the surface for misconfiguration.

**Rollback:** Restore pre-Phase-17 behavior with `FALCON_LLM_PROVIDER=disabled` (no healing) or `git revert` to the pre-Phase-17 HEAD. CI secret (the repo's `OPENAI_API_KEY` secret) should be deleted or rotated by the operator.

**Deprecation note:** Changelog documents this as a breaking change for users relying on `OPENAI_API_KEY` alone.

## 8. Azure OpenAI v1 semantics

**Base URL construction:** `https://<resource>.<host_suffix>/openai/deployments/<deployment>/chat/completions?api-version=2024-10-21`.

**Authentication:** Bearer token via `Authorization` header (key auth only; Entra ID unsupported).

**Model parameter:** The `model` field in the request body is the deployment name, not a model identifier.

**Known limitations:** Azure v1 chat-completions endpoint verified against a mock server only; production deployments must be tested by operators.

## 9. Retry and budget bounds

- **Retry attempts**: Only transient errors (RATE_LIMITED, PROVIDER_ERROR, TIMEOUT, NETWORK_ERROR) are retried. Auth failures (401, 403) and client errors (400, 404, 422) fail immediately.
- **Backoff**: 500 ms, 1000 ms, capped at 2000 ms; no jitter.
- **Retry-After header**: Clamped to 2000 ms if present.
- **Budget counts HTTP attempts, not calls**: One semantic request may trigger multiple HTTP attempts.
- **Per-process ceiling**: With Phase 16 parallel execution (up to 3 shards), effective ceiling = `FALCON_LLM_RUN_BUDGET` × number of workers. Operators must size accordingly (budget ~50 per process × 3 workers ≈ 150 total).

## 10. Telemetry allowlist

Only these fields are recorded in HealingReport and dashboard:

- `provider` (string: openai, azure-openai, openai-compatible, disabled)
- `modelLabel` (string)
- `endpointClass` (string: openai_public, azure, custom_loopback, custom_private, custom_public)
- `latencyMs` (integer)
- `attempts` (integer)
- `outcome` (string: success, rate_limited, auth_failed, bad_request, provider_error, timeout, network_error, oversized, redirect_rejected, budget_exhausted, endpoint_policy_rejected, config_error, disabled)
- `errorCode` (string or null)
- `promptTokens`, `completionTokens` (safe integers or null)

**Never recorded**: prompt text, DOM content, URLs, API keys, provider error message bodies.

## 11. Prompt bounds

- **Candidate count**: Sliced to `FALCON_LLM_MAX_PROMPT_CANDIDATES` (default 20, max 60).
- **Payload size**: Capped at `promptMaxBytes` (8 KiB UTF-8 bytes); whole trailing candidates dropped if over limit.
- **DOM collection**: Still collected up to 60 elements per page (unchanged from Phase 16).

Benchmark tests measure total candidates sent, not healing quality.

## 12. AIAnalyser removal

`src/core/AIHealer/AIAnalyser.js` is deleted. This class was a second egress path for debugging; it read raw error text and performed duplicate analysis outside the provider interface. Removal is documented as a public-interface change (AC17).

## 13. Test strategy

All tests in `tests/regression/p17-*.check.cjs`, using `loopback only` servers:

- **p17-provider-contract**: Provider implementations return correct schema.
- **p17-isolation**: Three loopback mock servers; zero cross-talk.
- **p17-sdk-transport**: Replaces `openai-sdk.check.cjs`; adds decoy server with OPENAI_BASE_URL/ORG_ID/PROJECT_ID/ADMIN_KEY (verifies 0 requests to decoy).
- **p17-config**: Config validation, conflict detection, unknown keys.
- **p17-endpoint-policy**: SSRF table; IP denial; DNS rebinding defense (double-resolution test).
- **p17-bounds**: Prompt slicing, response size, timeout, budget exhaustion.
- **p17-redaction**: Secret fields absent from logs, reports, ledger.
- **p17-no-provider**: `FALCON_LLM_PROVIDER=disabled` → zero requests.

## 14. Benchmark provider dimension

`HealingBenchmark` adds rows for each provider + mock (e.g., `provider:openai@mock`). Claim scope: **"protocol compatibility only, not healing quality."** Mock rows are excluded from quality denominators. The cap-20 candidate coverage metric is **not** measured as a quality metric.

## 15. Known limitations

1. **Azure v1 chat-completions**: Verified against a mock server only; production deployments must be tested.
2. **Custom-endpoint DNS names**: The `compatible-endpoint` class label is best-effort for DNS names; operators must ensure stable resolution.
3. **Public-host SSRF**: Cooperating public hosts (e.g., a test server in your CI infrastructure) are an accepted residual risk when `FALCON_LLM_ALLOW_CUSTOM_ENDPOINT=true`.
4. **Proxies unsupported**: Corporate proxy environments cannot be used; `HTTP_PROXY` and `ALL_PROXY` are ignored.
5. **Timeout worst case**: Under retry, worst-case latency ≈ attempts × (timeout + backoff).

## Files affected

**New:**
- `src/core/llm/LlmProvider.js`, `LlmProviderRegistry.js`, `LlmConfig.js`, `RetryPolicy.js`, `LlmBudget.js`, `LlmTelemetry.js`
- `src/core/llm/transport/guardedFetch.js`, `EndpointPolicy.js`
- `src/core/llm/providers/OpenAIProvider.js`, `AzureOpenAIProvider.js`, `OpenAICompatibleProvider.js`, `DisabledProvider.js`

**Modified:**
- `src/core/AIHealer.js` (calls provider.complete; logs error code only)
- `src/core/HealingReport.js` (appends allowlisted telemetry)
- `src/core/locator/HealingBenchmark.js` (adds provider dimension)
- `.env.example` (add FALCON_LLM_* keys)
- `.github/workflows/ci.yml` (remove OPENAI_API_KEY from steps)
- `package.json` (no new dependencies)

**Deleted:**
- `src/core/AIHealer/AIAnalyser.js`
- `tests/regression/openai-sdk.check.cjs` (replaced by p17-sdk-transport)
