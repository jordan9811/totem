import "server-only";
// FOR YOU FROM THE HUB (SPEC B, docs/roadmap/scope-plan.md §4 B) — a discovery feed for the signed-in root, read by THE
// BROWSER DEVICE straight from a Snapchain node, with no Neynar and nothing passing through Totem's servers, ordered by the
// root's active mode (spec A's shaper, lib/fc/hubRead/mode.ts). Every read goes through the hub read core
// (lib/fc/hubRead/read.ts __hubCore): the same node, the 8-in-flight limiter, the 429 pause, plain GETs with credentials
// omitted and no referrer, and the separation guard (nothing while a persona acts; no path naming an own persona's fid).
//
// THE CANDIDATES, bounded (HUB_FORYOU_LIMITS), and the reads they cost:
//   0. the root's follow list: the SAME read Following makes (C.followsFor, cached with Following's engine);
//   1. ACTIVITY: the follows, most recently followed first, are checked in batches of 40 for their newest like
//      (GET /v1/reactionsByFid?fid=<f>&reaction_type=Like&pageSize=1&reverse=true, ~600 bytes) until 40 of them liked a
//      post in the last 72 hours or 1,000 were checked: the SAMPLE;
//   2. for each sampled follow, as soon as it is found: its newest 25 likes and 25 recasts (reaction_type is required:
//      the real node answers 400 "missing field `reaction_type`" without it) and its newest 50 follows
//      (GET /v1/linksByFid?fid=<f>&link_type=follow&pageSize=50&reverse=true: newest first on the real node);
//   3. (a) POSTS THEY LIKED OR RECAST: each sampled follow brings in at most 2 posts, its newest reactions of the last 72
//      hours, by accounts eligible below (GET /v1/castById), at most 80 a load;
//      (b) ACCOUNTS SEVERAL OF THEM FOLLOW: once the whole sample's follows are in, the accounts followed by at least 2
//      of the sampled follows, most-followed first, the top 30 eligible ones: their newest 5 posts
//      (GET /v1/castsByFid?pageSize=5&reverse=true), those of the last 7 days shown;
//   4. names: the profiles of every candidate's author and of the first two people who liked or recast it, and of the
//      accounts a candidate replies to or mentions when they are eligible (below); quoted posts the same way.
//   ELIGIBLE = not the root, not an account the root follows (that is Following), never an own persona (never read), and
//   IN THE KEYED HALF (below). The mode never changes what is read: every candidate's reads are made whatever the mode,
//   and the mode orders and filters the page afterwards (spec A's rule), so the node cannot tell one mode from another.
//
// MEASURED FIRST (the public node https://snap.farcaster.xyz:3381, read-only, 2026-11-07, one address, 8 in flight):
//   * the 40 most recently FOLLOWED were a poor sample: for fid 2 (1,854 follows) only 6 of them had liked anything in a
//     week; the 40 most recently ACTIVE (by newest like) had all liked within 17 hours. So the sample is found by activity.
//   * the activity check, 1 read per follow, ~607 bytes, p50 31 ms: fid 194 (1,284 follows) found its 40 in 120 checks
//     (0.66 s), fid 2 in 440 (2.0 s), fid 99 (3,131 follows) found 30 in the 1,000-check cap (4.6 s), fid 3 (78 follows)
//     24 in 78 (0.46 s). Every answer 200, none 429, in about 3,500 reads.
//   * a follow's newest 1,000 follows weigh ~365 KB (14.6 MB for 40), the newest 100 ~45 KB, the newest 50 ~24 KB, so 50
//     are read: they span about 10 months (p50 275 to 324 days) for active accounts. Ranking by the follows' WHOLE lists
//     picked long-dormant famous accounts (fid 3: the top 30 had a median newest post 148 days old; 4 had posted in 3
//     days); by their newest 50, 13 to 20 of the top 30 posted in the last week (52 to 90 posts).
//   * 25 likes + 25 recasts per sampled follow: ~13 KB a read, 2 reads each. The posts they liked by accounts the root
//     does not follow, in 72 hours: 39 to 179 distinct per root; most are liked by ONE of the sampled follows (the most
//     shared, 2 to 4).
//   * the whole design, four real roots (2, 194, 3, 99), phases in sequence: 304 to 1,214 node reads, 1.7 to 2.6 MB, 1.7
//     to 5.7 s (the activity check is most of it for a large, quiet graph), 103 to 150 posts to show. p50 29-54 ms, p99
//     37-196 ms, every answer 200, none 429.
//
// THE KEYED HALF (the 2026-11-07 check against personas: a skipped read is a signal). Which accounts For You reads is
// otherwise a deterministic function of public data (the root's follows, their reactions and follows), so the node could
// recompute it and notice the ONE account it should have read and did not: the root's own persona, liked or followed by
// the root's follows. So every account beyond the root's follows passes a keyed coin first: HMAC-SHA256 under a key
// derived from this vault's key (HKDF, info "totem/foryou-half/1"; never stored, never sent) of the account's fid, and it
// is eligible only when the first byte is below 128. The coin is the same in every tab and on every device of this vault,
// so an account that is never read is never more than 2:1 evidence that it is the root's (it is "out" for half of all
// accounts, the same way, every time), whatever the number of sessions. The same coin gates the secondary reads (the
// profiles of accounts a candidate replies to or mentions, and quoted posts) for accounts the root does not follow; one
// it does not admit shows its number, never a guess. Cost: about half the candidates are never shown to this root.
//
// PROGRESSIVE and NEVER FAIL OPEN, like Following: the device answers a snapshot and keeps reading; the island asks again
// while it is loading. What is on screen stays on screen while the feed fills and across a refresh (newer candidates slot
// in by the mode's order; only a mode switch re-orders the page from scratch). A follows read that failed is an error with
// Retry; a feed with nothing to show after a read failed is an ERROR ("not an empty feed"), never an empty state; reads
// that failed beside ones that worked are counted on the page; the three empty states are said only after reads that
// all succeeded. Casts dated more than 10 minutes ahead are left out (counted).
//
// CACHE: tab memory only (a reload re-reads; nothing about the graph is written to disk). A refresh ("Check for new
// posts", at most once a minute; on focus or every two minutes while visible, at most every 10 minutes) re-reads the
// sample's newest reactions and the accounts' newest posts; the activity check and the follows of the follows are redone
// after 30 minutes. A 429 pauses every read from the tab (the core's shared pause) and says so.
//
// PERSONA SEPARATION (SECURITY-POSTURE.md §40): the op is admitted like every hub read (refused acting_persona while a
// persona acts, so a persona acting means ZERO node reads from here; the own set loaded or nothing is read); no read names
// an own persona; an answer put together while a persona is being chosen is refused.
import type { Cast, User } from "@/lib/types";
import { hkdf } from "@noble/hashes/hkdf";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { __hubCore as C, HubReadError, type HubCoreRuntime, type HubRec } from "./read";
import {
  FOR_YOU_SIGNALS_SENTENCE,
  HUB_MODE_ERROR_SENTENCE,
  HUB_READ_SENTENCES,
  forYouCoverageSentence,
  forYouEmptySentence,
  forYouPartialSentence,
  forYouProofSentence,
  hubCastHref,
  pausedSentence,
  profilesFailedSentence,
  type HubForYouProof,
  type HubForYouView,
  type HubModeView,
} from "./copy";
import { shapeForMode, type HubModeSpec } from "./mode";

