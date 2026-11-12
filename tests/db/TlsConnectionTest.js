const Logger = require("../../utils/Logger");
const path = require("path");

/**
 * TlsConnectionTest — proves DBClient's TLS/mTLS path (G-02, CAP-11) against
 * a real TLS-enabled Postgres, not just the configuration object it builds.
 *
 * Why this is a standalone script rather than a BaseTest subclass:
 *   UserDBTest/OrderDBTest use the single `dbClient` ServiceContainer builds
 *   once, from whatever DB_* env vars are present when the process starts.
 *   This test needs several different SSL configurations (plain TLS, mTLS,
 *   untrusted CA, partial certs, insecure opt-out, DB_SSL=false) in one run,
 *   so each case sets process.env, requires a *fresh* DBClient instance, and
 *   restores the environment afterwards — exactly the pattern CLAUDE.md asks
 *   for because DBClient reads env only in its constructor.
 *
 * CI topology (see scripts/db/tls/start-tls-postgres.sh): one throwaway
 * Postgres container, certs generated at run time with openssl (never
 * committed), two databases differentiated by pg_hba.conf —
 *   - falcon_tls  (TLS_DB_PORT_TLS)  — hostssl, md5, client cert optional.
 *   - falcon_mtls (TLS_DB_PORT_MTLS) — hostssl, `cert` auth,
 *                                      clientcert=verify-full.
 *
 * Skip/fail convention (same as UserDBTest/OrderDBTest, CLAUDE.md "DB tests
 * may skip locally without configuration; CI is the authority"):
 *   - TLS_DB_HOST unset and CI unset/false/0  -> clean skip, exit 0.
 *   - TLS_DB_HOST unset and CI set (truthy)   -> real failure, exit 1 (CI
 *     provisions this container itself, so missing config means the job
 *     silently tested nothing).
 *
 * No private key, certificate, or password is ever logged — only file
 * paths and connection outcomes.
 */

const TLS_DB_HOST = process.env.TLS_DB_HOST;
const TLS_DB_PORT_TLS = process.env.TLS_DB_PORT_TLS;
const TLS_DB_PORT_MTLS = process.env.TLS_DB_PORT_MTLS;
const TLS_DB_CERT_DIR = process.env.TLS_DB_CERT_DIR;

function ciIsSet() {
    const ci = (process.env.CI || "").toLowerCase();
    return ci !== "" && ci !== "0" && ci !== "false";
}

if (!TLS_DB_HOST || !TLS_DB_PORT_TLS || !TLS_DB_PORT_MTLS || !TLS_DB_CERT_DIR) {
    if (ciIsSet()) {
        const message =
            "TLS Connection Test: no TLS database configured in CI " +
            "(TLS_DB_HOST/TLS_DB_PORT_TLS/TLS_DB_PORT_MTLS/TLS_DB_CERT_DIR not set) — " +
            "the db-tls job provisions a TLS Postgres container, so this run verified nothing.";
        Logger.error(`❌ ${message}`);
        process.exitCode = 1;
    } else {
        Logger.warning(
            "⚠️  Skipping TLS Connection Test — no TLS database configured locally " +
            "(TLS_DB_HOST/TLS_DB_PORT_TLS/TLS_DB_PORT_MTLS/TLS_DB_CERT_DIR not set). " +
            "Nothing was verified; CI is the authority for the real TLS/mTLS path."
        );
    }
    return;
}

const certPath = (name) => path.join(TLS_DB_CERT_DIR, name);

// Base env every case starts from, restored after each case so a case's
// overrides never leak into the next one.
const BASE_ENV = {
    DB_HOST: TLS_DB_HOST,
    DB_USER: "falcon_tls_user",
    DB_PASS: process.env.TLS_DB_PASSWORD || "falcon_tls_ci_password",
    DB_NAME: "falcon_tls",
    DB_PORT: TLS_DB_PORT_TLS,
    DB_SSL: "true",
};

