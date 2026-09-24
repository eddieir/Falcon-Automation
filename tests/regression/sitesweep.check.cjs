const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, silent } = require("./helpers.cjs");

// SiteSweep is deliberately browser-free at the unit level: everything below
// injects a fake Playwright context. Real-Chromium coverage lives in
// tests/regression/browser.spec.js.

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build a fake BrowserContext plus the collaborator doubles SiteSweep requires.
 *
 * world:
 *   visited        Array of URLs ClickExplorer "discovers" (or visitedPages to
 *                  hand back something that is not a Set)
 *   exploreThrows  ClickExplorer.explore() rejects
 *   unreachable    Set/array of URLs whose goto() rejects
 *   slow           { url: ms } extra time spent in goto()
 *   scenarios      { url: [scenario] } handed back by TestGenerator
 *   issues         { url: value } handed back by ExploratoryAI (any type)
 *   generatorThrows Set/array of URLs whose generateTestScenarios() rejects
 *   TestRunner     override the TestRunner double
 */
function harness(world = {}, opts = {}) {
  const events = [];
  const navigations = [];
  const plans = [];
  const openPages = { count: 0 };

  const unreachable = new Set(world.unreachable || []);
  const generatorThrows = new Set(world.generatorThrows || []);
  const slow = world.slow || {};
  const scenarios = world.scenarios || {};
  const issues = world.issues || {};

  const context = {
    async newPage() {
      let current = null;
      openPages.count++;
      return {
        url: () => current,
        async goto(url, options) {
          navigations.push({ url, options });
          if (slow[url]) await delay(slow[url]);
          if (unreachable.has(url)) throw new Error(`net::ERR_ABORTED at ${url}`);
          current = url;
        },
        async evaluate() {
          return true;
        },
        async fill() {},
        async selectOption() {},
        async close() {
          openPages.count--;
        },
      };
    },
  };

  class FakeClickExplorer {
    constructor(page) {
      this.page = page;
      this.visitedPages = Object.hasOwn(world, "visitedPages")
        ? world.visitedPages
        : new Set(world.visited || []);
    }
    async explore() {
      if (world.exploreThrows) throw new Error("explorer exploded");
    }
  }

  class FakeExploratoryAI {
    constructor(page) {
      this.page = page;
    }
    async detectUIIssues() {
      const value = issues[this.page.url()];
      if (value instanceof Error) throw value;
      return value === undefined ? [] : value;
    }
  }

  class FakeTestGenerator {
    constructor(page) {
      this.page = page;
    }
    async generateTestScenarios() {
      const url = this.page.url();
      if (generatorThrows.has(url)) throw new Error("generator exploded");
      return { url, test_scenarios: (scenarios[url] || []).map((s) => ({ ...s })) };
    }
  }

  class FakeTestRunner {
    constructor(page, testPlan) {
      this.testPlan = testPlan;
    }
    async executeTest() {
      plans.push(this.testPlan);
      return this.testPlan.test_scenarios.map((s) => ({
        name: s.description,
        status: "passed",
        duration: 1,
      }));
    }
  }

  const SiteSweep = load("src/core/SiteSweep.js", {
    "../../utils/Logger": silent,
    "./ClickExplorer": FakeClickExplorer,
    "./ExploratoryAI": FakeExploratoryAI,
    "./TestGenerator": FakeTestGenerator,
    "./TestRunner": world.TestRunner || FakeTestRunner,
  });

  const sweep = new SiteSweep(context, {
    onEvent: (name, payload) => events.push({ name, payload }),
    ...opts,
  });

  return { SiteSweep, sweep, events, navigations, plans, openPages };
}

function click(description, locator, extra = {}) {
  return { action: "click", locator, description, ...extra };
}

function byUrl(result, url) {
  return result.pages.find((p) => p.url === url);
}

// ── normalizeUrl ────────────────────────────────────────────────────────────

test("normalizeUrl: strips the fragment", () => {
  const { SiteSweep } = harness();
  assert.equal(SiteSweep.normalizeUrl("https://a.com/x#section"), "https://a.com/x");
});

