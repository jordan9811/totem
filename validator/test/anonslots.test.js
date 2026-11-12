"use strict";
// PERSONA LAUNCH P3 — THE INDEXED ANON SCOPE on the validator, in-process (createApp(":memory:"), an ephemeral port,
// never a pinned one). D4: K anon posts per PERSON per window (default 4), one nullifier per (person, window, slot), a
// global daily cap, the relay cadence and the lifetime cap by deployment shape, and migration 21 (tree + note).
//
// The nullifiers here are REAL — Poseidon(semaphoreHash(scopeValue), secretScalar), the circuit's formula
// (lib/zk/nullifier.ts) — so "K slots give K distinct nullifiers" and "the same slot twice is a replay" are properties
// of the scope strings, not of numbers this file chose. Every refusal is checked BEFORE the nullifier is consumed: the
// refused envelope's own real nullifier is then accepted under the correct inputs.
process.env.ZK_DEV_HOOKS = "true";
process.env.ZK_ANON_FLOOR = "2";
process.env.ZK_ANON_POST_TREE = "valid";
delete process.env.ZK_ANON_POST_SLOTS;
delete process.env.ZK_ANON_POST_DAILY_CAP;
delete process.env.ZK_ANON_POST_LIVE_CAP;
delete process.env.ZK_ANON_RELAY_INTERVAL_MS;
delete process.env.ZK_ANON_RELAY_SPREAD_MS;

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign: cryptoSign, createHash, randomBytes } = require("node:crypto");
const express = require("express");
const { createApp } = require("../server");
const zk = require("../zk");
const { Identity } = require("@semaphore-protocol/identity");
const { poseidon2 } = require("poseidon-lite");

let server;
let base;
let db;
before(async () => {
  const created = createApp(":memory:");
  db = created.db;
  await new Promise((resolve) => {
    server = created.app.listen(0, resolve);
  });
  base = "http://127.0.0.1:" + server.address().port;
});
after(() => server.close());

async function api(method, p, body, headers = {}) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const signHex = (canonical, privateKey) => cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");
const registerCanonical = (mode, c, rootId, issuedAt) => ["layers-zk-register/1", mode, c, rootId, String(issuedAt)].join("|");
// DELIBERATE DUPLICATES (validator/zk.js, lib/zk/hash.ts, lib/zk/transport/types.ts), so a drift on either side fails here
const fieldOf = (domain, canonical) => (BigInt("0x" + createHash("sha256").update(`layers-zk-field/1|${domain}|${canonical}`).digest("hex")) >> 8n).toString(10);
const fixtureTag = (canonical, nullifier) => createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
// PERSONA LAUNCH P4: the canonical tail binds the ring note's hash after the slot
const canonicalAnon = (p) =>
  ["layers-zk-public/1", p.mode, p.claimKind, p.tree, String(p.epoch), p.merkleTreeRoot, p.scope, p.message, p.personaId, p.gateId, p.challenge, p.castHash, p.attributionCommitment, p.slot === undefined || p.slot === null ? "" : String(p.slot), p.noteHash || ""].join("|");
const canonicalPlain = (p) => ["layers-zk-public/1", p.mode, p.claimKind, p.tree, String(p.epoch), p.merkleTreeRoot, p.scope, p.message, p.personaId, p.gateId, p.challenge].join("|");
const realNullifier = (scopeCanonical, identity) => poseidon2([BigInt(zk.semaphoreHash(fieldOf("scope", scopeCanonical))), identity.secretScalar]).toString(10);
const K = () => zk.anonPostSlots();

const anchor = (() => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
})();
const A = new Identity("anonslots-person-a");
const B = new Identity("anonslots-person-b");
let EP = null;
let ROOT = null;
let seq = 0;

