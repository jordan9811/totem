import "server-only";
// PROD-LIVE PASS (D-CU-0-4) — ONE computation per social page, run in two places.
//
// On the RIG (ZK_DEV_HOOKS=true) the page's server component calls these exactly where it used to compute inline,
// and hands the result to the page's client island as `initial` — same reads, same order, same failure semantics,
// same DOM. On a PUBLIC deployment the server holds no identity (no keystore, no device key, no hydrated store), so
// the page renders a shell and the island fetches the matching /api/* route instead; the browser device answers that
// route in-process by running THIS code against the visitor's own store (lib/device/host.ts). The route is the
// function; the page and the device are two callers of it.
//
// Every string that depends on the clock or the locale is computed here and shipped with the data (see
// lib/views/social.ts for why).
import { resolveIdentity } from "@/lib/identity/resolver";
import {
  getFeed,
  getNotifications,
  getSelf,
  getCastSourced,
  getThreadSourced,
  getProfileSourced,
  getProfileCastsSourced,
} from "@/lib/data";
import { isNetworkMarked, type LiveSource } from "@/lib/adapters/neynar/content";
import { attachPersonaLayer } from "@/lib/policy";
import { personasByFid } from "@/lib/validator";
import { legacyValidatorTier, personaTier } from "@/lib/rep/personaTier";
import { SEED_POSTS, absoluteTime, personaByHandle, personaById, postByHash } from "@/lib/adapters/mock/store";
import { mockRepAdapter } from "@/lib/adapters/mock/rep";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { STRIKE_THRESHOLD, strikeSettingFor } from "@/lib/eventlog/strikes";
import type { EdgeEvent } from "@/lib/eventlog/types";
import { importedPostsForAsync, shelfAttribution, type ImportedPost } from "@/lib/x/importer";
import { curatorEdgesFor, edgesFor } from "@/lib/refutation/edges";
import { filterByPolicy, filterByTab, type NotificationPolicy } from "@/lib/notifications";
import { permalinkTime, relativeTime } from "@/lib/format";
import type { Cast, User } from "@/lib/types";
import { isEmptyWorld } from "@/lib/world";
import { SHELF_PAGE_SIZE } from "./social";
import type {
  HistoryEvent,
  HistoryReceipt,
  HistoryShelfView,
  ImportedRow,
  ImportedView,
  ShelfPageView,
  NotificationsView,
  ProfileView,
  RelationshipHistoryView,
  ThreadView,
  ViewLiveSource,
} from "./social";

/**
 * FC-READ (review, privacy-safety-3): one page's relay freshness from its reads — absent unless at least one read
 * came through the relay; "stale" when ANY of them came off a shelf (a live root over shelved replies is not a live
 * page). Relayed reads only ever answer live or stale (a relay that did not answer threw instead).
 */
function pageLiveSource(...sources: LiveSource[]): ViewLiveSource | undefined {
  const relayed = sources.filter((s) => s.source === "relay");
  if (relayed.length === 0) return undefined;
  return { source: "relay", state: relayed.every((s) => s.state === "live") ? "live" : "stale" };
}

// ---------- profile (app/(main)/[handle]/page.tsx, app/api/profile) ----------

/**
 * The profile of `handle` as the ACTING persona sees it, or null when no account by that handle is known here.
 *
 * On the rig "known here" is the seed plus the fixture; inside the browser device it also covers the personas the
 * device minted (boot registers them into personaByHandle), which is why a visitor's OWN profile resolves there and
 * could never resolve on a public server.
 */
