/**
 * capture-dashboard.js — screenshots the live dashboard at a fixed interval
 * while a `node falcon.js` run streams events to it, so the README demo GIF
 * is built from real frames instead of a mockup.
 *
 * Usage (run from the project root, after `node falcon.js` has started and
 * the dashboard is reachable):
 *
 *   node docs/demo/capture-dashboard.js [frameCount] [intervalMs]
 *
 * Frames are written to docs/demo/frames/frame-NNN.png. See the "Demo" →
 * "Regenerating this demo" section in README.md for the full sequence.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
    const total = Number(process.argv[2] || 30);
    const intervalMs = Number(process.argv[3] || 150);
    const outDir = path.join(__dirname, "frames");
    fs.mkdirSync(outDir, { recursive: true });

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 750 } });
    await page.goto(process.env.DASHBOARD_URL || "http://localhost:3000", { waitUntil: "load" });

    for (let i = 0; i < total; i++) {
        await page.screenshot({ path: path.join(outDir, `frame-${String(i).padStart(3, "0")}.png`) });
        await page.waitForTimeout(intervalMs);
    }

    await browser.close();
})();
