"use strict";
// BROWSER KEYSTORE PASS Gate 2 / Gate 3 / Gate 5 — custody method records and wrapped-seed blobs, the device-link
// relay, the root-link relay (docs/custody-model.md D-CU-0-7, D-CU-0-13, D-CU-0-14; notes/reports/REPORT-CUSTODY.md Gate 5
// dispositions of research/attack-custody-{1,3}.md).
//
// A method RECORD says which root's anchor a passkey credential or a provider subject belongs to and, for a
// passkey, the credential's SPKI public key (what the app server verifies wrap-path assertions against). A BLOB is
// the root's seed wrapped under that method's KEK: ciphertext the validator cannot open. The public projection of a
// record carries the kind and the key material the app server needs and NOT the anchor (attack-custody-1 #10).
// Writes carry the device envelope; a method id belongs to the first anchor that wrote it; a wrap-path blob is
// refused here, because it must live only on the device (attack-custody-3 #12).
const { createHash, randomBytes } = require("node:crypto");
const { verifyEd25519 } = require("./crypto");

const KINDS = new Set(["passkey-prf", "passkey-wrap", "provider"]);
const ID = /^(pk|pv):[A-Za-z0-9._:-]{1,240}$/;
const EMPTY_BODY_HASH = createHash("sha256").update("").digest("hex");
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const OFFER_TTL_MS = 10 * 60_000;
const MAX_OPEN_OFFERS_PER_ADDRESS = 5;

function mintCode() {
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}
// PUBLIC GO-LIVE (A-WEB-PROXY-HOP-HEADERS): the hop the edge vouches for (X-Real-IP, else the RIGHT-most X-Forwarded-For entry), never the client-written left-most entry — validator/caps.js edgeClientAddress
const clientAddress = (req) => require("./caps").edgeClientAddress(req, process.env.TRUST_PROXY === "true");
const bodyHash = (req) => createHash("sha256").update(JSON.stringify(req.body)).digest("hex");
// attack-custody-2 #14: the envelope binds a NAMESPACE, not a path, so destructive operations sign under their own
// operation-class namespace — a captured envelope for a read cannot be replayed as a delete or a revoke
const makeSigned = ({ checkEnvelope, UNSIGNED_REFUSED }, ns = "custody") => (req, res, hash) => {
  if (!req.header("x-layers-device")) {
    res.status(401).json({ error: UNSIGNED_REFUSED });
    return null;
  }
  const bad = checkEnvelope(req, ns, hash);
  if (bad) {
    res.status(bad.status).json({ error: bad.error });
    return null;
  }
  return req.layersAnchor;
};

