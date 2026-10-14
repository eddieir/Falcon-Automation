"use strict";
/**
 * The 4:5 LinkedIn cut of the same recorded run: a UI refactor breaks the saved
 * journey, Falcon refuses to guess without identity evidence, finds the same
 * control when it has it, a person approves, and a fresh process reuses it.
 */

const { DEFAULTS } = require("../../../src/core/locator/CandidateMatcher");
const { lib } = require("./helpers");

const rect = (x, y, w, h) => ({ x, y, w, h });
const BROWSER = "Application under test — Falcon's browser";
const COUNTERS = "Falcon dashboard — counters";
const LOCATOR = "Falcon dashboard — locator evidence";

function linkedinScenes(cap, fmt) {
  const h = lib(cap, fmt);
  const { L, win, videos, card } = h;
  const afterVideos = (from, ...sources) => Math.max(from, ...sources.map((v) => cap.video(v).startMs + 150));
  const ev = cap.evidence;
  const oldSel = ev.capturedAgentsLocator;
  const newSel = ev.resolvedLocator;
  const pend = ev.pendingProposal;
  const margin = pend.margin;
  const refusal = cap.negative.evidence.refusal;
  const negSummary = cap.negative.evidence.summary;
  const scenes = [];

  // 1 ── the refactor ------------------------------------------------------------
  const same = cap.mark("step:same-control-by-targeted-assertions");
  scenes.push({
    id: "refactor", title: "A UI refactor renamed a test hook", subtitle: "The saved test still looks for the old one",
    from: same, to: same + 500, dur: 6, static: true,
    cards: [
      card("code", "body", same, { rect: rect(40, 200, 1000, 520), size: 27, title: "The control, before and after", lines: [
        { text: `- ${ev.before.html}`, tone: "del" }, { text: `+ ${ev.after.html}`, tone: "add" },
        { text: "Same label, accessible name, position and behavior", tone: "hl" },
      ] }),
      card("statement", "body", same, { rect: rect(40, 750, 1000, 380), title: "The saved test", lines: [
        { text: "Looks for", size: 36 }, { text: oldSel, size: 34, tone: "bad" }, { text: "Nothing on the page has that name now.", size: 32 },
      ] }),
    ],
    captions: [{ after: same, text: "Only the hook's name changed. What a customer sees did not." }],
  });

  // 2 ── the saved test breaks ---------------------------------------------------
  const rLoaded = L("falcon-recovery", /Loaded:/);
  const fail1 = L("falcon-recovery", /Attempt 1 failed/);
  const exhausted = L("falcon-recovery", /Tier 1 exhausted/);
  const tried = L("falcon-recovery", /Tier 1: Trying Select the Agents/);
  scenes.push({
    id: "broke", title: "Same saved test, updated app", subtitle: "Falcon runs it unchanged",
    titles: [{ after: fail1, title: "The saved test breaks", subtitle: "The old hook is not on the page" }],
    ...win(afterVideos(rLoaded - 500, "app:falcon-recovery", "dash:dash-recovery-summary"), exhausted + 700, 1.7),
    videos: videos("falcon-recovery", { app: BROWSER, summary: COUNTERS }),
    cards: [
      card("statement", "bottomCard", tried, { until: exhausted, title: "Falcon's first try", lines: [{ text: "Looking for", size: 30 }, { text: oldSel, size: 30, tone: "bad" }] }),
      card("statement", "bottomCard", exhausted, { title: "Falcon's first try", lines: [{ text: "3 attempts · hook not found", size: 36, tone: "bad" }, { text: oldSel, size: 28 }] }),
    ],
    captions: [
      { after: fail1, text: "Falcon looks for the old hook and does not find it.", tone: "warn" },
      { after: exhausted, text: "All 3 attempts failed.", tone: "bad" },
    ],
  });

  // 3 ── no identity, no guess ---------------------------------------------------
  scenes.push({
    id: "refuse", title: "No identity evidence, no guess", subtitle: "A different change, tested separately",
    from: 0, to: 500, dur: 8, static: true,
    cards: [card("kv", "body", 0, { rect: rect(40, 200, 1000, 940), size: 34, title: "Hidden element shifts the page", chip: "separate test", chipTone: "warn", rows: [
      { k: "The control", v: "no stable hook (no id, no test id)" },
      { k: "Falcon's decision", v: `refused: ${refusal.reason}`, tone: "warn", mono: true },
      { k: "Click performed", v: "no", tone: "good" },
      { k: "Proposal created", v: "no", tone: "good" },
      { k: "Steps", v: `${negSummary.passed} passed · ${negSummary.unavailable} unavailable · ${negSummary.skipped} skipped` },
    ] })],
    captions: [{ after: 0, text: "No stable hook, no guess among look-alike controls.", tone: "warn" }],
  });

  // 4 ── found it, journey completes ----------------------------------------------
  const pv = cap.mark("recovery:pending-visible");
  const healed = cap.mark("recovery:healed-counter");
  const rDone = L("falcon-recovery", /Test Run Complete/);
  scenes.push({
    id: "found", title: "With identity, Falcon looks again", subtitle: "The control kept its id, type, name and position",
    titles: [
      { after: healed, title: "Falcon finds the same control", subtitle: `It proposes ${newSel}` },
      { after: rDone, title: "The customer journey completes", subtitle: "7 of 7 steps passed" },
    ],
    ...win(exhausted - 300, rDone + 1500, 0.7),
    videos: videos("falcon-recovery", { app: BROWSER, summary: COUNTERS }),
    cards: [card("bars", "bottomCard", pv, { title: "Identity evidence", size: 20, bars: [
      { label: "Confidence", value: `${pend.total.toFixed(3)} (needs ≥ ${DEFAULTS.MIN_CONFIDENCE})`, fraction: pend.total, mark: DEFAULTS.MIN_CONFIDENCE, tone: "good" },
      { label: "Runner-up", value: pend.runnerUp.total.toFixed(3), fraction: pend.runnerUp.total, tone: "bad" },
      { label: "Margin", value: `${margin.toFixed(3)} (needs ≥ ${DEFAULTS.WINNER_MARGIN})`, fraction: Math.min(1, margin), mark: DEFAULTS.WINNER_MARGIN, tone: "good" },
    ] })],
    captions: [
      { after: exhausted, text: "Falcon compares the page with what it remembered." },
      { after: healed, text: "Same control found through its identity. Pending review.", tone: "good" },
      { after: rDone, text: "7 of 7 steps passed. Healed: 1.", tone: "good" },
    ],
  });

  // 5 ── human approval -----------------------------------------------------------
  const click = cap.mark("approval:click");
  const confirmed = cap.mark("approval:confirmed");
  scenes.push({
    id: "approval", title: "A person decides", subtitle: "Falcon does not trust the repair on its own",
    ...win(rDone + 1500, confirmed + 2000, 1.3),
    videos: [
      { source: "dash:dash-recovery-locator", slot: "dashLocator", label: LOCATOR, crop: fmt.crop.dashLocator },
      { source: "dash:dash-recovery-summary", slot: "dashSummary", label: COUNTERS },
    ],
    cards: [
      card("statement", "bottomCard", pv, { rect: rect(40, 505, 1000, 205), until: confirmed, title: "Pending review", lines: [{ text: oldSel, size: 28, tone: "bad" }, { text: `→ ${newSel}`, size: 28, tone: "accent" }] }),
      card("statement", "bottomCard", confirmed, { rect: rect(40, 505, 1000, 205), title: "Approved for scoped reuse", chip: "by a person", chipTone: "good", lines: [{ text: newSel, size: 30, tone: "good" }, { text: "Trusted for this control and page only", size: 28 }] }),
      card("statement", "bottomCard", pv, { title: "Why a person?", lines: [{ text: "Falcon proposes. A person decides.", size: 34 }, { text: "Nothing is trusted until it is approved.", size: 30 }] }),
    ],
    captions: [
      { after: click, text: "The reviewer clicks Approve in the dashboard." },
      { after: confirmed, text: "Approved — saved by Falcon.", tone: "good" },
    ],
  });

  // 6 ── a fresh process reuses it -------------------------------------------------
  const reuseDone = L("falcon-reuse", /Test Run Complete/);
  const reusePassed = L("falcon-reuse", /Passed: Select the Agents/) + 800;
  const reuseEv = ev.reuse.events.find((e) => e.status === "approved_reuse");
  scenes.push({
    id: "reuse", title: "A fresh Falcon process starts", subtitle: "The same unchanged saved journey",
    titles: [{ after: reusePassed, title: "The approved repair is reused", subtitle: "No new search, no new proposal" }],
    ...win(afterVideos(cap.mark("falcon-reuse:start") - 300, "app:falcon-reuse", "dash:dash-reuse-summary"), reuseDone + 3600, 2.2),
    videos: videos("falcon-reuse", { app: BROWSER, summary: COUNTERS }),
    cards: [card("statement", "bottomCard", cap.mark("falcon-reuse:start"), { until: reuseDone, title: "Same saved journey", lines: [{ text: "Unchanged plan. New process.", size: 34 }, { text: "The old hook is still not on the page.", size: 30 }] }),
      card("kv", "bottomCard", reuseDone, { title: "Falcon's report", chip: "fresh process", chipTone: "good", size: 26, rows: [
      { k: "Status", v: reuseEv.status, mono: true, tone: "good" },
      { k: "Journey", v: `${ev.reuse.summary.passed} of ${ev.reuse.summary.total} passed`, tone: "good" },
    ] })],
    captions: [
      { after: cap.mark("falcon-reuse:start"), text: "The old hook is still gone." },
      { after: reuseDone, text: "approved_reuse: 7 of 7 steps passed.", tone: "good" },
    ],
  });

  // 7 ── close --------------------------------------------------------------------
  scenes.push({
    id: "close", title: "Evidence, not guesses", subtitle: "One recorded run on a local AI-agency app",
    from: reuseDone, to: reuseDone + 500, dur: 7, static: true,
    cards: [card("checks", "body", reuseDone, { rect: rect(40, 200, 1000, 600), size: 38, title: "What happened", items: [
      { text: "Saved test broke after a refactor", state: "pass", detail: "hook renamed" },
      { text: "Unsafe change: Falcon refused", state: "pass", detail: refusal.reason },
      { text: "Safe change: found by identity", state: "pass", detail: `${pend.total.toFixed(3)} / ${margin.toFixed(3)}` },
      { text: "A person approved it", state: "pass", detail: "dashboard" },
      { text: "A fresh process reused it", state: "pass", detail: "approved_reuse" },
      { text: "Recovery used local evidence only", state: "pass", detail: "no LLM" },
    ] })],
    captions: [{ after: reuseDone, text: "Falcon recovers what it can prove is the same control, and refuses what it cannot." }],
  });

  return scenes;
}

module.exports = { linkedinScenes };
