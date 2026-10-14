"use strict";
/** Where the media tools may write: a named file type, never through a link, replaced atomically. */

const fs = require("node:fs");
const path = require("node:path");

/** Refuse an output path that is not the right kind of file or would write through a link. */
function checkOutput(file, ext) {
  if (path.extname(file).toLowerCase() !== ext) throw new Error(`the output must be a ${ext} file`);
  let stat = null;
  try { stat = fs.lstatSync(file); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (stat && (stat.isSymbolicLink() || !stat.isFile())) throw new Error("the output path exists and is not a regular file");
  const dir = path.dirname(file);
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error("the output directory is a link");
}

/** A sibling path to build into first; `finish` then moves it over the real output. */
function partialPath(file) {
  const ext = path.extname(file);
  return path.join(path.dirname(file), `.${path.basename(file, ext)}.${process.pid}.partial${ext}`);
}

function finish(partial, file) {
  fs.renameSync(partial, file);
}

module.exports = { checkOutput, partialPath, finish };
