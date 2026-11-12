// Data layer. With NEYNAR_API_KEY set, reads come from Neynar's v2 API.
// Without it (this environment), a dense fixture dataset stands in so the
// timeline keeps genuine X-like density. Same shapes either way.
import "server-only";
import rawBank from "./fixtures/data.json";
import type { Cast, Embed, LiveItem, NewsItem, NotificationItem, Trend, User } from "./types";
import { bank, isEmptyWorld, realPersonas } from "./world";
// FC Gate 2: ONE live transport. This file's phase-1 Neynar path (its own
// fetch, its own mappers, its own boot-time liveMode const) is retired in
// favor of the adapter layer — cached, backoff-on-429, stale-serving, and
// runtime-switchable, with the fixture-tested contentPure mappers.
import { contentSource, isLiveContent } from "./adapters/neynar/mode";
import { deviceNeynarOn } from "./fc/source/switch";
import {
  liveCast,
  liveChannelList,
  liveConversation,
  liveNotifications,
  liveViewerFeed,
  liveChannelFeed,
  liveUserByUsername,
  liveUserCasts,
  isNetworkMarked,
  isRelayHandleShape,
  relayDiscovery,
  relayStateOf,
  relayThread,
  relayUser,
  relayUserCasts,
  seedSource,
  RelayReadError,
  type LiveSource,
} from "./adapters/neynar/content";

const KEY = process.env.NEYNAR_API_KEY || "";

// Live content is opt-in via DATA_SOURCE=neynar (or the Developer pane's
// runtime switch — FC Gate 2), never something you get by accident because
// a key happens to be in the environment. Seed is the default, per the
// gate spec — and it is also the honest default, since the seeded corpus
// is what every acceptance suite is written against.
// A key is still required: asking for live data without one is a
// misconfiguration, and falling back silently would hide it.
//
// FUNCTIONS, not consts: the runtime source switch means "is live?" can
// change within a process lifetime. A module-load const here was exactly
// the two-live-universes trap — the Developer pane toggle would flip the
// adapter layer while this file kept serving its boot-time answer.
export function liveMode(): boolean {
  return isLiveContent() && KEY.length > 0;
}
export function liveRequestedWithoutKey(): boolean {
  return isLiveContent() && KEY.length === 0;
}

// FC-READ — the relay (the browser device on a public deployment, mode.ts contentSource() === "relay") is NOT
// liveMode(): it needs no key here, it never touches the write guards, and it reads a CLOSED set of surfaces —
// the discovery base (getFeed "foryou") and profiles/threads for network handles and hashes this device does not
// already hold. Never relayed: Following, notifications, the history shelf, trends, search, every channel tab, and
// every read a server renders (relayReads() is false outside the browser).
// FC-READ (no channels): channel tabs used to map to the relay's "channel" op; the owner's v1 decision is that
// channels are not an emphasis, so that op is gone and every channel tab stays seed/fixture.
function relayMode(): boolean {
  return contentSource() === "relay";
}

/** NEYNAR AS A SWITCH (§42, lib/fc/source/switch.ts): the relay is this page's source AND the operator switched For You to
 *  Neynar (FC_SOURCE_FORYOU) — the discovery list. Off by default: an armed key alone no longer puts Neynar on For You. */
function relayForYou(): boolean {
  return relayMode() && deviceNeynarOn("forYou");
}

/** NEYNAR AS A SWITCH (§42): a thread or profile lookup is how a card that came via Neynar opens, so it is made only while a
 *  Neynar surface that hands out such cards is switched on (For You's list or search) */
function relayLookups(): boolean {
  return relayMode() && (deviceNeynarOn("forYou") || deviceNeynarOn("search"));
}

