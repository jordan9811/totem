"use strict";
// ZK PASS 1 — validator zk surface unit tests, in-memory DB. Signatures
// are minted with node:crypto's native Ed25519 (a deliberate second
// implementation against the validator's verify path), and the canonical
// forms are duplicated in-file so a drift fails loudly.
process.env.ZK_DEV_HOOKS = "true";
process.env.ZK_ANON_FLOOR = "5";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign: cryptoSign, verify: cryptoVerify, createPublicKey, createHash, randomBytes } = require("node:crypto");
const { createApp } = require("../server");
const { Identity } = require("@semaphore-protocol/identity");
const { Group } = require("@semaphore-protocol/group");
const zk = require("../zk");

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

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function mkKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
}
const signHex = (canonical, privateKey) => cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const verifyHex = (sigHex, canonical, pubHex) =>
  cryptoVerify(
    null,
    Buffer.from(canonical, "utf8"),
    createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubHex, "hex")]), format: "der", type: "spki" }),
    Buffer.from(sigHex, "hex")
  );

// deliberate duplicates of validator/zk.js canonical forms
const registerCanonical = (mode, c, rootId, issuedAt) => ["layers-zk-register/1", mode, c, rootId, String(issuedAt)].join("|");
const placementCanonical = (p) =>
  ["layers-zk-placement/1", p.mode, p.tree, String(p.epoch), p.commitment, String(p.leafIndex), p.root].join("|");
const historyEntryHash = (e) =>
  createHash("sha256").update(["layers-zk-root-history/1", e.mode, e.tree, String(e.epoch), e.root, e.prevHash].join("|")).digest("hex");
const fixtureTag = (canonical, nullifier) =>
  createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
const canonicalPublicInputs = (p) =>
  ["layers-zk-public/1", p.mode, p.claimKind, p.tree, String(p.epoch), p.merkleTreeRoot, p.scope, p.message, p.personaId, p.gateId, p.challenge].join("|");
// THE CLAIM BINDING, duplicated: what scope / challenge / message MUST be
// for (persona, gate, epoch, root). validator/zk.js re-derives these and
// refuses anything else (attack-2 finding 1).
const fieldOf = (domain, canonical) => (BigInt("0x" + createHash("sha256").update(`layers-zk-field/1|${domain}|${canonical}`).digest("hex")) >> 8n).toString(10);
const scopeString = (feature, epoch, personaId) => `layers/zk-scope/v1|${feature}|${epoch}|${personaId}`;
function boundInputs(base) {
  const challenge = "epoch-" + base.epoch;
  return {
    ...base,
    challenge,
    scope: fieldOf("scope", scopeString("discovery-tier", base.epoch, base.personaId)),
    message: fieldOf("message", [base.personaId, base.gateId, challenge, base.merkleTreeRoot].join("|")),
  };
}
const fixtureEnvelope = (pub, nullifier) => ({ v: 1, mode: "fixture", claimKind: "tier-membership", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPublicInputs(pub), nullifier) } });

const anchor = mkKeys();
const identity = new Identity("zk-test-root");
const commitment = identity.commitment.toString(10);
let rootId;

test("SMALL-ORDER KEYS ARE NOT KEYS (found by the Gate 0 runner test): an all-zero public key with an all-zero signature 'verified' a quarter of all messages under node:crypto; the verify path refuses small-order / non-torsion-free keys, and an anchor cannot be registered under one", async () => {
  const { verifyEd25519 } = require("../crypto");
  const zero = "0".repeat(64);
  let accepted = 0;
  for (let i = 0; i < 64; i++) if (verifyEd25519("0".repeat(128), "layers-health/1|x|" + i, zero)) accepted++;
  assert.equal(accepted, 0, "a small-order key verified " + accepted + " of 64 messages");
  // the identity and the other canonical small-order encodings
  for (const bad of ["01" + "00".repeat(31), "ec" + "ff".repeat(30) + "7f", "00".repeat(31) + "80"]) {
    assert.equal(verifyEd25519("0".repeat(128), "anything", bad), false, bad.slice(0, 8));
  }
  const r = await api("POST", "/device/auth-anchor", { pubkey: zero });
  assert.notEqual(r.status, 201, "an anchor was registered under a small-order key");
});

test("setup: root + device-auth anchor", async () => {
  const r = await api("POST", "/roots", { fid: 424242, signerUuid: "zk-test-signer" });
  assert.equal(r.status, 201);
  rootId = r.json.rootId;
  const a = await api("POST", "/device/auth-anchor", { pubkey: anchor.pubHex });
  assert.equal(a.status, 201);
});

test("validator key is minted once and stable", async () => {
  const a = await api("GET", "/zk/validator-key");
  const b = await api("GET", "/zk/validator-key");
  assert.match(a.json.pubkey, /^[0-9a-f]{64}$/);
  assert.equal(a.json.pubkey, b.json.pubkey);
});

test("registration: refuses a bad signature, accepts the anchor's, is one-per-root and first-write-wins", async () => {
  const issuedAt = Date.now();
  const bad = await api("POST", "/zk/register", { mode: "fixture", commitment, rootId, issuedAt, signature: "ab".repeat(64) });
  assert.equal(bad.status, 403);
  const sig = signHex(registerCanonical("fixture", commitment, rootId, issuedAt), anchor.privateKey);
  const ok = await api("POST", "/zk/register", { mode: "fixture", commitment, rootId, issuedAt, signature: sig });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.activeFromEpoch, ok.json.epochRegistered + 1); // BATCHED
  // idempotent for the same (root, commitment)
  const again = await api("POST", "/zk/register", { mode: "fixture", commitment, rootId, issuedAt, signature: sig });
  assert.equal(again.status, 200);
  assert.equal(again.json.existing, true);
  // a DIFFERENT commitment for the same root → 409
  const other = new Identity("zk-test-root-2").commitment.toString(10);
  const t2 = Date.now();
  const s2 = signHex(registerCanonical("fixture", other, rootId, t2), anchor.privateKey);
  const dup = await api("POST", "/zk/register", { mode: "fixture", commitment: other, rootId, issuedAt: t2, signature: s2 });
  assert.equal(dup.status, 409);
  // the registration lookup never returns the root
  const reg = await api("GET", `/zk/registration?mode=fixture&commitment=${commitment}`);
  assert.equal(reg.json.registered, true);
  assert.equal(JSON.stringify(reg.json).includes(rootId), false);
});

test("batching: not a leaf this epoch; a leaf after the epoch advances; placement + history are signed and verify", async () => {
  const before = await api("GET", "/zk/members?mode=fixture&tree=valid");
  assert.equal(before.json.members.includes(commitment), false);
  const adv = await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  assert.equal(adv.status, 200);
  const after_ = await api("GET", "/zk/members?mode=fixture&tree=valid");
  assert.equal(after_.json.members.includes(commitment), true);
  assert.equal(after_.json.epoch, before.json.epoch + 1);
  // the served root equals a locally rebuilt LeanIMT root over the served members
  const g = new Group(after_.json.members.map((m) => BigInt(m)));
  assert.equal(g.root.toString(10), after_.json.root);
  // signed placement verifies against the validator key with the duplicate canonical
  const key = (await api("GET", "/zk/validator-key")).json.pubkey;
  const pl = await api("GET", `/zk/placement?mode=fixture&tree=valid&commitment=${commitment}`);
  assert.equal(pl.status, 200);
  const p = pl.json.placement;
  assert.equal(p.leafIndex, g.indexOf(identity.commitment));
  assert.equal(verifyHex(p.sig, placementCanonical(p), key), true);
  assert.equal(verifyHex(p.sig, placementCanonical({ ...p, leafIndex: p.leafIndex + 1 }), key), false);
  // signed, hash-chained history verifies; a tampered root breaks it
  const h = await api("GET", "/zk/history?mode=fixture&tree=valid");
  assert.equal(h.json.pubkey, key);
  const entries = h.json.entries;
  assert.ok(entries.length >= 2);
  let prev = null;
  for (const e of entries) {
    assert.equal(historyEntryHash(e), e.hash);
    assert.equal(verifyHex(e.sig, e.hash, key), true);
    if (prev) {
      assert.equal(e.prevHash, prev.hash);
      assert.ok(e.epoch > prev.epoch);
    }
    prev = e;
  }
  const tampered = { ...entries[entries.length - 1], root: "12345" };
  assert.notEqual(historyEntryHash(tampered), tampered.hash);
});

