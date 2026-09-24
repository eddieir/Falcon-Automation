const Module = require("node:module");
const original = Module._load;
const mode = process.env.FALCON_FIXTURE_MODE;
const page = {
  goto: async (url) => {
    if (mode === "navigation-failure")
      throw Error("fixture navigation failure");
    if (mode === "query" && !url.endsWith("?key=value=tail"))
      throw Error(`truncated URL: ${url}`);
  },
};
const mocks = {
  playwright: {
    chromium: {
      launch: async () => {
        if (mode === "launch-failure") throw Error("fixture launch failure");
        return {
          newContext: async () => ({ newPage: async () => page }),
          close: async () => {},
        };
      },
    },
  },
  "./src/core/ExploratoryAI": class {
    async detectUIIssues() {
      return [];
    }
  },
  "./src/core/ClickExplorer": class {
    constructor() {
      this.visitedPages = new Set(["http://fixture.test"]);
    }
    async explore() {}
  },
  "./src/core/TestGenerator": class {
    async generateTestScenarios() {
      return { url: "http://fixture.test", test_scenarios: [] };
    }
  },
  "./src/core/TestRunner": class {
    async executeTest() {
      return mode === "empty"
        ? []
        : [
            {
              name: "fixture",
              status: mode === "scenario-failure" ? "failed" : "passed",
            },
          ];
    }
    async executeExploratoryTest() {}
  },
  // Phase 10 — falcon.js now drives the run through SiteSweep, so the CLI's
  // exit-code contract has to be exercised through a sweep result rather than
  // through a single TestRunner call. This stands in for SiteSweep at the
  // documented SweepResult shape; each fixture mode maps to the sweep outcome
  // that used to be produced by the mocks above, so the assertions in
  // cli.check.cjs still mean exactly what they meant before.
  "./src/core/SiteSweep": class {
    constructor(context, opts = {}) {
      this.opts = opts;
    }
    async run(entryUrl) {
      // The URL reaches the sweep whole or the run is wrong: "?key=value=tail"
      // is there to catch a naive split("=") in the flag parser.
      if (mode === "query" && !entryUrl.endsWith("?key=value=tail"))
        throw Error(`truncated URL: ${entryUrl}`);
      // A dead entry page is recorded, not thrown: one unreachable page must
      // never abort a sweep, and a run that tested nothing still exits 1.
      const page =
        mode === "navigation-failure"
          ? {
              url: entryUrl,
              status: "unreachable",
              reason: "fixture navigation failure",
              scenariosGenerated: 0,
              scenariosDeduplicated: 0,
              results: [],
              uiIssues: [],
              durationMs: 0,
            }
          : {
              url: entryUrl,
              status: "tested",
              scenariosGenerated: mode === "empty" ? 0 : 1,
              scenariosDeduplicated: 0,
              results:
                mode === "empty"
                  ? []
                  : [
                      {
                        name: "fixture",
                        status:
                          mode === "scenario-failure" ? "failed" : "passed",
                      },
                    ],
              uiIssues: [],
              durationMs: 1,
            };
      return {
        entryUrl,
        pages: [page],
        coverage: {
          pagesDiscovered: 1,
          pagesTested: page.status === "tested" ? 1 : 0,
          pagesSkipped: 0,
          pagesUnreachable: page.status === "unreachable" ? 1 : 0,
          scenariosGenerated: page.scenariosGenerated,
          scenariosDeduplicated: 0,
          budgetExhausted: false,
        },
      };
    }
  },
  "./src/core/Dashboard": class {
    async start() {}
    async stop() {}
    emit() {}
  },
};
Module._load = function (name, parent, ...rest) {
  if (Object.hasOwn(mocks, name)) return mocks[name];
  return original.call(this, name, parent, ...rest);
};
