// ATTESTATION PASS Gate 1 — THE OPEN ISSUER INTERFACE. Anyone can be an
// issuer; the protocol does not care who. What an issuer IS: a stable,
// namespaced id; a claim schema (what a claim of this kind asserts); the
// BUCKETS it emits (the coarse public attributes — the only thing a
// gated surface can predicate on, and the only thing the validator ever
// learns); a validity in epochs (expiry is quantized to the issue epoch,
// never per-subject); an Ed25519 key that signs every issuance; and
// `issue()`, the issuer's OWN verification of the underlying fact.
//
// Trust is not part of the interface. Registration on the validator is
// open; which issuers a client HONOURS is the subscriber's choice
// (lib/attest/subscriber.ts) — Morpho-style: a mode, a filter pack, a
// client decides, the protocol does not.
//
// This is a different thing from lib/adapters/types.ts's older
// `AttestationIssuer` (the settings page's mock "connect a credential"
// list, a UI shell from the gated pass): that one carries a tierBonus and
// no key. It stays as it is; this file is the protocol object.
import type { ZkMode } from "@/lib/zk/config";

export type JsonSchema = Record<string, unknown>;

/** a wallet the subject binds at issuance (Gate 2): the address and its
 * signature over the issuer's challenge — seen by the ISSUER only, during
 * issuance; never by the validator, never in the attestation */
export interface SubjectWallet {
  address: string;
  challengeSig: string;
}

/** the subject of an issuance is a ROOT (its zk commitment), never a persona */
export interface SubjectRef {
  mode: ZkMode;
  commitment: string;
  /** Gate 2: the wallets the subject has proven control of for this request */
  wallets?: SubjectWallet[];
  /** Gate 2: the challenge the wallet signatures are over (issuer-minted) */
  challenge?: string;
  /** which of the issuer's buckets the subject asks for (default: whatever the facts support) */
  buckets?: string[];
  /** FIXTURE ONLY (set by the subject module's cohort loop, never by a
   * request): this subject is a decoy commitment — an issuer may use its
   * synthetic cohort facts instead of a bound wallet */
  cohort?: boolean;
  /** FIXTURE ONLY: the decoy's position in the cohort — the synthetic
   * spread is by INDEX so bucket populations (and their pairwise
   * intersections, which the linkage test holds to the floor) are
   * deterministic, never a hash's variance */
  cohortIndex?: number;
  /** MULTI-FID Gate 0: X accounts the subject presents web proofs for (x.* issuers) */
  webProofs?: { handle: string; proof: string }[];
  /** MULTI-FID Gate 0: Farcaster fids whose signer signed the challenge (neynar.* issuers) */
  fids?: { fid: number; challengeSig: string }[];
}

/** what the issuer actually asserts — value + nonce stay in the subject's vault */
export interface AttestationClaim {
  kind: string;
  bucket: string;
  value: Record<string, unknown>;
  /** 32 random bytes (hex) minted per issuance: the validator's claimHash is not a dictionary */
  nonce: string;
}

/** one issuance, one bucket: the public part goes to the validator, the
 * claim stays with the subject */
export interface IssuedAttestation {
  issuerId: string;
  bucket: string;
  subjectCommitment: string;
  claimHash: string;
  issueEpoch: number;
  expiryEpoch: number;
  /** ms at issuance — stays inside the sealed vault record (publicPart never carries it) */
  issuedAt: number;
  /** the issuer's Ed25519 signature over attestCanonical(...) */
  sig: string;
  /** the key the issuer signed under (Gate 4: the client honours by KEY, never by id alone) */
  issuerPubkey: string;
  claim: AttestationClaim;
  mode: ZkMode;
}

/** what the validator is told — nothing else leaves the subject */
export interface AttestationPublicPart {
  issuer: string;
  bucket: string;
  commitment: string;
  claimHash: string;
  issuedEpoch: number;
  expiresEpoch: number;
  sig: string;
}

export function publicPartOf(a: IssuedAttestation): AttestationPublicPart {
  return { issuer: a.issuerId, bucket: a.bucket, commitment: a.subjectCommitment, claimHash: a.claimHash, issuedEpoch: a.issueEpoch, expiresEpoch: a.expiryEpoch, sig: a.sig };
}

export interface Refusal {
  refused: true;
  reason: string;
}

export function isRefusal(x: unknown): x is Refusal {
  return !!x && typeof x === "object" && (x as Refusal).refused === true;
}

export interface AttestationIssuer {
  /** stable, namespaced: "onchain.wallet-age", "test.mock-issuer" */
  readonly id: string;
  readonly displayName: string;
  /** what a claim of this kind asserts */
  readonly claimSchema: JsonSchema;
  /** the coarse public buckets this issuer emits; a bucket is a tree */
  readonly buckets: readonly string[];
  /** expiry, in epochs, quantized to the issue epoch */
  readonly validity: { epochs: number };
  /** issuer-signed claims are attested-tier by definition */
  readonly trustTier: "attested";
  /** the Ed25519 public key every issuance is signed under (64 hex) */
  readonly publicKey: string;
  /** sign a canonical string under THAT key — the issuer's own registration
   * is self-signed this way (Gate 2: a family may share one key, so the
   * registry never guesses which key file an id maps to) */
  sign(canonical: string): string;
  /** the issuer's own verification of the underlying fact. One issuance
   * per bucket the facts support (nested buckets → several); a Refusal
   * says why nothing was issued. */
  issue(subject: SubjectRef): Promise<IssuedAttestation[] | Refusal>;
  /** Gate 2: a challenge the subject's wallets sign to prove control */
  mintChallenge?(subject: Pick<SubjectRef, "mode" | "commitment">): string;
}

/** the validator's view of a registered issuer (GET /zk/issuers) */
export interface RegisteredIssuer {
  id: string;
  displayName: string;
  claimSchema: JsonSchema;
  buckets: string[];
  validityEpochs: number;
  trustTier: "attested";
  pubkey: string;
  registeredAt: number;
}
