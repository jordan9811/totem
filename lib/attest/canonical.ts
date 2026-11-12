// ATTESTATION PASS Gate 1 — the canonical forms an issuer signs and the
// validator verifies. Pure. DELIBERATE DUPLICATES of validator/zk.js
// (attestCanonical / issuerCanonical / attestRevokeCanonical); the
// acceptance suite signs on this side and the validator verifies on the
// other, which pins them together.
//
// THE CLAIM HASH: sha256 over ("layers-zk-attest-claim/1", kind, bucket,
// value-json, nonce). The nonce is 32 random bytes minted by the issuer
// per issuance, so the hash the validator stores is not a dictionary
// over the (tiny) space of bucket values: nothing about the VALUE is
// recoverable from what the validator holds. The value, the nonce and
// the issuer's signature live in the subject's vault; the subject can
// disclose them to whoever it chooses, and the validator can never do it
// for them.
import { createHash } from "@/lib/platform/crypto";
import type { AttestationClaim } from "./types";

export const ATTEST_DOMAIN = "layers-zk-attest/2";
export const ISSUER_DOMAIN = "layers-zk-issuer/1";
export const ATTEST_REVOKE_DOMAIN = "layers-zk-attest-revoke/1";
export const CLAIM_DOMAIN = "layers-zk-attest-claim/1";

export interface AttestCanonicalFields {
  mode: string;
  issuer: string;
  bucket: string;
  commitment: string;
  claimHash: string;
  issuedEpoch: number;
  expiresEpoch: number;
}

export function attestCanonical(a: AttestCanonicalFields): string {
  return [ATTEST_DOMAIN, a.mode, a.issuer, a.bucket, a.commitment, a.claimHash, String(a.issuedEpoch), String(a.expiresEpoch)].join("|");
}

export function schemaHash(schema: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(schema)).digest("hex");
}

export interface IssuerCanonicalFields {
  mode: string;
  id: string;
  displayName: string;
  schemaHash: string;
  buckets: readonly string[];
  validityEpochs: number;
  pubkey: string;
}

export function issuerCanonical(i: IssuerCanonicalFields): string {
  return [ISSUER_DOMAIN, i.mode, i.id, i.displayName, i.schemaHash, i.buckets.join(","), String(i.validityEpochs), i.pubkey].join("|");
}

export interface AttestRevokeFields {
  mode: string;
  issuer: string;
  bucket: string;
  commitment: string;
  issuedAt: number;
}

export function attestRevokeCanonical(r: AttestRevokeFields): string {
  return [ATTEST_REVOKE_DOMAIN, r.mode, r.issuer, r.bucket, r.commitment, String(r.issuedAt)].join("|");
}

export function claimHash(c: AttestationClaim): string {
  return createHash("sha256").update([CLAIM_DOMAIN, c.kind, c.bucket, JSON.stringify(c.value), c.nonce].join("|")).digest("hex");
}

export const ATTEST_SUBMIT_DOMAIN = "layers-zk-attest-submit/1";
/** Gate 4 (attack-att-3 #2): the SUBJECT's device-auth key signs the batch it submits, so only
 * the root's own device can enter an issuance for its commitment (the validator checks the
 * anchor). Deliberate duplicate of validator/zk.js attestSubmitCanonical. */
export function attestSubmitCanonical(mode: string, partsJson: string, issuedAt: number): string {
  return [ATTEST_SUBMIT_DOMAIN, mode, createHash("sha256").update(partsJson).digest("hex"), String(issuedAt)].join("|");
}

/** Gate 4 (attack-att-1 #4): the ISSUE WINDOW — activation (and so expiry) is quantized to
 * W epochs so every issuance of a window activates and expires together. Deliberate duplicate
 * of validator/zk.js windowStart; ATTEST_ISSUE_WINDOW must agree on both processes (default 1). */
export const ISSUE_WINDOW = Math.max(1, Math.min(1000, Number(process.env.ATTEST_ISSUE_WINDOW || 1)));
export function issueWindowStart(epoch: number): number {
  return Math.ceil((epoch + 1) / ISSUE_WINDOW) * ISSUE_WINDOW;
}
