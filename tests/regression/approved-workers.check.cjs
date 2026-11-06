"use strict";
/**
 * WP-77I-S2 end to end: approved-contract journeys on in-process workers,
 * driven through the real `falcon.js` CLI in a child process (real Chromium,
 * loopback fixture only, no LLM, no network). Oracle values are constants
 * here, never read from Falcon's own output.
 *
 * fixtures/identities.json is read from falcon.js's own directory (see
 * business-assertion-integration.check.cjs); this suite writes it for the run
 * and restores any pre-existing file afterwards. The regression suite runs
 * serially (--test-concurrency=1).
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

const T_ADMIN = "T-ADMIN-S2";
const T_VIEW = "T-VIEW-S2";
const IDENTITIES_DIR = path.join(R, "fixtures");
const IDENTITIES_PATH = path.join(IDENTITIES_DIR, "identities.json");
const IDENTITIES = { admin: { role: "admin", token: T_ADMIN }, viewer: { role: "viewer", token: T_VIEW } };
const prov = { source: "spec", ref: "plan:s2" };

const waiting = [];
let fixture, llm, base, identitiesBackup = null, fixturesCreatedDir = false;
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));

test.before(async () => {
    if (fs.existsSync(IDENTITIES_PATH)) identitiesBackup = fs.readFileSync(IDENTITIES_PATH, "utf8");
    else if (!fs.existsSync(IDENTITIES_DIR)) fixturesCreatedDir = true;
    fs.mkdirSync(IDENTITIES_DIR, { recursive: true });

    fixture = await listen(http.createServer((req, res) => {
        const url = req.url.split("?")[0];
        if (url === "/page/admin" || url === "/page/viewer") {
            res.writeHead(200, { "content-type": "text/html" });
            res.end(`<!doctype html><title>f</title><h1>Panel</h1><button id="ping" type="button">Ping</button>`);
            return;
        }
        if (url === "/page/cookie") {
            // Isolation oracle. Each page leaves a uniquely named cookie. Its #ping click blocks
            // (synchronous XHR) on /barrier until all three journeys' clicks are pending at once,
            // then reports how many cookies this browsing context holds: 1 = isolated, 3 = shared.
            res.writeHead(200, { "content-type": "text/html" });
            res.end(`<!doctype html><title>f</title><h1>pending</h1><button id="ping" type="button">Ping</button>`
                + `<script>document.cookie = "sid_" + Math.random().toString(36).slice(2) + "=1";`
                + `document.getElementById("ping").addEventListener("click", function () {`
                + `var x = new XMLHttpRequest(); x.open("GET", "/barrier", false); x.send();`
                + `var n = document.cookie.split(";").filter(Boolean).length;`
                + `document.querySelector("h1").textContent = n === 1 ? "none" : "leaked"; });</script>`);
            return;
        }
        if (url === "/barrier") {
            waiting.push(res);
            const release = () => { while (waiting.length) { const w = waiting.pop(); w.writeHead(200); w.end(); } };
            if (waiting.length >= 3) release(); else setTimeout(release, 8000);
            return;
        }
        if (url === "/api/admin") {
            const token = (req.headers["authorization"] || "").replace(/^Bearer\s+/, "");
            res.writeHead(token === T_ADMIN ? 200 : 403); res.end();
            return;
        }
        res.writeHead(404); res.end();
    }));
    llm = await listen(http.createServer((req, res) => { res.writeHead(500); res.end("{}"); }));
    base = `http://127.0.0.1:${fixture.address().port}`;
    for (const k of Object.keys(IDENTITIES)) IDENTITIES[k].origins = [base];
    fs.writeFileSync(IDENTITIES_PATH, JSON.stringify(IDENTITIES));
});

test.after(() => {
    fixture.close(); llm.close();
    if (identitiesBackup !== null) fs.writeFileSync(IDENTITIES_PATH, identitiesBackup);
    else {
        if (fs.existsSync(IDENTITIES_PATH)) fs.unlinkSync(IDENTITIES_PATH);
        if (fixturesCreatedDir) { try { fs.rmdirSync(IDENTITIES_DIR); } catch { /* leave it */ } }
    }
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "s2w-"));

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

