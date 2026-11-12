import "server-only";
// MULTI-FID PASS Gate 0 — the FIXTURE fid-facts adapter: scores from the
// recorded Neynar users (fixtures/neynar/user-bulk.json), and a signer key
// per fid derived from a FIXTURE CONSTANT — sha256("layers-fid-signer/<fid>")
// is the Ed25519 seed — so the rig can sign the issuer's challenge for a
// seeded fid with the same derivation. Plus synthetic COHORT scores by
// index for the decoy crowd.
//
// PERSONA LAUNCH P5 (D1): FOLLOWER COUNTS. A recorded user's follower_count; the Sign in with Farcaster fixture accounts
// (lib/fc/siwf/flow.ts FIXTURE_SIWF_MAIN / FIXTURE_SIWF_OTHER — the rig's "main account") get fixed facts of their own;
// every other fid stays UNKNOWN and is refused (never a guess, accept-fid0 check 6). The cohort spread puts EXACTLY 49
// score-clearing decoys in gte-100k (a cohort of ≥ 55), 71 more in gte-10k and the rest in gte-1k — so a suite can hold
// the 100k+ tier at 49 (under the floor) or lift it to 50 with one more account. TEST RIG ONLY: an override per fid
// (followers and/or score) behind ZK_DEV_HOOKS (app/api/reach), cleared by resetReachCaches (lib/reach/held.ts).
import { createHash } from "@/lib/platform/crypto";
import recorded from "@/fixtures/neynar/user-bulk.json";
import { publicKeyOf } from "@/lib/crypto/ed25519";
import type { FidFacts, FidFactsAdapter } from "./types";

interface RecordedUser {
  fid: number;
  score?: number;
  follower_count?: number;
  experimental?: { neynar_user_score?: number };
}

/** the fixture signer seed for a fid (the rig derives the same to sign) */
export function fixtureFidSignerSeed(fid: number): Uint8Array {
  return new Uint8Array(createHash("sha256").update("layers-fid-signer/" + String(fid)).digest());
}

/** PERSONA LAUNCH P5: the Sign in with Farcaster fixture accounts' facts (DELIBERATE DUPLICATE of the fids in
 *  lib/fc/siwf/flow.ts): fixture-main is a 100k+ account with a clearing score, fixture-other a 10k+ one below it */
export const FIXTURE_SIWF_FACTS: Readonly<Record<number, FidFacts>> = Object.freeze({
  9_200_001: Object.freeze({ score: 0.92, followerCount: 150_000 }),
  9_200_002: Object.freeze({ score: 0.55, followerCount: 12_000 }),
});

let byFid: Map<number, FidFacts> | null = null;
function table(): Map<number, FidFacts> {
  if (byFid) return byFid;
  byFid = new Map();
  const users = ((recorded as { users?: RecordedUser[] }).users ?? (recorded as unknown as RecordedUser[])) as RecordedUser[];
  for (const u of users) {
    const s = typeof u.score === "number" ? u.score : typeof u.experimental?.neynar_user_score === "number" ? u.experimental.neynar_user_score : null;
    const f = typeof u.follower_count === "number" && Number.isFinite(u.follower_count) ? Math.floor(u.follower_count) : null;
    byFid.set(Number(u.fid), { score: s, followerCount: f });
  }
  for (const [fid, facts] of Object.entries(FIXTURE_SIWF_FACTS)) byFid.set(Number(fid), { ...facts });
  return byFid;
}

function cohortIndex(commitment: string): number {
  return createHash("sha256").update("layers-fid-cohort/1|" + commitment).digest()[0];
}

// ---------------------------------------------------------------- the rig's per-fid override (dev hooks only)
export interface FixtureFidOverride {
  followers?: number | null;
  score?: number | null;
}
const g = globalThis as unknown as { __layersFidFactsOverrides?: Map<number, FixtureFidOverride> };
const overrides = () => (g.__layersFidFactsOverrides ??= new Map());

/** TEST RIG ONLY (app/api/reach, behind ZK_DEV_HOOKS): set (or with null, clear) one fixture fid's followers/score */
export function setFixtureFidOverride(fid: number, o: FixtureFidOverride | null): void {
  if (!Number.isInteger(fid) || fid <= 0) throw new Error("fixture fid facts: fid malformed");
  if (o === null) overrides().delete(fid);
  else overrides().set(fid, { ...o });
}
export function clearFixtureFidOverrides(): void {
  overrides().clear();
}
export function fixtureFidOverrides(): Array<{ fid: number } & FixtureFidOverride> {
  return [...overrides().entries()].map(([fid, o]) => ({ fid, ...o }));
}

/**
 * PERSONA LAUNCH P5: the cohort's follower spread by the ordinal among the score-clearing indices (i % 10 !== 0).
 * PERSONA LAUNCH wave 3 (L3): spread for the BAND rule too (lib/reach/trees.ts offerableChain) — every tier leaves at
 * least the floor of 50 in the band below it once the cohort is big enough. With 300 decoys (scripts/accept-reach.mjs):
 * 49 at 150k (gte-100k: exactly 49, the rig's "49, not ours"), 71 more at 25k (gte-10k: 120), 60 more at 2.5k (gte-1k:
 * 180) and 90 under 1k beside the 30 that fail the score — the plain anon tree (tier-2 on the rig: about 270 of them)
 * keeps far more than 50 beyond gte-1k. Up to 180 score-clearing decoys nothing changes from the wave-2 spread.
 */
export function cohortFollowers(index: number): number {
  const j = index - Math.ceil(index / 10);
  return j < 49 ? 150_000 : j < 120 ? 25_000 : j < 180 ? 2_500 : 500;
}

export const fixtureFidFacts: FidFactsAdapter = {
  kind: "fixture",
  async facts(fid: number): Promise<FidFacts> {
    const base = table().get(Number(fid));
    const o = overrides().get(Number(fid));
    if (!base && !o) throw new Error("fixture fid facts: unknown fid (not a recorded fixture user)");
    const out: FidFacts = { score: base?.score ?? null, followerCount: base?.followerCount ?? null };
    if (o && o.score !== undefined) out.score = o.score;
    if (o && o.followers !== undefined) out.followerCount = o.followers;
    return out;
  },
  async signerPublicKey(fid: number): Promise<string | null> {
    if (!Number.isInteger(fid) || fid <= 0) return null;
    return publicKeyOf(fixtureFidSignerSeed(fid));
  },
  cohortFacts(commitment: string, index?: number): FidFacts {
    // BY INDEX: with N decoys — score-gte-0.7 ≈ 9N/10, score-gte-0.9 ≈ 2N/3
    const i = index ?? cohortIndex(commitment);
    const score = i % 10 === 0 ? 0.5 : i % 4 === 0 ? 0.75 : 0.95;
    return { score, followerCount: cohortFollowers(i) };
  },
};
