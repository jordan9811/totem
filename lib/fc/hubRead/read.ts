import "server-only";
// FOLLOWING FROM THE HUB — the signed-in root's real Farcaster graph, read by THE BROWSER DEVICE straight from a
// Snapchain node, with no Neynar and nothing passing through Totem's servers. Four reads, all plain GETs (no custom
// header, no cookie, no referrer, so the browser never preflights and the node's `Access-Control-Allow-Origin: *`
// answers them):
//   GET /v1/linksByFid?fid=<root>&link_type=follow   who the root follows (paged, 1,000 a page)
//   GET /v1/castsByFid?fid=<f>&reverse=true          an account's casts, newest first (paged)
//   GET /v1/userDataByFid?fid=<f>                    an account's profile (name, display name, picture, bio)
//   GET /v1/castById / /v1/castsByParent             a thread: the cast, the posts it replies to, its replies
//   GET /v1/reactionsByFid?fid=<root>                the root's own newest likes and recasts (POST AS YOU on hub cards:
//                                                    which cards show pressed; one page of 200 per kind, cached 10 min)
//   (NOTIFICATIONS FROM FARCASTER, lib/fc/hubRead/notifications.ts, reads through __hubCore at the end of this file:
//    linksByTargetFid, castsByMention, castsByFid, castsByParent and reactionsByCast, each naming the root only)
//
// MEASURED FIRST (the public node https://snap.farcaster.xyz:3381, read-only, 2026-11-05, from one address; the
// numbers are SECURITY-POSTURE.md §36's and docs/technical/data-flows.md's):
//   * a root following 111 accounts: 223 requests (links 1, casts 111, profiles 111), 1.3 MB, 1.4 s at 8 in flight,
//     the first 20 casts in 0.33 s; p50 34 ms, p99 178 ms.
//   * a root following 965: 1,933 requests, 11.5 MB, 9.5 s at 8 in flight (2.6 s at 32), the first 20 casts in 1.1 s
//     (0.43 s at 32); p50 32 ms, p90 42 ms, p99 108 ms. The newest 50 casts across the graph spanned 2.9 h, 200 spanned
//     17.8 h; 57 of the 965 had posted in the last day.
//   * no 429 in about 4,100 requests, including 1,933 in 2.6 s (~730 a second). linksByFid and castsByFid honour a
//     pageSize of 5,000; the node speaks HTTP/2 (one connection, many requests). An OPTIONS preflight answers 404.
//   * the node holds casts dated decades ahead (fid 347's "time traveling" cast, dated 2066): they would sit on top of
//     any timeline sorted by its own timestamps forever.
// THE DESIGN THOSE LED TO:
//   * at most CONCURRENCY (8) requests in flight from a tab, with two lanes (what the visitor is looking at first: the
//     follows, the root's own casts, profiles, threads; then the bulk of casts), never an unbounded fan-out;
//   * a FAN-OUT CAP: the timeline reads the root and the 1,000 accounts it followed most recently (the follow list is
//     read to 10,000); beyond that the page says how many it reads;
//   * profiles only for what is on screen (the authors, the accounts a reply answers and a cast mentions), not for every
//     follow: about 1,030 requests for the 965-account root instead of 1,933;
//   * PROGRESSIVE: the device answers a snapshot of what is in (and keeps reading in the background); the island asks
//     again while it is filling. What it shows is in true reverse-chronological order down to a HORIZON: every account
//     contributes its newest 10 casts, and nothing older than the newest "oldest cast read" of any account with more is
//     shown until that account's next page is read ("Show older posts" pages the accounts at the horizon). So a prolific
//     account can never hide a quieter account's newer post, and an older post never jumps above a newer unread one.
//     The accounts at the horizon are paged while the rest still loads (a bounded allowance), and while it fills what is
//     on screen stays there (newer posts slot in above; nothing blinks out). The designed engine, measured the same way
//     on the real node (read-only, 2026-11-05): 965 follows → 1,096 requests, 9 posts after 0.5 s, 50 after 0.8 s, all
//     read in 5.0 s; 110 follows → 171 requests, 50 posts after 0.5 s, all read in 1.0 s; 1,854 follows (capped at
//     1,000) → 1,101 requests, all read in 5.3 s; every answer 200, none 429;
//   * casts dated more than 10 minutes ahead are left out of the order (and counted);
//   * a CACHE in the device (tab memory only: a reload re-reads; nothing about the root's graph is written to disk) and
//     an INCREMENTAL refresh: each account is re-checked on its own clock (an account that posted ten minutes ago is due
//     again in a minute, one quiet for a day in four hours, never more than six), reading only its newest page;
//   * a 429 pauses EVERY read from the tab for the node's Retry-After (10 s without one, 60 s at most), says so on the
//     page, and does not spend the retries; a dropped connection, a timeout (8 s) or a 5xx is retried twice (300, 900 ms);
//   * NEVER FAIL OPEN: a follows read that failed is an error with Retry, never "you follow nobody"; accounts whose posts
//     could not be read are counted on the page; a profile that could not be read shows the account's number and is
//     counted; "You don't follow anyone" and "No posts yet" are said only after reads that SUCCEEDED.
//
// WHICH SOURCE WINS (the read relay, lib/fc/readRelay.server.ts + POST /api/fc/read, is untouched):
//   * Following, for a signed-in root on the live site: THIS, the hub, always, whether or not a Neynar read key is set.
//     The relay has no following op by design: it would have to hand the root's fid to Totem's app server.
//   * For You, for a signed-in root acting as itself on the live site: the hub (SPEC B, lib/fc/hubRead/forYou.ts), whether
//     or not a Neynar read key is set, for the same reasons as Following. The relay stays For You's source for everyone
//     else (a persona acting, no Farcaster sign-in): its discovery op names no visitor's fid. It is never the root's
//     fallback when a hub read fails: that failure is said, with Retry.
//   * A thread or profile opened FROM a hub card: the hub (/fc/cast, /fc/profile). One opened from a relay card: the
//     relay, as before.
//
// WHO SEES WHAT (SECURITY-POSTURE.md §36): the node's operator sees this browser's internet address, its Origin header
// (the Totem page's origin), the time, and every fid and cast it reads: the root's own fid first. Totem's app server and
// validator learn nothing new: no read passes through them, and the pages these reads open carry the fid and hash in
// the URL FRAGMENT, which a browser never sends (lib/fc/hubRead/copy.ts hubCastHref).
//
// WHERE IT RUNS: the browser device only (app/api/fc/hub/route.ts answers any server 404 device_only before reading the
// body). Nothing here reads a key or the vault beyond the Sign in with Farcaster link (the root's fid) and, for the
// separation below, which fids are this visitor's own personas and whether a persona is acting.
//
// PERSONA SEPARATION (2026-11-05 review, SECURITY-POSTURE.md §36 A-HUBREAD-PERSONA-SEPARATION). The node ties this
// browser's address to the root (it reads the root's follows first), so two things would hand it a persona:
//   1. a read that NAMES one of the visitor's own personas (its casts, profile, a cast by it, the replies to one): "the
//      root's browser checked @persona's post seconds after it went up". Every read passes hubGet, which refuses any
//      path naming an own fid (fail closed: no own-set loaded = no read); the callers skip those fids, show the
//      persona's own name from the vault record, and the thread and profile pages refuse with own_persona.
//   2. reads while a persona is acting: the node would see the root's browser active at the moment the persona posts
//      through Totem's server. Every op refuses acting_persona while the device's acting persona is set.
import type { Cast, Embed, User } from "@/lib/types";
import { hubReadUrlRule } from "@/lib/fc/rootSigner/config";
import { mapUser } from "@/lib/adapters/neynar/contentPure.mjs";
import {
  HUB_READ_SENTENCES,
  ANCESTORS_FAILED_SENTENCE,
  ANCESTOR_MISSING_SENTENCE,
  ANCESTOR_OWN_SENTENCE,
  QUOTE_OWN_TITLE,
  PROFILE_CASTS_FAILED_SENTENCE,
  REPLIES_FAILED_SENTENCE,
  REACTED_FAILED_SENTENCE,
  olderPartialSentence,
  partialSentence,
  pausedSentence,
  profilesFailedSentence,
  type HubAccountView,
  type HubCountView,
  type HubPeopleView,
  type HubProfileView,
  type HubReactedView,
  type HubReadCode,
  type HubThreadView,
  type HubTimelineView,
  type HubModeView,
} from "./copy";
import { HUB_MODE_ERROR_SENTENCE, hubCastHref, hubEmbedIsImage, isHubReadingPiece, type HubCardView, type HubExtrasView } from "./copy";
import { modeHides, shapeForMode, type HubModeSpec } from "./mode";
import { shapeExtras, type HubExtrasSpec } from "./extras";

/** every number the design above names, in one place (the unit suite reads them) */
export const HUB_READ_LIMITS = Object.freeze({
  concurrency: 8,
  followsPage: 1000,
  maxFollowsRead: 10_000,
  maxTimelineAccounts: 1000,
  firstPage: 10,
  morePage: 25,
  timeoutMs: 8000,
  backoffMs: [300, 900] as readonly number[],
  maxRateRetries: 3,
  defaultPauseMs: 10_000,
  maxPauseMs: 60_000,
  futureSkewMs: 600_000,
  followsFreshMs: 600_000,
  profileFreshMs: 3_600_000,
  autoRefreshFloorMs: 30_000,
  manualRefreshFloorMs: 60_000,
  minRecheckMs: 60_000,
  maxRecheckMs: 6 * 3_600_000,
  extendBudget: 40,
  earlyExtendBudget: 120,
  defaultWant: 50,
  maxWant: 500,
  quoteBudget: 30,
  maxAncestors: 8,
  repliesPage: 50,
  profileCasts: 25,
  peoplePage: 50,
  maxProfiles: 5000,
  waitCapMs: 5000,
  // POST AS YOU ON HUB CARDS: the root's newest reactions, ONE page per kind (measured read-only on the public node,
  // 2026-11-05: 200 reactions are about 110 KB and spanned 6 weeks to 14 months for fids 2, 3 and 194), re-read after 10 min
  reactionsPage: 200,
  reactionsFreshMs: 600_000,
});
const L = HUB_READ_LIMITS;
const FC_EPOCH = 1_609_459_200_000;
const HASH_RE = /^0x[0-9a-f]{40}$/;

