"use strict";
const crypto = require("node:crypto");
const Signature = require("./ElementSignature");
const Identity = require("./LocatorIdentity");
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const hash = value => crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const string = (v, n) => typeof v === "string" && v.length > 0 && v.length <= n && !/[\u0000-\u001f]/.test(v);
function signature(v) {
  if (!v || typeof v !== "object" || Array.isArray(v) || v.schemaVersion !== Signature.SCHEMA_VERSION || bytes(v) > Signature.BOUNDS.MAX_TOTAL_BYTES) return false;
  const allowed = new Set(["schemaVersion", "capturedAt", "tagName", "role", "accessibleNameApprox", "attributes", "structuralPath", "textApprox", "boundingBoxBucket"]);
  if (Object.keys(v).some(k => !allowed.has(k)) || !string(v.tagName, 32)) return false;
  if (v.role != null && !/^[a-f0-9]{64}$/.test(v.role)) return false;
  for (const [k, n] of [["accessibleNameApprox", 120], ["textApprox", 80], ["boundingBoxBucket", 80]]) if (v[k] != null && (typeof v[k] !== "string" || v[k].length > n)) return false;
  if (!Array.isArray(v.structuralPath) || v.structuralPath.length > 4 || v.structuralPath.some(x => !string(x,32))) return false;
  if (!v.attributes || typeof v.attributes !== "object" || Array.isArray(v.attributes)) return false;
  return Object.entries(v.attributes).every(([k,x]) => Signature.ATTRIBUTE_ALLOW_LIST.includes(k) && /^[a-f0-9]{64}$/.test(x));
}
function identity(v) {
  if (!v || Object.keys(v).some(k=>!["schemaVersion","applicationId","origin","pathname","action","originalSelector"].includes(k)) || v.schemaVersion !== Identity.SCHEMA_VERSION || !Identity.ALLOWED_ACTIONS.has(v.action)) return false;
  if (!["applicationId","origin","pathname","originalSelector"].every(k => string(v[k], k === "originalSelector" ? 300 : k === "applicationId" ? 256 : 2048))) return false;
  try { const u = new URL(v.origin); return ["http:","https:"].includes(u.protocol) && u.origin === v.origin && v.pathname.startsWith("/") && !/[?#]/.test(v.pathname); } catch { return false; }
}
function selector(v) {
  return string(v,300) && !/\[\s*(?:value|password|token|secret|authorization|data-(?:token|secret|password))\b/i.test(v);
}
function sanitized(value,key="",depth=0) {
  if(depth>5) throw new Error("evidence depth exceeds bound");
  if(value===null || typeof value === "boolean") return value;
  if(typeof value === "number" && Number.isFinite(value)) return value;
  if(typeof value === "string") {
    if(key === "selector") {if(!selector(value)) throw new Error("unsafe evidence selector");return value;}
    if(value.length<=80 && /^[a-zA-Z0-9_.: -]*$/.test(value)) return value;
    throw new Error("evidence must contain labels, not page values");
  }
  if(Array.isArray(value)) {if(value.length>20)throw new Error("evidence array exceeds bound");return value.map(v=>sanitized(v,key,depth+1));}
  if(value && typeof value === "object") {
    if(Object.keys(value).length>40)throw new Error("evidence object exceeds bound");
    const out=Object.create(null);
    for(const [k,v] of Object.entries(value)) {if(!/^[a-zA-Z0-9_.-]{1,64}$/.test(k))throw new Error("invalid evidence label");out[k]=sanitized(v,k,depth+1);}
    return out;
  }
  throw new Error("invalid evidence");
}
function evidence(raw) {
  const out = {};
  for (const k of ["contributions","total","winner","runnerUp","evidence","alternativesConsidered","margin","changedFields","contradictions","missingEvidence","reason","threshold"]) if (Object.hasOwn(raw,k)) out[k] = sanitized(raw[k],k);
  if (bytes(out)>8192) throw new Error("candidate evidence exceeds bound");
  return out;
}
function proposal(raw) {
  if (!raw || !selector(raw.selector) || !signature(raw.signature)) throw new Error("invalid candidate");
  const substantive = {selector:raw.selector, signature:clone(raw.signature), ...evidence(raw)};
  const digestInput = clone(substantive); delete digestInput.signature.capturedAt;
  return {...substantive, proposalId:hash(digestInput)};
}
const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value ? value : "1970-01-01T00:00:00.000Z";
module.exports = {clone,bytes,hash,string,timestamp,signature,identity,evidence,proposal,MAX_BYTES:8*1024*1024,HISTORY_MAX:50};
