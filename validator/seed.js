"use strict";
// Seeds the validator DB: the dev self root/persona, fixture-user roots +
// personas (so tier badges and For You filtering are live in fixture mode),
// and a synthetic rep population so percentile deciles are meaningful.
const path = require("node:path");
const fs = require("node:fs");
const { openDb, uid } = require("./db");
const data = require("../lib/fixtures/data.json");

const dbPath = process.env.VALIDATOR_DB || path.join(__dirname, "layers.db");
const force = process.argv.includes("--force");

// LAYERS_WORLD (lib/world.ts): "empty" = the demo world is never seeded — an empty database stays empty (a fresh
// owner deploy starts with nothing but the owner's own root), and this script never deletes: --force (which removes
// the database file) is refused under the flag. A database that already holds rows is skipped exactly as before. Any
// other value is a typo that would silently seed the demo world, and is refused (exit 78, EX_CONFIG) — including a
// variable that is present but EMPTY (review WORLD-GUARD-6): only an ABSENT variable means the demo world.
const world = process.env.LAYERS_WORLD;
if (world !== undefined && world !== "empty") {
  console.error('[seed] REFUSING: LAYERS_WORLD must be "empty" or absent' + (world === "" ? " (it is set but empty)" : ""));
  process.exit(78);
}
const emptyWorld = world === "empty";
if (emptyWorld && force) {
  console.error("[seed] REFUSING --force under LAYERS_WORLD=empty: it deletes the database file");
  process.exit(78);
}
// PUBLIC GO-LIVE (lib/platform/publicLive.ts): PUBLIC_LIVE=true on a PUBLIC validator (production, no dev hooks) seeds
// nothing into an empty database, and --force (which deletes the database file) is refused: a live site never loses
// rows. A database that already holds the demo world is NEVER deleted or rewritten here (the skip below runs first):
// each visitor's device hides those rows (lib/world.ts's partition, run in the tab). The value is "true", "false" or
// unset; anything else refuses (names and a length class only), like the app's boot. On a rig-shaped process the
// variable is ignored, and said: every rig suite keeps its demo world.
const liveRaw = process.env.PUBLIC_LIVE;
const publicShape = process.env.NODE_ENV === "production" && process.env.ZK_DEV_HOOKS !== "true";
if (publicShape && liveRaw !== undefined && liveRaw !== "" && liveRaw !== "true" && liveRaw !== "false") {
  console.error('[seed] REFUSING: PUBLIC_LIVE must be "true", "false" or unset (got a value of ' + liveRaw.length + " character(s))");
  process.exit(78);
}
if (!publicShape && liveRaw !== undefined && liveRaw !== "") console.warn("[seed] PUBLIC_LIVE is set on a rig-shaped process; it is ignored here (live mode is for the public site only)");
const publicLive = publicShape && liveRaw === "true";
if (publicLive && force) {
  console.error("[seed] REFUSING --force under PUBLIC_LIVE=true: it deletes the database file");
  process.exit(78);
}
// review WORLD-GUARD-6: the resolved world is ALWAYS said, in both worlds — a seed log with no WORLD line is itself the
// signal that something else ran
console.log(
  "[seed] WORLD: " +
    (publicLive
      ? "live (PUBLIC_LIVE=true) — nothing is seeded; rows already stored are kept, and hidden by each visitor's device"
      : emptyWorld
        ? "empty (LAYERS_WORLD=empty) — nothing is seeded"
        : "demo (LAYERS_WORLD absent) — the demo world is seeded into an empty database")
);

if (force && fs.existsSync(dbPath)) fs.rmSync(dbPath);
const db = openDb(dbPath);

const existing = db.prepare("SELECT COUNT(*) AS n FROM roots").get().n;
if (existing > 0) {
  console.log("[seed] DB already has " + existing + " roots — skipping (use --force to reseed)");
  process.exit(0);
}
if (emptyWorld) {
  console.log("[seed] LAYERS_WORLD=empty — the demo world is not seeded; the empty database stays empty (no roster written)");
  process.exit(0);
}
if (publicLive) {
  console.log("[seed] PUBLIC_LIVE=true — the demo world is not seeded; the empty database stays empty (no roster written)");
  process.exit(0);
}

