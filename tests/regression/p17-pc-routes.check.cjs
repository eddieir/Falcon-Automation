/**
 * tests/regression/p17-pc-routes.check.cjs — route/shape regression tests
 * for src/production-cycle/Server.js (ADR-0018 sec.7, Sec-00b D-08/D-09/
 * D-12/D-17/D-21).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const Server = require("../../src/production-cycle/Server");
const EventLog = require("../../src/production-cycle/EventLog");

function makeDraft(overrides) {
  return Object.assign(
    {
      runId: "run1",
      type: "dispatch_created",
      phase: "P1",
      taskId: "Dev-01",
      packetId: null,
      fromRole: "coordinator",
      toRole: "developer",
      requestedLabel: null,
      resolvedModelId: null,
      observedModelId: null,
      targetRevision: "UNKNOWN",
      status: "PENDING",
      verdict: null,
      summary: "test event",
      evidenceRefs: [],
      openRisks: [],
      dispatchIndex: null,
      dispatchTotal: null,
      retryCount: null,
      attempt: null,
      invalidates: [],
    },
    overrides
  );
}

async function mkRunDir() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "p17-pc-routes-"));
  const runDir = path.join(root, "run1");
  await fsp.mkdir(runDir, { recursive: true });
  return { root, runDir };
}

function request(port, pathAndQuery, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathAndQuery,
        method: options.method || "GET",
        headers: Object.assign({ Host: `127.0.0.1:${port}` }, options.headers),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function startServer(runDir, extra = {}) {
  const instance = Server.create(Object.assign({ runDir, port: 0, host: "127.0.0.1" }, extra));
  const bound = await instance.listen();
  return { instance, port: bound.port };
}

test("GET / returns 200 html with per-response nonce and security headers", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  const { instance, port } = await startServer(runDir);
  try {
    const r1 = await request(port, "/");
    const r2 = await request(port, "/");
    assert.equal(r1.status, 200);
    assert.match(r1.headers["content-type"], /text\/html/);
    const csp1 = r1.headers["content-security-policy"];
    const csp2 = r2.headers["content-security-policy"];
    assert.match(csp1, /script-src 'nonce-[A-Za-z0-9+/=]+'/);
    assert.notEqual(csp1, csp2, "nonce must differ per response");
    assert.equal(r1.headers["x-content-type-options"], "nosniff");
    assert.equal(r1.headers["x-frame-options"], "DENY");
    assert.equal(r1.headers["referrer-policy"], "no-referrer");
    assert.equal(r1.headers["cross-origin-opener-policy"], "same-origin");
    assert.equal(r1.headers["cross-origin-resource-policy"], "same-origin");
    assert.equal(r1.headers["cache-control"], "no-store");
  } finally {
    await instance.close();
  }
});

test("GET /api/state returns combined shape", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  await EventLog.appendEvent(runDir, makeDraft({ taskId: "Dev-01" }));
  const { instance, port } = await startServer(runDir);
  try {
    const r = await request(port, "/api/state");
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /application\/json/);
    const data = JSON.parse(r.body);
    assert.equal(typeof data.run, "object");
    assert.equal(data.run.present, true);
    assert.equal(data.run.tampered, false);
    assert.equal(typeof data.run.malformedCount, "number");
    assert.equal(typeof data.run.partialBytes, "number");
    assert.equal(typeof data.run.lastSeq, "number");
    assert.ok(Array.isArray(data.events));
    assert.equal(data.events.length, 1);
    assert.equal(typeof data.roles, "object");
  } finally {
    await instance.close();
  }
});

test("405 matrix: non-GET methods return Allow: GET", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  const { instance, port } = await startServer(runDir);
  try {
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
      const r = await request(port, "/api/state", { method });
      assert.equal(r.status, 405, `method ${method}`);
      assert.equal(r.headers.allow, "GET");
    }
    // HEAD responses never carry a body per HTTP semantics, so only the
    // status/Allow header are checked for it.
    const rHead = await request(port, "/api/state", { method: "HEAD" });
    assert.equal(rHead.status, 405);
    assert.equal(rHead.headers.allow, "GET");
  } finally {
    await instance.close();
  }
});

test("GET with a body is rejected with 405", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  const { instance, port } = await startServer(runDir);
  try {
    const r = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/state",
          method: "GET",
          headers: { Host: `127.0.0.1:${port}`, "Content-Length": "4" },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode }));
        }
      );
      req.on("error", () => resolve({ status: null }));
      req.write("body");
      req.end();
    });
    assert.ok(r.status === 405 || r.status === null);
  } finally {
    await instance.close();
  }
});

test("unknown path returns 404 with fixed JSON code", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  const { instance, port } = await startServer(runDir);
  try {
    const r = await request(port, "/nope");
    assert.equal(r.status, 404);
    const data = JSON.parse(r.body);
    assert.deepEqual(data, { error: "NOT_FOUND" });
  } finally {
    await instance.close();
  }
});

test("query allowlist: unknown key on /api/state is 400", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  const { instance, port } = await startServer(runDir);
  try {
    const r = await request(port, "/api/state?bogus=1");
    assert.equal(r.status, 400);
    assert.deepEqual(JSON.parse(r.body), { error: "BAD_QUERY_KEY" });
  } finally {
    await instance.close();
  }
});

test("cursor paging via from/limit", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  for (let i = 0; i < 3; i++) {
    await EventLog.appendEvent(runDir, makeDraft({ taskId: `Dev-0${i + 1}` }));
  }
  const { instance, port } = await startServer(runDir);
  try {
    const r = await request(port, "/api/state?from=1&limit=1");
    assert.equal(r.status, 200);
    const data = JSON.parse(r.body);
    assert.equal(data.events.length, 1);
    assert.equal(data.events[0].seq, 2);
  } finally {
    await instance.close();
  }
});

test("empty/missing ledger reports present:false with no crash", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  const { instance, port } = await startServer(runDir);
  try {
    const r = await request(port, "/api/state");
    assert.equal(r.status, 200);
    const data = JSON.parse(r.body);
    assert.equal(data.run.present, false);
    assert.deepEqual(data.events, []);
  } finally {
    await instance.close();
  }
});

test("partial last line: complete events returned, partialBytes counted, no content leak", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  await EventLog.appendEvent(runDir, makeDraft({ taskId: "Dev-01" }));
  const eventsPath = path.join(runDir, "events.jsonl");
  await fsp.appendFile(eventsPath, '{"partial":"SECRETVALUE_notcomplete');
  const { instance, port } = await startServer(runDir);
  try {
    const r = await request(port, "/api/state");
    const data = JSON.parse(r.body);
    assert.equal(data.events.length, 1);
    assert.ok(data.run.partialBytes > 0);
    assert.ok(!r.body.includes("SECRETVALUE_notcomplete"));

    await EventLog.appendEvent(runDir, makeDraft({ taskId: "Dev-02" }));
  } finally {
    await instance.close();
  }
});

test("malformed + tampered raw-append: counts/flags only, no content echoed", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  await EventLog.appendEvent(runDir, makeDraft({ taskId: "Dev-01" }));
  const eventsPath = path.join(runDir, "events.jsonl");
  await fsp.appendFile(eventsPath, '{"not":"valid","secretMarker":"RAWBADLINE123"}\n');
  const { instance, port } = await startServer(runDir);
  try {
    const r = await request(port, "/api/state");
    const data = JSON.parse(r.body);
    assert.ok(data.run.malformedCount >= 1);
    assert.ok(!r.body.includes("RAWBADLINE123"));
  } finally {
    await instance.close();
  }
});

test("path-attack subset and no filesystem route", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  const { instance, port } = await startServer(runDir);
  try {
    for (const p of ["/api/../../.git/config", "/%2e%2e/HEAD", "/package.json", "/.git/config"]) {
      const r = await request(port, p);
      assert.equal(r.status, 404, `path ${p}`);
    }
    const r2 = await request(port, "/?run=x");
    assert.equal(r2.status, 400);
  } finally {
    await instance.close();
  }
});

test("markers M07-M10 never appear in any response body or header", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  const eventsPath = path.join(runDir, "events.jsonl");
  await fsp.writeFile(
    eventsPath,
    '{"secret":"M07-SECRET-TOKEN"}\n{"bad":"M08-MARKER"}\n{"x":"M09-MARKER\n{"y":"M10-MARKER"}\n'
  );
  const { instance, port } = await startServer(runDir);
  try {
    const r1 = await request(port, "/api/state");
    const r2 = await request(port, "/");
    for (const marker of ["M07-SECRET-TOKEN", "M08-MARKER", "M09-MARKER", "M10-MARKER"]) {
      assert.ok(!r1.body.includes(marker), `api/state leaked ${marker}`);
      assert.ok(!r2.body.includes(marker), `/ leaked ${marker}`);
      assert.ok(!JSON.stringify(r1.headers).includes(marker), `headers leaked ${marker}`);
    }
  } finally {
    await instance.close();
  }
});

test("D-19: non-loopback host rejected at create", { timeout: 8000 }, async () => {
  const { runDir } = await mkRunDir();
  assert.throws(() => {
    Server.create({ runDir, port: 0, host: "0.0.0.0" });
  });
});
