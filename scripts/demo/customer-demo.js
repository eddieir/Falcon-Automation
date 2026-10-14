#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const Logger = require(path.join(__dirname, "..", "..", "utils", "Logger"));
const { run } = require("./lib/engine");
const compose = require("./lib/compose");

const REPORTS_ROOT = path.join(__dirname, "..", "..", "reports", "customer-demo");

function parseArgs(argv) {
  const o = { layout: "wide", record: false, reset: false, out: null, all: false, buildOnly: false };
  for (const a of argv) {
    if (a.startsWith("--layout=")) o.layout = a.slice(9);
    else if (a === "--record") o.record = true;
    else if (a === "--no-record") o.record = false;
    else if (a === "--reset") o.reset = true;
    else if (a.startsWith("--out=")) o.out = a.slice(6);
    else if (a === "--all") o.all = true;
    else if (a === "--build-only") o.buildOnly = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

async function runLayout(layout, out) {
  const outDir = path.resolve(out || path.join(REPORTS_ROOT, layout));
  const result = await run({ layout, record: { dir: path.join(outDir, "video") }, outDir });
  Logger.info(`Customer demo (${layout}) PASSED: ${result.assertions} assertions, ${result.phases.length} phases`);
  return result;
}

/** `--all`: fresh wide + portrait recordings, then compose every asset. Exits non-zero on any failure. */
async function runAll() {
  await fs.promises.rm(REPORTS_ROOT, { recursive: true, force: true });
  Logger.info(`Reset ${path.relative(process.cwd(), REPORTS_ROOT) || "."}`);
  await runLayout("wide");
  await runLayout("portrait");
  const built = await compose.build({});
  Logger.info(`Composed assets: ${Object.values(built).map((p) => path.relative(process.cwd(), p)).join(", ")}`);
  return 0;
}

/** `--build-only`: compose from whatever recordings already exist under reports/customer-demo. */
async function buildOnly() {
  const built = await compose.build({});
  Logger.info(`Composed assets: ${Object.values(built).map((p) => path.relative(process.cwd(), p)).join(", ")}`);
  return 0;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.reset) {
    const outDir = path.resolve(o.out || path.join(REPORTS_ROOT, o.layout));
    await fs.promises.rm(outDir, { recursive: true, force: true });
    Logger.info(`Removed ${path.relative(process.cwd(), outDir) || "."}`);
    return 0;
  }
  if (o.all) return runAll();
  if (o.buildOnly) return buildOnly();
  const outDir = path.resolve(o.out || path.join(REPORTS_ROOT, o.layout));
  const result = await run({ layout: o.layout, record: o.record ? { dir: path.join(outDir, "video") } : false, outDir });
  Logger.info(`Customer demo (${o.layout}) PASSED: ${result.assertions} assertions, ${result.phases.length} phases`);
  return 0;
}

main().then((c) => process.exit(c), (e) => {
  Logger.error(`Customer demo FAILED: ${e.message}`);
  process.exit(1);
});