/** every number the design above names, in one place (the unit suite reads them) */
export const HUB_FORYOU_LIMITS = Object.freeze({
  probeMax: 1000,
  probeBatch: 40,
  sample: 40,
  activeHours: 72,
  reactionsPage: 25,
  likedPerFollow: 2,
  likedMax: 80,
  linksPage: 50,
  minFollowedBy: 2,
  accounts: 30,
  castsPage: 5,
  castsWindowHours: 168,
  /** of 256: an account beyond the root's follows is eligible when its keyed byte is below this (one half) */
  halfOf: 128,
  quoteBudget: 30,
  actorsShown: 2,
  defaultWant: 50,
  maxWant: 200,
  futureSkewMs: 600_000,
  lightFreshMs: 600_000,
  fullFreshMs: 1_800_000,
  manualFloorMs: 60_000,
  waitCapMs: 5000,
});
const F = HUB_FORYOU_LIMITS;
const HOUR = 3_600_000;
type RootAcct = Parameters<typeof C.followsFor>[1];

// ------------------------------------------------------------------------------------------------- the keyed half
export const FOR_YOU_HALF_INFO = "totem/foryou-half/1";
/** the key the half is drawn under, from this vault's key (PURE: the harness pins the derivation with it) */
export function forYouHalfKey(vaultKey: Uint8Array): Uint8Array {
  if (!(vaultKey instanceof Uint8Array) || vaultKey.length < 16) throw new Error("for you: the vault key is not usable");
  return hkdf(sha256, vaultKey, new Uint8Array(0), new TextEncoder().encode(FOR_YOU_HALF_INFO), 32);
}
/** is this account in the keyed half (eligible to be read for For You when it is not one the root follows)? */
export function inForYouHalf(key: Uint8Array, fid: number): boolean {
  return hmac(sha256, key, new TextEncoder().encode("fid:" + fid))[0] < F.halfOf;
}
async function deviceVaultKey(): Promise<Uint8Array> {
  return (await import("@/lib/identity/keystore")).vaultKeyBytes();
}