test("normalizeUrl: strips a trailing slash below the root and collapses with the unslashed form", () => {
  const { SiteSweep } = harness();
  assert.equal(SiteSweep.normalizeUrl("https://a.com/x/"), "https://a.com/x");
  assert.equal(
    SiteSweep.normalizeUrl("https://a.com/x/"),
    SiteSweep.normalizeUrl("https://a.com/x")
  );
  // Root is already canonical either way.
  assert.equal(SiteSweep.normalizeUrl("https://a.com"), SiteSweep.normalizeUrl("https://a.com/"));
});

test("normalizeUrl: preserves the query string, including through slash stripping", () => {
  const { SiteSweep } = harness();
  assert.equal(SiteSweep.normalizeUrl("https://a.com/x?id=2"), "https://a.com/x?id=2");
  assert.equal(SiteSweep.normalizeUrl("https://a.com/x/?id=2"), "https://a.com/x?id=2");
  assert.notEqual(
    SiteSweep.normalizeUrl("https://a.com/x?id=2"),
    SiteSweep.normalizeUrl("https://a.com/x?id=3")
  );
});

test("normalizeUrl: rejects non-HTTP(S) schemes and junk", () => {
  const { SiteSweep } = harness();
  for (const bad of ["mailto:a@b.com", "tel:+123", "javascript:void(0)", "not a url", "", null, undefined, 42]) {
    assert.equal(SiteSweep.normalizeUrl(bad), null, `expected null for ${String(bad)}`);
  }
});

// ── frontier construction ───────────────────────────────────────────────────

test("frontier: the entry URL is always page 1 even if discovery returns it later", async () => {
  const { sweep } = harness({ visited: ["https://a.com/b", "https://a.com"] });
  const result = await sweep.run("https://a.com");
  assert.equal(result.pages[0].url, "https://a.com/");
  assert.equal(result.coverage.pagesDiscovered, 2);
});

test("frontier: duplicates that differ only by fragment or trailing slash collapse to one page", async () => {
  const { sweep } = harness({
    visited: ["https://a.com/b", "https://a.com/b#top", "https://a.com/b/", "https://a.com/b"],
  });
  const result = await sweep.run("https://a.com");
  assert.deepEqual(result.pages.map((p) => p.url), ["https://a.com/", "https://a.com/b"]);
});

test("frontier: cross-origin URLs are skipped with a reason when sameOriginOnly is on", async () => {
  const { sweep } = harness({ visited: ["https://other.com/x", "https://a.com/b"] });
  const result = await sweep.run("https://a.com");
  const foreign = byUrl(result, "https://other.com/x");
  assert.equal(foreign.status, "skipped");
  assert.equal(foreign.reason, "cross-origin");
  assert.equal(byUrl(result, "https://a.com/b").status, "tested");
  assert.equal(result.coverage.pagesSkipped, 1);
});

test("frontier: sameOriginOnly false lets a cross-origin page be tested", async () => {
  const { sweep } = harness({ visited: ["https://other.com/x"] }, { sameOriginOnly: false });
  const result = await sweep.run("https://a.com");
  assert.equal(byUrl(result, "https://other.com/x").status, "tested");
  assert.equal(result.coverage.pagesTested, 2);
});

test("frontier: mailto/tel/javascript are dropped even with cross-origin allowed", async () => {
  const { sweep } = harness(
    { visited: ["mailto:a@b.com", "tel:+123", "javascript:void(0)"] },
    { sameOriginOnly: false }
  );
  const result = await sweep.run("https://a.com");
  for (const bad of ["mailto:a@b.com", "tel:+123", "javascript:void(0)"]) {
    assert.equal(byUrl(result, bad).status, "skipped");
    assert.equal(byUrl(result, bad).reason, "unsupported-scheme");
  }
  assert.equal(result.coverage.pagesTested, 1);
});

test("frontier: a repeated unparseable URL is reported once, not once per sighting", async () => {
  const { sweep } = harness({ visited: ["mailto:a@b.com", "mailto:a@b.com"] });
  const result = await sweep.run("https://a.com");
  assert.equal(result.pages.filter((p) => p.url === "mailto:a@b.com").length, 1);
});

test("run: a non-HTTP entry URL is rejected outright", async () => {
  const { sweep } = harness();
  await assert.rejects(() => sweep.run("mailto:a@b.com"), /http\(s\) entry URL/);
});

