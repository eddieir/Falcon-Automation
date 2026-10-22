"use strict";
// Turns a raw Claude Code hook payload into a small, closed-schema event.
// Whitelist only: prompts, tool input/output, assistant messages, environment
// values and full paths are never copied (only the transcript's project
// directory name is kept so the server can locate the file under ~/.claude). Unknown or malformed values become
// absent (the UI shows UNKNOWN) instead of being guessed.
const crypto = require("crypto");
const path = require("path");

const EVENTS = new Set(["SessionStart", "SessionEnd", "Stop", "StopFailure", "SubagentStart", "SubagentStop", "PostToolUse", "PostToolUseFailure"]);
const ID = /^[A-Za-z0-9._:-]{1,80}$/;
const TYPE = /^[A-Za-z0-9._:@-]{1,64}$/;
const MODEL = /^[A-Za-z0-9._:\/\[\]-]{1,60}$/;
const ENUM = /^[a-z_]{1,40}$/;
const TOOL = /^[A-Za-z0-9_.:-]{1,80}$/;
const ENTRY = /^[a-z0-9_-]{1,32}$/;
const MAX_TP = 400;
const TRANSCRIPT = /\/projects\/([A-Za-z0-9._-]{1,200})\/([A-Za-z0-9._:-]{1,80})\.jsonl$/;

const printable = (s, n) => String(s).replace(/[^\x20-\x7e]/g, "").slice(0, n);
const str = (v, re) => (typeof v === "string" && re.test(v) ? v : undefined);

function sanitizeHook(input, ctx = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const ev = input.hook_event_name;
  if (!EVENTS.has(ev)) return null;
  const sid = str(input.session_id, ID);
  if (!sid) return null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  // The id only identifies one delivery (duplicate hook deliveries share it). It is a truncated
  // SHA-256 of the raw payload: not reversible, but it could confirm an exact guess of the whole
  // payload, which a process that can already read the transcripts could do anyway.
  const out = { v: 1, id: crypto.createHash("sha256").update(String(ctx.raw ?? JSON.stringify(input))).digest("hex").slice(0, 16), ts: now.toISOString(), src: "hook", ev, sid };

  const aid = str(input.agent_id, ID);
  if (aid) out.aid = aid;
  const atype = str(input.agent_type, TYPE);
  if (atype) out.atype = atype;
  if (typeof input.cwd === "string") {
    const base = printable(path.basename(input.cwd), 60);
    if (base) out.project = base;
  }
  const entry = str(ctx.entry, ENTRY);
  if (entry) out.entry = entry;
  if (typeof input.transcript_path === "string" && input.transcript_path.length <= MAX_TP && !input.transcript_path.includes("\0")) {
    const m = TRANSCRIPT.exec(input.transcript_path);
    if (m && m[2] === sid && m[1] !== "." && m[1] !== "..") out.tpd = m[1];
  }
  if (ev === "SessionStart") {
    const model = str(input.model && typeof input.model === "object" ? input.model.id : input.model, MODEL);
    if (model) out.model = model;
    const source = str(input.source, ENUM);
    if (source) out.source = source;
  }
  if (ev === "SessionEnd") {
    const reason = str(input.reason, ENUM);
    if (reason) out.reason = reason;
  }
  if (ev === "StopFailure") {
    const e = str(input.error_type, ENUM);
    if (e) out.errorType = e;
  }
  if (ev === "PostToolUse" || ev === "PostToolUseFailure") {
    const tool = str(input.tool_name, TOOL);
    if (tool) out.tool = tool;
    if (input.is_interrupt === true) out.interrupted = true;
  }
  return out;
}

module.exports = { sanitizeHook, EVENTS };
