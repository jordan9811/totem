"use strict";
// PUBLIC GO-LIVE (the relay track) — THE PUBLIC @anon RELAY on the validator, in-process (createApp(":memory:"), an
// ephemeral port, never a pinned one; the Neynar and Optimism it talks to are scripts/lib/neynar-anon-stub.mjs on loopback,
// so nothing here leaves the machine). Covered:
//   the env contract both ways (the validator holds the one relay credential, refuses a second; the app refuses it);
//   the relay account on both paths (the owner path's fields are the old formula's, word for word; the agent path's
//   problems name each missing piece); the agent transport against the stub (the post leaves exactly once, under the
//   agent's signer and key, after its slot; a hidden row never leaves); the lifetime cap on the agent path (required,
//   counted inside the insert transaction — a real live proof when the pinned artifacts are cached); the text filter
//   (refused before the nullifier is consumed, logged as a rule id and an hour only); reports (fixed reasons, the per-address
//   limit, no reporter stored); the takedown queue (signed reads and decisions, KEEP dismisses, REMOVE hides and keeps the
//   row, the live delete once through the agent signer, bounded retries ending in "unknown"); hidden rows excluded from
//   every list and the one-cast read; the fid gate (a verified sign-in joins, one commitment per fid, a newer sign-in
//   replaces at the next epoch, a replayed message, a foreign domain, a stale time, an unbound nonce, a wrong address, a
//   contract signature and an unreadable chain are refused).
process.env.ZK_DEV_HOOKS = "true";
process.env.ZK_ANON_POST_TREE = "valid";
process.env.ZK_ANON_FLOOR = "1";
for (const k of ["FC_ANON_FID", "FC_ANON_SIGNER_UUID", "FC_ANON_NEYNAR_KEY", "ZK_ANON_RELAY_LIVE", "ZK_ANON_POST_LIVE_CAP", "FC_ANON_NEYNAR_BASE_URL", "NEYNAR_API_KEY", "NEYNAR_SIGNER_UUID", "ENABLE_FC_WRITE", "ANON_MODERATORS", "ZK_ANON_FID_GATE", "APP_URL", "ANON_FID_RPC_URL", "FC_HUB_URL", "ZK_ANON_TRANSPORT", "ANON_FILTER_SCAM_DOMAINS", "ZK_ANON_POST_SLOTS", "ZK_ANON_POST_DAILY_CAP", "LAYERS_HOSTED", "TRUST_PROXY"]) delete process.env[k];

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generateKeyPairSync, sign: cryptoSign, createHash, randomBytes } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { createApp } = require("../server");
const zk = require("../zk");
const ap = require("../anonpublic");
const vc = require("../env-contract");
const { Identity } = require("@semaphore-protocol/identity");
const { poseidon2 } = require("poseidon-lite");

let server;
let base;
let db;
let stub;
const STUB_KEY = "anonstub-validator-test-0001";
const AGENT_UUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d";
const AGENT_FID = 812345;
before(async () => {
  const created = createApp(":memory:");
  db = created.db;
  await new Promise((resolve) => {
    server = created.app.listen(0, "127.0.0.1", resolve);
  });
  base = "http://127.0.0.1:" + server.address().port;
  const { startNeynarAnonStub } = await import(pathToFileURL(path.join(__dirname, "..", "..", "scripts", "lib", "neynar-anon-stub.mjs")).href);
  stub = await startNeynarAnonStub({ key: STUB_KEY, signers: { [AGENT_UUID]: { fid: AGENT_FID } } });
});
after(async () => {
  server.close();
  await stub.close();
  const curve = globalThis.curve_bn128;
  if (curve && typeof curve.terminate === "function") await curve.terminate();
});

async function api(method, p, body, headers = {}) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
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
const AGENT_ENV = () => ({ FC_ANON_FID: String(AGENT_FID), FC_ANON_SIGNER_UUID: AGENT_UUID, FC_ANON_NEYNAR_KEY: STUB_KEY, ZK_ANON_RELAY_LIVE: "on", ZK_ANON_POST_LIVE_CAP: "5", FC_ANON_NEYNAR_BASE_URL: stub.baseUrl });
const signHex = (canonical, privateKey) => cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");
const keypair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
};
// DELIBERATE DUPLICATES (validator/zk.js, lib/zk/hash.ts, lib/zk/transport/types.ts)
const fieldOf = (domain, canonical) => (BigInt("0x" + createHash("sha256").update(`layers-zk-field/1|${domain}|${canonical}`).digest("hex")) >> 8n).toString(10);
const fixtureTag = (canonical, nullifier) => createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
const canonicalAnon = (p) => ["layers-zk-public/1", p.mode, p.claimKind, p.tree, String(p.epoch), p.merkleTreeRoot, p.scope, p.message, p.personaId, p.gateId, p.challenge, p.castHash, p.attributionCommitment, String(p.slot), p.noteHash].join("|");
const registerCanonical = (mode, c, rootId, issuedAt) => ["layers-zk-register/1", mode, c, rootId, String(issuedAt)].join("|");
const realNullifier = (scopeCanonical, identity) => poseidon2([BigInt(zk.semaphoreHash(fieldOf("scope", scopeCanonical))), identity.secretScalar]).toString(10);

const anchor = keypair();
const A = new Identity("anonpublic-person-a");
let EP = null;
let ROOT = null;
let seq = 0;
function anonEnvelope(who, slot, text) {
  const t = text ?? `anon public ${++seq} ${Date.now().toString(36)}`;
  const nonce = createHash("sha256").update("nonce|" + t + "|" + seq).digest("hex").slice(0, 32);
  const castHash = createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + t, "utf8").digest("hex");
  const attributionCommitment = createHash("sha256").update("layers-anon-attribution/1|" + createHash("sha256").update("secret|" + t).digest("hex"), "utf8").digest("hex");
  const scopeCanonical = `layers/zk-scope/v1|anon-post/w${EP}/s${slot}`;
  const note = randomBytes(256).toString("hex");
  const noteHash = createHash("sha256").update(Buffer.from(note, "hex")).digest("hex");
  const challenge = "epoch-" + EP;
  const pub = {
    mode: "fixture", claimKind: "anon-post", tree: "valid", epoch: EP, merkleTreeRoot: ROOT,
    scope: fieldOf("scope", scopeCanonical),
    message: fieldOf("message", ["anon", "anon-post", "cast:" + castHash, "attr:" + attributionCommitment, "note:" + noteHash, challenge, ROOT].join("|")),
    personaId: "anon", gateId: "anon-post", challenge, castHash, attributionCommitment, noteHash, slot,
  };
  const nullifier = realNullifier(scopeCanonical, who);
  return { v: 1, mode: "fixture", claimKind: "anon-post", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalAnon(pub), nullifier) }, payload: { text: t, nonce, note } };
}
const submit = (envelope) => api("POST", "/zk/submit", { envelope });
const hasNullifier = (n) => !!db.prepare("SELECT 1 FROM zk_nullifiers WHERE mode = 'fixture' AND nullifier = ?").get(n);

test("setup: one person registered, a leaf of the fixture `valid` tree after the batched epoch", async () => {
  await api("POST", "/device/auth-anchor", { pubkey: anchor.pubHex });
  const r = await api("POST", "/roots", { fid: 616161, signerUuid: "anonpublic-a" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const issuedAt = Date.now();
  const c = A.commitment.toString(10);
  const reg = await api("POST", "/zk/register", { mode: "fixture", commitment: c, rootId: r.json.rootId, issuedAt, signature: signHex(registerCanonical("fixture", c, r.json.rootId, issuedAt), anchor.privateKey), anchorPubKey: anchor.pubHex });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  const members = (await api("GET", "/zk/members?mode=fixture&tree=valid")).json;
  assert.ok(members.members.includes(c));
  EP = members.epoch;
  ROOT = members.root;
});

test("ENV CONTRACT: a public validator holding the agent's fid, signer, key and switch is clean, and still refuses NEYNAR_API_KEY / NEYNAR_SIGNER_UUID / ENABLE_FC_WRITE / NEYNAR_READ_API_KEY beside them; the app's TypeScript list refuses the signer and the key and its shared list stays the validator's", () => {
  const pub = { NODE_ENV: "production", LAYERS_REQUIRE_SIG: "true", FC_ANON_FID: "1", FC_ANON_SIGNER_UUID: AGENT_UUID, FC_ANON_NEYNAR_KEY: STUB_KEY, ZK_ANON_RELAY_LIVE: "on" };
  assert.deepEqual(vc.contractViolations(pub), [], "the relay credential refused the validator");
  for (const n of ["NEYNAR_API_KEY", "NEYNAR_SIGNER_UUID", "ENABLE_FC_WRITE", "NEYNAR_READ_API_KEY"]) assert.deepEqual(vc.contractViolations({ ...pub, [n]: n === "ENABLE_FC_WRITE" ? "true" : "x-1234567890abcdef" }), [n], n + " was not refused beside the relay credential");
  assert.deepEqual([...vc.RELAY_ACCEPTED].sort(), ["FC_ANON_FID", "FC_ANON_NEYNAR_KEY", "FC_ANON_SIGNER_KEY", "FC_ANON_SIGNER_UUID", "ZK_ANON_RELAY_LIVE"]);
  const ts = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "platform", "env-contract.ts"), "utf8");
  const appOnly = [...((ts.split("APP_ONLY_REFUSES: readonly string[] = [")[1] || "").split("];")[0].matchAll(/"([A-Z_]+)"/g))].map((m) => m[1]);
  // POST AS YOU: and the app account's custody key (validator/keyrequest.js), which lives on the validator too
  // SIGN IN WITH X: and a confidential X app's client secret (validator/xsignin.js), which lives on the validator too
  assert.deepEqual(appOnly.sort(), ["FC_ANON_NEYNAR_KEY", "FC_ANON_SIGNER_KEY", "FC_ANON_SIGNER_UUID", "FC_APP_CUSTODY_KEY", "X_CLIENT_SECRET"]);
  assert.ok(/for \(const name of APP_ONLY_REFUSES\)/.test(ts), "contractViolations does not read the app-only list");
  assert.ok(!/MUST_NOT_SHIP/.test("APP_ONLY_REFUSES") && !/MUST_NOT_SHIP/.test("RELAY_ACCEPTED"));
  for (const n of ["FC_ANON_FID", "FC_ANON_SIGNER_UUID", "FC_ANON_NEYNAR_KEY", "ZK_ANON_RELAY_LIVE"]) assert.ok(!vc.MUST_NOT_SHIP.includes(n) && !vc.VALIDATOR_REFUSES.includes(n));
});

