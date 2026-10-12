const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveUnder, readBoundedJson, writeAtomicPrivate } = require("../../src/core/parallel/SafeFs");
const Limits = require("../../src/core/parallel/Limits");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "p16-sfs-"));

test("Limits are frozen and match the architecture table", () => {
    assert.ok(Object.isFrozen(Limits));
    assert.strictEqual(Limits.MANIFEST_MAX_BYTES, 256 * 1024);
    assert.strictEqual(Limits.FRAGMENT_MAX_BYTES, 1024 * 1024);
    assert.strictEqual(Limits.JOURNAL_MAX_BYTES, 2 * 1024 * 1024);
    assert.strictEqual(Limits.JOURNAL_MAX_EVENTS, 5000);
    assert.strictEqual(Limits.JOURNAL_MAX_PAYLOAD_BYTES, 8192);
    assert.strictEqual(Limits.SHARD_MAX_BYTES, 64 * 1024 * 1024);
    assert.strictEqual(Limits.MERGE_MAX_BYTES, 1024 * 1024 * 1024);
    assert.strictEqual(Limits.MERGE_MAX_EVENTS, 250000);
    assert.strictEqual(Limits.SHARD_DIR_MAX_FILES, 2200);
    assert.ok(Limits.RUN_ID_PATTERN.test("a".repeat(6)) && Limits.RUN_ID_PATTERN.test("a".repeat(63)));
    assert.ok(!Limits.RUN_ID_PATTERN.test("a".repeat(5)) && !Limits.RUN_ID_PATTERN.test("a".repeat(64)));
    assert.ok(!Limits.RUN_ID_PATTERN.test("-aaaaaaa") && !Limits.RUN_ID_PATTERN.test("Aaaaaaaa"));
    assert.throws(() => { "use strict"; Limits.JOURNAL_MAX_EVENTS = 1; });
});

test("resolveUnder accepts a 64-char name and rejects 65", () => {
    const d = tmp();
    const p = resolveUnder(d, "a".repeat(64));
    assert.ok(p.startsWith(fs.realpathSync(d)));
    assert.throws(() => resolveUnder(d, "a".repeat(65)), { code: "PATH_NAME_INVALID" });
});

test("resolveUnder rejects traversal, absolute, NUL, separators, dots, unicode, empty", () => {
    const d = tmp();
    for (const bad of ["..", ".", "...", "../x", "a/b", "a\\b", "/etc/passwd", "a\0b", "café", "‮evil", "", "a b", "%2e%2e"]) {
        assert.throws(() => resolveUnder(d, bad), { code: "PATH_NAME_INVALID" }, JSON.stringify(bad));
    }
    assert.throws(() => resolveUnder(d, 5), { code: "PATH_NAME_INVALID" });
    assert.throws(() => resolveUnder(d), { code: "PATH_NAME_INVALID" });
    assert.throws(() => resolveUnder("", "a"), { code: "PATH_ROOT_INVALID" });
    assert.throws(() => resolveUnder(path.join(d, "missing-root"), "a"), { code: "PATH_ROOT_INVALID" });
});

test("resolveUnder refuses a symlinked intermediate that escapes the root", () => {
    const d = tmp();
    const outside = tmp();
    fs.symlinkSync(outside, path.join(d, "link"));
    assert.throws(() => resolveUnder(d, "link", "x.json"), { code: "PATH_ESCAPE" });
    const ok = resolveUnder(d, "sub", "x.json");
    assert.strictEqual(ok, path.join(fs.realpathSync(d), "sub", "x.json"));
});

test("readBoundedJson: accepts maxBytes, rejects maxBytes+1", async () => {
    const d = tmp();
    const f = path.join(d, "a.json");
    const base = JSON.stringify({ k: "" });
    const body = (n) => JSON.stringify({ k: "x".repeat(n - base.length) });
    fs.writeFileSync(f, body(100));
    const ok = await readBoundedJson(f, { maxBytes: 100, maxDepth: 3 });
    assert.strictEqual(ok.ok, true);
    fs.writeFileSync(f, body(101));
    const r = await readBoundedJson(f, { maxBytes: 100, maxDepth: 3 });
    assert.strictEqual(r.code, "READ_TOO_LARGE");
});

test("readBoundedJson: depth max accepted, max+1 rejected; 10k nesting rejected", async () => {
    const d = tmp();
    const f = path.join(d, "a.json");
    const nest = (n) => "[".repeat(n) + "]".repeat(n);
    fs.writeFileSync(f, nest(6));
    assert.strictEqual((await readBoundedJson(f, { maxBytes: 1e6, maxDepth: 6 })).ok, true);
    fs.writeFileSync(f, nest(7));
    assert.strictEqual((await readBoundedJson(f, { maxBytes: 1e6, maxDepth: 6 })).code, "READ_TOO_DEEP");
    fs.writeFileSync(f, nest(10000));
    assert.strictEqual((await readBoundedJson(f, { maxBytes: 1e6, maxDepth: 6 })).code, "READ_TOO_DEEP");
    // brackets inside strings do not count
    fs.writeFileSync(f, JSON.stringify({ s: "[[[[[[[[[[" }));
    assert.strictEqual((await readBoundedJson(f, { maxBytes: 1e6, maxDepth: 6 })).ok, true);
});