const contractObj = (journeyId, assertions) => ({ schemaVersion: 1, journeyId, requirementId: `${journeyId}-REQ`, revision: 1, assertions });
const nav = (id, page, required = true, extra = {}) => ({ id, required, check: "pathEquals", locator: "url:pathname", expected: `/page/${page}`, provenance: prov, ...extra });
const heading = (id, expected, required = true) => ({ id, required, check: "textEquals", locator: "h1", expected, provenance: prov });

/** Propose+approve a contract and write a plan for it into `dir`. Returns the plan file name. */
async function addJourney(ctx, { journeyId, page, assertions, approve = true, contract = true }) {
    const cFile = path.join(ctx.dir, `${journeyId}.contract.json`);
    const c = contractObj(journeyId, assertions);
    fs.writeFileSync(cFile, JSON.stringify(c));
    if (approve) {
        const digest = Contract.parse(JSON.stringify(c)).digest;
        const p = await run([`--contract-propose=${cFile}`, `--store-root=${ctx.store}`], ctx.dir);
        assert.strictEqual(p.code, 0, p.out);
        const a = await run([`--contract-approve=${cFile}`, `--confirm-digest=${digest}`, `--store-root=${ctx.store}`], ctx.dir);
        assert.strictEqual(a.code, 0, a.out);
    }
    const planFile = `${journeyId}.plan.json`;
    fs.writeFileSync(path.join(ctx.dir, planFile), JSON.stringify({
        format: "falcon-test-plan", version: 1, url: `${base}/page/${page}`, journey: true,
        scenarios: contract
            ? [{ action: "click", locator: "#ping", description: "Open panel" }, { action: "verify", description: "Verify" }]
            : [{ action: "click", locator: "#ping", description: "noop" }],
        ...(contract ? { contract: `${journeyId}.contract.json`, journeyId } : {}),
    }));
    return planFile;
}

const newCtx = () => { const dir = tmp(); return { dir, store: path.join(dir, "store") }; };

async function execute(ctx, plans, extra = []) {
    const r = await run([...plans.map((p) => `--plan=${p}`), "--no-dashboard", `--store-root=${ctx.store}`, ...extra], ctx.dir);
    const reportPath = path.join(ctx.dir, "reports", "test-report.json");
    const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, "utf8")) : null;
    return { ...r, report };
}

const accessAssertion = (id, role, expected) => ({
    id, required: true, check: "accessEquals", locator: "authz:access", expected,
    source: { kind: "http-status", url: `${base}/api/admin`, identity: { id: role, role } }, provenance: prov,
});

test("W1 two approved journeys on two workers (admin allowed, viewer denied) => exit 0, BUSINESS_VERIFIED, both journeys reported in order", async () => {
    const ctx = newCtx();
    const a = await addJourney(ctx, { journeyId: "j-admin", page: "admin", assertions: [nav("a-nav", "admin"), heading("a-h", "Panel"), accessAssertion("a-acc", "admin", "allowed")] });
    const v = await addJourney(ctx, { journeyId: "j-viewer", page: "viewer", assertions: [nav("v-nav", "viewer"), heading("v-h", "Panel"), accessAssertion("v-acc", "viewer", "denied")] });
    const r = await execute(ctx, [v, a], ["--workers=2"]);
    assert.strictEqual(r.code, 0, r.out.slice(-1500));
    assert.strictEqual(r.report.result, "PASSED");
    assert.strictEqual(r.report.verification.level, "BUSINESS_VERIFIED");
    assert.deepStrictEqual(r.report.verification.perJourney.map((j) => j.journeyId), ["j-admin", "j-viewer"]);
    assert.strictEqual(r.report.verification.assertions.required, 6);
    assert.strictEqual(r.report.verification.assertions.pass, 6);
    const text = JSON.stringify(r.report) + r.out;
    for (const secret of [T_ADMIN, T_VIEW]) assert.ok(!text.includes(secret), "identity tokens must never reach reports or logs");
});

