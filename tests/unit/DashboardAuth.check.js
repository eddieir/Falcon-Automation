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

function httpRequest(port, method, urlPath, headers = {}) {
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
            const payload = JSON.stringify({ name: "testStart", payload: {} });
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

(async () => {
    await testWithoutToken();
    await testWithToken();

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
