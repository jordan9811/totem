"use strict";
// PERSONA LAUNCH P5 — REACH TIERS on the validator, in-process (createApp(":memory:"), an ephemeral port, never a pinned
// one). An anon post may prove the configured plain anon tree OR the bucket tree of an accepted reach issuer
// (ZK_ANON_REACH_ISSUERS, default fc.reach + x.reach); a reach tree under the crowd floor is refused on the FROZEN tree's
// size at the post's epoch, before any nullifier is consumed; the row records the tree and that size (migration 24);
// and the tree is deliberately NOT in the scope, so one (window, slot) proved under two trees is one nullifier — a replay.
//
// The nullifiers are REAL — Poseidon(semaphoreHash(scopeValue), secretScalar), the circuit's formula — so "the tree is
// not in the scope" is a property of the scope strings, not of numbers this file chose. Every refusal is followed by a
// positive control that changes ONLY the refused thing (the floor, the issuer list) and gets the same envelope accepted,
// so no refusal here passes for a reason other than the one it names.
process.env.ZK_DEV_HOOKS = "true";
process.env.ZK_ANON_FLOOR = "3";
process.env.ZK_REACH_FLOOR = "3";
process.env.ZK_ANON_POST_TREE = "valid";
for (const k of ["ZK_ANON_REACH_ISSUERS", "ZK_ANON_POST_SLOTS", "ZK_ANON_POST_DAILY_CAP", "ZK_ANON_POST_WINDOW_EPOCHS"]) delete process.env[k];

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign: cryptoSign, createHash, randomBytes } = require("node:crypto");
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

async function api(method, p, body) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
function mkKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
}
const signHex = (canonical, privateKey) => cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");
// DELIBERATE DUPLICATES (validator/zk.js, lib/zk/hash.ts, lib/zk/transport/types.ts, lib/attest/canonical.ts)
const registerCanonical = (mode, c, rootId, issuedAt) => ["layers-zk-register/1", mode, c, rootId, String(issuedAt)].join("|");
const fieldOf = (domain, canonical) => (BigInt("0x" + createHash("sha256").update(`layers-zk-field/1|${domain}|${canonical}`).digest("hex")) >> 8n).toString(10);
const fixtureTag = (canonical, nullifier) => createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
const canonicalAnon = (p) =>
  ["layers-zk-public/1", p.mode, p.claimKind, p.tree, String(p.epoch), p.merkleTreeRoot, p.scope, p.message, p.personaId, p.gateId, p.challenge, p.castHash, p.attributionCommitment, String(p.slot), p.noteHash].join("|");
const realNullifier = (scopeCanonical, identity) => poseidon2([BigInt(zk.semaphoreHash(fieldOf("scope", scopeCanonical))), identity.secretScalar]).toString(10);
const issuerCanonical = (i) => ["layers-zk-issuer/1", i.mode, i.id, i.displayName, i.schemaHash, i.buckets.join(","), String(i.validityEpochs), i.pubkey].join("|");
const attestCanonical = (a) => ["layers-zk-attest/2", a.mode, a.issuer, a.bucket, a.commitment, a.claimHash, String(a.issuedEpoch), String(a.expiresEpoch)].join("|");
const attestSubmitCanonical = (mode, partsJson, issuedAt) => ["layers-zk-attest-submit/1", mode, createHash("sha256").update(partsJson).digest("hex"), String(issuedAt)].join("|");

const anchor = mkKeys();
const R = new Identity("reach-test-root");
const decoy = (i) => new Identity("layers-zk-decoy/" + i); // validator/zk.js seed-decoys: public test furniture
const VALIDITY = 8;
const FC = "fc.reach";
const OTHER = "onchain.reach-lookalike"; // a registered issuer that is NOT a reach issuer: its trees are never anon trees
const issuerKeys = { [FC]: mkKeys(), [OTHER]: mkKeys() };
let EP = null;

