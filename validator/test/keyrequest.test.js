"use strict";
// POST AS YOU — the validator's side, in-process (createApp(":memory:"), an ephemeral port), against
// scripts/lib/farcaster-api-stub.mjs (a loopback Farcaster client API that recovers every SignedKeyRequest with viem's own
// code against the custody its chain holds) and scripts/lib/farcaster-protocol-stub.mjs (a loopback Snapchain node with
// its own protobuf decoder, BLAKE3 and Ed25519 checks). Nothing here leaves the machine. Covered: the EIP-712 signer is
// byte-identical to viem's; the app account arms only with both names and names what is missing (never a value); a key
// request is created for a usable key only, signed for the configured app fid, and REFUSED by Farcaster for a wrong
// requestFid or an expired deadline; polling reads the approval and its userFid; the per-address cap; the sponsorship;
// the hub relay forwards a well-made message unchanged and refuses (without forwarding) a tampered one, an unrelayed type
// or the wrong content type, and passes the node's own refusal through as an error; nothing logged carries a key or token.
for (const k of ["ZK_DEV_HOOKS", "NODE_ENV", "FC_APP_FID", "FC_APP_CUSTODY_KEY", "FC_APP_SPONSOR", "FC_KEY_REQUEST_API_URL", "FC_KEY_REQUEST_TTL_SEC", "FC_HUB_URL", "FC_ANON_FID", "LAYERS_HOSTED", "TRUST_PROXY", "LAYERS_REQUIRE_SIG"]) delete process.env[k];

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const { recoverTypedDataAddress, keccak256, toBytes } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { createApp } = require("../server");
const eip = require("../eip712");
const hub = require("../hubmessage");
const kr = require("../keyrequest");
const vc = require("../env-contract");

const USER_FID = 990777;
const OTHER_FID = 990778;
const USER_KEY = createHash("sha256").update("keyrequest.test root signer").digest("hex");
const USER_PUB = "0x" + hub.signerPublicKey(USER_KEY);
const STRANGER_KEY = createHash("sha256").update("keyrequest.test stranger").digest("hex");
let server, base, stubs, logs;
const origLog = console.log;
const origWarn = console.warn;
const origErr = console.error;
before(async () => {
  logs = [];
  console.log = (...a) => logs.push(a.join(" "));
  console.warn = (...a) => logs.push(a.join(" "));
  console.error = (...a) => logs.push(a.join(" "));
  // behind a "proxy": every test speaks from its own X-Real-IP (from() below), so the per-address caps never bleed
  process.env.TRUST_PROXY = "true";
  const created = createApp(":memory:");
  delete process.env.TRUST_PROXY;
  await new Promise((r) => (server = created.app.listen(0, "127.0.0.1", r)));
  base = "http://127.0.0.1:" + server.address().port;
  const { startRootPostStubs } = await import(pathToFileURL(path.join(__dirname, "..", "..", "scripts", "lib", "farcaster-api-stub.mjs")).href);
  stubs = await startRootPostStubs();
});
after(async () => {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origErr;
  server.close();
  await stubs.close();
});
async function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
const ARMED = (x = {}) => ({ FC_APP_FID: String(stubs.appFid), FC_APP_CUSTODY_KEY: stubs.appKey, FC_KEY_REQUEST_API_URL: stubs.api.base, FC_HUB_URL: stubs.protocol.hubUrl, ...x });
const api = async (method, p, body, headers = {}) => {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
};
// each test speaks from its own loopback address, so the per-address caps do not bleed between tests
let nextIp = 10;
const from = () => ({ "x-real-ip": "10.0.0." + nextIp++ });
const SKR_TYPES = { SignedKeyRequest: [{ name: "requestFid", type: "uint256" }, { name: "key", type: "bytes" }, { name: "deadline", type: "uint256" }] };