// ------------------------------------------------------------------------------------------------- errors
const STATUS: Record<HubReadCode, number> = {
  device_only: 404,
  not_signed_in: 409,
  disconnected_account: 409,
  vault: 503,
  bad_config: 503,
  follows_unreadable: 503,
  casts_unreadable: 503,
  cast_unreadable: 503,
  not_found: 404,
  profile_unreadable: 503,
  bad_request: 400,
  own_persona: 403,
  acting_persona: 409,
  notifications_unreadable: 503,
  seen_unsaved: 503,
  foryou_unreadable: 503,
};
export class HubReadError extends Error {
  code: HubReadCode;
  status: number;
  retryable: boolean;
  constructor(code: HubReadCode) {
    super(HUB_READ_SENTENCES[code]);
    this.name = "HubReadError";
    this.code = code;
    this.status = STATUS[code];
    this.retryable = ["vault", "follows_unreadable", "casts_unreadable", "cast_unreadable", "profile_unreadable", "notifications_unreadable", "seen_unsaved", "foryou_unreadable"].includes(code);
  }
}
/** a read that did not get an answer (never shown as such: each caller maps it to its own fixed sentence) */
class HubFail extends Error {
  constructor(readonly why: "unreachable" | "status" | "malformed" | "rate" | "own") {
    super("hub read failed: " + why);
    this.name = "HubFail";
  }
}

// ------------------------------------------------------------------------------------------------- the runtime seam
interface HubAccount {
  fid: number;
  fname: string | null;
  /** what the sign-in already knows of the root's profile: shown on its own posts until the node's profile is read */
  displayName?: string | null;
  pfpUrl?: string | null;
}
export interface HubReadRuntime {
  device: boolean;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => number;
  /** the signed-in root (Sign in with Farcaster), null when there is none; THROWS a HubReadError when unreadable */
  account: () => Promise<HubAccount | null>;
  /** PERSONA SEPARATION: this visitor's own accounts that are NOT the root (personas, the anon account when known):
   *  never named in a read. THROWS a HubReadError when unreadable (no read is made: fail closed) */
  own: () => Promise<OwnAccounts>;
  /** PERSONA SEPARATION: true while a persona (not the root) is this tab's acting identity; an unreadable answer is true */
  acting: () => Promise<boolean>;
  /** SPEC A: the root's active mode as this device holds it (lib/fc/hubRead/modeSource.ts); THROWS when it cannot be
   *  read or applied (the page then shows nothing under it). null only in the node harness: no mode applied */
  mode: () => Promise<HubModeSpec | null>;
  /** SPEC B (For You from the hub): the vault key the keyed half is derived from (lib/fc/hubRead/forYou.ts). Absent = the
   *  device's own vault key (lib/identity/keystore.ts); the node harness injects one. THROWS when it cannot be read. */
  halfKey?: () => Promise<Uint8Array>;
  /** SPEC C: the device's own records the extras are drawn from (lib/fc/hubRead/extrasSource.ts), for the active mode's
   *  id. null only in the node harness: no extras looked at (the page renders `items`, as before) */
  extras: (modeId: string | null) => Promise<HubExtrasSpec | null>;
}
interface OwnAccounts {
  fids: Set<number>;
  /** the fname each own persona's vault record holds (shown instead of a profile read) */
  names: Map<number, string | null>;
}
const gr = globalThis as unknown as { __layersHubReadRuntime?: HubReadRuntime | null; __layersHubOwn?: OwnAccounts | null };
// the device's answers (lib/fc/hubRead/separation.ts); every throw is a refusal
async function ownAccounts(): Promise<OwnAccounts> {
  try {
    return await (await import("@/lib/fc/hubRead/separation")).ownPersonaAccounts();
  } catch {
    throw new HubReadError("vault");
  }
}
async function actingPersona(): Promise<boolean> {
  try {
    return await (await import("@/lib/fc/hubRead/separation")).personaActing();
  } catch {
    return true; // unknown: read nothing (fail closed)
  }
}
async function activeMode(): Promise<HubModeSpec | null> {
  return (await import("@/lib/fc/hubRead/modeSource")).hubModeSpec();
}
async function activeExtras(modeId: string | null): Promise<HubExtrasSpec | null> {
  return (await import("@/lib/fc/hubRead/extrasSource")).hubExtrasSpec(modeId);
}
async function linkedAccount(): Promise<HubAccount | null> {
  let link;
  try {
    const { mainLink } = await import("@/lib/fc/siwf/links");
    link = await mainLink();
  } catch {
    throw new HubReadError("vault");
  }
  if (!link) return null;
  if (link.disconnectedAt !== null) throw new HubReadError("disconnected_account");
  return { fid: link.fid, fname: link.fname, displayName: link.displayName, pfpUrl: link.pfpUrl };
}
function runtime(): HubReadRuntime {
  if (gr.__layersHubReadRuntime) return gr.__layersHubReadRuntime;
  const device = typeof window !== "undefined";
  const w = globalThis as unknown as { __layersOrigFetch?: typeof fetch };
  // the UNPATCHED fetch in the device: the patch answers /api/* in the tab; the node is another origin
  return { device, env: process.env, fetch: (device && w.__layersOrigFetch) || fetch, now: () => Date.now(), account: linkedAccount, own: ownAccounts, acting: actingPersona, mode: activeMode, extras: activeExtras };
}
/** NODE HARNESS ONLY (scripts/unit-hub-read.mjs): run as a device with an injected network, env, clock and account
 *  (own personas default to none and no persona acting; a check of the separation injects both) */
export function __setHubReadRuntimeForTests(r: Partial<HubReadRuntime> | null): void {
  if (typeof window !== "undefined") throw new Error("__setHubReadRuntimeForTests is a node-harness seam");
  gr.__layersHubReadRuntime = r
    ? {
        device: true,
        env: process.env,
        fetch,
        now: () => Date.now(),
        ...r,
        account: r.account ?? linkedAccount,
        own: r.own ?? (async () => ({ fids: new Set<number>(), names: new Map<number, string | null>() })),
        acting: r.acting ?? (async () => false),
        mode: r.mode ?? (async () => null),
        extras: r.extras ?? (async () => null),
      }
    : null;
}
function gate(): HubReadRuntime {
  const rt = runtime();
  if (!rt.device) throw new HubReadError("device_only");
  return rt;
}
/** PERSONA SEPARATION, at the top of every op: nothing while a persona acts; the own set re-loaded for hubGet (replaced
 *  only by a good load, so reads already in flight keep the last good set; a failed load clears it: nothing is read) */
async function admit(rt: HubReadRuntime): Promise<void> {
  if (await rt.acting()) {
    gr.__layersHubOwn = null;
    throw new HubReadError("acting_persona");
  }
  try {
    gr.__layersHubOwn = await rt.own();
  } catch (e) {
    gr.__layersHubOwn = null;
    throw e instanceof HubReadError ? e : new HubReadError("vault");
  }
}
/** one of this visitor's own non-root accounts (no set loaded = every fid is treated as own: nothing is read) */
const isOwn = (fid: number): boolean => {
  const o = gr.__layersHubOwn;
  return !o || o.fids.has(fid);
};
/** the node THIS TAB reads: the same one post-as-you checks its key on (lib/fc/rootSigner/config.ts) */
function hubBase(rt: HubReadRuntime): string {
  if ((rt.env.FC_ROOT_POST ?? "").trim() === "bad_config") throw new HubReadError("bad_config");
  const r = hubReadUrlRule(rt.env.FC_ROOT_HUB_URL, false);
  if (!r.ok) throw new HubReadError("bad_config");
  return r.url;
}

// ------------------------------------------------------------------------------------------------- the network
interface Net {
  busy: number;
  hi: Array<() => void>;
  lo: Array<() => void>;
  pausedUntil: number;
  requests: number;
}
const gn = globalThis as unknown as { __layersHubNet?: Net };
const net = (): Net => (gn.__layersHubNet ??= { busy: 0, hi: [], lo: [], pausedUntil: 0, requests: 0 });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
type Lane = "hi" | "lo";
async function acquire(lane: Lane): Promise<void> {
  const n = net();
  while (n.busy >= L.concurrency) await new Promise<void>((r) => (lane === "hi" ? n.hi : n.lo).push(r));
  n.busy++;
}
function release(): void {
  const n = net();
  n.busy--;
  const w = n.hi.shift() ?? n.lo.shift();
  if (w) w();
}
function retryAfterMs(v: string | null, now: number): number {
  if (!v) return L.defaultPauseMs;
  const s = Number(v);
  const ms = Number.isFinite(s) ? s * 1000 : Date.parse(v) - now;
  if (!Number.isFinite(ms)) return L.defaultPauseMs;
  return Math.min(L.maxPauseMs, Math.max(1000, ms));
}
type Answer = { kind: "ok"; json: Record<string, unknown> } | { kind: "not_found" };
/**
 * One GET to the node, through the tab's concurrency limit. ok | not_found (the node's own 400 NotFound for a cast);
 * THROWS HubFail when there is no answer. A 429 pauses every read from this tab (the node's Retry-After) and is retried
 * without spending the ordinary retries; a dropped connection, a timeout or a 5xx is retried twice; any other status
 * is final.
 */
/** PERSONA SEPARATION, the last word before any read leaves the tab: a path naming an own fid, or any read while a
 *  persona acts (a read queued before a switch included), never goes. Every parameter that names an account counts:
 *  `fid=`, and `target_fid=` (NOTIFICATIONS FROM FARCASTER: linksByTargetFid, reactionsByCast) */
