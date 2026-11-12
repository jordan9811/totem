import "server-only";
// ADS, PHASE 1 — THE LOT LIST AND THE REVIEW CHECK (docs/roadmap/ad-auction.md §1, §6, §7).
//
// WHAT A LOT IS IN PHASE 1: one placement (Following, or For You once it reads from the hub) × one audience (generic:
// anyone whose mode allows ads; or contextual: a mode's name, "Sports", "Work"), with the advertiser, the creative
// (headline, body, link, button) and a house mark. No day, no price, no clock: those are Phase 2.
//
// WHERE THE LIST COMES FROM: public/ads/lots.json, shipped inside the app (the device bundle carries it, and the same
// file is served as /ads/lots.json for anyone to read). The same list for everyone, versioned with the app. The device
// never asks anyone for it, so no request says that this tab looked at ads, let alone which one it showed. Phase 2's
// daily lots replace lotSource() with a read-only signed list from the validator, checked by the same function below.
//
// THE REVIEW CHECK (verifyLotList): a lot is LISTED only when its `review` is an approval under the current policy
// (lib/ads/policy.ts AD_POLICY_ID) by a pinned reviewer key, and the signature verifies over the lot's exact terms
// (lib/ads/canonical.mjs). Anything else is REFUSED with a reason, never shown: no review, a rejection, another
// policy's approval, an unknown key, a bad signature, a malformed lot, a link that is not https, a duplicate id. A list
// that is not readable at all lists nothing.
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { lotTermsString, reviewCanonical } from "./canonical.mjs";
import { AD_POLICY_ID, AD_REVIEWER_KEYS } from "./policy";
import { normalizeModeTerm } from "./normalize";
import shipped from "@/public/ads/lots.json";

export type AdPlacement = "following" | "forYou";
export const AD_PLACEMENT_IDS: readonly AdPlacement[] = Object.freeze(["following", "forYou"] as const);

export type AdAudience = { kind: "generic" } | { kind: "mode"; modes: string[] };

export interface AdReview {
  decision: "approved" | "rejected";
  policy: string;
  /** the reviewer's Ed25519 public key, 64 hex */
  reviewer: string;
  /** the day of the review, YYYY-MM-DD (UTC) */
  reviewedAt: string;
  /** Ed25519 over reviewCanonical(policy, id, sha256(terms), decision, reviewedAt), 128 hex */
  sig: string;
}

export interface AdLot {
  id: string;
  placement: AdPlacement;
  audience: AdAudience;
  /** a house ad: Totem's own (or the owner's own project), not paid for */
  house: boolean;
  advertiser: { id: string; name: string; handle: string };
  creative: { headline: string; body: string; url: string; cta: string };
  review?: AdReview;
}

export type LotRefusal = "malformed" | "unsafe_link" | "duplicate" | "unreviewed" | "other_policy" | "unknown_reviewer" | "bad_signature" | "rejected";

export interface VerifiedLots {
  /** the list's own version number (null when the list is unreadable) */
  version: number | null;
  listed: AdLot[];
  refused: Array<{ id: string | null; reason: LotRefusal }>;
  /** the whole list could not be read: nothing is listed */
  error: string | null;
}

export const AD_LIMITS = Object.freeze({
  headline: 80,
  body: 280,
  cta: 24,
  advertiserName: 50,
  url: 300,
  modes: 8,
  modeTerm: 32,
  lots: 200,
});

const LOT_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ADVERTISER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HANDLE = /^[A-Za-z0-9_]{1,20}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const LOT_KEYS = new Set(["id", "placement", "audience", "house", "advertiser", "creative", "review"]);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v);
const onlyKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in o);

/** https only, no credentials in it, a real host */
export function safeAdLink(u: unknown): boolean {
  if (typeof u !== "string" || u.length > AD_LIMITS.url) return false;
  try {
    const p = new URL(u);
    return p.protocol === "https:" && !!p.hostname && !p.username && !p.password;
  } catch {
    return false;
  }
}

