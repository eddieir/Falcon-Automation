// Hermetic Playwright project used only by tests/regression/allure-results.check.cjs.
// Results and artifacts go to temp directories passed through the environment, so
// nothing is written under the repository. FALCON_ALLURE_REPORTER_OFF=1 drops the
// Allure reporter to prove the check notices when it is missing.
const path = require("node:path");
const { defineConfig } = require("@playwright/test");

const resultsDir = process.env.FALCON_ALLURE_RESULTS_DIR;
const outputDir = process.env.FALCON_ALLURE_OUTPUT_DIR;
if (!resultsDir || !outputDir) {
  throw new Error("FALCON_ALLURE_RESULTS_DIR and FALCON_ALLURE_OUTPUT_DIR are required");
}

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "**/*.fixture.js",
  outputDir,
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: { headless: true, screenshot: "only-on-failure" },
  reporter:
    process.env.FALCON_ALLURE_REPORTER_OFF === "1"
      ? [["list"]]
      : [["list"], ["allure-playwright", { resultsDir: path.resolve(resultsDir) }]],
});
