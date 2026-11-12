import "server-only";
// ADS, PHASE 1 — THE PLAN: which ads a page of posts carries, decided ON THIS DEVICE for the ACTING identity only
// (docs/roadmap/ad-auction.md §5, §6; SECURITY-POSTURE.md §41).
//
// INPUTS, all already on the device: the placement ("following" now; "forYou" is the seam for For You from the hub),
// the page's post hashes in the order shown, and the id of the mode the page was shaped under. The plan reads:
//   * the acting identity (activeSeedPersonaId(), the key every mode route uses: the root's public self while no persona
//     acts, the persona while one does);
//   * that mode, which must BELONG to the acting identity (a page made for the root never gets a persona's ads, or the
//     other way round: identity_changed, 409), and its dial (lib/ads/dial.ts; Event Safe Space forces none);
//   * the lots the app shipped that passed the review check (lib/ads/lots.ts);
//   * what THIS identity hid (lib/ads/hides.ts, the sealed adHides record).
// It answers the rows in order, posts and ads, merged by THE ONE INJECTION QUEUE (lib/injection.ts) at the placement's
// fixed slots (lib/ads/match.ts AD_PLACEMENTS), each ad with its "Why this ad" sentence computed here.
//
// WHAT LEAVES THE DEVICE: nothing. The plan makes no request (the lot list is in the bundle; the mode and the hides are
// already in this tab's memory after their first sealed read). No impression is reported, by design, until Phase 4's
// private measurement exists: nobody, Totem included, counts that an ad was shown.
//
// DORMANT FIRST (lib/ads/switch.ts): until the app's ADS=on reaches this tab, every plan is posts only, "Ads aren't
// running on Totem yet.", whatever the mode's dial says. That is how a deploy ships.
//
// NEVER FAIL OPEN: an ad list that cannot be read, or hides that cannot be read, is a plan with NO ads and the reason
// said (never the ads this identity hid); a mode that cannot be read is no ads too. Failing here only ever removes ads.
import type { FeedCard } from "@/lib/feed";
import type { Cast } from "@/lib/types";
import type { InjectionItem } from "@/lib/injection";
import type { AdDial } from "./dial";
import type { AdLot, AdPlacement } from "./lots";
import type { AdPick } from "./match";

export interface AdUnitView {
  /** the slot's index on this page (0, 1, …) and its position in the rows, 1-indexed */
  slot: number;
  position: number;
  lotId: string;
  advertiserId: string;
  advertiserName: string;
  advertiserHandle: string;
  house: boolean;
  headline: string;
  body: string;
  url: string;
  cta: string;
  /** "Why this ad", computed on this device */
  why: string;
  whyKind: "mode" | "generic";
}
export type AdRow = { kind: "post"; hash: string } | { kind: "ad"; ad: AdUnitView };

export interface AdPlanView {
  /** ok: ads placed; off: no ads, by the dial or for want of a lot that fits; error: no ads, because something could not be read */
  state: "ok" | "off" | "error";
  placement: AdPlacement;
  dial: AdDial | null;
  dialIsDefault: boolean;
  forced: boolean;
  modeName: string | null;
  /** the sentence for off / error (null when ads were placed) */
  reason: string | null;
  /** the page's posts in order, with the ads at their slots when state is ok */
  rows: AdRow[];
  ads: number;
  /** an opaque tag of the identity this plan was made for (a hide must carry it back: never lands on another identity) */
  actor: string | null;
  /** the shipped list's version, and how many of its lots the review check refused (counts only) */
  listVersion: number | null;
  refused: number;
  policy: string;
  /** ads are switched off on this site (the app's ADS is not on): no ad anywhere, "Ads aren't running on Totem yet." */
  dormant: boolean;
}

export type AdPlanCode = "bad_request" | "bad_placement" | "identity_changed" | "unknown_ad" | "full" | "unreadable" | "unsaved";
export class AdPlanError extends Error {
  constructor(public code: AdPlanCode, public status: number, sentence: string) {
    super(sentence);
    this.name = "AdPlanError";
  }
}

