'use strict';
// Deterministic, loopback-only stand-in for the News category filter used by
// the locator-recovery tests. It mirrors the shape that matters to Falcon
// (a row of toggle buttons inside nested containers) without cloning anything.
//
//   hooks      : each button has id + data-testid  ("news-category-<slug>")
//   renamed    : only the data-testid changes      ("news-filter-<slug>")
//   structural : no hooks at all; a hidden status region shifts the container
//                path (used with the plain "bare" markup)
const http = require('node:http');

const HOST = '127.0.0.1';
const CATEGORIES = ['All', 'Frontier', 'Open source', 'Agents', 'Research'];
const ITEMS = [
  { category: 'Frontier', title: 'A new frontier model arrives' },
  { category: 'Agents', title: 'Lighthouse Agent Protocol hands off long tasks' },
  { category: 'Research', title: 'A study on evaluation drift' },
];
const slug = (value) => value.toLowerCase().replace(/\s+/g, '-');

function page(version) {
  const hooks = version === 'hooks' || version === 'renamed';
  const prefix = version === 'renamed' ? 'news-filter' : 'news-category';
  const buttons = CATEGORIES.map((value) => {
    const attrs = hooks ? ` id="news-category-${slug(value)}" data-testid="${prefix}-${slug(value)}"` : '';
    return `<button type="button"${attrs} aria-pressed="${value === 'All'}" data-value="${value}">${value}</button>`;
  }).join('');
  const status = version === 'structural' ? '<div class="sr-only" role="status" aria-live="polite">3 articles shown</div>' : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Newsroom</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font:16px/1.4 sans-serif;color:#1b2430}
section{padding:16px 24px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
button{margin:0 6px 0 0;padding:6px 12px;border:1px solid #9aa5b5;border-radius:6px;background:#fff;font:inherit}
button[aria-pressed=true]{background:#12355b;color:#fff}
</style></head>
<body>
<main>
<section><h1>Newsroom</h1></section>
<section>
<div>
${status}<div><p>Latest</p></div>
<div><p>Filter by category</p></div>
<div><div>${buttons}</div></div>
<div id="stream"></div>
</div>
</section>
</main>
<script>
var items=${JSON.stringify(ITEMS)};
function show(category){
  var list=items.filter(function(i){return category==='All'||i.category===category;});
  document.getElementById('stream').innerHTML=list.map(function(i){return '<h2 class="lead">'+i.title+'</h2>';}).join('');
  document.querySelectorAll('button[data-value]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.value===category));});
}
document.querySelectorAll('button[data-value]').forEach(function(b){b.addEventListener('click',function(){show(b.dataset.value);});});
show('All');
</script>
</body></html>
`;
}

async function start() {
  let version = 'hooks';
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/news') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(page(version));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  const { port } = server.address();
  return {
    url: `http://${HOST}:${port}`,
    setVersion(next) { version = next; },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

module.exports = { start, CATEGORIES };
