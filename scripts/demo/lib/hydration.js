"use strict";
/**
 * Click a toggle control that is server-rendered and becomes interactive only
 * after hydration, without letting retries hide a wrong target.
 *
 * Before every attempt the control is re-resolved and must still be exactly one
 * element with the expected accessible name; the retry interval and the overall
 * time are bounded. If aria-pressed never becomes "true" the failure says so.
 */

class HydrationError extends Error {
  constructor(message) {
    super(message);
    this.name = "HydrationError";
  }
}

async function activateControl(page, { role = "button", name, timeoutMs = 8000, intervalMs = 250, settleMs = 250 } = {}) {
  if (!name) throw new TypeError("activateControl needs the control's accessible name");
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  for (;;) {
    const control = page.getByRole(role, { name, exact: true });
    const count = await control.count();
    if (count !== 1) throw new HydrationError(`expected exactly one ${role} named "${name}", found ${count}; refusing to click`);
    if ((await control.getAttribute("aria-pressed")) === "true") return { attempts };
    if (Date.now() >= deadline) {
      throw new HydrationError(`"${name}" never became pressed after ${attempts} click(s) in ${timeoutMs}ms; the page may not have hydrated`);
    }
    await control.click({ timeout: Math.max(500, deadline - Date.now()) });
    attempts += 1;
    await page.waitForTimeout(settleMs);
    if ((await control.getAttribute("aria-pressed")) === "true") return { attempts };
    await page.waitForTimeout(intervalMs);
  }
}

module.exports = { activateControl, HydrationError };
