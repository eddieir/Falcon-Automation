#!/usr/bin/env node
"use strict";
// Claude Code statusline (user level). Reads the documented statusline JSON on
// stdin and prints one line. Missing fields print N/A; nothing is invented.
// Never prints paths, session ids, prompt text or transcript content.
// Always exits 0 so it can never block Claude Code.
const fs = require("fs");
const os = require("os");
const path = require("path");

const OPS = path.join(os.homedir(), ".claude-ops");
const NA = "N/A";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const get = (o, p) => p.split(".").reduce((x, k) => (x !== null && typeof x === "object" ? x[k] : undefined), o);
const clean = (s, n) => String(s).replace(/[^\x20-\x7e]/g, "").slice(0, n);

function pct(v) {
  const n = num(v);
  return n === null ? NA : `${Math.round(Math.min(100, Math.max(0, n)))}%`;
}
function duration(ms) {
  const n = num(ms);
  if (n === null || n < 0) return NA;
  const m = Math.floor(n / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}
function reset(epochSec, now) {
  const n = num(epochSec);
  if (n === null) return "";
  const left = n * 1000 - now;
  if (left <= 0) return " reset due";
  const m = Math.ceil(left / 60000);
  if (m < 60) return ` r${m}m`;
  if (m < 2880) return ` r${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
  return ` r${Math.floor(m / 1440)}d`;
}
function tokens(v) {
  const n = num(v);
  if (n === null) return NA;
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
}

function render(d, now = Date.now()) {
  if (d === null || typeof d !== "object" || Array.isArray(d)) return "statusline: no data";
  const model = get(d, "model.display_name");
  const rl5 = get(d, "rate_limits.five_hour");
  const rl7 = get(d, "rate_limits.seven_day");
  const cost = num(get(d, "cost.total_cost_usd"));
  const parts = [
    typeof model === "string" && model ? clean(model, 24) : "model N/A",
    `ctx ${pct(get(d, "context_window.used_percentage"))} (${tokens(get(d, "context_window.total_input_tokens"))}/${tokens(get(d, "context_window.context_window_size"))})`,
    // Subscription limits exist only for Pro/Max after the first API response.
    `5h ${pct(get(rl5, "used_percentage"))}${reset(get(rl5, "resets_at"), now)}`,
    `7d ${pct(get(rl7, "used_percentage"))}${reset(get(rl7, "resets_at"), now)}`,
    `t ${duration(get(d, "cost.total_duration_ms"))}`,
    `est$ ${cost === null ? NA : cost.toFixed(2)}`,
  ];
  return parts.join(" | ");
}

// Opt-in: with ~/.claude-ops/capture-shape present, record which fields arrive
// (key paths and value types only, never values) to validate the real payload.
function captureShape(d) {
  try {
    const flag = path.join(OPS, "capture-shape");
    if (!fs.existsSync(flag)) return;
    const shape = {};
    (function walk(o, p, depth) {
      if (depth > 4 || o === null || typeof o !== "object" || Array.isArray(o)) return;
      for (const k of Object.keys(o)) {
        const v = o[k], key = p ? `${p}.${k}` : k;
        shape[key] = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
        walk(v, key, depth + 1);
      }
    })(d, "", 0);
    // Numeric context-window values only (no strings, ids or paths).
    const values = {};
    const cw = d.context_window;
    if (cw && typeof cw === "object") {
      for (const [k, v] of Object.entries(cw)) {
        if (typeof v === "number") values[`context_window.${k}`] = v;
        else if (k === "current_usage" && v && typeof v === "object") {
          for (const [k2, v2] of Object.entries(v)) if (typeof v2 === "number") values[`context_window.current_usage.${k2}`] = v2;
        }
      }
    }
    if (d.model && typeof d.model.id === "string") values["model.id"] = clean(d.model.id, 40);
    const shapeFile = path.join(OPS, "last-payload-shape.json");
    fs.writeFileSync(shapeFile, JSON.stringify({ at: new Date().toISOString(), shape, values }, null, 2), { mode: 0o600 });
    fs.chmodSync(shapeFile, 0o600); // mode above only applies on creation
  } catch { /* never fail */ }
}

// Numeric snapshot for the local dashboard. Written only when the telemetry
// directory exists (created by the dashboard installer). Numbers and the
// session id only: no paths, prompts or other strings.
const SID = /^[A-Za-z0-9_-]{1,64}$/;
function snapshot(d, now = Date.now()) {
  const dir = process.env.FALCON_TELEMETRY_DIR ? path.resolve(process.env.FALCON_TELEMETRY_DIR) : path.join(OPS, "telemetry");
  if (!fs.existsSync(dir)) return;
  const sid = d && d.session_id;
  if (typeof sid !== "string" || !SID.test(sid)) return;
  const n = (p) => num(get(d, p));
  const row = {
    ts: new Date(now).toISOString(), sid,
    model: typeof get(d, "model.id") === "string" ? clean(get(d, "model.id"), 40) : null,
    ctxPct: n("context_window.used_percentage"), ctxIn: n("context_window.total_input_tokens"), ctxSize: n("context_window.context_window_size"),
    lastIn: n("context_window.current_usage.input_tokens"), lastOut: n("context_window.current_usage.output_tokens"),
    lastCacheWrite: n("context_window.current_usage.cache_creation_input_tokens"), lastCacheRead: n("context_window.current_usage.cache_read_input_tokens"),
    h5Pct: n("rate_limits.five_hour.used_percentage"), h5Reset: n("rate_limits.five_hour.resets_at"),
    d7Pct: n("rate_limits.seven_day.used_percentage"), d7Reset: n("rate_limits.seven_day.resets_at"),
    estCostUsd: n("cost.total_cost_usd"), durationMs: n("cost.total_duration_ms"),
    cacheHitRatio: n("prompt_cache.hit_ratio"),
  };
  const file = path.join(dir, `snapshots-${new Date(now).toISOString().slice(0, 7).replace("-", "")}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(row) + "\n", { mode: 0o600 });
}

module.exports = { render, snapshot };

if (require.main === module) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => { if (raw.length < 1e6) raw += c; });
  process.stdin.on("error", () => {});
  process.stdin.on("end", () => {
    let d = null;
    try { d = raw.trim() ? JSON.parse(raw) : null; } catch { d = null; }
    let line;
    try { line = render(d); captureShape(d); try { snapshot(d); } catch { /* never fail */ } } catch { line = "statusline: error"; }
    process.stdout.write(line + "\n");
    process.exit(0);
  });
}
