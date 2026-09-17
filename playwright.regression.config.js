const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./tests/regression",
  testMatch: "**/*.spec.js",
  workers: 1,
  retries: 0,
  timeout: 15000,
  use: { headless: true, actionTimeout: 1500 },
  reporter: [
    ["list"],
    ["json", { outputFile: "reports/regression-browser.json" }],
  ],
  outputDir: "reports/regression-artifacts",
});
