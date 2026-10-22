"use strict";
const os = require("os");
const path = require("path");

// Telemetry lives outside the repository so it can never be committed.
function telemetryDir(env = process.env) {
  return env.FALCON_TELEMETRY_DIR ? path.resolve(env.FALCON_TELEMETRY_DIR) : path.join(os.homedir(), ".claude-ops", "telemetry");
}
function claudeProjectsDir(env = process.env) {
  return path.join(env.FALCON_CLAUDE_HOME ? path.resolve(env.FALCON_CLAUDE_HOME) : path.join(os.homedir(), ".claude"), "projects");
}
function tokenFile(env = process.env) {
  return env.FALCON_TOKEN_FILE ? path.resolve(env.FALCON_TOKEN_FILE) : path.join(os.homedir(), ".claude-ops", "dashboard-token");
}
module.exports = { telemetryDir, claudeProjectsDir, tokenFile };
