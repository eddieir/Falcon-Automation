# Maintenance: BYOK Invocation-Scoped LLM Providers

Practical task-oriented guide for operators configuring Falcon to use their own LLM provider account (BYOK) and selecting a provider per test invocation.

## What BYOK Means

Bring Your Own Key (BYOK): Falcon does not ship, broker, proxy, or store your LLM API key. You provide and manage your own account with your chosen LLM provider. Your provider's retention, billing, and data policies apply to your account. Falcon sends the Tier 3 healing candidate prompt to your selected provider endpoint only—never to Falcon infrastructure or a third party.

## Provider Support Matrix

| Provider | Adapter Class | API Protocol | Model IDs | Selection | Status |
|---|---|---|---|---|---|
| **openai** | First-class | OpenAI API v1 | operator-supplied (no default limit) | CLI `--llm-provider=openai` or `FALCON_LLM_PROVIDER` | Tested with mock; live models not certified |
| **azure-openai** | First-class | Azure API v1 + resource/deployment | operator-supplied | CLI flag or `FALCON_LLM_PROVIDER` | Tested with mock; Entra ID unsupported |
| **anthropic** | First-class (new) | REST /v1/messages, guarded | operator-supplied, required | CLI flag or `FALCON_LLM_PROVIDER` | Tested with mock; no live models certified |
| **gemini** | First-class (new) | REST /v1beta/models/:generateContent, guarded | operator-supplied, required, stricter charset | CLI flag or `FALCON_LLM_PROVIDER` | Tested with mock; no live models certified |
| **openai-compatible** | First-class | Custom OpenAI-compatible endpoint (e.g. Ollama, vLLM) | operator-supplied | CLI flag, requires explicit endpoint | Requires `FALCON_LLM_ALLOW_CUSTOM_ENDPOINT=true` |
| **disabled** or blank | None | — | — | Skip Tier 3 | Tiers 1/2 remain active |

**Note:** No models are live-tested or certified. Tests use mocks only to verify protocol behavior, not model quality. Model discovery is not implemented; you must type model IDs manually. Falcon keeps no allowlist of approved model IDs and makes no certification claim about any model's healing quality — any model ID you supply for your chosen provider is passed through as-is.

## Per-Invocation Provider Selection

Falcon resolves the LLM provider once at startup from these sources (in order of precedence):

1. **Direct CLI flags** (highest precedence)
2. **Profile** (by name, if `--llm-profile=<name>` is set)
3. **`FALCON_LLM_*` environment variables** (Phase 17 compatibility layer)
4. **Defaults** (if nothing above matches)

### CLI Flag Syntax

```bash
node falcon.js --llm-profile=<name> --llm-provider=<id> --llm-model=<id> [other options]
```

**Flag format:** `--key=value` only; no spaces, no repeated keys, no key-shaped values. Keys never come from flags:

```bash
# CORRECT
export ANTHROPIC_API_KEY=<your-key>
node falcon.js --llm-provider=anthropic --llm-model=<anthropic-model-id>

# WRONG (flags hard-exit)
node falcon.js --llm-api-key=<your-key>  # REJECTED
node falcon.js --key=<your-key>         # REJECTED
```

## Provider Configuration Examples

### OpenAI

```bash
export FALCON_LLM_API_KEY=<your-key>
node falcon.js --llm-provider=openai --llm-model=<openai-model-id>
```

Keys: Set `FALCON_LLM_API_KEY` or fall back to `OPENAI_API_KEY` (Phase 17 compat). Never pass the key in CLI flags.

**Protect your key from shell history:**

```bash
read -s FALCON_LLM_API_KEY
export FALCON_LLM_API_KEY
node falcon.js --llm-provider=openai --llm-model=gpt-4o-mini
```

### Anthropic

```bash
export ANTHROPIC_API_KEY=<your-key>
node falcon.js --llm-provider=anthropic --llm-model=<anthropic-model-id>
```

