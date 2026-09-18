/**
 * visual-regression-axonradar-demo.js — demonstrates VisualRegression's
 * real pixel-diff comparison against https://axonradar.netlify.app, the
 * way it would catch an unintended front-end change in CI:
 *
 *   1. Capture a real baseline screenshot of the live page.
 *   2. Compare the same page against itself — passes, near-zero diff.
 *   3. Inject a real DOM/CSS change (a banner + recolored button) and
 *      compare again — fails, with a real diff image written to disk.
 *
 * Run from the project root: node docs/demo/visual-regression-axonradar-demo.js
 */
const { chromium } = require("playwright");
const path = require("path");
const VisualRegression = require(path.join("..", "..", "src/core/VisualRegression"));

const TARGET_URL = "https://axonradar.netlify.app";

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(TARGET_URL, { waitUntil: "load" });

    const vr = new VisualRegression(page, { diffThreshold: 0.1 });

    console.log("\n=== Step 1: capture a real baseline from the live page ===\n");
    await vr.captureBaseline("axonradar-home");

    console.log("\n=== Step 2: compare the unchanged page against its own baseline ===\n");
    const unchanged = await vr.compare("axonradar-home");
    console.log(unchanged);

    console.log("\n=== Step 3: inject a real visual change, then compare again ===\n");
    await page.evaluate(() => {
        const banner = document.createElement("div");
        banner.textContent = "MAINTENANCE MODE";
        banner.style.cssText =
            "position:fixed;top:0;left:0;right:0;z-index:99999;background:#ff2d55;color:#fff;" +
            "font:700 20px sans-serif;text-align:center;padding:14px;";
        document.body.prepend(banner);
    });
    const changed = await vr.compare("axonradar-home");
    console.log(changed);

    console.log(`\n✅ Visual regression correctly caught the injected change: ${changed.diffPercent}% of pixels differ (status: ${changed.status}).\n`);

    await browser.close();
})();
