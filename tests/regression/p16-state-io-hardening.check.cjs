const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Logger = require("../../utils/Logger");
const { readJsonSync, writeJsonAtomic } = require("../../src/core/util/AtomicJsonStore");

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "p16-io-")); }

test("W-4: symlink is refused and target never read", () => {
    const d = tmp();
    const real = path.join(d, "real.json");
    fs.writeFileSync(real, JSON.stringify({ a: 1 }));
    const link = path.join(d, "link.json");
    fs.symlinkSync(real, link);
    assert.deepStrictEqual(readJsonSync(link, { fb: true }), { fb: true });
    assert.ok(fs.lstatSync(link).isSymbolicLink());
});

test("W-4: non-regular file (directory) is refused", () => {
    const d = tmp();
    assert.deepStrictEqual(readJsonSync(d, []), []);
});

test("W-4: oversized file falls back and original is preserved", () => {
    const d = tmp();
    const f = path.join(d, "big.json");
    fs.writeFileSync(f, JSON.stringify({ pad: "x".repeat(200) }));
    assert.deepStrictEqual(readJsonSync(f, { fb: 1 }, { maxBytes: 50 }), { fb: 1 });
    assert.ok(fs.existsSync(f));
    assert.deepStrictEqual(readJsonSync(f, { fb: 1 }).pad.length, 200);
});

test("W-4: missing, valid and corrupt behaviour unchanged", () => {
    const d = tmp();
    const f = path.join(d, "s.json");
    assert.deepStrictEqual(readJsonSync(f, []), []);
    fs.writeFileSync(f, "{bad");
    assert.deepStrictEqual(readJsonSync(f, {}), {});
    assert.ok(fs.readdirSync(d).some((n) => n.includes(".corrupt-")));
});

test("W-4: writeJsonAtomic creates parent 0o700, fsyncs, resolves ok, never rejects", async () => {
    const d = tmp();
    const f = path.join(d, "sub", "x.json");
    const origSync = fs.promises.FileHandle;
    const r = await writeJsonAtomic(f, { a: 1 });
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(fs.statSync(path.join(d, "sub")).mode & 0o777, 0o700);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, "utf8")), { a: 1 });
    void origSync;
    const bad = await writeJsonAtomic(path.join(f, "nope.json"), {});
    assert.strictEqual(bad.ok, false);
});

test("W-4: writeJsonAtomic fsyncs temp file before rename", async () => {
    const d = tmp();
    const order = [];
    const origOpen = fs.promises.open;
    const origRename = fs.promises.rename;
    fs.promises.open = async (...a) => {
        const h = await origOpen(...a);
        const s = h.sync.bind(h);
        h.sync = async () => { order.push("sync"); return s(); };
        return h;
    };
    fs.promises.rename = async (...a) => { order.push("rename"); return origRename(...a); };
    try { await writeJsonAtomic(path.join(d, "o.json"), {}); }
    finally { fs.promises.open = origOpen; fs.promises.rename = origRename; }
    assert.deepStrictEqual(order, ["sync", "rename"]);
});

test("W-5: Logger redacts env secrets, token= and Bearer in console and file", async () => {
    const d = tmp();
    const orig = Logger.logFilePath;
    const origDir = Logger._dirEnsured;
    Logger.logFilePath = path.join(d, "reports", "execution.log");
    Logger._dirEnsured = false;
    process.env.P16_TEST_API_KEY = ["sk", "supersecret" + "value"].join("-");
    const lines = [];
    const o = console.log;
    console.log = (m) => lines.push(m);
    try {
        Logger.info("key " + process.env.P16_TEST_API_KEY + " token=abc123xyz Bearer eyJhbGci.def");
        await Logger.flush();
    } finally {
        console.log = o;
        delete process.env.P16_TEST_API_KEY;
        Logger.logFilePath = orig;
        Logger._dirEnsured = origDir;
    }
    const file = fs.readFileSync(path.join(d, "reports", "execution.log"), "utf8");
    for (const out of [lines.join("\n"), file]) {
        assert.ok(!/supersecretvalue|abc123xyz|eyJhbGci/.test(out), out);
        assert.ok(out.includes("[redacted]"));
    }
    assert.strictEqual(fs.statSync(path.join(d, "reports", "execution.log")).mode & 0o777, 0o600);
});

test("W-5b: Logger redacts additional secret shapes and non-string input", async () => {
    const d = tmp();
    const orig = Logger.logFilePath;
    const origDir = Logger._dirEnsured;
    Logger.logFilePath = path.join(d, "reports", "execution.log");
    Logger._dirEnsured = false;
    process.env.P16_DB_CONNECTION_STRING = "pgconn-value-12345";
    process.env.P16_SERVICE_PASS = "svcpass-value-6789";
    const lines = [];
    const o = console.log;
    console.log = (m) => lines.push(m);
    try {
        Logger.info("password=hunter2pw passwd=hunter3pw secret=s3cr3tval api_key=AKIA1234 apikey=AKIA5678");
        Logger.info("Authorization: Bearer abc.def.ghi");
        Logger.info("Authorization: rawvalue987");
        Logger.info("Authorization: Basic dXNlcjpwYXNz");
        Logger.info("connect " + ["postgres", "//dbuser:dbpassw0" + "rd@db.example:5432/x"].join(":"));
        Logger.info("url ?token=%2Eabc%2Fdef%3D");
        Logger.info("env pgconn-value-12345 and svcpass-value-6789");
        Logger.info({ toString() { return "obj password=objpw123"; } });
        await Logger.flush();
    } finally {
        console.log = o;
        delete process.env.P16_DB_CONNECTION_STRING;
        delete process.env.P16_SERVICE_PASS;
        Logger.logFilePath = orig;
        Logger._dirEnsured = origDir;
    }
    const out = lines.join("\n");
    const file = fs.readFileSync(path.join(d, "reports", "execution.log"), "utf8");
    for (const text of [out, file]) {
        assert.ok(!/hunter2pw|hunter3pw|s3cr3tval|AKIA1234|AKIA5678|abc\.def\.ghi|rawvalue987|dXNlcjpwYXNz|dbpassw0rd|%2Eabc|pgconn-value|svcpass-value|objpw123/.test(text), text);
    }
    assert.ok(out.includes("db.example:5432"), "host must remain readable");
});

test("Logger: redaction stays linear on adversarial input and still masks URL credentials", () => {
    const Logger = require("../../utils/Logger");
    const lines = [];
    const realLog = console.log;
    console.log = (line) => lines.push(String(line));
    let ms;
    try {
        const adversarial = "x://" + "a".repeat(200000) + ":" + "b".repeat(200000);
        const t0 = process.hrtime.bigint();
        Logger.info(adversarial);
        ms = Number(process.hrtime.bigint() - t0) / 1e6;
        Logger.info("open " + ["postgres", "//svc:pw" + "9@host/db"].join(":"));
    } finally {
        console.log = realLog;
    }
    assert.ok(ms < 1000, `redaction took ${ms} ms`);
    assert.equal(lines.length, 2);
    assert.ok(!lines[1].includes("pw9"), lines[1]);
    assert.ok(lines[1].includes("[redacted]"), lines[1]);
});