test("W2 required failure in one journey => exit 1, FAILED, other journey still verified (journeys sorted by id: j-bad, j-ok)", async () => {
    const ctx = newCtx();
    const a = await addJourney(ctx, { journeyId: "j-ok", page: "admin", assertions: [nav("ok-nav", "admin")] });
    const b = await addJourney(ctx, { journeyId: "j-bad", page: "viewer", assertions: [heading("bad-h", "WRONG-HEADING")] });
    const r = await execute(ctx, [a, b], ["--workers=2"]);
    assert.strictEqual(r.code, 1, r.out.slice(-1500));
    assert.strictEqual(r.report.verification.level, "FAILED");
    assert.deepStrictEqual(r.report.verification.perJourney.map((j) => j.level), ["FAILED", "BUSINESS_VERIFIED"]);
});

test("W3 optional failure beside required passes (different digests) => exit 0, BUSINESS_VERIFIED, optional failure visible", async () => {
    const ctx = newCtx();
    const a = await addJourney(ctx, { journeyId: "j-a", page: "admin", assertions: [nav("a-nav", "admin"), heading("a-opt", "NOPE", false)] });
    const b = await addJourney(ctx, { journeyId: "j-b", page: "viewer", assertions: [nav("b-nav", "viewer")] });
    const r = await execute(ctx, [a, b], ["--workers=2"]);
    assert.strictEqual(r.code, 0, r.out.slice(-1500));
    assert.strictEqual(r.report.verification.level, "BUSINESS_VERIFIED");
    assert.ok(r.report.verification.reasonCodes.includes("OPTIONAL_FAILED"));
    assert.strictEqual(r.report.verification.assertions.optional.fail, 1);
});

test("W4 browser isolation: concurrent journeys never see each other's cookies", async () => {
    const ctx = newCtx();
    const plans = [];
    for (const id of ["j-c1", "j-c2", "j-c3"]) {
        plans.push(await addJourney(ctx, { journeyId: id, page: "cookie", assertions: [{ id: `${id}-seen`, required: true, check: "textEquals", locator: "h1", expected: "none", provenance: prov }] }));
    }
    const r = await execute(ctx, plans, ["--workers=3"]);
    assert.strictEqual(r.code, 0, r.out.slice(-1500));
    assert.strictEqual(r.report.verification.level, "BUSINESS_VERIFIED");
});

test("W5 workers=1 with several plans runs sequentially and agrees with parallel execution", async () => {
    const ctx = newCtx();
    const a = await addJourney(ctx, { journeyId: "j-a", page: "admin", assertions: [nav("a-nav", "admin")] });
    const b = await addJourney(ctx, { journeyId: "j-b", page: "viewer", assertions: [nav("b-nav", "viewer")] });
    const seq = await execute(ctx, [a, b]);
    const par = await execute(ctx, [a, b], ["--workers=2"]);
    assert.strictEqual(seq.code, 0, seq.out.slice(-800));
    assert.strictEqual(par.code, 0, par.out.slice(-800));
    assert.deepStrictEqual(seq.report.verification.perJourney, par.report.verification.perJourney);
    assert.deepStrictEqual(seq.report.verification.assertions, par.report.verification.assertions);
});

test("W6 unsafe or unsupported configurations are refused before any browser work (exit 1)", async () => {
    const ctx = newCtx();
    const a = await addJourney(ctx, { journeyId: "j-a", page: "admin", assertions: [nav("a-nav", "admin")] });
    const b = await addJourney(ctx, { journeyId: "j-b", page: "viewer", assertions: [nav("b-nav", "viewer")] });
    const plain = await addJourney(ctx, { journeyId: "j-plain", page: "admin", assertions: [], contract: false, approve: false });
    const cases = {
        "contract plan with --shard": [[a], ["--shard=1/2"]],
        "several contract plans with --shard": [[a, b], ["--shard=1/2", "--workers=2"]],
        "workers above the limit": [[a, b], ["--workers=9"]],
        "workers not an integer": [[a, b], ["--workers=1.5"]],
        "the same plan twice": [[a, a], ["--workers=2"]],
        "a contractless plan among journeys": [[a, plain], ["--workers=2"]],
        "workers with --single-page": [[a], ["--workers=2", "--single-page"]],
        "workers with --save-plan": [[a, b], ["--workers=2", "--save-plan=x.json"]],
        "--url with several plans": [[a, b], ["--workers=2", `--url=${base}/page/admin`]],
    };
    for (const [name, [plans, extra]] of Object.entries(cases)) {
        fs.rmSync(path.join(ctx.dir, "reports"), { recursive: true, force: true });
        const r = await execute(ctx, plans, extra);
        assert.strictEqual(r.code, 1, `${name}: ${r.out.slice(-600)}`);
        assert.ok(!r.report, `${name}: a refused run must not produce a verification report`);
    }
});

