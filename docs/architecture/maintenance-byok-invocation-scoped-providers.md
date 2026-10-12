# ADR-0019: Invocation-Scoped BYOK LLM Providers

**Status:** Approved (C1–C16 binding conditions adopted)  
**Decision:** Falcon supports multiple LLM providers selected per invocation, with credentials managed by the user (BYOK). Providers are resolved once at startup into a frozen `ProviderContext` shared by `TestRunner` and `AIHealer`.

## Context

Phase 17 fixed LLM provider selection at compile time via environment variables (`FALCON_LLM_PROVIDER`, etc.). Users who wanted to test with different providers had to restart or run parallel processes. The absence of Anthropic and Gemini adapters also limited provider choice.

This ADR adds per-invocation provider selection (via CLI flags or profiles), extends support to four first-class providers (OpenAI, Azure OpenAI, Anthropic, Gemini), and introduces a profile store for non-secret metadata reuse.

## Decision

1. **ProviderContext:** Resolve the selected provider once at startup from CLI flags, profile, `FALCON_LLM_*` environment variables, or defaults. Freeze the context and pass it to `TestRunner`, which injects it into `AIHealer`. No runtime switching or per-request fallback.

2. **Adapters:** Implement first-class adapters for OpenAI (via guarded fetch), Azure OpenAI, Anthropic (REST `/v1/messages` + guarded fetch), and Gemini (REST `/v1beta/models/:generateContent` + guarded fetch). Use guarded REST for Anthropic and Gemini (no SDK; avoids ambient env bleed, unverified fetch hooks, heavy dependencies).

3. **Registry:** Use a `WeakMap<ProviderContext, Provider>` to isolate credentials and budgets per context, preventing cross-invocation starvation.

4. **Profile Store:** Store non-secret metadata (provider, model, endpoint, credentials env-var name, Azure settings, option flags) in user-owned `~/.falcon/llm-profiles/<name>.json` (0600 file mode). Keys are never stored; users reference environment variable names instead. Profiles are optional; CLI flags and environment variables remain fully functional.

5. **Credential Resolution:** Credentials are lazily read from the selected environment variable at first request, not cached or stored in memory after use. The env-var name is resolved per precedence (direct > profile > Phase 17 compat > provider default). Env-var names must match `^[A-Z][A-Z0-9_]{0,63}_API_KEY$` and deny a hardcoded list (`PATH`, `HOME`, `NODE_*`, etc.).

6. **Precedence:** Direct CLI flags (`--llm-provider`, `--llm-model`, `--llm-profile`) > profile fields > `FALCON_LLM_*` env > defaults. Conflicting provider sources trigger `CONFIG_CONFLICT` (no silent override).

7. **No Runtime Changes:** Phase 17 env-only configuration remains supported without deprecation. With no provider selected and only `OPENAI_API_KEY` set, configuration resolution returns the non-fatal code `CONFIG_PROVIDER_REQUIRED` (one warning logged), Tier 3 is unavailable, and Tiers 1-2.5 continue.

## Architecture

### ProviderContext and Resolution

```javascript
// src/core/llm/ProviderContext.js
resolve({options, profile, get, env, deps})
  => {ok: true, context: ProviderContext} | {ok: false, errorCode, detail}
```

- **Input:** CLI options (`--llm-provider`, `--llm-model`), profile (loaded by name), config getter, environment map, dependencies.
- **Output:** Immutable, deep-frozen `ProviderContext` with provider ID, model, endpoint, credential env-var name, and per-context budget/semaphore.
- **Never throws:** All errors are `{ok: false, errorCode, detail}` tuples.
- **One per process:** If no explicit context is provided, a lazily-created default context (Phase 17 path) is used and shared across all requests.

### Provider Registry

```javascript
const registry = new WeakMap(); // <ProviderContext, Provider>
```

Replaces a per-provider-id map. Each context owns its `LlmBudget` and `Semaphore`, preventing one invocation's exhausted budget from affecting another.

