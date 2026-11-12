"use strict";
// Polls Neynar for engagement on each registered root's account and accrues
// rep events (diffed against the last snapshot). Trusted in phase 1; phase 2
// replaces this with attested event inclusion proofs. No-op without a key.

const NEYNAR = "https://api.neynar.com/v2/farcaster";

async function pollOnce(db, apiKey) {
  // Synthetic roots use fid >= 1000000 and never hit the network.
  const roots = db.prepare("SELECT id, fid FROM roots WHERE fid < 1000000").all();
  for (const root of roots) {
    try {
      const r = await fetch(NEYNAR + "/user/bulk?fids=" + root.fid, {
        headers: { "x-api-key": apiKey },
      });
      if (!r.ok) continue;
      const data = await r.json();
      const u = data.users && data.users[0];
      if (!u) continue;
      const snap = { followers: u.follower_count || 0 };
      const prevRow = db.prepare("SELECT snapshot FROM poll_state WHERE root_id = ?").get(root.id);
      const prev = prevRow ? JSON.parse(prevRow.snapshot) : null;
      if (prev && snap.followers > prev.followers) {
        db.prepare(
          "INSERT INTO rep_events (root_id, type, count, source_id, created_at) VALUES (?, 'follow_gained', ?, NULL, ?)"
        ).run(root.id, snap.followers - prev.followers, Date.now() - (Date.now() % 3600000)); // hour-grained (attack-mega-1 F1)
      }
      db.prepare(
        "INSERT INTO poll_state (root_id, snapshot) VALUES (?, ?) ON CONFLICT(root_id) DO UPDATE SET snapshot = excluded.snapshot"
      ).run(root.id, JSON.stringify(snap));

      // Recent casts: cast_created + likes/recasts/replies received.
      // Deduped via source_id so re-polls only accrue deltas (count snapshots
      // keyed by value; a growing count creates a new source_id row).
      const rc = await fetch(NEYNAR + "/feed/user/casts?fid=" + root.fid + "&limit=25", {
        headers: { "x-api-key": apiKey },
      });
      if (!rc.ok) continue;
      const feed = await rc.json();
      for (const cast of feed.casts || []) {
        const ins = db.prepare(
          "INSERT OR IGNORE INTO rep_events (root_id, type, count, source_id, created_at) VALUES (?, ?, ?, ?, ?)"
        );
        ins.run(root.id, "cast_created", 1, cast.hash, Date.now());
        const likes = (cast.reactions && cast.reactions.likes_count) || 0;
        const recasts = (cast.reactions && cast.reactions.recasts_count) || 0;
        const replies = (cast.replies && cast.replies.count) || 0;
        if (likes) ins.run(root.id, "like_received", likes, cast.hash + ":likes:" + likes, Date.now());
        if (recasts) ins.run(root.id, "recast_received", recasts, cast.hash + ":recasts:" + recasts, Date.now());
        if (replies) ins.run(root.id, "reply_received", replies, cast.hash + ":replies:" + replies, Date.now());
      }
    } catch (e) {
      console.error("[poller] root " + root.id + ": " + e.message);
    }
  }
}

function startPoller(db) {
  const apiKey = process.env.NEYNAR_API_KEY;
  // PROD-LIVE: the owner service's validator may hold NEYNAR_API_KEY only for the anon relay; the phase-1 rep
  // poller would then read the fixture fid every minute and spend Neynar credits for nothing.
  if (process.env.VALIDATOR_POLLER === "off") {
    console.log("[poller] VALIDATOR_POLLER=off - rep accrual poller disabled");
    return null;
  }
  if (!apiKey) {
    console.log("[poller] NEYNAR_API_KEY not set - rep accrual poller disabled (fixture mode)");
    return null;
  }
  console.log("[poller] polling Neynar every 60s");
  pollOnce(db, apiKey);
  return setInterval(() => pollOnce(db, apiKey), 60_000);
}

module.exports = { startPoller, pollOnce };
