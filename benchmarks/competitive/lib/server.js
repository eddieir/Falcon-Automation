'use strict';
// Loopback server that serves the healing-corpus pages with an event probe, records what each tool
// actually touched, and exposes control endpoints so every tool (including Cypress) resets and reads
// the same oracle. Nothing here knows which tool is calling.
const http = require('node:http');

const HOST = '127.0.0.1';
const PROBE = `<script>(function(){var id=location.pathname.split('/')[2];function r(e){var t=e.target&&e.target.closest?e.target.closest('[data-benchmark-ground-truth-id]'):null;navigator.sendBeacon('/__event?f='+encodeURIComponent(id),JSON.stringify({kind:e.type,gt:t?t.getAttribute('data-benchmark-ground-truth-id'):'other'}));}['click','input','change'].forEach(function(k){document.addEventListener(k,r,true);});})();</script>`;

async function start({ fixtures, apps }) {
  const pages = new Map(fixtures.map((f) => [f.id, { pre: f.preHtml, post: f.postHtml }]));
  const events = new Map();
  const observations = new Map();
  const server = http.createServer(async (req, res) => {
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    const url = new URL(req.url, 'http://localhost');
    const body = () => new Promise((resolve) => { let b = ''; req.on('data', (c) => { if (b.length < 4096) b += c; }); req.on('end', () => resolve(b)); });
    try {
      const page = /^\/f\/([^/]+)\/(pre|post)\.html$/.exec(url.pathname);
      if (req.method === 'GET' && page) {
        const entry = pages.get(page[1]);
        if (!entry) return send(404, 'text/plain', 'Not found');
        const html = entry[page[2]];
        return send(200, 'text/html; charset=utf-8', html.includes('</body>') ? html.replace('</body>', `${PROBE}</body>`) : html + PROBE);
      }
      if (req.method === 'POST' && url.pathname === '/__event') {
        const id = url.searchParams.get('f');
        if (!pages.has(id)) return send(404, 'text/plain', 'Not found');
        let ev;
        try { ev = JSON.parse(await body()); } catch { return send(400, 'text/plain', 'bad'); }
        if (!events.has(id)) events.set(id, []);
        events.get(id).push({ kind: String(ev.kind), gt: String(ev.gt) });
        return send(204, 'text/plain', '');
      }
      if (req.method === 'POST' && url.pathname === '/__ctl/reset') {
        for (const a of Object.values(apps)) a.reset();
        return send(204, 'text/plain', '');
      }
      if (req.method === 'POST' && url.pathname === '/__ctl/obs') {
        observations.set(url.searchParams.get('k'), (await body()).slice(0, 500));
        return send(204, 'text/plain', '');
      }
      return send(404, 'text/plain', 'Not found');
    } catch (err) {
      return send(500, 'text/plain', String(err.message));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, HOST, resolve); });
  return {
    url: `http://${HOST}:${server.address().port}`,
    eventsFor: (id) => [...(events.get(id) || [])],
    observation: (k) => observations.get(k) ?? null,
    resetApps() { for (const a of Object.values(apps)) a.reset(); },
    reset() { events.clear(); observations.clear(); this.resetApps(); },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

module.exports = { start, HOST };
