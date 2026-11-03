"use strict";
/**
 * WP-77S end to end: approved backend side-effect assertions (backendEquals, backendCountEquals,
 * backendExists) against a trusted local fixture, driven through the real `falcon.js --plan` CLI in
 * a child process (real Chromium, loopback only, no LLM). The page always claims success; the
 * verdict must come from the backend state that Falcon reads itself. Oracle values are constants
 * below, never read from Falcon's own output.
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

const JOURNEY_ID = "order-backend";
const EXPECTED_REF = "S3CR3T-ORDER-4471";
const OBSERVED_REF = "S3CR3T-OBSERVED-8820";
const LATE_FLIP_MS = 500;

// Backend documents per variant (the fixture specification).
const STATE = {
    paid: () => ({ status: "paid", items: [1, 2] }),
    pending: () => ({ status: "pending", items: [1, 2] }),
    "wrong-count": () => ({ status: "paid", items: [1] }),
    "wrong-ref": () => ({ status: "paid", items: [1, 2], ref: OBSERVED_REF }),
};

let fixture, llm, llmHits = 0, base;
let lateFlippedAt = new Map();
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));

function pageHtml(variant) {
    // The page always reports success and carries a decoy that displays the expected value.
    return `<!doctype html><title>fixture</title>
        <button id="save">Save order</button>
        <span id="msg"></span>
        <span id="decoy">paid</span>
        <script>
            document.getElementById('save').addEventListener('click', function () {
                fetch('/act/${variant}', { method: 'POST' });
                document.getElementById('msg').textContent = 'Order saved!';
            });
        </script>`;
}

test.before(async () => {
    fixture = await listen(http.createServer((req, res) => {
        const url = req.url.split("?")[0];
        let m;
        if ((m = /^\/page\/([a-z-]+)$/.exec(url))) {
            res.writeHead(200, { "content-type": "text/html" });
            res.end(pageHtml(m[1]));
            return;
        }
        if ((m = /^\/act\/([a-z-]+)$/.exec(url)) && req.method === "POST") {
            if (!lateFlippedAt.has(m[1])) lateFlippedAt.set(m[1], Date.now());
            res.writeHead(204); res.end();
            return;
        }
        if ((m = /^\/api\/orders\/([a-z-]+)$/.exec(url))) {
            const v = m[1];
            if (v === "down") { req.socket.destroy(); return; }
            let doc;
            if (v === "late") {
                const t = lateFlippedAt.get(v);
                doc = t && Date.now() - t >= LATE_FLIP_MS ? STATE.paid() : STATE.pending();
            } else if (STATE[v]) {
                doc = STATE[v]();
            } else { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(doc));
            return;
        }
        res.writeHead(404); res.end();
    }));
    llm = await listen(http.createServer((req, res) => { llmHits++; res.writeHead(500); res.end("{}"); }));
    base = `http://127.0.0.1:${fixture.address().port}`;
});
test.after(() => { fixture.close(); llm.close(); });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "side77s-"));
const prov = { source: "spec", ref: "plan:order" };

function contractObj(variant, { withRef = false, extra = {} } = {}) {
    const source = (pointer) => ({ kind: "http-json", url: `${base}/api/orders/${variant}`, pointer });
    const a = [
        { id: "order-status", required: true, check: "backendEquals", locator: "backend:state", expected: "paid", source: source("/status"), provenance: prov },
        { id: "order-items", required: true, check: "backendCountEquals", locator: "backend:state", expected: 2, source: source("/items"), provenance: prov },
        { id: "order-exists", required: true, check: "backendExists", locator: "backend:state", expected: true, source: source("/status"), provenance: prov },
    ];
    if (withRef) a.push({ id: "order-ref", required: true, check: "backendEquals", locator: "backend:state", expected: EXPECTED_REF, source: source("/ref"), provenance: prov });
    return { schemaVersion: 1, journeyId: JOURNEY_ID, requirementId: "ORDER-001", revision: 1, assertions: a, ...extra };
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

async function setup({ variant, state = "approved", contract, plan = true }) {
    const dir = tmp();
    const store = path.join(dir, "store");
    const contractFile = path.join(dir, "contract.json");
    const c = contract || contractObj(variant);
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
        format: "falcon-test-plan", version: 1, url: `${base}/page/${variant}`, journey: true,
        scenarios: [
            { action: "click", locator: "#save", description: "Save order" },
            ...(plan ? [{ action: "expect", locator: "#msg", check: "containsText", value: "Order saved!", description: "UI reports success" }] : []),
            ...(plan ? [{ action: "verify", description: "Verify order" }] : []),
        ],
        ...(plan ? { contract: "contract.json", journeyId: JOURNEY_ID } : {}),
    };
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(doc));
    return { dir, store, contractFile, digest, setupOut: ops.map((o) => o.out).join("\n") };
}

async function execute(ctx) {
    const r = await run(["--plan=plan.json", "--no-dashboard", `--store-root=${ctx.store}`], ctx.dir);
    const report = JSON.parse(fs.readFileSync(path.join(ctx.dir, "reports", "test-report.json"), "utf8"));
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

test("S1 positive: UI success + correct backend => BUSINESS_VERIFIED, exit 0, rows value-free", async () => {
    const ctx = await setup({ variant: "paid" });
    const r = await execute(ctx);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
    const by = assertionRows(r);
    assert.deepStrictEqual(Object.keys(by), ["order-status", "order-items", "order-exists"]);
    for (const x of Object.values(by)) {
        assert.strictEqual(x.status, "passed");
        assert.strictEqual(x.assertion.digest, ctx.digest);
        assert.strictEqual(x.assertion.locator, "backend:state");
        assert.ok(!("expected" in x.assertion) && !("actual" in x.assertion));
    }
});

test("S2 headline: UI says 'Order saved!' but backend state is pending => FAILED, nonzero exit", async () => {
    const ctx = await setup({ variant: "pending" });
    const r = await execute(ctx);
    assert.strictEqual(rowsByName(r, "UI reports success").status, "passed", "the browser interaction itself succeeded");
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "FAILED");
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
    const by = assertionRows(r);
    assert.strictEqual(by["order-status"].status, "failed");
    assert.strictEqual(by["order-items"].status, "passed");
});

function rowsByName(r, suffix) {
    return r.rows.find((x) => x.name.endsWith(suffix));
}

test("S2b wrong item count in the backend => FAILED", async () => {
    const r = await execute(await setup({ variant: "wrong-count" }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "FAILED");
    assert.strictEqual(assertionRows(r)["order-items"].status, "failed");
});

test("S3 backend down => nonzero, never BUSINESS_VERIFIED, rows unavailable", async () => {
    const r = await execute(await setup({ variant: "down" }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "UNVERIFIED");
    for (const x of Object.values(assertionRows(r))) assert.strictEqual(x.status, "unavailable");
});

test("S4 eventual consistency: backend becomes correct shortly after the click => BUSINESS_VERIFIED", async () => {
    lateFlippedAt.delete("late");
    const r = await execute(await setup({ variant: "late" }));
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
});

test("S6 contract tampered after approval => NOT_APPROVED, nonzero, not BUSINESS_VERIFIED", async () => {
    const ctx = await setup({ variant: "paid" });
    const edited = contractObj("paid");
    edited.assertions[0].expected = "shipped";
    fs.writeFileSync(ctx.contractFile, JSON.stringify(edited));
    const r = await execute(ctx);
    assert.strictEqual(r.level, "UNVERIFIED");
    assert.ok(r.out.includes("NOT_APPROVED"));
    assert.notStrictEqual(r.code, 0);
});

test("S6b backend source retargeted after approval (same assertions, other URL) => NOT_APPROVED", async () => {
    const ctx = await setup({ variant: "pending" });
    const edited = contractObj("paid"); // would pass if the retarget were honoured
    fs.writeFileSync(ctx.contractFile, JSON.stringify(edited));
    const r = await execute(ctx);
    assert.strictEqual(r.level, "UNVERIFIED");
    assert.ok(r.out.includes("NOT_APPROVED"));
    assert.notStrictEqual(r.code, 0);
});

test("S7 proposed-only contract cannot verify even with a correct backend", async () => {
    const r = await execute(await setup({ variant: "paid", state: "proposed" }));
    assert.notStrictEqual(r.code, 0);
    assert.strictEqual(r.level, "UNVERIFIED");
    assert.ok(r.out.includes("NOT_APPROVED"));
});

test("S8 decoy on the page showing the expected value cannot rescue a wrong backend", async () => {
    const r = await execute(await setup({ variant: "pending" }));
    assert.strictEqual(r.level, "FAILED");
});

test("S9 privacy: expected and observed secrets never reach reports, stdout/stderr (run)", async () => {
    const ctx = await setup({ variant: "wrong-ref", contract: contractObj("wrong-ref", { withRef: true }) });
    const r = await execute(ctx);
    assert.strictEqual(r.level, "FAILED");
    assert.strictEqual(assertionRows(r)["order-ref"].status, "failed");
    for (const f of walk(path.join(ctx.dir, "reports"))) {
        const content = fs.readFileSync(f, "utf8");
        for (const s of [EXPECTED_REF, OBSERVED_REF]) assert.ok(!content.includes(s), `${f} leaks ${s}`);
    }
    for (const s of [EXPECTED_REF, OBSERVED_REF]) assert.ok(!r.out.includes(s), `run output leaks ${s}`);
});

test("S9b privacy: the operator approval output shows the approved source (documented) and nothing observed", async () => {
    const ctx = await setup({ variant: "wrong-ref", contract: contractObj("wrong-ref", { withRef: true }) });
    assert.ok(ctx.setupOut.includes(EXPECTED_REF), "approval review shows the expected value to the operator by design");
    assert.ok(!ctx.setupOut.includes(OBSERVED_REF));
    assert.ok(!/[\u001b\r]/.test(ctx.setupOut));
});

test("S10 legacy plan without a contract is unaffected: INTERACTION_ONLY, exit 0", async () => {
    const r = await execute(await setup({ variant: "paid", plan: false, state: "none" }));
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "INTERACTION_ONLY");
});

test("runtime made zero LLM requests across every run", () => {
    assert.strictEqual(llmHits, 0);
});
