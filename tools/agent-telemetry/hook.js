#!/usr/bin/env node
"use strict";
// Claude Code hook collector. Reads one hook payload on stdin, appends one
// sanitized line to the local telemetry log, prints nothing (SessionStart/Stop
// stdout would otherwise be injected into Claude's context) and always exits 0
// so it can never block or break Claude Code.
const fs = require("fs");
const path = require("path");

const MAX_STDIN = 512 * 1024;
const done = () => process.exit(0);
setTimeout(done, 1500).unref(); // hard watchdog

function recordError(dir, code) {
  try { fs.appendFileSync(path.join(dir, "collector-errors.log"), `${new Date().toISOString()} ${String(code).replace(/[^\w.-]/g, "").slice(0, 40)}\n`, { mode: 0o600 }); } catch { /* ignore */ }
}

let raw = "";
let size = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { size += c.length; if (size <= MAX_STDIN) raw += c; });
process.stdin.on("error", done);
process.stdin.on("end", () => {
  let dir = null;
  try {
    const { sanitizeHook } = require("./lib/sanitize");
    const { appendEvent } = require("./lib/store");
    const { telemetryDir } = require("./lib/paths");
    dir = telemetryDir();
    if (size > MAX_STDIN) return done();
    const ev = sanitizeHook(JSON.parse(raw), { raw, entry: process.env.CLAUDE_CODE_ENTRYPOINT });
    if (ev) appendEvent(dir, ev);
  } catch (e) {
    if (dir && e && e.name !== "SyntaxError") recordError(dir, e.code || e.name || "error");
  }
  done();
});
