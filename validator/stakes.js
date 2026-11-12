"use strict";
// MEGA PASS 2 Gate 1 — STAKES: per-persona spend events on the validator.
//
// WHAT THIS TABLE IS: the public half of the reputation UBI. A stake is a
// signed event by a PERSONA's own key over (mode, persona, cast, action,
// direction, amount, epoch, nonce). The validator VERIFIES the signature
// under the key the client supplies, stores the key beside the row so any
// reader can re-check it against the persona's resolved key, and serves
// the rows publicly — per cast, per persona, per epoch.
//
// WHAT THIS TABLE IS NOT: a balance, a root, a tier, a device. The
// allowance a stake was spent from lives in the poster's vault and is
// never sent; this endpoint cannot tell an over-spent stake from an honest
// one and does not try (readers cap per-persona totals — lib/influence).
// Timestamps are hour-grained like every persona-addressed row (attack-
// z2-1 #2), and the table is WITHOUT ROWID keyed on the stake id, so
// insertion order is not kept.
//
// LOGGING DISCIPLINE: this module logs NOTHING.
const { createHash } = require("node:crypto");
const { verifyEd25519 } = require("./crypto");
const { epochInfo } = require("./zk");

const ACTIONS = new Set(["recast", "like", "note", "refute", "curate"]);
const DIRECTIONS = new Set(["good", "worth-reading", "wrong", "misleading", "note-worthy"]);
const CAST_RE = /^[A-Za-z0-9_:#.x-]{1,120}$/;
const PERSONA_RE = /^[A-Za-z0-9_]{1,80}$/;
const NONCE_RE = /^[a-z0-9]{8,32}$/;
const MAX_AMOUNT = 50;
const MAX_BACKDATE = 3;
const hourGrainMs = (t) => Math.floor(t / 3_600_000) * 3_600_000;
const isMode = (m) => m === "fixture" || m === "live";

// DELIBERATE DUPLICATE of stakeCanonical() in lib/influence/types.ts
const stakeCanonical = (b) => ["layers-stake/1", b.mode, b.personaId, b.castHash, b.action, b.direction, String(b.amount), String(b.epoch), b.nonce].join("|");

function rowOut(r) {
  return {
    id: r.id,
    mode: r.mode,
    personaId: r.persona_id,
    castHash: r.cast_hash,
    action: r.action,
    direction: r.direction,
    amount: r.amount,
    epoch: r.epoch,
    nonce: r.nonce,
    at: r.created_at,
    pubkey: r.pubkey,
    signature: r.signature,
  };
}

function mountStakes(app, db) {
  app.post("/stakes", (req, res) => {
    const b = req.body || {};
    const mode = String(b.mode || "fixture");
    const personaId = String(b.personaId || "");
    const castHash = String(b.castHash || "");
    const action = String(b.action || "");
    const direction = String(b.direction || "");
    const amount = Number(b.amount);
    const epoch = Number(b.epoch);
    const nonce = String(b.nonce || "");
    const pubkey = String(b.pubkey || "");
    const signature = String(b.signature || "");
    if (!isMode(mode)) return res.status(400).json({ error: "mode invalid" });
    if (!PERSONA_RE.test(personaId)) return res.status(400).json({ error: "personaId malformed" });
    if (!CAST_RE.test(castHash)) return res.status(400).json({ error: "castHash malformed" });
    if (!ACTIONS.has(action)) return res.status(400).json({ error: "action unknown" });
    if (!DIRECTIONS.has(direction)) return res.status(400).json({ error: "direction unknown" });
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) return res.status(400).json({ error: `amount must be an integer 1..${MAX_AMOUNT}` });
    if (!NONCE_RE.test(nonce)) return res.status(400).json({ error: "nonce malformed" });
    const current = epochInfo(db, mode).epoch;
    if (!Number.isInteger(epoch) || epoch > current || epoch < current - MAX_BACKDATE) return res.status(400).json({ error: `epoch must be within the last ${MAX_BACKDATE} epochs and never ahead` });
    if (!/^[0-9a-f]{64}$/.test(pubkey)) return res.status(400).json({ error: "pubkey malformed" });
    if (!/^[0-9a-f]{128}$/.test(signature)) return res.status(400).json({ error: "signature malformed" });
    const body = { mode, personaId, castHash, action, direction, amount, epoch, nonce };
    const canonical = stakeCanonical(body);
    if (!verifyEd25519(signature, canonical, pubkey)) return res.status(400).json({ error: "stake signature does not verify under the key given" });
    const id = createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24);
    const createdAt = hourGrainMs(Date.now());
    db.prepare(
      "INSERT OR IGNORE INTO stakes (mode, id, persona_id, cast_hash, action, direction, amount, epoch, nonce, created_at, pubkey, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(mode, id, personaId, castHash, action, direction, amount, epoch, nonce, createdAt, pubkey, signature);
    const row = db.prepare("SELECT * FROM stakes WHERE mode = ? AND id = ?").get(mode, id);
    res.status(201).json({ ok: true, stake: rowOut(row) });
  });

  app.get("/stakes", (req, res) => {
    const mode = String(req.query.mode || "fixture");
    if (!isMode(mode)) return res.status(400).json({ error: "mode invalid" });
    const castHash = req.query.castHash ? String(req.query.castHash) : null;
    const personaId = req.query.personaId ? String(req.query.personaId) : null;
    const epoch = req.query.epoch !== undefined ? Number(req.query.epoch) : null;
    const recent = req.query.recentEpochs !== undefined ? Number(req.query.recentEpochs) : null;
    let rows;
    if (castHash) {
      if (!CAST_RE.test(castHash)) return res.status(400).json({ error: "castHash malformed" });
      rows = db.prepare("SELECT * FROM stakes WHERE mode = ? AND cast_hash = ? ORDER BY created_at, id LIMIT 2000").all(mode, castHash);
    } else if (personaId) {
      if (!PERSONA_RE.test(personaId)) return res.status(400).json({ error: "personaId malformed" });
      rows = db.prepare("SELECT * FROM stakes WHERE mode = ? AND persona_id = ? ORDER BY created_at, id LIMIT 2000").all(mode, personaId);
    } else if (epoch !== null) {
      if (!Number.isInteger(epoch) || epoch < 0) return res.status(400).json({ error: "epoch malformed" });
      rows = db.prepare("SELECT * FROM stakes WHERE mode = ? AND epoch = ? ORDER BY created_at, id LIMIT 4000").all(mode, epoch);
    } else if (recent !== null) {
      if (!Number.isInteger(recent) || recent < 0 || recent > 12) return res.status(400).json({ error: "recentEpochs malformed" });
      const current = epochInfo(db, mode).epoch;
      rows = db.prepare("SELECT * FROM stakes WHERE mode = ? AND epoch >= ? AND epoch <= ? ORDER BY created_at, id LIMIT 4000").all(mode, current - recent, current);
    } else {
      return res.status(400).json({ error: "one of castHash, personaId, epoch, recentEpochs is required" });
    }
    res.json({ mode, stakes: rows.map(rowOut) });
  });
}

module.exports = { mountStakes, stakeCanonical };
