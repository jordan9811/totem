#!/usr/bin/env node
// Deterministic seed generator. `npm run seed`. No Date.now()/Math.random()
// anywhere — timestamps are stored as relative `minutesAgo` offsets,
// resolved to absolute time by the mock adapters at read time, exactly
// like the phase-1 fixture convention (lib/data.ts). Same seed in, same
// /seed/data/*.json out, every time.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRng } from "./prng.mjs";
import { ACCOUNTS, CLUSTERS, VIEWER } from "./content/accounts.mjs";
import { PHRASES, REPLY_OPENERS } from "./content/phrases.mjs";
import { LONGFORM } from "./content/longform.mjs";
import { REPLY_CHAINS, ARGUMENT_THREADS, QUOTE_PAIRS, BREAKING_NEWS } from "./content/anchors.mjs";
import { DEMO_TAGS, VIEWER_DEMO_TAGS } from "./content/demoTags.mjs";
import { CHANNELS, FOLDERS, ROOMS } from "./content/spaces.mjs";
import {
  CLAIM_CATALOGUE,
  VIEWER_SEED_CLAIMS,
  CONNECTORS,
  CAMPAIGNS,
  SETTLEMENT_HISTORY,
} from "./content/graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "data");
const SEED = 133742; // fixed — determinism depends on this never reading from the environment

const rng = makeRng(SEED);

// ---------- roots, personas, tiers ----------

const FID_BASE = 5_000_000; // disjoint from phase-1 fixtures (1000001+, 9152) and validator synthetics (2000000+)

const roots = [];
const personas = [];
const tierByRootId = new Map();

function tierFor(rep) {
  if (rep === "whale") return rng.pick([9, 10]);
  if (rep === "low") return rng.pick([1, 2]);
  return rng.int(4, 8);
}

ACCOUNTS.forEach((acc, i) => {
  const rootId = `root_${acc.id}`;
  const fid = FID_BASE + i;
  const tier = tierFor(acc.rep);
  roots.push({ id: rootId, fid, signerUuid: `seed-signer-${acc.id}` });
  tierByRootId.set(rootId, tier);
  personas.push({
    id: `persona_${acc.id}`,
    rootId,
    name: acc.name,
    handle: acc.handle,
    avatarUrl: acc.avatar,
    bio: acc.bio,
    cluster: acc.cluster,
    tier,
    demoTags: DEMO_TAGS[acc.id] ?? [],
  });
  if (acc.extraPersona) {
    personas.push({
      id: `persona_${acc.extraPersona.id}`,
      rootId, // SAME root — this is the cross-persona linkage test fixture
      name: acc.extraPersona.name,
      handle: acc.extraPersona.handle,
      avatarUrl: acc.extraPersona.avatar,
      bio: acc.extraPersona.bio,
      cluster: acc.extraPersona.cluster,
      tier,
      demoTags: DEMO_TAGS[acc.extraPersona.id] ?? [],
    });
  }
});

// Viewer root + personas (fixed fid matching phase-1 dev identity so the
// existing session/cookie flow keeps working unmodified).
const viewerRootId = VIEWER.rootId;
roots.push({ id: viewerRootId, fid: VIEWER.fid, signerUuid: "dev-signer-jordan" });
tierByRootId.set(viewerRootId, 8);
for (const p of VIEWER.personas) {
  personas.push({
    id: p.id,
    rootId: viewerRootId,
    name: p.name,
    handle: p.handle,
    avatarUrl: p.avatar,
    bio: p.bio,
    cluster: p.cluster,
    tier: 8,
    demoTags: VIEWER_DEMO_TAGS[p.id] ?? [],
  });
}

const personaByHandle = new Map(personas.map((p) => [p.handle, p]));
const personaByIdLocal = new Map(personas.map((p) => [p.id, p]));
const personaByAccId = new Map(ACCOUNTS.map((acc) => [acc.id, personaByHandle.get(acc.handle)]));

function personaFor(accId) {
  const p = personaByAccId.get(accId);
  if (!p) throw new Error(`unknown seed account id: ${accId}`);
  return p;
}

// ---------- posts ----------

const posts = [];
const anchorHashByKey = new Map(); // for notes.json lookups
let postCounter = 0;

function engagementFor(tier, rng2) {
  const scale = Math.max(1, tier) * Math.max(1, tier);
  return {
    replies: rng2.int(0, Math.round(3 + scale / 3)),
    likes: rng2.int(0, Math.round(8 + scale * 6)),
    recasts: rng2.int(0, Math.round(1 + scale)),
    views: rng2.int(50, Math.round(400 + scale * 220)),
  };
}

