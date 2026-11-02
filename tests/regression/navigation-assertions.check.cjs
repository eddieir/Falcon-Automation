"use strict";
/**
 * WP-77N end to end: approved navigation assertions against a local checkout fixture, driven
 * through the real `falcon.js --plan` CLI in a child process (real Chromium, no network, no LLM).
 * Oracle values come from the fixture specification below, never from Falcon's own output.
 * A false business outcome must fail the child process; this suite passes because it asserts that.
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

// Fixture specification (the oracle).
const SPEC = { path: "/order/confirmed", heading: "Thank you", journeyId: "checkout-basic" };
const PAGES = {
    "/checkout/ok": `<button id="checkout" onclick="location.href='/order/confirmed'">Checkout</button>`,
    "/checkout/error": `<button id="checkout" onclick="location.href='/order/error'">Checkout</button>`,
    "/checkout/wrongtext": `<button id="checkout" onclick="location.href='/order/confirmed-wrong-text'">Checkout</button>`,
    "/checkout/noheading": `<button id="checkout" onclick="location.href='/order/noheading'">Checkout</button>`,
    "/checkout/twoheadings": `<button id="checkout" onclick="location.href='/order/twoheadings'">Checkout</button>`,
    "/order/confirmed": `<h1 id="confirmation">Thank you</h1>`,
    "/order/error": `<h1 id="confirmation">Something went wrong</h1>`,
    "/order/confirmed-wrong-text": `<h1 id="confirmation">Payment pending</h1>`,
    "/order/noheading": `<p>Order received</p>`,
    "/order/twoheadings": `<h1 id="confirmation">Thank you</h1><h1 id="confirmation">Thank you</h1>`,
};

let fixture, llm, llmHits = 0, base;
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));

test.before(async () => {
    fixture = await listen(http.createServer((req, res) => {
        const body = PAGES[req.url];
        if (!body) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<!doctype html><title>fixture</title>${body}`);
    }));
    llm = await listen(http.createServer((req, res) => { llmHits++; res.writeHead(500); res.end("{}"); }));
    base = `http://127.0.0.1:${fixture.address().port}`;
});
test.after(() => { fixture.close(); llm.close(); });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "nav77n-"));

function contractObj(overrides = {}) {
    return {
        schemaVersion: 1, journeyId: SPEC.journeyId, requirementId: "CHECKOUT-001", revision: 1,
        assertions: [
            { id: "nav-path", required: true, check: "pathEquals", locator: "url:pathname", expected: SPEC.path, provenance: { source: "spec", ref: "plan:checkout" } },
            { id: "nav-heading", required: true, check: "textEquals", locator: "#confirmation", expected: SPEC.heading, provenance: { source: "spec", ref: "plan:checkout" } },
        ],
        ...overrides,
    };
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

/** Build a working dir with contract + plan; optionally propose/approve/reject through the real CLI. */
async function setup({ page = "ok", state = "approved", journeyId = SPEC.journeyId, plan = true, contract = contractObj() } = {}) {
    const dir = tmp();
    const store = path.join(dir, "store");
    const contractFile = path.join(dir, "contract.json");
    fs.writeFileSync(contractFile, JSON.stringify(contract));
    const digest = Contract.parse(JSON.stringify(contract)).digest;
    if (state !== "none") {
        const p = await run([`--contract-propose=${contractFile}`, `--store-root=${store}`], dir);
        assert.strictEqual(p.code, 0, p.out);
        if (state === "approved" || state === "rejected") {
            const flag = state === "approved" ? "--contract-approve" : "--contract-reject";
            const a = await run([`${flag}=${contractFile}`, `--confirm-digest=${digest}`, `--store-root=${store}`], dir);
            assert.strictEqual(a.code, 0, a.out);
        }
    }
    const doc = {
        format: "falcon-test-plan", version: 1, url: `${base}/checkout/${page}`, journey: true,
        scenarios: [{ action: "click", locator: "#checkout", description: "Click checkout" }, ...(plan ? [{ action: "verify", description: "Verify order" }] : [])],
        ...(plan ? { contract: "contract.json", journeyId } : {}),
    };
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(doc));
    return { dir, store, contractFile, digest };
}

async function execute(ctx) {
    const r = await run(["--plan=plan.json", "--no-dashboard", `--store-root=${ctx.store}`], ctx.dir);
    const report = JSON.parse(fs.readFileSync(path.join(ctx.dir, "reports", "test-report.json"), "utf8"));
    return { ...r, report, level: report.verification.level, rows: report.tests };
}

