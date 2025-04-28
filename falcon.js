const { chromium } = require("playwright");
const ExploratoryAI = require("./src/core/ExploratoryAI");
const ClickExplorer = require("./src/core/ClickExplorer");
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
    const context = await browser.newContext();
    let page = await context.newPage();
    Logger.info(`🌍 Navigating to ${url}...`);

    try {
        await page.goto(url, { waitUntil: "load" });
        Logger.info(`✅ Loaded website: ${url}`);

        // Step 1: Detect UI Issues
        const exploratoryAI = new ExploratoryAI(page);
        const uiIssues = await exploratoryAI.detectUIIssues();
        if (!Array.isArray(uiIssues)) {
            uiIssues = [];  
        }

        // Step 2: Explore Click Paths
        const clickExplorer = new ClickExplorer(page);
        await clickExplorer.explore();
        let visitedPages = clickExplorer.visitedPages;
        if (!(visitedPages instanceof Set)) {
            visitedPages = new Set();  // ✅ Ensure it's always a Set
        }

        // Step 3: Run the TestRunner to Log Results
        const runner = new TestRunner(page, uiIssues, clickExplorer.visitedPages);
        await runner.executeExploratoryTest();
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
    } finally {
        await browser.close();
    }
})();