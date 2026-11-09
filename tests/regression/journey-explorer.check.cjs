const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const JourneyExplorer = require("../../src/core/JourneyExplorer");

// Real Chromium against a route-intercepted fixture origin: no network, no
// third-party sites. Pages are tiny static HTML so states are exact.
const ORIGIN = "https://journeys.invalid";
const PAGES = {
  "/": `<a href="/a">Products</a><a href="/b">Account</a><a href="https://other.invalid/x">External</a>
        <button data-testid="del" onclick="document.title='x'">Delete everything</button>
        <a href="/a" target="_blank">Products tab</a>`,
  "/a": `<a href="/">Home</a><a href="/a/1">Item one</a><a href="/a/2">Item two</a>`,
  "/a/1": `<a href="/a">Back</a><a href="/a/1/more">Details</a>`,
  "/a/1/more": `<a href="/a/1">Up</a><a href="/a/1/deep">Deeper</a>`,
  "/a/1/deep": `<a href="/a/1/more">Up</a>`,
  "/a/2": `<a href="/a">Back</a>`,
  "/b": `<a href="/">Home</a><button id="t" onclick="document.getElementById('p').innerHTML='<a href=&quot;/a&quot;>Panel link</a>'">Toggle panel</button>
         <div id="p"></div>
         <input name="q" onchange="void 0"><button type="submit">Go</button>`,
  // Two controls with the same label and no distinguishing attribute.
  "/amb": `<button>Same</button><button>Same</button><a href="/">Home</a>`,
};

const replay = (page, j) => new JourneyExplorer(page).replay(j, { allowedOrigin: ORIGIN });

let browser;
before(async () => { browser = await chromium.launch(process.env.FALCON_TEST_CHROMIUM ? { executablePath: process.env.FALCON_TEST_CHROMIUM } : {}); });
after(async () => { await browser.close(); });

async function newPage(pages = PAGES) {
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, (r) => {
    const body = pages[new URL(r.request().url()).pathname];
    return body === undefined ? r.fulfill({ status: 404, body: "no" }) : r.fulfill({ contentType: "text/html", body });
  });
  await page.route("https://other.invalid/**", (r) => r.fulfill({ contentType: "text/html", body: "<a href='/'>x</a>" }));
  return page;
}

test("discovers 2-5 step journeys, never past the step cap", async () => {
  const page = await newPage();
  const r = await new JourneyExplorer(page, { maxSteps: 3 }).discover(`${ORIGIN}/`);
  assert.ok(r.journeys.length >= 1);
  for (const j of r.journeys) assert.ok(j.steps.length >= 2 && j.steps.length <= 3, `len ${j.steps.length}`);
  assert.ok(r.journeys.some((j) => j.steps.map((s) => s.label).join(">") === "Products>Item one>Details"));
  const urls = r.journeys.flatMap((j) => j.steps.map((s) => s.href));
  assert.ok(!urls.some((u) => u && u.includes("deep")), "depth-4 state must not appear at maxSteps 3");
  await page.close();
});

test("maxSteps above 5 is clamped to 5", async () => {
  const page = await newPage();
  const r = await new JourneyExplorer(page, { maxSteps: 99 }).discover(`${ORIGIN}/`);
  assert.equal(r.limits.maxSteps, 5);
  for (const j of r.journeys) assert.ok(j.steps.length <= 5);
  await page.close();
});

test("refuses destructive, cross-origin, new-tab, submit and ambiguous actions", async () => {
  const page = await newPage();
  const r = await new JourneyExplorer(page).discover(`${ORIGIN}/`);
  const by = (needle) => r.refusals.filter((x) => x.reason.startsWith(needle)).map((x) => x.label);
  assert.ok(by("destructive").includes("Delete everything"));
  assert.ok(by("cross-origin").includes("External"));
  assert.ok(by("new-tab").includes("Products tab"));
  assert.ok(by("form-submit").includes("Go"));
  await page.close();

  const p2 = await newPage();
  const amb = await new JourneyExplorer(p2).discover(`${ORIGIN}/amb`);
  assert.equal(amb.refusals.filter((x) => x.reason.startsWith("ambiguous") && x.label === "Same").length, 2);
  await p2.close();
});