async function separated(rt: HubReadRuntime, path: string): Promise<void> {
  if (await rt.acting()) throw new HubFail("own");
  for (const m of path.matchAll(/[?&](?:target_)?fid=(\d+)/g)) if (isOwn(Number(m[1]))) throw new HubFail("own");
}
async function hubGet(rt: HubReadRuntime, path: string, lane: Lane): Promise<Answer> {
  const base = hubBase(rt);
  await separated(rt, path);
  await acquire(lane);
  try {
    let attempt = 0;
    let rate = 0;
    for (;;) {
      const n = net();
      while (Date.now() < n.pausedUntil) await sleep(n.pausedUntil - Date.now());
      await separated(rt, path);
      n.requests++;
      let res: Response | null = null;
      try {
        const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(L.timeoutMs) : undefined;
        res = await rt.fetch(base + path, { method: "GET", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal });
      } catch {
        res = null;
      }
      if (res && res.status === 429) {
        await res.text().catch(() => "");
        n.pausedUntil = Math.max(n.pausedUntil, Date.now() + retryAfterMs(res.headers.get("retry-after"), Date.now()));
        if (++rate > L.maxRateRetries) throw new HubFail("rate");
        continue;
      }
      let text: string | null = null;
      if (res) text = await res.text().catch(() => null);
      if (res && text !== null) {
        if (res.status === 200) {
          try {
            const j = JSON.parse(text) as unknown;
            if (j && typeof j === "object") return { kind: "ok", json: j as Record<string, unknown> };
          } catch {
            /* not JSON: a hiccup, retried below */
          }
        } else if (res.status === 400 && /notfound|not found/i.test(text)) return { kind: "not_found" };
        else if (res.status < 500) throw new HubFail("status");
      }
      if (attempt >= L.backoffMs.length) throw new HubFail(res ? "malformed" : "unreachable");
      await sleep(L.backoffMs[attempt]);
      attempt++;
    }
  } finally {
    release();
  }
}

// ------------------------------------------------------------------------------------------------- shapes
interface Rec {
  hash: string;
  fid: number;
  /** epoch ms (the node's Farcaster seconds) */
  ts: number;
  text: string;
  parent: { fid: number; hash: string } | null;
  embeds: Array<{ url: string } | { castId: { fid: number; hash: string } }>;
  mentions: number[];
  positions: number[];
}
interface Profile {
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  bio: string | null;
}
const isFid = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const castIdOf = (v: unknown): { fid: number; hash: string } | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const h = typeof o.hash === "string" ? o.hash.toLowerCase() : "";
  return isFid(o.fid) && HASH_RE.test(h) ? { fid: o.fid, hash: h } : null;
};
/** a CastAdd message → a record, or null when it is not one (rebuilt field by field; nothing else is kept) */
function recOf(m: unknown): Rec | null {
  if (!m || typeof m !== "object") return null;
  const msg = m as Record<string, unknown>;
  const d = msg.data as Record<string, unknown> | undefined;
  const hash = typeof msg.hash === "string" ? msg.hash.toLowerCase() : "";
  if (!d || d.type !== "MESSAGE_TYPE_CAST_ADD" || !isFid(d.fid) || !HASH_RE.test(hash)) return null;
  const t = d.timestamp;
  if (typeof t !== "number" || !Number.isFinite(t) || t < 0) return null;
  const b = (d.castAddBody ?? {}) as Record<string, unknown>;
  const embeds: Rec["embeds"] = [];
  for (const e of Array.isArray(b.embeds) ? b.embeds.slice(0, 4) : []) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (typeof o.url === "string" && o.url.length <= 2048) embeds.push({ url: o.url });
    else {
      const c = castIdOf(o.castId);
      if (c) embeds.push({ castId: c });
    }
  }
  const mentions = Array.isArray(b.mentions) ? b.mentions.filter(isFid).slice(0, 20) : [];
  const positions = Array.isArray(b.mentionsPositions) ? b.mentionsPositions.filter((x): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0).slice(0, 20) : [];
  return {
    hash,
    fid: d.fid,
    ts: FC_EPOCH + t * 1000,
    text: typeof b.text === "string" ? b.text.slice(0, 4000) : "",
    parent: castIdOf(b.parentCastId),
    embeds,
    mentions: mentions.length === positions.length ? mentions : [],
    positions: mentions.length === positions.length ? positions : [],
  };
}
function linkOf(m: unknown): { fid: number; ts: number } | null {
  if (!m || typeof m !== "object") return null;
  const d = (m as Record<string, unknown>).data as Record<string, unknown> | undefined;
  const lb = (d?.linkBody ?? null) as Record<string, unknown> | null;
  if (!d || d.type !== "MESSAGE_TYPE_LINK_ADD" || !lb || lb.type !== "follow" || !isFid(lb.targetFid)) return null;
  const t = typeof d.timestamp === "number" && Number.isFinite(d.timestamp) ? d.timestamp : 0;
  return { fid: lb.targetFid, ts: FC_EPOCH + t * 1000 };
}
function profileOf(json: Record<string, unknown>): Profile {
  const p: Profile = { username: null, displayName: null, pfpUrl: null, bio: null };
  for (const m of Array.isArray(json.messages) ? json.messages : []) {
    const b = (m as { data?: { userDataBody?: { type?: unknown; value?: unknown } } })?.data?.userDataBody;
    if (!b || typeof b.value !== "string") continue;
    const v = b.value.slice(0, 512);
    if (b.type === "USER_DATA_TYPE_USERNAME" && /^[a-z0-9][a-z0-9.-]{0,63}$/i.test(v)) p.username = v.toLowerCase();
    else if (b.type === "USER_DATA_TYPE_DISPLAY") p.displayName = v.slice(0, 64);
    else if (b.type === "USER_DATA_TYPE_PFP") p.pfpUrl = v;
    else if (b.type === "USER_DATA_TYPE_BIO") p.bio = v.slice(0, 256);
  }
  return p;
}
/** a key order on (time, hash): the node's own order for an account's casts */
const cmpKey = (a: Rec, b: Rec): number => a.ts - b.ts || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0);
const newestFirst = (a: Rec, b: Rec): number => cmpKey(b, a);

const webUrl = (v: string | null | undefined): string | null => (typeof v === "string" && /^https:\/\/[^\s]+$/i.test(v) ? v : null);
/** contentPure's self-contained placeholder picture (an inline SVG: drawing it makes no request) */
const FALLBACK_PFP = mapUser({}).pfpUrl;
function userOf(fid: number, p: Profile | null | undefined): User {
  const username = p?.username || "!" + fid;
  return Object.assign(
    { fid, username, displayName: p?.displayName || p?.username || "Farcaster account " + fid, pfpUrl: webUrl(p?.pfpUrl) ?? FALLBACK_PFP, bio: p?.bio ?? "", followerCount: 0, followingCount: 0 },
    { network: true as const, hub: true as const }
  );
}
/** the mentions put back where the protocol keeps them: at their UTF-8 byte positions in the text */
function withMentions(r: Rec, nameOf: (fid: number) => string): string {
  if (!r.mentions.length) return r.text;
  const bytes = new TextEncoder().encode(r.text);
  const dec = new TextDecoder();
  const order = r.positions.map((p, i) => [p, r.mentions[i]] as const).sort((a, b) => a[0] - b[0]);
  const parts: string[] = [];
  let last = 0;
  for (const [p, fid] of order) {
    if (p < last || p > bytes.length) return r.text;
    parts.push(dec.decode(bytes.slice(last, p)), "@" + nameOf(fid));
    last = p;
  }
  parts.push(dec.decode(bytes.slice(last)));
  return parts.join("");
}
interface ShapeCtx {
  profile: (fid: number) => Profile | null;
  quote: (hash: string) => { rec: Rec | null; state: string } | null;
}
function castOf(r: Rec, ctx: ShapeCtx, depth = 0): Cast {
  const nameOf = (fid: number) => ctx.profile(fid)?.username || "!" + fid;
  const embeds: Embed[] = [];
  for (const e of r.embeds) {
    if ("url" in e) {
      const url = webUrl(e.url) ?? (/^http:\/\//i.test(e.url) ? e.url : null);
      if (!url) continue;
      let host = "";
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        continue;
      }
      const image = hubEmbedIsImage(url, host);
      if (image) embeds.push({ type: "image", url });
      else embeds.push({ type: "link", url, domain: host.replace(/^www\./, ""), title: (host + new URL(url).pathname).replace(/^www\./, "").slice(0, 80) });
    } else if (depth === 0) {
      const q = ctx.quote(e.castId.hash);
      if (q && q.rec) embeds.push({ type: "quote", quote: castOf(q.rec, ctx, 1) });
      else embeds.push({ type: "link", url: "https://farcaster.xyz", domain: "Farcaster", title: q && q.state === "own" ? QUOTE_OWN_TITLE : q && q.state === "failed" ? "A quoted post (couldn't be read just now)" : q && q.state === "missing" ? "A quoted post that isn't on the network any more" : "A quoted post" });
    }
  }
  const text = withMentions(r, nameOf);
  return Object.assign(
    {
      hash: r.hash,
      author: userOf(r.fid, ctx.profile(r.fid)),
      text,
      timestamp: r.ts,
      // Farcaster's node keeps no counts: never a fabricated number (0 renders as nothing)
      replies: 0,
      likes: 0,
      recasts: 0,
      views: undefined,
      embeds,
      truncate: text.length > 480,
      parentHash: r.parent?.hash,
      replyingTo: r.parent ? "@" + nameOf(r.parent.fid) : undefined,
      live: true,
    },
    { network: true as const, hub: true as const },
    // PERSONA SEPARATION FOR WRITES: a card by one of the visitor's own personas (a reply in someone else's thread) says
    // so, and its like, recast and reply stay off (the device refuses them too: own_persona). No set loaded = own.
    isOwn(r.fid) ? { hubOwn: true as const } : {}
  );
}