// ── bounds ──────────────────────────────────────────────────────────────────

test("maxPages: the overflow is recorded as skipped/max-pages, never discarded", async () => {
  const { sweep, navigations } = harness(
    { visited: ["https://a.com/b", "https://a.com/c", "https://a.com/d"] },
    { maxPages: 2 }
  );
  const result = await sweep.run("https://a.com");

  assert.equal(result.coverage.pagesDiscovered, 4);
  assert.equal(result.coverage.pagesTested, 2);
  assert.equal(result.coverage.pagesSkipped, 2);
  for (const url of ["https://a.com/c", "https://a.com/d"]) {
    assert.equal(byUrl(result, url).status, "skipped");
    assert.equal(byUrl(result, url).reason, "max-pages");
  }
  // The exploration navigation plus the two tested pages — nothing beyond the cap.
  assert.equal(navigations.filter((n) => n.url === "https://a.com/c").length, 0);
});

test("budget: exhaustion marks the remainder and sets budgetExhausted", async () => {
  const { sweep, navigations } = harness(
    {
      visited: ["https://a.com/b", "https://a.com/c", "https://a.com/d"],
      slow: { "https://a.com/b": 200 },
    },
    { budgetMs: 100 }
  );
  const result = await sweep.run("https://a.com");

  assert.equal(result.coverage.budgetExhausted, true);
  assert.equal(byUrl(result, "https://a.com/").status, "tested");
  assert.equal(byUrl(result, "https://a.com/b").status, "tested");
  for (const url of ["https://a.com/c", "https://a.com/d"]) {
    assert.equal(byUrl(result, url).status, "skipped");
    assert.equal(byUrl(result, url).reason, "budget-exhausted");
  }
  assert.equal(navigations.filter((n) => n.url === "https://a.com/c").length, 0);
});

test("budget: a sweep that finishes inside its budget reports budgetExhausted false", async () => {
  const { sweep } = harness({ visited: ["https://a.com/b"] }, { budgetMs: 600000 });
  const result = await sweep.run("https://a.com");
  assert.equal(result.coverage.budgetExhausted, false);
});

test("pageTimeoutMs is passed through to every goto", async () => {
  const { sweep, navigations } = harness({ visited: ["https://a.com/b"] }, { pageTimeoutMs: 1234 });
  await sweep.run("https://a.com");
  assert.ok(navigations.length >= 2);
  for (const nav of navigations) {
    assert.equal(nav.options.timeout, 1234);
    assert.equal(nav.options.waitUntil, "load");
  }
});

// ── resilience ──────────────────────────────────────────────────────────────

test("an unreachable page is recorded with the error message and the sweep continues", async () => {
  const { sweep } = harness({
    visited: ["https://a.com/dead", "https://a.com/live"],
    unreachable: ["https://a.com/dead"],
  });
  const result = await sweep.run("https://a.com");

  const dead = byUrl(result, "https://a.com/dead");
  assert.equal(dead.status, "unreachable");
  assert.match(dead.reason, /ERR_ABORTED/);
  assert.equal(byUrl(result, "https://a.com/live").status, "tested");
  assert.equal(result.coverage.pagesUnreachable, 1);
  assert.equal(result.coverage.pagesTested, 2);
});

test("a page whose generation throws is reported, not fatal", async () => {
  const { sweep } = harness({
    visited: ["https://a.com/bad", "https://a.com/good"],
    generatorThrows: ["https://a.com/bad"],
  });
  const result = await sweep.run("https://a.com");
  assert.equal(byUrl(result, "https://a.com/bad").status, "unreachable");
  assert.match(byUrl(result, "https://a.com/bad").reason, /generator exploded/);
  assert.equal(byUrl(result, "https://a.com/good").status, "tested");
});

test("a failed exploration still sweeps the entry page", async () => {
  const { sweep } = harness({ exploreThrows: true });
  const result = await sweep.run("https://a.com");
  assert.equal(result.coverage.pagesDiscovered, 1);
  assert.equal(byUrl(result, "https://a.com/").status, "tested");
});

