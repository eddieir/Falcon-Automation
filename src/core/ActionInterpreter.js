const Logger = require("../../utils/Logger");

class ActionInterpreter {
    constructor(pageAnalysis) {
        this.pageAnalysis = pageAnalysis;
    }

    generateActions(userInstruction) {
        Logger.info(`🧠 Processing user instruction: "${userInstruction}"`);

        const actions = [];

        if (userInstruction.toLowerCase().includes("login")) {
            const usernameInput = this.pageAnalysis.inputs.find(el => el.name.toLowerCase().includes("user"));
            const passwordInput = this.pageAnalysis.inputs.find(el => el.name.toLowerCase().includes("pass"));
            const loginButton = this.pageAnalysis.buttons.find(el => el.text.toLowerCase().includes("log in"));

            if (usernameInput && passwordInput && loginButton) {
                actions.push({ action: "type", locator: usernameInput.selector, value: "testuser", description: "Enter Username" });
                actions.push({ action: "type", locator: passwordInput.selector, value: "testpass", description: "Enter Password" });
                actions.push({ action: "click", locator: loginButton.selector, description: "Click Login" });
            }
        }

        if (userInstruction.toLowerCase().includes("search for")) {
            const searchInput = this.pageAnalysis.inputs.find(el => el.name.toLowerCase().includes("search") || el.selector.includes("q"));
            const searchButton = this.pageAnalysis.buttons.find(el => el.text.toLowerCase().includes("search"));

            if (searchInput) {
                const searchTerm = userInstruction.match(/search for '(.*?)'/)?.[1] || "default search";
                actions.push({ action: "type", locator: searchInput.selector, value: searchTerm, description: "Type Search Query" });
                if (searchButton) {
                    actions.push({ action: "click", locator: searchButton.selector, description: "Click Search Button" });
                }
            }
        }

        return actions;
    }
}

module.exports = ActionInterpreter;
