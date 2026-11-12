// SPEC A — THE ALGORITHM DIAL ON REAL POSTS: the active mode applied to the real Following (the hub timeline,
// lib/fc/hubRead/read.ts). PURE (no fetch, no vault, no clock of its own, browser-safe): the device's engine hands it the
// page's posts and the mode as the device holds it (lib/fc/hubRead/modeSource.ts), and it answers which posts stay, in
// which order, and what the mode could not do. scripts/unit-hub-read.mjs H17 pins it.
//
// THE SAME MACHINERY AS THE SAMPLE FEED (lib/feed.ts), not a second one:
//   * the per-post decision is lib/rules/evaluate.ts ruleActions, over the mode's own rules and the delivery tiers
//     compiled by lib/delivery/tiers.ts compileDeliveryRules (never-miss = pin, banner, quiet = downrank, facet-only =
//     hide): one evaluator, the same Rule objects;
//   * a hide rule that reads the AUTHOR's Totem fields (tier, topic, proven attestations) hides every Farcaster post,
//     because a Farcaster account carries none of them: hide-when-unsure, the sample feed's rule for a network cast
//     whose author it cannot resolve (lib/feed.ts authorHideRuleExists);
//   * the final order is lib/reach/boost.ts makeFinalComparator: never-miss first (one post per account, at most a
//     quarter of the page), quiet last;
//   * the lens arithmetic is lib/lens/signals.ts signalsFor + lensScore, the mode's terms are lib/feed.ts
//     baseRankTerms' shape.
// WHAT DIFFERS, AND WHY (both follow from "a mode never changes what is read from the network"):
//   * WHICH posts are on the page is fixed by the reads: the newest posts read, exactly as the default mode shows them.
//     The sample feed lets the ranking choose its window from a corpus it already holds; here a different window would
//     mean reading other accounts' profiles and quoted posts from Farcaster's node, so the node would learn something
//     about your mode. So the ranking ORDERS the page instead (key 4 of the final comparator is the mode's score), and
//     no author is thinned out of it (Following keeps every post, as on X).
//   * signals Farcaster posts do not carry are LEFT OUT and SAID (gapsFor below), never quietly read as 0: the node keeps
//     no like, recast or reply counts (engagement, calm ranking, the likes / recasts / stakes / early-curve lens
//     signals), and a Farcaster account has no Totem tier, topic, attestation, standing or story.
// Under the Default mode (and any mode whose only usable ranking signal is recency) the order is newest first, exactly.
//
// SPEC B — FOR YOU FROM THE HUB (lib/fc/hubRead/forYou.ts) hands the same shaper its candidates with a SOCIAL PROOF each:
// how many of the people you follow liked it, recast it, and follow its author, counted from what this browser read (never
// a network total: the node keeps none). Those are real counts with a narrow meaning, so on For You they feed the
// existing terms and the page says what they mean there (FOR_YOU_SIGNALS_SENTENCE): the mode's engagement weight reads
// lib/feed.ts baseRankTerms' own curve over those likes and recasts (calm ranking damps it), the lens's likes and recasts
// signals read the same two counts, and author affinity is the share of the sampled follows who follow the author (on
// Following every author is followed, so it is 1 there, as before). Without a proof (Following) nothing changes.
import type { RankingWeights, Rule, RuleField } from "@/lib/adapters/types";
import { fieldLabel, fieldsOf, ruleActions, type EvalContext } from "@/lib/rules/evaluate";
import { lensScore, signalsFor } from "@/lib/lens/signals";
import { LENS_SIGNALS, type LensSignal, type LensSpec } from "@/lib/lens/types";
import { makeFinalComparator } from "@/lib/reach/boost";
import { HUB_TIERS_UNREADABLE_SENTENCE, hubModeHidSentence, type HubModeGap } from "./copy";
export { HUB_ACCOUNT_PREFIX, hubAccountKey, fidOfHubAccountKey } from "./copy";

/** the active mode, as the device holds it, for the root (lib/fc/hubRead/modeSource.ts builds it) */
export interface HubModeSpec {
  id: string;
  name: string;
  ranking: RankingWeights;
  calmRanking: boolean;
  longformOnly: boolean;
  hideReplies: boolean;
  kingOfTheHill: boolean;
  /** the mode's own rules, resolved (a rule that could not be resolved never reaches here: the loader refuses) */
  rules: Rule[];
  /** the delivery tiers in this mode, compiled into rules (lib/delivery/tiers.ts compileDeliveryRules) */
  deliveryRules: Rule[];
  /** fid → tier, for the accounts with a non-normal tier in this mode */
  tiers: Map<number, string>;
  /** the tier map could not be read: every account is Normal for now, and the page says so */
  tiersUnreadable: boolean;
  lens: { id: string; name: string | null; source: "mode" | "pack" | "canonical"; spec: LensSpec | null; missing: boolean };
  /** attached filter packs: `perAccount` = it carries claim predicates or curator riders (about Totem accounts) */
  packs: Array<{ id: string; name: string; perAccount: boolean }>;
}

