"use strict";
/**
 * WP-77F end to end: a plan that mixes an approved business contract with a plain
 * contractless UI `expect` assertion must never let the contractless assertion count
 * toward, or substitute for, business verification. Oracle values come from the static
 * fixture page below, never from Falcon's own output. Driven through the real
 * `falcon.js --plan` CLI in a child process (real Chromium, no network, no LLM).
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

const JOURNEY_ID = "order-save";
const PAGE_BODY = `<h1 id="title">Order</h1><button id="save">Save</button><span id="msg"></span>
<script>document.getElementById('save').addEventListener('click', function () {
  document.getElementById('msg').textContent = 'Order saved!';
});</script>`;

let fixture, llm, llmHits = 0, base;
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));

test.before(async () => {
    fixture = await listen(http.createServer((req, res) => {
        if (req.url !== "/page") { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<!doctype html><title>fixture</title>${PAGE_BODY}`);
    }));
    llm = await listen(http.createServer((req, res) => { llmHits++; res.writeHead(500); res.end("{}"); }));
    base = `http://127.0.0.1:${fixture.address().port}`;
});
test.after(() => { fixture.close(); llm.close(); });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cless77f-"));

function contractObj(overrides = {}) {
    return {
        schemaVersion: 1, journeyId: JOURNEY_ID, requirementId: "ORDER-SAVE-001", revision: 1,
        assertions: [
            { id: "page-path", required: true, check: "pathEquals", locator: "url:pathname", expected: "/page", provenance: { source: "spec", ref: "plan:order-save" } },
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

/**
 * Build a working dir with plan (+ optional contract). `expectValue` controls whether the
 * contractless UI expect assertion passes ("Order saved!") or fails (any other string).
 */
async function setup({
    withContract = false, state = "approved", journeyId = JOURNEY_ID, expectValue = "Order saved!",
    withExpect = true, withVerify = undefined, contract = contractObj(),
} = {}) {
    const dir = tmp();
    const store = path.join(dir, "store");
    const contractFile = path.join(dir, "contract.json");
    let digest;
    if (withContract) {
        fs.writeFileSync(contractFile, JSON.stringify(contract));
        digest = Contract.parse(JSON.stringify(contract)).digest;
        if (state !== "none") {
            const p = await run([`--contract-propose=${contractFile}`, `--store-root=${store}`], dir);
            assert.strictEqual(p.code, 0, p.out);
            if (state === "approved" || state === "rejected") {
                const flag = state === "approved" ? "--contract-approve" : "--contract-reject";
                const a = await run([`${flag}=${contractFile}`, `--confirm-digest=${digest}`, `--store-root=${store}`], dir);
                assert.strictEqual(a.code, 0, a.out);
            }
        }
    }
    const includeVerify = withVerify === undefined ? withContract : withVerify;
    const scenarios = [{ action: "click", locator: "#save", description: "Save" }];
    if (withExpect) {
        scenarios.push({ action: "expect", locator: "#msg", check: "containsText", value: expectValue, description: "UI says saved" });
    }
    if (includeVerify) {
        scenarios.push({ action: "verify", description: "Verify" });
    }
    const doc = {
        format: "falcon-test-plan", version: 1, url: `${base}/page`, journey: true, scenarios,
        ...(withContract ? { contract: "contract.json", journeyId } : {}),
    };
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(doc));
    return { dir, store, contractFile, digest };
}

async function execute(ctx) {
    const r = await run(["--plan=plan.json", "--no-dashboard", `--store-root=${ctx.store}`], ctx.dir);
    const report = JSON.parse(fs.readFileSync(path.join(ctx.dir, "reports", "test-report.json"), "utf8"));
    return { ...r, report, level: report.verification.level, assertions: report.verification.assertions, rows: report.tests };
}

test("E1: contractless passing UI expect => INTERACTION_ONLY, exit 0, zero required business assertions", async () => {
    const ctx = await setup({ withContract: false });
    const r = await execute(ctx);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "INTERACTION_ONLY");
    assert.strictEqual(r.assertions.required, 0);
});

test("E2: contractless failing UI expect => FAILED, nonzero exit", async () => {
    const ctx = await setup({ withContract: false, expectValue: "Order NOT saved" });
    const r = await execute(ctx);
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "FAILED");
});

test("E3: approved contract, assertion passes, verify step => BUSINESS_VERIFIED, exit 0", async () => {
    const ctx = await setup({ withContract: true, withExpect: false });
    const r = await execute(ctx);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
    assert.strictEqual(r.assertions.required, 1);
    assert.strictEqual(r.assertions.pass, 1);
    assert.strictEqual(r.assertions.fail, 0);
});

test("E4: approved assertion with wrong expected value => FAILED, nonzero exit", async () => {
    const badContract = contractObj({ assertions: [{ ...contractObj().assertions[0], expected: "/not-page" }] });
    const ctx = await setup({ withContract: true, withExpect: false, contract: badContract });
    const r = await execute(ctx);
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "FAILED");
});

test("E5: approved passing contract plus passing contractless expect => BUSINESS_VERIFIED, required equals contract assertion count only", async () => {
    const ctx = await setup({ withContract: true, withExpect: true });
    const r = await execute(ctx);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
    assert.strictEqual(r.assertions.required, contractObj().assertions.length);
    assert.strictEqual(r.assertions.pass, contractObj().assertions.length);
});

test("E6: contract proposed but not approved => never BUSINESS_VERIFIED, nonzero exit", async () => {
    const ctx = await setup({ withContract: true, withExpect: false, state: "proposed", withVerify: true });
    const r = await execute(ctx);
    assert.notStrictEqual(r.code, 0, r.out);
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
});

test("E7: contract tampered after approval => never BUSINESS_VERIFIED, nonzero exit, mentions NOT_APPROVED", async () => {
    const ctx = await setup({ withContract: true, withExpect: false });
    fs.writeFileSync(ctx.contractFile, JSON.stringify(contractObj({ revision: 1, assertions: [{ ...contractObj().assertions[0], expected: "/tampered" }] })));
    const r = await execute(ctx);
    assert.notStrictEqual(r.code, 0, r.out);
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
    assert.ok(r.out.includes("NOT_APPROVED"), r.out);
});

test("E8: legacy click-only plan, no contract => INTERACTION_ONLY, exit 0", async () => {
    const ctx = await setup({ withContract: false, withExpect: false });
    const r = await execute(ctx);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "INTERACTION_ONLY");
});

test("E9: runtime made zero LLM requests across every run", () => {
    assert.strictEqual(llmHits, 0);
});