export async function profileView(handle: string): Promise<ProfileView | null> {
  const seeded = personaByHandle.get(handle);

  // ---- seeded persona profile (Waves 1-3 surfaces live here) ----
  if (seeded) {
    // ZK PASS 2 Gate 1: PROOF under zk (0 = not proven); the seed's tier otherwise
    const profileTier = await personaTier(seeded.id, () => seeded.tier);
    const posts = SEED_POSTS.filter((p) => p.authorPersonaId === seeded.id).slice(0, 30);
    // Retry the block check rather than failing open: a transient adapter
    // failure must not render a blocked account as un-blocked.
    let blockedIds: string[] = [];
    let blockCheckFailed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        blockedIds = await mockRepAdapter.blockedFor(activeSeedPersonaId());
        blockCheckFailed = false;
        break;
      } catch {
        blockCheckFailed = true;
      }
    }
    const isBlocked = blockedIds.includes(seeded.id);
    // The currently ACTING persona, not root-family membership: View-As
    // exists precisely so every surface renders as someone else, and this
    // page's owner-only controls (block, facet-follow, resurface) must
    // follow that lens. A fixed SEED_VIEWER.personas check ignored View-As
    // entirely — visiting yeak__'s own profile while viewing-as another
    // persona still read isOwn=true, hiding controls that persona should
    // have seen. Found by the UX Gate 0 resurface-visibility test.
    // PROD-LIVE (D-CU-0-4): inside the device activeSeedPersonaId() is the VISITOR's acting persona — the same
    // answer /api/persona/chrome gives useApp().actingPersonaId — so a visitor's own profile reads isOwn=true there.
    const isOwn = seeded.id === activeSeedPersonaId();

    // LAYERS_WORLD=empty (lib/world.ts): every persona here is one of the device's REAL personas, so the profile
    // carries no demo numbers — no follower count derived from a tier, no stock banner, no invented join date — and
    // its posts are the persona's own local casts (the seeded posts a demo profile lists are not loaded)
    const emptyWorld = isEmptyWorld();
    let ownLocal: Cast[] = [];
    let joined = "March 2021";
    if (emptyWorld) {
      const { localCastsOf } = await import("@/lib/data");
      ownLocal = localCastsOf(seeded.id);
      const { getPersona: keystorePersona } = await import("@/lib/identity/keystore");
      const created = keystorePersona(seeded.id)?.createdAt;
      joined = created ? new Date(created).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";
    }

    const user: User = {
      fid: 0,
      username: seeded.handle,
      displayName: seeded.name,
      pfpUrl: seeded.avatarUrl,
      bio: seeded.bio,
      bannerUrl: emptyWorld ? undefined : `https://picsum.photos/seed/${seeded.handle}/1500/500`,
      followerCount: emptyWorld ? 0 : seeded.tier * 4100,
      followingCount: emptyWorld ? 0 : 200 + seeded.tier * 40,
      postCount: emptyWorld ? ownLocal.length : posts.length,
      joined,
      // ZK PASS 2 Gate 1: the check mark follows the PROVEN tier under zk
      verified: (profileTier ?? 0) >= 7,
    };

    const localAsProfile: Cast[] = ownLocal.map((c) => ({
      ...c,
      author: user,
      text: (c.text ?? "").replace(/\s*layers:persona:\S+/, ""),
      personaId: seeded.id,
      tier: profileTier,
    }));

    const casts: Cast[] = localAsProfile.concat(posts.map((p) => ({
      hash: p.hash,
      author: user,
      text: p.text,
      timestamp: absoluteTime(p.minutesAgo),
      replies: p.replies,
      likes: p.likes,
      recasts: p.recasts,
      views: p.views,
      embeds: [],
      truncate: p.truncate,
      personaId: p.authorPersonaId,
      // ZK PASS 2 Gate 1: the profile's own cards carry the PROVEN tier
      // under zk (0 renders "not proven"), the seed's tier otherwise
      tier: profileTier,
      storyId: p.storyId,
    })));

    // Disclosure surface. Everything shown in the linked-identities section
    // came from PersonaResolver, which already decided what this viewer may see.
    const identity = resolveIdentity(seeded.id, activeSeedPersonaId());
    // PERSONA LAUNCH P1 (SIWF's diff, applied here): the public self's sealed facts (fname, verifiedAt, disconnected —
    // never the fid). null for every persona that is not this device's public self (no vault read for them); THROWS
    // when a public self's link cannot be read — the profile errors rather than silently dropping "disconnected".
    const { publicSelfFacts } = await import("@/lib/fc/siwf/links");
    const publicSelf = await publicSelfFacts(seeded.id);

    return {
      kind: "seeded",
      personaId: seeded.id,
      name: seeded.name,
      handle: seeded.handle,
      user,
      tier: profileTier,
      postCount: emptyWorld ? ownLocal.length : posts.length,
      casts,
      isOwn,
      blockCheckFailed,
      isBlocked,
      identity,
      imported: await importedView(seeded.id),
      ...(publicSelf ? { publicSelf } : {}),
    };
  }

  // ---- phase-1 fixture profile (unchanged) ----
  const profile = await getProfileSourced(handle);
  const user = profile.value;
  if (!user) return null;
  const profileCasts = await getProfileCastsSourced(handle);
  const casts = await attachPersonaLayer(profileCasts.value);
  // FC-READ: a network account (answered by the read relay, lib/data.ts getProfile) is a STRANGER to our layer —
  // no persona roster lookup by its fid (a real fid collides with small fixture fids, the reason attachPersonaLayer
  // skips live casts), no tier, never "self". The page says it is a live, read-only Farcaster profile.
  // FC-READ (review): and whether it is live or off a shelf — the island renders the timelines' chip from liveSource.
  if (isNetworkMarked(user)) {
    const liveSource = pageLiveSource(profile.liveSource, profileCasts.liveSource);
    return { kind: "fixture", user, casts, isSelf: false, network: true, ...(liveSource ? { liveSource } : {}) };
  }
  const isSelf = user.username === getSelf().username;
  const personas = await personasByFid(user.fid);
  const tier = personas[0] ? await personaTier(personas[0].id, () => legacyValidatorTier(personas[0].id)) : undefined;
  // BUILD A review (UXC-12): an account read live (lib/data.ts marks it) gets a real Farcaster Follow on its header
  return { kind: "fixture", user, casts, isSelf, tier, ...(user.live === true && !isSelf ? { live: true as const } : {}) };
}

