// @ts-check
const { defineConfig, devices } = require("@playwright/test");

/**
 * Playwright configuration for Falcon's native test suite.
 *
 * Phase 3 addition:
 *   - Adds allure-playwright reporter so full_automation.test.js and any
 *     future spec files generate a rich Allure HTML report alongside the
 *     built-in JSON reporter.
 *   - Configures screenshot capture on failure and a test retry on CI so
 *     flaky tests get one extra attempt before being counted as failures.
 *
 * Run native tests:  npx playwright test
 * Generate report:   npx allure generate allure-results --clean -o allure-report
 * Open report:       npx allure open allure-report
 */
module.exports = defineConfig({
    // Resolve specs from the project root
    testDir: "./tests",
    testMatch: ["**/*.test.js", "**/*.spec.js"],

    // Maximum time one test can run (ms)
    timeout: 60_000,

    // Retry once on CI, no retries locally
    retries: process.env.CI ? 1 : 0,

    // Parallel workers — all CPUs on CI, 1 locally to keep output readable
    workers: process.env.CI ? undefined : 1,

    // Reporters
    reporter: [
        // Standard terminal output
        ["list"],
        // Machine-readable JSON (already used by test:e2e script)
        ["json", { outputFile: "reports/playwright-results.json" }],
        // Allure — generates files into allure-results/ for post-processing
        ["allure-playwright"],
    ],

    use: {
        // Base URL — overridable via environment variable
        baseURL: process.env.BASE_URL || "https://www.saucedemo.com",

        // Capture screenshots on every failure
        screenshot: "only-on-failure",

        // Capture a video clip of failing tests
        video: "retain-on-failure",

        // Respect the HEADLESS env var
        headless: process.env.HEADLESS !== "false",

        // Allure metadata
        actionTimeout: 10_000,
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],

    // Output folder for test artefacts (screenshots, videos)
    outputDir: "reports/test-artifacts/",
});
