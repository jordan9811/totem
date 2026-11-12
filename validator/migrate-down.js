#!/usr/bin/env node
"use strict";
// ZK PASS 2 Gate 2 — roll migration 006 back (the ONLY migration with a
// down). It needs a DEVICE-SIDE roster — either the pre-006 export
// (validator/export-roster.js → { roots: { rootId: [personaId] }, fids })
// or the app's dev action `rosterExport` ({ personaId: rootId }) —
// because after 006 the validator has no table that can answer
// persona → root. It refuses without one, and refuses if any persona is
// missing from it, unless told to QUARANTINE the unattributable ones
// (moved, not deleted, to personas_orphaned_on_rollback).
//
//   node validator/migrate-down.js <roster.json> [dbPath] [--orphans=quarantine]
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { migrateDown } = require("./migrations");

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const rosterPath = positional[0];
const dbPath = positional[1] || process.env.VALIDATOR_DB || path.join(__dirname, "layers.db");
if (!rosterPath) {
  console.error("usage: node validator/migrate-down.js <roster.json> [dbPath] [--orphans=quarantine]");
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
// normalise both shapes to { personaId: rootId }
let roster = raw;
if (raw && typeof raw === "object" && raw.roots && typeof raw.roots === "object") {
  roster = {};
  for (const [rootId, ids] of Object.entries(raw.roots)) for (const id of ids) roster[id] = rootId;
}
const orphans = flags.includes("--orphans=quarantine") ? "quarantine" : "refuse";
const db = new DatabaseSync(dbPath);
try {
  const r = migrateDown(db, 6, roster, { orphans });
  const cols = db.prepare("PRAGMA table_info(personas)").all().map((c) => c.name);
  console.log(`migration 006 rolled back on ${dbPath}: ${r.restored} persona(s) restored to their roots, ${r.quarantined} quarantined; personas columns: ${cols.join(",")}`);
} catch (e) {
  console.error("migration 006 down REFUSED: " + e.message);
  process.exit(1);
}
