import "server-only";
// LIVE CONTENT from Neynar, mapped to the app's Cast/User shapes.
//
// Every field mapping here was checked against the recorded contract in
// notes/runbooks/NEYNAR-CONTRACT.md and against real responses in fixtures/neynar/, not
// against memory. The places the wire format disagrees with our types are
// the whole job of this file:
//
//   timestamp      ISO-8601 string, not epoch ms
//   display_name   nullable
//   pfp_url        nullable
//   reactions      an object, not a number
//   replies        an object, not a number
//   views          DOES NOT EXIST — see below
//   bio            nested at profile.bio.text
//
// Personas, grants and modes are OUR layer and stay seed+local. Neynar is
// content. The two compose: the persona layer renders over live content.
import type { Cast, Embed, User } from "@/lib/types";
// FC-READ (review): the relay-refusal sentences, shared with the islands that render them (a types-and-constants
// module with no runtime imports of its own — safe in the server, the device and a client component alike)
import { LIVE_PAUSED_SENTENCES } from "@/lib/views/social";

const BASE ="https://api.neynar.com/v2/farcaster";

export class NeynarError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "NeynarError";
  }
}

function apiKey(): string {
  const key = process.env.NEYNAR_API_KEY;
  if (!key) throw new NeynarError("NEYNAR_API_KEY is not set");
  return key;
}

// ---------------------------------------------------------------- mapping
//
// The mapping itself lives in ./contentPure.mjs — plain JS with no imports,
// so the Gate 4 suite can run the EXACT functions the app uses against
// recorded real responses. A test that re-implemented them would verify a
// copy, and the copy is what drifts.
export { mapUser, mapCast, mapEmbeds, mapChannel, CLAMP_CHARS } from "./contentPure.mjs";
import { mapCast, mapUser, mapChannel, CLAMP_CHARS } from "./contentPure.mjs";

// ---------------------------------------------------------------- fetching
//
// FC pass Gate 2 contract: a rate-limit hit degrades to CACHE, never to a
// blank feed — and the caller is told the content is stale rather than the
// staleness being laundered as fresh.
//
//   1. Fresh cache hit (< TTL) serves immediately.
//   2. Miss/expired: fetch with bounded backoff — 429, 5xx and network
//      errors retry (300ms/900ms); other 4xx throw immediately (a 404 is
//      an answer, not a hiccup).
//   3. Exhausted: if ANY cached value exists for the path — however old —
//      serve it with stale:true. Entries are never evicted, only
//      refreshed, precisely so this shelf exists. Nothing cached → throw.
//
// The forced-429 knob (devControls.forceNeynar429) is consumed per
// ATTEMPT, so arming 3+ forces a full backoff-then-degrade cycle — the
// degrade path is provable, not probable.
import { consumeForced429 } from "../devControls";

const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 60_000;
const BACKOFF_MS = [300, 900];

export interface LiveResult<T> {
  value: T;
  /** true when this came from the stale shelf after live attempts failed */
  stale: boolean;
}

async function get<T>(path: string): Promise<LiveResult<T>> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return { value: hit.value as T, stale: false };

  let lastErr: NeynarError | null = null;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]));
    try {
      if (consumeForced429()) throw new NeynarError("neynar rate limit (forced)", 429);
      const res = await fetch(BASE + path, {
        headers: { "x-api-key": apiKey(), accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 429) throw new NeynarError("neynar rate limit", 429);
      if (res.status >= 500) throw new NeynarError(`neynar ${res.status}`, res.status);
      if (!res.ok) {
        // Definitive answer, not transient — no retry, no stale masking.
        // And the stale shelf for this path is EVICTED: once the network
        // has said "gone" (404 on a deleted cast, etc.), a later transient
        // failure must not resurrect the pre-404 cached value as stale
        // content. Definitive answers outrank the shelf.
        cache.delete(path);
        throw Object.assign(new NeynarError(`neynar ${res.status}`, res.status), { definitive: true });
      }
      const value = (await res.json()) as T;
      cache.set(path, { at: Date.now(), value });
      return { value, stale: false };
    } catch (e) {
      if ((e as { definitive?: boolean }).definitive) throw e;
      lastErr =
        e instanceof NeynarError ? e : new NeynarError(`neynar unreachable: ${(e as Error).message}`);
    }
  }

  const stale = cache.get(path);
  if (stale) return { value: stale.value as T, stale: true };
  throw lastErr ?? new NeynarError("neynar unavailable");
}

