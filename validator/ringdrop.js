"use strict";
// PERSONA LAUNCH P4 — THE RING DROP (plan R8 / D8; research/spec-friend-whitelist-2026-10-08.txt §3, made multi-writer).
//
// A public table of fixed-size sealed envelopes. Any device with a registered device key may WRITE (D8: strangers'
// rings, device-signed, padded to buckets of 4); ANYONE may READ the whole table (every Totem device reads it on every
// prefetch tick, ring or not, so a read marks nobody). What the operator learns, and only this:
//   * that a device publishes, when (an hourly re-seal), and about how many rows (rows come in multiples of 4);
//   * fixed-size ciphertext, a 4-hex hint that is a PRF under a key it does not hold, hour-grained expiries;
//   * every reader's IP (A-RING-DROP-READ-IP) and every writer's device at write time (A-RING-WRITER-IS-THE-DEVICE —
//     in memory for the per-device rate limit; the drop table has no writer, device, anchor or mode column, BUT the
//     envelope check keeps one envelope_counters row per (device, "rings:drop"), never pruned, so the database does
//     record which devices ever published and the counter dates the first write — SECURITY-POSTURE §24).
// Never: a persona, a fid, a handle, a ring label, which rows are one member's, whether a reader holds an address.
//
//   PUT  /rings/drop/batch   DEVICE-SIGNED (the envelope over sha256(JSON body), namespace "rings:drop"; an unsigned or
//                            badly signed write is 401/403/409 whatever LAYERS_REQUIRE_SIG says). Body
//                            {rows: [{id, enc, ct, hint, expiresHour, delHash}], deletes: [token]}: rows.length % 4 === 0
//                            and at most RING_DROP_MAX_ROWS_PER_WRITE; every shape exact (ct is the fixed envelope size);
//                            expiresHour in (now, now + 72 + 2 h of clock slack]; an id that exists → 409 (never
//                            overwrite); the table full → 413. Inserts then deletes, ONE transaction (the publisher swaps
//                            generations atomically). A delete is by token (sha256 of its raw bytes is the row's
//                            del_hash) in the signed body — no new request header, so no CORS change. Idempotent: a token
//                            whose row is gone is not an error (ids are public, absence no oracle).
//
// BOUNDED OCCUPANCY, not just write counts (W2-RINGS-DROP-FILL-DOS). The first cut let one fresh device fill the whole
// table in ~75 minutes (120 writes/h × 28 rows, kept for up to a week) and every honest publish then got drop_full while
// every reader downloaded ~34 MB a tick. Now, per process instance and MEMORY ONLY (counts per hour bucket — never a row
// id, never at rest; the table still has no writer column):
//   * a row lives at most 72 h (+2 h clock slack) — the publisher's own lease;
//   * LIVE rows per DEVICE ≤ RING_DROP_MAX_LIVE_PER_DEVICE (1024 = two full generations of the largest publisher, 16
//     rings × 32 members, which a swap or a half-landed publish briefly holds): rows a device inserted minus rows it
//     deleted over the lease window — a publisher that swaps stays flat, a writer that never deletes hits the ceiling;
//   * LIVE rows per ADDRESS (the client IP, X-Forwarded-For only behind TRUST_PROXY, as caps.js) ≤
//     RING_DROP_MAX_LIVE_PER_ADDRESS (2048), so minting device identities from one address does not multiply it;
//   * rows inserted per device per hour ≤ RING_DROP_ROWS_PER_HOUR (2048) beside RING_DROP_WRITES_PER_HOUR (120).
// Each refusal is a 429 with a sentence and Retry-After. Residual (A-RING-DROP-SYBIL): many addresses × many identities
// still add up to the table's cap; proof-authorized writes are v1.1. Dummy rows cannot be told from real ones (that is
// their point), so no rule here may single them out.
//   GET  /rings/drop         open, no-store: sweep, then every live row in a CRYPTO SHUFFLE, each exactly
//                            {id, enc, ct, hint, expiresHour}.
//   POST /rings/dev/reset    dev hooks only: the rig's seed reset empties the drop (every row on a rig is test data).
// Logging: aggregate counts, once a minute when anything happened — never a row, a device or an address.
const { createHash, randomInt } = require("node:crypto");

