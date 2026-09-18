const http = require("http");
const { io } = require("socket.io-client");

/**
 * DashboardAuth.check.js — regression test for the Phase 7 dashboard auth.
 *
 * Proves both halves of the contract:
 *   1. With DASHBOARD_TOKEN unset (default local-dev behavior), everything
 *      still works with no token at all — this must never become a breaking
 *      change for anyone just running `node falcon.js` locally.
 *   2. With DASHBOARD_TOKEN set, an unauthenticated POST /emit, GET /events,
 *      and socket.io connection are all rejected — and the correct token
 *      (via header, query param, or socket auth) is accepted.
 *
 * Runs a real Dashboard instance on an ephemeral port and makes real HTTP
 * requests and a real socket.io connection against it — no mocks. The token
 * used here is a throwaway value generated for this test run only, the same
 * pattern as the CI Postgres password — it's a test fixture, not a secret.
 */

const Dashboard = require("../../src/core/Dashboard");

let failures = 0;

function httpRequest(port, method, urlPath, headers = {}, jsonBody) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { host: "localhost", port, path: urlPath, method, headers, timeout: 3000 },
            (res) => {
                let body = "";
                res.on("data", (chunk) => (body += chunk));
                res.on("end", () => resolve({ statusCode: res.statusCode, body }));
            }
        );
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("request timed out")));
        if (method === "POST") {
            const payload = JSON.stringify(jsonBody ?? { name: "testStart", payload: {} });
            req.setHeader("Content-Type", "application/json");
            req.setHeader("Content-Length", Buffer.byteLength(payload));
            req.end(payload);
        } else {
            req.end();
        }
    });
}

function connectSocket(port, token) {
    return new Promise((resolve) => {
        const socket = io(`http://localhost:${port}`, {
            auth: token !== undefined ? { token } : {},
            reconnection: false,
            timeout: 3000,
        });
        socket.on("connect", () => {
            socket.close();
            resolve({ connected: true });
        });
        socket.on("connect_error", (err) => {
            socket.close();
            resolve({ connected: false, message: err.message });
        });
    });
}

function check(label, condition, detail) {
    if (condition) {
        console.log(`✅ ${label}`);
    } else {
        failures++;
        console.error(`❌ ${label}${detail ? `: ${detail}` : ""}`);
    }
}

async function testWithoutToken() {
    delete process.env.DASHBOARD_TOKEN;
    const dashboard = new Dashboard({ port: 0 });
    await dashboard.start();
    const port = dashboard.port;

    const emitRes = await httpRequest(port, "POST", "/emit");
    check("no DASHBOARD_TOKEN set: unauthenticated POST /emit still succeeds (204)", emitRes.statusCode === 204, `got ${emitRes.statusCode}`);

    const eventsRes = await httpRequest(port, "GET", "/events");
    check("no DASHBOARD_TOKEN set: unauthenticated GET /events still succeeds (200)", eventsRes.statusCode === 200, `got ${eventsRes.statusCode}`);

    const healingPendingRes = await httpRequest(port, "GET", "/healing/pending");
    check("no DASHBOARD_TOKEN set: unauthenticated GET /healing/pending still succeeds (200)", healingPendingRes.statusCode === 200, `got ${healingPendingRes.statusCode}`);

    const healingTrendRes = await httpRequest(port, "GET", "/healing/trend");
    check("no DASHBOARD_TOKEN set: unauthenticated GET /healing/trend still succeeds (200)", healingTrendRes.statusCode === 200, `got ${healingTrendRes.statusCode}`);

    const socketRes = await connectSocket(port);
    check("no DASHBOARD_TOKEN set: socket connects with no token", socketRes.connected === true, socketRes.message);

    await dashboard.stop();
}