/** an anon envelope for `who` in `slot` — the scope from (window, slot) unless `scopeQualifier` overrides it */
function anonEnvelope(who, slot, o = {}) {
  const text = o.text ?? `anon slots ${++seq} ${Date.now().toString(36)}`;
  const nonce = createHash("sha256").update("nonce|" + text).digest("hex").slice(0, 32);
  const castHash = createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + text, "utf8").digest("hex");
  const attributionCommitment = createHash("sha256").update("layers-anon-attribution/1|" + createHash("sha256").update("secret|" + text).digest("hex"), "utf8").digest("hex");
  const qualifier = o.scopeQualifier ?? `w${EP}/s${slot}`;
  const scopeCanonical = `layers/zk-scope/v1|anon-post/${qualifier}`;
  const challenge = "epoch-" + EP;
  // PERSONA LAUNCH P4 (R8): every anon post carries a 256-byte note (here CSPRNG bytes — a post with no ring), its
  // sha256 over the RAW bytes bound into the message beside attr:
  const note = randomBytes(256).toString("hex");
  const noteHash = createHash("sha256").update(Buffer.from(note, "hex")).digest("hex");
  const pub = {
    mode: "fixture", claimKind: "anon-post", tree: "valid", epoch: EP, merkleTreeRoot: ROOT,
    scope: fieldOf("scope", scopeCanonical),
    message: fieldOf("message", ["anon", "anon-post", "cast:" + castHash, "attr:" + attributionCommitment, "note:" + noteHash, challenge, ROOT].join("|")),
    personaId: "anon", gateId: "anon-post", challenge, castHash, attributionCommitment, noteHash,
    ...(o.omitSlot ? {} : { slot }),
  };
  const nullifier = o.nullifier ?? realNullifier(scopeCanonical, who);
  return { v: 1, mode: "fixture", claimKind: "anon-post", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalAnon(pub), nullifier) }, payload: { text, nonce, note } };
}
const submit = (envelope) => api("POST", "/zk/submit", { envelope });
const nullifierCount = () => db.prepare("SELECT COUNT(*) AS n FROM zk_nullifiers WHERE mode = 'fixture'").get().n;
const anonRowCount = () => db.prepare("SELECT COUNT(*) AS n FROM zk_anon_casts WHERE mode = 'fixture'").get().n;
const hasNullifier = (n) => !!db.prepare("SELECT 1 FROM zk_nullifiers WHERE mode = 'fixture' AND nullifier = ?").get(n);
function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
async function withEnvAsync(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

test("setup: two people (two roots, one anchor), registered, a leaf of `valid` after the batched epoch", async () => {
  await api("POST", "/device/auth-anchor", { pubkey: anchor.pubHex });
  for (const [i, who] of [A, B].entries()) {
    const r = await api("POST", "/roots", { fid: 515150 + i, signerUuid: "anonslots-" + i });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const issuedAt = Date.now();
    const c = who.commitment.toString(10);
    const reg = await api("POST", "/zk/register", { mode: "fixture", commitment: c, rootId: r.json.rootId, issuedAt, signature: signHex(registerCanonical("fixture", c, r.json.rootId, issuedAt), anchor.privateKey), anchorPubKey: anchor.pubHex });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
  }
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  const members = (await api("GET", "/zk/members?mode=fixture&tree=valid")).json;
  assert.ok(members.members.includes(A.commitment.toString(10)) && members.members.includes(B.commitment.toString(10)));
  EP = members.epoch;
  ROOT = members.root;
});

test("migration 21: zk_anon_casts gains nullable `tree` and `note`; no table anywhere has a slot column; migration 22 (byx's x_index) is applied after it", () => {
  const cols = db.prepare("PRAGMA table_info(zk_anon_casts)").all();
  const tree = cols.find((c) => c.name === "tree");
  const note = cols.find((c) => c.name === "note");
  assert.ok(tree && note, "tree/note columns missing: " + cols.map((c) => c.name).join(","));
  assert.equal(tree.notnull, 0);
  assert.equal(note.notnull, 0);
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
    const bad = db.prepare(`PRAGMA table_info("${name}")`).all().filter((c) => /slot/i.test(c.name));
    assert.equal(bad.length, 0, `${name} has a slot column: ${bad.map((c) => c.name).join(",")}`);
  }
  const versions = db.prepare("SELECT version, name FROM schema_version WHERE version IN (21, 22) ORDER BY version").all().map((r) => ({ ...r }));
  assert.deepEqual(versions, [{ version: 21, name: "zk_anon_casts_tree_note" }, { version: 22, name: "x_index" }]);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'x_fname_current'").get() && db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'x_index_cursor'").get());
});