export function clearNeynarCache() {
  cache.clear();
  // FC-READ: the device relay's tab cache and its pause are runtime-armed state too (the reset contract: whatever
  // can be armed at runtime, a reset disarms)
  relayCache.clear();
  relayPausedUntil = 0;
  relayPausedAs = null;
}

/** Test knob: age every entry past the fresh TTL WITHOUT dropping it —
 * the stale shelf stays stocked, which is exactly the state the
 * degrade-to-cache tests need to reach deterministically (a warm read
 * followed immediately by a forced 429 just hits the fresh window). */
export function expireNeynarCache() {
  for (const e of cache.values()) e.at = 0;
}

export async function liveFeed(fid: number, limit = 25): Promise<LiveResult<Cast[]>> {
  const r = await get<{ casts: any[] }>(
    `/feed/?feed_type=following&fid=${fid}&limit=${limit}&viewer_fid=${fid}`
  );
  return { value: (r.value.casts ?? []).map(mapCast), stale: r.stale };
}

export async function liveUserCasts(fid: number, limit = 25): Promise<LiveResult<Cast[]>> {
  const r = await get<{ casts: any[] }>(`/feed/user/casts?fid=${fid}&limit=${limit}`);
  return { value: (r.value.casts ?? []).map(mapCast), stale: r.stale };
}

export async function liveUsers(fids: number[]): Promise<LiveResult<User[]>> {
  if (!fids.length) return { value: [], stale: false };
  const r = await get<{ users: any[] }>(`/user/bulk?fids=${fids.join(",")}`);
  return { value: (r.value.users ?? []).map(mapUser), stale: r.stale };
}

export async function liveChannels(q: string, limit = 10) {
  const r = await get<{ channels: any[] }>(
    `/channel/search?q=${encodeURIComponent(q)}&limit=${limit}`
  );
  return {
    value: (r.value.channels ?? []).map(mapChannel),
    stale: r.stale,
  };
}

// ---- Gate 2 coverage additions. Shapes per notes/runbooks/NEYNAR-CONTRACT.md §Gate 2 ----

export async function liveCast(hash: string): Promise<LiveResult<Cast>> {
  const r = await get<{ cast: any }>(`/cast?identifier=${encodeURIComponent(hash)}&type=hash`);
  return { value: mapCast(r.value.cast), stale: r.stale };
}

/** Root cast + ancestors + direct replies. The contract flags the exact
 * placement of chronological_parent_casts as doc-ambiguous, so both
 * observed placements are read defensively. */
export async function liveConversation(
  hash: string,
  replyDepth = 2,
  limit = 20
): Promise<LiveResult<{ cast: Cast; ancestors: Cast[]; replies: Cast[] }>> {
  const r = await get<{ conversation: any }>(
    `/cast/conversation?identifier=${encodeURIComponent(hash)}&type=hash` +
      `&reply_depth=${replyDepth}&include_chronological_parent_casts=true&limit=${limit}`
  );
  const conv = r.value.conversation ?? {};
  const root = conv.cast ?? {};
  const ancestorsRaw = conv.chronological_parent_casts ?? r.value.conversation?.cast?.chronological_parent_casts ?? [];
  const repliesRaw = root.direct_replies ?? [];
  return {
    value: {
      cast: mapCast(root),
      ancestors: (ancestorsRaw as any[]).map(mapCast),
      replies: (repliesRaw as any[]).map(mapCast),
    },
    stale: r.stale,
  };
}

export interface LiveNotification {
  type: string;
  timestamp: number;
  seen: boolean;
  users: User[];
  cast: Cast | null;
}

export async function liveNotifications(fid: number, limit = 15): Promise<LiveResult<LiveNotification[]>> {
  const r = await get<{ notifications: any[] }>(`/notifications?fid=${fid}&limit=${limit}`);
  const mapped = (r.value.notifications ?? []).map((n: any): LiveNotification => {
    // actor extraction varies by type: follows carry follows[].user,
    // reaction types carry reactions[].user, mention/reply/quote carry
    // cast.author. All defensive — real notification payloads mix shapes.
    const users: User[] = [];
    for (const f of n.follows ?? []) if (f?.user) users.push(mapUser(f.user));
    for (const x of n.reactions ?? []) if (x?.user) users.push(mapUser(x.user));
    if (!users.length && n.cast?.author) users.push(mapUser(n.cast.author));
    return {
      type: String(n.type ?? "unknown"),
      timestamp: Date.parse(n.most_recent_timestamp ?? "") || Date.now(),
      seen: Boolean(n.seen),
      users,
      cast: n.cast ? mapCast(n.cast) : null,
    };
  });
  return { value: mapped, stale: r.stale };
}

