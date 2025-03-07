const { chromium, firefox, webkit } = require("playwright");
const ConfigManager = require("../core/ConfigManager");
const Logger = require("../../utils/Logger");


class BrowserManager {
    constructor() {
        this.browserType = ConfigManager.get("browser") || "chromium";
        this.browser = null;
        this.page = null;
    }

    async launch() {
        Logger.info(`🚀 Launching ${this.browserType} browser...`);
        this.browser = await { chromium, firefox, webkit }[this.browserType].launch({
            headless: false,
        });

        this.page = await this.browser.newPage();
    }

    async close() {
        if (this.page) {
            Logger.info("🔴 Closing browser page...");
            await this.page.close();
        } else {
            Logger.warning("⚠️ No page to close!");
        }

        if (this.browser) {
            Logger.info("🔴 Closing browser instance...");
            await this.browser.close();
        } else {
            Logger.warning("⚠️ No browser to close!");
        }
    }

    async newContext() {
        if (!this.browser) {
            throw new Error("⚠️ Browser not initialized! Call launch() first.");
        }
        return await this.browser.newContext();
    }
}

module.exports = BrowserManager;

