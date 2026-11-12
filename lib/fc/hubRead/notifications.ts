import "server-only";
// NOTIFICATIONS FROM FARCASTER — the signed-in root's real Farcaster notifications, read by THE BROWSER DEVICE straight
// from a Snapchain node, with no Neynar and nothing passing through Totem's servers. Every read goes through the hub
// read core (lib/fc/hubRead/read.ts __hubCore): the same node, the 8-in-flight limiter, the 429 pause, plain GETs with
// credentials omitted and no referrer, and the separation guard (nothing while a persona acts; no path naming an own
// persona's fid, `fid=` or `target_fid=`). Each read names the ROOT only:
//   GET /v1/linksByTargetFid?target_fid=<root>&link_type=follow&pageSize=50&reverse=true      who followed the root
//   GET /v1/castsByMention?fid=<root>&pageSize=50&reverse=true                                posts that mention it
//   GET /v1/castsByFid?fid=<root>&pageSize=25&reverse=true                                    the root's newest 25 posts
//   for each of those 25:
//     GET /v1/castsByParent?fid=<root>&hash=<h>&pageSize=50&reverse=true                      the replies to it
//     GET /v1/reactionsByCast?target_fid=<root>&target_hash=<h>&reaction_type=Like|Recast&pageSize=100&reverse=true
//   GET /v1/userDataByFid?fid=<f>   the profiles of what is on screen only (the first 5 accounts of a group), cached
//
// MEASURED FIRST (the public node https://snap.farcaster.xyz:3381, read-only, 2026-11-06, from one address):
//   * every by-target index (linksByTargetFid, castsByMention, castsByParent, reactionsByCast) is answered PER SHARD: a
//     pageSize of 5 returns up to 10 (two shards, each its own newest 5, concatenated, so the page is not in order). The
//     union of one page holds the exact newest `pageSize` across shards, so ONE page is read and merged here; nothing
//     past it is claimed.
//   * their page tokens cannot be trusted: castsByParent ALWAYS returns a token, even with 0 replies, and following it
//     starts the list over (3 replies came back 12 times in 12 pages); reactionsByCast's pages repeat items across
//     shards (114 items, 65 distinct). So no token is followed: "there may be more" is "a page was full" (atLeast).
//   * with no pageSize, linksByTargetFid answers 10,000 per shard (9.9 MB, 12 s for fid 194): a pageSize always rides.
//   * Snapchain's reaction names: reaction_type=Like|Recast (REACTION_TYPE_LIKE is a 400 "unknown variant"), and
//     reactionsByCast wants target_fid + target_hash (fid + hash is a 400 "missing field `target_fid`").
//   * the whole fan-out, five real roots: 78 node reads before profiles (3 + 25 x 3) for any root with 25 posts; with the
//     profiles on screen 224 to 284 reads, 0.65 to 3.0 MB, 1.0 to 1.6 s at 8 in flight; a new account (one follower,
//     no posts) 4 reads in 61 ms. p50 30-33 ms, p99 52-174 ms; every answer 200, none 429.
// THE DESIGN THOSE LED TO:
//   * the window, said on the page: the newest 50 followers, the newest 50 mentions, and the replies, likes and recasts
//     on the root's newest 25 posts (HUB_NOTIF_LIMITS); a list of at most 100 notifications;
//   * grouped like X: likes and recasts per post, follows per day ("Alice, Bob and 12 others liked your post"), each split
//     at the last time they were seen (so the new ones are their own group); replies and mentions one by one, each a hub
//     card (reply, like and recast work on it, components/hub/HubWrite.tsx); newest first;
//   * INCREMENTAL: the three head reads at most once a minute (twice a minute for "Check now"); each post's replies and
//     reactions on its own clock (a tenth of its age, between 1 and 30 minutes), so a quiet tab costs about 4 reads a
//     minute, not 78; a cache in tab memory only (a reload re-reads); the badge's reads ride the limiter's low lane,
//     behind Following's own reads on the same page, and the page's the high lane;
//   * UNREAD from a sealed record (lib/fc/hubRead/seen.ts, the vault, never plaintext): what is newer than the last time
//     the root saw its notifications, on any of its devices;
//   * NEVER FAIL OPEN: nothing read and a read failed = an error with Retry, never "no notifications"; a failed read with
//     others working is counted on the page ("Couldn't read your mentions just now"), and an earlier good read stays
//     shown; "No notifications yet" only after every read succeeded; an unreadable seen record is said, and the badge
//     then says it cannot tell (never 0);
//   * events dated more than 10 minutes ahead are left out (counted): one would otherwise sit on top for ever, and mark
//     everything below it seen.
//
// PERSONA SEPARATION (SECURITY-POSTURE.md §37): every op is admitted like every hub read (refused acting_persona while a
// persona acts; the own set loaded or nothing is read), every path names the root, and what a persona did (followed,
// mentioned, replied, liked, recast) is LEFT OUT: its profile is never read and it is not shown on the root's screen.
import type { Cast, User } from "@/lib/types";
import { __hubCore as C, HubReadError, type HubCoreRuntime, type HubRec } from "./read";
import {
  HUB_READ_SENTENCES,
  NOTIF_SEEN_UNREADABLE_SENTENCE,
  notifPartialSentence,
  pausedSentence,
  profilesFailedSentence,
  type HubAccountView,
  type HubNotifKind,
  type HubNotifTab,
  type HubNotificationItem,
  type HubNotificationsView,
  type HubUnreadView,
} from "./copy";

