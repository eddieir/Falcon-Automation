const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { root } = require("./helpers.cjs");

/**
 * dashboardUI() loads the real, shipped <script> from src/dashboard/index.html
 * into a fresh V8 context with a minimal fake DOM, so this file exercises the
 * actual production JavaScript — not a reimplementation of it.
 *
 * `fetchImpl(url, options)` lets a test control what `/healing/*` calls
 * return; `fetchCalls` records every call made so tests can assert on the
 * method, URL, headers, and body the shipped code actually sent.
 */
function dashboardUI({ fetchImpl, search = "" } = {}) {
  const handlers = {},
    nodes = new Map(),
    rows = [],
    fetchCalls = [],
    alerts = [];
  const makeNode = () => ({
    textContent: "",
    style: {},
    classList: { add() {}, remove() {} },
    dataset: {},
    disabled: false,
    innerHTML: "",
    children: [], // last payload this node received via replaceChildren()
    _listeners: {},
    remove() {},
    addEventListener(evt, fn) {
      (this._listeners[evt] ||= []).push(fn);
    },
    prepend(row) {
      rows.unshift(row);
    },
    replaceChildren(...kids) {
      rows.length = 0; // preserves the shared feed-clearing semantics other tests rely on
      this.children = kids;
    },
  });
  const document = {
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, makeNode());
      return nodes.get(id);
    },
    createElement: () => makeNode(),
  };
  const html = fs.readFileSync(
    path.join(root, "src/dashboard/index.html"),
    "utf8",
  );
  const source = html.match(/<script>\s*([\s\S]*?)<\/script>/i)[1];
  const defaultFetch = async () => ({ ok: true, json: async () => [] });
  vm.runInNewContext(source, {
    document,
    io: () => ({ on: (name, fn) => (handlers[name] = fn) }),
    setInterval() {},
    URL,
    URLSearchParams,
    location: { search, href: `http://localhost${search}` },
    localStorage: { getItem: () => null, setItem() {} },
    history: { replaceState() {} },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return (fetchImpl || defaultFetch)(url, options);
    },
    alert: (msg) => alerts.push(msg),
  });
  return { handlers, nodes, rows, fetchCalls, alerts };
}

/** Simulates clicking a data-action button inside #healing-pending-list. */
function clickHealingButton(nodes, { action, selector }) {
  const list = nodes.get("healing-pending-list");
  const handler = list._listeners.click[0];
  const button = {
    dataset: { action, selector },
    disabled: false,
    closest: (sel) => (sel === "button[data-action]" ? button : null),
  };
  return handler({ target: button }).then(() => button);
}

function pendingEvent(overrides = {}) {
  return {
    name: "healingPending",
    payload: {
      original: "#old",
      suggested: "#new",
      description: "Save",
      occurrences: 1,
      lastSeen: new Date().toISOString(),
      ...overrides,
    },
    timestamp: Date.now(),
  };
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

// ── Phase 8: healing trust panel ──

test("Phase 8: dashboard handles healing-trust pending/approved/rejected events without crashing", () => {
  const { handlers } = dashboardUI();
  assert.doesNotThrow(() => {
    handlers.event(pendingEvent());
    handlers.event({ name: "healingApproved", payload: { original: "#old", suggested: "#new" }, timestamp: Date.now() });
    handlers.event({ name: "healingRejected", payload: { original: "#other", suggested: "#x" }, timestamp: Date.now() });
  });
});

test("Phase 8: a pending event renders the entry into the healing panel", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pendingEvent({ original: "#save-btn", suggested: "[data-testid=save]" }));
  const list = nodes.get("healing-pending-list");
  assert.equal(list.children.length, 1);
  assert.match(list.children[0].innerHTML, /#save-btn/);
  assert.match(list.children[0].innerHTML, /data-testid=save/);
});

