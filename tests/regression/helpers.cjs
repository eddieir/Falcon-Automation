const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
exports.root = path.resolve(__dirname, "../..");
exports.silent = { info() {}, warning() {}, error() {}, async flush() {} };
exports.load = function (relative, mocks = {}) {
  const filename = path.join(exports.root, relative);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (name) =>
    Object.hasOwn(mocks, name)
      ? mocks[name]
      : Module.prototype.require.call(mod, name);
  mod._compile(fs.readFileSync(filename, "utf8"), filename);
  return mod.exports;
};
exports.temp = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "falcon-regression-"));
