const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { io } = require("socket.io-client");
const { root, temp } = require("./helpers.cjs");

const Dashboard = require("../../src/core/Dashboard");
const { MAX_EVENTS } = Dashboard;

// Constructed without DASHBOARD_HOST / DASHBOARD_TOKEN leaking in from the
// developer's shell, then restored.
function withEnv(env, fn) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: urlPath, timeout: 3000 }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(JSON.parse(body)));
      })
      .on("error", reject);
  });
}

test("default bind address is 127.0.0.1", async (t) => {
  const d = withEnv({ DASHBOARD_HOST: undefined, DASHBOARD_TOKEN: undefined }, () => new Dashboard({ port: 0 }));
  await d.start();
  t.after(() => d.stop());
  assert.equal(d._server.address().address, "127.0.0.1");
  assert.match(d.url, /^http:\/\/localhost:/);
});

test("DASHBOARD_HOST env var sets the default host", () => {
  const d = withEnv({ DASHBOARD_HOST: "192.168.1.10" }, () => new Dashboard({ port: 0 }));
  assert.equal(d.host, "192.168.1.10");
});

test("non-loopback host without a token refuses to start and listens on nothing", async () => {
  const d = withEnv({ DASHBOARD_TOKEN: undefined }, () => new Dashboard({ port: 0, host: "0.0.0.0" }));
  await assert.rejects(d.start(), (error) => {
    assert.equal(error.code, "DASHBOARD_EXPOSED_WITHOUT_TOKEN");
    assert.match(error.message, /DASHBOARD_HOST|host/);
    assert.match(error.message, /DASHBOARD_TOKEN/);
    return true;
  });
  assert.equal(d._server, null);
});

test("non-loopback host with a token starts, and the message never contains the token", async (t) => {
  const token = "throwaway-" + process.pid;
  const refused = withEnv({ DASHBOARD_TOKEN: undefined }, () => new Dashboard({ port: 0, host: "0.0.0.0" }));
  await assert.rejects(refused.start(), (e) => !e.message.includes(token));
  const d = withEnv({ DASHBOARD_TOKEN: token }, () => new Dashboard({ port: 0, host: "0.0.0.0" }));
  await d.start();
  t.after(() => d.stop());
  assert.equal(d._server.listening, true);
});

test("loopback classification", () => {
  for (const h of ["::1", "[::1]", "localhost", "LOCALHOST", "127.0.0.1", "127.0.0.5"]) {
    assert.equal(Dashboard.isLoopbackHost(h), true, h);
  }
  for (const h of ["0.0.0.0", "::", "192.168.1.10", "10.0.0.1", "128.0.0.1", "example.com", "", undefined]) {
    assert.equal(Dashboard.isLoopbackHost(h), false, String(h));
  }
});

test("event history is capped at MAX_EVENTS, oldest dropped, replay bounded", async (t) => {
  const d = withEnv({ DASHBOARD_HOST: undefined, DASHBOARD_TOKEN: undefined }, () => new Dashboard({ port: 0 }));
  await d.start();
  t.after(() => d.stop());
  const total = MAX_EVENTS + 10;
  for (let i = 0; i < total; i++) d.emit("testPass", { name: `t${i}` });
  assert.equal(d._events.length, MAX_EVENTS);
  assert.equal(d._events[0].payload.name, "t10");
  assert.equal(d._events[MAX_EVENTS - 1].payload.name, `t${total - 1}`);

  const viaHttp = await getJson(d.port, "/events");
  assert.equal(viaHttp.length, MAX_EVENTS);

  const socket = io(`http://127.0.0.1:${d.port}`, { transports: ["websocket"] });
  t.after(() => socket.close());
  const replay = await new Promise((resolve, reject) => {
    socket.on("replay", resolve);
    socket.on("connect_error", reject);
  });
  assert.equal(replay.length, MAX_EVENTS);
});