/** DELIBERATE DUPLICATES of lib/rings/envelope.ts and lib/rings/publisher.ts */
const ENVELOPE_CT_HEX_LEN = 8224;
const MAX_LEASE_HOURS = 72;
/** a publisher's clock may run a little ahead of this one: its expiresHour is hourOf(its now + 72 h) */
const CLOCK_SLACK_HOURS = 2;
/** the occupancy window: a row inserted longer ago than this has expired, whatever it said */
const WINDOW_HOURS = MAX_LEASE_HOURS + CLOCK_SLACK_HOURS + 1;
const ID_RE = /^[0-9a-f]{32}$/;
const ENC_RE = /^[0-9a-f]{64}$/;
const CT_RE = new RegExp("^[0-9a-f]{" + ENVELOPE_CT_HEX_LEN + "}$");
const HINT_RE = /^[0-9a-f]{4}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const DROP_NS = "rings:drop";
const MAX_DELETES_PER_WRITE = 256;

const hourNow = () => Math.floor(Date.now() / 3_600_000);
function intEnv(name, dflt, min, max) {
  const raw = String(process.env[name] ?? "").trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= min && n <= max ? n : dflt;
}
/** the table's cap (default 4096 rows ≈ 34 MB served per read at the worst; never raise it casually) */
const maxRows = () => intEnv("RING_DROP_MAX_ROWS", 4096, 4, 1_000_000);
/** rows per signed write: a multiple of 4 that fits the JSON body limit (28 × ~8.4 KB) */
const maxRowsPerWrite = () => {
  const n = intEnv("RING_DROP_MAX_ROWS_PER_WRITE", 28, 4, 28);
  return n - (n % 4);
};
const writesPerHour = () => intEnv("RING_DROP_WRITES_PER_HOUR", 120, 1, 100_000);
const rowsPerHour = () => intEnv("RING_DROP_ROWS_PER_HOUR", 2048, 4, 1_000_000);
const maxLivePerDevice = () => intEnv("RING_DROP_MAX_LIVE_PER_DEVICE", 1024, 4, 1_000_000);
const maxLivePerAddress = () => intEnv("RING_DROP_MAX_LIVE_PER_ADDRESS", 2048, 4, 1_000_000);

/** net live rows per key (a device id or an address), in hour buckets over the occupancy window — counts only */
function liveOf(map, key, nowH) {
  const b = map.get(key);
  if (!b) return 0;
  let sum = 0;
  for (const [h, n] of b) {
    if (h <= nowH - WINDOW_HOURS) b.delete(h);
    else sum += n;
  }
  if (b.size === 0) map.delete(key);
  return Math.max(0, sum); // deletes of rows inserted before a restart can take a bucket below zero
}
function addLive(map, key, nowH, delta) {
  if (!delta) return;
  let b = map.get(key);
  if (!b) map.set(key, (b = new Map()));
  b.set(nowH, (b.get(nowH) ?? 0) + delta);
}

function rowError(r, nowH) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return "a row is not an object";
  const keys = Object.keys(r).sort().join(",");
  if (keys !== "ct,delHash,enc,expiresHour,hint,id") return "a row has extra or missing fields";
  if (!ID_RE.test(r.id)) return "a row id must be 32 hex";
  if (!ENC_RE.test(r.enc)) return "a row's enc must be 64 hex";
  if (!CT_RE.test(r.ct)) return "a row's ct must be exactly " + ENVELOPE_CT_HEX_LEN + " hex";
  if (!HINT_RE.test(r.hint)) return "a row's hint must be 4 hex";
  if (!HASH_RE.test(r.delHash)) return "a row's delHash must be 64 hex";
  if (!Number.isSafeInteger(r.expiresHour) || r.expiresHour <= nowH || r.expiresHour > nowH + MAX_LEASE_HOURS + CLOCK_SLACK_HOURS) return "a row must expire within the next " + MAX_LEASE_HOURS + " hours";
  return null;
}

const delHashOf = (tokenHex) => createHash("sha256").update(Buffer.from(tokenHex, "hex")).digest("hex");

