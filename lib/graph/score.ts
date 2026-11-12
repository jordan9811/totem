import "server-only";
// UX GATE 4 — THE AD MATCH SCORE. A 0-100 completeness/richness score for
// how targetable a profile is — explicitly NOT a trustworthiness or
// attractiveness-of-person score (that framing is a product requirement,
// not a naming nicety: the honesty-guardrail copy lives with the UI, not
// here, but the score's own math has to be honest first).
//
// THE ANTI-GAMING INVARIANT: a self-declared claim moves the score barely;
// an attested one moves it substantially. That's not a UI framing choice —
// it's baked into claimPoints() as a straight multiplier, tested directly
// (scripts/accept-ux4.mjs), and it composes with claimsForMatching()'s own
// fail-closed sensitive gate rather than re-deriving one: the score reads
// EXACTLY the claim set the ad marketplace itself matches against, so the
// two surfaces can never quietly disagree about what counts.
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { CONNECTORS, isSensitive } from "@/lib/adapters/mock/graph";
import { SENSITIVE_CATEGORIES, type ClaimCategory, type GraphClaim } from "@/lib/adapters/types";

/** Per-category base value (ad-targeting richness, not attested/self yet). */
export const CATEGORY_BASE: Record<ClaimCategory, number> = {
  interests: 10,
  demographics: 12,
  ownership: 10,
  habits: 10,
  health: 8,
  finances: 14,
  politics: 6,
};

/** Trust-tier multiplier, as a percent of a category's base value. The gap
 * between self and attested (10x) is the anti-gaming property made literal. */
export const TRUST_PERCENT: Record<GraphClaim["source"], number> = {
  self: 10,
  "x-inferred": 50,
  attested: 100,
};

export function claimPoints(category: ClaimCategory, source: GraphClaim["source"]): number {
  return Math.round((CATEGORY_BASE[category] * TRUST_PERCENT[source]) / 100);
}

export interface ScoreFactor {
  claimId: string;
  category: ClaimCategory;
  label: string;
  source: GraphClaim["source"];
  points: number;
}

export interface ScoreSuggestion {
  connectorId: string;
  label: string;
  delta: number;
}

export interface AdMatchScore {
  /** the displayed 0-100 score = min(100, rawTotal). */
  score: number;
  /** the pre-cap sum of every breakdown factor. The invariant is precise:
   * breakdown factors sum to rawTotal EXACTLY (always), and score caps that
   * at 100. Surfacing rawTotal makes "the breakdown sums to the total"
   * assertable without the cap silently breaking it above 100. */
  rawTotal: number;
  breakdown: ScoreFactor[];
  suggestions: ScoreSuggestion[];
}

/**
 * Reads claimsForMatching (NOT listClaims) — the same fail-closed,
 * consent-gated, dedup'd claim set the ad marketplace itself matches
 * against. A claim that wouldn't count toward an ad match doesn't count
 * toward the score either; there is exactly one definition of "counted."
 */
export async function computeScore(personaId: string): Promise<AdMatchScore> {
  const { claims } = await retryAdapter(() => adapters.graph.claimsForMatching(personaId));

  const breakdown: ScoreFactor[] = claims
    .map((c) => ({
      claimId: c.id,
      category: c.category,
      label: c.label,
      source: c.source,
      points: claimPoints(c.category, c.source),
    }))
    .sort((a, b) => b.points - a.points);

  const rawTotal = breakdown.reduce((a, f) => a + f.points, 0);
  const score = Math.min(100, rawTotal);

  // Suggestions: for every connector with at least one yield this persona
  // doesn't hold, the ACHIEVABLE delta — excluding any sensitive yield
  // whose category isn't consented, since completing the import wouldn't
  // actually deliver that point value either (advanceImport withholds it
  // the same way). A suggestion promising points an import wouldn't pay
  // out is a dark pattern by another name.
  const held = new Set(claims.map((c) => c.value));
  // Parallel, not sequential: 3 sensitive categories at up to 1500ms each
  // (plus retries) adds real, avoidable latency to every score read if run
  // one at a time for no reason — they're independent reads.
  const consent: Record<string, boolean> = {};
  await Promise.all(
    SENSITIVE_CATEGORIES.map(async (category) => {
      try {
        consent[category] = await retryAdapter(() => adapters.graph.getConsent(personaId, category));
      } catch {
        consent[category] = false; // fail closed, same as everywhere else
      }
    })
  );

  // Deltas are clamped to the remaining headroom below the 100 cap, so a
  // suggestion never promises more score than it can actually deliver
  // (a "+12" when you're at 95 would land you at 100, i.e. +5). Honest by
  // construction, not just by the copy next to it.
  const headroom = Math.max(0, 100 - score);
  const suggestions: ScoreSuggestion[] = [];
  for (const connector of CONNECTORS) {
    const trust = connector.trustSource ?? "attested";
    const missing = connector.yields.filter((y) => !held.has(y.value));
    const achievable = missing.filter((y) => !isSensitive(y.category) || consent[y.category]);
    if (achievable.length === 0) continue;
    const raw = achievable.reduce((a, y) => a + claimPoints(y.category, trust), 0);
    const delta = Math.min(raw, headroom);
    if (delta <= 0) continue;
    suggestions.push({ connectorId: connector.id, label: `Connect ${connector.name}`, delta });
  }
  suggestions.sort((a, b) => b.delta - a.delta);

  return { score, rawTotal, breakdown, suggestions };
}