test("K slots: one person's K posts in one window are ALL accepted with K DISTINCT real nullifiers and K relayed rows (tree = the configured tree, note = the envelope's own 256-byte note, tree_size = the frozen tree's size); the same slot again is a replay (409) and relays nothing", async () => {
  assert.equal(K(), 4, "the default K is 4 (D4)");
  const nulls = [];
  for (let s = 0; s < K(); s++) {
    const env = anonEnvelope(A, s);
    const r = await submit(env);
    assert.equal(r.status, 200, `slot ${s}: ` + JSON.stringify(r.json));
    nulls.push(env.nullifier);
    const row = { ...db.prepare("SELECT * FROM zk_anon_casts WHERE mode = 'fixture' AND cast_hash = ?").get(env.publicInputs.castHash) };
    assert.equal(row.tree, "valid");
    // PERSONA LAUNCH P4: the row stores the note the envelope carried, byte for byte (512 hex = 256 bytes)
    assert.match(row.note, /^[0-9a-f]{512}$/);
    assert.equal(row.note, env.payload.note);
    // PERSONA LAUNCH P5 (migration 24): the frozen tree's size at the post's epoch — two people are leaves of `valid`
    assert.equal(row.tree_size, db.prepare("SELECT COUNT(*) AS n FROM zk_placements WHERE mode = 'fixture' AND tree = 'valid' AND epoch = ?").get(EP).n);
    assert.equal(row.status, "relayed");
  }
  assert.equal(new Set(nulls).size, K(), "the K slots did not give K distinct nullifiers");
  for (const n of nulls) assert.ok(hasNullifier(n));
  const rowsBefore = anonRowCount();
  const again = anonEnvelope(A, 0); // a NEW text in a used slot: the scope, hence the nullifier, is slot 0's
  assert.equal(again.nullifier, nulls[0], "the same (person, window, slot) did not give the same nullifier");
  const r = await submit(again);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(anonRowCount(), rowsBefore, "a replayed slot relayed something");
  // the public list's columns, EXACTLY (an allowlist, so a column added later fails here): PERSONA LAUNCH P4/P5/P6 serve
  // the note, the tree, its size and the launch batch; never a slot, a persona, a root or a nullifier on the wire back out
  const listed = (await api("GET", "/zk/anon-casts?mode=fixture")).json.casts;
  assert.ok(listed.length >= K());
  for (const c of listed) assert.deepEqual(Object.keys(c).sort(), ["at", "attributedAt", "attributedBatch", "attributedFid", "attributedSigner", "castHash", "epoch", "fid", "hash", "note", "text", "tree", "treeSize"]);
});

