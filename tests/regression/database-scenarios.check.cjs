const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { root, temp } = require("./helpers.cjs");
for (const name of ["UserDBTest", "OrderDBTest"]) {
  test(`${name} fails rather than skipping invalid certificate configuration`, (t) => {
    const dir = temp();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const child = spawnSync(
      process.execPath,
      [path.join(root, `tests/db/${name}.js`)],
      {
        cwd: dir,
        timeout: 5000,
        encoding: "utf8",
        env: {
          ...process.env,
          DB_HOST: "127.0.0.1",
          DB_USER: "fixture",
          DB_SSL: "true",
          SSL_CA_FILE: "/missing/ca",
          SSL_KEY_FILE: "/missing/key",
          SSL_CERT_FILE: "/missing/cert",
        },
      },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1, child.stdout + child.stderr);
    assert.ok(!(child.stdout + child.stderr).includes("Skipping"));
  });
}
test("standalone database connectivity script fails on connection refusal", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const child = spawnSync(
    process.execPath,
    [path.join(root, "tests/db/TestDBConnection.js")],
    {
      cwd: dir,
      timeout: 5000,
      encoding: "utf8",
      env: {
        ...process.env,
        DB_HOST: "127.0.0.1",
        DB_PORT: "1",
        DB_USER: "fixture",
        DB_PASS: "fixture",
        DB_NAME: "fixture",
        DB_SSL: "false",
      },
    },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, child.stdout + child.stderr);
});