### Transport: Guarded REST (No SDK)

**Anthropic** and **Gemini** use guarded REST (custom fetch wrapper) instead of vendor SDKs:

- **Why:** Avoid ambient environment bleed (`process.env` leaking into SDK), unverified fetch hooks, and heavy transitive dependencies.
- **guardedFetch mode:** `fixed-host` — exact hostname, port 443, HTTPS only, exact path, no loopback/private without opt-in, redirects rejected.
- **Headers:** Validated via try/catch on normalization; CR/LF injection rejected at input, never echoed to stderr.
- **Credential shape:** Must match `^[\x21-\x7e]{1,512}$` before any I/O; rejected if not.
- **Response bodies:** Never read or echoed on error; only status code, headers, and safe error codes extracted.

### Anthropic Adapter

- **Endpoint:** `https://api.anthropic.com/v1/messages`
- **Headers:** `x-api-key: <key>`, `anthropic-version: 2023-06-01`
- **Request body:** `{model, max_tokens, messages: [{role: "user", content: [{type: "text", text: "..."}]}]}`
- **Response:** First text block extracted; `401`/`403` → `AUTH_FAILED`; `400`/`404`/`413`/`422` → `BAD_REQUEST` (no retry); `429` → `RATE_LIMITED`; `5xx`/`529` → `PROVIDER_ERROR`; `504` → `TIMEOUT`.

### Gemini Adapter

- **Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`
- **Query parameter:** `key=<api-key>` (forbidden in model or endpoint fields; URL injection prevented by charset validation)
- **Headers:** `x-goog-api-key: <key>`
- **Request body:** `{contents: [{role: "user", parts: [{text: "..."}]}], generationConfig: {maxOutputTokens, temperature: 0}}`
- **Response:** Extract text from `candidates[0].content.parts[0].text`; `blockReason` or `finishReason in [SAFETY, BLOCKLIST, PROHIBITED_CONTENT, RECITATION, IMAGE_SAFETY]` → `CONTENT_BLOCKED`.
- **Model ID charset (strict):** `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (no `/`, `:`, no `models/` prefix) because the ID is placed in the URL path. Traversal attempts (`../`, `%2e`, `:`) are rejected.

### Credential Reference Rules

- **Env-var name (not the key itself):** Profile or config holds the NAME (e.g., `ANTHROPIC_API_KEY`), never the key value.
- **Resolution order per field:**
  1. Direct CLI flag (hard-exit if a key-shaped value detected)
  2. Profile `credentialEnvVar`
  3. Phase 17 compat (OpenAI only: `FALCON_LLM_API_KEY`, then `OPENAI_API_KEY`)
  4. Provider-pinned default (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.)
- **Env-var name validation:** Matches `^[A-Z][A-Z0-9_]{0,63}_API_KEY$`; deny: `PATH`, `HOME`, `SHELL`, `USER`, `PWD`, `TMPDIR`, `NODE_*`, `LD_*`, `DYLD_*`, `npm_*`.
- **Lazy read:** Value is read from `process.env` only when the selected adapter makes its first request. Never cached, never stored in ledger/dashboard/profiles.

### Profile Store

**Location:** `$FALCON_LLM_PROFILE_DIR` (absolute path, 0700, owned by user, outside repo) or `~/.falcon/llm-profiles/` (created 0700 if missing).

**File:** `<name>.json`, mode 0600, atomic write (write to temp, fsync, rename).

**Reading:** O_NOFOLLOW, fstat (regular file, owner, mode `&0o077 == 0`, size ≤16 KiB).

**Schema (version `falcon-llm-profile/1`):**
- `provider` (string, required): `openai`, `azure-openai`, `anthropic`, `gemini`, `openai-compatible`
- `model` (string, required): Model ID
- `endpoint` (string, optional): Custom endpoint (openai-compatible only)
- `credentialEnvVar` (string, optional): Env-var name (defaults to provider-pinned)
- `azureResource`, `azureHostSuffix`, `azureDeployment` (string, optional): Azure only
- `allowCustomEndpoint`, `allowHttpLoopback`, `allowPrivateEndpoint` (boolean, optional): openai-compatible only
- `timeoutMs`, `maxAttempts` (number, optional): Per-context overrides

