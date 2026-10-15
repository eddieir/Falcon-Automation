"use strict";
/** Small builders shared by the scene lists. */

function lib(cap, fmt) {
  /** Real time of a line one process printed (throws if it never did). */
  const L = (label, re, afterMs = 0) => cap.logAt(label, re, afterMs);

  /** A real window shown at `speed` times real time. */
  const win = (from, to, speed) => ({ from, to, dur: Number(((to - from) / 1000 / speed).toFixed(2)) });

  /** The recorded panes of one Falcon run: its browser and the two dashboard views. */
  const videos = (run, labels) => {
    const short = run.replace(/^falcon-/, "");
    const out = [];
    if (labels.app) out.push({ source: `app:${run}`, slot: "app", label: labels.app });
    if (labels.summary) out.push({ source: `dash:dash-${short}-summary`, slot: "dashSummary", label: labels.summary });
    if (labels.locator) out.push({ source: `dash:dash-${short}-locator`, slot: "dashLocator", label: labels.locator, crop: fmt.crop.dashLocator });
    return out;
  };

  /** A stage card that appears once the real event at `after` has happened. */
  const card = (kind, slot, after, data) => ({ kind, slot, after, ...data });

  const bottomTerm = (spec) => ({ slot: "terminal", title: "Recorded command output", ...spec });

  const STEPS = [
    ["Select the Agents category", /Passed: Select the Agents/, "click"],
    ["Search news for the Lighthouse briefing", /Passed: Search news/, "type"],
    ["The matching article is listed", /Assertion passed: The matching article is listed/, "check"],
    ["Open the briefing", /Passed: Open the briefing/, "click"],
    ["The briefing heading is shown", /Assertion passed: The briefing heading/, "check"],
    ["The original-source link points to the publisher", /Assertion passed: The original-source link points/, "check"],
    ["The original-source link opens safely", /Assertion passed: The original-source link opens/, "check"],
  ];

  /**
   * The seven journey steps of one Falcon run as a checklist whose rows turn
   * green when the run's own log reports them. With `hookMissing`, the first
   * step shows the original hook being looked for, then not found, then
   * the recovered click.
   */
  const journeySteps = (run, { hookMissing = false, recoveredNote = "recovered hook" } = {}) => STEPS.map(([text, re, kind], i) => {
    const passAt = L(run, re);
    if (i === 0 && hookMissing) {
      return { text, timeline: [
        { at: L(run, /Tier 1: Trying Select the Agents/), state: "pending", detail: "looking for the original hook" },
        { at: L(run, /Tier 1 exhausted/), state: "fail", detail: "original hook not found" },
        { at: passAt, state: "pass", detail: recoveredNote },
      ] };
    }
    return { text, timeline: [{ at: passAt, state: "pass", detail: kind }] };
  });

  return { L, win, videos, card, bottomTerm, journeySteps };
}

module.exports = { lib };