const SAVED_KEYS = [
    "DB_HOST", "DB_USER", "DB_PASS", "DB_NAME", "DB_PORT", "DB_SSL",
    "SSL_CA_FILE", "SSL_KEY_FILE", "SSL_CERT_FILE", "SSL_REJECT_UNAUTHORIZED",
];

function withEnv(overrides, fn) {
    const saved = {};
    for (const key of SAVED_KEYS) saved[key] = process.env[key];
    for (const key of SAVED_KEYS) delete process.env[key];
    Object.assign(process.env, BASE_ENV, overrides);

    // Each case needs a *fresh* DBClient (and a fresh pg Pool), so the
    // module cache for DBClient itself must be cleared — it reads env only
    // once, in its constructor, but require() caching is per-module, not
    // per-instance, and we deliberately `new DBClient()` per case rather
    // than relying on any cache.
    delete require.cache[require.resolve("../../src/core/DBClient")];
    const DBClient = require("../../src/core/DBClient");

    return Promise.resolve()
        .then(() => fn(DBClient))
        .finally(() => {
            for (const key of SAVED_KEYS) {
                if (saved[key] === undefined) delete process.env[key];
                else process.env[key] = saved[key];
            }
        });
}

async function expectConnects(label, overrides, assertRow) {
    let client;
    try {
        await withEnv(overrides, async (DBClient) => {
            client = new DBClient();
            const rows = await client.query(
                "SELECT ssl, client_dn FROM pg_stat_ssl " +
                "JOIN pg_stat_activity USING (pid) WHERE pid = pg_backend_pid()"
            );
            if (!rows[0] || rows[0].ssl !== true) {
                throw new Error(`${label}: expected pg_stat_ssl.ssl = true, got ${JSON.stringify(rows[0])}`);
            }
            if (assertRow) assertRow(rows[0]);
        });
        Logger.info(`✅ ${label}`);
        return true;
    } catch (err) {
        Logger.error(`❌ ${label}: expected a successful TLS connection but got: ${err.message}`);
        return false;
    } finally {
        if (client) await client.close().catch(() => {});
    }
}

async function expectRejects(label, overrides, errorPattern) {
    let client;
    try {
        await withEnv(overrides, async (DBClient) => {
            client = new DBClient();
            await client.query("SELECT 1");
        });
        Logger.error(`❌ ${label}: expected the connection to be rejected, but it succeeded.`);
        return false;
    } catch (err) {
        if (!errorPattern.test(err.message)) {
            Logger.error(
                `❌ ${label}: connection failed as expected, but the error did not match ` +
                `${errorPattern} (not a generic failure, must be a cert/handshake rejection): ${err.message}`
            );
            return false;
        }
        Logger.info(`✅ ${label} (rejected with: ${err.message})`);
        return true;
    } finally {
        if (client) await client.close().catch(() => {});
    }
}

async function expectConstructorThrows(label, overrides, messagePattern) {
    try {
        await withEnv(overrides, async (DBClient) => {
            new DBClient();
        });
        Logger.error(`❌ ${label}: expected DBClient construction to throw, but it did not.`);
        return false;
    } catch (err) {
        if (!messagePattern.test(err.message)) {
            Logger.error(`❌ ${label}: error did not match ${messagePattern}: ${err.message}`);
            return false;
        }
        Logger.info(`✅ ${label} (threw: ${err.message})`);
        return true;
    }
}

