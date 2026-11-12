"use strict";
// PERSONA LAUNCH wave 3 (verify) — THE EPOCH BUILD'S COST AND ATOMICITY (validator/rep.js tiersForRoots, validator/zk.js
// buildTrees).
//
// Why: buildTrees asked tierForRoot once per registration, and tierForRoot scores EVERY root each time — registrations x
// roots score queries per new epoch — and then wrote each signed placement as its own autocommit. On the rig's database
// (3,058 roots, 212 registrations by 2026-10-13) a new epoch held the validator's event loop for 3-9 s, long enough that
// kept-alive sockets were reset under the suites (ECONNRESET in accept-z2 6, a refused drain in accept-z2 7). Now the
// tiers come from ONE read of the scores and the epoch's whole write is one savepoint.
//
//   1. tiersForRoots gives EXACTLY tierForRoot's answer for every root, on random populations that include zero-rep roots,
//      ties, unknown event types, an id that is not a root at all, and a duplicate id.
//   2. A failure part-way through an epoch's write keeps NOTHING of that epoch (no history entry, no placement) and drops
//      the cached trees, so the next read builds the epoch whole — a trigger on zk_placements injects the failure.
//
// Real validator (createApp over a temp database, an ephemeral loopback port); no network.
process.env.ZK_DEV_HOOKS = "true";
delete process.env.LAYERS_REQUIRE_SIG;

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { openDb } = require("../db");
const { tierForRoot, tiersForRoots, WEIGHTS } = require("../rep");
const { createApp } = require("../server");

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "layers-reptiers-test-"));
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test("tiersForRoots answers exactly what tierForRoot answers, root by root, on random populations (zero rep, ties, unknown types, a non-root id, a duplicate)", () => {
  const types = [...Object.keys(WEIGHTS), "not_a_weighted_type"];
  let compared = 0;
  let distinctTiers = new Set();
  for (let trial = 0; trial < 12; trial++) {
    const db = openDb(path.join(dir, `pop-${trial}.db`));
    try {
      const n = 5 + trial * 7;
      const ids = [];
      for (let i = 0; i < n; i++) {
        const id = `root_t${trial}_${i}`;
        ids.push(id);
        db.prepare("INSERT INTO roots (id, fid, signer_uuid, created_at) VALUES (?, ?, ?, ?)").run(id, 800000000 + trial * 1000 + i, `s-${trial}-${i}`, 0);
        // a third have no rep at all; the rest a few events, with deliberate ties (small integer counts)
        if (i % 3 === 0) continue;
        const events = 1 + (randomBytes(1)[0] % 4);
        for (let e = 0; e < events; e++) {
          const type = types[randomBytes(1)[0] % types.length];
          db.prepare("INSERT INTO rep_events (root_id, type, count, source_id, created_at) VALUES (?, ?, ?, ?, ?)").run(id, type, 1 + (randomBytes(1)[0] % 3), `src-${trial}-${i}-${e}`, 0);
        }
      }
      // (an event for a root that does not exist cannot be written: rep_events.root_id references roots) — an id that is
      // not a root is asked below
      const asked = [...ids, "root_not_there", ids[1]]; // a duplicate too
      const many = tiersForRoots(db, asked);
      for (const id of asked) {
        const one = tierForRoot(db, id);
        assert.equal(many.get(id), one, `trial ${trial}: ${id} → tiersForRoots ${many.get(id)} vs tierForRoot ${one}`);
        distinctTiers.add(one);
        compared++;
      }
    } finally {
      db.close();
    }
  }
  // non-vacuous: many comparisons, and the populations really spread over the deciles (tier 1 AND high tiers)
  assert.ok(compared > 400, "compared only " + compared);
  assert.ok(distinctTiers.has(1) && distinctTiers.has(10) && distinctTiers.size >= 6, "the populations did not spread over the deciles: " + [...distinctTiers].sort((a, b) => a - b).join(","));
  // and the empty population: every id is tier 1, as tierForRoot says
  const empty = openDb(path.join(dir, "empty.db"));
  try {
    assert.equal(tiersForRoots(empty, ["root_x"]).get("root_x"), tierForRoot(empty, "root_x"));
    assert.equal(tiersForRoots(empty, ["root_x"]).get("root_x"), 1);
  } finally {
    empty.close();
  }
});

test("an epoch's write is atomic: a failure part-way keeps no history entry and no placement of that epoch, and the next read builds it whole", async () => {
  const { app, db } = createApp(path.join(dir, "atomic.db"));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const api = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    assert.equal((await api("POST", "/zk/dev/seed-decoys", { mode: "fixture", count: 6 })).status, 200);
    const adv = await api("POST", "/zk/dev/advance-epoch", { mode: "fixture" });
    assert.equal(adv.status, 200);
    const epoch = adv.json.epoch;
    const rows = () => ({
      history: db.prepare("SELECT COUNT(*) AS n FROM zk_root_history WHERE mode = 'fixture' AND epoch = ?").get(epoch).n,
      placements: db.prepare("SELECT COUNT(*) AS n FROM zk_placements WHERE mode = 'fixture' AND epoch = ?").get(epoch).n,
    });
    assert.deepEqual(rows(), { history: 0, placements: 0 }, "the epoch was built before the test asked for it");
    // inject a failure in the MIDDLE of the epoch's write: the third leaf of tier-1 (other trees are written before it)
    db.exec("CREATE TRIGGER reptiers_fail_mid BEFORE INSERT ON zk_placements WHEN NEW.tree = 'tier-1' AND NEW.leaf_index = 2 BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    const failed = await api("GET", "/zk/members?mode=fixture&tree=valid");
    assert.ok(failed.status >= 500, "the injected failure did not surface: " + failed.status + " " + JSON.stringify(failed.json));
    assert.deepEqual(rows(), { history: 0, placements: 0 }, "a failed epoch build kept part of its write");
    db.exec("DROP TRIGGER reptiers_fail_mid");
    // the cached trees were dropped with the write: the next read builds and FREEZES the epoch whole
    const ok = await api("GET", "/zk/members?mode=fixture&tree=tier-1");
    assert.equal(ok.status, 200, "members after the failure: " + JSON.stringify(ok.json));
    assert.ok(ok.json.members.length >= 3, "tier-1 has " + ok.json.members.length + " members (the injection needs at least 3)");
    const after = rows();
    const trees = db.prepare("SELECT COUNT(DISTINCT tree) AS n FROM zk_root_history WHERE mode = 'fixture' AND epoch = ?").get(epoch).n;
    assert.ok(after.history >= 2 && after.history === trees, "history after the rebuild: " + JSON.stringify(after));
    const tier1 = db.prepare("SELECT COUNT(*) AS n FROM zk_placements WHERE mode = 'fixture' AND epoch = ? AND tree = 'tier-1'").get(epoch).n;
    assert.equal(tier1, ok.json.members.length, "tier-1's placements do not match its served members");
  } finally {
    server.close();
    try {
      db.close();
    } catch {
      /* closed */
    }
  }
});
