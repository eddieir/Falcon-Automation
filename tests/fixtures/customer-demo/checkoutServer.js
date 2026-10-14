'use strict';
// Deterministic, loopback-only, disposable checkout app for the customer demo.
const http = require('node:http');

const HOST = '127.0.0.1';

function page(version) {
  const id = version === 2 ? 'place-order' : 'checkout-submit';
  const rel = `v${version}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Northwind Checkout</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box}
body{margin:0;background:#eef1f6;color:#1b2430;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.card{position:relative;width:900px;max-width:94vw;margin:48px auto;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(20,30,50,.12);padding:36px 44px}
.brand{font-size:22px;font-weight:700;color:#12355b;margin:0 0 24px}
.pill{position:absolute;top:16px;right:20px;background:#12355b;color:#fff;font-size:12px;padding:4px 10px;border-radius:999px}
.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #e5e9f0;font-size:16px}
.total{font-weight:700}
label{display:block;margin:22px 0 6px;font-size:14px;color:#4a5668}
input[type=text]{width:100%;padding:12px;border:1px solid #c5cdd9;border-radius:8px;font-size:16px}
.actions{display:flex;gap:12px;margin-top:26px}
.btn{padding:14px 22px;border-radius:8px;font-size:16px;cursor:pointer;border:1px solid #c5cdd9;background:#fff;color:#1b2430}
.btn.primary{background:#0a6cff;border-color:#0a6cff;color:#fff;font-weight:600;margin-left:auto;width:200px}
.confirm{margin-top:24px;min-height:20px}
.ok{background:#e3f7e8;border:1px solid #2e9d4f;color:#17692f;padding:16px;border-radius:8px;font-weight:600}
</style></head>
<body data-release="${rel}">
<main class="card">
<span class="pill">Release ${rel}</span>
<h1 class="brand">Northwind Checkout</h1>
<div class="row"><span>Falcon Pro Plan</span><span>€49</span></div>
<div class="row"><span>Billing</span><span>Annual, one seat</span></div>
<div class="row total"><span>Total due today</span><span>€49</span></div>
<label for="email">Email</label>
<input type="text" id="email" name="email" placeholder="you@example.com" autocomplete="off">
<div class="actions">
<button class="btn" type="button" data-testid="save-later">Save for later</button>
<button class="btn" type="button" data-testid="cancel-order">Cancel</button>
<button id="${id}" class="btn primary" data-testid="checkout-complete" name="complete-order" aria-label="Complete order" type="button">Complete order</button>
</div>
<div class="confirm" id="confirmation-region"></div>
</main>
<script>
document.querySelector('[data-testid="checkout-complete"]').addEventListener('click',function(){
fetch('/api/order',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
var r=document.getElementById('confirmation-region');
r.innerHTML='<div class="ok" data-testid="order-confirmation">Order completed</div><div>Order #'+d.orderNumber+'</div>';
});});
</script>
</body></html>
`;
}

async function start(opts = {}) {
  let version = 1;
  let orders = 0;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (req.method === 'GET' && u.pathname === '/checkout') {
      const q = u.searchParams.get('version');
      return send(200, 'text/html; charset=utf-8', page(q === '1' || q === '2' ? Number(q) : version));
    }
    if (req.method === 'POST' && u.pathname === '/api/order') {
      orders += 1;
      return send(200, 'application/json', JSON.stringify({ status: 'completed', orderNumber: 1000 + orders }));
    }
    if (req.method === 'GET' && u.pathname === '/__version') {
      return send(200, 'application/json', JSON.stringify({ version }));
    }
    return send(404, 'text/plain; charset=utf-8', 'Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(opts.port) || 0, HOST, resolve);
  });
  const port = server.address().port;
  return {
    url: `http://${HOST}:${port}`,
    server,
    setVersion(v) { if (v !== 1 && v !== 2) throw new Error('version must be 1 or 2'); version = v; },
    getVersion: () => version,
    orderCount: () => orders,
    reset() { version = 1; orders = 0; },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

module.exports = { start };
