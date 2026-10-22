#!/usr/bin/env node
"use strict";
// Read-only localhost dashboard server. No outbound network, no LLM calls.
// Serves a fixed set of static files and one JSON endpoint; nothing from the
// URL is ever used as a file path.
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { JsonlTail } = require("./lib/store");
const { reduce } = require("./lib/state");
const { UsageReader, subagentPath } = require("./lib/usage");
const { readLedger } = require("./lib/ledger");
const { readAgentDefs } = require("./lib/agentdefs");
const { telemetryDir, claudeProjectsDir, tokenFile } = require("./lib/paths");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const MAX_EVENTS = 100000;
const USAGE_EVERY_MS = 10000;
const USAGE_WINDOW_MS = 7 * 24 * 3600 * 1000;
const MAX_USAGE_SESSIONS = 40;
const MAX_USAGE_AGENTS = 200;

const UI = path.join(__dirname, "ui");
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};
const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

// Access token: any local process can reach a loopback port, so the data API
// requires a secret that only this user can read (0600 file, or passed in).
function loadToken(file) {
  let fd = null;
  try {
    // Open without following a symlink, then judge and read the SAME handle,
    // so the file cannot be swapped between the check and the read.
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const st = fs.fstatSync(fd);
    const owned = typeof process.getuid !== "function" || st.uid === process.getuid();
    if (st.isFile() && owned && (st.mode & 0o077) === 0) {
      const t = fs.readFileSync(fd, "utf8").trim();
      if (/^[A-Za-z0-9_-]{32,128}$/.test(t)) return t;
    }
  } catch { /* missing, a symlink, or unreadable: replace below */ } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
  try { fs.unlinkSync(file); } catch { /* nothing to remove; also removes a symlink without following it */ }
  const t = crypto.randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, t + "\n", { flag: "wx", mode: 0o600 }); // wx never writes through an existing path
  return t;
}
function tokenOk(header, token) {
  const m = /^Bearer ([A-Za-z0-9_-]{1,200})$/.exec(String(header || ""));
  if (!m) return false;
  const a = crypto.createHash("sha256").update(m[1]).digest(), b = crypto.createHash("sha256").update(token).digest();
  return crypto.timingSafeEqual(a, b);
}