test("falcon.js exits non-zero with a clear message when the dashboard would be exposed", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const marker = path.join(dir, "launched");
  // CI=true turns the dashboard off unless --dashboard is passed, so both are
  // pinned here: the test exercises the same path on a laptop and in CI.
  const env = { ...process.env, CI: "true", FALCON_RUN_HISTORY: "off", FALCON_FIXTURE_MODE: "success", FALCON_LAUNCH_MARKER: marker, DASHBOARD_HOST: "0.0.0.0", DASHBOARD_PORT: "0" };
  delete env.DASHBOARD_TOKEN;
  // The shared CLI preload stubs Dashboard out; this test needs the real one,
  // so a local preload applies the shared mocks and then lets Dashboard through.
  const preload = path.join(dir, "preload.cjs");
  fs.writeFileSync(
    preload,
    `const Module = require("node:module");
const real = Module._load;
require(${JSON.stringify(path.join(root, "tests/fixtures/cli-preload.cjs"))});
const mocked = Module._load;
Module._load = function (name, ...rest) {
  return (name === "./src/core/Dashboard" ? real : mocked).call(this, name, ...rest);
};
`,
  );
  const child = spawnSync(
    process.execPath,
    ["--require", preload, path.join(root, "falcon.js"), "--dashboard", "--url=http://fixture.test/"],
    { cwd: dir, env, encoding: "utf8", timeout: 8000 },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, child.stdout + child.stderr);
  const out = child.stdout + child.stderr;
  assert.match(out, /DASHBOARD_TOKEN/);
  assert.match(out, /Refusing to start the dashboard/);
  assert.equal(fs.existsSync(marker), false, "run must not proceed past the refusal");
});

// ── DNS rebinding: Host / Origin validation on a loopback bind ──────────────

function rawRequest(port, { method = "GET", urlPath = "/", headers = {}, body, host = "127.0.0.1" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path: urlPath, method, headers, timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.end(body);
  });
}

async function startLoopback(t) {
  const d = withEnv({ DASHBOARD_HOST: undefined, DASHBOARD_TOKEN: undefined, DASHBOARD_ALLOWED_ORIGIN: undefined }, () => new Dashboard({ port: 0 }));
  await d.start();
  t.after(() => d.stop());
  return d;
}

test("loopback bind: a foreign Host header is refused on / and /events", async (t) => {
  const d = await startLoopback(t);
  for (const urlPath of ["/", "/events"]) {
    const res = await rawRequest(d.port, { urlPath, headers: { Host: `evil.com:${d.port}` } });
    assert.equal(res.statusCode, 403, urlPath);
    assert.match(res.body, /Forbidden/);
  }
  const wrongPort = await rawRequest(d.port, { urlPath: "/events", headers: { Host: `localhost:${d.port + 1}` } });
  assert.equal(wrongPort.statusCode, 403);
  const noPort = await rawRequest(d.port, { urlPath: "/events", headers: { Host: "localhost" } });
  assert.equal(noPort.statusCode, 403);
});

test("loopback bind: a request with no Host header is refused", async (t) => {
  const d = await startLoopback(t);
  const raw = await new Promise((resolve, reject) => {
    const net = require("node:net");
    const sock = net.connect(d.port, "127.0.0.1", () => sock.write("GET /events HTTP/1.0\r\n\r\n"));
    let out = "";
    sock.on("data", (c) => (out += c));
    sock.on("end", () => resolve(out));
    sock.on("error", reject);
  });
  assert.match(raw, /^HTTP\/1\.\d 403/);
});

test("loopback bind: localhost, 127.0.0.1 and [::1] Host values are accepted", async (t) => {
  const d = await startLoopback(t);
  for (const h of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) {
    const res = await rawRequest(d.port, { urlPath: "/events", headers: { Host: `${h}:${d.port}` } });
    assert.equal(res.statusCode, 200, h);
  }
});

test("bound to ::1: the [::1] Host is accepted", async (t) => {
  const d = withEnv({ DASHBOARD_TOKEN: undefined }, () => new Dashboard({ port: 0, host: "::1" }));
  try {
    await d.start();
  } catch (error) {
    if (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT") return t.skip("IPv6 loopback is not available on this platform");
    throw error;
  }
  t.after(() => d.stop());
  const ok = await rawRequest(d.port, { host: "::1", urlPath: "/events", headers: { Host: `[::1]:${d.port}` } });
  assert.equal(ok.statusCode, 200);
  const bad = await rawRequest(d.port, { host: "::1", urlPath: "/events", headers: { Host: `evil.com:${d.port}` } });
  assert.equal(bad.statusCode, 403);
});

test("loopback bind: POST /emit with a foreign Origin is refused; no Origin and own Origin work", async (t) => {
  const d = await startLoopback(t);
  const body = JSON.stringify({ name: "testPass", payload: { name: "x" } });
  const post = (origin) => rawRequest(d.port, {
    method: "POST", urlPath: "/emit", body,
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...(origin ? { Origin: origin } : {}) },
  });
  assert.equal((await post("http://evil.com")).statusCode, 403);
  assert.equal((await post("null")).statusCode, 403);
  assert.equal(d._events.length, 0, "a refused POST must not emit");
  assert.equal((await post()).statusCode, 204, "a Node reporter sends no Origin");
  assert.equal((await post(`http://localhost:${d.port}`)).statusCode, 204);
});