test("the destructive control is never clicked", async () => {
  const page = await newPage();
  await new JourneyExplorer(page).discover(`${ORIGIN}/`);
  assert.notEqual(await page.title(), "x");
  await page.close();
});

test("state equivalence: a toggled-back panel and a revisited page are one state", async () => {
  const page = await newPage();
  const r = await new JourneyExplorer(page, { maxSteps: 3 }).discover(`${ORIGIN}/`);
  assert.ok(r.coverage.equivalentTransitions > 0, "Home links back to an already-known state");
  const ids = r.journeys.map((j) => j.id);
  assert.equal(new Set(ids).size, ids.length);
  await page.close();
});

test("action budget is enforced and reported as incomplete coverage", async () => {
  const page = await newPage();
  const r = await new JourneyExplorer(page, { maxActions: 4 }).discover(`${ORIGIN}/`);
  assert.ok(r.coverage.actionsUsed <= 4);
  assert.equal(r.coverage.budgetExhausted, true);
  assert.ok(r.coverage.unexploredActions > 0);
  await page.close();
});

test("state budget is enforced", async () => {
  const page = await newPage();
  const r = await new JourneyExplorer(page, { maxStates: 2 }).discover(`${ORIGIN}/`);
  assert.ok(r.coverage.states <= 2);
  assert.equal(r.coverage.budgetExhausted, true);
  await page.close();
});

test("two runs on a fresh page produce an identical digest", async () => {
  const run = async () => {
    const page = await newPage();
    const r = await new JourneyExplorer(page, { maxSteps: 3 }).discover(`${ORIGIN}/`);
    await page.close();
    return r;
  };
  const [a, b] = [await run(), await run()];
  assert.equal(a.digest, b.digest);
  assert.deepEqual(a.journeys, b.journeys);
});

test("replay passes on the same app and reports the step where it diverges", async () => {
  const page = await newPage();
  const r = await new JourneyExplorer(page, { maxSteps: 3 }).discover(`${ORIGIN}/`);
  const journey = r.journeys.find((j) => j.steps[0].label === "Products");
  assert.deepEqual(await replay(page, journey), { ok: true });
  await page.close();

  const changed = { ...PAGES, "/a": `<a href="/">Home</a><a href="/a/1">Item one</a><a href="/a/2">Item two</a><a href="/a/3">Item three</a>` };
  const p2 = await newPage(changed);
  const res = await replay(p2, journey);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "state-mismatch");
  assert.equal(typeof res.divergedAt, "number");
  await p2.close();
});

test("replay refuses a tampered journey containing a destructive step", async () => {
  const page = await newPage();
  const res = await replay(page, {
    entry: `${ORIGIN}/`,
    steps: [{ label: "Delete everything", selector: '[data-testid="del"]', text: "Delete everything", href: null, expect: null }],
  });
  assert.equal(res.ok, false);
  assert.match(res.reason, /^refused/);
  assert.notEqual(await page.title(), "x");
  await page.close();
});

test("reports a missing element as step failure, not a pass", async () => {
  const page = await newPage();
  const res = await replay(page, {
    entry: `${ORIGIN}/`,
    steps: [{ label: "Gone", selector: "#gone", text: "Gone", href: null, expect: "x" }],
  });
  assert.deepEqual([res.ok, res.divergedAt, res.reason], [false, 0, "step-failed"]);
  await page.close();
});

test("persisted report holds no query values, form values or cookie values", async () => {
  const pages = { "/": `<a href="/s?token=SECRET123&x=1">Search</a><input name="q" value="TOPSECRET">` , "/s": `<a href="/">Home</a>` };
  const page = await newPage(pages);
  await page.context().addCookies([{ name: "sid", value: "COOKIESECRET", url: ORIGIN }]);
  const r = await new JourneyExplorer(page).discover(`${ORIGIN}/`);
  const text = JSON.stringify(r);
  for (const s of ["SECRET123", "TOPSECRET", "COOKIESECRET"]) assert.ok(!text.includes(s), s);
  await page.close();
});