Credentials: `ANTHROPIC_API_KEY` by default (or use `--llm-credential-env=<name>` to override, if supported).

### Gemini

```bash
export GEMINI_API_KEY=<your-key>
node falcon.js --llm-provider=gemini --llm-model=<gemini-model-id>
```

Credentials: `GEMINI_API_KEY` by default.

### Azure OpenAI

```bash
export FALCON_LLM_API_KEY=<your-key>
node falcon.js --llm-provider=azure-openai \
  --llm-model=gpt-4 \
  --llm-azure-resource=my-resource \
  --llm-azure-deployment=my-deployment
```

Credentials: `FALCON_LLM_API_KEY` (key-based auth only; Entra ID unsupported).

### OpenAI-Compatible Endpoint (Ollama on Loopback)

```bash
export FALCON_LLM_API_KEY=<key-if-required>
export FALCON_LLM_ALLOW_CUSTOM_ENDPOINT=true
export FALCON_LLM_ALLOW_HTTP_LOOPBACK=true
node falcon.js --llm-provider=openai-compatible \
  --llm-endpoint=http://127.0.0.1:11434/v1 \
  --llm-model=llama2
```

**Opt-in required:** Custom endpoints must explicitly enable `FALCON_LLM_ALLOW_CUSTOM_ENDPOINT=true`. HTTP is allowed only on loopback (`127.0.0.1`, `::1`) with `FALCON_LLM_ALLOW_HTTP_LOOPBACK=true`. Private IP ranges (e.g., `10.0.0.0/8`) require `FALCON_LLM_ALLOW_PRIVATE_ENDPOINT=true`.

## Running Two Invocations with Different Providers

Falcon resolves the provider once per process at startup and freezes it. To switch providers between runs:

```bash
# Run 1: OpenAI
export FALCON_LLM_API_KEY=<your-key>
node falcon.js --llm-provider=openai --llm-model=gpt-4o-mini

# Run 2: Anthropic (new shell or unset)
unset FALCON_LLM_API_KEY
export ANTHROPIC_API_KEY=<your-key>
node falcon.js --llm-provider=anthropic --llm-model=<anthropic-model-id>
```

**In-process:** Do not attempt to switch providers mid-run. Create separate processes with distinct flags and environment.

## Where the Invocation Provider Context Applies

Falcon resolves a per-invocation `providerContext` once at startup in `falcon.js` and threads the same object, by identity, through every run mode in that process — it is never rebuilt, swapped, or re-resolved from `FALCON_LLM_*` partway through a run:

- **Default whole-app run** (`node falcon.js <url>`): `providerContext` flows from `falcon.js` into `SiteSweep`, which passes it to `TestRunner.runRepeatedTestPlan` for every page it sweeps, and from there into the `AIHealer` instance used for Tier 3 healing.
- **`--single-page`**: the pre-Phase-10 single-page pipeline forwards the same `providerContext` directly to `TestRunner.runRepeatedTestPlan`, bypassing `SiteSweep` but reaching the same healer wiring.
- **In-process parallel/sharded runs** (`--workers`, `--shard`): `providerContext` is carried in `sweepOpts` into `ParallelSweep.runInJournalMode`, which builds a single `SiteSweep` for frontier discovery with that context, then passes the same context into `TestRunner.runRepeatedTestPlan` for every page executed across the worker pool. All workers in the same invocation share that one resolved context; none re-resolve or re-select a provider independently.

**Provider selection** (which provider/model/credential a run uses) is resolved once per invocation, by field precedence `options > profile > FALCON_LLM_* env-compat > defaults` (see "Configuration Precedence" below): a directly-selected provider (via `--llm-provider` or a profile) never silently falls back to a *different* provider named by `FALCON_LLM_PROVIDER` — that is refused with `CONFIG_CONFLICT`. This precedence is per field, not all-or-nothing: `FALCON_LLM_*` env vars can still supply individual fields the flags/profile leave unset for that same invocation (e.g. `FALCON_LLM_TIMEOUT_MS`, `FALCON_LLM_MAX_ATTEMPTS`) without affecting which provider was selected, and that resolved mix applies identically inside parallel workers.

