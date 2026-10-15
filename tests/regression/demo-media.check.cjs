"use strict";
// The demo video builder's evidence rules, without rendering any video:
// nothing is shown before the event that proves it, scenes may not slow the
// recording below the stated limit, and recorded lines keep their order.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Capture } = require("../../scripts/demo/media/capture");
const { buildStates } = require("../../scripts/demo/media/render");
const { WIDE, PORTRAIT } = require("../../scripts/demo/media/formats");

function makeCapture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-media-test-"));
  const dir = path.join(root, "capture");
  fs.mkdirSync(dir);
  const run = {
    ok: true, agencySha: "f".repeat(40), evidence: {},
    log: [
      { t: 100, label: "agency", stream: "stdout", line: `ready at ${root}/agency/app.js` },
      { t: 900, label: "falcon", stream: "stdout", line: "✅ Passed: First step (10ms)" },
      { t: 1500, label: "falcon", stream: "stdout", line: "❌ Tier 1 exhausted for First step." },
      { t: 2200, label: "falcon", stream: "stdout", line: "✅ Passed: Second step (10ms)" },
    ],
    capture: { t0: 1000, marks: [{ t: 50, name: "agency:ready" }, { t: 1800, name: "recovery:healed-counter", detail: 1 }], videos: [], commands: [{ t: 80, label: "agency", argv: ["npm", "run", "dev"] }, { t: 800, label: "falcon", argv: ["node", "falcon.js", `--plan=${root}/plan.json`] }] },
    ...overrides.run,
  };
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run));
  fs.writeFileSync(path.join(dir, "negative.json"), JSON.stringify({ ok: true, evidence: {}, ...overrides.negative }));
  fs.writeFileSync(path.join(dir, "public.json"), JSON.stringify({ url: "https://example.org/", title: "t" }));
  return { cap: new Capture(dir), root, dir };
}

test("a recording whose gate did not pass is refused", () => {
  const { dir } = makeCapture();
  const bad = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  bad.ok = false;
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(bad));
  assert.throws(() => new Capture(dir), /did not pass its gate/);
});

test("events that never happened cannot be looked up, so nothing can be anchored to them", () => {
  const { cap } = makeCapture();
  assert.equal(cap.mark("agency:ready"), 50);
  assert.throws(() => cap.mark("approval:click"), /no recorded event/);
  assert.equal(cap.logAt("falcon", /Tier 1 exhausted/), 1500);
  assert.throws(() => cap.logAt("falcon", /approved_reuse/), /no recorded line/);
  assert.throws(() => cap.command("falcon-reuse"), /no recorded command/);
});

test("machine paths never reach the screen", () => {
  const { cap, root } = makeCapture();
  const shown = cap.clean(`--plan=${root}/plan.json and /Users/someone/project/file.js and /private/var/x`);
  assert.doesNotMatch(shown, /\/Users\/|\/private\/|falcon-media-test/);
  assert.match(shown, /--plan=\.\/plan\.json/);
});

const base = (extra) => ({ id: "t", title: "Title", subtitle: "Sub", from: 0, to: 4000, dur: 4, ...extra });

test("cards and captions appear only once the real time shown has reached their event", () => {
  const { cap } = makeCapture();
  const scene = base({
    cards: [{ kind: "statement", slot: "body", after: 2000, title: "Late", lines: [{ text: "x" }] }, { kind: "statement", slot: "body", after: 500, until: 1500, title: "Window", lines: [{ text: "y" }] }],
    captions: [{ after: 1000, text: "first" }, { after: 3000, text: "second" }],
  });
  const { frames } = buildStates(cap, WIDE, scene);
  const at = (ms) => frames[Math.round(ms / 100)];
  assert.equal(at(0).cards.length, 0);
  assert.equal(at(0).caption, undefined, "no caption before its event");
  assert.deepEqual(at(700).cards.map((c) => c.title), ["Window"]);
  assert.deepEqual(at(1700).cards.map((c) => c.title), [], "a card with an end time disappears");
  assert.equal(at(1200).caption.text, "first");
  assert.deepEqual(at(2500).cards.map((c) => c.title), ["Late"]);
  assert.equal(at(3500).caption.text, "second");
});

test("a card or caption without a recorded event is rejected", () => {
  const { cap } = makeCapture();
  assert.throws(() => buildStates(cap, WIDE, base({ captions: [{ text: "floating claim" }] })), /no recorded event/);
  assert.throws(() => buildStates(cap, WIDE, base({ cards: [{ kind: "statement", slot: "body", after: NaN, lines: [] }] })), /no recorded event/);
});

test("scenes may speed the recording up or slow it to half speed, no further; still scenes carry no video", () => {
  const { cap } = makeCapture();
  assert.doesNotThrow(() => buildStates(cap, WIDE, base({ to: 8000, dur: 4 })));
  assert.doesNotThrow(() => buildStates(cap, WIDE, base({ to: 2000, dur: 4 })));
  assert.throws(() => buildStates(cap, WIDE, base({ to: 1000, dur: 4 })), /slow the recording down/);
  assert.throws(() => buildStates(cap, WIDE, base({ static: true, videos: [{ source: "app:x", slot: "app", label: "x" }] })), /still scene/);
});