function addPost({ authorAccId, text, minutesAgo, replyToHash = null, quoteOfHash = null, storyId = null, isUpdate = false, truncate = false, anchorKey = null }) {
  postCounter += 1;
  const persona = personaFor(authorAccId);
  const hash = `0x${persona.cluster.slice(0, 2)}${String(postCounter).padStart(4, "0")}`;
  const eng = engagementFor(persona.tier, rng);
  const post = {
    hash,
    authorAccId,
    authorPersonaId: persona.id,
    text,
    minutesAgo,
    replyToHash,
    quoteOfHash,
    storyId,
    isUpdate,
    truncate,
    ...eng,
  };
  posts.push(post);
  if (anchorKey) anchorHashByKey.set(anchorKey, hash);
  return hash;
}

// -- long-form (10) --
let t = 4000;
for (const cluster of CLUSTERS) {
  for (const lf of LONGFORM[cluster]) {
    t -= rng.int(60, 400);
    addPost({ authorAccId: lf.authorId, text: lf.text, minutesAgo: t, truncate: true, anchorKey: `longform_${cluster}_${LONGFORM[cluster].indexOf(lf)}` });
  }
}

// -- reply chains (5 clusters x 5 posts, 4+ deep) --
for (const cluster of CLUSTERS) {
  const chain = REPLY_CHAINS[cluster];
  let prevHash = null;
  let ct = rng.int(600, 2200);
  chain.forEach((entry, i) => {
    ct -= rng.int(15, 90);
    const key = i === 0 ? `reply_root_${cluster}` : null;
    const hash = addPost({ authorAccId: entry.authorId, text: entry.text, minutesAgo: ct, replyToHash: prevHash, anchorKey: key });
    prevHash = hash;
  });
}

// -- argument threads (5 clusters, 4-5 posts each) --
for (const cluster of CLUSTERS) {
  const thread = ARGUMENT_THREADS[cluster];
  let prevHash = null;
  let at = rng.int(600, 2600);
  thread.forEach((entry, i) => {
    at -= rng.int(20, 100);
    const key = i === 0 ? `argument_root_${cluster}` : null;
    const hash = addPost({ authorAccId: entry.authorId, text: entry.text, minutesAgo: at, replyToHash: prevHash, anchorKey: key });
    prevHash = hash;
  });
}

// -- quote pairs (5 clusters x 2) --
for (const cluster of CLUSTERS) {
  const pair = QUOTE_PAIRS[cluster];
  const qt = rng.int(600, 3000);
  const baseHash = addPost({ authorAccId: pair.base.authorId, text: pair.base.text, minutesAgo: qt, anchorKey: `quote_base_${cluster}` });
  addPost({ authorAccId: pair.quote.authorId, text: pair.quote.text, minutesAgo: qt - rng.int(20, 200), quoteOfHash: baseHash });
}

// -- breaking news (4: 3 initial + 1 later update) --
for (const bn of BREAKING_NEWS.posts) {
  addPost({ authorAccId: bn.authorId, text: bn.text, minutesAgo: bn.minutesAgo, storyId: BREAKING_NEWS.storyId, isUpdate: bn.isUpdate });
}

// -- filler posts to reach ~400 total --
const TARGET_TOTAL = 400;
const clusterWeights = CLUSTERS.map((c) => ACCOUNTS.filter((a) => a.cluster === c).length);
const totalWeight = clusterWeights.reduce((a, b) => a + b, 0);

// Per-cluster shuffled phrase cursors so we exhaust variety before repeating.
const cursors = Object.fromEntries(CLUSTERS.map((c) => [c, { order: rng.shuffle(PHRASES[c].map((_, i) => i)), pos: 0 }]));
function nextPhrase(cluster) {
  const cur = cursors[cluster];
  if (cur.pos >= cur.order.length) {
    cur.order = rng.shuffle(PHRASES[cluster].map((_, i) => i));
    cur.pos = 0;
  }
  const idx = cur.order[cur.pos++];
  return PHRASES[cluster][idx];
}

