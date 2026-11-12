// FC-READ — A LOOPBACK NEYNAR for the public live-read relay's tests (lib/fc/readRelay.server.ts, POST /api/fc/read).
//
// Why a stub and not recordings alone: the relay's whole contract is about WHAT IT SENDS UPSTREAM — a closed op table,
// no fid/viewer_fid/cursor/provider, never /notifications or a following feed (FC-READ (house): but the one pinned
// house request), the x-api-key it was given and no visitor header — and a fixture read from disk cannot see a
// request. The FC pass's lesson was that live-only parameters are exactly where fixtures lie (trending limit=25 against
// a documented maximum of 10), so this stub:
//   * serves the four real recordings in fixtures/neynar plus SYNTHESIZED shapes for the relay's four endpoints
//     (the discovery feed GET /feed/?feed_type=filter&filter_type=fids, /cast/conversation, /user/by_username,
//     /feed/user/casts), shaped as the recordings and notes/runbooks/NEYNAR-CONTRACT.md record them;
//   * ENFORCES the documented parameters and maxima with Neynar's own 400 shape (ErrorRes {message, code, property,
//     status}), so a relay that asks for more fails here exactly as it would against the network. FC-READ (no
//     channels): /feed from the CURRENT OAS contract (neynarxyz/OAS v3.184.0, read 2026-09-25): feed_type
//     following|filter, filter_type fids|parent_url|channel_id|embed_url|embed_types, fids at most 100 integers, limit
//     1..100. The others from the SDK typings v3.177.0 (lr-neynar): user casts <= 150, conversation <= 50;
//   * records the EXACT query string of every request, rejects anything but GET, and asserts the x-api-key header
//     equals the fake key it was started with (a length is logged, never a value);
//   * records a VIOLATION for any request the relay must never make — /notifications, a following feed other than
//     the pinned house request, a viewer_fid/cursor/provider parameter, a fid anywhere but /feed/user/casts and that
//     house request, a path outside the relay's table, a non-GET, a wrong key, a forwarded visitor header, and
//     FC-READ (no channels): ANY channel feed (/feed/channels, /feed/parent_urls, /channel/*, or /feed filtered by
//     channel_id or parent_url — the owner's v1 decision is that channels are not an emphasis), a discovery feed
//     filtered by anything but fids, and an endpoint Neynar has
//     REMOVED from its contract (/feed/trending, /feed/for_you, filter_type=global_trending) — and the suites FAIL
//     the run on any violation;
//   * counts hits, and can be told to answer the next N requests with a forced 429 or 5xx;
//   * plants the casts the suites need to prove the relay's moderation and the UI's media guard: an author with a LOW
//     Neynar score, one with NO score (missing = hidden), a hash on the operator denylist, an image on a host outside
//     the media allowlist, a cast whose text is made of page-health needle words (a real cast can say "404"), and
//     FC-READ (no channels) a REPLY by an admitted author inside the discovery feed (whether Neynar's fids filter
//     includes replies is unverified, so the relay must drop them itself). They are reached the way Neynar reaches
//     them — by their authors' fids — so the relay's FC_READ_FIDS must name those authors: `stubDiscoveryFids()` /
//     `node scripts/lib/neynar-stub.mjs fids` prints the list;
//   * FC-READ (house): serves the SECOND discovery source — the following feed of ONE designated house account
//     (STUB_HOUSE; `stubHouseFid()` / `node scripts/lib/neynar-stub.mjs house-fid`), shaped as the recorded
//     fixtures/neynar/feed-following.json ({casts, next: {cursor}}). The house "follows" every discovery author, so its
//     feed holds the same corpus, planted casts and in-feed reply included, and every planted-cast check measures
//     either source. Only the relay's PINNED house request is served clean (RELAY.house, houseRequestProblems()); any
//     other following-feed read — another fid, a viewer_fid, a cursor, another limit, a missing or extra parameter —
//     is still the following-feed violation, because that feed is per-account and only the operator's house account
//     is curation (D-FCREAD-HOUSE-ACCOUNT).
//
// Loopback only, never on a pinned port (3001/4001 the pair, 3009 accept-cu4's boot probes, 3100/3101 the M4 live
// suites). Default port 4319. Used two ways:
//   * in-process — `startNeynarStub({ port: 0 })` (scripts/accept-fcread.mjs's side apps, scripts/accept-cu4.mjs);
//   * as a process — `node scripts/lib/neynar-stub.mjs serve --port 4319` (scripts/run-prod-shape.sh under
//     PRODLIVE_FC_READ=stub), read and steered over HTTP under /__stub/ (stubClient below).
// The fake key must start "fcread-stub-": /__stub/state returns it so a suite can grep for it, and a key that could be
// a real one is refused at start rather than ever being served back.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ------------------------------------------------------------------------------------------------ the shared contract

/** ports the stub must never take (the pinned pair, accept-cu4's boot probes, the M4 live suites) */
export const FORBIDDEN_PORTS = new Set([3001, 4001, 3009, 3100, 3101]);
export const STUB_DEFAULT_PORT = 4319;
export const STUB_KEY_PREFIX = "fcread-stub-";
/** the relay's key shape (readRelay.server.ts KEY_SHAPE): a fake key must pass it, or the relay would not arm */
export const KEY_SHAPE = /^[A-Za-z0-9-]{16,80}$/;
export const HASH40 = /^0x[0-9a-f]{40}$/;

/** FC-READ: the relay contract as the suites read it (lead decision; lib/fc/readRelay.server.ts is the implementation
 *  and lib/fc/networkTarget.ts the write refusal). One copy for accept-fcread, accept-cu4 and smoke-deployed. */
