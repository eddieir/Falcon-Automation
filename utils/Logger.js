const fs = require("fs");
const path = require("path");

class Logger {
    static logFilePath = path.join(__dirname, "..", "reports", "execution.log");

    static info(message) {
        console.log(`🟢 INFO: ${message}`);
        fs.appendFileSync(this.logFilePath, `[INFO] ${new Date().toISOString()} - ${message}\n`);
    }

    static error(message) {
        console.error(`🔴 ERROR: ${message}`);
        fs.appendFileSync(this.logFilePath, `[ERROR] ${new Date().toISOString()} - ${message}\n`);
    }

    static warning(message) {
        console.warn(`🟡 WARNING: ${message}`);
        fs.appendFileSync(this.logFilePath, `[WARNING] ${new Date().toISOString()} - ${message}\n`);
    }
}

module.exports = Logger;
