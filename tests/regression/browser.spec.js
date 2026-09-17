const { test, expect } = require("@playwright/test");
const PageAnalyser = require("../../src/core/PageAnalyser");
const Generator = require("../../src/core/TestGenerator");
const Runner = require("../../src/core/TestRunner");
const Explorer = require("../../src/core/ClickExplorer");
const Inspector = require("../../src/core/ExploratoryAI");
const Healer = require("../../src/core/AIHealer/AIHealer");
const Store = require("../../src/core/AIHealer/LocatorStore");
const Report = require("../../src/core/AIHealer/HealingReport");
const Logger = require("../../utils/Logger");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
let scratch;
test.beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-browser-"));
  Store.storePath = path.join(scratch, "store.json");
  Store.data = {};
  Report._instance.filePath = path.join(scratch, "healing.json");
});
test.afterAll(async () => {
  await Store._queue;
  await Report._instance._queue;
  await Logger.flush();
  fs.rmSync(scratch, { recursive: true, force: true });
});
const form = `<input data-testid="user" id="lower-priority" name="user"><textarea id="notes"></textarea>
<select name="country"><option value="" disabled>Choose</option><option value="it">Italy</option></select>
<input id="submit" type="submit" value="Save"><button id="save" onclick="window.saved=(window.saved||0)+1">Save</button>
<a id="link" href="#next">Next</a><input id="hidden" style="display:none"><button id="fixed" style="position:fixed;top:0;right:0">Fixed</button>`;
test("analysis detects visible controls and prioritizes stable test identifiers", async ({
  page,
}) => {
  await page.setContent(form);
  const data = await new PageAnalyser(page).analyze();
  expect(
    data.allElements.some((x) => x.selector === '[data-testid="user"]'),
  ).toBeTruthy();
  expect(data.allElements.some((x) => x.selector === "#hidden")).toBeFalsy();
  expect(data.allElements.some((x) => x.selector === "#fixed")).toBeTruthy();
  expect(data.buttons.some((x) => x.selector === "#submit")).toBeTruthy();
  expect(data.inputs.some((x) => x.selector === "#submit")).toBeFalsy();
});
test("generated plan selects actual options and does not fill dropdowns or duplicate links", async ({
  page,
}) => {
  await page.setContent(form);
  const plan = await new Generator(page).generateTestScenarios();
  expect(plan.test_scenarios.filter((x) => x.locator === "#link")).toHaveLength(
    1,
  );
  const dropdown = plan.test_scenarios.filter(
    (x) => x.locator === 'select[name="country"]',
  );
  expect(dropdown).toHaveLength(1);
  expect(dropdown[0]).toMatchObject({ action: "select", value: "it" });
});
test("link actions respect the three-link exploration bound", async ({
  page,
}) => {
  await page.setContent(
    Array.from(
      { length: 8 },
      (_, i) => `<a id="link${i}" href="#${i}">Link ${i}</a>`,
    ).join(""),
  );
  const plan = await new Generator(page).generateTestScenarios();
  expect(plan.test_scenarios).toHaveLength(3);
});
test("generated fill, click, and select actions execute against a real DOM", async ({
  page,
}) => {
  await page.setContent(
    '<input id="user"><textarea id="note"></textarea><select id="choice"><option value="it">Italy</option></select><button id="save" onclick="window.saved=true">Save</button>',
  );
  const runner = new Runner(
    page,
    await new Generator(page).generateTestScenarios(),
  );
  const results = await runner.executeTest();
  expect(results.every((r) => r.status === "passed")).toBeTruthy();
  expect(results).toHaveLength(4);
  await expect(page.locator("#user")).toHaveValue("test_value");
  await expect(page.locator("#choice")).toHaveValue("it");
  expect(await page.evaluate(() => window.saved)).toBe(true);
});
test("selector escaping handles quotes, spaces, and punctuation", async ({
  page,
}) => {
  await page.setContent("<button>Save</button>");
  await page
    .locator("button")
    .evaluate((el) => el.setAttribute("data-testid", 'save "quoted" : value'));
  const data = await new PageAnalyser(page).analyze();
  await expect(page.locator(data.buttons[0].selector)).toHaveCount(1);
});
test("autoheal clicks original element with no recovery event", async ({
  page,
}) => {
  await page.setContent(
    '<button id="save" onclick="window.saved=true">Save</button>',
  );
  const before = Report._instance.logs.length;
  await new Healer(page).healAndClick("#save");
  expect(await page.evaluate(() => window.saved)).toBe(true);
  expect(Report._instance.logs).toHaveLength(before);
});
test("autoheal repairs changed selector through persistent alternatives inside runner", async ({
  page,
}) => {
  await page.setContent(
    '<button id="new" onclick="window.saved=true">Save</button>',
  );
  Store.addLocator("#old", "#new");
  const runner = new Runner(page, {
    test_scenarios: [{ action: "click", locator: "#old", description: "Save" }],
  });
  runner.healer._retry.maxAttempts = 1;
  const results = await runner.executeTest();
  expect(results[0].status).toBe("passed");
  expect(await page.evaluate(() => window.saved)).toBe(true);
  expect(Report._instance.logs.at(-1).resolved).toBe("#new");
});
test("autoheal infers from real DOM through a controlled provider and caches only a working selector", async ({
  page,
}) => {
  await page.setContent(
    '<button data-testid="replacement" onclick="window.saved=true">Save</button>',
  );
  const healer = new Healer(page);
  let requests = 0;
  healer._getOpenAIClient = async () => ({
    chat: {
      completions: {
        create: async (req) => {
          requests++;
          expect(req.messages[0].content).toContain("replacement");
          return {
            choices: [{ message: { content: '[data-testid="replacement"]' } }],
          };
        },
      },
    },
  });
  await healer.healSelector("#renamed", "Save");
  expect(await page.evaluate(() => window.saved)).toBe(true);
  expect(Store.getAlternatives("#renamed")).toContain(
    '[data-testid="replacement"]',
  );
  await healer.healSelector("#renamed", "Save");
  expect(requests).toBe(1);
});
test("unrecoverable selector records failure instead of success or skip", async ({
  page,
}) => {
  await page.setContent("<p>No matching element</p>");
  const runner = new Runner(page, {
    test_scenarios: [
      { action: "click", locator: "#absent", description: "Missing" },
    ],
  });
  runner.healer._retry.maxAttempts = 1;
  runner.healer.getAlternativeSelector = async () => null;
  const result = await runner.executeTest();
  expect(result[0].status).toBe("failed");
});
test("exploratory inspection reports hidden controls, missing href, and unlabeled buttons", async ({
  page,
}) => {
  await page.setContent(
    '<input style="display:none"><a>Broken</a><button></button><button>Good</button>',
  );
  const issues = await new Inspector(page).detectUIIssues();
  expect(issues.map((x) => x.type).sort()).toEqual([
    "broken_link",
    "empty_button",
    "hidden_element",
  ]);
});
test("crawler follows same-origin navigation, tracks pages, and bounds depth", async ({
  page,
}) => {
  await page.route("http://fixture.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: route.request().url().endsWith("/child")
        ? "<p>Child</p>"
        : '<a data-testid="child" href="/child">Child</a>',
    }),
  );
  await page.goto("http://fixture.test/");
  const explorer = new Explorer(page);
  await explorer.explore();
  const log = explorer.getExplorationLog();
  expect(log.visitedPages).toEqual([
    "http://fixture.test/",
    "http://fixture.test/child",
  ]);
  expect(log.exploredElements).toHaveLength(1);
  await explorer.explore();
  expect(log.exploredElements).toHaveLength(1);
});
test("crawler falls back to text when an element has no stable attributes", async ({
  page,
}) => {
  await page.setContent(
    '<button onclick="window.clicked=true">Anonymous</button>',
  );
  const explorer = new Explorer(page);
  await explorer.explore();
  expect(await page.evaluate(() => window.clicked)).toBe(true);
  expect(explorer.getExplorationLog().exploredElements[0].selector).toBeNull();
});
test("crawler respects depth limit without touching the page", async ({
  page,
}) => {
  const explorer = new Explorer(page);
  await explorer.explore(3);
  expect(explorer.visitedPages.size).toBe(0);
});