/** every number the design above names, in one place (the unit suite reads them) */
export const HUB_NOTIF_LIMITS = Object.freeze({
  followers: 50,
  mentions: 50,
  posts: 25,
  repliesPage: 50,
  reactionsPage: 100,
  maxItems: 100,
  actorsShown: 5,
  headFreshMs: 60_000,
  manualFloorMs: 30_000,
  minRecheckMs: 60_000,
  maxRecheckMs: 1_800_000,
  futureSkewMs: 600_000,
  waitCapMs: 5000,
  profileWaitMs: 3000,
});
const P = HUB_NOTIF_LIMITS;
type Lane = "hi" | "lo";

// ------------------------------------------------------------------------------------------------- the engine
interface Ev {
  /** who: the follower, or the account that liked or recast */
  fid: number;
  ts: number;
  hash: string;
}
interface Src<T> {
  /** null until a read succeeded (then the last good read, kept through a failed re-read) */
  items: T[] | null;
  /** "failed": the LAST read failed (counted on the page, whatever `items` holds) */
  state: "idle" | "loading" | "ok" | "failed";
  /** when the last read started */
  at: number;
  /** the node's page was full: there may be more than were read */
  capped: boolean;
  p: Promise<void> | null;
}
interface PostSrc {
  rec: HubRec;
  replies: Src<HubRec>;
  like: Src<Ev>;
  recast: Src<Ev>;
  checkedAt: number;
}
interface NEngine {
  fid: number;
  fname: string | null;
  followers: Src<Ev>;
  mentions: Src<HubRec>;
  own: Src<HubRec>;
  posts: Map<string, PostSrc>;
  refreshedAt: number;
  changed: { p: Promise<void>; fire: () => void };
  /** the fids the last page answer showed (their profiles are waited for) */
  shownFids: number[];
  /** the posts' check waits for the root's newest posts being re-read (still "reading" until it has started) */
  postsDeferred: boolean;
}
const gn = globalThis as unknown as { __layersHubNotif?: NEngine | null };
const src = <T>(): Src<T> => ({ items: null, state: "idle", at: 0, capped: false, p: null });
function signal(): NEngine["changed"] {
  let fire = () => {};
  const p = new Promise<void>((r) => (fire = r));
  return { p, fire };
}
function notify(e: NEngine): void {
  const c = e.changed;
  e.changed = signal();
  c.fire();
}
const alive = (e: NEngine) => gn.__layersHubNotif === e;
function engineFor(acct: { fid: number; fname: string | null }): NEngine {
  const cur = gn.__layersHubNotif;
  if (cur && cur.fid === acct.fid) {
    cur.fname = acct.fname;
    return cur;
  }
  // a different root (or none before): nothing of the previous one's notifications survives
  const e: NEngine = { fid: acct.fid, fname: acct.fname, followers: src(), mentions: src(), own: src(), posts: new Map(), refreshedAt: 0, changed: signal(), shownFids: [], postsDeferred: false };
  gn.__layersHubNotif = e;
  return e;
}
/** reloadIdentity / resetSeed reach this through resetHubReads (lib/fc/hubRead/read.ts) */
export function resetHubNotifications(): void {
  gn.__layersHubNotif = null;
}