test("loopback bind: DASHBOARD_ALLOWED_ORIGIN is honoured for state-changing requests", async (t) => {
  const d = await startLoopback(t);
  const saved = process.env.DASHBOARD_ALLOWED_ORIGIN;
  process.env.DASHBOARD_ALLOWED_ORIGIN = "http://ui.example.test";
  t.after(() => { if (saved === undefined) delete process.env.DASHBOARD_ALLOWED_ORIGIN; else process.env.DASHBOARD_ALLOWED_ORIGIN = saved; });
  const res = await rawRequest(d.port, { method: "POST", urlPath: "/emit", body: "{}", headers: { "Content-Type": "application/json", Origin: "http://ui.example.test" } });
  assert.equal(res.statusCode, 204);
});

test("loopback bind: a socket with a foreign Host or Origin cannot connect", async (t) => {
  const d = await startLoopback(t);
  const attempt = (extraHeaders) => new Promise((resolve) => {
    const socket = io(`http://127.0.0.1:${d.port}`, { transports: ["polling"], reconnection: false, extraHeaders });
    socket.on("connect", () => { socket.close(); resolve(true); });
    socket.on("connect_error", () => { socket.close(); resolve(false); });
  });
  // The socket.io client will not let a caller override Host, so the Host
  // case is driven as a raw engine.io handshake request.
  const handshake = (host) => rawRequest(d.port, { urlPath: "/socket.io/?EIO=4&transport=polling", headers: { Host: host } });
  assert.equal((await handshake(`evil.com:${d.port}`)).statusCode, 403);
  assert.equal((await handshake(`localhost:${d.port}`)).statusCode, 200);
  assert.equal(await attempt({ Origin: "http://evil.com" }), false);
  assert.equal(await attempt({}), true);
});

test("non-loopback bind skips the Host check (the token is mandatory there)", async (t) => {
  const d = withEnv({ DASHBOARD_TOKEN: "throwaway-" + process.pid }, () => new Dashboard({ port: 0, host: "0.0.0.0" }));
  await d.start();
  t.after(() => d.stop());
  const res = await rawRequest(d.port, { urlPath: "/events", headers: { Host: "dash.internal:80", "X-Dashboard-Token": "throwaway-" + process.pid } });
  assert.equal(res.statusCode, 200);
});

test("loopback bind: a non-default loopback DASHBOARD_HOST and port 80 Host forms are accepted", () => {
  const custom = withEnv({ DASHBOARD_TOKEN: undefined }, () => new Dashboard({ port: 4321, host: "127.0.0.5" }));
  assert.ok(custom._isRequestAllowed({ host: "127.0.0.5:4321" }, { checkOrigin: false }));
  assert.ok(custom._isRequestAllowed({ host: "localhost:4321" }, { checkOrigin: false }));
  assert.ok(!custom._isRequestAllowed({ host: "127.0.0.6:4321" }, { checkOrigin: false }));
  const v6 = withEnv({ DASHBOARD_TOKEN: undefined }, () => new Dashboard({ port: 4321, host: "::1" }));
  assert.ok(v6._isRequestAllowed({ host: "[::1]:4321" }, { checkOrigin: false }));
  const p80 = withEnv({ DASHBOARD_TOKEN: undefined }, () => new Dashboard({ port: 80 }));
  assert.ok(p80._isRequestAllowed({ host: "localhost" }, { checkOrigin: false }));
  assert.ok(p80._isRequestAllowed({ host: "localhost:80" }, { checkOrigin: false }));
  assert.ok(!p80._isRequestAllowed({ host: "evil.com" }, { checkOrigin: false }));
});
