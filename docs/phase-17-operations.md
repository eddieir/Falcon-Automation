# Phase 17 Operations Guide — Pluggable LLM Providers

Practical task-oriented guide for operators configuring and running Falcon with LLM-powered Tier 3 healing and the production-cycle dashboard.

> For invocation-scoped (`--llm-profile`/`--llm-provider`/`--llm-model` flag/profile) provider selection and the Anthropic/Gemini providers, see [docs/maintenance-byok-operations.md](maintenance-byok-operations.md).

## Choosing a Provider

Falcon Tier 3 (AI self-healing) requires an LLM provider. Set `FALCON_LLM_PROVIDER` in your environment:

- **`openai`**: OpenAI API; requires `FALCON_LLM_API_KEY`.
- **`azure-openai`**: Azure OpenAI; requires `FALCON_LLM_API_KEY`, `FALCON_LLM_AZURE_RESOURCE`, and optionally `FALCON_LLM_AZURE_DEPLOYMENT` and `FALCON_LLM_AZURE_HOST_SUFFIX`. Key-based auth only (Entra ID unsupported).
- **`openai-compatible`**: Custom endpoint (e.g. Ollama, vLLM); requires `FALCON_LLM_ENDPOINT` and opt-in flag `FALCON_LLM_ALLOW_CUSTOM_ENDPOINT=true`. HTTP allowed only on loopback with `FALCON_LLM_ALLOW_HTTP_LOOPBACK=true`; private ranges only with `FALCON_LLM_ALLOW_PRIVATE_ENDPOINT=true`.
- **`disabled` or blank**: Skips Tier 3; Tier 1/2 healing remains active.

For a quick migration from old `OPENAI_API_KEY`-only setup, add `FALCON_LLM_PROVIDER=openai`.

## Configuration Reference

See `.env.example` for all options. Key settings:

- `FALCON_LLM_PROVIDER` — Provider ID (required for Tier 3).
- `FALCON_LLM_API_KEY` — API key.
- `FALCON_LLM_MODEL` — Model name (e.g. `gpt-4o`); blank = provider default.
- `FALCON_LLM_TIMEOUT_MS` — Request timeout; default 10000 ms.
- `FALCON_LLM_MAX_ATTEMPTS` — Retry limit per request; default 2.
- `FALCON_LLM_RUN_BUDGET` — Total LLM calls per test run; default 50.

## Provider Examples

### OpenAI

```bash
export FALCON_LLM_PROVIDER=openai
export FALCON_LLM_API_KEY=<your-key>
export FALCON_LLM_MODEL=gpt-4o
```

### Azure OpenAI

```bash
export FALCON_LLM_PROVIDER=azure-openai
export FALCON_LLM_API_KEY=<your-key>
export FALCON_LLM_AZURE_RESOURCE=my-resource
export FALCON_LLM_AZURE_DEPLOYMENT=my-deployment
```

### OpenAI-Compatible (Ollama on Loopback)

```bash
export FALCON_LLM_PROVIDER=openai-compatible
export FALCON_LLM_ALLOW_CUSTOM_ENDPOINT=true
export FALCON_LLM_ALLOW_HTTP_LOOPBACK=true
export FALCON_LLM_ENDPOINT=http://127.0.0.1:11434/v1
export FALCON_LLM_MODEL=llama2
```

## What Data Leaves the Machine

Per provider call, Falcon sends:
- Failing selector
- Target element description
- Action name
- Up to 20 candidate element descriptors (tag name, attributes, short text; ≤8 KiB total)

Never sent: full DOM, cookies, storage, environment variables, or any secrets.

## Migration from OPENAI_API_KEY-Only

Earlier releases accepted `OPENAI_API_KEY` on its own (BREAKING change in Phase 17):

```bash
# Old behavior (no longer works)
export OPENAI_API_KEY=sk-...
# npm run test:ui  # ← Tier 3 now SKIPPED; logs one-time warning

# New setup (required)
export FALCON_LLM_PROVIDER=openai
export FALCON_LLM_API_KEY=sk-...
# npm run test:ui  # ← Tier 3 enabled
```

Existing `OPENAI_API_KEY` is read only when `FALCON_LLM_PROVIDER=openai` AND `FALCON_LLM_API_KEY` is empty. It never selects a provider.

## Kill Switch

Disable Tier 3 at any time without removing configuration:

```bash
export FALCON_LLM_PROVIDER=disabled
```

Tiers 1 and 2 (rule-based and state-based healing) remain active.

## Troubleshooting by Error Code

