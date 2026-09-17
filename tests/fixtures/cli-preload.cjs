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