test("a non-Set visitedPages degrades to an entry-only sweep", async () => {
  const { sweep } = harness({ visitedPages: ["https://a.com/b"] });
  const result = await sweep.run("https://a.com");
  assert.deepEqual(result.pages.map((p) => p.url), ["https://a.com/"]);
});

test("non-array uiIssues become [] rather than propagating", async () => {
  const { sweep } = harness({ issues: { "https://a.com/": "not an array" } });
  const result = await sweep.run("https://a.com");
  assert.deepEqual(byUrl(result, "https://a.com/").uiIssues, []);
});

test("a throwing detectUIIssues does not fail the page", async () => {
  const { sweep } = harness({ issues: { "https://a.com/": new Error("dom gone") } });
  const result = await sweep.run("https://a.com");
  const page = byUrl(result, "https://a.com/");
  assert.equal(page.status, "tested");
  assert.deepEqual(page.uiIssues, []);
});

test("uiIssues are carried through per page", async () => {
  const { sweep } = harness({
    visited: ["https://a.com/b"],
    issues: { "https://a.com/b": [{ type: "broken_link" }] },
  });
  const result = await sweep.run("https://a.com");
  assert.deepEqual(byUrl(result, "https://a.com/b").uiIssues, [{ type: "broken_link" }]);
  assert.deepEqual(byUrl(result, "https://a.com/").uiIssues, []);
});

test("every page opened is closed, including unreachable ones", async () => {
  const { sweep, openPages } = harness({
    visited: ["https://a.com/dead", "https://a.com/b"],
    unreachable: ["https://a.com/dead"],
  });
  await sweep.run("https://a.com");
  assert.equal(openPages.count, 0);
});

test("a throwing onEvent listener cannot abort the sweep", async () => {
  const { SiteSweep } = harness();
  const context = {
    async newPage() {
      let current = null;
      return {
        url: () => current,
        async goto(url) { current = url; },
        async close() {},
      };
    },
  };
  const sweep = new SiteSweep(context, {
    onEvent() { throw new Error("dashboard died"); },
  });
  const result = await sweep.run("https://a.com");
  assert.equal(result.coverage.pagesTested, 1);
});

// ── deduplication ───────────────────────────────────────────────────────────

const NAV = [click("Navigate: Home", "#home"), click("Navigate: Docs", "#docs")];

test("dedupe: a shared nav bar runs once and is recorded as deduped everywhere else", async () => {
  const { sweep, plans } = harness({
    visited: ["https://a.com/b", "https://a.com/c"],
    scenarios: {
      "https://a.com/": [...NAV, click("Click Save", "#save")],
      "https://a.com/b": [...NAV, click("Click Delete", "#delete")],
      "https://a.com/c": [...NAV],
    },
  });
  const result = await sweep.run("https://a.com");

  assert.equal(result.coverage.scenariosGenerated, 8);
  assert.equal(result.coverage.scenariosDeduplicated, 4);

  // The nav scenarios were only ever handed to TestRunner once.
  const executedLocators = plans.flatMap((p) => p.test_scenarios.map((s) => s.locator));
  assert.deepEqual(executedLocators, ["#home", "#docs", "#save", "#delete"]);

  const b = byUrl(result, "https://a.com/b");
  assert.equal(b.scenariosGenerated, 3);
  assert.equal(b.scenariosDeduplicated, 2);
  const dedupedRows = b.results.filter((r) => r.status === "deduped");
  assert.deepEqual(dedupedRows, [
    { name: "Navigate: Home", status: "deduped", firstRunOn: "https://a.com/" },
    { name: "Navigate: Docs", status: "deduped", firstRunOn: "https://a.com/" },
  ]);

  const c = byUrl(result, "https://a.com/c");
  assert.equal(c.results.length, 2);
  assert.ok(c.results.every((r) => r.status === "deduped"));
});

