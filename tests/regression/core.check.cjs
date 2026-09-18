const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, silent, temp } = require("./helpers.cjs");
function runner(page = {}, { flaky } = {}) {
  const calls = [];
  const flakyCalls = [];
  const Runner = load("src/core/TestRunner.js", {
    "../../utils/Logger": silent,
    "./AIHealer/AIHealer": class {
      async healAndClick(...args) {
        calls.push(args);
      }
    },
    "./AIHealer/HealingReport": { log() {} },
    "./FlakinessTracker": flaky || {
      record: (opts) => {
        flakyCalls.push(opts);
        return null;
      },
      isQuarantined: () => false,
      keyFor: ({ url, action, locator }) => `${url}::${action}::${locator}`,
    },
  });
  return { instance: new Runner(page), calls, flakyCalls };
}
test("runner sends missing click locators through healing", async () => {
  const { instance, calls } = runner({ evaluate: async () => false });
  instance.testPlan.test_scenarios = [
    { action: "click", locator: "#old", description: "Save" },
  ];
  assert.equal((await instance.executeTest())[0].status, "passed");
  assert.deepEqual(calls, [["#old", "Save"]]);
});
for (const [action, method] of [
  ["type", "fill"],
  ["select", "selectOption"],
]) {
  test(`runner retries ${action} and records exactly one success`, async () => {
    let attempts = 0;
    const { instance } = runner({
      [method]: async (s, v) => {
        assert.equal(s, "#field");
        assert.equal(v, "value");
        if (++attempts < 3) throw Error("timeout");
      },
    });
    await instance.runScenario({
      action,
      locator: "#field",
      value: "value",
      description: "Field",
    });
    assert.equal(attempts, 3);
    assert.equal(instance.results.length, 1);
    assert.equal(instance.results[0].status, "passed");
  });
  test(`runner records exhausted ${action}`, async () => {
    let attempts = 0;
    const { instance } = runner({
      [method]: async () => {
        attempts++;
        throw Error("invalid");
      },
    });
    await instance.runScenario({ action, locator: "#field", value: "value" });
    assert.equal(attempts, 3);
    assert.equal(instance.results[0].status, "failed");
    assert.equal(instance.results[0].error, "invalid");
  });
}
test("runner does not multiply healer retry chain", async () => {
  const { instance } = runner();
  let calls = 0;
  instance.healer.healAndClick = async () => {
    calls++;
    throw Error("exhausted");
  };
  await instance.runScenario({ action: "click", locator: "#old" });
  assert.equal(calls, 1);
  assert.equal(instance.results[0].status, "failed");
});
test("unsupported actions are explicitly skipped", async () => {
  const { instance } = runner();
  await instance.runScenario({ action: "unknown" });
  assert.equal(instance.results[0].status, "skipped");
});

// ── Phase 9: FlakinessTracker integration ──

