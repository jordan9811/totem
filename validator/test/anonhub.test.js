"use strict";
// THE HUB ROUTE (Neynar-free @anon) — the public relay on ZK_ANON_TRANSPORT=hub, in-process (createApp(":memory:"), an
// ephemeral port), against scripts/lib/farcaster-protocol-stub.mjs: a loopback Snapchain node that decodes every message
// with its OWN protobuf decoder and checks the BLAKE3 hash, the Ed25519 signature and that the signer is ACTIVE for the fid.
// Nothing here leaves the machine and no Neynar address is ever asked. Covered: the hub account (arms with every piece,
// names each missing one, refuses a Neynar credential beside it, never carries the key); the relay (a pending live row
// leaves EXACTLY ONCE as a CastAdd the node accepts, recorded relayed with the node's hash under the fid; an unregistered
// key relays nothing; a refused submit leaves the row pending and is shown in public-status; a retry is the same message);
// the takedown as a CastRemove; the network reads (castsByFid / castById, hidden rows left out, an unread hub is an error).
process.env.ZK_DEV_HOOKS = "true";
process.env.ZK_ANON_POST_TREE = "valid";
for (const k of ["FC_ANON_FID", "FC_ANON_SIGNER_UUID", "FC_ANON_NEYNAR_KEY", "FC_ANON_SIGNER_KEY", "ZK_ANON_RELAY_LIVE", "ZK_ANON_POST_LIVE_CAP", "FC_ANON_NEYNAR_BASE_URL", "NEYNAR_API_KEY", "NEYNAR_SIGNER_UUID", "ENABLE_FC_WRITE", "ANON_MODERATORS", "ZK_ANON_FID_GATE", "APP_URL", "ANON_FID_RPC_URL", "FC_HUB_URL", "ZK_ANON_TRANSPORT", "LAYERS_HOSTED", "TRUST_PROXY"]) delete process.env[k];

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { generateKeyPairSync, sign: cryptoSign, createHash, randomBytes } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { createApp } = require("../server");
const ap = require("../anonpublic");
const hub = require("../hubmessage");
const vc = require("../env-contract");

const FID = 990321;
const KEY = createHash("sha256").update("anonhub.test signer").digest("hex");
const PUB = hub.signerPublicKey(KEY);
const OTHER_KEY = createHash("sha256").update("anonhub.test unregistered").digest("hex");
let server, base, db, stub;
before(async () => {
  const created = createApp(":memory:");
  db = created.db;
  await new Promise((r) => (server = created.app.listen(0, "127.0.0.1", r)));
  base = "http://127.0.0.1:" + server.address().port;
  const { startProtocolStub } = await import(pathToFileURL(path.join(__dirname, "..", "..", "scripts", "lib", "farcaster-protocol-stub.mjs")).href);
  stub = await startProtocolStub();
  stub.seedAccount(FID, "0x" + "ab".repeat(20), PUB);
});
after(async () => {
  server.close();
  await stub.close();
});
const api = async (method, p, body) => {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
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
const HUB_ENV = (x = {}) => ({ ZK_ANON_TRANSPORT: "hub", FC_ANON_FID: String(FID), FC_ANON_SIGNER_KEY: KEY, FC_HUB_URL: stub.hubUrl, ZK_ANON_RELAY_LIVE: "on", ZK_ANON_POST_LIVE_CAP: "5", ...x });
const neynarCalls = () => stub.calls.filter((c) => /neynar/i.test(c.path));
const submits = () => stub.calls.filter((c) => c.path === "/v1/submitMessage");
const insertPending = (castHash, text, extra = "") => db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status" + (extra ? ", hidden_at" : "") + ") VALUES ('live', ?, ?, 0, 0, '', ?, 'pending'" + (extra ? ", 3600000" : "") + ")").run(castHash, text, FID);
const keypair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
};
const MOD = keypair();
const signDecision = (mode, castHash, decision) => {
  const hour = Math.floor(Date.now() / 3_600_000);
  const nonce = randomBytes(16).toString("hex");
  return { mode, castHash, decision, issuedHour: hour, nonce, pubkey: MOD.pubHex, sig: cryptoSign(null, Buffer.from(ap.takedownCanonical(mode, castHash, decision, hour, nonce), "utf8"), MOD.privateKey).toString("hex") };
};