test("readBoundedJson: forbidden keys at any depth rejected, no pollution", async () => {
    const d = tmp();
    const f = path.join(d, "a.json");
    for (const text of [
        '{"__proto__":{"polluted":1}}',
        '{"a":{"b":[{"__proto__":{"polluted":1}}]}}',
        '{"a":{"constructor":{"prototype":{"polluted":1}}}}',
        '{"prototype":1}',
    ]) {
        fs.writeFileSync(f, text);
        const r = await readBoundedJson(f, { maxBytes: 1e6, maxDepth: 6 });
        assert.strictEqual(r.code, "READ_FORBIDDEN_KEY", text);
        assert.strictEqual(({}).polluted, undefined);
    }
});

test("readBoundedJson: huge exponent (Infinity) rejected", async () => {
    const d = tmp();
    const f = path.join(d, "a.json");
    fs.writeFileSync(f, '{"n":1e999}');
    assert.strictEqual((await readBoundedJson(f, { maxBytes: 1e6, maxDepth: 6 })).code, "READ_NON_FINITE");
});

test("readBoundedJson: invalid UTF-8, bad JSON, missing, directory, bad options", async () => {
    const d = tmp();
    const f = path.join(d, "a.json");
    fs.writeFileSync(f, Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]));
    assert.strictEqual((await readBoundedJson(f, { maxBytes: 100, maxDepth: 3 })).code, "READ_NOT_UTF8");
    fs.writeFileSync(f, "{bad");
    const bad = await readBoundedJson(f, { maxBytes: 100, maxDepth: 3 });
    assert.strictEqual(bad.code, "READ_PARSE");
    assert.ok(!JSON.stringify(bad).includes("bad"), "error must not echo content");
    assert.strictEqual((await readBoundedJson(path.join(d, "none.json"), { maxBytes: 100, maxDepth: 3 })).code, "READ_NOT_FOUND");
    assert.strictEqual((await readBoundedJson(d, { maxBytes: 100, maxDepth: 3 })).code, "READ_NOT_REGULAR");
    assert.strictEqual((await readBoundedJson(f, {})).code, "READ_OPTIONS_INVALID");
    assert.strictEqual((await readBoundedJson("a\0b", { maxBytes: 1, maxDepth: 1 })).code, "READ_PATH_INVALID");
});

test("readBoundedJson: symlink refused and target not read", async () => {
    const d = tmp();
    const real = path.join(d, "real.json");
    fs.writeFileSync(real, '{"secret":"CANARY-TARGET"}');
    const link = path.join(d, "link.json");
    fs.symlinkSync(real, link);
    const r = await readBoundedJson(link, { maxBytes: 1000, maxDepth: 3 });
    assert.strictEqual(r.code, "READ_SYMLINK");
    assert.ok(!JSON.stringify(r).includes("CANARY-TARGET"));
});

test("writeAtomicPrivate: creates 0600 file in 0700 dirs, replaces atomically", async () => {
    const d = tmp();
    const f = path.join(d, "x", "y", "out.json");
    assert.deepStrictEqual(await writeAtomicPrivate(f, "one"), { ok: true });
    assert.strictEqual(fs.readFileSync(f, "utf8"), "one");
    if (process.platform !== "win32") {
        assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
        assert.strictEqual(fs.statSync(path.dirname(f)).mode & 0o777, 0o700);
    }
    assert.deepStrictEqual(await writeAtomicPrivate(f, "two"), { ok: true });
    assert.strictEqual(fs.readFileSync(f, "utf8"), "two");
    assert.deepStrictEqual(fs.readdirSync(path.dirname(f)), ["out.json"], "no temp files left");
});

test("writeAtomicPrivate: failure leaves destination unchanged and never rejects", async () => {
    const d = tmp();
    const f = path.join(d, "out.json");
    fs.writeFileSync(f, "original");
    // destination is a non-empty directory name collision: rename onto a directory fails
    const dirDest = path.join(d, "dest");
    fs.mkdirSync(path.join(dirDest, "child"), { recursive: true });
    const r = await writeAtomicPrivate(dirDest, "data");
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /^WRITE_FAILED:/);
    assert.ok(fs.statSync(dirDest).isDirectory());
    assert.deepStrictEqual(fs.readdirSync(d).sort(), ["dest", "out.json"], "temp cleaned up");
    assert.strictEqual(fs.readFileSync(f, "utf8"), "original");
    // parent is a regular file
    const r2 = await writeAtomicPrivate(path.join(f, "child.json"), "z");
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(fs.readFileSync(f, "utf8"), "original");
    // bad args
    assert.strictEqual((await writeAtomicPrivate("a\0b", "x")).ok, false);
    assert.strictEqual((await writeAtomicPrivate(f, 42)).ok, false);
});

test("writeAtomicPrivate: symlink destination is replaced, not followed", async () => {
    const d = tmp();
    const target = path.join(d, "target.txt");
    fs.writeFileSync(target, "keep");
    const link = path.join(d, "link.json");
    fs.symlinkSync(target, link);
    assert.deepStrictEqual(await writeAtomicPrivate(link, "new"), { ok: true });
    assert.strictEqual(fs.readFileSync(target, "utf8"), "keep");
    assert.ok(!fs.lstatSync(link).isSymbolicLink());
});