const importedDate = (ts: number) =>
  new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

const rowOf = (p: ImportedPost): ImportedRow => ({
  id: p.id,
  text: p.text,
  date: importedDate(p.createdAt),
  likes: p.favoriteCount.toLocaleString(),
  reposts: p.retweetCount.toLocaleString(),
  isReply: !!p.replyToId,
  isRetweet: p.isRetweet === true,
  resurfaced: p.resurfaced,
});

const countsOf = (posts: ImportedPost[]) => ({
  total: posts.length,
  retweets: posts.filter((p) => p.isRetweet).length,
  replies: posts.filter((p) => !!p.replyToId && !p.isRetweet).length,
});

/** the shelf's rows under a filter: retweets hidden unless asked for, replies shown unless hidden */
function filtered(posts: ImportedPost[], opts: { retweets: boolean; replies: boolean }): ImportedPost[] {
  return posts.filter((p) => (opts.retweets || !p.isRetweet) && (opts.replies || !p.replyToId || p.isRetweet));
}

/**
 * IMPORTED FROM X — the profile's history shelf (components/x/ImportedFromX.tsx renders it). null = nothing imported.
 * PERSONA LAUNCH P2 (BYX G3): the shelf is read (awaited) here — an unreadable shelf becomes the error state, never
 * null (null would render "nothing imported", which is the fail-open answer).
 */
async function importedView(personaId: string): Promise<ImportedView | null> {
  let posts: ImportedPost[];
  let attribution: Awaited<ReturnType<typeof shelfAttribution>>;
  try {
    posts = await importedPostsForAsync(personaId);
    attribution = await shelfAttribution(personaId);
  } catch (e) {
    return { status: "error", personaId, error: (e as Error).message || "the shelf could not be read" };
  }
  if (posts.length === 0) return null;
  const handle = attribution?.handle || posts[0].archiveHandle;
  const verifiedBy = attribution?.verifiedBy ?? null;
  const shown = filtered(posts, { retweets: false, replies: true });
  return {
    status: "ok",
    personaId,
    handle,
    verified: !!verifiedBy,
    verifiedBy,
    attribution: verifiedBy ? "verified" : attribution?.testLink ? "test-link" : "self-supplied",
    unlinked: !!attribution?.unlinked,
    anyResurfaced: posts.some((p) => p.resurfaced),
    counts: countsOf(posts),
    posts: shown.slice(0, SHELF_PAGE_SIZE).map(rowOf),
    nextOffset: shown.length > SHELF_PAGE_SIZE ? SHELF_PAGE_SIZE : null,
  };
}

