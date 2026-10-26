'use strict';
// Deterministic, loopback-only, disposable auth fixture for benchmark workload W4.
// No passwords by design: it carries no credential-shaped data. Sessions are opaque counters, not secrets.
const http = require('node:http');

const HOST = '127.0.0.1';
const USERS = Object.freeze({ alice: 'admin', bob: 'member' });
const MAX_BODY = 1024;
const MAX_SESSIONS = 256;

async function start(opts = {}) {
  let counter = 0;
  const sessions = new Map();
  const server = http.createServer((req, res) => {
    const send = (code, type, body, headers = {}) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...headers });
      res.end(body);
    };
    const json = (code, obj, headers) => send(code, 'application/json', JSON.stringify(obj), headers);
    const wantsHtml = (req.headers.accept || '').includes('text/html');
    const denied = (code, error) => (wantsHtml
      ? send(code, 'text/html; charset=utf-8', `<!doctype html><title>${code}</title><body><p data-testid="denied">${error}</p></body>`)
      : json(code, { error }));
    const sid = /(?:^|;\s*)sid=([A-Za-z0-9]+)/.exec(req.headers.cookie || '')?.[1];
    const user = sessions.get(sid);
    const { pathname } = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && pathname === '/') {
      return send(200, 'text/html; charset=utf-8', '<!doctype html><title>Benchmark auth</title><main><h1>Sign in</h1><a href="/admin">Admin console</a></main>');
    }
    if (req.method === 'GET' && pathname.startsWith('/signin/')) {
      const name = decodeURIComponent(pathname.slice('/signin/'.length));
      if (!Object.hasOwn(USERS, name)) return denied(401, 'unknown user');
      if (sessions.size >= MAX_SESSIONS) return denied(503, 'session limit');
      counter += 1;
      const token = `s${counter}`;
      sessions.set(token, name);
      return send(302, 'text/plain; charset=utf-8', 'redirecting', { location: '/admin', 'set-cookie': `sid=${token}; Path=/; HttpOnly; SameSite=Strict` });
    }
    if (req.method === 'POST' && pathname === '/login') {
      let body = '';
      let size = 0;
      req.on('data', (c) => {
        if (res.writableEnded) return;
        size += c.length;
        if (size > MAX_BODY) {
          json(413, { error: 'too large' });
          req.destroy();
          return;
        }
        body += c;
      });
      req.on('end', () => {
        if (res.writableEnded) return;
        let name;
        try { name = JSON.parse(body).user; } catch { return json(400, { error: 'bad json' }); }
        if (!Object.hasOwn(USERS, name)) return json(401, { error: 'unknown user' });
        if (sessions.size >= MAX_SESSIONS) return json(503, { error: 'session limit' });
        counter += 1;
        const token = `s${counter}`;
        sessions.set(token, name);
        return json(200, { user: name }, { 'set-cookie': `sid=${token}; Path=/; HttpOnly; SameSite=Strict` });
      });
      return undefined;
    }
    if (req.method === 'POST' && pathname === '/logout') {
      sessions.delete(sid);
      return json(200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/whoami') {
      return user ? json(200, { user, role: USERS[user] }) : json(401, { error: 'not signed in' });
    }
    if (req.method === 'GET' && pathname === '/admin') {
      if (!user) return denied(401, 'not signed in');
      if (USERS[user] !== 'admin') return denied(403, 'forbidden');
      return send(200, 'text/html; charset=utf-8', '<!doctype html><title>Admin</title><h1 data-testid="admin-console">Admin console</h1>');
    }
    return send(404, 'text/plain; charset=utf-8', 'Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(opts.port) || 0, HOST, resolve);
  });
  return {
    url: `http://${HOST}:${server.address().port}`,
    server,
    sessionCount: () => sessions.size,
    reset() { sessions.clear(); counter = 0; },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

module.exports = { start, USERS };
