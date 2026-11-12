"use strict";
const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const { migrate } = require("./migrations");

function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS roots (
      id TEXT PRIMARY KEY,
      fid INTEGER UNIQUE NOT NULL,
      signer_uuid TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL
    );
    -- personas: the phase-1 shape (root_id) is created here so migrations
    -- 1..5 see what they expect; migration 006 rebuilds it WITHOUT root_id
    -- before this process serves a request. blocks (root-level) is not
    -- created here any more: 006 owns it (ZK PASS 2 Gate 2).
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      root_id TEXT NOT NULL REFERENCES roots(id),
      name TEXT NOT NULL,
      handle TEXT UNIQUE NOT NULL,
      avatar_url TEXT,
      bio TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rep_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_id TEXT NOT NULL REFERENCES roots(id),
      type TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      source_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS rep_dedupe
      ON rep_events(root_id, type, source_id) WHERE source_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS poll_state (
      root_id TEXT PRIMARY KEY,
      snapshot TEXT NOT NULL
    );
  `);
  migrate(db);
  return db;
}

const uid = (prefix) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;

/** BROWSER KEYSTORE PASS Gate 1 stage 2: the device-auth anchor an UNSIGNED request resolves to — the oldest
 * registered one (a rig validator's own), or "legacy" before any is registered. A signed request never comes here:
 * checkEnvelope stamps req.layersAnchor from the device's delegation. */
function singleAnchor(db) {
  const row = db.prepare("SELECT pubkey FROM device_auth ORDER BY registered_at ASC, pubkey ASC LIMIT 1").get();
  return row ? row.pubkey : "legacy";
}
function anchorOf(req, db) {
  return req.layersAnchor ?? singleAnchor(db);
}

module.exports = { openDb, uid, singleAnchor, anchorOf };