// Filler ages span ~3 days, weighted toward recent (power curve) so the
// feed has a realistic gradient instead of piling up at the age floor.
const FILLER_SPAN_MINUTES = 4320;
while (posts.length < TARGET_TOTAL) {
  // weighted cluster pick
  let r = rng.float() * totalWeight;
  let clusterIdx = 0;
  for (; clusterIdx < CLUSTERS.length; clusterIdx++) {
    r -= clusterWeights[clusterIdx];
    if (r <= 0) break;
  }
  const cluster = CLUSTERS[Math.min(clusterIdx, CLUSTERS.length - 1)];
  const clusterAccounts = ACCOUNTS.filter((a) => a.cluster === cluster);
  const author = rng.pick(clusterAccounts);

  const combine = rng.bool(0.55);
  let text = nextPhrase(cluster);
  text = text[0].toUpperCase() + text.slice(1);
  if (combine) {
    const second = nextPhrase(cluster);
    text += ". " + second[0].toUpperCase() + second.slice(1);
  }
  if (rng.bool(0.12)) {
    text = rng.pick(REPLY_OPENERS) + " — " + text;
  }

  const age = Math.max(3, Math.floor(Math.pow(rng.float(), 1.7) * FILLER_SPAN_MINUTES));
  addPost({ authorAccId: author.id, text, minutesAgo: age });
}

// ---------- notes (5), gate: tier>=3 AND endorsements>=2 for the client
// policy, 4 qualify / 1 fails on endorsement count only ----------

const noteTargets = [
  { key: "argument_root_crypto", authorAccId: "acc_crypto_4", endorsements: 3, id: "note_1" },
  { key: "reply_root_fantasy", authorAccId: "acc_fantasy_4", endorsements: 4, id: "note_2" },
  { key: "reply_root_astronomy", authorAccId: "acc_astro_1", endorsements: 2, id: "note_3" },
  { key: "argument_root_restaurants", authorAccId: "acc_food_3", endorsements: 5, id: "note_4" },
  { key: "quote_base_history", authorAccId: "acc_hist_2", endorsements: 1, id: "note_5" }, // FAILS gate: endorsements < 2
];

const notes = noteTargets.map((nt) => {
  const postHash = anchorHashByKey.get(nt.key);
  const authorPersona = personaFor(nt.authorAccId);
  const qualifies = authorPersona.tier >= 3 && nt.endorsements >= 2;
  return {
    id: nt.id,
    postHash,
    authorPersonaId: authorPersona.id,
    endorsements: nt.endorsements,
    text: qualifies
      ? "Additional context: this claim is broadly accurate but omits a widely-cited counterexample readers should weigh before sharing further."
      : "Context: disputed by some readers; endorsement count has not yet cleared the community threshold for a verified note.",
    qualifies,
    minutesAgo: (posts.find((p) => p.hash === postHash)?.minutesAgo ?? 500) - rng.int(30, 200),
  };
});

// ---------- viewer state ----------

const followingPersonaIds = VIEWER.followingHandles.map((h) => {
  const p = personaByHandle.get(h);
  if (!p) throw new Error(`VIEWER.followingHandles references unknown handle: ${h}`);
  return p.id;
});

// 2 of the note-attached posts (qualifying ones) are liked by the viewer —
// notes reinjection acceptance test needs a positive case on a liked post.
const likedNotePosts = [anchorHashByKey.get("argument_root_crypto"), anchorHashByKey.get("reply_root_astronomy")];
const otherLikeCandidates = rng.shuffle(posts.filter((p) => !p.truncate && !likedNotePosts.includes(p.hash))).slice(0, 10).map((p) => p.hash);
const likedPostHashes = [...likedNotePosts, ...otherLikeCandidates];

const longformHashes = [...anchorHashByKey.entries()].filter(([k]) => k.startsWith("longform_")).map(([, v]) => v);
const bookmarkLongform = rng.shuffle(longformHashes).slice(0, 2);
const bookmarkOthers = rng.shuffle(posts.filter((p) => !bookmarkLongform.includes(p.hash) && !likedPostHashes.includes(p.hash))).slice(0, 4).map((p) => p.hash);
const bookmarkHashes = [...bookmarkLongform, ...bookmarkOthers];

const viewer = {
  fid: VIEWER.fid,
  rootId: viewerRootId,
  personas: VIEWER.personas.map((p) => p.id),
  activePersonaId: VIEWER.personas[0].id,
  followingPersonaIds,
  likedPostHashes,
  bookmarkedPostHashes: bookmarkHashes,
};

// ---------- write ----------

mkdirSync(OUT_DIR, { recursive: true });
// ---------- Wave 4: channels, folders, rooms ----------
// Channel back-posts are real posts carrying a channelId. Every read
// surface gates on channel membership, so these are invisible to
// non-members everywhere (acceptance criterion 1).

