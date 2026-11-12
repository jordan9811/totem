// ADS, PHASE 1 — PLACEMENTS AND CONTEXTUAL MATCHING, ON THE DEVICE (docs/roadmap/ad-auction.md §1, §5, §6). PURE: the
// device hands it the listed lots, the mode's dial and name, and what this identity hid; it answers which lots fill
// which slots and why. Nothing here reads, writes or asks anyone anything.
//
// PLACEMENTS (§1): a promoted post at position 5 of Following and position 3 of For You, then every 15th position
// (5, 20, 35, 50, … and 3, 18, 33, …), counted in the list as shown, the ads themselves included. An ad is never the
// last row (a post always follows it), never in a thread (no thread or profile page asks for a plan, and the plan
// route refuses any placement but these two) and never in Event Safe Space (its dial is forced to none).
//
// MATCHING (§6, contextual only): a lot is GENERIC (for anyone whose mode allows ads) or names MODES ("Sports"). A mode
// lot fits when one of its terms is a whole word or phrase of the active mode's name, in any case ("Sports" fits
// "Sunday sports"). Under "Generic ads only" only generic lots are eligible; under "Matched to this mode" the lots that
// fit this mode come first, then generic ones. Nothing about the viewer is an input: not a tier, an attestation, a
// graph fact, a follow, another mode or another identity.
//
// FILL: the eligible lots fill the slots in turn and start over when they run out, so with one house campaign every
// slot shows it (unsold inventory shows a house ad, §2). A lot this identity hid, or any lot of an advertiser it hid,
// is never eligible.
import type { AdDial } from "./dial";
import type { AdLot, AdPlacement } from "./lots";
import { normalizeModeTerm } from "./normalize";

export interface SlotRule {
  /** the first slot's position, 1-indexed, in the list as shown */
  first: number;
  /** the positions between one slot and the next */
  every: number;
}
export const AD_PLACEMENTS: Readonly<Record<AdPlacement, SlotRule>> = Object.freeze({
  following: Object.freeze({ first: 5, every: 15 }),
  forYou: Object.freeze({ first: 3, every: 15 }),
});

/** how many slots a page of `posts` posts holds: slot k sits at first + k·every and needs at least one post after it */
export function adSlotCount(rule: SlotRule, posts: number): number {
  let k = 0;
  // before slot k: (first + k·every − 1) rows, k of them ads; at least one post must remain after it
  while (posts > rule.first - 1 + k * rule.every - k) k++;
  return k;
}

/** a mode lot's terms against the mode's name, as whole words */
export function modeFits(modeName: string | null, terms: readonly string[]): boolean {
  if (!modeName) return false;
  const name = " " + normalizeModeTerm(modeName) + " ";
  return terms.some((t) => {
    const n = normalizeModeTerm(t);
    return n.length > 0 && name.includes(" " + n + " ");
  });
}

export interface AdPick {
  lot: AdLot;
  /** "mode": it fits the active mode's name; "generic": the same for everyone */
  why: "mode" | "generic";
}

export interface PickContext {
  placement: AdPlacement;
  dial: AdDial;
  modeName: string | null;
  hiddenLots: ReadonlySet<string>;
  hiddenAdvertisers: ReadonlySet<string>;
}

/** the eligible lots for this placement and dial, in the order they fill slots */
export function pickAds(lots: readonly AdLot[], ctx: PickContext): AdPick[] {
  if (ctx.dial === "none") return [];
  const open = lots.filter((l) => l.placement === ctx.placement && !ctx.hiddenLots.has(l.id) && !ctx.hiddenAdvertisers.has(l.advertiser.id));
  const generic = open.filter((l) => l.audience.kind === "generic").map((lot): AdPick => ({ lot, why: "generic" }));
  if (ctx.dial === "generic") return generic;
  const fits = open.filter((l) => l.audience.kind === "mode" && modeFits(ctx.modeName, l.audience.modes)).map((lot): AdPick => ({ lot, why: "mode" }));
  return [...fits, ...generic];
}

/** the slots' lots, in turn: slot k gets picks[k mod n] */
export function fillSlots(picks: readonly AdPick[], count: number): AdPick[] {
  if (!picks.length) return [];
  return Array.from({ length: count }, (_, k) => picks[k % picks.length]);
}

/** "Why this ad", computed here, from what the device already knows */
export function whyThisAd(pick: AdPick, modeName: string | null): string {
  if (pick.why === "mode") return `Shown because you're in ${modeName ?? "this"} mode.`;
  return "Shown to everyone who has ads on. Nothing about you or your mode picked it.";
}

export const WHY_WHERE_SENTENCE = "Picked on this device from a list that is the same for everyone. No request tells Totem which ad you saw.";
export const WHY_HOUSE_SENTENCE = "A house ad: Totem's own, not paid for.";
export const NO_MEASUREMENT_SENTENCE = "Nobody counts that you saw it: Totem keeps no impression or click counts yet.";