test("submit: fixture envelope accepted once, replay 409, tamper/wrong-root/unknown-kind/live refused", async () => {
  const ep = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  const members = (await api("GET", "/zk/members?mode=fixture&tree=valid")).json;
  const pub = boundInputs({ mode: "fixture", claimKind: "tier-membership", tree: "valid", epoch: ep, merkleTreeRoot: members.root, personaId: "p_test", gateId: "foryou" });
  const nullifier = "555555555";
  const env = fixtureEnvelope(pub, nullifier);
  const ok = await api("POST", "/zk/submit", { envelope: env });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const replay = await api("POST", "/zk/submit", { envelope: env });
  assert.equal(replay.status, 409);
  // tamper: message changed → the claim binding refuses before any proof is read
  const t = await api("POST", "/zk/submit", { envelope: { ...env, nullifier: "777", publicInputs: { ...pub, message: "1" } } });
  assert.equal(t.status, 400);
  assert.match(t.json.error, /canonical derivation/);
  // wrong root with a VALID tag AND a message bound to that wrong root (the
  // toy scheme is forgeable by design — the root check must stand on its own)
  const wrongPub = boundInputs({ ...pub, merkleTreeRoot: "42" });
  const w = await api("POST", "/zk/submit", { envelope: fixtureEnvelope(wrongPub, "888") });
  assert.equal(w.status, 400);
  assert.match(w.json.error, /signed history root/);
  // unknown kind fails closed
  const uk = await api("POST", "/zk/submit", { envelope: { ...env, claimKind: "everything", publicInputs: { ...pub, claimKind: "everything" } } });
  assert.equal(uk.status, 400);
  // a live-universe envelope with a fixture body is refused
  const lv = await api("POST", "/zk/submit", { envelope: { ...env, mode: "live", publicInputs: { ...pub, mode: "live" } } });
  assert.equal(lv.status, 400);
});

