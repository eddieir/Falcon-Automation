# Customer demo: a renamed test hook, recovered, approved and reused

This demo runs Falcon's real `node falcon.js` against a local copy of AI-agency (the open-source application behind the public AxonRadar site). A saved customer journey passes. A UI refactor renames one test hook. Falcon recovers because the control kept strong identity evidence, a person approves the repair in the dashboard, and a fresh Falcon process reuses it. In a separate run, Falcon refuses a different change because the control had no stable identity to prove it was the same control.

Watch it: [full video (1 min 42 s, 16:9)](falcon-customer-demo-full-16x9.mp4) · [LinkedIn cut (about 50 s, 4:5)](falcon-customer-demo-linkedin-4x5.mp4) · [scene plan](CUSTOMER-DEMO-STORYBOARD.md)

## What this demonstrates, and what it does not

It demonstrates, with evidence the run records:

1. **Falcon runs a saved customer journey against an application.** The journey has seven steps (select the Agents category, search, check the match, open the briefing, check the heading, check the source link and its `rel`). The steps were written for the demo; Falcon captured the selector of the Agents control itself (`--single-page --save-plan`).
2. **A renamed test hook breaks the saved test and Falcon recovers it.** Only the `data-testid` changes. The control's `id`, label, accessible name, position, state, behavior and filtering are unchanged, and the run checks each of these against the running application before and after.
3. **Recovery needs a person.** The replacement is proposed as pending; the Healed counter and the report show the recovery; only a click on Approve in the real dashboard makes it trusted for reuse.
4. **A fresh process reuses the approved replacement** and the report records `approved_reuse` with no new scoring, refusal or pending proposal.
5. **Falcon refuses what it cannot prove.** With no stable hook on the control, a structural change is refused (`insufficient_identity_evidence`) before any candidate is scored; no click or proposal follows.

It does not demonstrate, and the videos do not claim: recovery from arbitrary DOM changes; that Falcon discovers the whole journey; LLM-powered recovery (none is configured; credential-like environment variables are not passed to the processes); production readiness; any operation against the public AxonRadar site (one read-only screenshot of its home page is the only contact); or permanent repair before approval.

## The parts of the story, and where each is recorded

| Part | What happens | Where the evidence is |
|---|---|---|
| Public reference | AxonRadar shown for context. | A screenshot only. Falcon is never pointed at it. |
| Local target | AI-agency at a pinned commit, patched in a scratch copy, started with its own `npm run dev` bound to 127.0.0.1. | The process output and the listening addresses, all loopback. |
| Falcon startup | `node falcon.js --url=<local>/news --single-page --save-plan=<file>` explores the page and saves a versioned plan. | Falcon's output; the plan file. |
| Baseline | `node falcon.js --plan=<journey>` with the dashboard on. | 7 of 7 passed, no recovery events, dashboard Healed 0. |
| Mutation | The controlled test-hook rename is applied to the scratch copy and the application restarted. | The old selector matches 0 elements; the preserved id matches 1. |
| Recovery | The unchanged plan runs against the changed application. | Three failed attempts at the old hook, then an accepted candidate, a pending proposal, Healed 1, 7 of 7. |
| Approval | A person clicks Approve in the dashboard. | The panel moves from "Pending review" to "Approved for scoped reuse"; the proposal is persisted. |
| Reuse | A new Falcon process runs the same plan. | The report event `approved_reuse`; 7 of 7. |
| Safety boundary | A different structural change is applied to a copy without stable hooks. | A refused recovery, `insufficient_identity_evidence`, no proposal, no click. |

## Prerequisites

Falcon (this repository):

- Node.js 22 or later, `npm ci`, and Playwright's Chromium (`npx playwright install chromium`).
- `ffmpeg` and `ffprobe` only if you build the videos.

