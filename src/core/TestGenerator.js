const Logger = require("../../utils/Logger");

class TestGenerator {
    constructor(page) {
        this.page = page;
    }

    async scanPage() {
        Logger.info("🔍 Scanning website for visible elements...");

        const elements = await this.page.evaluate(() => {
            return [...document.querySelectorAll("input, button, a, select, textarea, div[role='button']")]
                .filter(el => el.offsetParent !== null) // Only visible elements
                .map(el => ({
                    tag: el.tagName.toLowerCase(),
                    type: el.getAttribute("type") || "",
                    name: el.getAttribute("name") || "",
                    text: el.innerText.trim(),
                    selector: el.tagName.toLowerCase() + (el.name ? `[name='${el.name}']` : ""),
                    role: el.getAttribute("role") || "",
                }));
        });

        Logger.info(`✅ Found ${elements.length} visible interactive elements.`);
        return elements;
    }

    async generateTestScenarios() {
        const elements = await this.scanPage();

        const scenarios = [];
        for (const el of elements) {
            if (el.tag === "button" || el.tag === "a" || el.role === "button") {
                scenarios.push({ action: "click", locator: el.selector, description: el.text || "Unnamed Button" });
            } else if (el.tag === "input" || el.tag === "textarea") {
                scenarios.push({ action: "type", locator: el.selector, value: "test_value", description: el.name || "Unnamed Input" });
            } else if (el.tag === "select") {
                scenarios.push({ action: "select", locator: el.selector, value: "option_1", description: "Dropdown Selection" });
            }
        }

        return {
            url: await this.page.url(),
            test_scenarios: scenarios
        };
    }
}

module.exports = TestGenerator;