function mountRingDrop(app, db, { checkEnvelope, devHooks = false, trustProxy = process.env.TRUST_PROXY === "true" } = {}) {
  if (typeof checkEnvelope !== "function") throw new Error("mountRingDrop needs the server's checkEnvelope");
  // the table is migration 23 (validator/migrations.js); refuse to mount without it rather than create it here
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ring_drop'").get();
  if (!has) throw new Error("ring_drop table missing — migration 23 (ring_drop) has not run");

  const perDevice = new Map(); // deviceId → { hour, n, rows } — memory only, swept hourly
  const liveByDevice = new Map(); // deviceId → Map(hour → net rows) — memory only, counts
  const liveByAddress = new Map(); // address → Map(hour → net rows) — memory only, counts
  // PUBLIC GO-LIVE (A-WEB-PROXY-HOP-HEADERS): the hop the edge vouches for, never the client-written left-most entry
  const addressOf = (req) => require("./caps").edgeClientAddress(req, trustProxy);
  const agg = { writes: 0, rowsIn: 0, deleted: 0, reads: 0, refused: 0 };
  const sweep = () => db.prepare("DELETE FROM ring_drop WHERE expires_hour <= ?").run(hourNow()).changes;
  const timer = setInterval(() => {
    try {
      sweep();
    } catch {
      /* the next read sweeps */
    }
    const h = hourNow();
    for (const [k, v] of perDevice) if (v.hour !== h) perDevice.delete(k);
    for (const map of [liveByDevice, liveByAddress]) for (const k of [...map.keys()]) liveOf(map, k, h);
    if (agg.writes || agg.reads || agg.refused) {
      console.log(`[ringdrop] last minute: ${agg.writes} writes (${agg.rowsIn} rows in, ${agg.deleted} deleted), ${agg.reads} reads, ${agg.refused} refused`);
      agg.writes = agg.rowsIn = agg.deleted = agg.reads = agg.refused = 0;
    }
  }, 60_000);
  timer.unref?.();

  app.put("/rings/drop/batch", (req, res) => {
    const refuse = (status, error, extra = {}) => {
      agg.refused++;
      return res.status(status).json({ error, ...extra });
    };
    // 1. the device envelope, ALWAYS (an unsigned write is refused whatever the deployment's LAYERS_REQUIRE_SIG says)
    const bodyHash = createHash("sha256").update(JSON.stringify(req.body ?? {})).digest("hex");
    const bad = checkEnvelope(req, DROP_NS, bodyHash);
    if (bad) return refuse(bad.status, bad.error);
    const deviceId = String(req.header("x-layers-device"));
    // 2. shapes
    const b = req.body || {};
    const rows = b.rows;
    const deletes = b.deletes === undefined ? [] : b.deletes;
    if (!Array.isArray(rows) || !Array.isArray(deletes)) return refuse(400, "rows and deletes must be lists");
    if (Object.keys(b).some((k) => k !== "rows" && k !== "deletes")) return refuse(400, "the body carries only rows and deletes");
    if (rows.length % 4 !== 0) return refuse(400, "rows come in groups of 4 (pad with dummies)");
    if (rows.length > maxRowsPerWrite()) return refuse(413, "at most " + maxRowsPerWrite() + " rows per write");
    if (deletes.length > MAX_DELETES_PER_WRITE) return refuse(413, "at most " + MAX_DELETES_PER_WRITE + " deletes per write");
    if (rows.length === 0 && deletes.length === 0) return refuse(400, "nothing to write");
    const nowH = hourNow();
    for (const r of rows) {
      const e = rowError(r, nowH);
      if (e) return refuse(400, e);
    }
    if (new Set(rows.map((r) => r.id)).size !== rows.length) return refuse(400, "a batch repeats a row id");
    for (const t of deletes) if (typeof t !== "string" || !TOKEN_RE.test(t)) return refuse(400, "a delete token must be 64 hex");
    // 3. the per-device hourly budgets (memory only): writes, and rows inserted
    const hourLeft = () => String(Math.max(60, 3600 - Math.floor((Date.now() % 3_600_000) / 1000)));
    const slot = perDevice.get(deviceId);
    const used = slot && slot.hour === nowH ? slot : { hour: nowH, n: 0, rows: 0 };
    if (used.n >= writesPerHour()) {
      res.setHeader("Retry-After", hourLeft());
      return refuse(429, "too many ring writes from this device this hour");
    }
    if (used.rows + rows.length > rowsPerHour()) {
      res.setHeader("Retry-After", hourLeft());
      return refuse(429, "this device sent more ring rows this hour than any publisher needs (" + rowsPerHour() + ")");
    }
    perDevice.set(deviceId, { hour: nowH, n: used.n + 1, rows: used.rows });
    const address = addressOf(req);
    // 4. one transaction: inserts (409 on any id reuse, 413 when full, 429 past a writer's occupancy), then deletes
    sweep();
    db.exec("BEGIN");
    let deleted = 0;
    try {
      const hashes = deletes.map(delHashOf);
      const willDelete = hashes.length ? db.prepare(`SELECT COUNT(*) AS n FROM ring_drop WHERE del_hash IN (${hashes.map(() => "?").join(",")})`).get(...hashes).n : 0;
      const count = db.prepare("SELECT COUNT(*) AS n FROM ring_drop").get().n;
      if (count + rows.length - willDelete > maxRows()) {
        db.exec("ROLLBACK");
        return refuse(413, "drop_full", { code: "drop_full" });
      }
      // OCCUPANCY: what this device, and this address, would keep live after the write (a swap nets to zero)
      if (rows.length > 0) {
        const net = rows.length - willDelete;
        if (liveOf(liveByDevice, deviceId, nowH) + net > maxLivePerDevice()) {
          db.exec("ROLLBACK");
          res.setHeader("Retry-After", "3600");
          return refuse(429, "this device already keeps as many rows on the ring drop as one device may (" + maxLivePerDevice() + ") — a publish that swaps out its old rows fits");
        }
        if (liveOf(liveByAddress, address, nowH) + net > maxLivePerAddress()) {
          db.exec("ROLLBACK");
          res.setHeader("Retry-After", "3600");
          return refuse(429, "this address already keeps as many rows on the ring drop as one address may (" + maxLivePerAddress() + ")");
        }
      }
      const exists = db.prepare("SELECT 1 FROM ring_drop WHERE id = ?");
      const ins = db.prepare("INSERT INTO ring_drop (id, enc, ct, hint, expires_hour, del_hash) VALUES (?, ?, ?, ?, ?, ?)");
      for (const r of rows) {
        if (exists.get(r.id)) {
          db.exec("ROLLBACK");
          return refuse(409, "a row with that id exists (rows are never overwritten)");
        }
        ins.run(r.id, r.enc, r.ct, r.hint, r.expiresHour, r.delHash);
      }
      const del = db.prepare("DELETE FROM ring_drop WHERE del_hash = ?");
      for (const h of hashes) deleted += del.run(h).changes;
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      return refuse(500, "the drop write failed");
    }
    // counted only once committed: rows in, rows this writer took out
    const s2 = perDevice.get(deviceId);
    if (s2 && s2.hour === nowH) s2.rows += rows.length;
    addLive(liveByDevice, deviceId, nowH, rows.length - deleted);
    addLive(liveByAddress, address, nowH, rows.length - deleted);
    agg.writes++;
    agg.rowsIn += rows.length;
    agg.deleted += deleted;
    res.status(201).json({ ok: true, inserted: rows.length, deleted });
  });

  app.get("/rings/drop", (req, res) => {
    sweep();
    const nowH = hourNow();
    const rows = db.prepare("SELECT id, enc, ct, hint, expires_hour FROM ring_drop WHERE expires_hour > ?").all(nowH).map((r) => ({ id: r.id, enc: r.enc, ct: r.ct, hint: r.hint, expiresHour: r.expires_hour }));
    for (let i = rows.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    agg.reads++;
    res.setHeader("Cache-Control", "no-store");
    res.json({ nowHour: nowH, count: rows.length, rows });
  });

  if (devHooks) {
    app.post("/rings/dev/reset", (req, res) => {
      const n = db.prepare("DELETE FROM ring_drop").run().changes;
      perDevice.clear();
      liveByDevice.clear();
      liveByAddress.clear();
      res.json({ ok: true, removed: n });
    });
  }
  return { sweep };
}

module.exports = { mountRingDrop, ENVELOPE_CT_HEX_LEN, DROP_NS };