test("the EIP-712 signer is byte-identical to viem's (no viem in the validator image) and recovers to the custody", async () => {
  const priv = keccak256(toBytes("keyrequest.test eip712"));
  const acct = privateKeyToAccount(priv);
  assert.equal(eip.custodyAddressOf(priv), acct.address);
  for (const [fid, deadline] of [[1, 1], [3358008, 1793903759], [Number.MAX_SAFE_INTEGER, 2 ** 40]]) {
    const ours = eip.signKeyRequest({ privHex: priv, requestFid: fid, key: USER_PUB, deadline });
    const theirs = await acct.signTypedData({ domain: eip.SKR_DOMAIN, types: SKR_TYPES, primaryType: "SignedKeyRequest", message: { requestFid: BigInt(fid), key: USER_PUB, deadline: BigInt(deadline) } });
    assert.equal(ours, theirs, "fid " + fid);
    assert.equal(await recoverTypedDataAddress({ domain: eip.SKR_DOMAIN, types: SKR_TYPES, primaryType: "SignedKeyRequest", message: { requestFid: BigInt(fid), key: USER_PUB, deadline: BigInt(deadline) }, signature: ours }), acct.address);
  }
  const sp = eip.signSponsorship({ privHex: priv, keyRequestSignature: eip.signKeyRequest({ privHex: priv, requestFid: 9, key: USER_PUB, deadline: 9 }) });
  assert.equal(sp, await acct.signMessage({ message: { raw: eip.signKeyRequest({ privHex: priv, requestFid: 9, key: USER_PUB, deadline: 9 }) } }));
  // MUTATION: another domain name gives another signature (the domain is load-bearing)
  const wrong = eip.signedKeyRequestDigest({ requestFid: 1, key: USER_PUB, deadline: 1 }, { ...eip.SKR_DOMAIN, name: "Farcaster SignedKeyRequest" });
  assert.notEqual(Buffer.from(wrong).toString("hex"), Buffer.from(eip.signedKeyRequestDigest({ requestFid: 1, key: USER_PUB, deadline: 1 })).toString("hex"));
  assert.equal(eip.custodyAddressOf("0x" + "00".repeat(32)), null);
  assert.equal(eip.custodyAddressOf("not a key"), null);
});

test("the app account: unarmed names what is missing (never a value); armed answers the fid and the custody ADDRESS", async () => {
  await withEnv({ FC_APP_FID: undefined, FC_APP_CUSTODY_KEY: undefined }, async () => {
    const r = await api("GET", "/fc/app-account", undefined, from());
    assert.equal(r.status, 200);
    assert.equal(r.json.ready, false);
    assert.ok(r.json.problems.some((p) => p.startsWith("FC_APP_FID is unset")) && r.json.problems.some((p) => p.startsWith("FC_APP_CUSTODY_KEY is unset")), JSON.stringify(r.json));
    const k = await api("POST", "/fc/key-request", { key: USER_PUB }, from());
    assert.equal(k.status, 503);
    assert.equal(k.json.code, "not_armed");
    const s = await api("POST", "/fc/hub/submit", new Uint8Array([1, 2, 3]), { "Content-Type": "application/octet-stream", ...from() });
    assert.equal(s.status, 503, "the relay is off while the app account is unarmed");
  });
  await withEnv(ARMED({ FC_APP_CUSTODY_KEY: "0x1234" }), async () => {
    const r = await api("GET", "/fc/app-account", undefined, from());
    assert.equal(r.json.ready, false);
    assert.ok(r.json.problems.some((p) => /FC_APP_CUSTODY_KEY is not/.test(p)) && !JSON.stringify(r.json).includes("0x1234"), JSON.stringify(r.json));
  });
  await withEnv(ARMED({ FC_ANON_FID: String(stubs.appFid) }), async () => {
    const r = await api("GET", "/fc/app-account", undefined, from());
    assert.equal(r.json.ready, false, "the app account must not be the @anon account");
  });
  await withEnv(ARMED(), async () => {
    const r = await api("GET", "/fc/app-account", undefined, from());
    assert.deepEqual({ ready: r.json.ready, appFid: r.json.appFid, custodyAddress: r.json.custodyAddress, sponsored: r.json.sponsored, problems: r.json.problems }, { ready: true, appFid: stubs.appFid, custodyAddress: privateKeyToAccount(stubs.appKey).address, sponsored: false, problems: [] });
    assert.ok(!JSON.stringify(r.json).toLowerCase().includes(stubs.appKey.slice(2).toLowerCase()), "the key never leaves");
  });
});