function mountCustody(app, db, deps) {
  const signed = makeSigned(deps);
  const signedDelete = makeSigned(deps, "custody:delete");

  // the record's PUBLIC projection: kind and the key the app server verifies against — never the anchor
  app.get("/custody/method/:id", (req, res) => {
    const row = db.prepare("SELECT method_id, kind, pubkey_spki, alg, created_at FROM custody_methods WHERE method_id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "no such method" });
    res.json({ method: row });
  });

  // the blob: public ciphertext, keyed by a public identifier
  app.get("/custody/blob/:id", (req, res) => {
    const row = db.prepare("SELECT blob, updated_at FROM custody_blobs WHERE method_id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "no blob under that method" });
    let blob;
    try {
      blob = JSON.parse(row.blob);
    } catch {
      return res.status(500).json({ error: "stored blob unreadable" });
    }
    res.json({ blob, updatedAt: row.updated_at });
  });

  // the caller's own methods (settings): signed read, scoped to the caller's anchor
  app.get("/custody/methods", (req, res) => {
    const anchor = signed(req, res, EMPTY_BODY_HASH);
    if (!anchor) return;
    const rows = db.prepare("SELECT method_id, kind, created_at FROM custody_methods WHERE anchor = ? ORDER BY created_at").all(anchor);
    res.json({ methods: rows });
  });

  // write a record: first anchor wins the id; the same anchor may update its own key material
  app.put("/custody/method/:id", (req, res) => {
    const id = req.params.id;
    if (!ID.test(id)) return res.status(400).json({ error: "malformed method id" });
    const { kind, pubkeySpki = null, alg = null } = req.body || {};
    if (!KINDS.has(kind)) return res.status(400).json({ error: "kind must be passkey-prf, passkey-wrap or provider" });
    // attack-custody-2 #24: the id's prefix and the record's kind agree — a pk: id is a passkey, a pv: id a provider
    if ((id.startsWith("pk:") && kind === "provider") || (id.startsWith("pv:") && kind !== "provider")) return res.status(400).json({ error: "method kind does not match the id prefix" });
    if (pubkeySpki !== null && !/^[0-9a-f]{40,400}$/.test(pubkeySpki)) return res.status(400).json({ error: "pubkeySpki must be SPKI hex" });
    if (alg !== null && alg !== -8 && alg !== -7) return res.status(400).json({ error: "alg must be -8 or -7" });
    const anchor = signed(req, res, bodyHash(req));
    if (!anchor) return;
    const existing = db.prepare("SELECT anchor FROM custody_methods WHERE method_id = ?").get(id);
    if (existing && existing.anchor !== anchor) return res.status(409).json({ error: "that method id belongs to another root" });
    db.prepare(
      "INSERT INTO custody_methods (method_id, kind, anchor, pubkey_spki, alg, created_at) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(method_id) DO UPDATE SET kind = excluded.kind, pubkey_spki = excluded.pubkey_spki, alg = excluded.alg"
    ).run(id, kind, anchor, pubkeySpki, alg, Date.now());
    res.status(existing ? 200 : 201).json({ ok: true });
  });

  // write a blob: the record must exist and be the caller's; a wrap-path blob never lands here
  app.put("/custody/blob/:id", (req, res) => {
    const id = req.params.id;
    if (!ID.test(id)) return res.status(400).json({ error: "malformed method id" });
    const { blob } = req.body || {};
    if (!blob || typeof blob !== "object" || blob.v !== 1 || typeof blob.ct !== "string" || typeof blob.nonce !== "string" || blob.method !== id)
      return res.status(400).json({ error: "blob {v:1, method, nonce, ct} bound to this method id required" });
    if (JSON.stringify(blob).length > 4096) return res.status(413).json({ error: "blob too large" });
    const anchor = signed(req, res, bodyHash(req));
    if (!anchor) return;
    const rec = db.prepare("SELECT anchor, kind FROM custody_methods WHERE method_id = ?").get(id);
    if (!rec) return res.status(404).json({ error: "write the method record first" });
    if (rec.anchor !== anchor) return res.status(403).json({ error: "that method belongs to another root" });
    if (rec.kind === "passkey-wrap") return res.status(403).json({ error: "a wrap-path blob lives only on the device that saved it" });
    const existing = db.prepare("SELECT method_id FROM custody_blobs WHERE method_id = ?").get(id);
    const now = Date.now();
    db.prepare(
      "INSERT INTO custody_blobs (method_id, anchor, blob, created_at, updated_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(method_id) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at"
    ).run(id, anchor, JSON.stringify(blob), now, now);
    res.status(existing ? 200 : 201).json({ ok: true });
  });

  // forget a method (settings → remove): the caller's own only; the blob goes with it
  app.delete("/custody/method/:id", (req, res) => {
    const id = req.params.id;
    const anchor = signedDelete(req, res, EMPTY_BODY_HASH);
    if (!anchor) return;
    const rec = db.prepare("SELECT anchor FROM custody_methods WHERE method_id = ?").get(id);
    if (!rec) return res.status(404).json({ error: "no such method" });
    if (rec.anchor !== anchor) return res.status(403).json({ error: "that method belongs to another root" });
    db.prepare("DELETE FROM custody_blobs WHERE method_id = ?").run(id);
    db.prepare("DELETE FROM custody_methods WHERE method_id = ?").run(id);
    res.json({ ok: true });
  });
}

// ---------------------------------------------------------------- the device-link relay (Gate 3)
// D-CU-3-OFFERS-ARE-CREATE-ONCE-AND-SHORT-LIVED: an offer is a device key, an HPKE public key and a code; the sealed
// material is ciphertext written under the old device's envelope. The relay opens nothing, and its public read
// carries neither the approving anchor nor the root id (attack-custody-3 #8).
function mountLinkRelay(app, db, deps) {
  const signed = makeSigned(deps);
  const signedRevoke = makeSigned(deps, "custody:revoke");
  const sweep = () => db.prepare("DELETE FROM link_offers WHERE expires_at < ?").run(Date.now());
  setInterval(sweep, 60_000).unref();
  app.post("/link/offer", (req, res) => {
    const { deviceId, devicePubKey, hpkePub } = req.body || {};
    if (typeof deviceId !== "string" || !/^dev_[A-Za-z0-9_]{4,64}$/.test(deviceId)) return res.status(400).json({ error: "deviceId required" });
    if (!/^[0-9a-f]{64}$/.test(devicePubKey || "") || !/^[0-9a-f]{64}$/.test(hpkePub || "")) return res.status(400).json({ error: "devicePubKey and hpkePub (32-byte hex) required" });
    sweep();
    const addr = clientAddress(req);
    if (db.prepare("SELECT COUNT(*) AS n FROM link_offers WHERE created_by = ?").get(addr).n >= MAX_OPEN_OFFERS_PER_ADDRESS)
      return res.status(429).json({ error: "too many open offers from this address" });
    if (db.prepare("SELECT COUNT(*) AS n FROM link_offers").get().n >= 1000) return res.status(429).json({ error: "too many open offers" });
    let code = mintCode();
    for (let i = 0; i < 5 && db.prepare("SELECT code FROM link_offers WHERE code = ?").get(code); i++) code = mintCode();
    const now = Date.now();
    try {
      db.prepare("INSERT INTO link_offers (code, device_id, device_pubkey, hpke_pub, sealed, anchor, root_id, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)").run(code, deviceId, devicePubKey, hpkePub, now, now + OFFER_TTL_MS, addr);
    } catch {
      return res.status(409).json({ error: "code collision; try again" });
    }
    res.status(201).json({ code, expiresAt: now + OFFER_TTL_MS });
  });
  app.get("/link/:code", (req, res) => {
    sweep();
    const row = db.prepare("SELECT * FROM link_offers WHERE code = ?").get(String(req.params.code).toUpperCase());
    if (!row) return res.status(404).json({ error: "no such offer" });
    let sealed = null;
    if (row.sealed) {
      try {
        sealed = JSON.parse(row.sealed);
      } catch {
        sealed = null;
      }
    }
    res.json({ code: row.code, deviceId: row.device_id, devicePubKey: row.device_pubkey, hpkePub: row.hpke_pub, sealed, expiresAt: row.expires_at });
  });
  // the old device posts the sealed material: signed, once
  app.put("/link/:code/sealed", (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const { enc, ct, rootId } = req.body || {};
    if (!/^[0-9a-f]{64}$/.test(enc || "") || !/^[0-9a-f]{32,65536}$/.test(ct || "")) return res.status(400).json({ error: "enc and ct (hex) required" });
    const anchor = signed(req, res, bodyHash(req));
    if (!anchor) return;
    sweep();
    const row = db.prepare("SELECT sealed FROM link_offers WHERE code = ?").get(code);
    if (!row) return res.status(404).json({ error: "no such offer" });
    if (row.sealed) return res.status(409).json({ error: "that offer was already answered" });
    db.prepare("UPDATE link_offers SET sealed = ?, anchor = ?, root_id = ? WHERE code = ?").run(JSON.stringify({ enc, ct }), anchor, typeof rootId === "string" ? rootId : null, code);
    res.json({ ok: true });
  });
  // the root that approved (or the device it approved, once enrolled under it) forgets the offer; unanswered offers expire
  app.delete("/link/:code", (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const anchor = signedRevoke(req, res, EMPTY_BODY_HASH);
    if (!anchor) return;
    const row = db.prepare("SELECT anchor FROM link_offers WHERE code = ?").get(code);
    if (!row) return res.status(404).json({ error: "no such offer" });
    if (!row.anchor || row.anchor !== anchor) return res.status(403).json({ error: "that offer is not this root's to forget" });
    db.prepare("DELETE FROM link_offers WHERE code = ?").run(code);
    res.json({ ok: true });
  });
}

// ---------------------------------------------------------------- the root-link relay (Gate 3, reworked in Gate 5)
// D-CU-3-A-ROOT-LINK-IS-A-CO-SIGNED-GRANT, v2: a proposal (anchor, root id, an ephemeral key), an answer (anchor, root
// id, an ephemeral key, the ROSTER SEALED TO THE PROPOSER'S KEY, its hash, a signature), a completion (the proposer's
// roster sealed to the answerer's key, its hash, a signature). The relay holds two public anchors, two root ids, two
// ephemeral public keys, ciphertext and signatures; every read is signed by an enrolled device; a grant's two
// parties are recorded at completion so only a party can revoke it or ask whether it was revoked.
function mountRootLinkRelay(app, db, deps) {
  const signed = makeSigned(deps);
  const signedRevoke = makeSigned(deps, "custody:revoke");
  const sweep = () => db.prepare("DELETE FROM root_link_offers WHERE expires_at < ?").run(Date.now());
  setInterval(sweep, 60_000).unref();
  const HEX64 = /^[0-9a-f]{64}$/;
  const HEX128 = /^[0-9a-f]{128}$/;
  const sealedOk = (s) => s && typeof s === "object" && HEX64.test(s.enc || "") && /^[0-9a-f]{32,65536}$/.test(s.ct || "");
  const grantIdOf = (a, b, rootA, rootB, issuedAt, hA, hB) =>
    createHash("sha256").update(`layers/rootlink/v2|${a}|${b}|${rootA}|${rootB}|${issuedAt}|hB=${hB}|hA=${hA}`).digest("hex").slice(0, 32);

  app.post("/rootlink/offer", (req, res) => {
    const { proposal } = req.body || {};
    if (!proposal || typeof proposal.a !== "string" || typeof proposal.rootA !== "string" || !Number.isInteger(proposal.issuedAt) || !HEX64.test(proposal.ekA || ""))
      return res.status(400).json({ error: "proposal {a, rootA, issuedAt, ekA} required" });
    const anchor = signed(req, res, bodyHash(req));
    if (!anchor) return;
    if (proposal.a !== anchor) return res.status(403).json({ error: "the proposal must name the anchor that signs it" });
    sweep();
    let code = mintCode();
    for (let i = 0; i < 5 && db.prepare("SELECT code FROM root_link_offers WHERE code = ?").get(code); i++) code = mintCode();
    const now = Date.now();
    db.prepare("INSERT INTO root_link_offers (code, anchor_a, proposal, anchor_b, answer, sig_a, created_at, expires_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)").run(
      code,
      anchor,
      JSON.stringify({ a: proposal.a, rootA: proposal.rootA, issuedAt: proposal.issuedAt, ekA: proposal.ekA }),
      now,
      now + OFFER_TTL_MS
    );
    res.status(201).json({ code, expiresAt: now + OFFER_TTL_MS });
  });
  // signed: only a party may ask whether one of its own grants was revoked
  app.get("/rootlink/revoked/:id", (req, res) => {
    const anchor = signed(req, res, EMPTY_BODY_HASH);
    if (!anchor) return;
    const id = String(req.params.id);
    const g = db.prepare("SELECT anchor_a, anchor_b FROM root_link_grants WHERE grant_id = ?").get(id);
    if (!g || (g.anchor_a !== anchor && g.anchor_b !== anchor)) return res.status(404).json({ error: "no such grant of yours" });
    const row = db.prepare("SELECT anchor FROM root_link_revocations WHERE grant_id = ?").get(id);
    res.json({ revoked: !!row });
  });
  // signed: any enrolled device may fetch by code (the code is the rendezvous); the row carries no roster in the clear
  app.get("/rootlink/:code", (req, res) => {
    const anchor = signed(req, res, EMPTY_BODY_HASH);
    if (!anchor) return;
    sweep();
    const row = db.prepare("SELECT * FROM root_link_offers WHERE code = ?").get(String(req.params.code).toUpperCase());
    if (!row) return res.status(404).json({ error: "no such proposal" });
    res.json({ code: row.code, proposal: JSON.parse(row.proposal), answer: row.answer ? JSON.parse(row.answer) : null, completion: row.sig_a ? JSON.parse(row.sig_a) : null, expiresAt: row.expires_at });
  });
  app.put("/rootlink/:code/answer", (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const { answer } = req.body || {};
    if (!answer || typeof answer.b !== "string" || typeof answer.rootB !== "string" || !HEX64.test(answer.ekB || "") || !sealedOk(answer.rosterB) || !HEX64.test(answer.hB || "") || !HEX128.test(answer.sigB || ""))
      return res.status(400).json({ error: "answer {b, rootB, ekB, rosterB, hB, sigB} required" });
    const anchor = signed(req, res, bodyHash(req));
    if (!anchor) return;
    if (answer.b !== anchor) return res.status(403).json({ error: "the answer must name the anchor that signs it" });
    sweep();
    const row = db.prepare("SELECT anchor_a, answer FROM root_link_offers WHERE code = ?").get(code);
    if (!row) return res.status(404).json({ error: "no such proposal" });
    if (row.answer) return res.status(409).json({ error: "already answered" });
    if (row.anchor_a === anchor) return res.status(400).json({ error: "a root cannot link to itself" });
    db.prepare("UPDATE root_link_offers SET anchor_b = ?, answer = ? WHERE code = ?").run(anchor, JSON.stringify({ b: answer.b, rootB: answer.rootB, ekB: answer.ekB, rosterB: answer.rosterB, hB: answer.hB, sigB: answer.sigB }), code);
    res.json({ ok: true });
  });
  app.put("/rootlink/:code/complete", (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const { completion } = req.body || {};
    if (!completion || !sealedOk(completion.rosterA) || !HEX64.test(completion.hA || "") || !HEX128.test(completion.sigA || ""))
      return res.status(400).json({ error: "completion {rosterA, hA, sigA} required" });
    const anchor = signed(req, res, bodyHash(req));
    if (!anchor) return;
    sweep(); // attack-custody-3 #7: an expired proposal cannot be completed in the minute before the interval sweep
    const row = db.prepare("SELECT anchor_a, anchor_b, proposal, answer FROM root_link_offers WHERE code = ?").get(code);
    if (!row) return res.status(404).json({ error: "no such proposal" });
    if (row.anchor_a !== anchor) return res.status(403).json({ error: "only the proposer completes" });
    if (!row.answer) return res.status(409).json({ error: "not answered yet" });
    const p = JSON.parse(row.proposal);
    const a = JSON.parse(row.answer);
    db.prepare("UPDATE root_link_offers SET sig_a = ? WHERE code = ?").run(JSON.stringify({ rosterA: completion.rosterA, hA: completion.hA, sigA: completion.sigA }), code);
    // the grant's two parties, recorded so revocation is party-scoped; no roster, no body
    const id = grantIdOf(p.a, a.b, p.rootA, a.rootB, p.issuedAt, completion.hA, a.hB);
    db.prepare("INSERT OR IGNORE INTO root_link_grants (grant_id, anchor_a, anchor_b, created_at) VALUES (?, ?, ?, ?)").run(id, row.anchor_a, row.anchor_b, Date.now());
    res.json({ ok: true, grantId: id });
  });
  app.delete("/rootlink/:code", (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const anchor = signedRevoke(req, res, EMPTY_BODY_HASH);
    if (!anchor) return;
    const row = db.prepare("SELECT anchor_a, anchor_b FROM root_link_offers WHERE code = ?").get(code);
    if (!row) return res.status(404).json({ error: "no such proposal" });
    if (row.anchor_a !== anchor && row.anchor_b !== anchor) return res.status(403).json({ error: "not a party" });
    db.prepare("DELETE FROM root_link_offers WHERE code = ?").run(code);
    res.json({ ok: true });
  });
  app.post("/rootlink/revoke", (req, res) => {
    const { grantId } = req.body || {};
    if (typeof grantId !== "string" || !/^[0-9a-f]{32}$/.test(grantId)) return res.status(400).json({ error: "grantId required" });
    const anchor = signedRevoke(req, res, bodyHash(req));
    if (!anchor) return;
    const g = db.prepare("SELECT anchor_a, anchor_b FROM root_link_grants WHERE grant_id = ?").get(grantId);
    if (!g || (g.anchor_a !== anchor && g.anchor_b !== anchor)) return res.status(403).json({ error: "not a party to that grant" });
    db.prepare("INSERT OR IGNORE INTO root_link_revocations (grant_id, anchor, created_at) VALUES (?, ?, ?)").run(grantId, anchor, Date.now());
    res.json({ ok: true });
  });
}

/** Gate 5 (attack-custody-1 #2): a device may move between anchors only with proof it holds its own private key */
function deviceProofOk(req, devicePubKey) {
  const proof = req.header("x-layers-device-proof");
  if (!proof || !/^[0-9a-f]{128}$/.test(proof)) return false;
  return verifyEd25519(proof, "layers/device-proof/v1|" + bodyHash(req), devicePubKey);
}

module.exports = { mountCustody, mountLinkRelay, mountRootLinkRelay, deviceProofOk, clientAddress };