async function registerIssuer(id, buckets) {
  const schema = { type: "object" };
  const body = { mode: "fixture", id, displayName: id, claimSchema: schema, buckets, validityEpochs: VALIDITY, pubkey: issuerKeys[id].pubHex };
  const schemaHash = createHash("sha256").update(JSON.stringify(schema)).digest("hex");
  const sig = signHex(issuerCanonical({ ...body, schemaHash }), issuerKeys[id].privateKey);
  return api("POST", "/zk/issuers", { ...body, sig });
}
async function issue(id, bucket, commitments, ep) {
  const list = commitments.map((c) => {
    const a = { issuer: id, bucket, commitment: c, claimHash: createHash("sha256").update(`reach-claim|${id}|${bucket}|${c}`).digest("hex"), issuedEpoch: ep, expiresEpoch: ep + 1 + VALIDITY };
    return { ...a, sig: signHex(attestCanonical({ mode: "fixture", ...a }), issuerKeys[id].privateKey) };
  });
  const issuedAt = Date.now();
  return api("POST", "/zk/attest", { mode: "fixture", attestations: list, issuedAt, signature: signHex(attestSubmitCanonical("fixture", JSON.stringify(list), issuedAt), anchor.privateKey), anchorPubKey: anchor.pubHex });
}
const members = async (tree) => (await api("GET", "/zk/members?mode=fixture&tree=" + encodeURIComponent(tree))).json;

let seq = 0;
/** an anon envelope for `who` proving `tree` in `slot` (this window), with a fresh text and a 256-byte CSPRNG note */
async function anonEnvelope(who, tree, slot, o = {}) {
  const m = o.members ?? (await members(tree));
  const root = m && m.root ? m.root : "0";
  const text = `reach ${++seq} ${Date.now().toString(36)}`;
  const nonce = createHash("sha256").update("nonce|" + text).digest("hex").slice(0, 32);
  const castHash = createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + text, "utf8").digest("hex");
  const attributionCommitment = createHash("sha256").update("layers-anon-attribution/1|" + createHash("sha256").update("secret|" + text).digest("hex"), "utf8").digest("hex");
  const note = randomBytes(256).toString("hex");
  const noteHash = createHash("sha256").update(Buffer.from(note, "hex")).digest("hex");
  // THE SCOPE: (window, slot) — no tree, no persona (lib/zk/scopes.ts anon-post)
  const scopeCanonical = `layers/zk-scope/v1|anon-post/w${EP}/s${slot}`;
  const challenge = "epoch-" + EP;
  const pub = {
    mode: "fixture", claimKind: "anon-post", tree, epoch: EP, merkleTreeRoot: root,
    scope: fieldOf("scope", scopeCanonical),
    message: fieldOf("message", ["anon", "anon-post", "cast:" + castHash, "attr:" + attributionCommitment, "note:" + noteHash, challenge, root].join("|")),
    personaId: "anon", gateId: "anon-post", challenge, castHash, attributionCommitment, slot, noteHash,
  };
  const nullifier = realNullifier(scopeCanonical, who);
  return { v: 1, mode: "fixture", claimKind: "anon-post", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalAnon(pub), nullifier) }, payload: { text, nonce, note } };
}
const submit = (envelope) => api("POST", "/zk/submit", { envelope });
const hasNullifier = (n) => !!db.prepare("SELECT 1 FROM zk_nullifiers WHERE mode = 'fixture' AND nullifier = ?").get(n);
const nullifierCount = () => db.prepare("SELECT COUNT(*) AS n FROM zk_nullifiers WHERE mode = 'fixture'").get().n;
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

const TEN = "attest:fc.reach/gte-10k";
const HUNDRED = "attest:fc.reach/gte-100k";
const ONE = "attest:fc.reach/gte-1k";
const LOOKALIKE = "attest:" + OTHER + "/gte-10k";