// ------------------------------------------------------------------------------------------------- the engine
type ReadState = "loading" | "ok" | "failed";
interface Reacted {
  fid: number;
  likers: Set<number>;
  recasters: Set<number>;
}
interface Liked {
  fid: number;
  hash: string;
  state: "loading" | "ok" | "missing" | "failed";
  rec: HubRec | null;
}
interface Acct {
  fid: number;
  state: ReadState;
  recs: HubRec[];
}
interface Run {
  at: number;
  full: boolean;
  followsState: ReadState;
  followsCount: number | null;
  truncated: boolean;
  stale: boolean;
  followed: Set<number>;
  probing: boolean;
  probed: number;
  probeFailed: number;
  /** the sample, in the order it was found */
  active: number[];
  sampled: number;
  /** sampled follows whose reactions or follows could not be read */
  sampleFailed: number;
  likedSelected: number;
  /** the accounts beyond the follows this load reads (their newest posts) */
  accounts: number[];
  done: boolean;
  interrupted: boolean;
  p: Promise<void> | null;
}
interface FEngine {
  fid: number;
  fname: string | null;
  key: Uint8Array | null;
  half: Map<number, boolean>;
  run: Run | null;
  /** the last load that finished (its coverage is what the page says while a refresh runs), and the last FULL one (whose
   *  sample and accounts a light refresh reads again) */
  lastDone: Run | null;
  lastFull: Run | null;
  /** quoted posts asked for (once each; a Retry asks again) */
  quotesAsked: Set<string>;
  /** ACROSS LOADS in this tab: who liked / recast what, who follows whom, the posts and accounts read */
  reactions: Map<string, Reacted>;
  followedBy: Map<number, Set<number>>;
  sampledLinks: Set<number>;
  liked: Map<string, Liked>;
  accts: Map<number, Acct>;
  shown: Set<string>;
  shownMode: string | null;
  want: number;
  refreshedAt: number;
  changed: { p: Promise<void>; fire: () => void };
  shownFids: number[];
}
const gf = globalThis as unknown as { __layersHubForYou?: FEngine | null };
function signal(): FEngine["changed"] {
  let fire = () => {};
  const p = new Promise<void>((r) => (fire = r));
  return { p, fire };
}
function notify(e: FEngine): void {
  const c = e.changed;
  e.changed = signal();
  c.fire();
}
const alive = (e: FEngine) => gf.__layersHubForYou === e;
function engineFor(acct: { fid: number; fname: string | null }): FEngine {
  const cur = gf.__layersHubForYou;
  if (cur && cur.fid === acct.fid) {
    cur.fname = acct.fname;
    return cur;
  }
  // a different root (or none before): nothing of the previous one's For You survives
  const e: FEngine = {
    fid: acct.fid,
    fname: acct.fname,
    key: null,
    half: new Map(),
    run: null,
    lastDone: null,
    lastFull: null,
    quotesAsked: new Set(),
    reactions: new Map(),
    followedBy: new Map(),
    sampledLinks: new Set(),
    liked: new Map(),
    accts: new Map(),
    shown: new Set(),
    shownMode: null,
    want: F.defaultWant,
    refreshedAt: 0,
    changed: signal(),
    shownFids: [],
  };
  gf.__layersHubForYou = e;
  return e;
}
/** reloadIdentity / resetSeed reach this through resetHubReads (lib/fc/hubRead/read.ts) */
export function resetHubForYou(): void {
  gf.__layersHubForYou = null;
}
function half(e: FEngine, fid: number): boolean {
  let v = e.half.get(fid);
  if (v === undefined) {
    // no key = nobody is in the half (fail closed: nothing beyond the follows is read)
    v = !!e.key && inForYouHalf(e.key, fid);
    e.half.set(fid, v);
  }
  return v;
}
/** an account For You may read and show: beyond the root's follows, never an own persona, in the keyed half */
function eligible(e: FEngine, run: Run, fid: number): boolean {
  return fid !== e.fid && !run.followed.has(fid) && !C.isOwn(fid) && half(e, fid);
}
/** an account a candidate replies to or mentions (or quotes): its profile / post is read when the root follows it (or is
 *  it), or it passes the same coin; an own persona's name comes from the vault (the core never reads it) */
function readable(e: FEngine, run: Run, fid: number): boolean {
  if (fid === e.fid || run.followed.has(fid)) return true;
  return !C.isOwn(fid) && half(e, fid);
}