export const RELAY = {
  path: "/api/fc/read",
  header: "x-layers-relay",
  /** the closed op table. FC-READ (no channels): "channel" is RETIRED — the owner's v1 decision is that channels are
   *  not an emphasis, so the relay offers no per-channel read and answers that op 400 bad_op with no upstream call */
  // NEYNAR AS A SWITCH (§42): the two search ops, answered only while FC_SOURCE_SEARCH asks for Neynar (else 503
  // fc_source_off, like every op whose surface is switched to the network)
  ops: ["status", "discovery", "thread", "user", "user-casts", "search-casts", "search-users"],
  retiredOps: ["channel"],
  reasons: ["armed", "no_key", "bad_key", "off", "not_public", "bad_base_url", "bad_config"],
  states: ["live", "stale", "off", "budget", "unarmed", "error"],
  /** FC-READ (no channels): no `channels` field any more — there is no channel allowlist to publish. The fid list is
   *  not published either (it is operator curation, and the status answer carries no number) */
  statusKeys: ["armed", "reason", "state"],
  /**
   * FC-READ (no channels): THE DECIDED V1 DISCOVERY READ — general, not channel-curated. One GET per miss:
   *   /v2/farcaster/feed/?feed_type=filter&filter_type=fids&fids=<FC_READ_FIDS>&with_recasts=false&limit=25
   * `fids` is the server-held author list (1..100 integers, the server's env only); every other value is a server
   * constant pinned here. No cursor (one page per miss: the relay refuses `cursor` by name), no viewer_fid (it would
   * only add viewer_context and one viewer's mutes). Price: /v2/farcaster/feed is 4 credits x page limit on Neynar's
   * credits page = 100 per miss. Why this endpoint: /feed/trending and filter_type=global_trending left Neynar's
   * contract in OAS v3.183.0 (2026-08-07), /feed/for_you in v3.182.0; this is the only in-contract feed that is not
   * per-viewer, not channel-based, and whose quality the operator controls (curation by AUTHOR).
   */
  discovery: {
    path: "/v2/farcaster/feed/",
    route: "/feed",
    params: { feed_type: "filter", filter_type: "fids", with_recasts: "false", limit: "25" },
    fidsParam: "fids",
    fidsEnv: "FC_READ_FIDS",
    maxFids: 100,
    maxLimit: 100,
    pagesPerMiss: 1,
    creditsPerMiss: 100,
  },
  /**
   * FC-READ (house): the SECOND discovery source, for the owner to choose in the morning (exactly ONE of the two may be
   * configured: FC_READ_FIDS xor FC_READ_HOUSE_FID; both, neither or a malformed value disarm with bad_config naming
   * the variable, never its value). FC_READ_HOUSE_FID is one positive integer fid — a Farcaster account the operator
   * controls — and discovery is that account's FOLLOWING feed: the owner curates by following and unfollowing in any
   * Farcaster client, with no redeploy and no 100-fid cap. One GET per miss:
   *   /v2/farcaster/feed/following/?fid=<FC_READ_HOUSE_FID>&with_recasts=false&limit=25
   * (Neynar's "Following" feed, reference/fetch-user-following-feed, read 2026-09-27 from the docs MCP: fid required,
   * viewer_fid / with_recasts / limit (default 25) / cursor optional; FeedResponse {casts, next}). The fid is the
   * SERVER's constant, pinned by value like `limit` — never a viewer_fid, never a client value — with no cursor (one
   * page per miss), replies dropped by the relay, and the same score floor, denylist and price: /feed/following is
   * 4 credits x page limit on Neynar's credits page = 100 a miss. EXACTLY this spelling (the relay's HOUSE_PATH,
   * trailing slash as Neynar documents it): the same read addressed as /v2/farcaster/feed/?feed_type=following stays
   * refused by the relay in both modes (its /feed/ pins are unchanged), so here it is the following-feed violation
   * like every other following-feed request.
   * D-FCREAD-HOUSE-ACCOUNT: the house account's follow list is public on Farcaster by nature; whoever controls that
   * account curates the public feed; losing control of it means losing curation, not keys (the relay holds none of
   * its keys and never writes).
   */
  house: {
    env: "FC_READ_HOUSE_FID",
    path: "/v2/farcaster/feed/following/",
    route: "/feed/following",
    fidParam: "fid",
    params: { with_recasts: "false", limit: "25" },
    maxLimit: 100,
    pagesPerMiss: 1,
    creditsPerMiss: 100,
  },
  /** FC-READ (house): the two discovery sources — exactly one may be set (the status op never says which) */
  sourceEnvs: ["FC_READ_FIDS", "FC_READ_HOUSE_FID"],
  networkReadOnly: {
    status: 403,
    code: "NETWORK_READ_ONLY",
    error: "Posting to Farcaster isn't on this preview yet. Reading is live; your own posts, folders and private posts still work.",
  },
  /** PUBLIC GO-LIVE (F11): the same refusal on a live site (PUBLIC_LIVE): lib/fc/networkTarget.ts NETWORK_READ_ONLY_LIVE */
  networkReadOnlyLive: {
    status: 403,
    code: "NETWORK_READ_ONLY",
    error: "Liking, replying to or recasting Farcaster posts from Totem isn't on this site yet. Reading is live; your own posts, folders and private posts still work.",
  },
  /** the design's global miss bucket (per minute, per instance) and per-address bucket (per 10 minutes). FC-READ
   *  (review): unchanged numbers, but the per-address bucket now takes a token for EVERY identifying lookup request
   *  (thread / user / user-casts), hit or miss, before the cache is consulted — and a discovery miss only; so a suite's
   *  lookups from one address (the local pair keys everything as "local") spend it even when they are cache hits */
  globalMissesPerMinute: 60,
  perAddressMisses: 20,
  /** FC-READ (review, cost-abuse-2): lookups may spend at most this share of the day; one address at most this share */
  lookupShare: 0.7,
  perAddressDailyShare: 0.05,
};

/**
 * FC-READ: what is wrong with a status-op answer — it is PUBLIC (any page can ask), so it may carry the documented
 * fields only, never a number (a budget, a spend, a remaining count) and never the key. Returns problems; [] = clean.
 */
export function statusProblems(json, key) {
  const out = [];
  if (!json || typeof json !== "object" || Array.isArray(json)) return ["not a JSON object"];
  for (const k of Object.keys(json)) {
    if (RELAY.statusKeys.includes(k)) continue;
    // FC-READ (no channels): named outright — a `channels` field is a build from before the owner's v1 decision
    out.push(k === "channels" ? "a channels field (there is no channel allowlist in v1: a build from before FC-READ (no channels)?)" : "undocumented field " + k);
  }
  const walk = (v, at) => {
    if (typeof v === "number" || typeof v === "bigint") out.push("a number at " + at);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, at + "[" + i + "]"));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      if (/credit|budget|spent|remain|quota|limit|count/i.test(k)) out.push("a budget-like field " + at + "." + k);
      walk(x, at + "." + k);
    }
  };
  walk(json, "$");
  if (typeof json.armed !== "boolean") out.push("armed is not a boolean");
  if (!RELAY.reasons.includes(json.reason)) out.push("reason " + JSON.stringify(json.reason) + " is not in the contract");
  if (json.state !== undefined && !RELAY.states.includes(json.state)) out.push("state " + JSON.stringify(json.state) + " is not in the contract");
  if (key && JSON.stringify(json).includes(key)) out.push("THE KEY");
  return out;
}

/** the synthetic accounts the stub plants: one below the default score floor (0.5), one with no score at all */
export const STUB_USERS = {
  low: { fid: 990001, username: "fcread-lowscore", score: 0.12 },
  none: { fid: 990002, username: "fcread-noscore", score: null },
};
/** a host outside every media allowlist: .invalid never resolves (RFC 2606), so a leak shows as an attempt, not a fetch */
export const STUB_MEDIA_HOST = "media.fcread-stub.invalid";
/** text markers the suites find planted casts by */
export const STUB_MARKERS = {
  media: "FCREAD-MEDIA",
  needle: "FCREAD-NEEDLE",
  low: "FCREAD-LOWSCORE",
  none: "FCREAD-NOSCORE",
  denied: "FCREAD-DENIED",
  reply: "FCREAD-REPLY",
  /** FC-READ (no channels): a reply INSIDE the discovery feed (a /feed fids filter may include replies; the relay
   *  must drop any cast with a parent itself). Not a substring of `reply`, and `reply` is not one of it. */
  feedReply: "FCREAD-INFEED",
  /** FC-READ (future-dated casts): a top-level cast dated decades ahead (the real network carries some); the relay
   *  drops any cast dated more than 10 minutes ahead of its clock, or it would sit on top of the recency-ordered feed */
  future: "FCREAD-FUTURE",
};
/** FC-READ (house): the ONE account the stub answers a following feed for, as the relay's FC_READ_HOUSE_FID. A
 *  synthetic fid (the 990xxx block, beside STUB_USERS) that no recording and no planted author carries, so a house fid
 *  riding any other request, or another fid riding a following feed, is unmistakable in the request log. */
export const STUB_HOUSE = { fid: 990100, username: "fcread-house" };
if (Object.values(STUB_USERS).some((u) => u.fid === STUB_HOUSE.fid)) throw new Error("neynar-stub: STUB_HOUSE collides with a synthetic user");
/** FC-READ (house): the FC_READ_HOUSE_FID a relay pointed at this stub holds in house mode */
export function stubHouseFid() {
  return STUB_HOUSE.fid;
}
/** the planted cast the operator denylist names (run-prod-shape passes it as FC_READ_DENY) */
export const STUB_DENY_HASH = "0x" + "deadfc" + "0".repeat(32) + "d1";
if (!HASH40.test(STUB_DENY_HASH)) throw new Error("neynar-stub: STUB_DENY_HASH is not 0x + 40 hex");
/** FC-READ (future-dated casts): the planted future-dated cast's hash, and the date it keeps in every answer (the feeds'
 *  recency re-stamping leaves it alone) — the shape observed on the real network on 2026-09-27: a top-level cast dated
 *  2061 */
export const STUB_FUTURE_HASH = "0x" + "f0f0fc" + "0".repeat(32) + "e1";
if (!HASH40.test(STUB_FUTURE_HASH)) throw new Error("neynar-stub: STUB_FUTURE_HASH is not 0x + 40 hex");
export const STUB_FUTURE_TIMESTAMP = "2061-09-12T00:00:00.000Z";
/** NEYNAR AS A SWITCH (§42): the word only the stub's search-probe cast and its synthetic user carry, so a search for it
 *  answers exactly one cast and one person (and the suites can tell a search answer from anything else on the page) */
export const STUB_SEARCH = { term: "fcsourceprobe", hash: "0x" + "5ea7c4" + "0".repeat(32) + "a1", user: { fid: 990200, username: "fcsourceprobe-person", score: 0.93 } };
if (!HASH40.test(STUB_SEARCH.hash)) throw new Error("neynar-stub: STUB_SEARCH.hash is not 0x + 40 hex");

