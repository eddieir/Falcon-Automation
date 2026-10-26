'use strict';
// Deterministic, loopback-only fixture for benchmark workload W5-unasserted-step.
// The page never shows a result, so a flow that clicks Save and asserts nothing looks green
// while the server state says nothing was saved. GET /api/state is the objective oracle.
const http = require('node:http');

const HOST = '127.0.0.1';
const MAX_BODY = 1024;
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Silent save</title></head>
<body><main>
<label for="note">Note</label><input id="note" type="text" value="benchmark">
<button type="button" data-testid="save-note">Save</button>
</main>
<script>
document.querySelector('[data-testid="save-note"]').addEventListener('click',function(){
fetch('/api/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:document.getElementById('note').value})}).catch(function(){});
});
</script></body></html>
`;

async function start(opts = {}) {
  let mode = 'fail';
  let state = { saved: false, value: null };
  const server = http.createServer((req, res) => {
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/') return send(200, 'text/html; charset=utf-8', PAGE);
    if (req.method === 'POST' && pathname === '/api/save') {
      if (Number(req.headers['content-length'] || 0) > MAX_BODY) {
        send(413, 'application/json', JSON.stringify({ ok: false }));
        return req.destroy();
      }
      req.resume();
      if (mode === 'ok') {
        state = { saved: true, value: 'benchmark' };
        return send(200, 'application/json', JSON.stringify({ ok: true }));
      }
      return send(500, 'application/json', JSON.stringify({ ok: false }));
    }
    if (req.method === 'GET' && pathname === '/api/state') return send(200, 'application/json', JSON.stringify(state));
    return send(404, 'text/plain; charset=utf-8', 'Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(opts.port) || 0, HOST, resolve);
  });
  return {
    url: `http://${HOST}:${server.address().port}`,
    server,
    setMode(m) { if (m !== 'ok' && m !== 'fail') throw new Error('mode must be ok or fail'); mode = m; },
    getState: () => ({ ...state }),
    reset() { mode = 'fail'; state = { saved: false, value: null }; },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

module.exports = { start };
