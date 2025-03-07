const { chromium, firefox, webkit } = require("playwright");

class BrowserManager {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    async launch(browserType = "chromium") {
        console.log(`🚀 Launching ${browserType} browser...`);
        this.browser = await { chromium, firefox, webkit }[browserType].launch({ headless: true });
        this.page = await this.browser.newPage();
    }

    async close() {
        console.log("🔹 Closing browser...");
        await this.page.close();
        await this.browser.close();
    }
}

module.exports = BrowserManager;