// ------------------------------------------------------------------------------------------------- the device cache
interface Src {
  fid: number;
  /** newest first, deduplicated */
  recs: Rec[];
  token: string;
  exhausted: boolean;
  state: "pending" | "loading" | "ok" | "failed";
  refreshing: boolean;
  extending: boolean;
  olderFailed: boolean;
  checkedAt: number;
  nextCheckAt: number;
}
interface Slot<T> {
  v: T | null;
  /** "own": one of this visitor's own personas, never read (PERSONA SEPARATION) */
  state: "loading" | "ok" | "failed" | "missing" | "own";
  at: number;
  p: Promise<void> | null;
}
interface Engine {
  fid: number;
  fname: string | null;
  follows: { list: Array<{ fid: number; ts: number }> | null; state: "idle" | "loading" | "ok" | "failed"; at: number; truncated: boolean; refreshFailed: boolean; p: Promise<void> | null };
  sources: Map<number, Src>;
  selected: number[] | null;
  want: number;
  extending: boolean;
  refreshing: number;
  refreshedAt: number;
  /** this tab's own posts as the root, not yet seen on the node (lib/fc/rootSigner/flow.ts onRootCast) */
  pending: Map<string, Rec>;
  removed: Set<string>;
  changed: { p: Promise<void>; fire: () => void };
  /** the fids the last answer's casts needed profiles for (busy() asks about them without re-merging) */
  shownFids: number[];
  /** the root's profile as the sign-in recorded it (used only until the node's own profile is read) */
  rootProfile: Profile;
  /** the hashes the last answer showed (kept on screen while the timeline is still filling) */
  shown: Set<string>;
  /** older-page reads allowed while the first read is still filling */
  earlyBudget: number;
}
interface PublicCache {
  profiles: Map<number, Slot<Profile>>;
  casts: Map<string, Slot<Rec>>;
}
const ge = globalThis as unknown as { __layersHubEngine?: Engine | null; __layersHubPublic?: PublicCache | null; __layersHubListening?: boolean };
const pub = (): PublicCache => (ge.__layersHubPublic ??= { profiles: new Map(), casts: new Map() });
function signal(): Engine["changed"] {
  let fire = () => {};
  const p = new Promise<void>((r) => (fire = r));
  return { p, fire };
}
function notify(e: Engine): void {
  const c = e.changed;
  e.changed = signal();
  c.fire();
}
const alive = (e: Engine) => ge.__layersHubEngine === e;
function newSrc(fid: number): Src {
  return { fid, recs: [], token: "", exhausted: false, state: "pending", refreshing: false, extending: false, olderFailed: false, checkedAt: 0, nextCheckAt: 0 };
}
function engineFor(acct: HubAccount): Engine {
  const cur = ge.__layersHubEngine;
  const rootProfile: Profile = { username: acct.fname, displayName: acct.displayName ?? null, pfpUrl: acct.pfpUrl ?? null, bio: null };
  if (cur && cur.fid === acct.fid) {
    cur.fname = acct.fname;
    cur.rootProfile = rootProfile;
    return cur;
  }
  // a different root (or none before): nothing of the previous one's graph survives
  ge.__layersHubPublic = null;
  const e: Engine = {
    fid: acct.fid,
    fname: acct.fname,
    follows: { list: null, state: "idle", at: 0, truncated: false, refreshFailed: false, p: null },
    sources: new Map(),
    selected: null,
    want: L.defaultWant,
    extending: false,
    refreshing: 0,
    refreshedAt: 0,
    pending: new Map(),
    removed: new Set(),
    changed: signal(),
    shownFids: [],
    rootProfile,
    shown: new Set(),
    earlyBudget: L.earlyExtendBudget,
  };
  ge.__layersHubEngine = e;
  listen();
  return e;
}
/** reloadIdentity / resetSeed: the previous root's graph, its casts, profiles, reactions and pause go (the reset contract) */
export function resetHubReads(): void {
  ge.__layersHubEngine = null;
  ge.__layersHubPublic = null;
  gx.__layersHubReacted = null;
  // NOTIFICATIONS FROM FARCASTER (lib/fc/hubRead/notifications.ts): the previous root's notifications go too
  (globalThis as unknown as { __layersHubNotif?: unknown }).__layersHubNotif = null;
  // SPEC B (lib/fc/hubRead/forYou.ts): the previous root's For You goes too
  (globalThis as unknown as { __layersHubForYou?: unknown }).__layersHubForYou = null;
  const n = net();
  n.pausedUntil = 0;
  n.requests = 0;
}

// ------------------------------------------------------------------------------------------------- the root's reactions
// POST AS YOU ON HUB CARDS: which casts the root has already liked and recast, so a card shows its pressed state as the
// network has it (never a guess, never a count: the node keeps none). Two plain GETs naming the ROOT only, through hubGet
// (the limiter and the separation guard: nothing while a persona acts), one page of the newest reactions per kind:
//   GET /v1/reactionsByFid?fid=<root>&reaction_type=Like|Recast&pageSize=200&reverse=true
// (Snapchain's names: `REACTION_TYPE_LIKE` is refused with 400 "unknown variant", measured 2026-11-05). Cached in tab memory
// for 10 minutes; a like or recast this tab makes is applied at once (onRootCast) and wins over a read that started before it.
interface Reacted {
  fid: number;
  state: "idle" | "loading" | "ok" | "failed";
  like: Set<string>;
  recast: Set<string>;
  horizon: { like: number | null; recast: number | null };
  at: number;
  p: Promise<void> | null;
  /** this tab's own reactions since the last read started: kind + ":" + hash → { on, at } */
  local: Map<string, { on: boolean; at: number }>;
}
const gx = globalThis as unknown as { __layersHubReacted?: Reacted | null };
function reactedFor(fid: number): Reacted {
  const cur = gx.__layersHubReacted;
  if (cur && cur.fid === fid) return cur;
  // a different root: nothing of the previous one's reactions survives
  const r: Reacted = { fid, state: "idle", like: new Set(), recast: new Set(), horizon: { like: null, recast: null }, at: 0, p: null, local: new Map() };
  gx.__layersHubReacted = r;
  return r;
}
function reactionsPage(rt: HubReadRuntime, fid: number, kind: "like" | "recast"): Promise<{ hashes: Set<string>; horizon: number | null }> {
  const want = kind === "like" ? "REACTION_TYPE_LIKE" : "REACTION_TYPE_RECAST";
  return hubGet(rt, `/v1/reactionsByFid?fid=${fid}&reaction_type=${kind === "like" ? "Like" : "Recast"}&pageSize=${L.reactionsPage}&reverse=true`, "hi").then((a) => {
    if (a.kind !== "ok" || !Array.isArray(a.json.messages)) throw new HubFail("malformed");
    const hashes = new Set<string>();
    let oldest: number | null = null;
    for (const m of a.json.messages as unknown[]) {
      const d = (m as { data?: Record<string, unknown> } | null)?.data;
      const b = (d?.reactionBody ?? null) as Record<string, unknown> | null;
      // rebuilt field by field: a record of another account or another kind is dropped
      if (!d || d.type !== "MESSAGE_TYPE_REACTION_ADD" || d.fid !== fid || !b || b.type !== want) continue;
      const t = castIdOf(b.targetCastId);
      if (!t) continue;
      hashes.add(t.hash);
      if (typeof d.timestamp === "number" && Number.isFinite(d.timestamp)) {
        const ms = FC_EPOCH + d.timestamp * 1000;
        oldest = oldest === null ? ms : Math.min(oldest, ms);
      }
    }
    const more = typeof a.json.nextPageToken === "string" && a.json.nextPageToken !== "";
    // more than one page: a cast older than the oldest reaction read cannot be told (never "not liked")
    return { hashes, horizon: more ? oldest ?? Number.MAX_SAFE_INTEGER : null };
  });
}
function ensureReactions(rt: HubReadRuntime, fid: number, force: boolean): Promise<void> {
  const r = reactedFor(fid);
  if (r.p) return r.p;
  if (r.state === "ok" && !force && rt.now() - r.at < L.reactionsFreshMs) return Promise.resolve();
  const started = rt.now();
  r.state = r.state === "ok" ? "ok" : "loading";
  const p = Promise.all([reactionsPage(rt, fid, "like"), reactionsPage(rt, fid, "recast")])
    .then(([like, recast]) => {
      if (gx.__layersHubReacted !== r) return;
      r.like = like.hashes;
      r.recast = recast.hashes;
      r.horizon = { like: like.horizon, recast: recast.horizon };
      r.state = "ok";
      r.at = rt.now();
      // what this tab did after the read started still wins; what it did before, the read already shows
      for (const [k, v] of r.local) if (v.at < started) r.local.delete(k);
    })
    .catch(() => {
      if (gx.__layersHubReacted !== r) return;
      // NEVER FAIL OPEN: a failed read is "couldn't tell", never "not liked" (an earlier good read stays)
      if (r.state !== "ok") r.state = "failed";
    })
    .finally(() => {
      if (gx.__layersHubReacted === r) r.p = null;
    });
  r.p = p;
  return p;
}
function reactedView(r: Reacted, acct: HubAccount): HubReactedView {
  const side = (kind: "like" | "recast") => {
    const set = new Set(kind === "like" ? r.like : r.recast);
    for (const [k, v] of r.local) {
      const [kk, hash] = k.split(":");
      if (kk !== kind) continue;
      if (v.on) set.add(hash);
      else set.delete(hash);
    }
    return { hashes: [...set], horizon: r.horizon[kind] };
  };
  const ok = r.state === "ok";
  const none = { hashes: [], horizon: null };
  return {
    account: { fid: acct.fid, fname: acct.fname },
    state: ok ? "ok" : r.state === "failed" ? "failed" : "loading",
    like: ok ? side("like") : none,
    recast: ok ? side("recast") : none,
    sentence: r.state === "failed" ? REACTED_FAILED_SENTENCE : null,
  };
}

/** POST AS YOU: a cast this tab just posted as the root shows at once; a delete goes at once (the node re-read confirms);
 *  a like or recast (or its undo) is the cards' pressed state at once */
