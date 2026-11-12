import "server-only";
// PERSONA LAUNCH P5 (D1) — THE FARCASTER REACH ISSUER, behind the open AttestationIssuer interface:
//
//   fc.reach   gte-1k | gte-10k | gte-100k   (NESTED: a 100k account is issued all three)
//
// WHAT IT ASSERTS: the root's OWN main Farcaster account has at least that many followers. Coarse buckets, never the
// number (an exact follower count is a fingerprint). ENTRY: the account's Neynar score is at least 0.7 (D1's entry
// ticket) — below it nothing is issued, in plain words. Facts come through the fid-facts seam (lib/attest/fid/*:
// fixture in sweeps, the existing Neynar user lookup on live, never in a sweep).
//
// CONTROL — the root's own main account ONLY. The issuer is co-hosted with the subject's device (A-ATT-ISSUER-COHOSTED),
// so it reads the main account where the device keeps it: the owner service's connected public-self record
// (lib/fc/personaFid.ts connectedRecords) or the sealed Sign in with Farcaster link (lib/fc/siwf/links.ts mainLink),
// exactly as lib/identity/rootHeadshot.ts does — READ ONLY, never edited, never a fid taken from the request. A request
// that names any other fid is refused. A disconnected main proves nothing.
//
// ONE ACCOUNT PER ROOT: the issuer's retention family "fc.reach" remembers (salted hash of the fid) → the commitment it
// vouched for; a second root binding the same account is refused while the first's issuance is unexpired.
//
// WHAT THE ISSUER LEARNS, said plainly (A-REACH-ISSUER-SEES-MEMBERS): at issuance it sees fid → commitment, so it knows
// who is in each reach tree. It never sees which anonymous post any member made: the post proves membership in the tree,
// not a leaf.
import { randomBytes } from "@/lib/platform/crypto";
import { storage } from "@/lib/platform/storage";
import path from "node:path";
import { fetchEpoch } from "@/lib/zk/validatorClient";
import { REACH_BUCKETS, REACH_MIN_SCORE, reachBucketsFor } from "@/lib/reach/trees";
import { attestCanonical, claimHash, issueWindowStart } from "../canonical";
import { fidFacts } from "../fid/source";
import { issuerKeyFor, signWithKey } from "../issuerKey";
import { boundElsewhere, retain } from "../retention";
import type { AttestationClaim, AttestationIssuer, IssuedAttestation, JsonSchema, Refusal, SubjectRef } from "../types";

export const REACH_KEY_ID = "reach";
export const FC_REACH_ID = "fc.reach";
/** follower counts move slowly: two days of 6-hour epochs */
export const REACH_VALIDITY_EPOCHS = 8;

/**
 * The fid of the root's OWN main Farcaster account, or null when there is none (or it was disconnected). THROWS when
 * the record that would say cannot be read — never "no account" on a failed read. Mirrors rootHeadshot's readers.
 */
export async function mainAccountFid(): Promise<number | null> {
  if (typeof window === "undefined") {
    const { connectedRecords } = await import("@/lib/fc/personaFid");
    const records = await connectedRecords(); // THROWS on an unreadable vault
    const main = records.find((r) => r.connected?.publicSelf === true) ?? null;
    if (main) return main.connected?.disconnectedAt ? null : Number.isInteger(main.fid) && main.fid > 0 ? main.fid : null;
    const { siwfGate } = await import("@/lib/fc/siwf/flow");
    if (!siwfGate().ok) return null;
  }
  const { mainLink } = await import("@/lib/fc/siwf/links");
  const link = await mainLink(); // THROWS on an unreadable namespace
  if (!link || link.disconnectedAt !== null) return null;
  return Number.isInteger(link.fid) && link.fid > 0 ? link.fid : null;
}

const SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "fc.reach",
  description:
    "The root's own main Farcaster account (Neynar score at least 0.7) has at least the bucket's number of followers at the snapshot. Buckets nest; tiers, never the number.",
  type: "object",
  properties: { kind: { const: "reach" }, provider: { const: "farcaster" }, bucket: { enum: [...REACH_BUCKETS] }, snapshotEpoch: { type: "integer" } },
  required: ["kind", "provider", "bucket", "snapshotEpoch"],
};

/** the issuer's refusal for a transport error, with no digits in it (never the fid) */
const scrub = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b\d{1,12}\b/g, "<n>").split("\n")[0].slice(0, 160);