// ------------------------------------------------------------------------------------------------- the reads
type Loaded<T> = { items: T[]; capped: boolean };
function messages(a: Awaited<ReturnType<typeof C.hubGet>>): unknown[] {
  if (a.kind !== "ok" || !Array.isArray(a.json.messages)) throw new Error("malformed");
  return a.json.messages as unknown[];
}
const data = (m: unknown): Record<string, unknown> | null => {
  const d = m && typeof m === "object" ? (m as Record<string, unknown>).data : null;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
};
const hashOf = (m: unknown): string => {
  const h = m && typeof m === "object" ? (m as Record<string, unknown>).hash : null;
  return typeof h === "string" ? h.toLowerCase() : "";
};
const evNewest = (a: Ev, b: Ev): number => b.ts - a.ts || a.fid - b.fid;
/** one event per account (its newest), newest first, the exact newest `limit` of the merged shards */
function topEvents(list: Ev[], limit: number): Ev[] {
  const best = new Map<number, Ev>();
  for (const ev of list) {
    const cur = best.get(ev.fid);
    if (!cur || cur.ts < ev.ts) best.set(ev.fid, ev);
  }
  return [...best.values()].sort(evNewest).slice(0, limit);
}
async function loadFollowers(rt: HubCoreRuntime, lane: Lane, root: number): Promise<Loaded<Ev>> {
  const raw = messages(await C.hubGet(rt, `/v1/linksByTargetFid?target_fid=${root}&link_type=follow&pageSize=${P.followers}&reverse=true`, lane));
  const evs: Ev[] = [];
  for (const m of raw) {
    const d = data(m);
    const lb = (d?.linkBody ?? null) as Record<string, unknown> | null;
    // rebuilt field by field: a link of another kind, to another account, or with no time is dropped
    if (!d || d.type !== "MESSAGE_TYPE_LINK_ADD" || !lb || lb.type !== "follow" || lb.targetFid !== root || !C.isFid(d.fid) || typeof d.timestamp !== "number" || !Number.isFinite(d.timestamp)) continue;
    evs.push({ fid: d.fid, ts: C.FC_EPOCH + d.timestamp * 1000, hash: hashOf(m) });
  }
  return { items: topEvents(evs, P.followers), capped: raw.length >= P.followers };
}
const mentionsRoot = (m: unknown, root: number): boolean => {
  const b = (data(m)?.castAddBody ?? null) as Record<string, unknown> | null;
  return !!b && Array.isArray(b.mentions) && b.mentions.includes(root);
};
function newestRecs(recs: Array<HubRec | null>, limit: number): HubRec[] {
  return C.dedupe(recs.filter((r): r is HubRec => !!r)).slice(0, limit);
}
async function loadMentions(rt: HubCoreRuntime, lane: Lane, root: number): Promise<Loaded<HubRec>> {
  const raw = messages(await C.hubGet(rt, `/v1/castsByMention?fid=${root}&pageSize=${P.mentions}&reverse=true`, lane));
  // a cast that does not mention the root is dropped, never shown as a mention
  return { items: newestRecs(raw.filter((m) => mentionsRoot(m, root)).map(C.recOf), P.mentions), capped: raw.length >= P.mentions };
}
async function loadOwn(rt: HubCoreRuntime, lane: Lane, root: number): Promise<Loaded<HubRec>> {
  const raw = messages(await C.hubGet(rt, `/v1/castsByFid?fid=${root}&pageSize=${P.posts}&reverse=true`, lane));
  // a record under another fid is dropped: only the root's own posts carry its notifications
  return { items: newestRecs(raw.map(C.recOf).filter((r) => !!r && r.fid === root), P.posts), capped: false };
}
async function loadReplies(rt: HubCoreRuntime, lane: Lane, root: number, hash: string): Promise<Loaded<HubRec>> {
  const raw = messages(await C.hubGet(rt, `/v1/castsByParent?fid=${root}&hash=${hash}&pageSize=${P.repliesPage}&reverse=true`, lane));
  const recs = raw.map(C.recOf).filter((r) => !!r && !!r.parent && r.parent.fid === root && r.parent.hash === hash);
  // the node's castsByParent token never ends (it starts over), so "there may be more" is only "a full page"
  return { items: newestRecs(recs, P.repliesPage), capped: raw.length >= P.repliesPage };
}
async function loadReactions(rt: HubCoreRuntime, lane: Lane, root: number, hash: string, kind: "like" | "recast"): Promise<Loaded<Ev>> {
  const want = kind === "like" ? "REACTION_TYPE_LIKE" : "REACTION_TYPE_RECAST";
  const raw = messages(await C.hubGet(rt, `/v1/reactionsByCast?target_fid=${root}&target_hash=${hash}&reaction_type=${kind === "like" ? "Like" : "Recast"}&pageSize=${P.reactionsPage}&reverse=true`, lane));
  const evs: Ev[] = [];
  for (const m of raw) {
    const d = data(m);
    const b = (d?.reactionBody ?? null) as Record<string, unknown> | null;
    const t = b ? C.castIdOf(b.targetCastId) : null;
    // rebuilt field by field: another kind, another post, or a record with no account or time is dropped
    if (!d || d.type !== "MESSAGE_TYPE_REACTION_ADD" || !b || b.type !== want || !t || t.fid !== root || t.hash !== hash || !C.isFid(d.fid) || typeof d.timestamp !== "number" || !Number.isFinite(d.timestamp)) continue;
    evs.push({ fid: d.fid, ts: C.FC_EPOCH + d.timestamp * 1000, hash: hashOf(m) });
  }
  return { items: topEvents(evs, P.reactionsPage), capped: raw.length >= P.reactionsPage };
}

