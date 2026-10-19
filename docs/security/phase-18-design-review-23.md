# Phase 18 Security Design Review 23 (SEC-24)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `9bedb43` on `docs/phase-18-architecture` (rev 25, applied on top of `e75cad0`). Scope: the first Security review of everything after rev 23 (`96b1b84`): `git diff 96b1b84..9bedb43`, the rev 25 patch and edits JSON, and the SPIKE and evidence documents. The Security Engineer role is read-only; the coordinator saved this text from the reviewer's report in condensed form without changing findings. Status: **PARTIAL**.

**Verdict: APPROVE WITH CONDITIONS, PARTIAL. Blockers: 0. Majors: 2 open (M-25 carried: superseded by the design but not closed; M-26 new). Minors: 4 new (m-87 to m-90).** m-83 and m-84 are closed. m-82 is closed in the prose only. m-85 is accepted but was not checked in depth. m-86 is only partly closed. The checker and the W6-T conformance measurement have not been run. Accepting any residual risk is the owner's decision.

## Evidence (commands run, read-only)

| Check | Result |
|---|---|
| Both edits JSON files parse with `JSON.parse` | valid |
| AC counts recomputed from the criteria array | 98 total / 89 Must / 6 Should / 3 Could. C6-T still 27/5, sourced from rev 23 D.4 |
| docEdit anchors | Every `old` occurred exactly once at `e75cad0`; every `new` is present once at HEAD; where `old` is still present, `new` contains it (in-place notes) |
| `ac[]` appendText edits | all present (AC-084/085/090/091) |
| Lines removed since `96b1b84` (31) | each is CDP text replaced by a supersession note, or the tmpfs admission being withdrawn. Nothing weakened. No O-1/token line touched. M-23/M-24 still "Closed, not reopened" |
| 40-hex strings | none in the rev 25 files; present in the evidence-workflow proposal (pinned action SHAs) and the Linux runner findings (the run commit), both added by evidence commits, not rev 25 |
| `POLICY_SHARED_WORKER` | only in historical or "must not appear" text |
| W6-T totals | 21+1+7+4+1 = 34; F16 to F21 are unmeasured and refuse (fail-closed), none counts as a pass |

**Not executed:** any browser or harness rerun, the implementation checker, the W6-T conformance run, and a local check of Playwright's evaluate world (`playwright-core/lib/server/frames.js` was not found in `node_modules`).

## Findings

- **M-26 (Major): `armed:true` can be reached when a measurement is missing.** The patch's B.5 `decide(perRealm)` takes no required-realm set. The harness it claims to match (W6 findings, lines 48 to 61) refuses only on `measurable === false` and treats any `typeofSharedWorker` other than `'function'` as absent. A required realm missing from the array, a record with `measurable` undefined, or `typeof` null or `'object'` everywhere would all arm. Impact is limited today because SharedWorker is present on this build and F5/F7/F11/F21 always refuse; it becomes live on the first browser without SharedWorker. Fix: `decide(perRealm, requiredIds)` requires exact id-set equality (no duplicates or extras); each realm passes only if `measurable===true && !error && timedOut===false && typeof==='undefined' && descriptor===undefined && nativeCtor===undefined && constructed===false`; anything else refuses. Verification: add IC3 cases for a missing realm, a duplicate id, undefined `measurable`, and null/`'object'` typeof.
- **M-25 (carried): superseded, not closed.** Stated correctly (AC line 212, patch item 5 and Section I). Closing needs the executed W6-T measurement plus a Security review.
- **m-87: reason precedence differs from the harness.** The patch evaluates "unmeasurable first, across all realms"; the harness stops at the first matching realm, which is why W6 reported `shared_worker_present` for the default configuration although F5/F7/F11 were unmeasurable. Pick one order and state which outcomes W6 actually exercised.
- **m-88:** B.2 and B.6 say `page.evaluate`/`frame.evaluate` run "in an isolated world". Security believes Playwright evaluates in the main world (a hypothesis, not verified locally). The integrity claim should rest on the probe running on Falcon-authored content before navigation plus the pre-captured native reference. F17/F18 (realms after arming) need the same care.
- **m-89: some withdrawn requirements are still live.** AC JSON line 33 (the SPIKE-W item) still says "SPIKE-W2 IS REQUIRED BEFORE 18C MERGES ... every case MEASURED-PASS" with no rev 25 marker; rev 23 patch lines 209 to 216 still list gates 1 (W2-1..16), 2 (the `shared_worker_blocked` test), 3 and 8 (W2-15/16) without a marker. Each needs an in-place SUPERSEDED note.
- **m-90: m-86 residue.** Rev 23 patch line 16 ("tmpfs admitted"), line 203 (the LINUX-01 row) and line 215 (gate 7, "test that tmpfs ... is accepted") contradict E.2; gate 7 would encode tmpfs admission. Correct to "candidate; refused until accepted".
- **Note (no defect assigned):** the probe must be tied to the same browser process and launch configuration that the run then uses; B.2 says the probe launches a fresh browser but never says it is the one the run uses.

## Honesty checks (all hold)

SPIKEW-04 stage 3(a) unresolved; SPIKEW-05 vacuous with the false exit-18 marker named; the exit-137 attribution withdrawn; "permanent" called an inference; 42 runs with the "12" withdrawn; Linux evidence observational only (one image, one day, ramfs id distinct from tmpfs, nothing admitted, no browser launched on Linux); sandbox-evaluate fidelity and `document.write` named as limits of the probe design; popup construction unconfirmed and fail-closed; service worker (F21) required and fail-closed; dedicated worker (F22) informational only; Node 22.19.0 and 24.21.0 both mandated.

Practical impact (arming refused on the current build) is stated directly in plan line 3, Section F and Section G. No bypass, no flag; `--disable-features` is rejected.

## Owner items, correctly left open

OWNER-24 (browser posture) and OWNER-25 (exception process). The flag path is not adopted.
