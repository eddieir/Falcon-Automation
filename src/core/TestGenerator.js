const Logger = require("../../utils/Logger");

class TestGenerator {
    constructor(page) {
        this.page = page;
    }

    async scanPage() {
        Logger.info("🔍 Scanning website for test elements...");

        const elements = await this.page.evaluate(() => {
            return [...document.querySelectorAll("input, button, a, form")].map(el => ({
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute("type") || "",
                name: el.getAttribute("name") || "",
                text: el.innerText.trim(),
                selector: el.tagName.toLowerCase() + (el.name ? `[name='${el.name}']` : "")
            }));
        });

        Logger.info(`✅ Found ${elements.length} interactive elements.`);
        return elements;
    }

    async generateTestScenarios() {
        const elements = await this.scanPage();

        const scenarios = [];
        for (const el of elements) {
            if (el.tag === "button" || el.tag === "a") {
                scenarios.push({ action: "click", locator: el.selector, description: el.text || "Unnamed Button" });
            } else if (el.tag === "input") {
                scenarios.push({ action: "type", locator: el.selector, value: "test_value", description: el.name || "Unnamed Input" });
            }
        }

        return {
            url: await this.page.url(),
            test_scenarios: scenarios
        };
    }
}

module.exports = TestGenerator;