/** a fresh fake key: the prefix makes it recognisably fake, the random tail makes a grep for it meaningful */
export function makeStubKey() {
  return STUB_KEY_PREFIX + randomBytes(12).toString("hex");
}

// ------------------------------------------------------------------------------------------------ the corpus

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "neynar");
const sha40 = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 40);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** a raw cast as /feed answers it WITHOUT viewer_fid: no viewer_context anywhere (the relay never sends one) */
function stripViewer(c) {
  const x = clone(c);
  delete x.viewer_context;
  if (x.author) delete x.author.viewer_context;
  return x;
}

let corpus = null;
/** built once, lazily (importing this module for its constants reads no file) and deterministically: the same hashes,
 *  users and texts on every start, so a denylist or a marker named before the pair starts still matches */
function buildCorpus() {
  if (corpus) return corpus;
  const fx = (n) => JSON.parse(readFileSync(path.join(FIXTURES, n + ".json"), "utf8"));
  const feed = fx("feed-following").casts;
  const userCasts = fx("user-casts").casts;
  const bulk = fx("user-bulk").users;
  const channels = fx("channel").channels;

  const synthUser = (spec, bio) => {
    const u = clone(bulk[0]);
    u.fid = spec.fid;
    u.username = spec.username;
    u.display_name = spec.username.replace(/-/g, " ");
    u.pfp_url = "https://i.imgur.com/3d6fFAI.png";
    u.custody_address = "0x" + sha40("custody:" + spec.username);
    u.verifications = [];
    u.verified_addresses = { eth_addresses: [], sol_addresses: [], primary: { eth_address: null, sol_address: null } };
    u.auth_addresses = [];
    u.verified_accounts = [];
    delete u.pro;
    delete u.url;
    u.follower_count = 12;
    u.following_count = 3;
    u.profile = { bio: { text: bio } };
    if (spec.score == null) {
      delete u.score;
      delete u.experimental;
    } else {
      u.score = spec.score;
      u.experimental = { neynar_user_score: spec.score };
    }
    return u;
  };
  const low = synthUser(STUB_USERS.low, "a synthetic account below the preview's score floor");
  const none = synthUser(STUB_USERS.none, "a synthetic account with no Neynar score in the payload");

  // the discovery corpus: the recordings' top-level casts, the planted five first. FC-READ (no channels): served by the
  // /feed fids filter, each cast keeps the `channel` it was recorded with (null, or a dehydrated channel) — a general
  // feed carries casts from anywhere, and nothing is re-labelled into a channel mix any more
  const tops = [...feed, ...userCasts].filter((c) => !c.parent_hash).map(stripViewer);
  const plant = (from, patch) => ({ ...clone(from), ...patch });
  const planted = {
    media: plant(tops[0], {
      text: `${STUB_MARKERS.media} a photo whose host is not on the preview's media list`,
      embeds: [{ url: `https://${STUB_MEDIA_HOST}/pixel.png`, metadata: { _status: "PENDING" } }],
    }),
    needle: plant(tops[1], {
      text: `${STUB_MARKERS.needle} my old site answered 404 all week and I was refusing to reload it. Couldn't load, couldn't confirm, couldn't read.`,
      embeds: [],
    }),
    low: plant(tops[2], { author: low, text: `${STUB_MARKERS.low} a cast by an account below the score floor`, embeds: [] }),
    none: plant(tops[3], { author: none, text: `${STUB_MARKERS.none} a cast by an account with no score`, embeds: [] }),
    denied: plant(tops[4], { hash: STUB_DENY_HASH, thread_hash: STUB_DENY_HASH, text: `${STUB_MARKERS.denied} a cast on the operator denylist`, embeds: [] }),
  };
  // FC-READ (no channels): a REPLY inside the discovery feed, by an admitted (high-score, undenied) fixture author, to
  // another discovery cast. The recorded following feed has 0 replies in 25, but whether the fids filter includes
  // replies is unverified — so the relay drops any cast with a parent itself, and this is what proves it does. It sits
  // AFTER tops[5..7] so the suites' discoveryHashes[6] / [7] (ordinary casts) keep their places.
  const parentOfReply = tops[6] ?? tops[0];
  const feedReplyHash = "0x" + sha40("fcread-stub:in-feed-reply");
  planted.feedReply = plant(tops[7] ?? tops[0], {
    hash: feedReplyHash,
    thread_hash: parentOfReply.thread_hash ?? parentOfReply.hash,
    parent_hash: parentOfReply.hash,
    parent_author: { fid: parentOfReply.author?.fid ?? null },
    parent_url: null,
    root_parent_url: null,
    text: `${STUB_MARKERS.feedReply} a reply that a fids-filtered feed may carry; discovery shows top-level casts only`,
    embeds: [],
  });
  // FC-READ (future-dated casts): a TOP-LEVEL cast by an admitted (high-score, undenied) discovery author, dated 2061.
  // The device orders the feed by recency, so a relay that passed it through would pin it on top for decades; the relay
  // drops it (projectCast), and this is what proves it does. Right after the in-feed reply, so discoveryHashes[6] / [7]
  // keep their places; its author is already a discovery author, so the fids list does not change.
  planted.future = plant(tops[8] ?? tops[0], {
    hash: STUB_FUTURE_HASH,
    thread_hash: STUB_FUTURE_HASH,
    parent_hash: null,
    parent_url: null,
    root_parent_url: null,
    timestamp: STUB_FUTURE_TIMESTAMP,
    text: `${STUB_MARKERS.future} a cast dated decades ahead of every clock; discovery must not pin it on top`,
    embeds: [],
  });
  const seen = new Set();
  const discovery = [];
  for (const c of [planted.media, planted.needle, planted.low, planted.none, planted.denied, ...tops.slice(5, 8), planted.feedReply, planted.future, ...tops.slice(8)]) {
    if (!HASH40.test(c.hash) || seen.has(c.hash)) continue;
    seen.add(c.hash);
    discovery.push(c);
  }
  // FC-READ (no channels): the authors the discovery corpus is reached by, in corpus order (Neynar's fids filter
  // answers casts BY these authors, so the relay's FC_READ_FIDS must name them for the planted casts to be served)
  const discoveryFids = [...new Set(discovery.map((x) => x.author?.fid).filter((f) => Number.isInteger(f) && f > 0))];
  if (discoveryFids.length > RELAY.discovery.maxFids) throw new Error("neynar-stub: the discovery corpus has more authors than one fids filter takes");
  // FC-READ (house): the house account follows every discovery author; it is none of them itself
  if (discoveryFids.includes(STUB_HOUSE.fid)) throw new Error("neynar-stub: STUB_HOUSE is a discovery author");

  // every cast the stub can answer a conversation for, by hash (the feed's replies too, and the planted ones)
  const byHash = new Map();
  for (const c of [...feed.map(stripViewer), ...userCasts.map(stripViewer), ...discovery]) if (HASH40.test(c.hash)) byHash.set(c.hash, c);

  // every full user object, by username (casts' authors, the bulk recording, the two synthetic accounts)
  const users = new Map();
  const addUser = (u) => {
    if (u && u.object === "user" && typeof u.username === "string" && !users.has(u.username.toLowerCase())) users.set(u.username.toLowerCase(), stripViewer(u));
  };
  for (const c of [...discovery, ...feed, ...userCasts]) addUser(c.author);
  for (const u of bulk) addUser(u);
  users.set(low.username, low);
  users.set(none.username, none);

  // a replier with a known high score (the relay admits a reply only when its author's score is in the answer)
  const replier = [...users.values()].find((u) => typeof u.score === "number" && u.score >= 0.9 && u.fid !== STUB_USERS.low.fid) ?? bulk[0];
  // NEYNAR AS A SWITCH (§42): the search corpus — every cast above plus ONE probe cast that only a search reaches (it is
  // not in discovery, so every discovery check is unchanged), by a synthetic, admitted account that only a search finds
  const probeUser = synthUser(STUB_SEARCH.user, "a synthetic account only a search finds");
  users.set(probeUser.username, probeUser);
  planted.search = plant(tops[9] ?? tops[0], {
    hash: STUB_SEARCH.hash,
    thread_hash: STUB_SEARCH.hash,
    parent_hash: null,
    parent_url: null,
    root_parent_url: null,
    author: probeUser,
    text: `${STUB_SEARCH.term} a cast only a Neynar search finds`,
    embeds: [],
  });
  byHash.set(planted.search.hash, planted.search);
  const searchable = [...new Map([...discovery, planted.search, ...userCasts.map(stripViewer)].filter((x) => HASH40.test(x.hash)).map((x) => [x.hash, x])).values()];
  corpus = { discovery, discoveryFids, byHash, users, userCasts, channels, planted, replier, searchable, following: feed.map(stripViewer), followingNext: fx("feed-following").next };
  return corpus;
}

