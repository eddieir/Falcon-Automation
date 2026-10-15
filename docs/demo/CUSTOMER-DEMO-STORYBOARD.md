# Customer demo storyboard

This is the scene plan for the two videos built from one recorded run of the News journey on a local copy of AI-agency. Reproduction steps, prerequisites and limits are in [CUSTOMER-DEMO.md](CUSTOMER-DEMO.md).

Both videos are composed presentations, not screen recordings: a build script lays recordings of the real processes, and text it derives from the run's own events, onto a fixed stage. Nothing on screen is typed, drawn or animated by hand. A title, caption or card appears only after the recorded event that proves it, and the build refuses a scene whose cards or captions have no recorded event to wait for.

| File | Format | Length |
|---|---|---|
| [`falcon-customer-demo-full-16x9.mp4`](falcon-customer-demo-full-16x9.mp4) | 1920×1080, 30 fps, H.264 | 1 min 42 s |
| [`falcon-customer-demo-linkedin-4x5.mp4`](falcon-customer-demo-linkedin-4x5.mp4) | 1080×1350, 30 fps, H.264 | about 50 s |
| [`falcon-customer-demo-poster.png`](falcon-customer-demo-poster.png) | 1200×627 | still |

There is no GIF. Both videos are silent and readable without narration.

## Approved wording

Use these sentences, and nothing stronger:

- "Falcon runs a saved customer journey against the updated application."
- "Falcon recovered a renamed automation hook because the control retained strong identity evidence."
- "After human approval, a fresh Falcon process reused the trusted replacement."
- "Falcon refused a different structural change when it could not identify the intended control safely."
- "A test hook was renamed during a UI refactor while the control's identity and behavior remained unchanged."

Do not claim: recovery from arbitrary DOM changes; that Falcon discovered the whole journey; LLM-powered recovery (this demo uses none); production readiness; operation against the public AxonRadar site; or permanent repair before approval.

## Full video (16:9)

Scene titles use customer language. Internal names (tiers, the locator store) appear only inside evidence panels; a regression test checks the scene lists for them.

| # | Title on screen | What the viewer sees | The recorded event it waits for | Seconds |
|---|---|---|---|---|
| 1 | The customer's product: AxonRadar | The public AxonRadar home page, labelled "not the test target", and a card saying the application under test is AI-agency, cloned at a pinned commit and run locally. | A still from a read-only visit to the public site. Falcon is never pointed at it. | 7 |
| 2 | Start the application | The real command `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` and AI-agency's own output; a card with the loopback listeners. | The process start, then its "ready" line. | 6.7 |
| 3 | Start Falcon | The real command `node falcon.js --url=… --single-page --save-plan=…`, Falcon's own output, and its browser on the local page. | The process start, then "Test plan saved". | 4 |
| 4 | Discover the customer journey | The selector Falcon captured for Agents, `[data-testid="news-category-agents"]`, and the seven journey steps. The caption says the journey was written for the demo. | "Test plan saved". | 9 |
| 5 | Run the saved journey → Baseline passed | Falcon's browser selects Agents, searches, opens the briefing and checks the heading and source link; a checklist turns green line by line; the dashboard shows 7 passed and Healed 0, and the caption says why Healed is 0. | The dashboard line; each step's pass line; "Test Run Complete". The title changes to "Baseline passed" only then. | 10.8 |
| 6 | The interface changed | The control before and after a refactor (identical on screen), the one-attribute difference in its HTML, and a table of what was compared: label, accessible name, position, state, filtering result, the old hook matching 0 elements and the preserved id matching 1. | The gate step that made those comparisons against the running application. | 12 |
| 7 | Run the same saved journey on the updated app → The saved test broke | The unchanged plan runs; Falcon's three attempts at the old hook fail and the terminal shows them. | First failed attempt; "Tier 1 exhausted". | 9.8 |
| 8 | Falcon looks for the same control → Falcon found a compatible target → The user outcome completed | The recovered click, the journey finishing, Healed 1, and a card with the identity evidence: 0.867 against 0.85, runner-up 0.208, margin 0.658 against 0.15, what was preserved and what changed. | "Tier 1 exhausted"; the moment the dashboard showed Healed 1; "Test Run Complete". | 12.6 |
| 9 | Human approval required | The reviewer's dashboard view, the Approve button, the pointer moving to it, then "Approved for scoped reuse". | Pending proposal visible; the click; the confirmation. | 5.6 |
| 10 | Start a fresh Falcon process → Approved repair reused | A new process runs the same plan; the old hook is still gone; Falcon applies the approved replacement; a card quotes the report: status `approved_reuse`, no other recovery events. | The new process start; the replacement's pass line; "Test Run Complete". | 13.8 |
| 11 | Evidence ready for review | The run in numbers, the safety boundary (a separate change was refused, nothing created or clicked), and how the video was made. | End of the reuse run. | 11 |

The safety boundary in scene 11 comes from a separate recorded run (the structural change, below). It never interrupts the recovery story.

## LinkedIn cut (4:5)

| # | Title | Content |
|---|---|---|
| 1 | A UI refactor renamed a test hook | The one-attribute difference, and the saved test still looking for the old hook. |
| 2 | Same saved test, updated app → The saved test breaks | Falcon's browser and dashboard; the old hook is not found. |
| 3 | No identity evidence, no guess | The structural change that was refused, with the reason and the fact that no click or proposal followed. |
| 4 | With identity, Falcon looks again → Falcon finds the same control → The customer journey completes | The recovered click, the dashboard at Healed 1, and the score and margin. |
| 5 | A person decides | The Approve click in the dashboard. |
| 6 | A fresh Falcon process starts → The approved repair is reused | The new process, `approved_reuse`, 7 of 7. |
| 7 | Evidence, not guesses | One line per fact that was demonstrated. |

## What is shortened, slowed or added for viewing

- Terminal and dashboard panels show recordings and captured output of the real processes, in recorded order. Lines are an excerpt chosen by pattern; none is altered except that machine paths are removed.
- Idle waits are cut by speeding a window up (the panel says "shown ×N faster"); the few fast moments are slowed (the panel says "slowed ×N"). A window is never slowed below half speed.
- Falcon's browser pauses 1.5 seconds after each action in the recorded run, so the journey can be followed. The recorded run itself passed every gate step with that pause.
- The reviewer reads the pending proposal for 8 seconds before approving, as a person would.
- The dashboard is recorded twice at different sizes (counters, and the locator panel scrolled into view) and a visible pointer is added to the locator view so the click can be seen.
- Dependency installation is not shown.
