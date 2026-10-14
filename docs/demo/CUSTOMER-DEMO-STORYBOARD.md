# Falcon customer demo: storyboard and caption map

This document describes the demo as it was recorded by `npm run demo:customer`.
Timestamps come from `stage.sceneChanges` in `reports/customer-demo/<layout>/result.json`
and the event times in `timeline.json`, mapped onto the final MP4 timeline
(the compose step trims 0.2 s from the start of the wide cut and nothing from the
portrait cut, so MP4 time is about `scene time − 0.2 s` for wide and equal to
`scene time` for portrait). Final files: wide 73.6 s, portrait 51.0 s, GIF 13.3 s.
Timings vary by a second or two between runs because they follow real events.

## Audience

- QA leaders and automation architects, who want to know whether a changed selector becomes a silent pass or a reviewable decision.
- Engineering managers and teams, who want to know what runs locally, what leaves the machine (nothing on this path), and what is still a technical preview.

## (a) Messaging

**Product promise:** Falcon finishes a browser test when a selector changes, shows exactly what it used instead, and waits for a person before reusing that fix.

**LinkedIn hook:** "Your test failed because a button ID changed. Your product still works. Here is what happens next."

**Thumbnail headline:** Self-healing tests with human control

**Closing call to action:** Looking for feedback from QA leaders, automation architects, and engineering teams. Open-source technical preview: github.com/eddieir/Falcon-Automation

**Recommended LinkedIn post** (plain text, three hashtags):

> A changed button ID can fail a test even when the checkout still works. That is maintenance time, and it makes real product failures harder to spot.
>
> Falcon Automation is an open-source technical preview built on Playwright. In this short demo, on a local checkout app:
>
> 1. The test passes with the original selector.
> 2. The app ships a new release that renames the button's ID.
> 3. The unchanged test fails on the old selector. Falcon then finds the same button using evidence it stored earlier. That match runs on the machine; no AI model or external service is called.
> 4. The order completes, and the replacement is held for review.
> 5. A person approves it in the dashboard. Only then is it reused, and only in the same scope.
>
> Falcon does not silently trust a replacement. It is a technical preview, not a production-ready product, and exploration belongs in local, staging, or disposable environments.
>
> I would like feedback from QA leaders, automation architects, and engineering teams.
>
> github.com/eddieir/Falcon-Automation
>
> #Playwright #TestAutomation #OpenSource

**Accessibility text**

- Full video (1920x1080, about 74 s, no audio): "Screen recording of a checkout page on the left and the Falcon dashboard on the right, with captions across the top and bottom. A test clicks Complete order and passes. The page is updated to a new release in which the button's ID changes. The unchanged test fails on the old ID, then Falcon finds the same button using stored evidence and the order completes. The dashboard shows the replacement waiting for review, a person clicks Approve, and the next run reuses the approved replacement. A closing panel lists the results, then a card reads Falcon Automation, open-source technical preview."
- LinkedIn video (1080x1350, about 51 s, no audio): "Vertical version of the same recording: the checkout page above, the Falcon dashboard below, captions at the bottom. It shows a passing baseline, the button's ID changing, Falcon recovering and the order completing, a person approving the replacement in the dashboard, and the next run reusing it."
- GIF (960x540, about 13 s, loops): "Short loop of the failure and recovery. The old button ID is no longer found, Falcon reports a local evidence match with a match score of 90 percent, the order completes, and the dashboard shows the replacement as pending review with Approve and Reject buttons."
- Poster (1200x627): "Headline: Self-healing tests with human control. A frame from the recording shows the checkout page and the Falcon dashboard, with the label open-source technical preview."

## (b) Scene table

Times are seconds on the final MP4 (wide / portrait). Captions are copied from `scripts/demo/lib/captions.js`.