/** one source's read: a failure is "failed" (counted), never an empty list; an earlier good read stays */
function run<T>(e: NEngine, rt: HubCoreRuntime, s: Src<T>, load: () => Promise<Loaded<T>>, then?: () => void): Promise<void> {
  if (s.p) return s.p;
  s.at = rt.now();
  if (s.items === null) s.state = "loading";
  const p = load()
    .then((r) => {
      if (!alive(e)) return;
      s.items = r.items;
      s.capped = r.capped;
      s.state = "ok";
      then?.();
    })
    .catch(() => {
      if (!alive(e)) return;
      s.state = "failed";
    })
    .finally(() => {
      s.p = null;
      if (alive(e)) notify(e);
    });
  s.p = p;
  return p;
}
function readPost(e: NEngine, rt: HubCoreRuntime, lane: Lane, ps: PostSrc, only: "all" | "failed"): void {
  ps.checkedAt = rt.now();
  const go = <T>(s: Src<T>, load: () => Promise<Loaded<T>>) => {
    if (only === "all" || s.state === "failed" || s.state === "idle") void run(e, rt, s, load);
  };
  go(ps.replies, () => loadReplies(rt, lane, e.fid, ps.rec.hash));
  go(ps.like, () => loadReactions(rt, lane, e.fid, ps.rec.hash, "like"));
  go(ps.recast, () => loadReactions(rt, lane, e.fid, ps.rec.hash, "recast"));
}
/** the window follows the root's newest posts: a new post is read at once, one that fell out goes */
function reconcilePosts(e: NEngine, rt: HubCoreRuntime, lane: Lane): void {
  const recs = e.own.items ?? [];
  const keep = new Set(recs.map((r) => r.hash));
  for (const h of [...e.posts.keys()]) if (!keep.has(h)) e.posts.delete(h);
  for (const r of recs) {
    if (e.posts.has(r.hash)) continue;
    const ps: PostSrc = { rec: r, replies: src(), like: src(), recast: src(), checkedAt: 0 };
    e.posts.set(r.hash, ps);
    readPost(e, rt, lane, ps, "all");
  }
}
/** a post's own clock: a tenth of its age, between 1 and 30 minutes */
const recheckIn = (ts: number, now: number): number => Math.min(P.maxRecheckMs, Math.max(P.minRecheckMs, Math.floor((now - ts) / 10)));
/** `lane`: "hi" when the notifications page asks (what the visitor is looking at), "lo" for the badge (behind
 *  Following's own reads on the same page) */
