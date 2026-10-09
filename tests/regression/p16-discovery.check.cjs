"use strict";
/**
 * P16 parallel discovery: the set found does not depend on the concurrency, matches the
 * sequential crawl on the fixture, resolves plain anchors without clicking, still clicks
 * buttons, never opens another origin, skips new-tab links and honours the task cap.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");

const R = path.join(__dirname, "..", "..");
const PD = require(path.join(R, "src/core/parallel/ParallelDiscovery"));
const ClickExplorer = require(path.join(R, "src/core/ClickExplorer"));
const Fixture = require(path.join(R, "scripts/fixture/server.js"));

const close = (s) => new Promise((r) => s.close(r));

function site(pages) {
    const hits = [];
    return new Promise((resolve) => {
        const s = http.createServer((req, res) => {
            hits.push(req.url);
            const body = pages[req.url];
            if (body === undefined) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { "content-type": "text/html" });
            res.end(body);
        });
        s.listen(0, "127.0.0.1", () => resolve({ s, hits, url: `http://127.0.0.1:${s.address().port}` }));
    });
}

async function withBrowser(fn) {
    const browser = await chromium.launch();
    try { return await fn(await browser.newContext()); } finally { await browser.close(); }
}

test("discovery result is identical for 1, 2 and 4 lanes and matches the sequential crawl on the fixture", { timeout: 180000 }, async () => {
    const fx = await Fixture.start({ port: 0, delayMs: 0 });
    const entry = `http://127.0.0.1:${fx.address().port}/`;
    try {
        await withBrowser(async (context) => {
            const r1 = await PD.discover(context, entry, { concurrency: 1 });
            const r2 = await PD.discover(context, entry, { concurrency: 2 });
            const r4 = await PD.discover(context, entry, { concurrency: 4 });
            assert.deepStrictEqual(r2, r1);
            assert.deepStrictEqual(r4, r1);
            assert.deepStrictEqual(r1, [...r1].sort());
            const page = await context.newPage();
            await page.goto(entry);
            const explorer = new ClickExplorer(page);
            await explorer.explore();
            const seq = [...explorer.visitedPages].map((u) => u.replace(/\/$/, "") || u).sort();
            const par = r1.map((u) => u.replace(/\/$/, "") || u).sort();
            assert.deepStrictEqual(par, seq);
        });
    } finally {
        await close(fx);
    }
});

test("plain anchors are resolved from their href, buttons are clicked, new-tab links and other origins are not opened", { timeout: 120000 }, async () => {
    const other = await site({ "/": "<h1>other</h1>" });
    const pages = {
        "/": `<a href="/a">A</a><a href="/b" target="_blank">B new tab</a><button id="go" onclick="location.href='/c'">Go</button>` +
             `<a href="${other.url}/">Elsewhere</a><a href="mailto:x@example.com">Mail</a><a href="#top">Top</a>`,
        "/a": `<a href="/d">D</a>`,
        "/c": `<a href="/e">E</a>`,
        "/d": "<h1>d</h1>", "/e": "<h1>e</h1>", "/b": "<h1>b</h1>",
    };
    const main = await site(pages);
    try {
        await withBrowser(async (context) => {
            const found = await PD.discover(context, `${main.url}/`, { concurrency: 2 });
            const paths = found.map((u) => u.replace(main.url, ""));
            assert.ok(paths.includes("/a"), "anchor href resolved");
            assert.ok(paths.includes("/c"), "button click followed");
            assert.ok(paths.includes("/d"), "second hop from a resolved anchor");
            assert.ok(paths.includes("/e"), "second hop from a clicked page");
            assert.ok(!paths.includes("/b"), "new-tab link not followed");
            assert.ok(found.some((u) => u.startsWith(other.url)), "other origin recorded");
            assert.ok(!other.hits.includes("/"), "other origin never requested");
            assert.ok(!found.some((u) => u.startsWith("mailto:")), "mailto not recorded");
            assert.ok(!main.hits.includes("/b"), "new-tab target never requested");
        });
    } finally {
        await close(main.s); await close(other.s);
    }
});

test("links with credentials in the URL or an oversized href are neither followed nor recorded", { timeout: 120000 }, async () => {
    const main = await site({ "/": `<a href="http://user:secret@127.0.0.1/x">Cred</a><a href="/ok">Ok</a><a href="/${"a".repeat(3000)}">Long</a>`, "/ok": "<h1>ok</h1>" });
    try {
        await withBrowser(async (context) => {
            const found = await PD.discover(context, `${main.url}/`, { concurrency: 2 });
            assert.ok(found.some((u) => u.endsWith("/ok")));
            assert.ok(!found.some((u) => u.includes("secret") || u.includes("user:")), "no URL with credentials is recorded");
            assert.ok(!found.some((u) => u.length > 2100), "no oversized URL is recorded");
        });
    } finally { await close(main.s); }
});

test("a page that fails once is retried, so a transient failure does not shrink the result", { timeout: 120000 }, async () => {
    let flaky = 0;
    const s = http.createServer((req, res) => {
        const body = req.url === "/" ? `<a href="/flaky">Flaky</a>` : req.url === "/flaky" ? `<a href="/deep">Deep</a>` : "<h1>x</h1>";
        const send = () => { res.writeHead(200, { "content-type": "text/html" }); res.end(body); };
        // The first request for /flaky outlasts the page timeout; the retry is answered at once.
        if (req.url === "/flaky" && flaky++ === 0) setTimeout(send, 2500); else send();
    });
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${s.address().port}`;
    try {
        await withBrowser(async (context) => {
            const found = await PD.discover(context, `${url}/`, { concurrency: 1, pageTimeoutMs: 800 });
            assert.ok(found.some((u) => u.endsWith("/deep")), `second hop found after the retry: ${found.join(", ")}`);
        });
    } finally { await close(s); }
});

test("a page that cannot be loaded is skipped and discovery still returns the rest", { timeout: 120000 }, async () => {
    const main = await site({ "/": `<a href="/gone">Gone</a><a href="/ok">Ok</a>`, "/ok": "<h1>ok</h1>" });
    try {
        await withBrowser(async (context) => {
            const found = await PD.discover(context, `${main.url}/`, { concurrency: 2 });
            assert.ok(found.some((u) => u.endsWith("/ok")));
        });
    } finally { await close(main.s); }
});

test("discover returns [] for a non-http entry and exposes bounded limits", async () => {
    assert.deepStrictEqual(await PD.discover({}, "not a url"), []);
    assert.strictEqual(PD.MAX_DEPTH, 2);
    assert.strictEqual(PD.MAX_CANDIDATES, 5);
    assert.ok(PD.MAX_TASKS <= 400);
});
