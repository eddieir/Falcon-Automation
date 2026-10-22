"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs"), path = require("path"), assert = require("assert");
const dir = __dirname, script = path.join(dir, "statusline.js");
// Reset times are relative to the real clock, so build that fixture at run time.
const now = Math.floor(Date.now() / 1000);
const c = JSON.parse(fs.readFileSync(path.join(dir, "fixtures", "complete.json"), "utf8"));
c.rate_limits.five_hour.resets_at = now + 8100 + 30;
c.rate_limits.seven_day.resets_at = now + 3 * 86400 + 30;
fs.writeFileSync(path.join(dir, "fixtures", "complete.generated.json"), JSON.stringify(c));
// Tests must never write into the real telemetry directory: point it at a path that does not exist.
const os = require("os");
const NO_TELEMETRY = path.join(os.tmpdir(), "falcon-statusline-test-none-" + process.pid);
const run = (f, env = {}) => spawnSync("node", [script], { input: fs.readFileSync(path.join(dir, "fixtures", f)), encoding: "utf8", env: { ...process.env, FALCON_TELEMETRY_DIR: NO_TELEMETRY, ...env } });
const T = [
  ["complete.generated.json", (o) => assert.match(o, /^Sonnet 5\.5 \| ctx 15% \(153k\/1\.0M\) \| 5h 24% r\d+h\d+ \| 7d 41% r3d \| t 1h23m \| est\$ 1\.23$/)],
  ["no-rate-limits.json", (o) => assert.match(o, /5h N\/A \| 7d N\/A/)],
  ["no-cost.json", (o) => assert.match(o, /est\$ N\/A/)],
  ["no-model.json", (o) => assert.match(o, /^model N\/A \|/)],
  ["zero-context.json", (o) => assert.match(o, /ctx 0% \(0\/N\/A\) .*t 0m .*est\$ 0\.00/)],
  ["malformed.json", (o) => assert.match(o, /^statusline: no data/)],
  ["empty.json", (o) => assert.match(o, /^statusline: no data/)],
  ["array.json", (o) => assert.match(o, /^statusline: no data/)],
  ["future-fields.json", (o) => { assert.match(o, /^Sonnet 5\.5\[31m \| ctx 100% \(N\/A\/N\/A\) \| 5h N\/A \| 7d N\/A/); assert(!o.includes("\x1b")); }],
  ["complete.generated.json", (o) => { assert(!/FIXTURE-SESSION-ID|\/path\/not\/shown/.test(o)); }],
];
let fail = 0;
// Snapshot: written only when the telemetry dir exists; numeric fields + session id only.
{
  const tdir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-statusline-snap-"));
  try {
    const r = run("complete.generated.json", { FALCON_TELEMETRY_DIR: tdir });
    const files = fs.readdirSync(tdir).filter((f) => f.startsWith("snapshots-"));
    assert.strictEqual(r.status, 0); assert.strictEqual(files.length, 1);
    const row = JSON.parse(fs.readFileSync(path.join(tdir, files[0]), "utf8").trim());
    assert.strictEqual(row.sid, "FIXTURE-SESSION-ID"); assert.strictEqual(row.h5Pct, 23.5);
    for (const [k, v] of Object.entries(row)) assert.ok(v === null || typeof v === "number" || ["ts", "sid", "model"].includes(k), k);
    assert(!/Users|private/.test(JSON.stringify(row)));
    console.log("PASS snapshot row is numeric-only and written only to the override dir");
    const none = run("complete.generated.json"); assert.strictEqual(fs.existsSync(NO_TELEMETRY), false); assert.strictEqual(none.status, 0);
    console.log("PASS no snapshot written when the telemetry dir does not exist");
  } catch (e) { fail++; console.log("FAIL snapshot", e.message.split("\n")[0]); }
  fs.rmSync(tdir, { recursive: true, force: true });
}
for (const [f, check] of T) {
  const r = run(f);
  try { assert.strictEqual(r.status, 0); assert.strictEqual(r.stderr, ""); assert.strictEqual(r.stdout.split("\n").length, 2); check(r.stdout.trim()); console.log("PASS", f, "->", r.stdout.trim()); }
  catch (e) { fail++; console.log("FAIL", f, e.message.split("\n")[0], "|", r.stdout.trim()); }
}
const t = process.hrtime.bigint(); const N = 20;
for (let i = 0; i < N; i++) run("complete.generated.json");
console.log(`avg wall per invocation (node startup incl.): ${(Number(process.hrtime.bigint() - t) / 1e6 / N).toFixed(0)} ms`);
fs.rmSync(path.join(dir, "fixtures", "complete.generated.json"), { force: true }); // generated at run time, never kept
process.exit(fail ? 1 : 0);
