"use strict";
/**
 * WP-77D end to end: approved data-value assertions (valueEquals, countEquals, moneyEquals)
 * against a local checkout fixture, driven through the real `falcon.js --plan` CLI in a child
 * process (real Chromium, no network, no LLM). Oracle values are constants below, never read
 * from Falcon's own output. Modeled directly on navigation-assertions.check.cjs.
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

// Oracle values (the fixture specification). Never read from Falcon output.
const REF = "S3CR3T-REF-9917";
const CURRENCY = "USD";
const MINOR = 5997; // USD 59.97
const JOURNEY_ID = "checkout-data";

function pageHtml(variant) {
    const script = `
        var total = ${MINOR === 5997 ? "59.97" : "0"};
        function render() {
            document.getElementById('total').textContent = 'USD 59.97';
        }
        function addItem() {
            var li = document.createElement('li');
            li.className = 'item';
            document.getElementById('cart').appendChild(li);
        }
        document.getElementById('add').addEventListener('click', function () {
            if ('${variant}' === 'wrong-count') {
                // only ever add up to 2 items regardless of clicks
                if (document.querySelectorAll('#cart li.item').length < 2) addItem();
            } else {
                addItem();
            }
            if ('${variant}' === 'wrong-total') {
                document.getElementById('total').textContent = 'USD 59.98';
            } else if ('${variant}' === 'wrong-currency') {
                document.getElementById('total').textContent = 'EUR 59.97';
            } else if ('${variant}' === 'delayed') {
                document.getElementById('total').textContent = '';
                setTimeout(function () { document.getElementById('total').textContent = 'USD 59.97'; }, 300);
            } else if ('${variant}' === 'ambiguous-total') {
                // leave both #total spans as-is (duplicate id already in markup)
            } else {
                document.getElementById('total').textContent = 'USD 59.97';
            }
        });
        if ('${variant}' === 'wrong-value') {
            // after the plan types into the field, the page overwrites it
            document.getElementById('customer-ref').addEventListener('input', function () {
                var el = document.getElementById('customer-ref');
                setTimeout(function () { el.value = 'OTHER'; }, 0);
            });
        }
    `;
    const totalMarkup =
        variant === "ambiguous-total"
            ? `<span id="total">USD 59.97</span><span id="total">USD 59.97</span>`
            : `<span id="total">USD 0.00</span>`;
    return `
        <input id="customer-ref" type="text" />
        <ul id="cart"></ul>
        ${totalMarkup}
        <button id="add">Add</button>
        <script>${script}</script>
    `;
}

const VARIANTS = ["ok", "wrong-count", "wrong-total", "wrong-currency", "wrong-value", "delayed", "ambiguous-total"];

let fixture, llm, llmHits = 0, base;
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));

test.before(async () => {
    fixture = await listen(http.createServer((req, res) => {
        const url = req.url.split("?")[0];
        const m = /^\/checkout\/([a-z-]+)$/.exec(url);
        if (!m || !VARIANTS.includes(m[1])) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<!doctype html><title>fixture</title>${pageHtml(m[1])}`);
    }));
    llm = await listen(http.createServer((req, res) => { llmHits++; res.writeHead(500); res.end("{}"); }));
    base = `http://127.0.0.1:${fixture.address().port}`;
});
test.after(() => { fixture.close(); llm.close(); });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "data77d-"));

function contractObj(overrides = {}) {
    return {
        schemaVersion: 1, journeyId: JOURNEY_ID, requirementId: "CHECKOUT-002", revision: 1,
        assertions: [
            { id: "ref-value", required: true, check: "valueEquals", locator: "#customer-ref", expected: REF, provenance: { source: "spec", ref: "plan:checkout" } },
            { id: "cart-count", required: true, check: "countEquals", locator: "#cart li.item", expected: 3, provenance: { source: "spec", ref: "plan:checkout" } },
            { id: "cart-total", required: true, check: "moneyEquals", locator: "#total", expected: { minor: MINOR, currency: CURRENCY }, provenance: { source: "spec", ref: "plan:checkout" } },
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
async function setup({ variant = "ok", state = "approved", journeyId = JOURNEY_ID, plan = true, contract = contractObj() } = {}) {
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
        format: "falcon-test-plan", version: 1, url: `${base}/checkout/${variant}`, journey: true,
        scenarios: [
            { action: "type", locator: "#customer-ref", value: REF, description: "Type customer reference" },
            { action: "click", locator: "#add", description: "Add item 1" },
            { action: "click", locator: "#add", description: "Add item 2" },
            { action: "click", locator: "#add", description: "Add item 3" },
            ...(plan ? [{ action: "verify", description: "Verify checkout" }] : []),
        ],
        ...(plan ? { contract: "contract.json", journeyId } : {}),
    };
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(doc));
    return { dir, store, contractFile, digest };
}

async function execute(ctx) {
    const r = await run(["--plan=plan.json", "--no-dashboard", `--store-root=${ctx.store}`], ctx.dir);
    const reportPath = path.join(ctx.dir, "reports", "test-report.json");
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return { ...r, report, reportPath, level: report.verification.level, rows: report.tests };
}

/** Recursively collect every file under `dir`. */
function walk(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(p));
        else out.push(p);
    }
    return out;
}