export const AD_SENTENCES = Object.freeze({
  dialNone: "No ads in this mode.",
  noLot: "No ad fits this mode right now.",
  listUnreadable: "Couldn't read the ad list, so no ads are shown.",
  hidesUnreadable: "Couldn't read the ads you've hidden, so no ads are shown here. Try again.",
  modeUnreadable: "Couldn't read this mode's ad setting, so no ads are shown.",
  noIdentity: "No ads: nobody is acting in this tab.",
  identityChanged: "You switched who you're acting as, so this page's ads belong to someone else now. Reload the page.",
  unknownAd: "That ad isn't on the list any more.",
  hideUnsaved: "Couldn't save that just now, so nothing changed. Try again.",
  badPlacement: "Ads only go in Following and For You, never in threads or anywhere else.",
  badRequest: "That request isn't one the ad planner understands.",
});

const MAX_POSTS = 600;
const g = globalThis as unknown as { __layersAdActorSalt?: Uint8Array };

/** an opaque tag for an identity, stable for this tab's life (a per-tab random salt; never sent anywhere) */
export async function actorTag(identity: string): Promise<string> {
  const { sha256 } = await import("@noble/hashes/sha2");
  const { bytesToHex } = await import("@noble/hashes/utils");
  if (!g.__layersAdActorSalt) {
    const salt = new Uint8Array(16);
    globalThis.crypto.getRandomValues(salt);
    g.__layersAdActorSalt = salt;
  }
  const id = new TextEncoder().encode(identity);
  const buf = new Uint8Array(g.__layersAdActorSalt.length + id.length);
  buf.set(g.__layersAdActorSalt, 0);
  buf.set(id, g.__layersAdActorSalt.length);
  return bytesToHex(sha256(buf)).slice(0, 24);
}

/** the acting identity (the key every mode route uses), or "" when nobody acts */
export async function actingIdentity(): Promise<string> {
  const { activeSeedPersonaId } = await import("@/lib/activePersona");
  try {
    return activeSeedPersonaId() || "";
  } catch {
    return "";
  }
}

function parseInput(body: Record<string, unknown>): { placement: AdPlacement; modeId: string; posts: string[] } {
  const placement = String(body.placement ?? "");
  if (placement !== "following" && placement !== "forYou") throw new AdPlanError("bad_placement", 400, AD_SENTENCES.badPlacement);
  const modeId = body.modeId;
  const posts = body.posts;
  if (typeof modeId !== "string" || !modeId || modeId.length > 160) throw new AdPlanError("bad_request", 400, AD_SENTENCES.badRequest);
  if (!Array.isArray(posts) || posts.length > MAX_POSTS || !posts.every((h) => typeof h === "string" && h.length > 0 && h.length <= 160)) throw new AdPlanError("bad_request", 400, AD_SENTENCES.badRequest);
  return { placement, modeId, posts: posts as string[] };
}