// FC-READ (no channels): /feed/channels is still in Neynar's contract (spec v3.184.0: channel_ids max 10, limit max
// 100, members_only/should_moderate deprecated — notes/runbooks/NEYNAR-CONTRACT.md), so the rig's and the owner service's channel
// tabs keep reading it in liveMode. The PUBLIC preview has no channel tabs at all (D-FCREAD-NO-CHANNELS-IN-V1).
export async function liveChannelFeed(channelIds: string[], limit = 25): Promise<LiveResult<Cast[]>> {
  const r = await get<{ casts: any[] }>(
    `/feed/channels?channel_ids=${encodeURIComponent(channelIds.join(","))}&limit=${limit}&with_recasts=true`
  );
  return { value: (r.value.casts ?? []).map(mapCast), stale: r.stale };
}

/** FC-READ (no channels): the DIRECT transport's For You / Following / Explore / History base in liveMode — the
 *  viewer's following feed, the same read the mode-aware home already makes (lib/feed.ts buildFeed:
 *  liveFeed(NEYNAR_VIEWER_FID)). It replaced liveTrending, whose /feed/trending Neynar REMOVED from its contract in
 *  spec v3.183.0 (2026-08-07, with filter_type=global_trending; /feed/for_you went in v3.182.0): that call would have
 *  failed and fallen through to the fixture without a sound on a live owner service. Rig and owner service only:
 *  liveMode() needs NEYNAR_API_KEY and DATA_SOURCE=neynar, and a public deployment refuses both at boot (and
 *  NEYNAR_VIEWER_FID with them); the public preview's live reads go through the relay below, never here. */
export async function liveViewerFeed(limit = 25): Promise<LiveResult<Cast[]>> {
  return liveFeed(Number(process.env.NEYNAR_VIEWER_FID ?? "3"), limit);
}

export async function liveChannelList(limit = 10) {
  const r = await get<{ channels: any[] }>(`/channel/list?limit=${limit}`);
  return { value: (r.value.channels ?? []).map(mapChannel), stale: r.stale };
}

export async function liveUserByUsername(username: string): Promise<LiveResult<User | null>> {
  try {
    const r = await get<{ user: any }>(`/user/by_username?username=${encodeURIComponent(username)}`);
    return { value: r.value.user ? mapUser(r.value.user) : null, stale: r.stale };
  } catch (e) {
    if (e instanceof NeynarError && e.status === 404) return { value: null, stale: false };
    throw e;
  }
}

// ================================================================ FC-READ: the DEVICE transport (relay)
//
// Everything above is the DIRECT transport — the rig and the owner service, NEYNAR_API_KEY from their own env —
// and this pass leaves it exactly as it was. It never reads NEYNAR_READ_API_KEY: that key has ONE reader,
// lib/fc/readRelay.server.ts, imported only by app/api/fc/read. Were this file's server path able to see it, the
// public server's own getProfile (generateMetadata runs for any /<segment>) and getTrends (the rail, every page)
// would become unmetered live reads the moment anything flipped server-side liveMode — page renders are not
// rate-limited (middleware.ts).
//
// Below is what the BROWSER DEVICE uses on a public deployment (mode.ts contentSource() === "relay"). The device
// holds no key and never will — publicDeviceEnv is serialized into every page. It asks the app server's relay for
// one op from a closed table and gets back casts/users ALREADY mapped by contentPure through a field allowlist:
// never raw Neynar JSON, and nothing identifying goes the other way (no fid, viewer_fid, cursor or limit — the
// device's own fid is pseudoFid(anchor), a validator root, and forwarding it would join reads to that root).
//
//   * POST, JSON body {op, arg}: handles and hashes stay out of request paths, which the platform's HTTP logs record.
//   * x-layers-relay: 1 — a custom header forces a CORS preflight nobody approves, so another site cannot spend the
//     budget through its visitors' browsers; the route refuses its absence and Sec-Fetch-Site: cross-site.
//   * credentials: "omit" + referrerPolicy: "no-referrer": the relay needs no cookie and no page URL to answer.
//   * The UNPATCHED fetch (window.__layersOrigFetch, installed by public/device/boot.js): the device's own fetch
//     patch routes /api/* to the bundled handlers, and the relay must reach the SERVER whatever the SERVER_ONLY
//     lists say — a stale list would otherwise answer "the device serves no such route" from inside the tab.
//   * 503 / 429 / 400 / 404 are FINAL — no retry. 503 (off / budget / unarmed) and 429 are the server's decision;
//     retrying them only multiplies the load the refusal exists to shed. A kill switch cannot reach a bundle that
//     already loaded (the env is captured at import, lib/device/shims/process.ts), so the SERVER enforces off and
//     budget and this side obeys — pausing itself for a minute rather than re-asking on every island mount.
//     FC-READ (review): a 503 fc_read_upstream (the relay's provider did not answer) pauses too, for 30 s — an
//     outage is not this op's either, and every tab re-asking through it is what spends the relay's budget on
//     charged upstream rounds that come back empty.
//     Only a dropped connection or a bare 5xx gets ONE retry: that is a hiccup, not an answer.
//   * FC-READ (review): no LOOKUP (thread / user / user-casts) from a FRAMED document. Another site can frame a
//     preview page for its own visitors, and every random hash or name it puts in the frame's URL would be a miss
//     charged to the day's budget from that visitor's address — the header and Sec-Fetch-Site checks cannot see a
//     same-origin request made by a framed page. In a frame a lookup answers "paused here" with no request at all;
//     the identity-free discovery key stays (one shared, cached answer for every visitor).
//   * A small per-tab cache: fresh for minutes (the server's shared cache is the real one, and hits there are free),
//     404/400 negative-cached, and a bounded STALE SHELF — when the relay later refuses, content this tab already
//     holds is served labelled stale, never laundered as live (the Gate 2 rule, carried over).