test("MULTI-FID Gate 4 — anon-post: an anon envelope (constant 'anon', window scope, cast-bound message, payload text) is accepted and RELAYED (a public row with no persona, no root, no nullifier); replay 409; a tampered payload, a re-hashed cast, a persona on the signal, a foreign tree and a plain claim carrying a payload are refused", async () => {
  const prevTree = process.env.ZK_ANON_POST_TREE;
  process.env.ZK_ANON_POST_TREE = "valid"; // the unit root is a leaf of `valid`; the predicate is the validator's own config
  try {
    const ep = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
    const members = (await api("GET", "/zk/members?mode=fixture&tree=valid")).json;
    const text = "anon unit " + Date.now().toString(36);
    const nonce = "ab".repeat(16);
    const castHash = createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + text, "utf8").digest("hex");
    const challenge = "epoch-" + ep;
    // the anoncast reveal pattern (MULTI-FID PASS): every anon post binds a commitment — sha256 of a
    // secret only the poster holds — so a reveal later can prove authorship; the unit's is fixed
    const revealSecret = "cd".repeat(32);
    const attributionCommitment = createHash("sha256").update("layers-anon-attribution/1|" + revealSecret, "utf8").digest("hex");
    // PERSONA LAUNCH P4 (R8): the 256-byte ring note every anon post carries (CSPRNG bytes: a post with no ring), its
    // sha256 over the RAW bytes bound into the message beside attr: and appended to the canonical tail after the slot
    const note = randomBytes(256).toString("hex");
    const noteHash = createHash("sha256").update(Buffer.from(note, "hex")).digest("hex");
    // PERSONA LAUNCH P3: the scope is qualified by the window AND the slot (w<n>/s<i>, i < K); the slot rides the
    // public inputs and the fixture tag binds it (canonical form: …|castHash|attributionCommitment|slot)
    const anonPub = (t, ch, slot = 0) => ({
      mode: "fixture", claimKind: "anon-post", tree: "valid", epoch: ep, merkleTreeRoot: members.root,
      scope: fieldOf("scope", `layers/zk-scope/v1|anon-post/w${Math.floor(ep / 1)}/s${slot}`), // Gate 5: the window replaces the epoch
      message: fieldOf("message", ["anon", "anon-post", "cast:" + ch, "attr:" + attributionCommitment, "note:" + noteHash, challenge, members.root].join("|")),
      personaId: "anon", gateId: "anon-post", challenge, castHash: ch, attributionCommitment, slot, noteHash,
    });
    const anonEnvelope = (pub, nullifier, payloadText) => ({ v: 1, mode: "fixture", claimKind: "anon-post", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPublicInputs(pub) + "|" + pub.castHash + "|" + pub.attributionCommitment + "|" + pub.slot + "|" + pub.noteHash, nullifier) }, payload: { text: payloadText, nonce, note } });
    const pub = anonPub(text, castHash);
    const env = anonEnvelope(pub, "777777777", text);
    const cfg = await api("GET", "/zk/anon-post/config?mode=fixture");
    assert.equal(cfg.json.tree, "valid");
    const ok = await api("POST", "/zk/submit", { envelope: env });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const listed = (await api("GET", "/zk/anon-casts?mode=fixture")).json.casts.find((c) => c.castHash === castHash);
    assert.ok(listed, "relayed row missing");
    assert.equal(listed.text, text);
    assert.match(listed.hash, /^0xanon[0-9a-f]{32}$/);
    assert.equal(listed.at % 3_600_000, 0, "relayed_at is hour-grained");
    // the public list's columns, EXACTLY (an allowlist): PERSONA LAUNCH P4/P5/P6 add the note, the tree, its frozen size
    // and the launch batch — never a slot, a persona, a root or a nullifier
    assert.deepEqual(Object.keys(listed).sort(), ["at", "attributedAt", "attributedBatch", "attributedFid", "attributedSigner", "castHash", "epoch", "fid", "hash", "note", "text", "tree", "treeSize"]);
    assert.equal(listed.attributedFid, null, "a fresh anon cast is attributed to no one");
    assert.equal(listed.attributedBatch, null, "a fresh anon cast belongs to no launch batch");
    assert.equal(listed.note, note, "the public list serves the note byte for byte");
    assert.equal(listed.tree, "valid");
    assert.equal(listed.treeSize, members.members.length, "treeSize is the frozen tree's size at the post's epoch");
    // PERSONA LAUNCH P3 (migration 21): the stored row records the tree the post proved; PERSONA LAUNCH P4: the note the
    // envelope carried; P5 (migration 24): the tree's size — and nothing about the slot
    const stored = { ...db.prepare("SELECT * FROM zk_anon_casts WHERE mode = 'fixture' AND cast_hash = ?").get(castHash) };
    assert.equal(stored.tree, "valid");
    assert.equal(stored.note, note);
    assert.equal(stored.tree_size, members.members.length);
    assert.equal(Object.keys(stored).some((k) => /slot|persona|root|nullifier/i.test(k)), false, "the anon row carries a slot, persona, root or nullifier column: " + Object.keys(stored).join(","));
    // the anoncast reveal pattern: a wrong secret is refused, the right one attributes it once, a
    // second persona is refused, the same persona again is a no-op. §14.2: the fid half of the claim
    // is signed by that fid's own Farcaster signer key over a statement binding mode|cast|fid|key.
    const kp = generateKeyPairSync("ed25519");
    const signerPubKey = kp.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
    const revealCanonical = (m, c, f, k) => ["layers-anon-reveal/1", m, c, String(f), k].join("|");
    const signReveal = (f, key = kp.privateKey, pub = signerPubKey) =>
      cryptoSign(null, Buffer.from(revealCanonical("fixture", castHash, f, pub), "utf8"), key).toString("hex");
    const unsigned = await api("POST", "/zk/anon/reveal", { mode: "fixture", castHash, secret: revealSecret, fid: 4242 });
    assert.equal(unsigned.status, 400, "a reveal with no signature is refused: " + JSON.stringify(unsigned.json));
    // a signature that is real but for a DIFFERENT fid must not transfer to this one (the fid is bound)
    const lifted = await api("POST", "/zk/anon/reveal", { mode: "fixture", castHash, secret: revealSecret, fid: 4242, signerPubKey, signature: signReveal(9999) });
    assert.equal(lifted.status, 400, "a signature for another fid does not verify here");
    const wrong = await api("POST", "/zk/anon/reveal", { mode: "fixture", castHash, secret: "11".repeat(32), fid: 4242, signerPubKey, signature: signReveal(4242) });
    assert.equal(wrong.status, 400, JSON.stringify(wrong.json));
    assert.equal((await api("GET", "/zk/anon-casts?mode=fixture")).json.casts.find((c) => c.castHash === castHash).attributedFid, null);
    const revealed = await api("POST", "/zk/anon/reveal", { mode: "fixture", castHash, secret: revealSecret, fid: 4242, signerPubKey, signature: signReveal(4242) });
    assert.equal(revealed.status, 200, JSON.stringify(revealed.json));
    assert.equal(revealed.json.attributedFid, 4242);
    const row = (await api("GET", "/zk/anon-casts?mode=fixture")).json.casts.find((c) => c.castHash === castHash);
    assert.equal(row.attributedFid, 4242);
    assert.equal(row.attributedSigner, signerPubKey, "the key the claim verified under is carried to the reader");
    assert.equal(row.attributedAt % 3_600_000, 0, "attributedAt is hour-grained");
    const otherKp = generateKeyPairSync("ed25519");
    const otherPub = otherKp.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
    const otherFid = await api("POST", "/zk/anon/reveal", { mode: "fixture", castHash, secret: revealSecret, fid: 9999, signerPubKey: otherPub, signature: signReveal(9999, otherKp.privateKey, otherPub) });
    assert.equal(otherFid.status, 409, "one reveal, ever");
    const again = await api("POST", "/zk/anon/reveal", { mode: "fixture", castHash, secret: revealSecret, fid: 4242, signerPubKey, signature: signReveal(4242) });
    assert.equal(again.status, 200);
    assert.equal(again.json.alreadyAttributed, true);
    assert.equal((await api("POST", "/zk/submit", { envelope: env })).status, 409);
    const tampered = await api("POST", "/zk/submit", { envelope: { ...env, nullifier: "777777778", payload: { text: text + "!", nonce, note } } });
    assert.equal(tampered.status, 400);
    assert.match(tampered.json.error, /tamper|hash/);
    const other = "anon swapped";
    const rehashed = await api("POST", "/zk/submit", { envelope: anonEnvelope({ ...pub, castHash: createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + other, "utf8").digest("hex") }, "777777779", other) });
    assert.equal(rehashed.status, 400, "the message still binds the first cast");
    const personaOnSignal = await api("POST", "/zk/submit", { envelope: { ...env, nullifier: "777777780", publicInputs: { ...pub, personaId: "p_test" } } });
    assert.equal(personaOnSignal.status, 400);
    assert.match(personaOnSignal.json.error, /anon/);
    const foreignTree = await api("POST", "/zk/submit", { envelope: { ...env, nullifier: "777777781", publicInputs: { ...pub, tree: "tier-1" } } });
    assert.equal(foreignTree.status, 400);
    const plainWithPayload = await api("POST", "/zk/submit", { envelope: { ...fixtureEnvelope(boundInputs({ mode: "fixture", claimKind: "tier-membership", tree: "valid", epoch: ep, merkleTreeRoot: members.root, personaId: "p_test2", gateId: "foryou" }), "777777782"), payload: { text, nonce } } });
    assert.equal(plainWithPayload.status, 400);
    assert.match(plainWithPayload.json.error, /payload/);
    assert.equal((await api("GET", "/zk/anon-casts?mode=fixture")).json.casts.length, 1, "nothing else was relayed");
  } finally {
    if (prevTree === undefined) delete process.env.ZK_ANON_POST_TREE;
    else process.env.ZK_ANON_POST_TREE = prevTree;
  }
});