/** FC-READ: is `hash` a network cast this device should ask the relay about? Only once every local store has said
 *  no — seed, fixture, this tab's own 0xlocal casts, private posts and the validator's anon list (the helper owns
 *  the last two) — so an anon author opening their OWN post never becomes a relay lookup tied to their address.
 *
 *  The helper must read the stores DIRECTLY (it does: findLocalCast, postByHash, the private store, the anon list) —
 *  never through getCast()/getThread(), which call back here: that would be an unbounded async recursion. */
async function isRelayCastTarget(hash: string): Promise<boolean> {
  if (!relayLookups()) return false;
  // dynamic: the helper reads the stores this module reads (findLocalCast), and a static edge would be a cycle
  const { isNetworkHashShape, isNetworkCastTarget } = await import("@/lib/fc/networkTarget");
  if (!isNetworkHashShape(hash)) return false; // every local hash family has another shape: no I/O for those
  try {
    return await isNetworkCastTarget(hash);
  } catch {
    // the helper THROWS when a store is unreadable (the anon list is a validator read). Unknown locality is
    // neither answer: not "network" (that would relay a hash this device may hold — an anon author's own post)
    // and not "local" (that would print "no such post" about a post that may exist). A fixed-sentence 503.
    throw new RelayReadError("error", "fc_read_locality_unknown");
  }
}

// ---------- fixture plumbing ----------

// LAYERS_WORLD=empty (lib/world.ts): the fixture world is not loaded — no casts, users, threads, notifications,
// trends, news, live rooms, follow suggestions or channels. Every reader below takes the empty twin, so a fixture
// entry added to lib/fixtures/data.json later is never read under the flag. The self record keeps only its fid (the
// key of this device's own root handle, never rendered); its display comes from the first real persona (getSelf).
const EMPTY_FIXTURE = {
  ...rawBank,
  self: { ...rawBank.self },
  users: [],
  casts: [],
  selfCasts: [],
  threads: {},
  notifications: [],
  trends: [],
  news: [],
  liveOnX: [],
  whoToFollow: [],
  channels: [],
} as unknown as typeof rawBank;
const raw = bank(rawBank, EMPTY_FIXTURE);

const BOOT = Date.now();

const usersByFid = new Map<number, User>();
for (const u of raw.users as any[]) usersByFid.set(u.fid, u as User);
if (!isEmptyWorld()) usersByFid.set(raw.self.fid, raw.self as unknown as User);

export function fixtureUser(fid: number): User {
  return (
    usersByFid.get(fid) ?? {
      fid,
      username: "user" + fid,
      displayName: "User " + fid,
      pfpUrl: "https://i.pravatar.cc/160?img=1",
      followerCount: 0,
      followingCount: 0,
    }
  );
}

function materialize(c: any): Cast {
  const embeds: Embed[] = (c.embeds ?? []).map((e: any) => {
    if (e.type === "quote") return { type: "quote", quote: materialize(e.quote) };
    return e as Embed;
  });
  return {
    hash: c.hash,
    author: fixtureUser(c.authorFid),
    text: c.text,
    timestamp: BOOT - c.minutesAgo * 60_000,
    replies: c.replies ?? 0,
    likes: c.likes ?? 0,
    recasts: c.recasts ?? 0,
    views: c.views ?? 0,
    embeds,
    recastedBy: c.recastedByFid ? fixtureUser(c.recastedByFid) : undefined,
    truncate: c.truncate,
    threadCount: c.threadCount,
    parentIsSelf: c.parentIsSelf,
    viewerLiked: c.viewerLiked,
  };
}

// In-memory store for fixture-mode writes (dev server lifetime).
type Store = {
  extraCasts: Cast[];
  liked: Set<string>;
  recast: Set<string>;
  likeDelta: Map<string, number>;
  recastDelta: Map<string, number>;
};
const store: Store = ((globalThis as any).__layersStore ??= {
  extraCasts: [],
  liked: new Set(),
  recast: new Set(),
  likeDelta: new Map(),
  recastDelta: new Map(),
});

