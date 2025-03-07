const { chromium, firefox, webkit } = require("playwright");
const ConfigManager = require("../core/ConfigManager");
const Logger = require("../../utils/Logger");

class BrowserManager {
    constructor() {
        this.browser = null;
        this.page = null;
        this.browserType = ConfigManager.get("browser") || "chromium";
    }

    async launch() {
        Logger.info(`🚀 Launching ${this.browserType} browser...`);
        this.browser = await { chromium, firefox, webkit }[this.browserType].launch({ headless: false });
        this.page = await this.browser.newPage();
    }

    async close() {
        Logger.info("🔴 Closing browser...");
        await this.page.close();
        await this.browser.close();
    }
}

module.exports = BrowserManager;