function refresh(e: NEngine, rt: HubCoreRuntime, kind: "auto" | "manual" | null, retry: boolean, lane: Lane): void {
  const now = rt.now();
  const floor = kind === "manual" ? P.manualFloorMs : P.headFreshMs;
  const due = (s: Src<unknown>) => s.state === "idle" || (retry && s.state === "failed") || (kind !== null && now - s.at >= floor);
  if (due(e.followers)) void run(e, rt, e.followers, () => loadFollowers(rt, lane, e.fid));
  if (due(e.mentions)) void run(e, rt, e.mentions, () => loadMentions(rt, lane, e.fid));
  // each post on its own clock (a manual check: anything not read in the last 30 s)
  const posts = () => {
    e.postsDeferred = false;
    if (!alive(e)) return;
    const t = rt.now();
    for (const ps of e.posts.values()) {
      const wait = kind === "manual" ? P.manualFloorMs : recheckIn(ps.rec.ts, t);
      if (kind !== null && t - ps.checkedAt >= wait) readPost(e, rt, lane, ps, "all");
      else if (retry) readPost(e, rt, lane, ps, "failed");
    }
  };
  // when the root's newest posts are re-read, the posts are checked against the NEW window once it is in (a post that
  // just fell out of it is not read again; a new one is read at once by reconcilePosts)
  if (due(e.own)) {
    e.postsDeferred = true;
    void run(e, rt, e.own, () => loadOwn(rt, lane, e.fid), () => reconcilePosts(e, rt, lane)).then(posts);
  } else posts();
  if (kind !== null) e.refreshedAt = now;
}
function sources(e: NEngine): Src<unknown>[] {
  const out: Src<unknown>[] = [e.followers, e.mentions, e.own];
  for (const ps of e.posts.values()) out.push(ps.replies, ps.like, ps.recast);
  return out;
}
/** still reading anything the answer depends on */
function reading(e: NEngine): boolean {
  return e.postsDeferred || sources(e).some((s) => s.p !== null || s.state === "idle" || s.state === "loading");
}
/** a short wait for progress (the island asks again while it is loading); a profile read does not signal this engine,
 *  so the wait also looks again every 50 ms */
async function waitFor(e: NEngine, waitMs: number | undefined, busy: () => boolean): Promise<void> {
  const deadline = Date.now() + Math.min(P.waitCapMs, Math.max(0, waitMs ?? 0));
  while (Date.now() < deadline && busy()) await Promise.race([e.changed.p, new Promise<void>((r) => setTimeout(r, Math.max(0, Math.min(50, deadline - Date.now()))))]);
}