// ------------------------------------------------------------------------------------------------- the reads
function messages(a: Awaited<ReturnType<typeof C.hubGet>>): unknown[] {
  if (a.kind !== "ok" || !Array.isArray(a.json.messages)) throw new Error("malformed");
  return a.json.messages as unknown[];
}
const dataOf = (m: unknown): Record<string, unknown> | null => {
  const d = m && typeof m === "object" ? (m as Record<string, unknown>).data : null;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
};
const tsOf = (d: Record<string, unknown>): number | null => (typeof d.timestamp === "number" && Number.isFinite(d.timestamp) ? C.FC_EPOCH + d.timestamp * 1000 : null);
/** the newest like of a follow (its activity): epoch ms, 0 = no like at all; THROWS when it could not be read */
async function probe(rt: HubCoreRuntime, fid: number): Promise<number> {
  const raw = messages(await C.hubGet(rt, `/v1/reactionsByFid?fid=${fid}&reaction_type=Like&pageSize=1&reverse=true`, "lo"));
  let newest = 0;
  for (const m of raw) {
    const d = dataOf(m);
    if (!d || d.type !== "MESSAGE_TYPE_REACTION_ADD" || d.fid !== fid) continue;
    const ts = tsOf(d);
    if (ts !== null) newest = Math.max(newest, ts);
  }
  return newest;
}
interface Reaction {
  kind: "like" | "recast";
  target: { fid: number; hash: string };
  ts: number;
}
async function reactionsOf(rt: HubCoreRuntime, fid: number, kind: "like" | "recast"): Promise<Reaction[]> {
  const want = kind === "like" ? "REACTION_TYPE_LIKE" : "REACTION_TYPE_RECAST";
  const raw = messages(await C.hubGet(rt, `/v1/reactionsByFid?fid=${fid}&reaction_type=${kind === "like" ? "Like" : "Recast"}&pageSize=${F.reactionsPage}&reverse=true`, "lo"));
  const out: Reaction[] = [];
  for (const m of raw) {
    const d = dataOf(m);
    const b = (d?.reactionBody ?? null) as Record<string, unknown> | null;
    // rebuilt field by field: another account's record, another kind, or one with no target or time is dropped
    if (!d || d.type !== "MESSAGE_TYPE_REACTION_ADD" || d.fid !== fid || !b || b.type !== want) continue;
    const t = C.castIdOf(b.targetCastId);
    const ts = tsOf(d);
    if (!t || ts === null) continue;
    out.push({ kind, target: t, ts });
  }
  return out;
}
async function followsOf(rt: HubCoreRuntime, fid: number): Promise<number[]> {
  const raw = messages(await C.hubGet(rt, `/v1/linksByFid?fid=${fid}&link_type=follow&pageSize=${F.linksPage}&reverse=true`, "lo"));
  const out = new Set<number>();
  for (const m of raw) {
    const d = dataOf(m);
    const lb = (d?.linkBody ?? null) as Record<string, unknown> | null;
    if (!d || d.type !== "MESSAGE_TYPE_LINK_ADD" || d.fid !== fid || !lb || lb.type !== "follow" || !C.isFid(lb.targetFid)) continue;
    out.add(lb.targetFid);
  }
  return [...out];
}
async function castsOf(rt: HubCoreRuntime, fid: number): Promise<HubRec[]> {
  const raw = messages(await C.hubGet(rt, `/v1/castsByFid?fid=${fid}&pageSize=${F.castsPage}&reverse=true`, "hi"));
  // a record under another fid is dropped, never shown under the wrong author
  return C.dedupe(raw.map(C.recOf).filter((r): r is HubRec => !!r && r.fid === fid));
}