AI-agency ([eddieir/AI-agency](https://github.com/eddieir/AI-agency)):

- Pinned commit **`f56928fbf2eaf2622c7f7e36157e0abbc2a5996d`**, the one this demo was recorded and tested against. The scripts clone it, check out exactly that commit and refuse any other.
- Git and npm. The scripts run `npm ci` in the scratch copy. Nothing is installed or changed in your own clone.
- The `.patch` files used are in [`ai-agency/`](ai-agency/README.md). AI-agency's own `npm run build` needs GNU `timeout` (not present on macOS); the demo does not run the build.

## Reproduce it from a clean state

Point `AGENCY_SOURCE` at a local clone of AI-agency (or its URL). Every command writes to a work directory it creates and empties itself; it will not touch a non-empty directory it did not create.

```bash
# 1. The positive gate: baseline, rename, recovery, approval, reuse (a few minutes, mostly `npm ci` in the scratch copy)
AGENCY_SOURCE=<path-or-url> node scripts/demo/gate-run.js hook-rename <workDir>

# 2. The negative gate: a structural change is refused
AGENCY_SOURCE=<path-or-url> node scripts/demo/gate-run.js structural <workDir2>
```

Each prints one line per step and exits 0 only if the expected outcome was proven. `<workDir>/gate-result.json` records the evidence in a versioned format (`falcon-demo-gate-result`, version 1) with machine paths, timestamps, ports and credentials removed. For the negative gate, exit 0 means Falcon refused as it should.

To record the videos, run the same scenario with capture on, then build:

```bash
AGENCY_SOURCE=<path-or-url> node scripts/demo/record-run.js <workDir>

node scripts/demo/media/build.js --capture=<workDir>/capture --format=wide     --out=docs/demo/falcon-customer-demo-full-16x9.mp4
node scripts/demo/media/build.js --capture=<workDir>/capture --format=portrait --out=docs/demo/falcon-customer-demo-linkedin-4x5.mp4
node scripts/demo/media/poster.js --video=docs/demo/falcon-customer-demo-full-16x9.mp4 --out=docs/demo/falcon-customer-demo-poster.png
```

`record-run.js` runs both gates, saves videos of Falcon's browser and of two views of the real dashboard, stills of the control, and every line the processes printed, and takes one read-only screenshot of the public AxonRadar home page. `build.js` refuses a recording whose gate did not pass, and checks the finished file's size, codec and length.

### Using the saved-plan commands yourself

```bash
node falcon.js --url=http://127.0.0.1:5173/news --single-page --save-plan=plan.json   # write the plan Falcon generated
node falcon.js --plan=plan.json                                                       # replay a saved plan
```

A saved plan is a versioned JSON document (`falcon-test-plan`, version 1) of `click`, `type`, `select` and `expect` steps; `"journey": true` runs the steps in order without returning to the start page and stops at the first step that does not pass. A plan that does not validate exits 2 before any browser or dashboard starts; a run that fails exits 1. Details are in the [technical reference](../technical-reference.md).

## The deterministic seed

AI-agency's News page normally shows live feeds. Patch `01-deterministic-news-seed.patch` adds a fixed nine-article seed, used only when `AXON_DEMO_SEED=1` is set in the dev server's environment (the scripts write it to the scratch copy's ignored `.env.local`). The Agents briefing, `Lighthouse Agent Protocol lets coding agents hand off long tasks safely`, is always the same, so the journey can search for it and check its source link.

## The hooks and the controlled rename

AI-agency's category buttons carry no stable hooks. Patch `02-stable-test-hooks.patch` is demo instrumentation that gives every category button an `id` and a `data-testid` (`news-category-<slug>`). That is what lets Falcon capture a `data-testid` selector, the strongest hook on the page.

The controlled change, `03-test-hook-rename.patch`, renames only the test id: `news-category-<slug>` becomes `news-filter-<slug>`. The `id`, visible label, accessible name, position, behavior and filtering are untouched. The run asserts that, against the running application, with a position tolerance of 2 px.

The video describes this as: *a test hook was renamed during a UI refactor while the control's identity and behavior remained unchanged.* The thresholds are Falcon's defaults and were not touched.

## Expected counters and evidence

Dashboard counters (Total / Passed / Failed / Skipped / Healed / Quarantined):

| Moment | Counters |
|---|---|
| Baseline, finished | 7 / 7 / 0 / 0 / **0** / 0 |
| Recovery, old hook failing | 0 / 0 / 0 / 0 / 0 / 0 |
| Recovery, candidate accepted | Healed becomes **1** (while the proposal is pending) |
| Recovery, finished | 7 / 7 / 0 / 0 / **1** / 0 |
| Fresh process, finished | 7 / 7 / 0 / 0 / **1** / 0 |

Healed is 0 at the baseline because nothing needed repair; the video says so on screen.

Report and stored evidence:

- Baseline report: `PASSED`, 7 of 7, no recovery events.
- Recovery: one event with the original `[data-testid="news-category-agents"]`, resolved `[data-testid="news-filter-agents"]`, status `accepted`; the run summary says `Self-healing: 1 selector(s) repaired`.
- The pending proposal (in `data/locator_memory.json` of the scratch Falcon copy): confidence **0.867** against a minimum of 0.85; runner-up **0.208**; margin **0.658** against a minimum of 0.15. Same: `id`, `type`, tag, role, accessible name, text, structure, position. Changed: `data-testid`. The score is made of attribute 0.267, accessible name 0.25, structure 0.15, text 0.1 and position 0.1.
- After Approve: the entry holds the approved alternative and no pending proposal.
- Fresh process: one event, status `approved_reuse`, and no `accepted`, `refused` or `pending` events.

The numbers above are from the recorded run and are stable for this seed and viewport; the proposal's identifier and timestamps differ every run.

## The negative safety case

`structural-hidden-status.patch` is applied to a copy **without** the stable hooks and adds a visually hidden status region before the filters. The category buttons keep their look and behavior, but their structural path shifts, so the selector Falcon captured (a structural path) matches nothing.

Falcon's reply is the correct one: the control has no `id` or test-id in its baseline snapshot, so there is nothing to prove it is the same control, and recovery is refused with `insufficient_identity_evidence` before any candidate is scored. The step is reported unavailable, the remaining six are skipped, no proposal is created and nothing is clicked. The gate counts that refusal as a pass; it is evidence that Falcon declines to guess among look-alike controls, not a Falcon failure. The video states this in one card and never lets it interrupt the recovery story.

## How the videos are composed

They are composed presentations, not screen recordings. A build script lays recordings of Falcon's own browser, of two views of the real dashboard, and the captured output of the real processes onto a fixed stage:

- **Terminal panels** list lines the processes printed, in order. They are an excerpt chosen by pattern, with machine paths removed; no line is added or edited. The command lines shown are the commands that were run.
- **Pauses are shortened or lengthened and the panel says so.** A recorded window may be sped up ("shown ×1.5 faster") or slowed to at most half speed ("slowed ×1.8").
- **Falcon's browser pauses 1.5 s after each action** in the recorded run so the journey can be followed, and the reviewer reads the pending proposal for 8 s before clicking. The gate steps all passed in that run.
- **Added for visibility:** a pointer on the locator-panel view of the dashboard, and the locator panel scrolled into view. Nothing is added to Falcon's own page.
- **Nothing is drawn or typed by hand.** Each title, caption and card is anchored to the recorded event that proves it, and the builder refuses one that has no such event. Where a claim needs the Healed counter to read 1, it appears only after the recorded moment the counter showed it.

## Cleanup

Everything is created inside the work directory you gave and the operating system's temporary directory.

```bash
rm -rf <workDir> <workDir2>          # the scratch AI-agency copy, Falcon copy, plans, videos and results
```

If a run is interrupted with Ctrl-C (or SIGTERM), the scripts stop AI-agency, Falcon, the dashboard and their browsers and exit with 130 (or 143). If a listener is still on port 5173 afterwards, find it with `lsof -nP -iTCP:5173 -sTCP:LISTEN` and stop that process.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `AI-agency is at …, expected f56928f…` | The clone could not be checked out at the pinned commit. Use a full clone (not shallow) of AI-agency. |
| `AI-agency did not start within 120s` / `--strictPort` error | Port 5173 is in use. Stop whatever holds it; the gate uses 5173. |
| `AI-agency is not loopback-only` | The dev server bound a non-loopback address. The gate stops it; check for a proxy or an edited dev command. |
| `refusing to reuse a non-empty directory` | `<workDir>` exists and was not created by a gate run. Pick a new directory or delete it yourself. |
| `HydrationError … never became pressed` | The page did not become interactive within the time limit; rerun, and check the machine is not overloaded. |
| `gate step failed: …` | The named step is the first thing that did not hold; `<workDir>/gate-result.json` has the evidence up to that point. |
| The refusal gate "fails" | It passes only when Falcon refuses with `insufficient_identity_evidence`. Anything else, including a recovery, fails it. |
| `ffmpeg failed` while building | Install `ffmpeg` with an H.264 encoder (`libx264`). |
| Videos differ from the committed ones | Timing, proposal identifiers and timestamps differ on every run; the structure, counters and scores should match. |

## Limitations

- One control, one kind of change. Recovery works here because the control kept an `id` and the page kept its structure; it is not a general claim about DOM changes.
- The journey is authored. Falcon captured the selector; it did not discover the seven steps.
- The thresholds (0.85 confidence, 0.15 margin) are Falcon's provisional, uncalibrated defaults. They were not changed and were not tuned for this demo.
- The demo patches add test hooks and a data seed to a scratch copy. AI-agency's own repository is never modified.
- Approval is a click in a local dashboard on the same machine. There is no reviewer identity.
- Recorded for macOS and a 1280×720 browser; the proposal's position score depends on the viewport.
- The fresh process still tries the old hook for about ten seconds before applying the approved replacement; reuse avoids a new search, not the first attempt.

## Where the old checkout fixture went

An earlier version of this demo used a small made-up checkout page. That fixture ([`tests/fixtures/customer-demo`](../../tests/fixtures/customer-demo/README.md)) remains as automated test coverage of the same capabilities; it is not a customer demo and no video of it is kept.