const channels = [];
const channelPosts = [];
for (const ch of CHANNELS) {
  const owner = personaFor(ch.ownerAccId);
  channels.push({
    id: ch.id,
    name: ch.name,
    description: ch.description,
    cluster: ch.cluster,
    policy: ch.policy,
    ownerPersonaId: owner.id,
    createdAt: 0,
  });
  ch.posts.forEach((cp, i) => {
    const author = personaFor(cp.authorAccId);
    channelPosts.push({
      hash: `0x${ch.id.replace(/[^a-z0-9]/g, "").slice(0, 8)}${String(i).padStart(2, "0")}`,
      authorAccId: cp.authorAccId,
      authorPersonaId: author.id,
      text: cp.text,
      minutesAgo: cp.minutesAgo,
      replyToHash: null,
      quoteOfHash: null,
      storyId: null,
      isUpdate: false,
      truncate: false,
      replies: rng.int(0, 6),
      likes: rng.int(3, 60),
      recasts: rng.int(0, 8),
      views: rng.int(200, 4000),
      channelId: ch.id,
    });
  });
}
posts.push(...channelPosts);

// Folders: pick real seeded posts so folder cards link to genuine content.
const folders = [];
for (const f of FOLDERS) {
  const owner = personaFor(f.ownerAccId);
  const pool = posts.filter(
    (x) =>
      !x.channelId &&
      !x.replyToHash &&
      personaByIdLocal.get(x.authorPersonaId)?.cluster === f.pick.cluster
  );
  const longFirst = f.pick.preferLongform
    ? [...pool].sort((a, b) => Number(b.truncate) - Number(a.truncate))
    : pool;
  folders.push({
    id: f.id,
    name: f.name,
    ownerPersonaId: owner.id,
    isPublic: f.isPublic,
    postHashes: longFirst.slice(0, f.pick.count).map((x) => x.hash),
    createdAt: 0,
  });
}

const rooms = ROOMS.map((r) => ({
  id: r.id,
  title: r.title,
  topicCluster: r.topicCluster,
  hostPersonaId: personaFor(r.hostAccId).id,
  status: "scheduled",
  scheduledForMinutes: r.scheduledInMinutes,
  script: r.script.map((m) => ({
    atMs: m.atMs,
    personaId: personaFor(m.accId).id,
    text: m.text,
  })),
  mutedPersonaIds: [],
  pinnedMessageId: null,
  openedAt: null,
  closedAt: null,
}));

writeFileSync(
  path.join(OUT_DIR, "spaces.json"),
  JSON.stringify({ channels, folders, rooms }, null, 2) + "\n"
);
console.log(
  `[seed] ${channels.length} channels (${channelPosts.length} channel posts), ${folders.length} folders (${folders.filter((f) => f.isPublic).length} public), ${rooms.length} rooms`
);


// ---------- Wave 5/6: graph, campaigns, settlement ----------
// Precomputed match index (gated-pass failure mode: do NOT recompute the
// whole campaign set on every claim toggle). claimValue -> campaign ids.
const campaigns = CAMPAIGNS.map((c) => ({
  id: c.id,
  name: c.name,
  advertiserPersonaId: personaFor(c.advertiserAccId).id,
  budget: c.budget,
  audience: c.audience,
  status: "live",
  createdAt: 0,
}));

const matchIndex = {};
for (const c of CAMPAIGNS) {
  for (const clause of c.audience.clauses) {
    if (clause.field === "graph.claim") {
      (matchIndex[clause.value] ??= []).push(c.id);
    }
  }
}

// Synthetic audience population: which seeded personas hold which claims.
// Used for k-anonymity audience-size estimates. Deterministic.
const audiencePopulation = personas.map((p) => {
  const claims = [];
  if (p.cluster === "crypto") claims.push("market_structure", "longform_reader");
  if (p.cluster === "astronomy") claims.push("telescope", "astronomy");
  if (p.cluster === "restaurants") claims.push("espresso", "coffee_weekly", "ramen");
  if (p.cluster === "fantasy") claims.push("fantasy_football", "watches_sports");
  if (p.cluster === "history") claims.push("longform_reader");
  // A deliberately rare claim so the k-floor can actually be tripped.
  if (p.handle === "footnote_feiler" || p.handle === "marginalia_mo") claims.push("military_history");
  if (rng.bool(0.35)) claims.push("espresso");
  if (rng.bool(0.3)) claims.push("longform_reader");
  return { personaId: p.id, tier: p.tier, claims };
});

const viewerClaims = VIEWER_SEED_CLAIMS.map((c, i) => {
  const cat = CLAIM_CATALOGUE[c.category].find((x) => x.value === c.value);
  return {
    id: "claim_seed_" + i,
    personaId: VIEWER.personas[0].id,
    category: c.category,
    label: cat ? cat.label : c.value,
    value: c.value,
    source: "self",
    issuer: null,
    issuedAt: null,
    active: true,
  };
});