test("a key request: a usable key only; signed for the app fid; Farcaster's token and deeplink come back; polling reads the approval", async () => {
  await withEnv(ARMED(), async () => {
    for (const bad of ["", "0x" + "00".repeat(32), USER_PUB.slice(0, 40), "0x" + "zz".repeat(32), USER_PUB.toUpperCase().replace("0X", "0x") + "00"]) {
      const r = await api("POST", "/fc/key-request", { key: bad }, from());
      assert.equal(r.status, 400, "refused: " + bad);
      assert.equal(r.json.code, "bad_key");
    }
    const before = stubs.api.requests.length;
    const r = await api("POST", "/fc/key-request", { key: USER_PUB }, from());
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(stubs.api.requests.length, before + 1, "the stub API (which recovers the signature itself) accepted it");
    const made = stubs.api.requests[stubs.api.requests.length - 1];
    assert.equal(made.requestFid, stubs.appFid);
    assert.equal(made.key, USER_PUB);
    assert.equal(r.json.token, made.token);
    assert.equal(r.json.deeplinkUrl, "farcaster://signed-key-request?token=" + made.token);
    assert.equal(r.json.requestFid, stubs.appFid);
    const now = Math.floor(Date.now() / 1000);
    assert.ok(r.json.deadline > now + 850 && r.json.deadline <= now + 900 + 5, "a 15-minute deadline by default");
    const p1 = await api("GET", "/fc/key-request?token=" + encodeURIComponent(made.token), undefined, from());
    assert.deepEqual(p1.json, { token: made.token, key: USER_PUB, state: "pending", userFid: null });
    stubs.api.approve(made.token, { userFid: USER_FID });
    const p2 = await api("GET", "/fc/key-request?token=" + encodeURIComponent(made.token), undefined, from());
    assert.deepEqual(p2.json, { token: made.token, key: USER_PUB, state: "completed", userFid: USER_FID });
    const nf = await api("GET", "/fc/key-request?token=0x00000000000000000000000000", undefined, from());
    assert.equal(nf.status, 404);
    assert.equal(nf.json.code, "not_found");
    const bt = await api("GET", "/fc/key-request?token=" + encodeURIComponent("a b"), undefined, from());
    assert.equal(bt.status, 400);
  });
});

