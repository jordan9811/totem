// ADS, PHASE 1 — THE REVIEW POLICY AND WHO MAY APPROVE A LOT (docs/roadmap/ad-auction.md §7).
//
// Every lot is listed only after a reviewer approved it under THIS policy: the approval is an Ed25519 signature over the
// lot's exact terms and this policy's id (lib/ads/canonical.mjs), recorded in the lot list itself (public/ads/lots.json).
// The policy text is the spec's suggested default and stays the default until the owner decides (§10 decision 3).
// Changing what is banned means a new id ("totem-ad-policy/2"): every approval under the old id stops counting and each
// lot has to be reviewed again, which is the point.
//
// WHO MAY APPROVE: the Ed25519 public keys in lib/ads/reviewers.json, pinned in the app build. The private half lives
// only on the reviewer's machine (.keystore/ad-reviewer.json, gitignored, written by `npm run ads:approve -- --new-reviewer`),
// never in the repository and never on a server. A list served from anywhere else later (Phase 2's daily lots, from the
// validator) is checked against the same pinned keys, so whoever serves it cannot add a lot nobody reviewed.
import reviewers from "./reviewers.json";

export const AD_POLICY_ID = "totem-ad-policy/1";

/** what a reviewer checks, in the words a viewer reads under "Why this ad" and the docs quote */
export const AD_POLICY_TEXT =
  "Every ad is reviewed before it is listed. Not allowed: scams or fraud, financial offers the advertiser isn't licensed to make, political ads, and adult content. An ad links to the advertiser's own page and carries no tracking.";

export const AD_POLICY_BANS = Object.freeze(["scams", "unlicensed financial offers", "political ads", "adult content"] as const);

/** the pinned reviewer keys (64 hex each); a key that is not a usable Ed25519 point is ignored by the verifier */
export const AD_REVIEWER_KEYS: readonly string[] = Object.freeze(
  ((reviewers as { keys?: unknown }).keys instanceof Array ? ((reviewers as { keys: unknown[] }).keys as unknown[]) : []).filter(
    (k): k is string => typeof k === "string" && /^[0-9a-f]{64}$/.test(k)
  )
);
