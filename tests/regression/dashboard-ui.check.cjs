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

/** Simulates clicking a data-action button inside #flaky-list. */
function clickFlakyButton(nodes, { action, key }) {
  const list = nodes.get("flaky-list");
  const handler = list._listeners.click[0];
  const button = {
    dataset: { action, key },
    disabled: false,
    closest: (sel) => (sel === "button[data-action]" ? button : null),
  };
  return handler({ target: button }).then(() => button);
}

function flakyScenario(overrides = {}) {
  return {
    key: "https://x.com::click::#flaky",
    url: "https://x.com",
    action: "click",
    locator: "#flaky",
    description: "Flaky button",
    classification: "flaky",
    flakeRate: 0.5,
    sampleSize: 4,
    quarantined: false,
    history: [
      { status: "passed" }, { status: "failed" }, { status: "passed" }, { status: "failed" },
    ],
    ...overrides,
  };
}
function flakyDetectedEvent(overrides = {}) {
  return { name: "flakyDetected", payload: flakyScenario(overrides), timestamp: Date.now() };
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

// ── Phase 9: flaky tests panel ──

test("Phase 9: a flakyDetected event renders the scenario into the flaky panel", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(flakyDetectedEvent());
  const list = nodes.get("flaky-list");
  assert.equal(list.children.length, 1);
  assert.match(list.children[0].innerHTML, /Flaky button/);
  assert.match(list.children[0].innerHTML, /50% fail rate/);
});

test("Phase 9: a 'new' or 'stable' classified scenario is not shown in the panel", async () => {
  const stable = [{ key: "https://x.com::click::#stable", url: "https://x.com", action: "click", locator: "#stable", description: "Stable", classification: "stable", flakeRate: 0, sampleSize: 5, quarantined: false, history: [] }];
  const { handlers, nodes } = dashboardUI({
    fetchImpl: async (url) => (url.includes("trend") ? { ok: true, json: async () => [] } : { ok: true, json: async () => stable }),
  });
  handlers.connect();
  await new Promise(setImmediate);
  assert.equal(nodes.get("flaky-list").children.length, 1); // just the empty placeholder
  assert.equal(nodes.get("flaky-list").children[0], nodes.get("flaky-empty"));
});

test("Phase 9: a 'broken' scenario is shown with a distinct classification but no misleading fail rate label", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(flakyDetectedEvent({ classification: "broken", flakeRate: 1, key: "https://x.com::click::#broken", locator: "#broken", description: "Broken button" }));
  const list = nodes.get("flaky-list");
  assert.equal(list.children.length, 1);
  assert.match(list.children[0].innerHTML, /always fails/);
  assert.doesNotMatch(list.children[0].innerHTML, /100% fail rate/);
});

test("Phase 9: quarantining removes a scenario from the actionable list only if it's also no longer flaky/broken", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(flakyDetectedEvent());
  handlers.event({ name: "scenarioQuarantined", payload: flakyScenario({ quarantined: true, quarantinedBy: "dashboard" }), timestamp: Date.now() });
  // Still flaky AND quarantined — stays visible (with an Unquarantine control) rather than vanishing.
  const list = nodes.get("flaky-list");
  assert.equal(list.children.length, 1);
  assert.match(list.children[0].innerHTML, /quarantined/);
  assert.match(list.children[0].innerHTML, /Unquarantine/);
});

test("Phase 9: unquarantining a scenario whose classification has since recovered to stable removes it from the panel", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(flakyDetectedEvent({ quarantined: true }));
  handlers.event({ name: "scenarioUnquarantined", payload: flakyScenario({ classification: "stable", flakeRate: 0, quarantined: false }), timestamp: Date.now() });
  const list = nodes.get("flaky-list");
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0], nodes.get("flaky-empty"));
});

test("Phase 9: scenario fields are HTML-escaped in the flaky panel, not injected raw", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(flakyDetectedEvent({
    description: '<img src=x onerror=alert(1)>',
    locator: '<script>alert(2)</script>',
    url: '"><b>bold</b>',
  }));
  const html = nodes.get("flaky-list").children[0].innerHTML;
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<b>"));
  assert.match(html, /&lt;img/);
});

test("Phase 9: quarantine button POSTs the scenario key, with auth header, and disables itself", async () => {
  const { handlers, nodes, fetchCalls } = dashboardUI({ search: "?token=secret-token" });
  handlers.event(flakyDetectedEvent());

  const button = await clickFlakyButton(nodes, { action: "quarantine", key: "https://x.com::click::#flaky" });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "/flakiness/quarantine");
  assert.equal(fetchCalls[0].options.method, "POST");
  assert.equal(fetchCalls[0].options.headers["X-Dashboard-Token"], "secret-token");
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), { key: "https://x.com::click::#flaky" });
  assert.equal(button.disabled, true);
});