/** FC-READ (no channels): the fids the discovery corpus is reached by — what a relay pointed at this stub must hold as
 *  FC_READ_FIDS (comma-joined) for every planted cast to be served. Deterministic: the same list on every start. */
export function stubDiscoveryFids() {
  return [...buildCorpus().discoveryFids];
}

/**
 * FC-READ (no channels): is this upstream request a CHANNEL feed? The owner's v1 decision is that channels are not an
 * emphasis, so any of these is a violation: /feed/channels, /feed/parent_urls (FIP-2 channels by URL), anything under
 * /channel, or /feed asked for a channel (filter_type channel_id or parent_url, or a channel_id / parent_url /
 * members_only parameter). `route` is routeOf()'s form ("/feed/channels"); `params` the recorded parameters.
 */
export function isChannelFeedRequest(route, params = {}) {
  if (route === "/feed/channels" || route === "/feed/parent_urls" || /^\/channel(\/|$)/.test(route)) return true;
  if (route === "/feed") {
    if (["channel_id", "parent_url"].includes(String(params.filter_type ?? ""))) return true;
    if ("channel_id" in params || "parent_url" in params || "members_only" in params) return true;
  }
  if (route === "/feed/trending" && ("channel_id" in params || "parent_url" in params)) return true;
  return false;
}

/**
 * FC-READ (no channels): what is wrong with a recorded discovery request's parameters against the DECIDED read
 * (RELAY.discovery): exactly feed_type, filter_type, fids, with_recasts and limit, each once, the constants as pinned,
 * fids 1..100 distinct positive integers — and, when `expectedFids` is given, exactly that set. [] = clean.
 */
export function discoveryParamProblems(params, expectedFids) {
  const D = RELAY.discovery;
  const out = [];
  const want = [...Object.keys(D.params), D.fidsParam].sort();
  const got = Object.keys(params ?? {}).sort();
  if (want.join(",") !== got.join(",")) out.push(`parameters ${JSON.stringify(got)} (expected exactly ${JSON.stringify(want)})`);
  for (const [k, v] of Object.entries(D.params)) if (params?.[k] !== undefined && params[k] !== v) out.push(`${k}=${JSON.stringify(params[k])} (the server's constant is ${v})`);
  const raw = params?.[D.fidsParam];
  if (typeof raw === "string") {
    const items = raw.split(",");
    const nums = items.map((s) => (/^[1-9]\d{0,9}$/.test(s) ? Number(s) : NaN));
    if (nums.some((n) => !Number.isInteger(n))) out.push("fids carries a value that is not a positive integer");
    if (items.length > D.maxFids) out.push(`fids carries ${items.length} fids (at most ${D.maxFids})`);
    if (new Set(nums).size !== nums.length) out.push("fids repeats an fid");
    if (expectedFids) {
      const want2 = new Set(expectedFids.map(Number));
      const extra = nums.filter((n) => !want2.has(n));
      const missing = [...want2].filter((n) => !nums.includes(n));
      if (extra.length || missing.length) out.push(`fids is not the server's FC_READ_FIDS (${extra.length} extra, ${missing.length} missing)`);
    }
  } else if (raw !== undefined) {
    out.push("fids is repeated");
  }
  return out;
}

/**
 * FC-READ (house): is this upstream request a FOLLOWING feed? Neynar serves one at /feed/following and on the /feed/
 * pathname when feed_type is following — or ABSENT (its default), which is why the fids read pins feed_type. `route`
 * is routeOf()'s form; a repeated feed_type that names following counts too.
 */
export function isFollowingFeedRequest(route, params = {}) {
  if (route === RELAY.house.route) return true;
  if (route !== "/feed") return false;
  const ft = params.feed_type;
  if (ft === undefined) return true;
  return Array.isArray(ft) ? ft.includes("following") : ft === "following";
}

/**
 * FC-READ (house): what is wrong with a request against the relay's PINNED house read (RELAY.house): the path
 * /v2/farcaster/feed/following/ spelled exactly (when the request's `path` is known — a recorded entry carries it),
 * exactly fid, with_recasts and limit, each once, the constants as pinned, and fid = the house fid (default: this
 * stub's). `req` is a recorded request ({route, params, path}). [] = it IS the pinned request. The problems never
 * print a fid's value: in a misconfigured run it could be the owner's real house account.
 */
export function houseRequestProblems(req, houseFid = STUB_HOUSE.fid) {
  const H = RELAY.house;
  const { route, params, path: p } = req ?? {};
  if (route !== H.route) {
    return [route === "/feed" ? `a following feed on the /feed/ pathname (feed_type=following or absent): the house read is ${H.path} only` : `${route} is not the house feed's path (${H.path})`];
  }
  const out = [];
  if (typeof p === "string" && !p.endsWith(H.path)) out.push(`the path is spelled ${JSON.stringify(p)} (the pinned spelling is ${H.path})`);
  const names = [...Object.keys(H.params), H.fidParam].sort();
  const got = Object.keys(params ?? {}).sort();
  if (names.join(",") !== got.join(",")) out.push(`parameters ${JSON.stringify(got)} (expected exactly ${JSON.stringify(names)})`);
  for (const [k, v] of Object.entries(H.params)) if (params?.[k] !== undefined && params[k] !== v) out.push(`${k}=${JSON.stringify(params[k])} (the server's constant is ${v})`);
  const f = params?.[H.fidParam];
  if (f === undefined) out.push("no fid");
  else if (Array.isArray(f)) out.push("fid is repeated");
  else if (f !== String(houseFid)) out.push("fid is not the house fid (a viewer's, a client's or another account's following feed)");
  return out;
}

/** the conversation for a known hash: the root, two synthetic direct replies, and the parent chain when there is one */
function conversationFor(root) {
  const c = buildCorpus();
  const replies = [0, 1].map((i) => {
    const hash = "0x" + sha40(root.hash + ":reply:" + i);
    const r = {
      ...clone(c.discovery[5] ?? root),
      hash,
      thread_hash: root.thread_hash ?? root.hash,
      parent_hash: root.hash,
      parent_author: { fid: root.author?.fid ?? null },
      parent_url: null,
      author: clone(c.replier),
      text: `${STUB_MARKERS.reply} ${i + 1} to ${root.hash.slice(0, 10)}`,
      embeds: [],
      direct_replies: [],
    };
    if (!c.byHash.has(hash)) c.byHash.set(hash, r);
    return r;
  });
  const parents = [];
  let p = root.parent_hash ? c.byHash.get(root.parent_hash) : null;
  while (p && parents.length < 5) {
    parents.unshift(p);
    p = p.parent_hash ? c.byHash.get(p.parent_hash) : null;
  }
  return {
    conversation: { cast: { ...clone(root), direct_replies: replies }, chronological_parent_casts: parents.map(clone) },
    next: { cursor: null },
  };
}

// ------------------------------------------------------------------------------------------------ the request rules

