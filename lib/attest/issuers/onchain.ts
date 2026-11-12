import "server-only";
// ATTESTATION PASS Gate 2 — THE ONCHAIN-FACTS REFERENCE ISSUER. It needs
// nobody's permission and nobody's trust: the facts are public, the
// subject proves control of its wallets to the issuer with a signed
// challenge, and the issuer signs COARSE BUCKETS — never a number.
//
// The `onchain.*` family is one issuer id per claim kind, all sharing ONE
// signing key in phase 1 (key id "onchain"; a rotation is a new family):
//   onchain.wallet-age        gt1y | gt2y | gt4y            (nested)
//   onchain.holdings          eth-gte-0.1 | eth-gte-1 | eth-gte-10 (nested; ETH, summed over bound wallets)
//   onchain.protocol-history  aave | morpho | compound | uniswap (interacted before the issue epoch)
//   onchain.governance        votes-gte-1 | votes-gte-5 | votes-gte-20 (nested; Snapshot votes)
//
// COARSENESS IS A PRIVACY CONTROL, not a UX choice: an exact balance, a
// first-tx timestamp or a vote count is a fingerprint; a bucket shared by
// fifty roots is a set. A bucket's population is checked against the
// anonymity floor by the CLIENT before it proves into it (lib/zk/cohort.ts)
// and by every gated surface (Gate 3) — a thin bucket is honoured NOWHERE.
//
// WHAT THE ISSUER SEES AND KEEPS: the wallet address, during issuance
// only, and a SALTED HASH of it afterwards (revocation needs to find the
// issuance again; nothing else does). The attestation carries no address,
// no wallet count, no exact value; the subject's vault holds the bucket.
// MULTIPLE WALLETS aggregate at the root (max age, summed holdings, union
// of protocols, summed votes) and the validator never sees the set or its
// size.
import { randomBytes } from "@/lib/platform/crypto";
import { verifyMessage } from "viem";
import { fetchEpoch } from "@/lib/zk/validatorClient";
import { attestCanonical, claimHash, issueWindowStart } from "../canonical";
import { challengeIsLive, consumeChallenge, mintChallenge } from "../challenge";
import { chainFacts } from "../chain/source";
import { TRACKED_PROTOCOLS, type WalletFacts } from "../chain/types";
import { issuerKeyFor, signWithKey } from "../issuerKey";
import { boundElsewhere, retain, subjectHash } from "../retention";
import type { AttestationClaim, AttestationIssuer, IssuedAttestation, JsonSchema, Refusal, SubjectRef } from "../types";

export const ONCHAIN_KEY_ID = "onchain";
const YEAR = 365.25 * 24 * 3600 * 1000;

/** an address must never ride an error, a log line or a recorded refusal (live-att1 found viem quoting the RPC request body — the address — in its message) */
export function redactAddresses(s: string): string {
  return s.replace(/0x[0-9a-fA-F]{40}/g, "0x<redacted>");
}
const WEI = BigInt("1000000000000000000");

// ---------- buckets ----------
export const ONCHAIN_BUCKETS = Object.freeze({
  "onchain.wallet-age": Object.freeze(["gt1y", "gt2y", "gt4y"]),
  "onchain.holdings": Object.freeze(["eth-gte-0.1", "eth-gte-1", "eth-gte-10"]),
  "onchain.protocol-history": Object.freeze([...TRACKED_PROTOCOLS]),
  "onchain.governance": Object.freeze(["votes-gte-1", "votes-gte-5", "votes-gte-20"]),
});
export type OnchainIssuerId = keyof typeof ONCHAIN_BUCKETS;

/** validity in epochs (epochs are 6 h by default): facts that move slowly last a week, holdings a day */
const VALIDITY: Record<OnchainIssuerId, number> = {
  "onchain.wallet-age": 28,
  "onchain.holdings": 4,
  "onchain.protocol-history": 28,
  "onchain.governance": 28,
};

