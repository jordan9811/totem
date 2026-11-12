// ADS, PHASE 1 (docs/roadmap/ad-auction.md) — THE BYTES A REVIEWER SIGNS, in one place for the two parties that build
// them: the browser device that verifies a lot before listing it (lib/ads/lots.ts) and the owner's review script that
// signs it (scripts/ads-approve.mjs). Plain JS with no imports, so both run THIS code, not two copies that can drift.
// Hashing is the caller's (the device uses @noble/hashes, the script node:crypto: both sha256 over the UTF-8 string).
//
// A lot's TERMS are everything in it except its `review`: the placement, the audience, the house mark, the advertiser
// and the creative. A reviewer signs one line naming the policy the lot was judged under, the lot's id, the sha256 of
// its terms, the decision and the day:
//   layers-ad-review/1|<policy id>|<lot id>|<sha256 hex of the terms>|<approved|rejected>|<YYYY-MM-DD>
// So an edit to any word of a lot after review, or a change of policy, voids the approval: the device refuses the lot
// until it is reviewed again.

export const AD_REVIEW_DOMAIN = "layers-ad-review/1";

/** JSON with every object's keys sorted, arrays in order, no whitespace. THROWS on anything JSON cannot carry exactly
 *  (undefined, a function, a non-finite number), so two parties can never disagree about what was signed. */
export function stableStringify(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string" || t === "boolean") return JSON.stringify(value);
  if (t === "number") {
    if (!Number.isFinite(value)) throw new Error("ads: a non-finite number cannot be signed");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  if (t === "object") {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const k of keys) {
      if (value[k] === undefined) throw new Error("ads: an undefined field cannot be signed (" + k + ")");
      parts.push(JSON.stringify(k) + ":" + stableStringify(value[k]));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error("ads: a " + t + " cannot be signed");
}

/** the lot without its review: what the reviewer judged */
export function lotTermsOf(lot) {
  const out = {};
  for (const k of Object.keys(lot ?? {})) if (k !== "review") out[k] = lot[k];
  return out;
}

/** the canonical string of a lot's terms (hash it with sha256 for the review line) */
export function lotTermsString(lot) {
  return stableStringify(lotTermsOf(lot));
}

/** the one line a reviewer signs */
export function reviewCanonical(policy, lotId, termsHash, decision, reviewedAt) {
  return [AD_REVIEW_DOMAIN, String(policy), String(lotId), String(termsHash), String(decision), String(reviewedAt)].join("|");
}