test("THE HUB ACCOUNT: arms with every piece (kind agent, transport hub), carries the PUBLIC key only, and names each missing piece; a Neynar credential beside it is two relay credentials", () => {
  const a = ap.relayAccount(HUB_ENV());
  assert.equal(a.kind, "agent");
  assert.equal(a.transport, "hub");
  assert.equal(a.armed, true, JSON.stringify(a.problems));
  assert.equal(ap.relayReady(a), true);
  assert.equal(a.signerPub, PUB);
  assert.ok(!JSON.stringify(a).includes(KEY), "the account object carries the private key");
  assert.equal(ap.liveWebDoorOpen(HUB_ENV()), true);
  const cases = [
    [{ FC_ANON_SIGNER_KEY: undefined }, /FC_ANON_SIGNER_KEY is unset/],
    [{ FC_ANON_SIGNER_KEY: "zz" + KEY.slice(2) }, /not a 64-hex Ed25519 private key/],
    [{ FC_HUB_URL: undefined }, /FC_HUB_URL is unset/],
    [{ FC_HUB_URL: "http://hub.example" }, /must be an https address/],
    [{ FC_HUB_URL: "https://snapchain-api.neynar.com" }, /Neynar address/],
    [{ FC_HUB_URL: stub.hubUrl, LAYERS_HOSTED: "true" }, /must be an https address/],
    [{ FC_ANON_NEYNAR_KEY: "anonstub-key-0000000001" }, /two relay credentials/],
    [{ NEYNAR_API_KEY: "FAKEWRITE-1111-2222-3333" }, /two relay credentials/],
    [{ NEYNAR_SIGNER_UUID: "5f1e2d3c-4b5a-4968-8776-65544332210f" }, /NEYNAR_SIGNER_UUID/],
    [{ ZK_ANON_RELAY_LIVE: undefined }, /ZK_ANON_RELAY_LIVE is unset/],
    [{ ZK_ANON_POST_LIVE_CAP: undefined }, /ZK_ANON_POST_LIVE_CAP is unset/],
    [{ FC_ANON_FID: "x" }, /FC_ANON_FID/],
  ];
  for (const [delta, re] of cases) {
    const env = HUB_ENV();
    for (const [k, v] of Object.entries(delta)) if (v === undefined) delete env[k]; else env[k] = v;
    const x = ap.relayAccount(env);
    assert.equal(x.armed, false, JSON.stringify(delta));
    assert.equal(ap.relayReady(x), false, JSON.stringify(delta));
    assert.ok(x.problems.some((p) => re.test(p)), JSON.stringify(delta) + " -> " + JSON.stringify(x.problems));
    assert.ok(!x.problems.join(" ").includes(KEY), "a problem line carries the key");
  }
  // the switch off: no posting, but a removal still reaches the network (ASM-4); no key: removals wait
  assert.equal(ap.deleteCredentialReady(ap.relayAccount(HUB_ENV({ ZK_ANON_RELAY_LIVE: undefined })), HUB_ENV({ ZK_ANON_RELAY_LIVE: undefined })), true);
  assert.equal(ap.deleteCredentialReady(ap.relayAccount(HUB_ENV({ FC_ANON_SIGNER_KEY: undefined })), HUB_ENV({ FC_ANON_SIGNER_KEY: undefined })), false);
  // the env contract: the public validator holds the hub key cleanly; the app refuses it (lib/platform/env-contract.ts)
  assert.deepEqual(vc.contractViolations({ NODE_ENV: "production", LAYERS_REQUIRE_SIG: "true", ...HUB_ENV() }), []);
  assert.ok(vc.RELAY_ACCEPTED.includes("FC_ANON_SIGNER_KEY") && !vc.MUST_NOT_SHIP.includes("FC_ANON_SIGNER_KEY"));
});

