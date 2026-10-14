#!/usr/bin/env node
"use strict";
/**
 * Functional gate for the News journey.
 *
 *   AGENCY_SOURCE=<clone or URL> node scripts/demo/gate-run.js <hook-rename|structural> <workDir>
 *
 * hook-rename : exit 0 only if every positive-gate step passes.
 * structural  : exit 0 only if Falcon refuses with insufficient_identity_evidence
 *               (the expected safe outcome of the negative test).
 * Writes <workDir>/gate-result.json (versioned, sanitized, written atomically).
 * SIGINT and SIGTERM stop AI-agency, Falcon, the dashboard and their browsers.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const E = require("./lib/env");
const gate = require("./lib/gate");
const R = require("./lib/result");

const EXPECTED = {
  "hook-rename": "recovered, approved through the dashboard and reused by a fresh process",
  structural: "Falcon refuses with insufficient_identity_evidence before scoring or acting",
};

function parseArgs(argv) {
  const [mode, workArg] = argv;
  if (!mode || !workArg || !Object.hasOwn(gate.MODES, mode)) return null;
  const workDir = path.resolve(workArg);
  const inside = (dir, parent) => dir === parent || dir.startsWith(parent + path.sep);
  if (workDir === path.parse(workDir).root || workDir === os.homedir() || inside(E.REPO_ROOT, workDir) || inside(workDir, E.REPO_ROOT)) return { error: "refusing to use that working directory" };
  return { mode, workDir };
}

/** Stop everything on SIGINT/SIGTERM and on exit. Returns a function that removes the handlers. */
function installCleanup() {
  let stopping = false;
  const onSignal = (signal, code) => async () => {
    if (stopping) return;
    stopping = true;
    await E.stopAll();
    process.exit(code);
  };
  const handlers = [["SIGINT", onSignal("SIGINT", 130)], ["SIGTERM", onSignal("SIGTERM", 143)]];
  for (const [signal, fn] of handlers) process.on(signal, fn);
  process.on("exit", E.killAllNow);
  return () => {
    for (const [signal, fn] of handlers) process.off(signal, fn);
    process.off("exit", E.killAllNow);
  };
}

async function main({ argv = process.argv.slice(2), env = process.env, runScenario = gate.runScenario, out = process.stdout, err = process.stderr } = {}) {
  const args = parseArgs(argv);
  if (!args || args.error) {
    err.write(`${args ? args.error + "\n" : ""}usage: AGENCY_SOURCE=<clone|url> node scripts/demo/gate-run.js <hook-rename|structural> <workDir>\n`);
    return 2;
  }
  const { mode, workDir } = args;
  const agencySource = env.AGENCY_SOURCE || E.AGENCY_REPO;

  let result;
  let error = null;
  try {
    result = await runScenario({ mode, workDir, agencySource });
  } catch (e) {
    error = e;
    result = { mode, ...(e.out || {}), ok: false, failedStep: e.message, log: e.log ? e.log.lines : [] };
  }
  const gatePassed = !!result.ok;
  if (!fs.existsSync(path.join(workDir, gate.MARKER))) {
    // The directory was refused (not ours); write nothing into it.
    err.write(`${error ? error.message : "working directory not prepared"}\n`);
    return 2;
  }
  const text = R.buildResult(result, { workDir, agencySource, expected: EXPECTED[mode], gatePassed });
  await R.writeAtomic(path.join(workDir, "gate-result.json"), text);

  for (const [name, s] of Object.entries(result.steps || {})) out.write(`${s.ok ? "PASS" : "FAIL"}  ${name}\n`);
  if (error) out.write(`\nStopped: ${error.message}\n`);
  out.write(`\n${mode}: ${gatePassed ? "gate passed" : "gate NOT passed"} (${EXPECTED[mode]})\n`);
  out.write("Result file: <workDir>/gate-result.json\n");
  return gatePassed ? 0 : 1;
}

if (require.main === module) {
  installCleanup();
  main().then((code) => E.stopAll().then(() => process.exit(code)), (e) => {
    process.stderr.write(`gate failed to run: ${e.message}\n`);
    E.stopAll().then(() => process.exit(1));
  });
}

module.exports = { main, parseArgs, installCleanup, EXPECTED };