function createApp({ dataDir = telemetryDir(), repo = null, projectsDir = claudeProjectsDir(), host = "127.0.0.1", port = 47831, now = () => Date.now(), token = null, tokenPath = tokenFile() } = {}) {
  if (!LOOPBACK.has(host)) throw new Error(`refusing non-loopback host: ${host}`);
  const accessToken = token || loadToken(tokenPath);
  const events = new JsonlTail(dataDir, "events");
  const snaps = new JsonlTail(dataDir, "snapshots");
  const usage = new UsageReader(projectsDir);
  const usageBySid = new Map();
  let evs = [], snapRows = [];
  const files = Object.fromEntries(Object.entries(STATIC).map(([u, [f]]) => [f, fs.readFileSync(path.join(UI, f))]));
  let cache = { key: "", body: null };
  let defs = { at: 0, v: {} };
  let usageBusy = false;
  let ignoredSnapshots = 0;
  let usageVersion = 0;
  const usageSig = new Map();

  const synthetic = () => fs.existsSync(path.join(dataDir, "SYNTHETIC"));

  function poll() {
    const e = events.poll();
    if (e.length) { evs = evs.concat(e); if (evs.length > MAX_EVENTS) evs = evs.slice(-MAX_EVENTS); }
    // Real Claude Code session ids are UUIDs. Snapshot rows with any other id
    // (fixtures, hand-written rows) are ignored and counted, never displayed,
    // unless the dataset is explicitly marked SYNTHETIC. Nothing is deleted.
    const strict = !synthetic();
    const s = snaps.poll().filter((r) => { const ok = !strict || (r && typeof r.sid === "string" && UUID.test(r.sid)); if (!ok) ignoredSnapshots++; return ok; });
    if (s.length) { snapRows = snapRows.concat(s); if (snapRows.length > MAX_EVENTS) snapRows = snapRows.slice(-MAX_EVENTS); }
  }

  async function refreshUsage(state) {
    if (usageBusy) return;
    usageBusy = true;
    let changed = false;
    try {
      const t = now();
      const targets = state.sessions.map((s) => ({ ...s, tp: sessionTranscript(s) })).filter((s) => s.tp && t - Date.parse(s.lastEventAt) < USAGE_WINDOW_MS).slice(0, MAX_USAGE_SESSIONS);
      let agentBudget = MAX_USAGE_AGENTS;
      for (const s of targets) {
        const entry = { main: await usage.refresh(s.tp), agents: {} };
        for (const a of state.agents.filter((x) => x.sid === s.sid)) {
          if (agentBudget-- <= 0) break;
          const p = subagentPath(s.tp, s.sid, a.aid);
          if (p) entry.agents[a.aid] = await usage.refresh(p);
        }
        const sig = JSON.stringify(entry);
        if (usageSig.get(s.sid) !== sig) { usageSig.set(s.sid, sig); changed = true; }
        usageBySid.set(s.sid, entry);
      }
      usage.evict();
    } catch { /* usage is best effort */ } finally { usageBusy = false; if (changed) usageVersion++; }
  }

  // Transcript location: legacy rows carry an absolute path, new rows only the
  // project directory name (the file is <projects>/<dir>/<session>.jsonl).
  function sessionTranscript(s) {
    if (s.tp) return s.tp;
    return s.tpd ? path.join(projectsDir, s.tpd, `${s.sid}.jsonl`) : null;
  }

  function build() {
    poll();
    const t = now();
    const key = `${evs.length}|${snapRows.length}|${Math.floor(t / 1000)}|${usageVersion}`;
    if (cache.key === key) return cache.body;
    if (t - defs.at > 30000) defs = { at: t, v: readAgentDefs(repo) };
    const state = reduce(evs, snapRows, { now: t, defs: defs.v });
    const sessions = state.sessions.slice(0, 200).map(({ tp, tpd, ...s }) => {
      const u = usageBySid.get(s.sid);
      return { ...s, usage: u ? { main: u.main, agentCount: Object.keys(u.agents).length } : null };
    });
    const keep = new Set(sessions.map((s) => s.sid));
    const agents = state.agents.filter((a) => keep.has(a.sid)).slice(0, 1000).map((a) => {
      const u = usageBySid.get(a.sid);
      const au = u ? u.agents[a.aid] || null : null;
      return { ...a, usage: au, observedModels: au ? Object.keys(au.models) : null };
    });
    let collectorErrors = 0;
    try { collectorErrors = fs.readFileSync(path.join(dataDir, "collector-errors.log"), "utf8").split("\n").filter(Boolean).length; } catch { /* none */ }
    const body = JSON.stringify({
      now: t, dataLabel: synthetic() ? "SYNTHETIC" : "REAL", sessions, agents, timeline: state.timeline.slice(-800), limits: state.limits, stats: state.stats,
      ledger: readLedger(repo), health: { badLines: events.bad + snaps.bad, ignoredSnapshots, collectorErrors, eventFiles: events.files().length, snapshotFiles: snaps.files().length, defs: Object.keys(defs.v).length },
    });
    cache = { key, body };
    return body;
  }

  function handler(req, res) {
    const send = (code, type, body, extra = {}) => { res.writeHead(code, { ...HEADERS, "Content-Type": type, ...extra }); res.end(req.method === "HEAD" ? undefined : body); };
    try {
      const addr = server.address();
      const p = addr && addr.port;
      const hostHdr = String(req.headers.host || "");
      if (hostHdr !== `127.0.0.1:${p}` && hostHdr !== `localhost:${p}`) return send(403, "text/plain; charset=utf-8", "forbidden host");
      const origin = req.headers.origin;
      if (origin && origin !== `http://127.0.0.1:${p}` && origin !== `http://localhost:${p}`) return send(403, "text/plain; charset=utf-8", "forbidden origin");
      if (req.method !== "GET" && req.method !== "HEAD") return send(405, "text/plain; charset=utf-8", "method not allowed", { Allow: "GET, HEAD" });
      let pathname;
      try { pathname = new URL(req.url, "http://x").pathname; } catch { return send(400, "text/plain; charset=utf-8", "bad request"); }
      if (pathname === "/favicon.ico") return send(204, "image/x-icon", "");
      if (pathname === "/api/health") return send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, now: now() }));
      if (pathname === "/api/state") {
        if (!tokenOk(req.headers.authorization, accessToken)) return send(401, "application/json; charset=utf-8", JSON.stringify({ error: "token required" }), { "WWW-Authenticate": "Bearer" });
        const body = build();
        return send(200, "application/json; charset=utf-8", body);
      }
      const entry = Object.prototype.hasOwnProperty.call(STATIC, pathname) ? STATIC[pathname] : null;
      if (entry) return send(200, entry[1], files[entry[0]]);
      return send(404, "text/plain; charset=utf-8", "not found");
    } catch {
      return send(500, "text/plain; charset=utf-8", "internal error");
    }
  }

  const server = http.createServer(handler);
  const timer = setInterval(() => { try { poll(); refreshUsage(reduce(evs, snapRows, { now: now(), defs: defs.v })).catch(() => {}); } catch { /* keep serving */ } }, USAGE_EVERY_MS);
  timer.unref();
  return {
    server,
    listen: () => new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => resolve(server.address())); }),
    close: () => new Promise((resolve) => { clearInterval(timer); server.close(() => resolve()); }),
    refreshUsageNow: async () => { poll(); await refreshUsage(reduce(evs, snapRows, { now: now(), defs: defs.v })); cache = { key: "", body: null }; },
  };
}

if (require.main === module) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
  const port = Number(arg("port", 47831));
  const host = arg("host", "127.0.0.1");
  const repo = path.resolve(arg("repo", path.join(__dirname, "..", "..")));
  const dataDir = arg("data-dir") ? path.resolve(arg("data-dir")) : telemetryDir();
  let app;
  try { app = createApp({ dataDir, repo, host, port }); } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(2); }
  app.listen().then((a) => process.stdout.write(`Falcon agent dashboard: http://127.0.0.1:${a.port}/  (data: ${dataDir === telemetryDir() ? "local telemetry" : "custom dir"})\nAccess token file (0600): ${tokenFile()}\nTo sign in, copy the token (pbcopy < ${tokenFile()}) and paste it into the page.\n`)).catch((e) => { process.stderr.write(`cannot listen: ${e.code || e.message}\n`); process.exit(1); });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => app.close().then(() => process.exit(0)));
}

module.exports = { createApp, loadToken, tokenOk };