| # | Scene | Wide / portrait | Composition | Triggering real event | Caption on screen | Customer value | Evidence source |
|---|---|---|---|---|---|---|---|
| 1 | Baseline | 0.3–8.4 / 0.2–5.2 | Left: Northwind Checkout, release v1, Falcon Pro Plan, €49, **Complete order** button. Right: dashboard with zero counts. Header chip 1 Baseline. | `testStart`, then `testPass` for the first run; card "Baseline passed" (Original selector `#checkout-submit`, Result passed) | Baseline: the test works with the original selector. | The starting point is a passing test with a visible selector. | `timeline.json` testPass (baseline); `result.json` phases, `facts`; app shows "Order completed" |
| 2 | Locator changed | 8.4–17.0 / 5.4–11.9 | Header card compares Release v1 `#checkout-submit` and Release v2 `#place-order` (ids read from the live page of each release). App shows release v2 pill. Chip 2. | Fixture version switch on the server; no DOM editing | The product still works. The old selector does not. | A normal front-end release breaks the locator, not the product. | `result.json` `versionIds`; fixture `data-release` and pill |
| 3 | Failure | 17.0–18.8 / 12.0–13.1 | Chip 3 Recovery (amber). Card "Original locator failed" (Original `#checkout-submit`, Attempts 2). Dashboard feed shows the matching row. | `healingStage` `original_failed` after two real 800 ms attempts | The test finds a broken locator—not a broken product. | Separates selector upkeep from real product defects. | `timeline.json` healingStage original_failed |
| 4 | Recovery | 18.8–28.6 / 13.2–20.4 | Cards in order: Recovery started; Local evidence match found (Replacement `[data-testid="checkout-complete"]`, Match score 90%, the first reason); Replacement validated on the live page; Action completed; Approval required before reuse (status pending review). App shows "Order completed" only after Action completed. Dashboard shows the pending review row. | `healingStage` recovery_started, candidate_selected; `healingEvent` tier LocatorMemory status accepted; `healingStage` action_completed, proposal_pending | Falcon looks for the same control using evidence it already stored. / Falcon found a local match with match score 90%. / The replacement was checked against the live page before use. / Falcon completes the test, but does not silently trust the replacement. / Falcon will not reuse the replacement until a person approves it. | The test finishes, the reason is visible, and nothing is trusted yet. | `timeline.json` events with score 0.9, margin 0.6875; order counter in the app; pending candidate in the locator panel |
| 5 | Human approval | 28.6–38.8 / 20.5–27.6 | Dashboard scrolled to the locator panel: original `#checkout-submit`, replacement, scope (application origin, `/checkout`, click), status badge Pending review, Approve and Reject buttons. Cursor moves to Approve and clicks. Chip 4. After the click the badge reads Approved for scoped reuse. | `locatorDecision` kind approve (in-process event after the real `/locator/approve` call) | A person decides what Falcon may reuse. | A person decides; approval is through the dashboard and is not tied to a named individual. | `timeline.json` locatorDecision; `GET /locator/entries` shows the approved replacement |
| 6 | Approved reuse | 38.8–54.2 / 27.8–38.2 | Page reloads on release v2 and the same test runs again. Chip 5. Card "Approved replacement reused" (Review: no new approval needed). Dashboard shows no new pending proposal. App shows "Order completed" and the next order number. | `healingEvent` status approved_reuse; `healingStage` action_completed with `via: approved`; no `proposal_pending` | Future runs reuse the approved fix inside the same scope. | Approval pays off on the next run without another review. | `timeline.json` approved_reuse; `result.json` facts and counts |
| 7 | Evidence and end card | 54.2–73.6 / 38.4–51.0 | Full-canvas evidence panel (Original selector: failed; Recovery: successful; Business action: completed; Human review: approved; Next run: approved replacement reused), then the end card. | Derived from `result.json` `facts` (a false fact would print its opposite) | Falcon Automation. Self-healing browser tests with human control. Discover. Test. Recover. Review. Open-source technical preview. github.com/eddieir/Falcon-Automation. Looking for feedback from QA leaders, automation architects, and engineering teams. | Honest maturity framing and a clear request for feedback. | `evidenceRows()` and `endCard()` in `captions.js` |

Design note on scenes 5 and 6: the captions "A person decides what Falcon may reuse." and "Future runs reuse the approved fix inside the same scope." appear when those phases begin, as statements that are already true at that moment. The cards that assert an outcome ("Approved for scoped reuse", "Approved replacement reused") appear only at or after their real events; `compose.js` fails the build if any card appears before its event.

## (c) Caption map

| Real event or phase | Caption |
|---|---|
| `testStart` (baseline) | Baseline: the test works with the original selector. |
| Release change (fixture switched to v2) | The product still works. The old selector does not. |
| `healingStage` original_failed | The test finds a broken locator—not a broken product. |
| `healingStage` recovery_started | Falcon looks for the same control using evidence it already stored. |
| `healingStage` candidate_selected | Falcon found a local match with match score {score}%. |
| `healingEvent` accepted (LocatorMemory) | The replacement was checked against the live page before use. |
| `healingStage` action_completed (not approved) | Falcon completes the test, but does not silently trust the replacement. |
| `healingStage` proposal_pending | Falcon will not reuse the replacement until a person approves it. |
| Approval phase / `locatorDecision` approve | A person decides what Falcon may reuse. |
| Reuse phase / `healingEvent` approved_reuse | Future runs reuse the approved fix inside the same scope. |
| Refused match (not shown in this run) | No safe replacement found. The test fails instead of guessing. |

## (d) Caption review

| Check | Result |
|---|---|
| Two lines at most, mobile readable | Captions are single sentences under about 75 characters; the stage renders them at 40 px or larger. QA confirms legibility on a downscaled portrait frame. |
| Plain language | No "Tier 2.5", "LocatorMemory", or development-phase wording in any caption. |
| Factual accuracy | Every number and selector on screen comes from `timeline.json` (match score 0.9, two attempts, `#checkout-submit`, `[data-testid="checkout-complete"]`). |
| No exaggeration | No time-saved or accuracy figures, no "production-ready", no certification claims. |
| No AI wording for local matching | The local match is described as evidence the test stored earlier; the LinkedIn copy says no AI model or external service is called. |
| Reviewer identity | Not shown. Captions say "a person" and the card says approved through the dashboard. |
| Healed counter | The dashboard now counts only resolved recoveries. The GIF never shows the counter tiles; the full video shows them honestly, starting at zero during the baseline. |

## Verification status

- Verified from run data: scene order and event times, match score and margin, selector names, version ids, order counts, facts and counts.
- VISUAL CHECK BY QA: caption legibility at phone size, absence of overlap or clipping, that the app shows "Order completed" only after "Action completed", and that the dashboard shows no pending row before "Approval required before reuse".
- Not part of this demo: optional provider-assisted recovery (Tier 3), any third-party site, and authenticated reviewer identity.