| Error Code | Cause | Fix |
|---|---|---|
| `CONFIG_PROVIDER_REQUIRED` | Tier 3 invoked with no provider set. | Set `FALCON_LLM_PROVIDER` and credentials. |
| `CONFIG_UNSUPPORTED_PROVIDER` | Provider name not recognized. | Check `FALCON_LLM_PROVIDER` spelling. |
| `CONFIG_CONFLICT` | Conflicting provider settings. | Review Azure resource, endpoint, or deployment names. |
| `CONFIG_MISSING_CREDENTIALS` | API key or required param empty. | Check `FALCON_LLM_API_KEY`, Azure resource, or endpoint. |
| `CONFIG_INVALID` | Malformed configuration value. | Review timeout, budget, or model name format. |
| `CONFIG_ENDPOINT_OPT_IN_REQUIRED` | Custom endpoint without opt-in flag. | Set `FALCON_LLM_ALLOW_CUSTOM_ENDPOINT=true`. |
| `PROVIDER_DISABLED` | Provider intentionally disabled. | Set `FALCON_LLM_PROVIDER` to active provider or leave for Tier 1/2 only. |
| `ENDPOINT_POLICY_REJECTED` | Network policy denied endpoint (SSRF check). | Use public endpoint or enable `FALCON_LLM_ALLOW_PRIVATE_ENDPOINT` for private ranges. |
| `REDIRECT_REJECTED` | Endpoint returned HTTP redirect. | Use final target endpoint directly. |
| `BUDGET_EXHAUSTED` | Run LLM call limit reached. | Increase `FALCON_LLM_RUN_BUDGET` or reduce scenario count. |
| `AUTH_FAILED` | API key invalid or expired. | Rotate `FALCON_LLM_API_KEY`. |
| `BAD_REQUEST` | Malformed request to provider. | Check model name and provider settings. |
| `RATE_LIMITED` | Provider returned 429. | Increase `FALCON_LLM_TIMEOUT_MS`, reduce concurrency, or retry later. |
| `PROVIDER_ERROR` | Provider returned 5xx. | Check provider status; retry if transient. |
| `TIMEOUT` | Request exceeded `FALCON_LLM_TIMEOUT_MS`. | Increase timeout or check network latency. |
| `NETWORK_ERROR` | DNS, connection, or TLS failure. | Check endpoint URL, network routing, and `NODE_EXTRA_CA_CERTS` if needed. |
| `MALFORMED_RESPONSE` | Provider response not JSON or invalid schema. | Verify provider endpoint and model compatibility. |
| `OVERSIZED` | Response body exceeded `FALCON_LLM_MAX_RESPONSE_BYTES`. | Check provider response size or increase limit. |
| `UNSUPPORTED_CAPABILITY` | Provider does not support feature. | Verify model and provider type. |

## Production-Cycle Dashboard

Run the coordination dashboard to view dispatch history, verdicts, and event ledger during a release cycle:

```bash
npm run production:dashboard -- --run-id=<run-id>
```

Binds to `127.0.0.1` (loopback) by default; non-loopback binding is refused.

Append events (coordinator only):

```bash
npm run production:event -- --run-id=<run-id> --type=dispatch_created \
  --from-role=production-director --to-role=developer \
  --task-id=AC-01 --status=PENDING --summary="Building feature..."
```

Exit codes: 0 (ok), 2 (usage/validation/redaction), 3 (full/I/O), 4 (lock timeout), 5 (verify found malformed).

## Known Limitations

1. Ledger lives in `.git/production-cycle/<run-id>/events.jsonl`; cloned repos have no history.
2. Prompt candidates default to 20 and are configurable from 1 to the 60-element DOM collection cap; the complete prompt remains capped at 8 KiB.
3. Healing outcome may differ before and after cap reduction; benchmark advised.
4. Custom endpoints (loopback, private ranges) require explicit opt-in flags.
5. Proxies unsupported; dedicated HTTP agent used.

## Rollback and Disabling

To revert to a prior release without Tier 3:

```bash
git checkout <prior-tag>
npm ci
# Tier 1/2 tests proceed normally
```

Or disable Tier 3 only:

```bash
export FALCON_LLM_PROVIDER=disabled
npm run test:ui
```

## Owner Actions

After deploying Phase 17:

1. **Delete or rotate** the `OPENAI_API_KEY` CI secret (no longer used; `FALCON_LLM_API_KEY` replaces it).
2. **Grant ledger access** only to the coordinator; recommend deny rules on `.git/production-cycle/**` for non-coordinator agents.
3. **Verify provider** credentials in CI/CD secrets; update to `FALCON_LLM_PROVIDER` and `FALCON_LLM_API_KEY` as needed.
