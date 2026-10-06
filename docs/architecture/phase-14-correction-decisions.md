# Phase 14 correction decisions

Status: implemented for review; release acceptance remains pending final validation.

## Authority and migration

`LocatorMemory` is the sole authority for automatic replacement replay. Identity includes
application, origin, pathname, action and original selector. Global `LocatorStore` alternatives
and legacy `HealingTrust` approvals remain inspectable but cannot grant scoped authority.
Migration requires fresh collection in the intended scope and review of a new proposal. Inferring
scope or fabricating signatures from legacy selector strings was rejected because neither proves
which element was observed. Tier 3 execution can create a scoped proposal, never automatic trust.

Approval retains the replacement selector and signature. Replay checks current uniqueness,
visibility, action compatibility and signature evidence. Successful replay does not re-propose
an already approved repair. Fresh success with the developer's selector can restore revoked trust.

## Durable review and concurrent writers

Substantive sanitized candidate evidence determines an immutable proposal ID; observation timestamps
do not. Approve/reject require the current ID, and rollback requires the current entry revision.
The review output includes score contributions, winner margin, runner-up and field labels for
supporting, changed, missing and contradictory evidence. It does not display hashed attribute values.
Decision records retain the actor channel (`cli` or `dashboard`), not a verified human identity.

Review stages state, acquires an exclusive adjacent lock, compares the durable-file digest and
atomically replaces the file before installing approved state. Invalid requests return 400,
unknown identities 404, stale decisions 409 and persistence failures 503. The CLI fails nonzero.
A process-local queue alone was rejected because independently loaded stores can lose updates.
Blind merging was rejected because it could resolve conflicting trust decisions silently.

Restart a stale instance after a writer conflict. For a crashed lock, stop all writers, inspect
the lock PID and verify that its owner has exited before removing the lock. Never remove a live
or indeterminate owner's lock. The implementation does not steal locks by age.

## Validation and privacy

Schema version 1 is accepted. Bounds include 500 identities, 50 audit rows per entry, 2 KiB per
signature and an 8 MiB serialized envelope. Inputs and returned entries are copied. Unsupported
schema or salt-fingerprint mismatch disables trusted reuse and preserves the original file.
An external `FALCON_LOCATOR_SALT` is not serialized; its fingerprint detects changed salts.
Keep the external salt stable. New memory writes and corruption sidecars use mode 0600; existing
file permissions and containing-directory access remain an operator responsibility.

Own-text collection excludes input, textarea, select, option and contenteditable contents.
Native roles and ARIA/label names are approximations, not the full accessible-name algorithm.
Identity attributes are hashed; bounded names and own text use heuristic redaction. Arbitrary
short secrets, application paths and selectors can still be sensitive. Do not claim universal
secret removal or irrecoverable hashes when a generated salt is stored with the file.

## Benchmark and calibration

The 27-case corpus declares expected outcomes and ground truth. The benchmark uses collection,
matching, production selector building and unique DOM resolution. Storage reporting measures an
actual persisted memory file. Production-path regressions verify actions, scoped replay and review.
Neither corpus success nor zero observed false heals establishes safety for arbitrary pages.

Confidence 0.85 and margin 0.15 remain provisional. Before recalibration, freeze a separate holdout
corpus covering each mutation class, reserve unseen applications and redraws, and label intended
nodes independently of matcher output. Tune only on development fixtures, then report holdout
false heals, refusals, misses and recall without changing holdout labels or thresholds. Retain
structural ambiguity refusals regardless of score. Publish failures as well as successes.

## Rollout and rollback

Inspect existing local memory and back it up before rollout. Unsupported files remain untouched;
do not edit their schema or salt fingerprint to force trust. For migration, keep the original
restricted file, start a fresh supported store and gather new scoped evidence before approval.
Rolling back an entry revokes reuse and retains its prior signature and audit. Rolling back the
application version can reintroduce global replay, so isolate its state and do not reuse newly
approved memory without checking that version's trust semantics. Locator memory remains gitignored
and excluded from CI cache restore/save.

Research sources and disputed capability claims are recorded in the Phase 14 research documents.
A completed matrix is evidence for review, not evidence of an owner approval or release decision.