test("THE HUB RELAY: a pending live row leaves EXACTLY ONCE as a CastAdd the node accepts (hash, signature, active signer checked by the node), recorded relayed with the node's hash under the fid; a second slot sends nothing; a HIDDEN row never leaves; Neynar is never asked; public-status shows the hub and never the key", async () => {
  const h = createHash("sha256").update("hub-relay-row").digest("hex");
  const hidden = createHash("sha256").update("hub-relay-hidden").digest("hex");
  insertPending(h, "an anonymous post straight to the protocol");
  insertPending(hidden, "a removed pending post", "hidden");
  const n0 = submits().length;
  await withEnv(HUB_ENV(), async () => {
    await api("POST", "/zk/dev/relay-now");
    await api("POST", "/zk/dev/relay-now");
  });
  const sent = submits().slice(n0);
  assert.equal(sent.length, 1, JSON.stringify(sent));
  assert.equal(sent[0].status, 200, JSON.stringify(sent[0]));
  const row = db.prepare("SELECT status, network_hash, fid FROM zk_anon_casts WHERE cast_hash = ?").get(h);
  assert.equal(row.status, "relayed");
  assert.equal(row.network_hash, sent[0].submit, "the row's network hash is not the node's");
  assert.equal(row.fid, FID);
  const onNode = stub.state.casts.get(row.network_hash);
  assert.ok(onNode && onNode.fid === FID && onNode.text === "an anonymous post straight to the protocol", "the node does not hold the cast");
  assert.equal(db.prepare("SELECT status FROM zk_anon_casts WHERE cast_hash = ?").get(hidden).status, "pending", "a hidden row was relayed");
  assert.equal(neynarCalls().length, 0);
  const st = await withEnv(HUB_ENV(), () => api("GET", "/zk/anon/public-status?mode=live"));
  assert.equal(st.json.relay.transport, "hub");
  assert.equal(st.json.relay.ready, true);
  assert.equal(st.json.relay.hub, new URL(stub.hubUrl).host);
  assert.ok(!JSON.stringify(st.json).includes(KEY), "public-status carries the signer key");
  const cfg = await withEnv(HUB_ENV(), () => api("GET", "/zk/anon-post/config?mode=live"));
  assert.equal(cfg.json.liveRelay, true);
  assert.equal(cfg.json.relayKind, "agent");
  assert.ok(!JSON.stringify(cfg.json).includes(KEY));
});

test("FAIL CLOSED: an UNREGISTERED key relays nothing (the signer check refuses before any submit); a submit the node refuses keeps the row PENDING (bounded) and is shown in public-status (lastSubmitError) — never marked relayed, never dropped silently", async () => {
  const h = createHash("sha256").update("hub-relay-unregistered").digest("hex");
  insertPending(h, "a post signed by a key the node does not know");
  const n0 = submits().length;
  await withEnv(HUB_ENV({ FC_ANON_SIGNER_KEY: OTHER_KEY }), () => api("POST", "/zk/dev/relay-now"));
  assert.equal(submits().length, n0, "an unregistered key was submitted");
  assert.equal(db.prepare("SELECT status FROM zk_anon_casts WHERE cast_hash = ?").get(h).status, "pending");
  // the node refuses the submit itself (a 400 with its words): the row stays pending, the reason is shown
  stub.failNext("hub:/v1/submitMessage", 400, 1);
  await withEnv(HUB_ENV(), () => api("POST", "/zk/dev/relay-now"));
  assert.equal(db.prepare("SELECT status, network_hash FROM zk_anon_casts WHERE cast_hash = ?").get(h).status, "pending", "a refused submit was marked relayed");
  const st = await withEnv(HUB_ENV(), () => api("GET", "/zk/anon/public-status?mode=live"));
  assert.ok(st.json.relay.lastSubmitError && /stub was told to fail/.test(st.json.relay.lastSubmitError.words), JSON.stringify(st.json.relay));
  assert.equal(st.json.relay.lastSubmitError.hour % 3_600_000, 0, "the error's time is finer than the hour");
  // the next slot (the node fine again) relays it
  await withEnv(HUB_ENV(), () => api("POST", "/zk/dev/relay-now"));
  assert.equal(db.prepare("SELECT status FROM zk_anon_casts WHERE cast_hash = ?").get(h).status, "relayed");
});

test("A RETRY IS THE SAME MESSAGE: publishing the same idempotency key twice signs the same timestamp, so the node merges ONE cast and the second answer (duplicate) is the same hash; a different key is a different cast", async () => {
  const acct = ap.relayAccount(HUB_ENV());
  const t = ap.anonTransport(acct, HUB_ENV());
  const before = stub.state.casts.size;
  const a = await t.publish("the same post twice", "idem-retry-0001");
  const b = await t.publish("the same post twice", "idem-retry-0001");
  assert.equal(a.ok, true);
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(a.hash, b.hash);
  assert.equal(a.author, FID);
  assert.equal(stub.state.casts.size, before + 1, "a retry made a second cast");
  const c = await t.publish("the same post twice", "idem-retry-0002");
  assert.notEqual(c.hash, a.hash);
  // MUTATION: a 321-byte text is refused before signing (nothing submitted), and said so
  const n0 = submits().length;
  const long = await t.publish("x".repeat(321), "idem-long-00001");
  assert.equal(long.ok, false);
  assert.equal(submits().length, n0);
});

