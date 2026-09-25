/**
 * build-ui-test-recording.js — turns the videos Playwright recorded for
 * tests/demo/axonradar.ui.spec.js into the two artefacts the README links:
 * an MP4 of the whole suite and a GIF of the self-healing test.
 *
 * The recordings are located through reports/ui-demo-results.json, not by
 * walking reports/ui-demo-artifacts/. Playwright names each artefact
 * directory after a truncated, hashed form of the test title
 * ("…-f817f-and-the-feed-really-filters-chromium"), so matching a test by
 * directory name silently stops working the moment a title is edited. The
 * JSON reporter maps full title to video path directly, and it also records
 * each test's status — which is what lets this script refuse to publish a
 * recording of a run that wasn't green.
 *
 * reports/ is gitignored, so nothing published here is a build artefact that
 * got committed by accident; this script copies the chosen recordings into
 * docs/demo/ deliberately.
 *
 * Why two formats: GitHub renders a relative .gif inline in a README but not
 * a relative .mp4, so the GIF is what a reader sees without clicking. The MP4
 * is the same run at full length and fidelity, linked rather than embedded,
 * because a readable GIF of six tests runs to tens of megabytes and nobody
 * should pay that to load a README.
 *
 * Requires ffmpeg on PATH. Run after the suite, or use `npm run demo:record`
 * to do both in one step.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");
const RESULTS_FILE = path.join(REPO_ROOT, "reports", "ui-demo-results.json");
const WORK_DIR = path.join(REPO_ROOT, "reports", "ui-demo-artifacts");

const MP4_OUT = path.join(__dirname, "axonradar-ui-test.mp4");
const GIF_OUT = path.join(__dirname, "axonradar-ui-test.gif");

// The GIF is built from the one test that shows something no screenshot can:
// a selector that doesn't exist, the real retries against it, and the live
// feed collapsing to the matching article once Tier 2 resolves it.
const GIF_TEST_TITLE_CONTAINS = "still types into the real search field";

function run(command, args) {
    const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.error || result.status !== 0) {
        throw new Error(
            `${command} failed (${result.status}): ${(result.stderr || result.error?.message || "").trim()}`
        );
    }
    return result.stdout;
}

function fail(message) {
    console.error(message);
    process.exitCode = 1;
}

/** Flatten the reporter's nested suites into one list of specs, in run order. */
function collectSpecs(suites) {
    const specs = [];
    const walk = (list) => {
        for (const suite of list || []) {
            specs.push(...(suite.specs || []));
            walk(suite.suites);
        }
    };
    walk(suites);
    return specs;
}

if (spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status !== 0) {
    fail("ffmpeg is not on PATH — install it (brew install ffmpeg) and run this again.");
    return;
}

if (!fs.existsSync(RESULTS_FILE)) {
    fail(
        `No results at ${path.relative(REPO_ROOT, RESULTS_FILE)}.\n` +
        "Run `npm run test:demo` first — it records a video per test."
    );
    return;
}

const specs = collectSpecs(JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8")).suites);
if (specs.length === 0) {
    fail("The results file contains no tests — nothing to build a recording from.");
    return;
}

const recordings = [];
const problems = [];

for (const spec of specs) {
    const result = spec.tests?.[0]?.results?.[0];
    if (!result || result.status !== "passed") {
        problems.push(`${spec.title} — ${result ? result.status : "no result"}`);
        continue;
    }
    const video = (result.attachments || []).find((attachment) => attachment.name === "video");
    if (!video || !fs.existsSync(video.path)) {
        problems.push(`${spec.title} — passed, but no video was recorded`);
        continue;
    }
    recordings.push({ title: spec.title, video: video.path });
}

// A recording is published as evidence the suite works. Publishing one from a
// run where a test failed, or where a video went missing, would make it
// evidence of nothing — so this stops rather than writing a partial file.
if (problems.length > 0) {
    fail(
        "Not building a recording — this run isn't publishable:\n" +
        problems.map((problem) => `  ${problem}`).join("\n") +
        "\n\nFix the suite (or re-run it) and try again."
    );
    return;
}

console.log(`${recordings.length} passing test(s) with recordings:`);
for (const { title, video } of recordings) {
    console.log(`  ${(fs.statSync(video).size / 1024 / 1024).toFixed(2)} MB  ${title}`);
}

// ── MP4: every test, in run order, one file ──
// Re-encoded rather than stream-copied: the segments are VP8, which the
// concat demuxer will not copy into an MP4 container.
const listFile = path.join(WORK_DIR, "concat-list.txt");
fs.writeFileSync(
    listFile,
    recordings.map(({ video }) => `file '${video.replace(/'/g, "'\\''")}'`).join("\n") + "\n"
);

console.log("\nEncoding MP4…");
run("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-c:v", "libx264", "-preset", "medium", "-crf", "28",
    // Even dimensions and yuv420p, or the file won't play in a browser.
    "-vf", "scale=1280:-2:flags=lanczos,fps=15,format=yuv420p",
    "-movflags", "+faststart",
    MP4_OUT,
]);
fs.rmSync(listFile, { force: true });

// ── GIF: the self-healing test only ──
const healing = recordings.find(({ title }) => title.includes(GIF_TEST_TITLE_CONTAINS));
if (!healing) {
    fail(
        `\nNo test title contains "${GIF_TEST_TITLE_CONTAINS}" — the MP4 is written, the GIF is not.\n` +
        "If the test was renamed, update GIF_TEST_TITLE_CONTAINS in this script."
    );
} else {
    console.log(`\nEncoding GIF from: ${healing.title}`);
    // Two passes — palette, then apply. A single-pass GIF of a dark UI bands badly.
    const palette = path.join(WORK_DIR, "palette.png");
    // tpad holds the last frame for two seconds before the loop restarts, so
    // the filtered feed — the whole point of the clip — is readable rather
    // than flashing past on the way back to the beginning.
    const filters = "fps=10,scale=900:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=2";
    run("ffmpeg", ["-y", "-i", healing.video, "-vf", `${filters},palettegen=max_colors=128`, palette]);
    run("ffmpeg", [
        "-y", "-i", healing.video, "-i", palette,
        "-lavfi", `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
        "-loop", "0", GIF_OUT,
    ]);
    fs.rmSync(palette, { force: true });
}

console.log("\nWritten:");
for (const output of [MP4_OUT, GIF_OUT]) {
    if (fs.existsSync(output)) {
        console.log(
            `  ${path.relative(REPO_ROOT, output)}  ` +
            `(${(fs.statSync(output).size / 1024 / 1024).toFixed(2)} MB)`
        );
    }
}
