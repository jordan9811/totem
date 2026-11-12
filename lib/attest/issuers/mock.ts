import "server-only";
// ATTESTATION PASS Gate 1 — the MOCK issuer, retired behind the interface.
// `test.mock-issuer` is an issuer like any other (its own key, its own
// registration, real signatures the validator verifies); what makes it a
// mock is that its "verification of the underlying fact" is vacuous — it
// vouches for any registered commitment it is asked about. Fixtures only:
// the subject path refuses it unless ZK_DEV_HOOKS=true (app side), and a
// product client never honours it (lib/attest/subscriber.ts).
//
// Its claim value carries a random TOKEN so the acceptance suite can grep
// the validator's database, log and every payload for the value and find
// it nowhere — the validator holds a nonce-salted hash, nothing else.
import { randomBytes } from "@/lib/platform/crypto";
import { fetchEpoch } from "@/lib/zk/validatorClient";
import { attestCanonical, claimHash } from "../canonical";
import { validBucket } from "../ids";
import { issueWindowStart } from "../canonical";
import { issuerPublicKey, signAsIssuer } from "../issuerKey";
import type { AttestationClaim, AttestationIssuer, IssuedAttestation, Refusal, SubjectRef } from "../types";

export const MOCK_ISSUER_ID = "test.mock-issuer";
/** the same mock with a 3-epoch validity: an issuance that OUTLIVES a
 * revocation, so "revoke removes exactly that leaf" is demonstrable */
export const MOCK_ISSUER_LONG_ID = "test.mock-issuer-long";
const BUCKETS = Object.freeze(["any", "alt"]);

function makeMock(id: string, validityEpochs: number): AttestationIssuer {
  return {
    id,
    displayName: `Mock issuer (fixtures only, validity ${validityEpochs})`,
    claimSchema: Object.freeze({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: `${id} claim`,
      type: "object",
      properties: {
        kind: { const: "mock" },
        ok: { type: "boolean", description: "the mock vouches; nothing was verified" },
        token: { type: "string", description: "random per issuance — the leak grep's needle" },
      },
      required: ["kind", "ok", "token"],
    }),
    buckets: BUCKETS,
    validity: { epochs: validityEpochs },
    trustTier: "attested",
    get publicKey() {
      return issuerPublicKey(id);
    },
    sign(canonical: string) {
      return signAsIssuer(id, canonical);
    },
    async issue(subject: SubjectRef): Promise<IssuedAttestation[] | Refusal> {
      if (process.env.ZK_DEV_HOOKS !== "true") return { refused: true, reason: "the mock issuer issues only under ZK_DEV_HOOKS=true (fixtures)" };
      const wanted = subject.buckets && subject.buckets.length ? subject.buckets : ["any"];
      for (const b of wanted) if (!validBucket(b) || !BUCKETS.includes(b)) return { refused: true, reason: `bucket "${b}" is not one the mock issuer emits` };
      let epoch: number;
      try {
        epoch = (await fetchEpoch(subject.mode)).epoch;
      } catch (e) {
        return { refused: true, reason: "issuer could not read the epoch: " + (e as Error).message };
      }
      const out: IssuedAttestation[] = [];
      for (const bucket of wanted) {
        const claim: AttestationClaim = { kind: "mock", bucket, value: { kind: "mock", ok: true, token: randomBytes(8).toString("hex") }, nonce: randomBytes(32).toString("hex") };
        const fields = { mode: subject.mode, issuer: id, bucket, commitment: subject.commitment, claimHash: claimHash(claim), issuedEpoch: epoch, expiresEpoch: issueWindowStart(epoch) + validityEpochs };
        out.push({
          issuerId: id,
          bucket,
          subjectCommitment: subject.commitment,
          claimHash: fields.claimHash,
          issueEpoch: epoch,
          expiryEpoch: fields.expiresEpoch,
          issuedAt: Date.now(),
          sig: signAsIssuer(id, attestCanonical(fields)),
          issuerPubkey: issuerPublicKey(id),
          claim,
          mode: subject.mode,
        });
      }
      return out;
    },
  };
}

export const mockIssuer: AttestationIssuer = makeMock(MOCK_ISSUER_ID, 1);
export const mockIssuerLong: AttestationIssuer = makeMock(MOCK_ISSUER_LONG_ID, 3);