test("Phase 9: a passed scenario is recorded with url/action/locator/description/duration", async () => {
  const { instance, flakyCalls } = runner({
    waitForSelector: async () => {},
    click: async () => {},
  });
  instance.testPlan.url = "https://example.com/page";
  await instance.runScenario({ action: "click", locator: "#save", description: "Save" });
  assert.equal(flakyCalls.length, 1);
  assert.equal(flakyCalls[0].url, "https://example.com/page");
  assert.equal(flakyCalls[0].action, "click");
  assert.equal(flakyCalls[0].locator, "#save");
  assert.equal(flakyCalls[0].description, "Save");
  assert.equal(flakyCalls[0].status, "passed");
  assert.equal(typeof flakyCalls[0].duration, "number");
});
test("Phase 9: an exhausted failure is recorded with status 'failed' and a classified errorType", async () => {
  const { instance, flakyCalls } = runner({
    fill: async () => {
      throw Error("timeout waiting for element");
    },
  });
  instance.testPlan.url = "https://example.com/page";
  await instance.runScenario({ action: "type", locator: "#field", value: "x", description: "Field" });
  assert.equal(flakyCalls.length, 1);
  assert.equal(flakyCalls[0].status, "failed");
  assert.equal(flakyCalls[0].errorType, "TIMEOUT");
});
test("Phase 9: a quarantined scenario reports status 'quarantined' instead of 'failed', but is still recorded", async () => {
  const quarantinedKeys = new Set(["https://example.com/page::type::#field"]);
  const { instance, flakyCalls } = runner(
    {
      fill: async () => {
        throw Error("invalid selector");
      },
    },
    {
      flaky: {
        record: (opts) => {
          flakyCalls.push(opts);
          return null;
        },
        isQuarantined: (key) => quarantinedKeys.has(key),
        keyFor: ({ url, action, locator }) => `${url}::${action}::${locator}`,
      },
    },
  );
  instance.testPlan.url = "https://example.com/page";
  await instance.runScenario({ action: "type", locator: "#field", value: "x", description: "Field" });
  assert.equal(instance.results[0].status, "quarantined");
  assert.equal(instance.results[0].error, "invalid selector");
  assert.equal(instance.results[0].errorType, "HARD");
  // Quarantining changes how the failure is *reported*, not whether it's tracked.
  assert.equal(flakyCalls.length, 1);
  assert.equal(flakyCalls[0].status, "failed");
});
test("Phase 9: a non-quarantined scenario with the same error still reports 'failed'", async () => {
  const { instance } = runner(
    {
      fill: async () => {
        throw Error("invalid selector");
      },
    },
    {
      flaky: {
        record: () => null,
        isQuarantined: () => false,
        keyFor: ({ url, action, locator }) => `${url}::${action}::${locator}`,
      },
    },
  );
  await instance.runScenario({ action: "type", locator: "#field", value: "x", description: "Field" });
  assert.equal(instance.results[0].status, "failed");
});
test("Phase 9: a passed scenario is never checked against quarantine (only failures are)", async () => {
  let checked = false;
  const { instance } = runner(
    { waitForSelector: async () => {}, click: async () => {} },
    {
      flaky: {
        record: () => null,
        isQuarantined: () => {
          checked = true;
          return true;
        },
        keyFor: ({ url, action, locator }) => `${url}::${action}::${locator}`,
      },
    },
  );
  await instance.runScenario({ action: "click", locator: "#save", description: "Save" });
  assert.equal(instance.results[0].status, "passed");
  assert.equal(checked, false);
});
test("Phase 9: unsupported/skipped actions are never fed to FlakinessTracker", async () => {
  const { instance, flakyCalls } = runner();
  await instance.runScenario({ action: "unknown" });
  assert.equal(flakyCalls.length, 0);
});
test("visibility errors resolve false", async () => {
  const { instance } = runner({
    evaluate: async () => {
      throw Error("invalid");
    },
  });
  assert.equal(await instance.isElementVisible("["), false);
});
for (const [raw, expected] of [
  ["", {}],
  [
    '{"browser":"firefox","zero":0,"off":false}',
    { browser: "firefox", zero: 0, off: false },
  ],
]) {
  test(`configuration parses ${raw || "empty file"}`, () => {
    const config = load("src/core/ConfigManager.js", {
      fs: { existsSync: () => true, readFileSync: () => raw },
      dotenv: { config() {} },
    });
    assert.deepEqual(config.config, expected);
    if (raw) {
      assert.equal(config.get("zero"), 0);
      assert.equal(config.get("off"), false);
    }
  });
}
test("missing configuration falls back to environment", (t) => {
  process.env.FALCON_TEST_OPTION = "fixture";
  t.after(() => delete process.env.FALCON_TEST_OPTION);
  const config = load("src/core/ConfigManager.js", {
    fs: { existsSync: () => false },
    dotenv: { config() {} },
  });
  assert.equal(config.get("FALCON_TEST_OPTION"), "fixture");
  assert.equal(config.get("missing"), null);
});
test("malformed configuration fails", () =>
  assert.throws(
    () =>
      load("src/core/ConfigManager.js", {
        fs: { existsSync: () => true, readFileSync: () => "{broken" },
        dotenv: { config() {} },
      }),
    /Invalid JSON/,
  ));
