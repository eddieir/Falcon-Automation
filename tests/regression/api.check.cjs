const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const API = require("../../src/core/APIClient");
const { root, temp } = require("./helpers.cjs");
async function server(t, handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}
test("API client sends headers and JSON payloads over real HTTP", async (t) => {
  const url = await server(t, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        method: req.method,
        authorization: req.headers.authorization,
        body: body ? JSON.parse(body) : null,
      }),
    );
  });
  const client = new API();
  assert.equal(
    (await client.get(url, { Authorization: "fixture" })).data.authorization,
    "fixture",
  );
  assert.deepEqual((await client.post(url, { hello: "world" })).data, {
    method: "POST",
    body: { hello: "world" },
  });
});
test("API client rejects HTTP failures", async (t) => {
  const url = await server(t, (_req, res) => {
    res.writeHead(503);
    res.end();
  });
  await assert.rejects(new API().get(url), (e) => e.response.status === 503);
});
function run(script, url, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, script)], {
      cwd,
      env: {
        ...process.env,
        API_BASE_URL: url,
        DB_HOST: "",
        DB_USER: "",
        DASHBOARD_URL: "",
      },
    });
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    const timer = setTimeout(() => child.kill(), 5000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}
for (const name of ["User", "Product"])
  for (const mode of [
    "success",
    "empty",
    "bad-schema",
    "wrong-record",
    "server-error",
  ]) {
    test(`${name} API scenario ${mode} reports correct process outcome`, async (t) => {
      const dir = temp();
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const item =
        name === "User"
          ? {
              id: 1,
              name: "Fixture",
              username: "fixture",
              email: "fixture@example.test",
            }
          : { id: 1, title: "Fixture", body: "fixture", userId: 1 };
      const url = await server(t, (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (mode === "server-error") {
          res.writeHead(500);
          res.end("{}");
          return;
        }
        if (req.method === "POST") {
          res.writeHead(201);
          res.end(JSON.stringify({ ...item, id: 101 }));
          return;
        }
        const isSingle = /\/1$/.test(req.url);
        let data = isSingle
          ? mode === "wrong-record"
            ? { ...item, id: 2 }
            : item
          : mode === "empty"
            ? []
            : [mode === "bad-schema" ? { id: 1 } : item];
        res.end(JSON.stringify(data));
      });
      const result = await run(`tests/api/${name}ApiTest.js`, url, dir);
      assert.equal(result.code, mode === "success" ? 0 : 1, result.output);
      const report = JSON.parse(
        fs.readFileSync(path.join(dir, "reports/test-report.json")),
      );
      assert.equal(
        report.tests[0].status,
        mode === "success" ? "passed" : "failed",
      );
    });
  }
