const { chromium } = require("playwright");
const TestGenerator = require("./src/core/TestGenerator");
const TestRunner = require("./src/core/TestRunner");
const Logger = require("./utils/Logger");

(async () => {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error("❌ Usage: node falcon.js --url=https://example.com");
        process.exit(1);
    }

    let url = args.find(arg => arg.startsWith("--url=")).split("=")[1];

    if (!url.startsWith("http")) {
        url = `https://${url}`;
    }

    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    Logger.info(`🌍 Navigating to ${url}...`);

    try {
        await page.goto(url, { waitUntil: "load" });
        Logger.info(`✅ Loaded website: ${url}`);

        const testGen = new TestGenerator(page);
        const testPlan = await testGen.generateTestScenarios();

        Logger.info(`📝 Generated Test Plan:\n${JSON.stringify(testPlan, null, 2)}`);

        const runner = new TestRunner(page, testPlan, 3); // Run with 3 concurrent tests
        await runner.executeTest();
    } catch (error) {
        console.error(`❌ Failed to load ${url}: ${error.message}`);
    } finally {
        await browser.close();
    }
})();
