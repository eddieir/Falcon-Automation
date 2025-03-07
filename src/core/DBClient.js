const mysql = require("mysql2/promise");
require("dotenv").config();

class DBClient {
    constructor() {
        this.pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME,
        });
    }

    async query(sql, params = []) {
        console.log(`🔹 Running DB Query: ${sql}`);
        const connection = await this.pool.getConnection();
        const [rows] = await connection.execute(sql, params);
        connection.release();
        return rows;
    }
}

module.exports = DBClient;
