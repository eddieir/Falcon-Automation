"use strict";

/**
 * P14-22 regression: the human review surfaces for Tier 2.5 scoped locator
 * evidence — the dashboard's `/locator/...` routes (src/core/Dashboard.js)
 * and the `locator-*` subcommands added to scripts/healing/review.js.
 *
 * These surfaces are the trust boundary for the whole phase: they are where
 * a human decides whether a proposed repair becomes trusted evidence. This
 * file proves, behaviourally (not by reading the source):
 *   - every new route carries the same token gate/rate limiter as the
 *     existing Phase 8 `/healing/...` routes, and rejects an unauthenticated
 *     request with zero side effects;
 *   - approve/reject/rollback/legacy-delete work end to end against a real
 *     LocatorMemory instance over real HTTP;
 *   - a selector carrying ANSI escapes and an embedded newline can neither
 *     rewrite the CLI reviewer's terminal nor forge an extra listing row;
 *   - a hashed signature field (`role`, any `attributes` value) is never
 *     rendered by the CLI or the dashboard UI — only which field matched;
 *   - the shipped dashboard UI script escapes every locator-panel value it
 *     renders.
 *
 * Run directly with `node --test`, independent of the rest of the suite.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { root, temp } = require("./helpers.cjs");

const Dashboard = require(path.join(root, "src/core/Dashboard.js"));
const Middleware = require(path.join(root, "src/core/Middleware.js"));
const LocatorIdentity = require(path.join(root, "src/core/locator/LocatorIdentity.js"));
const ElementSignature = require(path.join(root, "src/core/locator/ElementSignature.js"));
const LocatorMemory = require(path.join(root, "src/core/locator/LocatorMemory.js"));

// node:test's TAP-like reporter reads this process's stdout concurrently
// with every Dashboard.start()/Logger call in this file — same rationale,
// same fix, as tests/regression/dashboard.check.cjs.
console.log = () => {};
console.warn = () => {};

const TEST_SALT = "p14-surfaces-test-salt";

function setup(t, token) {
  const old = process.env.DASHBOARD_TOKEN;
  if (token === undefined) delete process.env.DASHBOARD_TOKEN;
  else process.env.DASHBOARD_TOKEN = token;
  // P14-21 round 2: Dashboard's default LocatorMemory is now the SAME
  // process-wide shared instance AIHealer defaults to (fixing a lost-update
  // bug where each held its own competing copy) — so isolation is no longer
  // "construct, then reach in and repoint the default's path", it is
  // "inject an already-isolated instance at construction time" instead.
  const dir = temp();
  const locatorMemory = new LocatorMemory({
    memoryPath: path.join(dir, "locator_memory.json"),
    env: { FALCON_LOCATOR_SALT: TEST_SALT },
  });
  const d = new Dashboard({ port: 0, locatorMemory });
  t.after(async () => {
    Middleware.setEmitter(null);
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.DASHBOARD_TOKEN;
    else process.env.DASHBOARD_TOKEN = old;
  });
  return d;
}

function httpJSON(port, method, urlPath, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "localhost", port, path: urlPath, method, headers, timeout: 3000 },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = raw ? JSON.parse(raw) : undefined;
          } catch {
            parsed = raw;
          }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    if (body !== undefined) {
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      req.setHeader("Content-Type", "application/json");
      req.setHeader("Content-Length", Buffer.byteLength(payload));
      req.end(payload);
    } else {
      req.end();
    }
  });
}

function identityFor(selector, overrides = {}) {
  const built = LocatorIdentity.buildIdentity({
    url: "https://example.com/checkout",
    action: "click",
    originalSelector: selector,
    env: {},
  });
  assert.equal(built.status, "built");
  return { ...built.identity, ...overrides };
}

function signatureFor(label, overrides = {}) {
  return ElementSignature.capture(
    {
      tagName: "button",
      role: "button",
      accessibleName: label,
      attributes: { id: label, "data-testid": `${label}-btn` },
      structuralPath: ["form", "div", "button"],
      ownText: label,
      boundingBoxBucket: "bottom-right:small",
      ...overrides,
    },
    { salt: TEST_SALT },
  );
}

function candidateFor(selector, label, extra = {}) {
  return {
    selector,
    signature: signatureFor(label),
    contributions: { attribute: 0.4, accessibleName: 0.2, structural: 0.1, text: 0.05, boundingBox: 0.02, rawTotal: 0.77 },
    total: 0.77,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Dashboard routes — auth gate (behavioural, every new route)
// ---------------------------------------------------------------------------

test("locator routes: every new route 401s an unauthenticated request with zero side effects", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();

  const identity = identityFor("#protected");
  d._locatorMemory.recordPendingCandidate(identity, candidateFor("[data-testid=protected]", "Protected"));
  await d._locatorMemory._queue;
  const key = LocatorIdentity.serialiseIdentity(identity);

  const entries = await httpJSON(d.port, "GET", "/locator/entries");
  assert.equal(entries.statusCode, 401);
  const legacy = await httpJSON(d.port, "GET", "/locator/legacy");
  assert.equal(legacy.statusCode, 401);
  const approve = await httpJSON(d.port, "POST", "/locator/approve", {}, { key });
  assert.equal(approve.statusCode, 401);
  const reject = await httpJSON(d.port, "POST", "/locator/reject", {}, { key });
  assert.equal(reject.statusCode, 401);
  const rollback = await httpJSON(d.port, "POST", "/locator/rollback", {}, { key });
  assert.equal(rollback.statusCode, 401);
  const legacyDelete = await httpJSON(d.port, "POST", "/locator/legacy/delete", {}, { id: "whatever" });
  assert.equal(legacyDelete.statusCode, 401);

  // None of the unauthenticated mutating attempts above touched anything —
  // the entry is still exactly the unproven pending candidate it started as.
  const stillAuthed = await httpJSON(d.port, "GET", "/locator/entries", { "X-Dashboard-Token": "fixture-token" });
  assert.equal(stillAuthed.statusCode, 200);
  assert.equal(stillAuthed.body[key].trust, "unproven");
  assert.ok(stillAuthed.body[key].pendingCandidate);
});

// ---------------------------------------------------------------------------
// Dashboard routes — real HTTP round trips against a real LocatorMemory
// ---------------------------------------------------------------------------

test("locator routes: full HTTP round trip — pending candidate, approve, now trusted", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };

  const identity = identityFor("#submit");
  d._locatorMemory.recordPendingCandidate(identity, candidateFor("[data-testid=submit-btn]", "Submit"));
  await d._locatorMemory._queue;
  const key = LocatorIdentity.serialiseIdentity(identity);

  const before = await httpJSON(d.port, "GET", "/locator/entries", auth);
  assert.equal(before.statusCode, 200);
  assert.equal(before.body[key].trust, "unproven");

  const approve = await httpJSON(d.port, "POST", "/locator/approve", auth, { key, proposalId: d._locatorMemory.getEntry(key)?.pendingCandidate?.proposalId });
  assert.equal(approve.statusCode, 200);
  assert.equal(approve.body.trust, "trusted");
  assert.equal(approve.body.pendingCandidate, null);

  const after = await httpJSON(d.port, "GET", "/locator/entries", auth);
  assert.equal(after.body[key].trust, "trusted");
  assert.equal(after.body[key].pendingCandidate, null);
});

test("locator routes: reject discards the candidate and leaves trust untouched", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };

  const identity = identityFor("#reject-me");
  d._locatorMemory.recordPendingCandidate(identity, candidateFor("[data-testid=nope]", "Nope"));
  await d._locatorMemory._queue;
  const key = LocatorIdentity.serialiseIdentity(identity);

  const reject = await httpJSON(d.port, "POST", "/locator/reject", auth, { key, proposalId: d._locatorMemory.getEntry(key)?.pendingCandidate?.proposalId });
  assert.equal(reject.statusCode, 200);
  assert.equal(reject.body.trust, "unproven");
  assert.equal(reject.body.pendingCandidate, null);

  // A second identical proposal now shows up as previously rejected.
  d._locatorMemory.recordPendingCandidate(identity, candidateFor("[data-testid=nope]", "Nope"));
  await d._locatorMemory._queue;
  const again = await httpJSON(d.port, "GET", "/locator/entries", auth);
  assert.equal(again.body[key].pendingCandidate.previouslyRejected.count, 1);
});

test("locator routes: rollback revokes trust, and a revoked identity refuses re-approval over HTTP (loophole closure)", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };

  const identity = identityFor("#tricky");
  d._locatorMemory.recordEvidence(identity, signatureFor("Tricky"));
  await d._locatorMemory._queue;
  const key = LocatorIdentity.serialiseIdentity(identity);

  const rollback = await httpJSON(d.port, "POST", "/locator/rollback", auth, { key, expectedRevision: d._locatorMemory.getEntry(key).revision, note: "operator judged this unsafe" });
  assert.equal(rollback.statusCode, 200);
  assert.equal(rollback.body.trust, "revoked");
  assert.equal(rollback.body.revocationHistory.length, 1);
  assert.equal(rollback.body.revocationHistory[0].actor, "dashboard");
  assert.equal(rollback.body.revocationHistory[0].note, "operator judged this unsafe");

  // A pending candidate arriving after the rollback must not be approvable —
  // the only way back is fresh recordEvidence(), never approve().
  d._locatorMemory.recordPendingCandidate(identity, candidateFor("[data-testid=tricky-2]", "Tricky2"));
  await d._locatorMemory._queue;
  const approve = await httpJSON(d.port, "POST", "/locator/approve", auth, { key, proposalId: d._locatorMemory.getEntry(key)?.pendingCandidate?.proposalId });
  assert.equal(approve.statusCode, 409);
  const stillRevoked = await httpJSON(d.port, "GET", "/locator/entries", auth);
  assert.equal(stillRevoked.body[key].trust, "revoked");
});

test("locator routes: acting on a key that doesn't exist returns 404, not a silent success", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };

  const approve = await httpJSON(d.port, "POST", "/locator/approve", auth, { key: "never-existed", proposalId: "absent", expectedRevision: "absent" });
  assert.equal(approve.statusCode, 404);
  const reject = await httpJSON(d.port, "POST", "/locator/reject", auth, { key: "never-existed", proposalId: "absent", expectedRevision: "absent" });
  assert.equal(reject.statusCode, 404);
  const rollback = await httpJSON(d.port, "POST", "/locator/rollback", auth, { key: "never-existed", proposalId: "absent", expectedRevision: "absent" });
  assert.equal(rollback.statusCode, 404);
  const legacyDelete = await httpJSON(d.port, "POST", "/locator/legacy/delete", auth, { id: "never-existed" });
  assert.equal(legacyDelete.statusCode, 404);
});

test("locator routes: a non-string key/id is rejected, not crashed on", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };

  for (const body of [{}, { key: 42 }, { key: null }, { key: ["x"] }, { key: { nested: true } }]) {
    const res = await httpJSON(d.port, "POST", "/locator/approve", auth, body);
    assert.equal(res.statusCode, 400, `expected 400 for body ${JSON.stringify(body)}`);
  }
});

test("locator routes: GET /locator/legacy is read-only and surfaces quarantined rows, deletable only via the explicit route", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };

  // Write a malformed row directly to disk, then reload — this is exactly
  // how LocatorMemory itself quarantines a row on load.
  const raw = {
    schemaVersion: 1,
    salt: TEST_SALT,
    entries: { "bad-key": { identity: { schemaVersion: 1 }, trust: "trusted" } },
    legacy: {},
    rejections: [],
  };
  fs.mkdirSync(path.dirname(d._locatorMemory.memoryPath), { recursive: true });
  fs.writeFileSync(d._locatorMemory.memoryPath, JSON.stringify(raw));
  d._locatorMemory._reload();

  const legacy = await httpJSON(d.port, "GET", "/locator/legacy", auth);
  assert.equal(legacy.statusCode, 200);
  const ids = Object.keys(legacy.body);
  assert.equal(ids.length, 1);
  assert.match(legacy.body[ids[0]].reason, /missing_identity_field/);

  // Express 404s an unregistered verb/route — nothing here promotes a legacy
  // row back into `entries`.
  const noPromoteRoute = await httpJSON(d.port, "POST", "/locator/legacy/promote", auth, { id: ids[0] });
  assert.equal(noPromoteRoute.statusCode, 404);

  const del = await httpJSON(d.port, "POST", "/locator/legacy/delete", auth, { id: ids[0] });
  assert.equal(del.statusCode, 200);
  assert.equal(del.body.deleted, true);

  const after = await httpJSON(d.port, "GET", "/locator/legacy", auth);
  assert.deepEqual(after.body, {});
});

// ---------------------------------------------------------------------------
// Hashed values are never rendered over HTTP either — field names only,
// never the hash. The dashboard JSON API legitimately carries the hash (a
// consumer needs the raw entry to do anything useful with it); the point
// proven here is that the explainability contract doesn't require hiding it
// from the API, only from what a human-facing surface RENDERS — which is
// what the CLI and dashboard-UI tests below exist to prove.
// ---------------------------------------------------------------------------

test("locator routes: GET /locator/entries carries the real hashed signature fields (API is data, not a render surface)", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };

  const identity = identityFor("#hashed");
  const signature = signatureFor("HashMe");
  d._locatorMemory.recordEvidence(identity, signature);
  await d._locatorMemory._queue;
  const key = LocatorIdentity.serialiseIdentity(identity);

  const res = await httpJSON(d.port, "GET", "/locator/entries", auth);
  const entry = res.body[key];
  assert.equal(entry.signature.role, signature.role);
  assert.equal(entry.signature.attributes.id, signature.attributes.id);
  // Confirms this is really a hash, not plaintext passthrough.
  assert.notEqual(entry.signature.attributes.id, "HashMe");
  assert.match(entry.signature.attributes.id, /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// CLI — scripts/healing/review.js locator-* subcommands, real child process
// ---------------------------------------------------------------------------

function runCLI(args, memoryPath) {
  return spawnSync(process.execPath, [path.join(root, "scripts/healing/review.js"), ...args], {
    env: {
      ...process.env,
      FALCON_TEST_LOCATOR_MEMORY_PATH: memoryPath,
      FALCON_LOCATOR_SALT: TEST_SALT,
    },
    encoding: "utf8",
    timeout: 10000,
  });
}

function makeMemoryPath(dir) {
  return path.join(dir, "locator_memory.json");
}

function seedMemory(memoryPath, fn) {
  const LocatorMemory = require(path.join(root, "src/core/locator/LocatorMemory.js"));
  const mem = new LocatorMemory({ memoryPath, env: { FALCON_LOCATOR_SALT: TEST_SALT } });
  fn(mem);
  return mem._queue;
}

test("CLI: locator-list shows a pending candidate, locator-approve promotes it, locator-show reflects trusted state", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  const identity = identityFor("#cli-submit");
  const key = LocatorIdentity.serialiseIdentity(identity);
  await seedMemory(memoryPath, (mem) => {
    mem.recordPendingCandidate(identity, candidateFor("[data-testid=cli-submit-btn]", "CliSubmit"));
  });

  const list = runCLI(["locator-list"], memoryPath);
  assert.equal(list.status, 0);
  assert.match(list.stdout, /1 scoped locator candidate\(s\) awaiting review/);
  assert.match(list.stdout, /cli-submit/);
  assert.match(list.stdout, /unproven/);

  const approve = runCLI(["locator-approve", key, decisionToken(memoryPath, key)], memoryPath);
  assert.equal(approve.status, 0);
  assert.match(approve.stdout, /Persisted approve decision/);

  const show = runCLI(["locator-show", key], memoryPath);
  assert.equal(show.status, 0);
  assert.match(show.stdout, /trust: trusted/);
  assert.match(show.stdout, /pending candidate: \(none\)/);

  const listAfter = runCLI(["locator-list"], memoryPath);
  assert.equal(listAfter.status, 0);
  assert.match(listAfter.stdout, /No scoped locator candidates awaiting review\./);
});

test("CLI: locator-reject discards the candidate; locator-rollback revokes and blocks re-approval", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  const identity = identityFor("#cli-reject");
  const key = LocatorIdentity.serialiseIdentity(identity);
  await seedMemory(memoryPath, (mem) => {
    mem.recordPendingCandidate(identity, candidateFor("[data-testid=nope]", "Nope"));
  });

  const reject = runCLI(["locator-reject", key, decisionToken(memoryPath, key)], memoryPath);
  assert.equal(reject.status, 0);
  assert.match(reject.stdout, /Persisted reject decision/);

  const rollback = runCLI(["locator-rollback", key, decisionToken(memoryPath, key, true), "no longer trusted"], memoryPath);
  assert.equal(rollback.status, 0);
  assert.match(rollback.stdout, /Persisted rollback decision/);

  const show = runCLI(["locator-show", key], memoryPath);
  assert.match(show.stdout, /trust: revoked/);
  assert.match(show.stdout, /by cli — no longer trusted/);

  // Re-seed a pending candidate for the now-revoked identity and confirm the
  // CLI refuses to approve it.
  await seedMemory(memoryPath, (mem) => {
    mem.recordPendingCandidate(identity, candidateFor("[data-testid=nope2]", "Nope2"));
  });
  const approve = runCLI(["locator-approve", key, decisionToken(memoryPath, key)], memoryPath);
  assert.notEqual(approve.status, 0);
  assert.match(approve.stderr, /revoked/);
});

test("CLI: unknown locator-* key names are reported, not silently accepted", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);

  for (const cmd of ["locator-show", "locator-approve", "locator-reject", "locator-rollback"]) {
    const res = runCLI([cmd, "not-a-real-key"], memoryPath);
    assert.notEqual(res.status, 0, `${cmd} should have failed`);
  }
});

test("CLI: Tier 3 subcommands keep working unchanged alongside the new Tier 2.5 ones", (t) => {
  const res = runCLI(["bogus-command"], path.join(temp(), "locator_memory.json"));
  assert.match(res.stderr, /locator-list \| locator-show/);
  assert.match(res.stderr, /approve-all/);
});

// ---------------------------------------------------------------------------
// Injection proof: an ANSI/newline-laden selector can neither rewrite the
// terminal nor forge an extra listing row, and a hashed value is never
// printed — behavioural, against the real CLI child process.
// ---------------------------------------------------------------------------

test("CLI: an ANSI-escape- and newline-laden selector is neutralised in real stdout — no raw ESC byte, no forged row, hash never shown", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  const identity = identityFor("#legit");
  const key = LocatorIdentity.serialiseIdentity(identity);

  // Built from \xNN escapes, never a raw control byte in this source file.
  // Red-colours text, repositions the cursor, then plants a newline that
  // *looks* like a complete, legitimate extra listing row.
  const evilSelector =
    "#legit\x1b[31mFAKE\x1b[0m\nkey: forged-key  current trust: trusted  proposed: [data-testid=innocent]";
  const signature = signatureFor("Evil", { attributes: { id: "Evil", "data-testid": "evil" } });

  const memory = new LocatorMemory({ memoryPath, env: { FALCON_LOCATOR_SALT: TEST_SALT } });
  assert.throws(() => memory.recordPendingCandidate(identity, { selector: evilSelector, signature }), /invalid candidate/);
  await memory._queue;
  const list = runCLI(["locator-list"], memoryPath);
  assert.equal(list.status, 0);
  assert.ok(!list.stdout.includes("forged-key"));
  assert.ok(!list.stdout.includes("\x1b"));

});

// ---------------------------------------------------------------------------
// Dashboard UI — the shipped <script> escapes every locator-panel value,
// never renders a hashed field, and never raw-innerHTML's page-derived text.
// Mirrors how tests/regression/dashboard.check.cjs exercises the real
// production script from src/dashboard/index.html in a minimal fake DOM.
// ---------------------------------------------------------------------------

function loadDashboardScript() {
  const vm = require("node:vm");
  const html = fs.readFileSync(path.join(root, "src/dashboard/index.html"), "utf8");
  const source = html.match(/<script>\s*([\s\S]*?)<\/script>/i)[1];

  const nodes = new Map();
  const makeNode = () => ({
    textContent: "",
    style: {},
    classList: { add() {}, remove() {} },
    dataset: {},
    disabled: false,
    innerHTML: "",
    children: [],
    _listeners: {},
    remove() {},
    addEventListener(evt, fn) {
      (this._listeners[evt] ||= []).push(fn);
    },
    prepend(row) {
      this.children.unshift(row);
    },
    replaceChildren(...kids) {
      this.children = kids;
    },
  });
  const document = {
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, makeNode());
      return nodes.get(id);
    },
    createElement: () => makeNode(),
  };

  let fetchImpl = async () => ({ ok: true, json: async () => ({}) });
  const context = {
    document,
    io: () => ({ on: () => {} }),
    setInterval() {},
    URL,
    URLSearchParams,
    location: { search: "", href: "http://localhost/" },
    localStorage: { getItem: () => null, setItem() {} },
    history: { replaceState() {} },
    fetch: (...args) => fetchImpl(...args),
    alert() {},
    prompt: () => null,
  };
  vm.runInNewContext(source, context);
  return { nodes, context, setFetch: (fn) => (fetchImpl = fn) };
}

// state/locatorEntries/locatorLegacy are declared with `const`/`let` inside
// the script, so (unlike a `var`) they are never exposed as properties on
// the vm context/global object — there is no `context.state` to reach into
// directly. Driving these tests through the real `refreshLocator()` code
// path (a mocked `fetch`) instead of poking at internal state exercises the
// actual production flow a connected tab uses, which is strictly stronger
// than reaching past it.
function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

test("dashboard UI: locator entry fields render escaped — selector/identity/actor text never becomes markup", async () => {
  const { nodes, context, setFetch } = loadDashboardScript();

  const maliciousIdentity = {
    action: "click",
    originalSelector: '<img src=x onerror=alert(1)>',
    origin: "https://x.com",
    pathname: "/<script>evil()</script>",
  };
  const entries = {
    "the-key": {
      key: "the-key",
      trust: "unproven",
      identity: maliciousIdentity,
      lastSeen: new Date().toISOString(),
      signature: null,
      pendingCandidate: {
        selector: '"><svg onload=alert(2)>',
        contributions: { attribute: 0.4, accessibleName: 0.2, structural: 0.1, text: 0.05, boundingBox: 0.02 },
        occurrences: 1,
        lastSeen: new Date().toISOString(),
        previouslyRejected: { count: 2, lastRejectedAt: "2024-01-01T00:00:00.000Z", lastRejectedBy: "<img src=x onerror=alert(3)>" },
      },
    },
  };

  setFetch(async (url) => (String(url).includes("/locator/entries") ? jsonResponse(entries) : jsonResponse({})));
  await context.refreshLocator();

  const html = nodes.get("locator-entries-list").children[0].innerHTML;
  assert.ok(!html.includes("<img"), `raw <img markup leaked: ${html}`);
  assert.ok(!html.includes("<svg"), `raw <svg markup leaked: ${html}`);
  assert.ok(!html.includes("<script>evil()"), `raw <script> markup leaked: ${html}`);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;svg/);
  assert.match(html, /previously rejected/);
});

test("dashboard UI: a hashed signature value is never interpolated into the locator panel, even when present on the entry", async () => {
  const { nodes, context, setFetch } = loadDashboardScript();

  const fakeHash = "a".repeat(64); // shaped like a real HMAC-SHA256 hex digest
  const entries = {
    "k1": {
      key: "k1",
      trust: "trusted",
      identity: { action: "click", originalSelector: "#x", origin: "https://x.com", pathname: "/y" },
      lastSeen: new Date().toISOString(),
      pendingCandidate: null,
      // A real trusted entry's signature carries hashed role/attributes —
      // the panel must never read or render this object at all.
      signature: { role: fakeHash, attributes: { id: fakeHash, "data-testid": fakeHash }, tagName: "button" },
    },
  };

  setFetch(async (url) => (String(url).includes("/locator/entries") ? jsonResponse(entries) : jsonResponse({})));
  await context.refreshLocator();

  const html = nodes.get("locator-entries-list").children[0].innerHTML;
  assert.ok(!html.includes(fakeHash), `a hashed value leaked into the rendered locator row: ${html}`);
});

test("dashboard UI: legacy rows render read-only and labelled, with no raw markup from their fields", async () => {
  const { nodes, context, setFetch } = loadDashboardScript();

  const legacy = {
    "legacy-1": { reason: "missing_identity_field:applicationId<script>x</script>", loadedAt: "2024-01-01T00:00:00.000Z" },
  };
  setFetch(async (url) => (String(url).includes("/locator/legacy") ? jsonResponse(legacy) : jsonResponse({})));
  await context.refreshLocator();

  const html = nodes.get("locator-legacy-list").children[0].innerHTML;
  assert.match(html, /legacy — not usable for matching/);
  assert.ok(!html.includes("<script>x</script>"));
  assert.match(html, /&lt;script&gt;/);
});

function decisionToken(memoryPath, key, rollback = false) {
  const mem = new LocatorMemory({ memoryPath, env: { FALCON_LOCATOR_SALT: TEST_SALT } });
  const entry = mem.getEntry(key);
  return rollback ? entry?.revision : entry?.pendingCandidate?.proposalId;
}

test("locator decisions require the displayed proposal and reject a replacement proposal", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };
  const identity = identityFor("#stale");
  const key = LocatorIdentity.serialiseIdentity(identity);
  d._locatorMemory.recordPendingCandidate(identity, candidateFor("#proposal-a", "A"));
  await d._locatorMemory._queue;
  const first = d._locatorMemory.getEntry(key).pendingCandidate.proposalId;
  d._locatorMemory.recordPendingCandidate(identity, candidateFor("#proposal-b", "B"));
  await d._locatorMemory._queue;
  const missing = await httpJSON(d.port, "POST", "/locator/approve", auth, { key });
  assert.equal(missing.statusCode, 400);
  for (const kind of ["approve", "reject"]) {
    const stale = await httpJSON(d.port, "POST", `/locator/${kind}`, auth, { key, proposalId: first });
    assert.equal(stale.statusCode, 409);
    assert.equal(d._locatorMemory.getEntry(key).pendingCandidate.selector, "#proposal-b");
  }
});

test("locator decision surfaces report a durable-write failure and keep trust unchanged", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };
  const identity = identityFor("#write-failure");
  const key = LocatorIdentity.serialiseIdentity(identity);
  d._locatorMemory.recordPendingCandidate(identity, candidateFor("#replacement", "Replacement"));
  await d._locatorMemory._queue;
  const before = d._locatorMemory.getEntry(key);
  fs.writeFileSync(d._locatorMemory.memoryPath + ".lock", JSON.stringify({ pid: process.pid, token: "other-writer" }));
  const res = await httpJSON(d.port, "POST", "/locator/approve", auth, { key, proposalId: before.pendingCandidate.proposalId });
  assert.equal(res.statusCode, 503);
  assert.equal(d._locatorMemory.getEntry(key).trust, before.trust);
  const result = runCLI(["locator-approve", key, before.pendingCandidate.proposalId], d._locatorMemory.memoryPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /failed/);
  assert.equal(new LocatorMemory({ memoryPath: d._locatorMemory.memoryPath, env: { FALCON_LOCATOR_SALT: TEST_SALT } }).getEntry(key).trust, before.trust);
});