(async () => {
    Logger.info("🔹 Running TLS Connection Test (G-02 / CAP-11)...");
    const outcomes = [];

    // 1. Positive: TLS, trusted CA, no client cert — connects; DBClient logs
    //    a warning about missing client certs (no mTLS attempted).
    outcomes.push(await expectConnects(
        "TLS with trusted CA, no client cert — connects",
        { SSL_CA_FILE: certPath("ca-trusted.crt") },
        (row) => {
            if (row.client_dn !== null) {
                throw new Error(`expected no client cert (client_dn null), got ${row.client_dn}`);
            }
        }
    ));

    // 2. Positive: full mTLS — connects; server confirms the client cert
    //    subject via pg_stat_ssl.client_dn.
    outcomes.push(await expectConnects(
        "Full mTLS with trusted CA + client cert — connects, server confirms client_dn",
        {
            DB_PORT: TLS_DB_PORT_MTLS,
            DB_USER: "falcon_mtls_client",
            DB_PASS: "",
            DB_NAME: "falcon_mtls",
            SSL_CA_FILE: certPath("ca-trusted.crt"),
            SSL_KEY_FILE: certPath("client.key"),
            SSL_CERT_FILE: certPath("client.crt"),
        },
        (row) => {
            if (row.client_dn !== "/CN=falcon_mtls_client") {
                throw new Error(`expected client_dn '/CN=falcon_mtls_client', got ${row.client_dn}`);
            }
        }
    ));

    // 3. Negative: untrusted server CA — rejectUnauthorized default (true),
    //    must fail with a certificate-verification error, not a generic one.
    outcomes.push(await expectRejects(
        "Untrusted CA, default rejectUnauthorized — connection must be rejected",
        { SSL_CA_FILE: certPath("ca-untrusted.crt") },
        /self[- ]signed|unable to verify|certificate/i
    ));

    // 4. Negative: mTLS server, no client cert presented — refused.
    outcomes.push(await expectRejects(
        "mTLS server (clientcert=verify-full), no client cert — connection must be refused",
        {
            DB_PORT: TLS_DB_PORT_MTLS,
            DB_USER: "falcon_mtls_client",
            DB_PASS: "",
            DB_NAME: "falcon_mtls",
            SSL_CA_FILE: certPath("ca-trusted.crt"),
        },
        /certificate/i
    ));

    // 5. Failure: SSL_CA_FILE points to a missing file — DBClient's existing
    //    contract (read failure logs and rethrows) must name the file and
    //    must not print key content.
    outcomes.push(await expectConstructorThrows(
        "Missing SSL_CA_FILE — constructor throws naming the file",
        {
            SSL_CA_FILE: certPath("does-not-exist.crt"),
            SSL_KEY_FILE: certPath("client.key"),
            SSL_CERT_FILE: certPath("client.crt"),
        },
        /does-not-exist\.crt/
    ));

    // 6. Boundary: SSL_REJECT_UNAUTHORIZED=false with an untrusted CA —
    //    connects. Documented insecure opt-out; behaviour must not change
    //    silently.
    outcomes.push(await expectConnects(
        "SSL_REJECT_UNAUTHORIZED=false with untrusted CA — connects (insecure opt-out)",
        { SSL_CA_FILE: certPath("ca-untrusted.crt"), SSL_REJECT_UNAUTHORIZED: "false" }
    ));

    // 7. Boundary: partial cert vars (key without cert) — falls to the
    //    no-client-cert branch with a warning, still connects over TLS.
    outcomes.push(await expectConnects(
        "Partial cert vars (SSL_KEY_FILE without SSL_CERT_FILE) — no-client-cert branch, still connects",
        { SSL_CA_FILE: certPath("ca-trusted.crt"), SSL_KEY_FILE: certPath("client.key") }
    ));

    // 8. Boundary: DB_SSL=false against a TLS-only (hostssl) server —
    //    refused, no silent TLS upgrade.
    outcomes.push(await expectRejects(
        "DB_SSL=false against hostssl-only server — connection must be refused",
        { DB_SSL: "false" },
        /no pg_hba\.conf entry|no encryption|SSL/i
    ));

    const passed = outcomes.filter(Boolean).length;
    const failed = outcomes.length - passed;
    Logger.info(`🔹 TLS Connection Test: ${passed}/${outcomes.length} cases passed.`);

    if (failed > 0) {
        Logger.error(`❌ TLS Connection Test FAILED: ${failed} case(s) did not behave as expected.`);
        process.exitCode = 1;
    } else {
        Logger.info("✅ TLS Connection Test PASSED — all cases verified against a real TLS Postgres.");
    }
    await Logger.flush();
})();
