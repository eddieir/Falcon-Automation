#!/usr/bin/env node
'use strict';
// Runs the competitive benchmark: the same workloads, fixtures and oracles for every tool, then scores
// the records with scripts/benchmark/competitive-score.js. Every page and flow is on loopback; no accounts, keys or spend.
// Tool installers may download browser drivers or binaries; vendor telemetry is switched off below.
//   node benchmarks/competitive/run.js [--tools=falcon,playwright,selenium,cypress] [--runs=3] [--out=dir]
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');
const { score } = require(path.join(ROOT, 'scripts', 'benchmark', 'competitive-score.js'));
const Bench = require(path.join(ROOT, 'src', 'core', 'locator', 'HealingBenchmark.js'));
const checkout = require(path.join(ROOT, 'tests', 'fixtures', 'customer-demo', 'checkoutServer.js'));
const auth = require(path.join(ROOT, 'tests', 'fixtures', 'competitive', 'authServer.js'));
const silent = require(path.join(ROOT, 'tests', 'fixtures', 'competitive', 'silentSaveServer.js'));
const { start: startServer } = require('./lib/server');
const { derive } = require('./lib/locators');
const { baseRecord, failed, classifyLanding, classifyHeal } = require('./lib/classify');

const ADAPTERS = { falcon: './adapters/falcon', playwright: './adapters/playwright', selenium: './adapters/selenium', cypress: './adapters/cypress' };
const KIND = { click: 'click', type: 'input', select: 'change' };
const FLOW_WORKLOADS = ['W3-checkout-flow', 'W4-role-denied', 'W5-unasserted-step', 'W6-ci-economics'];
const arg = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || dflt;
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