// FC-READ (no channels): there is no "channel" op. The owner's v1 decision is that channels are not an emphasis, so the
// relay offers no per-channel live read and the device never asks for one — every channel tab stays seed/fixture.
// NEYNAR AS A SWITCH (§42): "search-casts" / "search-users", a public search query (lib/fc/source/switch.ts)
export type RelayOp = "discovery" | "thread" | "user" | "user-casts" | "search-casts" | "search-users";
/** the state vocabulary of the relay contract, as the feed routes report it (liveSource.state). NEYNAR AS A SWITCH (§42):
 *  "network" — the relay is armed, but the operator keeps this surface on Farcaster's network (FC_SOURCE_FORYOU), so no
 *  relay read is made; reported with source "seed", never thrown */
export type RelayState = "live" | "stale" | "filtered" | "off" | "budget" | "unarmed" | "error" | "network";
/** FC-READ (review): "filtered" is not a failure — it is a mode's decision, reported by buildFeed, never thrown */
export type RelayFailureState = Exclude<RelayState, "live" | "stale" | "filtered" | "network">;

/**
 * FC-READ — the machine-readable live status every feed surface carries (GET /api/feed2, GET /api/feed).
 *
 *   source "seed"  — this surface does not read through the relay at all (no relay on this deployment, the rig,
 *                    the Following surface, a followed-only mode, any channel tab, a later page).
 *                    FC-READ (no channels): a channel tab is never relayed in v1, so it always reports "seed".
 *                    state is then always "off" and the UI shows NOTHING: deploying with no key changes nothing.
 *   source "relay" — this surface reads through the relay. state "live": the network cards are current;
 *                    "stale": they came from a cached shelf; "off" | "budget" | "unarmed" | "error": the relay did
 *                    not answer, and the cards are PREVIEW content in its place — which the UI must say.
 *                    FC-READ (review) "filtered": the relay would serve this surface, but the active MODE hides
 *                    authors it cannot rate (an author.* hide rule — every network author is unattributed, so it
 *                    would hide every one), so the seeded cards stand in and the UI says why. No relay read is made.
 */
export interface LiveSource {
  source: "relay" | "seed";
  state: RelayState;
}

export function seedSource(): LiveSource {
  return { source: "seed", state: "off" };
}

// Fixed sentences only: a failure's own text is never echoed (on Node 24 a malformed key header throws a message
// that CONTAINS the key — the relay maps every failure to a code, and so does this side). None of these may carry
// a page-health needle word ("Couldn't load", "refusing to", "404", "Couldn't confirm", "Couldn't read").
// FC-READ (review): the sentences live in lib/views/social.ts (LIVE_PAUSED_SENTENCES) — the thread and profile islands
// match a read error against that same closed table to render the paused state instead of the load-error block, so
// the two sides share one source and cannot drift. A code with its own sentence wins; otherwise the state's.
const RELAY_SENTENCE: Record<RelayFailureState, string> = {
  off: LIVE_PAUSED_SENTENCES.off,
  budget: LIVE_PAUSED_SENTENCES.budget,
  unarmed: LIVE_PAUSED_SENTENCES.off,
  error: LIVE_PAUSED_SENTENCES.error,
};
const RELAY_CODE_SENTENCE: Readonly<Record<string, string>> = {
  fc_read_rate: LIVE_PAUSED_SENTENCES.rate,
  fc_read_upstream: LIVE_PAUSED_SENTENCES.upstream,
  fc_read_framed: LIVE_PAUSED_SENTENCES.framed,
  // NEYNAR AS A SWITCH (§42): the server keeps this op's surface on Farcaster's network
  fc_source_off: LIVE_PAUSED_SENTENCES.switchedOff,
};

export class RelayReadError extends Error {
  constructor(
    readonly state: RelayFailureState,
    /** the relay's code (fc_read_off, fc_read_budget, fc_read_unarmed, fc_read_rate, fc_read_upstream) or a
     *  device-side one (fc_read_framed, fc_read_unreachable, ...) — always fc_read_*, never upstream text */
    readonly code: string
  ) {
    super(Object.prototype.hasOwnProperty.call(RELAY_CODE_SENTENCE, code) ? RELAY_CODE_SENTENCE[code] : RELAY_SENTENCE[state]);
    this.name = "RelayReadError";
  }
}

/** the liveSource state a failed relay read reports */
export function relayStateOf(e: unknown): RelayFailureState {
  return e instanceof RelayReadError ? e.state : "error";
}

export interface RelayResult<T> {
  value: T;
  stale: boolean;
  state: "live" | "stale";
}

interface RelayEntry {
  at: number;
  ttl: number;
  value?: unknown;
  stale?: boolean;
  /** negative cache: the relay said "no such thing" (404) or "not an op it serves" (400) */
  missing?: true;
}

const relayCache = new Map<string, RelayEntry>();
const relayInflight = new Map<string, Promise<RelayResult<unknown> | null>>();
// TUNE: device-side freshness. Shorter than the relay's own TTLs (600-1800 s) on purpose — a re-ask that lands in
// the server's shared cache costs no credits, and it is how an open tab picks up the server's refresh.
const RELAY_FRESH_MS: Record<RelayOp, number> = {
  discovery: 120_000,
  thread: 300_000,
  user: 600_000,
  "user-casts": 300_000,
  "search-casts": 300_000,
  "search-users": 300_000,
};
const RELAY_MISSING_MS = 600_000;
const RELAY_SHELF_MS = 24 * 3_600_000; // the stale shelf's horizon (at most 24 h, always labelled stale)
const RELAY_MAX_ENTRIES = 200; // bounded: a visitor walking profiles must not grow the tab without limit
const RELAY_TIMEOUT_MS = 8_000;
const RELAY_PAUSE_MS = 60_000;
// FC-READ (review): a provider outage (503 fc_read_upstream) pauses this tab too — shorter, because an outage may
// clear in seconds, but long enough that a page of islands does not each re-ask through it
const RELAY_UPSTREAM_PAUSE_MS = 30_000;
let relayPausedUntil = 0;
let relayPausedAs: { state: RelayFailureState; code: string } | null = null;

/** FC-READ (review): pause this tab's relay reads; a longer pause already standing is never shortened by a later,
 *  shorter one (an in-flight read that lands after a budget pause must not cut it to 30 s) */
function pauseRelay(state: RelayFailureState, code: string, ms: number): void {
  const now = Date.now();
  const until = now + ms;
  if (relayPausedAs && now < relayPausedUntil && relayPausedUntil >= until) return;
  relayPausedUntil = until;
  relayPausedAs = { state, code };
}

/** FC-READ (review): the ops that name something (a hash, a handle) — misses a third party could choose */
const RELAY_LOOKUP_OPS: ReadonlySet<RelayOp> = new Set<RelayOp>(["thread", "user", "user-casts", "search-casts", "search-users"]);

/** FC-READ (review): is this document inside another document's frame? A cross-origin `top` is still comparable
 *  (only its contents are off limits); anything that throws is treated as framed — never as "top level, go ahead". */
function framedDocument(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

/** the relay's code, if it is one (fc_read_*); anything else is not echoed as a code */
function relayCode(v: unknown): string {
  return typeof v === "string" && /^fc_read_[a-z_]{1,32}$/.test(v) ? v : "";
}

function relayRemember(key: string, entry: RelayEntry): void {
  relayCache.delete(key); // re-insert: Map order is the LRU order
  relayCache.set(key, entry);
  while (relayCache.size > RELAY_MAX_ENTRIES) {
    const oldest = relayCache.keys().next().value;
    if (oldest === undefined) break;
    relayCache.delete(oldest);
  }
}

function networkFetch(): typeof fetch {
  const w = globalThis as unknown as { __layersOrigFetch?: typeof fetch };
  return w.__layersOrigFetch ?? fetch;
}

async function relayFetchOnce(op: RelayOp, arg: string | undefined): Promise<Response> {
  const timeout =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(RELAY_TIMEOUT_MS) : undefined;
  return networkFetch()("/api/fc/read", {
    method: "POST",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    headers: { "content-type": "application/json", "x-layers-relay": "1" },
    body: JSON.stringify(arg === undefined ? { op } : { op, arg }),
    signal: timeout,
  });
}

/**
 * One relay op, through the tab cache. Resolves null when the relay answered "no such thing" (404) or "not an op
 * I serve" (400) — both definitive, both negative-cached. THROWS RelayReadError when it did not answer and this tab
 * holds nothing to show instead; with something on the shelf it resolves that, marked stale.
 *
 * `shape` turns the relay's payload into the app's types (and refuses anything malformed); what is cached is the
 * SHAPED value, so a malformed payload is never shelved.
 */
async function relayRead<T>(op: RelayOp, arg: string | undefined, shape: (raw: unknown) => T | null): Promise<RelayResult<T> | null> {
  if (typeof window === "undefined") throw new RelayReadError("unarmed", "fc_read_server_side"); // never from a server
  // FC-READ (review, key-custody-1): a framed document makes no lookup — no request, no tab-cache consult. Not
  // "no such post" (that would be a lie about a post that may exist): the paused state, with its own sentence.
  if (RELAY_LOOKUP_OPS.has(op) && framedDocument()) throw new RelayReadError("unarmed", "fc_read_framed");
  const key = op + "\u0000" + (arg ?? "");
  const hit = relayCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    if (hit.missing) return null;
    return { value: hit.value as T, stale: !!hit.stale, state: hit.stale ? "stale" : "live" };
  }
  const pending = relayInflight.get(key);
  if (pending) return pending as Promise<RelayResult<T> | null>;
  const p = relayFetch(op, arg, key, shape).finally(() => relayInflight.delete(key));
  relayInflight.set(key, p);
  return p;
}

async function relayFetch<T>(
  op: RelayOp,
  arg: string | undefined,
  key: string,
  shape: (raw: unknown) => T | null
): Promise<RelayResult<T> | null> {
  const fromShelf = (): RelayResult<T> | null => {
    const s = relayCache.get(key);
    if (!s || s.missing || Date.now() - s.at > RELAY_SHELF_MS) return null;
    return { value: s.value as T, stale: true, state: "stale" };
  };
  if (relayPausedAs && Date.now() < relayPausedUntil) {
    const shelved = fromShelf();
    if (shelved) return shelved;
    throw new RelayReadError(relayPausedAs.state, relayPausedAs.code);
  }

  let failure: RelayReadError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
    let res: Response;
    try {
      res = await relayFetchOnce(op, arg);
    } catch {
      failure = new RelayReadError("error", "fc_read_unreachable");
      continue; // a dropped connection (or the timeout): one retry
    }
    const body = (await res.json().catch(() => null)) as { value?: unknown; stale?: unknown; state?: unknown; code?: unknown } | null;
    if (res.ok) {
      const value = body && "value" in body ? shape(body.value) : null;
      if (value === null) {
        failure = new RelayReadError("error", "fc_read_malformed"); // not an answer we can render — and never shelved
        break;
      }
      const stale = body?.stale === true || body?.state === "stale";
      relayRemember(key, { at: Date.now(), ttl: RELAY_FRESH_MS[op], value, stale });
      return { value, stale, state: stale ? "stale" : "live" };
    }
    const code = relayCode(body?.code) || (body?.code === "fc_source_off" ? "fc_source_off" : "");
    // NEYNAR AS A SWITCH (§42): the server keeps this op's surface on the network. Final, and it pauses NOTHING else: the
    // other surfaces may be switched to Neynar (a pause would stop them too)
    if (res.status === 503 && code === "fc_source_off") {
      failure = new RelayReadError("off", code);
      break;
    }
    if (res.status === 404 || res.status === 400) {
      relayRemember(key, { at: Date.now(), ttl: RELAY_MISSING_MS, missing: true });
      return null;
    }
    if (res.status === 503 || res.status === 429) {
      const state: RelayFailureState =
        code === "fc_read_off" ? "off" : code === "fc_read_budget" ? "budget" : code === "fc_read_unarmed" ? "unarmed" : "error";
      failure = new RelayReadError(state, code || (res.status === 429 ? "fc_read_rate" : "fc_read_unavailable"));
      // a switched-off, spent or unarmed relay is a DEPLOYMENT state, not this op's: stop asking for a minute. A 429
      // is per-visitor MISSES only (hits stay free), so it pauses nothing beyond this op, which it does by no retry.
      if (state !== "error") pauseRelay(state, failure.code, RELAY_PAUSE_MS);
      // FC-READ (review): the provider did not answer the relay — not this op's state either. Every island re-asking
      // through an outage costs the relay charged upstream rounds; this tab stops for 30 s and serves its shelf.
      else if (code === "fc_read_upstream") pauseRelay("error", "fc_read_upstream", RELAY_UPSTREAM_PAUSE_MS);
      break;
    }
    failure = new RelayReadError("error", "fc_read_" + res.status);
    if (res.status < 500) break; // any other 4xx (a cross-site refusal, say) is an answer too: final
    // a bare 5xx: one retry
  }
  const shelved = fromShelf();
  if (shelved) return shelved;
  throw failure ?? new RelayReadError("error", "fc_read_unavailable");
}

// ---- shaping: the relay's payload, re-checked field by field on THIS side ----
//
// The relay already maps through contentPure and a field allowlist; the device rebuilds every object from an
// allowlist of its own anyway, because what it renders must not depend on a second file staying right. Nothing a
// network cast carries may claim OUR layer (personaId, tier, private, anon, attributedTo, stakes, viewer state), and
// every URL must be http(s) — a Farcaster embed is any string its author chose, `javascript:` included.

const HASH40 = /^0x[0-9a-f]{40}$/;
const NETWORK_FALLBACK_PFP = mapUser({}).pfpUrl; // contentPure's self-contained placeholder
const finiteCount = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const plain = (v: unknown): string => (typeof v === "string" ? v : "");
const webUrl = (v: unknown): string | undefined => (typeof v === "string" && /^https?:\/\//i.test(v) ? v : undefined);

/** FC-READ: a relayed record is marked where it travels (`network: true`), so every later layer can tell it from ours */
export function isNetworkMarked(x: unknown): boolean {
  return !!x && typeof x === "object" && (x as { network?: unknown }).network === true;
}

function networkUser(u: unknown): User | null {
  if (!u || typeof u !== "object") return null;
  const r = u as Record<string, unknown>;
  const fid = typeof r.fid === "number" ? r.fid : NaN;
  const username = plain(r.username);
  if (!Number.isInteger(fid) || fid <= 0 || !username) return null;
  const pfp = plain(r.pfpUrl);
  const user: User = {
    fid,
    username,
    displayName: plain(r.displayName) || username,
    pfpUrl: webUrl(pfp) || pfp.startsWith("data:image/svg+xml,") ? pfp : NETWORK_FALLBACK_PFP, // (http(s) or svg) ? pfp : fallback
    bio: plain(r.bio),
    bannerUrl: webUrl(r.bannerUrl),
    followerCount: finiteCount(r.followerCount),
    followingCount: finiteCount(r.followingCount),
    verified: r.verified === true,
  };
  return Object.assign(user, { network: true as const });
}

function networkCast(x: unknown, quoted = false): Cast | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const hash = plain(r.hash);
  if (!HASH40.test(hash)) return null;
  const author = networkUser(r.author);
  if (!author) return null;
  const embeds: Embed[] = [];
  for (const e of quoted || !Array.isArray(r.embeds) ? [] : r.embeds) {
    if (!e || typeof e !== "object") continue;
    const em = e as Record<string, unknown>;
    if (em.type === "image") {
      const url = webUrl(em.url);
      if (url) embeds.push({ type: "image", url });
    } else if (em.type === "link") {
      const url = webUrl(em.url);
      if (url)
        embeds.push({
          type: "link",
          url,
          domain: plain(em.domain) || url,
          title: plain(em.title) || url,
          description: typeof em.description === "string" ? em.description : undefined,
          image: webUrl(em.image),
        });
    } else if (em.type === "quote") {
      const q = networkCast(em.quote, true); // one level, its own embeds stripped — contentPure's rule
      if (q) embeds.push({ type: "quote", quote: q });
    }
  }
  const body = plain(r.text);
  const parentHash = plain(r.parentHash);
  const cast: Cast = {
    hash,
    author,
    text: body,
    timestamp: typeof r.timestamp === "number" && Number.isFinite(r.timestamp) ? r.timestamp : Date.now(),
    replies: finiteCount(r.replies),
    likes: finiteCount(r.likes),
    recasts: finiteCount(r.recasts),
    views: undefined, // Farcaster has no impression metric (contentPure) — never a fabricated number
    embeds,
    truncate: body.length > CLAMP_CHARS,
    replyingTo: plain(r.replyingTo) || undefined,
    parentHash: HASH40.test(parentHash) ? parentHash : undefined,
    // provenance: lib/policy.ts attachPersonaLayer skips the phase-1 fid heuristic PER CAST on this tag — without
    // it a real account's small fid would be re-skinned as a fixture persona (and the roster asked about it)
    live: true,
  };
  return Object.assign(cast, { network: true as const });
}