// per path: the parameters the relay may send, the documented maxima (and minima), the required ones. Anything else is
// a violation.
const ROUTES = {
  // FC-READ (no channels): the decided v1 discovery read. The parameter NAMES the relay may send are exactly the five
  // of RELAY.discovery; Neynar's other /feed filters (channel_id, parent_url, members_only, embed_url, embed_types)
  // are not the relay's and record param-unexpected (a channel one records channel-feed as well). `limit` is 1..100.
  "/feed": { allowed: ["feed_type", "filter_type", "fids", "with_recasts", "limit"], max: { limit: RELAY.discovery.maxLimit }, min: { limit: 1 }, required: [] },
  // FC-READ (house): Neynar's "Following" feed (fid required; viewer_fid and cursor are FATAL_PARAMS here). Served clean
  // only as the pinned house read; any other request records the following-feed violation and is answered with the
  // recording, as the network would answer it. limit 1..100: DOCUMENTED — Neynar's OAS spec v3.184.0 declares this
  // endpoint's `limit` as int32, default 25, minimum 1, maximum 100 (the reference page shows only the default).
  "/feed/following": { allowed: ["fid", "with_recasts", "limit"], max: { limit: RELAY.house.maxLimit }, min: { limit: 1 }, required: ["fid"] },
  // FC-READ (no channels): still SERVED (a real endpoint, so a stale build's other checks can run), but every request
  // here records the channel-feed violation and fails the run
  "/feed/channels": { allowed: ["channel_ids", "limit", "with_recasts", "with_replies", "members_only", "should_moderate"], max: { limit: 100 }, required: ["channel_ids"] },
  "/cast/conversation": {
    allowed: ["identifier", "type", "reply_depth", "include_chronological_parent_casts", "limit", "sort_type", "fold"],
    max: { limit: 50, reply_depth: 5 },
    required: ["identifier", "type"],
  },
  "/user/by_username": { allowed: ["username"], max: {}, required: ["username"] },
  "/feed/user/casts": { allowed: ["fid", "limit", "include_replies"], max: { limit: 150 }, required: ["fid"] },
  // tolerated (not in the relay's table, but a harmless read a fallback might use): served, maxima enforced
  "/cast": { allowed: ["identifier", "type"], max: {}, required: ["identifier", "type"], outOfTable: true },
  // NEYNAR AS A SWITCH (§42): the search ops. q and limit only (reference/search-casts, reference/search-user); author_fid,
  // viewer_fid, cursor, channel_id and parent_url are documented but the relay must never send them (FATAL_PARAMS or
  // param-unexpected). The maxima are ASSUMED (the reference pages give only the defaults, 25 and 5).
  "/cast/search": { allowed: ["q", "limit"], max: { limit: 100 }, min: { limit: 1 }, required: ["q"] },
  "/user/search": { allowed: ["q", "limit"], max: { limit: 10 }, min: { limit: 1 }, required: ["q"] },
};
/** FC-READ (no channels): endpoints Neynar has REMOVED from its published contract (neynarxyz/OAS; a keyless probe on
 *  2026-09-25 answers them 401 exactly like a made-up route). The stub used to serve /feed/trending with limit <= 10,
 *  which let a call pass here that the live API may now refuse; it answers 404 and records a violation instead. */
const REMOVED_ROUTES = {
  "/feed/trending": "removed from Neynar's contract in OAS v3.183.0 (2026-08-07)",
  "/feed/for_you": "removed from Neynar's contract in OAS v3.182.0 (2026-08-04)",
};
/** the /feed enums of the current contract (OAS v3.184.0): global_trending left filter_type in v3.183.0 */
const FEED_TYPES = ["following", "filter"];
const FILTER_TYPES = ["fids", "parent_url", "channel_id", "embed_url", "embed_types"];
const REMOVED_FILTER_TYPES = { global_trending: "removed from the filter_type enum in OAS v3.183.0 (2026-08-07)" };
/** parameters that must never ride a relay request: identity (viewer_fid), pagination the client could steer (cursor),
 *  and a provider switch — on ANY path */
const FATAL_PARAMS = ["viewer_fid", "cursor", "provider", "provider_metadata", "author_fid"];
/** headers a relay must not forward from the visitor: Neynar should see the app, never the visitor */
const VISITOR_HEADERS = ["cookie", "authorization", "x-forwarded-for", "x-real-ip", "forwarded", "referer", "origin", "x-layers-relay", "sec-fetch-site"];

const neynarError = (status, message, property) => ({ message, code: status === 404 ? "NotFound" : status === 401 ? "Unauthorized" : "InvalidField", ...(property ? { property } : {}), status });

