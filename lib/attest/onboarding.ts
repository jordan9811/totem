import "server-only";
// MULTI-FID PASS Gate 0 — OR-GATE ONBOARDING. A gate may be a DISJUNCTION
// over issuers: a new persona clears onboarding on ONE strong signal it
// has PROVEN this epoch — an old, never-renamed X account; a good Neynar
// score; an old wallet; a proof-of-personhood issuer if one is registered
// later — and a persona with none of them walks the graduation curve
// (tier by reputation, exactly as before). Clearing onboarding makes the
// persona ELIGIBLE for the gated discovery surface below the gate tier;
// it does not change the tier shown (a badge is a proof or nothing).
//
// Only PROVEN attestations count (lib/attest/proven.ts — honoured issuers
// only, this epoch, floor-checked before the proof was even built), so
// the onboarding gate is exactly as private as any other attestation
// predicate: the validator learned "some persona proved into bucket B",
// never which signal a persona has.
//
// ONBOARDING_GATE (env, JSON) overrides the default disjunction:
//   [{"issuer":"x.account-age","buckets":["gte-2y-stable"]}, ...]
// An issuer pattern may be "<ns>.*"; a bucket list of ["*"] means any bucket.
import type { ZkMode } from "@/lib/zk/config";
import { issuerMatches } from "./ids";
import { provenAttestationsFor, refreshProvenAttestations } from "./proven";

export interface OnboardingDisjunct {
  /** an issuer id or "<ns>.*" pattern (honour is decided elsewhere, by key) */
  issuer: string;
  /** any of these buckets clears; ["*"] = any bucket of the issuer */
  buckets: string[];
}

export const DEFAULT_ONBOARDING_GATE: readonly OnboardingDisjunct[] = Object.freeze([
  { issuer: "x.account-age", buckets: ["gte-2y-stable", "gte-4y-stable"] },
  { issuer: "neynar.score", buckets: ["score-gte-0.7", "score-gte-0.9"] },
  { issuer: "onchain.wallet-age", buckets: ["gt2y", "gt4y"] },
  // a proof-of-personhood issuer, when one is registered and honoured: any bucket clears
  { issuer: "pop.*", buckets: ["*"] },
]);

let cached: { raw: string | undefined; list: OnboardingDisjunct[] } | null = null;

export function onboardingDisjuncts(): OnboardingDisjunct[] {
  const raw = process.env.ONBOARDING_GATE;
  if (cached && cached.raw === raw) return cached.list;
  let list: OnboardingDisjunct[] = [...DEFAULT_ONBOARDING_GATE];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const ok = parsed.filter(
          (d): d is OnboardingDisjunct =>
            !!d && typeof d === "object" && typeof (d as OnboardingDisjunct).issuer === "string" && Array.isArray((d as OnboardingDisjunct).buckets)
        );
        if (ok.length) list = ok.map((d) => ({ issuer: d.issuer, buckets: d.buckets.map(String) }));
      }
    } catch {
      /* a malformed override is ignored: the default gate is the conservative one */
    }
  }
  cached = { raw, list };
  return list;
}

/** the disjunct a proven "issuer/bucket" list satisfies, if any */
export function clearsOnboarding(proven: readonly string[], disjuncts: readonly OnboardingDisjunct[] = onboardingDisjuncts()): { clears: boolean; by: string | null } {
  for (const p of proven) {
    const i = p.indexOf("/");
    if (i <= 0) continue;
    const issuer = p.slice(0, i);
    const bucket = p.slice(i + 1);
    for (const d of disjuncts) {
      if (!issuerMatches(d.issuer, issuer)) continue;
      if (d.buckets.includes("*") || d.buckets.includes(bucket)) return { clears: true, by: p };
    }
  }
  return { clears: false, by: null };
}

/** this persona's onboarding status from what it has proven this epoch — a FRESH read (one gated
 * fetch, the same one every feed build makes), never the cache alone */
export async function onboardingStatusFor(personaId: string, mode: ZkMode): Promise<{ clears: boolean; by: string | null; proven: string[] }> {
  await refreshProvenAttestations(mode);
  const proven = provenAttestationsFor(personaId);
  return { ...clearsOnboarding(proven), proven };
}
