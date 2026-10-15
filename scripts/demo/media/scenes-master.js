"use strict";
/**
 * The full 16:9 customer demo. Each scene shows a window of the recorded run;
 * every card and caption names the real event it waits for.
 */

const { DEFAULTS } = require("../../../src/core/locator/CandidateMatcher");
const { lib } = require("./helpers");

const rect = (x, y, w, h) => ({ x, y, w, h });
const BROWSER = "Application under test — Falcon's browser";
const COUNTERS = "Falcon dashboard — counters";
const LOCATOR = "Falcon dashboard — locator evidence";

function masterScenes(cap, fmt) {
  const h = lib(cap, fmt);
  /** A scene that shows recorded videos starts once they have all begun. */
  const afterVideos = (from, ...sources) => Math.max(from, ...sources.map((v) => cap.video(v).startMs + 150));
  const { L, win, videos, card, bottomTerm, journeySteps } = h;
  const ev = cap.evidence;
  const sha = cap.run.agencySha.slice(0, 7);
  const oldSel = ev.capturedAgentsLocator;
  const newSel = ev.resolvedLocator;
  const pend = ev.pendingProposal;
  const margin = pend.margin;
  const scenes = [];

  // 1 ── the customer's product ------------------------------------------------
  scenes.push({
    id: "public", title: "The customer's product: AxonRadar", subtitle: "A public AI-news site, shown for context only",
    from: 0, to: 7000, dur: 7, static: true,
    assets: { public: cap.still("public-axonradar.png") },
    stills: [{ rect: rect(48, 176, 1100, 619), asset: "public", label: "Public reference — axonradar.netlify.app" }],
    badges: [{ rect: rect(1176, 146, 330, 36), text: "Not the test target", bg: "#3a2a12", fg: "#ffc857", size: 22 }],
    cards: [card("statement", "sideCard", 0, { rect: rect(1176, 200, 696, 595), title: "What Falcon tests in this demo", lines: [
      { text: "AI-agency", size: 40 },
      { text: "the open-source application behind AxonRadar", size: 28 },
      { text: `Cloned at a pinned commit (${sha}) and run on this computer`, size: 28, tone: "accent" },
      { text: "Falcon is never pointed at the public site", size: 28 },
    ] })],
    captions: [{ after: 0, text: "The customer ships AxonRadar. We test its source locally, not the live site." }],
  });

  // 2 ── start the application ---------------------------------------------------
  const cmdAgency = cap.command("agency", 0).t;
  const ready = cap.mark("agency:ready");
  scenes.push({
    id: "start-app", title: "Start the application", subtitle: "AI-agency, started with its own dev command",
    ...win(cmdAgency - 400, ready + 2200, 1),
    terminal: { rect: rect(48, 150, 1824, 400), rows: 13, labels: ["agency"], commands: [{ label: "agency", nth: 0 }], include: (l) => /dev|vite|Using secrets|ready in|Local:/.test(l.line) && !/GET /.test(l.line) },
    cards: [
      card("kv", "bodyLeft", ready, { rect: rect(48, 580, 900, 200), title: "Where it is listening", rows: ev.listening.map((a) => ({ k: "Listener", v: a, mono: true, tone: "good" })) }),
      card("statement", "bodyRight", cmdAgency, { rect: rect(972, 580, 900, 200), title: "Before this point", size: 26, lines: [{ text: "Dependencies were installed beforehand with npm ci (not shown).", size: 26 }, { text: "News data is a fixed demo seed, so the page is deterministic.", size: 26 }] }),
    ],
    captions: [
      { after: cmdAgency, text: "Start the application: npm run dev, bound to 127.0.0.1." },
      { after: ready, text: "The application is up and listening on loopback only.", tone: "good" },
    ],
  });

  // 3 ── start Falcon ------------------------------------------------------------
  const disc = cap.mark("falcon-discover:start");
  const discEnd = L("falcon-discover", /Test Run Complete/);
  scenes.push({
    id: "start-falcon", title: "Start Falcon", subtitle: "The real falcon.js entry point, pointed at the local application",
    ...win(afterVideos(disc - 300, "app:falcon-discover"), discEnd + 800, 1.2),
    videos: videos("falcon-discover", { app: BROWSER }),
    terminal: bottomTerm({ labels: ["falcon-discover"], commands: [{ label: "falcon-discover", nth: 0 }], include: (l) => /Navigating|Loaded:|Test plan saved|scenario\(s\) generated|Test Run Complete|Total:/.test(l.line) }),
    cards: [card("kv", "dashLocator", disc, { rect: rect(960, 176, 912, 330), title: "Falcon run", rows: [
      { k: "Entry point", v: "node falcon.js", mono: true },
      { k: "Target", v: ev.journeyPlan.url, mono: true },
      { k: "Mode", v: "--single-page --save-plan", mono: true },
      { k: "Dashboard", v: "off for this exploration run" },
    ] })],
    captions: [
      { after: disc, text: "Start Falcon against the local application." },
      { after: L("falcon-discover", /Test plan saved/), text: "Falcon explored the page and saved a plan of what it found." },
    ],
  });

  // 4 ── discover the customer journey -------------------------------------------
  const saved = L("falcon-discover", /Test plan saved/);
  scenes.push({
    id: "discover", title: "Discover the customer journey", subtitle: "Falcon supplied the control's selector; the seven steps were written for this demo",
    from: saved, to: saved + 500, dur: 9, static: true,
    cards: [
      card("code", "bodyLeft", saved, { rect: rect(48, 150, 900, 420), title: "What Falcon captured for “Agents”", chip: "from the saved plan", lines: [
        { text: "Falcon's saved plan, Agents category button:" },
        { text: `locator: ${oldSel}`, tone: "hl" },
        { text: "Strongest hook on the page: data-testid" },
      ] }),
      card("checks", "bodyRight", saved, { rect: rect(972, 150, 900, 560), size: 26, title: "The saved customer journey (7 steps)", items: ev.journeyPlan.scenarios.map((s) => ({ text: s.description, state: "pending", detail: s.action === "expect" ? "check" : s.action })) }),
    ],
    captions: [{ after: saved, text: "Falcon runs a saved customer journey against the application. It did not discover the journey by itself." }],
  });

  // 5 ── baseline passed ----------------------------------------------------------
  const bDash = L("falcon-baseline", /Dashboard →/);
  const bDone = L("falcon-baseline", /Test Run Complete/);
  scenes.push({
    id: "baseline", title: "Run the saved journey", subtitle: "Before any change, the saved plan runs end to end",
    titles: [{ after: bDone, title: "Baseline passed", subtitle: "Before any change, the saved journey runs end to end" }],
    ...win(afterVideos(bDash - 600, "app:falcon-baseline", "dash:dash-baseline-summary"), bDone + 2400, 0.8),
    videos: videos("falcon-baseline", { app: BROWSER, summary: COUNTERS }),
    terminal: bottomTerm({ labels: ["falcon-baseline"], commands: [{ label: "falcon-baseline", nth: 0 }], include: (l) => /Dashboard →|Running saved plan|Executing|Passed:|Assertion passed|Test Run Complete|Total:/.test(l.line) }),
    cards: [card("checks", "dashLocator", bDash, { rect: rect(960, 350, 912, 312), size: 20, title: "Saved journey — as Falcon reports each step", items: journeySteps("falcon-baseline") })],
    captions: [
      { after: bDash, text: "Falcon's dashboard is available while the saved plan runs." },
      { after: L("falcon-baseline", /Passed: Select the Agents/), text: "Select Agents → search → open the briefing → check the heading and source link." },
      { after: bDone, text: "7 of 7 steps passed. Nothing needed repair, so Healed is still 0.", tone: "good" },
    ],
  });

  // 6 ── the interface changed ----------------------------------------------------
  const same = cap.mark("step:same-control-by-targeted-assertions");
  const b = ev.before;
  const a = ev.after;
  const px = (box) => `x ${box.x.toFixed(0)}, y ${box.y.toFixed(0)}, ${box.width.toFixed(0)}×${box.height.toFixed(0)}`;
  scenes.push({
    id: "changed", title: "The interface changed", subtitle: "A UI refactor renamed one test hook. Nothing the customer sees changed.",
    from: same, to: same + 500, dur: 12, static: true,
    assets: { before: cap.still("control-before-idle.png"), after: cap.still("control-after-idle.png") },
    cards: [
      card("images", "bodyLeft", same, { rect: rect(48, 150, 900, 300), title: "What a customer sees", column: true, size: 22, items: [
        { asset: "before", caption: "Before the refactor" }, { asset: "after", caption: "After the refactor — the same control" },
      ] }),
      card("code", "bodyRight", same, { rect: rect(972, 150, 900, 300), title: "What the test hook looked like", size: 22, lines: [
        { text: `- ${b.html}`, tone: "del" }, { text: `+ ${a.html}`, tone: "add" },
        { text: "id, label, accessible name, position, state and behavior: unchanged", tone: "hl" },
      ] }),
      card("checks", "body", same, { rect: rect(48, 470, 1824, 454), size: 25, title: "Checked against the running application, before and after", items: [
        { text: "Visible label", state: "pass", detail: `“${a.label}” both times` },
        { text: "Accessible name", state: "pass", detail: a.ariaSnapshot.replace(/^- /, "") },
        { text: "Position (tolerance 2 px)", state: "pass", detail: `${px(b.box)}  →  ${px(a.box)}` },
        { text: "Enabled / pressed state", state: "pass", detail: `enabled, aria-pressed ${b.pressed} → ${b.pressedAfterClick} on click, both times` },
        { text: "Filtering result", state: "pass", detail: `${a.filteredTitles.length} Agents articles shown, same titles` },
        { text: "Original data-testid selector now matches", state: "fail", detail: `${a.oldLocatorMatches} elements` },
        { text: "Preserved id (#news-category-agents) matches", state: "pass", detail: `${a.idMatches} element` },
      ] }),
    ],
    captions: [{ after: same, text: "A test hook was renamed during a UI refactor while the control's identity and behavior remained unchanged." }],
  });

  // 7 ── the saved test broke -----------------------------------------------------
  const rLoaded = L("falcon-recovery", /Loaded:/);
  const tried = L("falcon-recovery", /Tier 1: Trying Select the Agents/);
  const fail1 = L("falcon-recovery", /Attempt 1 failed/);
  const exhausted = L("falcon-recovery", /Tier 1 exhausted/);
  scenes.push({
    id: "broke", title: "Run the same saved journey on the updated app", subtitle: "The plan has not been edited",
    titles: [{ after: fail1, title: "The saved test broke", subtitle: "The same unchanged plan, run against the updated application" }],
    ...win(rLoaded - 700, exhausted + 700, 1.1),
    videos: videos("falcon-recovery", { app: BROWSER, summary: COUNTERS, locator: LOCATOR }),
    terminal: bottomTerm({ labels: ["falcon-recovery"], commands: [{ label: "falcon-recovery", nth: 0 }], include: (l) => /Dashboard →|Running saved plan|Executing|Tier 1: Trying|Attempt \d failed|Tier 1 exhausted/.test(l.line) }),
    captions: [
      { after: tried, text: `The saved journey looks for ${oldSel}` },
      { after: fail1, text: "…and does not find it. Falcon keeps trying (attempt 1 of 3).", tone: "warn" },
      { after: exhausted, text: "All 3 attempts failed: the original test hook is gone.", tone: "bad" },
    ],
  });

  // 8-9 ── Falcon found a compatible target; the user outcome completed -------
  // These happen at once in the run (the recovered click lets the journey run
  // while the proposal appears), so they share one window and the title changes
  // when the journey completes.
  const pv = cap.mark("recovery:pending-visible");
  const healed = cap.mark("recovery:healed-counter"); // the dashboard is showing Healed 1 from here on
  const rDone = L("falcon-recovery", /Test Run Complete/);
  const evid = pend.winner.evidence;
  const FRIENDLY = { "attributes.id": "id", "attributes.type": "type", tagName: "tag", role: "role", accessibleNameApprox: "accessible name", textApprox: "text", structuralPath: "structure", boundingBoxBucket: "position" };
  const preserved = evid.supporting.map((k) => FRIENDLY[k]).filter(Boolean);
  scenes.push({
    id: "found", title: "Falcon looks for the same control", subtitle: "The original hook is exhausted; Falcon compares what it remembered with the page",
    titles: [{ after: healed, title: "Falcon found a compatible target", subtitle: "The control kept its identity, so Falcon proposes the renamed hook" }, { after: rDone, title: "The user outcome completed", subtitle: "The recovered click let the whole journey finish" }],
    ...win(exhausted - 300, rDone + 2500, 0.6),
    posterAt: rDone + 300, // a frame with the journey complete and Healed 1 on screen
    videos: videos("falcon-recovery", { app: BROWSER, summary: COUNTERS }),
    cards: [
      card("checks", "dashLocator", exhausted, { rect: rect(960, 346, 912, 326), size: 19, title: "Saved journey — as Falcon reports each step", items: journeySteps("falcon-recovery", { hookMissing: true }) }),
      card("bars", "bottomLeft", pv, { title: "Identity evidence", chip: "accepted at the unchanged thresholds", chipTone: "good", size: 22, bars: [
        { label: newSel, mono: true, value: `${pend.total.toFixed(3)}  (needs ≥ ${DEFAULTS.MIN_CONFIDENCE})`, fraction: pend.total, mark: DEFAULTS.MIN_CONFIDENCE, tone: "good" },
        { label: "Runner-up (a structural look-alike)", value: pend.runnerUp.total.toFixed(3), fraction: pend.runnerUp.total, tone: "bad" },
        { label: "Margin over the runner-up", value: `${margin.toFixed(3)}  (needs ≥ ${DEFAULTS.WINNER_MARGIN})`, fraction: Math.min(1, margin), mark: DEFAULTS.WINNER_MARGIN, tone: "good" },
      ] }),
      card("kv", "bottomRight", pv, { title: "Same control", size: 22, rows: [
        { k: "Preserved", v: preserved.join(", ") },
        { k: "Changed", v: evid.changed.map((k) => k.replace("attributes.", "")).join(", "), tone: "warn" },
      ] }),
    ],
    captions: [
      { after: exhausted, text: "The original hook is exhausted. Falcon now compares the page with what it remembered about the missing control." },
      { after: healed, text: `Same control found through its stable identity: ${newSel}, pending human review.`, tone: "good" },
      { after: rDone, text: `7 of 7 steps passed. Healed: ${cap.markDetail("recovery:healed-counter")}.`, tone: "good" },
    ],
  });

  // 10 ── human approval ----------------------------------------------------------
  const click = cap.mark("approval:click");
  const confirmed = cap.mark("approval:confirmed");
  scenes.push({
    id: "approval", title: "Human approval required", subtitle: "Falcon does not make the repair permanent on its own",
    ...win(rDone + 2500, confirmed + 2600, 1.15),
    videos: [
      { source: "dash:dash-recovery-locator", rect: rect(48, 176, 1300, 358), label: LOCATOR, crop: fmt.crop.dashLocator },
      { source: "dash:dash-recovery-summary", rect: rect(48, 572, 1300, 228), label: COUNTERS },
    ],
    cards: [card("statement", "sideCard", confirmed, { rect: rect(1376, 150, 496, 650), title: "Approved for scoped reuse", chip: "by a person", chipTone: "good", size: 24, lines: [
      { text: "Replacement trusted for this control and page only", size: 22 }, { text: newSel, size: 22, tone: "good" },
    ] }),
    card("statement", "sideCard", pv, { until: confirmed, rect: rect(1376, 150, 496, 650), title: "Pending review", size: 24, lines: [
      { text: "Original hook", size: 22 }, { text: oldSel, size: 22, tone: "bad" },
      { text: "Proposed replacement", size: 22 }, { text: newSel, size: 22, tone: "accent" },
      { text: `confidence ${pend.total.toFixed(3)} · margin ${margin.toFixed(3)}`, size: 22 },
    ] })],
    captions: [
      { after: pv, text: "The proposal waits for a person. Nothing is trusted yet.", tone: "warn" },
      { after: click, text: "The reviewer clicks Approve in the real dashboard." },
      { after: confirmed, text: "Approved for scoped reuse — saved by Falcon, not edited by hand.", tone: "good" },
    ],
  });

  // 11 ── approved repair reused ---------------------------------------------------
  const reuseDone = L("falcon-reuse", /Test Run Complete/);
  const reusePassed = L("falcon-reuse", /Passed: Select the Agents/) + 800;
  const reuseEv = ev.reuse.events.find((e) => e.status === "approved_reuse");
  scenes.push({
    id: "reuse", title: "Start a fresh Falcon process", subtitle: "The same unchanged saved journey, in a new process",
    titles: [{ after: reusePassed, title: "Approved repair reused", subtitle: "A fresh Falcon process runs the same unchanged saved journey" }],
    ...win(afterVideos(cap.mark("falcon-reuse:start") - 300, "app:falcon-reuse", "dash:dash-reuse-summary", "dash:dash-reuse-locator"), reuseDone + 5200, 1.5),
    videos: videos("falcon-reuse", { app: BROWSER, summary: COUNTERS, locator: LOCATOR }),
    cards: [card("kv", "dashLocator", reuseDone, { rect: rect(960, 346, 912, 326), size: 21, title: "From Falcon's report (test-report.json)", chip: "fresh process", chipTone: "good", rows: [
      { k: "Recovery status", v: reuseEv.status, mono: true, tone: "good" },
      { k: "Applied", v: reuseEv.resolved, mono: true },
      { k: "Instead of", v: reuseEv.original, mono: true },
      { k: "Other recovery events", v: "none: no new scoring, no refusal, nothing pending", tone: "good" },
      { k: "Journey", v: `${ev.reuse.summary.passed} of ${ev.reuse.summary.total} passed`, tone: "good" },
    ] })],
    terminal: bottomTerm({ labels: ["falcon-reuse"], commands: [{ label: "falcon-reuse", nth: 0 }], include: (l) => /Dashboard →|Running saved plan|Tier 1: Trying|Tier 1 exhausted|Passed:|Test Run Complete|Total:|Self-healing/.test(l.line) }),
    captions: [
      { after: cap.mark("falcon-reuse:start"), text: "A new Falcon process starts. The old hook is still gone." },
      { after: L("falcon-reuse", /Tier 1 exhausted/), text: "Falcon applies the replacement a person approved.", tone: "good" },
      { after: reuseDone, text: `Report: ${reuseEv.status} — no new candidate search, no refusal, no pending proposal. 7 of 7 passed.`, tone: "good" },
    ],
  });

  // 12 ── evidence ready for review --------------------------------------------------
  const refusal = cap.negative.evidence.refusal;
  scenes.push({
    id: "evidence", title: "Evidence ready for review", subtitle: "What this run proved",
    from: reuseDone, to: reuseDone + 500, dur: 11, static: true,
    cards: [
      card("kv", "bodyLeft", reuseDone, { rect: rect(48, 150, 900, 560), size: 25, title: "This run", rows: [
        { k: "Baseline", v: `${ev.baseline.summary.passed} of ${ev.baseline.summary.total} passed, no recovery`, tone: "good" },
        { k: "After the refactor", v: `${oldSel} not found`, tone: "bad", mono: true },
        { k: "Recovered to", v: newSel, mono: true, tone: "good" },
        { k: "Confidence / margin", v: `${pend.total.toFixed(3)} / ${margin.toFixed(3)}` },
        { k: "Journey", v: `${ev.recovery.summary.passed} of ${ev.recovery.summary.total} passed` },
        { k: "Healed (dashboard)", v: String(cap.markDetail("recovery:healed-counter")), tone: "good" },
        { k: "Approval", v: "clicked in the dashboard by a person" },
        { k: "Fresh process", v: `${reuseEv.status}, ${ev.reuse.summary.passed} of ${ev.reuse.summary.total} passed`, tone: "good" },
      ] }),
      card("kv", "bodyRight", reuseDone, { rect: rect(972, 150, 900, 560), size: 25, title: "Safety boundary", chip: "separate test", chipTone: "warn", rows: [
        { k: "Different change", v: "a hidden element shifted the page structure; the control had no stable hook" },
        { k: "Falcon's decision", v: `refused — ${refusal.reason}`, tone: "warn", mono: true },
        { k: "Proposal / click", v: "none created, none performed", tone: "good" },
        { k: "Meaning", v: "Falcon did not guess among look-alike controls" },
      ] }),
      card("kv", "body", reuseDone, { rect: rect(48, 730, 1824, 194), size: 21, headSize: 18, title: "How this video was made", rows: [
        { k: "Recording", v: `one real run: AI-agency at ${sha} (patched copy) and Falcon from this repository` },
        { k: "Authored", v: "the seven journey steps and the one-line test-hook rename; Falcon captured the selector" },
        { k: "Panels", v: "captured output and recordings of the real processes, in order; waits shortened or slowed as labelled" },
      ] }),
    ],
    captions: [{ after: reuseDone, text: "Falcon recovered a renamed automation hook because the control kept strong identity evidence — and a person approved it." }],
  });

  return scenes;
}

module.exports = { masterScenes };