/** Seed reset: local casts and reaction toggles are mutable state, and a
 * reset that leaves them standing is reporting success for work it did not
 * do — the b2 collapse suite caught exactly that (a fixed-text test cast
 * surviving reset and doubling in the next sweep run). */
export function resetLocalStore() {
  store.extraCasts = [];
  store.liked = new Set();
  store.recast = new Set();
  store.likeDelta = new Map();
  store.recastDelta = new Map();
}

export function addLocalCast(cast: Cast) {
  store.extraCasts.unshift(cast);
}

/** Authorship lookup for the refutation evaluation layer: local casts keep
 * their persona marker in the raw text until render strips it. */
export function findLocalCast(hash: string): { text?: string; personaId?: string } | null {
  const c = store.extraCasts.find((x) => x.hash === hash);
  return c ? { text: c.text, personaId: c.personaId } : null;
}

/** Persona ids of local casts replying to a hash — the pledge lottery's
 * qualifying-pool contribution from composer-made replies. */
export function localRepliersTo(hash: string): string[] {
  // composer casts carry authorship as the in-text persona marker (stripped
  // at render); personaId is only set on some paths, so parse both
  return store.extraCasts
    .filter((c) => c.replyingTo === hash)
    .map((c) => c.personaId ?? c.text?.match(/layers:persona:(\S+)/)?.[1])
    .filter((id): id is string => Boolean(id));
}

/** LAYERS_WORLD=empty (lib/world.ts): one persona's own local casts, newest first — what its profile shows when the
 *  demo world (the seeded posts a seeded profile lists) is not loaded */
export function localCastsOf(personaId: string): Cast[] {
  return store.extraCasts
    .filter((c) => (c.personaId ?? c.text?.match(/layers:persona:(\S+)/)?.[1]) === personaId)
    .map(decorate);
}

export function setReaction(hash: string, kind: "like" | "recast", on: boolean) {
  const set = kind === "like" ? store.liked : store.recast;
  const delta = kind === "like" ? store.likeDelta : store.recastDelta;
  const had = set.has(hash);
  if (on && !had) {
    set.add(hash);
    delta.set(hash, (delta.get(hash) ?? 0) + 1);
  } else if (!on && had) {
    set.delete(hash);
    delta.set(hash, (delta.get(hash) ?? 0) - 1);
  }
}

function decorate(c: Cast): Cast {
  return {
    ...c,
    likes: c.likes + (store.likeDelta.get(c.hash) ?? 0),
    recasts: c.recasts + (store.recastDelta.get(c.hash) ?? 0),
    viewerLiked: c.viewerLiked || store.liked.has(c.hash),
    viewerRecast: c.viewerRecast || store.recast.has(c.hash),
  };
}

// (phase-1 Neynar mappers + fetch retired in FC Gate 2 — the adapter layer
// in lib/adapters/neynar/ is the one live transport: cached, 429-backoff,
// stale-serving, runtime-switchable, fixture-tested mappers.)

// ---------- public reads ----------

export const PAGE_SIZE = 10;

