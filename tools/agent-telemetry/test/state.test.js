"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { reduce } = require("../lib/state");
const { ev, NOW } = require("./helpers");

const R = (events, snaps = [], o = {}) => reduce(events, snaps, { now: NOW, ...o });
const byType = (st, t) => st.agents.find((a) => a.type === t);

test("session start/end lifecycle", () => {
  const st = R([ev(0, { ev: "SessionStart", sid: "s1", model: "claude-sonnet-5-5", source: "startup", project: "P", entry: "cli" }), ev(30, { ev: "SessionEnd", sid: "s1", reason: "other" })]);
  const s = st.sessions[0];
  assert.strictEqual(s.status, "ended"); assert.strictEqual(s.endReason, "other"); assert.strictEqual(s.elapsedMs, 30 * 60000); assert.strictEqual(s.startObserved, true); assert.strictEqual(s.model, "claude-sonnet-5-5");
});
test("session without SessionStart is shown with start not observed", () => {
  const st = R([ev(50, { ev: "Stop", sid: "s2" })]);
  assert.strictEqual(st.sessions[0].startObserved, false); assert.strictEqual(st.sessions[0].startedAt, null); assert.ok(st.sessions[0].elapsedMs !== null);
});
test("subagent start/stop, parent session and concurrent agents", () => {
  const st = R([
    ev(0, { ev: "SessionStart", sid: "s1" }),
    ev(5, { ev: "SubagentStart", sid: "s1", aid: "a1", atype: "developer" }), ev(6, { ev: "SubagentStart", sid: "s1", aid: "a2", atype: "qa-engineer" }), ev(7, { ev: "SubagentStart", sid: "s1", aid: "a3", atype: "code-reviewer" }),
    ev(9, { ev: "SubagentStop", sid: "s1", aid: "a1", atype: "developer" }),
  ], [], { staleMs: 1e12 });
  assert.strictEqual(st.agents.length, 3);
  assert.ok(st.agents.every((a) => a.parent === "s1" && a.sid === "s1"));
  assert.strictEqual(byType(st, "developer").status, "completed"); assert.strictEqual(byType(st, "qa-engineer").status, "running");
  assert.strictEqual(st.stats.maxConcurrentAgents, 3); assert.strictEqual(st.stats.runningAgents, 2);
  assert.strictEqual(byType(st, "developer").elapsedMs, 4 * 60000);
});
test("agents are scoped per session even with the same agent id", () => {
  const st = R([ev(0, { ev: "SubagentStart", sid: "s1", aid: "x", atype: "developer" }), ev(1, { ev: "SubagentStart", sid: "s2", aid: "x", atype: "qa-engineer" })]);
  assert.strictEqual(st.agents.length, 2);
});
test("failed agent (StopFailure with agent id) and interrupted agent", () => {
  const st = R([
    ev(0, { ev: "SubagentStart", sid: "s1", aid: "a1", atype: "developer" }), ev(2, { ev: "StopFailure", sid: "s1", aid: "a1", atype: "developer", errorType: "rate_limit" }),
    ev(0, { ev: "SubagentStart", sid: "s1", aid: "a2", atype: "qa-engineer" }), ev(3, { ev: "PostToolUseFailure", sid: "s1", aid: "a2", atype: "qa-engineer", tool: "Bash", interrupted: true }), ev(4, { ev: "SubagentStop", sid: "s1", aid: "a2", atype: "qa-engineer" }),
  ]);
  assert.strictEqual(byType(st, "developer").status, "failed"); assert.strictEqual(byType(st, "developer").lastError, "rate_limit");
  assert.strictEqual(byType(st, "qa-engineer").status, "interrupted");
  assert.ok(st.timeline.some((t) => t.kind === "error"));
});
test("missing stop event: session ended => agent interrupted; stale session => unknown", () => {
  const ended = R([ev(0, { ev: "SessionStart", sid: "s1" }), ev(1, { ev: "SubagentStart", sid: "s1", aid: "a1", atype: "developer" }), ev(10, { ev: "SessionEnd", sid: "s1" })]);
  assert.strictEqual(ended.agents[0].status, "interrupted");
  const stale = R([ev(0, { ev: "SessionStart", sid: "s1" }), ev(1, { ev: "SubagentStart", sid: "s1", aid: "a1", atype: "developer" })], [], { now: NOW + 3 * 3600000 });
  assert.strictEqual(stale.sessions[0].status, "stale"); assert.strictEqual(stale.agents[0].status, "unknown");
  const live = R([ev(55, { ev: "SessionStart", sid: "s1" }), ev(58, { ev: "SubagentStart", sid: "s1", aid: "a1", atype: "developer" })]);
  assert.strictEqual(live.sessions[0].status, "active"); assert.strictEqual(live.agents[0].status, "running");
});
test("missing model, type, and token data stay null (UNKNOWN), never invented", () => {
  const st = R([ev(0, { ev: "SubagentStart", sid: "s1", aid: "a1" })]);
  const a = st.agents[0];
  assert.strictEqual(a.type, null); assert.strictEqual(a.configuredModel, null); assert.strictEqual(st.sessions[0].model, null); assert.strictEqual(st.sessions[0].snapshot, null); assert.strictEqual(st.limits, null);
});
test("configured model comes from agent definitions only for known roles", () => {
  const st = R([ev(0, { ev: "SubagentStart", sid: "s1", aid: "a1", atype: "developer" }), ev(0, { ev: "SubagentStart", sid: "s1", aid: "a2", atype: "Explore" })], [], { defs: { developer: { model: "claude-sonnet-5" } } });
  assert.strictEqual(byType(st, "developer").configuredModel, "claude-sonnet-5"); assert.strictEqual(byType(st, "Explore").configuredModel, null);
});
test("duplicate hook delivery is ignored; out-of-order arrival is sorted", () => {
  const a = { v: 1, id: "dup1", ts: ev(5, {}).ts, ev: "SubagentStart", sid: "s1", aid: "a1", atype: "developer" };
  const st = R([ev(9, { ev: "SubagentStop", sid: "s1", aid: "a1", atype: "developer" }), a, { ...a }]);
  assert.strictEqual(st.stats.duplicates, 1); assert.strictEqual(st.agents.length, 1); assert.strictEqual(st.agents[0].status, "completed"); assert.strictEqual(st.agents[0].elapsedMs, 4 * 60000);
});
test("resumed session clears the ended state", () => {
  const st = R([ev(0, { ev: "SessionStart", sid: "s1" }), ev(5, { ev: "SessionEnd", sid: "s1" }), ev(55, { ev: "SessionStart", sid: "s1", source: "resume" })]);
  assert.strictEqual(st.sessions[0].status, "active");
});
test("statusline snapshots give per-session context/cost and account limits", () => {
  const snaps = [{ ts: ev(10, {}).ts, sid: "s1", ctxPct: 10, h5Pct: 30, h5Reset: 1, d7Pct: 5, d7Reset: 2, estCostUsd: 1 }, { ts: ev(20, {}).ts, sid: "s1", ctxPct: 20, h5Pct: 40, h5Reset: 1, d7Pct: 6, d7Reset: 2, estCostUsd: 2 }];
  const st = R([ev(0, { ev: "SessionStart", sid: "s1" })], snaps);
  assert.strictEqual(st.sessions[0].snapshot.ctxPct, 20); assert.strictEqual(st.limits.h5Pct, 40); assert.strictEqual(st.sessions[0].snapshot.estCostUsd, 2);
});
test("multiple sessions are kept separate", () => {
  const st = R([ev(0, { ev: "SessionStart", sid: "s1" }), ev(1, { ev: "SessionStart", sid: "s2", entry: "claude-desktop" })], [], { staleMs: 1e12 });
  assert.strictEqual(st.sessions.length, 2); assert.strictEqual(st.stats.activeSessions, 2);
});

