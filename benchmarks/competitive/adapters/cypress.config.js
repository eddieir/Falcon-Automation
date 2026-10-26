// Config for the plain Cypress pass; the harness overrides spec and env per run.
module.exports = {
  e2e: { supportFile: false, video: false, screenshotOnRunFailure: false, defaultCommandTimeout: 1000, retries: 0, chromeWebSecurity: false },
};
