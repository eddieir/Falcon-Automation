'use strict';
// Runs the real gate-run main() and cleanup handlers with a stand-in scenario
// that starts an "AI-agency" and a "Falcon + dashboard" process tree, each with
// a descendant, then waits to be signalled.
//   node gateCleanupDriver.js <workDir> <stubDir> <port> <port> <port> <port>
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const E = require('../../../scripts/demo/lib/env');
const gate = require('../../../scripts/demo/lib/gate');
const { main, installCleanup } = require('../../../scripts/demo/gate-run');

const [workDir, stubDir, ...ports] = process.argv.slice(2);
const stub = path.join(__dirname, 'stubTree.js');
const firstLine = (child) => new Promise((resolve) => child.stdout.once('data', (d) => resolve(JSON.parse(d.toString().split('\n')[0]))));

installCleanup();
main({
  argv: ['hook-rename', workDir],
  env: { AGENCY_SOURCE: 'unused' },
  runScenario: async () => {
    await gate.resetWorkDir(workDir);
    const agency = E.track(spawn(process.execPath, [stub, ports[0], ports[1]], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] }));
    const agencyPids = await firstLine(agency);
    fs.writeFileSync(path.join(stubDir, 'falcon.js'), `require(${JSON.stringify(stub)});\n`);
    const falcon = E.startFalcon(stubDir, [ports[2], ports[3]], {});
    const falconPids = await firstLine(falcon.child);
    process.stdout.write(`READY ${JSON.stringify({ pids: [agencyPids.pid, agencyPids.leaf, falconPids.pid, falconPids.leaf], ports })}\n`);
    await new Promise(() => {});
  },
});