**Plaintext rejection:** If a value matches a key-shaped pattern (`sk-`, `sk-ant-`, `AIza`) or contains a denied env-var name, the profile is rejected without being written.

**CLI commands:**
- `npm run llm:profile:list` — names, provider, model only (no secrets)
- `npm run llm:profile:show <name>` — all fields except credential values
- `npm run llm:profile:set <name> --provider=... --model=... --credential-env=...` — create/update atomically
- `npm run llm:profile:delete <name>` — delete securely

**Windows residual risk:** Symlink and permission checks are skipped on Windows with a warning. This is documented as a known limitation.

## Configuration Precedence

1. Direct CLI flags (`--llm-provider=<id>`, `--llm-model=<id>`, `--llm-profile=<name>`, etc.)
2. Profile (loaded from `<name>.json`)
3. `FALCON_LLM_*` environment variables (Phase 17 compat)
4. Provider defaults

**Conflict detection:** If profile provider differs from `--llm-provider` or `FALCON_LLM_PROVIDER`, exit with `CONFIG_CONFLICT`.

**Phase 17 env-only:** If no explicit context is selected, the default context is created once per process, sharing budget/semaphore. Old behavior preserved.

## Error Vocabulary

**Existing error codes** (Phase 17) plus:

- `CONFIG_CONFLICT` — Profile provider conflicts with flag or env.
- `CONFIG_INVALID` — Malformed config value (credential shape, model charset, timeout format).
- `CONFIG_MISSING_CREDENTIALS` — Env-var empty or unset.
- `CONFIG_PROVIDER_REQUIRED` — Tier 3 invoked with no provider.
- `CONTENT_BLOCKED` — Gemini blocked response (safety/blocklist).
- `ENDPOINT_POLICY_REJECTED` — Non-public endpoint without opt-in.
- `REDIRECT_REJECTED` — Endpoint returned HTTP redirect.

All error messages exclude key values, credential env-var names longer than 20 chars, and raw provider error bodies.

## Resource Bounds

**Per context (invocation):**
- LLM call budget: `FALCON_LLM_RUN_BUDGET` (default 50)
- Request timeout: `FALCON_LLM_TIMEOUT_MS` (default 10000 ms)
- Max attempts per request: `FALCON_LLM_MAX_ATTEMPTS` (default 2)
- Concurrent in-flight requests: per-context semaphore (default 1)

**Process-wide (shared by all contexts):**
- Total attempts: hard ceiling 2000
- Concurrent in-flight: hard ceiling 8

**Per request:**
- Request size: bounded by provider limits
- Response size: bounded (`FALCON_LLM_MAX_RESPONSE_BYTES`), oversized responses rejected with `OVERSIZED`.

**No fallback:** If the selected provider/endpoint fails, Falcon does not attempt another. Healing is skipped; Tiers 1/2 proceed.

## Migration and Rollback

### From Phase 17

**Before:** `FALCON_LLM_PROVIDER=openai`, `FALCON_LLM_API_KEY=<your-key>`

**Now (Phase 17 compat, no change required):**
```bash
export FALCON_LLM_PROVIDER=openai
export FALCON_LLM_API_KEY=<your-key>
npm run test:ui  # ← Still works
```

**Now (new per-invocation):**
```bash
export ANTHROPIC_API_KEY=<your-key>
node falcon.js --llm-provider=anthropic --llm-model=<anthropic-model-id>
```

### Rollback

```bash
git checkout <prior-tag>
npm ci
# Phase 17 env path unchanged; tests proceed normally
export FALCON_LLM_PROVIDER=openai
export FALCON_LLM_API_KEY=<your-key>
npm run test:ui
```

