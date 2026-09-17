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
        // Respect the HEADLESS env var (default: true for CI-safe runs).
        // Set HEADLESS=false in .env to watch the browser during local debugging.
        const headless = process.env.HEADLESS !== "false";
        Logger.info(`🚀 Launching ${this.browserType} browser (headless=${headless})...`);
        const engine = { chromium, firefox, webkit }[this.browserType];
        if (!engine) throw new Error(`Unsupported browser: ${this.browserType}`);
        if (this.browser) throw new Error("Browser already initialized; close it before launching again");
        this.browser = await engine.launch({ headless });
        try {
            this.page = await this.browser.newPage();
        } catch (error) {
            await this.close().catch(() => {});
            throw error;
        }
    }

    async close() {
        const page = this.page;
        const browser = this.browser;
        this.page = null;
        this.browser = null;
        try {
            if (page) await page.close();
        } finally {
            if (browser) await browser.close();
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

