/**
 * capture-dashboard.js — screenshots the live dashboard at a fixed interval
 * while a `node falcon.js` run streams events to it, so the README demo GIF
 * is built from real frames instead of a mockup.
 *
 * Usage (run from the project root, started at the same time as `node
 * falcon.js` — not after it. Waiting for the dashboard to answer before
 * launching this lets a short run finish first, and the empty and explore
 * states are then never captured; this script does its own waiting instead):
 *
 *   node docs/demo/capture-dashboard.js [frameCount] [intervalMs] [outDirName]
 *
 * Frames are written to docs/demo/<outDirName>/frame-NNN.png ("frames" by
 * default). See the "Demo" → "Regenerating this demo" section in README.md
 * for the full sequence.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DASHBOARD_WAIT_MS = 30000;

(async () => {
    const total = Number(process.argv[2] || 30);
    const intervalMs = Number(process.argv[3] || 150);
    const outDir = path.join(__dirname, process.argv[4] || "frames");
    fs.mkdirSync(outDir, { recursive: true });

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 750 } });

    // The dashboard may not be listening yet — this is started alongside
    // falcon.js on purpose, so the first frames catch the empty state.
    const url = process.env.DASHBOARD_URL || "http://localhost:3000";
    const deadline = Date.now() + DASHBOARD_WAIT_MS;
    for (;;) {
        try {
            await page.goto(url, { waitUntil: "load" });
            break;
        } catch (error) {
            if (Date.now() > deadline) throw error;
            await page.waitForTimeout(100);
        }
    }

    for (let i = 0; i < total; i++) {
        await page.screenshot({ path: path.join(outDir, `frame-${String(i).padStart(3, "0")}.png`) });
        await page.waitForTimeout(intervalMs);
    }

    await browser.close();
})();
