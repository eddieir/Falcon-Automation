"use strict";
/**
 * WP-77R end to end: UI permission-state assertions (visible/enabled/disabled)
 * plus accessEquals authorization assertions, driven through the real
 * `falcon.js --plan` CLI in a child process (real Chromium, loopback only,
 * no LLM), exactly as side-effect-assertions.check.cjs drives backend
 * assertions. Oracle values (admin/viewer tokens, expected HTTP statuses)
 * are constants below, never read from Falcon's own output.
 *
 * NOTE on fixtures/identities.json: falcon.js resolves the accessEquals
 * identity map from "fixtures/identities.json" relative to falcon.js's own
 * install directory (__dirname of falcon.js), not the plan's cwd — see
 * falcon.js around the `needsIdentities` block. There is no CLI flag or env
 * override. For a Falcon checkout this is also the project root, so this
 * suite writes that file at the real repo root for the duration of the run
 * (test.before) and removes it in test.after, backing up/restoring any
 * pre-existing file so it never clobbers a real one and is never committed.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const R = path.join(__dirname, "..", "..");
const FALCON = path.join(R, "falcon.js");
const Contract = require(path.join(R, "src/core/outcome/Contract"));

const JOURNEY_ID = "admin-delete";
const T_ADMIN = "T-ADMIN";
const T_VIEW = "T-VIEW";
const IDENTITIES_DIR = path.join(R, "fixtures");
const IDENTITIES_PATH = path.join(IDENTITIES_DIR, "identities.json");
const IDENTITIES = { admin: { role: "admin", token: T_ADMIN }, viewer: { role: "viewer", token: T_VIEW } };

let fixture, llm, llmHits = 0, base;
let adminApiHits = 0, buggyApiHits = 0;
let fixturesCreatedDir = false;
let identitiesBackup = null; // null = didn't exist before; string = prior content

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));

const ROLE_BUTTON = {
    admin: `<button id="delete">Delete</button>`,
    viewer: `<button id="delete" disabled>Delete</button>`,
    guest: `<button id="delete" style="display:none">Delete</button>`,
};
const ROLES = new Set(Object.keys(ROLE_BUTTON));

function pageHtml(role) {
    return `<!doctype html><title>fixture</title><h1>Admin panel</h1><button id="ping" type="button">Ping</button>${ROLE_BUTTON[role]}`;
}

test.before(async () => {
    if (fs.existsSync(IDENTITIES_PATH)) {
        identitiesBackup = fs.readFileSync(IDENTITIES_PATH, "utf8");
    } else {
        identitiesBackup = null;
        if (!fs.existsSync(IDENTITIES_DIR)) fixturesCreatedDir = true;
    }
    fs.mkdirSync(IDENTITIES_DIR, { recursive: true });
    fs.writeFileSync(IDENTITIES_PATH, JSON.stringify(IDENTITIES));

    fixture = await listen(http.createServer((req, res) => {
        const url = req.url.split("?")[0];
        let m;
        if ((m = /^\/page\/([a-z]+)$/.exec(url)) && ROLES.has(m[1])) {
            res.writeHead(200, { "content-type": "text/html" });
            res.end(pageHtml(m[1]));
            return;
        }
        if (url === "/api/admin") {
            adminApiHits++;
            const auth = req.headers["authorization"] || "";
            const token = auth.replace(/^Bearer\s+/, "");
            res.writeHead(token === T_ADMIN ? 200 : 403);
            res.end();
            return;
        }
        if (url === "/api/admin-buggy") {
            buggyApiHits++;
            const auth = req.headers["authorization"] || "";
            const token = auth.replace(/^Bearer\s+/, "");
            // Buggy backend: grants both admin and viewer tokens.
            res.writeHead(token === T_ADMIN || token === T_VIEW ? 200 : 403);
            res.end();
            return;
        }
        res.writeHead(404); res.end();
    }));
    llm = await listen(http.createServer((req, res) => { llmHits++; res.writeHead(500); res.end("{}"); }));
    base = `http://127.0.0.1:${fixture.address().port}`;
});

test.after(() => {
    fixture.close(); llm.close();
    if (identitiesBackup !== null) {
        fs.writeFileSync(IDENTITIES_PATH, identitiesBackup);
    } else {
        if (fs.existsSync(IDENTITIES_PATH)) fs.unlinkSync(IDENTITIES_PATH);
        if (fixturesCreatedDir) {
            try { fs.rmdirSync(IDENTITIES_DIR); } catch { /* not empty / already gone: leave it */ }
        }
    }
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "perm77r-"));
const prov = { source: "spec", ref: "plan:admin-delete" };