/** what the shaper needs of a post (lib/fc/hubRead/read.ts maps its records) */
export interface HubModePost {
  hash: string;
  fid: number;
  /** epoch ms */
  ts: number;
  text: string;
  reply: boolean;
  embeds: number;
  /** SPEC B (For You): the people you follow who liked / recast it, and the share of the sampled follows who follow its
   *  author (0..1). Absent on Following. */
  proof?: { likes: number; recasts: number; affinity: number };
}
/** which timeline the shaper serves: what a Farcaster post cannot carry differs (For You has follow-based counts) */
export type HubSurface = "following" | "foryou";
/** the terms For You reads from its social proof, so they are not "not available" there */
const FORYOU_USED: ReadonlySet<string> = new Set(["engagement", "calm ranking", "likes", "recasts"]);

// ------------------------------------------------------------------------------------------------- what is usable
/** a hub card is long-form past this many characters (lib/fc/hubRead/read.ts castOf's `truncate`) */
const LONG_CHARS = 480;
/** the lens signals a Farcaster post carries: its reading length. Every other signal is a count the node does not keep
 *  or a Totem fact a Farcaster account does not have */
export const HUB_LENS_SIGNALS: ReadonlySet<LensSignal> = new Set<LensSignal>(["dwell"]);
const LENS_GAP: Record<LensSignal, string> = {
  recasts: "Farcaster's network keeps no recast counts",
  likes: "Farcaster's network keeps no like counts",
  stakesGood: "stakes are made on Totem posts, not on Farcaster's",
  stakesWorthReading: "stakes are made on Totem posts, not on Farcaster's",
  stakesWrong: "stakes are made on Totem posts, not on Farcaster's",
  stakesMisleading: "stakes are made on Totem posts, not on Farcaster's",
  stakesNoteWorthy: "stakes are made on Totem posts, not on Farcaster's",
  dwell: "",
  tier: "a Farcaster account carries no Totem tier",
  attestations: "a Farcaster account carries no proven attestations here",
  // SPEC C: a desk's note now SHOWS on a Farcaster post (lib/fc/hubRead/extras.ts); it does not weigh the order yet
  curatorSubscriptions: "a desk's note shows on a Farcaster post but doesn't weigh the order yet",
  earlyCurve: "it counts stakes, which are made on Totem posts",
  saturation: "Farcaster posts carry no story to be caught up on",
};
/** rule fields a Farcaster post or account does not carry, and how a rule reads them there */
const AUTHOR_FIELDS: ReadonlySet<RuleField> = new Set<RuleField>(["author.tier", "author.cluster", "attest.holds"]);
const ABSENT_FIELDS: ReadonlySet<RuleField> = new Set<RuleField>(["post.topicId", "post.isUpdate", "graph.claim", "clock.hourUTC"]);
const isDeliveryRule = (r: Rule) => r.id.startsWith("delivery:");
const w = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** every setting of this mode a Farcaster post cannot carry: said on the page instead of being quietly read as 0. On For
 *  You the follow-based counts carry engagement, calm ranking and the lens's likes and recasts (said instead by
 *  FOR_YOU_SIGNALS_SENTENCE), so those are not gaps there */