test("stop-only (orphan) agent record is partial: unknown duration, never a fabricated zero", () => {
  const st = R([ev(5, { ev: "SubagentStop", sid: "s1", aid: "orph" })], [], { staleMs: 1e12 });
  const a = st.agents[0];
  assert.strictEqual(a.partial, true); assert.strictEqual(a.startObserved, false); assert.strictEqual(a.elapsedMs, null);
  assert.strictEqual(a.type, null); assert.strictEqual(a.status, "completed"); assert.strictEqual(st.stats.partialAgents, 1);
});
test("agent first seen via tool events only is partial; normal agent is not", () => {
  const st = R([ev(55, { ev: "PostToolUse", sid: "s1", aid: "late", atype: "developer", tool: "Read" }), ev(56, { ev: "SubagentStart", sid: "s1", aid: "ok", atype: "qa-engineer" })]);
  assert.strictEqual(st.agents.find((a) => a.aid === "late").partial, true); assert.strictEqual(st.agents.find((a) => a.aid === "late").elapsedMs, null);
  assert.strictEqual(st.agents.find((a) => a.aid === "ok").partial, false); assert.ok(st.agents.find((a) => a.aid === "ok").elapsedMs > 0);
});
test("exact agent+parent tracking: same agent id in another session is a separate record (watcher-bug regression)", () => {
  const st = R([ev(5, { ev: "SubagentStop", sid: "s1", aid: "same" }), ev(55, { ev: "SubagentStart", sid: "s2", aid: "same", atype: "developer" })]);
  assert.strictEqual(st.agents.length, 2);
  assert.strictEqual(st.agents.find((a) => a.sid === "s1").status, "completed"); assert.strictEqual(st.agents.find((a) => a.sid === "s2").status, "running");
});