function listen(): void {
  if (ge.__layersHubListening) return;
  ge.__layersHubListening = true;
  void import("@/lib/fc/rootSigner/flow")
    .then((f) =>
      f.onRootCast((ev) => {
        if (ev.kind === "react") {
          const r = gx.__layersHubReacted;
          if (r && r.fid === ev.fid) r.local.set(ev.reaction + ":" + ev.target.hash, { on: ev.on, at: ev.at });
          return;
        }
        const e = ge.__layersHubEngine;
        if (!e || e.fid !== ev.fid) return;
        if (ev.kind === "cast") {
          e.pending.set(ev.hash, { hash: ev.hash, fid: ev.fid, ts: ev.at, text: ev.text, parent: ev.parent, embeds: [], mentions: [], positions: [] });
          e.removed.delete(ev.hash);
        } else {
          e.removed.add(ev.hash);
          e.pending.delete(ev.hash);
          const s = e.sources.get(e.fid);
          if (s) s.recs = s.recs.filter((r) => r.hash !== ev.hash);
        }
        const s = e.sources.get(e.fid);
        if (s) s.nextCheckAt = 0;
        notify(e);
      })
    )
    .catch(() => {
      ge.__layersHubListening = false; // the next engine tries again
    });
}

// ------------------------------------------------------------------------------------------------- follows
function ensureFollows(e: Engine, rt: HubReadRuntime, force: boolean): Promise<void> {
  const f = e.follows;
  if (f.p) return f.p;
  const fresh = f.state === "ok" && rt.now() - f.at < L.followsFreshMs;
  if (!force && (fresh || f.state === "failed")) return Promise.resolve();
  if (f.state !== "ok") f.state = "loading";
  const p = (async () => {
    const seen = new Map<number, number>();
    let token = "";
    let truncated = false;
    for (;;) {
      const a = await hubGet(rt, `/v1/linksByFid?fid=${e.fid}&link_type=follow&pageSize=${L.followsPage}` + (token ? "&pageToken=" + encodeURIComponent(token) : ""), "hi");
      if (a.kind !== "ok" || !Array.isArray(a.json.messages)) throw new HubFail("malformed");
      for (const m of a.json.messages) {
        const t = linkOf(m);
        if (t && t.fid !== e.fid) seen.set(t.fid, Math.max(seen.get(t.fid) ?? 0, t.ts));
      }
      token = typeof a.json.nextPageToken === "string" ? a.json.nextPageToken : "";
      if (!token) break;
      if (seen.size >= L.maxFollowsRead) {
        truncated = true;
        break;
      }
    }
    // most recently followed first (the fan-out cap keeps the front of this list)
    const list = [...seen.entries()].map(([fid, ts]) => ({ fid, ts })).sort((a, b) => b.ts - a.ts || a.fid - b.fid);
    if (!alive(e)) return;
    e.follows = { list, state: "ok", at: rt.now(), truncated, refreshFailed: false, p: null };
    reconcile(e);
  })()
    .catch(() => {
      if (!alive(e)) return;
      // NEVER FAIL OPEN: an old list stays (and the page says it could not be re-read); no list is an ERROR, never []
      if (e.follows.list) e.follows = { ...e.follows, state: "ok", refreshFailed: true, p: null };
      else e.follows = { ...e.follows, state: "failed", p: null };
    })
    .finally(() => {
      if (alive(e)) {
        e.follows.p = null;
        notify(e);
      }
    });
  f.p = p;
  return p;
}
/** the accounts the timeline reads: the root, then the most recently followed, up to the cap */
function reconcile(e: Engine): void {
  const list = e.follows.list ?? [];
  // PERSONA SEPARATION: an own persona the root follows is never read (its posts are its own, on its own pages)
  const sel = [e.fid, ...list.slice(0, L.maxTimelineAccounts).map((f) => f.fid).filter((f) => !isOwn(f))];
  e.selected = sel;
  const keep = new Set(sel);
  for (const fid of sel) if (!e.sources.has(fid)) e.sources.set(fid, newSrc(fid));
  for (const fid of [...e.sources.keys()]) if (!keep.has(fid)) e.sources.delete(fid);
}

// ------------------------------------------------------------------------------------------------- casts
function recheckIn(s: Src, now: number): number {
  const newest = s.recs.find((r) => r.ts <= now + L.futureSkewMs);
  if (!newest) return L.maxRecheckMs;
  return Math.min(L.maxRecheckMs, Math.max(L.minRecheckMs, Math.floor((now - newest.ts) / 6)));
}
function castsPage(rt: HubReadRuntime, fid: number, size: number, token: string, lane: Lane): Promise<{ recs: Rec[]; token: string; full: boolean }> {
  return hubGet(rt, `/v1/castsByFid?fid=${fid}&pageSize=${size}&reverse=true` + (token ? "&pageToken=" + encodeURIComponent(token) : ""), lane).then((a) => {
    if (a.kind !== "ok" || !Array.isArray(a.json.messages)) throw new HubFail("malformed");
    const raw = a.json.messages as unknown[];
    // a record under another fid in this answer is dropped, never shown under the wrong author
    const recs = raw.map(recOf).filter((r): r is Rec => !!r && r.fid === fid);
    const next = typeof a.json.nextPageToken === "string" ? a.json.nextPageToken : "";
    return { recs, token: next, full: raw.length >= size && !!next };
  });
}
function dedupe(list: Rec[]): Rec[] {
  const seen = new Set<string>();
  const out: Rec[] = [];
  for (const r of list.sort(newestFirst)) {
    if (seen.has(r.hash)) continue;
    seen.add(r.hash);
    out.push(r);
  }
  return out;
}
async function readHead(e: Engine, rt: HubReadRuntime, s: Src, refresh: boolean): Promise<void> {
  if (refresh) {
    s.refreshing = true;
    e.refreshing++;
  } else s.state = "loading";
  try {
    const pg = await castsPage(rt, s.fid, L.firstPage, "", s.fid === e.fid ? "hi" : "lo");
    if (!alive(e)) return;
    if (!refresh || s.recs.length === 0 || !pg.full) {
      // the first read, or an account with fewer casts than a page: this page is the whole truth from the top
      s.recs = dedupe(pg.recs);
      s.token = pg.token;
      s.exhausted = !pg.full;
    } else {
      const head = new Set(pg.recs.map((r) => r.hash));
      const overlap = s.recs.some((r) => head.has(r.hash));
      if (!overlap) {
        // a gap between the new head and what was held: start this account over from its head (never a hole)
        s.recs = dedupe(pg.recs);
        s.token = pg.token;
        s.exhausted = false;
      } else {
        // the head page covers everything at or above its oldest key: what it no longer lists there was deleted
        const oldest = pg.recs[pg.recs.length - 1];
        const kept = s.recs.filter((r) => head.has(r.hash) || cmpKey(r, oldest) < 0);
        s.recs = dedupe([...pg.recs, ...kept]);
      }
    }
    s.state = "ok";
    s.checkedAt = rt.now();
    s.nextCheckAt = s.checkedAt + recheckIn(s, s.checkedAt);
    for (const r of s.recs) e.pending.delete(r.hash);
  } catch {
    if (!alive(e)) return;
    if (!refresh) s.state = "failed";
    // a failed RE-read keeps what was read (still ok) and is re-tried on the account's next check
    else s.nextCheckAt = rt.now() + L.minRecheckMs;
  } finally {
    if (refresh) {
      s.refreshing = false;
      e.refreshing--;
    }
    if (alive(e)) notify(e);
  }
}
function pump(e: Engine, rt: HubReadRuntime): void {
  for (const fid of e.selected ?? []) {
    const s = e.sources.get(fid);
    if (!s) continue;
    if (s.state === "pending") void readHead(e, rt, s, false);
    // nextCheckAt 0 on a read account = "re-read it now" (this tab just posted or deleted as the root)
    else if (s.state === "ok" && s.nextCheckAt === 0 && !s.refreshing) void readHead(e, rt, s, true);
  }
}
function refresh(e: Engine, rt: HubReadRuntime, kind: "auto" | "manual"): void {
  const now = rt.now();
  if (now - e.refreshedAt < (kind === "manual" ? L.manualRefreshFloorMs / 2 : L.autoRefreshFloorMs)) return;
  e.refreshedAt = now;
  void ensureFollows(e, rt, now - e.follows.at >= L.followsFreshMs);
  for (const fid of e.selected ?? []) {
    const s = e.sources.get(fid);
    if (!s || s.state !== "ok" || s.refreshing) continue;
    const due = kind === "manual" ? now - s.checkedAt >= L.manualRefreshFloorMs || s.nextCheckAt <= now : s.nextCheckAt <= now;
    if (due) void readHead(e, rt, s, true);
  }
}

interface Merge {
  /** every cast read (newest first), horizon or not */
  all: Rec[];
  visible: Rec[];
  horizon: Rec | null;
  ok: number;
  failed: number;
  pending: number;
  future: number;
  frontier: Src[];
}
/** the merged timeline: exact (reverse-chronological) down to the horizon, the newest "oldest cast read" of any account
 *  that has more casts than were read */
function merge(e: Engine, now: number): Merge {
  const limit = now + L.futureSkewMs;
  const all: Rec[] = [];
  let horizon: Rec | null = null;
  let ok = 0;
  let failed = 0;
  let pending = 0;
  let future = 0;
  const open: Src[] = [];
  for (const fid of e.selected ?? []) {
    const s = e.sources.get(fid);
    if (!s) continue;
    if (s.state === "ok") {
      ok++;
      for (const r of s.recs) {
        if (e.removed.has(r.hash)) continue;
        if (r.ts > limit) future++;
        else all.push(r);
      }
      if (!s.exhausted && s.recs.length) {
        open.push(s);
        const o = s.recs[s.recs.length - 1];
        if (!horizon || cmpKey(o, horizon) > 0) horizon = o;
      }
    } else if (s.state === "failed") failed++;
    else pending++;
  }
  for (const r of e.pending.values()) if (!e.removed.has(r.hash)) all.push(r);
  const merged = dedupe(all);
  const h = horizon;
  const visible = h ? merged.filter((r) => cmpKey(r, h) >= 0) : merged;
  // the accounts holding the horizon back, newest "oldest read" first
  const frontier = open.filter((s) => !s.olderFailed && !s.extending).sort((a, b) => newestFirst(a.recs[a.recs.length - 1], b.recs[b.recs.length - 1]));
  return { all: merged, visible, horizon, ok, failed, pending, future, frontier };
}
/** "Show older posts": page the accounts at the horizon until the window is full (a bounded number of reads per step;
 *  while the first read is still filling, out of a separate bounded allowance) */