test("RELAY ACCOUNT: the owner path's fields are the pre-go-live formula's, word for word; the agent path arms only with every piece and names each missing one", () => {
  const old = (env) => {
    const fid = Number(env.FC_ANON_FID ?? "");
    const signerUuid = env.FC_ANON_SIGNER_UUID ?? "";
    const apiKey = env.NEYNAR_API_KEY ?? "";
    const legacy = env.NEYNAR_SIGNER_UUID ?? "";
    return { fid: Number.isInteger(fid) && fid > 0 ? fid : 0, signerUuid, apiKey, armed: env.ENABLE_FC_WRITE === "true", foreignSigner: !!legacy && legacy !== signerUuid, keyFingerprint: apiKey ? createHash("sha256").update(apiKey).digest("hex").slice(0, 12) : null };
  };
  for (const env of [{}, { FC_ANON_FID: "7", FC_ANON_SIGNER_UUID: "u", NEYNAR_API_KEY: "k-123", ENABLE_FC_WRITE: "true" }, { FC_ANON_FID: "x", NEYNAR_SIGNER_UUID: "other", ENABLE_FC_WRITE: "TRUE" }]) {
    const a = ap.relayAccount(env);
    assert.equal(a.kind, "owner");
    const { kind, problems, ...fields } = a;
    assert.deepEqual(fields, old(env), JSON.stringify(env));
    assert.deepEqual(problems, []);
  }
  const full = { ...AGENT_ENV(), FC_ANON_NEYNAR_BASE_URL: "" };
  const ok = ap.relayAccount(full);
  assert.equal(ok.kind, "agent");
  assert.equal(ok.armed, true, JSON.stringify(ok.problems));
  assert.equal(ap.relayReady(ok), true);
  assert.equal(ok.keyFingerprint, createHash("sha256").update(STUB_KEY).digest("hex").slice(0, 12));
  const missing = [
    [{ ZK_ANON_RELAY_LIVE: undefined }, /ZK_ANON_RELAY_LIVE is unset/],
    [{ ZK_ANON_RELAY_LIVE: "true" }, /ZK_ANON_RELAY_LIVE is not on/],
    [{ ZK_ANON_POST_LIVE_CAP: undefined }, /ZK_ANON_POST_LIVE_CAP is unset/],
    [{ FC_ANON_FID: "abc" }, /FC_ANON_FID/],
    [{ FC_ANON_SIGNER_UUID: "not-a-uuid" }, /FC_ANON_SIGNER_UUID/],
    [{ FC_ANON_NEYNAR_KEY: "short" }, /not key-shaped/],
    [{ NEYNAR_API_KEY: "FAKEWRITE-1111-2222-3333" }, /two relay credentials/],
    [{ NEYNAR_SIGNER_UUID: "5f1e2d3c-4b5a-4968-8776-65544332210f" }, /NEYNAR_SIGNER_UUID/],
    // THE HUB ROUTE: the hub transport beside the agent's Neynar key is two relay credentials (and needs its own signer key)
    [{ ZK_ANON_TRANSPORT: "hub", FC_HUB_URL: "https://hub.example" }, /FC_ANON_NEYNAR_KEY is set beside FC_ANON_SIGNER_KEY/],
    [{ ZK_ANON_TRANSPORT: "hub", FC_HUB_URL: "https://hub.example" }, /FC_ANON_SIGNER_KEY is unset/],
    [{ FC_ANON_NEYNAR_BASE_URL: "http://127.0.0.1:9", LAYERS_HOSTED: "true" }, /hosting platform/],
    [{ FC_ANON_NEYNAR_BASE_URL: "https://api.example.com" }, /loopback/],
  ];
  for (const [delta, re] of missing) {
    const env = { ...full };
    for (const [k, v] of Object.entries(delta)) if (v === undefined) delete env[k]; else env[k] = v;
    const a = ap.relayAccount(env);
    assert.equal(a.armed, false, JSON.stringify(delta));
    assert.ok(a.problems.some((p) => re.test(p)), JSON.stringify(delta) + " → " + JSON.stringify(a.problems));
    assert.ok(!JSON.stringify(a.problems).includes(STUB_KEY) && !JSON.stringify(a.problems).includes(AGENT_UUID), "a problem carries a value");
  }
  assert.equal(ap.liveWebDoorOpen(full), true);
  assert.equal(ap.liveWebDoorOpen({}), false);
  assert.equal(ap.liveWebDoorOpen({ FC_ANON_FID: "7", FC_ANON_SIGNER_UUID: AGENT_UUID, NEYNAR_API_KEY: STUB_KEY, ENABLE_FC_WRITE: "true" }), false, "the owner path opened the browser's live door");
});