// ------------------------------------------------------------------------------------------------- the groups
interface Group {
  id: string;
  kind: HubNotifKind;
  at: number;
  /** distinct accounts, newest first */
  actors: number[];
  atLeast: boolean;
  target: HubRec | null;
  rec: HubRec | null;
}
interface Built {
  groups: Group[];
  future: number;
  /** what an own persona did: left out (never read, never shown) */
  ownLeftOut: number;
}
const dayKey = (ms: number): string => {
  const d = new Date(ms);
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
};
function build(e: NEngine, seenAt: number | null, now: number): Built {
  const root = e.fid;
  const limit = now + P.futureSkewMs;
  let future = 0;
  let ownLeftOut = 0;
  const leave = (fid: number, ts: number): boolean => {
    if (ts > limit) {
      future++;
      return true;
    }
    if (fid === root) return true; // the root's own reply to itself, its self-like, a self-follow
    if (C.isOwn(fid)) {
      ownLeftOut++;
      return true;
    }
    return false;
  };
  const fresh = (ts: number) => seenAt !== null && ts > seenAt;
  const groups = new Map<string, Group>();
  type Pending = { id: string; kind: HubNotifKind; ts: number; fid: number; target?: HubRec; rec?: HubRec; atLeast?: boolean };
  const evs: Pending[] = [];
  for (const f of e.followers.items ?? []) if (!leave(f.fid, f.ts)) evs.push({ id: "follow:" + (fresh(f.ts) ? "new" : dayKey(f.ts)), kind: "follow", ts: f.ts, fid: f.fid });
  const talk = new Map<string, HubRec>();
  for (const ps of e.posts.values()) {
    for (const kind of ["like", "recast"] as const) {
      const s = ps[kind];
      const list = (s.items ?? []).filter((ev) => !leave(ev.fid, ev.ts));
      // a full page: the OLDEST group read may be missing older accounts ("at least")
      const oldest = s.capped && list.length ? list[list.length - 1] : null;
      for (const ev of list) evs.push({ id: kind + ":" + ps.rec.hash + ":" + (fresh(ev.ts) ? "new" : "old"), kind, ts: ev.ts, fid: ev.fid, target: ps.rec, atLeast: ev === oldest });
    }
    for (const r of ps.replies.items ?? []) if (!leave(r.fid, r.ts)) talk.set(r.hash, r);
  }
  for (const r of e.mentions.items ?? []) if (!leave(r.fid, r.ts)) talk.set(r.hash, r);
  for (const r of talk.values()) {
    const kind: HubNotifKind = r.parent && r.parent.fid === root ? "reply" : "mention";
    evs.push({ id: kind + ":" + r.hash, kind, ts: r.ts, fid: r.fid, rec: r });
  }
  evs.sort((a, b) => b.ts - a.ts || a.fid - b.fid);
  for (const ev of evs) {
    let g = groups.get(ev.id);
    if (!g) {
      g = { id: ev.id, kind: ev.kind, at: ev.ts, actors: [], atLeast: false, target: ev.target ?? null, rec: ev.rec ?? null };
      groups.set(ev.id, g);
    }
    if (!g.actors.includes(ev.fid)) g.actors.push(ev.fid);
    if (ev.ts > g.at) g.at = ev.ts;
    if (ev.atLeast) g.atLeast = true;
  }
  const list = [...groups.values()].sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { groups: list, future, ownLeftOut };
}
const unreadOf = (g: Group, seenAt: number | null) => seenAt === null || g.at > seenAt;
function inTab(g: Group, tab: HubNotifTab): boolean {
  if (tab === "mentions") return g.kind === "reply" || g.kind === "mention";
  // Priority: what a person did toward you, not aggregate engagement (lib/notifications.ts's rule)
  if (tab === "priority") return g.kind !== "like" && g.kind !== "recast";
  return true;
}
interface Health {
  failed: number;
  sentence: string | null;
  anyRead: boolean;
  anyFailed: boolean;
}
function health(e: NEngine): Health {
  let onPosts = 0;
  let anyRead = false;
  for (const s of sources(e)) if (s.items !== null) anyRead = true;
  for (const ps of e.posts.values()) if ([ps.replies, ps.like, ps.recast].some((s) => s.state === "failed")) onPosts++;
  const f = { followers: e.followers.state === "failed", mentions: e.mentions.state === "failed", posts: e.own.state === "failed", onPosts };
  const failed = Number(f.followers) + Number(f.mentions) + Number(f.posts) + onPosts;
  return { failed, sentence: failed ? notifPartialSentence(f) : null, anyRead, anyFailed: failed > 0 };
}