function accessSource(apiPath, id, role) {
    return { kind: "http-status", url: `${base}${apiPath}`, identity: { id, role } };
}

function contractObj(assertions, extra = {}) {
    return { schemaVersion: 1, journeyId: JOURNEY_ID, requirementId: "ADMIN-DEL-001", revision: 1, assertions, ...extra };
}

function run(args, cwd) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [FALCON, ...args], {
            cwd,
            env: { ...process.env, CI: "1", FALCON_RUN_HISTORY: "off", OPENAI_API_KEY: "sk-fixture-unused-0000000000000000", OPENAI_BASE_URL: `http://127.0.0.1:${llm.address().port}` },
        });
        let out = "";
        child.stdout.on("data", (d) => { out += d; });
        child.stderr.on("data", (d) => { out += d; });
        child.on("close", (code) => resolve({ code, out }));
    });
}

async function setup({ role, assertions, state = "approved", contract, plan = true, journeyId = JOURNEY_ID }) {
    const dir = tmp();
    const store = path.join(dir, "store");
    const contractFile = path.join(dir, "contract.json");
    const c = contract || contractObj(assertions, { journeyId });
    fs.writeFileSync(contractFile, JSON.stringify(c));
    const digest = Contract.parse(JSON.stringify(c)).digest;
    const ops = [];
    if (state !== "none") {
        const p = await run([`--contract-propose=${contractFile}`, `--store-root=${store}`], dir);
        assert.strictEqual(p.code, 0, p.out);
        ops.push(p);
        if (state === "approved") {
            const a = await run([`--contract-approve=${contractFile}`, `--confirm-digest=${digest}`, `--store-root=${store}`], dir);
            assert.strictEqual(a.code, 0, a.out);
            ops.push(a);
        }
    }
    const doc = {
        format: "falcon-test-plan", version: 1, url: `${base}/page/${role}`, journey: true,
        scenarios: plan ? [{ action: "click", locator: "#ping", description: "Open admin panel" }, { action: "verify", description: "Verify permissions" }] : [{ action: "click", locator: "#ping", description: "noop" }],
        ...(plan ? { contract: "contract.json", journeyId } : {}),
    };
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(doc));
    return { dir, store, contractFile, digest, setupOut: ops.map((o) => o.out).join("\n") };
}

async function execute(ctx) {
    const r = await run(["--plan=plan.json", "--no-dashboard", `--store-root=${ctx.store}`], ctx.dir);
    const reportPath = path.join(ctx.dir, "reports", "test-report.json");
    assert.ok(fs.existsSync(reportPath), `no report written (exit ${r.code}): ${r.out.slice(-1500)}`);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return { ...r, report, level: report.verification.level, rows: report.tests };
}

const assertionRows = (r) => Object.fromEntries(r.rows.filter((x) => x.assertion && x.assertion.id).map((x) => [x.assertion.id, x]));

function walk(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
    }
    return out;
}

// -------------------------------------------------------------- (1) happy path