test("THE OWNER PATH'S REQUESTS ARE UNCHANGED: the signer lookup and the publish go to https://api.neynar.com exactly as before, whatever the agent override says (fetch is replaced in-process: no request leaves)", async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method || "GET", headers: init.headers, body: init.body });
    return new Response(JSON.stringify(String(url).includes("/signer") ? { status: "approved", fid: 7 } : { cast: { hash: "0x" + "ab".repeat(20), author: { fid: 7 } } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const acct = ap.relayAccount({ FC_ANON_FID: "7", FC_ANON_SIGNER_UUID: "owner-uuid", NEYNAR_API_KEY: "owner-key-1234567", ENABLE_FC_WRITE: "true", FC_ANON_NEYNAR_BASE_URL: "http://127.0.0.1:1" });
    const t = ap.anonTransport(acct, { FC_ANON_NEYNAR_BASE_URL: "http://127.0.0.1:1" });
    assert.equal((await t.signerStatus()).ok, true);
    const p = await t.publish("hello", "0123456789abcdef");
    assert.equal(p.ok, true);
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(seen[0].url, "https://api.neynar.com/v2/farcaster/signer?signer_uuid=owner-uuid");
  assert.deepEqual(seen[0].headers, { "x-api-key": "owner-key-1234567" });
  assert.equal(seen[1].url, "https://api.neynar.com/v2/farcaster/cast");
  assert.equal(seen[1].method, "POST");
  assert.equal(seen[1].body, JSON.stringify({ signer_uuid: "owner-uuid", text: "hello", idem: "0123456789abcdef" }));
});

test("THE TEXT FILTER: a verified anon post with a filtered word is refused 400 (code filter) BEFORE the nullifier is consumed, logged as its rule id and hour only; the same slot with clean words is then accepted", async () => {
  const bad = anonEnvelope(A, 0, "this is layersfiltercanary talk");
  const logBefore = db.prepare("SELECT COUNT(*) AS n FROM zk_anon_filter_log").get().n;
  const r = await submit(bad);
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(r.json.code, "filter");
  assert.equal(r.json.rule, "slur");
  assert.equal(hasNullifier(bad.nullifier), false, "the filter's refusal consumed the nullifier");
  const rows = db.prepare("SELECT * FROM zk_anon_filter_log").all();
  assert.equal(rows.length, logBefore + 1);
  const last = { ...rows[rows.length - 1] };
  assert.deepEqual(Object.keys(last).sort(), ["created_hour", "id", "mode", "rule"], "the filter log has a column beyond the rule and the hour");
  assert.equal(last.rule, "slur");
  assert.equal(last.created_hour % 3_600_000, 0, "not hour-grained");
  assert.ok(!JSON.stringify(rows).includes("layersfiltercanary"), "the refused text was logged");
  for (const t of ["call me at (555) 123-4567", "write to someone@example.com", "I live at 221 Baker Street", "go https://warpcast-airdrop.xyz now"]) {
    const e = anonEnvelope(A, 0, t);
    const x = await submit(e);
    assert.equal(x.status, 400, t + ": " + JSON.stringify(x.json));
    assert.equal(x.json.code, "filter");
  }
  // the operator's own scam list (validator only)
  const op = anonEnvelope(A, 0, "see https://bad.example.net/x");
  const y = await withEnv({ ANON_FILTER_SCAM_DOMAINS: "example.net" }, () => submit(op));
  assert.equal(y.json?.rule, "scam-url", JSON.stringify(y.json));
  const good = anonEnvelope(A, 0, "a plain anonymous thought");
  assert.equal(good.nullifier, bad.nullifier, "the same slot did not give the same nullifier");
  const ok = await submit(good);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

let reportedCast = null;
test("REPORTS: a fixed reason on a showing cast is taken (201) with no reporter stored; the same address again is 'already' (200, no row); a bad reason 400; an unknown cast 404; past the per-address budget 429", async () => {
  const e = anonEnvelope(A, 1, "a post someone will report");
  assert.equal((await submit(e)).status, 200);
  reportedCast = e.publicInputs.castHash;
  const cols = db.prepare("PRAGMA table_info(zk_anon_reports)").all().map((c) => c.name).sort();
  assert.deepEqual(cols, ["cast_hash", "created_hour", "id", "mode", "reason"], "a reports column could name the reporter");
  const r1 = await api("POST", "/zk/anon/report", { mode: "fixture", castHash: reportedCast, reason: "spam" });
  assert.equal(r1.status, 201, JSON.stringify(r1.json));
  const r2 = await api("POST", "/zk/anon/report", { mode: "fixture", castHash: reportedCast, reason: "hate" });
  assert.equal(r2.status, 200);
  assert.equal(r2.json.already, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM zk_anon_reports WHERE cast_hash = ?").get(reportedCast).n, 1);
  assert.equal((await api("POST", "/zk/anon/report", { mode: "fixture", castHash: reportedCast, reason: "because" })).status, 400);
  assert.equal((await api("POST", "/zk/anon/report", { mode: "fixture", castHash: "ab".repeat(32), reason: "spam" })).status, 404);
  // the per-address budget, on the pure function (a fresh address; the HTTP route keys on the socket address)
  const others = [];
  for (let s = 0; s < ap.REPORTS_PER_ADDRESS_PER_HOUR + 1; s++) {
    const x = anonEnvelope(new Identity("anonpublic-reportee-" + s), 0, "reportee " + s);
    db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('fixture', ?, ?, ?, 0, '0xanonrow', 0, 'relayed')").run(x.publicInputs.castHash, x.payload.text, EP);
    others.push(x.publicInputs.castHash);
  }
  let last = null;
  for (const h of others) last = ap.report(db, { mode: "fixture", castHash: h, reason: "spam" }, "budget-address");
  assert.equal(last.status, 429, JSON.stringify(last));
});

const MOD = keypair();
const signReview = (mode, pubkey = MOD.pubHex, priv = MOD.privateKey, hour = Math.floor(Date.now() / 3_600_000)) => ({ mode, issuedHour: hour, pubkey, sig: signHex(ap.reviewCanonical(mode, hour, pubkey), priv) });
const signDecision = (mode, castHash, decision, pubkey = MOD.pubHex, priv = MOD.privateKey, hour = Math.floor(Date.now() / 3_600_000)) => {
  const nonce = randomBytes(16).toString("hex");
  return { mode, castHash, decision, issuedHour: hour, nonce, pubkey, sig: signHex(ap.takedownCanonical(mode, castHash, decision, hour, nonce), priv) };
};
const q = (o) => "?" + Object.entries(o).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");

test("TAKEDOWN (fixture): a moderator's SIGNED read lists the reported cast; another key, a bad signature and a stale hour are refused; KEEP dismisses; a new report brings it back; REMOVE hides it from every list and the one-cast read and KEEPS the row; removed is final", async () => {
  await withEnv({ ANON_MODERATORS: MOD.pubHex }, async () => {
    const st = await api("GET", "/zk/anon/public-status?mode=fixture");
    assert.equal(st.json.moderated, true);
    assert.deepEqual(st.json.moderators, [MOD.pubHex]);
    const rv = await api("GET", "/zk/anon/moderation" + q(signReview("fixture")));
    assert.equal(rv.status, 200, JSON.stringify(rv.json));
    const item = rv.json.items.find((i) => i.castHash === reportedCast);
    assert.ok(item && item.reports === 1 && item.reasons.spam === 1 && item.text === "a post someone will report", JSON.stringify(rv.json.items));
    const other = keypair();
    assert.equal((await api("GET", "/zk/anon/moderation" + q(signReview("fixture", other.pubHex, other.privateKey)))).status, 403);
    const forged = signReview("fixture");
    forged.sig = forged.sig.slice(0, -2) + (forged.sig.endsWith("00") ? "11" : "00");
    assert.equal((await api("GET", "/zk/anon/moderation" + q(forged))).status, 403);
    assert.equal((await api("GET", "/zk/anon/moderation" + q(signReview("fixture", MOD.pubHex, MOD.privateKey, Math.floor(Date.now() / 3_600_000) - 3)))).status, 400);
    // a non-moderator's decision
    assert.equal((await api("POST", "/zk/anon/moderation", signDecision("fixture", reportedCast, "remove", other.pubHex, other.privateKey))).status, 403);
    // KEEP
    const keep = await api("POST", "/zk/anon/moderation", signDecision("fixture", reportedCast, "keep"));
    assert.equal(keep.status, 200, JSON.stringify(keep.json));
    const after = await api("GET", "/zk/anon/moderation" + q(signReview("fixture")));
    assert.ok(!after.json.items.some((i) => i.castHash === reportedCast), "KEEP did not dismiss the reports");
    // a report AFTER the keep brings it back (the keep is hour-grained: a report in a later hour is a new one)
    db.prepare("UPDATE zk_anon_takedowns SET decided_hour = decided_hour - 3600000 WHERE cast_hash = ?").run(reportedCast);
    assert.equal(ap.report(db, { mode: "fixture", castHash: reportedCast, reason: "doxxing" }, "another-address").status, 201);
    const back = await api("GET", "/zk/anon/moderation" + q(signReview("fixture")));
    assert.ok(back.json.items.some((i) => i.castHash === reportedCast && i.reasons.doxxing === 1), JSON.stringify(back.json.items));
    // REMOVE
    const rm = await api("POST", "/zk/anon/moderation", signDecision("fixture", reportedCast, "remove"));
    assert.equal(rm.status, 200, JSON.stringify(rm.json));
    assert.equal(rm.json.deleteState, "not-on-network");
    const listed = (await api("GET", "/zk/anon-casts?mode=fixture")).json.casts;
    assert.ok(!listed.some((c) => c.castHash === reportedCast), "a removed cast is still listed");
    assert.equal((await api("GET", "/zk/anon-cast?mode=fixture&hash=" + reportedCast)).status, 404);
    const row = db.prepare("SELECT hidden_at, text FROM zk_anon_casts WHERE cast_hash = ?").get(reportedCast);
    assert.ok(row && row.hidden_at > 0 && row.hidden_at % 3_600_000 === 0 && row.text === "a post someone will report", "the row was not KEPT hidden: " + JSON.stringify(row));
    assert.equal((await api("POST", "/zk/anon/moderation", signDecision("fixture", reportedCast, "keep"))).status, 409);
    assert.equal(ap.report(db, { mode: "fixture", castHash: reportedCast, reason: "spam" }, "third-address").status, 404, "a hidden cast took a report");
    const gone = await api("GET", "/zk/anon/moderation" + q(signReview("fixture")));
    assert.ok(gone.json.removed.some((r) => r.castHash === reportedCast && r.deleteState === "not-on-network"));
  });
  // no moderator configured: every decision refused
  assert.equal((await api("POST", "/zk/anon/moderation", signDecision("fixture", "cd".repeat(32), "remove"))).status, 403);
});

test("THE AGENT RELAY against the loopback Neynar: a pending live row leaves EXACTLY ONCE (POST /v2/farcaster/cast under the agent's signer uuid and key), is recorded relayed with the stub's hash under the agent fid; a second slot posts nothing; a HIDDEN pending row never leaves; unarmed (no switch) nothing leaves at all and the waiting row is DROPPED (ASM-3)", async () => {
  stub.reset();
  const castHash = createHash("sha256").update("agent-relay-row").digest("hex");
  const hiddenHash = createHash("sha256").update("agent-relay-hidden").digest("hex");
  const unarmedHash = createHash("sha256").update("agent-relay-unarmed").digest("hex");
  // UNARMED: nothing leaves, and the row that was waiting is dropped ('failed': ASM-3), never published later
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('live', ?, 'a post waiting while unarmed', 0, 0, '', ?, 'pending')").run(unarmedHash, AGENT_FID);
  await withEnv({ ...AGENT_ENV(), ZK_ANON_RELAY_LIVE: undefined }, async () => {
    await api("POST", "/zk/dev/relay-now");
  });
  assert.equal(stub.calls().filter((c) => c.kind === "neynar").length, 0, "an unarmed relay asked Neynar: " + JSON.stringify(stub.calls()));
  assert.equal(db.prepare("SELECT status FROM zk_anon_casts WHERE cast_hash = ?").get(unarmedHash).status, "failed", "an unarmed public relay kept the waiting row (it would publish on the next arm)");
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('live', ?, 'an anonymous post for Farcaster', 0, 0, '', ?, 'pending')").run(castHash, AGENT_FID);
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status, hidden_at) VALUES ('live', ?, 'a removed pending post', 0, 0, '', ?, 'pending', 3600000)").run(hiddenHash, AGENT_FID);
  await withEnv(AGENT_ENV(), async () => {
    await api("POST", "/zk/dev/relay-now");
    await api("POST", "/zk/dev/relay-now");
  });
  const pubs = stub.calls().filter((c) => c.op === "publish");
  assert.equal(pubs.length, 1, "publishes: " + JSON.stringify(pubs));
  assert.equal(pubs[0].keyOk, true);
  assert.equal(pubs[0].signerKnown, true);
  assert.equal(pubs[0].text, "an anonymous post for Farcaster");
  assert.equal(pubs[0].idem, castHash.slice(0, 16));
  const row = db.prepare("SELECT status, network_hash, fid FROM zk_anon_casts WHERE cast_hash = ?").get(castHash);
  assert.equal(row.status, "relayed");
  assert.equal(row.network_hash, pubs[0].hash);
  assert.equal(row.fid, AGENT_FID);
  assert.equal(db.prepare("SELECT status FROM zk_anon_casts WHERE cast_hash = ?").get(hiddenHash).status, "pending", "a hidden row was relayed");
  const listed = (await api("GET", "/zk/anon-casts?mode=live")).json.casts;
  assert.ok(listed.some((c) => c.castHash === castHash) && !listed.some((c) => c.castHash === hiddenHash));
  const one = await api("GET", "/zk/anon-cast?mode=live&hash=" + castHash);
  assert.equal(one.status, 200);
  assert.equal(one.json.cast.castUrl, "https://farcaster.xyz/~/conversations/" + pubs[0].hash);
});

test("TAKEDOWN (live) through the agent signer: REMOVE hides at once and queues the delete; one pass sends EXACTLY ONE DELETE under the agent's key for the network hash and records 'deleted'; a delete Farcaster keeps refusing is retried at most DELETE_MAX_ATTEMPTS times and ends 'unknown' — never retried forever", async () => {
  const relayed = db.prepare("SELECT cast_hash, network_hash FROM zk_anon_casts WHERE mode = 'live' AND status = 'relayed'").get();
  assert.ok(relayed, "no relayed live row from the previous test");
  stub.reset();
  // the stub forgot its casts on reset: publish one again so the DELETE has a cast to find
  const acct = ap.relayAccount(AGENT_ENV());
  const p = await ap.anonTransport(acct, AGENT_ENV()).publish("re-made for the delete", "redo000000000001");
  db.prepare("UPDATE zk_anon_casts SET network_hash = ? WHERE cast_hash = ?").run(p.hash, relayed.cast_hash);
  const from = stub.calls().length;
  await withEnv({ ...AGENT_ENV(), ANON_MODERATORS: MOD.pubHex }, async () => {
    const rm = await api("POST", "/zk/anon/moderation", signDecision("live", relayed.cast_hash, "remove"));
    assert.equal(rm.status, 200, JSON.stringify(rm.json));
    assert.equal(rm.json.deleteState, "pending");
    assert.equal((await api("GET", "/zk/anon-cast?mode=live&hash=" + relayed.cast_hash)).status, 404, "not hidden at once");
    const d1 = await api("POST", "/zk/anon/dev/delete-now");
    assert.equal(d1.json.deleted, 1, JSON.stringify(d1.json));
    await api("POST", "/zk/anon/dev/delete-now");
  });
  const dels = stub.calls().slice(from).filter((c) => c.op === "delete");
  assert.equal(dels.length, 1, "deletes: " + JSON.stringify(dels));
  assert.equal(dels[0].keyOk, true);
  assert.equal(dels[0].signerKnown, true);
  assert.equal(dels[0].target, p.hash);
  assert.equal(db.prepare("SELECT delete_state FROM zk_anon_takedowns WHERE cast_hash = ?").get(relayed.cast_hash).delete_state, "deleted");
  // the bounded retry
  const h2 = createHash("sha256").update("agent-delete-flaky").digest("hex");
  const p2 = await ap.anonTransport(acct, AGENT_ENV()).publish("a flaky delete", "flaky00000000001");
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('live', ?, 'a flaky delete', 0, 0, ?, ?, 'relayed')").run(h2, p2.hash, AGENT_FID);
  const from2 = stub.calls().length;
  stub.failNext("delete", 500, 100);
  await withEnv({ ...AGENT_ENV(), ANON_MODERATORS: MOD.pubHex }, async () => {
    assert.equal((await api("POST", "/zk/anon/moderation", signDecision("live", h2, "remove"))).status, 200);
    for (let i = 0; i < ap.DELETE_MAX_ATTEMPTS + 3; i++) await api("POST", "/zk/anon/dev/delete-now");
  });
  const t = db.prepare("SELECT delete_state, attempts FROM zk_anon_takedowns WHERE cast_hash = ?").get(h2);
  assert.equal(t.delete_state, "unknown");
  assert.equal(t.attempts, ap.DELETE_MAX_ATTEMPTS);
  assert.equal(stub.calls().slice(from2).filter((c) => c.op === "delete").length, ap.DELETE_MAX_ATTEMPTS, "the delete was retried past its bound");
  stub.reset();
});

test("TAKEDOWN with the relay SWITCHED OFF (ASM-4): the kill switch stops new posts, never a removal — a REMOVE with ZK_ANON_RELAY_LIVE gone (the key still on the validator) hides the post at once and ONE pass deletes it once under the agent key, while the browser's live door is shut and the relay publishes nothing", async () => {
  const acct = ap.relayAccount(AGENT_ENV());
  const p = await ap.anonTransport(acct, AGENT_ENV()).publish("removed while switched off", "wait000000000001");
  const h = createHash("sha256").update("agent-delete-while-switched-off").digest("hex");
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('live', ?, 'removed while switched off', 0, 0, ?, ?, 'relayed')").run(h, p.hash, AGENT_FID);
  const pendingHash = createHash("sha256").update("pending-while-switched-off").digest("hex");
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('live', ?, 'waiting while switched off', 0, 0, '', ?, 'pending')").run(pendingHash, AGENT_FID);
  const from = stub.calls().length;
  // the kill switch as arm-public-anon.ps1 -Disarm leaves it: ZK_ANON_RELAY_LIVE removed, the key and the signer kept
  const OFF = { ...AGENT_ENV(), ZK_ANON_RELAY_LIVE: undefined, ANON_MODERATORS: MOD.pubHex };
  await withEnv(OFF, async () => {
    assert.equal(ap.liveWebDoorOpen(), false, "the browser's live door is open with the switch off");
    assert.equal(ap.relayReady(ap.relayAccount()), false);
    assert.equal(ap.deleteCredentialReady(ap.relayAccount()), true, "the credential alone does not let a delete through");
    assert.equal((await api("POST", "/zk/anon/moderation", signDecision("live", h, "remove"))).status, 200);
    assert.equal((await api("GET", "/zk/anon-cast?mode=live&hash=" + h)).status, 404, "not hidden at once while switched off");
    const d = await api("POST", "/zk/anon/dev/delete-now");
    assert.equal(d.json.deleted, 1, "the switch off stopped the delete: " + JSON.stringify(d.json));
    await api("POST", "/zk/anon/dev/delete-now");
    await api("POST", "/zk/dev/relay-now");
    const st = (await api("GET", "/zk/anon/public-status?mode=live")).json;
    assert.equal(st.relay.ready, false);
    assert.equal(st.relay.deletesReady, true, "public-status does not say removals still reach Farcaster");
  });
  const t = db.prepare("SELECT delete_state, attempts FROM zk_anon_takedowns WHERE cast_hash = ?").get(h);
  assert.equal(t.delete_state, "deleted");
  const calls = stub.calls().slice(from);
  const dels = calls.filter((c) => c.op === "delete");
  assert.equal(dels.length, 1, "not exactly one DELETE with the switch off");
  assert.equal(dels[0].target, p.hash);
  assert.equal(dels[0].keyOk, true);
  assert.equal(calls.filter((c) => c.op === "publish").length, 0, "the switched-off relay published");
  assert.equal(db.prepare("SELECT status FROM zk_anon_casts WHERE cast_hash = ?").get(pendingHash).status, "failed", "the switch off alone did not drop the waiting post (ASM-3)");
});

test("TAKEDOWN with the key REVOKED (arm-public-anon.ps1 -Disarm -RevokeKey): a REMOVE hides the post at once, sends NOTHING and counts no attempt ('waiting', however many passes); with the key back, ONE pass deletes it once under the agent key", async () => {
  const acct = ap.relayAccount(AGENT_ENV());
  const p = await ap.anonTransport(acct, AGENT_ENV()).publish("removed while revoked", "wait000000000002");
  const h = createHash("sha256").update("agent-delete-while-revoked").digest("hex");
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('live', ?, 'removed while revoked', 0, 0, ?, ?, 'relayed')").run(h, p.hash, AGENT_FID);
  const from = stub.calls().length;
  await withEnv({ ...AGENT_ENV(), ZK_ANON_RELAY_LIVE: undefined, FC_ANON_NEYNAR_KEY: undefined, FC_ANON_SIGNER_UUID: undefined, ANON_MODERATORS: MOD.pubHex }, async () => {
    assert.equal(ap.deleteCredentialReady(ap.relayAccount()), false);
    assert.equal((await api("POST", "/zk/anon/moderation", signDecision("live", h, "remove"))).status, 200);
    assert.equal((await api("GET", "/zk/anon-cast?mode=live&hash=" + h)).status, 404, "not hidden at once while revoked");
    for (let i = 0; i < ap.DELETE_MAX_ATTEMPTS + 3; i++) {
      const d = await api("POST", "/zk/anon/dev/delete-now");
      assert.equal(d.json.deleted, 0);
    }
  });
  let t = db.prepare("SELECT delete_state, attempts FROM zk_anon_takedowns WHERE cast_hash = ?").get(h);
  assert.equal(t.delete_state, "waiting", "a delete with no key is not 'waiting'");
  assert.equal(t.attempts, 0, "a keyless pass counted an attempt (a revoked key would burn the bound into a false 'unknown')");
  assert.equal(stub.calls().slice(from).filter((c) => c.op === "delete").length, 0, "a DELETE left a validator with no key");
  // the key back (the switch still off: a delete needs the key only)
  await withEnv({ ...AGENT_ENV(), ZK_ANON_RELAY_LIVE: undefined, ANON_MODERATORS: MOD.pubHex }, async () => {
    const d = await api("POST", "/zk/anon/dev/delete-now");
    assert.equal(d.json.deleted, 1, JSON.stringify(d.json));
    await api("POST", "/zk/anon/dev/delete-now");
  });
  t = db.prepare("SELECT delete_state, attempts FROM zk_anon_takedowns WHERE cast_hash = ?").get(h);
  assert.equal(t.delete_state, "deleted");
  const dels = stub.calls().slice(from).filter((c) => c.op === "delete");
  assert.equal(dels.length, 1, "with the key back: not exactly one DELETE");
  assert.equal(dels[0].target, p.hash);
  assert.equal(dels[0].keyOk, true);
});

test("DISARM DROPS THE QUEUE (ASM-3): a pending live post, then the switch off — the next slot marks it 'failed' (never relayed, never counted); armed again, relay-now publishes NOTHING; a validator that BOOTS disarmed drops the queue at once; the owner service's path keeps its pending rows (dropPendingOnDisarm)", async () => {
  stub.reset();
  const h = createHash("sha256").update("asm3-pending").digest("hex");
  db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('live', ?, 'queued before the disarm', 0, 0, '', ?, 'pending')").run(h, AGENT_FID);
  await withEnv({ ...AGENT_ENV(), ZK_ANON_RELAY_LIVE: undefined }, () => api("POST", "/zk/dev/relay-now"));
  assert.equal(db.prepare("SELECT status FROM zk_anon_casts WHERE cast_hash = ?").get(h).status, "failed", "the disarmed relay kept the queued post");
  await withEnv(AGENT_ENV(), async () => {
    await api("POST", "/zk/dev/relay-now");
    await api("POST", "/zk/dev/relay-now");
  });
  assert.equal(stub.calls().filter((c) => c.op === "publish").length, 0, "re-arming published the backlog: " + JSON.stringify(stub.calls()));
  // a validator that BOOTS disarmed (the disarm is a redeploy) drops the queue before any re-armed process starts
  const file = path.join(require("node:os").tmpdir(), "layers-asm3-" + process.pid + "-" + Date.now() + ".db");
  const { openDb } = require("../db");
  const d0 = openDb(file);
  const h2 = createHash("sha256").update("asm3-boot").digest("hex");
  d0.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) VALUES ('live', ?, 'queued before a disarmed boot', 0, 0, '', ?, 'pending')").run(h2, AGENT_FID);
  d0.close();
  try {
    await withEnv({ ...AGENT_ENV(), ZK_ANON_RELAY_LIVE: undefined }, async () => {
      const booted = createApp(file);
      try {
        assert.equal(booted.db.prepare("SELECT status FROM zk_anon_casts WHERE cast_hash = ?").get(h2).status, "failed", "a validator booted disarmed kept the queue");
      } finally {
        booted.db.close();
      }
    });
  } finally {
    for (const ext of ["", "-wal", "-shm"]) fs.rmSync(file + ext, { force: true });
  }
  // the pure rule: the public shape and the agent path drop; the owner service (kind owner, not public) keeps its rows
  const ownerOff = ap.relayAccount({ FC_ANON_FID: "7", FC_ANON_SIGNER_UUID: "u", NEYNAR_API_KEY: "owner-key-123456" });
  assert.equal(ap.dropPendingOnDisarm(ownerOff, { ZK_DEV_HOOKS: "true" }), false, "the owner service's pending rows were dropped");
  assert.equal(ap.dropPendingOnDisarm(ownerOff, { NODE_ENV: "production" }), true, "a public validator with no relay kept its queue");
  assert.equal(ap.dropPendingOnDisarm(ap.relayAccount({ ...AGENT_ENV(), ZK_ANON_RELAY_LIVE: undefined }), { ZK_DEV_HOOKS: "true" }), true);
  assert.equal(ap.dropPendingOnDisarm(ap.relayAccount(AGENT_ENV()), { NODE_ENV: "production" }), false, "an ARMED relay dropped its queue");
});

// ------------------------------------------------------------------------------------------------ the fid gate
let viem = null;
let accounts = null;
async function siweFor({ account, fid, commitment, salt, domain = "layers.example", origin = "https://layers.example", issuedAt = new Date(), nonce }) {
  const { createSiweMessage } = await import("viem/siwe");
  const message = createSiweMessage({ domain, address: account.address, statement: "Farcaster Auth", uri: origin + "/device", version: "1", chainId: 10, nonce: nonce ?? ap.joinNonceFor(commitment, salt), issuedAt, expirationTime: new Date(issuedAt.getTime() + 10 * 60_000), resources: ["farcaster://fid/" + fid] });
  return { message, signature: await account.signMessage({ message }) };
}
const GATE_ENV = () => ({ ZK_ANON_FID_GATE: "on", APP_URL: "https://layers.example", ANON_FID_RPC_URL: stub.rpcUrl });

test("THE FID GATE: a verified sign-in joins one commitment per fid (a leaf of the LIVE `valid` tree from the NEXT epoch); a newer sign-in REPLACES it at the next epoch; a replayed message, another fid's commitment, a foreign domain, a stale time, an unbound nonce, a non-custody signer, a contract signature and an unreadable chain are each refused; with the gate off the join is 404 and the live tree is the registrations'", async () => {
  viem = await import("viem/accounts");
  accounts = [viem.privateKeyToAccount("0x" + "11".repeat(32)), viem.privateKeyToAccount("0x" + "22".repeat(32)), viem.privateKeyToAccount("0x" + "33".repeat(32))];
  ap.__resetForTests();
  const custody = { [accounts[0].address.toLowerCase()]: 9001, [accounts[1].address.toLowerCase()]: 9002 };
  const { startNeynarAnonStub } = await import(pathToFileURL(path.join(__dirname, "..", "..", "scripts", "lib", "neynar-anon-stub.mjs")).href);
  const chain = await startNeynarAnonStub({ key: STUB_KEY, custody, authKeys: { ["9003:" + accounts[2].address.toLowerCase()]: { state: 1, keyType: 2 } } });
  try {
    const env = { ...GATE_ENV(), ANON_FID_RPC_URL: chain.rpcUrl };
    const c1 = new Identity("fid-join-1").commitment.toString(10);
    const c2 = new Identity("fid-join-2").commitment.toString(10);
    const salt = () => randomBytes(16).toString("hex");
    // off: 404
    const s0 = salt();
    const off = await ap.fidJoin(db, { mode: "live", fid: 9001, commitment: c1, salt: s0, authMethod: "custody", ...(await siweFor({ account: accounts[0], fid: 9001, commitment: c1, salt: s0 })) }, { APP_URL: "https://layers.example" });
    assert.equal(off.status, 404);
    // a valid custody join
    const s1 = salt();
    const signed1 = await siweFor({ account: accounts[0], fid: 9001, commitment: c1, salt: s1 });
    const j1 = await ap.fidJoin(db, { mode: "live", fid: 9001, commitment: c1, salt: s1, authMethod: "custody", ...signed1 }, env);
    assert.equal(j1.status, 201, JSON.stringify(j1.json));
    const ep = zk.epochInfo(db, "live").epoch;
    assert.equal(j1.json.activeFromEpoch, ep + 1);
    assert.equal(chain.calls().filter((c) => c.call === "idOf").length, 1, "the custody address was not read from the chain");
    // replay of the same signed message
    const rep = await ap.fidJoin(db, { mode: "live", fid: 9001, commitment: c1, salt: s1, authMethod: "custody", ...signed1 }, env);
    assert.equal(rep.status, 409);
    assert.equal(rep.json.code, "fid-join-replay");
    // the tree: not this epoch, then the next one
    assert.equal(ap.fidGateMembers(db, "live", ep, env).includes(c1), false, "joined into the CURRENT epoch");
    assert.deepEqual(ap.fidGateMembers(db, "live", ep + 1, env), [c1]);
    // another fid with the SAME commitment: taken
    const sT = salt();
    const taken = await ap.fidJoin(db, { mode: "live", fid: 9002, commitment: c1, salt: sT, authMethod: "custody", ...(await siweFor({ account: accounts[1], fid: 9002, commitment: c1, salt: sT })) }, env);
    assert.equal(taken.status, 409);
    assert.equal(taken.json.code, "fid-join-taken");
    // a newer sign-in by fid 9001 with a NEW commitment replaces at the next epoch (a lost passkey is not a lockout)
    db.prepare("UPDATE zk_anon_fid_members SET joined_epoch = joined_epoch - 2 WHERE fid = 9001").run();
    const s2 = salt();
    const j2 = await ap.fidJoin(db, { mode: "live", fid: 9001, commitment: c2, salt: s2, authMethod: "custody", ...(await siweFor({ account: accounts[0], fid: 9001, commitment: c2, salt: s2 })) }, env);
    assert.equal(j2.status, 201, JSON.stringify(j2.json));
    assert.equal(j2.json.replaced, true);
    assert.deepEqual(ap.fidGateMembers(db, "live", ep, env), [], "the replaced commitment still sits in the epoch the new one joined");
    assert.deepEqual(ap.fidGateMembers(db, "live", ep + 1, env), [c2]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM zk_anon_fid_members WHERE fid = 9001").get().n, 1, "more than one commitment for one fid");
    // an auth address (KeyRegistry keyType 2, state 1)
    const c3 = new Identity("fid-join-3").commitment.toString(10);
    const s3 = salt();
    const j3 = await ap.fidJoin(db, { mode: "live", fid: 9003, commitment: c3, salt: s3, authMethod: "authAddress", ...(await siweFor({ account: accounts[2], fid: 9003, commitment: c3, salt: s3 })) }, env);
    assert.equal(j3.status, 201, JSON.stringify(j3.json));
    assert.equal(chain.calls().filter((c) => c.call === "keyDataOf").length, 1);
    // the refusals
    const c4 = new Identity("fid-join-4").commitment.toString(10);
    const refused = async (label, body, want, statusWant) => {
      const r = await ap.fidJoin(db, body, env);
      assert.equal(r.json.code, "fid-join-" + want, label + ": " + JSON.stringify(r.json));
      if (statusWant) assert.equal(r.status, statusWant, label);
      assert.equal(db.prepare("SELECT 1 FROM zk_anon_fid_members WHERE commitment = ?").get(c4), undefined, label + " joined");
      assert.ok(!JSON.stringify(r.json).includes(accounts[1].address.toLowerCase()), label + ": the refusal carries a value");
    };
    const s4 = salt();
    await refused("a foreign domain", { mode: "live", fid: 9002, commitment: c4, salt: s4, authMethod: "custody", ...(await siweFor({ account: accounts[1], fid: 9002, commitment: c4, salt: s4, domain: "evil.example", origin: "https://evil.example" })) }, "message", 400);
    await refused("a stale sign-in", { mode: "live", fid: 9002, commitment: c4, salt: s4, authMethod: "custody", ...(await siweFor({ account: accounts[1], fid: 9002, commitment: c4, salt: s4, issuedAt: new Date(Date.now() - 30 * 60_000) })) }, "stale", 400);
    await refused("an unbound nonce", { mode: "live", fid: 9002, commitment: c4, salt: s4, authMethod: "custody", ...(await siweFor({ account: accounts[1], fid: 9002, commitment: c4, salt: s4, nonce: "RandomNonce12345" })) }, "message", 400);
    await refused("a nonce bound to ANOTHER commitment", { mode: "live", fid: 9002, commitment: c4, salt: s4, authMethod: "custody", ...(await siweFor({ account: accounts[1], fid: 9002, commitment: c1, salt: s4 })) }, "message", 400);
    await refused("a signer that is not the fid's custody", { mode: "live", fid: 9002, commitment: c4, salt: s4, authMethod: "custody", ...(await siweFor({ account: accounts[2], fid: 9002, commitment: c4, salt: s4 })) }, "account", 403);
    const sig = await siweFor({ account: accounts[1], fid: 9002, commitment: c4, salt: s4 });
    await refused("a contract-wallet signature", { mode: "live", fid: 9002, commitment: c4, salt: s4, authMethod: "custody", message: sig.message, signature: sig.signature + "00".repeat(40) }, "contract", 400);
    await refused("a signature over other words", { mode: "live", fid: 9002, commitment: c4, salt: s4, authMethod: "custody", message: sig.message, signature: (await siweFor({ account: accounts[1], fid: 9002, commitment: c4, salt: salt() })).signature }, "signature", 400);
    chain.failNext("rpc", 500, 1);
    const s5 = salt();
    await refused("an unreadable chain", { mode: "live", fid: 9002, commitment: c4, salt: s5, authMethod: "custody", ...(await siweFor({ account: accounts[1], fid: 9002, commitment: c4, salt: s5 })) }, "chain", 503);
    const s6 = salt();
    const noSite = await ap.fidJoin(db, { mode: "live", fid: 9002, commitment: c4, salt: s6, authMethod: "custody", ...(await siweFor({ account: accounts[1], fid: 9002, commitment: c4, salt: s6 })) }, { ...env, APP_URL: "" });
    assert.equal(noSite.status, 503);
    assert.equal(noSite.json.code, "fid-join-site");
    // CONTROL: the same person, every check passing, does join (so each refusal above was its own check's)
    const s7 = salt();
    const ok4 = await ap.fidJoin(db, { mode: "live", fid: 9002, commitment: c4, salt: s7, authMethod: "custody", ...(await siweFor({ account: accounts[1], fid: 9002, commitment: c4, salt: s7 })) }, env);
    assert.equal(ok4.status, 201, JSON.stringify(ok4.json));
  } finally {
    await chain.close();
  }
  // the gate wired into the tree build: on → the live `valid` tree is the fid members'; off → the registrations' as before
  await withEnv(GATE_ENV(), async () => {
    await api("POST", "/zk/dev/advance-epoch", { mode: "live" });
    const members = (await api("GET", "/zk/members?mode=live&tree=valid")).json.members;
    assert.ok(members.includes(new Identity("fid-join-2").commitment.toString(10)) && members.includes(new Identity("fid-join-3").commitment.toString(10)), JSON.stringify(members));
    assert.ok(!members.includes(new Identity("fid-join-1").commitment.toString(10)), "the replaced commitment is still a leaf");
    const cfg = (await api("GET", "/zk/anon-post/config?mode=live")).json;
    assert.equal(cfg.fidGate, true);
  });
  await api("POST", "/zk/dev/advance-epoch", { mode: "live" });
  const plain = (await api("GET", "/zk/members?mode=live&tree=valid")).json.members;
  assert.ok(!plain.includes(new Identity("fid-join-2").commitment.toString(10)), "the gate's members leaked into an ungated build");
});

test("THE LIFETIME CAP on the agent path is REQUIRED and counted inside the insert transaction: with cap 1 the first live post is accepted (pending), the second refused 503 with nothing consumed (a real live proof; skipped without cached artifacts)", async (t) => {
  const dir = path.join(__dirname, "..", "..", ".zk-artifacts");
  const wasm = path.join(dir, "semaphore-20.wasm");
  const zkey = path.join(dir, "semaphore-20.zkey");
  if (!fs.existsSync(wasm) || !fs.existsSync(zkey)) return t.skip("no cached artifacts (run npm run bench:zk once)");
  const { generateProof } = require("@semaphore-protocol/proof");
  const { Group } = require("@semaphore-protocol/group");
  const L = new Identity("anonpublic-live-person");
  const rootId = (await api("POST", "/roots", { fid: 717171, signerUuid: "anonpublic-live" })).json.rootId;
  const issuedAt = Date.now();
  const c = L.commitment.toString(10);
  assert.equal((await api("POST", "/zk/register", { mode: "live", commitment: c, rootId, issuedAt, signature: signHex(registerCanonical("live", c, rootId, issuedAt), anchor.privateKey), anchorPubKey: anchor.pubHex })).status, 201);
  await api("POST", "/zk/dev/advance-epoch", { mode: "live" });
  const members = (await api("GET", "/zk/members?mode=live&tree=valid")).json;
  assert.ok(members.members.includes(c));
  const group = new Group(members.members.map((m) => BigInt(m)));
  const liveEnvelope = async (slot, text) => {
    const nonce = randomBytes(16).toString("hex");
    const castHash = createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + text, "utf8").digest("hex");
    const attributionCommitment = createHash("sha256").update("layers-anon-attribution/1|" + randomBytes(32).toString("hex"), "utf8").digest("hex");
    const note = randomBytes(256).toString("hex");
    const noteHash = createHash("sha256").update(Buffer.from(note, "hex")).digest("hex");
    const pub = { mode: "live", claimKind: "anon-post", tree: "valid", epoch: members.epoch, merkleTreeRoot: members.root, personaId: "anon", gateId: "anon-post", challenge: "epoch-" + members.epoch, castHash, attributionCommitment, noteHash, slot };
    const ex = zk.expectedPublicValues(pub);
    Object.assign(pub, { scope: ex.scope, message: ex.message });
    const proof = await generateProof(L, group, BigInt(pub.message), BigInt(pub.scope), 20, { wasm, zkey });
    return { v: 1, mode: "live", claimKind: "anon-post", publicInputs: pub, nullifier: String(proof.nullifier), proof: { scheme: "semaphore-v4", merkleTreeDepth: proof.merkleTreeDepth, points: proof.points.map(String) }, payload: { text, nonce, note } };
  };
  stub.reset();
  await withEnv({ ...AGENT_ENV(), ZK_ANON_POST_LIVE_CAP: "1", ZK_ANON_RELAY_INTERVAL_MS: "86400000" }, async () => {
    // pending live rows from the earlier tests count against the cap: clear them out of this universe's count first
    db.prepare("UPDATE zk_anon_casts SET status = 'failed' WHERE mode = 'live' AND status IN ('pending', 'relayed')").run();
    const e1 = await liveEnvelope(0, "the first live anonymous post");
    const r1 = await submit(e1);
    assert.equal(r1.status, 200, JSON.stringify(r1.json));
    assert.equal(db.prepare("SELECT status FROM zk_anon_casts WHERE cast_hash = ?").get(e1.publicInputs.castHash).status, "pending", "a live post was not held for its slot");
    assert.equal(stub.calls().filter((x) => x.op === "publish").length, 0, "the post left before its slot");
    const e2 = await liveEnvelope(1, "the second live anonymous post");
    const r2 = await submit(e2);
    assert.equal(r2.status, 503, JSON.stringify(r2.json));
    assert.match(r2.json.error, /ZK_ANON_POST_LIVE_CAP/);
    assert.equal(!!db.prepare("SELECT 1 FROM zk_nullifiers WHERE mode = 'live' AND nullifier = ?").get(e2.nullifier), false, "the capped post consumed its nullifier");
  });
  // without the cap the agent path does not arm at all: refused 503 naming it, nothing consumed
  await withEnv({ ...AGENT_ENV(), ZK_ANON_POST_LIVE_CAP: undefined }, async () => {
    const e3 = await liveEnvelope(2, "a post with no cap set");
    const r3 = await submit(e3);
    assert.equal(r3.status, 503, JSON.stringify(r3.json));
    assert.match(r3.json.error, /ZK_ANON_POST_LIVE_CAP is unset/);
  });
});

// ------------------------------------------------------------------------------------------------ ASM-1: the gated tree only
async function livePostInto(who, group, members, tree, slot, text) {
  const wasm = path.join(__dirname, "..", "..", ".zk-artifacts", "semaphore-20.wasm");
  const zkey = path.join(__dirname, "..", "..", ".zk-artifacts", "semaphore-20.zkey");
  const { generateProof } = require("@semaphore-protocol/proof");
  const nonce = randomBytes(16).toString("hex");
  const castHash = createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + text, "utf8").digest("hex");
  const attributionCommitment = createHash("sha256").update("layers-anon-attribution/1|" + randomBytes(32).toString("hex"), "utf8").digest("hex");
  const note = randomBytes(256).toString("hex");
  const noteHash = createHash("sha256").update(Buffer.from(note, "hex")).digest("hex");
  const pub = { mode: "live", claimKind: "anon-post", tree, epoch: members.epoch, merkleTreeRoot: members.root, personaId: "anon", gateId: "anon-post", challenge: "epoch-" + members.epoch, castHash, attributionCommitment, noteHash, slot };
  const ex = zk.expectedPublicValues(pub);
  Object.assign(pub, { scope: ex.scope, message: ex.message });
  const proof = await generateProof(who, group, BigInt(pub.message), BigInt(pub.scope), 20, { wasm, zkey });
  return { v: 1, mode: "live", claimKind: "anon-post", publicInputs: pub, nullifier: String(proof.nullifier), proof: { scheme: "semaphore-v4", merkleTreeDepth: proof.merkleTreeDepth, points: proof.points.map(String) }, payload: { text, nonce, note } };
}

test("ASM-1 THE GATED TREE ONLY: on the fid-gated shape the live config offers NO reach issuer and says liveTreeOnly; the reach ids cannot be registered in the live universe; a live anon post into a SELF-ISSUED attest:fc.reach/gte-1k (50 leaves, the gated plain tree over 100) is refused 400 'gated-tree' with the nullifier still unseen; CONTROL: the very same proof with the gate off is ACCEPTED (so the refusal is the guard's, not the floor's or the band's); the test universe's config is unchanged (a real live proof; skipped without cached artifacts)", async (t) => {
  if (!fs.existsSync(path.join(__dirname, "..", "..", ".zk-artifacts", "semaphore-20.zkey"))) return t.skip("no cached artifacts (run npm run bench:zk once)");
  const GATED = { ...AGENT_ENV(), ZK_ANON_FID_GATE: "on", APP_URL: "https://layers.example", ZK_ANON_RELAY_INTERVAL_MS: "86400000" };
  // the config, both universes, gate on and off
  await withEnv(GATED, async () => {
    const live = (await api("GET", "/zk/anon-post/config?mode=live")).json;
    assert.deepEqual(live.reachIssuers, [], "a gated live config offers reach issuers");
    assert.equal(live.liveTreeOnly, true);
    const fx = (await api("GET", "/zk/anon-post/config?mode=fixture")).json;
    assert.deepEqual(fx.reachIssuers, ["fc.reach", "x.reach"], "the test universe lost its reach tiers");
    assert.equal(fx.liveTreeOnly, false);
  });
  const ungated = (await api("GET", "/zk/anon-post/config?mode=live")).json;
  assert.deepEqual(ungated.reachIssuers, ["fc.reach", "x.reach"], "an ungated validator changed its reach issuers");
  assert.equal(ungated.liveTreeOnly, false);
  // the open registry: fc.reach in the live universe of a gated validator is refused (the fixture universe is not)
  const issuer = keypair();
  const reg = (mode) => {
    const body = { mode, id: "fc.reach", displayName: "Self-issued reach", claimSchema: { type: "object" }, buckets: ["gte-1k", "gte-10k", "gte-100k"], validityEpochs: 100, pubkey: issuer.pubHex };
    const schemaHash = createHash("sha256").update(JSON.stringify(body.claimSchema)).digest("hex");
    return { ...body, sig: signHex(zk.issuerCanonical({ ...body, schemaHash }), issuer.privateKey) };
  };
  await withEnv(GATED, async () => {
    const r = await api("POST", "/zk/issuers", reg("live"));
    assert.equal(r.status, 403, "a gated validator took fc.reach in the live universe: " + JSON.stringify(r.json));
    assert.equal(db.prepare("SELECT 1 FROM zk_issuers WHERE mode = 'live' AND id = 'fc.reach'").get(), undefined);
  });
  // the attack's furniture, as an issuer registered BEFORE the refusal existed would leave it: fc.reach in the live
  // universe, 50 registered commitments issued gte-1k (the attacker's among them, NOT a member of the gated tree), and a
  // gated plain tree of 100+ Farcaster-joined commitments (so the size floor and the band both pass)
  const ep0 = zk.epochInfo(db, "live").epoch;
  db.prepare("INSERT OR REPLACE INTO zk_issuers (mode, id, display_name, schema_json, buckets_json, validity_epochs, pubkey, sig, registered_at) VALUES ('live', 'fc.reach', 'Self-issued reach', '{}', ?, 100, ?, 'x', 0)").run(JSON.stringify(["gte-1k", "gte-10k", "gte-100k"]), issuer.pubHex);
  const attacker = new Identity("asm1-attacker");
  const reachers = [attacker, ...Array.from({ length: 49 }, (_, i) => new Identity("asm1-reach-" + i))];
  reachers.forEach((who, i) => {
    const rootId = "root_asm1_" + i;
    db.prepare("INSERT OR IGNORE INTO roots (id, fid, signer_uuid, created_at) VALUES (?, ?, ?, 0)").run(rootId, 960000 + i, "asm1-" + i);
    db.prepare("INSERT OR IGNORE INTO zk_registrations (mode, commitment, root_id, registered_at, epoch_registered, active_from_epoch) VALUES ('live', ?, ?, 0, ?, ?)").run(who.commitment.toString(10), rootId, ep0, ep0 + 1);
    db.prepare("INSERT OR REPLACE INTO zk_attestations (mode, issuer, bucket, commitment, claim_hash, issued_epoch, active_from_epoch, expires_epoch, revoked_from_epoch, sig, created_at) VALUES ('live', 'fc.reach', 'gte-1k', ?, ?, ?, ?, ?, NULL, 'x', 0)").run(who.commitment.toString(10), "ab".repeat(32), ep0, ep0 + 1, ep0 + 100);
  });
  for (let i = 0; i < 110; i++) db.prepare("INSERT OR IGNORE INTO zk_anon_fid_members (mode, fid, commitment, joined_epoch) VALUES ('live', ?, ?, ?)").run(880000 + i, new Identity("asm1-crowd-" + i).commitment.toString(10), ep0 - 1);
  const tree = "attest:fc.reach/gte-1k";
  let env;
  await withEnv(GATED, async () => {
    await api("POST", "/zk/dev/advance-epoch", { mode: "live" });
    const reach = (await api("GET", "/zk/members?mode=live&tree=" + encodeURIComponent(tree))).json;
    const plain = (await api("GET", "/zk/members?mode=live&tree=valid")).json;
    assert.equal(reach.members.length, 50, "the self-issued reach tree: " + reach.members.length);
    assert.ok(plain.members.length >= 100 && !plain.members.includes(attacker.commitment.toString(10)), "the gated plain tree: " + plain.members.length);
    env = await livePostInto(attacker, new (require("@semaphore-protocol/group").Group)(reach.members.map((m) => BigInt(m))), reach, tree, 0, "a post from a crowd of my own making");
    db.prepare("UPDATE zk_anon_casts SET status = 'failed' WHERE mode = 'live' AND status IN ('pending', 'relayed')").run();
    const r = await submit(env);
    assert.equal(r.status, 400, "the self-issued reach post was not refused: " + JSON.stringify(r.json));
    assert.equal(r.json.code, "gated-tree");
    assert.equal(!!db.prepare("SELECT 1 FROM zk_nullifiers WHERE mode = 'live' AND nullifier = ?").get(env.nullifier), false, "the refused post consumed its nullifier");
    assert.equal(db.prepare("SELECT 1 FROM zk_anon_casts WHERE cast_hash = ?").get(env.publicInputs.castHash), undefined, "the refused post was stored");
  });
  // CONTROL: the same envelope with the gate OFF (every other check unchanged) is accepted — the refusal above was the guard's
  await withEnv({ ...AGENT_ENV(), ZK_ANON_RELAY_INTERVAL_MS: "86400000" }, async () => {
    const r = await submit(env);
    assert.equal(r.status, 200, "control: the same post with the gate off was refused (the check above proved nothing): " + JSON.stringify(r.json));
  });
  db.prepare("UPDATE zk_anon_casts SET status = 'failed' WHERE mode = 'live' AND cast_hash = ?").run(env.publicInputs.castHash);
});

// ------------------------------------------------------------------------------------------------ ASM-5: leaving the crowd
test("ASM-5 LEAVING THE CROWD: a Farcaster-joined commitment leaves by a leave signed with ITS OWN identity — from the next epoch it is not a leaf of the live gated tree (the current, frozen epoch keeps it); another identity's signature, a stale hour and an unknown commitment are refused; a second leave is idempotent; only a FRESH sign-in by the fid joins it again; the HTTP route answers the same", async () => {
  ap.__resetForTests();
  const acc = (await import("viem/accounts")).privateKeyToAccount("0x" + "55".repeat(32));
  const { startNeynarAnonStub } = await import(pathToFileURL(path.join(__dirname, "..", "..", "scripts", "lib", "neynar-anon-stub.mjs")).href);
  const chain = await startNeynarAnonStub({ key: STUB_KEY, custody: { [acc.address.toLowerCase()]: 9105 } });
  try {
    const env = { ZK_ANON_FID_GATE: "on", APP_URL: "https://layers.example", ANON_FID_RPC_URL: chain.rpcUrl };
    const crowd = new Identity("asm5-crowd-identity");
    const c = crowd.commitment.toString(10);
    const s1 = randomBytes(16).toString("hex");
    const j = await ap.fidJoin(db, { mode: "live", fid: 9105, commitment: c, salt: s1, authMethod: "custody", ...(await siweFor({ account: acc, fid: 9105, commitment: c, salt: s1 })) }, env);
    assert.equal(j.status, 201, JSON.stringify(j.json));
    db.prepare("UPDATE zk_anon_fid_members SET joined_epoch = joined_epoch - 2 WHERE fid = 9105").run();
    const ep = zk.epochInfo(db, "live").epoch;
    assert.ok(ap.fidGateMembers(db, "live", ep, env).includes(c), "the joined commitment is not a leaf (furniture)");
    const hour = Math.floor(Date.now() / 3_600_000);
    const leaveBy = (who, h = hour, commitment = c) => {
      const sig = who.signMessage(ap.fidLeaveMessage("live", commitment, h));
      return { mode: "live", commitment, publicKey: who.publicKey.map(String), signature: { R8: sig.R8.map(String), S: String(sig.S) }, issuedHour: h };
    };
    const other = new Identity("asm5-someone-else");
    const forged = ap.fidLeave(db, { ...leaveBy(other), commitment: c }, env);
    assert.equal(forged.status, 403, "another identity's leave: " + JSON.stringify(forged.json));
    assert.equal(ap.fidLeave(db, leaveBy(crowd, hour - 3), env).json.code, "fid-leave-stale");
    assert.equal(ap.fidLeave(db, leaveBy(other, hour, other.commitment.toString(10)), env).status, 404, "an unknown commitment's leave");
    assert.ok(ap.fidGateMembers(db, "live", ep + 1, env).includes(c), "a refused leave dropped the leaf");
    const left = ap.fidLeave(db, leaveBy(crowd), env);
    assert.equal(left.status, 200, JSON.stringify(left.json));
    assert.equal(left.json.leftFromEpoch, ep + 1);
    assert.ok(ap.fidGateMembers(db, "live", ep, env).includes(c), "the leave changed the CURRENT (frozen) epoch");
    assert.ok(!ap.fidGateMembers(db, "live", ep + 1, env).includes(c), "after the leave the commitment is still a leaf of the next epoch");
    assert.ok(!ap.fidGateMembers(db, "live", ep + 5, env).includes(c), "the leave did not last");
    assert.ok(db.prepare("SELECT 1 FROM zk_anon_fid_members WHERE commitment = ?").get(c), "the row was deleted (hide, never delete)");
    assert.equal(ap.fidLeave(db, leaveBy(crowd), env).json.existing, true, "a second leave is not idempotent");
    // only a fresh sign-in by the fid joins it again
    const s2 = randomBytes(16).toString("hex");
    const back = await ap.fidJoin(db, { mode: "live", fid: 9105, commitment: c, salt: s2, authMethod: "custody", ...(await siweFor({ account: acc, fid: 9105, commitment: c, salt: s2 })) }, env);
    assert.equal(back.status, 201, JSON.stringify(back.json));
    assert.equal(back.json.rejoined, true);
    assert.ok(ap.fidGateMembers(db, "live", ep + 1, env).includes(c), "a fresh sign-in did not join it again");
    // the route
    await withEnv(env, async () => {
      const r = await api("POST", "/zk/anon/fid-leave", leaveBy(crowd));
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.ok(!ap.fidGateMembers(db, "live", ep + 1, env).includes(c));
    });
    assert.equal((await api("POST", "/zk/anon/fid-leave", leaveBy(crowd))).status, 404, "the leave answered with the gate off");
  } finally {
    await chain.close();
  }
});

test("migration 29 and 30: idempotent (a second run adds nothing), reversible (each down drops exactly its tables and columns), and every time column is hour-grained by name", () => {
  const { migrate, migrateDown } = require("../migrations");
  assert.equal(migrate(db).ran, 0);
  const { openDb } = require("../db");
  const d = openDb(":memory:");
  try {
    const tables = () => d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'zk_anon_%'").all().map((r) => r.name).sort();
    assert.deepEqual(tables(), ["zk_anon_casts", "zk_anon_fid_members", "zk_anon_filter_log", "zk_anon_reports", "zk_anon_takedowns"]);
    assert.ok(d.prepare("PRAGMA table_info(zk_anon_fid_members)").all().some((c) => c.name === "left_epoch"), "migration 30 did not add left_epoch");
    migrateDown(d, 30);
    assert.ok(!d.prepare("PRAGMA table_info(zk_anon_fid_members)").all().some((c) => c.name === "left_epoch"), "migration 30's down left the column");
    migrateDown(d, 29);
    assert.deepEqual(tables(), ["zk_anon_casts"]);
    assert.ok(!d.prepare("PRAGMA table_info(zk_anon_casts)").all().some((c) => c.name === "hidden_at"));
  } finally {
    d.close();
  }
  for (const t of ["zk_anon_reports", "zk_anon_takedowns", "zk_anon_filter_log"]) {
    const timeCols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name).filter((n) => /_at$|time|hour/.test(n));
    assert.ok(timeCols.every((n) => n.endsWith("_hour")), t + " has a time column that is not hour-grained: " + timeCols.join(","));
  }
});