/** THE PLAN. THROWS AdPlanError for a request it cannot answer (a bad placement, a mode of another identity). */
export async function adPlan(body: Record<string, unknown>): Promise<AdPlanView> {
  const { placement, modeId, posts } = parseInput(body);
  const { AD_POLICY_ID } = await import("./policy");
  const postRows: AdRow[] = posts.map((hash) => ({ kind: "post", hash }));
  const base: AdPlanView = { state: "off", placement, dial: null, dialIsDefault: false, forced: false, modeName: null, reason: null, rows: postRows, ads: 0, actor: null, listVersion: null, refused: 0, policy: AD_POLICY_ID, dormant: false };
  // DORMANT (lib/ads/switch.ts): until the app's ADS=on reaches this tab, no feed carries an ad, whatever a mode's dial says
  const { adsRunning, ADS_DORMANT_SENTENCE } = await import("./switch");
  if (!adsRunning()) return { ...base, dormant: true, reason: ADS_DORMANT_SENTENCE };
  const identity = await actingIdentity();
  if (!identity) return { ...base, reason: AD_SENTENCES.noIdentity };
  const actor = await actorTag(identity);
  // the mode the page was shaped under, which must be the acting identity's own
  const { adapters } = await import("@/lib/adapters/registry");
  const { retryAdapter } = await import("@/lib/adapters/retry");
  let mode: Awaited<ReturnType<typeof adapters.mode.get>>;
  try {
    mode = await retryAdapter(() => adapters.mode.get(modeId));
  } catch {
    return { ...base, actor, state: "error", reason: AD_SENTENCES.modeUnreadable };
  }
  if (!mode) return { ...base, actor, state: "error", reason: AD_SENTENCES.modeUnreadable };
  if (mode.personaId !== identity) throw new AdPlanError("identity_changed", 409, AD_SENTENCES.identityChanged);
  const { kindOf } = await import("@/lib/identity/personaKind");
  const { effectiveAdDial, FORCED_OFF_SENTENCE } = await import("./dial");
  const d = effectiveAdDial(mode, kindOf(identity));
  const withDial: AdPlanView = { ...base, actor, dial: d.dial, dialIsDefault: d.isDefault, forced: d.forced, modeName: mode.name };
  if (d.dial === "none") return { ...withDial, reason: d.forced ? FORCED_OFF_SENTENCE : AD_SENTENCES.dialNone };
  const { listedLots } = await import("./lots");
  const lots = await listedLots();
  const counted = { ...withDial, listVersion: lots.version, refused: lots.refused.length };
  if (lots.error) return { ...counted, state: "error", reason: AD_SENTENCES.listUnreadable };
  let hidden: { lots: Set<string>; advertisers: Set<string> };
  try {
    hidden = await (await import("./hides")).hiddenFor(identity);
  } catch {
    return { ...counted, state: "error", reason: AD_SENTENCES.hidesUnreadable };
  }
  const { AD_PLACEMENTS, adSlotCount, fillSlots, pickAds, whyThisAd } = await import("./match");
  const picks = pickAds(lots.listed, { placement, dial: d.dial, modeName: mode.name, hiddenLots: hidden.lots, hiddenAdvertisers: hidden.advertisers });
  if (!picks.length) return { ...counted, reason: AD_SENTENCES.noLot };
  const rule = AD_PLACEMENTS[placement];
  const count = adSlotCount(rule, posts.length);
  if (!count) return { ...counted, reason: null };
  // THE ONE INJECTION QUEUE: the posts as cards, the ads as "ad" items at the placement's fixed slots
  const cards: FeedCard[] = posts.map((hash) => ({ kind: "post", cast: { hash } as unknown as Cast }));
  const byCard = new Map<FeedCard, AdPick>();
  const items: InjectionItem[] = fillSlots(picks, count).map((pick) => {
    const card: FeedCard = { kind: "ad", cast: { hash: "ad:" + pick.lot.id } as unknown as Cast };
    byCard.set(card, pick);
    return { type: "ad", card, sourceHash: "ad:" + pick.lot.id };
  });
  const { injectIntoFeed } = await import("@/lib/injection");
  const merged = injectIntoFeed(cards, items, { caps: { ad: count }, slots: { ad: rule } }).cards;
  let slot = 0;
  const rows: AdRow[] = merged.map((card, i): AdRow => {
    const pick = byCard.get(card);
    if (!pick) return { kind: "post", hash: String((card.cast as unknown as { hash: string }).hash) };
    const l: AdLot = pick.lot;
    return {
      kind: "ad",
      ad: {
        slot: slot++,
        position: i + 1,
        lotId: l.id,
        advertiserId: l.advertiser.id,
        advertiserName: l.advertiser.name,
        advertiserHandle: l.advertiser.handle,
        house: l.house,
        headline: l.creative.headline,
        body: l.creative.body,
        url: l.creative.url,
        cta: l.creative.cta,
        why: whyThisAd(pick, mode!.name),
        whyKind: pick.why,
      },
    };
  });
  return { ...counted, state: "ok", reason: null, rows, ads: slot };
}

