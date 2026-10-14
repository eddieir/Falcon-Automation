#!/usr/bin/env node
"use strict";
/**
 * Records one complete, real run of the News journey for the customer demo:
 *
 *   AGENCY_SOURCE=<clone|url> node scripts/demo/record-run.js <workDir>
 *
 * - the positive scenario (hook-rename) with capture: videos of Falcon's browser
 *   and of the real dashboard, stills of the control, a timeline, and every
 *   line the real processes printed;
 * - the negative scenario (structural) as evidence for the safety card;
 * - one read-only screenshot of the public AxonRadar home page (reference only;
 *   Falcon is never pointed at it).
 *
 * Output (in <workDir>/capture): run.json, negative.json, public-axonradar.png and the media.
 * Exit 0 only if both scenarios produced their expected outcome.
 */

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const E = require("./lib/env");
const gate = require("./lib/gate");
const { installCleanup, parseArgs } = require("./gate-run");

const PUBLIC_URL = "https://axonradar.netlify.app/";

async function publicScreenshot(file) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(PUBLIC_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(1500);
    const title = await page.title();
    await page.screenshot({ path: file });
    return { url: PUBLIC_URL, title };
  } finally {
    await browser.close();
  }
}

async function main() {
  const parsed = parseArgs(["hook-rename", process.argv[2]]);
  if (!parsed || parsed.error) {
    process.stderr.write("usage: AGENCY_SOURCE=<clone|url> node scripts/demo/record-run.js <workDir>\n");
    return 2;
  }
  const agencySource = process.env.AGENCY_SOURCE || E.AGENCY_REPO;
  const workDir = parsed.workDir;
  const captureDir = path.join(workDir, "capture");

  const positive = await gate.runScenario({ mode: "hook-rename", workDir, agencySource, capture: { dir: captureDir } });
  fs.writeFileSync(path.join(captureDir, "run.json"), JSON.stringify(positive, null, 2));
  process.stdout.write(`hook-rename: ${positive.ok ? "all steps passed" : "NOT passed"}\n`);

  const negativeDir = `${workDir}-negative`;
  const negative = await gate.runScenario({ mode: "structural", workDir: negativeDir, agencySource });
  fs.writeFileSync(path.join(captureDir, "negative.json"), JSON.stringify(negative, null, 2));
  process.stdout.write(`structural: ${negative.ok ? "refused as expected" : "NOT as expected"}\n`);

  const reference = await publicScreenshot(path.join(captureDir, "public-axonradar.png"));
  fs.writeFileSync(path.join(captureDir, "public.json"), JSON.stringify(reference, null, 2));
  process.stdout.write(`public reference captured (${reference.title})\n`);
  return positive.ok && negative.ok ? 0 : 1;
}

if (require.main === module) {
  installCleanup();
  main().then((code) => E.stopAll().then(() => process.exit(code)), (e) => {
    process.stderr.write(`record-run failed: ${e.message}\n`);
    E.stopAll().then(() => process.exit(1));
  });
}