/** the buckets one AGGREGATED fact set supports, per issuer — nested buckets all fire */
export function bucketsFor(id: OnchainIssuerId, f: WalletFacts, now = Date.now()): string[] {
  switch (id) {
    case "onchain.wallet-age": {
      if (f.firstTxAt === null) return [];
      const age = now - f.firstTxAt;
      const out: string[] = [];
      if (age > 1 * YEAR) out.push("gt1y");
      if (age > 2 * YEAR) out.push("gt2y");
      if (age > 4 * YEAR) out.push("gt4y");
      return out;
    }
    case "onchain.holdings": {
      const wei = BigInt(f.ethWei || "0");
      const out: string[] = [];
      if (wei >= WEI / BigInt(10)) out.push("eth-gte-0.1");
      if (wei >= WEI) out.push("eth-gte-1");
      if (wei >= BigInt(10) * WEI) out.push("eth-gte-10");
      return out;
    }
    case "onchain.protocol-history":
      return TRACKED_PROTOCOLS.filter((p) => f.protocols.includes(p));
    case "onchain.governance": {
      const out: string[] = [];
      if (f.votes >= 1) out.push("votes-gte-1");
      if (f.votes >= 5) out.push("votes-gte-5");
      if (f.votes >= 20) out.push("votes-gte-20");
      return out;
    }
  }
}

/** aggregate several wallets' facts at the ROOT: max age, summed holdings, union, summed votes */
export function aggregateFacts(all: WalletFacts[]): WalletFacts {
  let firstTxAt: number | null = null;
  let wei = BigInt(0);
  const protocols = new Set<string>();
  let votes = 0;
  for (const f of all) {
    if (f.firstTxAt !== null && (firstTxAt === null || f.firstTxAt < firstTxAt)) firstTxAt = f.firstTxAt;
    wei += BigInt(f.ethWei || "0");
    for (const p of f.protocols) protocols.add(p);
    votes += f.votes;
  }
  return { firstTxAt, ethWei: wei.toString(10), protocols: [...protocols], votes };
}

// the challenge and the retention moved to ../challenge.ts and ../retention.ts (MULTI-FID Gate 0:
// every identity-binding issuer shares them); the onchain family keeps its file and hash domain
export { mintChallenge };
/** compat: the salted hash an onchain wallet is remembered under */
export function walletHash(address: string, salt: string): string {
  return subjectHash(address, salt);
}

// ---------- the issuers ----------
const SCHEMAS: Record<OnchainIssuerId, JsonSchema> = {
  "onchain.wallet-age": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "onchain.wallet-age",
    description: "The root controls a wallet whose first transaction is older than the bucket says (max over bound wallets). Buckets nest: gt4y implies gt2y implies gt1y.",
    type: "object",
    properties: { kind: { const: "wallet-age" }, bucket: { enum: ["gt1y", "gt2y", "gt4y"] }, snapshotEpoch: { type: "integer" } },
    required: ["kind", "bucket", "snapshotEpoch"],
  },
  "onchain.holdings": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "onchain.holdings",
    description: "The root's bound wallets together held at least the bucket's amount of ETH at the snapshot. Tiers, never amounts: an exact balance is a fingerprint.",
    type: "object",
    properties: { kind: { const: "holdings" }, asset: { const: "eth" }, bucket: { enum: ["eth-gte-0.1", "eth-gte-1", "eth-gte-10"] }, snapshotEpoch: { type: "integer" } },
    required: ["kind", "asset", "bucket", "snapshotEpoch"],
  },
  "onchain.protocol-history": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "onchain.protocol-history",
    description: "A bound wallet interacted with the named protocol before the issue epoch (Aave, Morpho, Compound, Uniswap).",
    type: "object",
    properties: { kind: { const: "protocol-history" }, bucket: { enum: [...TRACKED_PROTOCOLS] }, snapshotEpoch: { type: "integer" } },
    required: ["kind", "bucket", "snapshotEpoch"],
  },
  "onchain.governance": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "onchain.governance",
    description: "The root's bound wallets cast at least the bucket's number of governance votes (Snapshot, any space). Buckets nest.",
    type: "object",
    properties: { kind: { const: "governance" }, bucket: { enum: ["votes-gte-1", "votes-gte-5", "votes-gte-20"] }, snapshotEpoch: { type: "integer" } },
    required: ["kind", "bucket", "snapshotEpoch"],
  },
};
const DISPLAY: Record<OnchainIssuerId, string> = {
  "onchain.wallet-age": "Onchain facts — wallet age",
  "onchain.holdings": "Onchain facts — holdings (ETH, coarse)",
  "onchain.protocol-history": "Onchain facts — protocol history",
  "onchain.governance": "Onchain facts — governance participation",
};

