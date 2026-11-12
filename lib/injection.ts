import "server-only";
// ONE queue for everything spliced into the timeline: readwise chunks,
// correction cards, sent posts, folder-addition cards, highlight reels.
// Built proactively per the gated-pass failure mode — five independent
// injectors racing to splice into the same array is how you get the same
// post appearing twice under two different card types.
//
// Guarantees:
//   1. de-duplication by underlying post hash across ALL types (first
//      writer wins, by priority order)
//   2. a per-type cap per session, so one noisy type can't flood the feed
//   3. deterministic interleave into the ranked post list
import type { FeedCard } from "./feed";

export type InjectionType =
  | "correction"
  | "sent"
  | "readwise"
  | "folder"
  | "highlight"
  | "ad"
  | "moved"
  | "migration"
  | "resurfaced";

export interface InjectionItem {
  type: InjectionType;
  card: FeedCard;
  /** underlying post hash, WITHOUT the per-card suffix, for de-duplication */
  sourceHash: string;
  /** GATE 0 (Tier B): who this card belongs to, for reservation purposes.
   * Defaults to the type. Distinct tenants can share a card TYPE — community
   * notes and curator annotations are both "correction" — and the Tier A
   * starvation happened precisely because the cap couldn't tell them apart. */
  tenant?: string;
}

// Lower number = spliced earlier. Corrections are time-sensitive; highlight
// reels are the distribution mechanic and should be seen; readwise is a
// slow drip and can wait.
const PRIORITY: Record<InjectionType, number> = {
  moved: 0,
  correction: 1,
  // a join notice is timely — someone just arrived and the auto-follow
  // already happened; the card explains a change the user will notice
  migration: 2,
  // an explicit user promotion to fresh content — same standing as a
  // freshly composed post (both are "the user made this visible today")
  resurfaced: 2,
  highlight: 3,
  sent: 4,
  ad: 5,
  folder: 6,
  readwise: 7,
};

// Per-type caps per feed build. Prevents a user with 40 bookmarked chunks
// from seeing nothing but their own reading queue.
export const PER_TYPE_CAPS: Record<InjectionType, number> = {
  // One move per fork, and few forks — but capped like everything else so a
  // pathological fork chain cannot become the whole timeline.
  moved: 2,
  // Back to 3 now that reservations exist. Tier A raised this to 5 as a
  // stopgap when notes starved curator annotations; the per-tenant floor is
  // the real fix, and a tight cap is the honest test of it — three notes
  // fill the type budget and the curator card renders anyway, via its
  // reserved slot rather than via slack.
  correction: 3,
  highlight: 2,
  sent: 3,
  // Ad load is a product decision, not an accident of how many campaigns
  // happen to match — capped low and enforced in the same place as
  // everything else.
  ad: 2,
  folder: 3,
  readwise: 4,
  // several people can join in one window; two cards per build, rest wait
  migration: 2,
  // a resurfacing spree should not become the whole timeline — same cap
  // discipline as sent posts
  resurfaced: 3,
};

export interface InjectionResult {
  cards: FeedCard[];
  /** what got dropped and why — surfaced in the dev pane, never silent. "slot": a slotted type's card had no slot left
   *  on this page (a slot is never the last row) */
  dropped: { type: InjectionType; reason: "cap" | "duplicate" | "slot"; sourceHash: string }[];
}

/** ADS, PHASE 1: a type placed at FIXED positions instead of the every-N interleave — the first card at `first`
 *  (1-indexed, in the merged list as shown, earlier slotted cards included), then every `every` positions. A slot is
 *  filled only when at least one row follows it. */
export interface InjectionSlots {
  first: number;
  every: number;
}

