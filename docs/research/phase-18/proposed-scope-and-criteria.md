# Phase 18 Proposed Scope and Acceptance Criteria (for owner decision)

Date: 2026-10-15. Status: **PROPOSED — not approved.** Produced by the Product Owner role from docs/PHASE-PLANS.md (Phase 18) and the Product Manager problem statement. Implementation does not start until the owner records a decision on this scope, the criteria and [claims-policy.md](claims-policy.md). Failure-code names are proposals pending the architecture design.

## Problem and outcome

Falcon cannot yet be evaluated safely against realistic authenticated staging applications: authentication lifecycle, destructive-action control and artifact secret-safety are missing. Phase 18 makes Falcon safe enough to evaluate on authenticated **staging** applications, proven on a hermetic local fixture. Users: QA leads, test authors, CI maintainers, security reviewers.

Not in scope: production-safety certification, compliance claims, enterprise SSO/OIDC/SAML, multi-tenant RBAC, business-outcome contracts (Phase 19), measured healing accuracy (Phase 20), MFA/CAPTCHA automation, secrets-manager integrations, external third-party staging apps as a gate, shared multi-machine approval workflow.

## Delivery grouping

| PR | Theme | Criteria |
|---|---|---|
| 18A | Authentication lifecycle | 001–024 |
| 18B | Zero-mutation dry-run and plan digest | 025–035 |
| 18C | Manifest and deterministic policy | 036–050, 081 |
| 18D | Revision-bound protected-action approval | 051–059 |
| 18E | Secret-safe evidence boundary | 060–068, 070 |
| 18F | Hermetic fixture and integration gate | 073–077 |
| DOC | Documentation honesty | 069, 078–080 |
| cross | All PRs | 071, 072, 082 |

No partial Phase 18 satisfies the conjunctive acceptance gate; a partial delivery must not be labelled pilot-ready (OD-16).

## Criteria (Given/When/Then condensed)

Priority M/S/C = Must/Should/Could.

**18A — authentication**

| ID | P | Observable requirement |
|---|---|---|
| P18-AC-001 | M | Exported storageState values appear only in the operator-chosen file; zero in stdout, stderr, logs, reports, run history |
| P18-AC-002 | M | Import records only role, cookie count, earliest expiry, SHA-256 fingerprint |
| P18-AC-003 | M | Login-setup with env-referenced credentials succeeds on fixture; state file owner-readable only |
| P18-AC-004 | M | Bad credentials: `AUTH_LOGIN_FAILED`, no new state file, existing one unchanged, password absent from output |
| P18-AC-005 | M | Manifest literal in a credential-named field rejected `MANIFEST_SECRET_LITERAL` with zero target requests |
| P18-AC-006 | M | Authenticated role with no state exits `AUTH_STATE_MISSING` before any target request |
| P18-AC-007 | M | Landing on the login route: `AUTH_REDIRECT_TO_LOGIN`; later authenticated steps not counted; status not PASS |
| P18-AC-008 | M | Expired session: `AUTH_SESSION_EXPIRED`, same consequence |
| P18-AC-009 | M | Page without authenticated marker and without login redirect: `AUTH_UNEXPECTED_ANONYMOUS` |
| P18-AC-010 | M | Neither marker nor login route observed: `AUTH_STATE_UNDETERMINED`; never classified authenticated (fail closed) |
| P18-AC-011 | M | Auth lost at step k of N: steps k..N marked not executed; authenticated coverage counts only steps before k |
| P18-AC-012 | M | Failure-code enum identical in output, report, dashboard event and docs; no code outside the enum |
| P18-AC-013 | M | Auth-loss exit code differs from test-failure and config-error codes |
| P18-AC-014 | M | Anonymous execution is never implicit; a run without a role is refused unless the manifest declares an anonymous role |
| P18-AC-015 | M | Valid state: zero login requests during the run |
| P18-AC-016 | M | Customer role plan contains zero administrator-only actions |
| P18-AC-017 | M | Each (role, worker) uses a distinct state copy; source file hash unchanged |
| P18-AC-018 | M | A cookie mutated by one worker is absent for another |
| P18-AC-019 | M | Zero per-run state copies remain after normal or failed exit |
| P18-AC-020 | M | Sequential run: every request carries only its role's state |
| P18-AC-021 | M | Worker mode: per-test role assignment honoured; coverage set equals sequential |
| P18-AC-022 | M | Shard bundles contain zero storageState files and zero cookie/token values |
| P18-AC-023 | M | Shard with missing state exits `AUTH_STATE_MISSING`; merged report shows lost coverage, not pass |
| P18-AC-024 | M | Unknown role: `MANIFEST_ROLE_UNKNOWN` with zero target requests |

