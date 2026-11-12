// ADS, PHASE 1 — THE AD DIAL, PER MODE (docs/roadmap/ad-auction.md §5). PURE (no store, no clock, browser-safe).
//
// Three settings, stored ON THE MODE (ModeDefinition.adDial), so the dial is sealed exactly as the mode is (the "modes"
// namespace, one opaque record) and belongs to the identity that owns the mode, never to another:
//   none     no ads in this mode
//   generic  only ads that are the same for everyone (nothing about the mode or you picks them)
//   matched  ads matched to this mode's name ("Sports"), then generic ones. Contextual only in Phase 1: no tiers, no
//            attestations, no graph facts, nothing about you
// DEFAULTS (the spec's): generic in a public identity's modes, none in a private persona's. A mode whose owner cannot be
// told apart (the identity is unknown here) gets none: the safe side is fewer ads, never more.
// FORCED: a mode with allowAds === false (Event Safe Space, and any copy of it) is none, whatever is stored, and the
// dial cannot be set to anything else there (PATCH /api/modes refuses).

export type AdDial = "none" | "generic" | "matched";
export const AD_DIALS: readonly AdDial[] = Object.freeze(["none", "generic", "matched"] as const);
export const AD_DIAL_LABELS: Readonly<Record<AdDial, string>> = Object.freeze({
  none: "No ads",
  generic: "Generic ads only",
  matched: "Matched to this mode",
});

export const isAdDial = (v: unknown): v is AdDial => typeof v === "string" && (AD_DIALS as readonly string[]).includes(v);

/** what the dial is for a mode: its own setting, the default for its owner's kind, or forced off */
export interface DialAnswer {
  dial: AdDial;
  /** the mode has no setting of its own: this is the default */
  isDefault: boolean;
  /** Event Safe Space (allowAds === false): none, and not changeable */
  forced: boolean;
}

export function effectiveAdDial(mode: { adDial?: unknown; allowAds?: boolean }, ownerKind: "public" | "private" | "unknown"): DialAnswer {
  if (mode.allowAds === false) return { dial: "none", isDefault: false, forced: true };
  if (isAdDial(mode.adDial)) return { dial: mode.adDial, isDefault: false, forced: false };
  return { dial: ownerKind === "public" ? "generic" : "none", isDefault: true, forced: false };
}

export const FORCED_OFF_SENTENCE = "Event Safe Space never shows ads.";
export const DIAL_REFUSED_SENTENCE = "Event Safe Space never shows ads, so its ad setting can't be changed.";
export const DIAL_BAD_SENTENCE = "That isn't an ad setting: choose No ads, Generic ads only or Matched to this mode.";
