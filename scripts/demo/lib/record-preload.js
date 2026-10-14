"use strict";
/**
 * Demo-only preload (`node --require`): when FALCON_DEMO_VIDEO_DIR is set, every
 * browser context the Falcon process opens records a video of its page, and a
 * sidecar file notes when each page (and therefore each video) started.
 *
 * It changes nothing Falcon does: no input is injected and nothing is added to
 * the page. It only lets the demo show what Falcon's own browser did.
 */
const fs = require("node:fs");
const path = require("node:path");

const dir = process.env.FALCON_DEMO_VIDEO_DIR;
if (dir) {
  const { chromium } = require("playwright");
  const SIZE = { width: 1280, height: 720 };
  const pages = [];
  fs.mkdirSync(dir, { recursive: true });

  // Videos are written in page-creation order; pair them with the start times
  // when the process exits (synchronously, so a following process.exit is safe).
  process.on("exit", () => {
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".webm"))
        .map((f) => ({ f, born: fs.statSync(path.join(dir, f)).birthtimeMs }))
        .sort((a, b) => a.born - b.born);
      const paired = pages.map((p, i) => ({ startedAt: p.startedAt, file: files[i] ? files[i].f : null }));
      fs.writeFileSync(path.join(dir, "pages.json"), JSON.stringify(paired, null, 2));
    } catch { /* the recording is optional */ }
  });

  // An optional pause after each browser action so a viewer can follow the
  // journey. It slows Falcon down; it does not change what Falcon does.
  const slowMo = Number(process.env.FALCON_DEMO_SLOWMO_MS) || 0;
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (options = {}, ...rest) => {
    const browser = await launch(slowMo ? { ...options, slowMo } : options, ...rest);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (options = {}) => {
      const context = await newContext({ ...options, viewport: SIZE, recordVideo: { dir, size: SIZE } });
      context.on("page", () => pages.push({ startedAt: Date.now() }));
      return context;
    };
    return browser;
  };
}