/** one page of a persona's shelf for the profile's "Show more" and its chips (GET /api/x/import?view=shelf) */
export async function shelfPage(personaId: string, opts: { offset: number; retweets: boolean; replies: boolean }): Promise<ShelfPageView> {
  const posts = await importedPostsForAsync(personaId);
  const shown = filtered(posts, opts);
  const offset = Number.isSafeInteger(opts.offset) && opts.offset > 0 ? opts.offset : 0;
  const rows = shown.slice(offset, offset + SHELF_PAGE_SIZE).map(rowOf);
  return { rows, nextOffset: offset + SHELF_PAGE_SIZE < shown.length ? offset + SHELF_PAGE_SIZE : null, shown: shown.length, counts: countsOf(posts) };
}

// ---------- relationship history (components/RelationshipHistory.tsx, app/api/eventlog/history) ----------
// (the rig's profile page hands this view to a client island, so it crosses into the page's RSC payload: rendered
// text only — see lib/views/social.ts for what was stripped and why)

function when(ts: number): string {
  if (ts === 0) return "before the log existed";
  const mins = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
}

// PROD-LIVE (review fix): an event crosses to the client as the text the tab draws — never its log id (`ev_…`) or
// its triggeringCastId. The receipt is resolved HERE, where HEAD's server-rendered tab resolved it, and a cast that
// cannot be resolved ships only the 10-character prefix the tab prints (see lib/views/social.ts).
function receiptFor(hash: string | null): HistoryReceipt | null {
  if (!hash) return null;
  const post = postByHash.get(hash);
  if (!post) return { kind: "unresolved", hashPrefix: hash.slice(0, 10) };
  return { kind: "cast", handle: personaById.get(post.authorPersonaId)?.handle, text: post.text.slice(0, 140) };
}

function historyEvent(e: EdgeEvent): HistoryEvent {
  return { context: e.context, when: when(e.timestamp), receipt: receiptFor(e.triggeringCastId) };
}

/**
 * CALL OPTION B — the viewer's relationship history with one account. A failed read is an ERROR the tab renders,
 * never an empty history: "you have no history with them" and "we could not read it" are different answers.
 */
export async function relationshipHistoryView(
  viewerPersonaId: string,
  targetPersonaId: string
): Promise<RelationshipHistoryView> {
  let events: EdgeEvent[] = [];
  try {
    events = await retryAdapter(() => adapters.eventLog.forTarget(viewerPersonaId, targetPersonaId));
  } catch (e) {
    return { status: "error", error: (e as Error).message || "could not read the relationship log" };
  }
  const empty: Extract<RelationshipHistoryView, { status: "ok" }> = {
    status: "ok",
    empty: true,
    follow: null,
    backfilledFollow: false,
    firstInteraction: null,
    engagements: 0,
    strikes: [],
    muted: false,
    strikesOn: false,
    strikeThreshold: STRIKE_THRESHOLD,
  };
  if (events.length === 0) return empty;

  const follow = events.find((e) => e.type === "follow" && !e.backfilled);
  const backfilledFollow = events.some((e) => e.type === "follow" && e.backfilled);
  const firstInteraction = events.find((e) => e.type === "first_interaction");
  const engagements = events.filter((e) => e.type === "reply" || e.type === "like").length;
  const strikes = events.filter((e) => e.type === "strike");
  const mute = events.find((e) => e.type === "mute");
  const strikesOn = strikeSettingFor(viewerPersonaId).enabled;

  // each shown event carries its own receipt, resolved in historyEvent()/receiptFor() — no hash-keyed map crosses
  return {
    ...empty,
    empty: false,
    follow: follow ? historyEvent(follow) : null,
    backfilledFollow,
    firstInteraction: firstInteraction ? { receipt: receiptFor(firstInteraction.triggeringCastId) } : null,
    engagements,
    strikes: strikes.map(historyEvent),
    muted: !!mute,
    strikesOn,
  };
}

