// Regression for Sec-01 F1/F2: the pinned DNS lookup must satisfy Node's
// real { all: true } contract, and a 204/205 reply must reject, not crash.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createGuardedFetch } = require("../../src/core/llm/transport/guardedFetch");

function listen(handler, address = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.once("error", reject);
    srv.listen(0, address, () => resolve(srv));
  });
}

// Real http.request (so Node itself calls options.lookup with its own
// options), but tell it to use the pinned lookup and plain http to loopback.
const seenOptions = [];
function loopbackRequest(opts, cb) {
  seenOptions.push({ servername: opts.servername, rejectUnauthorized: opts.rejectUnauthorized });
  const o = { ...opts, agent: new http.Agent({ keepAlive: false }) };
  delete o.rejectUnauthorized;
  delete o.servername;
  return http.request(o, cb);
}

async function run(handler, { address = "127.0.0.1", family = 4, host = "llm.example.test" } = {}) {
  const srv = await listen(handler, address);
  const port = srv.address().port;
  const lookup = (_h, _o, cb) => cb(null, [{ address, family }]);
  const base = `https://${host}:${port}/v1`;
  const f = createGuardedFetch({
    baseUrl: base,
    policyOpts: { allowLoopback: true, extraAllowedPorts: [port] },
    timeoutMs: 3000,
    maxResponseBytes: 4096,
    deps: { lookup, httpsRequest: loopbackRequest },
  });
  try {
    return await f(`${base}/chat/completions`, { method: "POST", headers: {}, body: "{}" });
  } finally {
    srv.close();
  }
}

test("hostname endpoint connects through the pinned lookup (Node { all: true } contract)", async () => {
  const res = await run((_q, r) => { r.writeHead(200, { "content-type": "application/json" }); r.end("{}"); });
  assert.equal(res.status, 200);
});

test("204 reply rejects with MALFORMED_RESPONSE instead of crashing the process", async () => {
  await assert.rejects(
    run((_q, r) => { r.writeHead(204); r.end(); }),
    (e) => e.llmCode === "MALFORMED_RESPONSE",
  );
});

test("DNS name: real hostname is the TLS server name and certificate verification is on", async () => {
  seenOptions.length = 0;
  const res = await run((_q, r) => { r.writeHead(200, { "content-type": "application/json" }); r.end("{}"); });
  assert.equal(res.status, 200);
  assert.deepEqual(seenOptions.at(-1), { servername: "llm.example.test", rejectUnauthorized: true });
});

test("IPv6 pinned address works through the { all: true } contract", async (t) => {
  let res;
  try {
    res = await run((_q, r) => { r.writeHead(200, { "content-type": "application/json" }); r.end("{}"); },
      { address: "::1", family: 6 });
  } catch (e) {
    if (e && e.llmCode === "NETWORK_ERROR" && !require("node:os").networkInterfaces().lo0?.some((i) => i.family === "IPv6")) {
      t.skip("no IPv6 loopback on this host");
      return;
    }
    throw e;
  }
  assert.equal(res.status, 200);
});

test("IP-literal endpoint sends no server name (certificate checked against the IP)", async () => {
  seenOptions.length = 0;
  const srv = await listen((_q, r) => { r.writeHead(200); r.end("{}"); });
  const port = srv.address().port;
  const base = `https://127.0.0.1:${port}/v1`;
  const f = createGuardedFetch({
    baseUrl: base,
    policyOpts: { allowLoopback: true, extraAllowedPorts: [port] },
    timeoutMs: 3000, maxResponseBytes: 4096,
    deps: { httpsRequest: loopbackRequest },
  });
  try {
    const res = await f(`${base}/chat/completions`, { method: "POST", headers: {}, body: "{}" });
    assert.equal(res.status, 200);
  } finally { srv.close(); }
  assert.equal(seenOptions.at(-1).servername, undefined);
  assert.equal(seenOptions.at(-1).rejectUnauthorized, true);
});