test("REFUSED BEFORE ANY NULLIFIER: slot = K, a non-integer slot, a string slot, a negative slot, a missing slot and the BARE w<n> scope on anon-post, and a slot on a non-anon claim — each 400 with the store untouched; the refused envelopes' own real nullifier is then accepted under the right inputs (it was never consumed)", async () => {
  const before0 = nullifierCount();
  const rows0 = anonRowCount();
  const good = anonEnvelope(B, 0);
  const variants = [
    ["slot = K", { ...good, publicInputs: { ...good.publicInputs, slot: K() } }],
    ["slot = 1.5", { ...good, publicInputs: { ...good.publicInputs, slot: 1.5 } }],
    ["slot = '0'", { ...good, publicInputs: { ...good.publicInputs, slot: "0" } }],
    ["slot = -1", { ...good, publicInputs: { ...good.publicInputs, slot: -1 } }],
    ["missing slot", anonEnvelope(B, 0, { omitSlot: true, text: good.payload.text })],
  ];
  // the bare window — the pre-P3 scope, with its own real nullifier (what an old client would emit): refused by the binding
  const bare = anonEnvelope(B, 0, { scopeQualifier: `w${EP}` });
  variants.push(["bare w<n> scope", bare]);
  // a slot beyond K with its OWN consistent scope and nullifier (a client that believed K were larger)
  variants.push(["slot K with its own scope", anonEnvelope(B, K())]);
  for (const [name, env] of variants) {
    const r = await submit(env);
    assert.equal(r.status, 400, `${name}: ` + JSON.stringify(r.json));
  }
  // a slot on a tier-membership claim
  const ch = "epoch-" + EP;
  const plain = { mode: "fixture", claimKind: "tier-membership", tree: "valid", epoch: EP, merkleTreeRoot: ROOT, personaId: "p_slots", gateId: "foryou", challenge: ch, scope: fieldOf("scope", `layers/zk-scope/v1|discovery-tier|${EP}|p_slots`), message: fieldOf("message", ["p_slots", "foryou", ch, ROOT].join("|")) };
  const plainEnv = (pub, n) => ({ v: 1, mode: "fixture", claimKind: "tier-membership", publicInputs: pub, nullifier: n, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPlain(pub), n) } });
  const withSlot = await submit(plainEnv({ ...plain, slot: 0 }, "918273645"));
  assert.equal(withSlot.status, 400, JSON.stringify(withSlot.json));
  assert.match(withSlot.json.error, /slot is only valid on an anon-post claim/);
  assert.equal(nullifierCount(), before0, "a refused submission consumed a nullifier");
  assert.equal(anonRowCount(), rows0, "a refused submission relayed something");
  assert.equal(hasNullifier(good.nullifier), false);
  // non-vacuous: every variant above carried B's slot-0 nullifier or its own; the right one is still spendable
  const ok = await submit(good);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // and the plain claim without the slot is accepted too (the refusal was the slot, nothing else)
  assert.equal((await submit(plainEnv(plain, "918273645"))).status, 200);
  // MUTATION (the refusal is the K bound itself): raise K to 8 and the slot-K envelope that was refused verifies
  await withEnvAsync({ ZK_ANON_POST_SLOTS: "8" }, async () => {
    const wide = anonEnvelope(B, 4);
    const r = await submit(wide);
    assert.equal(r.status, 200, "slot 4 under K = 8: " + JSON.stringify(r.json));
  });
  // a blank ZK_ANON_POST_SLOTS is UNSET (K = 4), never Number("") = 0 → K = 1
  withEnv({ ZK_ANON_POST_SLOTS: "  " }, () => assert.equal(K(), 4));
  withEnv({ ZK_ANON_POST_SLOTS: "99" }, () => assert.equal(K(), 16));
  withEnv({ ZK_ANON_POST_SLOTS: "nope" }, () => assert.equal(K(), 4));
});

test("the validator's scopeString takes ONLY w<n>/s<i> for anon-post: the bare window, s<K> and junk throw; i < K is enforced", () => {
  const entry = { feature: "anon-post", onePerHuman: true };
  assert.equal(zk.scopeString(entry, EP, undefined, `w${EP}/s3`), `layers/zk-scope/v1|anon-post/w${EP}/s3`);
  for (const q of [`w${EP}`, `w${EP}/s${K()}`, `w${EP}/s-1`, `w${EP}/s1.5`, `w${EP}/x1`, undefined, ""]) assert.throws(() => zk.scopeString(entry, EP, undefined, q), `qualifier ${q} was accepted`);
});

