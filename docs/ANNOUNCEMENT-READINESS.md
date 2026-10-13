# Announcement readiness

This page is the factual boundary for announcing the Phase 17 and invocation-scoped BYOK work. It is written for maintainers preparing a GitHub release, product update, demo, or social post.

## What is ready to announce

- Phases 1–17 are merged on `main`.
- Pull request #50 added invocation-scoped selection of provider, model, and credential source.
- Implemented routes are OpenAI, Anthropic, Gemini, Azure OpenAI with API-key authentication, and explicitly approved OpenAI-compatible endpoints.
- Each run resolves one provider context. Whole-app, single-page, and in-process parallel execution carry that context to Tier 3.
- Profiles store non-secret metadata and the name of the environment variable holding a credential, never the credential value.
- Tier 3 receives a bounded candidate-selection payload. Its proposed selector is validated locally, may run once, and needs human approval before trusted reuse.
- The pull request #50 release gate measured 2,076 regression cases and 61 browser tests. Treat these as dated release evidence, not permanent counts.

## Claims that are not ready

Do not say that Falcon supports every frontier model, every LLM provider, or every vendor authentication method. Model IDs are operator-supplied, Falcon has no catalogue discovery, and new model behavior is not automatically certified.

Do not call the provider routes live-certified. The release cycle used mocked provider protocols because live API keys were unavailable; no live OpenAI, Anthropic, Gemini, Azure OpenAI, or custom-endpoint call was made.

Do not say that no data leaves the machine when Tier 3 is enabled. Falcon sends the failing selector, step description, action type, and a bounded set of candidate element descriptors to the selected endpoint. It does not send the full DOM, cookies, storage, environment variables, complete form contents, authentication tokens, or full page HTML.

Do not describe AWS Bedrock, Google Vertex AI authentication, Entra ID, or arbitrary provider-specific APIs as supported. They have no native adapter in this release.

## Public compatibility matrix

| Route | Status | Evidence | Limit |
|---|---|---|---|
| OpenAI | Native | Mock contract and security tests | No live call in this cycle |
| Anthropic | Native | Mock contract and security tests | No live call in this cycle |
| Gemini | Native | Mock contract, blocked-content, and security tests | No live call in this cycle |
| Azure OpenAI | Native | Mock contract and isolation tests | API-key auth only; no live call |
| OpenAI-compatible | Guarded compatibility route | Mock endpoint and credential-isolation tests | Compatibility varies by endpoint/model |
| AWS Bedrock | Unsupported | None | Native SigV4/auth transport absent |
| Google Vertex AI auth | Unsupported | None | Direct Gemini API support is not Vertex support |
| Other native provider APIs | Unsupported | None | Use only if the service implements the tested OpenAI-compatible contract |

## Five-minute demo path

Use a staging or disposable web application. Discovery clicks and fills real controls.

```bash
npm ci

export OPENAI_API_KEY='<openai-key>'
node falcon.js --url=https://staging.example.com --llm-provider=openai --llm-model='<openai-model-id>'

unset OPENAI_API_KEY
export ANTHROPIC_API_KEY='<anthropic-key>'
node falcon.js --url=https://staging.example.com --llm-provider=anthropic --llm-model='<anthropic-model-id>'

unset ANTHROPIC_API_KEY
export GEMINI_API_KEY='<gemini-key>'
node falcon.js --url=https://staging.example.com --llm-provider=gemini --llm-model='<gemini-model-id>'
```

Run one provider at a time. Unset a conflicting `FALCON_LLM_PROVIDER`; Falcon deliberately exits with `CONFIG_CONFLICT` rather than silently overriding an environment-level provider or kill switch.

## Suggested announcement

Falcon Automation now supports invocation-scoped bring-your-own-key LLM providers. Different runs can use OpenAI, Anthropic, Gemini, Azure OpenAI, or an approved OpenAI-compatible endpoint without persisting credential values in Falcon profiles or forwarding one provider's credential to another provider route. Provider output remains locally validated, and a proposed selector must be approved before reuse.

This is an open-source technical preview for teams evaluating auditable, self-healing browser automation. Provider integrations are contract-tested against mocks; live-provider certification and broader native provider coverage remain future work.

## Release checklist

- [x] Phase 17 merged on `main`.
- [x] Invocation-scoped BYOK merged through pull request #50.
- [x] README exposes BYOK, its safety boundary, quickstart, and compatibility matrix.
- [x] Dated test evidence is stated without presenting it as a permanent count.
- [x] Announcement copy avoids universal, production-ready, and live-certified claims.
- [ ] Record a short provider-switching demo against a staging target.
- [ ] Perform and document opt-in live smoke tests for the providers being named as live-certified.
- [ ] Create a version tag and GitHub release after this documentation pull request merges.

No tag exists for this announcement update at the time this document was written. Tagging and publishing the GitHub release are post-merge owner actions.
