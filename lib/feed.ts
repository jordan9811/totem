import "server-only";
// The mode-aware feed pipeline. Reads seeded posts, applies (in order):
// blocks → facet-follow scoping → mode rules (via lib/rules) → saturation →
// mode-specific shaping → ranking weights. Then splices in feed-health
// cards (readwise chunks, sends, note corrections).
import type { Cast, Embed, User } from "./types";
import type { ModeDefinition, Rule } from "./adapters/types";
import { adapters } from "./adapters/registry";
import { injectIntoFeed, type InjectionItem } from "./injection";
import { resolveForwardPointer } from "./identity/fork";
import { followingFor } from "./eventlog/log";
import { flaggedAuthors, subscribedAnnotations } from "./curators/annotations";
import { holdsStanding } from "./refutation/edges";
import { threeStrikeMuted } from "./eventlog/strikes";
import { packsForMode, packFailures } from "./packs/service";
import { resolvableSiblings } from "./identity/grants";
import { verifiedGrants } from "./identity/verifiedGrants";
import { contentSource, isLiveContent } from "./adapters/neynar/mode";
import { deviceNeynarOn } from "./fc/source/switch";
import { liveFeed, relayDiscovery, relayStateOf, seedSource, type LiveResult, type LiveSource } from "./adapters/neynar/content";
import { AdapterError } from "./adapters/types";
import { evaluateGroup, ruleActions, validateRuleGroup } from "./rules/evaluate";
import { provenAttestationsFor } from "./attest/proven";
import { marketClock } from "./adapters/mock/clock";
import { hasModeOverride } from "./session/ephemeral";
import {
  SEED_NOTES,
  SEED_POSTS,
  SEED_VIEWER,
  absoluteTime,
  personaById,
  postByHash,
  state,
  type SeedPost,
} from "./adapters/mock/store";

// Mock adapters fail 2% of calls by design. buildFeed fans out across
// several of them, so a single unretried pass fails often enough to be
// visible. Retry transient failures the way a real client would, and let
// the error state handle persistent ones.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// UX Gate 1 — time/context auto-switch. Lazy, not polled: there is no
// background scheduler anywhere in this app (on-demand-first is the
// standing convention), so the rule is checked at the one point that
// already runs on every feed load — right here, before the active mode is
// read for rendering. Fires on a seeded clock advance because it reads
// marketClock, the SAME controllable clock every other timed feature in
// this project uses; never fires for a persona currently overridden by an
// explicit in-session swipe ("more specific wins").
async function applyActivationRuleIfDue(personaId: string): Promise<void> {
  if (hasModeOverride(personaId)) return;
  const owned = await withRetry(() => adapters.mode.list(personaId));
  const hourUTC = new Date(marketClock.now()).getUTCHours();
  const ctx = {
    post: { hash: "", topicId: null, isUpdate: false, hasMedia: false, ageMinutes: 0 },
    author: { personaId: "", tier: 1, cluster: null },
    viewer: { personaId: null, followingPersonaIds: [] as string[] },
    clock: { hourUTC },
  };
  const due = owned.find((m) => m.activationEnabled && m.activationRule && evaluateGroup(m.activationRule, ctx));
  if (!due) return;
  const active = await withRetry(() => adapters.mode.getActive(personaId));
  if (active.id === due.id) return; // already there — no redundant write
  // NOT markModeOverride: a binding firing is not a user swipe, and must
  // stay overridable by a later explicit one within the same session.
  await withRetry(() => adapters.mode.setActive(personaId, due.id));
}

export interface FeedCard {
  kind: "post" | "readwise" | "sent" | "correction" | "folder" | "highlight" | "ad" | "moved" | "caughtup" | "migration" | "resurfaced";
  cast: Cast;
  /** authored by a private persona; only ever present for a granted viewer */
  private?: boolean;
  /** MULTI-FID Gate 4: relayed through the shared anon account — attributed to no one */
  anon?: true;
  /** FC-READ: a real Farcaster cast read through the public preview's read relay — READ-ONLY here (the write routes
   *  answer 403 NETWORK_READ_ONLY on it). Its cast carries the same mark. Never set on the rig's direct live path. */
  network?: true;
  /** KOTH: this post's claim lost standing (tier-weighted refutation or a
   * subscribed desk's attestation). Sunk in the ordering AND marked, so the
   * fact is assertable from the payload rather than inferred from position. */
  standingLost?: true;
  /** moved: a fork's forward pointer, resolvable only by carried holders */
  moved?: {
    fromHandle: string;
    fromName: string;
    toPersonaId: string;
    toHandle: string;
    toName: string;
    toAvatarUrl: string;
  };
  /** readwise */
  chunkIndex?: number;
  chunkTotal?: number;
  /** POST-DEPLOY Gate 4: this chunk came from a folder the owner marked priority */
  readwisePriority?: boolean;
  /** UX Gate 3: set only for a schedule created from cold-store resolution
   * (an X bookmark folder / DM thread) — overrides the default "your
   * bookmarks" attribution copy. Absent for an ordinary readwise schedule. */
  readwiseSource?: string;
  /** sent */
  sentByHandle?: string;
  /** correction */
  noteText?: string;
  noteAuthorHandle?: string;
  /** set when the correction came from a subscribed curator feed */
  curatorName?: string;
  evidenceLink?: string;
  annotationId?: string;
  /** MEGA PASS 2 Gate 1: wrong + misleading stake on the corrected post — the spectrum feeding the notes surface */
  stakeWrong?: number;
  /** folder */
  folderName?: string;
  folderId?: string;
  /** migration (X interop Gate 4): the deferred auto-follow notices */
  migrationText?: string;
  migrationKind?: "joined" | "waiting";
  /** resurfaced (UX Gate 0): a promoted X import, entering feeds for real */
  resurfacedFromX?: true;
  folderCuratorHandle?: string;
  /** highlight reel */
  roomId?: string;
  roomTitle?: string;
  highlights?: { text: string; handle: string; name: string; avatarUrl: string; tier: number }[];
  /** in-feed ad unit */
  ad?: {
    campaignId: string;
    advertiserHandle: string;
    advertiserName: string;
    advertiserAvatarUrl: string;
    body: string;
    reasons: string[];
    embed?: {
      title: string;
      currentBid: number;
      slots: number;
      slotsFilled: number;
      href: string;
    };
  };
}

function personaToUser(personaId: string, tier: number): User {
  const p = personaById.get(personaId);
  return {
    fid: 0,
    username: p?.handle ?? "unknown",
    displayName: p?.name ?? "Unknown",
    pfpUrl: p?.avatarUrl ?? "",
    bio: p?.bio,
    followerCount: 0,
    followingCount: 0,
    verified: tier >= 7,
  };
}

type TierResolver = (personaId: string, seedTier: number) => number;
const seedTierOnly: TierResolver = (_personaId, seedTier) => seedTier;

/** MULTI-FID Gate 4: the shared anon account's avatar — a fixed glyph, never a persona's */
const ANON_PFP = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="#536471"/><circle cx="20" cy="16" r="7" fill="#fff"/><path d="M8 34c2-7 7-10 12-10s10 3 12 10z" fill="#fff"/></svg>');

function seedToCast(post: SeedPost, tier: number, tierOf: TierResolver = seedTierOnly): Cast {
  const s = state();
  const embeds: Embed[] = [];
  if (post.quoteOfHash) {
    const quoted = postByHash.get(post.quoteOfHash);
    if (quoted) {
      // ZK PASS 2 Gate 1: a quoted author's tier is PROOF under zk too
      const qTier = tierOf(quoted.authorPersonaId, personaById.get(quoted.authorPersonaId)?.tier ?? 1);
      embeds.push({ type: "quote", quote: seedToCast(quoted, qTier, tierOf) });
    }
  }
  return {
    hash: post.hash,
    author: personaToUser(post.authorPersonaId, tier),
    text: post.text,
    timestamp: absoluteTime(post.minutesAgo),
    replies: post.replies,
    likes: post.likes,
    recasts: post.recasts,
    views: post.views,
    embeds,
    truncate: post.truncate,
    personaId: post.authorPersonaId,
    tier,
    storyId: post.storyId,
    isUpdate: post.isUpdate,
    viewerLiked: s.likes.has(post.hash),
    replyingTo: post.replyToHash ? postByHash.get(post.replyToHash)?.hash : undefined,
  };
}

/** MEGA PASS 2 Gate 2: the mode's own ranking, TERM BY TERM — the evaluate API shows these beside the lens terms,
 * and rankScore is exactly their sum, so the breakdown is the ranking and not a story about it */
export function baseRankTerms(post: SeedPost, mode: ModeDefinition, viewerFollowing: Set<string>, tier: number): { term: string; raw: number; weight: number; contribution: number }[] {
  const ageHours = post.minutesAgo / 60;
  const recency = 1 / (1 + ageHours / 12);
  const engagement = Math.log10(1 + post.likes + post.recasts * 3) / 4;
  const affinity = viewerFollowing.has(post.authorPersonaId) ? 1 : 0;
  const viewerCluster = personaById.get(SEED_VIEWER.activePersonaId)?.cluster;
  const clusterAffinity = personaById.get(post.authorPersonaId)?.cluster === viewerCluster ? 1 : 0;
  const w = mode.ranking;
  const terms = [
    { term: "recency", raw: recency, weight: w.recency, contribution: recency * w.recency },
    { term: "engagement", raw: engagement, weight: w.engagement, contribution: engagement * w.engagement },
    { term: "authorAffinity", raw: affinity, weight: w.authorAffinity, contribution: affinity * w.authorAffinity },
    { term: "clusterAffinity", raw: clusterAffinity, weight: w.clusterAffinity, contribution: clusterAffinity * w.clusterAffinity },
  ];
  // Calm ranking damps high-engagement outliers (Event Safe Space).
  if (mode.calmRanking) terms.push({ term: "calmRanking", raw: engagement, weight: -0.3, contribution: -engagement * 0.3 });
  // Curate weights long-form and bookmarks up.
  if (mode.longformOnly) {
    if (post.truncate) terms.push({ term: "longform", raw: 1, weight: 0.5, contribution: 0.5 });
    if (state().bookmarks.has(post.hash)) terms.push({ term: "bookmarked", raw: 1, weight: 0.4, contribution: 0.4 });
  }
  terms.push({ term: "tierNudge", raw: tier, weight: 1 / 200, contribution: tier / 200 }); // gentle tier nudge, never dominant
  return terms;
}