function dbFixture(t, env = {}) {
  const keys = [
    "DB_HOST",
    "DB_USER",
    "DB_SSL",
    "SSL_CA_FILE",
    "SSL_KEY_FILE",
    "SSL_CERT_FILE",
    "SSL_REJECT_UNAUTHORIZED",
  ];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, {
    DB_HOST: "fixture",
    DB_USER: "fixture",
    ...env,
  });
  t.after(() => {
    for (const k of keys) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  });
  let options,
    releases = 0,
    ended = false;
  const client = {
    query: async (sql, params) => ({ rows: [{ sql, params }] }),
    release: () => releases++,
  };
  const DB = load("src/core/DBClient.js", {
    "../../utils/Logger": silent,
    dotenv: { config() {} },
    pg: {
      Pool: class {
        constructor(o) {
          options = o;
        }
        on() {}
        async connect() {
          return client;
        }
        async end() {
          ended = true;
        }
      },
    },
  });
  return {
    DB,
    client,
    get options() {
      return options;
    },
    get releases() {
      return releases;
    },
    get ended() {
      return ended;
    },
  };
}
test("database rejects missing credentials", (t) => {
  const f = dbFixture(t, { DB_HOST: "" });
  assert.throws(() => new f.DB(), /credentials/);
});
for (const [env, expected] of [
  [{ DB_SSL: "false" }, false],
  [{}, { rejectUnauthorized: true }],
  [{ SSL_REJECT_UNAUTHORIZED: "false" }, { rejectUnauthorized: false }],
]) {
  test(`database TLS ${JSON.stringify(env)}`, (t) => {
    const f = dbFixture(t, env);
    new f.DB();
    assert.deepEqual(f.options.ssl, expected);
  });
}
test("database loads mutual TLS certificates", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ["ca", "key", "cert"])
    fs.writeFileSync(path.join(dir, name), name);
  const f = dbFixture(t, {
    SSL_CA_FILE: path.join(dir, "ca"),
    SSL_KEY_FILE: path.join(dir, "key"),
    SSL_CERT_FILE: path.join(dir, "cert"),
  });
  new f.DB();
  assert.deepEqual(f.options.ssl, {
    rejectUnauthorized: true,
    ca: "ca",
    key: "key",
    cert: "cert",
  });
});
test("unreadable certificates fail configuration", (t) => {
  const f = dbFixture(t, {
    SSL_CA_FILE: "/missing/ca",
    SSL_KEY_FILE: "/missing/key",
    SSL_CERT_FILE: "/missing/cert",
  });
  assert.throws(() => new f.DB(), /ENOENT/);
});
test("database forwards parameters, releases on success/failure, and closes", async (t) => {
  const f = dbFixture(t);
  const db = new f.DB();
  assert.deepEqual(await db.query("SELECT $1", [7]), [
    { sql: "SELECT $1", params: [7] },
  ]);
  assert.equal(f.releases, 1);
  f.client.query = async () => {
    throw Error("query failed");
  };
  await assert.rejects(db.query("broken"), /query failed/);
  assert.equal(f.releases, 2);
  db.pool.connect = async () => {
    throw Error("connection refused");
  };
  await assert.rejects(db.query("SELECT 1"), /connection refused/);
  assert.equal(f.releases, 2);
  await db.close();
  assert.equal(f.ended, true);
});
test("service registry preserves registrations and optional lookups", () => {
  const registry = load("src/core/ServiceContainer.js", {
    "./BrowserManager": class {},
    "./APIClient": class {},
    "./DBClient": class {
      constructor() {
        throw Error("not configured");
      }
    },
    "./ReportManager": class {},
    "../../utils/Logger": silent,
  });
  assert.equal(registry.getOptional("dbClient"), null);
  assert.throws(() => registry.get("missing"), /not registered/);
  registry.register("fixture", 1);
  registry.register("fixture", 2);
  assert.equal(registry.get("fixture"), 1);
});
for (const browserType of ["chromium", "firefox", "webkit"]) {
  test(`browser manager lifecycle for ${browserType}`, async () => {
    const actions = [];
    const page = { close: async () => actions.push("page-close") };
    const browser = {
      newPage: async () => page,
      newContext: async () => ({ context: true }),
      close: async () => actions.push("browser-close"),
    };
    const BM = load("src/core/BrowserManager.js", {
      playwright: {
        [browserType]: {
          launch: async (o) => {
            assert.equal(typeof o.headless, "boolean");
            return browser;
          },
        },
      },
      "../core/ConfigManager": { get: () => browserType },
      "../../utils/Logger": silent,
    });
    const bm = new BM();
    await assert.rejects(bm.newContext(), /not initialized/);
    await bm.close();
    await bm.launch();
    assert.equal(bm.page, page);
    assert.deepEqual(await bm.newContext(), { context: true });
    await bm.close();
    assert.deepEqual(actions, ["page-close", "browser-close"]);
  });
}
test("base lifecycle starts report before launch and reports outcomes", async () => {
  const actions = [];
  const services = {
    browserManager: {
      page: {},
      launch: async () => actions.push("launch"),
      close: async () => actions.push("close"),
    },
    apiClient: {},
    reportManager: {
      startRun: () => actions.push("start"),
      generateReport: (r) => actions.push(r),
    },
  };
  const Base = load("src/core/BaseTest.js", {
    "../../utils/Logger": silent,
    "./ServiceContainer": { get: (n) => services[n], getOptional: () => null },
    "./VisualRegression": class {
      constructor(page) {
        this.page = page;
      }
    },
  });
  const instance = new Base("Fixture");
  instance._results.push({ name: "fixture", status: "passed" });
  await instance.setup();
  await instance.teardown();
  assert.deepEqual(actions.slice(0, 3), ["start", "launch", "close"]);
  assert.deepEqual(actions[3].tests, instance._results);
  assert.equal(instance.dbClient, null);
});
test("logger preserves write order and flush waits for persistence", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logger = load("utils/Logger.js");
  logger.logFilePath = path.join(dir, "logs/run.log");
  logger.info("first");
  logger.warning("second");
  logger.error("third");
  await logger.flush();
  const output = fs.readFileSync(logger.logFilePath, "utf8");
  assert.match(output, /\[INFO\]/);
  assert.ok(output.indexOf("first") < output.indexOf("second"));
  assert.ok(output.indexOf("second") < output.indexOf("third"));
  logger.logFilePath = dir;
  logger.info("unwritable");
  await logger.flush();
});
test("error diagnostics sanitize filenames and preserve message/stack", async () => {
  let file, body;
  const Handler = load("src/core/ErrorHandler.js", {
    "../../utils/Logger": silent,
    fs: {
      promises: {
        mkdir: async () => {},
        writeFile: async (f, b) => {
          file = f;
          body = JSON.parse(b);
        },
      },
    },
  });
  const error = Error("fixture");
  await Handler.handleError("../unsafe/name", error);
  assert.equal(path.basename(file), "___unsafe_name_error.json");
  assert.equal(body.errorMessage, "fixture");
  assert.equal(body.stackTrace, error.stack);
});
