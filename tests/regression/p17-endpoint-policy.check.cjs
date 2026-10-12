const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers.cjs");

function freshModule() {
  return load("src/core/llm/transport/EndpointPolicy.js", {});
}

// --- Sec-00 SSRF TABLE (data-driven; every row => zero requests) ----------
//
// `url` is the FALCON_LLM_ENDPOINT shape under test. `opts` mirrors the
// opt-in flags LlmConfig would pass through. `expect` is the closed error
// code validateEndpointUrl must return, or "ok" if the row is expected to
// pass shape validation (classification may still defer to resolution time
// for a plain DNS hostname).
const SSRF_TABLE = [
  { name: "public https host, no opt-in", url: "https://public.example.com/v1", opts: {}, expect: "ok" },
  {
    name: "loopback http without opt-in",
    url: "http://127.0.0.1:11434/v1",
    opts: {},
    expect: "CONFIG_ENDPOINT_OPT_IN_REQUIRED",
  },
  {
    name: "loopback http with opt-in",
    url: "http://127.0.0.1:11434/v1",
    opts: { allowHttpLoopback: true },
    expect: "ok",
  },
  {
    name: "AWS IMDS https, every opt-in",
    url: "https://169.254.169.254/v1",
    opts: { allowLoopback: true, allowPrivate: true },
    expect: "ENDPOINT_POLICY_REJECTED",
  },
  {
    name: "AWS IMDS as IPv4-mapped IPv6",
    url: "https://[::ffff:169.254.169.254]/v1",
    opts: { allowLoopback: true, allowPrivate: true },
    expect: "ENDPOINT_POLICY_REJECTED",
  },
  {
    name: "AWS IMDS IPv6 with ALLOW_PRIVATE",
    url: "https://[fd00:ec2::254]/v1",
    opts: { allowPrivate: true },
    expect: "ENDPOINT_POLICY_REJECTED",
  },
  {
    name: "Azure host metadata, every opt-in",
    url: "https://168.63.129.16/v1",
    opts: { allowLoopback: true, allowPrivate: true },
    expect: "ENDPOINT_POLICY_REJECTED",
  },
  {
    name: "Alibaba metadata with ALLOW_PRIVATE",
    url: "https://100.100.100.200/v1",
    opts: { allowPrivate: true },
    expect: "ENDPOINT_POLICY_REJECTED",
  },
  { name: "private 10/8 without ALLOW_PRIVATE", url: "https://10.0.0.1/v1", opts: {}, expect: "CONFIG_ENDPOINT_OPT_IN_REQUIRED" },
  { name: "private 172.16/12 without ALLOW_PRIVATE", url: "https://172.16.0.1/v1", opts: {}, expect: "CONFIG_ENDPOINT_OPT_IN_REQUIRED" },
  { name: "private 192.168/16 without ALLOW_PRIVATE", url: "https://192.168.1.1/v1", opts: {}, expect: "CONFIG_ENDPOINT_OPT_IN_REQUIRED" },
  { name: "shared address space 100.64/10 without ALLOW_PRIVATE", url: "https://100.64.0.1/v1", opts: {}, expect: "CONFIG_ENDPOINT_OPT_IN_REQUIRED" },
  { name: "ULA fc00::/7 without ALLOW_PRIVATE", url: "https://[fc00::1]/v1", opts: {}, expect: "CONFIG_ENDPOINT_OPT_IN_REQUIRED" },
  { name: "link-local fe80::1", url: "https://[fe80::1]/v1", opts: { allowPrivate: true, allowLoopback: true }, expect: "ENDPOINT_POLICY_REJECTED" },
  { name: "0x7f.1 alternate loopback notation w/o opt-in", url: "https://0x7f.1/v1", opts: {}, expect: "CONFIG_ENDPOINT_OPT_IN_REQUIRED" },
  { name: "2130706433 decimal loopback notation w/o opt-in", url: "https://2130706433/v1", opts: {}, expect: "CONFIG_ENDPOINT_OPT_IN_REQUIRED" },
  { name: "0177.0.0.1 octal loopback notation w/o opt-in", url: "https://0177.0.0.1/v1", opts: {}, expect: "CONFIG_ENDPOINT_OPT_IN_REQUIRED" },
  { name: "127.1 short loopback notation w/o opt-in", url: "https://127.1/v1", opts: {}, expect: "CONFIG_ENDPOINT_OPT_IN_REQUIRED" },
  { name: "unspecified 0.0.0.0", url: "https://0.0.0.0/v1", opts: { allowPrivate: true, allowLoopback: true }, expect: "ENDPOINT_POLICY_REJECTED" },
  { name: "unspecified ::", url: "https://[::]/v1", opts: { allowPrivate: true, allowLoopback: true }, expect: "ENDPOINT_POLICY_REJECTED" },
  { name: "multicast 224.0.0.1", url: "https://224.0.0.1/v1", opts: { allowPrivate: true }, expect: "ENDPOINT_POLICY_REJECTED" },
  { name: "broadcast 255.255.255.255", url: "https://255.255.255.255/v1", opts: { allowPrivate: true }, expect: "ENDPOINT_POLICY_REJECTED" },
  { name: "reserved 240.0.0.1", url: "https://240.0.0.1/v1", opts: { allowPrivate: true }, expect: "ENDPOINT_POLICY_REJECTED" },
  { name: "NAT64 64:ff9b::a9fe:a9fe", url: "https://[64:ff9b::a9fe:a9fe]/v1", opts: { allowPrivate: true }, expect: "ENDPOINT_POLICY_REJECTED" },
  { name: "6to4 2002:a9fe:a9fe::", url: "https://[2002:a9fe:a9fe::]/v1", opts: { allowPrivate: true }, expect: "ENDPOINT_POLICY_REJECTED" },
  { name: "userinfo rejected", url: "https://user:pw@public.example.com/v1", opts: {}, expect: "CONFIG_INVALID" },
  { name: "fragment rejected", url: "https://public.example.com/v1#frag", opts: {}, expect: "CONFIG_INVALID" },
  { name: "query string rejected", url: "https://public.example.com/v1?t=MARK", opts: {}, expect: "CONFIG_INVALID" },
  { name: "disallowed port :22", url: "https://public.example.com:22/v1", opts: {}, expect: "CONFIG_INVALID" },
  { name: "ftp scheme rejected", url: "ftp://public.example.com/v1", opts: {}, expect: "CONFIG_INVALID" },
  { name: "file scheme rejected", url: "file:///v1", opts: {}, expect: "CONFIG_INVALID" },
  { name: "javascript scheme rejected", url: "javascript://public.example.com/v1", opts: {}, expect: "CONFIG_INVALID" },
  { name: "non-/v1 base path rejected", url: "https://public.example.com/v2", opts: {}, expect: "CONFIG_INVALID" },
  { name: "dot-segment escape /v1/../admin rejected", url: "https://public.example.com/v1/../admin", opts: {}, expect: "CONFIG_INVALID" },
  { name: "encoded dot-segment escape rejected", url: "https://public.example.com/v1/%2e%2e/admin", opts: {}, expect: "CONFIG_INVALID" },
  { name: "localhost. trailing dot without opt-in", url: "https://localhost./v1", opts: {}, expect: "CONFIG_ENDPOINT_OPT_IN_REQUIRED" },
  { name: "LOCALHOST uppercase without opt-in", url: "https://LOCALHOST/v1", opts: {}, expect: "CONFIG_ENDPOINT_OPT_IN_REQUIRED" },
];