function rankScore(post: SeedPost, mode: ModeDefinition, viewerFollowing: Set<string>, tier: number): number {
  let score = 0;
  for (const t of baseRankTerms(post, mode, viewerFollowing, tier)) score += t.contribution;
  return score;
}

/** the tier resolver the feed ranks with (PROOF under zk, the seed tier otherwise) — for the evaluate API */
export async function tierResolver(): Promise<TierResolver> {
  const { discoveryEligibility } = await import("@/lib/zk/gate");
  const zkGate = await discoveryEligibility();
  return (personaId, seedTier) => (zkGate ? zkGate.provenTier(personaId) : seedTier);
}

export async function buildFeed(
  personaId: string,
  opts: {
    surface: "discovery" | "following";
    limit?: number;
    /** Preview support: run the feed under THIS mode instead of the active
     * one. The algo import preview passes a candidate here so its numbers
     * come from the identical code path activation will use — the exactness
     * guarantee is structural, not aspirational. */
    modeOverride?: ModeDefinition;
    /** Inline rules for a preview mode whose rules have no stored ids yet
     * (an artifact carries full definitions, not ids). Refused unless every
     * rule passes the evaluator's guardrail validator — the same refusal an
     * activation would hit. */
    inlineRules?: Rule[];
    /** MEGA PASS 2 Gate 2: rank through THIS lens instead of the mode's (a preview); null = canonical (no lens terms) */
    lensOverride?: import("@/lib/lens/types").LensSpec | null;
  } = { surface: "discovery" }
): Promise<{
  cards: FeedCard[];
  mode: ModeDefinition;
  contentStale: boolean;
  /** FC-READ: whether this surface read through the preview's read relay, and how that went (content.ts LiveSource) */
  liveSource: LiveSource;
  lensId: string;
  /** POST-DEPLOY Gate 3 — the BANNER tier's surface. A strip above the timeline,
   *  not a notification: it is drawn from posts already in this build's eligible
   *  set, so it can never show something the mode's rules excluded, and it never
   *  appears below the caught-up banner. */
  previewStrip?: { hash: string; authorPersonaId: string; handle: string; text: string; minutesAgo: number }[];
  /** the hashes the delivery tiers pinned, for the UI to mark and the suite to assert */
  pinnedHashes?: string[];
}> {
  const s = state();
  // Preview mode (modeOverride set) must render EXACTLY the candidate — the
  // whole point is that the numbers come from the identical code path
  // activation will use, so an auto-switch sneaking in here would corrupt
  // the very guarantee this override exists for.
  if (!opts.modeOverride) await applyActivationRuleIfDue(personaId);
  const mode = opts.modeOverride ?? (await withRetry(() => adapters.mode.getActive(personaId)));
  const [blockedIds, saturated, followedFacetIds, reinjections, schedules, inbox] = await Promise.all([
    withRetry(() => adapters.rep.blockedFor(personaId)),
    withRetry(() => adapters.feedHealth.listSaturated(personaId, mode.id)),
    withRetry(() => adapters.disclosure.followedFacets(personaId)),
    withRetry(() => adapters.feedHealth.reinjectionsFor(personaId)),
    withRetry(() => adapters.feedHealth.getReadwiseSchedules(personaId)),
    withRetry(() => adapters.feedHealth.inboxFor(personaId)),
  ]);

  // Network-state filter packs, PER-MODE: Work can run a pack Default does
  // not, because attachment lives on the mode. A pack hides exactly the
  // personas it fails — no sibling fan-out, since predicates are claims
  // about the account itself, and fanning out through linkages would let a
  // pack read the disclosure graph sideways.
  try {
    for (const pack of packsForMode(mode.filterPackIds)) {
      for (const failed of packFailures(pack.artifact)) blockedIds.push(failed);
    }
  } catch {
    /* an unreadable pack filters nothing — packs are opt-in curation, and
       failing closed here would mean a broken pack silently blanks feeds */
  }

  // Curator-flagged authors, per the viewer's OWN subscription choice.
  // Derived at read time from VALID annotations only — nothing persisted, so
  // unsubscribing reverses all of it on the next render. Auto-block composes
  // with cross-persona blocking: a flagged author's resolvable siblings
  // disappear too, through the same grant-resolved fan-out ordinary blocks
  // use. Fail-closed direction: an unreadable subscription list means no
  // curator effects, never phantom blocks.
  // 3-strike mutes: soft-hidden from feeds, no sibling fan-out — a mute is
  // about attention, not identity. Derived per render; disabling the toggle
  // un-mutes with receipts intact.
  let strikeMuted = new Set<string>();
  try {
    strikeMuted = await threeStrikeMuted(personaId);
  } catch {
    strikeMuted = new Set(); // fail open for a mute: a missed mute costs
    // attention, not disclosure
  }
  for (const m of strikeMuted) blockedIds.push(m);

  const demotedAuthors = new Set<string>();
  try {
    const flags = flaggedAuthors(personaId);
    for (const [author, action] of flags) {
      if (action === "autoblock") {
        blockedIds.push(author);
        for (const sib of resolvableSiblings(
          // verified grants only — a forged grant must not widen a blocklist
          verifiedGrants(),
          s.resolutionRequests,
          author,
          personaId
        )) {
          blockedIds.push(sib);
        }
      } else if (action === "demote") {
        demotedAuthors.add(author);
      }
    }
  } catch {
    /* no curator effects on failure */
  }

  // Channel gating FAILS CLOSED. If we cannot establish membership, the
  // viewer is a member of nothing and every channel post stays hidden —
  // never the reverse (gated-pass ground rule 4).
  let visibleChannels: Set<string>;
  try {
    visibleChannels = new Set(await withRetry(() => adapters.space.visibleChannelIds(personaId)));
  } catch {
    visibleChannels = new Set();
  }

  // Followed public folders + their newest additions, and room highlights.
  let followedFolderIds: string[] = [];
  try {
    followedFolderIds = await withRetry(() => adapters.space.followedFolders(personaId));
  } catch {
    followedFolderIds = [];
  }

  const blocked = new Set(blockedIds);
  const saturatedStories = new Set(saturated.map((e) => e.storyId));
  // Live graph: seed baseline plus runtime follow/unfollow deltas. The
  // static read this replaced meant the Follow button could never actually
  // change your feed.
  const following = followingFor(personaId);

  // Facet-follow scoping: if the viewer follows specific facets of a root,
  // only that root's personas in those clusters are eligible.
  const facetScopedRoots = new Map<string, Set<string>>(); // rootId -> allowed clusters
  for (const facetId of followedFacetIds) {
    const m = facetId.match(/^facet_(.+)_([^_]+)$/);
    if (!m) continue;
    const [, rootId, cluster] = m;
    if (!facetScopedRoots.has(rootId)) facetScopedRoots.set(rootId, new Set());
    facetScopedRoots.get(rootId)!.add(cluster);
  }

  // POST-DEPLOY Gate 3 — DELIVERY TIERS, compiled into ordinary rules.
  //
  // The tiers are (account x mode), so they are resolved for THIS mode and
  // handed to the SAME evaluator every other filter uses; there is deliberately
  // no second filtering path for them to live in. The compiled set is one rule
  // per non-normal tier — the account never enters the rule, only the tier
  // string the map resolves per post.
  //
  // Fails CLOSED on the quiet side and open on nothing: an unreadable tier map
  // throws in lib/delivery/tiers.ts rather than reading as "everything normal",
  // because silently un-quieting an account is the one direction of this
  // setting that hands attention to somebody the owner turned down.
  let deliveryMap = new Map<string, import("@/lib/delivery/tiers").DeliveryTier>();
  let deliveryRules: Rule[] = [];
  let QUIET_PENALTY = 0;
  {
    const { tierMapFor, compileDeliveryRules, QUIET_PENALTY: qp } = await import("@/lib/delivery/tiers");
    QUIET_PENALTY = qp;
    // GATE 5 (attack-post-2 F-9): an unreadable tier map threw straight out of buildFeed and
    // 503'd the ENTIRE timeline. That is a worse failure than the one the throw exists to
    // prevent, and it contradicted the posture, which promised "delivers everything Normally".
    // The module still refuses to treat an unreadable vault as empty; the FEED degrades to
    // Normal delivery and keeps working, which is what the posture now says.
    try {
      deliveryMap = await tierMapFor(mode.id);
    } catch {
      deliveryMap = new Map();
    }
    const allowed = new Set<string>();
    for (const set of facetScopedRoots.values()) for (const c of set) allowed.add(c);
    // GATE 5 (attack-post-2 F-1): compile only the tiers actually in use — see the note in
    // lib/delivery/tiers.ts about what compiling the facet-only rule unconditionally cost.
    deliveryRules = deliveryMap.size ? compileDeliveryRules([...allowed], new Set(deliveryMap.values())) : [];
  }
  const deliveryOf = (authorPersonaId: string): string => deliveryMap.get(authorPersonaId) ?? "normal";

  // Resolve the mode's rules once.
  const rules: Rule[] = [];
  rules.push(...deliveryRules);
  for (const inline of opts.inlineRules ?? []) {
    const violations = validateRuleGroup(inline.root);
    if (violations.length) {
      throw new AdapterError(
        `inline rule "${inline.name}" refused: ${violations.map((v) => v.reason).join("; ")}`,
        "FAILED"
      );
    }
    rules.push(inline);
  }
  for (const ruleId of mode.ruleIds) {
    const rule = await withRetry(() => adapters.rules.get(ruleId));
    // A mode that references a rule we cannot resolve must NOT quietly serve
    // an unfiltered feed. Silently skipping is a fail-open: a Work or Event
    // Safe Space user would see exactly the content the mode exists to hide,
    // with no indication anything went wrong. Surface it instead.
    if (!rule) {
      throw new AdapterError(
        `mode "${mode.name}" references rule ${ruleId}, which could not be resolved — refusing to serve an unfiltered feed`,
        "FAILED"
      );
    }
    rules.push(rule);
  }

  // ZK PASS 1 Gate 2: the proof-mediated discovery gate. Null unless the
  // rep binding is zk — then eligibility comes from what each author
  // PROVED this epoch (one validator read per build), with the explicit
  // per-gate fallback; and the "you always see your own personas" exemption
  // is the CURRENT viewer's own personas, not the seed viewer's.
  const { discoveryEligibility } = await import("@/lib/zk/gate");
  // ZK PASS 2 Gate 1: under the zk binding the gate's proven map stamps the
  // tier on EVERY surface (0 = not proven this epoch); discovery hiding is
  // still applied only on the discovery surface (below).
  const zkGate = await discoveryEligibility();
  const tierOf = (personaId: string, seedTier: number): number => (zkGate ? zkGate.provenTier(personaId) : seedTier);
  const { ownSiblingIds } = await import("@/lib/identity/ownership");
  const ownOfViewer = zkGate ? new Set([personaId, ...ownSiblingIds(personaId)]) : null;
  const discoveryHides = (authorPersonaId: string, tier: number): boolean => {
    if (opts.surface !== "discovery") return false;
    if (zkGate) return !ownOfViewer!.has(authorPersonaId) && !zkGate.isEligible(authorPersonaId, tier);
    return tier === 1 && !SEED_VIEWER.personas.includes(authorPersonaId);
  };

  // MEGA PASS 2 Gate 1: verified stake summaries on the seeded corpus — ONE public read per build; an additive
  // signal, so an unreadable stake store adds nothing (and never hides anything)
  let stakeSummaries = new Map<string, import("@/lib/influence/types").CastStakeSummary>();
  try {
    const { recentStakes, summarize } = await import("@/lib/influence/stakes");
    const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
    stakeSummaries = summarize(await recentStakes(2), new Set(await ownPersonaIdsAll()));
  } catch {
    stakeSummaries = new Map();
  }
  // MEGA PASS 2 Gate 2: the LENS this feed ranks through — the mode's pin, an attached pack's pin, or canonical
  // (the identity: zero weights, so the feed is byte-for-byte the feed without one). A preview passes its own.
  const { lensForMode, CANONICAL_LENS_ID } = await import("@/lib/lens/service");
  const { signalsFor, lensScore } = await import("@/lib/lens/signals");
  const activeLens =
    opts.lensOverride === undefined
      ? lensForMode(mode)
      : opts.lensOverride
        ? { id: "preview", spec: opts.lensOverride }
        : { id: CANONICAL_LENS_ID, spec: null };
  let curatorFlaggedCasts = new Set<string>();
  try {
    curatorFlaggedCasts = new Set(subscribedAnnotations(personaId).map(({ annotation }) => annotation.targetCastId));
  } catch {
    curatorFlaggedCasts = new Set();
  }
  const lensTermFor = (post: SeedPost, tier: number): number => {
    if (!activeLens.spec) return 0;
    return lensScore(
      activeLens.spec,
      signalsFor({
        post: { text: post.text, likes: post.likes, recasts: post.recasts, minutesAgo: post.minutesAgo, truncate: post.truncate },
        tier,
        attestations: provenAttestationsFor(post.authorPersonaId),
        stakes: stakeSummaries.get(post.hash) ?? null,
        curatorFlagged: curatorFlaggedCasts.has(post.hash),
        saturated: !!post.storyId && saturatedStories.has(post.storyId),
      })
    );
  };

  const eligible: SeedPost[] = [];
  // POST-DEPLOY Gate 3: what the delivery rules decided, by post hash
  const pinned = new Set<string>();
  const bannered = new Set<string>();
  const quieted = new Set<string>();
  for (const post of SEED_POSTS) {
    const author = personaById.get(post.authorPersonaId);
    // the legacy (seed) tier is what the explicit `policy` fallback rules on;
    // the tier shown and ranked is PROOF under zk (0 = not proven)
    const legacyTier = author?.tier ?? 1;
    const tier = tierOf(post.authorPersonaId, legacyTier);

    // Channel posts require membership. Fails closed: visibleChannels is
    // empty when membership could not be established.
    if (post.channelId && !visibleChannels.has(post.channelId)) continue;
    if (blocked.has(post.authorPersonaId)) continue;
    if (mode.hideReplies && post.replyToHash) continue;
    if (mode.followedOnly && !following.has(post.authorPersonaId)) continue;

    // Facet scoping applies only to roots the viewer has facet-followed.
    if (author && facetScopedRoots.has(author.rootId)) {
      const allowedClusters = facetScopedRoots.get(author.rootId)!;
      if (!allowedClusters.has(author.cluster)) continue;
    }

    // Saturation: a caught-up story is suppressed UNLESS the post is an update.
    if (post.storyId && saturatedStories.has(post.storyId) && !post.isUpdate) continue;

    // Discovery surfaces filter tier-1 personas (phase-1 client policy),
    // except the viewer's own. Following surface is unfiltered. Under the
    // zk rep binding this is the proof-mediated gate (see discoveryHides).
    if (discoveryHides(post.authorPersonaId, legacyTier)) continue;

    // THE rules engine — every mode filter goes through it.
    const ctx = {
      post: {
        hash: post.hash,
        topicId: post.storyId,
        isUpdate: post.isUpdate,
        hasMedia: false,
        ageMinutes: post.minutesAgo,
        text: post.text,
      },
      // Attestation pass Gate 3: what the author PROVED this epoch (empty unless the zk gate loaded it)
      author: { personaId: post.authorPersonaId, tier, cluster: author?.cluster ?? null, attestations: provenAttestationsFor(post.authorPersonaId) },
      viewer: { personaId, followingPersonaIds: [...following] },
      delivery: { tier: deliveryOf(post.authorPersonaId) },
    };
    // SPEC A: the one per-post decision (lib/rules/evaluate.ts ruleActions), which the real Following takes too
    const act = ruleActions(rules, ctx);
    if (act.hide) continue;
    // POST-DEPLOY Gate 3: the other three actions, read off the SAME evaluation.
    // They change PLACEMENT, never membership — the eligible set is whatever the
    // hide rules left, and nothing below adds a post to it.
    if (act.pin) pinned.add(post.hash);
    if (act.banner) bannered.add(post.hash);
    if (act.downrank) quieted.add(post.hash);

    eligible.push(post);
  }

  eligible.sort((a, b) => {
    const ta = tierOf(a.authorPersonaId, personaById.get(a.authorPersonaId)?.tier ?? 1);
    const tb = tierOf(b.authorPersonaId, personaById.get(b.authorPersonaId)?.tier ?? 1);
    return rankScore(b, mode, following, tb) + lensTermFor(b, tb) - (rankScore(a, mode, following, ta) + lensTermFor(a, ta));
  });
  // GATE 5 (attack-post-2 F-2): the quiet penalty is NOT applied here, and the comment two
  // hundred lines down says why. This is the CORPUS sort over every eligible post; the window
  // is cut at `limit` afterwards. A penalty here pushed a quiet author below the cut entirely,
  // which is a de facto block wearing derank's label — verbatim the trap the demote feature hit
  // and documented at the final sort. Quiet is applied THERE, where the ordering survives and
  // the author stays on the page.

  // Author diversity: a pure score sort stacks four posts from the same
  // prolific account in a row, which no real timeline does. Push a post
  // down if the same author appeared in the last two slots.
  const limit = opts.limit ?? 40;
  // POST-DEPLOY Gate 3: NEVER-MISS is hoisted OUT of the diversity walk and put
  // at the front. It has to be out of the walk, not merely scored higher: the
  // walk exists to stop one prolific account stacking slots, which is exactly
  // what it would do to the account you said you never want to miss. It is
  // capped at a quarter of the page, because "never miss" that fills the screen
  // is a different product (and the cap is what stops marking 200 accounts from
  // turning the timeline into a pin board).
  // ONE POST PER PINNED ACCOUNT, and at most a quarter of the page in total.
  // Pinning every post a never-miss account made turns the top of the timeline
  // into that one account — which is exactly what the diversity walk below
  // exists to prevent, and marking someone never-miss is not a request to hear
  // only from them. The rest of their posts rank normally, like everyone else's.
  const pinCap = Math.max(1, Math.floor(limit / 4));
  const seenAuthor = new Set<string>();
  const pins: SeedPost[] = [];
  for (const p of eligible) {
    if (!pinned.has(p.hash) || seenAuthor.has(p.authorPersonaId)) continue;
    seenAuthor.add(p.authorPersonaId);
    pins.push(p);
    if (pins.length >= pinCap) break;
  }
  const pinSet = new Set(pins.map((p) => p.hash));
  const ordered: SeedPost[] = [...pins];
  const pending = eligible.filter((p) => !pinSet.has(p.hash));
  while (ordered.length < limit && pending.length > 0) {
    const recent = ordered.slice(-2).map((p) => p.authorPersonaId);
    let pick = pending.findIndex((p) => !recent.includes(p.authorPersonaId));
    if (pick === -1) pick = 0; // nothing else available — take the best remaining
    ordered.push(pending.splice(pick, 1)[0]);
  }

  // POST-DEPLOY Gate 3 — the BANNER tier's strip. Newest first, from the
  // ELIGIBLE set (not from `ordered`, so a banner post that fell off the page
  // still surfaces — that is what the tier is for), capped so a strip stays a
  // strip. Not a notification: nothing is pushed, nothing is counted unread.
  const previewStrip = eligible
    .filter((p) => bannered.has(p.hash))
    .sort((a, b) => a.minutesAgo - b.minutesAgo)
    .slice(0, 6)
    .map((p) => ({
      hash: p.hash,
      authorPersonaId: p.authorPersonaId,
      handle: personaById.get(p.authorPersonaId)?.handle ?? p.authorPersonaId,
      text: p.text.length > 90 ? p.text.slice(0, 89) + "…" : p.text,
      minutesAgo: p.minutesAgo,
    }));

  let cards: FeedCard[] = ordered.map((post) => ({
    kind: "post" as const,
    cast: seedToCast(post, tierOf(post.authorPersonaId, personaById.get(post.authorPersonaId)?.tier ?? 1), tierOf),
  }));

  for (const c of cards) {
    const sum = stakeSummaries.get(c.cast.hash);
    if (sum) c.cast.stakes = sum;
  }

  // ---- live content ----
  //
  // In neynar mode the BASE of the timeline is real Farcaster casts. Our
  // layer still runs on top: private posts, moved cards, the injection
  // queue, and the mode's own settings. That is the composition the gate
  // asks for — the persona layer rendering over live content, not instead
  // of it.
  //
  // Live authors are real Farcaster accounts, not seeded personas, so no
  // persona/grant resolution attaches to them. That is correct rather than a
  // gap: a disclosure grant is a claim about OUR personas, and inventing one
  // for a stranger's fid would be fabricating a linkage.
  //
  // FC-READ — the public preview's READ RELAY takes this same branch, on the DISCOVERY surface only, with the
  // relay's identity-free "discovery" op as the base (one shared answer, identical for every visitor, never a
  // viewer fid). FC-READ (no channels): what that answer reads upstream is the relay's choice — in v1 a server-held
  // list of authors, not channels, which are not a v1 emphasis — so nothing below may assume a relayed cast carries a
  // channel (it carries none).
  // Following never: it is the visitor's own world, and a followed-only mode is skipped too — its whole
  // question is "whom do you follow", every network cast is unattributed (no author to have followed), and the
  // seeded base IS the followed graph, so the relay would only blank it. Relay mode keeps what isLiveContent()
  // drops below (the injection queue, the caught-up banner): its seed-derived cards are self-contained.
  // Status travels as liveSource, never as contentStale — that banner promises a retry on refresh, which a kill
  // switch or a spent budget will not honour.
  let contentStale = false;

  // Fail-closed live rule evaluation. A hide rule that references
  // author.* fields DEMANDS author knowledge; for an unattributed
  // live stranger that knowledge does not exist, so the rule HIDES
  // the cast (hide-when-unsure), not shows it — show-when-unsure
  // would let an Event Safe Space tier rule wave every stranger
  // through, the exact fail-open the rules exist to prevent.
  // FC-READ (review): hoisted above the relay decision — the relay base below needs the same answer BEFORE it reads.
  const referencesAuthor = (grp: Rule["root"]): boolean =>
    grp.clauses.some((c) => ("combinator" in c ? referencesAuthor(c) : /^author\./.test(c.field)));
  // GATE 5 (attack-post-2 F-1, residual): a DELIVERY rule is excluded from this question.
  //
  // The question is "is there a hide rule whose answer depends on who the author is",
  // and it exists so a live cast with an unresolvable author fails CLOSED. A delivery
  // rule's first clause is `delivery.tier eq <tier>`, and an unattributed cast has tier
  // "normal" by construction, so such a rule can NEVER match one — but the facet-only
  // rule also carries an `author.cluster` clause, so it answered this test and dropped
  // every stranger's cast from a live timeline. One preference on one account, a blank
  // feed. The question is asked of the rules the OWNER wrote.
  const isDeliveryRule = (r: Rule) => r.id.startsWith("delivery:");
  const authorHideRuleExists = rules.some((r) => r.action === "hide" && !isDeliveryRule(r) && referencesAuthor(r.root));

  // FC-READ (review, correctness-relay-safe-space-blank-discovery): a mode with an author.* hide rule (Event Safe
  // Space's tier floor, a cluster rule, any owner rule on author fields) hides EVERY relayed cast — every network
  // author is an unattributed stranger, so the fail-closed rule above drops them all. Reading the relay there only
  // spent a read to blank the timeline under a "live" chip. So the relay base is not taken at all: the seeded base
  // stands (already filtered by the same mode, above), no relay read is made, and the page says why ("filtered").
  // NEYNAR AS A SWITCH (§42, lib/fc/source/switch.ts): the relay is For You's base only while the operator switched For You
  // to Neynar (FC_SOURCE_FORYOU). An armed relay with For You on the network reads nothing, and the payload says so.
  const relayArmedHere = contentSource() === "relay" && opts.surface === "discovery" && !mode.followedOnly;
  const relayWanted = relayArmedHere && deviceNeynarOn("forYou");
  const relayBase = relayWanted && !authorHideRuleExists;
  let liveSource: LiveSource =
    relayWanted && authorHideRuleExists ? { source: "relay", state: "filtered" } : relayArmedHere && !relayWanted ? { source: "seed", state: "network" } : seedSource();
  /** the network base replaced the seeded one (relay mode) — the anon merge below keeps off it */
  let networkBase = false;
  if (isLiveContent() || relayBase) {
    try {
      let live: LiveResult<Cast[]>;
      if (relayBase) {
        const r = await relayDiscovery();
        live = { value: r.value, stale: r.stale };
        liveSource = { source: "relay", state: r.state };
      } else {
        const viewerFid = Number(process.env.NEYNAR_VIEWER_FID ?? "3");
        live = await liveFeed(viewerFid, opts.limit ?? 40);
      }
      if (live.value.length) {
        if (!relayBase) contentStale = live.stale;
        const now = Date.now();
        // FC Gate 4 FIRST, Gate 2 rules SECOND — attribution resolves
        // before rule filtering so an ATTRIBUTED cast (one of ours,
        // through the shared FID) evaluates author rules with its REAL
        // persona fields, and blocklists compose (a blocked persona's
        // attributed casts disappear — the one honest way a persona
        // blocklist applies to live strangers).
        const { attributionFor } = await import("./fc/attribution");
        const withAtt = live.value.map((cast) => ({ cast, att: attributionFor(cast.hash, personaId) }));

        // (authorHideRuleExists — the fail-closed author question — is computed above the relay decision)
        const liveEligible = withAtt.filter(({ cast, att }) => {
          if (mode.hideReplies && (cast.replyingTo || cast.parentHash)) return false;
          if (att && blocked.has(att.id)) return false;
          // discovery's tier-1 policy applies to ATTRIBUTED casts the same
          // way it applies to seeded ones (own personas exempt, as ever);
          // under the zk rep binding, the proof-mediated gate applies
          if (att && discoveryHides(att.id, att.tier)) return false;
          if (!att && authorHideRuleExists) return false; // unknowable author under an author rule: hidden
          const persona = att ? personaById.get(att.id) : undefined;
          // GATE 5 (attack-post-2 F-3): the live path gets the SAME delivery context as the
          // seeded one. Without it every tier was inert on live content and quiet failed OPEN —
          // the one direction this setting must never fail, because it hands attention back to
          // an account the owner deliberately turned down.
          const ctx = {
            post: {
              hash: cast.hash,
              topicId: null,
              isUpdate: false,
              hasMedia: cast.embeds.length > 0,
              ageMinutes: Math.max(0, (now - cast.timestamp) / 60_000),
              text: cast.text,
            },
            author: att
              ? { personaId: att.id, tier: att.tier, cluster: persona?.cluster ?? null, attestations: provenAttestationsFor(att.id) }
              : // sentinels whose comparisons are all false — non-author
                // clauses still evaluate normally for strangers
                { personaId: "", tier: NaN, cluster: null },
            viewer: { personaId, followingPersonaIds: [...following] },
            delivery: { tier: att ? deliveryOf(att.id) : "normal" },
          };
          const act = ruleActions(rules, ctx);
          if (att) {
            if (act.pin) pinned.add(cast.hash);
            if (act.banner) bannered.add(cast.hash);
            if (act.downrank) quieted.add(cast.hash);
          }
          return !act.hide;
        });

        // Mode ranking over live engagement — rankScore's shape with the
        // fields live casts actually have.
        //
        // FC-READ: plus the LENS term, through the SAME signalsFor/lensScore the seeded sort uses. Before this a
        // lens did nothing to live content, so the lens and algo previews (which promise "the identical code path")
        // showed no effect on a live timeline. The post-shaped signals (likes, recasts, dwell, age) are real on a
        // network cast; the identity-shaped ones are honestly ABSENT for a stranger — tier 0 (what the zk gate says
        // of an unproven author), no attestations, no curator flag, no saturation — never invented. The canonical
        // lens is all-zero weights, so a feed with no lens ranks exactly as it did.
        const liveLensTerm = (cast: Cast, att: { id: string; tier: number } | null): number => {
          if (!activeLens.spec) return 0;
          return lensScore(
            activeLens.spec,
            signalsFor({
              post: {
                text: cast.text,
                likes: cast.likes,
                recasts: cast.recasts,
                minutesAgo: Math.max(0, (now - cast.timestamp) / 60_000),
                truncate: cast.truncate,
              },
              tier: att ? tierOf(att.id, att.tier) : 0,
              attestations: att ? provenAttestationsFor(att.id) : [],
              stakes: stakeSummaries.get(cast.hash) ?? null,
              curatorFlagged: curatorFlaggedCasts.has(cast.hash),
              saturated: false,
            })
          );
        };
        const liveScore = (cast: Cast, att: { id: string; tier: number } | null) => {
          const ageHours = Math.max(0, (now - cast.timestamp) / 3_600_000);
          const recency = 1 / (1 + ageHours / 12);
          const engagement = Math.log10(1 + cast.likes + cast.recasts * 3) / 4;
          let score = recency * mode.ranking.recency + engagement * mode.ranking.engagement;
          if (mode.calmRanking) score -= engagement * 0.3;
          if (mode.longformOnly && cast.truncate) score += 0.5;
          return score + liveLensTerm(cast, att);
        };
        // Ranking here is WINDOW SELECTION, exactly as it is for seeded
        // content: the demote/recency pass later in the pipeline is the
        // feed's final display order, so the mode's weights decide WHICH
        // casts make the window, not how the window is ordered. (The
        // earlier version sorted and then kept everything — mode ranking
        // was dead code by the time the final sort ran. Re-review find.)
        // followedOnly needs no live check: the live base feed IS the
        // viewer fid's following feed by construction. (FC-READ: the relay's
        // discovery base is NOT — which is why relayBase excludes a
        // followed-only mode outright, above.)
        const ranked = [...liveEligible]
          .sort((a, b) => liveScore(b.cast, b.att) - liveScore(a.cast, a.att))
          .slice(0, opts.limit ?? 40);

        // A live feed the MODE filtered to zero is an EMPTY live feed —
        // the empty-state UI exists for exactly this. Reverting to the
        // seeded universe here would show content the user's mode hid,
        // sourced from a world they weren't even looking at.
        // FC-READ: relayed cards carry network:true (their casts already do, from the device's shaping in
        // content.ts) — the mark CastCard keys its read-only treatment on, and the write routes' per-target guard
        // agrees with it (a 40-hex hash no local store holds).
        const net = relayBase ? { network: true as const } : {};
        if (relayBase && ranked.length === 0) {
          // FC-READ (review): never a "live" chip over an empty timeline. The author-rule case never reaches here (the
          // relay base is not taken for it, above); this is any OTHER mode filter that hid every relayed cast. On the
          // preview the seeded cards are the discovery corpus the relay stood in for — already put through this same
          // mode — so they stand, labelled "filtered", rather than an empty page under a live label. (The rig's
          // direct live path keeps its empty-state answer, unchanged.)
          liveSource = { source: "relay", state: "filtered" };
        } else {
          cards = ranked.map(({ cast, att }) =>
            att
              ? {
                  kind: "post" as const,
                  ...net,
                  private: att.private ? (true as const) : undefined,
                  cast: {
                    ...cast,
                    personaId: att.id,
                    tier: tierOf(att.id, att.tier),
                    author: {
                      ...cast.author,
                      username: att.handle,
                      displayName: att.name,
                      pfpUrl: att.avatarUrl || cast.author.pfpUrl,
                    },
                  },
                }
              : { kind: "post" as const, ...net, cast }
          );
          networkBase = relayBase;
        }
      } else {
        // An EMPTY live response (the network answered with nothing)
        // leaves the seeded cards in place rather than blanking the
        // timeline — but LABELED degraded, never laundered as the live
        // feed it isn't. (FC-READ: in relay mode the label is liveSource.)
        if (relayBase) liveSource = { source: "relay", state: "error" };
        else contentStale = true;
      }
    } catch (e) {
      // A failed live read falls back to seeded content rather than an
      // empty screen — availability, not disclosure. Labeled degraded for
      // the same honesty reason as above. (FC-READ: in relay mode the label
      // is liveSource — off / budget / unarmed / error, from the relay's own
      // code; the seeded cards stand in and the page says they are preview.)
      if (relayBase) liveSource = { source: "relay", state: relayStateOf(e) };
      else contentStale = true;
    }
  }

  // ---- private posts, inline ----
  //
  // Interleaved by recency into the ranked list rather than spliced through
  // the injection queue: a private post from someone you follow is an
  // ordinary post that happens to have an audience, not an interstitial.
  //
  // SINGLE STORE. These are read from the one private store at request time
  // and authorized per viewer. They are never copied into a per-viewer feed
  // store, because a copy cannot be retracted and revoke would become a lie.
  try {
    const privatePosts = await withRetry(() => adapters.identity.visiblePrivatePosts(personaId));
    for (const p of privatePosts) {
      if (p.replyToHash) continue; // replies live in the thread, not the timeline
      const author = personaById.get(p.authorPersonaId);
      if (!author) continue;
      cards.push({
        kind: "post",
        private: true,
        cast: {
          hash: p.hash,
          author: {
            fid: 0,
            username: author.handle,
            displayName: author.name,
            pfpUrl: author.avatarUrl,
            bio: author.bio ?? "",
            followerCount: 0,
            followingCount: 0,
          },
          text: p.text,
          timestamp: p.createdAt,
          replies: 0,
          likes: p.likes.length,
          recasts: 0,
          views: 0,
          embeds: [],
          personaId: p.authorPersonaId,
          tier: tierOf(p.authorPersonaId, author.tier),
          viewerLiked: p.likes.includes(personaId),
        },
      });
    }
    // MULTI-FID Gate 4: the relayed anon casts — ordinary posts by the shared anon account, read from the
    // validator's PUBLIC list (no viewer on the request). No persona, no tier, no attribution: nothing to
    // block, follow, demote or accrue to. Discovery content: a followed-only mode has no author to follow.
    // FC-READ: and never onto a NETWORK base. On the public preview these are the fixture relay's anon posts —
    // preview-only, never on Farcaster — and merged between real network casts they would read as casts the
    // network carries. They stay on the seeded surfaces (Following, or discovery whenever the relay is not the base).
    // PUBLIC GO-LIVE (public live mode): once the anonymous posts are REAL Farcaster casts (the anon universe is not the
    // fixture one), they ARE what the network carries, and the live home feed is the relay's discovery plus them — so
    // they merge onto the network base too. A fixture (preview) anon post never does: it would read as a network cast.
    const { isPublicLive } = await import("./platform/publicLive");
    const { zkMode: anonUniverse } = await import("./zk/config");
    const anonOnNetworkBase = networkBase && isPublicLive() && anonUniverse() !== "fixture";
    if (!mode.followedOnly && (!networkBase || anonOnNetworkBase)) {
      const { fetchAnonCasts } = await import("./zk/validatorClient");
      const { zkMode } = await import("./zk/config");
      const anonCasts = await withRetry(() => fetchAnonCasts(zkMode()));
      // PERSONA LAUNCH P5 — THE REACH LABEL'S INPUTS, read once per build from what this client already holds (no fetch):
      // the last tick's issuer registry (honour BY KEY) and its census of bucket sizes, and the client's reach floor
      const reachCtx = await (async () => {
        const { cachedSnapshot } = await import("./zk/prefetch");
        const { ZK_REACH_FLOOR } = await import("./zk/config");
        const { isHonoredIssuer } = await import("./attest/subscriber");
        const snap = cachedSnapshot(zkMode());
        const keyOf = new Map((snap?.issuers ?? []).map((i) => [i.id, i.pubkey]));
        const census = snap && !snap.bucketsError ? { epoch: snap.epoch.epoch, sizes: Object.fromEntries(snap.buckets.map((b) => [b.tree, b.size])) } : null;
        return { honoured: (issuer: string) => isHonoredIssuer(issuer, keyOf.get(issuer) ?? null), floor: ZK_REACH_FLOOR, census };
      })();
      const { reachLabelFor } = await import("./reach/boost");
      // PERSONA LAUNCH P7: on the PUBLIC deployment's test universe every anon card is a preview post — relayed by the
      // validator's fixture relay, never on Farcaster — and each one says so (never present test data as live). The owner
      // service and the rig are not public deployments; a live-universe card is never marked.
      const { isPublicDeployment } = await import("./platform/env-contract");
      const previewOnly = isPublicDeployment() && zkMode() === "fixture";
      for (const a of anonCasts) {
        // MULTI-FID PASS — the anoncast reveal pattern: still rendered as the shared anon account
        // (that IS how it was posted and how every other client sees it), but with a note if its
        // poster has since chosen to attribute it — never guessed, only ever what the poster revealed
        let attributedTo: Cast["attributedTo"] = null;
        if (a.attributedFid != null) {
          const { publicProfileForFid } = await import("./fc/personaFid");
          // §14.2 — pass the signer key the validator recorded so the resolver can check the claim
          // before we put a name on someone else's anonymous post. An unverifiable claim renders as
          // nothing at all (NOT as a bare fid): "we could not check this" must never look like a
          // weaker version of "@x said this".
          attributedTo = await publicProfileForFid(a.attributedFid, a.attributedSigner ?? null).catch(() => null);
        }
        cards.push({
          kind: "post",
          anon: true,
          cast: {
            hash: a.hash,
            castHash: a.castHash,
            anon: true,
            attributedTo,
            author: { fid: a.fid, username: "anon", displayName: "anon", pfpUrl: ANON_PFP, bio: "", followerCount: 0, followingCount: 0, anon: true },
            text: a.text,
            timestamp: a.at,
            replies: 0,
            likes: 0,
            recasts: 0,
            views: 0,
            embeds: [],
          },
        });
        const cast = cards[cards.length - 1].cast as Cast;
        if (previewOnly) cast.previewOnly = true;
        // PERSONA LAUNCH P5: the reach tier the post proved — set ONLY when the label rule holds (lib/reach/boost.ts:
        // honoured by key, a crowd at or above the floor, the size agreeing with this client's census); absent otherwise
        const reach = reachLabelFor(a, reachCtx);
        if (reach) cast.reach = reach;
        // PERSONA LAUNCH P4 (rings' line): which persona wrote it, when a ring this device is in shared it — the key is
        // ABSENT for a non-member (never null), and the note itself is never copied onto a card
        const { ringRevealForAnon } = await import("./rings/merge");
        const ring = ringRevealForAnon(a.castHash);
        if (ring) cast.ringShared = ring;
      }
    }
    // King of the hill: posts that lost standing sink with the demoted.
    // Standing is computed per-post from edges — tier-weighted author
    // declarations and subscribed curator attestations — and reply volume
    // appears nowhere in it. The seeded flood (a tier-1 account declaring
    // refutation ten times against a tier-9 claim) must change nothing.
    const sunkForStanding = new Set<string>();
    if (mode.kingOfTheHill) {
      try {
        for (const c of cards) {
          if (c.kind === "post" && c.cast && !c.private && !c.anon && !holdsStanding(c.cast.hash, personaId)) {
            sunkForStanding.add(c.cast.hash);
            c.standingLost = true;
          }
        }
      } catch {
        /* standing unavailable -> nothing sinks; volume still never counts */
      }
    }

    // GATE 5, second look at attack-post-2 F-3: giving the LIVE path a delivery context
    // fixed quiet (which is decided in the sort below, after the live merge) and did NOT
    // fix pin or banner, because both were frozen from the SEEDED corpus a hundred lines
    // above — a live cast matched the pin rule, went into `pinned`, and was then ignored.
    // Half a fix reads exactly like a whole one from the outside, which is why this is
    // written down rather than quietly patched.
    //
    // The same two limits apply as for the seeded hoist: ONE post per pinned account, and
    // the whole pinned block capped at a quarter of the page.
    {
      // GATE 5 (attack-post-2 F-3, residual): the caps are recomputed over the cards ACTUALLY
      // on the page. The seeded eligibility pass fills pinSet and previewStrip from the seed
      // corpus, and on a live timeline those seeded posts are not in `cards` at all — so both
      // caps were already exhausted by entries nobody could see, and the live back-fill broke
      // on its first iteration. A banner account's live casts never reached the strip, and ten
      // never-miss accounts made the pin key a no-op on live content.
      const onPage = new Set(cards.map((c) => c.cast?.hash).filter(Boolean) as string[]);
      for (const h of [...pinSet]) if (!onPage.has(h)) pinSet.delete(h);
      for (let i = previewStrip.length - 1; i >= 0; i--) if (!onPage.has(previewStrip[i].hash)) previewStrip.splice(i, 1);
      const pinnedAuthors = new Set<string>();
      for (const h of pinSet) {
        const c = cards.find((x) => x.cast?.hash === h);
        if (c?.cast?.personaId) pinnedAuthors.add(c.cast.personaId);
      }
      for (const c of cards) {
        if (pinSet.size >= pinCap) break;
        const hash = c.cast?.hash;
        const author = c.cast?.personaId;
        if (!hash || !author) continue;
        if (!pinned.has(hash) || pinSet.has(hash)) continue;
        if (pinnedAuthors.has(author)) continue;
        pinnedAuthors.add(author);
        pinSet.add(hash);
      }
      // and the banner tier's strip, which was likewise built from the seeded set only
      for (const c of cards) {
        if (previewStrip.length >= 6) break;
        const hash = c.cast?.hash;
        if (!hash || !bannered.has(hash) || previewStrip.some((x) => x.hash === hash)) continue;
        if (!c.cast) continue;
        previewStrip.push({
          hash,
          authorPersonaId: c.cast.personaId ?? "",
          handle: c.cast.author.username,
          text: c.cast.text.length > 90 ? c.cast.text.slice(0, 89) + "\u2026" : c.cast.text,
          minutesAgo: Math.max(0, Math.round((Date.now() - (c.cast.timestamp ?? Date.now())) / 60000)),
        });
      }
    }

    // Demote sinks flagged authors to the bottom of the WINDOW — this is
    // the feed's final ordering, so it is the only place a position
    // guarantee can actually be made. (An earlier attempt sank them in
    // the corpus sort, which pushed them below the limit entirely — a de
    // facto block wearing demote's label; a second attempt sank them
    // before this recency sort, which promptly unsank them.)
    //
    // POST-DEPLOY Gate 3 — the delivery tiers land HERE, for the reason the
    // comment above records about demote: this recency sort is the feed final
    // ordering, so it is the only place a position guarantee survives. Pinning
    // in the corpus ordering put the never-miss post at the top of `ordered`
    // and this sort put it straight back where its timestamp said — the same
    // trap, one feature later.
    //
    // Deliberately BELOW the demote key: a sunk author stays sunk. Never-miss
    // is the owner ordering their own timeline, not a way to overrule a
    // curator flag or a standing penalty on the author.
    //
    // PERSONA LAUNCH P5 — THE FOR YOU BOOST: on the DISCOVERY surface only, a labelled anon card (cast.reach, set above)
    // sorts as if it were REACH_BOOST_MS[bucket] newer. It sits BELOW demote, pin and quiet, and ties between anon cards
    // break on their cast hash, so the order is a pure function of the rows (lib/reach/boost.ts makeFinalComparator,
    // where the keys are written once and unit-tested; with no reach label anywhere it is exactly the sort it replaced).
    const { makeFinalComparator } = await import("./reach/boost");
    cards.sort(
      makeFinalComparator<FeedCard>({
        sunk: (c) => !!((c.cast?.personaId && demotedAuthors.has(c.cast.personaId)) || (c.cast && sunkForStanding.has(c.cast.hash))),
        pinned: (c) => !!(c.cast && pinSet.has(c.cast.hash)),
        quiet: (c) => !!(c.cast && quieted.has(c.cast.hash)),
        discovery: opts.surface === "discovery",
      })
    );
  } catch {
    // FAIL CLOSED. If we cannot establish who is entitled to a private post,
    // nobody gets one. The alternative — showing them on a failed read — is
    // the exact inversion of the feature.
  }

  // ---- feed-health cards spliced in ----

  // Health cards surface posts that skipped the main eligibility pass, so
  // they must honour the same visibility rules — otherwise a blocked or
  // facet-scoped author leaks back in through a correction or a send.
  function visible(post: SeedPost): boolean {
    // Channel posts are visible only to members. Applies to health cards
    // too, so a correction or a send can't leak a channel post outward.
    if (post.channelId && !visibleChannels.has(post.channelId)) return false;
    if (blocked.has(post.authorPersonaId)) return false;
    const author = personaById.get(post.authorPersonaId);
    if (author && facetScopedRoots.has(author.rootId)) {
      if (!facetScopedRoots.get(author.rootId)!.has(author.cluster)) return false;
    }
    return true;
  }

  // Readwise chunks: one card per surfaced chunk, in order.
  const { coldSourceLabelForHash } = await import("@/lib/x/coldstore");
  // MEGA PASS 2 Gate 5: DM-sourced items drip at the MODE's cadence — one tick per feed build, per (persona, mode)
  const { dmCadenceDue, dmSourceLabelForHash, DEFAULT_DM_READWISE } = await import("@/lib/x/inbox");
  const dmCfg = mode.dmReadwise ?? DEFAULT_DM_READWISE;
  const dmDue = opts.modeOverride ? true : dmCadenceDue(personaId, mode.id, dmCfg.every);
  // POST-DEPLOY Gate 4 — the readwise knobs, the dwell state and the bin.
  //
  // A chunk that has been READ is done: it stops surfacing. A chunk that was
  // surfaced and not read REQUEUES, which here means simply that it keeps
  // surfacing — there is no separate queue to put it back on, because the
  // schedule already holds it and the dwell map already knows it is unread.
  // A BURIED chunk is out until the owner restores it from the bin.
  //
  // Priority folders are a plain WEIGHT: chunks whose source post sits in a
  // folder the owner marked priority are emitted FIRST, so when the cadence
  // slider is low they are the ones that fit. No model, no decay, no estimate.
  const { dwellMap, buriedIds, priorityFolders } = await import("@/lib/readwise/state");
  let readDwell: Record<string, { read: boolean }> = {};
  let buried = new Set<string>();
  let priorityHashes = new Set<string>();
  let readwiseAvailable = true;
  try {
    readDwell = await dwellMap();
    buried = await buriedIds();
    const prio = new Set(await priorityFolders());
    for (const f of s.folders.values()) if (prio.has(f.id)) for (const h of f.postHashes) priorityHashes.add(h);
  } catch {
    // The readwise state is unreadable, so the queue is UNAVAILABLE rather than
    // empty-by-default. Surfacing the schedules anyway was the first version and
    // it is the wrong direction: it would replay chunks the owner has already
    // read and, worse, resurface ones they DISMISSED. A reading queue that is
    // briefly absent is a degradation someone can understand; one that hands
    // back what you threw away is a broken promise.
    readwiseAvailable = false;
  }
  const readwisePriority: FeedCard[] = [];
  const readwiseRest: FeedCard[] = [];
  for (const schedule of readwiseAvailable ? schedules : []) {
    const source = postByHash.get(schedule.postHash);
    if (!source || !visible(source)) continue;
    if (schedule.postHash.startsWith("dm:") && !dmDue) continue;
    const tier = tierOf(source.authorPersonaId, personaById.get(source.authorPersonaId)?.tier ?? 1);
    const readwiseSource = dmSourceLabelForHash(schedule.postHash) ?? coldSourceLabelForHash(schedule.postHash) ?? undefined;
    const bucket = priorityHashes.has(schedule.postHash) ? readwisePriority : readwiseRest;
    for (let i = 0; i < schedule.nextChunkIndex; i++) {
      const chunkId = `${source.hash}#chunk${i + 1}`;
      if (readDwell[chunkId]?.read) continue;
      if (buried.has(chunkId)) continue;
      bucket.push({
        kind: "readwise",
        chunkIndex: i + 1,
        chunkTotal: schedule.chunks.length,
        readwiseSource,
        readwisePriority: bucket === readwisePriority || undefined,
        cast: {
          ...seedToCast(source, tier, tierOf),
          hash: chunkId,
          text: schedule.chunks[i],
          truncate: false,
          embeds: [],
        },
      });
    }
  }
  const readwiseCards: FeedCard[] = [...readwisePriority, ...readwiseRest];
  const readwiseKnobs = await (await import("@/lib/readwise/state")).knobsFor(mode.id).catch(() => ({ perBuild: 4, chunkWords: 280 }));

  // Sent-to-timeline cards.
  const sentCards: FeedCard[] = inbox
    .map((event) => {
      const post = postByHash.get(event.postHash);
      if (!post || !visible(post)) return null;
      const tier = tierOf(post.authorPersonaId, personaById.get(post.authorPersonaId)?.tier ?? 1);
      return {
        kind: "sent" as const,
        sentByHandle: personaById.get(event.fromPersonaId)?.handle ?? "someone",
        cast: { ...seedToCast(post, tier, tierOf), hash: `${post.hash}#sent${event.id}` },
      };
    })
    .filter(Boolean) as FeedCard[];

  // Community-notes correction cards — only qualifying notes reinject.
  const correctionCards: FeedCard[] = reinjections
    .filter((r) => r.qualifies)
    .map((r) => {
      const post = postByHash.get(r.postHash);
      const note = SEED_NOTES.find((n) => n.id === r.noteId);
      if (!post || !note || !visible(post)) return null;
      const tier = tierOf(post.authorPersonaId, personaById.get(post.authorPersonaId)?.tier ?? 1);
      return {
        kind: "correction" as const,
        noteText: note.text,
        noteAuthorHandle: personaById.get(note.authorPersonaId)?.handle ?? "unknown",
        stakeWrong: (stakeSummaries.get(post.hash)?.byDirection.wrong ?? 0) + (stakeSummaries.get(post.hash)?.byDirection.misleading ?? 0),
        cast: { ...seedToCast(post, tier, tierOf), hash: `${post.hash}#note${note.id}` },
      };
    })
    .filter(Boolean) as FeedCard[];

  // ---- curator annotations on engaged posts: SAME correction surface ----
  //
  // No parallel display system. A subscribed curator's valid annotation on a
  // post the viewer engaged with rides the identical card type community
  // notes use, tagged with the curator's identity. Sub-threshold annotations
  // never reach this loop — validAnnotations() already refused them.
  try {
    for (const { annotation, feed: curFeed } of subscribedAnnotations(personaId)) {
      if (!s.likes.has(annotation.targetCastId)) continue;
      const post = postByHash.get(annotation.targetCastId);
      if (!post || !visible(post)) continue;
      const tier = tierOf(post.authorPersonaId, personaById.get(post.authorPersonaId)?.tier ?? 1);
      correctionCards.push({
        kind: "correction" as const,
        noteText: annotation.claim,
        noteAuthorHandle: curFeed.name,
        curatorName: curFeed.name,
        evidenceLink: annotation.evidenceLink,
        annotationId: annotation.id,
        stakeWrong: (stakeSummaries.get(post.hash)?.byDirection.wrong ?? 0) + (stakeSummaries.get(post.hash)?.byDirection.misleading ?? 0),
        cast: { ...seedToCast(post, tier, tierOf), hash: `${post.hash}#ann${annotation.id}` },
      });
    }
  } catch {
    /* curator surfaces are additive; a read failure adds nothing */
  }

  // ---- folder cards: newest addition from each followed public folder ----
  const folderCards: InjectionItem[] = [];
  for (const folderId of followedFolderIds) {
    let folder;
    try {
      folder = await withRetry(() => adapters.space.getFolder(folderId));
    } catch {
      continue; // a folder we can't read is simply not injected
    }
    if (!folder || !folder.isPublic) continue;
    const newest = folder.postHashes[0];
    const post = newest ? postByHash.get(newest) : undefined;
    if (!post || !visible(post)) continue;
    const tier = tierOf(post.authorPersonaId, personaById.get(post.authorPersonaId)?.tier ?? 1);
    folderCards.push({
      type: "folder",
      sourceHash: post.hash,
      card: {
        kind: "folder",
        folderName: folder.name,
        folderId: folder.id,
        folderCuratorHandle: personaById.get(folder.ownerPersonaId)?.handle ?? "someone",
        cast: { ...seedToCast(post, tier, tierOf), hash: post.hash + "#folder" + folder.id },
      },
    });
  }

  // ---- highlight reels: closed rooms whose topic matches this viewer ----
  const highlightCards: InjectionItem[] = [];
  try {
    const rooms = await withRetry(() => adapters.space.listRooms());
    const viewerCluster = personaById.get(personaId)?.cluster;
    for (const room of rooms) {
      if (room.status !== "closed") continue;
      // Topic match via the rules engine's own notion of cluster affinity:
      // a reel reaches viewers whose cluster matches the room's topic.
      if (room.topicCluster !== viewerCluster) continue;
      const highlights = await withRetry(() => adapters.space.listHighlights(room.id));
      if (highlights.length === 0) continue;
      const hostTier = tierOf(room.hostPersonaId, personaById.get(room.hostPersonaId)?.tier ?? 1);
      highlightCards.push({
        type: "highlight",
        sourceHash: "reel:" + room.id,
        card: {
          kind: "highlight",
          roomId: room.id,
          roomTitle: room.title,
          highlights: highlights.map((h) => ({
            text: h.text,
            handle: personaById.get(h.personaId)?.handle ?? "unknown",
            name: personaById.get(h.personaId)?.name ?? "Unknown",
            avatarUrl: personaById.get(h.personaId)?.avatarUrl ?? "",
            tier: tierOf(h.personaId, personaById.get(h.personaId)?.tier ?? 1),
          })),
          cast: {
            ...seedToCast(
              {
                hash: "reel_" + room.id,
                authorAccId: "",
                authorPersonaId: room.hostPersonaId,
                text: room.title,
                minutesAgo: 1,
                replyToHash: null,
                quoteOfHash: null,
                storyId: null,
                isUpdate: false,
                truncate: false,
                replies: 0,
                likes: 0,
                recasts: 0,
                views: 0,
              },
              hostTier,
              tierOf
            ),
            hash: "reel_" + room.id,
          },
        },
      });
    }
  } catch {
    // Highlight reels are additive; failing to load them must not break the feed.
  }

  // ONE injection queue for every card type — dedupes across types and caps
  // each type per session (lib/injection.ts).
  // ---- in-feed ads ----
  // Ads surface ONLY for viewers whose graph matches a campaign, and ONLY
  // in modes that allow them. Event Safe Space sets allowAds=false, so the
  // exclusion is a mode property enforced here rather than a special case
  // scattered through the UI.
  // ADS, PHASE 1: a mode set to "No ads" (lib/ads/dial.ts) gets none here either. The sample world's Wave 6 ads below
  // are its test-data market demo (graph-matched); Phase 1's house ads are placed by the device (lib/ads/plan.ts).
  const adCards: InjectionItem[] = [];
  if (mode.allowAds !== false && mode.adDial !== "none") {
    try {
      const matches = await withRetry(() => adapters.market.matchingCampaigns(personaId));
      for (const m of matches.slice(0, 2)) {
        const advertiser = personaById.get(m.campaign.advertiserPersonaId);
        const openIntents = [...state().intents.values()].filter((i) => i.status === "open");
        const demoIntent = openIntents[0];
        adCards.push({
          type: "ad",
          sourceHash: "ad:" + m.campaign.id,
          card: {
            kind: "ad",
            cast: seedToCast(
              {
                hash: "ad_" + m.campaign.id,
                authorAccId: "",
                authorPersonaId: m.campaign.advertiserPersonaId,
                text: m.campaign.name,
                minutesAgo: 1,
                replyToHash: null,
                quoteOfHash: null,
                storyId: null,
                isUpdate: false,
                truncate: false,
                replies: 0,
                likes: 0,
                recasts: 0,
                views: 0,
              },
              tierOf(m.campaign.advertiserPersonaId, personaById.get(m.campaign.advertiserPersonaId)?.tier ?? 1), tierOf
            ),
            ad: {
              campaignId: m.campaign.id,
              advertiserHandle: advertiser?.handle ?? "unknown",
              advertiserName: advertiser?.name ?? "Advertiser",
              advertiserAvatarUrl: advertiser?.avatarUrl ?? "",
              body: m.campaign.name,
              reasons: m.reasons,
              // One working mini-app embed: the simplified live-auction card.
              embed: demoIntent
                ? {
                    title: demoIntent.description,
                    currentBid: Math.round(demoIntent.escrowAmount * 0.55),
                    slots: demoIntent.pitchSlots,
                    slotsFilled: (state().bids.get(demoIntent.id) ?? []).length,
                    href: "/market/" + demoIntent.id,
                  }
                : undefined,
            },
          },
        });
      }
    } catch {
      // Ads are additive — failing to load them must never break the feed.
    }
  }

  // ---- moved cards: a fork's forward pointer, for carried holders only ----
  //
  // This runs through resolveForwardPointer(), the exact function the API
  // uses. That is deliberate: two gates drift, and the Gate 1 blind spot was
  // precisely a second door nobody tested. If a viewer is not named on a
  // forward grant, the loop simply produces no card — there is no branch that
  // could accidentally emit one.
  const movedCards: InjectionItem[] = [];
  for (const fork of s.forks.values()) {
    let target: string | null = null;
    try {
      target = resolveForwardPointer(fork.oldPersona, personaId, new Set(fork.forwardGrantIds));
    } catch {
      target = null; // fail closed: an unreadable grant tells you nothing
    }
    if (!target) continue;
    const from = personaById.get(fork.oldPersona);
    const to = personaById.get(target);
    if (!from || !to) continue;
    movedCards.push({
      type: "moved",
      sourceHash: "moved:" + fork.oldPersona,
      card: {
        kind: "moved",
        moved: {
          fromHandle: from.handle,
          fromName: from.name,
          toPersonaId: to.id,
          toHandle: to.handle,
          toName: to.name,
          toAvatarUrl: to.avatarUrl,
        },
        cast: {
          hash: "moved:" + fork.oldPersona,
          author: {
            fid: 0,
            username: to.handle,
            displayName: to.name,
            pfpUrl: to.avatarUrl,
            bio: to.bio ?? "",
            followerCount: 0,
            followingCount: 0,
          },
          text: "",
          timestamp: fork.forkedAt,
          replies: 0,
          likes: 0,
          recasts: 0,
          views: 0,
          embeds: [],
          personaId: to.id,
          tier: tierOf(to.id, to.tier),
        },
      },
    });
  }

  // In live mode the seed-derived injections are dropped. A community note
  // about a seeded post, or a folder card pointing at one, annotates a post
  // that is not in this timeline — the card would reference something the
  // viewer cannot scroll to. Our layer still composes with live content
  // through the cards that are self-contained: moved pointers and private
  // posts (ours by construction) and ad units (their own campaign objects).
  //
  // FC-READ: the public preview's RELAY mode keeps them all. isLiveContent()
  // is false there by design (mode.ts), so the checks below are untouched and
  // the rig's live semantics stay exactly as they were. On the preview each of
  // these cards carries its own post inside it (seedToCast in every builder
  // above), the visitor's world — sends, readwise, folders, notes — is the
  // point of the product, and the network base is only the discovery corpus.
  // X-migration notices: the deferred moment's cards, each ride the queue
  // as their own tenant so a busy correction day cannot starve them
  const { noticesFor } = await import("@/lib/x/migration");
  // PERSONA LAUNCH P2 (BYX G3): the shelf is a chunked sealed document (lib/x/shelf.ts). Read it — once per process,
  // then from its cache — so the resurfaced cards below see it; an unreadable shelf adds no cards here (the profile
  // says why it could not be read), exactly as before the shelf had loaded.
  try {
    const { loadShelf } = await import("@/lib/x/shelf");
    await loadShelf();
  } catch {
    /* skipped: the shelf contributes nothing to this feed until it can be read */
  }
  const { importedPostsFor } = await import("@/lib/x/importer");
  const migrationCards: InjectionItem[] = noticesFor(personaId)
    .slice(0, 3)
    .map((n) => ({
      type: "migration" as const,
      tenant: "x_migration",
      sourceHash: "migration:" + n.id,
      card: {
        kind: "migration" as const,
        migrationText: n.text,
        migrationKind: n.kind,
        cast: {
          hash: "migration:" + n.id,
          author: { fid: 0, username: n.handle, displayName: n.handle, pfpUrl: "", followerCount: 0, followingCount: 0 },
          text: n.text,
          timestamp: n.at,
          replies: 0,
          likes: 0,
          recasts: 0,
          embeds: [],
        },
      },
    }));

  // UX Gate 0 — resurfaced X imports. Default off; this list is empty for
  // every persona who never touched the toggle. Each carries a FRESH
  // timestamp (resurfacedAt), never the original createdAt — that field
  // stays untouched on the "Imported from X" history view regardless.
  const resurfacedCards: InjectionItem[] = importedPostsFor(personaId)
    .filter((p) => p.resurfaced && p.resurfacedAt)
    .map((p) => {
      const author = personaById.get(personaId);
      const cast: Cast = {
        hash: "resurfaced:" + p.id,
        author: {
          fid: 0,
          username: author?.handle ?? personaId,
          displayName: author?.name ?? "Unknown",
          pfpUrl: author?.avatarUrl ?? "",
          followerCount: 0,
          followingCount: 0,
          verified: tierOf(personaId, author?.tier ?? 1) >= 7,
        },
        text: p.text,
        timestamp: p.resurfacedAt as number,
        replies: 0,
        likes: p.favoriteCount,
        recasts: p.retweetCount,
        embeds: [],
        personaId,
        tier: author ? tierOf(personaId, author.tier) : undefined,
      };
      return {
        type: "resurfaced" as const,
        tenant: "x_resurfaced",
        sourceHash: p.id,
        card: { kind: "resurfaced" as const, cast, resurfacedFromX: true },
      };
    });

  const live = isLiveContent();
  const queue: InjectionItem[] = [
    ...movedCards,
    ...adCards,
    ...migrationCards,
    ...resurfacedCards,
    ...(live ? [] : correctionCards).map((card) => ({
      type: "correction" as const,
      card,
      sourceHash: String(card.cast.hash).split("#")[0],
      // community notes and curator annotations are separate TENANTS of the
      // correction surface — each gets a reserved floor slot
      tenant: card.curatorName ? "curator_annotation" : "community_note",
    })),
    ...(live ? [] : sentCards).map((card) => ({
      type: "sent" as const,
      card,
      sourceHash: String(card.cast.hash).split("#")[0],
    })),
    ...(live ? [] : readwiseCards).map((card) => ({
      type: "readwise" as const,
      card,
      sourceHash: String(card.cast.hash).split("#")[0],
    })),
    ...(live ? [] : folderCards),
    ...(live ? [] : highlightCards),
  ];

  // ---- the caught-up banner: a hard stop, not a suggestion ----
  //
  // When everything the mode admits that is NEW since the last visit has
  // been surfaced, the feed ENDS. Below the banner: readwise chunks and
  // folder cards only — no ranked backfill, no ads, no anything else. That
  // is the anti-doomscroll contract, and the test asserts it structurally.
  const lastVisit = s.lastVisitAt.get(personaId) ?? 0;
  const calibration = mode.caughtUp ?? "new";
  if (lastVisit > 0 && calibration !== "off" && !isLiveContent()) {
    const isNew = (card: FeedCard): boolean => {
      if (card.kind !== "post" || !card.cast) return true; // moved/private stay
      if (card.private) return (card.cast.timestamp ?? 0) > lastVisit;
      const seedPost = postByHash.get(card.cast.hash);
      if (!seedPost) return (card.cast.timestamp ?? 0) > lastVisit;
      if (absoluteTime(seedPost.minutesAgo) <= lastVisit) return false;
      // Aggressive: a saturated story counts as seen even when its posts
      // are newer than the last visit.
      if (calibration === "aggressive" && seedPost.storyId && saturated.some((x) => x.storyId === seedPost.storyId))
        return false;
      return true;
    };
    const fresh = cards.filter(isNew);
    const exhausted = fresh.length < cards.length || fresh.length === 0;
    if (exhausted) {
      // Above the banner: fresh posts with the time-sensitive interleave
      // (moved pointers, corrections, sent posts). Ads stay above too — the
      // space below the banner is not for sale.
      const aboveQueue = queue.filter((q) => !["readwise", "folder"].includes(q.type));
      const { cards: above } = injectIntoFeed(fresh, aboveQueue, { every: 4, caps: { readwise: readwiseKnobs.perBuild } });
      const banner: FeedCard = {
        kind: "caughtup",
        cast: {
          hash: "caughtup:" + personaId,
          author: { fid: 0, username: "", displayName: "", pfpUrl: "", followerCount: 0, followingCount: 0 },
          text: "",
          timestamp: Date.now(),
          replies: 0, likes: 0, recasts: 0, embeds: [],
        },
      };
      const below: FeedCard[] = [
        // the cadence slider applies below the banner too: this is the one place
        // readwise cards are appended rather than injected, and a slider that
        // stopped applying here would quietly become "except when caught up"
        ...readwiseCards.slice(0, readwiseKnobs.perBuild),
        ...folderCards.map((f) => f.card),
      ];
      // The caught-up contract, kept exactly: never-miss may pin ABOVE the
      // banner (it is already in `fresh` if it is fresh), and manufactures
      // nothing below it. The preview strip lives above the timeline entirely,
      // so it is not "content below the banner" either — but it is built from
      // the same eligible set, never from a backfill.
      // GATE 5 (attack-post-2 F-8): the strip does NOT survive a fully exhausted feed. It is
      // drawn from posts the owner has by definition already seen once everything is caught
      // up, and an "ended" timeline with six cards still sitting above it is the
      // anti-doomscroll contract being honoured in the cards and broken in the chrome.
      const stripHere = fresh.length ? previewStrip : [];
      return { cards: [...above, banner, ...below], mode, contentStale, liveSource, lensId: activeLens.id, previewStrip: stripHere, pinnedHashes: [...pinSet] };
    }
  }

  const { cards: merged } = injectIntoFeed(cards, queue, { every: 4, caps: { readwise: readwiseKnobs.perBuild } });
  // MULTI-FID Gate 2: the granted viewer's MERGED identity on every persona-authored card — seed posts,
  // local act-as casts and attributed network casts alike; a bare persona for everyone else
  const { mergedAuthorFor } = await import("./fc/attribution");
  let ringsMerge: typeof import("./rings/merge") | null = null;
  for (const card of merged) {
    const c = (card as unknown as { cast?: Cast }).cast;
    if (!c || !c.author) continue;
    if (!c.personaId) {
      // PERSONA LAUNCH P4 (rings' line): a card with no persona — a network cast by a fid a ring this device is in shared
      // — merges the ring's linked identity; never an anon card (its persona rides cast.ringShared, set above)
      if (!c.anon && c.author.fid > 0) {
        ringsMerge ??= await import("./rings/merge");
        const m = ringsMerge.mergedAuthorForFid(c.author.fid);
        if (m) c.author = { ...c.author, ...m };
      }
      continue;
    }
    const m = mergedAuthorFor(c.personaId, personaId);
    if (m) c.author = { ...c.author, ...m };
  }
  return { cards: merged, mode, contentStale, liveSource, lensId: activeLens.id, previewStrip, pinnedHashes: [...pinSet] };
}

/** Debunk indicator: posts repeating a story that has a qualifying note. */
export function debunkedStoryIds(): Set<string> {
  const out = new Set<string>();
  for (const note of SEED_NOTES) {
    if (!note.qualifies) continue;
    const post = postByHash.get(note.postHash);
    if (post?.storyId) out.add(post.storyId);
  }
  return out;
}

/**
 * Debunked stories WITH attribution, viewer-aware: community notes plus the
 * viewer's subscribed curator feeds. Same indicator surface; the tag says
 * who is doing the debunking. Only VALID annotations reach this — the
 * threshold check lives in validAnnotations(), so a 1-of-3 draft cannot
 * light an indicator no matter who subscribes.
 */
export function debunkSourcesFor(personaId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of debunkedStoryIds()) out[id] = "Community note";
  try {
    for (const { annotation, feed } of subscribedAnnotations(personaId)) {
      const post = postByHash.get(annotation.targetCastId);
      if (post?.storyId && !out[post.storyId]) out[post.storyId] = feed.name;
    }
  } catch {
    /* additive only */
  }
  return out;
}