test("a scenario that has never passed gets no Quarantine button, only the reason it can't have one", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(flakyDetectedEvent({
    classification: "broken",
    flakeRate: 1,
    sampleSize: 3,
    history: [{ status: "failed" }, { status: "failed" }, { status: "failed" }],
  }));
  const row = nodes.get("flaky-list").children[0].innerHTML;
  assert.doesNotMatch(row, /data-action="quarantine"/);
  assert.match(row, /Not quarantinable/);
});

test("a broken scenario that has passed at least once keeps its Quarantine button", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(flakyDetectedEvent({
    classification: "broken",
    history: [{ status: "passed" }, { status: "failed" }, { status: "failed" }],
  }));
  assert.match(nodes.get("flaky-list").children[0].innerHTML, /data-action="quarantine"/);
});

test("an already-quarantined scenario keeps its Unquarantine button even with no pass in history", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(flakyDetectedEvent({
    classification: "broken",
    quarantined: true,
    history: [{ status: "failed" }, { status: "failed" }],
  }));
  assert.match(nodes.get("flaky-list").children[0].innerHTML, /data-action="unquarantine"/);
});

test("Phase 9: unquarantine button POSTs to /flakiness/unquarantine", async () => {
  const { handlers, nodes, fetchCalls } = dashboardUI();
  handlers.event(flakyDetectedEvent({ quarantined: true }));
  await clickFlakyButton(nodes, { action: "unquarantine", key: "https://x.com::click::#flaky" });
  assert.equal(fetchCalls[0].url, "/flakiness/unquarantine");
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), { key: "https://x.com::click::#flaky" });
});

test("Phase 9: a failed quarantine request re-enables the button and alerts the user", async () => {
  const { handlers, nodes, alerts } = dashboardUI({
    fetchImpl: async () => ({ ok: false, statusText: "Not Found", json: async () => ({ error: "No tracked scenario for that key." }) }),
  });
  handlers.event(flakyDetectedEvent());
  const button = await clickFlakyButton(nodes, { action: "quarantine", key: "https://x.com::click::#flaky" });
  assert.equal(button.disabled, false);
  assert.match(alerts[0], /Failed to quarantine/);
  assert.match(alerts[0], /No tracked scenario/);
});

test("Phase 9: connecting fetches the current flaky scenario list from the server", async () => {
  const scenarios = [flakyScenario()];
  const { handlers, nodes, fetchCalls } = dashboardUI({
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => (url.includes("/flakiness/scenarios") ? scenarios : []),
    }),
  });
  handlers.connect();
  await new Promise(setImmediate);
  assert.ok(fetchCalls.some((c) => c.url === "/flakiness/scenarios"));
  const list = nodes.get("flaky-list");
  assert.equal(list.children.length, 1);
  assert.match(list.children[0].innerHTML, /Flaky button/);
});

test("Phase 9: a failed /flakiness/scenarios fetch on connect never throws and leaves the panel empty", async () => {
  const { handlers, nodes } = dashboardUI({
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.doesNotThrow(() => handlers.connect());
  await new Promise(setImmediate);
  const list = nodes.get("flaky-list");
  assert.equal(list.children.length, 0); // renderFlaky() was never called — nothing to show or hide yet
});

test("Phase 9: replay resets the flaky panel instead of accumulating stale entries", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(flakyDetectedEvent());
  assert.equal(nodes.get("flaky-list").children.length, 1);
  handlers.replay([]);
  const list = nodes.get("flaky-list");
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0], nodes.get("flaky-empty"));
});

// ── Phase 10: coverage panel ──

function pageStartEvent(overrides = {}) {
  return { name: "pageStart", payload: { url: "https://x.com/", index: 1, total: 4, ...overrides }, timestamp: Date.now() };
}

function pageCompleteEvent(url = "https://x.com/", summary = {}) {
  return {
    name: "pageComplete",
    payload: {
      url,
      summary: { status: "tested", scenariosGenerated: 6, scenariosDeduplicated: 2, durationMs: 1200, passed: 4, failed: 1, ...summary },
    },
    timestamp: Date.now(),
  };
}

test("Phase 10: a replay with no sweep events leaves the coverage panel empty, not half-rendered", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.replay([]);
  const list = nodes.get("coverage-list");
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0], nodes.get("coverage-empty"));
  assert.equal(nodes.get("coverage-uncovered-header").style.display, "none");
  assert.equal(nodes.get("coverage-summary").textContent, "");
});

test("Phase 10: pageStart then pageComplete renders one page row with its pass/fail counts", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pageStartEvent({ url: "https://x.com/login" }));
  handlers.event(pageCompleteEvent("https://x.com/login"));
  const list = nodes.get("coverage-list");
  assert.equal(list.children.length, 1); // updated in place, not duplicated
  assert.match(list.children[0].innerHTML, /https:\/\/x\.com\/login/);
  assert.match(list.children[0].innerHTML, /4 passed/);
  assert.match(list.children[0].innerHTML, /1 failed/);
  assert.match(list.children[0].innerHTML, /1200ms/);
});