// ------------------------------------------------------------------------------------------------- the ops
async function admitted(): Promise<{ rt: HubCoreRuntime; acct: { fid: number; fname: string | null } | null }> {
  const rt = C.gate();
  await C.admit(rt);
  const acct = await C.signedIn(rt);
  if (acct) C.hubBase(rt); // misconfigured: say so before any read
  return { rt, acct };
}
/** when this root's notifications were last seen; THROWS (said as seenError) when the sealed record cannot be read */
async function seenFor(fid: number): Promise<number | null> {
  return (await import("./seen")).notifSeenAt(fid);
}
const tabOf = (t: unknown): HubNotifTab => (t === "mentions" || t === "priority" ? t : "all");
function accountView(e: NEngine): HubAccountView {
  return { fid: e.fid, fname: e.fname };
}
function notSignedIn(tab: HubNotifTab): HubNotificationsView {
  return {
    state: "not_signed_in",
    code: "not_signed_in",
    reason: HUB_READ_SENTENCES.not_signed_in,
    account: null,
    tab,
    items: [],
    unread: null,
    seenAt: null,
    newestAt: null,
    seenError: null,
    coverage: { followers: P.followers, mentions: P.mentions, posts: P.posts },
    partial: null,
    profilesFailed: null,
    paused: null,
    loading: false,
    empty: false,
    futureDated: 0,
    refreshedAt: null,
    requests: 0,
  };
}
function paused(): HubNotificationsView["paused"] {
  const until = C.pausedUntil();
  return until > Date.now() ? { until, sentence: pausedSentence((until - Date.now()) / 1000) } : null;
}

/** the notifications page: a snapshot of what is in, with the reads it needs started (not awaited past `waitMs`) */
export async function hubNotifications(opts: { tab?: unknown; refresh?: "auto" | "manual" | null; retry?: boolean; waitMs?: number } = {}): Promise<HubNotificationsView> {
  const tab = tabOf(opts.tab);
  const { rt, acct } = await admitted();
  if (!acct) return notSignedIn(tab);
  const e = engineFor(acct);
  if (opts.retry) C.forgetFailedProfiles();
  refresh(e, rt, opts.refresh ?? null, !!opts.retry, "hi");
  await waitFor(e, opts.waitMs, () => reading(e) || e.shownFids.some((f) => C.profileState(f) === "loading"));
  let seenAt: number | null = null;
  let seenError: string | null = null;
  try {
    seenAt = await seenFor(e.fid);
  } catch {
    seenError = NOTIF_SEEN_UNREADABLE_SENTENCE;
  }
  const now = rt.now();
  const b = build(e, seenAt, now);
  const h = health(e);
  const settled = !reading(e);
  const error = settled && !h.anyRead && h.anyFailed;
  const shown = error ? [] : b.groups.filter((g) => inTab(g, tab)).slice(0, P.maxItems);
  // the profiles of what is on screen only: the first few accounts of each group, and the posts' authors and mentions
  const fids = new Set<number>();
  for (const g of shown) {
    for (const f of g.actors.slice(0, P.actorsShown)) fids.add(f);
    for (const f of C.fidsFor([g.rec, g.target].filter((r): r is HubRec => !!r))) fids.add(f);
  }
  e.shownFids = [...fids];
  const profiles = e.shownFids.map((f) => C.ensureProfile(rt, f));
  const recs = shown.map((g) => g.rec).filter((r): r is HubRec => !!r);
  const quotes = C.quotesFor(rt, recs);
  if (opts.waitMs && opts.waitMs > 0) await C.settle([...profiles, ...quotes], Math.min(P.profileWaitMs, opts.waitMs));
  const unknownSeen = seenError !== null;
  const items: HubNotificationItem[] = shown.map((g) => {
    const cast: Cast | null = g.rec ? C.castOf(g.rec) : null;
    const actors: User[] = g.actors.slice(0, P.actorsShown).map((f) => C.userOf(f));
    return {
      id: g.id,
      kind: g.kind,
      at: g.at,
      unread: !unknownSeen && unreadOf(g, seenAt),
      actors,
      count: g.actors.length,
      atLeast: g.atLeast,
      target: g.target ? { fid: e.fid, hash: g.target.hash, text: C.castOf(g.target).text.slice(0, 280) } : null,
      cast,
    };
  });
  const profilesLoading = e.shownFids.some((f) => C.profileState(f) === "loading");
  const actorFids = [...new Set(shown.flatMap((g) => g.actors.slice(0, P.actorsShown)))];
  const pf = actorFids.filter((f) => C.profileState(f) === "failed").length;
  const state: HubNotificationsView["state"] = error ? "error" : settled && !profilesLoading ? "ready" : "loading";
  return {
    state,
    code: error ? "notifications_unreadable" : null,
    reason: error ? HUB_READ_SENTENCES.notifications_unreadable : null,
    account: accountView(e),
    tab,
    items,
    unread: error || unknownSeen ? null : b.groups.filter((g) => unreadOf(g, seenAt)).length,
    seenAt,
    newestAt: b.groups.length ? b.groups[0].at : null,
    seenError,
    coverage: { followers: P.followers, mentions: P.mentions, posts: P.posts },
    partial: !error && h.failed ? { failed: h.failed, sentence: h.sentence as string } : null,
    profilesFailed: pf ? { failed: pf, sentence: profilesFailedSentence(pf) } : null,
    paused: paused(),
    loading: state === "loading",
    empty: state === "ready" && !h.anyFailed && shown.length === 0,
    futureDated: b.future,
    refreshedAt: e.refreshedAt || null,
    requests: C.requests(),
  };
}