test("THE CLAIM BINDING (attack-2 #1/#3): a valid proof cannot name another persona, mint a fresh scope, or be replayed under a padded nullifier", async () => {
  const ep = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  const members = (await api("GET", "/zk/members?mode=fixture&tree=valid")).json;
  const base = { mode: "fixture", claimKind: "tier-membership", tree: "valid", epoch: ep, merkleTreeRoot: members.root, gateId: "foryou" };
  const forA = boundInputs({ ...base, personaId: "p_bind_a" });
  // 1. proof material for A, envelope names B → refused, and B gets nothing
  const namesB = { ...forA, personaId: "p_bind_b" };
  const r1 = await api("POST", "/zk/submit", { envelope: fixtureEnvelope(namesB, "600001") });
  assert.equal(r1.status, 400);
  assert.match(r1.json.error, /canonical derivation/);
  // 2. same persona, a fresh scope (would be a fresh nullifier) → refused
  const freshScope = { ...forA, scope: (BigInt(forA.scope) + 1n).toString(10) };
  const r2 = await api("POST", "/zk/submit", { envelope: fixtureEnvelope(freshScope, "600002") });
  assert.equal(r2.status, 400);
  assert.match(r2.json.error, /canonical derivation/);
  // 3. wrong challenge → refused
  const r3 = await api("POST", "/zk/submit", { envelope: fixtureEnvelope({ ...forA, challenge: "epoch-" + (ep + 1) }, "600003") });
  assert.equal(r3.status, 400);
  // 4. the honest envelope is accepted exactly once …
  const ok = await api("POST", "/zk/submit", { envelope: fixtureEnvelope(forA, "600004") });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // … and a LEADING-ZERO copy of its nullifier is not a fresh nullifier (non-canonical → refused, never inserted)
  const padded = await api("POST", "/zk/submit", { envelope: fixtureEnvelope(forA, "0600004") });
  assert.equal(padded.status, 400);
  assert.match(padded.json.error, /canonical/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM zk_nullifiers WHERE mode = 'fixture' AND nullifier IN ('600004','0600004')").get().n, 1);
  // 5. a non-canonical scope encoding is refused too
  const r5 = await api("POST", "/zk/submit", { envelope: fixtureEnvelope({ ...forA, scope: "0" + forA.scope }, "600005") });
  assert.equal(r5.status, 400);
});

test("anonymity floor: decoys (batched to the next epoch) push the valid tree over the floor; a top tier stays under; the frozen epoch's root did not move", async () => {
  const rootBefore = (await api("GET", "/zk/trees?mode=fixture")).json.trees.find((t) => t.tree === "valid").root;
  const seeded = await api("POST", "/zk/dev/seed-decoys", { mode: "fixture", count: 8 });
  assert.equal(seeded.status, 200);
  assert.equal(seeded.json.inserted, 8);
  // FROZEN EPOCH: seeding does not change this epoch's served root
  assert.equal((await api("GET", "/zk/trees?mode=fixture")).json.trees.find((t) => t.tree === "valid").root, rootBefore);
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  const trees = (await api("GET", "/zk/trees?mode=fixture")).json.trees;
  const valid = trees.find((t) => t.tree === "valid");
  assert.ok(valid.size >= 5);
  assert.equal(valid.clearsFloor, true);
  const top = trees.find((t) => t.tree === "tier-10");
  assert.equal(top.clearsFloor, top.size >= 5);
});

test("Gate 2: a verified tier-tree submission records eligibility at that tier for the epoch (+ grace); the map endpoint lists it; a valid-tree proof grants no tier", async () => {
  const ep = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  const tierTree = (await api("GET", "/zk/trees?mode=fixture")).json.trees.find((t) => t.tree === "tier-1");
  const pub = boundInputs({ mode: "fixture", claimKind: "tier-membership", tree: "tier-1", epoch: ep, merkleTreeRoot: tierTree.root, personaId: "p_elig", gateId: "foryou" });
  const env = fixtureEnvelope(pub, "424242");
  const ok = await api("POST", "/zk/submit", { envelope: env });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const one = await api("GET", "/zk/eligibility?mode=fixture&gateId=foryou&personaId=p_elig");
  assert.equal(one.json.eligibility.tier, 1);
  assert.equal(one.json.eligibility.epoch, ep);
  const map = await api("GET", "/zk/eligibility?mode=fixture&gateId=foryou");
  assert.equal(map.json.tiers.p_elig, 1);
  // grace: still eligible one epoch later, gone two epochs later
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  assert.equal((await api("GET", "/zk/eligibility?mode=fixture&gateId=foryou&personaId=p_elig")).json.eligibility?.tier, 1);
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  assert.equal((await api("GET", "/zk/eligibility?mode=fixture&gateId=foryou&personaId=p_elig")).json.eligibility, null);
  // a `valid`-tree membership proves non-revocation only: no tier
  const ep2 = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  const valid = (await api("GET", "/zk/members?mode=fixture&tree=valid")).json;
  const pub2 = boundInputs({ ...pub, tree: "valid", epoch: ep2, merkleTreeRoot: valid.root, personaId: "p_valid_only" });
  const env2 = fixtureEnvelope(pub2, "434343");
  assert.equal((await api("POST", "/zk/submit", { envelope: env2 })).status, 200);
  assert.equal((await api("GET", "/zk/eligibility?mode=fixture&gateId=foryou&personaId=p_valid_only")).json.eligibility, null);
});

test("Gate 2 LIVE: a real Semaphore v4 proof is verified by the validator; a tampered one is refused (skips without cached artifacts)", async (t) => {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "..", "..", ".zk-artifacts");
  const wasm = path.join(dir, "semaphore-20.wasm");
  const zkey = path.join(dir, "semaphore-20.zkey");
  if (!fs.existsSync(wasm) || !fs.existsSync(zkey)) return t.skip("no cached artifacts (run npm run bench:zk once)");
  const { generateProof } = require("@semaphore-protocol/proof");
  // register a LIVE-universe root and make it a tier-1 leaf
  const liveId = new Identity("zk-test-live-root");
  const liveC = liveId.commitment.toString(10);
  const rootLive = (await api("POST", "/roots", { fid: 434343, signerUuid: "zk-live-signer" })).json.rootId;
  const issuedAt = Date.now();
  const sig = signHex(registerCanonical("live", liveC, rootLive, issuedAt), anchor.privateKey);
  assert.equal((await api("POST", "/zk/register", { mode: "live", commitment: liveC, rootId: rootLive, issuedAt, signature: sig })).status, 201);
  await api("POST", "/zk/dev/advance-epoch", { mode: "live" });
  const ep = (await api("GET", "/zk/epoch?mode=live")).json.epoch;
  const members = (await api("GET", "/zk/members?mode=live&tree=tier-1")).json;
  assert.ok(members.members.includes(liveC));
  const group = new Group(members.members.map((m) => BigInt(m)));
  // the REAL claim binding: scope and message are the derivations for
  // (p_live, foryou, epoch, root) — anything else is refused before groth16
  const bound = boundInputs({ mode: "live", claimKind: "tier-membership", tree: "tier-1", epoch: ep, merkleTreeRoot: members.root, personaId: "p_live", gateId: "foryou" });
  const proof = await generateProof(liveId, group, BigInt(bound.message), BigInt(bound.scope), 20, { wasm, zkey });
  assert.equal(String(proof.merkleTreeRoot), members.root);
  const env = { v: 1, mode: "live", claimKind: "tier-membership", publicInputs: bound, nullifier: String(proof.nullifier), proof: { scheme: "semaphore-v4", merkleTreeDepth: proof.merkleTreeDepth, points: proof.points.map(String) } };
  // a tampered message fails the claim binding (before groth16 is even run)
  const tampered = await api("POST", "/zk/submit", { envelope: { ...env, publicInputs: { ...bound, message: "1" } } });
  assert.equal(tampered.status, 400);
  assert.match(tampered.json.error, /canonical derivation/);
  // a proof for persona A cannot be re-labelled as persona B: the binding refuses
  const relabelled = await api("POST", "/zk/submit", { envelope: { ...env, publicInputs: { ...bound, personaId: "p_live_other" } } });
  assert.equal(relabelled.status, 400);
  assert.match(relabelled.json.error, /canonical derivation/);
  // tampered proof POINTS fail groth16 against the PINNED key
  const points = [...env.proof.points];
  points[0] = (BigInt(points[0]) + 1n).toString(10);
  const badPoints = await api("POST", "/zk/submit", { envelope: { ...env, proof: { ...env.proof, points } } });
  assert.equal(badPoints.status, 400);
  assert.match(badPoints.json.error, /groth16/);
  const good = await api("POST", "/zk/submit", { envelope: env });
  assert.equal(good.status, 200, JSON.stringify(good.json));
  assert.equal((await api("GET", "/zk/eligibility?mode=live&gateId=foryou&personaId=p_live")).json.eligibility.tier, 1);
  assert.equal((await api("POST", "/zk/submit", { envelope: env })).status, 409);
  // a padded copy of the live nullifier is refused, never a fresh row
  const padded = await api("POST", "/zk/submit", { envelope: { ...env, nullifier: "0" + env.nullifier } });
  assert.equal(padded.status, 400);
});

// snarkjs (via ffjavascript) keeps a worker pool alive on globalThis after
// the first prove/verify; without terminating it the test process never
// exits and the runner hangs. Terminate it here, after everything.
after(async () => {
  const curve = globalThis.curve_bn128;
  if (curve && typeof curve.terminate === "function") await curve.terminate();
});

test("dev hooks are refused when disabled (the plain submit door included); reset is fixture-only", async () => {
  process.env.ZK_DEV_HOOKS = "false";
  const r = await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  assert.equal(r.status, 403);
  const door = await api("POST", "/zk/submit", { envelope: { v: 1 } });
  assert.equal(door.status, 403);
  process.env.ZK_DEV_HOOKS = "true";
  const live = await api("POST", "/zk/dev/reset", { mode: "live" });
  assert.equal(live.status, 400);
});

