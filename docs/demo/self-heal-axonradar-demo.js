/**
 * self-heal-axonradar-demo.js — demonstrates AIHealer's three-tier healing
 * chain against a real, external, previously-untested site
 * (https://axonradar.netlify.app), the way it would play out when a
 * front-end refactor renames a button's selector out from under a test.
 *
 * Run from the project root: node docs/demo/self-heal-axonradar-demo.js
 */
const { chromium } = require("playwright");
const path = require("path");
const AIHealer = require(path.join("..", "..", "src/core/AIHealer/AIHealer"));
const LocatorStore = require(path.join("..", "..", "src/core/AIHealer/LocatorStore"));

const TARGET_URL = "https://axonradar.netlify.app";
// A selector that has never existed on this site — simulates a stale test
// written against an old build after a front-end refactor renamed the id.
const BROKEN_SELECTOR = "#rescan-trigger-legacy";
// The real, current selector for the same logical element (the "RESCAN ↻"
// button), taught to LocatorStore up front exactly the way a previous
// successful Tier 3 healing run would have persisted it.
const REAL_SELECTOR = "button:has-text('RESCAN')";

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: "load" });

    console.log(`\n=== Scenario: a selector broke, but a prior healing run already taught LocatorStore the fix (Tier 2) ===\n`);
    LocatorStore.addLocator(BROKEN_SELECTOR, REAL_SELECTOR);

    const healer = new AIHealer(page);
    await healer.healAndClick(BROKEN_SELECTOR, "RESCAN");
    console.log(`\n✅ Healed and clicked "${BROKEN_SELECTOR}" via the real selector, with zero code changes to any test.\n`);

    await browser.close();
})();
