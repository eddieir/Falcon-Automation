#!/usr/bin/env node
'use strict';
// Dependency-free local fixture site for Falcon parallel benchmarks.
const http = require('node:http');

const MAX_DELAY_MS = 5000;
const PAGE_COUNT = 10;

function parseDelay(value) {
    if (value === undefined || value === null || value === '') return 0;
    const s = String(value).trim();
    if (!/^\d+$/.test(s)) throw new Error(`Invalid --delay-ms: ${value}`);
    const n = Number(s);
    if (n > MAX_DELAY_MS) throw new Error(`--delay-ms must be <= ${MAX_DELAY_MS}`);
    return n;
}

function parsePort(value) {
    if (value === undefined) return 0;
    const s = String(value).trim();
    if (!/^\d+$/.test(s) || Number(s) > 65535) throw new Error(`Invalid --port: ${value}`);
    return Number(s);
}

function nav() {
    const links = [`<a id="nav-home" href="/">Home</a>`];
    for (let i = 1; i <= PAGE_COUNT; i++) links.push(`<a id="nav-p${i}" href="/p/${i}">Page ${i}</a>`);
    return `<nav id="main-nav">${links.join(' ')}</nav>`;
}

function layout(title, body) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body>
${nav()}
<main>
${body}
</main>
</body></html>
`;
}

function indexPage() {
    const items = [];
    for (let i = 1; i <= PAGE_COUNT; i++) items.push(`<li><a id="link-p${i}" href="/p/${i}">Fixture page ${i}</a></li>`);
    return layout('Fixture Index', `<h1 id="title">Fixture Index</h1>\n<ul id="pages">\n${items.join('\n')}\n</ul>`);
}

function page(n) {
    return layout(`Fixture Page ${n}`, `<h1 id="title">Fixture Page ${n}</h1>
<p id="status-${n}">Ready</p>
<label for="name-${n}">Name</label>
<input id="name-${n}" name="name" type="text" placeholder="Your name">
<button id="toggle-${n}" type="button" onclick="document.getElementById('status-${n}').textContent='Toggled'">Toggle ${n}</button>
<button id="clear-${n}" type="button" onclick="document.getElementById('name-${n}').value=''">Clear ${n}</button>
<a id="self-${n}" href="#section-${n}">Jump to section</a>
<section id="section-${n}"><h2>Section ${n}</h2></section>
<script>fetch('/api/ping').then(function(r){return r.json()}).then(function(d){document.getElementById('status-${n}').setAttribute('data-ping',d.ok?'ok':'fail')}).catch(function(){});</script>`);
}

function createServer(options = {}) {
    const delayMs = parseDelay(options.delayMs);
    return http.createServer((req, res) => {
        let pathname;
        try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; } catch { pathname = ''; }
        const send = (status, type, body) => {
            const respond = () => {
                res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
                res.end(body);
            };
            if (delayMs > 0 && pathname !== '/health') setTimeout(respond, delayMs); else respond();
        };
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain; charset=utf-8', 'Method Not Allowed');
        if (pathname === '/health') return send(200, 'application/json', '{"status":"ok"}');
        if (pathname === '/api/ping') return send(200, 'application/json', '{"ok":true}');
        if (pathname === '/') return send(200, 'text/html; charset=utf-8', indexPage());
        const m = /^\/p\/(\d+)$/.exec(pathname);
        if (m && Number(m[1]) >= 1 && Number(m[1]) <= PAGE_COUNT && String(Number(m[1])) === m[1]) {
            return send(200, 'text/html; charset=utf-8', page(Number(m[1])));
        }
        return send(404, 'text/plain; charset=utf-8', 'Not Found');
    });
}

function start(options = {}) {
    const port = parsePort(options.port);
    const server = createServer(options);
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

function parseArgs(argv) {
    const out = {};
    for (const a of argv) {
        const m = /^--(port|delay-ms)=(.*)$/.exec(a);
        if (!m) throw new Error(`Unknown argument: ${a}`);
        out[m[1] === 'port' ? 'port' : 'delayMs'] = m[2];
    }
    return out;
}

async function main() {
    let opts;
    try { opts = parseArgs(process.argv.slice(2)); parseDelay(opts.delayMs); parsePort(opts.port); }
    catch (e) { process.stderr.write(`${e.message}\n`); process.exit(2); }
    const server = await start(opts);
    process.stdout.write(`FIXTURE_URL=http://127.0.0.1:${server.address().port}\n`);
    const stop = () => { server.close(() => process.exit(0)); server.closeAllConnections(); };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}

module.exports = { createServer, start, parseDelay, parsePort, PAGE_COUNT, MAX_DELAY_MS };

if (require.main === module) {
    main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
