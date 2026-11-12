"use strict";
// ZK PASS 2 Gate 2 — migration 006 (personas_without_root) round trip:
// a PRE-006 database with roots, personas and root-level blocks goes UP
// (column gone, persona-level blocks, legacy blocks kept as evidence),
// then DOWN from a device-side roster (exact restoration), then UP again.
// The down REFUSES without a roster, refuses an incomplete one (leaving
// the schema untouched — the rollback is transactional), and only
// quarantines unattributable personas when told to.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { openDb } = require("../db");
const { migrate, migrateDown } = require("../migrations");

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const hasTable = (db, t) => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
// is migration 006 applied? (later migrations — 007 and on — may be applied too, so MAX(version) is not the question)
const has006 = (db) => !!db.prepare("SELECT 1 FROM schema_version WHERE version = 6").get();

/** a fresh db is post-006; walk it back with an empty roster (no personas) to get the v1 shape */
function pre006Db() {
  const db = openDb(":memory:");
  assert.equal(has006(db), true);
  migrateDown(db, 6, {});
  assert.equal(has006(db), false);
  assert.ok(cols(db, "personas").includes("root_id"));
  assert.ok(hasTable(db, "blocks"));
  assert.equal(hasTable(db, "blocks_v2"), false);
  return db;
}

function seedV1(db) {
  const now = Date.now();
  const insRoot = db.prepare("INSERT INTO roots (id, fid, signer_uuid, created_at) VALUES (?, ?, ?, ?)");
  const insP = db.prepare("INSERT INTO personas (id, root_id, name, handle, avatar_url, bio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  insRoot.run("root_a", 1, "sig-a", now);
  insRoot.run("root_b", 2, "sig-b", now);
  insP.run("p_a1", "root_a", "A1", "a1", null, null, now);
  insP.run("p_a2", "root_a", "A2", "a2", null, "bio", now + 1);
  insP.run("p_b1", "root_b", "B1", "b1", "https://x/y.png", null, now + 2);
  db.prepare("INSERT INTO blocks (blocker_root, blocked_root, created_at) VALUES (?, ?, ?)").run("root_a", "root_b", now);
  return { p_a1: "root_a", p_a2: "root_a", p_b1: "root_b" };
}

test("006 up: root_id gone, persona-level blocks, legacy root-level blocks kept as read-only evidence", () => {
  const db = pre006Db();
  seedV1(db);
  const r = migrate(db);
  assert.equal(r.ran, 1);
  assert.equal(has006(db), true);
  assert.equal(cols(db, "personas").includes("root_id"), false);
  assert.deepEqual(cols(db, "personas"), ["id", "name", "handle", "avatar_url", "bio", "created_at"]);
  assert.equal(hasTable(db, "blocks"), false);
  assert.deepEqual(cols(db, "blocks_v2"), ["blocker_persona", "blocked_persona", "created_at"]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM blocks_legacy_export").get().n, 1);
  // every persona survived, with its fields
  const p = db.prepare("SELECT * FROM personas ORDER BY created_at").all();
  assert.deepEqual(p.map((x) => x.id), ["p_a1", "p_a2", "p_b1"]);
  assert.equal(p[1].bio, "bio");
  assert.equal(p[2].avatar_url, "https://x/y.png");
  // NOTHING in the schema links a persona to a root
  for (const t of db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all()) {
    const c = cols(db, t.name);
    const hasRoot = c.some((x) => x === "root_id" || /_root$/.test(x));
    const hasPersona = c.some((x) => x === "persona_id" || /_persona$/.test(x)) || t.name === "personas";
    assert.equal(hasRoot && hasPersona, false, `table ${t.name} links personas to roots: ${c.join(",")}`);
  }
});

test("006 down: refuses without a roster; refuses an incomplete roster transactionally; refuses an unknown root", () => {
  const db = pre006Db();
  const roster = seedV1(db);
  migrate(db);
  assert.throws(() => migrateDown(db, 6, null), /roster export .* required/);
  assert.throws(() => migrateDown(db, 6, { p_a1: "root_a", p_a2: "root_a" }), /lacks 1 persona/);
  // untouched after the refusal
  assert.equal(has006(db), true);
  assert.equal(cols(db, "personas").includes("root_id"), false);
  assert.ok(hasTable(db, "blocks_v2"));
  assert.throws(() => migrateDown(db, 6, { ...roster, p_b1: "root_nope" }), /unknown root/);
  assert.equal(has006(db), true);
});

test("006 down from a complete roster restores persona → root EXACTLY and the root-level blocks; up again re-applies", () => {
  const db = pre006Db();
  const roster = seedV1(db);
  const before = db.prepare("SELECT id, root_id, name, handle, avatar_url, bio, created_at FROM personas ORDER BY id").all();
  migrate(db);
  const r = migrateDown(db, 6, roster);
  assert.deepEqual(r, { restored: 3, quarantined: 0 });
  assert.equal(has006(db), false);
  const after = db.prepare("SELECT id, root_id, name, handle, avatar_url, bio, created_at FROM personas ORDER BY id").all();
  assert.deepEqual(after, before);
  assert.deepEqual(db.prepare("SELECT blocker_root, blocked_root FROM blocks").all().map((r) => ({ ...r })), [{ blocker_root: "root_a", blocked_root: "root_b" }]);
  assert.equal(hasTable(db, "blocks_v2"), false);
  assert.equal(hasTable(db, "blocks_legacy_export"), false);
  assert.equal(hasTable(db, "personas_orphaned_on_rollback"), false);
  // and up again
  migrate(db);
  assert.equal(has006(db), true);
  assert.equal(cols(db, "personas").includes("root_id"), false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM blocks_legacy_export").get().n, 1);
});

test("006 down with orphans=quarantine moves the unattributable persona aside (never deletes it) and restores the rest", () => {
  const db = pre006Db();
  const roster = seedV1(db);
  migrate(db);
  // a persona created AFTER 006 by a device that later forgot it
  db.prepare("INSERT INTO personas (id, name, handle, avatar_url, bio, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("p_orphan", "O", "orphan", null, null, Date.now());
  assert.throws(() => migrateDown(db, 6, roster), /lacks 1 persona.*p_orphan/);
  const r = migrateDown(db, 6, roster, { orphans: "quarantine" });
  assert.deepEqual(r, { restored: 3, quarantined: 1 });
  assert.deepEqual(db.prepare("SELECT id FROM personas ORDER BY id").all().map((x) => x.id), ["p_a1", "p_a2", "p_b1"]);
  // node:sqlite rows are null-prototype objects: compare plain copies
  const q = db.prepare("SELECT id, name, handle FROM personas_orphaned_on_rollback").all().map((r) => ({ ...r }));
  assert.deepEqual(q, [{ id: "p_orphan", name: "O", handle: "orphan" }]);
});
