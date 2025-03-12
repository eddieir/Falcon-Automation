const Logger = require('../../utils/Logger');  // Corrected the typo

class ExploratoryAI {
    constructor(page) {
        this.page = page;
    }

    async detectUIIssues() {
        Logger.info("🔍 AI is scanning the webpage for potential UI issues...");

        const issues = await this.page.evaluate(() => {
            const problems = [];

            // Detect elements that should be visible but are not interactable
            document.querySelectorAll("button, a, input, select, textarea").forEach(el => {
                const computedStyle = window.getComputedStyle(el);
                if (computedStyle.display === "none" || computedStyle.visibility === "hidden") {
                    problems.push({ type: "hidden_element", element: el.outerHTML });
                }
            });

            // Detect broken links (missing `href` attribute)
            document.querySelectorAll("a").forEach(el => {
                if (!el.getAttribute("href")) {
                    problems.push({ type: "broken_link", element: el.outerHTML });
                }
            });

            // Detect empty buttons or elements without labels
            document.querySelectorAll("button, a").forEach(el => {
                if (!el.innerText.trim()) {
                    problems.push({ type: "empty_button", element: el.outerHTML });
                }
            });

            return problems;
        });

        Logger.info(`🧐 AI detected ${issues.length} potential UI issues.`);
        return issues || []; 
    }
}

module.exports = ExploratoryAI;