**18B — dry-run**

| ID | P | Observable requirement |
|---|---|---|
| P18-AC-025 | M | Click, fill, type, submit, download counters all 0 |
| P18-AC-026 | M | Zero POST/PUT/PATCH/DELETE to any origin; GET only to allowed routes |
| P18-AC-027 | M | Provider key configured: zero provider calls at the SDK boundary |
| P18-AC-028 | M | State file hash, storage and fixture data checksum unchanged |
| P18-AC-029 | M | Two identical dry-runs give byte-identical plans and equal digests |
| P18-AC-030 | M | Material field change alters the digest; non-material change (timestamps, run ID, host paths) does not |
| P18-AC-031 | M | Digest mismatch: `PLAN_DIGEST_MISMATCH`, no click/fill/submit |
| P18-AC-032 | M | Material target change since dry-run: `PLAN_DRIFT`, new review required, no approval reused |
| P18-AC-033 | M | Plan lacking schema version or digest (including current `--save-plan` output) refused `PLAN_INVALID` for execute |
| P18-AC-034 | M | Oracle fixture: 100% of oracle controls proposed, zero invented actions |
| P18-AC-035 | S | Each plan action shows policy outcome and reason; summary counts match rows |

**18C — manifest and policy**

| ID | P | Observable requirement |
|---|---|---|
| P18-AC-036 | M | Unknown key or missing field: `MANIFEST_INVALID` naming the path, zero requests |
| P18-AC-037 | M | Unsupported version: `MANIFEST_VERSION_UNSUPPORTED` |
| P18-AC-038 | M | Every schema field documented and vice versa (CI check) |
| P18-AC-039 | M | Default manifest blocks cross-origin navigation/form submit: `POLICY_ORIGIN_DENIED`, zero requests (sub-resources: OD-08) |
| P18-AC-040 | M | Denied route blocked before interaction: `POLICY_ROUTE_DENIED` |
| P18-AC-041 | M | Page/time budget exceeded: `POLICY_BUDGET_EXCEEDED`, no further actions |
| P18-AC-042 | M | Delete/Pay/Transfer/Publish/Send/Submit matrix varied by name, text, type, form action, URL: 100% protected or denied |
| P18-AC-043 | M | A control labelled "Cancel"/"View" with destructive action or URL is protected (any destructive signal wins) |
| P18-AC-044 | M | Manifest business vocabulary term makes a matching control protected |
| P18-AC-045 | M | Provider "safe" never lowers a protected/denied outcome; it may only add caution |
| P18-AC-046 | M | Provider absent or erroring gives the same outcomes; no default permit |
| P18-AC-047 | M | Healing never clicks, and builds no provider prompt for, a protected/denied action |
| P18-AC-048 | M | Approval cannot override denial |
| P18-AC-049 | M | Ambiguous or changed-identity control: `CONTROL_AMBIGUOUS`/`PLAN_DRIFT`, zero clicks |
| P18-AC-050 | S | Artifact policy "none": zero screenshots/traces/DOM snapshots; "on-failure": only failed steps on listed routes |
| P18-AC-081 | C | JSON schema export for editors |

**18D — approval**

| ID | P | Observable requirement |
|---|---|---|
| P18-AC-051 | M | CSRF-protected form: approved protected submit succeeds with in-run token, token absent from artifacts; unapproved: zero POSTs |
| P18-AC-052 | M | No approval: `APPROVAL_REQUIRED`, zero clicks |
| P18-AC-053 | M | Approval bound to plan digest, manifest version, role, action ID; any mismatch `APPROVAL_MISMATCH` |
| P18-AC-054 | M | Expired or pre-change approval: `APPROVAL_STALE` |
| P18-AC-055 | M | Consumed approval reused after process restart: `APPROVAL_REPLAYED` |
| P18-AC-056 | M | Approval for an unknown plan digest: `APPROVAL_UNKNOWN_PLAN` |
| P18-AC-057 | M | Every grant/refusal/consumption has one audit entry with timestamp, approver, digest, action, role, decision, code; no secrets |
| P18-AC-058 | S | Edited approval/history file detected; zero clicks |
| P18-AC-059 | C | Read-only dashboard approval view |

**18E — secret-safe boundary**