// PERSONA LAUNCH wave 3 (L3): the crowd is sized for the BAND rule at the floor of 3 too (validator/zk.js reachBandRefusal):
// the plain tree holds 4 more than gte-1k, gte-1k 3 more than gte-10k — so gte-1k and gte-10k are offerable, gte-100k
// (2) is under the floor itself
test("setup: a root and 10 decoys are leaves of `valid`; fc.reach issues gte-1k to 7, gte-10k to 4 and gte-100k to 2 (under the floor of 3); a non-reach issuer's lookalike bucket holds 4; all active next epoch", async () => {
  assert.ok([200, 201].includes((await api("POST", "/device/auth-anchor", { pubkey: anchor.pubHex })).status));
  const r = await api("POST", "/roots", { fid: 616161, signerUuid: "reach-test" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const issuedAt = Date.now();
  const c = R.commitment.toString(10);
  const reg = await api("POST", "/zk/register", { mode: "fixture", commitment: c, rootId: r.json.rootId, issuedAt, signature: signHex(registerCanonical("fixture", c, r.json.rootId, issuedAt), anchor.privateKey), anchorPubKey: anchor.pubHex });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  assert.equal((await api("POST", "/zk/dev/seed-decoys", { mode: "fixture", count: 10 })).json.inserted, 10);
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  const valid = await members("valid");
  assert.ok(valid.members.includes(c) && valid.members.length === 11, "valid: " + valid.members.length);
  assert.equal((await registerIssuer(FC, zk.REACH_BUCKETS)).status, 201);
  assert.equal((await registerIssuer(OTHER, ["gte-10k"])).status, 201);
  const ep = valid.epoch;
  const d = (i) => decoy(i).commitment.toString(10);
  for (const [id, bucket, list] of [
    [FC, "gte-1k", [c, d(0), d(1), d(2), d(3), d(4), d(5)]],
    [FC, "gte-10k", [c, d(0), d(1), d(2)]],
    [FC, "gte-100k", [c, d(0)]],
    [OTHER, "gte-10k", [c, d(0), d(1), d(2)]],
  ]) {
    const a = await issue(id, bucket, list, ep);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(a.json.accepted, list.length, JSON.stringify(a.json));
  }
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  EP = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  assert.equal((await members(TEN)).members.length, 4);
  assert.equal((await members(HUNDRED)).members.length, 2);
  assert.equal((await members(ONE)).members.length, 7);
  assert.equal((await members(LOOKALIKE)).members.length, 4);
});

test("migration 24: zk_anon_casts.tree_size is a nullable INTEGER; the anon config serves the accepted reach issuers (public); ZK_ANON_REACH_ISSUERS narrows them, 'none' empties them, a blank value is the default", async () => {
  const col = db.prepare("PRAGMA table_info(zk_anon_casts)").all().find((c) => c.name === "tree_size");
  assert.ok(col, "tree_size column missing");
  assert.equal(col.type, "INTEGER");
  assert.equal(col.notnull, 0);
  assert.deepEqual({ ...db.prepare("SELECT version, name FROM schema_version WHERE version = 24").get() }, { version: 24, name: "zk_anon_casts_tree_size" });
  const cfg = (await api("GET", "/zk/anon-post/config?mode=fixture")).json;
  assert.deepEqual(cfg.reachIssuers, ["fc.reach", "x.reach"]);
  await withEnv({ ZK_ANON_REACH_ISSUERS: "fc.reach" }, async () => assert.deepEqual((await api("GET", "/zk/anon-post/config?mode=fixture")).json.reachIssuers, ["fc.reach"]));
  await withEnv({ ZK_ANON_REACH_ISSUERS: "none" }, async () => assert.deepEqual(zk.anonReachIssuers(), []));
  await withEnv({ ZK_ANON_REACH_ISSUERS: "  " }, async () => assert.deepEqual(zk.anonReachIssuers(), ["fc.reach", "x.reach"]));
  // the allowlist itself: the plain tree, the three reach buckets of an accepted issuer — nothing else
  assert.equal(zk.anonTreeAllowed("valid"), true);
  for (const t of [ONE, TEN, HUNDRED, "attest:x.reach/gte-10k"]) assert.equal(zk.anonTreeAllowed(t), true, t);
  for (const t of ["tier-2", "attest:fc.reach/gte-5k", LOOKALIKE, "attest:fc.reach", "fc.reach/gte-10k", ""]) assert.equal(zk.anonTreeAllowed(t), false, t);
  // the floor of a reach tree is never below ZK_ANON_FLOOR, and defaults to 50 whatever ZK_ANON_FLOOR says
  await withEnv({ ZK_REACH_FLOOR: undefined, ZK_ANON_FLOOR: "1" }, async () => assert.equal(zk.reachFloor(), 50));
  await withEnv({ ZK_REACH_FLOOR: "10", ZK_ANON_FLOOR: "60" }, async () => assert.equal(zk.reachFloor(), 60));
});

test("an ALLOWED reach tree at or above the floor is accepted and RECORDED with its tree and the frozen tree's size; the public list serves tree + treeSize", async () => {
  const env = await anonEnvelope(R, TEN, 0);
  const r = await submit(env);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = { ...db.prepare("SELECT * FROM zk_anon_casts WHERE mode = 'fixture' AND cast_hash = ?").get(env.publicInputs.castHash) };
  assert.equal(row.tree, TEN);
  assert.equal(row.tree_size, 4, "tree_size is the frozen tree's size at the post's epoch");
  assert.equal(row.tree_size, db.prepare("SELECT COUNT(*) AS n FROM zk_placements WHERE mode = 'fixture' AND tree = ? AND epoch = ?").get(TEN, EP).n);
  assert.equal(row.note, env.payload.note);
  const listed = (await api("GET", "/zk/anon-casts?mode=fixture")).json.casts.find((c) => c.castHash === env.publicInputs.castHash);
  assert.equal(listed.tree, TEN);
  assert.equal(listed.treeSize, 4);
  // a plain-tree post records ITS tree and size too (no boost, but the same row shape)
  const plain = await anonEnvelope(R, "valid", 1);
  assert.equal((await submit(plain)).status, 200);
  const prow = db.prepare("SELECT tree, tree_size FROM zk_anon_casts WHERE mode = 'fixture' AND cast_hash = ?").get(plain.publicInputs.castHash);
  assert.equal(prow.tree, "valid");
  assert.equal(prow.tree_size, 11);
});

test("a reach tree UNDER THE CROWD FLOOR is refused (400) before any nullifier is consumed, judged on the frozen tree's size; control: the same envelope is accepted once the floor is 2", async () => {
  const env = await anonEnvelope(R, HUNDRED, 2);
  const n0 = nullifierCount();
  const r = await submit(env);
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.match(r.json.error, /under the crowd floor/);
  assert.equal(nullifierCount(), n0, "the refusal consumed a nullifier");
  assert.equal(hasNullifier(env.nullifier), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM zk_anon_casts WHERE cast_hash = ?").get(env.publicInputs.castHash).n, 0);
  // MUTATION-STYLE CONTROL: only the floor changes, and the very same envelope verifies — the refusal was the floor
  await withEnv({ ZK_REACH_FLOOR: "2", ZK_ANON_FLOOR: "2" }, async () => {
    const ok = await submit(env);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
  });
  assert.equal(db.prepare("SELECT tree_size FROM zk_anon_casts WHERE cast_hash = ?").get(env.publicInputs.castHash).tree_size, 2);
});

test("a tree OUTSIDE the allowed set is refused (400) with nothing consumed: a tier tree, a non-reach issuer's lookalike bucket of a floor-clearing size, an undeclared bucket, and a reach issuer the validator does not accept; control: the accepted issuer list makes the last one verify", async () => {
  const n0 = nullifierCount();
  for (const [name, tree] of [["tier tree", "tier-1"], ["lookalike issuer", LOOKALIKE], ["undeclared bucket", "attest:fc.reach/gte-5k"]]) {
    const env = await anonEnvelope(R, tree, 3, tree === "attest:fc.reach/gte-5k" ? { members: { root: "0" } } : {});
    const r = await submit(env);
    assert.equal(r.status, 400, `${name}: ` + JSON.stringify(r.json));
    assert.equal(hasNullifier(env.nullifier), false, name);
  }
  assert.equal(nullifierCount(), n0);
  const one = await anonEnvelope(R, ONE, 3);
  await withEnv({ ZK_ANON_REACH_ISSUERS: "x.reach" }, async () => {
    const r = await submit(one);
    assert.equal(r.status, 400, "fc.reach accepted while the validator accepts only x.reach: " + JSON.stringify(r.json));
    assert.match(r.json.error, /claim binding/);
  });
  assert.equal(hasNullifier(one.nullifier), false);
  assert.equal((await submit(one)).status, 200, "the default issuer list did not accept fc.reach");
});

test("THE TREE IS NOT IN THE SCOPE: one (window, slot) proved under a reach tree and then under another tree carries the SAME real nullifier, and the second is a 409 replay that relays nothing", async () => {
  // slots 0..3 of this window are spent above; a new window gives four fresh ones
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  EP = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  const first = await anonEnvelope(R, TEN, 1);
  assert.equal((await submit(first)).status, 200);
  const rows = db.prepare("SELECT COUNT(*) AS n FROM zk_anon_casts WHERE mode = 'fixture'").get().n;
  for (const tree of ["valid", ONE]) {
    const again = await anonEnvelope(R, tree, 1);
    assert.equal(again.nullifier, first.nullifier, `the same (window, slot) under ${tree} gave a different nullifier — the tree is in the scope`);
    const r = await submit(again);
    assert.equal(r.status, 409, `${tree}: ` + JSON.stringify(r.json));
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM zk_anon_casts WHERE mode = 'fixture'").get().n, rows, "a replay relayed something");
  // and K posts in one window over DIFFERENT trees take K distinct nullifiers; the (K+1)th slot has no scope
  const spread = [await anonEnvelope(R, "valid", 0), await anonEnvelope(R, ONE, 2), await anonEnvelope(R, TEN, 3)];
  for (const e of spread) assert.equal((await submit(e)).status, 200);
  assert.equal(new Set([first, ...spread].map((e) => e.nullifier)).size, 4);
  const fifth = await anonEnvelope(R, ONE, 4);
  assert.equal((await submit(fifth)).status, 400, "a fifth slot verified");
});

test("THE BAND RULE (L3): a reach tier that leaves fewer than the floor in the tier BELOW it is refused (400) before any nullifier is consumed — the lower tier's posts would come from that small band (the default is the highest tier offered); judged on the frozen sizes; controls: the tier below is still accepted, and the same envelope verifies once the floor is low enough for its band", async () => {
  // the next epoch: gte-10k gains d3 and d4 (both already in gte-1k) — 6 of gte-1k's 7, a band of 1 under the floor of 3
  const ep = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  const d = (i) => decoy(i).commitment.toString(10);
  const a = await issue(FC, "gte-10k", [d(3), d(4)], ep);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  EP = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  assert.equal((await members(ONE)).members.length, 7);
  assert.equal((await members(TEN)).members.length, 6);
  const env = await anonEnvelope(R, TEN, 0);
  const n0 = nullifierCount();
  const r = await submit(env);
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.match(r.json.error, /attest:fc\.reach\/gte-10k tier would leave only 1 accounts in attest:fc\.reach\/gte-1k below it/);
  assert.equal(nullifierCount(), n0, "the band refusal consumed a nullifier");
  assert.equal(hasNullifier(env.nullifier), false);
  // the tier below (gte-1k: 7 of the plain tree's 11, a band of 4) is offerable and accepted
  assert.equal((await submit(await anonEnvelope(R, ONE, 1))).status, 200, "gte-1k (a band of 4 against the plain tree) was refused");
  // MUTATION-STYLE CONTROL: only the floor changes, and the very same envelope verifies — the refusal was the band
  await withEnv({ ZK_REACH_FLOOR: "1", ZK_ANON_FLOOR: "1" }, async () => {
    const ok = await submit(env);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
  });
});

// ------------------------------------------------------------------------------------------------------------------------
// PERSONA LAUNCH P5 (W2-MIGRATION-NONATOMIC) — THE MIGRATION RUNNER IS ATOMIC, and the wave-2 ADD COLUMN steps (24, 25) are
// idempotent. migrations.js is reach's file this wave, so its test lives here. Each scenario runs against the REAL module
// and against a MUTATED copy (the transaction, or the column guard, removed — written to a temp dir and required there,
// never the repo file); the mutated copy MUST fail its scenario, so neither check can pass vacuously.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDb } = require("../db");
const migrations = require("../migrations");

const colsOf = (d, t) => d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const tableExists = (d, t) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const versionRow = (d, v) => !!d.prepare("SELECT 1 FROM schema_version WHERE version = ?").get(v);

/** a mutated copy of validator/migrations.js (it requires nothing, so it loads from anywhere) */
function mutatedMigrations(edits) {
  let src = fs.readFileSync(path.join(__dirname, "..", "migrations.js"), "utf8");
  for (const [from, to] of edits) {
    assert.ok(src.includes(from), "mutation anchor not found (the mutation would be untested): " + from);
    src = src.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layers-migrations-mut-"));
  const f = path.join(dir, "migrations.js");
  fs.writeFileSync(f, src);
  try {
    return require(f);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const HALF = 9001;
/** an up() killed between two DDL statements: a new table, a new column, then the throw */
const halfUp = (d) => {
  d.exec("CREATE TABLE w2_half (id TEXT PRIMARY KEY)");
  d.exec("ALTER TABLE zk_anon_casts ADD COLUMN w2_half_col TEXT");
  throw new Error("killed half-way");
};
const wholeUp = (d) => {
  d.exec("CREATE TABLE w2_half (id TEXT PRIMARY KEY)");
  d.exec("ALTER TABLE zk_anon_casts ADD COLUMN w2_half_col TEXT");
};
/** the runner under test (`mod`) on a fully migrated database: the half-way failure leaves NOTHING, no transaction stays
 *  open, and the next boot runs the (fixed) migration from the start */
function atomicScenario(mod) {
  const d = openDb(":memory:");
  mod.MIGRATIONS.push({ version: HALF, name: "w2_half", up: halfUp });
  try {
    assert.throws(() => mod.migrate(d), /killed half-way/);
    assert.equal(tableExists(d, "w2_half"), false, "the failed migration's table survived the rollback");
    assert.equal(colsOf(d, "zk_anon_casts").includes("w2_half_col"), false, "the failed migration's column survived the rollback");
    assert.equal(versionRow(d, HALF), false, "the failed migration was recorded as applied");
    assert.equal(d.isTransaction, false, "migrate() left a transaction open after the failure");
    // the next boot, with the migration fixed: it runs from the start, once, and commits
    mod.MIGRATIONS[mod.MIGRATIONS.length - 1] = { version: HALF, name: "w2_half", up: wholeUp };
    const r = mod.migrate(d);
    assert.equal(r.ran, 1, "the re-run did not apply exactly the one migration");
    assert.ok(tableExists(d, "w2_half") && colsOf(d, "zk_anon_casts").includes("w2_half_col") && versionRow(d, HALF), "the re-run did not finish the migration");
    assert.equal(d.isTransaction, false);
  } finally {
    const i = mod.MIGRATIONS.findIndex((m) => m.version === HALF);
    if (i >= 0) mod.MIGRATIONS.splice(i, 1);
    d.close();
  }
}

test("W2-MIGRATION-NONATOMIC: an up() that throws half-way leaves no table, no column and no version row, holds no open transaction, and the next boot re-runs it to completion; CONTROL: run bare (the old runner) the same up() leaves half a schema whose re-run dies; MUTATION: the runner without its transaction fails this scenario", () => {
  // CONTROL — the scenario can tell a transactional runner from none: bare, the half-way up() leaves both steps behind
  const c = openDb(":memory:");
  assert.throws(() => halfUp(c), /killed half-way/);
  assert.ok(tableExists(c, "w2_half") && colsOf(c, "zk_anon_casts").includes("w2_half_col"), "control: a bare up() did not leave half a schema");
  assert.throws(() => wholeUp(c), /already exists|duplicate column/, "control: re-running the half-applied migration did not die (the boot loop the finding names)");
  c.close();
  // THE REAL RUNNER
  atomicScenario(migrations);
  // MUTATION — the runner's BEGIN / COMMIT / ROLLBACK removed: the scenario MUST go red
  const mut = mutatedMigrations([
    ['    db.exec("BEGIN IMMEDIATE");\n', ""],
    ['      db.exec("COMMIT");\n    } catch (e) {\n      // SQLite may', '    } catch (e) {\n      // SQLite may'],
    ['        db.exec("ROLLBACK");\n      } catch {\n        /* no transaction left', '      } catch {\n        /* no transaction left'],
  ]);
  assert.throws(() => atomicScenario(mut), /survived the rollback/, "the runner WITHOUT its transaction passed the atomicity scenario — the check is vacuous");
});

/** a database that crashed mid-24 / mid-25 under the OLD runner: the columns (and 25's tables) exist, the version rows do
 *  not. The next boot must finish both migrations, not die on its own ALTER TABLE. */
function crashRecoveryScenario(mod) {
  const d = openDb(":memory:");
  try {
    d.exec("DELETE FROM schema_version WHERE version IN (24, 25)");
    assert.ok(colsOf(d, "zk_anon_casts").includes("tree_size") && colsOf(d, "zk_anon_casts").includes("attributed_batch"), "setup: the columns are not there");
    const r = mod.migrate(d);
    assert.equal(r.ran, 2, "the crashed migrations were not re-applied");
    assert.ok(versionRow(d, 24) && versionRow(d, 25), "the re-run did not record 24 and 25");
    const cols = colsOf(d, "zk_anon_casts");
    assert.equal(cols.filter((x) => x === "tree_size").length, 1);
    assert.equal(cols.filter((x) => x === "attributed_batch").length, 1);
    for (const t of ["launch_queue", "sim_chain_fids", "zk_reveal_batches"]) assert.ok(tableExists(d, t), t + " missing after the re-run");
  } finally {
    d.close();
  }
}

test("W2-MIGRATION-NONATOMIC: a database that crashed mid-24/25 under the old runner (columns added, no version rows) boots: both re-run, nothing is added twice; CONTROL: the bare ALTER TABLE on it dies 'duplicate column'; MUTATION: the column guard removed fails this scenario", () => {
  const c = openDb(":memory:");
  assert.throws(() => c.exec("ALTER TABLE zk_anon_casts ADD COLUMN tree_size INTEGER"), /duplicate column/, "control: the unguarded ALTER did not refuse");
  assert.throws(() => c.exec("ALTER TABLE zk_anon_casts ADD COLUMN attributed_batch TEXT"), /duplicate column/, "control: the unguarded ALTER did not refuse");
  c.close();
  crashRecoveryScenario(migrations);
  const mut = mutatedMigrations([["  if (!has) db.exec(", "  void has;\n  db.exec("]]);
  assert.throws(() => crashRecoveryScenario(mut), /duplicate column/, "the migrations WITHOUT the column guard passed the crash-recovery scenario — the check is vacuous");
});

test("W2-MIGRATION-NONATOMIC: no migration opens its own transaction (SQLite has no nested BEGIN: 006 now runs inside the runner's), and a fresh database ends fully migrated with no transaction open", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "migrations.js"), "utf8");
  const tx = src.split("\n").filter((l) => /db\.exec\("(BEGIN|COMMIT|ROLLBACK)/.test(l)).map((l) => l.trim());
  // exactly the runner's three and migrateDown's three
  assert.deepEqual(tx.sort(), ['db.exec("BEGIN IMMEDIATE");', 'db.exec("BEGIN");', 'db.exec("COMMIT");', 'db.exec("COMMIT");', 'db.exec("ROLLBACK");', 'db.exec("ROLLBACK");'].sort(), "a migration opens its own transaction again (a nested BEGIN refuses to boot): " + tx.join(" | "));
  const d = openDb(":memory:");
  try {
    assert.equal(d.isTransaction, false);
    assert.ok(versionRow(d, 6) && versionRow(d, 25), "a fresh database is not fully migrated");
  } finally {
    d.close();
  }
});
