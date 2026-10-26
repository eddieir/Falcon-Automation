// Plain Cypress spec driven by the plan in Cypress.expose('plan'). Failures are swallowed per step so that
// the harness, not Cypress, decides what a tool outcome means.
const plan = Cypress.expose('plan');
const urls = Cypress.expose('urls');
const T = 1000;
const swallow = () => cy.on('fail', () => false);

describe('locators', () => {
  plan.forEach((step) => {
    it(step.id, () => {
      swallow();
      cy.visit(`${urls.base}/f/${step.id}/post.html`);
      const el = cy.get(step.selector, { timeout: T });
      if (step.action === 'type') el.type('benchmark input', { timeout: T });
      else if (step.action === 'select') el.select(step.value, { timeout: T });
      else el.click({ timeout: T });
      cy.wait(100);
    });
  });
});

describe('flows', () => {
  it('w3 checkout', () => {
    swallow();
    cy.request('POST', `${urls.base}/__ctl/reset`);
    cy.visit(`${urls.checkout}/checkout`);
    cy.get('#email', { timeout: T }).type('buyer@example.test');
    cy.get('[data-testid="checkout-complete"]', { timeout: T }).click();
    cy.get('[data-testid="order-confirmation"]', { timeout: 2000 }).should('be.visible');
    cy.request('POST', `${urls.base}/__ctl/obs?k=w3`, 'ok');
  });
  [['alice', '/signin/alice'], ['bob', '/signin/bob'], ['anon', '/admin']].forEach(([key, p]) => {
    it(`w4 ${key}`, () => {
      swallow();
      cy.clearCookies();
      cy.visit(urls.auth + p, { failOnStatusCode: false });
      cy.get('body', { timeout: T }).invoke('text').then((t) => cy.request('POST', `${urls.base}/__ctl/obs?k=w4-${key}`, t));
    });
  });
  it('w5 unasserted', () => {
    swallow();
    cy.visit(`${urls.silent}/`);
    cy.get('[data-testid="save-note"]', { timeout: T }).click();
    cy.request('POST', `${urls.base}/__ctl/obs?k=w5`, 'ok');
  });
});