test("MUTATIONS refused by Farcaster: a WRONG requestFid (another account's number) and an EXPIRED deadline", async () => {
  // the validator configured with a fid whose custody is NOT the key it holds: the stub recovers the signer and refuses
  await withEnv(ARMED({ FC_APP_FID: String(OTHER_FID) }), async () => {
    const r = await api("POST", "/fc/key-request", { key: USER_PUB }, from());
    assert.equal(r.status, 502, JSON.stringify(r.json));
    assert.equal(r.json.code, "farcaster_refused");
    assert.match(r.json.error, /does not recover to the requestFid's custody/);
  });
  // an expired deadline, signed correctly by the same signer the validator uses: Farcaster refuses it
  const deadline = Math.floor(Date.now() / 1000) - 60;
  const signature = eip.signKeyRequest({ privHex: stubs.appKey, requestFid: stubs.appFid, key: USER_PUB, deadline });
  const res = await fetch(stubs.api.base + "/v2/signed-key-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: USER_PUB, requestFid: stubs.appFid, signature, deadline }) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).errors[0].message, /deadline has passed/);
  // the positive control for the same request with a live deadline (so the refusal above is about the deadline alone)
  const ok = eip.signKeyRequest({ privHex: stubs.appKey, requestFid: stubs.appFid, key: USER_PUB, deadline: deadline + 3600 });
  const res2 = await fetch(stubs.api.base + "/v2/signed-key-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: USER_PUB, requestFid: stubs.appFid, signature: ok, deadline: deadline + 3600 }) });
  assert.equal(res2.status, 200);
  // a TTL below the floor is refused by name (no deadline shorter than ten minutes is ever signed)
  assert.ok(kr.appAccount({ ...ARMED(), FC_KEY_REQUEST_TTL_SEC: "30" }).problems.some((p) => p.startsWith("FC_KEY_REQUEST_TTL_SEC")));
});

test("Farcaster down or answering something unusable: a 502 in plain words, never a link", async () => {
  await withEnv(ARMED(), async () => {
    stubs.api.failNext(503, 1);
    const r = await api("POST", "/fc/key-request", { key: USER_PUB }, from());
    assert.equal(r.status, 502);
    assert.equal(r.json.code, "farcaster_refused");
    assert.equal(r.json.deeplinkUrl, undefined);
  });
  await withEnv(ARMED({ FC_KEY_REQUEST_API_URL: "http://127.0.0.1:9" }), async () => {
    const r = await api("POST", "/fc/key-request", { key: USER_PUB }, from());
    assert.equal(r.status, 502);
    assert.equal(r.json.code, "farcaster_unreachable");
  });
  assert.ok(!kr.deeplinkOk("https://evil.example/signed-key-request?token=0xabc", "0xabc") && !kr.deeplinkOk("javascript:alert(1)//0xabc", "0xabc") && kr.deeplinkOk("farcaster://signed-key-request?token=0xabcdef01", "0xabcdef01") && kr.deeplinkOk("https://client.farcaster.xyz/deeplinks/signed-key-request?token=0xabcdef01", "0xabcdef01"));
  // a hosting platform takes https only
  assert.ok(kr.appAccount({ ...ARMED(), LAYERS_HOSTED: "true" }).problems.some((p) => p.startsWith("FC_KEY_REQUEST_API_URL")));
});

test("the per-address cap: the seventh key request from one address in an hour is refused 429", async () => {
  await withEnv(ARMED(), async () => {
    const h = { "x-real-ip": "10.9.9.9" };
    // TRUST_PROXY is off here, so every test request keys on the loopback socket: use a fresh mount to count cleanly
    const express = require("express");
    const app = express();
    app.use(express.json());
    kr.mountKeyRequest(app, { devHooks: false, trustProxy: true, log: { log() {} } });
    let s2;
    await new Promise((r) => (s2 = app.listen(0, "127.0.0.1", r)));
    const b2 = "http://127.0.0.1:" + s2.address().port;
    const codes = [];
    for (let i = 0; i < 7; i++) {
      const res = await fetch(b2 + "/fc/key-request", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ key: USER_PUB }) });
      codes.push(res.status);
    }
    s2.close();
    assert.deepEqual(codes, [201, 201, 201, 201, 201, 201, 429], codes.join(","));
  });
});

test("the per-account cap counts only what the node TOOK: junk signed by a stranger's key naming the account never spends its day", async () => {
  await withEnv(ARMED(), async () => {
    const express = require("express");
    const app = express();
    kr.mountKeyRequest(app, { devHooks: false, trustProxy: true, log: { log() {} }, limits: { ...kr.LIMITS, submitsPerFidDay: 2, submitsPerAddressHour: 1000 } });
    let s2;
    await new Promise((r) => (s2 = app.listen(0, "127.0.0.1", r)));
    const b2 = "http://127.0.0.1:" + s2.address().port;
    const send = async (privateKey, text) => (await fetch(b2 + "/fc/hub/submit", { method: "POST", headers: { "content-type": "application/octet-stream", "x-real-ip": "10.8.8.8" }, body: hub.makeMessage({ fid: USER_FID, body: { type: "CastAdd", text }, privateKey }).bytes })).status;
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push(await send(STRANGER_KEY, "junk " + i)); // the node refuses a key the account never added
    for (let i = 0; i < 3; i++) codes.push(await send(USER_KEY, "mine " + i));
    s2.close();
    // MUTATION: spending the cap BEFORE the node answers turns the first real post into a 429 ([502,429,429,429,...])
    assert.deepEqual(codes, [502, 502, 502, 200, 200, 429], codes.join(","));
  });
});

