import "server-only";
// MULTI-FID PASS Gate 0 — the LIVE fid-facts adapter: the score through
// the existing Neynar API path (read-only, one user lookup; never in a
// sweep). Signer vouching on live is narrow BY DESIGN: this client can
// vouch for a signer key only on a fid it registered that key for itself
// (the persona ↔ FID map, Gate 1); any other fid's signer set would have
// to be read from the KeyRegistry, which is ASSUMPTION A-FID-SIGNER-LOOKUP
// until a later pass — so a third-party fid is refused, never guessed.
import type { FidFacts, FidFactsAdapter } from "./types";

const BASE = "https://api.neynar.com/v2/farcaster";


export const liveFidFacts: FidFactsAdapter = {
  kind: "live",
  async facts(fid: number): Promise<FidFacts> {
    const key = process.env.NEYNAR_API_KEY;
    if (!key) throw new Error("live fid facts: NEYNAR_API_KEY is not set");
    if (!Number.isInteger(fid) || fid <= 0) throw new Error("live fid facts: fid malformed");
    const res = await fetch(`${BASE}/user/bulk?fids=${fid}`, { headers: { accept: "application/json", "x-api-key": key }, cache: "no-store" });
    if (!res.ok) throw new Error(`live fid facts: Neynar HTTP ${res.status}`);
    const j = (await res.json()) as { users?: { fid: number; score?: number; follower_count?: number; experimental?: { neynar_user_score?: number } }[] };
    const u = (j.users ?? []).find((x) => Number(x.fid) === fid);
    if (!u) throw new Error("live fid facts: Neynar returned no user for the fid");
    const s = typeof u.score === "number" ? u.score : typeof u.experimental?.neynar_user_score === "number" ? u.experimental.neynar_user_score : null;
    // PERSONA LAUNCH P5: the follower count rides the same one user lookup (never in a sweep)
    const followers = typeof u.follower_count === "number" && Number.isFinite(u.follower_count) && u.follower_count >= 0 ? Math.floor(u.follower_count) : null;
    return { score: s, followerCount: followers };
  },
  async signerPublicKey(fid: number): Promise<string | null> {
    // Gate 1: only a fid this client owns — the persona ↔ fid map's derived signer key
    try {
      const { ownFidSignerPublicKey } = await import("@/lib/fc/personaFid");
      return await ownFidSignerPublicKey(fid);
    } catch {
      return null;
    }
  },
};