test("rejects a non-http entry URL", async () => {
  const page = await newPage();
  await assert.rejects(new JourneyExplorer(page).discover("javascript:alert(1)"), /http/);
  await page.close();
});

test("budgetExhausted stays true when a later replay fails for a non-budget reason", async () => {
  // "/" links to A for its first five requests, then drops it, so a replay
  // of A's path fails after the state budget has already been hit.
  let hits = 0;
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, (r) => {
    const p = new URL(r.request().url()).pathname;
    let body = "no";
    if (p === "/") body = `${++hits <= 5 ? '<a href="/a">A</a>' : ""}<a href="/b">B</a><a href="/c">C</a>`;
    else if (p === "/a") body = '<a href="/x">X</a><a href="/y">Y</a>';
    else if (["/b", "/c", "/x", "/y"].includes(p)) body = `<p>${p}</p>`;
    return r.fulfill({ contentType: "text/html", body });
  });
  const r = await new JourneyExplorer(page, { maxStates: 3 }).discover(`${ORIGIN}/`);
  assert.equal(r.coverage.budgetExhausted, true);
  await page.close();
});

test("plain form-submit buttons are refused and no request is sent", async () => {
  let posts = 0;
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, (r) => {
    const req = r.request();
    if (req.method() === "POST") posts++;
    const body = new URL(req.url()).pathname === "/" ? '<form action="/submitted" method="post"><button>Save</button></form><a href="/">Home</a>' : "ok";
    return r.fulfill({ contentType: "text/html", body });
  });
  const r = await new JourneyExplorer(page).discover(`${ORIGIN}/`);
  assert.equal(posts, 0);
  assert.ok(r.refusals.some((x) => x.label === "Save" && x.reason.startsWith("form-submit")));
  await page.close();
});

test("replay cannot click a control whose text was swapped in the journey file", async () => {
  const page = await newPage();
  const res = await replay(page, { entry: `${ORIGIN}/`, steps: [{ label: "Products", selector: null, text: "Delete everything", href: null, expect: null }] });
  assert.equal(res.ok, false);
  assert.notEqual(await page.title(), "x");
  await page.close();
});

test("replay refuses a tampered entry: wrong origin, file: URL, missing allowedOrigin", async () => {
  const page = await newPage();
  const step = [{ label: "Products", selector: null, text: "Products", href: null, expect: null }];
  for (const entry of ["https://other.invalid/", "file:///etc/passwd", "not a url"]) {
    assert.equal((await replay(page, { entry, steps: step })).reason, "entry-origin", entry);
  }
  assert.equal((await new JourneyExplorer(page).replay({ entry: `${ORIGIN}/`, steps: step })).reason, "entry-origin");
  await page.close();
});

test("a link with no text keeps its query values out of the report", async () => {
  const page = await newPage({ "/": '<a href="/x?token=SEKRET1"></a><a href="/">Home</a>', "/x": "ok" });
  const r = await new JourneyExplorer(page).discover(`${ORIGIN}/`);
  assert.ok(!JSON.stringify(r).includes("SEKRET1"));
  assert.ok(r.refusals.some((x) => x.label.endsWith("/x?token")));
  await page.close();
});

test("destructive filter reads aria-label, id and camelCase hrefs", async () => {
  const page = await newPage({ "/": '<button id="icon1" aria-label="Delete account"></button><button id="btnDelete" title="x">X</button><a href="/deleteAccount">Go</a><a href="/">Home</a>', "/deleteAccount": "ok" });
  const r = await new JourneyExplorer(page).discover(`${ORIGIN}/`);
  const refused = r.refusals.filter((x) => x.reason.startsWith("destructive")).length;
  assert.equal(refused, 3);
  await page.close();
});

test("an entry that redirects off-origin is rejected", async () => {
  const page = await newPage();
  page.url = () => "https://other.invalid/landed"; // what the page reports after an off-origin redirect
  await assert.rejects(new JourneyExplorer(page).discover(`${ORIGIN}/`), /redirected/);
  await page.close();
});
