const fs = require("fs");
const path = require("path");

class HealingReport {
    constructor() {
        this.filePath = path.join(__dirname, "..", "..", "reports", "healing_logs.json");
        this.logs = [];
    }

    logHealing(testName, originalSelector, healedSelector) {
        const entry = {
            testName,
            originalSelector,
            healedSelector,
            timestamp: new Date().toISOString(),
        };

        this.logs.push(entry);
        fs.writeFileSync(this.filePath, JSON.stringify(this.logs, null, 2));
    }
}

module.exports = new HealingReport();