test("P1 admin: visible + enabled + accessEquals allowed => BUSINESS_VERIFIED, exit 0", async () => {
    const before = adminApiHits;
    const assertions = [
        { id: "delete-visible", required: true, check: "visible", locator: "#delete", provenance: prov },
        { id: "delete-enabled", required: true, check: "enabled", locator: "#delete", provenance: prov },
        { id: "admin-access", required: true, check: "accessEquals", locator: "authz:access", expected: "allowed", source: accessSource("/api/admin", "admin", "admin"), provenance: prov },
    ];
    const r = await execute(await setup({ role: "admin", assertions }));
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
    const by = assertionRows(r);
    for (const id of ["delete-visible", "delete-enabled", "admin-access"]) assert.strictEqual(by[id].status, "passed", id);
    assert.ok(adminApiHits > before);
});

test("P1b viewer: disabled + accessEquals denied => BUSINESS_VERIFIED, exit 0", async () => {
    const assertions = [
        { id: "delete-disabled", required: true, check: "disabled", locator: "#delete", provenance: prov },
        { id: "viewer-access", required: true, check: "accessEquals", locator: "authz:access", expected: "denied", source: accessSource("/api/admin", "viewer", "viewer"), provenance: prov },
    ];
    const r = await execute(await setup({ role: "viewer", assertions, journeyId: "viewer-delete" }));
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
    const by = assertionRows(r);
    for (const id of ["delete-disabled", "viewer-access"]) assert.strictEqual(by[id].status, "passed", id);
});

// -------------------------------------------------------------- (2) counterexample

