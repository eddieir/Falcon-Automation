#!/usr/bin/env node
/**
 * scripts/production-cycle/dashboard.js — CLI launcher for the loopback-only
 * production-cycle dashboard server (ADR-0018 section 7, Sec-00b D-19).
 */

"use strict";

const path = require("node:path");
const { execFileSync } = require("node:child_process");

const Logger = require("../../utils/Logger");
const Server = require("../../src/production-cycle/Server");

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      return { error: `positional arguments are not allowed: ${arg}` };
    }
    const body = arg.slice(2);
    const eqIdx = body.indexOf("=");
    if (eqIdx === -1) {
      flags[body] = true;
      continue;
    }
    flags[body.slice(0, eqIdx)] = body.slice(eqIdx + 1);
  }
  return { flags };
}

function resolveLedgerRoot(flags) {
  if (typeof flags["ledger-root"] === "string" && flags["ledger-root"].length > 0) {
    return flags["ledger-root"];
  }
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    return path.resolve(out);
  } catch {
    return null;
  }
}

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    Logger.error(`dashboard: ${parsed.error}`);
    process.exitCode = 2;
    return false;
  }
  const { flags } = parsed;

  if (!flags["run-id"]) {
    Logger.error("dashboard: --run-id is required");
    process.exitCode = 2;
    return false;
  }

  const host = typeof flags.host === "string" ? flags.host : "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    Logger.error(`dashboard: non-loopback host is not permitted (host=${host})`);
    process.exitCode = 1;
    return false;
  }

  const ledgerRoot = resolveLedgerRoot(flags);
  if (!ledgerRoot) {
    Logger.error("dashboard: unable to resolve ledger root");
    process.exitCode = 1;
    return false;
  }

  const port = flags.port !== undefined ? Number(flags.port) : 0;

  let instance;
  try {
    instance = Server.create({
      ledgerRoot,
      runId: flags["run-id"],
      host,
      port: Number.isInteger(port) ? port : 0,
    });
  } catch (e) {
    Logger.error(`dashboard: unable to start server (${e && e.message})`);
    process.exitCode = 1;
    return false;
  }

  const bound = await instance.listen();
  Logger.info(`Production-cycle dashboard ready on http://127.0.0.1:${bound.port} (run ${flags["run-id"]})`);

  const shutdown = async () => {
    await instance.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return true;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    Logger.error(`dashboard: unexpected failure (${e && e.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };
