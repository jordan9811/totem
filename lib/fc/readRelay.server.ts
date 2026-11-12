import "server-only";
// FC-READ — THE PUBLIC LIVE-READ RELAY (D-FCREAD-KEY-SERVER-ONLY, D-FCREAD-SERVER-STAYS-SEED).
//
// The ONE module that reads NEYNAR_READ_API_KEY. A Neynar key cannot be scoped to reads, endpoints, origins or IPs
// (the API answers every origin with Access-Control-Allow-Origin *), so a key that reached a browser would work from
// anywhere: it lives here, in the public app server's env, and nothing but app/api/fc/read/route.ts calls the reader.
// lib/device/deviceEnv.server.ts asks relayArmed() for a boolean — the device gets a mode hint, never the key.
// content.ts on the server keeps reading NEYNAR_API_KEY only (and the public contract refuses that name), so the
// server's own renders — the rail, generateMetadata, explore — stay seed: page loads are not rate-limited
// (middleware.ts), and a live read there would be an unmetered spend path.
//
// What it is NOT: a proxy. The device names an OPERATION from a closed table plus one validated argument; the
// upstream path, every query parameter, the page size and the discovery author list are the server's. The client can never
// supply fid, viewer_fid, cursor, provider or limit (the route rejects any body key but op/arg and any query string
// outright — rejecting, not stripping: the device's pseudo-fid is a validator root, and forwarding it would let the
// operator join reads to roots). /notifications and the following feed are not in the table and cannot be reached —
// with ONE exception, FC-READ (house) below: the house account's following feed, its fid a server constant pinned by
// value in the path check, never a viewer's. Every other following-shaped path stays refused.
//
// Upstream discipline: GET only, cache:"no-store" (the Next fetch Data Cache must never hold an upstream response
// outside this module's accounting), one in-flight request per key (coalescing), the existing 300/900 ms backoff on
// 429/5xx/network, and EVERY failure mapped to a fixed code. Error text is never echoed or logged: on Node 24 a
// header value with an interior CR/LF makes fetch throw `Headers.append: "<value>" is an invalid header value`, and
// the value is the key. The key is trimmed and shape-checked when arming, so that throw cannot happen — and if
// anything else ever throws, the message still goes nowhere.
//
// Payloads are mapped HERE by the pure mapper (lib/adapters/neynar/contentPure.mjs) and then projected through a
// field allowlist (projectCast/projectUser): no raw Neynar JSON leaves the server (raw is ~180 KB per 25 casts and
// carries custody addresses, verifications and viewer_context), every URL is http(s) or dropped, every cast hash is
// the 40-hex network shape or the cast is dropped. Moderation: authors below FC_READ_MIN_SCORE (Neynar's user score,
// present in the payload; missing = hidden) and anything on the operator denylist (FC_READ_DENY) never leave.
//
// Budget: credits are counted on cache MISSES from the documented per-endpoint costs (lr-neynar; 4 x limit for feed
// endpoints, and ASSUMED 4 x limit / 2 for the four undocumented ones until measured), per UTC day, per instance
// (A-FCREAD-BUDGET-PER-INSTANCE: a redeploy resets it). A per-address miss bucket (best effort until Railway's
// X-Forwarded-For is measured, A-FCREAD-FORWARDING-HEADER) and a global miss bucket that no header can split bound
// the rate. A spent budget, a limit or an upstream failure serves the stale shelf (<= 24 h, labelled stale) before
// it refuses — for DISCOVERY only.
//
// FC-READ (no channels) — the owner's v1 decision is that channels are not an emphasis, so live discovery is not
// channel-curated and there is no per-channel live read at all:
//   * discovery is ONE call to /v2/farcaster/feed/?feed_type=filter&filter_type=fids with a server-held list of 1-100
//     author fids (FC_READ_FIDS), with_recasts=false, limit 25. /feed/channels (whose members_only is itself
//     deprecated in the current spec), /feed/trending and filter_type=global_trending are gone: Neynar dropped the
//     last two from its published contract (OAS v3.183.0, 2026-08-07), and /feed/for_you three days earlier. This is
//     curation BY AUTHOR — the operator's list is the discovery mix.
//   * FC_READ_FIDS has no default: choosing whose casts appear under the Totem brand is the owner's call, not this
//     module's. It is one of TWO exclusive sources (FC-READ (house) below): malformed, the relay DISARMS with
//     bad_config (FC_READ_FIDS); unset, it disarms only when FC_READ_HOUSE_FID is unset too, with bad_config naming
//     both variables — the device env then carries no relay hint and every surface stays seed, exactly as with no key.
//   * the "channel" op is gone: parseOp answers 400 bad_op for it (armed or not, at no cost), the channel index is
//     gone, and the status answer no longer lists channels. Channel tabs on the device stay seed/fixture.
//   * one page per miss: no cursor is ever followed (the response's next.cursor is ignored), so `cursor` stays
//     refused by name and a miss costs exactly one upstream page, charged once, up front.
//
// FC-READ (house) — a SECOND way to choose the discovery authors, so the owner can pick either one without a code
// change. Exactly ONE source is configured, or the relay stays unarmed:
//   * FC_READ_FIDS (above): the author list itself, 1-100 fids, changed by a redeploy.
//   * FC_READ_HOUSE_FID: ONE positive integer fid, a "house" Farcaster account whose FOLLOWS are the curation list.
//     The owner curates by following and unfollowing in any Farcaster client: no redeploy, no 100-fid cap. Discovery
//     is then ONE call to GET /v2/farcaster/feed/following/?fid=<house>&with_recasts=false&limit=25 (Neynar's
//     "Following" reference, reference/fetch-user-following-feed: fid required, viewer_fid/with_recasts/limit/cursor
//     optional; priced "/v2/farcaster/feed/following | 4 | page limit", so 100 credits a miss, the same as the fids
//     feed). No viewer_fid (it would apply that account's mutes and add viewer_context, and the relay never sends
//     one), no cursor, replies dropped, the same score floor, denylist, shelf and accounting.
//   * both set, neither set, or a malformed value -> bad_config naming the VARIABLE(S), never a value. A blank value
//     (`FC_READ_HOUSE_FID=` as the env example ships it) counts as unset; anything else non-blank counts as set.
//   * the house fid is PINNED by value in upstreamPathAllowed, the way `limit` is: /feed/following/ is admitted only
//     for discovery, only with `fid` equal to the configured house fid — checked() takes that value from the armed
//     configuration (cfg.source), never from the spec being checked, so a spec that carried another account's fid
//     in its path fails the check even if it agrees with itself — and every other following-shaped path —
//     /feed/following without the slash or with a suffix, any other op, a different fid, a viewer_fid, a cursor,
//     /feed/?feed_type=following — stays refused. The status op still reports armed/reason/state only: it never says
//     which source is armed, and never the fid.
//   * D-FCREAD-HOUSE-ACCOUNT — what house mode concedes, knowingly: (1) the house account's follow list is PUBLIC on
//     Farcaster by nature, so anyone can see exactly whose posts the preview features (visible from the posts
//     anyway); (2) whoever controls that account — its custody key, its recovery address, or ANY signer on it (an app
//     it signed into can follow on its behalf) — curates the public feed under the Totem name, so it should be a
//     dedicated account holding as few signers as possible, never the owner's personal account (its follows, and
//     so its following feed, would become the brand's feed; the public boot contract refuses NEYNAR_VIEWER_FID for
//     the same reason); (3) losing control of that account means losing CURATION, not keys: the relay holds no signer
//     and no key of that account, and nothing here writes to Farcaster. The response is FC_READ=off (or switching to
//     FC_READ_FIDS) and a redeploy; the score floor and the denylist keep deciding what leaves meanwhile. The fid is
//     the same for every visitor — a server constant, never a visitor's pseudo-fid — so the reason behind
//     D-FCREAD-FOLLOWING-STAYS-LOCAL (no read joinable to a root) still holds.
//   * UNVERIFIED until the first real arming (the 2,000-credit smoke): whether the following feed also carries casts
//     from CHANNELS the house account follows (keep it following no channels, D-FCREAD-NO-CHANNELS-IN-V1), and how
//     many of 25 survive the floor, the denylist and the reply drop (the FEED_LIMIT TUNE note applies to both sources).
//
// FC-READ (review) — the accounting as it now stands, each rule with its finding:
//   * a miss is charged ONCE, before its first attempt; its 300/900 ms retries are not charged again. A failed miss
//     puts its key on a 45 s cooldown and five failed misses in a row (any keys) open a 60 s breaker; while either
//     holds, the answer is the shelf or fc_read_upstream with no upstream call and no charge. A Neynar outage used
//     to re-charge every retry of every request and could spend the day (correctness-relay-upstream-failure-burns-budget).
//   * the fixed key (discovery) costs one miss per TTL: <= 144 x 100 = 14.4k credits a day at the defaults
//     (cost-abuse-2; FC-READ (no channels): there is no channel op, so nothing else rides on that key).
//   * lookups (thread, user, user-casts) may spend at most 70% of the day, so discovery is never starved, and one
//     address at most 5% of the day on lookups (cost-abuse-2).
//   * the identifying lookups take a per-address token on EVERY request, hit or miss, before the cache is consulted,
//     and never serve the shelf: a refusal reads the same whether or not someone else read that handle or hash
//     (privacy-safety-2). What a fresh HIT still reveals (a 200 without an upstream call's latency) is the shared
//     cache's nature — A-FCREAD-SHARED-CACHE-OBSERVABLE, bounded by the token each probe costs.
//   * negative answers live in their own FIFO map and can never evict a positive; the discovery answer is pinned
//     outside the evictable LRU, so its 24 h shelf survives any lookup churn (cost-abuse-1).
//
// NEYNAR AS A SWITCH (SECURITY-POSTURE.md §42, lib/fc/source/switch.ts) — an armed key no longer answers everything. Every
// op but status is answered only while the surface it serves is switched to Neynar on THIS server (OP_SURFACES):
// discovery for FC_SOURCE_FORYOU, the two search ops for FC_SOURCE_SEARCH, a thread / user / user-casts lookup for either
// (it is how a card that came via Neynar opens). Otherwise 503 fc_source_off, before any token, credit or upstream call
// (the device's hint is page-settable and grants nothing). Following, notifications and counts have no op at all and
// never will: a read of one account's graph, or of the hashes on one screen, names its visitor to this server.
//   * search-casts / search-users: ONE argument, the query, normalised (NFKC, lower case, single spaces, 2-64 characters,
//     no control characters), as `q` with the server's `limit` (10 / 5) and nothing else (author_fid, viewer_fid, fid,
//     cursor, channel_id and parent_url are refused by name). Lookups by discipline: a per-address token on every
//     request, the lookup reserve, no shelf. Results go through the same floor, denylist and allowlist as discovery.
//
// State lives on globalThis: Next compiles each route and page as its own entry, and a module-level Map would be one
// cache (and one budget) per entry in the same process. Same discipline as lib/adapters/neynar/mode.ts.
import { createHash, randomBytes } from "node:crypto";
import { isHostedPlatform, isPublicDeployment } from "@/lib/platform/env-contract";
import { mapCast, mapUser } from "@/lib/adapters/neynar/contentPure.mjs";
import { FC_SOURCE_OFF_SENTENCE, normaliseSearchQuery, searchQueryAllowed, serverNeynarAllowed, type FcSurface } from "@/lib/fc/source/switch";
import type { Cast, Embed, User } from "@/lib/types";

// ------------------------------------------------------------------------------------------------ the contract
// Shared with the device transport (lib/adapters/neynar/content.ts) and the tests. Consumers import these as TYPES
// only (`import type`), which TypeScript erases: nothing in the browser bundle imports this module's code.

// FC-READ (no channels): no "channel" op — channels are not a v1 emphasis, so there is no per-channel live read
// NEYNAR AS A SWITCH (§42): "search-casts" and "search-users" — a public search query, naming no visitor
export type FcReadOp = "status" | "discovery" | "thread" | "user" | "user-casts" | "search-casts" | "search-users";

/** a cast that came through the relay: the mapper's `live: true` plus the network-cast marker the UI and the
 *  per-target write refusal key on (its hash is always 0x + 40 lowercase hex) */
export type RelayCast = Cast & { live: true; network: true };

export interface RelayThread {
  cast: RelayCast;
  ancestors: RelayCast[];
  replies: RelayCast[];
}

/** what `value` holds for each op in a 200 answer */
export interface FcReadValues {
  discovery: RelayCast[];
  thread: RelayThread;
  user: User;
  "user-casts": RelayCast[];
  "search-casts": RelayCast[];
  "search-users": User[];
}

export type FcReadReason = "armed" | "no_key" | "bad_key" | "off" | "not_public" | "bad_base_url" | "bad_config";
export type FcReadState = "live" | "stale" | "off" | "budget" | "unarmed" | "error";

export type FcReadCode =
  | "fc_read_off"
  | "fc_read_budget"
  | "fc_read_unarmed"
  | "fc_read_upstream"
  | "fc_read_rate"
  | "bad_op"
  | "not_found"
  | "cross_site"
  // NEYNAR AS A SWITCH (§42): the op's surface is switched to Farcaster's network on this server (FC_SOURCE_*)
  | "fc_source_off";

/** FIXED sentences, one per code. Never upstream text, never an error message. FC-READ: they also avoid the
 *  page-health needle words (scripts/lib/page-health.mjs), because the device may show them inline. */
export const FC_READ_SENTENCES: Record<FcReadCode, string> = {
  fc_read_off: "Live Farcaster posts are paused on this preview, so it shows preview content.",
  fc_read_budget: "Live Farcaster posts are paused for today, so this preview shows its own content.",
  fc_read_unarmed: "Live Farcaster reading is not switched on for this preview.",
  fc_read_upstream: "Farcaster did not answer just now, so this preview shows its own content.",
  // FC-READ (review): "for now … later", not "a few minutes" — the same code answers the per-address DAILY lookup cap,
  // whose Retry-After can be hours
  fc_read_rate: "Too many live Farcaster lookups from here for now. Try again later.",
  bad_op: "That read is not one this preview offers.",
  not_found: "That Farcaster post or account is not available here.",
  cross_site: "Live Farcaster reads are served to this site's own pages only.",
  fc_source_off: FC_SOURCE_OFF_SENTENCE,
};

export interface FcReadAnswer {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

// ------------------------------------------------------------------------------------------------ constants

const REAL_BASE = "https://api.neynar.com/v2/farcaster";
const KEY_SHAPE = /^[A-Za-z0-9-]{16,80}$/;
const HASH40 = /^0x[0-9a-f]{40}$/;
/** an fname (the Farcaster name registry's own rule) or an ENS-style .eth name (dwr.eth, name.base.eth) */
const FNAME = /^[a-z0-9][a-z0-9-]{0,15}$/;
const ETH_NAME = /^(?=.{5,64}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.eth$/;
/** FC-READ (no channels): one fid in FC_READ_FIDS (and in FC_READ_DENY): a positive integer, no leading zero, so one
 *  account has exactly one spelling and a duplicate is always caught */
const FID_ITEM = /^[1-9]\d{0,9}$/;
/** FC-READ (no channels): /v2/farcaster/feed/'s documented cap on `fids` ("Max array size is 100") */
const MAX_FIDS = 100;
/** the only shape the discovery path's `fids` VALUE may have: 1-100 of FID_ITEM, comma separated. A server constant
 *  (the operator's list, validated at arming), never a client argument — so the path check may read it. */
const FIDS_VALUE = /^[1-9]\d{0,9}(?:,[1-9]\d{0,9}){0,99}$/; // FID_ITEM, 1 to MAX_FIDS times
/** FC-READ (house): the house account's following feed — the ONE following-shaped pathname the relay may build, and
 *  only for discovery with `fid` pinned to FC_READ_HOUSE_FID (upstreamPathAllowed). Neynar documents it with the
 *  trailing slash (GET /v2/farcaster/feed/following/); no other spelling is admitted. */
const HOUSE_PATH = "/feed/following/";

const DEFAULT_DAILY_CREDITS = 100_000;
const MAX_DAILY_CREDITS = 10_000_000; // the whole Free plan's month; anything above is a typo, not a budget
const DEFAULT_MIN_SCORE = 0.5;

// FC-READ (no channels): discovery is /v2/farcaster/feed/ (filter_type=fids), priced on Neynar's credits page as
// "/v2/farcaster/feed | 4 | page limit": 4 x 25 = 100 credits per miss, ONE page per miss (no cursor is followed).
// At TTL 600 s that is <= 144 misses, <= 14.4k credits a day — the same as the /feed/channels discovery it replaces.
// FC-READ (house): the house mode's /feed/following/ is priced on the same page as "/v2/farcaster/feed/following | 4 |
// page limit", so the SAME 100 credits a miss and the same ceiling; the limit below is shared by both sources.
// TUNE: if the arming probe admits fewer than ~20 casts per page (score floor + denylist + dropped replies), raise
// this to 40-50 (160-200 credits per miss, <= 28.8k a day, still inside discovery's 30% of the 100k default) rather
// than following a cursor — the path check admits only this constant as `limit`, and the endpoint's cap is 100.
const FEED_LIMIT = 25;
const THREAD_LIMIT = 10; // /cast/conversation, reply_depth 2: ASSUMED 4 x 10 = 40 until measured
const USER_CASTS_LIMIT = 10; // /feed/user/casts: ASSUMED 4 x 10 = 40 until measured
// NEYNAR AS A SWITCH (§42): the search ops. /user/search is priced FLAT on Neynar's compute-units page ("/v2/farcaster/user/
// search | 10", read 2026-11-07); /cast/search is not on that page, so it is ASSUMED 4 x limit like the feed endpoints
// until the first real arming measures it. Page sizes: Neynar's defaults are 25 casts and 5 users; ours are 10 and 5.
const SEARCH_CASTS_LIMIT = 10;
const SEARCH_USERS_LIMIT = 5;
// FC-READ (no channels): there is no "channel" op, so no entry here and no other key rides on discovery's miss: the
// fixed keys are one discovery miss per TTL, <= 144 x 100 = 14.4k credits a day (cost-abuse-2).
const COST = { discovery: 4 * FEED_LIMIT, thread: 4 * THREAD_LIMIT, user: 2, "user-casts": 4 * USER_CASTS_LIMIT, "search-casts": 4 * SEARCH_CASTS_LIMIT, "search-users": 10 } as const;
/** the page size each op's upstream path carries — the server's constant, the only `limit` value the path check admits */
const SERVER_LIMIT: Partial<Record<SpecOp, number>> = { discovery: FEED_LIMIT, thread: THREAD_LIMIT, "user-casts": USER_CASTS_LIMIT, "search-casts": SEARCH_CASTS_LIMIT, "search-users": SEARCH_USERS_LIMIT };

const S = 1000;
/** FC-READ (future-dated casts): the most a cast's timestamp may lead this server's clock — Farcaster's own 10-minute
 *  clock-skew allowance. A cast dated further ahead is dropped by projectCast (see there). */
const FUTURE_SKEW_MS = 600 * S;
const TTL_MS = { discovery: 600 * S, thread: 900 * S, user: 1800 * S, "user-casts": 1800 * S, "search-casts": 900 * S, "search-users": 900 * S } as const;
const NEGATIVE_TTL_MS = 3600 * S;
const STALE_SHELF_MS = 24 * 3600 * S;
const MAX_ENTRIES = 500;
const MAX_BYTES = 20 * 1024 * 1024;
/** FC-READ (review, cost-abuse-1): negatives live in their own FIFO map with this cap. At 64 bytes and one LRU slot
 *  each, and refreshed by every free hit, they used to be able to flush the shared LRU — hot keys and shelf included. */
const MAX_NEGATIVES = 2000;

const BACKOFF_MS = [300, 900]; // the existing content.ts discipline: 429, 5xx and network errors retry twice
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;
/** after the upstream refuses the key (401/403), stop asking for a while: a revoked key must not turn every miss
 *  into an upstream call */
const KEY_REJECTED_COOLDOWN_MS = 5 * 60 * S;
/** FC-READ (review, correctness-relay-upstream-failure-burns-budget): after a failed miss (429/5xx/network/timeout
 *  through all three attempts, or an answer the mapper cannot read), that KEY is not asked upstream again for 45 s:
 *  requests meanwhile get the shelf or fc_read_upstream with no upstream call and no charge. */
const FAILURE_COOLDOWN_MS = 45 * S;
const MAX_COOLDOWNS = 2000;
/** FC-READ (review, same finding): and when this many misses IN A ROW fail, across keys, upstream is paused for
 *  BREAKER_OPEN_MS for every key — a Neynar outage costs at most a handful of charged misses, not the day. After the
 *  pause exactly one miss is let through as a trial; its failure re-opens the breaker, its success closes it. */
const BREAKER_THRESHOLD = 5;
const BREAKER_OPEN_MS = 60 * S;

const PER_ADDRESS_MISSES = 20; // per 10 minutes (and, for the identifying lookups, per 10 minutes of REQUESTS)
const PER_ADDRESS_WINDOW_S = 600;
const GLOBAL_MISSES_PER_MINUTE = 60;
/** FC-READ (review, cost-abuse-2): lookups may spend at most this share of the day, so discovery (which needs
 *  <= 14.4k credits a day at the defaults) is never starved by them */
const LOOKUP_SHARE = 0.7;
/** FC-READ (review, cost-abuse-2): one address may spend at most this share of the day on lookup misses — an honest
 *  header or not, no single address can spend the day. Floored at one thread miss (40), so a tiny test budget (the
 *  2,000-credit real smoke gets 100) can still read one of each. */
const PER_ADDRESS_DAILY_SHARE = 0.05;
/** the per-address daily ledger's size bound (FIFO): forgetting an address hands it a fresh 5%, which a new address
 *  gets anyway — the lookup reserve and the global bucket are what bound the total */
const MAX_ADDRESS_LEDGER = 20_000;
const COUNTER_LOG_EVERY_MS = 15 * 60 * S;

/** FC-READ (review, key-custody-2): the only upstream paths this module can build, and each one's parameter NAMES.
 *  Checked when a spec is BUILT (checked(), before any token or credit is taken) against the path and the names —
 *  never against an argument's value, so an fname such as "cursor", "following" or "notifications" is an ordinary
 *  value. FC-READ (no channels): /feed/channels is gone; discovery is /feed/ with the filter parameters below. */
const UPSTREAM_PARAMS: Readonly<Record<string, readonly string[]>> = {
  "/feed/": ["feed_type", "filter_type", "fids", "with_recasts", "limit"],
  // FC-READ (house): fid (pinned to FC_READ_HOUSE_FID), with_recasts, limit — never viewer_fid or cursor, which the
  // endpoint also takes
  [HOUSE_PATH]: ["fid", "with_recasts", "limit"],
  "/cast/conversation": ["identifier", "type", "reply_depth", "include_chronological_parent_casts", "limit"],
  "/user/by_username": ["username"],
  "/feed/user/casts": ["fid", "limit"],
  // NEYNAR AS A SWITCH (§42): q and limit ONLY. Never viewer_fid (it would name a visitor and apply their mutes), never
  // author_fid (a search scoped to one account is a lookup of that account), never cursor, channel_id or parent_url.
  // The trailing slash is Neynar's documented spelling (reference/search-casts, reference/search-user).
  "/cast/search/": ["q", "limit"],
  "/user/search/": ["q", "limit"],
};
/** FC-READ (no channels): parameters whose VALUE is pinned, the way `limit` is pinned to SERVER_LIMIT. /feed/ serves
 *  the per-viewer following feed on the SAME pathname (feed_type defaults to "following"), so a table bug that sent
 *  feed_type=following, dropped feed_type, or switched filter_type (channel_id, parent_url, embed_*) must fail the
 *  check rather than reach upstream. with_recasts is pinned too: discovery shows original casts only.
 *  FC-READ (house): the /feed/ pins are UNCHANGED — house mode does not use /feed/?feed_type=following, so that shape
 *  stays refused in both modes; the house path pins with_recasts the same way (its `fid` is pinned in the check). */
const PINNED_VALUES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "/feed/": { feed_type: "filter", filter_type: "fids", with_recasts: "false" },
  [HOUSE_PATH]: { with_recasts: "false" },
};
/** FC-READ (no channels): parameters that must be PRESENT — an absent feed_type means the following feed upstream.
 *  FC-READ (house): an absent with_recasts means recasts (Neynar's default true), and an absent limit means Neynar's
 *  default page — neither may be left to the upstream's defaults. */
const REQUIRED_PARAMS: Readonly<Record<string, readonly string[]>> = {
  "/feed/": ["feed_type", "filter_type", "fids", "with_recasts", "limit"],
  [HOUSE_PATH]: ["fid", "with_recasts", "limit"],
  "/cast/search/": ["q", "limit"],
  "/user/search/": ["q", "limit"],
};
const OP_PATH: Readonly<Record<SpecOp, string>> = {
  discovery: "/feed/",
  thread: "/cast/conversation",
  user: "/user/by_username",
  "user-casts": "/feed/user/casts",
  "search-casts": "/cast/search/",
  "search-users": "/user/search/",
};
/** named outright as well (none is in any allowlist above; this keeps them refused if one ever is added) */
const REFUSED_PARAMS: ReadonlySet<string> = new Set(["viewer_fid", "cursor", "provider", "author_fid", "channel_id", "parent_url"]);
/** FC-READ (house): "/feed/following" stays here. The ONE exemption is exact — pathname HOUSE_PATH, op discovery, a
 *  valid configured house fid (upstreamPathAllowed's `houseRequest`); every other path under the prefix is refused. */
const REFUSED_PREFIXES = ["/notifications", "/feed/following"];

// ------------------------------------------------------------------------------------------------ state

/** the ops that reach upstream (every op but status) */
type SpecOp = "discovery" | "thread" | "user" | "user-casts" | "search-casts" | "search-users";
/** FC-READ (review, privacy-safety-2): the ops whose KEY names someone (a hash, a handle). They take a per-address
 *  token on every request, never serve the shelf, and count against the lookup reserve and the per-address cap. */
// NEYNAR AS A SWITCH (§42): a search key names what someone typed, so the searches take the same per-request token, the
// lookup reserve and no shelf
const LOOKUP_OPS: ReadonlySet<SpecOp> = new Set<SpecOp>(["thread", "user", "user-casts", "search-casts", "search-users"]);

/** NEYNAR AS A SWITCH (§42): the surface(s) each op serves. An op is answered only while one of them is switched to Neynar
 *  on THIS server (lib/fc/source/switch.ts serverNeynarAllowed): discovery is For You's list; a search is search; a thread
 *  or profile lookup is how a card that came via Neynar opens, so it follows either. Following, notifications and counts
 *  have no op at all. */
const OP_SURFACES: Readonly<Record<SpecOp, readonly FcSurface[]>> = {
  discovery: ["forYou"],
  thread: ["forYou", "search"],
  user: ["forYou", "search"],
  "user-casts": ["forYou", "search"],
  "search-casts": ["search"],
  "search-users": ["search"],
};

/** NEYNAR AS A SWITCH (§42): is this op's surface switched to Neynar here? Exported for the unit harness. */
export function opSwitchedOn(op: SpecOp, env: Record<string, string | undefined> = process.env): boolean {
  return OP_SURFACES[op].some((s) => serverNeynarAllowed(env, s));
}

/** a POSITIVE answer. Negatives are not entries: they are a key and an expiry in their own map. */
interface Entry {
  op: SpecOp;
  value: unknown;
  bytes: number;
  storedAt: number;
  freshUntil: number;
}

interface Bucket {
  tokens: number;
  at: number;
}

type Refusal = { kind: "refused"; code: "fc_read_budget" | "fc_read_rate" | "fc_read_upstream"; retryAfterSeconds?: number };
type Outcome = { kind: "value"; value: unknown; stale: boolean } | { kind: "not_found" } | Refusal;

interface Counters {
  hits: number;
  misses: number;
  stale: number;
  notFound: number;
  rate: number;
  budget: number;
  upstream: number;
  /** refusals answered with no upstream call because of a cooldown, the breaker or a rejected key */
  paused: number;
  refused: number;
  upstreamCalls: number;
}

interface RelayState {
  /** the evictable LRU: positive LOOKUP answers only (thread, user, user-casts), dead at their fresh TTL */
  cache: Map<string, Entry>;
  bytes: number;
  /** FC-READ (review, cost-abuse-1): the fixed hot key (discovery), outside the LRU — no lookup churn can evict it
   *  or its 24 h shelf. Bounded by construction: the key set is fixed. */
  pinned: Map<string, Entry>;
  /** FC-READ (review, cost-abuse-1): negative answers, key -> fresh-until. FIFO, capped at MAX_NEGATIVES, never
   *  touched on a hit, and unable to evict a positive (they are not in the LRU at all). */
  negatives: Map<string, number>;
  inflight: Map<string, Promise<Outcome>>;
  day: string;
  spent: number;
  /** credits spent today by lookup misses (bounded by LOOKUP_SHARE of the day) */
  lookupSpent: number;
  /** credits spent today by lookup misses per hashed address (bounded by PER_ADDRESS_DAILY_SHARE of the day) */
  addressSpent: Map<string, number>;
  addressBuckets: Map<string, Bucket>;
  addressSweptAt: number;
  global: Bucket;
  keyRejectedUntil: number;
  /** per-key failure cooldowns, key -> until (FIFO; every entry has the same length, so the oldest expire first) */
  failedUntil: Map<string, number>;
  /** consecutive failed misses across keys; the breaker is open until openUntil, and then lets one trial through */
  breaker: { failures: number; openUntil: number; trial: boolean };
  loggedReason: string | null;
  counters: Counters;
  countersSince: number;
  salt: Buffer;
}

const zeroCounters = (): Counters => ({ hits: 0, misses: 0, stale: 0, notFound: 0, rate: 0, budget: 0, upstream: 0, paused: 0, refused: 0, upstreamCalls: 0 });

function state(): RelayState {
  const g = globalThis as unknown as { __layersFcRead?: RelayState };
  if (!g.__layersFcRead) {
    const now = Date.now();
    g.__layersFcRead = {
      cache: new Map(),
      bytes: 0,
      pinned: new Map(),
      negatives: new Map(),
      inflight: new Map(),
      day: utcDay(now),
      spent: 0,
      lookupSpent: 0,
      addressSpent: new Map(),
      addressBuckets: new Map(),
      addressSweptAt: now,
      global: { tokens: GLOBAL_MISSES_PER_MINUTE, at: now },
      keyRejectedUntil: 0,
      failedUntil: new Map(),
      breaker: { failures: 0, openUntil: 0, trial: false },
      loggedReason: null,
      counters: zeroCounters(),
      countersSince: now,
      // FC-READ: per-process salt — the address buckets hold a salted hash, never an address (the app's memory is
      // not a log of who read what; A-FCREAD-OPERATOR-SEES-READS covers what the platform's own logs still see)
      salt: randomBytes(16),
    };
  }
  return g.__layersFcRead;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------------------------------------ arming

/** FC-READ (house): where discovery's authors come from — exactly ONE of the two variables. "fids": the author list
 *  itself (FC_READ_FIDS, 1-100 distinct fids, in the operator's order). "house": the account whose follows are the
 *  list (FC_READ_HOUSE_FID). Server env only; never reported by the status op, never logged. */
type DiscoverySource = { kind: "fids"; fids: number[] } | { kind: "house"; fid: number };

interface ArmedConfig {
  armed: true;
  key: string;
  base: string;
  /** FC-READ (house): the ONE configured discovery source (it replaces the fids-only `fids` field) */
  source: DiscoverySource;
  daily: number;
  minScore: number;
  denyFids: Set<number>;
  denyHashes: Set<string>;
}
type RelayConfig = ArmedConfig | { armed: false; reason: Exclude<FcReadReason, "armed">; detail?: string };

const OFF = new Set(["off", "false", "0", "no"]);

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Whether the relay is armed in THIS environment, and why not when it is not. Evaluated per call (it is a few string
 * checks), so the answer always matches the env the process holds. Misconfiguration DISARMS with a named reason; it
 * never exits the process — the public app has no healthcheck path, so a refused boot is an outage, not a failed
 * rollout (the must-not-ship class keeps exit 78; this is not that class).
 *
 * Order: the kill switch, then the key (absent, then shape), then the test base-URL override, then WHERE this
 * process may spend (a hosted public deployment; or a local production-shaped pair pointed at a loopback stub; or
 * FC_READ_RIG=real, the explicit opt-in for a local run against the real network; or FC_READ_RIG=stub + loopback on a
 * rig), then the tunables. The rig and the owner service hold the owner's NEYNAR_API_KEY and stay dormant: neither is
 * a public deployment, and this reads NEYNAR_READ_API_KEY only.
 */
// NOT exported: the armed config holds the key, and this module is the key's only reader
function relayConfig(env: Record<string, string | undefined> = process.env): RelayConfig {
  if (OFF.has((env.FC_READ ?? "").trim().toLowerCase())) return { armed: false, reason: "off" };
  const key = (env.NEYNAR_READ_API_KEY ?? "").trim();
  if (!key) return { armed: false, reason: "no_key" };
  if (!KEY_SHAPE.test(key)) return { armed: false, reason: "bad_key" };

  let base = REAL_BASE;
  let loopbackBase = false;
  const override = (env.NEYNAR_READ_BASE_URL ?? "").trim();
  if (override) {
    // FC-READ: a test-only override. On a hosted platform, or pointed anywhere but loopback, it would ship the key to
    // an arbitrary host — so it disarms the relay instead of being honoured.
    if (isHostedPlatform(env)) return { armed: false, reason: "bad_base_url", detail: "set on a hosted platform" };
    let u: URL;
    try {
      u = new URL(override);
    } catch {
      return { armed: false, reason: "bad_base_url", detail: "not a URL" };
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return { armed: false, reason: "bad_base_url", detail: "not http(s)" };
    if (!isLoopbackHost(u.hostname)) return { armed: false, reason: "bad_base_url", detail: "not a loopback host" };
    if (u.username || u.password || u.search || u.hash) return { armed: false, reason: "bad_base_url", detail: "carries credentials, a query or a fragment" };
    const path = u.pathname.replace(/\/+$/, "");
    base = u.origin + (path === "" ? "/v2/farcaster" : path);
    loopbackBase = true;
  }

  const rig = (env.FC_READ_RIG ?? "").trim().toLowerCase();
  const publicShape = isPublicDeployment(env);
  const mayArm = publicShape
    ? isHostedPlatform(env) || loopbackBase || rig === "real"
    : rig === "stub" && loopbackBase;
  if (!mayArm) return { armed: false, reason: "not_public" };

  // tunables — a bad value disarms (naming the variable, never the value) rather than being guessed around
  // FC-READ (house): the discovery SOURCE first — exactly one of FC_READ_FIDS and FC_READ_HOUSE_FID. Both set is an
  // operator who has not decided (the relay must not pick for them); neither set is the no-default rule below.
  const fidsRaw = (env.FC_READ_FIDS ?? "").trim();
  const houseRaw = (env.FC_READ_HOUSE_FID ?? "").trim();
  if (fidsRaw && houseRaw) return { armed: false, reason: "bad_config", detail: "FC_READ_FIDS and FC_READ_HOUSE_FID are both set; set exactly one" };
  if (!fidsRaw && !houseRaw) return { armed: false, reason: "bad_config", detail: "FC_READ_FIDS or FC_READ_HOUSE_FID: set exactly one" };
  let source: DiscoverySource;
  if (houseRaw) {
    // FC-READ (house): ONE plain positive integer (FID_ITEM: no sign, no leading zero, no list, no decimal) — a typo
    // must not point discovery at some other account's following feed, or at none
    if (!FID_ITEM.test(houseRaw)) return { armed: false, reason: "bad_config", detail: "FC_READ_HOUSE_FID" };
    source = { kind: "house", fid: Number(houseRaw) };
    if (!checked(discoverySpec(source), source)) return { armed: false, reason: "bad_config", detail: "FC_READ_HOUSE_FID" };
  } else {
    // FC-READ (no channels): FC_READ_FIDS replaces FC_READ_CHANNELS (which is no longer read at all). It has NO
    // default: whose casts appear under the Totem brand is the owner's choice, so empty, more than 100, a duplicate,
    // or any entry that is not a plain positive integer DISARMS — never a guessed list, never a partial one.
    const fidItems = fidsRaw.split(",").map((f) => f.trim()).filter(Boolean);
    if (!fidItems.length || fidItems.length > MAX_FIDS || fidItems.some((f) => !FID_ITEM.test(f)) || new Set(fidItems).size !== fidItems.length) {
      return { armed: false, reason: "bad_config", detail: "FC_READ_FIDS" };
    }
    source = { kind: "fids", fids: fidItems.map(Number) };
    // FC-READ (review, key-custody-2): the discovery path this source builds is checked HERE, at arming, rather than
    // at request time — so a value the path check would refuse disarms with a named reason instead of failing reads.
    if (!checked(discoverySpec(source), source)) return { armed: false, reason: "bad_config", detail: "FC_READ_FIDS" };
  }
  const rawDaily = (env.FC_READ_DAILY_CREDITS ?? "").trim();
  const daily = rawDaily ? Number(rawDaily) : DEFAULT_DAILY_CREDITS;
  if (!Number.isInteger(daily) || daily < 1 || daily > MAX_DAILY_CREDITS) return { armed: false, reason: "bad_config", detail: "FC_READ_DAILY_CREDITS" };
  const rawScore = (env.FC_READ_MIN_SCORE ?? "").trim();
  const minScore = rawScore ? Number(rawScore) : DEFAULT_MIN_SCORE;
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) return { armed: false, reason: "bad_config", detail: "FC_READ_MIN_SCORE" };
  const denyFids = new Set<number>();
  const denyHashes = new Set<string>();
  for (const raw of (env.FC_READ_DENY ?? "").split(",")) {
    const item = raw.trim().toLowerCase();
    if (!item) continue;
    if (FID_ITEM.test(item)) denyFids.add(Number(item));
    else if (HASH40.test(item)) denyHashes.add(item);
    // an operator's typo must not silently let through what they meant to block — fail closed
    else return { armed: false, reason: "bad_config", detail: "FC_READ_DENY" };
  }
  return { armed: true, key, base, source, daily, minScore, denyFids, denyHashes };
}

/** the one "[fc-read] armed" / "[fc-read] unarmed: <reason>" line, at first use and again only if it changes */
function noteArming(cfg: RelayConfig): void {
  const st = state();
  const line = cfg.armed ? "armed" : "unarmed: " + cfg.reason + (cfg.detail ? " (" + cfg.detail + ")" : "");
  if (st.loggedReason === line) return;
  st.loggedReason = line;
  if (cfg.armed) console.log("[fc-read] armed");
  else console.log("[fc-read] " + line);
}

/** the device hint (lib/device/deviceEnv.server.ts): true only while the relay is armed. A boolean — never the key. */
export function relayArmed(): boolean {
  const cfg = relayConfig();
  noteArming(cfg);
  return cfg.armed;
}

// ------------------------------------------------------------------------------------------------ budget + buckets

function rollDay(st: RelayState, now: number): void {
  const day = utcDay(now);
  if (day !== st.day) {
    st.day = day;
    st.spent = 0;
    st.lookupSpent = 0;
    st.addressSpent.clear();
  }
}

/** seconds until the UTC day rolls (the per-address daily cap's Retry-After) */
function secondsToUtcMidnight(now: number): number {
  const d = new Date(now);
  return Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now) / 1000));
}