test("dedupe: the signature is action + locator + value, so differing values survive", async () => {
  const { sweep, plans } = harness({
    visited: ["https://a.com/b"],
    scenarios: {
      "https://a.com/": [{ action: "type", locator: "#q", value: "alpha", description: "Fill q" }],
      "https://a.com/b": [
        { action: "type", locator: "#q", value: "beta", description: "Fill q" },
        { action: "click", locator: "#q", description: "Click q" },
        { action: "type", locator: "#q", value: "alpha", description: "Fill q again" },
      ],
    },
  });
  const result = await sweep.run("https://a.com");

  // Only the identical action+locator+value triple collapses.
  assert.equal(result.coverage.scenariosDeduplicated, 1);
  const b = byUrl(result, "https://a.com/b");
  assert.deepEqual(
    b.results.filter((r) => r.status === "deduped"),
    [{ name: "Fill q again", status: "deduped", firstRunOn: "https://a.com/" }]
  );
  assert.equal(plans.at(-1).test_scenarios.length, 2);
});

test("dedupe: a missing value and an empty-string value share one signature", () => {
  const { SiteSweep } = harness();
  assert.equal(
    SiteSweep.signatureOf({ action: "click", locator: "#x" }),
    SiteSweep.signatureOf({ action: "click", locator: "#x", value: "" })
  );
});

test("dedupe: false runs every scenario on every page", async () => {
  const { sweep, plans } = harness(
    {
      visited: ["https://a.com/b"],
      scenarios: { "https://a.com/": [...NAV], "https://a.com/b": [...NAV] },
    },
    { dedupe: false }
  );
  const result = await sweep.run("https://a.com");

  assert.equal(result.coverage.scenariosGenerated, 4);
  assert.equal(result.coverage.scenariosDeduplicated, 0);
  assert.equal(plans.flatMap((p) => p.test_scenarios).length, 4);
  assert.equal(result.pages.every((p) => p.results.every((r) => r.status !== "deduped")), true);
});

test("dedupe state does not leak between two sweeps", async () => {
  const world = {
    scenarios: { "https://a.com/": [...NAV] },
  };
  const first = harness(world);
  const second = harness(world);
  const a = await first.sweep.run("https://a.com");
  const b = await second.sweep.run("https://a.com");
  assert.equal(a.coverage.scenariosDeduplicated, 0);
  assert.equal(b.coverage.scenariosDeduplicated, 0);
});

test("deduped scenarios never reach FlakinessTracker", async () => {
  // Uses the real TestRunner with its collaborators stubbed, so this asserts the
  // actual code path that feeds the tracker rather than a stand-in for it.
  const recorded = [];
  const RealTestRunner = load("src/core/TestRunner.js", {
    "../../utils/Logger": silent,
    "./AIHealer/AIHealer": class {
      constructor(page) { this.page = page; }
      async healAndClick() {}
    },
    "./AIHealer/HealingReport": { log() {} },
    "./AIHealer/AdaptiveRetry": { classify: () => "unknown" },
    "./FlakinessTracker": {
      record: (entry) => recorded.push(entry),
      keyFor: () => "key",
      isQuarantined: () => false,
    },
  });

  const { sweep } = harness({
    TestRunner: RealTestRunner,
    visited: ["https://a.com/b"],
    scenarios: { "https://a.com/": [...NAV], "https://a.com/b": [...NAV, click("Click Save", "#save")] },
  });
  const result = await sweep.run("https://a.com");

  assert.equal(result.coverage.scenariosDeduplicated, 2);
  // #home and #docs once each (entry page) plus #save — never a second time.
  assert.deepEqual(recorded.map((r) => r.locator), ["#home", "#docs", "#save"]);
  assert.equal(recorded.every((r) => r.status === "passed"), true);
});

// ── events ──────────────────────────────────────────────────────────────────

test("events: each visited page emits pageStart then pageComplete with an index and total", async () => {
  const { sweep, events } = harness({
    visited: ["https://a.com/b"],
    scenarios: { "https://a.com/": [click("Click Save", "#save")] },
  });
  await sweep.run("https://a.com");

  // sweepComplete closes the stream: pages that were never opened emit no
  // per-page events of their own, so a consumer rebuilding coverage from the
  // event stream alone would under-report what was skipped without it.
  assert.deepEqual(events.map((e) => e.name), [
    "pageStart", "pageComplete", "pageStart", "pageComplete", "sweepComplete",
  ]);
  assert.deepEqual(events[0].payload, { url: "https://a.com/", index: 1, total: 2 });
  assert.deepEqual(events[2].payload, { url: "https://a.com/b", index: 2, total: 2 });

  const summary = events[1].payload.summary;
  assert.equal(summary.url, "https://a.com/");
  assert.equal(summary.status, "tested");
  assert.equal(summary.passed, 1);
  assert.equal(summary.scenariosGenerated, 1);
  assert.equal(typeof summary.durationMs, "number");
});