function castList(raw: unknown): Cast[] | null {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { casts?: unknown }).casts)
      ? (raw as { casts: unknown[] }).casts
      : null;
  if (!list) return null;
  return list.map((c) => networkCast(c)).filter((c): c is Cast => c !== null);
}

export interface NetworkThread {
  cast: Cast;
  ancestors: Cast[];
  replies: Cast[];
}

function threadShape(raw: unknown): NetworkThread | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const cast = networkCast(r.cast);
  if (!cast) return null;
  return { cast, ancestors: castList(r.ancestors) ?? [], replies: castList(r.replies) ?? [] };
}

function userShape(raw: unknown): User | null {
  const inner = raw && typeof raw === "object" && "user" in raw ? (raw as { user: unknown }).user : raw;
  return networkUser(inner);
}

// ---- shape pre-checks: the device never asks the relay about something that cannot be a network record ----

/** an fname (the registry caps it at 16) or an ENS-style .eth name (dwr.eth, name.base.eth) — the relay's own rule
 *  (lib/fc/readRelay.server.ts parseOp), lowercase only: a mixed-case URL segment is not asked about at all */
export function isRelayHandleShape(handle: string): boolean {
  return (
    /^[a-z0-9][a-z0-9-]{0,15}$/.test(handle) ||
    /^(?=.{5,64}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.eth$/.test(handle)
  );
}

// FC-READ (no channels): isRelayChannelShape and relayChannel are gone with the "channel" op — channels are not a v1
// emphasis, so no channel id is ever sent to the relay and a channel tab makes no relay request at all.

// ---- the ops, as the data layer calls them ----

/** the shared, identity-free discovery base (feed2 discovery, classic For You and Explore all read this ONE key).
 *  FC-READ (no channels): WHAT discovery reads upstream is the relay's server-side choice (in v1 a server-held list
 *  of authors, not channels); the device sends no argument and gets the same cast list shape either way. Its casts
 *  carry no channel (networkCast's allowlist has none), and nothing here or downstream may assume one. */
export async function relayDiscovery(): Promise<RelayResult<Cast[]>> {
  const r = await relayRead("discovery", undefined, castList);
  if (!r) throw new RelayReadError("error", "fc_read_no_discovery"); // the base op cannot be "missing"
  return r;
}

/** null: no such cast on the network */
export function relayThread(hash: string): Promise<RelayResult<NetworkThread> | null> {
  return relayRead("thread", hash, threadShape);
}

/** null: no such account on the network */
export function relayUser(fname: string): Promise<RelayResult<User> | null> {
  return relayRead("user", fname, userShape);
}

/** by fname, never by fid — the relay resolves the fid from its own cached by_username answer */
export function relayUserCasts(fname: string): Promise<RelayResult<Cast[]> | null> {
  return relayRead("user-casts", fname, castList);
}

/** NEYNAR AS A SWITCH (§42): the users of a Neynar search answer, each rebuilt from this side's own allowlist */
function userList(raw: unknown): User[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((u) => networkUser(u)).filter((u): u is User => u !== null);
}

/** NEYNAR AS A SWITCH (§42): a Neynar cast search, through the relay. The argument is the visitor's query and nothing
 *  else (the caller has checked it names none of this visitor's own accounts: app/api/search/network/route.ts). THROWS
 *  RelayReadError when the relay did not answer; [] when nothing matched. */
export async function relaySearchCasts(q: string): Promise<RelayResult<Cast[]>> {
  const r = await relayRead("search-casts", q, castList);
  if (!r) throw new RelayReadError("error", "fc_read_search_refused"); // 400/404: a query the relay would not take
  return r;
}

/** NEYNAR AS A SWITCH (§42): a Neynar user search, through the relay (as relaySearchCasts) */
export async function relaySearchUsers(q: string): Promise<RelayResult<User[]>> {
  const r = await relayRead("search-users", q, userList);
  if (!r) throw new RelayReadError("error", "fc_read_search_refused");
  return r;
}