/** FC-READ (review, cost-abuse-2): the lookup reserve and one address's daily share, in credits */
function lookupCaps(cfg: ArmedConfig): { reserve: number; perAddress: number } {
  return {
    reserve: Math.floor(cfg.daily * LOOKUP_SHARE),
    perAddress: Math.max(COST.thread, Math.floor(cfg.daily * PER_ADDRESS_DAILY_SHARE)),
  };
}

/** the salted hash every per-address structure keys on (the app's memory is not a log of who read what). The route
 *  has already normalised the address (IPv6 to its /64, IPv4-mapped to IPv4, unparseable to one "unknown" bucket). */
function addressId(addressKey: string): string {
  return createHash("sha256").update(state().salt).update(addressKey).digest("base64url").slice(0, 22);
}

function refill(b: Bucket, capacity: number, perSecond: number, now: number): void {
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * perSecond);
  b.at = now;
}

function waitSeconds(b: Bucket, perSecond: number): number {
  return Math.max(1, Math.ceil((1 - b.tokens) / perSecond));
}

/**
 * Peek the requested buckets; take one token from each only when all of them have one (a refusal costs no one a
 * token). `perAddress`: the address's bucket (every identifying request, and a discovery miss). `global`: the miss
 * bucket no header can split (every miss).
 */
function takeTokens(addr: string, now: number, perAddress: boolean, global: boolean): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const st = state();
  const perAddr = PER_ADDRESS_MISSES / PER_ADDRESS_WINDOW_S;
  const perGlobal = GLOBAL_MISSES_PER_MINUTE / 60;
  if (now - st.addressSweptAt > 60 * S) {
    for (const [k, b] of st.addressBuckets) if (now - b.at > PER_ADDRESS_WINDOW_S * S) st.addressBuckets.delete(k);
    st.addressSweptAt = now;
  }
  let mine: Bucket | undefined;
  if (perAddress) {
    mine = st.addressBuckets.get(addr) ?? { tokens: PER_ADDRESS_MISSES, at: now };
    refill(mine, PER_ADDRESS_MISSES, perAddr, now);
    st.addressBuckets.set(addr, mine);
    if (mine.tokens < 1) return { ok: false, retryAfterSeconds: waitSeconds(mine, perAddr) };
  }
  if (global) {
    refill(st.global, GLOBAL_MISSES_PER_MINUTE, perGlobal, now);
    if (st.global.tokens < 1) return { ok: false, retryAfterSeconds: waitSeconds(st.global, perGlobal) };
    st.global.tokens -= 1;
  }
  if (mine) mine.tokens -= 1;
  return { ok: true };
}

