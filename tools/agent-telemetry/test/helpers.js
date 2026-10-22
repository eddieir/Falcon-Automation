"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const HOOK = path.join(__dirname, "..", "hook.js");
const tmp = (p = "fat-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const T = (min) => new Date(Date.UTC(2026, 9, 22, 8, 0, 0) + min * 60000).toISOString();
const ev = (min, o) => ({ v: 1, id: `${o.ev}-${o.sid}-${o.aid || ""}-${min}-${Math.random()}`, ts: T(min), src: "hook", ...o });
const NOW = Date.UTC(2026, 9, 22, 8, 0, 0) + 60 * 60000;

function runHook(input, dir, extraEnv = {}) {
  return spawnSync("node", [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, FALCON_TELEMETRY_DIR: dir, ...extraEnv } });
}
function runHookAsync(input, dir) {
  return new Promise((resolve) => {
    const p = spawn("node", [HOOK], { env: { ...process.env, FALCON_TELEMETRY_DIR: dir } });
    p.on("close", (code) => resolve(code));
    p.stdin.end(JSON.stringify(input));
  });
}
function readEvents(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.startsWith("events-")).flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
module.exports = { tmp, T, ev, NOW, runHook, runHookAsync, readEvents, HOOK };