export async function getFeed(
  tab: "foryou" | "following" | string,
  page = 0,
  /** FC-READ: seedOnly — a caller that must never read through the relay (the history shelf: what it shows is
   *  presented as the visitor's OWN, and network casts are nobody's history here) */
  opts: { seedOnly?: boolean } = {}
): Promise<{ casts: Cast[]; nextPage: number | null; liveSource: LiveSource }> {
  // FC-READ (no channels): the DIRECT transport (the rig's runtime switch, the owner service; never a public
  // deployment — liveMode() needs NEYNAR_API_KEY and DATA_SOURCE=neynar, both refused there). For You and Following
  // (and so Explore and the history shelf, which read "foryou") are the viewer's following feed: /feed/trending, what
  // they used to read, is gone from Neynar's contract. Channel tabs keep /feed/channels, which is still in it.
  if (liveMode()) {
    try {
      const r =
        tab === "foryou" || tab === "following"
          ? await liveViewerFeed(25)
          : await liveChannelFeed([tab], 25);
      if (r.value.length) return { casts: r.value, nextPage: null, liveSource: seedSource() };
    } catch {
      /* fall through to fixture — availability, not disclosure */
    }
  }
  // FC-READ: the relay reads For You only (the shared "discovery" op — the same key feed2 and Explore read).
  // FOLLOWING NEVER: it is the visitor's own world, and the deployed smoke posts a cast and reads it back there.
  // FC-READ (no channels): a channel tab is NEVER relayed — no request, source "seed", the fixture slice below —
  // because channels are not a v1 emphasis and the relay offers no per-channel read. Page 0 only — the relay serves
  // one page, so the answer carries nextPage null exactly as the rig's live path does.
  let liveSource = seedSource();
  // NEYNAR AS A SWITCH (§42): an armed relay with For You kept on the network makes no read, and the payload SAYS why
  if (relayMode() && !relayForYou() && !opts.seedOnly && page === 0 && tab === "foryou") liveSource = { source: "seed", state: "network" };
  if (relayForYou() && !opts.seedOnly && page === 0 && tab === "foryou") {
    try {
      const r = await relayDiscovery();
      if (r.value.length) {
        // the visitor's own posts still lead For You, as they do in the seeded feed below — the network base
        // replaces the SEEDED corpus, never the visitor's own world
        const own = store.extraCasts.map(decorate);
        return { casts: [...own, ...r.value], nextPage: null, liveSource: { source: "relay", state: r.state } };
      }
      // the relay answered with nothing: the seeded page stands in, and the payload SAYS so
      liveSource = { source: "relay", state: "error" };
    } catch (e) {
      // off / budget / unarmed / rate / unreachable: seed content in its place, labelled — never silently
      liveSource = { source: "relay", state: relayStateOf(e) };
    }
  }
  // Fixture: stable ordering, channel tabs slice differently, extra local
  // casts (fixture-mode posts) lead the For You/Following feeds.
  let base = (raw.casts as any[]).map(materialize);
  if (tab === "crypto") base = base.filter((_, i) => i % 2 === 0);
  if (tab === "defi") base = base.filter((_, i) => i % 3 === 0);
  const withLocal = page === 0 && (tab === "foryou" || tab === "following")
    ? [...store.extraCasts, ...base]
    : base;
  // LAYERS_WORLD=empty: no fixture base and no local casts is an EMPTY feed (the pages say so) — never cycled
  // (i % 0). The demo world always has a base, so this never fires there.
  if (withLocal.length === 0) return { casts: [], nextPage: null, liveSource };
  // Cycle pages so infinite scroll always has content.
  const start = page * PAGE_SIZE;
  const casts = [];
  for (let i = start; i < start + PAGE_SIZE; i++) {
    const c = withLocal[i % withLocal.length];
    casts.push(i < withLocal.length ? c : { ...c, hash: c.hash + "p" + i });
  }
  return { casts: casts.map(decorate), nextPage: page + 1, liveSource };
}

// FC-READ (review, privacy-safety-3): a read's value WITH where it came from. getCast/getThread/getProfile/
// getProfileCasts used to return only r.value, dropping the relay's stale/state, so a thread or profile served off a
// 24 h shelf (the server's or this tab's) rendered exactly like a live one. The *Sourced variants report it; the plain
// ones keep their signatures for every other caller. `note` is called only on a RELAYED answer — every seed, fixture,
// local and rig path leaves the source "seed", so their views (and the rig's DOM) are unchanged.
export interface Sourced<T> {
  value: T;
  liveSource: LiveSource;
}
type NoteSource = (s: LiveSource) => void;

async function sourced<T>(read: (note: NoteSource) => Promise<T>): Promise<Sourced<T>> {
  let liveSource: LiveSource = seedSource();
  const value = await read((s) => {
    liveSource = s;
  });
  return { value, liveSource };
}