/** record one address's lookup spend for today (FIFO-bounded; see MAX_ADDRESS_LEDGER) */
function ledger(addr: string, total: number): void {
  const st = state();
  st.addressSpent.delete(addr);
  st.addressSpent.set(addr, total);
  while (st.addressSpent.size > MAX_ADDRESS_LEDGER) {
    const oldest = st.addressSpent.keys().next();
    if (oldest.done) break;
    st.addressSpent.delete(oldest.value);
  }
}

// ------------------------------------------------------------------------------------------------ the caches

/** the positive answer for a key: the pinned discovery answer (alive for the 24 h shelf), or a lookup from the LRU
 *  (alive only while fresh — a lookup has no shelf, privacy-safety-2). Touches LRU entries only. */
function positiveGet(key: string, now: number): Entry | undefined {
  const st = state();
  const p = st.pinned.get(key);
  if (p) {
    if (now - p.storedAt < STALE_SHELF_MS) return p;
    st.pinned.delete(key);
    return undefined;
  }
  const e = st.cache.get(key);
  if (!e) return undefined;
  if (now >= e.freshUntil) {
    st.cache.delete(key);
    st.bytes -= e.bytes;
    return undefined;
  }
  // touch: Map order is insertion order, so re-inserting makes this the most recently used
  st.cache.delete(key);
  st.cache.set(key, e);
  return e;
}

/** whether a fresh negative answer is held for the key. FIFO: a hit does NOT refresh its place (cost-abuse-1). */
function negativeHeld(key: string, now: number): boolean {
  const st = state();
  const until = st.negatives.get(key);
  if (until === undefined) return false;
  if (now < until) return true;
  st.negatives.delete(key);
  return false;
}

function dropPositive(key: string): void {
  const st = state();
  st.pinned.delete(key);
  const old = st.cache.get(key);
  if (old) {
    st.cache.delete(key);
    st.bytes -= old.bytes;
  }
}

function putPositive(key: string, e: Omit<Entry, "bytes">): void {
  const st = state();
  st.negatives.delete(key);
  dropPositive(key);
  const bytes = JSON.stringify(e.value ?? null).length;
  if (bytes > MAX_BYTES / 4) return; // one answer never takes a quarter of the cache
  if (e.op === "discovery") {
    st.pinned.set(key, { ...e, bytes });
    return;
  }
  st.cache.set(key, { ...e, bytes });
  st.bytes += bytes;
  while (st.cache.size > MAX_ENTRIES || st.bytes > MAX_BYTES) {
    const oldest = st.cache.keys().next();
    if (oldest.done) break;
    const victim = st.cache.get(oldest.value);
    st.cache.delete(oldest.value);
    if (victim) st.bytes -= victim.bytes;
  }
}

/** a definitive "gone" (or hidden by the floor or the denylist): it outranks any positive for the key, which goes */
function putNegative(key: string, until: number, now: number): void {
  const st = state();
  dropPositive(key);
  st.negatives.delete(key);
  st.negatives.set(key, until);
  // every negative lives NEGATIVE_TTL_MS, so the oldest expire first: drop the expired from the front, then the cap
  for (const [k, u] of st.negatives) {
    if (u > now && st.negatives.size <= MAX_NEGATIVES) break;
    st.negatives.delete(k);
  }
}

// ------------------------------------------------------------------------------------------------ moderation + allowlist

type Raw = Record<string, any>;

function scoreOf(u: Raw | undefined): number | undefined {
  const s = u?.score ?? u?.experimental?.neynar_user_score;
  return typeof s === "number" && Number.isFinite(s) ? s : undefined;
}

/** every full user object in a payload carries its Neynar score; quoted casts' authors arrive dehydrated (no score),
 *  so a quote is admitted only when its author's score is known from elsewhere in the same answer */
function collectScores(casts: Raw[], scores: Map<number, number> = new Map()): Map<number, number> {
  const add = (u: Raw | undefined) => {
    const s = scoreOf(u);
    if (typeof u?.fid === "number" && s !== undefined) scores.set(u.fid, s);
  };
  for (const c of casts) {
    add(c?.author);
    for (const m of Array.isArray(c?.mentioned_profiles) ? c.mentioned_profiles : []) add(m);
  }
  return scores;
}

function admitted(cfg: ArmedConfig, u: Raw | undefined, scores: Map<number, number>): boolean {
  if (!u || typeof u.fid !== "number") return false;
  if (cfg.denyFids.has(u.fid)) return false;
  const s = scoreOf(u) ?? scores.get(u.fid);
  // FC-READ: missing score = hidden. The floor is the only moderation between arbitrary Farcaster content and a page
  // under the Totem brand, so absence cannot mean pass.
  return s !== undefined && s >= cfg.minScore;
}

function castAdmitted(cfg: ArmedConfig, c: Raw | undefined, scores: Map<number, number>): boolean {
  if (!c || typeof c.hash !== "string") return false;
  if (cfg.denyHashes.has(c.hash.toLowerCase())) return false;
  return admitted(cfg, c.author, scores);
}

/** drop quote embeds whose quoted cast or author is not admitted, before the mapper sees them */
function prefilterEmbeds(cfg: ArmedConfig, c: Raw, scores: Map<number, number>): Raw {
  const embeds = Array.isArray(c.embeds) ? c.embeds : [];
  return {
    ...c,
    embeds: embeds.filter((e: Raw) => {
      if (!e || typeof e !== "object") return false;
      if (e.cast || e.cast_id) return !!e.cast && castAdmitted(cfg, e.cast, scores);
      return true;
    }),
  };
}

const FALLBACK_PFP: string = mapUser({}).pfpUrl; // the mapper's own neutral placeholder (a data: SVG)

function safeUrl(u: unknown): string | undefined {
  if (typeof u !== "string" || u.length > 2048) return undefined;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? u : undefined;
  } catch {
    return undefined;
  }
}
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** the User field allowlist: exactly the fields the app renders, each typed and bounded */
function projectUser(m: User): User | null {
  if (typeof m.fid !== "number" || !Number.isInteger(m.fid) || m.fid <= 0) return null;
  const banner = safeUrl(m.bannerUrl);
  return {
    fid: m.fid,
    username: str(m.username, 64) || String(m.fid),
    displayName: str(m.displayName, 128) || str(m.username, 64) || String(m.fid),
    pfpUrl: safeUrl(m.pfpUrl) ?? FALLBACK_PFP,
    bio: str(m.bio, 1024),
    ...(banner ? { bannerUrl: banner } : {}),
    followerCount: count(m.followerCount),
    followingCount: count(m.followingCount),
    verified: m.verified === true,
  };
}

function projectEmbed(e: Embed, depth: number): Embed | null {
  if (e.type === "image") {
    const url = safeUrl(e.url);
    return url ? { type: "image", url } : null;
  }
  if (e.type === "link") {
    const url = safeUrl(e.url);
    if (!url) return null;
    const image = safeUrl(e.image);
    const description = typeof e.description === "string" ? e.description.slice(0, 1000) : undefined;
    return {
      type: "link",
      url,
      domain: str(e.domain, 253) || url,
      title: str(e.title, 300) || url,
      ...(description ? { description } : {}),
      ...(image ? { image } : {}),
    };
  }
  if (e.type === "quote" && depth === 0) {
    const quote = projectCast(e.quote, 1);
    return quote ? { type: "quote", quote } : null;
  }
  return null;
}

/** the Cast field allowlist. A cast whose hash is not the network shape is dropped: the per-target write refusal
 *  (lib/fc/networkTarget.ts) identifies network casts by exactly that shape.
 *  FC-READ (future-dated casts): so is a cast dated more than FUTURE_SKEW_MS ahead of this server's clock. The real
 *  network carries some (a top-level cast dated 2061 was observed on 2026-09-27 from a well-known account), and the
 *  device's final feed order is by recency, so one such cast would sit at the top of the public discovery feed — under
 *  the Totem name, in either source — for decades; its age would render as negative. Dropped, not clamped: clamping
 *  to "now" would re-date it on every read and keep it on top. This applies to every op (discovery, a profile's casts,
 *  a thread's root, ancestors and replies, a quoted cast), because each renders a timestamp. */
function projectCast(m: Cast, depth = 0): RelayCast | null {
  const hash = typeof m.hash === "string" ? m.hash.toLowerCase() : "";
  if (!HASH40.test(hash)) return null;
  if (typeof m.timestamp === "number" && Number.isFinite(m.timestamp) && m.timestamp > Date.now() + FUTURE_SKEW_MS) return null;
  const author = projectUser(m.author);
  if (!author) return null;
  const parent = typeof m.parentHash === "string" && HASH40.test(m.parentHash.toLowerCase()) ? m.parentHash.toLowerCase() : undefined;
  const embeds = (Array.isArray(m.embeds) ? m.embeds : [])
    .slice(0, 4)
    .map((e) => projectEmbed(e, depth))
    .filter((e): e is Embed => e !== null);
  const replyingTo = typeof m.replyingTo === "string" ? m.replyingTo.slice(0, 64) : undefined;
  return {
    hash,
    author,
    text: str(m.text, 12_000),
    timestamp: typeof m.timestamp === "number" && Number.isFinite(m.timestamp) ? m.timestamp : Date.now(),
    replies: count(m.replies),
    likes: count(m.likes),
    recasts: count(m.recasts),
    embeds,
    ...(m.truncate ? { truncate: true } : {}),
    ...(replyingTo ? { replyingTo } : {}),
    ...(parent ? { parentHash: parent } : {}),
    live: true,
    network: true,
  };
}

