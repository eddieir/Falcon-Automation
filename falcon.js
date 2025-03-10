const { chromium } = require("playwright");
const PageAI = require("./src/core/PageAI");
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

        const pageAI = new PageAI(page);
        const pageData = await pageAI.analyze();
        const actions = pageAI.generateActions(pageData);

        Logger.info(`📝 AI-Generated Test Plan:\n${JSON.stringify(actions, null, 2)}`);

        const runner = new TestRunner(page, actions);
        await runner.executeTest();
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
    } finally {
        await browser.close();
    }
})();