export async function getCast(hash: string): Promise<Cast | null> {
  return castRead(hash);
}

/** FC-READ (review): getCast plus the relay's freshness (source "seed" for everything not read through the relay) */
export function getCastSourced(hash: string): Promise<Sourced<Cast | null>> {
  return sourced((note) => castRead(hash, note));
}

async function castRead(hash: string, note?: NoteSource): Promise<Cast | null> {
  if (liveMode()) {
    try {
      const r = await liveCast(hash);
      if (r.value) return r.value;
    } catch {
      /* not a live cast (404) or transport down — fall through to fixture */
    }
  }
  const all = [
    ...(raw.casts as any[]),
    ...(raw.selfCasts as any[]),
    ...Object.values(raw.threads as Record<string, any[]>).flat(),
  ];
  const hit = all.find((c) => c.hash === hash);
  if (hit) return decorate(materialize(hit));
  // SEEDED posts get permalinks too. Every post in the product has a
  // permalink on X, and the seeded corpus is the primary surface — before
  // this, every seeded post's permalink 404'd, found when refutation-thread
  // rendering tried to open one.
  {
    const { postByHash, personaById, absoluteTime } = await import("@/lib/adapters/mock/store");
    const p = postByHash.get(hash);
    if (p) {
      const author = personaById.get(p.authorPersonaId);
      return {
        hash: p.hash,
        author: {
          fid: 0,
          username: author?.handle ?? "unknown",
          displayName: author?.name ?? "Unknown",
          pfpUrl: author?.avatarUrl ?? "",
          bio: author?.bio ?? "",
          followerCount: 0,
          followingCount: 0,
          verified: (author?.tier ?? 1) >= 7,
        },
        text: p.text,
        timestamp: absoluteTime(p.minutesAgo),
        replies: p.replies,
        likes: p.likes,
        recasts: p.recasts,
        views: p.views,
        embeds: [],
        truncate: p.truncate,
        personaId: p.authorPersonaId,
        tier: author?.tier,
      };
    }
  }
  const local = store.extraCasts.find((c) => c.hash === hash);
  if (local) return decorate(local);
  // FC-READ: LAST, and only for an unknown 40-hex hash every local store has disowned (isRelayCastTarget). The
  // relay's "thread" op returns the root cast with its replies in one call, so getThread's read right after this
  // one is a tab-cache hit, not a second request. null = the network has no such cast either. A relay that does not
  // answer THROWS (RelayReadError, a fixed sentence): "no such post" would be a lie about a post that may exist.
  if (await isRelayCastTarget(hash)) {
    const r = await relayThread(hash);
    if (r) note?.({ source: "relay", state: r.state }); // FC-READ (review): live or off a shelf — the page says which
    return r ? r.value.cast : null;
  }
  return null;
}

export async function getThread(hash: string): Promise<Cast[]> {
  return threadRead(hash);
}

/** FC-READ (review): getThread plus the relay's freshness */
export function getThreadSourced(hash: string): Promise<Sourced<Cast[]>> {
  return sourced((note) => threadRead(hash, note));
}

