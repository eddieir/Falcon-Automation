const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const Visual = require("../../src/core/VisualRegression");
const { temp } = require("./helpers.cjs");
function fixture(t) {
  const cwd = process.cwd(),
    dir = temp();
  process.chdir(dir);
  t.after(async () => {
    await Visual._writeQueue;
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let width = 8,
    height = 8,
    color = 255;
  const page = {
    screenshot: async ({ path: file }) => {
      const png = new PNG({ width, height });
      for (let i = 0; i < png.data.length; i += 4) {
        png.data[i] = color;
        png.data[i + 1] = color;
        png.data[i + 2] = color;
        png.data[i + 3] = 255;
      }
      fs.writeFileSync(file, PNG.sync.write(png));
    },
  };
  const vr = new Visual(page);
  return {
    vr,
    setColor: (v) => (color = v),
    setSize: (w, h) => {
      width = w;
      height = h;
    },
  };
}
test("visual comparison reports missing baseline", async (t) => {
  const { vr } = fixture(t);
  assert.equal((await vr.compare("missing")).status, "no-baseline");
});
test("snapshot captures first baseline then detects identical image", async (t) => {
  const { vr } = fixture(t);
  assert.equal((await vr.snapshot("page")).status, "baseline-captured");
  const result = await vr.snapshot("page");
  assert.equal(result.status, "passed");
  assert.equal(result.diffPixels, 0);
  assert.ok(fs.existsSync(result.diffPath));
});
test("visual changes fail with an inspectable diff", async (t) => {
  const { vr, setColor } = fixture(t);
  await vr.captureBaseline("page");
  setColor(0);
  const result = await vr.compare("page");
  assert.equal(result.status, "failed");
  assert.equal(result.diffPixels, 64);
  assert.equal(result.diffPercent, 100);
});
test("dimension changes report failure without throwing", async (t) => {
  const { vr, setSize } = fixture(t);
  await vr.captureBaseline("page");
  setSize(10, 10);
  assert.equal((await vr.compare("page")).reason, "dimension-mismatch");
});
test("summary queues retain concurrent comparisons and recover corrupt file", async (t) => {
  const { vr } = fixture(t);
  fs.writeFileSync(vr.summaryPath, "broken");
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => vr.compare(`missing${i}`)),
  );
  await Visual._writeQueue;
  assert.equal(JSON.parse(fs.readFileSync(vr.summaryPath)).length, 10);
});