const now = Date.now() - (Date.now() % 3600000); // rep rows carry the hour (attack-mega-1 F1)
const roster = { roots: {}, fids: {} }; // the device-side persona → root roster, known only at insert time
// Gate 5 (attack-custody-1 #11): seeded roots carry the sentinel anchor "seed" — never NULL, so never claimable by
// a signed stranger who knows a seed signer id
const insRoot = { run: (id, fid, signer, at) => db.prepare("INSERT INTO roots (id, fid, signer_uuid, created_at, anchor) VALUES (?, ?, ?, ?, 'seed')").run(id, fid, signer, at) };
const insPersona = db.prepare(
  "INSERT INTO personas (id, name, handle, avatar_url, bio, created_at) VALUES (?, ?, ?, ?, ?, ?)"
);
const insEvent = db.prepare(
  "INSERT INTO rep_events (root_id, type, count, source_id, created_at) VALUES (?, ?, ?, ?, ?)"
);

// Gate 5 (attack-custody-1 #11): seeded roots carry the sentinel anchor "seed" — never NULL, never claimable
function addAccount(fid, signer, name, handle, avatarUrl, bio, score) {
  const rootId = uid("root");
  insRoot.run(rootId, fid, signer, now);
  const personaId = uid("persona");
  // ZK PASS 2 Gate 2: the persona row carries no root (006). The grouping a
  // fresh fixture needs is the DEVICE's: export it with
  // validator/export-roster.js BEFORE the first boot on a 006 build.
  insPersona.run(personaId, name, handle, avatarUrl, bio, now);
  if (score > 0) insEvent.run(rootId, "follow_gained", Math.ceil(score / 5), "seed:" + fid, now);
  roster.roots[rootId] = [personaId];
  roster.fids[String(fid)] = rootId;
  return { rootId, personaId };
}

// Self — the dev login. Mid-high rep from posting history.
const self = data.self;
const selfAcct = addAccount(
  self.fid,
  "dev-signer-jordan",
  self.displayName,
  self.username,
  self.pfpUrl,
  self.bio,
  Math.floor(self.followerCount / 10) + self.postCount
);
console.log("[seed] self persona: " + selfAcct.personaId + " (@" + self.username + ")");

// Fixture users. Score tracks follower count; tier1grinder lands in the
// bottom decile on purpose (For You filter demo).
for (const u of data.users) {
  const score = u.username === "tier1grinder" ? 0 : Math.floor(u.followerCount / 100);
  addAccount(u.fid, "seed-" + u.fid, u.displayName, u.username, u.pfpUrl, u.bio || null, score);
}

// Synthetic population (no personas) so percentiles have a base. Quadratic
// spread; first three sit at zero so genuinely-zero accounts share tier 1.
for (let i = 0; i < 50; i++) {
  const rootId = uid("root");
  insRoot.run(rootId, 2000000 + i, "synthetic-" + i, now);
  const score = i < 3 ? 0 : Math.floor(i * i * 0.8);
  if (score > 0) insEvent.run(rootId, "follow_gained", Math.ceil(score / 5), "seed:s" + i, now);
}

// BROWSER KEYSTORE PASS Gate 1 stage 2: the persona → root mapping exists ONLY here, at insert time — migration 006
// dropped the column, and export-roster.js (rightly) refuses to invent it on a post-006 database. Writing it here is
// what makes the rig reproducible from scratch: `node validator/seed.js --force` now yields both the database and
// the device-side roster that pairs with it, instead of depending on a snapshot taken once before 006 existed.
const rosterArg = process.argv.indexOf("--roster");
const rosterOut = rosterArg !== -1 ? process.argv[rosterArg + 1] : path.join(__dirname, "..", ".keystore", "fixture-roster.json");
if (rosterOut !== "none") {
  fs.mkdirSync(path.dirname(path.resolve(rosterOut)), { recursive: true });
  fs.writeFileSync(path.resolve(rosterOut), JSON.stringify({ ...roster, exportedAt: Date.now(), source: path.basename(dbPath) }, null, 2) + String.fromCharCode(10));
  console.log("[seed] device roster written: " + rosterOut + " (" + Object.keys(roster.roots).length + " roots)");
}

const roots = db.prepare("SELECT COUNT(*) AS n FROM roots").get().n;
const personas = db.prepare("SELECT COUNT(*) AS n FROM personas").get().n;
console.log("[seed] done: " + roots + " roots, " + personas + " personas (db: " + dbPath + ")");