/** strip any number of "/v2/farcaster" prefixes (the relay's base may or may not carry it) and a trailing slash */
function routeOf(pathname) {
  let p = pathname;
  while (p.startsWith("/v2/farcaster")) p = p.slice("/v2/farcaster".length) || "/";
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

// ------------------------------------------------------------------------------------------------ the server

/**
 * The stub's logic with no socket: { handle(req, res), snapshot(), reset(), force(), setOrigin() }. `req` needs method,
 * url, headers, on/resume; `res` needs writeHead/end — so the rules can be exercised without binding a port.
 *   key   a FAKE key (default: a fresh one); log: one line per violation
 */
export function createNeynarStub({ key = makeStubKey(), log = (s) => console.log("[neynar-stub] " + s), onShutdown = () => {} } = {}) {
  if (typeof key !== "string" || !key.startsWith(STUB_KEY_PREFIX) || !KEY_SHAPE.test(key)) {
    throw new Error(`neynar-stub: the key must be a FAKE key ("${STUB_KEY_PREFIX}…", shape ${KEY_SHAPE}) — refusing one that could be real`);
  }
  buildCorpus();
  let actualPort = 0;
  let origin = "";

  const st = {
    startedAt: Date.now(),
    requests: [],
    violations: [],
    hits: { total: 0, byRoute: {} },
    forced: [], // [{ status, remaining }]
    // FC-READ (house): lastSource = which discovery source the last discovery answer served ("fids" | "house" | null)
    served: { hashes: new Set(), discovery: [], lastFids: null, lastSource: null },
    echoes: [], // FC-READ (lead fix): what a browser attached to a request to /__stub/echo (see control())
  };
  const reset = () => {
    st.requests = [];
    st.violations = [];
    st.hits = { total: 0, byRoute: {} };
    st.forced = [];
    st.served = { hashes: new Set(), discovery: [], lastFids: null, lastSource: null };
    st.echoes = [];
  };
  const snapshot = () => ({
    ok: true,
    key,
    port: actualPort,
    url: origin,
    baseUrl: origin + "/v2/farcaster",
    startedAt: st.startedAt,
    hits: clone(st.hits),
    requests: clone(st.requests),
    violations: clone(st.violations),
    forced: clone(st.forced),
    served: { hashes: [...st.served.hashes], discovery: [...st.served.discovery], lastFids: st.served.lastFids, lastSource: st.served.lastSource },
    planted: plantedSummary(),
    echoes: clone(st.echoes),
  });

  function violation(entry, kind, detail) {
    const v = { n: entry.n, route: entry.route, kind, detail };
    st.violations.push(v);
    entry.violations.push(kind);
    log(`VIOLATION #${entry.n} ${kind} — ${entry.method} ${entry.route}${entry.query ? "?" + entry.query : ""}${detail ? " (" + detail + ")" : ""}`);
  }

  const send = (res, status, body, entry) => {
    if (entry) entry.status = status;
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(text) });
    res.end(text);
  };
  const noteServed = (casts) => {
    for (const c of casts) {
      if (c?.hash) st.served.hashes.add(c.hash);
      for (const e of c?.embeds ?? []) if (e?.cast?.hash) st.served.hashes.add(e.cast.hash);
      for (const r of c?.direct_replies ?? []) if (r?.hash) st.served.hashes.add(r.hash);
    }
  };

  function control(req, res, u) {
    const p = u.pathname.slice("/__stub".length);
    const body = () =>
      new Promise((resolve) => {
        let t = "";
        req.on("data", (b) => (t += b));
        req.on("end", () => {
          try {
            resolve(t ? JSON.parse(t) : {});
          } catch {
            resolve({});
          }
        });
      });
    if (req.method === "GET" && p === "/state") return send(res, 200, snapshot());
    if (req.method === "POST" && p === "/reset") {
      reset();
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && p === "/force") {
      return body().then((b) => {
        const status = Number(b.status);
        const count = Math.max(1, Math.min(100, Number(b.count) || 1));
        if (!(status === 429 || (status >= 500 && status <= 599))) return send(res, 400, { error: "force takes 429 or 5xx" });
        st.forced.push({ status, remaining: count });
        send(res, 200, { ok: true, forced: clone(st.forced) });
      });
    }
    if (req.method === "GET" && p === "/xsite.html") {
      // FC-READ: a page on ANOTHER site (this origin is 127.0.0.1:<port>; the app is localhost:<port> — a different
      // registrable host, so the browser labels its requests Sec-Fetch-Site: cross-site). accept-fcread drives it.
      const html = "<!doctype html><meta charset=utf-8><title>another site</title><p>fcread cross-site probe</p>";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(html);
    }
    if (p === "/echo") {
      // FC-READ (lead fix, accept-fcread check 11): a WITNESS of the browser's own labelling. A test driver cannot read
      // the Sec-Fetch-* headers the browser attached to the probe page's requests to the relay (the preflighted one is
      // never sent, and the automation layer does not expose them on the no-cors one), so the probe page sends the SAME
      // two shapes to this endpoint, addressed as http://localhost:<this port> — the app's site (scheme + host; a port
      // is not part of a site), and a different site from the probe page on 127.0.0.1. What the browser attached is
      // recorded here (headers only, never a body) and read back through /state. It answers 204 with no
      // Access-Control-Allow-* header, exactly as the relay refuses a preflight, and it is a control path: never an
      // upstream hit, so the suites' frozen-counter measurements are unaffected.
      if (typeof req.resume === "function") req.resume();
      const h = (n) => (typeof req.headers[n] === "string" ? req.headers[n] : null);
      st.echoes.push({
        at: Date.now(),
        method: req.method,
        secFetchSite: h("sec-fetch-site"),
        secFetchMode: h("sec-fetch-mode"),
        origin: h("origin"),
        host: h("host"),
        contentType: h("content-type"),
        requestHeaders: h("access-control-request-headers"),
      });
      if (st.echoes.length > 100) st.echoes.splice(0, st.echoes.length - 100);
      res.writeHead(204, { "cache-control": "no-store" });
      return res.end();
    }
    if (req.method === "POST" && p === "/shutdown") {
      send(res, 200, { ok: true });
      setTimeout(() => onShutdown(), 50);
      return;
    }
    return send(res, 404, { error: "no such control" });
  }

  /**
   * FC-READ (no channels): GET /feed — Neynar's "By filters" feed (operationId fetch-feed), the v1 discovery read. The
   * relay's request is feed_type=filter + filter_type=fids (RELAY.discovery); anything else is answered only so a
   * wrong request is judged as the network would judge it (a 400 in Neynar's ErrorRes shape) or recorded as the
   * violation it is. The answer is a real FeedResponse {casts, next: {cursor}}: the corpus casts BY the listed fids,
   * newest first, at most `limit`, with next.cursor set while more remain (the relay must ignore it: one page per miss).
   */
  function feedFiltered(res, entry, c, limitOf, stamped) {
    const P = entry.params;
    const invalid = (property, message, kind = "param-shape", detail = message) => {
      violation(entry, kind, `${property}: ${detail}`);
      return send(res, 400, neynarError(400, message, property), entry);
    };
    // a repeated name is already a violation (param-repeated); it is not a question this endpoint answers
    for (const [k, v] of Object.entries(P)) if (Array.isArray(v)) return send(res, 400, neynarError(400, `${k} is given more than once`, k), entry);
    const feedType = P.feed_type ?? "following";
    if (!FEED_TYPES.includes(feedType)) return invalid("feed_type", `feed_type must be one of ${FEED_TYPES.join(", ")}`);
    if (feedType === "following") {
      // FC-READ (house): Neynar needs a fid for it. This pathname is never the pinned house read (that is
      // /feed/following/ only), so its following-feed violation is already recorded; answered with the recording
      if (!("fid" in P)) return send(res, 400, neynarError(400, "fid is required when feed_type is following", "fid"), entry);
      return followingFeed(res, entry, c, limitOf, stamped);
    }
    const ft = P.filter_type;
    if (ft === undefined || ft === "") {
      violation(entry, "param-missing", "filter_type");
      return send(res, 400, neynarError(400, "filter_type is required when feed_type is filter", "filter_type"), entry);
    }
    if (REMOVED_FILTER_TYPES[ft]) return invalid("filter_type", `filter_type must be one of ${FILTER_TYPES.join(", ")}`, "removed-filter", `${ft} was ${REMOVED_FILTER_TYPES[ft]}`);
    if (!FILTER_TYPES.includes(ft)) return invalid("filter_type", `filter_type must be one of ${FILTER_TYPES.join(", ")}`);
    if (ft !== "fids") {
      // channel_id / parent_url: the channel-feed violation is already recorded. embed_url / embed_types: a real feed,
      // but not the decided discovery (a firehose by media type the score floor cannot make brand-safe)
      if (ft === "embed_url" || ft === "embed_types") violation(entry, "discovery-filter", `filter_type=${ft}: v1 discovery filters by author fids only`);
      return send(res, 200, { casts: [], next: { cursor: null } }, entry);
    }
    const raw = P.fids;
    if (raw === undefined || raw === "") {
      violation(entry, "param-missing", "fids");
      return send(res, 400, neynarError(400, "fids is required when filter_type is fids", "fids"), entry);
    }
    const items = String(raw).split(",");
    if (items.some((s) => !/^[1-9]\d{0,9}$/.test(s))) return invalid("fids", "fids must be a comma-separated list of integer fids");
    if (items.length > RELAY.discovery.maxFids) {
      return invalid("fids", `fids takes at most ${RELAY.discovery.maxFids} fids`, "over-max", `carries ${items.length} fids (documented maximum ${RELAY.discovery.maxFids})`);
    }
    if ("with_recasts" in P && P.with_recasts !== "true" && P.with_recasts !== "false") return invalid("with_recasts", "with_recasts must be a boolean");
    // the request is one Neynar would answer; whether it is THE decided one (every server constant, nothing else) is
    // the relay's contract — a deviation fails the run like any other violation
    const off = discoveryParamProblems(P);
    if (off.length) violation(entry, "discovery-params", off.join("; "));
    const fids = items.map(Number);
    const want = new Set(fids);
    const matching = c.discovery.filter((x) => want.has(x.author?.fid));
    const limit = limitOf(25);
    // the corpus holds no recasts (the recordings carry none), so with_recasts=false has nothing to drop here
    const casts = stamped(matching.slice(0, limit));
    noteServed(casts);
    st.served.discovery = casts.map((x) => x.hash);
    st.served.lastFids = fids;
    st.served.lastSource = "fids";
    const cursor = matching.length > limit ? Buffer.from(JSON.stringify({ timestamp: casts.at(-1)?.timestamp ?? null, stub: "fcread" })).toString("base64url") : null;
    return send(res, 200, { casts, next: { cursor } }, entry);
  }

  /**
   * FC-READ (house): a FOLLOWING feed (GET /feed/following, or /feed with feed_type=following). The pinned house read
   * (entry.house, set in upstream() by houseRequestProblems) is answered with the house account's feed: the casts of
   * the accounts it follows — the whole discovery corpus, planted casts and the in-feed reply included (whether
   * Neynar's following feed carries replies is unverified: the 25-cast recording has none, so the relay drops any cast
   * with a parent itself) — newest first, at most `limit`, in the recording's FeedResponse shape {casts, next:{cursor}}
   * with next.cursor set while more remain (the relay must ignore it: one page per miss). Any other following feed
   * (its violation already recorded) is answered with the recording, as the network would answer some account's feed,
   * and never counts as the discovery answer.
   */
  function followingFeed(res, entry, c, limitOf, stamped) {
    const P = entry.params;
    if (typeof P.fid !== "string" || !/^[1-9]\d{0,9}$/.test(P.fid)) {
      violation(entry, "param-shape", "fid: not one positive integer");
      return send(res, 400, neynarError(400, "fid must be a positive integer", "fid"), entry);
    }
    if ("with_recasts" in P && P.with_recasts !== "true" && P.with_recasts !== "false") {
      violation(entry, "param-shape", "with_recasts: not a boolean");
      return send(res, 400, neynarError(400, "with_recasts must be a boolean", "with_recasts"), entry);
    }
    const limit = limitOf(25);
    if (!entry.house) {
      const casts = stamped(c.following.slice(0, limit));
      noteServed(casts);
      return send(res, 200, { casts, next: clone(c.followingNext ?? { cursor: null }) }, entry);
    }
    // the corpus holds no recasts (the recordings carry none), so with_recasts=false has nothing to drop here
    const casts = stamped(c.discovery.slice(0, limit));
    noteServed(casts);
    st.served.discovery = casts.map((x) => x.hash);
    st.served.lastSource = "house";
    const cursor = c.discovery.length > limit ? Buffer.from(JSON.stringify({ timestamp: casts.at(-1)?.timestamp ?? null, stub: "fcread-house" })).toString("base64url") : null;
    return send(res, 200, { casts, next: { cursor } }, entry);
  }

  function upstream(req, res, u) {
    const c = buildCorpus();
    const route = routeOf(u.pathname);
    const query = u.search.startsWith("?") ? u.search.slice(1) : u.search;
    const keyHeader = req.headers["x-api-key"];
    const entry = {
      n: st.hits.total + 1,
      at: Date.now(),
      method: req.method,
      path: u.pathname,
      route,
      query, // the EXACT query string as received
      params: {},
      keyOk: keyHeader === key,
      keyLength: typeof keyHeader === "string" ? keyHeader.length : 0,
      forwarded: VISITOR_HEADERS.filter((h) => h in req.headers),
      status: 0,
      forced: false,
      violations: [],
    };
    st.hits.total++;
    st.hits.byRoute[route] = (st.hits.byRoute[route] ?? 0) + 1;
    st.requests.push(entry);
    if (st.requests.length > 5000) st.requests.splice(0, 1000);

    // repeated parameters are recorded as arrays (a relay that sends limit twice is asking two different questions)
    for (const [k, v] of u.searchParams) {
      if (k in entry.params) entry.params[k] = [].concat(entry.params[k], v);
      else entry.params[k] = v;
    }

    if (req.method !== "GET") {
      violation(entry, "non-GET", req.method);
      return send(res, 405, neynarError(405, "method not allowed"), entry);
    }
    if (!entry.keyOk) {
      violation(entry, "x-api-key", keyHeader === undefined ? "missing" : "does not equal the fake key (length " + entry.keyLength + ")");
      return send(res, 401, neynarError(401, "Unauthorized"), entry);
    }
    if (entry.forwarded.length) violation(entry, "visitor-header", "forwarded " + entry.forwarded.join(", "));

    // the never-ever list: fatal whatever else the request is
    if (/^\/notifications(\/|$)/.test(route)) violation(entry, "notifications", "the relay must never read notifications");
    // FC-READ (house): a following feed is the house source's read ONLY as the relay's pinned request (the house fid, the
    // pinned constants, nothing else); every other following feed — another fid, a viewer_fid, a cursor, another limit,
    // a missing or an extra parameter — is still the violation it always was
    if (isFollowingFeedRequest(route, entry.params)) {
      const off = houseRequestProblems(entry);
      if (off.length) violation(entry, "following-feed", "the relay reads no following feed but the pinned house request: " + off.join("; "));
      else entry.house = true;
    }
    for (const p of FATAL_PARAMS) if (p in entry.params) violation(entry, "param:" + p, "a " + p + " rode the request");
    if ("fid" in entry.params && route !== "/feed/user/casts" && !entry.house) violation(entry, "param:fid", "fid outside /feed/user/casts and the pinned house request");
    for (const [k, v] of Object.entries(entry.params)) if (Array.isArray(v)) violation(entry, "param-repeated", k);
    // FC-READ (no channels): channels are not a v1 emphasis — no channel feed, by any path or filter, ever
    if (isChannelFeedRequest(route, entry.params)) violation(entry, "channel-feed", "discovery is not channel-curated in v1 (the owner's decision); the relay must never read a channel feed");

    // FC-READ (no channels): an endpoint Neynar removed answers as an unknown route does, and fails the run
    if (REMOVED_ROUTES[route]) {
      violation(entry, "removed-endpoint", REMOVED_ROUTES[route]);
      return send(res, 404, neynarError(404, "Resource not found"), entry);
    }
    const spec = ROUTES[route];
    if (!spec) {
      if (!entry.violations.length) violation(entry, "out-of-table", "not one of the relay's endpoints");
      return send(res, 404, neynarError(404, "Resource not found"), entry);
    }
    if (spec.outOfTable) violation(entry, "out-of-table", "a real endpoint, but not in the relay's op table");
    for (const k of Object.keys(entry.params)) if (!spec.allowed.includes(k) && !FATAL_PARAMS.includes(k) && k !== "fid") violation(entry, "param-unexpected", k);
    for (const k of spec.required) {
      if (!(k in entry.params) || entry.params[k] === "") {
        violation(entry, "param-missing", k);
        return send(res, 400, neynarError(400, k + " is required", k), entry);
      }
    }
    for (const [k, max] of Object.entries(spec.max)) {
      if (!(k in entry.params)) continue;
      const n = Number(entry.params[k]);
      const min = spec.min?.[k] ?? 0;
      if (!Number.isInteger(n) || n < min || n > max) {
        violation(entry, "over-max", `${k}=${entry.params[k]} (documented range ${min}..${max})`);
        return send(res, 400, neynarError(400, `${k} must be an integer between ${min} and ${max}`, k), entry);
      }
    }

    // a forced failure (the suites' 429/5xx knob) answers after the request has been judged and recorded
    const f = st.forced.find((x) => x.remaining > 0);
    if (f) {
      f.remaining--;
      if (f.remaining <= 0) st.forced = st.forced.filter((x) => x.remaining > 0);
      entry.forced = true;
      return send(res, f.status, neynarError(f.status, "forced by the stub"), entry);
    }

    const limitOf = (d) => (entry.params.limit !== undefined ? Number(entry.params.limit) : d);
    const stamped = (casts) => {
      // recent, in corpus order: the discovery surface ranks by recency, so the planted casts lead
      const now = Date.now();
      // FC-READ (future-dated casts): except the planted future-dated cast, which keeps its 2061 date everywhere
      return casts.map((x, i) => ({ ...clone(x), timestamp: x.hash === STUB_FUTURE_HASH ? STUB_FUTURE_TIMESTAMP : new Date(now - (i + 1) * 4 * 60_000).toISOString() }));
    };

    if (route === "/feed") return feedFiltered(res, entry, c, limitOf, stamped);
    if (route === RELAY.house.route) return followingFeed(res, entry, c, limitOf, stamped);
    if (route === "/feed/channels") {
      // FC-READ (no channels): the channel-feed violation is already recorded (the run fails); the answer is still
      // Neynar's shape, so whatever else a stale build does can be measured. It does NOT count as the discovery answer.
      const ids = String(entry.params.channel_ids).split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length > 10) {
        violation(entry, "over-max", "channel_ids carries " + ids.length + " ids (documented maximum 10)");
        return send(res, 400, neynarError(400, "channel_ids takes at most 10 ids", "channel_ids"), entry);
      }
      if (ids.some((id) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))) violation(entry, "param-shape", "channel_ids");
      const casts = stamped(c.discovery.slice(0, limitOf(25))).map((x, i) => ({
        ...x,
        channel: { object: "channel_dehydrated", id: ids[i % ids.length], name: ids[i % ids.length], image_url: "https://i.imgur.com/Qfwe9DU.jpg" },
      }));
      noteServed(casts);
      return send(res, 200, { casts, next: { cursor: null } }, entry);
    }
    if (route === "/cast/conversation" || route === "/cast") {
      const id = String(entry.params.identifier);
      if (entry.params.type !== "hash" || !HASH40.test(id)) {
        violation(entry, "param-shape", "identifier is not a 0x + 40 lowercase hex hash (type=" + entry.params.type + ")");
        return send(res, 400, neynarError(400, "identifier must be a cast hash", "identifier"), entry);
      }
      const root = c.byHash.get(id);
      if (!root) return send(res, 404, neynarError(404, "Cast not found", "identifier"), entry);
      if (route === "/cast") {
        noteServed([root]);
        return send(res, 200, { cast: clone(root) }, entry);
      }
      const conv = conversationFor(root);
      noteServed([conv.conversation.cast, ...conv.conversation.chronological_parent_casts]);
      return send(res, 200, conv, entry);
    }
    // NEYNAR AS A SWITCH (§42): the searches answer Neynar's documented shape {result: {casts|users, next: {cursor}}}
    if (route === "/cast/search") {
      const q = String(entry.params.q).toLowerCase();
      entry.searchQ = q;
      const casts = stamped(c.searchable.filter((x) => String(x.text ?? "").toLowerCase().includes(q)).slice(0, limitOf(25)));
      noteServed(casts);
      entry.servedHashes = casts.map((x) => x.hash);
      return send(res, 200, { result: { casts, next: { cursor: null } } }, entry);
    }
    if (route === "/user/search") {
      const q = String(entry.params.q).toLowerCase();
      entry.searchQ = q;
      const found = [...c.users.values()].filter((u) => String(u.username ?? "").toLowerCase().includes(q) || String(u.display_name ?? "").toLowerCase().includes(q));
      return send(res, 200, { result: { users: found.slice(0, limitOf(5)).map(clone), next: { cursor: null } } }, entry);
    }
    if (route === "/user/by_username") {
      const name = String(entry.params.username);
      if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(name)) violation(entry, "param-shape", "username is not an fname or a .eth name");
      const u2 = c.users.get(name.toLowerCase());
      if (!u2) return send(res, 404, neynarError(404, "User not found", "username"), entry);
      // the fid this lookup RESOLVED — the only fid a later /feed/user/casts may carry (the relay's, never the client's)
      entry.answeredFid = u2.fid;
      return send(res, 200, { user: clone(u2) }, entry);
    }
    if (route === "/feed/user/casts") {
      const fid = Number(entry.params.fid);
      if (!Number.isInteger(fid) || fid <= 0) {
        violation(entry, "param-shape", "fid is not a positive integer");
        return send(res, 400, neynarError(400, "fid must be a positive integer", "fid"), entry);
      }
      const all = [...c.discovery, ...c.userCasts.map(stripViewer)].filter((x) => x.author?.fid === fid);
      const uniq = [...new Map(all.map((x) => [x.hash, x])).values()];
      const casts = stamped(uniq.slice(0, limitOf(25)));
      noteServed(casts);
      // FC-READ (future-dated casts): what THIS answer carried, so a suite can prove the planted 2061 cast reached the
      // relay on a profile read before it asserts the relay dropped it there (accept-fcread 5d)
      entry.servedHashes = casts.map((x) => x.hash);
      return send(res, 200, { casts, next: { cursor: null } }, entry);
    }
    return send(res, 404, neynarError(404, "Resource not found"), entry);
  }

  function handle(req, res) {
    let u;
    try {
      u = new URL(req.url, "http://stub");
    } catch {
      return send(res, 400, { error: "bad url" });
    }
    try {
      if (u.pathname.startsWith("/__stub/")) return control(req, res, u);
      // drain any body (a non-GET is judged, never read)
      if (typeof req.resume === "function") req.resume();
      return upstream(req, res, u);
    } catch (e) {
      return send(res, 500, { error: "stub fault: " + String(e && e.message ? e.message : e).slice(0, 200) });
    }
  }

  return {
    key,
    handle,
    snapshot,
    reset,
    force: (status, count = 1) => {
      st.forced.push({ status, remaining: count });
    },
    setOrigin: (o, p) => {
      origin = o;
      actualPort = p;
    },
  };
}