// ------------------------------------------------------------------------------------------------- one load
function newRun(at: number, full: boolean): Run {
  return { at, full, followsState: "loading", followsCount: null, truncated: false, stale: false, followed: new Set(), probing: false, probed: 0, probeFailed: 0, active: [], sampled: 0, sampleFailed: 0, likedSelected: 0, accounts: [], done: false, interrupted: false, p: null };
}
/** a read refused because a persona acts is not a failure of the node: the load is marked interrupted (redone later) */
async function failed(rt: HubCoreRuntime, run: Run): Promise<void> {
  if (await rt.acting()) run.interrupted = true;
}
function readLiked(e: FEngine, rt: HubCoreRuntime, l: Liked): void {
  void C.ensureCast(rt, l.fid, l.hash).then((slot) => {
    if (!alive(e)) return;
    if (slot.state === "ok" && slot.v && slot.v.fid === l.fid) {
      l.state = "ok";
      l.rec = slot.v;
    } else l.state = slot.state === "missing" || slot.state === "own" ? "missing" : "failed";
    notify(e);
  });
}
/** one sampled follow: its newest likes and recasts (and the posts they bring in), and, on a full load, its newest follows */
async function sample(e: FEngine, rt: HubCoreRuntime, run: Run, fid: number): Promise<void> {
  const [like, recast, links] = await Promise.allSettled([reactionsOf(rt, fid, "like"), reactionsOf(rt, fid, "recast"), run.full ? followsOf(rt, fid) : Promise.resolve(null)]);
  if (!alive(e) || e.run !== run) return;
  let bad = false;
  const mine: Reaction[] = [];
  for (const r of [like, recast]) {
    if (r.status === "fulfilled") mine.push(...r.value);
    else bad = true;
  }
  for (const r of mine) {
    let x = e.reactions.get(r.target.hash);
    if (!x) {
      x = { fid: r.target.fid, likers: new Set(), recasters: new Set() };
      e.reactions.set(r.target.hash, x);
    }
    (r.kind === "like" ? x.likers : x.recasters).add(fid);
  }
  // the posts this follow brings in: its newest reactions of the window, by eligible accounts, at most likedPerFollow
  const since = rt.now() - F.activeHours * HOUR;
  let took = 0;
  for (const r of mine.sort((a, b) => b.ts - a.ts)) {
    if (took >= F.likedPerFollow || run.likedSelected >= F.likedMax) break;
    if (r.ts < since || e.liked.has(r.target.hash) || !eligible(e, run, r.target.fid)) continue;
    const l: Liked = { fid: r.target.fid, hash: r.target.hash, state: "loading", rec: null };
    e.liked.set(r.target.hash, l);
    run.likedSelected++;
    took++;
    readLiked(e, rt, l);
  }
  if (links.status === "fulfilled") {
    if (links.value) {
      e.sampledLinks.add(fid);
      for (const t of links.value) {
        if (t === e.fid) continue;
        let s = e.followedBy.get(t);
        if (!s) e.followedBy.set(t, (s = new Set()));
        s.add(fid);
      }
    }
  } else bad = true;
  if (bad) {
    run.sampleFailed++;
    await failed(rt, run);
  }
  run.sampled++;
  notify(e);
}
async function load(e: FEngine, rt: HubCoreRuntime, run: Run, acct: RootAcct, retry: boolean, reuse: number[] | null): Promise<void> {
  let follows: Awaited<ReturnType<typeof C.followsFor>>;
  try {
    follows = await C.followsFor(rt, acct, retry);
  } catch {
    if (!alive(e) || e.run !== run) return;
    run.followsState = "failed";
    await failed(rt, run);
    return;
  }
  if (!alive(e) || e.run !== run) return;
  run.followsState = "ok";
  run.followsCount = follows.count;
  run.truncated = follows.truncated;
  run.stale = follows.stale;
  run.followed = new Set(follows.list);
  notify(e);
  // PERSONA SEPARATION: an own persona the root follows is never read (as on Following)
  const list = follows.list.filter((f) => f !== e.fid && !C.isOwn(f));
  const reads: Promise<void>[] = [];
  if (reuse) {
    // a light refresh: the last load's sample again (still followed), its reactions re-read
    for (const f of reuse) if (run.followed.has(f) && !C.isOwn(f)) run.active.push(f);
    for (const f of run.active) reads.push(sample(e, rt, run, f));
  } else {
    run.probing = true;
    const max = Math.min(list.length, F.probeMax);
    for (let i = 0; i < max && run.active.length < F.sample; i += F.probeBatch) {
      const batch = list.slice(i, Math.min(i + F.probeBatch, max));
      const got = await Promise.allSettled(batch.map((f) => probe(rt, f)));
      if (!alive(e) || e.run !== run) return;
      run.probed += batch.length;
      const since = rt.now() - F.activeHours * HOUR;
      for (let j = 0; j < batch.length; j++) {
        const g = got[j];
        if (g.status === "rejected") {
          run.probeFailed++;
          continue;
        }
        // the first `sample` follows, in follow order, that liked a post in the window
        if (g.value >= since && run.active.length < F.sample) {
          run.active.push(batch[j]);
          reads.push(sample(e, rt, run, batch[j]));
        }
      }
      if (run.probeFailed) await failed(rt, run);
      notify(e);
    }
    run.probing = false;
    notify(e);
  }
  await Promise.all(reads);
  if (!alive(e) || e.run !== run) return;
  // ACCOUNTS SEVERAL OF THEM FOLLOW: ranked by how many sampled follows follow them, then by fid; the top eligible ones
  // (on a light refresh, the last full load's accounts again)
  const accounts = reuse
    ? (e.lastFull?.accounts ?? []).filter((f) => eligible(e, run, f))
    : [...e.followedBy.entries()]
        .filter(([f, s]) => [...s].filter((x) => run.followed.has(x)).length >= F.minFollowedBy && eligible(e, run, f))
        .map(([f, s]) => [f, [...s].filter((x) => run.followed.has(x)).length] as const)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, F.accounts)
        .map(([f]) => f);
  run.accounts = accounts;
  notify(e);
  await Promise.all(
    accounts.map(async (f) => {
      const prev = e.accts.get(f);
      const a: Acct = prev ?? { fid: f, state: "loading", recs: [] };
      if (!prev) e.accts.set(f, a);
      else if (a.state === "failed") a.state = "loading";
      try {
        const recs = await castsOf(rt, f);
        if (!alive(e)) return;
        // a re-read keeps what was read before (nothing on screen blinks out) and adds what is new
        a.recs = C.dedupe([...recs, ...a.recs]).slice(0, F.castsPage * 4);
        a.state = "ok";
      } catch {
        if (!alive(e)) return;
        // a failed RE-read keeps what was read (still ok); a first read that failed is counted
        if (!a.recs.length) a.state = "failed";
        await failed(rt, run);
      } finally {
        if (alive(e)) notify(e);
      }
    })
  );
}
/** start a load when one is due: the first, a refresh past its floor, a retry, or one a persona's switch interrupted. A
 *  follows list that could not be read is not re-read before Retry (the core keeps its failure: C.followsFor with retry
 *  false answers it without a read), so the island asking again while loading never costs a read per ask */
