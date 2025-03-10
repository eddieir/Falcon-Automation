const fs = require("fs");
const path = require("path");

class LocatorStore {
    constructor() {
        this.storePath = path.join(__dirname, "..", "..", "data", "locator_store.json");
        this.data = this.loadData();
    }

    loadData() {
        if (fs.existsSync(this.storePath)) {
            return JSON.parse(fs.readFileSync(this.storePath, "utf8"));
        }
        return {};
    }

    saveData() {
        fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2));
    }

    addLocator(original, alternative) {
        if (!this.data[original]) {
            this.data[original] = [];
        }
        if (!this.data[original].includes(alternative)) {
            this.data[original].push(alternative);
            this.saveData();
        }
    }

    getAlternatives(original) {
        return this.data[original] || [];
    }
}

module.exports = new LocatorStore();
