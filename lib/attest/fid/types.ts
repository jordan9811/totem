// MULTI-FID PASS Gate 0 — the FID-FACTS seam. The neynar.* issuers read
// facts about a Farcaster FID (today: Neynar's user quality score)
// through this adapter and nothing else, and verify that the subject
// CONTROLS the fid by an Ed25519 signature over the issuer's challenge
// under a signer key the adapter can vouch for. Fixture in sweeps; live
// reads the existing Neynar path (never in a sweep). Exact scores never
// leave the issuer: it buckets before it signs.

export interface FidFacts {
  /** Neynar's user quality score, 0..1; null when Neynar has none for the fid */
  score: number | null;
  /** PERSONA LAUNCH P5 (D1): the fid's Farcaster follower count; null when unknown. The fc.reach issuer buckets it
   * (1k+ / 10k+ / 100k+) before it signs — the number itself never leaves the issuer. */
  followerCount: number | null;
}

/** what the subject presents: a fid and its signer's signature over the issuer's challenge */
export interface FidSignerProof {
  fid: number;
  challengeSig: string;
}

export interface FidFactsAdapter {
  readonly kind: "fixture" | "live";
  /** facts for one fid; throws on transport failure or an unknown fid (never fails open) */
  facts(fid: number): Promise<FidFacts>;
  /** the Ed25519 signer public key (64 hex) the adapter can vouch for on this fid, or null when it cannot —
   * fixture: derived from a fixture constant; live: only a fid this client REGISTERED a signer for (Gate 1) */
  signerPublicKey(fid: number): Promise<string | null>;
  /** FIXTURE ONLY: synthetic facts for a cohort commitment */
  cohortFacts?(commitment: string, index?: number): FidFacts;
}