function start(e: FEngine, rt: HubCoreRuntime, acct: RootAcct, refresh: "auto" | "manual" | null, retry: boolean): void {
  const run = e.run;
  const now = rt.now();
  let reuse: number[] | null = null;
  if (run) {
    if (run.p) return;
    if (!retry && !run.interrupted) {
      const age = now - run.at;
      const due = refresh === "manual" ? age >= F.manualFloorMs : refresh === "auto" ? age >= F.lightFreshMs : false;
      if (!due) return;
      // a light refresh while the last full load's sample is fresh: its reactions and the accounts' newest posts only
      const full = e.lastFull;
      if (full && now - full.at < F.fullFreshMs && full.active.length) reuse = [...full.active];
    }
  }
  if (retry || run?.interrupted) {
    // what failed is read again (an earlier good read stays); after a persona's switch, what its refusals marked failed
    for (const [h, l] of e.liked) if (l.state === "failed") e.liked.delete(h);
    for (const [f, a] of e.accts) if (a.state === "failed") e.accts.delete(f);
    e.quotesAsked.clear();
    C.forgetFailedProfiles();
  }
  const next = newRun(now, reuse === null);
  if (reuse && e.lastFull) next.probed = e.lastFull.probed;
  e.run = next;
  if (refresh || retry) e.refreshedAt = now;
  // the follows are re-asked after a Retry, or after a load a persona's switch interrupted (its refusal is not the node's)
  next.p = load(e, rt, next, acct, retry || !!run?.interrupted, reuse)
    .catch(() => {
      next.interrupted = true;
    })
    .finally(() => {
      next.p = null;
      next.done = true;
      next.probing = false;
      if (!alive(e)) return;
      if (next.followsState === "ok" && !next.interrupted) {
        e.lastDone = next;
        if (next.full) e.lastFull = next;
      }
      notify(e);
    });
}

