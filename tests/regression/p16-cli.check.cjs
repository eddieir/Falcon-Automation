"use strict";
/** P16 CLI: strict flag parsing, merge exit codes, default parsing unchanged. No browser, repo data/reports untouched. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const R = path.join(__dirname, "..", "..");
const FALCON = path.join(R, "falcon.js");
const StateJournal = require(path.join(R, "src/core/parallel/StateJournal"));
const ShardBundle = require(path.join(R, "src/core/parallel/ShardBundle"));
const Planning = require(path.join(R, "src/core/parallel/Planning"));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "p16cli-"));
const H = (c) => c.repeat(64);

function env(root) {
    const dataDir = path.join(root, "data");
    const reportsDir = path.join(root, "reports");
    const preload = path.join(root, "preload.cjs");
    fs.writeFileSync(preload, "globalThis.__FALCON_TEST_SEAMS__ = { parallelPaths: true };\n");
    return {
        preload,
        env: {
            ...process.env, CI: "true", FALCON_RUN_HISTORY: "off", FALCON_LOCATOR_SALT: "cli-salt",
            FALCON_TEST_PARALLEL_PATHS: JSON.stringify({ dataDir, reportsDir }),
        },
        dataDir, reportsDir,
    };
}

function falcon(root, args) {
    const e = env(root);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ["--require", e.preload, FALCON, ...args], { cwd: root, env: e.env, encoding: "utf8", timeout: 30000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, ms: Date.now() - t0, ...e };
}

async function bundle(root, failing) {
    const dir = path.join(root, "in", "shard-1-of-1");
    const urls = ["http://127.0.0.1:1/"];
    const j = new StateJournal({
        runId: "cli-run-1", shard: { index: 1, total: 1 }, pageOrdinal: 0, commit: "unknown", configFp: H("a"),
        planDigest: Planning.planDigest([["sig"]]), snapshotAt: "2030-01-01T00:00:00.000Z",
    });
    const pages = [{
        ordinal: 0, url: urls[0], assigned: true, disposition: "completed", status: "tested", analysisStatus: "tested",
        results: [{ name: "s", status: failing ? "failed" : "passed", error: failing ? "x" : undefined }],
        uiIssues: [], signatures: ["sig"], journal: j.finish("ok"),
    }];
    await ShardBundle.write({
        dir, runId: "cli-run-1", shard: { index: 1, total: 1 }, commit: "unknown", configFp: H("a"),
        frontierDigest: Planning.frontierDigest(urls), planDigest: Planning.planDigest([["sig"]]), pages,
    });
    return path.join(root, "in");
}

const INVALID = [
    ["--workers=0"], ["--workers=17"], ["--workers=abc"], ["--workers="], ["--workers"], ["--workers=2", "--workers=3"],
    ["--shard=1/2"], ["--shard=3/2", "--run-id=abcdef"], ["--shard=1", "--run-id=abcdef"], ["--shard=1/2", "--run-id=BAD"],
    ["--run-id=abcdef"], ["--input=x"], ["--expect-total=2"], ["--repeat=0"],
];

test("invalid parallel flags exit 1 quickly with no browser", () => {
    for (const args of INVALID) {
        const root = tmp();
        const r = falcon(root, ["--no-dashboard", "--url=http://127.0.0.1:1/", ...args]);
        assert.strictEqual(r.status, 1, `${args.join(" ")} -> ${r.status}\n${r.out}`);
        assert.ok(r.ms < 15000, `${args.join(" ")} took ${r.ms}ms`);
        assert.ok(!/Navigating to/.test(r.out), "browser path must not start");
        assert.ok(!fs.existsSync(r.reportsDir) && !fs.existsSync(r.dataDir));
    }
});

test("merge command: unknown, duplicate, empty and missing args exit 2", () => {
    for (const args of [
        ["merge"], ["merge", "--input="], ["merge", "--input=a", "--input=b"], ["merge", "--input=a", "--bogus"],
        ["merge", "--input=a", "extra"], ["merge", "--input=a", "--expect-total=0"], ["merge", "--input=a", "--workers=2"],
    ]) {
        const r = falcon(tmp(), args);
        assert.strictEqual(r.status, 2, `${args.join(" ")} -> ${r.status}\n${r.out}`);
    }
});

test("merge command exit codes: 0 passed, 1 failed run, 2 rejected input and unexpected total", async () => {
    const ok = tmp();
    const input = await bundle(ok, false);
    const r0 = falcon(ok, ["merge", `--input=${input}`, "--expect-total=1"]);
    assert.strictEqual(r0.status, 0, r0.out);
    assert.ok(fs.existsSync(path.join(r0.reportsDir, "test-report.json")));
    assert.ok(!fs.existsSync(path.join(R, "reports", "merge", "receipts", "cli-run-1.json")));
    const replay = falcon(ok, ["merge", `--input=${input}`, "--expect-total=1"]);
    assert.strictEqual(replay.status, 0, "replay returns the recorded outcome");

    const bad = tmp();
    const r1 = falcon(bad, ["merge", `--input=${await bundle(bad, true)}`]);
    assert.strictEqual(r1.status, 1, r1.out);

    const wrong = tmp();
    const r2 = falcon(wrong, ["merge", `--input=${await bundle(wrong, false)}`, "--expect-total=2"]);
    assert.strictEqual(r2.status, 2, r2.out);
    assert.ok(!fs.existsSync(path.join(wrong, "reports", "test-report.json")));
    const missing = falcon(tmp(), ["merge", `--input=${path.join(tmp(), "nope")}`]);
    assert.strictEqual(missing.status, 2);
});

test("default parsing is unchanged: --workers=1 and unrelated flags are accepted by the parser", () => {
    const { parseParallelArgs } = require(path.join(R, "src/core/parallel/Args"));
    for (const argv of [[], ["--no-dashboard", "--url=x", "--max-pages=3", "--repeat=2"], ["--workers=1"], ["--no-dashboard", "--help"]]) {
        const p = parseParallelArgs(argv);
        assert.strictEqual(p.ok, true);
        assert.strictEqual(p.workers, 1);
        assert.strictEqual(p.shard, null);
        assert.strictEqual(p.merge, null);
    }
});