test("status labels: partial stop-only is never labelled completed; stale vs ended vs interrupted are distinct", () => {
  const orphan = R([ev(5, { ev: "SubagentStop", sid: "s1", aid: "o" })], [], { staleMs: 1e12 }).agents[0];
  assert.strictEqual(orphan.statusLabel, "Partial — stop observed"); assert.ok(!/^completed/.test(orphan.statusLabel));
  const stale = R([ev(0, { ev: "SessionStart", sid: "s1" }), ev(1, { ev: "SubagentStart", sid: "s1", aid: "a", atype: "developer" })], [], { now: NOW + 3 * 3600000 });
  assert.match(stale.sessions[0].statusLabel, /liveness lost, termination not confirmed/); assert.match(stale.agents[0].statusLabel, /liveness lost/);
  const ended = R([ev(0, { ev: "SessionStart", sid: "s1" }), ev(1, { ev: "SubagentStart", sid: "s1", aid: "a", atype: "developer" }), ev(9, { ev: "SessionEnd", sid: "s1" })]);
  assert.match(ended.sessions[0].statusLabel, /SessionEnd observed/); assert.match(ended.agents[0].statusLabel, /inferred/);
  assert.strictEqual(R([ev(0, { ev: "SubagentStart", sid: "s1", aid: "a", atype: "d" }), ev(1, { ev: "SubagentStop", sid: "s1", aid: "a" })], [], { staleMs: 1e12 }).agents[0].statusLabel, "completed");
});

test("runningAgents counts only agents whose start was observed", () => {
  const st = R([ev(55, { ev: "SubagentStart", sid: "s1", aid: "ok", atype: "developer" }), ev(56, { ev: "PostToolUse", sid: "s1", aid: "late", atype: "qa-engineer", tool: "Read" })]);
  assert.strictEqual(st.stats.runningAgents, 1); assert.strictEqual(st.stats.partialAgents, 1);
});

test("duplicate deliveries are dropped only within a few seconds; the same id much later is a real repeated event", () => {
  const base = { v: 1, id: "same-id", ev: "Stop", sid: "s1" };
  const mk = (iso) => ({ ...base, ts: iso });
  const t0 = Date.parse(ev(10, {}).ts);
  const iso = (ms) => new Date(t0 + ms).toISOString();
  const near = R([mk(iso(0)), mk(iso(1500))], [], { staleMs: 1e12 });
  assert.strictEqual(near.stats.duplicates, 1); assert.strictEqual(near.stats.events, 1); assert.strictEqual(near.sessions[0].turns, 1);
  const later = R([mk(iso(0)), mk(iso(60000)), mk(iso(120000))], [], { staleMs: 1e12 });
  assert.strictEqual(later.stats.duplicates, 0); assert.strictEqual(later.stats.events, 3); assert.strictEqual(later.sessions[0].turns, 3, "repeated identical Stop events are all counted");
});