// ------------------------------------------------------------------------------------------------- the page
interface Cand {
  rec: HubRec;
  proof: { likes: number; recasts: number; followedBy: number; actors: number[] };
}
/** every candidate read (newest first), and the future-dated ones left out */
function candidates(e: FEngine, run: Run, now: number): { list: Cand[]; future: number } {
  const limit = now + F.futureSkewMs;
  const since = now - F.castsWindowHours * HOUR;
  const recs: HubRec[] = [];
  let future = 0;
  const seen = new Set<string>();
  const followed = run.followsState === "ok" ? run.followed : (e.lastDone?.followed ?? new Set<number>());
  const take = (r: HubRec, windowed: boolean) => {
    if (seen.has(r.hash)) return;
    seen.add(r.hash);
    if (r.ts > limit) {
      future++;
      return;
    }
    if (windowed && r.ts < since) return;
    // checked again at show time: an account followed (or found to be own) since it was read goes to Following
    if (r.fid === e.fid || followed.has(r.fid) || C.isOwn(r.fid)) return;
    recs.push(r);
  };
  for (const l of e.liked.values()) if (l.state === "ok" && l.rec) take(l.rec, false);
  for (const a of e.accts.values()) if (a.state === "ok") for (const r of a.recs) take(r, true);
  const list = C.dedupe(recs).map((rec) => {
    const x = e.reactions.get(rec.hash);
    const likers = x ? [...x.likers].filter((f) => followed.has(f)) : [];
    const recasters = x ? [...x.recasters].filter((f) => followed.has(f)) : [];
    const by = e.followedBy.get(rec.fid);
    return { rec, proof: { likes: likers.length, recasts: recasters.length, followedBy: by ? [...by].filter((f) => followed.has(f)).length : 0, actors: [...new Set([...likers, ...recasters])] } };
  });
  return { list, future };
}
/** the reads every candidate needs, made for ALL of them whatever the mode (so the node cannot tell one mode from another) */
function namesFor(e: FEngine, rt: HubCoreRuntime, run: Run, list: Cand[]): number[] {
  const fids = new Set<number>();
  let quotes = 0;
  for (const c of list) {
    fids.add(c.rec.fid);
    for (const a of c.proof.actors.slice(0, F.actorsShown)) fids.add(a);
    if (c.rec.parent && readable(e, run, c.rec.parent.fid)) fids.add(c.rec.parent.fid);
    for (const m of c.rec.mentions) if (readable(e, run, m)) fids.add(m);
    for (const em of c.rec.embeds) {
      if (!("castId" in em) || quotes >= F.quoteBudget || !readable(e, run, em.castId.fid)) continue;
      quotes++;
      if (e.quotesAsked.has(em.castId.hash)) continue;
      e.quotesAsked.add(em.castId.hash);
      void C.ensureCast(rt, em.castId.fid, em.castId.hash);
    }
  }
  for (const f of fids) void C.ensureProfile(rt, f);
  return [...fids];
}
type ModeAnswer = { spec: HubModeSpec | null } | { error: string };
function nameOf(fid: number): string {
  const u = C.userOf(fid);
  return u.displayName || "@" + u.username;
}
function proofOf(c: Cand): HubForYouProof {
  const actors: User[] = c.proof.actors.slice(0, F.actorsShown).map((f) => C.userOf(f));
  return {
    likes: c.proof.likes,
    recasts: c.proof.recasts,
    followedBy: c.proof.followedBy,
    actors,
    sentence: forYouProofSentence({ likes: c.proof.likes, recasts: c.proof.recasts, followedBy: c.proof.followedBy, actorCount: c.proof.actors.length, names: c.proof.actors.slice(0, F.actorsShown).map(nameOf) }),
  };
}
/** the candidates under the root's mode (spec A's shaper, For You's signals); no mode (the node harness): newest first */
function shaped(e: FEngine, list: Cand[], mode: ModeAnswer, now: number): { items: Cand[]; view: HubModeView | null } {
  const base = { id: null, name: null, reason: null, of: list.length, hidden: 0, hidAll: false, sentence: null, pinned: [], quiet: [], ranked: false, strip: [], gaps: [], tiers: { accounts: 0, unreadable: null } };
  if ("error" in mode) return { items: [], view: { ...base, state: "error", reason: mode.error } };
  const spec = mode.spec;
  if (!spec) return { items: list, view: null };
  const denom = Math.max(1, e.sampledLinks.size);
  const posts = list.map((c) => ({ hash: c.rec.hash, fid: c.rec.fid, ts: c.rec.ts, text: c.rec.text, reply: !!c.rec.parent, embeds: c.rec.embeds.length, proof: { likes: c.proof.likes, recasts: c.proof.recasts, affinity: Math.min(1, c.proof.followedBy / denom) }, c }));
  const s = shapeForMode(posts, spec, { now, want: e.want, surface: "foryou" });
  return {
    items: s.items.map((p) => p.c),
    view: {
      state: "ok",
      id: spec.id,
      name: spec.name,
      reason: null,
      of: list.length,
      hidden: s.hidden,
      hidAll: list.length > 0 && s.items.length === 0,
      sentence: s.sentence,
      pinned: [...s.pinned],
      quiet: [...s.quiet],
      ranked: s.ranked,
      strip: s.banner.map((p) => {
        const text = C.castOf(p.c.rec).text;
        return { hash: p.hash, fid: p.fid, handle: C.userOf(p.fid).username, text: text.length > 90 ? text.slice(0, 89) + "…" : text, minutesAgo: Math.max(0, Math.round((now - p.ts) / 60_000)), href: hubCastHref(p.fid, p.hash) };
      }),
      gaps: s.gaps,
      tiers: { accounts: spec.tiers.size, unreadable: s.tiersSentence },
    },
  };
}
function settledNow(e: FEngine, run: Run): boolean {
  if (!run.done) return false;
  for (const l of e.liked.values()) if (l.state === "loading") return false;
  for (const a of e.accts.values()) if (a.state === "loading") return false;
  return true;
}
function busy(e: FEngine): boolean {
  const run = e.run;
  if (!run) return false;
  if (!settledNow(e, run)) return true;
  return e.shownFids.some((f) => C.profileState(f) === "loading");
}
function view(e: FEngine, rt: HubCoreRuntime, mode: ModeAnswer): HubForYouView {
  const now = rt.now();
  const run = e.run as Run;
  const cov = run.done || !e.lastDone ? run : e.lastDone;
  const { list, future } = candidates(e, run, now);
  const fids = namesFor(e, rt, run, list);
  const sh = shaped(e, list, mode, now);
  // what is on screen stays on screen (newer candidates slot in by the mode's order); a mode switch starts the page over
  const modeKey = "spec" in mode && mode.spec ? mode.spec.id : "error" in mode ? "!error" : "";
  if (modeKey !== e.shownMode) {
    e.shownMode = modeKey;
    e.shown = new Set();
  }
  const page = sh.items.filter((c, i) => i < e.want || e.shown.has(c.rec.hash)).slice(0, F.maxWant);
  e.shown = new Set(page.map((c) => c.rec.hash));
  e.shownFids = fids;
  const settled = settledNow(e, run);
  const likedFailed = [...e.liked.values()].filter((l) => l.state === "failed").length;
  const acctsFailed = [...e.accts.values()].filter((a) => a.state === "failed").length;
  const followsFailedNow = cov.probeFailed + cov.sampleFailed;
  const anyFail = followsFailedNow + likedFailed + acctsFailed > 0;
  const followsError = run.followsState === "failed" && cov.followsState !== "ok";
  const nothing = settled && list.length === 0 && anyFail;
  const code = followsError ? ("follows_unreadable" as const) : nothing ? ("foryou_unreadable" as const) : null;
  // ready only once the names are in too (the authors, who liked it, who it replies to and mentions)
  const profilesLoading = fids.some((f) => C.profileState(f) === "loading");
  const state: HubForYouView["state"] = code ? "error" : settled && !profilesLoading ? "ready" : "loading";
  const authorsFailed = [...new Set(page.map((c) => c.rec.fid))].filter((f) => C.profileState(f) === "failed").length;
  let empty: HubForYouView["empty"] = null;
  if (state === "ready" && !anyFail && list.length === 0) {
    const kind = (cov.followsCount ?? 0) === 0 ? "follows-none" : cov.active.length === 0 ? "none-active" : "nothing-new";
    empty = { kind, sentence: forYouEmptySentence(kind, cov.probed, F.activeHours) };
  }
  const until = C.pausedUntil();
  const proof: Record<string, HubForYouProof> = {};
  if (!code) for (const c of page) proof[c.rec.hash] = proofOf(c);
  return {
    state,
    code,
    reason: code ? HUB_READ_SENTENCES[code] : null,
    account: { fid: e.fid, fname: e.fname },
    follows: { state: cov.followsState === "ok" ? "ok" : cov.followsState === "failed" ? "error" : "loading", count: cov.followsCount, truncated: cov.truncated, stale: cov.stale },
    coverage: {
      probed: cov.probed,
      active: cov.active.length,
      accounts: cov.accounts.length,
      windowHours: F.activeHours,
      sentence: cov.followsState === "ok" && (cov.done || cov.active.length > 0) && (cov.followsCount ?? 0) > 0 ? forYouCoverageSentence(cov.active.length, cov.accounts.length, F.activeHours) : null,
    },
    progress: { probing: run.probing, sampled: run.sampled, of: run.active.length },
    items: code ? [] : page.map((c): Cast => C.castOf(c.rec)),
    proof,
    mode: code ? null : sh.view,
    signals: code || !sh.view || sh.view.state !== "ok" ? null : FOR_YOU_SIGNALS_SENTENCE,
    more: !code && sh.items.length > page.length,
    loading: state === "loading",
    paused: until > Date.now() ? { until, sentence: pausedSentence((until - Date.now()) / 1000) } : null,
    partial: !code && anyFail ? { failed: followsFailedNow + likedFailed + acctsFailed, sentence: forYouPartialSentence({ follows: followsFailedNow, posts: likedFailed, accounts: acctsFailed }) } : null,
    profilesFailed: !code && authorsFailed ? { failed: authorsFailed, sentence: profilesFailedSentence(authorsFailed) } : null,
    empty,
    futureDated: future,
    refreshedAt: e.refreshedAt || null,
    requests: C.requests(),
  };
}
function notSignedIn(): HubForYouView {
  return {
    state: "not_signed_in",
    code: "not_signed_in",
    reason: HUB_READ_SENTENCES.not_signed_in,
    account: null,
    follows: { state: "loading", count: null, truncated: false, stale: false },
    coverage: { probed: 0, active: 0, accounts: 0, windowHours: F.activeHours, sentence: null },
    progress: { probing: false, sampled: 0, of: 0 },
    items: [],
    proof: {},
    mode: null,
    signals: null,
    more: false,
    loading: false,
    paused: null,
    partial: null,
    profilesFailed: null,
    empty: null,
    futureDated: 0,
    refreshedAt: null,
    requests: 0,
  };
}