test("Phase 10: the summary line reports pages tested against pages discovered", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pageStartEvent({ url: "https://x.com/", index: 1, total: 11 }));
  handlers.event(pageCompleteEvent("https://x.com/"));
  handlers.event(pageStartEvent({ url: "https://x.com/two", index: 2, total: 11 }));
  const summary = nodes.get("coverage-summary").textContent;
  assert.match(summary, /1 of 11 discovered page\(s\) tested/);
  assert.match(summary, /1 in progress/);
  assert.match(summary, /6 scenario\(s\) generated/);
  assert.match(summary, /2 deduped/);
});

test("Phase 10: a page in progress is shown as testing until its pageComplete arrives", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pageStartEvent({ url: "https://x.com/slow" }));
  const row = nodes.get("coverage-list").children[0];
  assert.match(row.className, /status-testing/);
  assert.match(row.innerHTML, /testing/);
});

test("Phase 10: skipped and unreachable pages get their own section with an explicit reason", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pageStartEvent({ url: "https://x.com/" }));
  handlers.event(pageCompleteEvent("https://x.com/"));
  handlers.event(pageCompleteEvent("https://x.com/dead", { status: "unreachable", reason: "net::ERR_ABORTED" }));
  handlers.event({
    name: "sweepComplete",
    payload: {
      entryUrl: "https://x.com/",
      pages: [
        { url: "https://x.com/deep", status: "skipped", reason: "max-pages" },
        { url: "https://x.com/later", status: "skipped", reason: "budget-exhausted" },
      ],
      coverage: { pagesDiscovered: 9, budgetExhausted: true },
    },
    timestamp: Date.now(),
  });

  // The tested page stays in the covered list; the three uncovered ones are
  // listed separately so "what we didn't cover" can't be mistaken for coverage.
  assert.deepEqual(nodes.get("coverage-list").children.length, 1);
  const uncovered = nodes.get("coverage-uncovered-list").children;
  assert.equal(uncovered.length, 3);
  assert.equal(nodes.get("coverage-uncovered-header").style.display, "block");
  const html = uncovered.map((row) => row.innerHTML).join("");
  assert.match(html, /excluded by the --max-pages limit/);
  assert.match(html, /time budget ran out/);
  assert.match(html, /net::ERR_ABORTED/);
  assert.match(nodes.get("coverage-summary").textContent, /2 skipped/);
  assert.match(nodes.get("coverage-summary").textContent, /1 unreachable/);
  assert.match(nodes.get("coverage-summary").textContent, /1 of 9 discovered page\(s\) tested/);
});

test("Phase 10: page URLs and skip reasons are HTML-escaped, not injected raw", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pageCompleteEvent('https://x.com/?q=<img src=x onerror=alert(1)>', {
    status: "skipped",
    reason: '"><b>bold</b><script>alert(2)</script>',
  }));
  const html = nodes.get("coverage-uncovered-list").children[0].innerHTML;
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<b>"));
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;b&gt;bold/);
});

test("Phase 10: a new sweep starting at index 1 clears the previous run's pages", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pageStartEvent({ url: "https://old.com/", index: 1, total: 1 }));
  handlers.event(pageCompleteEvent("https://old.com/"));
  handlers.event(pageStartEvent({ url: "https://new.com/", index: 1, total: 2 }));
  const urls = nodes.get("coverage-list").children.map((row) => row.innerHTML).join("");
  assert.ok(!urls.includes("old.com"));
  assert.match(urls, /new\.com/);
});

test("Phase 10: connecting fetches the current sweep from /coverage and renders it", async () => {
  const snapshot = {
    entryUrl: "https://x.com/",
    currentUrl: null,
    pages: [
      { url: "https://x.com/", status: "tested", passed: 3, failed: 0, scenariosGenerated: 3, durationMs: 900 },
      { url: "https://x.com/gone", status: "unreachable", reason: "Timeout 20000ms exceeded" },
    ],
    coverage: { pagesDiscovered: 7, pagesTested: 1, pagesSkipped: 0, pagesUnreachable: 1, budgetExhausted: false },
  };
  const { handlers, nodes, fetchCalls } = dashboardUI({
    fetchImpl: async (url) => ({ ok: true, json: async () => (url === "/coverage" ? snapshot : []) }),
  });
  handlers.connect();
  await new Promise(setImmediate);

  assert.ok(fetchCalls.some((c) => c.url === "/coverage"), "expected a GET /coverage call on connect");
  assert.equal(nodes.get("coverage-list").children.length, 1);
  assert.match(nodes.get("coverage-list").children[0].innerHTML, /3 passed/);
  assert.equal(nodes.get("coverage-uncovered-list").children.length, 1);
  assert.match(nodes.get("coverage-uncovered-list").children[0].innerHTML, /Timeout 20000ms exceeded/);
  assert.match(nodes.get("coverage-summary").textContent, /1 of 7 discovered page\(s\) tested/);
});