async function threadRead(hash: string, note?: NoteSource): Promise<Cast[]> {
  if (liveMode()) {
    try {
      const r = await liveConversation(hash, 2);
      if (r.value.replies.length) return r.value.replies;
    } catch {
      /* fall through to fixture */
    }
  }
  // FC-READ: a network cast's replies come from the same relay "thread" answer getCast just read (a tab-cache
  // hit). The local-first rule is the same one getCast applies — a hash any local store holds never reaches here.
  if (await isRelayCastTarget(hash)) {
    const r = await relayThread(hash);
    if (r) note?.({ source: "relay", state: r.state });
    const localReplies = store.extraCasts.filter((c) => c.replyingTo === hash).map(decorate);
    return [...localReplies, ...(r ? r.value.replies : [])];
  }
  const thread = (raw.threads as Record<string, any[]>)[hash] ?? [];
  // Local replies belong to their thread. Before this, a reply posted
  // through the composer existed only as a top-of-feed cast — the thread it
  // answered never showed it, which quietly broke every feature that reads
  // reply structure (refutation chains found this).
  const local = store.extraCasts.filter((c) => c.replyingTo === hash);
  // seeded replies to a seeded parent
  const { SEED_POSTS, personaById: byId, absoluteTime: at } = await import("@/lib/adapters/mock/store");
  const seededReplies = SEED_POSTS.filter((p) => p.replyToHash === hash).map((p) => {
    const author = byId.get(p.authorPersonaId);
    return {
      hash: p.hash,
      author: {
        fid: 0,
        username: author?.handle ?? "unknown",
        displayName: author?.name ?? "Unknown",
        pfpUrl: author?.avatarUrl ?? "",
        followerCount: 0,
        followingCount: 0,
        verified: (author?.tier ?? 1) >= 7,
      },
      text: p.text,
      timestamp: at(p.minutesAgo),
      replies: p.replies,
      likes: p.likes,
      recasts: p.recasts,
      views: p.views,
      embeds: [],
      personaId: p.authorPersonaId,
      tier: author?.tier,
    } as Cast;
  });
  return [...local, ...seededReplies, ...thread.map((c) => decorate(materialize(c)))];
}

export async function getProfile(handle: string): Promise<User | null> {
  return profileRead(handle);
}

/** FC-READ (review): getProfile plus the relay's freshness */
export function getProfileSourced(handle: string): Promise<Sourced<User | null>> {
  return sourced((note) => profileRead(handle, note));
}

async function profileRead(handle: string, note?: NoteSource): Promise<User | null> {
  const self = getSelf();
  if (self.username && handle === self.username) return self;
  if (liveMode()) {
    try {
      const r = await liveUserByUsername(handle);
      // BUILD A review (UXC-12): marked as read live, so the profile's Follow can be a real Farcaster follow
      if (r.value) return { ...r.value, live: true };
    } catch {
      /* fall through to fixture */
    }
  }
  for (const u of usersByFid.values()) if (u.username === handle) return u;
  // FC-READ: the relay comes after the visitor's own self (above), the device's personas and the fixture — and only
  // for a handle shaped like a network name. A persona handle (the device's, a fork registered after boot — the
  // profile route adopts those into personaByHandle before it asks) is ours and is never sent to a server.
  if (relayLookups() && isRelayHandleShape(handle)) {
    const { personaByHandle } = await import("@/lib/adapters/mock/store");
    if (personaByHandle.has(handle)) return null;
    const r = await relayUser(handle); // throws when the relay does not answer: "no such account" would be a lie
    if (r) note?.({ source: "relay", state: r.state });
    return r ? r.value : null;
  }
  return null;
}

/**
 * RETIRED by NEYNAR AS A SWITCH (§42): see the body. What it was:
 * PERSONA LAUNCH P1 (SIWF): "Show my Farcaster posts here" — the visitor's OWN Farcaster account (the read-only public
 * self a sign-in minted), read through the preview's read relay BY FNAME, only because the visitor pressed the button.
 * Never automatic: the relay read of @fname from the visitor's address is joinable by the operator to the root
 * (A-FCREAD-OPERATOR-SEES-READS / A-SIWF-OWN-PROFILE-READ), so the sealed facts render without it and the button says
 * what it reveals. It skips the short-circuit profileRead makes for a handle this device holds (the persona's handle
 * may equal the fname): the caller (app/api/profile live=1) has already established the handle is a publicSelf
 * persona's and passes the FNAME from its sealed link. Null when the relay is not this page's content source (the
 * FC_READ_RELAY hint is off) or the name is not network-shaped; THROWS RelayReadError when the relay did not answer.
 */
