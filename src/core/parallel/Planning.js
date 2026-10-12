"use strict";

const crypto = require("crypto");

function canonicalOrder(entryUrl, eligibleUrls) {
  const rest = [...new Set(eligibleUrls)].filter((u) => u !== entryUrl);
  rest.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [entryUrl, ...rest];
}

function shardOf(ordinal, total) {
  return (ordinal % total) + 1;
}

function assignShards(urls, total) {
  return urls.map((url, ordinal) => ({ ordinal, url, shard: shardOf(ordinal, total) }));
}

/**
 * analyses: [{ordinal, name, ...}]; signatureOf(analysis) -> string[] signatures.
 * Returns per-ordinal results sorted by ordinal. Input is not mutated.
 */
function dedupeInOrder(analyses, signatureOf) {
  const sorted = [...analyses].sort((a, b) => a.ordinal - b.ordinal);
  const owners = new Map();
  return sorted.map((page) => {
    const sigs = signatureOf(page);
    const kept = [];
    const deduped = [];
    for (const sig of sigs) {
      if (owners.has(sig)) {
        deduped.push({ name: page.name, signature: sig, status: "deduped", firstRunOn: owners.get(sig) });
      } else {
        owners.set(sig, page.url !== undefined ? page.url : page.ordinal);
        kept.push(sig);
      }
    }
    return { ordinal: page.ordinal, name: page.name, kept, deduped };
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

const frontierDigest = (orderedUrls) => digest(orderedUrls);
const planDigest = (perPageSignatureLists) => digest(perPageSignatureLists);

module.exports = { canonicalOrder, shardOf, assignShards, dedupeInOrder, frontierDigest, planDigest, canonicalJson };