## Profile Store and Safe Credential Management

Profiles store non-secret metadata for reuse, avoiding repeated CLI flags. Keys are never stored in profiles.

### Profile Schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `provider` | string | Yes | `openai`, `azure-openai`, `anthropic`, `gemini`, `openai-compatible` |
| `model` | string | Yes | Model ID (e.g., `gpt-4o-mini`); operator-supplied |
| `endpoint` | string | No | Custom endpoint URL (openai-compatible only) |
| `credentialEnvVar` | string | No | Environment variable name holding the key (e.g., `ANTHROPIC_API_KEY`); default provider-specific |
| `azureResource` | string | No | Azure resource name (azure-openai only) |
| `azureHostSuffix` | string | No | Azure host suffix (azure-openai only) |
| `azureDeployment` | string | No | Azure deployment name (azure-openai only) |
| `allowCustomEndpoint` | boolean | No | Enable custom endpoint (openai-compatible) |
| `allowHttpLoopback` | boolean | No | Allow HTTP on loopback (openai-compatible) |
| `allowPrivateEndpoint` | boolean | No | Allow private IP ranges (openai-compatible) |
| `timeoutMs` | number | No | Request timeout in milliseconds |
| `maxAttempts` | number | No | Retry limit per request |

### Profile Naming and Storage

- **Profile name:** `[a-z0-9][a-z0-9-]{0,31}` (lowercase, starts with letter/digit, up to 32 chars)
- **Directory:** `$FALCON_LLM_PROFILE_DIR` (absolute path, must exist, mode 0700) or `~/.falcon/llm-profiles/` (created 0700 if missing)
- **File:** `<name>.json`, stored with mode 0600
- **Size limit:** ≤16 KiB per profile
- **Keys never stored:** Plaintext API keys are rejected; use `credentialEnvVar` to reference an environment variable

**Windows limitation:** Symlink and file-permission checks are skipped on Windows with a warning. This is a documented residual risk.

### CLI Profile Commands

```bash
# List profiles
npm run llm:profile:list

# Show profile metadata (no secrets)
npm run llm:profile:show -- my-openai

# Create/update profile
npm run llm:profile:set -- my-anthropic \
  --provider=anthropic \
  --model=<anthropic-model-id> \
  --credential-env=ANTHROPIC_API_KEY

# Delete profile
npm run llm:profile:delete -- my-anthropic
```

### Why Not Store Keys in Profiles?

Profiles are stored on disk. Even with file-mode restrictions (0600), keys at rest create data-exfiltration risk. Profile `credentialEnvVar` references an environment variable instead, which you load from a secret manager (`1Password`, `AWS Secrets`, `HashiCorp Vault`, etc.) at runtime. This keeps the key ephemeral and separates the configuration (in version control) from the secret (not in version control).

## Configuration Precedence

When resolving a provider, Falcon checks in this order. The first match wins:

1. **Direct CLI flags** (`--llm-provider`, `--llm-model`, etc.) — highest
2. **Profile** (loaded via `--llm-profile=<name>`, applies all fields in the profile)
3. **`FALCON_LLM_*` environment variables** (Phase 17 compat: `FALCON_LLM_PROVIDER`, `FALCON_LLM_MODEL`, etc.)
4. **Defaults** (e.g., `openai` default model is `gpt-4o-mini`)

**Conflict detection:** If a profile's provider differs from `--llm-provider`, or if `FALCON_LLM_PROVIDER` in the environment names a different provider than the one selected by `--llm-provider`/`--llm-profile` (including `FALCON_LLM_PROVIDER=disabled` or `=none`, the kill switch), Falcon exits with `CONFIG_CONFLICT`. It is never silently overridden; the operator must `unset FALCON_LLM_PROVIDER` (or select the same provider) to run with a different provider.

