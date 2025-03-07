const { chromium } = require("playwright");

class BrowserManager {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    async launch() {
        const isCI = process.env.CI === "true"; // Detect CI environment
        console.log(`🚀 Launching browser... (Headless: ${isCI})`);
        this.browser = await chromium.launch({ headless: isCI });
        this.page = await this.browser.newPage();
    }

    async close() {
        console.log("🔹 Closing browser...");
        await this.page.close();
        await this.browser.close();
    }
}

module.exports = BrowserManager;