test("Phase 8: approving removes the entry from the panel; rejecting a different one does not affect it", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pendingEvent({ original: "#a" }));
  handlers.event(pendingEvent({ original: "#b" }));
  assert.equal(nodes.get("healing-pending-list").children.length, 2);

  handlers.event({ name: "healingApproved", payload: { original: "#a", suggested: "#new" }, timestamp: Date.now() });
  const remaining = nodes.get("healing-pending-list").children;
  assert.equal(remaining.length, 1);
  assert.match(remaining[0].innerHTML, /#b/);

  handlers.event({ name: "healingRejected", payload: { original: "#b", suggested: "#x" }, timestamp: Date.now() });
  const empty = nodes.get("healing-pending-list").children;
  assert.equal(empty.length, 1);
  assert.equal(empty[0], nodes.get("healing-empty"));
});

test("Phase 8: repeat pending events for the same selector update in place, not duplicate", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pendingEvent({ original: "#a", occurrences: 1 }));
  handlers.event(pendingEvent({ original: "#a", occurrences: 2 }));
  const list = nodes.get("healing-pending-list");
  assert.equal(list.children.length, 1);
  assert.match(list.children[0].innerHTML, /seen 2/);
});

test("Phase 8: approving/rejecting an original selector with no pending entry is a harmless no-op in the UI", () => {
  const { handlers, nodes } = dashboardUI();
  assert.doesNotThrow(() => {
    handlers.event({ name: "healingApproved", payload: { original: "#never-existed", suggested: "#x" }, timestamp: Date.now() });
  });
  const list = nodes.get("healing-pending-list");
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0], nodes.get("healing-empty"));
});

test("Phase 8: pending selector/suggestion/description are HTML-escaped, not injected raw", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pendingEvent({
    original: '<img src=x onerror=alert(1)>',
    suggested: '<script>alert(2)</script>',
    description: '"><b>bold</b>',
  }));
  const html = nodes.get("healing-pending-list").children[0].innerHTML;
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<b>"));
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
});

test("Phase 8: replay resets the healing panel instead of accumulating stale entries", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pendingEvent({ original: "#stale" }));
  assert.equal(nodes.get("healing-pending-list").children.length, 1);

  // A fresh replay (e.g. the dashboard process restarted) carries only what
  // actually happened in the new event history — "#stale" must not survive.
  handlers.replay([]);
  const list = nodes.get("healing-pending-list");
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0], nodes.get("healing-empty"));
});

test("Phase 8: replay reconstructs the pending panel from a pending/approved sequence", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.replay([
    pendingEvent({ original: "#a" }),
    pendingEvent({ original: "#b" }),
    { name: "healingApproved", payload: { original: "#a", suggested: "#x" }, timestamp: Date.now() },
  ]);
  const list = nodes.get("healing-pending-list");
  assert.equal(list.children.length, 1);
  assert.match(list.children[0].innerHTML, /#b/);
});

test("Phase 8: connecting fetches the current pending list and trend from the server", async () => {
  const pending = [{ original: "#server-side", suggested: "#fix", description: "", occurrences: 1, lastSeen: new Date().toISOString() }];
  const trend = [{ original: "#server-side", occurrences: 3, tiers: { LLM: 3 }, lastTier: "LLM", lastResolved: "#fix" }];
  const { handlers, nodes, fetchCalls } = dashboardUI({
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => (url.includes("trend") ? trend : pending),
    }),
  });
  handlers.connect();
  await new Promise(setImmediate);

  const pendingCall = fetchCalls.find((c) => c.url === "/healing/pending");
  const trendCall = fetchCalls.find((c) => c.url === "/healing/trend");
  assert.ok(pendingCall, "expected a GET /healing/pending call on connect");
  assert.ok(trendCall, "expected a GET /healing/trend call on connect");
  assert.equal(nodes.get("healing-pending-list").children.length, 1);
  assert.match(nodes.get("healing-pending-list").children[0].innerHTML, /#server-side/);

  const trendRows = nodes.get("healing-trend-body").children;
  assert.equal(trendRows.length, 1);
  assert.match(trendRows[0].innerHTML, /#server-side/);
  assert.match(trendRows[0].innerHTML, /LLM: 3/);
});

