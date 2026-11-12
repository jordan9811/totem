#!/usr/bin/env node
"use strict";
// ZK PASS 2 Gate 2 — THE LAST TIME THE VALIDATOR ANSWERS persona → root.
//
// Run ONCE, on a PRE-006 database, BEFORE the validator boots with the
// code that applies migration 006 (which drops personas.root_id). It
// writes the roster the DEVICE keeps from then on — the only thing a
// rollback (validator/migrate-down.js) can be fed — to a path OUTSIDE the
// validator's data (the app's .keystore/, gitignored):
//
//   node validator/export-roster.js .keystore/fixture-roster.json [dbPath]
//
// Refuses on a post-006 database: the column is gone, there is nothing
// to export, and inventing a roster is exactly what 006 forbids.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const out = process.argv[2];
const dbPath = process.argv[3] || process.env.VALIDATOR_DB || path.join(__dirname, "layers.db");
if (!out) {
  console.error("usage: node validator/export-roster.js <out.json> [dbPath]");
  process.exit(2);
}
if (path.resolve(out).startsWith(path.resolve(__dirname) + path.sep)) {
  console.error("refusing to write the roster export inside validator/ — it must leave the validator");
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const cols = db.prepare("PRAGMA table_info(personas)").all().map((c) => c.name);
if (!cols.includes("root_id")) {
  console.error("personas.root_id is already gone (migration 006 applied) — nothing to export; the roster is the device's now");
  process.exit(1);
}
const roster = { roots: {}, fids: {}, exportedAt: Date.now(), source: path.basename(dbPath) };
for (const r of db.prepare("SELECT id, fid FROM roots").all()) roster.fids[String(r.fid)] = r.id;
for (const p of db.prepare("SELECT id, root_id FROM personas ORDER BY created_at, id").all()) {
  (roster.roots[p.root_id] ??= []).push(p.id);
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(roster, null, 1));
const personas = Object.values(roster.roots).reduce((n, ids) => n + ids.length, 0);
console.log(`roster exported to ${out}: ${Object.keys(roster.roots).length} roots with personas, ${personas} personas, ${Object.keys(roster.fids).length} fids`);