test("events: an unreachable page still emits a matched start/complete pair", async () => {
  const { sweep, events } = harness({
    visited: ["https://a.com/dead"],
    unreachable: ["https://a.com/dead"],
  });
  await sweep.run("https://a.com");

  const dead = events.filter((e) => e.payload.url === "https://a.com/dead");
  assert.deepEqual(dead.map((e) => e.name), ["pageStart", "pageComplete"]);
  assert.equal(dead[1].payload.summary.status, "unreachable");
});

test("events: skipped pages emit nothing — they were never visited", async () => {
  const { sweep, events } = harness({ visited: ["https://a.com/b"] }, { maxPages: 1 });
  await sweep.run("https://a.com");
  assert.equal(events.filter((e) => e.payload.url === "https://a.com/b").length, 0);
});

// ── result shape ────────────────────────────────────────────────────────────

test("SweepResult carries entryUrl, per-page records and a complete coverage block", async () => {
  const { sweep } = harness({
    visited: ["https://a.com/b", "https://other.com/x", "https://a.com/dead"],
    unreachable: ["https://a.com/dead"],
    scenarios: { "https://a.com/": [click("Click Save", "#save")] },
  });
  const result = await sweep.run("https://a.com/");

  assert.equal(result.entryUrl, "https://a.com/");
  assert.deepEqual(Object.keys(result).sort(), ["coverage", "entryUrl", "pages"]);
  assert.deepEqual(result.coverage, {
    pagesDiscovered: 4,
    pagesTested: 2,
    pagesSkipped: 1,
    pagesUnreachable: 1,
    scenariosGenerated: 1,
    scenariosDeduplicated: 0,
    budgetExhausted: false,
  });

  for (const page of result.pages) {
    assert.deepEqual(Object.keys(page).sort(), [
      "durationMs", "reason", "results", "scenariosDeduplicated",
      "scenariosGenerated", "status", "uiIssues", "url",
    ]);
    assert.ok(Array.isArray(page.results));
    assert.ok(Array.isArray(page.uiIssues));
    assert.equal(typeof page.durationMs, "number");
    if (page.status === "tested") assert.equal(page.reason, undefined);
    else assert.equal(typeof page.reason, "string");
  }
});

test("summarize is pure and recomputable from a persisted pages array", () => {
  const { SiteSweep } = harness();
  const coverage = SiteSweep.summarize([
    { status: "tested", scenariosGenerated: 3, scenariosDeduplicated: 1 },
    { status: "skipped", reason: "max-pages" },
    { status: "unreachable", reason: "boom" },
  ]);
  assert.deepEqual(coverage, {
    pagesDiscovered: 3,
    pagesTested: 1,
    pagesSkipped: 1,
    pagesUnreachable: 1,
    scenariosGenerated: 3,
    scenariosDeduplicated: 1,
    budgetExhausted: false,
  });
  assert.deepEqual(SiteSweep.summarize().pagesDiscovered, 0);
});

test("constructor defaults match the documented contract", () => {
  const { SiteSweep } = harness();
  const sweep = new SiteSweep({});
  assert.equal(sweep.maxPages, 20);
  assert.equal(sweep.sameOriginOnly, true);
  assert.equal(sweep.budgetMs, 600000);
  assert.equal(sweep.pageTimeoutMs, 20000);
  assert.equal(sweep.dedupe, true);
  assert.equal(sweep.onEvent, null);
});

test("constructor ignores non-numeric and non-function options rather than trusting them", () => {
  const { SiteSweep } = harness();
  const sweep = new SiteSweep({}, {
    maxPages: "lots", budgetMs: null, pageTimeoutMs: undefined, onEvent: "nope",
  });
  assert.equal(sweep.maxPages, 20);
  assert.equal(sweep.budgetMs, 600000);
  assert.equal(sweep.pageTimeoutMs, 20000);
  assert.equal(sweep.onEvent, null);
});
