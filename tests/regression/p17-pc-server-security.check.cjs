/**
 * tests/regression/p17-pc-server-security.check.cjs — host/origin/sec-fetch
 * rejection matrix, rate limiting, and connection-hardening regression
 * tests for src/production-cycle/Server.js (Sec-00b D-11/D-12/D-13).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

const Server = require("../../src/production-cycle/Server");

async function mkRunDir() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "p17-pc-sec-"));
  const runDir = path.join(root, "run1");
  await fsp.mkdir(runDir, { recursive: true });
  return runDir;
}

function request(port, pathAndQuery, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathAndQuery, method: "GET", headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function startServer(runDir, extra = {}) {
  const instance = Server.create(Object.assign({ runDir, port: 0, host: "127.0.0.1" }, extra));
  const bound = await instance.listen();
  return { instance, port: bound.port };
}

test("D-11: missing/invalid Host header is 403", { timeout: 8000 }, async () => {
  const runDir = await mkRunDir();
  const { instance, port } = await startServer(runDir);
  try {
    // node's http client always injects a Host header, so a raw socket is
    // required to exercise the "Host missing entirely" case.
    const raw = await new Promise((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.write("GET /api/state HTTP/1.1\r\n\r\n");
      });
      let data = "";
      socket.on("data", (c) => (data += c.toString("utf8")));
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
    });
    // Node's own HTTP/1.1 parser requires a Host header and replies 400
    // before our handler ever runs when one is wholly absent; our handler's
    // Host allowlist (exercised below via a mismatched Host) is what
    // enforces the loopback-only policy once a request reaches it.
    assert.match(raw, /^HTTP\/1\.1 400/);

    const r2 = await request(port, "/api/state", { Host: "evil.example.com" });
    assert.equal(r2.status, 403);
  } finally {
    await instance.close();
  }
});

test("D-11: Origin present but not same-origin is 403", { timeout: 8000 }, async () => {
  const runDir = await mkRunDir();
  const { instance, port } = await startServer(runDir);
  try {
    const r = await request(port, "/api/state", {
      Host: `127.0.0.1:${port}`,
      Origin: "http://evil.example.com",
    });
    assert.equal(r.status, 403);
    const ok = await request(port, "/api/state", {
      Host: `127.0.0.1:${port}`,
      Origin: `http://127.0.0.1:${port}`,
    });
    assert.equal(ok.status, 200);
  } finally {
    await instance.close();
  }
});

test("D-11: Sec-Fetch-Site not in {same-origin,none} is 403", { timeout: 8000 }, async () => {
  const runDir = await mkRunDir();
  const { instance, port } = await startServer(runDir);
  try {
    const r = await request(port, "/api/state", {
      Host: `127.0.0.1:${port}`,
      "Sec-Fetch-Site": "cross-site",
    });
    assert.equal(r.status, 403);
    const ok = await request(port, "/api/state", {
      Host: `127.0.0.1:${port}`,
      "Sec-Fetch-Site": "same-origin",
    });
    assert.equal(ok.status, 200);
  } finally {
    await instance.close();
  }
});

test("D-11: Sec-Fetch-Mode navigate on /api/* is 403", { timeout: 8000 }, async () => {
  const runDir = await mkRunDir();
  const { instance, port } = await startServer(runDir);
  try {
    const r = await request(port, "/api/state", {
      Host: `127.0.0.1:${port}`,
      "Sec-Fetch-Mode": "navigate",
    });
    assert.equal(r.status, 403);
  } finally {
    await instance.close();
  }
});

test("D-12: two simulated tabs polling get zero 429 under the 600/min bucket", { timeout: 8000 }, async () => {
  const runDir = await mkRunDir();
  let fakeNow = 0;
  const now = () => fakeNow;
  const { instance, port } = await startServer(runDir, { now });
  try {
    let saw429 = false;
    for (let i = 0; i < 6; i++) {
      fakeNow += 500;
      const [a, b] = await Promise.all([
        request(port, "/api/state", { Host: `127.0.0.1:${port}` }),
        request(port, "/api/state", { Host: `127.0.0.1:${port}` }),
      ]);
      if (a.status === 429 || b.status === 429) saw429 = true;
    }
    assert.equal(saw429, false);
  } finally {
    await instance.close();
  }
});

test("D-13: connection hardening options are applied", { timeout: 8000 }, async () => {
  const runDir = await mkRunDir();
  const { instance, port } = await startServer(runDir, {
    headersTimeout: 300,
    requestTimeout: 500,
    keepAliveTimeout: 100,
  });
  try {
    assert.equal(instance.server.maxConnections, 8);
    assert.equal(instance.server.headersTimeout, 300);
    assert.equal(instance.server.requestTimeout, 500);
    assert.ok(instance.server.headersTimeout < instance.server.requestTimeout);

    let got408 = false;
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write("GET /api/state HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\n");
      // Deliberately never send the final CRLF — simulate a slow-header client.
    });
    // The socket must actively drain data for the TCP/Node internals to
    // observe the server's FIN/RST and emit 'close'; otherwise a client
    // that never reads will not notice the server already closed its end.
    socket.resume();
    socket.on("data", (chunk) => {
      if (chunk.toString("utf8").includes("408")) got408 = true;
    });
    const closed = await new Promise((resolve) => {
      socket.on("close", () => resolve(true));
      socket.on("error", () => resolve(true));
      setTimeout(() => resolve(false), 2500);
    });
    socket.destroy();
    assert.equal(closed, true, "slow-header socket should be closed within the injected headersTimeout bound");
    assert.equal(got408, true, "server should respond 408 Request Timeout before closing the slow-header socket");
  } finally {
    if (typeof instance.server.closeAllConnections === "function") {
      instance.server.closeAllConnections();
    }
    await instance.close();
  }
});

test("every error response is fixed JSON {error:CODE} with no paths/values", { timeout: 8000 }, async () => {
  const runDir = await mkRunDir();
  const { instance, port } = await startServer(runDir);
  try {
    const r = await request(port, "/api/state?bogus=1", { Host: `127.0.0.1:${port}` });
    const data = JSON.parse(r.body);
    assert.deepEqual(Object.keys(data), ["error"]);
    assert.equal(typeof data.error, "string");
    assert.ok(!data.error.includes("/"));
  } finally {
    await instance.close();
  }
});