test("W7 two journeys that are the same journey id under different files are refused", async () => {
    const ctx = newCtx();
    const a = await addJourney(ctx, { journeyId: "j-dup", page: "admin", assertions: [nav("a-nav", "admin")] });
    fs.copyFileSync(path.join(ctx.dir, a), path.join(ctx.dir, "copy.plan.json"));
    fs.copyFileSync(path.join(ctx.dir, "j-dup.contract.json"), path.join(ctx.dir, "j-dup2.contract.json"));
    const doc = JSON.parse(fs.readFileSync(path.join(ctx.dir, "copy.plan.json"), "utf8"));
    doc.contract = "j-dup2.contract.json";
    fs.writeFileSync(path.join(ctx.dir, "copy.plan.json"), JSON.stringify(doc));
    const r = await execute(ctx, [a, "copy.plan.json"], ["--workers=2"]);
    assert.strictEqual(r.code, 1, r.out.slice(-600));
    assert.ok(!r.report);
});

test("W8 an unapproved contract among the journeys is never verified (exit 1, not BUSINESS_VERIFIED)", async () => {
    const ctx = newCtx();
    const a = await addJourney(ctx, { journeyId: "j-a", page: "admin", assertions: [nav("a-nav", "admin")] });
    const u = await addJourney(ctx, { journeyId: "j-u", page: "viewer", assertions: [nav("u-nav", "viewer")], approve: false });
    const r = await execute(ctx, [a, u], ["--workers=2"]);
    assert.strictEqual(r.code, 1, r.out.slice(-800));
    assert.notStrictEqual(r.report.verification.level, "BUSINESS_VERIFIED");
});

test("W9 legacy: a single --plan keeps the single-process path and report shape; --workers=1 is identical", async () => {
    const ctx = newCtx();
    const a = await addJourney(ctx, { journeyId: "j-a", page: "admin", assertions: [nav("a-nav", "admin"), heading("a-h", "Panel")] });
    const legacy = await execute(ctx, [a]);
    assert.strictEqual(legacy.code, 0, legacy.out.slice(-800));
    assert.strictEqual(legacy.report.verification.level, "BUSINESS_VERIFIED");
    assert.strictEqual(legacy.report.verification.perJourney, undefined, "single journey keeps the existing shape");
    const one = await execute(ctx, [a], ["--workers=1"]);
    assert.strictEqual(one.code, 0);
    assert.deepStrictEqual(one.report.verification, legacy.report.verification);
    // A single approved journey routed through the coordinator keeps the same verification block.
    const viaCoordinator = await execute(ctx, [a], ["--workers=2"]);
    assert.strictEqual(viaCoordinator.code, 0, viaCoordinator.out.slice(-800));
    assert.deepStrictEqual(viaCoordinator.report.verification, legacy.report.verification);
});

test("W10 legacy: a contractless single plan is unchanged (no verification claim, exit 0)", async () => {
    const ctx = newCtx();
    const plain = await addJourney(ctx, { journeyId: "j-plain", page: "admin", assertions: [], contract: false, approve: false });
    const r = await execute(ctx, [plain]);
    assert.strictEqual(r.code, 0, r.out.slice(-800));
    assert.notStrictEqual(r.report.verification.level, "BUSINESS_VERIFIED");
});
