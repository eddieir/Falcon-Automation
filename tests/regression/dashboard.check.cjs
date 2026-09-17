const { test } = require("node:test");
const assert = require("node:assert/strict");
const { io } = require("socket.io-client");
const { once } = require("node:events");
const Dashboard = require("../../src/core/Dashboard");
const Middleware = require("../../src/core/Middleware");
function setup(t, token) {
  const old = process.env.DASHBOARD_TOKEN;
  if (token === undefined) delete process.env.DASHBOARD_TOKEN;
  else process.env.DASHBOARD_TOKEN = token;
  const d = new Dashboard({ port: 0 });
  t.after(async () => {
    Middleware.setEmitter(null);
    await d.stop();
    if (old === undefined) delete process.env.DASHBOARD_TOKEN;
    else process.env.DASHBOARD_TOKEN = old;
  });
  return d;
}
test("authorization rejects equal character length but unequal UTF-8 byte length", (t) => {
  const d = setup(t, "aa");
  assert.equal(d._isAuthorized("éé"), false);
  assert.equal(d._isAuthorized({}), false);
  assert.equal(d._isAuthorized("aa"), true);
});
test("dashboard URL round-trips reserved token characters", (t) => {
  const d = setup(t, "a&b#c +");
  assert.equal(new URL(d.url).searchParams.get("token"), "a&b#c +");
});
test("real websocket replays history and streams subsequent events", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  d.emit("testPass", { name: "first" });
  const socket = io(`http://localhost:${d.port}`, {
    autoConnect: false,
    auth: { token: "fixture-token" },
    reconnection: false,
  });
  t.after(() => socket.close());
  const replay = once(socket, "replay");
  socket.connect();
  assert.equal((await replay)[0][0].payload.name, "first");
  const event = once(socket, "event");
  d.emit("testFail", { name: "second" });
  assert.equal((await event)[0].name, "testFail");
  socket.close();
});
test("dashboard stop disconnects active websocket clients and detaches emitter", async (t) => {
  const d = setup(t);
  await d.start();
  const socket = io(`http://localhost:${d.port}`, {
    transports: ["websocket"],
    reconnection: false,
  });
  t.after(() => socket.close());
  await once(socket, "connect");
  let timer;
  try {
    await Promise.race([
      d.stop(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("stop did not close connected socket")),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    socket.close();
  }
  assert.equal(Middleware._emitter, null);
});
test("socket rate limiter resets after window and isolates IP addresses", (t) => {
  const d = setup(t);
  for (let i = 0; i < 120; i++)
    assert.equal(d._isSocketRateLimited("one"), false);
  assert.equal(d._isSocketRateLimited("one"), true);
  assert.equal(d._isSocketRateLimited("two"), false);
  d._socketConnectAttempts.set("one", [Date.now() - 61000]);
  assert.equal(d._isSocketRateLimited("one"), false);
});
test("middleware lifecycle emits typed payloads", async () => {
  const events = [];
  Middleware.setEmitter((...args) => events.push(args));
  try {
    await Middleware.beforeTest("fixture");
    await Middleware.afterTest("fixture");
    assert.deepEqual(
      events.map((e) => e[0]),
      ["testStart", "testEnd"],
    );
    assert.equal(events[0][1].testName, "fixture");
  } finally {
    Middleware.setEmitter(null);
  }
});
test("middleware sends remote events with authentication", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  Middleware.setEmitter(null);
  const old = process.env.DASHBOARD_URL;
  process.env.DASHBOARD_URL = `http://localhost:${d.port}`;
  t.after(() => {
    if (old === undefined) delete process.env.DASHBOARD_URL;
    else process.env.DASHBOARD_URL = old;
  });
  Middleware.emit("testPass", { name: "remote" });
  const deadline = Date.now() + 2000;
  while (!d._events.length && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(d._events[0]?.payload.name, "remote");
});
