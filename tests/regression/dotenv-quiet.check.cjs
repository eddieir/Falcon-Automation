"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { root, temp } = require("./helpers.cjs");

// dotenv 17+ prints an "injected env" line on every config() call. The
// config modules load it with quiet: true so CLI output stays unchanged,
// while values are still loaded.

test("modules load .env without dotenv banner output and still apply values", () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, ".env"), "FALCON_DOTENV_PROBE=loaded\n");
  const script = [
    `require(${JSON.stringify(path.join(root, "src/core/ConfigManager.js"))});`,
    `require(${JSON.stringify(path.join(root, "src/core/DBClient.js"))});`,
    `require(${JSON.stringify(path.join(root, "src/core/AIHealer/AIAnalyser.js"))});`,
    "process.stdout.write('probe=' + process.env.FALCON_DOTENV_PROBE);",
  ].join("");
  const env = { ...process.env };
  delete env.FALCON_DOTENV_PROBE;
  const run = spawnSync(process.execPath, ["-e", script], { cwd: dir, env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "probe=loaded");
  assert.equal(run.stderr, "");
});
