const fs   = require("fs");
const path = require("path");
require("dotenv").config();

/**
 * ConfigManager — JSON + env configuration singleton.
 *
 * The config file lives at `src/config/testConfig.json`. `__dirname` here is
 * `src/core/`, so it's one level up, not two.
 *
 * A missing config file logs a warning and falls back to an empty object
 * rather than throwing, so tests that rely solely on env vars (e.g. in CI)
 * do not crash on startup.
 */
class ConfigManager {
    constructor() {
        // __dirname = src/core  →  ../config = src/config
        this.configPath = path.join(__dirname, "..", "config", "testConfig.json");
        this.config     = this._load();
    }

    _load() {
        if (!fs.existsSync(this.configPath)) {
            console.warn(
                `⚠️  [ConfigManager] Config file not found at ${this.configPath}. ` +
                "Falling back to environment variables only."
            );
            return {};
        }

        const raw = fs.readFileSync(this.configPath, "utf-8").trim();
        if (!raw) {
            console.warn(`⚠️  [ConfigManager] Config file is empty: ${this.configPath}`);
            return {};
        }

        try {
            return JSON.parse(raw);
        } catch (error) {
            throw new Error(`❌ [ConfigManager] Invalid JSON in config file: ${error.message}`);
        }
    }

    /** Look up a key: config file → env var → null. */
    get(key) {
        return this.config[key] ?? process.env[key] ?? null;
    }
}

module.exports = new ConfigManager();