test("Phase 10: /coverage is fetched with the auth header when a token is present", async () => {
  const { handlers, fetchCalls } = dashboardUI({ search: "?token=secret-token" });
  handlers.connect();
  await new Promise(setImmediate);
  const call = fetchCalls.find((c) => c.url === "/coverage");
  assert.ok(call);
  assert.equal(call.options.headers["X-Dashboard-Token"], "secret-token");
});

test("Phase 10: a failed /coverage fetch on connect never throws, and live events still render afterwards", async () => {
  const { handlers, nodes } = dashboardUI({
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.doesNotThrow(() => handlers.connect());
  await new Promise(setImmediate);
  // Nothing was rendered — the snapshot never arrived — but the socket stream
  // still populates the panel, which is the path that matters during a run.
  handlers.event(pageCompleteEvent("https://x.com/after"));
  assert.equal(nodes.get("coverage-list").children.length, 1);
  assert.match(nodes.get("coverage-list").children[0].innerHTML, /x\.com\/after/);
});

test("Phase 10: replay reconstructs the coverage panel from the sweep events alone", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pageStartEvent({ url: "https://stale.com/" }));
  assert.equal(nodes.get("coverage-list").children.length, 1);

  handlers.replay([
    pageStartEvent({ url: "https://x.com/", index: 1, total: 2 }),
    pageCompleteEvent("https://x.com/"),
    pageStartEvent({ url: "https://x.com/two", index: 2, total: 2 }),
    pageCompleteEvent("https://x.com/two", { status: "skipped", reason: "max-pages" }),
  ]);
  const covered = nodes.get("coverage-list").children.map((row) => row.innerHTML).join("");
  assert.ok(!covered.includes("stale.com"));
  assert.equal(nodes.get("coverage-uncovered-list").children.length, 1);
});

test("Phase 10: the coverage panel survives minimal and malformed sweep payloads", () => {
  const { handlers } = dashboardUI();
  assert.doesNotThrow(() => {
    handlers.event({ name: "pageStart", payload: {}, timestamp: Date.now() });
    handlers.event({ name: "pageComplete", payload: {}, timestamp: Date.now() });
    handlers.event({ name: "pageComplete", payload: { url: "https://x.com/", summary: { results: "not an array" } }, timestamp: Date.now() });
    handlers.event({ name: "sweepComplete", payload: {}, timestamp: Date.now() });
    handlers.event({ name: "sweepComplete", payload: { pages: [null, { status: "skipped" }], coverage: "nope" }, timestamp: Date.now() });
  });
});

test("Phase 10: per-page counts fall back to tallying raw results when the summary has no explicit totals", () => {
  const { handlers, nodes } = dashboardUI();
  handlers.event(pageCompleteEvent("https://x.com/tally", {
    passed: undefined,
    failed: undefined,
    results: [{ status: "passed" }, { status: "failed" }, { status: "failed" }, { status: "deduped" }, { status: "quarantined" }],
  }));
  const html = nodes.get("coverage-list").children[0].innerHTML;
  assert.match(html, /1 passed/);
  assert.match(html, /2 failed/);
  assert.match(html, /1 deduped/);
  assert.match(html, /1 quarantined/);
});

test("Phase 10: sweep events also appear in the event feed so the run stays narratable", () => {
  const { handlers, rows } = dashboardUI();
  handlers.event(pageStartEvent({ url: "https://x.com/", index: 2, total: 5 }));
  assert.match(rows[0].innerHTML, /Page 2\/5/);
  handlers.event(pageCompleteEvent("https://x.com/gone", { status: "unreachable", reason: "boom" }));
  assert.match(rows[0].innerHTML, /Unreachable/);
});

test("Phase 9: dashboard handles flaky/quarantine events without crashing, even with minimal payloads", () => {
  const { handlers } = dashboardUI();
  assert.doesNotThrow(() => {
    handlers.event({ name: "flakyDetected", payload: { key: "k", classification: "flaky", flakeRate: 0.5, sampleSize: 3, history: [] }, timestamp: Date.now() });
    handlers.event({ name: "scenarioQuarantined", payload: { key: "k", classification: "flaky", flakeRate: 0.5, sampleSize: 3, quarantined: true, history: [] }, timestamp: Date.now() });
    handlers.event({ name: "scenarioUnquarantined", payload: { key: "k", classification: "flaky", flakeRate: 0.5, sampleSize: 3, quarantined: false, history: [] }, timestamp: Date.now() });
  });
});