test("the DAILY cap (ZK_ANON_POST_DAILY_CAP, default 500, per universe): pending + relayed rows of the current day's epochs count, failed/refused-author and yesterday's do not; the (cap+1)th is refused 503 inside the transaction with nothing consumed; raised, the same envelope is accepted", async () => {
  const [lo, hi] = zk.anonDayEpochRange(EP);
  assert.ok(lo <= EP && EP < hi);
  const usedNow = () => db.prepare("SELECT COUNT(*) AS n FROM zk_anon_casts WHERE mode = 'fixture' AND status IN ('pending','relayed') AND epoch >= ? AND epoch < ?").get(lo, hi).n;
  const cfgUsed = async () => (await api("GET", "/zk/anon-post/config?mode=fixture")).json.dailyUsed;
  assert.equal(await cfgUsed(), usedNow());
  assert.equal((await api("GET", "/zk/anon-post/config?mode=fixture")).json.dailyCap, 500);
  // bucketing: a failed row today, a refused-author row today and a relayed row YESTERDAY do not count; a pending row today does
  const ins = db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status, attribution_commitment, tree, note) VALUES ('fixture', ?, 'x', ?, 0, '', 0, ?, '', 'valid', NULL)");
  const base0 = await cfgUsed();
  ins.run("f".repeat(64), EP, "failed");
  ins.run("e".repeat(64), EP, "refused-author");
  ins.run("d".repeat(64), lo - 1, "relayed");
  assert.equal(await cfgUsed(), base0, "failed / refused-author / yesterday's rows were counted");
  ins.run("c".repeat(64), EP, "pending");
  assert.equal(await cfgUsed(), base0 + 1, "a pending row today was not counted");
  db.prepare("DELETE FROM zk_anon_casts WHERE cast_hash IN (?, ?, ?, ?)").run("f".repeat(64), "e".repeat(64), "d".repeat(64), "c".repeat(64));
  const used = await cfgUsed();
  await withEnvAsync({ ZK_ANON_POST_DAILY_CAP: String(used) }, async () => {
    const env = anonEnvelope(B, 1);
    const n0 = nullifierCount();
    const r = await submit(env);
    assert.equal(r.status, 503, JSON.stringify(r.json));
    assert.match(r.json.error, /ZK_ANON_POST_DAILY_CAP/);
    assert.equal(nullifierCount(), n0, "the cap refusal consumed a nullifier");
    assert.equal(hasNullifier(env.nullifier), false);
    process.env.ZK_ANON_POST_DAILY_CAP = String(used + 1);
    assert.equal((await submit(env)).status, 200, "raised by one, the same envelope was not accepted");
    const next = await submit(anonEnvelope(B, 2));
    assert.equal(next.status, 503, "the (cap+1)th was accepted: " + JSON.stringify(next.json));
  });
});

test("the daily bucket is the epoch's day on the shifted clock: 6-hour epochs → four per day, and a long epoch is its own day", () => {
  const H = 3_600_000;
  assert.deepEqual(zk.anonDayEpochRange(8, 6 * H), [8, 12]);
  assert.deepEqual(zk.anonDayEpochRange(11, 6 * H), [8, 12]);
  assert.deepEqual(zk.anonDayEpochRange(12, 6 * H), [12, 16]);
  assert.deepEqual(zk.anonDayEpochRange(3, 48 * H), [3, 4]);
  // every epoch lies in its own range, and consecutive days tile without overlap
  for (const ms of [H, 6 * H, 7 * H, 24 * H, 36 * H]) {
    for (let e = 0; e < 200; e++) {
      const [lo, hi] = zk.anonDayEpochRange(e, ms);
      assert.ok(lo <= e && e < hi, `epoch ${e} at ${ms} ms outside [${lo}, ${hi})`);
      if (e + 1 < hi) assert.deepEqual(zk.anonDayEpochRange(e + 1, ms), [lo, hi]);
    }
  }
});