test("approved contract + correct outcome => BUSINESS_VERIFIED, exit 0, rows carry id and digest", async () => {
    const ctx = await setup();
    const r = await execute(ctx);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
    const v = r.rows.filter((x) => x.assertion);
    assert.deepStrictEqual(v.map((x) => [x.assertion.id, x.status]), [["nav-path", "passed"], ["nav-heading", "passed"]]);
    assert.ok(v.every((x) => x.assertion.digest === ctx.digest && x.journeyId === SPEC.journeyId && x.required === true));
});

test("click succeeds but lands on /order/error => run FAILS because of the business assertion", async () => {
    const r = await execute(await setup({ page: "error" }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "FAILED");
    assert.strictEqual(r.rows.find((x) => x.name === "Click checkout").status, "passed");
    const p = r.rows.find((x) => x.assertion && x.assertion.id === "nav-path");
    assert.strictEqual(p.status, "failed");
    assert.strictEqual(p.errorType, "assertion");
    assert.strictEqual(p.assertion.actual, "/order/error");
    assert.ok(/Assertion failed: Verify order: nav-path/.test(r.out));
});

test("correct path, wrong confirmation text => FAILED on the heading assertion only", async () => {
    const r = await execute(await setup({ page: "wrongtext" }));
    assert.notStrictEqual(r.code, 0);
    assert.strictEqual(r.level, "FAILED");
    const by = Object.fromEntries(r.rows.filter((x) => x.assertion).map((x) => [x.assertion.id, x.status]));
    assert.strictEqual(by["nav-path"], "failed"); // /order/confirmed-wrong-text is not /order/confirmed (exact, no prefix match)
    assert.strictEqual(by["nav-heading"], "failed");
});

test("missing and ambiguous heading never verify", async () => {
    for (const page of ["noheading", "twoheadings"]) {
        const r = await execute(await setup({ page }));
        assert.notStrictEqual(r.code, 0, page);
        assert.notStrictEqual(r.level, "BUSINESS_VERIFIED", page);
    }
});

test("proposed-only and rejected contracts cannot verify (NOT_APPROVED), even with a correct page", async () => {
    for (const state of ["proposed", "rejected"]) {
        const r = await execute(await setup({ state }));
        assert.notStrictEqual(r.code, 0, state);
        assert.strictEqual(r.level, "UNVERIFIED", state);
        assert.ok(r.out.includes("NOT_APPROVED"), state);
        assert.ok(!/Assertion passed/.test(r.out), state);
    }
});

test("contract changed after approval invalidates the approval", async () => {
    const ctx = await setup();
    fs.writeFileSync(ctx.contractFile, JSON.stringify(contractObj({ revision: 1, assertions: [{ ...contractObj().assertions[0], expected: "/order/other" }, contractObj().assertions[1]] })));
    const r = await execute(ctx);
    assert.strictEqual(r.level, "UNVERIFIED");
    assert.ok(r.out.includes("NOT_APPROVED"));
    assert.notStrictEqual(r.code, 0);
});

test("wrong journey, missing store, corrupt store and symlinked store all fail closed", async () => {
    const wrong = await execute(await setup({ journeyId: "other-journey" }));
    assert.ok(wrong.out.includes("JOURNEY_MISMATCH") && wrong.level === "UNVERIFIED" && wrong.code !== 0);

    const none = await setup({ state: "none" });
    const missing = await execute(none);
    assert.ok(missing.out.includes("STORE_MISSING") && missing.level === "UNVERIFIED" && missing.code !== 0);

    const bad = await setup();
    fs.writeFileSync(path.join(bad.store, SPEC.journeyId, "events.jsonl"), "not json\n");
    const corrupt = await execute(bad);
    assert.ok(corrupt.out.includes("STORE_BROKEN") && corrupt.level === "UNVERIFIED" && corrupt.code !== 0);

    const sym = await setup();
    const real = path.join(sym.dir, "real-store");
    fs.renameSync(sym.store, real);
    fs.symlinkSync(real, sym.store);
    const linked = await execute(sym);
    assert.ok(linked.out.includes("STORE_ROOT_INVALID") && linked.level === "UNVERIFIED" && linked.code !== 0);
});

test("a plan without a contract keeps legacy behaviour: INTERACTION_ONLY, exit 0", async () => {
    const ctx = await setup({ plan: false, state: "none" });
    const r = await execute(ctx);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "INTERACTION_ONLY");
});

test("runtime made zero LLM requests across every run", () => {
    assert.strictEqual(llmHits, 0);
});
