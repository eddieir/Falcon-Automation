"use strict";
// The poster template must not turn a URL value into DOM content (CodeQL
// js/xss and js/client-side-unvalidated-url-redirection flagged the previous
// `?img=` handling). The build script embeds the frame as a base64 data URI
// instead, so the page runs no script and reads nothing from the URL.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const MEDIA = path.join(__dirname, "..", "..", "scripts", "demo", "media");
const posterHtml = fs.readFileSync(path.join(MEDIA, "poster.html"), "utf8");
const posterJs = fs.readFileSync(path.join(MEDIA, "poster.js"), "utf8");
const stageHtml = fs.readFileSync(path.join(MEDIA, "stage.html"), "utf8");

// 1x1 transparent PNG
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("poster template runs no script and reads nothing from the URL", () => {
  assert.doesNotMatch(posterHtml, /<script/i, "poster.html must not contain a script");
  assert.doesNotMatch(posterHtml, /location|URLSearchParams|document\.write|innerHTML/, "no URL or HTML-string sinks");
  assert.match(posterHtml, /__FRAME_DATA_URI__/, "the frame placeholder is replaced by the build script");
});

test("build script embeds the frame itself instead of passing it through the query string", () => {
  assert.doesNotMatch(posterJs, /\?img=/, "no image location in the poster URL");
  assert.match(posterJs, /data:image\/png;base64,/, "frame is embedded as a data URI");
  assert.match(posterJs, /setContent\(/, "the page is rendered from content, not navigated with parameters");
});

test("the stage page reads nothing from its URL and builds its DOM from text only", () => {
  assert.doesNotMatch(stageHtml, /location|URLSearchParams|document\.write|innerHTML|insertAdjacentHTML|eval\(/, "no URL or HTML-string sinks in the stage page");
});

test("poster renders at 1200x627 with the embedded image loaded", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 627 } });
  const scriptErrors = [];
  page.on("pageerror", (e) => scriptErrors.push(e.message));
  await page.setContent(posterHtml.replace("__FRAME_DATA_URI__", `data:image/png;base64,${PIXEL}`), { waitUntil: "load" });
  const loaded = await page.evaluate(() => {
    const img = document.getElementById("frame-img");
    return Boolean(img && img.complete && img.naturalWidth > 0);
  });
  assert.equal(loaded, true);
  assert.match(await page.textContent(".headline"), /Self-healing tests\s*with human control/);
  const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  assert.deepEqual(size, [1200, 627]);
  assert.deepEqual(scriptErrors, []);
});
