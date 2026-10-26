#!/usr/bin/env node
'use strict';
// Installs the Cypress binary only when the archive's SHA-256 matches the pin in cypress-binary.sha256.json.
// Fails closed: an unknown platform, a changed archive or a version mismatch installs nothing.
//   node benchmarks/competitive/install-cypress.js
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MAX_BYTES = 500 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function pinFor(pins, version, platform = `${process.platform}-${process.arch}`) {
  if (pins.version !== version) throw new Error(`pinned Cypress ${pins.version} does not match package.json ${version}`);
  const pin = pins.binaries[platform];
  if (!pin) throw new Error(`no pinned checksum for ${platform}; refusing to install an unverified binary`);
  if (!/^https:\/\/cdn\.cypress\.io\//.test(pin.url) || !/^[0-9a-f]{64}$/.test(pin.sha256)) throw new Error(`malformed pin for ${platform}`);
  return pin;
}

function download(url, file, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('too many redirects'));
        const next = new URL(res.headers.location, url);
        if (next.protocol !== 'https:') return reject(new Error('refusing a non-https redirect'));
        return resolve(download(next.href, file, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`download failed: HTTP ${res.statusCode}`)); }
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(file, { mode: 0o600 });
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { res.destroy(new Error('archive larger than the allowed size')); return; }
        hash.update(c);
      });
      res.on('error', (err) => { out.destroy(); reject(err); });
      res.pipe(out);
      out.on('finish', () => resolve(hash.digest('hex')));
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const pins = JSON.parse(fs.readFileSync(path.join(__dirname, 'cypress-binary.sha256.json'), 'utf8'));
  const version = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).dependencies.cypress;
  const pin = pinFor(pins, version);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-cypress-'));
  const file = path.join(dir, 'cypress.zip');
  try {
    const actual = await download(pin.url, file);
    if (actual !== pin.sha256) throw new Error(`checksum mismatch: expected ${pin.sha256}, got ${actual}; nothing installed`);
    const res = spawnSync('npx', ['cypress', 'install'], { cwd: __dirname, stdio: 'inherit', env: { ...process.env, CYPRESS_INSTALL_BINARY: file, CYPRESS_CRASH_REPORTS: '0' } });
    if (res.status !== 0) throw new Error('cypress install failed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { pinFor };
if (require.main === module) main().catch((err) => { process.stderr.write(`${err.message}\n`); process.exitCode = 1; });
