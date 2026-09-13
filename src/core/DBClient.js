const { Pool } = require("pg");
require("dotenv").config();
const Logger = require("../../utils/Logger");
const fs = require("fs");

/**
 * DBClient — PostgreSQL connection pool wrapper.
 *
 * Phase 1 fix:
 *   The Pool constructor contained a duplicate `ssl` key.  JavaScript object
 *   literals silently overwrite earlier keys with the same name, so the second
 *   `ssl: { rejectUnauthorized: false }` replaced the first entry that carried
 *   the actual certificate files.  The result: SSL cert verification was
 *   disabled, and the ca/key/cert values were never passed to the driver —
 *   making mTLS connections impossible and leaving rejectUnauthorized=false
 *   as the only "security" in place.
 *
 *   Fixed by merging both ssl entries into one, with an optional cert-loading
 *   path that activates only when the relevant env vars are present.  This
 *   preserves backward compatibility for environments that use password-only
 *   connections while enabling full mTLS where certs are configured.
 */
class DBClient {
    constructor() {
        if (!process.env.DB_HOST || !process.env.DB_USER) {
            throw new Error("❌ Database credentials are missing! Check your .env file.");
        }

        const sslConfig = this._buildSSLConfig();

        this.pool = new Pool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 5432,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME,
            ssl: sslConfig,
            statement_timeout: 5000,
            application_name: "Falcon-Automation",
        });

        this.pool.on("error", (err) => {
            Logger.error(`❌ Unexpected database pool error: ${err.message}`);
        });
    }

    /**
     * Build the SSL configuration object.
     *
     * If SSL_CA_FILE, SSL_KEY_FILE, and SSL_CERT_FILE are all set, full mTLS
     * is configured with cert verification enabled.
     *
     * If only some env vars are present, or none, a safe default is used with
     * rejectUnauthorized controlled by SSL_REJECT_UNAUTHORIZED (default: true).
     *
     * @returns {Object|boolean} pg-compatible ssl config, or false to disable SSL
     */
    _buildSSLConfig() {
        const useTLS = process.env.DB_SSL !== "false";
        if (!useTLS) return false;

        const caFile  = process.env.SSL_CA_FILE;
        const keyFile = process.env.SSL_KEY_FILE;
        const certFile = process.env.SSL_CERT_FILE;

        // Full mTLS: all three cert files must be present and readable
        if (caFile && keyFile && certFile) {
            try {
                return {
                    rejectUnauthorized: process.env.SSL_REJECT_UNAUTHORIZED !== "false",
                    ca:   fs.readFileSync(caFile).toString(),
                    key:  fs.readFileSync(keyFile).toString(),
                    cert: fs.readFileSync(certFile).toString(),
                };
            } catch (err) {
                Logger.error(`❌ Failed to load SSL certificate files: ${err.message}`);
                throw err;
            }
        }

        // Partial / no certs: TLS without client certificates
        Logger.warning(
            "⚠️  SSL cert env vars not fully configured — using TLS without client certificates. " +
            "Set SSL_CA_FILE, SSL_KEY_FILE, and SSL_CERT_FILE for mTLS."
        );
        return {
            rejectUnauthorized: process.env.SSL_REJECT_UNAUTHORIZED !== "false",
        };
    }

    async query(sql, params = []) {
        let client;
        try {
            Logger.info(`🔹 Running DB Query: ${sql}`);
            client = await this.pool.connect();
            const res = await client.query(sql, params);
            return res.rows;
        } catch (error) {
            Logger.error(`❌ Database Query Failed: ${error.message}`);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    /** Gracefully shut down all connections in the pool. */
    async close() {
        await this.pool.end();
        Logger.info("🔌 Database connection pool closed.");
    }
}

module.exports = DBClient;