### Credential Precedence (Special Case)

For the API key environment variable:

1. Direct flag (not allowed; hard exit)
2. Profile `credentialEnvVar`
3. Phase 17 compat: `FALCON_LLM_API_KEY`, then `OPENAI_API_KEY` (OpenAI only)
4. Provider-pinned default: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.

The key is read from the chosen environment variable **at first use**, never cached or stored.

## Migration from Phase 17 (FALCON_LLM_* Environment Only)

Phase 17 used environment variables like `FALCON_LLM_PROVIDER`, `FALCON_LLM_API_KEY`, `FALCON_LLM_MODEL`. This configuration path **remains fully supported** with no deprecation warning.

### Phase 17 Still Works

```bash
export FALCON_LLM_PROVIDER=openai
export FALCON_LLM_API_KEY=<your-key>
export FALCON_LLM_MODEL=gpt-4o
npm run test:ui
```

### New: Per-Invocation Flags

You may now select a provider with CLI flags without changing the environment, as long as the flag agrees with (or the environment is unset for) `FALCON_LLM_PROVIDER`. Flags never silently override a *different* provider set in the environment — that is refused with `CONFIG_CONFLICT`:

```bash
export FALCON_LLM_PROVIDER=openai
export FALCON_LLM_API_KEY=<your-key>

# This is refused: FALCON_LLM_PROVIDER=openai conflicts with --llm-provider=anthropic
node falcon.js --llm-provider=anthropic --llm-model=<anthropic-model-id>
# -> exits with CONFIG_CONFLICT

# To select a different provider for this run, unset the provider variable and
# supply that provider's own key variable (Anthropic reads ANTHROPIC_API_KEY):
unset FALCON_LLM_PROVIDER
export ANTHROPIC_API_KEY=<your-key>
node falcon.js --llm-provider=anthropic --llm-model=<anthropic-model-id>
```

### Rollback

If you need to revert to a release before BYOK support:

```bash
git checkout <prior-tag>
npm ci
# Phase 17 env (FALCON_LLM_*) still works as before
export FALCON_LLM_PROVIDER=openai
export FALCON_LLM_API_KEY=<your-key>
npm run test:ui
```

## What Data Leaves the Machine

Per LLM request, Falcon sends to your selected provider endpoint:

- Failing selector (CSS/XPath)
- Target element description (tag, id, class, text snippet)
- Action name (e.g., "click", "fill")
- Up to 20 candidate element descriptors (tag, attributes, short text; ≤8 KiB total)

**Never sent:** Full DOM, cookies, storage, environment variables, secrets, passwords, or any browser state outside the target page.

Your LLM provider's retention, billing, and data policies apply.

## Troubleshooting by Error Code

