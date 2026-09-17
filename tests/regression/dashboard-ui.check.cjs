const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { root } = require("./helpers.cjs");
function dashboardUI() {
  const handlers = {},
    nodes = new Map(),
    rows = [];
  const node = () => ({
    textContent: "",
    style: {},
    classList: { add() {}, remove() {} },
    remove() {},
    prepend(row) {
      rows.unshift(row);
    },
    replaceChildren() {
      rows.length = 0;
    },
  });
  const document = {
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, node());
      return nodes.get(id);
    },
    createElement: () => node(),
  };
  const html = fs.readFileSync(
    path.join(root, "src/dashboard/index.html"),
    "utf8",
  );
  const source = html.match(/<script>\s*([\s\S]*?)<\/script>/i)[1];
  vm.runInNewContext(source, {
    document,
    io: () => ({ on: (name, fn) => (handlers[name] = fn) }),
    setInterval() {},
    URL,
    URLSearchParams,
    location: { search: "", href: "http://localhost" },
    localStorage: { getItem: () => null },
    history: { replaceState() {} },
  });
  return { handlers, nodes, rows };
}
test("dashboard renders pass/fail/skip/healing counters and lifecycle rows", () => {
  const { handlers, nodes, rows } = dashboardUI();
  handlers.connect();
  assert.equal(nodes.get("status-label").textContent, "Live");
  for (const name of [
    "testStart",
    "testPass",
    "testFail",
    "testSkip",
    "healingEvent",
    "explorerPage",
    "testEnd",
  ])
    handlers.event({
      name,
      payload: {
        name: "fixture",
        testName: "fixture",
        original: "#old",
        resolved: "#new",
      },
      timestamp: Date.now(),
    });
  for (const id of ["t-pass", "t-fail", "t-skip", "t-heal"])
    assert.equal(Number(nodes.get(id).textContent), 1);
  assert.equal(Number(nodes.get("t-total").textContent), 3);
  assert.equal(rows.length, 7);
  handlers.disconnect();
  assert.equal(nodes.get("status-label").textContent, "Disconnected");
  handlers.connect_error(Error("Unauthorized"));
  assert.match(nodes.get("status-label").textContent, /Unauthorized/);
});
test("dashboard treats event names and error details as text", () => {
  const { handlers, rows } = dashboardUI();
  handlers.event({
    name: "testFail",
    payload: {
      name: "<img src=x onerror=alert(1)>",
      error: "<script>alert(1)</script>",
    },
    timestamp: Date.now(),
  });
  assert.ok(!rows[0].innerHTML.includes("<img"));
  assert.ok(!rows[0].innerHTML.includes("<script>"));
  assert.match(rows[0].innerHTML, /&lt;img/);
});
test("reconnect replay replaces counters and feed instead of duplicating history", () => {
  const { handlers, nodes, rows } = dashboardUI();
  const events = [
    { name: "testPass", payload: { name: "fixture" }, timestamp: Date.now() },
  ];
  handlers.replay(events);
  handlers.replay(events);
  assert.equal(Number(nodes.get("t-pass").textContent), 1);
  assert.equal(rows.length, 1);
});