for (const row of SSRF_TABLE) {
  test(`SSRF TABLE: ${row.name}`, () => {
    const { validateEndpointUrl } = freshModule();
    const result = validateEndpointUrl(row.url, row.opts);
    if (row.expect === "ok") {
      assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
    } else {
      assert.equal(result.ok, false, `expected ${row.expect}, got ok`);
      assert.equal(result.errorCode, row.expect);
    }
  });
}

// --- Always-deny beats every opt-in -----------------------------------
test("always-deny: AWS IMDS v6 stays denied even with allowPrivate+allowLoopback+extraAllowedPorts", () => {
  const { classifyAddress } = freshModule();
  const result = classifyAddress("fd00:ec2::254", { allowPrivate: true, allowLoopback: true });
  assert.equal(result.allowed, false);
});

test("always-deny: Azure metadata host stays denied with every opt-in", () => {
  const { classifyAddress } = freshModule();
  const result = classifyAddress("168.63.129.16", { allowPrivate: true, allowLoopback: true });
  assert.equal(result.allowed, false);
});

// --- IPv4-mapped / compat IPv6 decode-and-recheck -----------------------
test("IPv4-mapped ::ffff:10.0.0.1 is classified as the embedded private v4 (private, opt-in required)", () => {
  const { classifyAddress } = freshModule();
  const result = classifyAddress("::ffff:a00:1", {});
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "private_opt_in_required");
});

