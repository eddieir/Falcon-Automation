const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { root, temp } = require("./helpers.cjs");
for (const [mode, expected] of [
  ["success", 0],
  ["query", 0],
  ["scenario-failure", 1],
  ["navigation-failure", 1],
  ["launch-failure", 1],
  ["empty", 1],
]) {
  test(`CLI ${mode} has honest exit status and report`, (t) => {
    const dir = temp();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const child = spawnSync(
      process.execPath,
      [
        "--require",
        path.join(root, "tests/fixtures/cli-preload.cjs"),
        path.join(root, "falcon.js"),
        "--no-dashboard",
        "--url=http://fixture.test/?key=value=tail",
      ],
      {
        cwd: dir,
        env: { ...process.env, FALCON_FIXTURE_MODE: mode },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, expected, child.stdout + child.stderr);
    const report = JSON.parse(
      fs.readFileSync(path.join(dir, "reports/test-report.json")),
    );
    assert.equal(report.result === "PASSED", expected === 0);
  });
}
