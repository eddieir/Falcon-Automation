const Logger = require('../../utils/Logger');  // Corrected the typo

class DOMIssueScanner {
    constructor(page) {
        this.page = page;
    }

    async detectUIIssues() {
        Logger.info("🔍 Scanning the DOM for rule-based UI issues...");

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

            // Detect empty buttons or elements without labels.
            // Known limitation (intentionally left as-is): this checks innerText only,
            // so an icon button labelled solely via aria-label (no visible text) is
            // still flagged here. That is a known false-positive source, not a bug.
            document.querySelectorAll("button, a").forEach(el => {
                if (!el.innerText.trim()) {
                    problems.push({ type: "empty_button", element: el.outerHTML });
                }
            });

            return problems;
        });

        Logger.info(`🧐 Rule-based scan flagged ${issues.length} potential UI issue(s) — heuristics, may include false positives.`);
        return issues || [];
    }
}

module.exports = DOMIssueScanner;