/** the shared tail of both reach issuers: the score gate, the buckets, and one signed issuance per bucket */
export function reachIssuances(
  issuerId: string,
  provider: "farcaster" | "x",
  subject: SubjectRef,
  epoch: number,
  facts: { score: number | null; followers: number | null },
  words: { source: string }
): IssuedAttestation[] | Refusal {
  if (facts.score === null || !Number.isFinite(facts.score) || facts.score < REACH_MIN_SCORE) {
    return { refused: true, reason: `Your account's Neynar score is below ${REACH_MIN_SCORE}, so it can't join a reach tier yet.` };
  }
  const supported = reachBucketsFor(facts.followers);
  if (supported.length === 0) return { refused: true, reason: `Your ${words.source} account has fewer than 1,000 followers, so it isn't in a reach tier yet.` };
  const wanted = subject.buckets && subject.buckets.length ? subject.buckets.filter((b) => (supported as string[]).includes(b)) : supported;
  if (wanted.length === 0) return { refused: true, reason: "Your follower count doesn't reach the tier you asked for." };
  const key = issuerKeyFor(REACH_KEY_ID);
  const out: IssuedAttestation[] = [];
  for (const bucket of wanted) {
    // the CLAIM is the bucket and the epoch — never the count
    const value: Record<string, unknown> = { kind: "reach", provider, bucket, snapshotEpoch: epoch };
    const claim: AttestationClaim = { kind: "reach", bucket, value, nonce: randomBytes(32).toString("hex") };
    const fields = { mode: subject.mode, issuer: issuerId, bucket, commitment: subject.commitment, claimHash: claimHash(claim), issuedEpoch: epoch, expiresEpoch: issueWindowStart(epoch) + REACH_VALIDITY_EPOCHS };
    out.push({
      issuerId,
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
  return out;
}

export const fcReachIssuer: AttestationIssuer = {
  id: FC_REACH_ID,
  displayName: "Farcaster followers — reach tier (coarse)",
  claimSchema: SCHEMA,
  buckets: REACH_BUCKETS,
  validity: { epochs: REACH_VALIDITY_EPOCHS },
  trustTier: "attested",
  get publicKey() {
    return issuerKeyFor(REACH_KEY_ID).pubHex;
  },
  sign(canonical: string) {
    return signWithKey(issuerKeyFor(REACH_KEY_ID), canonical);
  },
  async issue(subject: SubjectRef): Promise<IssuedAttestation[] | Refusal> {
    const adapter = fidFacts();
    let epoch: number;
    try {
      epoch = (await fetchEpoch(subject.mode)).epoch;
    } catch (e) {
      return { refused: true, reason: "the issuer could not read the epoch: " + (e as Error).message };
    }
    // the fixture decoy crowd (dev hooks only): synthetic facts by index, no account
    if (subject.cohort === true) {
      if (adapter.kind !== "fixture" || process.env.ZK_DEV_HOOKS !== "true" || !adapter.cohortFacts) return { refused: true, reason: "cohort facts are a fixture rig's only" };
      const f = adapter.cohortFacts(subject.commitment, subject.cohortIndex);
      return reachIssuances(FC_REACH_ID, "farcaster", subject, epoch, { score: f.score, followers: f.followerCount }, { source: "Farcaster" });
    }
    let fid: number | null;
    try {
      fid = await mainAccountFid();
    } catch (e) {
      return { refused: true, reason: "Couldn't read your Farcaster account (" + scrub(e) + ") — nothing was issued." };
    }
    if (fid === null) return { refused: true, reason: "Sign in with your Farcaster account first — a reach tier comes from your own account's followers." };
    if (subject.fids && subject.fids.some((p) => Number(p.fid) !== fid)) return { refused: true, reason: "Only your own Farcaster account can prove your reach." };
    if (boundElsewhere(FC_REACH_ID, String(fid), subject.commitment, epoch, REACH_VALIDITY_EPOCHS)) {
      return { refused: true, reason: "This Farcaster account already proves the reach of another identity — one account per identity." };
    }
    let facts;
    try {
      facts = await adapter.facts(fid);
    } catch (e) {
      return { refused: true, reason: "Follower facts for your account are unavailable right now (" + scrub(e) + ")." };
    }
    const issued = reachIssuances(FC_REACH_ID, "farcaster", subject, epoch, { score: facts.score, followers: facts.followerCount }, { source: "Farcaster" });
    if (!Array.isArray(issued)) return issued;
    retain(FC_REACH_ID, [String(fid)], issued);
    return issued;
  },
};

/** resetZk (fixture, dev hooks): the reach families' identity → commitment bindings are moot once the universe forgot
 *  every commitment. DELIBERATE DUPLICATE of lib/attest/retention.ts's file path and empty-document shape (its
 *  clearRetention() lists the onchain/x/neynar families only; folding these two in there is a request to its owner). */
export function clearReachRetention(): void {
  const dir = path.join(process.env.KEYSTORE_DIR || path.join(process.cwd(), ".keystore"), "issuers");
  for (const family of [FC_REACH_ID, "x.reach"]) {
    const f = path.join(dir, `${family}-subjects.json`);
    if (storage.exists(f)) storage.writeText(f, JSON.stringify({ salt: randomBytes(32).toString("hex"), subjects: {} }, null, 2) + "\n");
  }
}
