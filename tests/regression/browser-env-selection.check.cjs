const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { root } = require("./helpers.cjs");

const BrowserManager = require(path.join(root, "src/core/BrowserManager"));

function browserTypeWith(env) {
  const previous = process.env.BROWSER;
  if (env === undefined) delete process.env.BROWSER;
  else process.env.BROWSER = env;
  try {
    return new BrowserManager().browserType;
  } finally {
    if (previous === undefined) delete process.env.BROWSER;
    else process.env.BROWSER = previous;
  }
}

test("BROWSER selects the engine, as .env.example documents", () => {
  assert.equal(browserTypeWith("firefox"), "firefox");
  assert.equal(browserTypeWith("webkit"), "webkit");
});

test("without BROWSER the testConfig.json default is used", () => {
  assert.equal(browserTypeWith(undefined), "chromium");
});

test("an unsupported BROWSER value still fails at launch", async () => {
  const previous = process.env.BROWSER;
  process.env.BROWSER = "netscape";
  try {
    await assert.rejects(new BrowserManager().launch(), /Unsupported browser: netscape/);
  } finally {
    if (previous === undefined) delete process.env.BROWSER;
    else process.env.BROWSER = previous;
  }
});