test("TAKEDOWN on the hub route: REMOVE hides at once and ONE pass sends ONE CastRemove the node accepts; the cast is gone from the node; recorded 'deleted'", async () => {
  const relayed = db.prepare("SELECT cast_hash, network_hash FROM zk_anon_casts WHERE mode = 'live' AND status = 'relayed' AND network_hash LIKE '0x%' AND hidden_at IS NULL").get();
  assert.ok(relayed);
  const n0 = submits().length;
  await withEnv(HUB_ENV({ ANON_MODERATORS: MOD.pubHex }), async () => {
    const rm = await api("POST", "/zk/anon/moderation", signDecision("live", relayed.cast_hash, "remove"));
    assert.equal(rm.status, 200, JSON.stringify(rm.json));
    assert.equal(rm.json.deleteState, "pending");
    const d = await api("POST", "/zk/anon/dev/delete-now");
    assert.equal(d.json.deleted, 1, JSON.stringify(d.json));
    await api("POST", "/zk/anon/dev/delete-now");
  });
  assert.equal(submits().slice(n0).length, 1, "not exactly one CastRemove");
  assert.equal(stub.state.casts.get(relayed.network_hash).removed, true, "the node still shows the cast");
  assert.equal(db.prepare("SELECT delete_state FROM zk_anon_takedowns WHERE cast_hash = ?").get(relayed.cast_hash).delete_state, "deleted");
});

test("THE NETWORK READS: @anon's casts as the node has them (castsByFid), each joined to the relay's castHash; a hidden row is left out; castById finds one and 404s an unknown or removed one; an unread node is a 503 (never an empty list); unconfigured is a 404", async () => {
  const net = await withEnv(HUB_ENV(), () => api("GET", "/zk/anon/network-casts"));
  assert.equal(net.status, 200, JSON.stringify(net.json));
  assert.equal(net.json.source, "hub");
  assert.equal(net.json.fid, FID);
  const ours = db.prepare("SELECT cast_hash, network_hash FROM zk_anon_casts WHERE mode = 'live' AND status = 'relayed' AND hidden_at IS NULL").all();
  for (const r of ours) assert.ok(net.json.casts.some((c) => c.hash === r.network_hash && c.castHash === r.cast_hash), "a relayed cast is missing from the network list: " + r.network_hash);
  const removed = db.prepare("SELECT network_hash FROM zk_anon_casts WHERE hidden_at IS NOT NULL AND network_hash LIKE '0x%'").get();
  assert.ok(!net.json.casts.some((c) => c.hash === removed.network_hash), "a removed cast is listed");
  // a cast still on the node whose row is hidden (its CastRemove not landed yet) is left out too
  const t = ap.anonTransport(ap.relayAccount(HUB_ENV()), HUB_ENV());
  const p = await t.publish("hidden before its remove landed", "idem-hidden-0001");
  const hh = createHash("sha256").update("hub-hidden-on-node").digest("hex");
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status, hidden_at) VALUES ('live', ?, 'x', 0, 0, ?, ?, 'relayed', 3600000)").run(hh, p.hash, FID);
  const net2 = await withEnv(HUB_ENV(), () => api("GET", "/zk/anon/network-casts"));
  assert.ok(!net2.json.casts.some((c) => c.hash === p.hash), "a hidden row's cast is listed while still on the node");
  const one = await withEnv(HUB_ENV(), () => api("GET", "/zk/anon/network-cast?hash=" + ours[0].network_hash));
  assert.equal(one.status, 200, JSON.stringify(one.json));
  assert.equal(one.json.cast.castHash, ours[0].cast_hash);
  assert.equal((await withEnv(HUB_ENV(), () => api("GET", "/zk/anon/network-cast?hash=0x" + "00".repeat(20)))).status, 404);
  assert.equal((await withEnv(HUB_ENV(), () => api("GET", "/zk/anon/network-cast?hash=" + removed.network_hash))).status, 404);
  assert.equal((await withEnv(HUB_ENV(), () => api("GET", "/zk/anon/network-cast?hash=" + p.hash))).status, 404, "a hidden row's cast is served");
  stub.failNext("hub:/v1/castsByFid", 503, 2);
  const down = await withEnv(HUB_ENV(), () => api("GET", "/zk/anon/network-casts"));
  assert.equal(down.status, 503, JSON.stringify(down.json));
  assert.ok(!Array.isArray(down.json.casts), "an unread node answered a list");
  const off = await withEnv({ FC_HUB_URL: undefined, FC_ANON_FID: undefined }, () => api("GET", "/zk/anon/network-casts"));
  assert.equal(off.status, 501, "unconfigured network reads are not a 501 (the share page tells it apart from a missing cast)");
  assert.equal(neynarCalls().length, 0);
});