// ------------------------------------------------------------------------------------------------- hide / show again
async function admitActor(actor: unknown): Promise<string> {
  const identity = await actingIdentity();
  if (!identity || typeof actor !== "string" || actor !== (await actorTag(identity))) throw new AdPlanError("identity_changed", 409, AD_SENTENCES.identityChanged);
  return identity;
}
/** the hide's guard, asked right before the write: still the same identity */
const sameIdentity = (identity: string) => async () => {
  if ((await actingIdentity()) !== identity) throw new AdPlanError("identity_changed", 409, AD_SENTENCES.identityChanged);
};
function writeFailure(e: unknown): never {
  if (e instanceof AdPlanError) throw e;
  if ((e as Error)?.name === "AdHidesFull") throw new AdPlanError("full", 409, (e as Error).message);
  throw new AdPlanError("unsaved", 503, AD_SENTENCES.hideUnsaved);
}

/** hide one listed lot, or every lot of its advertiser, for the identity the ad was shown to */
export async function adHide(body: Record<string, unknown>): Promise<{ ok: true; what: "ad" | "advertiser"; changed: boolean }> {
  const what = body.what === "advertiser" ? "advertiser" : body.what === "ad" ? "ad" : null;
  if (!what || typeof body.lot !== "string") throw new AdPlanError("bad_request", 400, AD_SENTENCES.badRequest);
  const identity = await admitActor(body.actor);
  const lot = (await (await import("./lots")).listedLots()).listed.find((l) => l.id === body.lot);
  if (!lot) throw new AdPlanError("unknown_ad", 404, AD_SENTENCES.unknownAd);
  const { hideForIdentity } = await import("./hides");
  try {
    const r = await hideForIdentity(identity, what === "ad" ? "lot" : "advertiser", what === "ad" ? lot.id : lot.advertiser.id, sameIdentity(identity));
    return { ok: true, what, changed: r === "hidden" };
  } catch (e) {
    writeFailure(e);
  }
}

/** show again: the lot (or its advertiser) this identity hid, from the card's Undo */
export async function adUnhide(body: Record<string, unknown>): Promise<{ ok: true; changed: boolean }> {
  const what = body.what === "advertiser" ? "advertiser" : body.what === "ad" ? "ad" : null;
  if (!what || typeof body.id !== "string") throw new AdPlanError("bad_request", 400, AD_SENTENCES.badRequest);
  const identity = await admitActor(body.actor);
  const { unhideForIdentity } = await import("./hides");
  try {
    return { ok: true, changed: (await unhideForIdentity(identity, what === "ad" ? "lot" : "advertiser", body.id, sameIdentity(identity))) === "shown" };
  } catch (e) {
    writeFailure(e);
  }
}

/** what the acting identity hid, named from the list (Settings, Modes); and "show them all again" */
export async function adHidden(): Promise<{ actor: string | null; lots: Array<{ id: string; label: string }>; advertisers: Array<{ id: string; label: string }> }> {
  const identity = await actingIdentity();
  if (!identity) return { actor: null, lots: [], advertisers: [] };
  let h: { lots: Set<string>; advertisers: Set<string> };
  try {
    h = await (await import("./hides")).hiddenFor(identity);
  } catch {
    throw new AdPlanError("unreadable", 503, AD_SENTENCES.hidesUnreadable);
  }
  const listed = (await (await import("./lots")).listedLots()).listed;
  return {
    actor: await actorTag(identity),
    lots: [...h.lots].map((id) => ({ id, label: listed.find((l) => l.id === id)?.creative.headline ?? id })),
    advertisers: [...h.advertisers].map((id) => ({ id, label: listed.find((l) => l.advertiser.id === id)?.advertiser.name ?? id })),
  };
}
export async function adShowAll(body: Record<string, unknown>): Promise<{ ok: true; changed: boolean }> {
  const identity = await admitActor(body.actor);
  const { unhideForIdentity } = await import("./hides");
  try {
    return { ok: true, changed: (await unhideForIdentity(identity, "all", null, sameIdentity(identity))) === "shown" };
  } catch (e) {
    writeFailure(e);
  }
}
