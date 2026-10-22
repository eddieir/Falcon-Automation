"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { sanitizeHook } = require("../lib/sanitize");
const { tmp, runHook, runHookAsync, readEvents } = require("./helpers");

const SECRET = "FAKE-CREDENTIAL-VALUE-123";
const payload = (o) => ({ session_id: "s-1", hook_event_name: "SessionStart", cwd: "/Users/someone/private/Project", transcript_path: "/Users/someone/.claude/projects/p/s-1.jsonl", model: "claude-sonnet-5-5", source: "startup", prompt: `my prompt ${SECRET}`, last_assistant_message: `reply ${SECRET}`, tool_input: { command: `echo ${SECRET}` }, tool_output: SECRET, env: { ANTHROPIC_API_KEY: SECRET }, ...o });

test("keeps only whitelisted fields and never prompt text, tool data or env values", () => {
  for (const ev of ["SessionStart", "SessionEnd", "Stop", "StopFailure", "SubagentStart", "SubagentStop", "PostToolUse", "PostToolUseFailure"]) {
    const out = sanitizeHook(payload({ hook_event_name: ev, agent_id: "a-1", agent_type: "developer", tool_name: "Bash", error_type: "rate_limit", reason: "other" }));
    assert.ok(out, ev);
    assert.ok(!JSON.stringify(out).includes(SECRET), ev);
    assert.ok(!("prompt" in out) && !("tool_input" in out) && !("last_assistant_message" in out) && !("env" in out));
    assert.ok(!JSON.stringify(out).includes("/Users/someone/private"), "cwd reduced to basename");
  }
  assert.strictEqual(sanitizeHook(payload({})).project, "Project");
});
test("rejects unknown events, bad ids and non-objects", () => {
  assert.strictEqual(sanitizeHook(payload({ hook_event_name: "UserPromptSubmit" })), null);
  assert.strictEqual(sanitizeHook(payload({ session_id: "../../etc/passwd" })), null);
  assert.strictEqual(sanitizeHook(payload({ session_id: "<script>" })), null);
  for (const v of [null, [], "x", 5]) assert.strictEqual(sanitizeHook(v), null);
});
test("hostile agent type, tool and model values are dropped, not stored", () => {
  const out = sanitizeHook(payload({ hook_event_name: "SubagentStart", agent_id: "a", agent_type: "<img src=x onerror=alert(1)>", model: "<script>alert(1)</script>" }));
  assert.ok(!("atype" in out));
  const t = sanitizeHook(payload({ hook_event_name: "PostToolUse", tool_name: "x\"><script>" }));
  assert.ok(!("tool" in t));
  assert.ok(!("model" in sanitizeHook(payload({ model: "<b>" }))));
});
test("event id is a truncated SHA-256 of the raw payload and the source never uses a weak hash", () => {
  const raw = JSON.stringify(payload({}));
  const a = sanitizeHook(JSON.parse(raw), { raw }), b = sanitizeHook(JSON.parse(raw), { raw: raw + " " });
  assert.match(a.id, /^[0-9a-f]{16}$/); assert.notStrictEqual(a.id, b.id);
  assert.strictEqual(a.id, require("crypto").createHash("sha256").update(raw).digest("hex").slice(0, 16));
  for (const f of ["lib/sanitize.js", "lib/store.js", "lib/usage.js", "server.js", "hook.js", "install.js"]) {
    assert.ok(!/createHash\(\s*["'](md5|sha1)["']/i.test(fs.readFileSync(path.join(__dirname, "..", f), "utf8")), `${f} must not use md5 or sha1`);
  }
});
test("identical delivery yields the same event id (dedupe key)", () => {
  const raw = JSON.stringify(payload({}));
  assert.strictEqual(sanitizeHook(JSON.parse(raw), { raw }).id, sanitizeHook(JSON.parse(raw), { raw }).id);
});
test("only the transcript's project directory name is stored, never a full path", () => {
  const ok = sanitizeHook(payload({}));
  assert.strictEqual(ok.tpd, "p"); assert.ok(!("tp" in ok)); assert.ok(!JSON.stringify(ok).includes("/Users/someone"));
  for (const bad of ["relative/x.jsonl", "/a/projects/p/other-session.jsonl", "/a/projects/../s-1.jsonl", "/a/projects/p/s-1.txt", "/a/projects/p/q/s-1.jsonl", "/a/projects/<x>/s-1.jsonl"]) {
    assert.ok(!("tpd" in sanitizeHook(payload({ transcript_path: bad }))), bad);
  }
});

test("hook: malformed JSON, empty stdin and unknown events exit 0 silently and write nothing", () => {
  const dir = tmp();
  for (const input of ["{not json", "", "[]", JSON.stringify({ hook_event_name: "Nope", session_id: "s" })]) {
    const r = runHook(input, dir);
    assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout, ""); assert.strictEqual(r.stderr, "");
  }
  assert.strictEqual(readEvents(dir).length, 0);
});
test("hook: writes one sanitized line and persists no secret or prompt text", () => {
  const dir = tmp();
  const r = runHook(payload({}), dir, { CLAUDE_CODE_ENTRYPOINT: "cli", ANTHROPIC_API_KEY: SECRET });
  assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout, "");
  const raw = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("");
  assert.ok(!raw.includes(SECRET) && !raw.includes("my prompt") && !raw.includes("reply "));
  const [e] = readEvents(dir);
  assert.strictEqual(e.ev, "SessionStart"); assert.strictEqual(e.entry, "cli");
});
test("hook: collector failure (unwritable data dir) never blocks Claude Code", () => {
  const base = tmp(); const blocker = path.join(base, "file"); fs.writeFileSync(blocker, "x");
  const t0 = Date.now();
  const r = runHook(payload({}), path.join(blocker, "sub")); // parent is a file: mkdir fails
  assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout, "");
  assert.ok(Date.now() - t0 < 1500, "returns promptly");
});
test("hook: oversized or hostile input exits 0 and stays bounded", () => {
  const dir = tmp();
  const huge = JSON.stringify(payload({ prompt: "A".repeat(2 * 1024 * 1024) }));
  const r = runHook(huge, dir);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(readEvents(dir).length, 0, "oversized payload discarded");
  const longCwd = runHook(payload({ cwd: "/" + "x".repeat(50000) }), dir);
  assert.strictEqual(longCwd.status, 0);
  for (const e of readEvents(dir)) assert.ok(JSON.stringify(e).length < 2000);
});
test("hook: 120 processes in waves of 20 concurrent writers append 120 intact lines", async () => {
  // Waves keep the test independent of machine load: under extreme CPU contention the
  // hook's 1.5 s watchdog may exit without writing (fail-open by design, documented).
  const dir = tmp(); const codes = [];
  for (let w = 0; w < 6; w++) codes.push(...await Promise.all(Array.from({ length: 20 }, (_, j) => runHookAsync(payload({ hook_event_name: "PostToolUse", agent_id: `a-${w * 20 + j}`, tool_name: "Read" }), dir))));
  assert.ok(codes.every((c) => c === 0));
  const lines = fs.readdirSync(dir).filter((f) => f.startsWith("events-")).flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean));
  assert.strictEqual(lines.length, 120);
  lines.forEach((l) => JSON.parse(l));
  assert.strictEqual(new Set(lines.map((l) => JSON.parse(l).aid)).size, 120);
});