test("IPv4-mapped ::ffff:169.254.169.254 is always denied regardless of opts", () => {
  const { classifyAddress } = freshModule();
  const result = classifyAddress("::ffff:a9fe:a9fe", { allowPrivate: true, allowLoopback: true });
  assert.equal(result.allowed, false);
});

test("IPv4-compat ::127.0.0.1 (deprecated form) decodes to loopback", () => {
  const { classifyAddress } = freshModule();
  const result = classifyAddress("::7f00:1", { allowLoopback: true });
  assert.equal(result.allowed, true);
  assert.equal(result.endpointClass, "custom_loopback");
});

// --- Alternate IPv4 notations (resolved through WHATWG URL parsing) ----
for (const notation of ["0x7f.1", "2130706433", "0177.0.0.1", "127.1"]) {
  test(`alternate notation ${notation} resolves to canonical loopback and is classified consistently`, () => {
    const { validateEndpointUrl } = freshModule();
    const denied = validateEndpointUrl(`https://${notation}/v1`, {});
    assert.equal(denied.ok, false);
    assert.equal(denied.errorCode, "CONFIG_ENDPOINT_OPT_IN_REQUIRED");
    const allowed = validateEndpointUrl(`https://${notation}/v1`, { allowLoopback: true });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.url.hostname, "127.0.0.1");
  });
}

// --- Port rows -----------------------------------------------------------
for (const port of [80, 443, 8000, 8080, 11434]) {
  test(`allowed port ${port} passes shape validation`, () => {
    const { validateEndpointUrl } = freshModule();
    const result = validateEndpointUrl(`https://public.example.com:${port}/v1`, {});
    assert.equal(result.ok, true);
  });
}

test("extraAllowedPorts permits an ephemeral test-only port", () => {
  const { validateEndpointUrl } = freshModule();
  const denied = validateEndpointUrl("https://public.example.com:54321/v1", {});
  assert.equal(denied.ok, false);
  const allowed = validateEndpointUrl("https://public.example.com:54321/v1", { extraAllowedPorts: [54321] });
  assert.equal(allowed.ok, true);
});

// --- assertAllResolvedAllowed: ANY denied address rejects the whole set --
test("assertAllResolvedAllowed rejects the whole lookup if any resolved address is denied", () => {
  const { assertAllResolvedAllowed } = freshModule();
  const result = assertAllResolvedAllowed(["93.184.216.34", "169.254.169.254"], {});
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "ENDPOINT_POLICY_REJECTED");
});

test("assertAllResolvedAllowed accepts when every resolved address is a classified-public address", () => {
  const { assertAllResolvedAllowed } = freshModule();
  const result = assertAllResolvedAllowed(["93.184.216.34", "93.184.216.35"], {});
  assert.equal(result.ok, true);
  assert.equal(result.endpointClass, "custom_public");
});

// --- TDD red/green proof (documented) -------------------------------------
// Row "AWS IMDS https, every opt-in" above fails red if the always-deny
// check in classifyV4 is removed/reordered after the private-range check:
// temporarily moving V4_ALWAYS_DENY below the private-range branch in
// EndpointPolicy.js makes `classifyAddress("169.254.169.254", {allowPrivate:
// true})` return {allowed:true} (private-range match swallows it before the
// always-deny list runs), which flips this row's `validateEndpointUrl` call
// from ENDPOINT_POLICY_REJECTED to ok:true — red. Restoring the always-deny
// check first (as shipped) makes it green again. Verified locally by hand
// during development; left as a comment per the Dev-01a/Dev-01b convention
// of not shipping a deliberately broken duplicate file.
//
// Row "disallowed port :22" fails red if `isAllowedPort` is changed to
// `return true` unconditionally (simulating "ports outside allowlist" being
// forgotten) — the port-:22 row flips from CONFIG_INVALID to ok:true. Red
// confirmed, then reverted to the shipped `isAllowedPort` body for green.
