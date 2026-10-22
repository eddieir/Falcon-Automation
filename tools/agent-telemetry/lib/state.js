"use strict";
// Pure reducer: hook events (+ statusline snapshots) -> sessions, agents,
// timeline. No I/O, no clock reads except the injected `now`, so tests are
// deterministic. Absent facts stay null; the UI renders them as UNKNOWN.

const MAX_TIMELINE = 1500;
const DUPLICATE_WINDOW_MS = 5000;

function reduce(events, snapshots = [], { now = Date.now(), staleMs = 30 * 60 * 1000, defs = {} } = {}) {
  const sorted = events.map((e, i) => [e, i]).sort((a, b) => (a[0].ts < b[0].ts ? -1 : a[0].ts > b[0].ts ? 1 : a[1] - b[1])).map((x) => x[0]);
  const seen = new Map(); // dedupe key -> first-seen time (ms)
  const sessions = new Map();
  const agents = new Map();
  const timeline = [];
  let duplicates = 0;
  let seenEvents = 0;

  const sess = (sid) => {
    if (!sessions.has(sid)) sessions.set(sid, { sid, project: null, entry: null, tp: null, tpd: null, model: null, startSource: null, startedAt: null, startObserved: false, endedAt: null, endReason: null, firstEventAt: null, lastEventAt: null, lastEvent: null, eventCount: 0, turns: 0, toolCount: 0, toolFailures: 0, stopFailures: 0, lastError: null });
    return sessions.get(sid);
  };
  const agent = (s, e) => {
    const key = `${s.sid}/${e.aid}`;
    if (!agents.has(key)) agents.set(key, { key, aid: e.aid, sid: s.sid, type: null, startedAt: null, startObserved: false, stoppedAt: null, firstEventAt: e.ts, lastEventAt: e.ts, lastEvent: null, lastTool: null, toolCount: 0, toolFailures: 0, failed: false, interrupted: false, lastError: null });
    return agents.get(key);
  };
  const push = (kind, e, label, detail) => timeline.push({ ts: e.ts, kind, sid: e.sid, aid: e.aid || null, label, detail: detail || null });

  for (const e of sorted) {
    if (!e || typeof e.sid !== "string" || typeof e.ts !== "string" || typeof e.ev !== "string") continue;
    // A duplicate hook delivery arrives with an identical payload id within moments. The same id much
    // later is a genuinely repeated event (identical bytes), so it is counted, not dropped.
    const dedupe = e.id || `${e.ev}|${e.sid}|${e.aid || ""}|${e.ts}`;
    const when = Date.parse(e.ts);
    const first = seen.get(dedupe);
    if (first !== undefined && !(Number.isFinite(when) && Math.abs(when - first) > DUPLICATE_WINDOW_MS)) { duplicates++; continue; }
    seen.set(dedupe, Number.isFinite(when) ? when : 0);
    seenEvents++;

    const s = sess(e.sid);
    s.eventCount++;
    s.firstEventAt = s.firstEventAt || e.ts;
    s.lastEventAt = e.ts;
    if (e.project) s.project = e.project;
    if (e.entry) s.entry = e.entry;
    if (e.tp) s.tp = e.tp;
    if (e.tpd) s.tpd = e.tpd;
    const a = e.aid ? agent(s, e) : null;
    if (a) { a.lastEventAt = e.ts; if (e.atype && !a.type) a.type = e.atype; }

    switch (e.ev) {
      case "SessionStart":
        if (!s.startedAt) s.startedAt = e.ts;
        s.startObserved = true;
        if (e.model) s.model = e.model;
        if (e.source) s.startSource = e.source;
        s.endedAt = null; s.endReason = null; // resumed session
        s.lastEvent = "SessionStart";
        push("session", e, "session start", e.source);
        break;
      case "SessionEnd":
        s.endedAt = e.ts; s.endReason = e.reason || null; s.lastEvent = "SessionEnd";
        push("session", e, "session end", e.reason);
        break;
      case "Stop":
        s.turns++; s.lastEvent = "Stop";
        break;
      case "StopFailure":
        s.stopFailures++; s.lastError = e.errorType || "unknown"; s.lastEvent = "StopFailure";
        if (a) { a.failed = true; a.lastError = s.lastError; a.lastEvent = "StopFailure"; }
        push("error", e, "turn failed", e.errorType || "unknown");
        break;
      case "SubagentStart":
        if (a) { if (!a.startedAt) a.startedAt = e.ts; a.startObserved = true; a.lastEvent = "SubagentStart"; }
        s.lastEvent = "SubagentStart";
        push("agent", e, `${(a && a.type) || "UNKNOWN"} started`, null);
        break;
      case "SubagentStop":
        if (a) { a.stoppedAt = e.ts; a.lastEvent = "SubagentStop"; }
        s.lastEvent = "SubagentStop";
        push("agent", e, `${(a && a.type) || "UNKNOWN"} stopped`, null);
        break;
      case "PostToolUse":
      case "PostToolUseFailure": {
        const failed = e.ev === "PostToolUseFailure";
        const t = a || s;
        t.toolCount++; if (failed) t.toolFailures++;
        if (a) { a.lastTool = e.tool || null; a.lastEvent = e.ev; if (e.interrupted) a.interrupted = true; }
        s.lastEvent = e.ev;
        push(failed ? "error" : "tool", e, failed ? "tool failed" : "tool", e.tool || null);
        break;
      }
      default: break;
    }
  }

  // Latest statusline snapshot per session and account-wide limits.
  const snapBySid = new Map();
  let limits = null;
  for (const r of snapshots) {
    if (!r || typeof r.sid !== "string" || typeof r.ts !== "string") continue;
    const cur = snapBySid.get(r.sid);
    if (!cur || r.ts >= cur.ts) snapBySid.set(r.sid, r);
    if ((typeof r.h5Pct === "number" || typeof r.d7Pct === "number") && (!limits || r.ts >= limits.at)) {
      limits = { at: r.ts, h5Pct: r.h5Pct ?? null, h5Reset: r.h5Reset ?? null, d7Pct: r.d7Pct ?? null, d7Reset: r.d7Reset ?? null };
    }
  }

  const ms = (iso) => (iso ? Date.parse(iso) : null);
  const outSessions = [];
  for (const s of sessions.values()) {
    const last = ms(s.lastEventAt);
    const snap = snapBySid.get(s.sid) || null;
    const status = s.endedAt ? "ended" : last !== null && now - last > staleMs ? "stale" : "active";
    const start = ms(s.startedAt || s.firstEventAt);
    const end = s.endedAt ? ms(s.endedAt) : status === "active" ? now : last;
    const statusLabel = status === "ended" ? "ended (SessionEnd observed)" : status === "stale" ? "stale — liveness lost, termination not confirmed" : "active (recent events)";
    outSessions.push({ ...s, status, statusLabel, elapsedMs: start !== null && end !== null ? Math.max(0, end - start) : null, snapshot: snap && { at: snap.ts, ctxPct: snap.ctxPct, ctxIn: snap.ctxIn, ctxSize: snap.ctxSize, estCostUsd: snap.estCostUsd, durationMs: snap.durationMs, model: snap.model, cacheHitRatio: snap.cacheHitRatio ?? null } });
  }
  const sessionByid = new Map(outSessions.map((s) => [s.sid, s]));

  const outAgents = [];
  for (const a of agents.values()) {
    const s = sessionByid.get(a.sid);
    let status;
    if (a.failed) status = "failed";
    else if (a.stoppedAt) status = a.interrupted ? "interrupted" : "completed";
    else if (s && s.status === "ended") status = "interrupted";
    else if (s && s.status === "stale") status = "unknown";
    else status = "running";
    const start = ms(a.startedAt || a.firstEventAt);
    const end = a.stoppedAt ? ms(a.stoppedAt) : status === "running" ? now : ms(a.lastEventAt);
    const def = a.type ? defs[a.type] : undefined;
    // A record whose SubagentStart was never seen (hooks installed mid-run, or a
    // stop-only event) is "partial": its duration is unknown, not zero.
    const partial = !a.startObserved;
    // Human-readable status that never overstates what was observed.
    const statusLabel = partial
      ? (a.stoppedAt ? "Partial — stop observed" : status === "running" ? "Partial — activity observed" : `Partial — ${status}`)
      : status === "interrupted" && !a.stoppedAt ? "interrupted (inferred: session ended without a stop event)"
      : status === "unknown" ? "unknown (session stale: liveness lost, outcome not observed)"
      : status === "failed" ? "failed (StopFailure observed)" : status;
    outAgents.push({ ...a, status, statusLabel, partial, parent: a.sid, elapsedMs: !partial && start !== null && end !== null ? Math.max(0, end - start) : null, configuredModel: def ? def.model || null : null, configSource: def ? "agent definition" : null });
  }

  // Maximum number of agents observed running at the same time.
  const edges = [];
  for (const a of outAgents) {
    if (!a.startedAt) continue;
    edges.push([ms(a.startedAt), 1]);
    edges.push([a.stoppedAt ? ms(a.stoppedAt) : a.status === "running" ? now : ms(a.lastEventAt), -1]);
  }
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0, maxConcurrent = 0;
  for (const [, d] of edges) { cur += d; if (cur > maxConcurrent) maxConcurrent = cur; }

  outSessions.sort((x, y) => (y.lastEventAt || "").localeCompare(x.lastEventAt || ""));
  outAgents.sort((x, y) => (y.startedAt || y.firstEventAt || "").localeCompare(x.startedAt || x.firstEventAt || ""));
  return {
    sessions: outSessions, agents: outAgents, limits,
    timeline: timeline.slice(-MAX_TIMELINE),
    stats: { events: seenEvents, duplicates, maxConcurrentAgents: maxConcurrent, runningAgents: outAgents.filter((a) => a.status === "running" && !a.partial).length, partialAgents: outAgents.filter((a) => a.partial).length, activeSessions: outSessions.filter((s) => s.status === "active").length },
  };
}

module.exports = { reduce };