export function gapsFor(spec: HubModeSpec, surface: HubSurface = "following"): HubModeGap[] {
  const out = gapsOfMode(spec);
  return surface === "foryou" ? out.filter((g) => !((g.kind === "ranking" || g.kind === "lens") && FORYOU_USED.has(g.term))) : out;
}
function gapsOfMode(spec: HubModeSpec): HubModeGap[] {
  const out: HubModeGap[] = [];
  if (w(spec.ranking.engagement) !== 0)
    out.push({ kind: "ranking", term: "engagement", sentence: "Engagement isn't used: Farcaster's network keeps no like, recast or reply counts." });
  if (w(spec.ranking.clusterAffinity) !== 0)
    out.push({ kind: "ranking", term: "topic affinity", sentence: "Topic affinity isn't used: a Farcaster account carries no Totem topic." });
  if (spec.calmRanking) out.push({ kind: "ranking", term: "calm ranking", sentence: "Calm ranking isn't used: it damps likes and recasts, which Farcaster's network doesn't count." });
  if (spec.longformOnly) out.push({ kind: "ranking", term: "bookmarks", sentence: "Bookmarks don't lift posts here: Farcaster posts aren't bookmarked in Totem." });
  if (spec.kingOfTheHill) out.push({ kind: "ranking", term: "standing", sentence: "Standing isn't used: it comes from refutations on Totem posts." });
  if (spec.lens.missing) out.push({ kind: "lens", term: "lens", sentence: "Your mode's lens isn't on this device any more, so posts are ranked without it." });
  if (spec.lens.spec) {
    for (const s of LENS_SIGNALS) {
      if (HUB_LENS_SIGNALS.has(s) || w(spec.lens.spec.signals[s]) === 0) continue;
      out.push({ kind: "lens", term: s, sentence: `The lens's ${s} weight isn't used: ${LENS_GAP[s]}.` });
    }
  }
  for (const r of spec.rules) {
    if (isDeliveryRule(r)) continue;
    const fields = fieldsOf(r.root);
    const author = fields.filter((f) => AUTHOR_FIELDS.has(f));
    const absent = fields.filter((f) => ABSENT_FIELDS.has(f));
    if (author.length && r.action === "hide")
      out.push({ kind: "rule", term: r.name, sentence: `Rule "${r.name}" reads the author's ${author.map(fieldLabel).join(" and ")}, which a Farcaster account doesn't carry, so it hides every post here.` });
    else if (author.length || absent.length)
      out.push({ kind: "rule", term: r.name, sentence: `Rule "${r.name}" reads ${[...author, ...absent].map(fieldLabel).join(" and ")}, which Farcaster posts don't carry, so it reads every post as having none.` });
  }
  for (const p of spec.packs) {
    if (!p.perAccount) continue;
    out.push({ kind: "pack", term: p.name, sentence: `Pack "${p.name}" checks claims Totem accounts prove, which Farcaster accounts don't carry, so it filters nothing here.` });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- one post
/** the rule context for a Farcaster post: its own fields, the author's delivery tier in this mode, and the author's
 *  Totem fields as the sentinels the sample feed gives a network author it cannot resolve (every comparison false) */
export function hubEvalContext(p: HubModePost, spec: Pick<HubModeSpec, "tiers">, now: number): EvalContext {
  return {
    post: { hash: p.hash, topicId: null, isUpdate: false, hasMedia: p.embeds > 0, ageMinutes: Math.max(0, (now - p.ts) / 60_000), text: p.text },
    author: { personaId: "", tier: NaN, cluster: null },
    viewer: { personaId: null, followingPersonaIds: [] },
    delivery: { tier: spec.tiers.get(p.fid) ?? "normal" },
  };
}

/** the mode's score for one post: its ranking terms (lib/feed.ts baseRankTerms' shape) with what a Farcaster post
 *  carries, plus the lens. The lens reads the post's text (its reading length); every signal a Farcaster post does not
 *  carry goes in ABSENT (no counts, no stakes, tier 0, no attestations, no desk note, no story), so its weight moves
 *  nothing, and gapsFor says so on the page. Every author on Following is one you follow (or you), so author affinity
 *  is the same for every post. */
export function hubScore(p: HubModePost, spec: HubModeSpec, now: number): number {
  const lens = spec.lens.spec;
  const minutes = Math.max(0, (now - p.ts) / 60_000);
  const recency = 1 / (1 + minutes / 60 / 12);
  const long = p.text.length > LONG_CHARS;
  // SPEC B: on For You the author's affinity is the share of your sampled follows who follow them; on Following, 1
  const proof = p.proof;
  let s = recency * w(spec.ranking.recency) + (proof ? Math.min(1, Math.max(0, proof.affinity)) : 1) * w(spec.ranking.authorAffinity);
  if (proof) {
    // lib/feed.ts baseRankTerms' engagement curve, over the people you follow who liked or recast it (never a network total)
    const engagement = Math.log10(1 + proof.likes + proof.recasts * 3) / 4;
    s += engagement * w(spec.ranking.engagement);
    if (spec.calmRanking) s -= engagement * 0.3;
  }
  if (spec.longformOnly && long) s += 0.5;
  if (lens) {
    s += lensScore(
      lens,
      signalsFor({ post: { text: p.text, likes: proof?.likes ?? 0, recasts: proof?.recasts ?? 0, minutesAgo: minutes, truncate: long }, tier: 0, attestations: [], stakes: null, curatorFlagged: false, saturated: false })
    );
  }
  return s;
}

// ------------------------------------------------------------------------------------------------- the page
export interface HubShaped<P extends HubModePost> {
  /** what stays, in the mode's order */
  items: P[];
  hidden: number;
  pinned: Set<string>;
  quiet: Set<string>;
  /** the banner tier's posts, newest first, at most 6 */
  banner: P[];
  /** the order differs from newest first among the posts that are neither pinned nor quiet */
  ranked: boolean;
  gaps: HubModeGap[];
  sentence: string | null;
  tiersSentence: string | null;
}

/** the sample feed's question, asked of the rules the OWNER wrote (a delivery rule is never one: lib/feed.ts) */
const authorHideOf = (spec: HubModeSpec): boolean => spec.rules.some((r) => !isDeliveryRule(r) && r.action === "hide" && fieldsOf(r.root).some((f) => AUTHOR_FIELDS.has(f)));

/** SPEC C: would this mode hide this post? The ONE per-post visibility decision, asked by the page below and by every
 *  extra spliced into it (lib/fc/hubRead/extras.ts): a sent post, a resurfaced note or a requeued reading piece never
 *  brings back a post the mode hides (lib/feed.ts asks its health cards the same: "a blocked author leaks back in
 *  through a correction or a send") */
export function modeHides(p: HubModePost, spec: HubModeSpec, now: number): boolean {
  if (spec.hideReplies && p.reply) return true;
  if (authorHideOf(spec)) return true;
  return ruleActions([...spec.deliveryRules, ...spec.rules], hubEvalContext(p, spec, now)).hide;
}

/** the page under the mode. `posts` are the page's posts newest first, exactly as read; `want` is the page size. */
export function shapeForMode<P extends HubModePost>(posts: readonly P[], spec: HubModeSpec, opts: { now: number; want: number; surface?: HubSurface }): HubShaped<P> {
  const { now } = opts;
  const rules = [...spec.deliveryRules, ...spec.rules];
  const authorHide = authorHideOf(spec);
  const eligible: P[] = [];
  const pinnedWant = new Set<string>();
  const quiet = new Set<string>();
  const bannered = new Set<string>();
  let hidden = 0;
  for (const p of posts) {
    if (spec.hideReplies && p.reply) {
      hidden++;
      continue;
    }
    if (authorHide) {
      hidden++;
      continue;
    }
    const act = ruleActions(rules, hubEvalContext(p, spec, now));
    if (act.hide) {
      hidden++;
      continue;
    }
    if (act.pin) pinnedWant.add(p.hash);
    if (act.banner) bannered.add(p.hash);
    if (act.downrank) quiet.add(p.hash);
    eligible.push(p);
  }
  const score = new Map<string, number>();
  for (const p of eligible) score.set(p.hash, hubScore(p, spec, now));
  // NEVER MISS: one post per account (its best by the mode's score), at most a quarter of the page (lib/feed.ts pinCap)
  const pinCap = Math.max(1, Math.floor(opts.want / 4));
  const byScore = [...eligible].sort((a, b) => (score.get(b.hash) as number) - (score.get(a.hash) as number));
  const pinned = new Set<string>();
  const pinnedAuthors = new Set<number>();
  for (const p of byScore) {
    if (pinned.size >= pinCap) break;
    if (!pinnedWant.has(p.hash) || pinnedAuthors.has(p.fid)) continue;
    pinnedAuthors.add(p.fid);
    pinned.add(p.hash);
  }
  const rows = eligible.map((p) => ({ cast: { hash: p.hash }, p }));
  rows.sort(
    makeFinalComparator<(typeof rows)[number]>({
      sunk: () => false,
      pinned: (r) => pinned.has(r.p.hash),
      quiet: (r) => quiet.has(r.p.hash),
      discovery: false,
      rank: (r) => score.get(r.p.hash) as number,
    })
  );
  const items = rows.map((r) => r.p);
  const plainOrder = items.filter((p) => !pinned.has(p.hash) && !quiet.has(p.hash)).map((p) => p.hash);
  const asRead = eligible.filter((p) => !pinned.has(p.hash) && !quiet.has(p.hash)).map((p) => p.hash);
  const ranked = plainOrder.some((h, i) => h !== asRead[i]);
  return {
    items,
    hidden,
    pinned,
    quiet,
    banner: eligible.filter((p) => bannered.has(p.hash)).slice(0, 6),
    ranked,
    gaps: gapsFor(spec, opts.surface ?? "following"),
    sentence: hubModeHidSentence(hidden, posts.length),
    tiersSentence: spec.tiersUnreadable ? HUB_TIERS_UNREADABLE_SENTENCE : null,
  };
}