async function extend(e: Engine, rt: HubReadRuntime, early: boolean): Promise<void> {
  if (e.extending) return;
  e.extending = true;
  try {
    let budget = early ? Math.min(L.extendBudget, e.earlyBudget) : L.extendBudget;
    while (budget > 0 && alive(e)) {
      const m = merge(e, rt.now());
      if (m.visible.length >= e.want || !m.frontier.length) break;
      const batch = m.frontier.slice(0, Math.min(4, budget));
      budget -= batch.length;
      if (early) e.earlyBudget -= batch.length;
      await Promise.all(
        batch.map(async (s) => {
          s.extending = true;
          try {
            const pg = await castsPage(rt, s.fid, L.morePage, s.token, "hi");
            if (!alive(e)) return;
            s.recs = dedupe([...s.recs, ...pg.recs]);
            s.token = pg.token;
            s.exhausted = !pg.full;
          } catch {
            // never "the account has no older posts": the timeline stops at the horizon and the page says why
            s.olderFailed = true;
          } finally {
            s.extending = false;
          }
        })
      );
      notify(e);
    }
  } finally {
    e.extending = false;
    if (alive(e)) notify(e);
  }
}

// ------------------------------------------------------------------------------------------------- profiles and quotes
function ensureProfile(rt: HubReadRuntime, fid: number, retry = false): Promise<void> {
  const c = pub();
  if (isOwn(fid)) {
    // PERSONA SEPARATION: an own persona's name comes from its vault record, never from a read naming it
    const name = gr.__layersHubOwn?.names.get(fid) ?? null;
    c.profiles.set(fid, { v: { username: name, displayName: name, pfpUrl: null, bio: null }, state: "ok", at: rt.now(), p: null });
    return Promise.resolve();
  }
  const slot = c.profiles.get(fid);
  if (slot && slot.p) return slot.p;
  if (slot && slot.state === "ok" && rt.now() - slot.at < L.profileFreshMs) return Promise.resolve();
  if (slot && slot.state === "failed" && !retry) return Promise.resolve();
  const s: Slot<Profile> = { v: slot?.v ?? null, state: "loading", at: rt.now(), p: null };
  c.profiles.delete(fid);
  c.profiles.set(fid, s);
  while (c.profiles.size > L.maxProfiles) c.profiles.delete(c.profiles.keys().next().value as number);
  s.p = hubGet(rt, `/v1/userDataByFid?fid=${fid}`, "hi")
    .then((a) => {
      if (a.kind !== "ok") throw new HubFail("malformed");
      s.v = profileOf(a.json);
      s.state = "ok";
    })
    .catch(() => {
      s.state = s.v ? "ok" : "failed";
    })
    .finally(() => {
      s.at = rt.now();
      s.p = null;
      const e = ge.__layersHubEngine;
      if (e) notify(e);
    });
  return s.p;
}
/** the node's profile once read; for the root itself, until then, what its sign-in recorded (never a bare number) */
const profileNow = (fid: number): Profile | null => {
  const v = pub().profiles.get(fid)?.v;
  if (v) return v;
  const e = ge.__layersHubEngine;
  return e && e.fid === fid && e.rootProfile.username ? e.rootProfile : null;
};
/** one cast by id, cached (threads, quotes); "missing" is the node's own NotFound, never a failure */
function ensureCast(rt: HubReadRuntime, fid: number, hash: string): Promise<Slot<Rec>> {
  const c = pub();
  const slot = c.casts.get(hash);
  if (slot && slot.p) return slot.p.then(() => slot);
  if (slot && (slot.state === "ok" || slot.state === "missing")) return Promise.resolve(slot);
  if (isOwn(fid)) {
    // PERSONA SEPARATION: a cast by an own persona is never read as the root
    const own: Slot<Rec> = { v: null, state: "own", at: rt.now(), p: null };
    c.casts.set(hash, own);
    return Promise.resolve(own);
  }
  const s: Slot<Rec> = { v: null, state: "loading", at: rt.now(), p: null };
  c.casts.set(hash, s);
  while (c.casts.size > 4000) c.casts.delete(c.casts.keys().next().value as string);
  s.p = hubGet(rt, `/v1/castById?fid=${fid}&hash=${hash}`, "hi")
    .then((a) => {
      if (a.kind === "not_found") {
        s.state = "missing";
        return;
      }
      const r = recOf(a.json);
      if (!r || r.hash !== hash || r.fid !== fid) throw new HubFail("malformed");
      s.v = r;
      s.state = "ok";
    })
    .catch(() => {
      s.state = "failed";
    })
    .finally(() => {
      s.at = rt.now();
      s.p = null;
      const e = ge.__layersHubEngine;
      if (e) notify(e);
    });
  return s.p.then(() => s);
}
const ctxNow: ShapeCtx = {
  profile: profileNow,
  quote: (hash) => {
    const s = pub().casts.get(hash);
    return s ? { rec: s.v, state: s.state } : null;
  },
};
/** the quoted casts a list of casts embeds (bounded), read */
function quotesFor(rt: HubReadRuntime, recs: Rec[]): Promise<unknown>[] {
  const out: Promise<unknown>[] = [];
  for (const r of recs) for (const em of r.embeds) if ("castId" in em && out.length < L.quoteBudget) out.push(ensureCast(rt, em.castId.fid, em.castId.hash));
  return out;
}
/** the fids a list of casts needs profiles for: authors, the accounts replied to, the accounts mentioned */
function fidsFor(recs: Rec[]): number[] {
  const out = new Set<number>();
  for (const r of recs) {
    out.add(r.fid);
    if (r.parent) out.add(r.parent.fid);
    for (const m of r.mentions) out.add(m);
  }
  return [...out];
}
function profilesFailed(fids: number[]): { failed: number; sentence: string } | null {
  const failed = fids.filter((f) => pub().profiles.get(f)?.state === "failed").length;
  return failed ? { failed, sentence: profilesFailedSentence(failed) } : null;
}
async function settle(promises: Promise<unknown>[], ms: number): Promise<void> {
  await Promise.race([Promise.allSettled(promises), sleep(ms)]);
}

// ------------------------------------------------------------------------------------------------- the ops
async function signedIn(rt: HubReadRuntime): Promise<HubAccount | null> {
  return rt.account();
}
function accountView(e: Engine): HubAccountView {
  return { fid: e.fid, fname: e.fname };
}