export async function getPublicSelfLiveSourced(fname: string): Promise<{ user: Sourced<User | null>; casts: Sourced<Cast[]> } | null> {
  // NEYNAR AS A SWITCH (§42), THE HARD RULE: a Neynar read may name no visitor, and this one names the visitor's OWN
  // account (the fname from the visitor's address is the root, to Totem's server). RETIRED: it is never made, whatever
  // any switch says; the root's own posts are read from Farcaster's network instead (/fc/profile, §36). The route answers
  // 409 names_you; the button is gone (components/profile/ProfileIsland.tsx).
  void fname;
  return null;
}

export async function getProfileCasts(handle: string): Promise<Cast[]> {
  return profileCastsRead(handle);
}

/** FC-READ (review): getProfileCasts plus the relay's freshness (of the casts read; the account's own is getProfile's) */
export function getProfileCastsSourced(handle: string): Promise<Sourced<Cast[]>> {
  return sourced((note) => profileCastsRead(handle, note));
}

async function profileCastsRead(handle: string, note?: NoteSource): Promise<Cast[]> {
  const selfName = getSelf().username;
  if (selfName && handle === selfName) {
    const own = (raw.selfCasts as any[]).map(materialize);
    return [...store.extraCasts, ...own].map(decorate);
  }
  const user = await getProfile(handle);
  if (!user) return [];
  if (liveMode()) {
    try {
      const r = await liveUserCasts(user.fid, 25);
      if (r.value.length) return r.value;
    } catch {
      /* fall through to fixture */
    }
  }
  // FC-READ: a relayed account's casts, asked BY FNAME — the relay resolves the fid from its own cached by_username
  // answer, so no fid ever travels from this side. (A fixture account — even one whose username is a real fname —
  // stays fixture: getProfile answered it without the relay, so it carries no network mark.)
  if (isNetworkMarked(user)) {
    const r = await relayUserCasts(handle);
    if (r) note?.({ source: "relay", state: r.state });
    return r ? r.value : [];
  }
  return (raw.casts as any[])
    .filter((c) => c.authorFid === user.fid)
    .map((c) => decorate(materialize(c)));
}

export async function getNotifications(): Promise<NotificationItem[]> {
  // FC Gate 2: live notifications for the viewer fid (no signer required —
  // verified against the current docs, which the phase-1 comment here
  // predated). Live types map onto the fixture union; `quote` (which the
  // fixture UI has no slot for) renders as a mention, the closest shape.
  if (liveMode()) {
    try {
      const fid = Number(process.env.NEYNAR_VIEWER_FID ?? "3");
      const r = await liveNotifications(fid, 15);
      if (r.value.length) {
        const TYPE_MAP: Record<string, NotificationItem["type"]> = {
          follows: "follow",
          likes: "like",
          recasts: "recast",
          reply: "reply",
          mention: "mention",
          quote: "mention",
        };
        // the fixture UI's `text` slot is the VERB PHRASE ("liked your
        // post"), not cast content — putting live cast text there rendered
        // verb-less 900-char rows. Cast content belongs in `preview`,
        // which the row clamps to two lines.
        const VERB: Record<string, string> = {
          follows: "followed you",
          likes: "liked your post",
          recasts: "reposted your post",
          reply: "replied to your post",
          mention: "mentioned you",
          quote: "quoted your post",
        };
        return r.value
          .filter((n) => TYPE_MAP[n.type] && n.users.length)
          .map((n, i) => ({
            id: `live_${n.type}_${i}_${n.timestamp}`,
            type: TYPE_MAP[n.type],
            actors: n.users,
            timestamp: n.timestamp,
            // the REPLY row renders `text` as the reply BODY (fixture
            // convention, n6) — every other type renders it as the verb
            // phrase. Mapping the verb into a reply row showed "replied to
            // your post" as the reply's content (re-review finding).
            text:
              n.type === "reply"
                ? (n.cast?.text ?? "").slice(0, 280) || "replied to your post"
                : VERB[n.type] ?? "interacted with you",
            preview: n.type !== "reply" && n.cast?.text ? n.cast.text.slice(0, 280) : undefined,
            replyingTo: undefined,
            views: undefined,
            replies: undefined,
            articleCard: undefined,
          }));
      }
    } catch {
      /* fall through to fixture */
    }
  }
  return (raw.notifications as any[]).map((n) => ({
    id: n.id,
    type: n.type,
    actors: n.actorFids.map(fixtureUser),
    timestamp: BOOT - n.minutesAgo * 60_000,
    text: n.text,
    preview: n.preview,
    replyingTo: n.replyingTo,
    views: n.views,
    replies: n.replies,
    articleCard: n.articleCard,
  }));
}

