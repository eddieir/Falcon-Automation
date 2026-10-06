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
  const env = { ...process.env, FALCON_FIXTURE_MODE: "success", FALCON_LAUNCH_MARKER: marker, DASHBOARD_HOST: "0.0.0.0", DASHBOARD_PORT: "0" };
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
    ["--require", preload, path.join(root, "falcon.js"), "--url=http://fixture.test/"],
    { cwd: dir, env, encoding: "utf8", timeout: 8000 },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, child.stdout + child.stderr);
  const out = child.stdout + child.stderr;
  assert.match(out, /DASHBOARD_TOKEN/);
  assert.match(out, /Refusing to start the dashboard/);
  assert.equal(fs.existsSync(marker), false, "run must not proceed past the refusal");
});