export function injectIntoFeed(
  posts: FeedCard[],
  items: InjectionItem[],
  /** POST-DEPLOY Gate 4: `caps` overrides the per-type cap for THIS build. The
   *  readwise cadence slider is exactly that — how many chunks may be spliced
   *  into one build — and it is a per-mode preference, so it cannot live in the
   *  module-level constant the rest of the caps live in. Anything not named
   *  falls back to PER_TYPE_CAPS, so the flood protection is never removed,
   *  only re-pointed. */
  opts: {
    every?: number;
    caps?: Partial<Record<InjectionType, number>>;
    /** ADS, PHASE 1: the types placed at fixed positions (the ad placements, lib/ads/match.ts AD_PLACEMENTS). Their
     *  cards still pass the same dedup and caps as every other type; only WHERE they land differs. */
    slots?: Partial<Record<InjectionType, InjectionSlots>>;
  } = {}
): InjectionResult {
  const every = opts.every ?? 4;
  const capOf = (t: InjectionType) => opts.caps?.[t] ?? PER_TYPE_CAPS[t];
  const dropped: InjectionResult["dropped"] = [];

  // Posts already in the ranked list own their hash — an injected card for
  // the same post would be a visible duplicate.
  const seen = new Set<string>();
  for (const p of posts) if (p.cast) seen.add(p.cast.hash);

  const counts: Record<string, number> = {};
  const accepted: InjectionItem[] = [];

  // PER-TENANT RESERVATION. Every distinct tenant with queued items is
  // guaranteed its FIRST card before any tenant takes a second — so three
  // community notes can never starve the one curator annotation out of the
  // correction budget again. Reserved picks still respect dedup; they bypass
  // only the per-type cap, which exists to stop flooding, not to pick
  // favourites among tenants.
  const tenantOf = (i: InjectionItem) => i.tenant ?? i.type;
  const sorted = [...items].sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type]);
  const reservedByTenant = new Set<string>();
  const reservedItems = new Set<InjectionItem>();
  for (const item of sorted) {
    const t = tenantOf(item);
    if (reservedByTenant.has(t)) continue;
    if (seen.has(item.sourceHash)) continue; // a duplicate cannot be the floor pick
    reservedByTenant.add(t);
    reservedItems.add(item);
  }

  for (const item of sorted) {
    if (seen.has(item.sourceHash)) {
      dropped.push({ type: item.type, reason: "duplicate", sourceHash: item.sourceHash });
      continue;
    }
    counts[item.type] = (counts[item.type] ?? 0) + 1;
    if (counts[item.type] > capOf(item.type) && !reservedItems.has(item)) {
      dropped.push({ type: item.type, reason: "cap", sourceHash: item.sourceHash });
      continue;
    }
    // Readwise is the one type where several cards legitimately share a
    // source post (chunk 1, chunk 2 …), so it dedupes on the card hash.
    // ADS, PHASE 1: an ad is the other. One house lot fills every free slot
    // (unsold inventory shows a house ad), so its cards share a source; an
    // ad still never duplicates a POST on the page (the check above, against
    // the posts' own hashes, drops a promoted cast already in the list).
    if (item.type !== "readwise" && item.type !== "ad") seen.add(item.sourceHash);
    accepted.push(item);
  }

  const slotted = (t: InjectionType) => !!opts.slots?.[t];
  const flowing = accepted.filter((i) => !slotted(i.type));
  const merged: FeedCard[] = [];
  let qi = 0;
  posts.forEach((card, i) => {
    merged.push(card);
    if ((i + 1) % every === 0 && qi < flowing.length) merged.push(flowing[qi++].card);
  });
  while (qi < flowing.length) merged.push(flowing[qi++].card);

  // FIXED POSITIONS, in priority order of the slotted types: card k of a type at first + k·every, while a row follows it
  for (const t of Object.keys(PRIORITY).sort((a, b) => PRIORITY[a as InjectionType] - PRIORITY[b as InjectionType]) as InjectionType[]) {
    const rule = opts.slots?.[t];
    if (!rule) continue;
    let k = 0;
    for (const item of accepted) {
      if (item.type !== t) continue;
      const at = rule.first - 1 + k * rule.every;
      if (at >= merged.length) {
        dropped.push({ type: t, reason: "slot", sourceHash: item.sourceHash });
        continue;
      }
      merged.splice(at, 0, item.card);
      k++;
    }
  }

  return { cards: merged, dropped };
}
