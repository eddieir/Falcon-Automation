"use strict";
/**
 * WP-77I end to end: proposal -> operator approval -> execution -> verification
 * for navigation, data, backend and permission assertions, required and
 * optional, plus shard-evidence refusal cases. Driven through the real
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
        if (url === "/api/state") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ orders: [1, 2], status: "ok" }));
            return;
        }
        res.writeHead(404); res.end();
    }));
    llm = await listen(http.createServer((req, res) => { llmHits++; res.writeHead(500); res.end("{}"); }));
    base = `http://127.0.0.1:${fixture.address().port}`;
    // Identities may only be used against the fixture origin (WP-77R).
    for (const k of Object.keys(IDENTITIES)) IDENTITIES[k].origins = [base];
    fs.writeFileSync(IDENTITIES_PATH, JSON.stringify(IDENTITIES));
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

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "int77i-"));
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

// ------------------------------------------------------------------ helpers

const sha = (v) => require("node:crypto").createHash("sha256").update(v).digest("hex");

function fullAssertions(role) {
    const ui = role === "admin"
        ? [
            { id: "delete-visible", required: true, check: "visible", locator: "#delete", provenance: prov },
            { id: "delete-enabled", required: true, check: "enabled", locator: "#delete", provenance: prov },
        ]
        : [{ id: "delete-disabled", required: true, check: "disabled", locator: "#delete", provenance: prov }];
    return [
        { id: "nav-path", required: true, check: "pathEquals", locator: "url:pathname", expected: `/page/${role}`, provenance: prov },
        { id: "nav-heading", required: true, check: "textEquals", locator: "h1", expected: "Admin panel", provenance: prov },
        { id: "btn-count", required: true, check: "countEquals", locator: "button", expected: 2, provenance: prov },
        { id: "orders-count", required: true, check: "backendCountEquals", locator: "backend:state", expected: 2, source: { kind: "http-json", url: `${base}/api/state`, pointer: "/orders" }, provenance: prov },
        ...ui,
        { id: "access", required: true, check: "accessEquals", locator: "authz:access", expected: role === "admin" ? "allowed" : "denied", source: accessSource("/api/admin", role, role), provenance: prov },
    ];
}

const navAssertion = (extra = {}) => ({ id: "nav-path", required: true, check: "pathEquals", locator: "url:pathname", expected: "/page/admin", provenance: prov, ...extra });
const optional = (a) => ({ ...a, required: false });

// ---------------------------------------------------- E1 proposal -> verification

test("E1 draft -> propose -> operator approval -> execution -> BUSINESS_VERIFIED (nav+data+backend+permission together)", async () => {
    const dir = tmp();
    const store = path.join(dir, "store");
    const specFile = path.join(dir, "spec.json");
    const contractFile = path.join(dir, "contract.json");
    const specAssertions = fullAssertions("admin").map(({ provenance, ...rest }) => rest);
    fs.writeFileSync(specFile, JSON.stringify({ journeyId: JOURNEY_ID, requirementId: "ADMIN-DEL-001", revision: 1, assertions: specAssertions }));

    const d = await run([`--contract-draft=${specFile}`, `--out=${contractFile}`], dir);
    assert.strictEqual(d.code, 0, d.out);
    assert.ok(fs.existsSync(contractFile), "draft file must be written");
    assert.ok(!fs.existsSync(store), "a draft must never create approval state");
    const m = /digest (sha256:[0-9a-f]{64})/.exec(d.out);
    assert.ok(m, `draft output must show the digest: ${d.out}`);

    const p = await run([`--contract-propose=${contractFile}`, `--store-root=${store}`], dir);
    assert.strictEqual(p.code, 0, p.out);
    const a = await run([`--contract-approve=${contractFile}`, `--confirm-digest=${m[1]}`, `--store-root=${store}`], dir);
    assert.strictEqual(a.code, 0, a.out);

    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({
        format: "falcon-test-plan", version: 1, url: `${base}/page/admin`, journey: true,
        scenarios: [{ action: "click", locator: "#ping", description: "Open admin panel" }, { action: "verify", description: "Verify" }],
        contract: "contract.json", journeyId: JOURNEY_ID,
    }));
    const r = await execute({ dir, store });
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
    const by = assertionRows(r);
    for (const x of specAssertions) {
        assert.strictEqual(by[x.id].status, "passed", x.id);
        assert.strictEqual(by[x.id].assertion.digest, m[1], `${x.id} must carry the approved digest`);
    }
});

test("E6 viewer: nav+data+backend+denied permission together verify; buggy backend is a FAILED counterexample", async () => {
    const ok = await execute(await setup({ role: "viewer", assertions: fullAssertions("viewer") }));
    assert.strictEqual(ok.code, 0, ok.out);
    assert.strictEqual(ok.level, "BUSINESS_VERIFIED");

    const bad = fullAssertions("viewer").map((a) => (a.id === "access" ? { ...a, source: accessSource("/api/admin-buggy", "viewer", "viewer") } : a));
    const r = await execute(await setup({ role: "viewer", assertions: bad }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "FAILED");
    assert.strictEqual(assertionRows(r).access.status, "failed");
    assert.strictEqual(assertionRows(r)["delete-disabled"].status, "passed", "the UI assertion alone would have been green");
});

// ------------------------------------------------------ E2 required pass / fail

test("E2 required assertion pass and failure", async () => {
    const pass = await execute(await setup({ role: "admin", assertions: [navAssertion()] }));
    assert.strictEqual(pass.code, 0, pass.out);
    assert.strictEqual(pass.level, "BUSINESS_VERIFIED");

    const fail = await execute(await setup({ role: "admin", assertions: [navAssertion({ expected: "/page/viewer" })] }));
    assert.notStrictEqual(fail.code, 0, fail.out);
    assert.strictEqual(fail.level, "FAILED");
    assert.strictEqual(assertionRows(fail)["nav-path"].status, "failed");
});

// ---------------------------------------------------------- E3 optional outcomes

test("E3 optional assertion pass, fail and unavailable never fail the run or inflate required counts", async () => {
    const wrongHeading = { id: "opt-heading", required: false, check: "textEquals", locator: "h1", expected: "Wrong heading", provenance: prov };
    const missingTarget = { id: "opt-missing", required: false, check: "visible", locator: "#does-not-exist", provenance: prov };
    const optPass = optional({ id: "opt-count", required: true, check: "countEquals", locator: "button", expected: 2, provenance: prov });

    const rPass = await execute(await setup({ role: "admin", assertions: [navAssertion(), optPass] }));
    assert.strictEqual(rPass.code, 0, rPass.out);
    assert.strictEqual(rPass.level, "BUSINESS_VERIFIED");
    assert.strictEqual(rPass.report.verification.assertions.required, 1);
    assert.deepStrictEqual(rPass.report.verification.assertions.optional, { total: 1, pass: 1, fail: 0, inconclusive: 0, notTested: 0 });
    assert.strictEqual(rPass.report.summary.optionalNotPassed, undefined);

    const rFail = await execute(await setup({ role: "admin", assertions: [navAssertion(), wrongHeading] }));
    assert.strictEqual(rFail.code, 0, rFail.out);
    assert.strictEqual(rFail.level, "BUSINESS_VERIFIED");
    assert.strictEqual(rFail.report.verification.assertions.fail, 0, "an optional failure is not a required failure");
    assert.strictEqual(rFail.report.verification.assertions.optional.fail, 1);
    assert.ok(rFail.report.verification.reasonCodes.includes("OPTIONAL_FAILED"));
    assert.strictEqual(rFail.report.summary.optionalNotPassed, 1);
    assert.strictEqual(assertionRows(rFail)["opt-heading"].status, "failed", "the optional failure stays visible in evidence");
    assert.strictEqual(assertionRows(rFail)["opt-heading"].required, false);

    const rUn = await execute(await setup({ role: "admin", assertions: [navAssertion(), missingTarget] }));
    assert.strictEqual(rUn.code, 0, rUn.out);
    assert.strictEqual(rUn.level, "BUSINESS_VERIFIED");
    assert.strictEqual(rUn.report.verification.assertions.optional.inconclusive, 1);
    assert.ok(rUn.report.verification.reasonCodes.includes("OPTIONAL_UNVERIFIED"));
    assert.strictEqual(assertionRows(rUn)["opt-missing"].status, "unavailable");
});

test("E3b an optional-only contract never claims business verification", async () => {
    const r = await execute(await setup({ role: "admin", assertions: [navAssertion({ required: false })] }));
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "INTERACTION_ONLY");
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
    assert.strictEqual(r.report.verification.assertions.required, 0);
});

test("E4 a failing required assertion with a passing optional one is FAILED with a nonzero exit", async () => {
    const r = await execute(await setup({ role: "admin", assertions: [navAssertion({ expected: "/page/viewer" }), optional({ id: "opt-count", required: true, check: "countEquals", locator: "button", expected: 2, provenance: prov })] }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "FAILED");
    assert.strictEqual(r.report.verification.assertions.fail, 1);
});

// ------------------------------------------------------------------- E5 / E8

test("E5 contractless execution can never produce BUSINESS_VERIFIED", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({
        format: "falcon-test-plan", version: 1, url: `${base}/page/admin`, journey: true,
        scenarios: [{ action: "click", locator: "#ping", description: "noop" }, { action: "expect", locator: "h1", check: "containsText", value: "Admin panel", description: "heading visible" }],
    }));
    const r = await execute({ dir, store: path.join(dir, "store") });
    assert.strictEqual(r.code, 0, r.out);
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
    assert.strictEqual(r.level, "INTERACTION_ONLY");
});

test("E8 exit codes: unapproved contract is never verified and exits nonzero; PASSED exits 0", async () => {
    for (const state of ["none", "proposed"]) {
        const r = await execute(await setup({ role: "admin", assertions: [navAssertion()], state }));
        assert.notStrictEqual(r.code, 0, `${state}: ${r.out}`);
        assert.notStrictEqual(r.level, "BUSINESS_VERIFIED", state);
    }
    const ok = await execute(await setup({ role: "admin", assertions: [navAssertion()] }));
    assert.strictEqual(ok.code, 0, ok.out);
});

// ------------------------------------------------------------- E7 shard evidence

async function mergeRows(rowsPerPage) {
    const ShardMerge = require(path.join(R, "src/core/parallel/ShardMerge"));
    const ShardBundle = require(path.join(R, "src/core/parallel/ShardBundle"));
    const StateJournal = require(path.join(R, "src/core/parallel/StateJournal"));
    const Schemas = require(path.join(R, "src/core/parallel/Schemas"));
    const H = (c) => c.repeat(64);
    const RUN = "gh-77i00001";
    const total = 2;
    const fragmentFor = (ord, rows) => ShardBundle.buildFragment({
        runId: RUN, shard: { index: (ord % total) + 1, total },
        page: { ordinal: ord, results: rows, scenarioNames: rows.map((r2) => r2.name), disposition: "completed", status: "ok", uiIssues: [] },
    });
    const journalFor = (ord) => {
        const j = new StateJournal({
            runId: RUN, shard: { index: (ord % total) + 1, total }, pageOrdinal: ord, commit: "unknown", configFp: H("a"),
            planDigest: H("c"), snapshotAt: "2030-01-01T00:00:00.000Z", clock: () => new Date("2030-01-01T00:00:01.000Z"),
        });
        j.record("flakiness.outcome", 0, 0, { action: "click", locator: "#b" + ord, status: "passed", outcome: null, errorType: null, durationMs: 5, description: "d" });
        return j.finish("ok");
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "int77i-shard-"));
    const dir = path.join(root, "in", RUN);
    for (let idx = 1; idx <= total; idx++) {
        const sd = path.join(dir, `shard-${idx}-of-${total}`);
        fs.mkdirSync(path.join(sd, "fragments"), { recursive: true });
        fs.mkdirSync(path.join(sd, "journals"), { recursive: true });
        const pages = rowsPerPage.map((rows, o) => {
            const mine = (o % total) + 1 === idx;
            const e = { ordinal: o, url: `https://example.test/p${o}`, assigned: mine, disposition: "completed", fragment: null, journal: null };
            if (mine) {
                const fragment = fragmentFor(o, rows);
                assert.ok(Schemas.validateFragment(fragment).ok, "fixture fragment must be schema-valid");
                const journal = journalFor(o);
                const ft = JSON.stringify(fragment); const jt = JSON.stringify(journal);
                fs.writeFileSync(path.join(sd, "fragments", `page-${o}.json`), ft);
                fs.writeFileSync(path.join(sd, "journals", `page-${o}.json`), jt);
                e.fragment = { name: `page-${o}.json`, bytes: Buffer.byteLength(ft), sha256: sha(ft) };
                e.journal = { name: `page-${o}.json`, bytes: Buffer.byteLength(jt), sha256: sha(jt), events: journal.count };
            }
            return e;
        });
        fs.writeFileSync(path.join(sd, "manifest.json"), JSON.stringify({
            schema: "falcon.shard-manifest", v: 1, runId: RUN, shard: { index: idx, total }, attempt: 1, commit: "unknown",
            configFp: H("a"), frontierDigest: H("b"), planDigest: H("c"), pages,
            exit: { code: 0, verdictCounts: { passed: 1 } },
            timing: { startedAt: "2030-01-01T00:00:00.000Z", endedAt: "2030-01-01T00:00:10.000Z", wallMs: 10000 },
            limits: { workers: 1, budgetMs: null },
        }));
    }
    const paths = { dataDir: path.join(root, "data"), reportsDir: path.join(root, "reports") };
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.mkdirSync(paths.reportsDir, { recursive: true });
    const merged = await ShardMerge.merge({ inputDir: dir, expectTotal: total, paths, env: { FALCON_LOCATOR_SALT: "fixture-salt" } });
    const report = merged.reportPath ? JSON.parse(fs.readFileSync(merged.reportPath, "utf8")) : null;
    return { merged, report };
}

const D1 = "sha256:" + "a".repeat(64);
const D2 = "sha256:" + "b".repeat(64);
const shardRow = (status, id, digest, required) => ({
    name: `row-${id}-${status}`, status, duration: 5, repetition: 1,
    assertion: { id, digest, check: "pathEquals", locator: "url:pathname", outcome: status === "passed" ? "path_match" : "path_mismatch", matches: 1 },
    ...(required === undefined ? {} : { required }),
});

test("E7a a forged failing optional shard row cannot hide a failure (optional claim is untrusted without proven approval)", async () => {
    const { report } = await mergeRows([[shardRow("passed", "req", D1, true), shardRow("failed", "opt", D1, false)]]);
    assert.ok(report, "merge should still produce a report");
    assert.notStrictEqual(report.result, "PASSED");
    assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED");
    assert.strictEqual(report.summary.optionalNotPassed, undefined);
});

test("E7b shard rows can never manufacture BUSINESS_VERIFIED (all-pass, duplicate and contradictory evidence)", async () => {
    const cases = {
        allPass: [shardRow("passed", "req", D1, true)],
        duplicate: [shardRow("passed", "req", D1, true), shardRow("passed", "req", D1, true)],
        contradictoryDigest: [shardRow("passed", "req", D1, true), shardRow("passed", "req2", D2, true)],
        contradictoryOutcome: [shardRow("passed", "req", D1, true), shardRow("failed", "req", D1, true)],
    };
    for (const [name, rows] of Object.entries(cases)) {
        const { merged, report } = await mergeRows([rows]);
        if (!report) {
            assert.ok(!merged.reportPath, `${name}: rejected merges must write no report`);
            continue;
        }
        assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED", name);
    }
    const { report } = await mergeRows([[shardRow("passed", "req", D1, true), shardRow("failed", "req", D1, true)]]);
    if (report) assert.strictEqual(report.verification.level, "FAILED", "a failure can never be reduced by merging");
});

test("E7c a legacy contractless shard merges unchanged", async () => {
    const legacy = { name: "legacy", status: "passed", duration: 5, repetition: 1 };
    const { report } = await mergeRows([[legacy]]);
    assert.ok(report);
    assert.strictEqual(report.result, "PASSED");
    assert.strictEqual(report.verification.level, "INTERACTION_ONLY");
});

// ---------------------------------------------------- E9 privacy and provenance

test("E9 reports carry the digest and fixed outcome codes but no tokens, URLs or expected values for data/backend/permission rows", async () => {
    const ctx = await setup({ role: "admin", assertions: fullAssertions("admin"), journeyId: "privacy-journey" });
    const r = await execute(ctx);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED", r.out);
    for (const f of walk(path.join(ctx.dir, "reports"))) {
        const content = fs.readFileSync(f, "utf8");
        for (const s of [T_ADMIN, T_VIEW, `${base}/api/`]) assert.ok(!content.includes(s), `${f} leaks ${s}`);
    }
    for (const s of [T_ADMIN, T_VIEW, `${base}/api/`]) assert.ok(!r.out.includes(s), `run output leaks ${s}`);
    const by = assertionRows(r);
    for (const id of ["btn-count", "orders-count", "access", "delete-visible"]) {
        assert.ok(by[id].assertion.digest.startsWith("sha256:"), `${id} must carry provenance`);
        assert.ok(!("expected" in by[id].assertion) || id === "nav-path", `${id} must not carry expected`);
        assert.ok(!("actual" in by[id].assertion), `${id} must not carry actual`);
    }
});

// --------------------------------------------------------------- E10 draft CLI

test("E10 draft CLI: refuses to overwrite, rejects invalid specs without writing, never creates store state", async () => {
    const dir = tmp();
    const store = path.join(dir, "store");
    const good = { journeyId: JOURNEY_ID, requirementId: "R-1", revision: 1, assertions: [{ id: "nav-path", check: "pathEquals", locator: "url:pathname", expected: "/page/admin" }] };
    const specFile = path.join(dir, "spec.json");
    const out = path.join(dir, "contract.json");
    fs.writeFileSync(specFile, JSON.stringify(good));

    const first = await run([`--contract-draft=${specFile}`, `--out=${out}`], dir);
    assert.strictEqual(first.code, 0, first.out);
    const before = fs.readFileSync(out);
    const again = await run([`--contract-draft=${specFile}`, `--out=${out}`], dir);
    assert.notStrictEqual(again.code, 0, "must refuse to overwrite");
    assert.deepStrictEqual(fs.readFileSync(out), before, "existing file must be untouched");

    const bad = {
        unknownCheck: { ...good, assertions: [{ id: "x", check: "madeUpCheck", locator: "#a", expected: "b" }] },
        duplicateId: { ...good, assertions: [good.assertions[0], good.assertions[0]] },
        observedProvenance: { ...good, assertions: [{ ...good.assertions[0], provenance: { source: "observed", ref: "x" } }] },
        smuggledApproval: { ...good, approval: { status: "approved" } },
        missingExpected: { ...good, assertions: [{ id: "x", check: "textEquals", locator: "h1" }] },
    };
    for (const [name, spec] of Object.entries(bad)) {
        const f = path.join(dir, `bad-${name}.json`);
        const o = path.join(dir, `bad-${name}-out.json`);
        fs.writeFileSync(f, JSON.stringify(spec));
        const r = await run([`--contract-draft=${f}`, `--out=${o}`], dir);
        assert.notStrictEqual(r.code, 0, `${name} must be rejected`);
        assert.ok(!fs.existsSync(o), `${name} must write nothing`);
    }
    const unreadable = await run([`--contract-draft=${path.join(dir, "missing.json")}`, `--out=${path.join(dir, "o2.json")}`], dir);
    assert.notStrictEqual(unreadable.code, 0);
    assert.ok(!fs.existsSync(path.join(dir, "o2.json")));
    assert.ok(!fs.existsSync(store), "drafting must never create approval state");
});

test("runtime made zero LLM requests across every run", () => {
    assert.strictEqual(llmHits, 0);
});
