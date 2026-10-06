#!/usr/bin/env node
/**
 * scripts/dashboard.js — Phase 15 serve mode.
 *
 * Starts the existing Dashboard class, unchanged, and keeps it up until Ctrl-C
 * (SIGINT) or SIGTERM. It runs no tests and launches no browser, so the
 * dashboard (including the History panel) can be opened on its own.
 *
 * Usage: node scripts/dashboard.js        (npm run dashboard)
 *
 * Configuration is the Dashboard's own: DASHBOARD_PORT (default 3000; 0 picks a free port),
 * DASHBOARD_HOST (default 127.0.0.1) and DASHBOARD_TOKEN. Every guard stays in
 * force: a non-loopback host without a token is refused, the Host/Origin check
 * and the rate limiter apply, and the token is never accepted in a query string
 * on an API route. There are no arguments.
 *
 * Readiness: once the server is listening it logs "Dashboard ready on
 * http://<host>:<port>" (never the token).
 *
 * Exit codes: 0 after a clean SIGINT/SIGTERM shutdown; 1 when the dashboard
 * refuses to start or fails to start.
 */
"use strict";

const path = require("node:path");
const Logger = require(path.join("..", "utils", "Logger"));
const Dashboard = require(path.join("..", "src", "core", "Dashboard"));

// Shutdown is bounded: a stop() that has not settled in this long exits 1. Tests
// may shorten it through the seam (a number only, never an environment variable).
const SHUTDOWN_TIMEOUT_MS = 5000;
function shutdownTimeoutMs() {
  const seam = globalThis.__FALCON_TEST_SEAMS__;
  const v = seam && seam.dashboardShutdownMs;
  return Number.isInteger(v) && v > 0 ? v : SHUTDOWN_TIMEOUT_MS;
}

// DASHBOARD_PORT: unset, blank or not a port number -> 3000. 0 is honoured here
// (an OS-assigned port, which is how the tests avoid clashes); falcon.js maps it to 3000.
function portFromEnv(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return 3000;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : 3000;
}

async function main() {
  const dashboard = new Dashboard({ port: portFromEnv(process.env.DASHBOARD_PORT) }); // host: DASHBOARD_HOST

  // Signal handlers go in before the server starts, so a signal that arrives
  // while (or right after) the readiness line is printed still shuts down cleanly.
  let signalled = null;
  let onSignal = (signal) => { signalled = signal; };
  const sigint = () => onSignal("SIGINT");
  const sigterm = () => onSignal("SIGTERM");
  process.once("SIGINT", sigint);
  process.once("SIGTERM", sigterm);

  try {
    await dashboard.start();
  } catch (error) {
    // The refusal message names the setting to change and never the token.
    Logger.error(`❌ ${error.message}`);
    await Logger.flush();
    return 1;
  }
  const host = dashboard.host.includes(":") ? `[${dashboard.host.replace(/^\[|\]$/g, "")}]` : dashboard.host;
  Logger.info(`Dashboard ready on http://${host}:${dashboard.port}`);

  return new Promise((resolve) => {
    let stopping = false;
    const shutdown = async (signal) => {
      if (stopping) {
        // A second signal while shutting down: stop waiting.
        Logger.warning(`Dashboard shutdown interrupted by a second ${signal}`);
        await Logger.flush();
        process.exit(1);
      }
      stopping = true;
      Logger.info(`Dashboard stopping (${signal})`);
      // Later signals must reach this handler too (process.once removed the first).
      process.on("SIGINT", sigint);
      process.on("SIGTERM", sigterm);
      const ms = shutdownTimeoutMs();
      let timer;
      const timedOut = new Promise((r) => { timer = setTimeout(() => r("timeout"), ms); });
      let code = 0;
      try {
        const outcome = await Promise.race([dashboard.stop().then(() => "stopped"), timedOut]);
        if (outcome === "timeout") {
          Logger.warning(`Dashboard did not stop within ${ms} ms; exiting`);
          code = 1;
        }
      } catch (error) {
        Logger.error(`Dashboard did not stop cleanly (${error.message})`);
        code = 1;
      }
      clearTimeout(timer);
      resolve(code);
    };
    onSignal = shutdown;
    if (signalled) shutdown(signalled);
  });
}

main().then(
  async (code) => {
    await Logger.flush();
    process.exit(code);
  },
  async (error) => {
    Logger.error(`Dashboard failed (${error && error.message ? error.message : "error"})`);
    await Logger.flush();
    process.exit(1);
  },
);
