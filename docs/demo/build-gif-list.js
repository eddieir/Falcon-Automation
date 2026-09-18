/**
 * build-gif-list.js — turns a directory of capture-dashboard.js frames into
 * an ffmpeg concat list, picking frames by actual content change instead of
 * a hardcoded frame index.
 *
 * Why: the dashboard's state at frame N depends on real network/render
 * timing (page load, socket connect, event arrival) which genuinely varies
 * run to run — a fixed index list like "frame-006.png is the explore state"
 * silently goes stale the next time this is regenerated. This script instead
 * hashes each frame, collapses consecutive duplicates (the dashboard is
 * static between real events), and keeps one representative frame per
 * distinct state — so the GIF always shows connect -> explore -> results,
 * however many frames of empty waiting happened to land in between.
 *
 * Usage: node docs/demo/build-gif-list.js <framesDir> <outputListFile> [holdSeconds]
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const framesDir = process.argv[2];
const outputFile = process.argv[3];
const holdSeconds = Number(process.argv[4] || 3.0);
const stepSeconds = 0.45;

const files = fs.readdirSync(framesDir)
    .filter((f) => f.endsWith(".png"))
    .sort();

if (files.length === 0) {
    throw new Error(`No frames found in ${framesDir}`);
}

const hashOf = (file) => crypto.createHash("sha1").update(fs.readFileSync(path.join(framesDir, file))).digest("hex");

const distinct = [];
let lastHash = null;
for (const file of files) {
    const hash = hashOf(file);
    if (hash !== lastHash) {
        distinct.push(file);
        lastHash = hash;
    }
}

// distinct[] is now one frame per real state change, in chronological order.
// Hold every state briefly except the last (final/settled) one, which gets
// a long hold so the GIF is readable before it loops.
const relDir = path.basename(framesDir);
const lines = [];
distinct.forEach((file, i) => {
    const isLast = i === distinct.length - 1;
    lines.push(`file '${relDir}/${file}'`);
    lines.push(`duration ${isLast ? holdSeconds : stepSeconds}`);
});
// ffmpeg's concat demuxer needs the last file repeated (it ignores the final
// duration directive otherwise), so hold the final state twice.
lines.push(`file '${relDir}/${distinct[distinct.length - 1]}'`);
lines.push(`duration ${holdSeconds}`);

fs.writeFileSync(outputFile, lines.join("\n") + "\n");
console.log(`${distinct.length} distinct state(s) out of ${files.length} captured frames -> ${outputFile}`);
distinct.forEach((f) => console.log(`  ${f}`));