/**
 * Start a stub on a loopback socket. Resolves { url, baseUrl, port, key, state(), reset(), force(), close() }.
 *   port  0 = any free port (never a pinned one); key = a fake key (default: a fresh one)
 */
export function startNeynarStub({ port = 0, host = "127.0.0.1", key = makeStubKey(), log } = {}) {
  if (FORBIDDEN_PORTS.has(Number(port))) return Promise.reject(new Error("neynar-stub: port " + port + " is pinned for the pair or another suite"));
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) return Promise.reject(new Error("neynar-stub: loopback only (got " + host + ")"));
  let server = null;
  let stub;
  try {
    stub = createNeynarStub({ key, ...(log ? { log } : {}), onShutdown: () => server && server.close() });
  } catch (e) {
    return Promise.reject(e);
  }
  server = http.createServer((req, res) => stub.handle(req, res));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      if (FORBIDDEN_PORTS.has(actual)) {
        server.close();
        return reject(new Error("neynar-stub: the OS handed out pinned port " + actual + " — retry"));
      }
      const origin = `http://${host === "::1" ? "[::1]" : host}:${actual}`;
      stub.setOrigin(origin, actual);
      resolve({
        url: origin,
        baseUrl: origin + "/v2/farcaster",
        port: actual,
        key: stub.key,
        state: async () => stub.snapshot(),
        reset: async () => stub.reset(),
        force: async (status, count = 1) => stub.force(status, count),
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function plantedSummary() {
  const c = buildCorpus();
  return {
    media: { hash: c.planted.media.hash, marker: STUB_MARKERS.media, host: STUB_MEDIA_HOST },
    needle: { hash: c.planted.needle.hash, marker: STUB_MARKERS.needle },
    low: { hash: c.planted.low.hash, marker: STUB_MARKERS.low, ...STUB_USERS.low },
    none: { hash: c.planted.none.hash, marker: STUB_MARKERS.none, ...STUB_USERS.none },
    denied: { hash: STUB_DENY_HASH, marker: STUB_MARKERS.denied },
    // FC-READ (no channels): the reply inside the discovery feed, and the author fid each planted cast is reached by
    feedReply: { hash: c.planted.feedReply.hash, marker: STUB_MARKERS.feedReply, parentHash: c.planted.feedReply.parent_hash },
    // FC-READ (future-dated casts): the top-level cast dated 2061 that every relay answer must leave out
    // (and its author's username, whose profile — user-casts — must leave it out too: accept-fcread 5d)
    future: { hash: STUB_FUTURE_HASH, marker: STUB_MARKERS.future, timestamp: STUB_FUTURE_TIMESTAMP, username: c.planted.future.author?.username ?? null },
    fids: Object.fromEntries(Object.entries(c.planted).map(([k, x]) => [k, x.author?.fid ?? null])),
    discoveryFids: [...c.discoveryFids],
    // FC-READ (house): the one account whose following feed the stub serves, and whom it follows (every author above)
    house: { fid: STUB_HOUSE.fid, username: STUB_HOUSE.username, follows: [...c.discoveryFids] },
    discoveryHashes: c.discovery.map((x) => x.hash),
    knownUser: { username: c.userCasts[0]?.author?.username ?? "dwr", fid: c.userCasts[0]?.author?.fid ?? 3 },
    // NEYNAR AS A SWITCH (§42): the one cast and the one person a search for STUB_SEARCH.term finds
    search: { term: STUB_SEARCH.term, hash: STUB_SEARCH.hash, user: { ...STUB_SEARCH.user } },
  };
}

/** the same API over HTTP, for a stub another process started (run-prod-shape.sh) */
export function stubClient(url) {
  const base = String(url).replace(/\/+$/, "");
  const call = async (method, p, body) => {
    const r = await fetch(base + "/__stub" + p, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!r.ok) throw new Error("stub " + method + " " + p + " answered " + r.status);
    return r.json();
  };
  return {
    url: base,
    state: () => call("GET", "/state"),
    reset: () => call("POST", "/reset", {}),
    force: (status, count = 1) => call("POST", "/force", { status, count }),
    close: () => call("POST", "/shutdown", {}).catch(() => null),
  };
}

// ------------------------------------------------------------------------------------------------ the CLI

const isMain = (() => {
  try {
    return path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name) => {
    const i = rest.indexOf("--" + name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (cmd === "deny-hash") {
    process.stdout.write(STUB_DENY_HASH);
  } else if (cmd === "fids") {
    // FC-READ (no channels): the FC_READ_FIDS a relay pointed at this stub needs (every planted cast's author)
    process.stdout.write(stubDiscoveryFids().join(","));
  } else if (cmd === "house-fid") {
    // FC-READ (house): the FC_READ_HOUSE_FID a relay pointed at this stub holds in house mode (the stub's house account)
    process.stdout.write(String(stubHouseFid()));
  } else if (cmd === "make-key") {
    process.stdout.write(makeStubKey());
  } else if (cmd === "serve") {
    const port = Number(flag("port") ?? STUB_DEFAULT_PORT);
    // the key comes from the environment (NEYNAR_STUB_KEY), never argv: argv shows in every process listing
    const key = (process.env.NEYNAR_STUB_KEY || "").trim() || makeStubKey();
    try {
      const s = await startNeynarStub({ port, key });
      console.log(`[neynar-stub] listening ${s.url} (base ${s.baseUrl}); fake key of length ${key.length}; control under ${s.url}/__stub/`);
      const stop = () => s.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    } catch (e) {
      console.error("[neynar-stub] could not start: " + (e && e.message ? e.message : e));
      process.exit(1);
    }
  } else {
    console.log("usage: node scripts/lib/neynar-stub.mjs serve [--port 4319]   (fake key from NEYNAR_STUB_KEY, else a fresh one)");
    console.log("       node scripts/lib/neynar-stub.mjs deny-hash | fids | house-fid | make-key");
    process.exit(2);
  }
}