Or disable Tier 3 only:
```bash
export FALCON_LLM_PROVIDER=disabled
npm run test:ui  # ← Tiers 1/2 active
```

## Rejected Alternatives

1. **AsyncLocalStorage (ALS):** Would require Promise-wrapping all I/O; high runtime cost and incompatible with Playwright's event-driven model.
2. **Vendor SDKs (OpenAI, Anthropic):** Introduce transitive dependencies, ambient environment bleed, and unverified fetch hooks.
3. **Process-global provider budget:** Prevents isolated test runs; one exhausted budget starves all concurrent invocations.
4. **Fallback/fan-out:** Retry another provider on failure. Violates audit trail (which provider was actually used?) and masking transient failures.
5. **Model discovery API:** Requires live provider calls, adds latency, and not all providers support it. Operator-supplied IDs are simpler.
6. **Entra ID for Azure:** Requires SDK or complex OAuth flow; key-based auth sufficient for CI.
7. **Model allowlist:** Prevents use of new models without deployment; operator typing model IDs is simpler.

## Security Conditions Adopted (C8–C16)

- **C8 (T-01):** Credential shape validated `^[\x21-\x7e]{1,512}$` before any I/O; header normalization wrapped in try/catch; CR/LF markers rejected, never echoed to stderr.
- **C9 (T-02):** `fixed-host` mode enforces exact hostname, port 443, HTTPS, exact path; no loopback/private without opt-in; HTTP redirects (3xx) rejected; proxy env ignored.
- **C10 (T-03):** Key-shaped values rejected in model, endpoint, deployment, profile fields; no value echo on error.
- **C11 (T-04):** Credential env-var name matches `^[A-Z][A-Z0-9_]{0,63}_API_KEY$`; deny list: `GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `NODE_OPTIONS`, etc.
- **C12 (T-05):** `FALCON_LLM_PROFILE_DIR` absolute, realpath equals given, user-owned, mode 0700, not inside cwd or parent of cwd.
- **C13 (T-06):** Profile files read via O_NOFOLLOW, fstat (regular, owner, mode, size ≤16 KiB); null-prototype parse, scalar values only.
- **C14 (T-07):** `Redact` exports per-field check; rejects `sk-ant-` and `AIza` patterns.
- **C15 (T-08):** Per-context budget/semaphore (no cross-invocation starvation) plus process-wide hard ceilings (2000 attempts, 8 in-flight).
- **C16 (T-09):** Runtime budget/semaphore not deep-frozen; CLI flags never accept raw keys; no error.message interpolation from user/provider input.

## Residual Risks

1. **Profile store on Windows:** Symlink and permission checks skipped; documented and acceptable for development/CI environments.
2. **No live model testing:** Protocol behavior verified with mocks; healing quality not measured. New model IDs are unverified.
3. **No Entra ID or Bedrock:** Azure restricted to key auth; AWS and GCP alternatives unsupported.
4. **Credential env-var namespace pollution:** A malicious dependency could set a standard env-var name (e.g., `ANTHROPIC_API_KEY`); mitigated by deny-list and explicit `credentialEnvVar` in profiles.
5. **Provider SLA/quota risk:** User responsible for provider account health; Falcon has no circuit breaker or quota awareness.

## Telemetry and Observability

No new ledger fields. Healing telemetry via `LlmTelemetry.serialize` allowlist only:
- Provider ID
- Model label (last 20 chars, no full ID)
- Endpoint class (e.g., `anthropic_public`, `gemini_public`)
- Latency
- Attempts
- Outcome (success, skipped, error)
- Error code (if applicable)
- Token counts (if reported by provider)

Credential env-var names, endpoint hostnames, and full model IDs are not logged.

## GitHub Advanced Security Gate

GitHub Advanced Security (CodeQL JS/TS, PR code scanning, secret scanning + push protection) is the sole authoritative security gate. npm audit is hygiene. No other scanner is named or used.