test("the LIFETIME live cap by shape: every non-public shape defaults to 1 with the variable unset OR blank (the owner service keeps 1 when the var is lost); the public shape has none unless set explicitly; fixture posts are never counted against it (K accepted above)", () => {
  const owner = { NODE_ENV: "production", ZK_DEV_HOOKS: "true" };
  const rig = { NODE_ENV: undefined, ZK_DEV_HOOKS: "true" };
  const pub = { NODE_ENV: "production", ZK_DEV_HOOKS: undefined };
  withEnv({ ...owner, ZK_ANON_POST_LIVE_CAP: undefined }, () => assert.equal(zk.anonLiveCap(), 1));
  withEnv({ ...owner, ZK_ANON_POST_LIVE_CAP: "" }, () => assert.equal(zk.anonLiveCap(), 1));
  withEnv({ ...owner, ZK_ANON_POST_LIVE_CAP: "5" }, () => assert.equal(zk.anonLiveCap(), 5)); // arm-anon.ps1 -RaiseCap 5
  withEnv({ ...rig, ZK_ANON_POST_LIVE_CAP: undefined }, () => assert.equal(zk.anonLiveCap(), 1));
  withEnv({ ...pub, ZK_ANON_POST_LIVE_CAP: undefined }, () => assert.equal(zk.anonLiveCap(), null));
  withEnv({ ...pub, ZK_ANON_POST_LIVE_CAP: " " }, () => assert.equal(zk.anonLiveCap(), null));
  withEnv({ ...pub, ZK_ANON_POST_LIVE_CAP: "3" }, () => assert.equal(zk.anonLiveCap(), 3));
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM zk_anon_casts WHERE mode = 'fixture'").get().n > 1, "fixture rows above the lifetime cap exist (it is live-only)");
});

test("the relay cadence by shape (D4): public 30-minute slots with a 30-minute spread; the rig and the owner service keep 60 minutes / no spread; the environment overrides any shape; a blank value is the shape's default", () => {
  const M = 60_000;
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined }, () => {
    assert.equal(zk.anonRelayIntervalMs(), 30 * M);
    assert.equal(zk.anonRelaySpreadMs(), 30 * M);
  });
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: "true" }, () => {
    assert.equal(zk.anonRelayIntervalMs(), 60 * M);
    assert.equal(zk.anonRelaySpreadMs(), 0);
  });
  withEnv({ NODE_ENV: undefined, ZK_DEV_HOOKS: "true" }, () => {
    assert.equal(zk.anonRelayIntervalMs(), 60 * M);
    assert.equal(zk.anonRelaySpreadMs(), 0);
  });
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_RELAY_INTERVAL_MS: "900000", ZK_ANON_RELAY_SPREAD_MS: "0" }, () => {
    assert.equal(zk.anonRelayIntervalMs(), 15 * M);
    assert.equal(zk.anonRelaySpreadMs(), 0);
  });
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: "true", ZK_ANON_RELAY_SPREAD_MS: "21600000" }, () => assert.equal(zk.anonRelaySpreadMs(), 6 * 60 * M));
  withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_RELAY_INTERVAL_MS: "" }, () => assert.equal(zk.anonRelayIntervalMs(), 30 * M, "a blank interval relayed every second"));
});

test("/zk/anon-post/config: slotsPerWindow in the UNSIGNED shape; dailyCap/dailyUsed only in the SIGNED (full) shape when the deployment is armed (an unsigned count is a submission-time oracle, R1-05)", async () => {
  const app2 = express();
  zk.mountZk(app2, db, { requireSig: true, checkEnvelope: (req) => (req.header("x-test-signed") === "yes" ? null : { status: 401, error: "signed envelope required" }) });
  const s2 = await new Promise((resolve) => {
    const s = app2.listen(0, () => resolve(s));
  });
  try {
    const url = "http://127.0.0.1:" + s2.address().port + "/zk/anon-post/config?mode=fixture";
    const unsigned = await (await fetch(url)).json();
    assert.equal(unsigned.slotsPerWindow, 4);
    for (const k of ["dailyCap", "dailyUsed", "pending", "cap", "fid", "relayed"]) assert.equal(k in unsigned, false, `${k} is in the unsigned shape`);
    const signed = await (await fetch(url, { headers: { "x-layers-device": "d", "x-test-signed": "yes" } })).json();
    assert.equal(signed.slotsPerWindow, 4);
    assert.equal(signed.dailyCap, 500);
    assert.ok(Number.isInteger(signed.dailyUsed) && signed.dailyUsed > 0, JSON.stringify(signed));
    withEnv({ ZK_ANON_POST_SLOTS: "6" }, () => assert.equal(zk.anonPostSlots(), 6));
  } finally {
    s2.close();
  }
});
