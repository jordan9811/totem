import "server-only";
// MULTI-FID PASS Gate 0 — the FIXTURE web-proof adapter: recorded About
// facts for seeded X handles (seed/data/x-about.json). The "proof" a
// fixture subject presents is a stand-in for a zkTLS transcript —
// `fixture-webproof/1|<handle>` — accepted by THIS adapter only; the live
// adapter refuses everything until a real verifier exists. Plus synthetic
// COHORT facts for decoy commitments, spread BY INDEX so bucket
// populations are deterministic.
import { createHash } from "@/lib/platform/crypto";
import recorded from "@/seed/data/x-about.json";
import type { WebProof, WebProofAdapter, XAboutFacts } from "./types";

interface Recorded {
  accounts: { handle: string; facts: XAboutFacts }[];
}

export const FIXTURE_WEBPROOF_DOMAIN = "fixture-webproof/1";

/** the proof string a fixture subject presents for a seeded handle (the rig computes the same) */
export function fixtureWebProofFor(handle: string): string {
  return `${FIXTURE_WEBPROOF_DOMAIN}|${handle.toLowerCase()}`;
}

let byHandle: Map<string, XAboutFacts> | null = null;
function table(): Map<string, XAboutFacts> {
  if (byHandle) return byHandle;
  byHandle = new Map();
  for (const a of (recorded as Recorded).accounts) byHandle.set(a.handle.toLowerCase(), a.facts);
  return byHandle;
}

function cohortIndex(commitment: string): number {
  return createHash("sha256").update("layers-x-cohort/1|" + commitment).digest()[0];
}

const YEAR = 365.25 * 24 * 3600 * 1000;
const REGION_SPREAD = ["North America", "North America", "South America", "Europe", "Europe", "Europe", "Asia", "Africa"];

export const fixtureWebProof: WebProofAdapter = {
  kind: "fixture",
  async xAbout(proof: WebProof): Promise<XAboutFacts> {
    const handle = String(proof.handle || "").toLowerCase();
    if (proof.proof !== fixtureWebProofFor(handle)) throw new Error("fixture web proof: the proof does not verify for this handle");
    const f = table().get(handle);
    if (!f) throw new Error("fixture web proof: unknown handle (not a seeded fixture account)");
    return { ...f, basedIn: f.basedIn ? { ...f.basedIn } : null };
  },
  cohortXAbout(commitment: string, index?: number): XAboutFacts {
    // BY INDEX: with N decoys — americas 3N/8, europe 3N/8, asia-pacific N/8,
    // africa-middle-east N/8 (the last two are deliberately THIN); ages:
    // gte-1y-stable ≈ 3N/4 minus renames, gte-2y-stable ≈ N/2 minus renames
    // (i ≡ 1 mod 10 renamed once → ~N/20 drop), gte-4y-stable N/8 (thin)
    const i = index ?? cohortIndex(commitment);
    const now = Date.now();
    const joinedAt = i % 8 === 7 ? now - 5 * YEAR : i % 4 === 0 ? now - 0.5 * YEAR : i % 4 === 1 ? now - 1.5 * YEAR : now - 3 * YEAR;
    return {
      basedIn: { granularity: "region", value: REGION_SPREAD[i % 8] },
      vpnCaveat: false,
      joinedAt,
      usernameChanges: i % 10 === 1 ? 1 : 0,
    };
  },
};
