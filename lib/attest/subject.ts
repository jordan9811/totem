import "server-only";
// ATTESTATION PASS Gate 1 — THE SUBJECT'S SIDE of an issuance. The subject
// is a ROOT (its zk commitment), never a persona: attestations live on the
// root like reputation and are proven per persona later. The flow:
//
//   1. the issuer registers itself (lazy, idempotent, self-signed)
//   2. the issuer verifies the underlying fact and signs one issuance per
//      bucket it can vouch for — value + nonce + signature come back to us
//   3. the CLAIM (value, nonce) is sealed into the subject's vault
//   4. only the PUBLIC part — issuer, bucket, commitment, claimHash, epochs,
//      signature — goes to the validator, which batches the leaf into
//      attest:<issuer>/<bucket> from the next epoch
//
// The submission is an identified, root-level request like registration
// (the validator already knows commitment ↔ root); nothing persona-level
// rides it. Timing is hour-grained on the validator's side.
//
// `includeCohort` is a FIXTURE convenience (dev hooks only): the mock
// issuer vouches for every commitment in the `valid` tree so the attest
// tree clears the client's floor — an attestation set of one is not a
// set. Those cohort claims are never stored in our vault (they are not
// ours).
import type { ZkMode } from "@/lib/zk/config";
import { zkCommitment } from "@/lib/zk/identity";
import { fetchMembers, submitAttestations } from "@/lib/zk/validatorClient";
import { builtinIssuer, ensureRegistered, issuerUnavailableHere } from "./registry";
import { isRefusal, publicPartOf, type AttestationPublicPart, type IssuedAttestation, type Refusal, type SubjectRef } from "./types";
import { storeIssued } from "./vault";

export interface IssuanceResult {
  ok: true;
  issuer: string;
  buckets: string[];
  accepted: number;
  refused: { i: number; error: string }[];
  epoch: number;
  activeFromEpoch: number;
  expiresEpoch: number;
  /** fixture: how many cohort commitments the issuer also vouched for */
  cohortAttested: number;
}

export async function requestIssuance(
  mode: ZkMode,
  issuerId: string,
  opts: {
    buckets?: string[];
    includeCohort?: boolean;
    wallets?: SubjectRef["wallets"];
    challenge?: string;
    webProofs?: SubjectRef["webProofs"];
    fids?: SubjectRef["fids"];
    /** MULTI-FID Gate 0: on FIXTURE chain facts, bind the seeded demo wallet (ATTEST_DEMO_WALLET_SEED) — the
     * reference issuer demonstrably issues without a browser wallet; refused on live chain facts */
    demoWallet?: boolean;
  } = {}
): Promise<IssuanceResult | Refusal> {
  const issuer = builtinIssuer(issuerId);
  if (!issuer) return { refused: true, reason: `no issuer module "${issuerId}" in this process` };
  // PERSONA LAUNCH (wave 2 close): a host-only issuer refuses in the browser device before it registers or issues
  const unavailable = issuerUnavailableHere(issuerId);
  if (unavailable) return { refused: true, reason: unavailable };
  const reg = await ensureRegistered(issuer, mode);
  if (reg.status !== 200 && reg.status !== 201) return { refused: true, reason: `issuer registration refused: ${reg.status} ${JSON.stringify(reg.json ?? {}).slice(0, 200)}` };

  let wallets = opts.wallets;
  let challenge = opts.challenge;
  if (opts.demoWallet === true) {
    const { chainSource } = await import("./chain/source");
    if (chainSource() !== "fixture") return { refused: true, reason: "the demo wallet is fixture-only — on live chain facts a real wallet must sign the challenge" };
    if (!issuer.mintChallenge) return { refused: true, reason: "this issuer binds no wallet" };
    const { keccak256, toBytes } = await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const seed = process.env.ATTEST_DEMO_WALLET_SEED || "layers-chain-wallet/0";
    const account = privateKeyToAccount(keccak256(toBytes(seed)));
    challenge = issuer.mintChallenge({ mode, commitment: zkCommitment() });
    wallets = [{ address: account.address, challengeSig: await account.signMessage({ message: challenge }) }];
  }
  const subject: SubjectRef = { mode, commitment: zkCommitment(), buckets: opts.buckets, wallets, challenge, webProofs: opts.webProofs, fids: opts.fids };
  const issued = await issuer.issue(subject);
  if (isRefusal(issued)) return issued;
  if (issued.length === 0) return { refused: true, reason: "the issuer found nothing to vouch for" };
  await storeIssued(issued);

  const parts: AttestationPublicPart[] = issued.map(publicPartOf);
  let cohortAttested = 0;
  if (opts.includeCohort === true && process.env.ZK_DEV_HOOKS === "true") {
    const valid = await fetchMembers(mode, "valid");
    let index = 0;
    for (const c of valid.members) {
      if (c === subject.commitment) continue;
      const r = await issuer.issue({ mode, commitment: c, buckets: subject.buckets, cohort: true, cohortIndex: index++ });
      if (isRefusal(r)) continue;
      for (const a of r) parts.push(publicPartOf(a));
      cohortAttested += r.length;
    }
  }
  // in CHUNKS: a cohort's batch (hundreds of ~450-byte issuances) overran the
  // validator's JSON body limit (413) — the request ceiling of 500 was never
  // reachable in one body. Ours ride the first chunk.
  const CHUNK = 100;
  let accepted = 0;
  let epoch: number | undefined;
  let activeFromEpoch: number | undefined;
  const refused: { i: number; error: string }[] = [];
  for (let off = 0; off < parts.length; off += CHUNK) {
    const res = await submitAttestations(mode, parts.slice(off, off + CHUNK));
    const j = (res.json ?? {}) as { accepted?: number; refused?: { i: number; error: string }[]; epoch?: number; activeFromEpoch?: number; error?: string };
    if (res.status !== 200) return { refused: true, reason: `validator refused the issuance: ${res.status} ${JSON.stringify(j).slice(0, 300)}` };
    accepted += j.accepted ?? 0;
    for (const r of j.refused ?? []) refused.push({ i: r.i + off, error: r.error });
    epoch ??= j.epoch;
    activeFromEpoch ??= j.activeFromEpoch;
  }
  return {
    ok: true,
    issuer: issuerId,
    buckets: issued.map((a) => a.bucket),
    accepted,
    refused,
    epoch: epoch ?? issued[0].issueEpoch,
    activeFromEpoch: activeFromEpoch ?? issued[0].issueEpoch + 1,
    expiresEpoch: issued[0].expiryEpoch,
    cohortAttested,
  };
}

export type { IssuedAttestation };
