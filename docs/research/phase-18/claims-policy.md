# Phase 18 Claims Policy

Date: 2026-10-15. Applies to the README, documentation, release notes, demo material and any announcement.

## Rules

1. State only what an automated test in this repository proves, and say which test.
2. Describe vendors only with facts from [source-register.md](source-register.md) at `VERIFIED`, with the access date. Do not turn `NOT_FOUND_IN_REVIEWED_DOCS` into "does not support".
3. No leadership, uniqueness, superiority, "first", "only", "best", "most secure" or percentage-improvement claims.
4. No certification, compliance, enterprise-readiness or production-safety claim.
5. Pilot wording is "authenticated staging pilots". Dry-run safety is limited to what its acceptance suite proves.

## Allowed (once the matching PR has merged with passing evidence)

- "Falcon can run against authenticated staging applications using a Playwright `storageState` file you provide."
- "Falcon refuses to count a run as authenticated coverage when it detects a redirect to login, an expired session or an anonymous page."
- "Falcon's dry-run plan mode performs no clicks, fills, submissions or provider requests, as verified by the Phase 18 acceptance suite."
- "Protected actions require an approval bound to the plan, manifest, role, origin, action and revision; changed fields invalidate it."
- "Deterministic policy decides before healing or any provider call; a provider cannot weaken a denial."
- "Planted synthetic credentials were not found in the artifacts the acceptance suite scans." (name the scanned artifacts)
- "Falcon is open source and self-hosted; Phase 18 adds no hosted service."

## Prohibited

- "Safe for production", "production-ready authentication", "secure by design", "SOC 2 / ISO 27001 / GDPR / HIPAA compliant" or similar.
- "Enterprise-grade", "enterprise SSO", "RBAC" for the named pilot roles (they are test fixtures, not an access-control system).
- "No secrets can ever leak" or "zero data exposure". Application-derived text may still contain sensitive data and must be documented as such.
- "Better/safer/more accurate than" any named product, or "competitors lack dry-run / approval / policy".
- "Market-leading", "first", "only", "unique".
- Any claim about healing accuracy before Phase 20 measurement.
- Quoting vendor marketing (S26) as fact.

## Evidence required before a claim is made

Each public claim maps to an acceptance criterion ID, the test that proves it and the PR where it landed. Release Manager checks this map before approving text.
