# Live provider checks (G-04, issue #116)

Opt-in, secret-gated checks that confirm Falcon's real provider classes
(`src/core/llm/providers/`) work end to end against the real OpenAI,
Anthropic, and Gemini endpoints, through the same candidate-selection
request/parse path Tier 3 uses. These are **not** part of `npm test`,
`npm run test:regression`, `npm run test:all`, or any CI job — they are
run only on purpose, with `npm run test:live-providers`.

## What this certifies (and what it does not)

Each run certifies the request/response **contract** with that provider,
model, and SDK/package version **on that date only**: the request is
accepted, a reply parses to a valid candidate index, malformed/out-of-range
output is rejected, the configured timeout is honoured, and an invalid key
produces a clean, redacted error. It does **not** certify model quality,
healing accuracy, or behaviour of any model/version not actually exercised.

## Gate

A check only makes a live network call when **both**:

- `FALCON_LIVE_PROVIDER_TESTS=1` is set, and
- the provider's dedicated key variable is present:
  `FALCON_LIVE_OPENAI_KEY`, `FALCON_LIVE_ANTHROPIC_KEY`, or
  `FALCON_LIVE_GEMINI_KEY` (optionally with `FALCON_LIVE_<PROVIDER>_MODEL`
  to pin a model).

Otherwise each check prints `SKIPPED: live provider checks disabled` (or a
missing-key message) and marks itself skipped (TAP `# SKIP`) — never a
silent pass — and the process exits `0`. Real operator configuration
(`FALCON_LLM_*`) is never read here; the `LlmConfig` `get` map is built
explicitly from `FALCON_LIVE_*` inputs only.

The invalid-key and timeout assertions need no real key and run whenever
the flag alone is set. The malformed/out-of-range-reply assertion is
hermetic (no network) and always runs.

## Cost ceiling

Every request uses a 3-line synthetic candidate prompt (well under 200
bytes) and `maxOutputTokens` of 5-8. Each provider check builds its own,
separate `LlmConfig`/`LlmBudget` instance with `maxAttempts=1` — there is
no run-wide shared cap across providers. The invalid-key and timeout
assertions fail before reaching the provider's billing path, so only the
real-key path makes a billable request: at most one billable request per
provider (one each for OpenAI, Anthropic, and Gemini — at most 3 billable
requests total across a full run), each capped at `maxOutputTokens<=8`. A
small fraction of a cent per provider at current list prices.

## Evidence

A successful real-key run writes a no-secret JSON record to
`live-evidence/` (gitignored): provider, model id, ISO date, SDK/package
version, per-assertion pass/fail, and token usage. No key material and no
raw prompt containing application data is ever written (the prompt is
always the fixed synthetic candidate set).

## Known remaining sub-gaps

Azure OpenAI and the generic OpenAI-compatible provider are not covered by
a live check here; they are not yet exercised against a real matching
endpoint in this change.