test("eligibility reads take the device envelope when the deployment is armed (attack-1 #5 / attack-3 F-9)", async () => {
  // server.js reads LAYERS_REQUIRE_SIG at module load, so mount the zk
  // surface on a second express app with an ARMED envelope check that
  // refuses everything: the map and the single lookup are then refused,
  // public material stays public.
  const { mountZk } = require("../zk");
  const express = require("express");
  const app2 = express();
  app2.use(express.json());
  mountZk(app2, createApp(":memory:").db, { requireSig: true, checkEnvelope: () => ({ status: 401, error: "signed envelope required" }) });
  const srv = await new Promise((resolve) => {
    const s = app2.listen(0, () => resolve(s));
  });
  try {
    const port = srv.address().port;
    assert.equal((await fetch(`http://127.0.0.1:${port}/zk/eligibility?mode=fixture&gateId=foryou`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/zk/eligibility?mode=fixture&gateId=foryou&personaId=p_x`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/zk/trees?mode=fixture`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/zk/members?mode=fixture&tree=valid`)).status, 200);
  } finally {
    srv.close();
  }
});

// ---------- ATTESTATION PASS Gate 1: the open issuer interface ----------
// deliberate duplicates of validator/zk.js / lib/attest/canonical.ts
const issuerCanonical = (i) => ["layers-zk-issuer/1", i.mode, i.id, i.displayName, i.schemaHash, i.buckets.join(","), String(i.validityEpochs), i.pubkey].join("|");
const attestCanonical2 = (a) => ["layers-zk-attest/2", a.mode, a.issuer, a.bucket, a.commitment, a.claimHash, String(a.issuedEpoch), String(a.expiresEpoch)].join("|");
const attestRevokeCanonical = (r) => ["layers-zk-attest-revoke/1", r.mode, r.issuer, r.bucket, r.commitment, String(r.issuedAt)].join("|");
const issuerKeys = mkKeys();
const ISSUER = "test.unit-issuer";
const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } } };
const BUCKETS = ["any", "alt"];
const schemaHash = (schema) => createHash("sha256").update(JSON.stringify(schema)).digest("hex");
function registerIssuer(over = {}) {
  const b = { mode: "fixture", id: ISSUER, displayName: "Unit issuer", claimSchema: SCHEMA, buckets: BUCKETS, validityEpochs: 3, pubkey: issuerKeys.pubHex, ...over };
  const canonical = issuerCanonical({ mode: b.mode, id: b.id, displayName: b.displayName, schemaHash: schemaHash(b.claimSchema), buckets: b.buckets, validityEpochs: b.validityEpochs, pubkey: b.pubkey });
  const { sig, privateKey, ...body } = { sig: undefined, privateKey: issuerKeys.privateKey, ...b };
  return api("POST", "/zk/issuers", { ...body, sig: sig ?? signHex(canonical, privateKey) });
}
const attestSubmitCanonical = (mode, partsJson, issuedAt) => ["layers-zk-attest-submit/1", mode, createHash("sha256").update(partsJson).digest("hex"), String(issuedAt)].join("|");
/** Gate 4: the batch is signed by the subject's device-auth key (the anchor) */
function postAttest(body) {
  const list = body.attestations ?? [body];
  const issuedAt = Date.now();
  const partsJson = JSON.stringify(list);
  return api("POST", "/zk/attest", { mode: "fixture", attestations: list, issuedAt, signature: signHex(attestSubmitCanonical("fixture", partsJson, issuedAt), anchor.privateKey) });
}
function issuance(commitmentStr, bucket, issuedEpoch, over = {}) {
  const claimHash = createHash("sha256").update("unit-claim|" + bucket + "|" + commitmentStr).digest("hex");
  // validity 3 → expiry = issued + 1 + 3 (quantized to the issue epoch)
  const a = { issuer: ISSUER, bucket, commitment: commitmentStr, claimHash, issuedEpoch, expiresEpoch: issuedEpoch + 4, ...over };
  return { ...a, sig: over.sig ?? signHex(attestCanonical2({ mode: "fixture", ...a }), over.privateKey ?? issuerKeys.privateKey) };
}

test("Gate 1 REGISTRY: open, self-signed registration (201); a bad signature is refused; the same id under ANOTHER key is 409; the same key re-registers as an update (200); the list is public and hour-grained", async () => {
  const bad = await registerIssuer({ sig: "0".repeat(128) });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /signature/);
  const first = await registerIssuer();
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.registeredAt % 3_600_000, 0);
  const other = mkKeys();
  const taken = await registerIssuer({ pubkey: other.pubHex, privateKey: other.privateKey });
  assert.equal(taken.status, 409);
  const again = await registerIssuer({ displayName: "Unit issuer (renamed)" });
  assert.equal(again.status, 200);
  assert.equal(again.json.existing, true);
  const list = await api("GET", "/zk/issuers?mode=fixture");
  const me = list.json.issuers.find((i) => i.id === ISSUER);
  assert.ok(me);
  assert.equal(me.displayName, "Unit issuer (renamed)");
  assert.deepEqual(me.buckets, BUCKETS);
  assert.equal(me.pubkey, issuerKeys.pubHex);
  assert.equal(me.trustTier, "attested");
  const malformed = await registerIssuer({ id: "Bad_Id" });
  assert.equal(malformed.status, 400);
});

test("Gate 1 ISSUANCE: issuer-signed and verified under the registered key; undeclared bucket / per-subject expiry / tampered signature / unknown issuer refused BY INDEX; the leaf enters attest:<issuer>/<bucket> NEXT epoch; the stored row holds a hash and never a value", async () => {
  const ep = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  const good = issuance(commitment, "any", ep);
  const r = await postAttest({
    mode: "fixture",
    attestations: [
      good,
      issuance(commitment, "undeclared", ep),
      issuance(commitment, "any", ep, { expiresEpoch: ep + 5 }),
      { ...good, sig: (good.sig[0] === "0" ? "1" : "0") + good.sig.slice(1) },
      issuance(commitment, "any", ep, { issuer: "test.nobody" }),
      issuance("12345", "any", ep),
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.accepted, 1);
  assert.deepEqual(r.json.refused.map((x) => x.i), [1, 2, 3, 4, 5]);
  assert.match(r.json.refused[0].error, /bucket/);
  assert.match(r.json.refused[1].error, /quantized|expiresEpoch/);
  assert.match(r.json.refused[2].error, /signature/);
  assert.match(r.json.refused[3].error, /not registered/);
  assert.match(r.json.refused[4].error, /commitment/);
  assert.equal(r.json.activeFromEpoch, ep + 1);
  // batched: not a tree this epoch (never issued), a tree next epoch with our leaf
  const before = (await api("GET", "/zk/trees?mode=fixture")).json.trees.find((t) => t.tree === "attest:" + ISSUER + "/any");
  assert.ok(!before || before.size === 0);
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  const members = await api("GET", "/zk/members?mode=fixture&tree=" + encodeURIComponent("attest:" + ISSUER + "/any"));
  assert.equal(members.status, 200);
  assert.ok(members.json.members.includes(commitment));
  const census = (await api("GET", "/zk/attest/buckets?mode=fixture")).json.buckets.find((b) => b.issuer === ISSUER && b.bucket === "any");
  assert.equal(census.size, 1);
  // the row: hash + epochs, the issuer's signature; nothing else
  const row = db.prepare("SELECT * FROM zk_attestations WHERE mode = 'fixture' AND issuer = ? AND bucket = 'any' AND commitment = ?").get(ISSUER, commitment);
  assert.equal(row.claim_hash, good.claimHash);
  assert.equal(row.active_from_epoch, ep + 1);
  assert.equal(row.expires_epoch, ep + 4);
  assert.equal(row.revoked_from_epoch, null);
  assert.equal(row.created_at % 3_600_000, 0);
  assert.equal(Object.keys({ ...row }).some((k) => /value|wallet|address/i.test(k)), false);
  const read = (await api("GET", "/zk/attestations?mode=fixture&commitment=" + commitment)).json;
  const mine = read.attestations.find((a) => a.issuer === ISSUER && a.bucket === "any");
  assert.equal(mine.activeNow, true);
});

test("Gate 1 CLAIM + REVOCATION: an attestation proof records (persona, issuer, BUCKET); the same persona's proof in a second bucket is a distinct nullifier (accepted), the same one is a replay; a signed issuer revocation drops exactly that leaf next epoch and the attested read lapses", async () => {
  // a second bucket for our commitment, active next epoch; "any" renewed
  // alongside it (a renewal of an ACTIVE issuance keeps its activation epoch)
  const ep0 = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  assert.equal((await postAttest({ mode: "fixture", attestations: [issuance(commitment, "alt", ep0), issuance(commitment, "any", ep0)] })).json.accepted, 2);
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  const ep = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  const submitAttest = async (bucket, nullifier) => {
    const tree = "attest:" + ISSUER + "/" + bucket;
    const m = (await api("GET", "/zk/members?mode=fixture&tree=" + encodeURIComponent(tree))).json;
    const challenge = "epoch-" + ep;
    const pub = {
      mode: "fixture",
      claimKind: "attestation",
      tree,
      epoch: ep,
      merkleTreeRoot: m.root,
      personaId: "p_attest",
      gateId: tree,
      challenge,
      issuer: ISSUER,
      bucket,
      scope: fieldOf("scope", scopeString("attestation/" + ISSUER + "/" + bucket, ep, "p_attest")),
      message: fieldOf("message", ["p_attest", tree, tree, challenge, m.root].join("|")),
    };
    const env = { v: 1, mode: "fixture", claimKind: "attestation", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPublicInputs(pub), nullifier) } };
    return api("POST", "/zk/submit", { envelope: env });
  };
  assert.equal((await submitAttest("any", "515151")).status, 200);
  assert.equal((await submitAttest("any", "515151")).status, 409);
  assert.equal((await submitAttest("alt", "525252")).status, 200);
  const at = await api("GET", "/zk/attested?mode=fixture&personaId=p_attest&issuer=" + ISSUER);
  assert.equal(at.json.attested, true);
  assert.deepEqual([...at.json.buckets].sort(), ["alt", "any"]);
  const one = await api("GET", "/zk/attested?mode=fixture&personaId=p_attest&issuer=" + ISSUER + "&bucket=alt");
  assert.equal(one.json.attested, true);
  const map = await api("GET", "/zk/attested-map?mode=fixture");
  assert.ok(map.json.claims.p_attest.includes(ISSUER + "/any") && map.json.claims.p_attest.includes(ISSUER + "/alt"));
  const rows = db.prepare("SELECT bucket, nullifier FROM zk_attestation_claims WHERE mode = 'fixture' AND persona_id = 'p_attest'").all();
  assert.equal(new Set(rows.map((r) => r.nullifier)).size, 2);
  // a mismatched bucket in the tree name is refused before the binding
  const bad = await (async () => {
    const tree = "attest:" + ISSUER + "/any";
    const m = (await api("GET", "/zk/members?mode=fixture&tree=" + encodeURIComponent(tree))).json;
    const pub = { mode: "fixture", claimKind: "attestation", tree, epoch: ep, merkleTreeRoot: m.root, personaId: "p_attest2", gateId: tree, challenge: "epoch-" + ep, issuer: ISSUER, bucket: "alt", scope: "1", message: "1" };
    return api("POST", "/zk/submit", { envelope: { v: 1, mode: "fixture", claimKind: "attestation", publicInputs: pub, nullifier: "535353", proof: { scheme: "layers-zk-fixture/1", tag: "x" } } });
  })();
  assert.equal(bad.status, 400);
  // revocation: signed by the issuer, effective next epoch, idempotent
  const issuedAt = Date.now();
  const rv = { mode: "fixture", issuer: ISSUER, bucket: "any", commitment, issuedAt };
  const badRv = await api("POST", "/zk/attest/revoke", { ...rv, sig: "0".repeat(128) });
  assert.equal(badRv.status, 400);
  const okRv = await api("POST", "/zk/attest/revoke", { ...rv, sig: signHex(attestRevokeCanonical(rv), issuerKeys.privateKey) });
  assert.equal(okRv.status, 200, JSON.stringify(okRv.json));
  assert.equal(okRv.json.revokedFromEpoch, ep + 1);
  const twice = await api("POST", "/zk/attest/revoke", { ...rv, sig: signHex(attestRevokeCanonical(rv), issuerKeys.privateKey) });
  assert.equal(twice.json.existing, true);
  // Gate 4 (attack-att-1 #4): no issue-epoch grace — an issuance from an earlier epoch is refused outright
  const stale = await postAttest({ attestations: [issuance(commitment, "any", ep0)] });
  assert.equal(stale.json.accepted, 0);
  assert.match(stale.json.refused[0].error, /current epoch/);
  // this epoch's tree is frozen; next epoch the leaf is gone (alt still there)
  assert.ok((await api("GET", "/zk/members?mode=fixture&tree=" + encodeURIComponent("attest:" + ISSUER + "/any"))).json.members.includes(commitment));
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  const anyAfter = await api("GET", "/zk/members?mode=fixture&tree=" + encodeURIComponent("attest:" + ISSUER + "/any"));
  assert.ok(anyAfter.status === 404 || !anyAfter.json.members.includes(commitment));
  assert.ok((await api("GET", "/zk/members?mode=fixture&tree=" + encodeURIComponent("attest:" + ISSUER + "/alt"))).json.members.includes(commitment));
  // the mark keeps its one-epoch grace, then lapses
  assert.equal((await api("GET", "/zk/attested?mode=fixture&personaId=p_attest&issuer=" + ISSUER + "&bucket=any")).json.attested, true);
  await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
  assert.equal((await api("GET", "/zk/attested?mode=fixture&personaId=p_attest&issuer=" + ISSUER + "&bucket=any")).json.attested, false);
  // Gate 4 (attack-att-3 #4): a revocation is not undone by replaying the ORIGINAL issuance —
  // a fresh same-epoch issuance, revoked, then re-posted byte for byte, stays revoked
  const epNow = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  const fresh = issuance(commitment, "alt", epNow);
  assert.equal((await postAttest({ attestations: [fresh] })).json.accepted, 1);
  const rvAlt = { mode: "fixture", issuer: ISSUER, bucket: "alt", commitment, issuedAt: Date.now() };
  assert.equal((await api("POST", "/zk/attest/revoke", { ...rvAlt, sig: signHex(attestRevokeCanonical(rvAlt), issuerKeys.privateKey) })).status, 200);
  const replay = await postAttest({ attestations: [fresh] });
  assert.equal(replay.json.accepted, 0);
  assert.match(replay.json.refused[0].error, /revoked/);
  // an unsigned batch is refused outright (Gate 4: the subject's device signs what it submits)
  const unsigned = await api("POST", "/zk/attest", { mode: "fixture", attestations: [fresh] });
  assert.ok(unsigned.status === 400 || unsigned.status === 403);
});

// ---------- PERSONA LAUNCH wave 2 (reach track, step 1): the ring-note seam (P4) and the launch-request seam (P6) ----------
// The envelopes below are built by hand with the canonical forms DUPLICATED here (a drift on either side fails), over
// the plain anon tree `valid` (the validator's configured predicate for these tests) at the CURRENT epoch.
const canonicalAnonP4 = (p) => canonicalPublicInputs(p) + "|" + p.castHash + "|" + p.attributionCommitment + "|" + p.slot + "|" + (p.noteHash || "");
const canonicalLaunch = (p) => canonicalPublicInputs(p) + "|" + (p.launchCommit || "");
const noteHashOf = (note) => createHash("sha256").update(Buffer.from(note, "hex")).digest("hex");
async function anonP4Envelope({ slot, nullifier, note = randomBytes(256).toString("hex"), noteHash, extra = {} }) {
  const ep = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
  const m = (await api("GET", "/zk/members?mode=fixture&tree=valid")).json;
  const text = "p4 note " + nullifier;
  const nonce = createHash("sha256").update("p4|" + text).digest("hex").slice(0, 32);
  const castHash = createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + text, "utf8").digest("hex");
  const attributionCommitment = createHash("sha256").update("layers-anon-attribution/1|" + "ef".repeat(32) + nullifier, "utf8").digest("hex");
  const nh = noteHash ?? noteHashOf(note);
  const challenge = "epoch-" + ep;
  const pub = {
    mode: "fixture", claimKind: "anon-post", tree: "valid", epoch: ep, merkleTreeRoot: m.root,
    scope: fieldOf("scope", `layers/zk-scope/v1|anon-post/w${ep}/s${slot}`),
    message: fieldOf("message", ["anon", "anon-post", "cast:" + castHash, "attr:" + attributionCommitment, "note:" + nh, challenge, m.root].join("|")),
    personaId: "anon", gateId: "anon-post", challenge, castHash, attributionCommitment, slot, noteHash: nh,
  };
  return { v: 1, mode: "fixture", claimKind: "anon-post", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalAnonP4(pub), nullifier) }, payload: { text, nonce, note }, ...extra };
}
const retag = (env) => ({ ...env, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(env.claimKind === "persona-launch" ? canonicalLaunch(env.publicInputs) : canonicalAnonP4(env.publicInputs), env.nullifier) } });
const nullifierStored = (n) => !!db.prepare("SELECT 1 FROM zk_nullifiers WHERE mode = 'fixture' AND nullifier = ?").get(n);

test("PERSONA LAUNCH P4 — THE RING NOTE: an anon post with no note, a note of the wrong size or case, an extra payload key, or a note that does not hash to the bound noteHash is refused (400) with nothing consumed; a noteHash on a plain claim is refused; control: the honest envelope is accepted with its note stored byte for byte; two posts' notes swapped fail both", async () => {
  const prevTree = process.env.ZK_ANON_POST_TREE;
  process.env.ZK_ANON_POST_TREE = "valid";
  try {
    await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" }); // a fresh window: every slot free
    const good = await anonP4Envelope({ slot: 1, nullifier: "8410001" });
    const { note, ...noNote } = good.payload;
    const otherNote = randomBytes(256).toString("hex");
    const variants = [
      ["no note", { ...good, payload: noNote }],
      ["a 255-byte note", { ...good, payload: { ...good.payload, note: note.slice(0, 510) } }],
      ["an uppercase note", { ...good, payload: { ...good.payload, note: note.toUpperCase() } }],
      ["an extra payload key", { ...good, payload: { ...good.payload, persona: "p_x" } }],
      ["a note that does not hash to noteHash", { ...good, payload: { ...good.payload, note: otherNote } }],
      // the note's hash re-bound to the OTHER note in the public inputs, the message still binding the first: the claim binding refuses
      ["noteHash swapped under an unchanged message", retag({ ...good, publicInputs: { ...good.publicInputs, noteHash: noteHashOf(otherNote) }, payload: { ...good.payload, note: otherNote } })],
      ["no noteHash at all", retag({ ...good, publicInputs: { ...good.publicInputs, noteHash: undefined } })],
    ];
    for (const [name, env] of variants) {
      const r = await api("POST", "/zk/submit", { envelope: env });
      assert.equal(r.status, 400, `${name}: ` + JSON.stringify(r.json));
    }
    assert.match((await api("POST", "/zk/submit", { envelope: variants[4][1] })).json.error, /does not hash to noteHash/);
    assert.equal(nullifierStored("8410001"), false, "a refused note consumed the nullifier");
    // a noteHash on a tier-membership claim (the plain door refuses the field itself)
    const ep = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
    const members = (await api("GET", "/zk/members?mode=fixture&tree=valid")).json;
    const plain = boundInputs({ mode: "fixture", claimKind: "tier-membership", tree: "valid", epoch: ep, merkleTreeRoot: members.root, personaId: "p_note_plain", gateId: "foryou" });
    const plainNote = await api("POST", "/zk/submit", { envelope: fixtureEnvelope({ ...plain, noteHash: "a".repeat(64) }, "8410002") });
    assert.equal(plainNote.status, 400);
    assert.match(plainNote.json.error, /noteHash is only valid on an anon-post claim/);
    // CONTROL: the honest envelope (the same nullifier every variant carried) is accepted, the note stored as sent
    const ok = await api("POST", "/zk/submit", { envelope: good });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(db.prepare("SELECT note FROM zk_anon_casts WHERE mode = 'fixture' AND cast_hash = ?").get(good.publicInputs.castHash).note, note);
    // two honest posts with their notes swapped: each note now fails its own post's bound hash
    const a = await anonP4Envelope({ slot: 2, nullifier: "8410003" });
    const b = await anonP4Envelope({ slot: 3, nullifier: "8410004" });
    for (const [env, swapped] of [[a, b.payload.note], [b, a.payload.note]]) {
      const r = await api("POST", "/zk/submit", { envelope: { ...env, payload: { ...env.payload, note: swapped } } });
      assert.equal(r.status, 400, JSON.stringify(r.json));
    }
    assert.equal((await api("POST", "/zk/submit", { envelope: a })).status, 200);
  } finally {
    if (prevTree === undefined) delete process.env.ZK_ANON_POST_TREE;
    else process.env.ZK_ANON_POST_TREE = prevTree;
  }
});

/** the launch track's registrar, STUBBED by patching its exports for one test (zk.js requires it lazily, per call) — the
 * test pins zk.js's half of the contract: what it asks the registrar, and that the queueing runs inside the record
 * transaction (a throw rolls the nullifier back) */
async function withStubRegistrar(fn) {
  const reg = require("../registrar");
  const saved = {};
  for (const k of ["launchCommitOf", "validateLaunchRequest", "enqueueLaunch", "revealBatch", "resetFixture"]) saved[k] = reg[k];
  const calls = { enqueue: [], reveal: [], reset: [] };
  reg.launchCommitOf = (r) => createHash("sha256").update("stub-launch|" + r).digest("hex");
  reg.validateLaunchRequest = (r) => (r.includes("REFUSE-ME") ? "the stub registrar refuses this request" : null);
  reg.enqueueLaunch = (db2, mode, request, commit, epoch) => {
    calls.enqueue.push({ mode, request, commit, epoch, inTx: db2.isTransaction === true });
    if (request.includes("THROW-409")) throw Object.assign(new Error("that custody address already has a launch"), { status: 409 });
  };
  reg.revealBatch = (db2, b) => {
    calls.reveal.push(b);
    return { status: 207, json: { stub: true, items: Array.isArray(b.castHashes) ? b.castHashes.length : 0 } };
  };
  reg.resetFixture = (db2, mode) => calls.reset.push(mode);
  try {
    return await fn(reg, calls);
  } finally {
    Object.assign(reg, saved);
  }
}
async function launchEnvelope({ request, nullifier, commit, tree = "valid", epochDelta = 0, extra = {}, payload }) {
  const ep = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch + epochDelta;
  const m = (await api("GET", "/zk/members?mode=fixture&tree=" + encodeURIComponent(tree))).json;
  const launchCommit = commit ?? createHash("sha256").update("stub-launch|" + request).digest("hex");
  const challenge = "epoch-" + ep;
  const pub = {
    mode: "fixture", claimKind: "persona-launch", tree, epoch: ep, merkleTreeRoot: m.root,
    scope: fieldOf("scope", `layers/zk-scope/v1|persona-launch/w${ep}`),
    message: fieldOf("message", ["anon", "persona-launch", "launch:" + launchCommit, challenge, m.root].join("|")),
    personaId: "anon", gateId: "persona-launch", challenge, launchCommit, ...extra,
  };
  return { v: 1, mode: "fixture", claimKind: "persona-launch", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalLaunch(pub), nullifier) }, payload: payload ?? { request } };
}

test("PERSONA LAUNCH P6 — THE LAUNCH REQUEST: accepted with the registrar asked to queue it INSIDE the record transaction; one per person per window (a second is a 409 replay); refused (400, nothing consumed) on a commit mismatch, the registrar's own words, an extra payload key, a request over 2048 bytes, a slot or a noteHash, another tree, an earlier epoch; a registrar throw rolls the nullifier back; launchCommit on other kinds is refused", async () => {
  const prevTree = process.env.ZK_ANON_POST_TREE;
  process.env.ZK_ANON_POST_TREE = "valid";
  try {
    await withStubRegistrar(async (reg, calls) => {
      await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
      const ep = (await api("GET", "/zk/epoch?mode=fixture")).json.epoch;
      const base = await launchEnvelope({ request: "req-A", nullifier: "8420001" });
      const refusals = [
        ["commit mismatch", await launchEnvelope({ request: "req-A", nullifier: "8420001", commit: "c".repeat(64) }), /does not hash to launchCommit/],
        ["the registrar's words", await launchEnvelope({ request: "req REFUSE-ME", nullifier: "8420001" }), /the stub registrar refuses this request/],
        ["an extra payload key", await launchEnvelope({ request: "req-A", nullifier: "8420001", payload: { request: "req-A", persona: "p_x" } }), /exactly \{ request \}/],
        ["a request over 2048 bytes", await launchEnvelope({ request: "r".repeat(2049), nullifier: "8420001" }), /larger than 2048/],
        ["a slot", retag({ ...base, publicInputs: { ...base.publicInputs, slot: 0 } }), /slot is not valid/],
        ["a noteHash", retag({ ...base, publicInputs: { ...base.publicInputs, noteHash: "a".repeat(64) } }), /noteHash is not valid/],
        ["another tree", await launchEnvelope({ request: "req-A", nullifier: "8420001", tree: "tier-1" }), /claim binding/],
        ["the previous epoch", await launchEnvelope({ request: "req-A", nullifier: "8420001", epochDelta: -1 }), /current epoch|signed history/],
      ];
      for (const [name, env, why] of refusals) {
        const r = await api("POST", "/zk/submit", { envelope: env });
        assert.equal(r.status, 400, `${name}: ` + JSON.stringify(r.json));
        assert.match(r.json.error, why, name);
      }
      assert.equal(nullifierStored("8420001"), false, "a refused launch request consumed the nullifier");
      assert.equal(calls.enqueue.length, 0, "a refused request reached the registrar's queue");
      // a registrar refusal INSIDE the transaction rolls the nullifier back, with the registrar's status
      const thrown = await api("POST", "/zk/submit", { envelope: await launchEnvelope({ request: "req THROW-409", nullifier: "8420001" }) });
      assert.equal(thrown.status, 409, JSON.stringify(thrown.json));
      assert.match(thrown.json.error, /already has a launch/);
      assert.equal(nullifierStored("8420001"), false, "the registrar's throw did not roll the nullifier back");
      // CONTROL: the honest request (the same nullifier) is accepted and queued once, in the transaction
      const ok = await api("POST", "/zk/submit", { envelope: base });
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      const last = calls.enqueue.at(-1);
      assert.deepEqual({ mode: last.mode, request: last.request, commit: last.commit, epoch: last.epoch }, { mode: "fixture", request: "req-A", commit: reg.launchCommitOf("req-A"), epoch: ep });
      assert.equal(last.inTx, true, "enqueueLaunch ran outside the record transaction");
      assert.equal(db.prepare("SELECT claim_kind FROM zk_nullifiers WHERE mode = 'fixture' AND nullifier = '8420001'").get().claim_kind, "persona-launch");
      // one per person per window: the same scope again (a new request) is the same nullifier — a replay
      const again = await api("POST", "/zk/submit", { envelope: await launchEnvelope({ request: "req-B", nullifier: "8420001" }) });
      assert.equal(again.status, 409);
      // launchCommit is refused on every other kind
      const members = (await api("GET", "/zk/members?mode=fixture&tree=valid")).json;
      const plain = boundInputs({ mode: "fixture", claimKind: "tier-membership", tree: "valid", epoch: ep, merkleTreeRoot: members.root, personaId: "p_launch_plain", gateId: "foryou" });
      const onPlain = await api("POST", "/zk/submit", { envelope: fixtureEnvelope({ ...plain, launchCommit: "d".repeat(64) }, "8420002") });
      assert.equal(onPlain.status, 400);
      assert.match(onPlain.json.error, /launchCommit is only valid on a persona-launch claim/);
      const anon = await anonP4Envelope({ slot: 0, nullifier: "8420003" });
      const onAnon = await api("POST", "/zk/submit", { envelope: retag({ ...anon, publicInputs: { ...anon.publicInputs, launchCommit: "d".repeat(64) } }) });
      assert.equal(onAnon.status, 400);
      assert.match(onAnon.json.error, /launchCommit is only valid on a persona-launch claim/);
    });
  } finally {
    if (prevTree === undefined) delete process.env.ZK_ANON_POST_TREE;
    else process.env.ZK_ANON_POST_TREE = prevTree;
  }
});

test("PERSONA LAUNCH P6 — the scope and the delegations: persona-launch takes the window ALONE (w<n>; a slot, junk or nothing is refused); a batch reveal is the registrar's, a single reveal is not; the fixture reset also resets the registrar's universe", async () => {
  const entry = { feature: "persona-launch", onePerHuman: true };
  assert.equal(zk.scopeString(entry, 12, undefined, "w12"), "layers/zk-scope/v1|persona-launch/w12");
  for (const q of ["w12/s0", "12", "w", undefined, ""]) assert.throws(() => zk.scopeString(entry, 12, undefined, q), `qualifier ${q} was accepted`);
  await withStubRegistrar(async (reg, calls) => {
    const batch = await api("POST", "/zk/anon/reveal", { batch: true, mode: "fixture", castHashes: ["a".repeat(64), "b".repeat(64)] });
    assert.equal(batch.status, 207, JSON.stringify(batch.json));
    assert.deepEqual(batch.json, { stub: true, items: 2 });
    assert.equal(calls.reveal.length, 1);
    // a single reveal never reaches the batch path (it is refused here on its own rules: no such cast)
    const single = await api("POST", "/zk/anon/reveal", { mode: "fixture", castHash: "c".repeat(64), secret: "d".repeat(64), fid: 5, signerPubKey: "e".repeat(64), signature: "f".repeat(128) });
    assert.notEqual(single.status, 207);
    assert.equal(calls.reveal.length, 1);
    const r = await api("POST", "/zk/dev/reset", { mode: "fixture" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(calls.reset, ["fixture"]);
  });
});