| ID | P | Observable requirement |
|---|---|---|
| P18-AC-060 | M | Canaries seeded in cookie, Authorization header, password field, URL token, localStorage, env credential occur zero times in every persisted artifact across execute, dry-run, failed login, expired session and shard runs |
| P18-AC-061 | M | Zero canaries in stdout/stderr of every Phase 18 command |
| P18-AC-062 | M | Zero canaries in dashboard HTML and events JSON |
| P18-AC-063 | M | Zero known credential values in provider prompt captures at the SDK boundary |
| P18-AC-064 | M | Exception carrying an Authorization value is redacted |
| P18-AC-065 | M | Locator memory and healing evidence store no input or cookie values |
| P18-AC-066 | M | Malicious app text is inert in dashboard/reports; ANSI stripped from logs |
| P18-AC-067 | M | Shard bundles hold only permitted artifacts (contents: OD-17) |
| P18-AC-068 | S | Documented cleanup removes artifacts older than the retention period |
| P18-AC-070 | C | Purge command removes all files for a run ID |

**18F, DOC, cross**

| ID | P | Observable requirement |
|---|---|---|
| P18-AC-069 | M | Docs list where application-derived text can appear, default retention, deletion steps |
| P18-AC-071 | M | Every refusal shows a stable code in exit output, report and dashboard event, and goes through `Logger` |
| P18-AC-072 | S | Hermetic dry-run completes within the CI budget (OD-13) |
| P18-AC-073 | M | Fixture suite makes zero non-loopback outbound requests |
| P18-AC-074 | M | Phase 18 matrix on Node 24 CI has zero skipped or expected-fail tests; a skip fails the job |
| P18-AC-075 | M | No CI job invokes GoogleSearchTest |
| P18-AC-076 | M | With no Phase 18 flags, exit codes and reports match the baseline at `2572e73`; existing tests pass unchanged |
| P18-AC-077 | M | Every Phase 18 test runs from an npm script that `ci.yml` calls |
| P18-AC-078 | M | Docs state not-certification, no compliance, no SSO/OIDC/SAML/RBAC, provider cannot weaken denial, residual application text; prohibited phrases absent |
| P18-AC-079 | S | Operator guide commands behave as documented on the fixture |
| P18-AC-080 | M | New `.env.example` keys are genuinely blank |
| P18-AC-082 | M | Release candidate on Node 24 CI: every Must passes with direct evidence; no open P0/P1 |

## Open decisions for the owner

Coordinator note: the recommended defaults are the Product Owner's or the coordinator's proposals and bind no one until decided. The architecture stage may resolve technical ones.

| ID | Decision | Proposed default |
|---|---|---|
| OD-01 | Approval binding fields | digest + manifest version + role + action ID (+ origin, per roadmap) |
| OD-02 | Approval TTL and approver identity source | run-scoped; operator-supplied identity string; no SSO |
| OD-03 | Digest algorithm and material/non-material fields | SHA-256 over canonical JSON; architect lists fields |
| OD-04 | Numeric defaults for page, time and auth-timeout budgets | architect proposes |
| OD-05 | Screenshots default for authenticated roles | off, masking required when on |
| OD-06 | State file location, permissions, retention, cookie-name recording | owner-only (0600), under run output dir, no cookie names recorded |
| OD-07 | Manifest mandatory for execute mode? Backward-compatible default | mandatory for authenticated mode only; legacy runs unchanged (AC-076) |
| OD-08 | Sub-resource cross-origin policy | block unless listed |
| OD-09 | Confirm MFA and manual login are out of scope | out of scope |
| OD-10 | Numeric exit codes for the failure codes | architect proposes; distinct from existing codes |
| OD-11 | Business vocabulary ownership | manifest only |
| OD-12 | Required CI gates and npm script name | architect/DevOps propose |
| OD-13 | Dry-run time budget on the fixture | set after first measurement |
| OD-14 | On-demand purge command in Phase 18 | Could; defer |
| OD-15 | Literal-credential detection rule for manifest fields | name-based and pattern-based; fail closed |
| OD-16 | May a partial Phase 18 be labelled pilot-ready? | no |
| OD-17 | May shard bundles include locator memory or healing evidence? | no |
| OD-18 | May the manifest deny destructive actions outright? | yes; deny beats protected |
| OD-19 | Cross-browser scope for new controls | Chromium only for Phase 18 |

## Residual risks

Application-derived text (an app displaying a token) cannot be guaranteed absent; it is handled by known-value redaction and documentation (AC-069). Screenshots can show secrets unless OD-05 is applied. Auth detection depends on manifest-declared markers; a poor declaration produces `AUTH_STATE_UNDETERMINED`, which is intended fail-closed behaviour. Criteria 010, 034, 042 and 049 depend on fixture oracles. PR #54's `--save-plan` has no digest, so 18B needs a migration note.