/** the badge: how many are unread (no profile is read for it). null = cannot be told, never 0 */
export async function hubUnread(opts: { refresh?: "auto" | "manual" | null; waitMs?: number } = {}): Promise<HubUnreadView> {
  const { rt, acct } = await admitted();
  if (!acct) return { state: "not_signed_in", unread: null, seenAt: null, newestAt: null, sentence: HUB_READ_SENTENCES.not_signed_in };
  const e = engineFor(acct);
  refresh(e, rt, opts.refresh ?? null, false, "lo");
  await waitFor(e, opts.waitMs, () => reading(e));
  let seenAt: number | null = null;
  let seenOk = true;
  try {
    seenAt = await seenFor(e.fid);
  } catch {
    seenOk = false;
  }
  const h = health(e);
  const settled = !reading(e);
  if (settled && !h.anyRead && h.anyFailed) return { state: "error", unread: null, seenAt, newestAt: null, sentence: HUB_READ_SENTENCES.notifications_unreadable };
  if (!h.anyRead) return { state: "loading", unread: null, seenAt, newestAt: null, sentence: null };
  const b = build(e, seenAt, rt.now());
  if (!seenOk) return { state: "error", unread: null, seenAt: null, newestAt: b.groups.length ? b.groups[0].at : null, sentence: NOTIF_SEEN_UNREADABLE_SENTENCE };
  return { state: settled ? "ok" : "loading", unread: b.groups.filter((g) => unreadOf(g, seenAt)).length, seenAt, newestAt: b.groups.length ? b.groups[0].at : null, sentence: h.sentence };
}

/** viewing the page: everything up to `upTo` (the newest notification shown) is seen, on every device of this root.
 *  Never moves back; never past "now" plus the clock allowance (a post dated decades ahead cannot mark the future seen). */
export async function hubNotificationsSeen(opts: { upTo?: unknown } = {}): Promise<{ seenAt: number | null }> {
  const upTo = opts.upTo;
  if (typeof upTo !== "number" || !Number.isSafeInteger(upTo) || upTo <= C.FC_EPOCH) throw new HubReadError("bad_request");
  const { rt, acct } = await admitted();
  if (!acct) throw new HubReadError("not_signed_in");
  const at = Math.min(upTo, rt.now() + P.futureSkewMs);
  // PERSONA SEPARATION: asked again right before the write, so a persona chosen meanwhile stops it (never written then)
  const stillRoot = async () => {
    if (await rt.acting()) throw new HubReadError("acting_persona");
  };
  try {
    return { seenAt: await (await import("./seen")).markNotifSeen(acct.fid, at, stillRoot) };
  } catch (e) {
    if (e instanceof HubReadError && e.code === "acting_persona") throw e;
    throw new HubReadError("seen_unsaved");
  }
}
