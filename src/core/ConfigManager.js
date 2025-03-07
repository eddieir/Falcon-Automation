const fs = require("fs");
const path = require("path");
require("dotenv").config();

class ConfigManager {
    constructor() {
        this.configPath = path.join(__dirname, "..", "config", "testConfig.json");
        this.loadConfig();
    }

    loadConfig() {
        if (!fs.existsSync(this.configPath)) {
            throw new Error(`⚠️ Config file not found: ${this.configPath}`);
        }

        const configData = fs.readFileSync(this.configPath, "utf-8").trim();
        if (!configData) {
            throw new Error(`⚠️ Config file is empty: ${this.configPath}`);
        }

        try {
            this.config = JSON.parse(configData);
        } catch (error) {
            throw new Error(`❌ Invalid JSON format in config file: ${error.message}`);
        }
    }

    get(key) {
        return this.config[key] || process.env[key] || null;
    }
}

module.exports = new ConfigManager();