async function testWithToken() {
    const TOKEN = `test-token-${Date.now()}`;
    process.env.DASHBOARD_TOKEN = TOKEN;
    const dashboard = new Dashboard({ port: 0 });
    await dashboard.start();
    const port = dashboard.port;

    const noAuthEmit = await httpRequest(port, "POST", "/emit");
    check("DASHBOARD_TOKEN set: unauthenticated POST /emit rejected (401)", noAuthEmit.statusCode === 401, `got ${noAuthEmit.statusCode}`);

    const noAuthEvents = await httpRequest(port, "GET", "/events");
    check("DASHBOARD_TOKEN set: unauthenticated GET /events rejected (401)", noAuthEvents.statusCode === 401, `got ${noAuthEvents.statusCode}`);

    const wrongHeaderEmit = await httpRequest(port, "POST", "/emit", { "X-Dashboard-Token": "wrong-token" });
    check("DASHBOARD_TOKEN set: wrong token via header rejected (401)", wrongHeaderEmit.statusCode === 401, `got ${wrongHeaderEmit.statusCode}`);

    const rightHeaderEmit = await httpRequest(port, "POST", "/emit", { "X-Dashboard-Token": TOKEN });
    check("DASHBOARD_TOKEN set: correct token via header accepted (204)", rightHeaderEmit.statusCode === 204, `got ${rightHeaderEmit.statusCode}`);

    const rightQueryEvents = await httpRequest(port, "GET", `/events?token=${TOKEN}`);
    check("DASHBOARD_TOKEN set: correct token via query param accepted (200)", rightQueryEvents.statusCode === 200, `got ${rightQueryEvents.statusCode}`);

    // Phase 8 — the healing trust endpoints get exactly the same gate as
    // /emit and /events above: same token check, same rate limiter.
    const noAuthPending = await httpRequest(port, "GET", "/healing/pending");
    check("DASHBOARD_TOKEN set: unauthenticated GET /healing/pending rejected (401)", noAuthPending.statusCode === 401, `got ${noAuthPending.statusCode}`);

    const rightAuthPending = await httpRequest(port, "GET", "/healing/pending", { "X-Dashboard-Token": TOKEN });
    check("DASHBOARD_TOKEN set: correct token via header accepted for GET /healing/pending (200)", rightAuthPending.statusCode === 200, `got ${rightAuthPending.statusCode}`);

    const noAuthApprove = await httpRequest(port, "POST", "/healing/approve", {}, { original: "#does-not-exist" });
    check("DASHBOARD_TOKEN set: unauthenticated POST /healing/approve rejected (401)", noAuthApprove.statusCode === 401, `got ${noAuthApprove.statusCode}`);

    const rightAuthApproveUnknown = await httpRequest(port, "POST", "/healing/approve", { "X-Dashboard-Token": TOKEN }, { original: "#does-not-exist" });
    check(
        "DASHBOARD_TOKEN set: authenticated POST /healing/approve for an unknown selector returns 404, not silently trusted",
        rightAuthApproveUnknown.statusCode === 404,
        `got ${rightAuthApproveUnknown.statusCode}`
    );

    const noAuthSocket = await connectSocket(port);
    check(
        "DASHBOARD_TOKEN set: unauthenticated socket connection rejected",
        noAuthSocket.connected === false,
        noAuthSocket.connected ? "socket connected without a token" : undefined
    );

    const wrongAuthSocket = await connectSocket(port, "wrong-token");
    check("DASHBOARD_TOKEN set: socket with wrong token rejected", wrongAuthSocket.connected === false);

    const rightAuthSocket = await connectSocket(port, TOKEN);
    check("DASHBOARD_TOKEN set: socket with correct token connects", rightAuthSocket.connected === true, rightAuthSocket.message);

    await dashboard.stop();
    delete process.env.DASHBOARD_TOKEN;
}

/**
 * Phase 7 follow-up: CodeQL flagged that POST /emit and GET /events perform
 * authorization but had no rate limiting — meaning DASHBOARD_TOKEN could be
 * brute-forced by hammering either endpoint with guesses. Fixed with
 * express-rate-limit on both routes, and a matching in-memory limiter on the
 * socket.io handshake (which express-rate-limit doesn't cover, since it's
 * not an Express route). This proves the fix actually throttles, not just
 * that it doesn't crash — fires well past the configured limit (120/min)
 * and confirms at least one request/connection gets rejected specifically
 * for rate limiting, not for auth.
 */
async function testRateLimiting() {
    const dashboard = new Dashboard({ port: 0 });
    await dashboard.start();
    const port = dashboard.port;

    const REQUEST_COUNT = 130; // over the 120/min limit
    const responses = await Promise.all(
        Array.from({ length: REQUEST_COUNT }, () => httpRequest(port, "POST", "/emit"))
    );
    const rateLimited = responses.filter((r) => r.statusCode === 429).length;
    check(
        `HTTP: firing ${REQUEST_COUNT} POST /emit requests gets at least one 429 (rate limited)`,
        rateLimited > 0,
        `got 0 of ${REQUEST_COUNT} rate-limited (statuses seen: ${[...new Set(responses.map((r) => r.statusCode))].join(", ")})`
    );

    const socketResults = await Promise.all(
        Array.from({ length: REQUEST_COUNT }, () => connectSocket(port))
    );
    const socketRateLimited = socketResults.filter(
        (r) => r.connected === false && /too many/i.test(r.message || "")
    ).length;
    check(
        `Socket: firing ${REQUEST_COUNT} connection attempts gets at least one rate-limit rejection`,
        socketRateLimited > 0,
        `got 0 of ${REQUEST_COUNT} rate-limited (sample message: ${socketResults.find((r) => !r.connected)?.message})`
    );

    await dashboard.stop();
}

(async () => {
    await testWithoutToken();
    await testWithToken();
    await testRateLimiting();

    if (failures > 0) {
        console.error(`\n❌ DashboardAuth: ${failures} case(s) failed`);
        process.exitCode = 1;
    } else {
        console.log("\n✅ DashboardAuth: all cases passed");
    }
})().catch((error) => {
    console.error(`❌ DashboardAuth: unexpected error — ${error.message}`);
    process.exitCode = 1;
});