// ---------- thread (app/(main)/[handle]/status/[hash]/page.tsx, app/api/thread) ----------

/** A cast and its replies as the acting persona sees them, or null when no such cast is known here (a visitor's own
 *  fresh cast is known only inside the device — its permalink could never resolve on a public server). */
export async function threadView(hash: string): Promise<ThreadView | null> {
  const root = await getCastSourced(hash);
  const raw = root.value;
  if (!raw) return null;
  const [cast] = await attachPersonaLayer([raw]);
  const thread = await getThreadSourced(hash);
  const replies = await attachPersonaLayer(thread.value);
  // Refutation chains render distinctly from ordinary replies: a
  // reply that declares (or is curator-attested as) a refutation of
  // THIS cast gets the treatment. Author-declared and desk-attested
  // are labelled differently — testimony vs a checked claim.
  // The curator half is the VIEWER's (the feeds this persona subscribes to).
  const viewer = activeSeedPersonaId();
  const inbound = [
    ...edgesFor(cast.hash),
    ...curatorEdgesFor(viewer).filter((e) => e.toCastId === cast.hash),
  ].filter((e) => e.type === "refutes");
  // a Map's last-write-wins, kept as ordered pairs so it survives JSON
  const refuters = [...new Map(inbound.map((e) => [e.fromCastId, e.declaredBy as string])).entries()];
  // FC-READ: a relayed network cast's permalink — read-only on this preview; the page labels it so
  // FC-READ (review): with the relay's freshness, so a shelf answer is never shown as current
  if (isNetworkMarked(raw)) {
    const liveSource = pageLiveSource(root.liveSource, thread.liveSource);
    return { cast, permalinkTime: permalinkTime(cast.timestamp), replies, refuters, network: true, ...(liveSource ? { liveSource } : {}) };
  }
  return { cast, permalinkTime: permalinkTime(cast.timestamp), replies, refuters };
}

// ---------- notifications (app/(main)/notifications/page.tsx, app/api/notifications) ----------

export async function notificationsView(tab: string): Promise<NotificationsView> {
  // LAYERS_WORLD=empty (review F6): with no persona yet there is no mode to read — asking threw "no persona yet" three
  // times and the page said it could not read the mode. Said once, plainly, instead (the page renders NoPersonaYet).
  if (isEmptyWorld() && !activeSeedPersonaId()) return { tab, policy: null, policyError: null, notifications: [], noPersona: true };
  const all = await getNotifications();

  // The active mode's notificationPolicy, applied for real.
  //
  // PROD-LIVE (never fail open): an unreadable mode used to fall back to "all" and say NOTHING, so a muted or
  // mentions-only mode was silently ignored. The fallback direction stands — a missed mention is a cost, not a leak,
  // so the list still renders unfiltered by policy — but it is no longer silent: policyError rides the payload and
  // the page says, visibly and with a Retry, that the mode's setting could not be read and nothing was filtered.
  let policy: NotificationPolicy | null = null;
  let policyError: string | null = null;
  try {
    const mode = await retryAdapter(() => adapters.mode.getActive(activeSeedPersonaId()));
    policy = (mode.notificationPolicy ?? "all") as NotificationPolicy;
  } catch (e) {
    policyError = (e as Error).message || "could not read the active mode";
  }
  const notifications = filterByTab(policy === null ? all : filterByPolicy(all, policy), tab);
  return {
    tab,
    policy,
    policyError,
    notifications: notifications.map((n) => ({ ...n, when: relativeTime(n.timestamp) })),
  };
}

// ---------- history shelf (app/(main)/history/page.tsx, app/api/history) ----------

export async function historyShelfView(): Promise<HistoryShelfView> {
  // FC-READ: seedOnly — this shelf is presented as the visitor's OWN history, and a relayed network cast is nobody's
  // history here (the relay reads discovery surfaces only; the design's "never relayed" list names this shelf)
  const { casts } = await getFeed("foryou", 0, { seedOnly: true });
  return { casts: await attachPersonaLayer(casts.slice(2, 6)) };
}
