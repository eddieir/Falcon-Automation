const Logger = require("../../utils/Logger");

class PageAI {
    constructor(page) {
        this.page = page;
    }

    async analyze() {
        Logger.info("🔍 AI is analyzing the webpage to detect interactions...");

        const elements = await this.page.evaluate(() => {
            return [...document.querySelectorAll("input, button, a, select, textarea, div[role='button'], form")]
                .filter(el => el.offsetParent !== null) // Only visible elements
                .map(el => ({
                    tag: el.tagName.toLowerCase(),
                    type: el.getAttribute("type") || "",
                    name: el.getAttribute("name") || "",
                    text: el.innerText.trim(),
                    selector: el.tagName.toLowerCase() + (el.name ? `[name='${el.name}']` : ""),
                    role: el.getAttribute("role") || "",
                    isFormElement: ["input", "textarea", "select"].includes(el.tagName.toLowerCase()),
                    isClickable: ["button", "a"].includes(el.tagName.toLowerCase()) || el.role === "button"
                }));
        });

        Logger.info(`✅ AI detected ${elements.length} interactive elements.`);

        return {
            inputs: elements.filter(el => el.isFormElement),
            buttons: elements.filter(el => el.isClickable),
            links: elements.filter(el => el.tag === "a"),
            selects: elements.filter(el => el.tag === "select"),
            allElements: elements
        };
    }

    generateActions(pageData) {
        Logger.info("🧠 AI is generating test scenarios based on detected elements...");

        const actions = [];

        // If a form is detected, assume login, search, or input submission
        if (pageData.inputs.length > 0) {
            for (const input of pageData.inputs) {
                actions.push({ action: "type", locator: input.selector, value: "test_value", description: `Type in ${input.name || "input field"}` });
            }
        }

        // Click buttons if found
        for (const button of pageData.buttons) {
            actions.push({ action: "click", locator: button.selector, description: `Click ${button.text || "button"}` });
        }

        // Click links to navigate if found
        for (const link of pageData.links.slice(0, 3)) { // Limit to avoid infinite loops
            actions.push({ action: "click", locator: link.selector, description: `Click link: ${link.text}` });
        }

        return actions;
    }
}

module.exports = PageAI;