// ------------------------------------------------------------------------------------------------- the op
/** For You: a snapshot of what is in, with the reads it needs started (not awaited past `waitMs`) */
export async function hubForYou(opts: { want?: number; refresh?: "auto" | "manual" | null; retry?: boolean; waitMs?: number } = {}): Promise<HubForYouView> {
  const rt = C.gate();
  await C.admit(rt);
  const acct = await C.signedIn(rt);
  if (!acct) return notSignedIn();
  C.hubBase(rt); // misconfigured: say so before any read
  const e = engineFor(acct);
  if (typeof opts.want === "number" && Number.isFinite(opts.want)) e.want = Math.min(F.maxWant, Math.max(10, Math.floor(opts.want)));
  // the keyed half, once per engine: no key = nothing beyond the follows could be told apart, so nothing is read
  if (!e.key) {
    try {
      e.key = forYouHalfKey(await (rt.halfKey ?? deviceVaultKey)());
      e.half.clear();
    } catch {
      throw new HubReadError("vault");
    }
  }
  if (opts.retry) C.forgetFailedProfiles();
  start(e, rt, acct, opts.refresh ?? null, !!opts.retry);
  const deadline = Date.now() + Math.min(F.waitCapMs, Math.max(0, opts.waitMs ?? 0));
  // a short wait for progress; a profile read does not signal this engine, so the wait also looks again every 50 ms
  while (Date.now() < deadline && busy(e)) await Promise.race([e.changed.p, new Promise<void>((r) => setTimeout(r, Math.max(0, Math.min(50, deadline - Date.now()))))]);
  // SPEC A's dial: the root's active mode, read from this device on every answer (a switch shows on the next one)
  let mode: ModeAnswer;
  try {
    mode = { spec: await rt.mode() };
  } catch (err) {
    mode = { error: err instanceof Error && err.name === "HubModeError" ? err.message : HUB_MODE_ERROR_SENTENCE };
  }
  // PERSONA SEPARATION: a persona chosen while this answer was being put together gets nothing of the root's
  if (await rt.acting()) throw new HubReadError("acting_persona");
  return view(e, rt, mode);
}
