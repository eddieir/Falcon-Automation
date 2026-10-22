#!/usr/bin/env node
"use strict";
// Optional retention helper. Dry run by default; deletes only monthly telemetry
// files (events-/snapshots-YYYYMM.jsonl) older than --keep-months (default 6).
//   node prune.js                 list what would be removed
//   node prune.js --apply         remove them
const fs = require("fs");
const path = require("path");
const { telemetryDir } = require("./lib/paths");

const argv = process.argv.slice(2);
const k = argv.indexOf("--keep-months");
const keep = k > -1 ? Number(argv[k + 1]) : 6;
if (!Number.isInteger(keep) || keep < 1) { console.error("--keep-months must be a positive integer"); process.exit(2); }
const dir = process.env.FALCON_TELEMETRY_DIR ? path.resolve(process.env.FALCON_TELEMETRY_DIR) : telemetryDir();
const now = new Date();
const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - keep + 1, 1));
const cutKey = `${cutoff.getUTCFullYear()}${String(cutoff.getUTCMonth() + 1).padStart(2, "0")}`;
let old = [];
try { old = fs.readdirSync(dir).filter((f) => /^(events|snapshots)-\d{6}\.jsonl$/.test(f) && f.match(/(\d{6})/)[1] < cutKey); } catch { /* no dir */ }
console.log(`${argv.includes("--apply") ? "removing" : "[dry run] would remove"}: ${old.join(", ") || "(nothing)"}`);
if (argv.includes("--apply")) for (const f of old) fs.unlinkSync(path.join(dir, f));