/** the lot's shape, field by field (no field a renderer or reviewer would not see) */
function wellFormed(l: Record<string, unknown>): boolean {
  if (!Object.keys(l).every((k) => LOT_KEYS.has(k))) return false;
  if (typeof l.id !== "string" || !LOT_ID.test(l.id)) return false;
  if (!(AD_PLACEMENT_IDS as readonly string[]).includes(String(l.placement))) return false;
  if (typeof l.house !== "boolean") return false;
  const a = l.audience;
  if (!isObj(a)) return false;
  if (a.kind === "generic") {
    if (!onlyKeys(a, ["kind"])) return false;
  } else if (a.kind === "mode") {
    if (!onlyKeys(a, ["kind", "modes"]) || !Array.isArray(a.modes) || a.modes.length < 1 || a.modes.length > AD_LIMITS.modes) return false;
    if (!a.modes.every((m) => text(m, AD_LIMITS.modeTerm) && normalizeModeTerm(m).length > 0)) return false;
  } else return false;
  const adv = l.advertiser;
  if (!isObj(adv) || !onlyKeys(adv, ["id", "name", "handle"])) return false;
  if (typeof adv.id !== "string" || !ADVERTISER_ID.test(adv.id) || !text(adv.name, AD_LIMITS.advertiserName) || typeof adv.handle !== "string" || !HANDLE.test(adv.handle)) return false;
  const c = l.creative;
  if (!isObj(c) || !onlyKeys(c, ["headline", "body", "url", "cta"])) return false;
  if (!text(c.headline, AD_LIMITS.headline) || !text(c.body, AD_LIMITS.body) || !text(c.cta, AD_LIMITS.cta) || typeof c.url !== "string") return false;
  if (l.review !== undefined) {
    const r = l.review;
    if (!isObj(r) || !onlyKeys(r, ["decision", "policy", "reviewer", "reviewedAt", "sig"])) return false;
    if ((r.decision !== "approved" && r.decision !== "rejected") || typeof r.policy !== "string" || typeof r.reviewer !== "string" || typeof r.reviewedAt !== "string" || !DAY.test(r.reviewedAt) || typeof r.sig !== "string") return false;
  }
  return true;
}

/** sha256 hex of the lot's canonical terms (what the review line names) */
export function lotTermsHash(lot: object): string {
  return bytesToHex(sha256(new TextEncoder().encode(lotTermsString(lot))));
}

/**
 * THE REVIEW CHECK. Lists a lot only when it is well formed, its link is https, its id is the first of its kind, and its
 * review is an APPROVAL under `policy` by one of `keys` whose signature verifies over its exact terms. Never throws.
 */
export async function verifyLotList(raw: unknown, keys: readonly string[], policy: string = AD_POLICY_ID): Promise<VerifiedLots> {
  if (!isObj(raw) || raw.v !== 1 || !Array.isArray(raw.lots) || typeof raw.version !== "number" || !Number.isSafeInteger(raw.version) || raw.lots.length > AD_LIMITS.lots)
    return { version: null, listed: [], refused: [], error: "the ad list cannot be read" };
  const { verifyCanonical, isUsablePublicKey } = await import("@/lib/crypto/ed25519");
  const pinned = new Set(keys.filter((k) => HEX64.test(k) && isUsablePublicKey(k)));
  const listed: AdLot[] = [];
  const refused: VerifiedLots["refused"] = [];
  const ids = new Set<string>();
  for (const item of raw.lots) {
    const id = isObj(item) && typeof item.id === "string" ? item.id : null;
    if (!isObj(item) || !wellFormed(item)) {
      refused.push({ id, reason: "malformed" });
      continue;
    }
    const lot = item as unknown as AdLot;
    if (!safeAdLink(lot.creative.url)) {
      refused.push({ id, reason: "unsafe_link" });
      continue;
    }
    if (ids.has(lot.id)) {
      refused.push({ id, reason: "duplicate" });
      continue;
    }
    ids.add(lot.id);
    const r = lot.review;
    if (!r) {
      refused.push({ id, reason: "unreviewed" });
      continue;
    }
    if (r.policy !== policy) {
      refused.push({ id, reason: "other_policy" });
      continue;
    }
    if (!pinned.has(r.reviewer)) {
      refused.push({ id, reason: "unknown_reviewer" });
      continue;
    }
    const line = reviewCanonical(r.policy, lot.id, lotTermsHash(lot), r.decision, r.reviewedAt);
    if (!HEX128.test(r.sig) || !verifyCanonical(r.sig, line, r.reviewer)) {
      refused.push({ id, reason: "bad_signature" });
      continue;
    }
    if (r.decision !== "approved") {
      refused.push({ id, reason: "rejected" });
      continue;
    }
    listed.push(lot);
  }
  return { version: raw.version, listed, refused, error: null };
}

// ------------------------------------------------------------------------------------------------- the source
interface LotSource {
  list: unknown;
  keys: readonly string[];
}
const g = globalThis as unknown as { __layersAdLotSource?: LotSource | null; __layersAdLotsVerified?: { src: LotSource; v: VerifiedLots } | null };
const SHIPPED: LotSource = { list: shipped, keys: AD_REVIEWER_KEYS };

/** the list this device decides from: the one the app shipped (the same for everyone) */
export function lotSource(): LotSource {
  return g.__layersAdLotSource ?? SHIPPED;
}

/** the source's lots, checked once per source (the check is pure: the same list and keys always give the same answer) */
export async function listedLots(): Promise<VerifiedLots> {
  const src = lotSource();
  const hit = g.__layersAdLotsVerified;
  if (hit && hit.src === src) return hit.v;
  const v = await verifyLotList(src.list, src.keys);
  g.__layersAdLotsVerified = { src, v };
  return v;
}

/** NODE HARNESS ONLY (scripts/unit-ads.mjs): decide from another list and other pinned keys */
export function __setAdLotSourceForTests(src: LotSource | null): void {
  if (typeof window !== "undefined") throw new Error("__setAdLotSourceForTests is a node-harness seam");
  g.__layersAdLotSource = src;
  g.__layersAdLotsVerified = null;
}