/** the Following timeline: a snapshot of what is in, and the reads it needs started (not awaited past `waitMs`) */
export async function hubTimeline(opts: { want?: number; refresh?: "auto" | "manual" | null; retry?: boolean; waitMs?: number } = {}): Promise<HubTimelineView> {
  const rt = gate();
  await admit(rt);
  const acct = await signedIn(rt);
  if (!acct) {
    return {
      state: "not_signed_in",
      code: "not_signed_in",
      reason: HUB_READ_SENTENCES.not_signed_in,
      account: null,
      follows: { state: "loading", count: null, truncated: false, stale: false },
      progress: { accounts: 0, read: 0, failed: 0, pending: 0 },
      capped: null,
      items: [],
      more: false,
      loading: false,
      paused: null,
      partial: null,
      olderFailed: null,
      profilesFailed: null,
      followsNone: false,
      noPosts: false,
      futureDated: 0,
      refreshedAt: null,
      requests: 0,
      mode: null,
    };
  }
  hubBase(rt); // misconfigured: say so before any read
  const e = engineFor(acct);
  if (typeof opts.want === "number" && Number.isFinite(opts.want)) e.want = Math.min(L.maxWant, Math.max(10, Math.floor(opts.want)));
  if (opts.retry) {
    for (const s of e.sources.values()) {
      if (s.state === "failed") s.state = "pending";
      s.olderFailed = false;
    }
    for (const [fid, slot] of pub().profiles) if (slot.state === "failed") pub().profiles.delete(fid);
  }
  void ensureFollows(e, rt, !!opts.retry && e.follows.state === "failed");
  if (e.follows.state === "ok") {
    if (!e.selected) reconcile(e);
    pump(e, rt);
    if (opts.refresh) refresh(e, rt, opts.refresh);
  }
  // a short wait for progress, so the first answer is rarely empty (the island asks again while it is filling)
  const deadline = Date.now() + Math.min(L.waitCapMs, Math.max(0, opts.waitMs ?? 0));
  while (Date.now() < deadline && busy(e)) {
    await Promise.race([e.changed.p, sleep(deadline - Date.now())]);
    if (e.follows.state === "ok") pump(e, rt);
  }
  // SPEC A: the root's active mode, read from this device on every answer (a switch shows on the next one). A mode
  // that cannot be read or applied is an error on the page, never the posts it might hide.
  let mode: ModeAnswer;
  try {
    mode = { spec: await rt.mode() };
  } catch (err) {
    mode = { error: err instanceof Error && err.name === "HubModeError" ? err.message : HUB_MODE_ERROR_SENTENCE };
  }
  // SPEC C: the device's own records the extras come from (no node read; each part fails on its own and says so). Not
  // looked at under a mode that could not be applied: that page shows nothing, and nothing is spliced into it either.
  let extras: HubExtrasSpec | null = null;
  if (!("error" in mode)) {
    try {
      extras = await rt.extras(mode.spec ? mode.spec.id : null);
    } catch {
      extras = { readwise: { state: "unavailable" }, notes: { state: "unreadable" }, sends: [] };
    }
  }
  // PERSONA SEPARATION: a persona chosen while this answer was being put together gets nothing of the root's
  if (await rt.acting()) {
    gr.__layersHubOwn = null;
    throw new HubReadError("acting_persona");
  }
  return view(e, rt, mode, extras);
}
type ModeAnswer = { spec: HubModeSpec | null } | { error: string };
/** still reading anything this answer depends on (O(accounts): never a re-merge) */
function busy(e: Engine): boolean {
  if (e.follows.p || e.extending || e.refreshing > 0) return true;
  for (const fid of e.selected ?? []) {
    const s = e.sources.get(fid);
    if (s && (s.state === "pending" || s.state === "loading")) return true;
  }
  return e.shownFids.some((f) => pub().profiles.get(f)?.state === "loading");
}
function view(e: Engine, rt: HubReadRuntime, mode: ModeAnswer = { spec: null }, extras: HubExtrasSpec | null = null): HubTimelineView {
  const now = rt.now();
  const m = merge(e, now);
  const settled = m.pending === 0 && e.follows.state === "ok";
  // the window is short and an account at the horizon has more: read older pages (bounded per step). Not only once
  // everything is read: the accounts holding the horizon are paged while the rest still loads (the visitor's lane, out
  // of a bounded allowance), so a prolific account does not stall the page until the last account has answered.
  // Measured on the real node (965 follows): 20 posts after 1.0 s instead of 3.0 s, for about 70 more requests (and,
  // with what is shown kept on screen below, 50 after 0.8 s).
  if (e.follows.state === "ok" && !e.extending && m.visible.length < e.want && m.frontier.length && (settled || e.earlyBudget > 0)) void extend(e, rt, !settled);
  // WHILE FILLING, what is already on screen stays on screen (newer posts slot in above it; nothing blinks out when a
  // newly read account moves the horizon). Once everything is read, the window is the exact cut: by then the accounts
  // at the horizon have been paged until it holds `want` posts, so the two agree (they differ only where older pages
  // could not be read, and the page says so).
  let shown = m.visible;
  if (!settled || busy(e)) {
    const cut = new Set(m.visible.map((r) => r.hash));
    const sticky = m.all.filter((r) => e.shown.has(r.hash) && !cut.has(r.hash));
    if (sticky.length) shown = dedupe([...m.visible, ...sticky]);
  }
  // the page AS READ: what is kept on screen while filling, and the only thing any read depends on (profiles, quotes).
  // SPEC A: the mode is applied AFTER, to this page, so a mode never changes what is read from Farcaster's node.
  const page = shown.slice(0, e.want);
  e.shown = new Set(page.map((r) => r.hash));
  e.shownFids = fidsFor(page);
  for (const f of e.shownFids) void ensureProfile(rt, f);
  void quotesFor(rt, page);
  const shaped = modeOf(page, mode, now, e.want);
  const items = shaped.items;
  const f = e.follows;
  const count = f.list ? f.list.length : null;
  const selected = e.selected?.length ?? 0;
  const followsError = f.state === "failed" && !f.list;
  const allFailed = settled && selected > 0 && m.ok === 0 && m.failed === selected;
  const state: HubTimelineView["state"] = followsError || allFailed ? "error" : settled && !busy(e) ? "ready" : "loading";
  const code: HubReadCode | null = followsError ? "follows_unreadable" : allFailed ? "casts_unreadable" : null;
  const n = net();
  const olderFailed = (e.selected ?? []).filter((fid) => e.sources.get(fid)?.olderFailed).length;
  // SPEC C: the extras, drawn only from what this browser already holds (m.all: every cast read for the Following) and
  // the device's own records: no read is started for any of them (profiles and quotes are only ever read for the page)
  const withExtras = !code && extras && !("error" in mode) ? extrasOf(e, m.all, items, extras, mode.spec, now) : null;
  return {
    ...(withExtras ? { cards: withExtras.cards, extras: withExtras.view } : {}),
    state,
    code,
    reason: code ? HUB_READ_SENTENCES[code] : null,
    account: accountView(e),
    follows: { state: f.state === "ok" ? "ok" : f.state === "failed" ? "error" : "loading", count, truncated: f.truncated, stale: f.refreshFailed },
    progress: { accounts: selected, read: m.ok, failed: m.failed, pending: m.pending },
    capped: f.list && f.list.length > L.maxTimelineAccounts ? { reading: L.maxTimelineAccounts, of: f.list.length } : null,
    items: code ? [] : items.map((r) => castOf(r, ctxNow)),
    mode: code ? null : shaped.view,
    more: m.visible.length > items.length || m.frontier.length > 0,
    loading: state === "loading",
    paused: n.pausedUntil > Date.now() ? { until: n.pausedUntil, sentence: pausedSentence((n.pausedUntil - Date.now()) / 1000) } : null,
    partial: m.failed > 0 && !allFailed ? { failed: m.failed, sentence: partialSentence(m.failed, selected) } : null,
    olderFailed: olderFailed ? { failed: olderFailed, sentence: olderPartialSentence(olderFailed) } : null,
    profilesFailed: profilesFailed(fidsFor(items)),
    followsNone: f.state === "ok" && count === 0,
    noPosts: state === "ready" && m.failed === 0 && m.visible.length === 0 && !m.frontier.length,
    futureDated: m.future,
    refreshedAt: e.refreshedAt || null,
    requests: n.requests,
  };
}
/** SPEC A: the page under the root's active mode (lib/fc/hubRead/mode.ts): which posts stay and in which order, and what
 *  the page says about it. No mode (the node harness): the page as read. A mode error: nothing (never the page unfiltered). */
function modeOf(page: Rec[], mode: ModeAnswer, now: number, want: number): { items: Rec[]; view: HubModeView | null } {
  const base = { id: null, name: null, reason: null, of: page.length, hidden: 0, hidAll: false, sentence: null, pinned: [], quiet: [], ranked: false, strip: [], gaps: [], tiers: { accounts: 0, unreadable: null } };
  if ("error" in mode) return { items: [], view: { ...base, state: "error", reason: mode.error } };
  const spec = mode.spec;
  if (!spec) return { items: page, view: null };
  const posts = page.map((r) => ({ hash: r.hash, fid: r.fid, ts: r.ts, text: r.text, reply: !!r.parent, embeds: r.embeds.length, rec: r }));
  const s = shapeForMode(posts, spec, { now, want });
  return {
    items: s.items.map((p) => p.rec),
    view: {
      state: "ok",
      id: spec.id,
      name: spec.name,
      reason: null,
      of: page.length,
      hidden: s.hidden,
      hidAll: page.length > 0 && s.items.length === 0,
      sentence: s.sentence,
      pinned: [...s.pinned],
      quiet: [...s.quiet],
      ranked: s.ranked,
      strip: s.banner.map((p) => {
        const text = withMentions(p.rec, (fid) => profileNow(fid)?.username || "!" + fid);
        return {
          hash: p.hash,
          fid: p.fid,
          handle: profileNow(p.fid)?.username || "!" + p.fid,
          text: text.length > 90 ? text.slice(0, 89) + "\u2026" : text,
          minutesAgo: Math.max(0, Math.round((now - p.ts) / 60_000)),
          href: hubCastHref(p.fid, p.hash),
        };
      }),
      gaps: s.gaps,
      tiers: { accounts: spec.tiers.size, unreadable: s.tiersSentence },
    },
  };
}
/** SPEC C: the page as cards with its extras (lib/fc/hubRead/extras.ts). `held` is every cast read for the Following;
 *  `page` the page as the mode left it. The root's reactions are the ones the cards already read (POST AS YOU on hub
 *  cards); when this tab has not read them, no note resurfaces a post (it cannot tell which ones you liked). */
function extrasOf(e: Engine, held: Rec[], page: Rec[], spec: HubExtrasSpec, modeSpec: HubModeSpec | null, now: number): { cards: HubCardView[]; view: HubExtrasView } {
  const r = gx.__layersHubReacted;
  let engaged: Set<string> | null = null;
  if (r && r.fid === e.fid && r.state === "ok") {
    // what the node said, with what this tab did since (a like or an undo here wins over a read that started before it)
    const like = new Set(r.like);
    const recast = new Set(r.recast);
    for (const [k, v] of r.local) {
      const [kind, hash] = k.split(":");
      const set = kind === "like" ? like : recast;
      if (v.on) set.add(hash);
      else set.delete(hash);
    }
    engaged = new Set([...like, ...recast]);
  }
  const out = shapeExtras<Rec>({
    page,
    held: new Map(held.map((x) => [x.hash, x])),
    engaged,
    hides: modeSpec ? (x) => modeHides({ hash: x.hash, fid: x.fid, ts: x.ts, text: x.text, reply: !!x.parent, embeds: x.embeds.length }, modeSpec, now) : undefined,
    spec,
  });
  return {
    cards: out.cards.map((c) => ({ kind: c.kind, placement: c.placement, cast: castOf(c.rec, ctxNow), piece: c.piece, note: c.note, sentBy: c.sentBy })),
    view: out.view,
  };
}
/** SPEC C — READWISE ON HUB POSTS: the text of a reading piece this browser HOLDS for the Following, for the readwise
 *  route's dwell threshold and the bin (/api/readwise: a piece's id is "<hash>#chunk1"). Never a read: a cast that is
 *  not held, or held but not a reading piece, is null. Refuses while a persona acts (nothing as the root then: a dwell
 *  or a bin entry for the root's Following is never written from a persona's tab) and on a server (device_only). */
