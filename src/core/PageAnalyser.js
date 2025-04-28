const Logger = require("../../utils/Logger");

class PageAnalyzer {
    constructor(page) {
        this.page = page;
    }

    async analyze() {
        Logger.info("🔍 AI is analyzing the webpage structure...");

        const elements = await this.page.evaluate(() => {
            return [...document.querySelectorAll("input, button, a, select, textarea, form")]
                .filter(el => el.offsetParent !== null) // Only visible elements
                .map(el => ({
                    tag: el.tagName.toLowerCase(),
                    type: el.getAttribute("type") || "",
                    name: el.getAttribute("name") || "",
                    text: el.innerText.trim(),
                    selector: el.tagName.toLowerCase() + (el.name ? `[name='${el.name}']` : ""),
                    role: el.getAttribute("role") || "",
                    isFormElement: ["input", "textarea", "select"].includes(el.tagName.toLowerCase()),
                }));
        });

        Logger.info(`✅ AI detected ${elements.length} interactive elements.`);

        return {
            inputs: elements.filter(el => el.isFormElement),
            buttons: elements.filter(el => el.tag === "button" || el.role === "button"),
            links: elements.filter(el => el.tag === "a"),
            selects: elements.filter(el => el.tag === "select"),
        };
    }
}

module.exports = PageAnalyzer;