test("sponsorship: FC_APP_SPONSOR=on adds the app's sponsorship; Farcaster refuses it until the account is signed up", async () => {
  await withEnv(ARMED({ FC_APP_SPONSOR: "on" }), async () => {
    const r1 = await api("POST", "/fc/key-request", { key: USER_PUB }, from());
    assert.equal(r1.status, 502);
    assert.match(r1.json.error, /not signed up|fewer than 100 warps/);
    stubs.api.markSponsor(stubs.appFid);
    const r2 = await api("POST", "/fc/key-request", { key: USER_PUB }, from());
    assert.equal(r2.status, 201, JSON.stringify(r2.json));
    assert.equal(r2.json.sponsored, true);
    assert.equal(stubs.api.requests[stubs.api.requests.length - 1].sponsored, true);
  });
});

test("the hub relay: a well-made message is forwarded unchanged; a tampered one, another type or the wrong content type is refused and NOT forwarded", async () => {
  await withEnv(ARMED(), async () => {
    stubs.protocol.state.keys.set(USER_FID + ":" + USER_PUB.slice(2), { state: 1, keyType: 1, at: 0 });
    const submits = () => stubs.protocol.calls.filter((c) => c.path === "/v1/submitMessage").length;
    const m = hub.makeMessage({ fid: USER_FID, body: { type: "CastAdd", text: "hello from my own account" }, privateKey: USER_KEY });
    const n0 = submits();
    const ok = await api("POST", "/fc/hub/submit", m.bytes, { "Content-Type": "application/octet-stream", ...from() });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual(ok.json, { ok: true, hash: m.hash, fid: USER_FID, type: 1 });
    assert.equal(submits(), n0 + 1);
    assert.equal(stubs.protocol.state.casts.get(m.hash).text, "hello from my own account");
    // a reply, a like, a recast and a delete, all forwarded
    const reply = hub.makeMessage({ fid: USER_FID, body: { type: "CastAdd", text: "a reply", parent: { fid: OTHER_FID, hash: "0x" + "cd".repeat(20) } }, privateKey: USER_KEY });
    assert.equal((await api("POST", "/fc/hub/submit", reply.bytes, { "Content-Type": "application/octet-stream", ...from() })).status, 200);
    assert.deepEqual(stubs.protocol.state.casts.get(reply.hash).parent, { fid: OTHER_FID, hash: "0x" + "cd".repeat(20) });
    for (const reaction of ["like", "recast"]) {
      const rm = hub.makeMessage({ fid: USER_FID, body: { type: "ReactionAdd", reaction, target: { fid: OTHER_FID, hash: "0x" + "cd".repeat(20) } }, privateKey: USER_KEY });
      const rr = await api("POST", "/fc/hub/submit", rm.bytes, { "Content-Type": "application/octet-stream", ...from() });
      assert.equal(rr.status, 200, reaction + " " + JSON.stringify(rr.json));
      assert.equal(rr.json.type, 3);
    }
    assert.equal(stubs.protocol.state.reactions.size, 2);
    const del = hub.makeMessage({ fid: USER_FID, body: { type: "CastRemove", targetHash: m.hash }, privateKey: USER_KEY });
    assert.equal((await api("POST", "/fc/hub/submit", del.bytes, { "Content-Type": "application/octet-stream", ...from() })).status, 200);
    assert.equal(stubs.protocol.state.casts.get(m.hash).removed, true);
    // refusals, none forwarded
    const n1 = submits();
    const bad = Uint8Array.from(reply.bytes);
    bad[bad.length - 2] ^= 1;
    const t = await api("POST", "/fc/hub/submit", bad, { "Content-Type": "application/octet-stream", ...from() });
    assert.equal(t.status, 400);
    assert.match(t.json.error, /hash does not match/);
    const ud = hub.makeMessage({ fid: USER_FID, body: { type: "UserDataAdd", field: "bio", value: "x" }, privateKey: USER_KEY });
    const u = await api("POST", "/fc/hub/submit", ud.bytes, { "Content-Type": "application/octet-stream", ...from() });
    assert.equal(u.status, 400);
    assert.match(u.json.error, /casts, deletes, likes and recasts only/);
    const ct = await api("POST", "/fc/hub/submit", m.bytes, { "Content-Type": "text/plain", ...from() });
    assert.equal(ct.status, 415);
    const junk = await api("POST", "/fc/hub/submit", new Uint8Array([0xff, 0xff, 0xff]), { "Content-Type": "application/octet-stream", ...from() });
    assert.equal(junk.status, 400);
    const big = await api("POST", "/fc/hub/submit", new Uint8Array(kr.MAX_MESSAGE_BYTES + 1), { "Content-Type": "application/octet-stream", ...from() });
    assert.equal(big.status, 413);
    assert.equal(submits(), n1, "nothing refused here reached the node");
    // the NODE's refusal (a key it does not list) comes back as an error with the node's words — never a silent drop
    const stranger = hub.makeMessage({ fid: USER_FID, body: { type: "CastAdd", text: "not my key" }, privateKey: STRANGER_KEY });
    const sr = await api("POST", "/fc/hub/submit", stranger.bytes, { "Content-Type": "application/octet-stream", ...from() });
    assert.equal(sr.status, 502);
    assert.equal(sr.json.code, "hub_refused");
    assert.match(sr.json.error, /invalid signer/);
    stubs.protocol.failNext("hub", 503, 1);
    const down = await api("POST", "/fc/hub/submit", hub.makeMessage({ fid: USER_FID, body: { type: "CastAdd", text: "node down" }, privateKey: USER_KEY }).bytes, { "Content-Type": "application/octet-stream", ...from() });
    assert.equal(down.status, 502);
  });
});

