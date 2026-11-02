"use strict";

/**
 * NavigationProposal.js — WP-77N builder for navigation-step business
 * contracts (pathEquals + heading textEquals assertions).
 *
 * Produces a plain contract object that must pass Contract.validate before
 * being returned. Never produces an "observed" provenance source (Contract
 * itself rejects that), and never includes approval/status fields.
 */

const Contract = require("./Contract");

/**
 * @param {object} opts
 * @param {string} opts.journeyId
 * @param {string} opts.requirementId
 * @param {number} opts.revision
 * @param {string} opts.stepRef
 * @param {string} opts.pathname
 * @param {{locator: string, text: string}} opts.heading
 * @param {boolean} [opts.required=true]
 * @param {string} [opts.source="spec"]
 * @returns {object} a Contract-shaped plain object
 */
function buildNavigationProposal(opts) {
    const o = opts || {};
    const required = o.required === undefined ? true : o.required;
    const source = o.source === undefined ? "spec" : o.source;
    const heading = o.heading || {};
    const ref = `plan:${o.stepRef}`;

    const contract = {
        schemaVersion: 1,
        journeyId: o.journeyId,
        requirementId: o.requirementId,
        revision: o.revision,
        assertions: [
            {
                id: "nav-path",
                required,
                check: "pathEquals",
                locator: "url:pathname",
                expected: o.pathname,
                provenance: { source, ref },
            },
            {
                id: "nav-heading",
                required,
                check: "textEquals",
                locator: heading.locator,
                expected: heading.text,
                provenance: { source, ref },
            },
        ],
    };

    const result = Contract.validate(contract);
    if (!result.ok) {
        const err = new TypeError(`invalid navigation proposal contract: ${result.code}`);
        err.code = result.code;
        throw err;
    }

    return result.value;
}

module.exports = { buildNavigationProposal };
