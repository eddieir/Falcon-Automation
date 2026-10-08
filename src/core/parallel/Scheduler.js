"use strict";

const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();
const MAX_ERROR = 300;

function getTaskContext() {
  return storage.getStore();
}

function boundedError(err) {
  const text = err && err.message !== undefined ? String(err.message) : String(err);
  return text.replace(/[^\x20-\x7e]/g, "?").slice(0, MAX_ERROR);
}

async function runBounded(items, limit, task, { deadline = Infinity, now = Date.now } = {}) {
  const n = items.length;
  const results = new Array(n);
  for (let i = 0; i < n; i++) results[i] = { index: i, status: "not-started" };
  const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, n));
  let cursor = 0;
  async function lane() {
    while (cursor < n) {
      if (now() >= deadline) return;
      const index = cursor++;
      try {
        const value = await storage.run({ pageOrdinal: index }, () => task(items[index], index));
        results[index] = { index, status: "done", value };
      } catch (err) {
        results[index] = { index, status: "failed", error: boundedError(err) };
      }
    }
  }
  const running = [];
  for (let l = 0; l < lanes; l++) running.push(lane());
  await Promise.all(running); // lanes only, never per item
  return results;
}

module.exports = { runBounded, getTaskContext };
