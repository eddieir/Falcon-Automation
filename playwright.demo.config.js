/**
 * playwright.demo.config.js — config for the recorded UI test suite
 * (tests/demo/axonradar.ui.spec.js).
 *
 * Separate from playwright.config.js for two reasons:
 *
 *  1. `video: "on"`. The main config records only on failure, which is the
 *     right default for a suite whose artefacts nobody watches when it's
 *     green. This suite exists to be watched, so every test is recorded
 *     whether it passes or not — the published recording is of a passing run.
 *
 *  2. It targets a live third-party site. The main config's testIgnore keeps
 *     tests/demo/ out of `npx playwright test` precisely so that neither CI
 *     nor a routine local run is gated on somebody else's deploy. Running
 *     this is a deliberate act.
 *
 * Run: npm run test:demo    (HEADLESS=false to watch it live)
 */
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
    testDir: "./tests/demo",
    testMatch: "**/*.spec.js",

    // A real network and a real CDN, plus Tier 1 spending its full retry
    // budget against a selector that cannot resolve, in tests that then
    // walk every route on the site.
    timeout: 180_000,

    // One at a time: the recording should read as a single session, and
    // parallel workers against a third-party site is just rude.
    workers: 1,
    retries: 0,

    reporter: [
        ["list"],
        ["json", { outputFile: "reports/ui-demo-results.json" }],
    ],

    use: {
        // Spread first so the explicit settings below win, not the device preset.
        ...devices["Desktop Chrome"],

        // Recorded on every test, not just failures — that's the point here.
        video: { mode: "on", size: { width: 1280, height: 720 } },
        screenshot: "on",
        trace: "retain-on-failure",
        viewport: { width: 1280, height: 720 },
        headless: process.env.HEADLESS !== "false",
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
    },

    projects: [{ name: "chromium" }],

    outputDir: "reports/ui-demo-artifacts/",
});
