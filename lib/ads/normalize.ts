// ADS, PHASE 1 — one word-normalizer for mode names and a lot's mode terms (lib/ads/lots.ts checks a term with it,
// lib/ads/match.ts compares with it): lower case, every run of anything that is not a letter or digit one space.
export function normalizeModeTerm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