test("P2 counterexample: viewer UI hides/disables the button but the buggy backend grants access => FAILED, nonzero exit", async () => {
    const assertions = [
        { id: "delete-disabled", required: true, check: "disabled", locator: "#delete", provenance: prov },
        { id: "viewer-access", required: true, check: "accessEquals", locator: "authz:access", expected: "denied", source: accessSource("/api/admin-buggy", "viewer", "viewer"), provenance: prov },
    ];
    const r = await execute(await setup({ role: "viewer", assertions, journeyId: "viewer-delete-buggy" }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "FAILED");
    const by = assertionRows(r);
    assert.strictEqual(by["delete-disabled"].status, "passed", "the UI assertion itself passed");
    assert.strictEqual(by["viewer-access"].status, "failed");
});

// -------------------------------------------------------------- (3) missing/unapproved contract

test("P3 missing/unapproved contract => never BUSINESS_VERIFIED, nonzero exit", async () => {
    const assertions = [
        { id: "admin-access", required: true, check: "accessEquals", locator: "authz:access", expected: "allowed", source: accessSource("/api/admin", "admin", "admin"), provenance: prov },
    ];
    const r = await execute(await setup({ role: "admin", assertions, state: "proposed" }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
    assert.ok(r.out.includes("NOT_APPROVED"), r.out);
});

// -------------------------------------------------------------- (4) wrong identity / role

test("P4 asserted role admin for a viewer identity => unavailable, zero requests to /api/admin", async () => {
    const before = adminApiHits;
    const assertions = [
        { id: "mismatched-access", required: true, check: "accessEquals", locator: "authz:access", expected: "allowed", source: accessSource("/api/admin", "viewer", "admin"), provenance: prov },
    ];
    const r = await execute(await setup({ role: "admin", assertions, journeyId: "mismatched-role" }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
    const by = assertionRows(r);
    assert.strictEqual(by["mismatched-access"].status, "unavailable");
    assert.strictEqual(adminApiHits, before, "role mismatch must never reach the network");
});

// -------------------------------------------------------------- (5) contractless expect

test("P5 contractless expect for a permission-shaped check stays an interaction, never BUSINESS_VERIFIED", async () => {
    const ctx = await setup({ role: "admin", assertions: [], plan: false, state: "none" });
    const dir = ctx.dir;
    const doc = {
        format: "falcon-test-plan", version: 1, url: `${base}/page/admin`, journey: true,
        scenarios: [{ action: "expect", locator: "#delete", check: "visible", description: "button is visible" }],
    };
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(doc));
    const r = await execute({ dir, store: ctx.store });
    assert.strictEqual(r.code, 0, r.out);
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
    assert.strictEqual(r.level, "INTERACTION_ONLY");
});

// -------------------------------------------------------------- (6) skipped/unavailable/quarantined

test("P6 an unavailable permission row (target never matches) is never BUSINESS_VERIFIED", async () => {
    const assertions = [
        { id: "ghost", required: true, check: "visible", locator: "#does-not-exist", provenance: prov },
    ];
    const r = await execute(await setup({ role: "admin", assertions, journeyId: "ghost-journey" }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
    assert.strictEqual(assertionRows(r).ghost.status, "unavailable");
});

// -------------------------------------------------------------- (7) contradictions rejected at validation

test("P7 contradictory assertions (enabled + disabled on the same locator) are rejected at validation", () => {
    const c = contractObj([
        { id: "a1", required: true, check: "enabled", locator: "#delete", provenance: prov },
        { id: "a2", required: true, check: "disabled", locator: "#delete", provenance: prov },
    ]);
    const parsed = Contract.parse(JSON.stringify(c));
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.code, "CONTRADICTORY_ASSERTIONS");
});

test("P7b contradictory accessEquals assertions (same url+identity, different expected) are rejected at validation", () => {
    const c = contractObj([
        { id: "a1", required: true, check: "accessEquals", locator: "authz:access", expected: "allowed", source: accessSource("/api/admin", "admin", "admin"), provenance: prov },
        { id: "a2", required: true, check: "accessEquals", locator: "authz:access", expected: "denied", source: accessSource("/api/admin", "admin", "admin"), provenance: prov },
    ]);
    const parsed = Contract.parse(JSON.stringify(c));
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.code, "CONTRADICTORY_ASSERTIONS");
});

// -------------------------------------------------------------- (8) shard-merge integrity

test("P8 a permission row survives shard merge with digest/outcome intact; merged level never BUSINESS_VERIFIED when approval provenance is unproven", async () => {
    const ShardMerge = require(path.join(R, "src/core/parallel/ShardMerge"));
    const ShardBundle = require(path.join(R, "src/core/parallel/ShardBundle"));
    const StateJournal = require(path.join(R, "src/core/parallel/StateJournal"));
    const Schemas = require(path.join(R, "src/core/parallel/Schemas"));
    const crypto = require("node:crypto");

    const H = (c) => c.repeat(64);
    const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
    const RUN = "gh-77r00001";
    const ENV = { FALCON_LOCATOR_SALT: "fixture-salt" };
    const DIGEST = "sha256:" + H("a");

    const permissionRow = {
        name: "a", status: "passed", duration: 5, repetition: 1,
        assertion: { id: "delete-enabled", digest: DIGEST, check: "enabled", locator: "#delete", outcome: "ui_enabled", matches: 1 },
    };

    function fragmentFor(ord, total, rows) {
        const idx = (ord % total) + 1;
        return ShardBundle.buildFragment({
            runId: RUN, shard: { index: idx, total },
            page: { ordinal: ord, results: rows, scenarioNames: rows.map((r2) => r2.name), disposition: "completed", status: "ok", uiIssues: [] },
        });
    }
    function journalFor(ord, total) {
        const idx = (ord % total) + 1;
        const j = new StateJournal({
            runId: RUN, shard: { index: idx, total }, pageOrdinal: ord, commit: "unknown", configFp: H("a"),
            planDigest: H("c"), snapshotAt: "2030-01-01T00:00:00.000Z", clock: () => new Date("2030-01-01T00:00:01.000Z"),
        });
        j.record("flakiness.outcome", 0, 0, { action: "click", locator: "#b" + ord, status: "passed", outcome: null, errorType: null, durationMs: 5, description: "d" });
        return j.finish("ok");
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "perm77r-shard-"));
    const inputs = path.join(root, "in");
    const total = 2;
    const pagesRows = [[permissionRow]];
    const dir = path.join(inputs, RUN);
    for (let idx = 1; idx <= total; idx++) {
        const sd = path.join(dir, `shard-${idx}-of-${total}`);
        fs.mkdirSync(path.join(sd, "fragments"), { recursive: true });
        fs.mkdirSync(path.join(sd, "journals"), { recursive: true });
        const mp = [];
        pagesRows.forEach((rows, o) => {
            const mine = (o % total) + 1 === idx;
            const e = { ordinal: o, url: `https://example.test/p${o}`, assigned: mine, disposition: "completed", fragment: null, journal: null };
            if (mine) {
                const fragment = fragmentFor(o, total, rows);
                const journal = journalFor(o, total);
                assert.ok(Schemas.validateFragment(fragment).ok);
                const ft = JSON.stringify(fragment); const jt = JSON.stringify(journal);
                fs.writeFileSync(path.join(sd, "fragments", `page-${o}.json`), ft);
                fs.writeFileSync(path.join(sd, "journals", `page-${o}.json`), jt);
                e.fragment = { name: `page-${o}.json`, bytes: Buffer.byteLength(ft), sha256: sha(ft) };
                e.journal = { name: `page-${o}.json`, bytes: Buffer.byteLength(jt), sha256: sha(jt), events: journal.count };
            }
            mp.push(e);
        });
        const m = {
            schema: "falcon.shard-manifest", v: 1, runId: RUN, shard: { index: idx, total }, attempt: 1, commit: "unknown",
            configFp: H("a"), frontierDigest: H("b"), planDigest: H("c"), pages: mp,
            exit: { code: 0, verdictCounts: { passed: 1 } },
            timing: { startedAt: "2030-01-01T00:00:00.000Z", endedAt: "2030-01-01T00:00:10.000Z", wallMs: 10000 },
            limits: { workers: 1, budgetMs: null },
        };
        fs.writeFileSync(path.join(sd, "manifest.json"), JSON.stringify(m));
    }

    const paths = { dataDir: path.join(root, "data"), reportsDir: path.join(root, "reports") };
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.mkdirSync(paths.reportsDir, { recursive: true });
    const mergeResult = await ShardMerge.merge({ inputDir: dir, expectTotal: total, paths, env: ENV });
    assert.ok(mergeResult.reportPath, `merge rejected: ${JSON.stringify(mergeResult.diagnostics)}`);
    const report = JSON.parse(fs.readFileSync(mergeResult.reportPath, "utf8"));
    const row = report.tests.find((t) => t.assertion && t.assertion.id === "delete-enabled");
    assert.ok(row, "merged permission row missing");
    assert.strictEqual(row.assertion.digest, DIGEST);
    assert.strictEqual(row.assertion.check, "enabled");
    assert.strictEqual(row.status, "passed");
    // WP-77H: shard-merged assertion rows carry no approval provenance, so a
    // bound PASS is never BUSINESS_VERIFIED via merge alone.
    assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED");
});

// -------------------------------------------------------------- (9) privacy

test("P9 privacy: tokens and URLs never appear in the serialized report", async () => {
    const assertions = [
        { id: "admin-access", required: true, check: "accessEquals", locator: "authz:access", expected: "allowed", source: accessSource("/api/admin", "admin", "admin"), provenance: prov },
    ];
    const ctx = await setup({ role: "admin", assertions, journeyId: "privacy-journey" });
    const r = await execute(ctx);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
    for (const f of walk(path.join(ctx.dir, "reports"))) {
        const content = fs.readFileSync(f, "utf8");
        for (const s of [T_ADMIN, T_VIEW, `${base}/api/`]) assert.ok(!content.includes(s), `${f} leaks ${s}`);
    }
    for (const s of [T_ADMIN, T_VIEW, `${base}/api/`]) assert.ok(!r.out.includes(s), `run output leaks ${s}`);
});

test("runtime made zero LLM requests across every run", () => {
    assert.strictEqual(llmHits, 0);
});