function mapCasts(cfg: ArmedConfig, raw: unknown, scores: Map<number, number>): RelayCast[] {
  const out: RelayCast[] = [];
  for (const c of Array.isArray(raw) ? (raw as Raw[]) : []) {
    if (!castAdmitted(cfg, c, scores)) continue;
    const p = projectCast(mapCast(prefilterEmbeds(cfg, c, scores)));
    if (p) out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the op table

type Mapped = { found: true; value: unknown } | { found: false };

interface Spec {
  op: SpecOp;
  key: string;
  path: string;
  cost: number;
  /** user-casts only: the fid by_username resolved on THIS server (the one `fid` value the path check admits) */
  fid?: number;
  /** statuses that mean "no such thing" (negative-cached) rather than a failure */
  notFound: ReadonlySet<number>;
  map: (cfg: ArmedConfig, body: Raw) => Mapped;
}

const LOOKUP_NOT_FOUND: ReadonlySet<number> = new Set([400, 404]);
const NONE: ReadonlySet<number> = new Set();

/** FC-READ (no channels): discovery's answer, whichever source built the path. Both endpoints answer FeedResponse
 *  {casts, next:{cursor}}, the shape of the recorded fixtures/neynar/feed-following.json: every full author carries
 *  `score`. */
function mapDiscovery(cfg: ArmedConfig, body: Raw): Mapped {
  // FC-READ (no channels): `casts` is REQUIRED in FeedResponse. An answer without it is a shape this mapper cannot
  // read — an upstream failure (the shelf, or fc_read_upstream), never an empty discovery pinned for 24 h over a good
  // one.
  if (!Array.isArray(body.casts)) throw new Error("unreadable feed");
  const casts: Raw[] = body.casts;
  // FC-READ (no channels): top-level casts only. Whether filter_type=fids includes replies is unverified (the
  // following-feed recording has 0 in 25) and the endpoint has no with_replies switch, so a cast with a parent_hash is
  // dropped here. FC-READ (house): the same for the following feed, which has no with_replies switch either. Every
  // cast's author still lends its score to the quote check below.
  const top = casts.filter((c) => !!c && typeof c === "object" && c.parent_hash == null);
  return { found: true, value: mapCasts(cfg, top, collectScores(casts)) };
}

/** FC-READ (no channels): the ONE feed spec — the casts of the operator's chosen authors, not of any channel. No
 *  viewer_fid (it only adds viewer_context and one viewer's mutes), no cursor (one page per miss).
 *  FC-READ (house): two shapes, one per source, the same key, cost, page size and mapper:
 *    fids  -> /feed/?feed_type=filter&filter_type=fids&fids=<FC_READ_FIDS>&with_recasts=false&limit=25
 *    house -> /feed/following/?fid=<FC_READ_HOUSE_FID>&with_recasts=false&limit=25
 *  One key for both: the source is server env, fixed for the process's life (changing it is a restart). */
function discoverySpec(source: DiscoverySource): Spec {
  const common = { op: "discovery" as const, key: "discovery", cost: COST.discovery, notFound: NONE, map: mapDiscovery };
  if (source.kind === "house") {
    // FC-READ (house): the fid is a validated integer (FID_ITEM) from the server's env; nothing from a request reaches
    // this function (discovery takes no arg). The path check pins `fid` to the ARMED config's house fid, which
    // checked() is handed separately — the spec carries no fid of its own for the check to agree with.
    return { ...common, path: `${HOUSE_PATH}?fid=${source.fid}&with_recasts=false&limit=${FEED_LIMIT}` };
  }
  // the fids are validated integers (FID_ITEM), so the list needs no encoding: commas as Neynar's own example has them
  return { ...common, path: `/feed/?feed_type=filter&filter_type=fids&fids=${source.fids.join(",")}&with_recasts=false&limit=${FEED_LIMIT}` };
}

/**
 * FC-READ (review, key-custody-2): the defence-in-depth check on an upstream path, by NAME. The path must be the
 * op's own endpoint (never under /notifications or /feed/following); every parameter NAME must be one that endpoint
 * takes here, at most once; viewer_fid, cursor and provider are refused by name. The only VALUES read are the
 * server's own constants: `limit` must be the op's SERVER_LIMIT (a client limit can never ride along), and `fid` may
 * appear only on user-casts and only as the fid this server resolved. An argument's value (an fname, a hash) is never
 * matched, so "cursor", "following" or "notifications" are ordinary names. Exported for the unit harness only
 * (scripts/unit-fcread-relay.mjs, accept-fcread check 25, which asserts its refusals directly); nothing routes to it.
 * FC-READ (no channels): discovery's /feed/ path also has its PINNED_VALUES (feed_type=filter, filter_type=fids,
 * with_recasts=false), its REQUIRED_PARAMS (an absent feed_type would be the following feed), and a `fids` value that
 * must be the 1-100 plain-integer list shape — the operator's list, a server constant like `limit`.
 * FC-READ (house): `houseFid` is the configured FC_READ_HOUSE_FID: checked() passes the ARMED configuration's source
 * (cfg.source, or at arming the source just parsed from the env), never a value carried on the spec it checks — so
 * the pin is independent of the path being checked (review: house-pin-self-referential). With it, discovery's ONE
 * admissible path is HOUSE_PATH, exempt from the /feed/following refusal, with `fid` pinned to exactly that value;
 * without it, discovery's one path is /feed/ as above. A house fid never opens HOUSE_PATH for another op, never pins `fid` anywhere else, and every other shape under
 * /feed/following — no slash, a suffix, a doubled slash — stays refused.
 */
export function upstreamPathAllowed(op: SpecOp, path: string, resolvedFid?: number, houseFid?: number): boolean {
  const q = path.indexOf("?");
  const pathname = q < 0 ? path : path.slice(0, q);
  // FC-READ (house): a house fid that is not one plain positive integer is a bug in the caller — refuse outright
  if (houseFid !== undefined && !(Number.isSafeInteger(houseFid) && FID_ITEM.test(String(houseFid)))) return false;
  const houseRequest = op === "discovery" && houseFid !== undefined && pathname === HOUSE_PATH;
  if (!houseRequest && REFUSED_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  // FC-READ (house): in house mode discovery's path is HOUSE_PATH and nothing else (not /feed/, whose fids shape is
  // the other source's); every other op keeps its one OP_PATH whatever houseFid says
  const expected = op === "discovery" && houseFid !== undefined ? HOUSE_PATH : OP_PATH[op];
  if (expected !== pathname) return false;
  const allowed = UPSTREAM_PARAMS[pathname];
  if (!allowed) return false;
  const pinned = PINNED_VALUES[pathname] ?? {};
  const seen = new Set<string>();
  for (const [name, value] of new URLSearchParams(q < 0 ? "" : path.slice(q + 1))) {
    if (seen.has(name)) return false;
    seen.add(name);
    if (REFUSED_PARAMS.has(name) || !allowed.includes(name)) return false;
    if (name === "limit" && value !== String(SERVER_LIMIT[op])) return false;
    if (name === "fid") {
      // user-casts: the fid this server resolved; FC-READ (house): house discovery: the configured house fid. Nothing
      // else may carry an fid, and each pin is compared by VALUE, so a table bug that built another number fails here.
      const pin = op === "user-casts" ? resolvedFid : houseRequest ? houseFid : undefined;
      if (typeof pin !== "number" || value !== String(pin)) return false;
    }
    if (Object.prototype.hasOwnProperty.call(pinned, name) && value !== pinned[name]) return false;
    if (name === "fids" && (op !== "discovery" || !FIDS_VALUE.test(value))) return false;
  }
  for (const name of REQUIRED_PARAMS[pathname] ?? []) if (!seen.has(name)) return false;
  return true;
}

/** specs that passed the path check. serve() and attempt() refuse any other, so no upstream call — and no token or
 *  credit — can ever be spent on an unchecked path. */
const CHECKED = new WeakSet<Spec>();

/** run the path check when the spec is BUILT — before any token or budget is taken (key-custody-2: it used to run
 *  inside attempt(), after the miss had been charged). null = a bug in this table; the caller answers bad_op.
 *  FC-READ (house): `source` is the CONFIGURED discovery source; its house fid (if any) is the pin the check compares
 *  the path's `fid` against. Omitted, no house fid is admitted anywhere (fail closed: HOUSE_PATH is refused). */
function checked(spec: Spec, source?: DiscoverySource): Spec | null {
  const houseFid = source?.kind === "house" ? source.fid : undefined;
  if (!upstreamPathAllowed(spec.op, spec.path, spec.fid, houseFid)) return null;
  Object.freeze(spec);
  CHECKED.add(spec);
  return spec;
}

function threadSpec(hash: string): Spec {
  return {
    op: "thread",
    key: "thread:" + hash,
    // ONE call: the conversation carries the root cast, so the separate /cast lookup content.ts makes is not needed
    path:
      `/cast/conversation?identifier=${hash}&type=hash&reply_depth=2` +
      `&include_chronological_parent_casts=true&limit=${THREAD_LIMIT}`,
    cost: COST.thread,
    notFound: LOOKUP_NOT_FOUND,
    map: (cfg, body) => {
      const conv = body.conversation ?? {};
      const root = conv.cast;
      // both observed placements of the ancestors, as content.ts liveConversation reads them
      const ancestorsRaw: Raw[] = Array.isArray(conv.chronological_parent_casts)
        ? conv.chronological_parent_casts
        : Array.isArray(root?.chronological_parent_casts)
          ? root.chronological_parent_casts
          : [];
      const repliesRaw: Raw[] = Array.isArray(root?.direct_replies) ? root.direct_replies : [];
      const scores = collectScores([root, ...ancestorsRaw, ...repliesRaw].filter(Boolean));
      // a hidden or denied root is "not available here", exactly like a missing one
      if (!root || !castAdmitted(cfg, root, scores)) return { found: false };
      const cast = projectCast(mapCast(prefilterEmbeds(cfg, { ...root, direct_replies: undefined, chronological_parent_casts: undefined }, scores)));
      if (!cast) return { found: false };
      const value: RelayThread = { cast, ancestors: mapCasts(cfg, ancestorsRaw, scores), replies: mapCasts(cfg, repliesRaw, scores) };
      return { found: true, value };
    },
  };
}

function userSpec(fname: string): Spec {
  return {
    op: "user",
    key: "user:" + fname,
    path: `/user/by_username?username=${encodeURIComponent(fname)}`,
    cost: COST.user,
    notFound: LOOKUP_NOT_FOUND,
    map: (cfg, body) => {
      const u = body.user;
      if (!u || !admitted(cfg, u, new Map())) return { found: false };
      const user = projectUser(mapUser(u));
      return user ? { found: true, value: user } : { found: false };
    },
  };
}

function userCastsSpec(fname: string, fid: number): Spec {
  return {
    op: "user-casts",
    key: "user-casts:" + fname,
    // the fid is the SERVER's, resolved from the cached by_username answer — never the client's
    path: `/feed/user/casts?fid=${fid}&limit=${USER_CASTS_LIMIT}`,
    cost: COST["user-casts"],
    fid,
    notFound: LOOKUP_NOT_FOUND,
    map: (cfg, body) => {
      const casts = Array.isArray(body.casts) ? body.casts : [];
      return { found: true, value: mapCasts(cfg, casts, collectScores(casts)) };
    },
  };
}

/** NEYNAR AS A SWITCH (§42): a Neynar cast search for one normalised query. The query is the ONLY argument; the page size
 *  is the server's; the answer goes through the same floor, denylist and field allowlist as discovery. An empty result is
 *  an answer (cached like any), never "not found". Replies are kept: a search finds what was said, wherever. */
function searchCastsSpec(q: string): Spec {
  return {
    op: "search-casts",
    key: "search-casts:" + q,
    path: `/cast/search/?q=${encodeURIComponent(q)}&limit=${SEARCH_CASTS_LIMIT}`,
    cost: COST["search-casts"],
    notFound: NONE,
    map: (cfg, body) => {
      const casts = body?.result?.casts;
      // `result.casts` is REQUIRED in the documented answer: anything else is a shape this mapper cannot read
      if (!Array.isArray(casts)) throw new Error("unreadable search");
      return { found: true, value: mapCasts(cfg, casts, collectScores(casts)) };
    },
  };
}

/** NEYNAR AS A SWITCH (§42): a Neynar user search for one normalised query (users below the score floor never leave) */
function searchUsersSpec(q: string): Spec {
  return {
    op: "search-users",
    key: "search-users:" + q,
    path: `/user/search/?q=${encodeURIComponent(q)}&limit=${SEARCH_USERS_LIMIT}`,
    cost: COST["search-users"],
    notFound: NONE,
    map: (cfg, body) => {
      const users = body?.result?.users;
      if (!Array.isArray(users)) throw new Error("unreadable search");
      const out: User[] = [];
      for (const u of users as Raw[]) {
        if (!admitted(cfg, u, new Map())) continue;
        const p = projectUser(mapUser(u));
        if (p) out.push(p);
      }
      return { found: true, value: out };
    },
  };
}

// ------------------------------------------------------------------------------------------------ upstream

type Attempt =
  | { kind: "ok"; body: Raw }
  | { kind: "not_found" }
  | { kind: "retry" }
  | { kind: "fail"; keyRejected?: boolean };

/** one GET. Every outcome is a KIND — no message, no status text and no thrown error ever leaves this function. */
async function attempt(cfg: ArmedConfig, spec: Spec): Promise<Attempt> {
  // FC-READ (review, key-custody-2): the path check ran when the spec was built (checked()), before any token or
  // credit; this only refuses a spec that never went through it (unreachable: serve() refuses those first)
  if (!CHECKED.has(spec)) return { kind: "fail" };
  state().counters.upstreamCalls++;
  let res: Response;
  try {
    res = await fetch(cfg.base + spec.path, {
      method: "GET",
      headers: { "x-api-key": cfg.key, accept: "application/json" },
      cache: "no-store",
      redirect: "error", // a redirect would carry the key header to wherever it pointed
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return { kind: "retry" }; // network error or timeout — the message is dropped unread
  }
  const discard = async () => {
    try {
      await res.body?.cancel();
    } catch {
      /* nothing to report */
    }
  };
  if (res.status === 429 || res.status >= 500) {
    await discard();
    return { kind: "retry" };
  }
  if (spec.notFound.has(res.status)) {
    await discard();
    return { kind: "not_found" };
  }
  if (res.status === 401 || res.status === 403) {
    await discard();
    return { kind: "fail", keyRejected: true };
  }
  if (!res.ok) {
    await discard();
    return { kind: "fail" };
  }
  try {
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_UPSTREAM_BYTES) {
      await discard();
      return { kind: "fail" };
    }
    const text = await res.text();
    if (text.length > MAX_UPSTREAM_BYTES) return { kind: "fail" };
    const body = JSON.parse(text);
    return body && typeof body === "object" ? { kind: "ok", body: body as Raw } : { kind: "fail" };
  } catch {
    return { kind: "retry" };
  }
}

/** the stale shelf for a key: the pinned discovery answer past its fresh TTL but inside 24 h, served labelled
 *  stale. Lookups have no shelf (positiveGet drops them at their fresh TTL). */
function shelf(key: string, now: number): Outcome | null {
  const e = positiveGet(key, now);
  if (!e) return null;
  state().counters.stale++;
  return { kind: "value", value: e.value, stale: now >= e.freshUntil };
}

function countRefusal(r: Refusal, paused = false): Refusal {
  const c = state().counters;
  if (r.code === "fc_read_rate") c.rate++;
  else if (r.code === "fc_read_budget") c.budget++;
  else c.upstream++;
  if (paused) c.paused++;
  return r;
}

/** a refusal for this spec's key. Discovery: the shelf first. A lookup (privacy-safety-2): NEVER the shelf — the
 *  refusal is the same whether or not someone else read that handle or hash. */
function refuseFor(spec: Spec, r: Refusal, now: number, paused = false): Outcome {
  if (!LOOKUP_OPS.has(spec.op)) {
    const kept = shelf(spec.key, now);
    if (kept) {
      if (paused) state().counters.paused++;
      return kept;
    }
  }
  return countRefusal(r, paused);
}

/** the breaker's gate for a new miss: closed; open (refuse, no upstream call); or the ONE trial after a pause */
function breakerGate(now: number): "closed" | "open" | "trial" {
  const b = state().breaker;
  if (b.failures < BREAKER_THRESHOLD) return "closed";
  if (now < b.openUntil || b.trial) return "open";
  return "trial";
}

function noteUpstreamSuccess(): void {
  const b = state().breaker;
  b.failures = 0;
  b.openUntil = 0;
}

/** a failed miss: this key cools down for FAILURE_COOLDOWN_MS; the breaker counts it, and opens at the threshold */
function noteUpstreamFailure(key: string, t: number): void {
  const st = state();
  st.failedUntil.delete(key);
  st.failedUntil.set(key, t + FAILURE_COOLDOWN_MS);
  for (const [k, until] of st.failedUntil) {
    if (until > t && st.failedUntil.size <= MAX_COOLDOWNS) break;
    st.failedUntil.delete(k);
  }
  const b = st.breaker;
  b.failures++;
  if (b.failures >= BREAKER_THRESHOLD) {
    b.openUntil = t + BREAKER_OPEN_MS;
    // aggregate only: never a key, an argument or an address
    console.warn(`[fc-read] ${b.failures} upstream misses in a row failed; pausing upstream calls for ${BREAKER_OPEN_MS / S} s`);
  }
}

async function miss(cfg: ArmedConfig, spec: Spec, addr: string): Promise<Outcome> {
  const st = state();
  const now = Date.now();
  const lookup = LOOKUP_OPS.has(spec.op);

  // 1. PAUSES — no token, no credit, no upstream call: a rejected key, an open breaker, this key's failure cooldown
  if (now < st.keyRejectedUntil) return refuseFor(spec, { kind: "refused", code: "fc_read_upstream" }, now, true);
  const gate = breakerGate(now);
  if (gate === "open") return refuseFor(spec, { kind: "refused", code: "fc_read_upstream" }, now, true);
  const cooled = st.failedUntil.get(spec.key);
  if (cooled !== undefined) {
    if (now < cooled) return refuseFor(spec, { kind: "refused", code: "fc_read_upstream" }, now, true);
    st.failedUntil.delete(spec.key);
  }

  // 2. BUDGET — the day; for a lookup also the lookup reserve and this address's daily share
  rollDay(st, now);
  if (st.spent + spec.cost > cfg.daily) return refuseFor(spec, { kind: "refused", code: "fc_read_budget" }, now);
  let addrSpent = 0;
  if (lookup) {
    const caps = lookupCaps(cfg);
    if (st.lookupSpent + spec.cost > caps.reserve) return refuseFor(spec, { kind: "refused", code: "fc_read_budget" }, now);
    addrSpent = st.addressSpent.get(addr) ?? 0;
    if (addrSpent + spec.cost > caps.perAddress) {
      return refuseFor(spec, { kind: "refused", code: "fc_read_rate", retryAfterSeconds: secondsToUtcMidnight(now) }, now);
    }
  }

  // 3. TOKENS — the global miss bucket always; the address's bucket for a discovery miss (a lookup took its
  //    per-address token for the REQUEST, before the cache was consulted)
  const tokens = takeTokens(addr, now, !lookup, true);
  if (!tokens.ok) return refuseFor(spec, { kind: "refused", code: "fc_read_rate", retryAfterSeconds: tokens.retryAfterSeconds }, now);

  // 4. CHARGE, ONCE (review: it used to be per attempt, so a 429/5xx storm spent three times the day's rate on
  //    nothing). Everything from step 1 to here is synchronous: no other request can slip between a gate and its charge.
  st.spent += spec.cost;
  if (lookup) {
    st.lookupSpent += spec.cost;
    ledger(addr, addrSpent + spec.cost);
  }
  st.counters.misses++;
  if (gate === "trial") st.breaker.trial = true;

  try {
    for (let i = 0; i <= BACKOFF_MS.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, BACKOFF_MS[i - 1]));
      const a = await attempt(cfg, spec);
      const t = Date.now();
      if (a.kind === "ok") {
        let mapped: Mapped;
        try {
          mapped = spec.map(cfg, a.body);
        } catch {
          break; // a shape the mapper cannot read is an upstream failure (shelf or fc_read_upstream), never a 500
        }
        noteUpstreamSuccess();
        if (mapped.found) {
          putPositive(spec.key, { op: spec.op, value: mapped.value, storedAt: t, freshUntil: t + TTL_MS[spec.op] });
          return { kind: "value", value: mapped.value, stale: false };
        }
        // hidden by the floor or the denylist: negative-cached like a missing one, and never served from the shelf
        putNegative(spec.key, t + NEGATIVE_TTL_MS, t);
        st.counters.notFound++;
        return { kind: "not_found" };
      }
      if (a.kind === "not_found") {
        // a definitive "gone" outranks the stale shelf (content.ts's rule): the positive entry is replaced
        noteUpstreamSuccess();
        putNegative(spec.key, t + NEGATIVE_TTL_MS, t);
        st.counters.notFound++;
        return { kind: "not_found" };
      }
      if (a.kind === "fail") {
        if (a.keyRejected) {
          st.keyRejectedUntil = t + KEY_REJECTED_COOLDOWN_MS;
          console.warn("[fc-read] the upstream refused the read key; pausing upstream calls for 5 minutes");
        }
        break;
      }
    }
  } finally {
    if (gate === "trial") st.breaker.trial = false;
  }
  const t = Date.now();
  noteUpstreamFailure(spec.key, t);
  return refuseFor(spec, { kind: "refused", code: "fc_read_upstream" }, t);
}

/** a fresh cache answer for a key, or null: a held negative (not touched) or a fresh positive */
function freshHit(key: string, now: number): Outcome | null {
  const st = state();
  if (negativeHeld(key, now)) {
    st.counters.hits++;
    st.counters.notFound++;
    return { kind: "not_found" };
  }
  const e = positiveGet(key, now);
  if (e && now < e.freshUntil) {
    st.counters.hits++;
    return { kind: "value", value: e.value, stale: false };
  }
  return null;
}

/** a cache hit, or the one in-flight miss for this key (joiners pay nothing more: they caused no upstream call) */
async function serve(cfg: ArmedConfig, spec: Spec, addr: string): Promise<Outcome> {
  const st = state();
  if (!CHECKED.has(spec)) return countRefusal({ kind: "refused", code: "fc_read_upstream" }); // unreachable: fcRead checks every spec
  const hit = freshHit(spec.key, Date.now());
  if (hit) return hit;
  const running = st.inflight.get(spec.key);
  if (running) return running;
  const p = miss(cfg, spec, addr).finally(() => st.inflight.delete(spec.key));
  st.inflight.set(spec.key, p);
  return p;
}

// ------------------------------------------------------------------------------------------------ the entry point

function answerFor(outcome: Outcome): FcReadAnswer {
  if (outcome.kind === "value") {
    return { status: 200, body: { value: outcome.value, stale: outcome.stale, state: outcome.stale ? "stale" : "live" } };
  }
  if (outcome.kind === "not_found") return refusal(404, "not_found");
  if (outcome.code === "fc_read_rate") {
    const s = String(outcome.retryAfterSeconds ?? 60);
    return { ...refusal(429, "fc_read_rate"), headers: { "retry-after": s } };
  }
  return refusal(503, outcome.code);
}

export function refusal(status: number, code: FcReadCode): FcReadAnswer {
  return { status, body: { code, error: FC_READ_SENTENCES[code] } };
}

/** the state the status op reports — never a budget number */
function stateFor(cfg: RelayConfig): FcReadState {
  if (!cfg.armed) return cfg.reason === "off" ? "off" : "unarmed";
  const st = state();
  const now = Date.now();
  rollDay(st, now);
  // "budget" once not even the cheapest miss fits (so FC_READ_DAILY_CREDITS=1 reads as budget, not as live)
  if (st.spent + Math.min(...Object.values(COST)) > cfg.daily) return "budget";
  // FC-READ (review): an open failure breaker is "error" too — upstream is not being asked for the moment
  if (now < st.keyRejectedUntil || now < st.breaker.openUntil) return "error";
  return "live";
}

/** the relay's status for server-side callers (never the key, never a budget number): what the status op answers */
export function relayStatus(): { armed: boolean; reason: FcReadReason; state: FcReadState } {
  const cfg = relayConfig();
  noteArming(cfg);
  return { armed: cfg.armed, reason: cfg.armed ? "armed" : cfg.reason, state: stateFor(cfg) };
}

function maybeLogCounters(now: number): void {
  const st = state();
  if (now - st.countersSince < COUNTER_LOG_EVERY_MS) return;
  const c = st.counters;
  if (c.hits + c.misses + c.stale + c.notFound + c.rate + c.budget + c.upstream + c.paused + c.refused > 0) {
    rollDay(st, now);
    // aggregate counters only: never an op argument, never an address, never the key
    console.log(
      `[fc-read] last ${Math.round((now - st.countersSince) / 60000)} min: hits=${c.hits} misses=${c.misses} upstream_calls=${c.upstreamCalls} ` +
        `stale=${c.stale} not_found=${c.notFound} rate=${c.rate} budget=${c.budget} upstream_errors=${c.upstream} paused=${c.paused} ` +
        `refused=${c.refused} credits_today=${st.spent} lookup_credits_today=${st.lookupSpent}`
    );
  }
  st.counters = zeroCounters();
  st.countersSince = now;
}

/** the route counts its own refusals (bad op, cross-site) into the same aggregate line */
export function noteRefused(): void {
  state().counters.refused++;
}

type Parsed =
  | { op: "discovery" }
  | { op: "thread"; hash: string }
  | { op: "user" | "user-casts"; fname: string }
  | { op: "search-casts" | "search-users"; q: string };

/** the closed op table's argument rules. null = not an op this preview offers (400 bad_op). FC-READ (no channels):
 *  "channel" is not in it any more — channels are not a v1 emphasis — so it is bad_op like any unknown op, whatever
 *  its argument, armed or not, before any token, credit or upstream call. */
function parseOp(op: unknown, arg: unknown): Parsed | null {
  if (op === "discovery") return arg === undefined ? { op } : null;
  // NEYNAR AS A SWITCH (§42): one query string, normalised (NFKC, lower case, single spaces) so variants are one cache
  // key; 2 to 64 characters, no control characters. It is what the visitor typed; nothing else rides with it.
  if (op === "search-casts" || op === "search-users") {
    if (typeof arg !== "string" || arg.length > 256) return null;
    const q = normaliseSearchQuery(arg);
    return searchQueryAllowed(q) ? { op, q } : null;
  }
  if (op !== "thread" && op !== "user" && op !== "user-casts") return null;
  if (typeof arg !== "string" || arg.length > 80) return null;
  // canonical form (lowercase, trimmed) so case variants of one handle are one cache key, not N credit-costing misses
  const a = arg.trim().toLowerCase();
  if (op === "thread") return HASH40.test(a) ? { op, hash: a } : null;
  return FNAME.test(a) || ETH_NAME.test(a) ? { op, fname: a } : null;
}

function badOp(): FcReadAnswer {
  noteRefused();
  return refusal(400, "bad_op");
}

/** user-casts: the fid comes from the by_username answer (cached, or fetched now) — never from the client — and a
 *  hidden or missing user has no casts here. FC-READ (review, privacy-safety-2): a refused user lookup is answered
 *  with that refusal as it is — no shelf, for this key or any other. */
async function userCasts(cfg: ArmedConfig, fname: string, who: Spec, addr: string): Promise<Outcome> {
  const hit = freshHit("user-casts:" + fname, Date.now());
  if (hit) return hit;
  const u = await serve(cfg, who, addr);
  if (u.kind !== "value") return u; // not_found, or the lookup's own (already counted) refusal
  const fid = (u.value as User | null)?.fid;
  const spec = typeof fid === "number" && Number.isInteger(fid) && fid > 0 ? checked(userCastsSpec(fname, fid)) : null;
  if (!spec) return countRefusal({ kind: "refused", code: "fc_read_upstream" });
  return serve(cfg, spec, addr);
}

/** FC-READ (review, privacy-safety-2): an identifying lookup takes a per-address token on EVERY request — hit or
 *  miss — BEFORE the cache is consulted. Probing whether someone else read a handle or hash costs the prober a token
 *  each time, and once its bucket is empty the answer is the same 429 whether or not the key is cached. */
function lookupGate(addr: string): Refusal | null {
  const t = takeTokens(addr, Date.now(), true, false);
  if (t.ok) return null;
  return countRefusal({ kind: "refused", code: "fc_read_rate", retryAfterSeconds: t.retryAfterSeconds });
}

/**
 * Answer one relay request. `op`/`arg` are the body's two fields exactly as sent (the route has already refused any
 * other field, any query string, a missing x-layers-relay header and a cross-site request); `addressKey` is the
 * client address the middleware's limiter would use, already normalised by the route (an IPv6 /64, an IPv4, "unknown"
 * or "local" — FC-READ review, cost-abuse-3), and hashed with a per-process salt before anything stores it.
 */
export async function fcRead(op: unknown, arg: unknown, addressKey: string): Promise<FcReadAnswer> {
  maybeLogCounters(Date.now());
  const cfg = relayConfig();
  noteArming(cfg);

  if (op === "status") {
    if (arg !== undefined) return badOp();
    // FC-READ (no channels): armed, reason and state only — no channel list (there are no relayed channel tabs), and
    // never the discovery author list: the status op is public and carries no number (scripts/lib/neynar-stub.mjs
    // statusProblems). FC-READ (house): nor which source is armed, nor the house fid — the same three fields and the
    // same values in both modes, so a visitor cannot tell a house account exists, let alone find it from here.
    return { status: 200, body: { armed: cfg.armed, reason: cfg.armed ? "armed" : cfg.reason, state: stateFor(cfg) } };
  }

  // validated BEFORE the arming answer, so a malformed request reads the same whether the relay is armed or not
  const parsed = parseOp(op, arg);
  if (!parsed) return badOp();
  if (!cfg.armed) return refusal(503, cfg.reason === "off" ? "fc_read_off" : "fc_read_unarmed");
  // NEYNAR AS A SWITCH (§42): the op's surface must be switched to Neynar on THIS server. The device's hint is page-
  // settable and grants nothing: a tab that asks anyway gets this, with no token, no credit and no upstream call.
  if (!opSwitchedOn(parsed.op)) {
    noteRefused();
    return refusal(503, "fc_source_off");
  }

  // FC-READ (review, key-custody-2): every spec this request can reach upstream with is built and path-checked HERE,
  // before any token or credit is taken. A spec the check refuses is a bug in the table, answered bad_op at no cost.
  // (user-casts: the casts spec's path is checked now with a stand-in fid, and again with the resolved one.)
  const spec =
    parsed.op === "discovery"
      ? checked(discoverySpec(cfg.source), cfg.source) // FC-READ (house): the configured source's one shape, pinned to it
      : parsed.op === "thread"
        ? checked(threadSpec(parsed.hash))
        : "q" in parsed
          ? checked(parsed.op === "search-casts" ? searchCastsSpec(parsed.q) : searchUsersSpec(parsed.q)) // NEYNAR AS A SWITCH (§42)
          : checked(userSpec(parsed.fname));
  if (!spec) return badOp();
  if (parsed.op === "user-casts" && !checked(userCastsSpec(parsed.fname, 1))) return badOp();

  const addr = addressId(addressKey);
  if (parsed.op === "discovery") return answerFor(await serve(cfg, spec, addr));

  // the identifying lookups: a per-address token first, for every request (privacy-safety-2)
  const gate = lookupGate(addr);
  if (gate) return answerFor(gate);
  if (parsed.op === "user-casts") return answerFor(await userCasts(cfg, parsed.fname, spec, addr));
  return answerFor(await serve(cfg, spec, addr));
}

/** test/ops knob, never routed: drop the cache, the budget and the buckets (the process is otherwise the reset) */
export function resetFcReadRelay(): void {
  (globalThis as unknown as { __layersFcRead?: RelayState }).__layersFcRead = undefined;
}