export async function hubHeldPiece(hash: unknown): Promise<{ text: string; fid: number } | null> {
  const h = typeof hash === "string" ? hash.toLowerCase() : "";
  if (!HASH_RE.test(h)) return null;
  const rt = gate();
  await admit(rt);
  const e = ge.__layersHubEngine;
  if (!e) return null;
  let rec: Rec | null = e.pending.get(h) ?? null;
  if (!rec) {
    for (const s of e.sources.values()) {
      const hit = s.recs.find((x) => x.hash === h);
      if (hit) {
        rec = hit;
        break;
      }
    }
  }
  if (!rec || e.removed.has(h) || isOwn(rec.fid) || !isHubReadingPiece(rec)) return null;
  return { text: rec.text, fid: rec.fid };
}
/** the follows-count read (the home card): awaited, an error when it cannot be read */
async function followsReady(e: Engine, rt: HubReadRuntime, retry: boolean): Promise<void> {
  await ensureFollows(e, rt, retry && e.follows.state === "failed");
  if (e.follows.p) await e.follows.p;
  if (!e.follows.list) throw new HubReadError("follows_unreadable");
}
export async function hubFollowsCount(opts: { retry?: boolean } = {}): Promise<HubCountView> {
  const rt = gate();
  await admit(rt);
  const acct = await signedIn(rt);
  if (!acct) throw new HubReadError("not_signed_in");
  hubBase(rt);
  const e = engineFor(acct);
  await followsReady(e, rt, !!opts.retry);
  return { account: accountView(e), count: e.follows.list!.length, truncated: e.follows.truncated };
}
/** Find your people: who the root follows, most recently followed first, with profiles for the page asked */
export async function hubPeople(opts: { offset?: number; limit?: number; retry?: boolean } = {}): Promise<HubPeopleView> {
  const rt = gate();
  await admit(rt);
  const acct = await signedIn(rt);
  if (!acct) throw new HubReadError("not_signed_in");
  hubBase(rt);
  const e = engineFor(acct);
  await followsReady(e, rt, !!opts.retry);
  const list = e.follows.list!;
  const offset = Math.max(0, Math.min(list.length, Math.floor(opts.offset ?? 0)));
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? L.peoplePage)));
  const slice = list.slice(offset, offset + limit);
  await settle(slice.map((f) => ensureProfile(rt, f.fid, !!opts.retry)), 6000);
  const rows = slice.map((f) => {
    const st = pub().profiles.get(f.fid)?.state;
    return { fid: f.fid, followedAt: f.ts, user: userOf(f.fid, profileNow(f.fid)), profile: st === "ok" ? ("ok" as const) : ("failed" as const) };
  });
  const failed = rows.filter((r) => r.profile === "failed").length;
  return { account: accountView(e), count: list.length, truncated: e.follows.truncated, offset, rows, more: offset + limit < list.length, profilesFailed: failed ? { failed, sentence: profilesFailedSentence(failed) } : null, stale: e.follows.refreshFailed };
}
const validFid = (v: unknown): v is number => isFid(v) && v < 2 ** 40;
/** a thread by its protocol id (fid + hash): the cast, what it replies to, its direct replies */
export async function hubThread(fid: unknown, hash: unknown): Promise<HubThreadView> {
  const h = typeof hash === "string" ? hash.toLowerCase() : "";
  if (!validFid(fid) || !HASH_RE.test(h)) throw new HubReadError("bad_request");
  const rt = gate();
  await admit(rt);
  hubBase(rt);
  if (isOwn(fid)) throw new HubReadError("own_persona");
  const main = await ensureCast(rt, fid, h);
  if (main.state === "missing") throw new HubReadError("not_found");
  if (main.state !== "ok" || !main.v) throw new HubReadError("cast_unreadable");
  const ancestors: Rec[] = [];
  let ancestorsError: string | null = null;
  let ancestorMissing: string | null = null;
  let up = main.v.parent;
  for (let i = 0; up && i < L.maxAncestors; i++) {
    const a = await ensureCast(rt, up.fid, up.hash);
    if (a.state === "missing") {
      ancestorMissing = ANCESTOR_MISSING_SENTENCE;
      break;
    }
    if (a.state === "own") {
      ancestorMissing = ANCESTOR_OWN_SENTENCE;
      break;
    }
    if (a.state !== "ok" || !a.v) {
      ancestorsError = ANCESTORS_FAILED_SENTENCE;
      break;
    }
    ancestors.unshift(a.v);
    up = a.v.parent;
  }
  let replies: Rec[] = [];
  let moreReplies = false;
  let repliesError: string | null = null;
  try {
    const a = await hubGet(rt, `/v1/castsByParent?fid=${fid}&hash=${h}&pageSize=${L.repliesPage}`, "hi");
    if (a.kind !== "ok" || !Array.isArray(a.json.messages)) throw new HubFail("malformed");
    replies = (a.json.messages as unknown[]).map(recOf).filter((r): r is Rec => !!r && !!r.parent && r.parent.hash === h);
    replies.sort(cmpKey);
    // the real node returns a next-page token on EVERY castsByParent answer, even with no replies (measured 2026-11-06),
    // so a token alone never means "more": only a full page with a token does
    moreReplies = (a.json.messages as unknown[]).length >= L.repliesPage && typeof a.json.nextPageToken === "string" && a.json.nextPageToken !== "";
  } catch {
    repliesError = REPLIES_FAILED_SENTENCE;
  }
  const all = [main.v, ...ancestors, ...replies];
  await settle([...fidsFor(all).map((f) => ensureProfile(rt, f)), ...quotesFor(rt, all)], 5000);
  return { cast: castOf(main.v, ctxNow), ancestors: ancestors.map((r) => castOf(r, ctxNow)), replies: replies.map((r) => castOf(r, ctxNow)), moreReplies, ancestorsError, ancestorMissing, repliesError };
}
/** an account by fid: its profile and newest casts */
export async function hubProfile(fid: unknown): Promise<HubProfileView> {
  if (!validFid(fid)) throw new HubReadError("bad_request");
  const rt = gate();
  await admit(rt);
  hubBase(rt);
  if (isOwn(fid)) throw new HubReadError("own_persona");
  await ensureProfile(rt, fid, true);
  if (pub().profiles.get(fid)?.state !== "ok") throw new HubReadError("profile_unreadable");
  let casts: Rec[] = [];
  let more = false;
  let castsError: string | null = null;
  try {
    const pg = await castsPage(rt, fid, L.profileCasts, "", "hi");
    const limit = rt.now() + L.futureSkewMs;
    casts = dedupe(pg.recs).filter((r) => r.ts <= limit);
    more = !!pg.token;
  } catch {
    castsError = PROFILE_CASTS_FAILED_SENTENCE;
  }
  await settle([...fidsFor(casts).map((f) => ensureProfile(rt, f)), ...quotesFor(rt, casts)], 4000);
  return { user: userOf(fid, profileNow(fid)), casts: casts.map((r) => castOf(r, ctxNow)), more, castsError };
}
/** POST AS YOU ON HUB CARDS: which casts the signed-in root has already liked and recast (the cards' pressed state).
 *  The same admission as every read (nothing while a persona acts; the guard on the path), the root's fid only. */
export async function hubReacted(opts: { refresh?: boolean } = {}): Promise<HubReactedView> {
  const rt = gate();
  await admit(rt);
  const acct = await signedIn(rt);
  if (!acct) throw new HubReadError("not_signed_in");
  hubBase(rt);
  listen();
  const r = reactedFor(acct.fid);
  // a refresh re-reads at most once a minute (the cards ask on every page; the cache answers)
  await settle([ensureReactions(rt, acct.fid, !!opts.refresh && rt.now() - r.at >= L.minRecheckMs)], L.waitCapMs);
  return reactedView(r, acct);
}

// ------------------------------------------------------------------------------------------------- the shared core
/** NOTIFICATIONS FROM FARCASTER (lib/fc/hubRead/notifications.ts) reads through THIS core and nothing else: the same gate,
 *  admission (nothing while a persona acts; the own set loaded), node, limiter, 429 pause, separation guard, record
 *  shapes, and profile and quote caches. So every guard above covers its reads too. Not for the islands. */
export type HubRec = Rec;
export type { HubReadRuntime as HubCoreRuntime };
export const __hubCore = Object.freeze({
  gate,
  admit,
  hubBase,
  /** "hi": what the visitor is looking at; "lo": background (the unread badge), behind Following's own reads */
  hubGet: (rt: HubReadRuntime, path: string, lane: Lane = "hi") => hubGet(rt, path, lane),
  signedIn,
  isOwn,
  isFid,
  castIdOf,
  recOf,
  newestFirst,
  dedupe,
  /** a record as a hub card (reply, like and recast work on it; an own persona's is marked) */
  castOf: (r: Rec): Cast => castOf(r, ctxNow),
  userOf: (fid: number): User => userOf(fid, profileNow(fid)),
  ensureProfile,
  profileState: (fid: number): Slot<Profile>["state"] | null => pub().profiles.get(fid)?.state ?? null,
  forgetFailedProfiles: (): void => {
    for (const [fid, slot] of pub().profiles) if (slot.state === "failed") pub().profiles.delete(fid);
  },
  quotesFor,
  fidsFor,
  settle,
  /** SPEC B (For You from the hub): the root's follow list, the SAME read Following makes (one linksByFid paging, cached
   *  with the Following engine; most recently followed first). THROWS HubReadError follows_unreadable when there is none. */
  followsFor: async (rt: HubReadRuntime, acct: HubAccount, retry: boolean): Promise<{ list: number[]; count: number; truncated: boolean; stale: boolean }> => {
    const e = engineFor(acct);
    await followsReady(e, rt, retry);
    const list = e.follows.list!.map((f) => f.fid);
    return { list, count: list.length, truncated: e.follows.truncated, stale: e.follows.refreshFailed };
  },
  /** SPEC B: one cast by id through the shared cache (castById; "missing" is the node's NotFound; "own" is never read) */
  ensureCast: (rt: HubReadRuntime, fid: number, hash: string): Promise<{ v: Rec | null; state: Slot<Rec>["state"] }> => ensureCast(rt, fid, hash),
  pausedUntil: (): number => net().pausedUntil,
  requests: (): number => net().requests,
  FC_EPOCH,
  HASH_RE,
});
