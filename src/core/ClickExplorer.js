const Logger = require("../../utils/Logger");

class ClickExplorer {
    constructor(page) {
        this.page = page;
        this.visitedPages = new Set();
        this.maxDepth = 2;
    }

    async explore(depth = 0) {
        if (depth > this.maxDepth) {
            Logger.info("🛑 Reached max exploration depth, stopping navigation.");
            return;
        }

        const currentUrl = await this.page.url();
        if (this.visitedPages.has(currentUrl)) {
            Logger.info(`🔄 Skipping already visited page: ${currentUrl}`);
            return;
        }

        Logger.info(`🌍 Exploring page: ${currentUrl}`);
        this.visitedPages.add(currentUrl);

        const clickableElements = await this.page.evaluate(() => {
            return [...document.querySelectorAll("a, button")].map(el => ({
                selector: el.tagName.toLowerCase() + (el.innerText ? `[innerText="${el.innerText.trim()}"]` : ""),
                text: el.innerText.trim(),
                newTab: el.getAttribute("target") === "_blank"
            }));
        });

        for (const element of clickableElements.slice(0, 3)) {
            try {
                Logger.info(`🖱 Trying to click on: ${element.text}`);

                // Ensure element is interactable
                await this.page.waitForSelector(element.selector, { state: "visible", timeout: 5000 });

                let [newPage] = await Promise.all([
                    element.newTab ? this.page.context().waitForEvent("page") : null,
                    this.page.click(element.selector)
                ]);

                if (element.newTab && newPage) {
                    Logger.info("🔄 Detected new tab. Switching focus...");
                    this.page = newPage;
                    await this.page.waitForLoadState("domcontentloaded"); // Ensure page is loaded
                }

                await this.page.waitForTimeout(2000); // Allow page to fully load content
                await this.explore(depth + 1);
                await this.page.goBack();
            } catch (error) {
                Logger.warning(`⚠️ Failed to click: ${element.text} - ${error.message}`);
            }
        }
    }
}

module.exports = ClickExplorer;