function makeIssuer(id: OnchainIssuerId): AttestationIssuer {
  return {
    id,
    displayName: DISPLAY[id],
    claimSchema: SCHEMAS[id],
    buckets: ONCHAIN_BUCKETS[id],
    validity: { epochs: VALIDITY[id] },
    trustTier: "attested",
    get publicKey() {
      return issuerKeyFor(ONCHAIN_KEY_ID).pubHex;
    },
    sign(canonical: string) {
      return signWithKey(issuerKeyFor(ONCHAIN_KEY_ID), canonical);
    },
    mintChallenge(subject) {
      return mintChallenge(id, subject, 0);
    },
    async issue(subject: SubjectRef): Promise<IssuedAttestation[] | Refusal> {
      const adapter = chainFacts();
      let epoch: number;
      try {
        epoch = (await fetchEpoch(subject.mode)).epoch;
      } catch (e) {
        return { refused: true, reason: "issuer could not read the epoch: " + (e as Error).message };
      }
      let facts: WalletFacts;
      const addresses: string[] = [];
      if (subject.wallets && subject.wallets.length) {
        // WALLET OWNERSHIP BINDING: every wallet signs the issuer's live challenge
        if (!subject.challenge || !challengeIsLive(subject.challenge, id, subject)) return { refused: true, reason: "no live challenge for this subject — mint one first" };
        const all: WalletFacts[] = [];
        for (const w of subject.wallets) {
          if (!/^0x[0-9a-fA-F]{40}$/.test(w.address)) return { refused: true, reason: "wallet address malformed" };
          let ok = false;
          try {
            ok = await verifyMessage({ address: w.address as `0x${string}`, message: subject.challenge, signature: w.challengeSig as `0x${string}` });
          } catch {
            ok = false;
          }
          if (!ok) return { refused: true, reason: "wallet signature over the challenge does not verify — control not proven" };
          if (boundElsewhere(ONCHAIN_KEY_ID, w.address, subject.commitment, epoch, Math.max(...Object.values(VALIDITY)))) return { refused: true, reason: "a bound wallet already vouches for another root — one wallet, one root" };
          try {
            all.push(await adapter.facts(w.address));
          } catch (e) {
            // NEVER the adapter's raw error: a transport library's message quotes
            // the request body, and the request body is the wallet address. The
            // refusal names the source, never the subject.
            return { refused: true, reason: "chain facts unavailable: " + redactAddresses((e as Error).message).split("\n")[0].slice(0, 160) };
          }
          addresses.push(w.address);
        }
        consumeChallenge(subject.challenge);
        facts = aggregateFacts(all);
      } else if (subject.cohort === true && adapter.kind === "fixture" && process.env.ZK_DEV_HOOKS === "true" && adapter.cohortFacts) {
        // FIXTURE cohort furniture: synthetic facts for a decoy commitment (no wallet, no binding)
        facts = adapter.cohortFacts(subject.commitment, subject.cohortIndex);
      } else {
        return { refused: true, reason: "no wallet bound — an onchain attestation needs at least one wallet that signed the challenge" };
      }
      const supported = bucketsFor(id, facts);
      const wanted = subject.buckets && subject.buckets.length ? subject.buckets.filter((b) => supported.includes(b)) : supported;
      if (wanted.length === 0) return { refused: true, reason: "the facts support none of the requested buckets" };
      const out: IssuedAttestation[] = [];
      const key = issuerKeyFor(ONCHAIN_KEY_ID);
      for (const bucket of wanted) {
        // the CLAIM is the bucket and the epoch — never the number behind it
        const value: Record<string, unknown> = id === "onchain.holdings" ? { kind: "holdings", asset: "eth", bucket, snapshotEpoch: epoch } : { kind: id.slice("onchain.".length), bucket, snapshotEpoch: epoch };
        const claim: AttestationClaim = { kind: id.slice("onchain.".length), bucket, value, nonce: randomBytes(32).toString("hex") };
        const fields = { mode: subject.mode, issuer: id, bucket, commitment: subject.commitment, claimHash: claimHash(claim), issuedEpoch: epoch, expiresEpoch: issueWindowStart(epoch) + VALIDITY[id] };
        out.push({
          issuerId: id,
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
      retain(ONCHAIN_KEY_ID, addresses, out);
      return out;
    },
  };
}

export const onchainIssuers: Record<OnchainIssuerId, AttestationIssuer> = {
  "onchain.wallet-age": makeIssuer("onchain.wallet-age"),
  "onchain.holdings": makeIssuer("onchain.holdings"),
  "onchain.protocol-history": makeIssuer("onchain.protocol-history"),
  "onchain.governance": makeIssuer("onchain.governance"),
};

export function isOnchainIssuer(id: string): id is OnchainIssuerId {
  return Object.prototype.hasOwnProperty.call(ONCHAIN_BUCKETS, id);
}