test("the terminal lists real lines in recorded order, with the command first, and states the time scale", () => {
  const { cap } = makeCapture();
  const scene = base({ from: 0, to: 3000, dur: 3, terminal: { slot: "terminal", labels: ["falcon"], commands: [{ label: "falcon", nth: 0 }], include: (l) => /Passed|exhausted/.test(l.line) } });
  const { frames } = buildStates(cap, WIDE, scene);
  const lines = frames[frames.length - 1].terminal.lines;
  assert.deepEqual(lines.map((l) => l.kind), ["cmd", "ok", "err", "ok"]);
  assert.match(lines[0].text, /^\$ node falcon\.js --plan=\.\/plan\.json$/);
  assert.deepEqual(lines.slice(1).map((l) => l.text.replace(/^.*?(Passed|Tier)/, "$1")), ["Passed: First step (10ms)", "Tier 1 exhausted for First step.", "Passed: Second step (10ms)"]);
  assert.equal(frames[0].terminal.note, "real time");
  const fast = buildStates(cap, WIDE, base({ from: 0, to: 8000, dur: 4, terminal: { slot: "terminal", labels: ["falcon"] } })).frames[0].terminal.note;
  assert.match(fast, /×2\.0 faster than real time/);
  const slow = buildStates(cap, WIDE, base({ from: 0, to: 2000, dur: 4, terminal: { slot: "terminal", labels: ["falcon"] } })).frames[0].terminal.note;
  assert.match(slow, /slowed ×2\.0/);
});

test("checklist rows change state only at the event the log recorded, and titles follow their events", () => {
  const { cap } = makeCapture();
  const items = [{ text: "First step", timeline: [{ at: 900, state: "pass" }] }, { text: "Hook", timeline: [{ at: 500, state: "pending", detail: "looking" }, { at: 1500, state: "fail", detail: "gone" }, { at: 2200, state: "pass", detail: "recovered" }] }];
  const scene = base({ from: 0, to: 3000, dur: 3, titles: [{ after: 1800, title: "Healed", subtitle: "s2" }], cards: [{ kind: "checks", slot: "body", after: 0, title: "Steps", items }] });
  const { frames } = buildStates(cap, WIDE, scene);
  const states = (ms) => frames[Math.round(ms / 100)].cards[0].items.map((i) => i.state);
  assert.deepEqual(states(0), ["pending", "pending"]);
  assert.deepEqual(states(1000), ["pass", "pending"]);
  assert.deepEqual(states(1600), ["pass", "fail"]);
  assert.deepEqual(states(2500), ["pass", "pass"]);
  assert.equal(frames[10].title, "Title");
  assert.equal(frames[20].title, "Healed");
});

test("both formats keep every slot inside the frame and every scene list free of the old checkout content", () => {
  for (const fmt of [WIDE, PORTRAIT]) {
    for (const [name, r] of Object.entries(fmt.slots)) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= fmt.size.w && r.y + r.h <= fmt.size.h, `${fmt.name}.${name} is inside ${fmt.size.w}x${fmt.size.h}`);
    }
  }
  for (const file of ["scenes-master.js", "scenes-linkedin.js", "helpers.js"]) {
    const text = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "demo", "media", file), "utf8");
    assert.doesNotMatch(text, /checkout|Northwind|place-order|Tier 2\.5|LocatorMemory/i, `${file} stays customer-first`);
  }
});

test("recorded files are confined to the capture directory, whatever the manifest says", () => {
  const { cap, dir } = makeCapture();
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  run.capture.videos.push({ label: "dash-evil", startedAt: 1000, file: "../../../etc/passwd" });
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run));
  const evil = new Capture(dir);
  assert.throws(() => evil.video("dash:dash-evil"), /outside the capture directory/);
  assert.throws(() => cap.still("../run.json"), /outside the capture directory/);
});

test("media outputs must be the right kind of file, never a link, and are built aside then moved into place", () => {
  const output = require("../../scripts/demo/media/output");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-media-out-"));
  assert.throws(() => output.checkOutput(path.join(dir, "x.txt"), ".mp4"), /must be a \.mp4 file/);
  const victim = path.join(dir, "victim.mp4");
  fs.writeFileSync(victim, "keep");
  const link = path.join(dir, "link.mp4");
  fs.symlinkSync(victim, link);
  assert.throws(() => output.checkOutput(link, ".mp4"), /not a regular file/);
  fs.mkdirSync(path.join(dir, "folder.mp4"));
  assert.throws(() => output.checkOutput(path.join(dir, "folder.mp4"), ".mp4"), /not a regular file/);
  assert.doesNotThrow(() => output.checkOutput(path.join(dir, "new.mp4"), ".mp4"));
  const target = path.join(dir, "final.mp4");
  const partial = output.partialPath(target);
  assert.notEqual(partial, target);
  assert.equal(path.dirname(partial), dir);
  assert.equal(path.extname(partial), ".mp4");
  fs.writeFileSync(partial, "built");
  output.finish(partial, target);
  assert.equal(fs.readFileSync(target, "utf8"), "built");
  assert.equal(fs.existsSync(partial), false);
});
