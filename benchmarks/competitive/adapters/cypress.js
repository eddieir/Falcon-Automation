'use strict';
// Plain Cypress (bundled Electron, headless): default cy.get/click/type/select, no healing.
// One cypress.run for the whole tool pass; the spec reports through the shared control server.
const path = require('node:path');

function create() {
  let version = '';
  return {
    name: 'Cypress',
    async open() {},
    version: () => version,
    // Cypress is batch-driven, so locators and flows run in one invocation (see flows()).
    async locators() { return null; },
    async flows(ctx, plan) {
      const cypress = require('cypress');
      const res = await cypress.run({
        project: __dirname,
        configFile: path.join(__dirname, 'cypress.config.js'),
        spec: path.join(__dirname, 'cypress.spec.cy.js'),
        quiet: true,
        config: {
          e2e: { specPattern: path.join(__dirname, 'cypress.spec.cy.js') },
          expose: { plan, urls: { base: ctx.base, checkout: ctx.checkoutUrl, auth: ctx.authUrl, silent: ctx.silentUrl } },
        },
      });
      if (res.status === 'failed') throw new Error(`cypress could not run: ${res.message}`);
      version = `${res.cypressVersion} / ${res.browserName} ${res.browserVersion}`;
      const w4 = { alice: ctx.observation('w4-alice'), bob: ctx.observation('w4-bob'), anon: ctx.observation('w4-anon') };
      return {
        w3: { error: ctx.observation('w3') === 'ok' ? null : 'flow did not complete' },
        w4: { error: Object.values(w4).some((v) => v === null) ? 'flow did not complete' : null, seen: w4 },
        w5: { error: ctx.observation('w5') === 'ok' ? null : 'flow did not complete' },
        batch: true,
      };
    },
    async close() {},
  };
}

module.exports = { create };