const settlements = SETTLEMENT_HISTORY.map((e, i) => ({
  id: "settle_seed_" + i,
  kind: e.kind,
  personaId: VIEWER.personas[0].id,
  amount: e.amount,
  category: e.category,
  note: e.note,
  // relative offsets, resolved at read time like every other seeded time
  minutesAgo: (i + 1) * 240,
}));

writeFileSync(
  path.join(OUT_DIR, "graph.json"),
  JSON.stringify(
    {
      catalogue: CLAIM_CATALOGUE,
      connectors: CONNECTORS,
      viewerClaims,
      campaigns,
      matchIndex,
      audiencePopulation,
      settlements,
    },
    null,
    2
  ) + "\n"
);
console.log(
  `[seed] graph: ${viewerClaims.length} viewer claims, ${CONNECTORS.length} connectors, ${campaigns.length} campaigns, ${settlements.length} settlement events`
);

writeFileSync(path.join(OUT_DIR, "accounts.json"), JSON.stringify({ roots, personas, tiers: Object.fromEntries(tierByRootId) }, null, 2) + "\n");
// ZK PASS 1 Gate 2: the demo user's second persona needs ONE top-level post
// so the proof-mediated discovery gate has a candidate of OUR root to gate.
// Appended AFTER every RNG-driven pick over `posts` (likes, bookmarks,
// notes) so regeneration leaves everything before it byte-identical; fixed
// hash, no RNG, and old enough never to displace existing top-40 content.
{
  const viewerAlt = personas.find((p) => p.id === "persona_viewer_alt");
  if (viewerAlt) {
    posts.push({
      hash: "0xvw0001",
      authorAccId: viewerAlt.rootId,
      authorPersonaId: viewerAlt.id,
      text: "Backyard seeing report: steady air after midnight, the double in Lyra split clean at 180x. Worth the cold.",
      minutesAgo: 700,
      replyToHash: null,
      quoteOfHash: null,
      storyId: null,
      isUpdate: false,
      truncate: false,
      replies: 2,
      likes: 14,
      recasts: 1,
      views: 820,
    });
  }
}
writeFileSync(path.join(OUT_DIR, "posts.json"), JSON.stringify({ posts, storyId: BREAKING_NEWS.storyId }, null, 2) + "\n");
writeFileSync(path.join(OUT_DIR, "notes.json"), JSON.stringify({ notes }, null, 2) + "\n");

// --wipe also clears persisted adapter state (user-created modes, rules,
// grants, channels, market state). Without it, `npm run seed` regenerates
// seed CONTENT while preserving everything the user built on top of it.
if (process.argv.includes("--wipe")) {
  const base = process.env.VALIDATOR_URL || "http://localhost:4000";
  try {
    const res = await fetch(base + "/state", { method: "DELETE" });
    console.log(res.ok ? "[seed] --wipe: adapter state cleared" : "[seed] --wipe: validator returned " + res.status);
  } catch {
    console.log("[seed] --wipe: validator unreachable, adapter state left as-is");
  }
} else {
  console.log("[seed] user-created state preserved (pass --wipe to clear it)");
}

writeFileSync(path.join(OUT_DIR, "viewer.json"), JSON.stringify({ viewer }, null, 2) + "\n");

// ---------- summary ----------

const longformCount = posts.filter((p) => p.truncate).length;
const replyCount = posts.filter((p) => p.replyToHash).length;
const quoteCount = posts.filter((p) => p.quoteOfHash).length;
const storyCount = posts.filter((p) => p.storyId).length;

console.log(`[seed] ${roots.length} roots, ${personas.length} personas (${personas.length - roots.length} extra personas beyond 1-per-root)`);
console.log(`[seed] ${posts.length} posts total (target ${TARGET_TOTAL}): ${longformCount} long-form, ${replyCount} replies, ${quoteCount} quotes, ${storyCount} story-tagged`);
console.log(`[seed] ${notes.length} notes (${notes.filter((n) => n.qualifies).length} qualify, ${notes.filter((n) => !n.qualifies).length} fail gate)`);
console.log(`[seed] viewer: ${viewer.followingPersonaIds.length} following, ${viewer.likedPostHashes.length} likes, ${viewer.bookmarkedPostHashes.length} bookmarks (${bookmarkLongform.length} long-form)`);
console.log(`[seed] wrote to ${OUT_DIR}`);
