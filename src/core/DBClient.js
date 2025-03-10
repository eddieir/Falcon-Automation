const { Pool } = require("pg");
require("dotenv").config();
const Logger = require("../../utils/Logger");
const fs = require("fs");

class DBClient {
    constructor() {
        if (!process.env.DB_HOST || !process.env.DB_USER) {
            throw new Error("❌ Database credentials are missing! Check your .env file.");
        }
        this.pool = new Pool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME,
            ssl: {
                rejectUnauthorized: false,
                ca: fs.readFileSync(process.env.SSL_CA_FILE).toString(),
                key: fs.readFileSync(process.env.SSL_KEY_FILE).toString(),
                cert: fs.readFileSync(process.env.SSL_CERT_FILE).toString(),
            },
            statement_timeout: 5000, // 5 seconds timeout for queries
            ssl: { rejectUnauthorized: false },
            application_name: "Falcon-Automation",
        });
    }

    async query(sql, params = []) {
        try {
            Logger.info(`🔹 Running DB Query: ${sql}`);
            const client = await this.pool.connect();
            const res = await client.query(sql, params);
            client.release();
            return res.rows;
        } catch (error) {
            Logger.error(`❌ Database Query Failed: ${error.message}`);
            throw error;
        }
    }
}

module.exports = DBClient;