test("Phase 8: a failed /healing/pending fetch on connect never throws and leaves the panel empty", async () => {
  const { handlers, nodes } = dashboardUI({
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.doesNotThrow(() => handlers.connect());
  await new Promise(setImmediate);
  assert.equal(nodes.get("healing-pending-list").children.length, 0);
});

test("Phase 8: approve button POSTs the selector with auth header and disables itself", async () => {
  const { handlers, nodes, fetchCalls } = dashboardUI({ search: "?token=secret-token" });
  handlers.event(pendingEvent({ original: "#old", suggested: "#new" }));

  const button = await clickHealingButton(nodes, { action: "approve", selector: "#old" });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "/healing/approve");
  assert.equal(fetchCalls[0].options.method, "POST");
  assert.equal(fetchCalls[0].options.headers["X-Dashboard-Token"], "secret-token");
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), { original: "#old" });
  assert.equal(button.disabled, true);
});

test("Phase 8: reject button POSTs to /healing/reject with the selector", async () => {
  const { nodes, fetchCalls } = dashboardUI();
  const button = await clickHealingButton(nodes, { action: "reject", selector: "#broken" });
  assert.equal(fetchCalls[0].url, "/healing/reject");
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), { original: "#broken" });
  assert.equal(button.disabled, true);
});

test("Phase 8: without a token, no auth header is sent", async () => {
  const { nodes, fetchCalls } = dashboardUI({ search: "" });
  await clickHealingButton(nodes, { action: "approve", selector: "#old" });
  assert.equal(fetchCalls[0].options.headers["X-Dashboard-Token"], undefined);
});

test("Phase 8: a failed approve/reject request re-enables the button and alerts the user", async () => {
  const { nodes, alerts } = dashboardUI({
    fetchImpl: async () => ({ ok: false, statusText: "Not Found", json: async () => ({ error: "No pending healing entry for that selector." }) }),
  });
  const button = await clickHealingButton(nodes, { action: "approve", selector: "#missing" });
  assert.equal(button.disabled, false);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /Failed to approve/);
  assert.match(alerts[0], /No pending healing entry/);
});

test("Phase 8: a network-level failure (fetch rejects) also re-enables the button and alerts", async () => {
  const { nodes, alerts } = dashboardUI({
    fetchImpl: async () => {
      throw new Error("Failed to fetch");
    },
  });
  const button = await clickHealingButton(nodes, { action: "approve", selector: "#old" });
  assert.equal(button.disabled, false);
  assert.match(alerts[0], /Failed to fetch/);
});

test("Phase 8: clicking inside the panel but not on a button is a no-op", async () => {
  const { nodes, fetchCalls } = dashboardUI();
  const list = nodes.get("healing-pending-list");
  const handler = list._listeners.click[0];
  const nonButtonTarget = { closest: () => null };
  await handler({ target: nonButtonTarget });
  assert.equal(fetchCalls.length, 0);
});

test("Phase 8: an ok:false trend/pending response body that isn't valid JSON does not crash refreshHealing", async () => {
  const { handlers, nodes } = dashboardUI({
    fetchImpl: async () => ({ ok: false, json: async () => { throw new Error("not json"); } }),
  });
  assert.doesNotThrow(() => handlers.connect());
  await new Promise(setImmediate);
  assert.equal(nodes.get("healing-pending-list").children.length, 0);
});

test("Phase 8: an empty trend array hides the trend table instead of rendering an empty one", async () => {
  const { handlers, nodes, fetchCalls } = dashboardUI({
    fetchImpl: async (url) => ({ ok: true, json: async () => [] }),
  });
  handlers.connect();
  await new Promise(setImmediate);
  assert.ok(fetchCalls.some((c) => c.url === "/healing/trend"));
  assert.equal(nodes.get("healing-trend-table").style.display, "none");
});
