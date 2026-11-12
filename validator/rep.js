"use strict";
// Rep model. Implementation detail — NOT part of the API contract (see API.md).
const WEIGHTS = {
  cast_created: 1,
  reply_received: 2,
  like_received: 2,
  recast_received: 3,
  follow_gained: 5,
  // MEGA PASS 2 Gate 1: stewardship — stakes a delayed evaluation confirmed, posted once per
  // evaluated epoch with the account's own root handle (dedupes on source_id).
  // TUNE: owner has unresolved design intent here — how much confirmed stewardship is worth
  // against a follow (5) or a recast (3) is a product call, not a settled one.
  stewardship: 4,
};

function scoreForRoot(db, rootId) {
  let total = 0;
  const rows = db
    .prepare("SELECT type, SUM(count) AS n FROM rep_events WHERE root_id = ? GROUP BY type")
    .all(rootId);
  for (const r of rows) total += (WEIGHTS[r.type] || 0) * r.n;
  return total;
}

// Percentile decile 1-10 across all roots. Ties resolve upward (<=).
function tierForRoot(db, rootId) {
  const roots = db.prepare("SELECT id FROM roots").all();
  if (roots.length === 0) return 1;
  const scores = new Map(roots.map((r) => [r.id, scoreForRoot(db, r.id)]));
  const mine = scores.get(rootId);
  if (mine === undefined) return 1;
  // ZK PASS 2 verify: an account with NO rep is tier 1 by definition, and the
  // deciles are computed over accounts WITH rep. Over a marathon the fixture
  // accumulates hundreds of zero-score signer-flow roots; with them in the
  // denominator every positive score sat above 80-90% of the population and
  // the whole decile model collapsed into tiers 9-10 (the seed's own intent:
  // "genuinely-zero accounts share tier 1"). validator/API.md documents it.
  if (mine <= 0) return 1;
  const positives = [...scores.values()].filter((s) => s > 0);
  let atOrBelow = 0;
  for (const s of positives) if (s <= mine) atOrBelow++;
  const percentile = atOrBelow / positives.length;
  return Math.max(1, Math.min(10, Math.ceil(percentile * 10)));
}

// PERSONA LAUNCH wave 3 (verify, epoch-build cost): tierForRoot for MANY roots against ONE read of the scores — the same
// answer tierForRoot gives each of them (same weights, same "zero rep is tier 1", same deciles over the roots WITH rep,
// ties upward), in O(roots + events) instead of O(roots) queries PER root. zk.js buildTrees asked tierForRoot once per
// registration, so a new epoch cost registrations x roots score queries (212 x 3,058 on the rig by 2026-10-13: ~3-9 s of
// a synchronous event loop, long enough that kept-alive sockets were reset under the suites — ECONNRESET in accept-z2).
// validator/test/reptiers.test.js pins the equivalence on random populations.
function tiersForRoots(db, rootIds) {
  const roots = db.prepare("SELECT id FROM roots").all();
  const out = new Map();
  if (roots.length === 0) {
    for (const id of rootIds) out.set(id, 1);
    return out;
  }
  const scores = new Map(roots.map((r) => [r.id, 0]));
  for (const r of db.prepare("SELECT root_id, type, SUM(count) AS n FROM rep_events GROUP BY root_id, type").all()) {
    if (scores.has(r.root_id)) scores.set(r.root_id, scores.get(r.root_id) + (WEIGHTS[r.type] || 0) * r.n);
  }
  const positives = [...scores.values()].filter((s) => s > 0);
  for (const id of rootIds) {
    if (out.has(id)) continue;
    const mine = scores.get(id);
    if (mine === undefined || mine <= 0) {
      out.set(id, 1);
      continue;
    }
    let atOrBelow = 0;
    for (const s of positives) if (s <= mine) atOrBelow++;
    out.set(id, Math.max(1, Math.min(10, Math.ceil((atOrBelow / positives.length) * 10))));
  }
  return out;
}

module.exports = { WEIGHTS, scoreForRoot, tierForRoot, tiersForRoots };
