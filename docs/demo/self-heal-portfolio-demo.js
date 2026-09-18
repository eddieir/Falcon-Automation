/**
 * self-heal-portfolio-demo.js — demonstrates AIHealer's three-tier healing
 * chain against a real, external, previously-untested site
 * (https://peymaniravani.netlify.app), the way it would play out when a
 * front-end refactor renames a button's selector out from under a test.
 *
 * Run from the project root: node docs/demo/self-heal-portfolio-demo.js
 */
const { chromium } = require("playwright");
const path = require("path");
const AIHealer = require(path.join("..", "..", "src/core/AIHealer/AIHealer"));
const LocatorStore = require(path.join("..", "..", "src/core/AIHealer/LocatorStore"));

const TARGET_URL = "https://peymaniravani.netlify.app";
// A selector that has never existed on this site — simulates a stale test
// written against an old build after a front-end refactor renamed the id.
const BROKEN_SELECTOR = "#copy-email-btn-legacy";
// The real, current selector for the same logical element (the "Copy My
// Email" button), taught to LocatorStore up front exactly the way a
// previous successful Tier 3 healing run would have persisted it.
const REAL_SELECTOR = "button:has-text('Copy My Email')";

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: "load" });

    console.log(`\n=== Scenario: a selector broke, but a prior healing run already taught LocatorStore the fix (Tier 2) ===\n`);
    LocatorStore.addLocator(BROKEN_SELECTOR, REAL_SELECTOR);

    const healer = new AIHealer(page);
    await healer.healAndClick(BROKEN_SELECTOR, "Copy My Email");
    console.log(`\n✅ Healed and clicked "${BROKEN_SELECTOR}" via the real selector, with zero code changes to any test.\n`);

    await browser.close();
})();