test("the env contract: the app custody key is the validator's (accepted here, refused by the public app); the fid is public", () => {
  assert.ok(vc.APP_ACCOUNT_ACCEPTED.includes("FC_APP_CUSTODY_KEY") && vc.APP_ACCOUNT_ACCEPTED.includes("FC_APP_FID"));
  assert.ok(!vc.MUST_NOT_SHIP.includes("FC_APP_CUSTODY_KEY") && !vc.VALIDATOR_REFUSES.includes("FC_APP_CUSTODY_KEY"));
  assert.deepEqual(vc.contractViolations({ NODE_ENV: "production", LAYERS_REQUIRE_SIG: "true", FC_APP_FID: "1", FC_APP_CUSTODY_KEY: "0x" + "11".repeat(32) }), [], "a public validator boots with the app account");
  const ts = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "platform", "env-contract.ts"), "utf8");
  const appOnly = [...((ts.split("APP_ONLY_REFUSES: readonly string[] = [")[1] || "").split("];")[0].matchAll(/"([A-Z_]+)"/g))].map((m) => m[1]);
  assert.ok(appOnly.includes("FC_APP_CUSTODY_KEY") && !appOnly.includes("FC_APP_FID"), JSON.stringify(appOnly));
  assert.ok(!/MUST_NOT_SHIP/.test("APP_ACCOUNT_ACCEPTED"));
});

test("nothing logged carries the app key, a user key or a token", () => {
  const all = logs.join("\n").toLowerCase();
  const needles = [stubs.appKey.slice(2), USER_PUB.slice(2), USER_KEY, ...stubs.api.requests.map((r) => r.token.slice(2))].map((s) => s.toLowerCase());
  for (const n of needles) assert.ok(!all.includes(n), "a secret or token reached a log line");
  assert.ok(stubs.api.requests.length > 0 && needles.length > 3, "the needles are real (positive control)");
});
