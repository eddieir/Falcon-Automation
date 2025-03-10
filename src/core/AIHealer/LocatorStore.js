const fs = require("fs");
const path = require("path");

class LocatorStore {
    constructor() {
        this.filePath = path.join(__dirname, "..", "..", "reports", "locator_store.json");
        this.locators = this.loadLocators();
    }

    loadLocators() {
        if (!fs.existsSync(this.filePath)) return {};
        return JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
    }

    saveLocator(selector) {
        if (!this.locators[selector]) {
            this.locators[selector] = { lastUsed: new Date().toISOString() };
            fs.writeFileSync(this.filePath, JSON.stringify(this.locators, null, 2));
        }
    }

    getPreviousLocators() {
        return Object.keys(this.locators);
    }
}

module.exports = new LocatorStore();