async function main() {
  const toolNames = arg('tools', 'falcon,playwright,selenium,cypress').split(',');
  const unknown = toolNames.filter((n) => !Object.hasOwn(ADAPTERS, n));
  if (unknown.length) throw new Error(`unknown tool(s): ${unknown.join(', ')}; choose from ${Object.keys(ADAPTERS).join(', ')}`);
  // Vendor telemetry off: Selenium Manager usage stats and Cypress crash reports.
  process.env.SE_AVOID_STATS = 'true';
  process.env.CYPRESS_CRASH_REPORTS = '0';
  // No provider credential can reach any tool, so the AI-call count of 0 holds by construction, not by assumption.
  const stripped = Object.keys(process.env).filter((k) => /(_API_KEY|_TOKEN|_SECRET)$/.test(k));
  for (const k of stripped) delete process.env[k];
  const runs = Number(arg('runs', '3'));
  const outDir = path.resolve(arg('out', path.join(ROOT, 'docs', 'research', 'competitive-benchmark-runs')));
  const workloads = JSON.parse(await fs.readFile(path.join(ROOT, 'docs', 'research', 'competitive-benchmark-workloads.json'), 'utf8')).workloads;
  const workloadOf = new Map(workloads.flatMap((w) => w.fixtureRefs.map((id) => [id, w.id])));
  const widOf = (f) => workloadOf.get(f.id) || `corpus/${f.id}`;
  const { fixtures } = await Bench.loadCorpus();

  const checkoutApp = await checkout.start();
  const authApp = await auth.start();
  const silentApp = await silent.start();
  const server = await startServer({ fixtures, apps: { checkout: checkoutApp, auth: authApp, silent: silentApp } });

  const probe = await chromium.launch({ headless: true });
  const locators = await derive(await probe.newPage(), fixtures, server.url);
  await probe.close();
  const plan = fixtures.map((f) => ({ id: f.id, action: f.action, value: f.expectedSelectValue || 'one', ...locators.get(f.id) }));

  const snaps = {};
  const ctx = {
    base: server.url, checkoutUrl: checkoutApp.url, authUrl: authApp.url, silentUrl: silentApp.url,
    reset: async () => server.resetApps(),
    snapshot: (k) => { snaps[k] = k === 'w3' ? checkoutApp.orderCount() : silentApp.getState().saved; },
    observation: (k) => server.observation(k),
  };

  const records = [];
  const environment = {};
  for (let run = 1; run <= runs; run += 1) {
    for (const name of toolNames) {
      const adapter = require(ADAPTERS[name]).create();
      const t0 = process.hrtime.bigint();
      server.reset();
      const emit = (workloadId, rec, version) => records.push({ ...rec, workloadId, toolVersion: version });
      try {
        await adapter.open();
        const located = await adapter.locators(ctx, plan);
        const flows = await adapter.flows(ctx, plan);
        if (flows.batch) ctx.snapshot('w3'), ctx.snapshot('w5');
        const bv = adapter.browserVersion ? await adapter.browserVersion() : null;
        const version = `${adapter.version()}${bv ? ` / Chrome ${bv}` : ''}`;
        environment[adapter.name] = version;
        await new Promise((r) => setTimeout(r, 300));

        for (const f of fixtures) {
          const rec = baseRecord(adapter.name, version, run, widOf(f), { expectedRefusal: Boolean(f.mustRefuse) });
          const step = located ? located[f.id] : {};
          const ev = server.eventsFor(f.id).filter((e) => e.kind === KIND[f.action]);
          const landed = ev.length ? ev[0].gt : null;
          if (step.heal && landed === null) emit(widOf(f), classifyHeal(rec, f, step.heal), version);
          else if (step.healError) emit(widOf(f), failed({ ...rec, objectivelyFailed: true, note: step.healError }), version);
          else emit(widOf(f), classifyLanding(rec, f, landed), version);
        }

        const flow = (id, ok, error) => baseRecord(adapter.name, version, run, id, error ? { outcome: 'FAIL', reportedPassed: false, objectivelyFailed: true } : { objectivelyFailed: !ok });
        const seen = flows.w4.seen || {};
        const w4ok = (seen.alice || '').includes('Admin console') && (seen.bob || '').includes('forbidden') && (seen.anon || '').includes('not signed in');
        emit('W3-checkout-flow', flow('W3-checkout-flow', snaps.w3 === 1, flows.w3.error), version);
        emit('W4-role-denied', flow('W4-role-denied', w4ok, flows.w4.error), version);
        // W5: the save never persists, so every run is objectively failing; passing it is the false green.
        emit('W5-unasserted-step', { ...flow('W5-unasserted-step', false, flows.w5.error), objectivelyFailed: snaps.w5 === false }, version);

        const secs = Number(process.hrtime.bigint() - t0) / 1e9;
        emit('W6-ci-economics', baseRecord(adapter.name, version, run, 'W6-ci-economics', {
          ci: { timeToGreenSec: Math.round(secs * 100) / 100, retries: 0, browserMinutes: Math.round((secs / 60) * 1000) / 1000, aiCalls: 0 },
        }), version);
      } catch (err) {
        const note = String(err.message).split('\n')[0].slice(0, 200);
        const ids = new Set([...fixtures.map(widOf), ...FLOW_WORKLOADS]);
        for (const workloadId of ids) {
          records.push({ workloadId, tool: adapter.name, toolVersion: environment[adapter.name] || 'unknown', mode: 'automated', run, outcome: 'NOT_TESTED', note });
        }
      } finally { await adapter.close().catch(() => {}); }
      process.stderr.write(`run ${run} ${name} done\n`);
    }
  }
  await Promise.all([server.close(), checkoutApp.close(), authApp.close(), silentApp.close()]);

  const revision = git('rev-parse', 'HEAD');
  const out = {
    meta: {
      revision, dirtyRelevantTree: git('status', '--porcelain', '--', 'src', 'scripts', 'tests', 'benchmarks').length > 0,
      date: new Date().toISOString(), node: process.version, os: `${os.platform()} ${os.release()} ${os.arch()}`,
      runs, tools: toolNames, versions: environment, costUsd: 0, aiCalls: 0, credentialVariablesRemovedFromEnvironment: stripped.length, telemetryDisabled: ['SE_AVOID_STATS', 'CYPRESS_CRASH_REPORTS'], mode: 'automated',
    },
    locators: plan.map(({ id, selector, basis }) => ({ id, selector, basis })),
    scores: score(records),
    records,
  };
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${revision.slice(0, 7)}-local.json`);
  await fs.writeFile(file, `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`${file}\n`);
}

main().catch((err) => { process.stderr.write(`benchmark failed: ${err.stack}\n`); process.exitCode = 1; });