| Error Code | Cause | Fix |
|---|---|---|
| `CONFIG_CONFLICT` | Profile provider conflicts with `--llm-provider` or `FALCON_LLM_PROVIDER`. | Use consistent provider setting or omit `--llm-profile`. |
| `CONFIG_INVALID` | Malformed flag value (e.g., model ID with invalid charset). | Check model ID, endpoint, and timeout values. |
| `CONFIG_PROVIDER_REQUIRED` | Tier 3 invoked with no provider selected. | Set `--llm-provider`, `FALCON_LLM_PROVIDER`, or profile. |
| `CONFIG_MISSING_CREDENTIALS` | API key environment variable is empty or unset. | Set `export ANTHROPIC_API_KEY=<your-key>` (or equivalent for your provider) before running. |
| `AUTH_FAILED` | API key invalid, expired, or revoked. | Rotate your API key in your provider console. |
| `BAD_REQUEST` | Request was malformed (bad model ID, missing required fields). | Verify model ID and provider type match. |
| `CONTENT_BLOCKED` | Provider blocked response (Gemini safety/blocklist). | Review prompt or candidate context; may indicate offensive/copyrighted selector text. Retry with different scenario. |
| `RATE_LIMITED` | Provider returned HTTP 429 (too many requests). | Increase `--llm-timeout-ms`, reduce concurrency, or retry after a delay. |
| `PROVIDER_ERROR` | Provider returned HTTP 5xx error. | Check provider status page; retry if transient. |
| `TIMEOUT` | Request exceeded configured timeout. | Increase `--llm-timeout-ms` or check network latency to provider. |
| `NETWORK_ERROR` | DNS, connection, or TLS failure. | Check endpoint URL, firewall, and DNS resolution. Set `NODE_EXTRA_CA_CERTS` if using a custom CA. |
| `MALFORMED_RESPONSE` | Provider response was not valid JSON or schema mismatch. | Verify endpoint URL and model compatibility. |
| `OVERSIZED` | Response body exceeded size limit. | Increase limit or check provider behavior. |
| `ENDPOINT_POLICY_REJECTED` | Endpoint is non-public (loopback/private) without opt-in. | Add `--llm-allow-http-loopback` or `--llm-allow-private-endpoint` as needed. |
| `REDIRECT_REJECTED` | Provider endpoint returned HTTP redirect (3xx). | Use the final target endpoint directly; redirects are not followed. |
| `BUDGET_EXHAUSTED` | Run LLM call limit reached. | Increase `FALCON_LLM_RUN_BUDGET` or reduce test scenarios. |
| `PROVIDER_DISABLED` | Provider explicitly set to `disabled`. | Set `--llm-provider` to an active provider or omit to use Tiers 1/2 only. |

**Safe debugging:** Error messages do not contain key values, endpoint hostnames, or model IDs longer than 20 chars. If you need to troubleshoot, review logs and check your configuration without pasting sensitive values.

**Fixed, value-free error details:** Every `detail` string returned by profile and config resolution (`LlmConfig.resolve`, `ProfileStore.safeParse`/`set`, and the `llm:profile` CLI's stderr output) is a fixed, hard-coded sentence describing the error class — never the caller-supplied value, field name, raw argv, or `error.message` that triggered it. A malformed model ID, an invalid profile field, or a hostile `FALCON_LLM_*` value is reported as a category (e.g. "profile contains an unrecognized field.") and never echoed back, so troubleshooting output is always safe to paste into a bug report or log.

## Known Limitations

1. **No live-tested models:** All models are operator-supplied and untested. Protocol behavior is verified with mocks only; healing quality is not measured.
2. **Profile store read-only on Windows:** Symlink and permission checks are skipped on Windows; use `FALCON_LLM_PROFILE_DIR` to an external secure location if available.
3. **No Entra ID:** Azure OpenAI authentication is key-based only; Entra ID / managed identity is not supported.
4. **No Bedrock or Vertex:** AWS Bedrock and Google Vertex AI are not supported.
5. **No fallback by design:** If the selected provider fails, Falcon does not attempt another provider. Healing is skipped and Tiers 1/2 proceed.
6. **No model discovery:** You must know your model ID in advance; no API call lists available models.
7. **Custom endpoints require explicit opt-in:** HTTP, loopback, and private-range endpoints must be enabled per profile or CLI flag.
8. **Profiles not synced to version control:** Store profiles on disk outside the repo; configure `FALCON_LLM_PROFILE_DIR` to a dedicated location.

## Owner Actions After Deployment

1. **Rotate old credentials:** Delete or rotate the `OPENAI_API_KEY` CI secret if it was used with Phase 17 only. Update CI to use `FALCON_LLM_PROVIDER` and new secrets.
2. **Grant key access carefully:** Keys live in your secret manager or shell; never commit them. Profiles in version control contain only metadata.
3. **Test a profile in CI:** Create a named profile (e.g., `ci-openai`) in your CI environment, set `FALCON_LLM_PROFILE_DIR`, and run `node falcon.js --llm-profile=ci-openai npm run test:ui`.
