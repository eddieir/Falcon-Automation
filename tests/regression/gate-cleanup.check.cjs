"use strict";
// SIGINT and SIGTERM during a gate run stop every process it started
// (stand-ins for AI-agency, Falcon, the dashboard and their descendants),
// free every listener, and leave the working directory removable.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const driver = path.join(__dirname, "..", "fixtures", "customer-demo", "gateCleanupDriver.js");
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const listening = (port) => new Promise((resolve) => {
  const s = net.connect(port, "127.0.0.1");
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
});
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return fn();
};

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  test(`${signal} stops every process, frees the ports and leaves a removable directory`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-gate-cleanup-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const workDir = path.join(root, "work");
    const stubDir = path.join(root, "stub");
    fs.mkdirSync(stubDir);
    const ports = [await freePort(), await freePort(), await freePort(), await freePort()];
    const child = spawn(process.execPath, [driver, workDir, stubDir, ...ports.map(String)], { stdio: ["ignore", "pipe", "pipe"] });
    t.after(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } });
    const exited = new Promise((resolve) => child.on("exit", (c, s) => resolve({ c, s })));

    let buf = "";
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`driver not ready: ${buf}`)), 15000);
      child.stdout.on("data", (d) => {
        buf += d.toString();
        const m = buf.match(/READY (.*)\n/);
        if (m) { clearTimeout(timer); resolve(JSON.parse(m[1])); }
      });
    });
    assert.equal(ready.pids.length, 4);
    assert.ok(ready.pids.every(alive), "all four stand-in processes are running");
    for (const p of ports) assert.ok(await until(() => listening(p)), `port ${p} is listening`);

    child.kill(signal);
    const result = await exited;
    assert.equal(result.c, code, "the runner exits with the conventional signal code");
    assert.ok(await until(() => ready.pids.every((pid) => !alive(pid))), "no process of either tree is left");
    for (const p of ports) assert.equal(await until(async () => !(await listening(p))), true, `port ${p} is free`);
    fs.rmSync(workDir, { recursive: true, force: false });
    assert.equal(fs.existsSync(workDir), false, "the isolated working directory can be removed");
  });
}