function assertNoSecretLeak(ctx, stdout) {
    const secrets = [REF, "59.97", String(MINOR)];
    const files = walk(path.join(ctx.dir, "reports"));
    for (const f of files) {
        const content = fs.readFileSync(f, "utf8");
        for (const s of secrets) {
            assert.ok(!content.includes(s), `${f} must not contain "${s}"`);
        }
    }
    for (const s of secrets) {
        assert.ok(!stdout.includes(s), `stdout/stderr must not contain "${s}"`);
    }
}

test("approved contract + correct outcome => BUSINESS_VERIFIED, exit 0, rows carry id and digest, no secret leak", async () => {
    const ctx = await setup();
    const r = await execute(ctx);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
    const v = r.rows.filter((x) => x.assertion);
    assert.deepStrictEqual(
        v.map((x) => [x.assertion.id, x.status]),
        [["ref-value", "passed"], ["cart-count", "passed"], ["cart-total", "passed"]],
    );
    assert.ok(v.every((x) => x.assertion.digest === ctx.digest && x.journeyId === JOURNEY_ID && x.required === true));
    for (const x of v) {
        assert.ok(!("expected" in x.assertion), `assertion ${x.assertion.id} must not carry expected`);
        assert.ok(!("actual" in x.assertion), `assertion ${x.assertion.id} must not carry actual`);
    }
    assertNoSecretLeak(ctx, r.out);
});

test("wrong-count: only cart-count fails, interactions still pass", async () => {
    const ctx = await setup({ variant: "wrong-count" });
    const r = await execute(ctx);
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "FAILED");
    for (const name of ["Type customer reference", "Add item 1", "Add item 2", "Add item 3"]) {
        assert.strictEqual(r.rows.find((x) => x.name === name).status, "passed", name);
    }
    const by = Object.fromEntries(r.rows.filter((x) => x.assertion).map((x) => [x.assertion.id, x]));
    assert.strictEqual(by["ref-value"].status, "passed");
    assert.strictEqual(by["cart-count"].status, "failed");
    assert.strictEqual(by["cart-count"].errorType, "assertion");
    assert.strictEqual(by["cart-total"].status, "passed");
    assertNoSecretLeak(ctx, r.out);
});

test("wrong-total: only cart-total fails", async () => {
    const r = await execute(await setup({ variant: "wrong-total" }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "FAILED");
    const by = Object.fromEntries(r.rows.filter((x) => x.assertion).map((x) => [x.assertion.id, x]));
    assert.strictEqual(by["ref-value"].status, "passed");
    assert.strictEqual(by["cart-count"].status, "passed");
    assert.strictEqual(by["cart-total"].status, "failed");
    assert.strictEqual(by["cart-total"].errorType, "assertion");
});

test("wrong-currency: only cart-total fails", async () => {
    const r = await execute(await setup({ variant: "wrong-currency" }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "FAILED");
    const by = Object.fromEntries(r.rows.filter((x) => x.assertion).map((x) => [x.assertion.id, x]));
    assert.strictEqual(by["ref-value"].status, "passed");
    assert.strictEqual(by["cart-count"].status, "passed");
    assert.strictEqual(by["cart-total"].status, "failed");
    assert.strictEqual(by["cart-total"].errorType, "assertion");
});

test("wrong-value: only ref-value fails", async () => {
    const r = await execute(await setup({ variant: "wrong-value" }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "FAILED");
    const by = Object.fromEntries(r.rows.filter((x) => x.assertion).map((x) => [x.assertion.id, x]));
    assert.strictEqual(by["ref-value"].status, "failed");
    assert.strictEqual(by["ref-value"].errorType, "assertion");
    assert.strictEqual(by["cart-count"].status, "passed");
    assert.strictEqual(by["cart-total"].status, "passed");
});

test("delayed total still settles to BUSINESS_VERIFIED", async () => {
    const r = await execute(await setup({ variant: "delayed" }));
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "BUSINESS_VERIFIED");
});

test("ambiguous total never verifies", async () => {
    const r = await execute(await setup({ variant: "ambiguous-total" }));
    assert.notStrictEqual(r.code, 0, r.out);
    assert.notStrictEqual(r.level, "BUSINESS_VERIFIED");
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
    const edited = contractObj({ revision: 1 });
    edited.assertions[1] = { ...edited.assertions[1], expected: 4 };
    fs.writeFileSync(ctx.contractFile, JSON.stringify(edited));
    const r = await execute(ctx);
    assert.strictEqual(r.level, "UNVERIFIED");
    assert.ok(r.out.includes("NOT_APPROVED"));
    assert.notStrictEqual(r.code, 0);
});

test("a plan without a contract keeps legacy behaviour: INTERACTION_ONLY, exit 0", async () => {
    const ctx = await setup({ plan: false, state: "none" });
    const r = await execute(ctx);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.level, "INTERACTION_ONLY");
});

test("PRIVACY: shard bundle toAssertion never carries expected/actual for a data row", () => {
    const ShardBundle = require(path.join(R, "src/core/parallel/ShardBundle"));
    if (typeof ShardBundle.toAssertion !== "function") {
        console.log("ShardBundle.toAssertion is not exported; skipping direct API check (reported as a limitation).");
        return;
    }
    const row = {
        id: "cart-total",
        digest: "sha256:" + "a".repeat(64),
        check: "moneyEquals",
        locator: "#total",
        outcome: "amount_mismatch",
        matches: 1,
    };
    const out = ShardBundle.toAssertion(row);
    assert.ok(out && typeof out === "object");
    assert.ok(!("expected" in out));
    assert.ok(!("actual" in out));
});

test("runtime made zero LLM requests across every run", () => {
    assert.strictEqual(llmHits, 0);
});