export async function getTrends(): Promise<Trend[]> {
  if (liveMode()) {
    try {
      const r = await liveChannelList(6);
      if (r.value.length) {
        return r.value.slice(0, 4).map((ch, i) => ({
          kind: "trend" as const,
          category: i % 2 ? "Trending" : "Only on X · Trending",
          title: ch.name,
        }));
      }
    } catch {
      /* fall through to fixture */
    }
  }
  return raw.trends as Trend[];
}

export async function getNews(): Promise<NewsItem[]> {
  return (raw.news as any[]).map((n) => ({
    title: n.title,
    meta: n.meta,
    avatars: n.avatarFids.map((f: number) => fixtureUser(f).pfpUrl),
  }));
}

export async function getLiveOnX(): Promise<LiveItem[]> {
  return (raw.liveOnX as any[]).map((l) => ({
    host: l.host,
    verified: l.verified,
    action: l.action,
    title: l.title,
    viewers: l.viewers,
    avatars: l.avatarFids.map((f: number) => fixtureUser(f).pfpUrl),
  }));
}

export async function getWhoToFollow(): Promise<User[]> {
  return (raw.whoToFollow as number[]).map(fixtureUser);
}

export function getChannels(): { id: string; name: string }[] {
  return raw.channels as { id: string; name: string }[];
}

export function getSelf(): User {
  if (isEmptyWorld()) return emptyWorldSelf();
  return raw.self as unknown as User;
}

/**
 * LAYERS_WORLD=empty: the "self" account record, drawn from the device's FIRST real persona (keystore-minted) — no
 * fixture name, face, bio, counts or check mark. The fid is the seed self's, kept as the key under which this
 * device's roster holds its own root handle (lib/identity/rootRoster.ts rootForFid): plumbing, not display. With no
 * real persona yet the record is anonymous ("You", no handle) and nothing links to a profile.
 */
function emptyWorldSelf(): User {
  let first: ReturnType<typeof realPersonas>[number] | undefined;
  try {
    // PUBLIC GO-LIVE: in a live visitor's browser device the first persona that can post — never the read-only public
    // self Sign in with Farcaster minted (the guided first run signs in before the first persona exists). The owner
    // service (no window) keeps its first real persona, unchanged.
    const held = realPersonas();
    first = typeof window !== "undefined" ? held.find((p) => p.publicSelf !== true) : held[0];
  } catch {
    first = undefined;
  }
  return {
    // PUBLIC GO-LIVE: the device's own fid when it set one at boot (setSelfForDevice writes raw.self); on a server the
    // empty twin's self is a copy of the bank's, so this is the seed self's fid there, exactly as before
    fid: raw.self.fid,
    username: first?.handle ?? "",
    displayName: first?.name ?? "You",
    pfpUrl: first?.avatarUrl ?? "",
    bio: first?.bio ?? "",
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    verified: false,
  };
}

/** BROWSER KEYSTORE PASS Gate 1 stage 3: the browser device makes the "self" record its own at boot (rig: never called) */
export function setSelfForDevice(u: Partial<User>): void {
  Object.assign(raw.self as unknown as User, u);
}
