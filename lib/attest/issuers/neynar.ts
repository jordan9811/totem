import "server-only";
// MULTI-FID PASS Gate 0 — THE NEYNAR SCORE ISSUER, behind the same
// AttestationIssuer interface: Neynar's user quality score for a Farcaster
// fid the root controls, read through the fid-facts seam (fixture in
// sweeps; the live Neynar path otherwise), bucketed COARSELY, signed under
// the family key "neynar".
//
//   neynar.score   score-gte-0.7 | score-gte-0.9   (nested)
//
// CONTROL of the fid is proven by an Ed25519 signature over the issuer's
// challenge under a signer key the adapter vouches for: on fixture a key
// derived from a fixture constant; on live only a signer THIS client
// registered for one of its own persona fids (Gate 1) — a third-party fid
// is refused, never guessed (A-FID-SIGNER-LOOKUP). Several fids aggregate
// at the root as the MAX score. One fid vouches for one root.
import { randomBytes } from "@/lib/platform/crypto";
import { isUsablePublicKey, verifyCanonical } from "@/lib/crypto/ed25519";
import { fetchEpoch } from "@/lib/zk/validatorClient";
import { attestCanonical, claimHash, issueWindowStart } from "../canonical";
import { challengeIsLive, consumeChallenge, mintChallenge } from "../challenge";
import { fidFacts } from "../fid/source";
import { issuerKeyFor, signWithKey } from "../issuerKey";
import { boundElsewhere, retain } from "../retention";
import type { AttestationClaim, AttestationIssuer, IssuedAttestation, JsonSchema, Refusal, SubjectRef } from "../types";

export const NEYNAR_KEY_ID = "neynar";
export const NEYNAR_SCORE_ID = "neynar.score";
export const NEYNAR_SCORE_BUCKETS = Object.freeze(["score-gte-0.7", "score-gte-0.9"]);
/** scores move: a day */
const VALIDITY_EPOCHS = 4;

export function scoreBuckets(score: number | null): string[] {
  if (score === null || !Number.isFinite(score)) return [];
  const out: string[] = [];
  if (score >= 0.7) out.push("score-gte-0.7");
  if (score >= 0.9) out.push("score-gte-0.9");
  return out;
}

const SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "neynar.score",
  description:
    "Neynar's user quality score for a Farcaster fid the root controls (max over bound fids) is at least the bucket's threshold at the snapshot. Tiers, never the number: an exact score is a fingerprint. Buckets nest.",
  type: "object",
  properties: { kind: { const: "score" }, provider: { const: "neynar" }, bucket: { enum: [...NEYNAR_SCORE_BUCKETS] }, snapshotEpoch: { type: "integer" } },
  required: ["kind", "provider", "bucket", "snapshotEpoch"],
};

export const neynarScoreIssuer: AttestationIssuer = {
  id: NEYNAR_SCORE_ID,
  displayName: "Neynar — user quality score (coarse)",
  claimSchema: SCHEMA,
  buckets: NEYNAR_SCORE_BUCKETS,
  validity: { epochs: VALIDITY_EPOCHS },
  trustTier: "attested",
  get publicKey() {
    return issuerKeyFor(NEYNAR_KEY_ID).pubHex;
  },
  sign(canonical: string) {
    return signWithKey(issuerKeyFor(NEYNAR_KEY_ID), canonical);
  },
  mintChallenge(subject) {
    return mintChallenge(NEYNAR_SCORE_ID, subject, 0);
  },
  async issue(subject: SubjectRef): Promise<IssuedAttestation[] | Refusal> {
    const adapter = fidFacts();
    let epoch: number;
    try {
      epoch = (await fetchEpoch(subject.mode)).epoch;
    } catch (e) {
      return { refused: true, reason: "issuer could not read the epoch: " + (e as Error).message };
    }
    let score: number | null = null;
    const fids: string[] = [];
    if (subject.fids && subject.fids.length) {
      if (!subject.challenge || !challengeIsLive(subject.challenge, NEYNAR_SCORE_ID, subject)) return { refused: true, reason: "no live challenge for this subject — mint one first" };
      for (const p of subject.fids) {
        const fid = Number(p.fid);
        if (!Number.isInteger(fid) || fid <= 0) return { refused: true, reason: "fid malformed" };
        // CONTROL: the fid's signer (as the adapter vouches for it) signed the challenge
        const pub = await adapter.signerPublicKey(fid);
        if (!pub || !isUsablePublicKey(pub)) return { refused: true, reason: "no signer this issuer can vouch for on that fid — control not provable here" };
        if (!verifyCanonical(String(p.challengeSig ?? ""), subject.challenge, pub)) return { refused: true, reason: "signer signature over the challenge does not verify — control not proven" };
        if (boundElsewhere(NEYNAR_KEY_ID, String(fid), subject.commitment, epoch, VALIDITY_EPOCHS)) {
          return { refused: true, reason: "a bound fid already vouches for another root — one fid, one root" };
        }
        let f;
        try {
          f = await adapter.facts(fid);
        } catch (e) {
          // never the transport's raw text with the fid in it
          return { refused: true, reason: "fid facts unavailable: " + (e as Error).message.replace(/\b\d{1,9}\b/g, "<fid>").split("\n")[0].slice(0, 160) };
        }
        if (f.score !== null && (score === null || f.score > score)) score = f.score;
        fids.push(String(fid));
      }
      consumeChallenge(subject.challenge);
    } else if (subject.cohort === true && adapter.kind === "fixture" && process.env.ZK_DEV_HOOKS === "true" && adapter.cohortFacts) {
      score = adapter.cohortFacts(subject.commitment, subject.cohortIndex).score;
    } else {
      return { refused: true, reason: "no fid bound — a neynar.score attestation needs a fid whose signer signed the challenge" };
    }
    const supported = scoreBuckets(score);
    const wanted = subject.buckets && subject.buckets.length ? subject.buckets.filter((b) => supported.includes(b)) : supported;
    if (wanted.length === 0) return { refused: true, reason: "the score supports none of the requested buckets" };
    const out: IssuedAttestation[] = [];
    const key = issuerKeyFor(NEYNAR_KEY_ID);
    for (const bucket of wanted) {
      // the CLAIM is the bucket and the epoch — never the score
      const value: Record<string, unknown> = { kind: "score", provider: "neynar", bucket, snapshotEpoch: epoch };
      const claim: AttestationClaim = { kind: "score", bucket, value, nonce: randomBytes(32).toString("hex") };
      const fields = {
        mode: subject.mode,
        issuer: NEYNAR_SCORE_ID,
        bucket,
        commitment: subject.commitment,
        claimHash: claimHash(claim),
        issuedEpoch: epoch,
        expiresEpoch: issueWindowStart(epoch) + VALIDITY_EPOCHS,
      };
      out.push({
        issuerId: NEYNAR_SCORE_ID,
        bucket,
        subjectCommitment: subject.commitment,
        claimHash: fields.claimHash,
        issueEpoch: epoch,
        expiryEpoch: fields.expiresEpoch,
        issuedAt: Date.now(),
        sig: signWithKey(key, attestCanonical(fields)),
        issuerPubkey: key.pubHex,
        claim,
        mode: subject.mode,
      });
    }
    retain(NEYNAR_KEY_ID, fids, out);
    return out;
  },
};
