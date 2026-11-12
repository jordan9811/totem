import "server-only";
// MULTI-FID PASS Gate 0 — an issuer's own RETENTION, shared by every family
// that binds an external identity: a SALTED HASH of the identity (a wallet
// address, an X handle, a Farcaster fid) → the issuances it contributed
// to. Revocation needs to find an issuance again; nothing else does. The
// attestation itself carries no identity, and the validator never sees
// this file. One identity vouches for ONE root (attack-att-3 #2,
// attack-att-1 #5): an identity already bound to another commitment by
// an unexpired issuance is refused — one whale cannot mint N whales, and a
// thin bucket cannot be padded through the honest issuer.
import { createHash, randomBytes } from "@/lib/platform/crypto";
import { storage } from "@/lib/platform/storage";
import path from "node:path";
import type { IssuedAttestation } from "./types";

interface SubjectFile {
  salt: string;
  /** sha256(salt|identity) -> the issuances that identity contributed to */
  subjects: Record<string, { commitment: string; issuer: string; buckets: string[]; issuedEpoch: number }[]>;
}

const filePath = (family: string) =>
  path.join(process.env.KEYSTORE_DIR || path.join(process.cwd(), ".keystore"), "issuers", `${family}-subjects.json`);

function load(family: string): SubjectFile {
  const f = filePath(family);
  if (storage.exists(f)) {
    try {
      return JSON.parse(storage.readText(f)) as SubjectFile;
    } catch {
      /* fall through to a fresh file */
    }
  }
  return { salt: randomBytes(32).toString("hex"), subjects: {} };
}

function save(family: string, doc: SubjectFile): void {
  const f = filePath(family);
  storage.writeText(f, JSON.stringify(doc, null, 2) + "\n");
}

/** the salted hash under which an identity is remembered (lower-cased: an address or handle is case-insensitive) */
export function subjectHash(identity: string, salt: string): string {
  return createHash("sha256").update(["layers-attest-subject/1", salt, identity.toLowerCase()].join("|")).digest("hex");
}

/** true when this identity already vouches, unexpired, for a DIFFERENT commitment */
export function boundElsewhere(family: string, identity: string, commitment: string, nowEpoch: number, validityMax: number): boolean {
  const doc = load(family);
  const list = doc.subjects[subjectHash(identity, doc.salt)] ?? [];
  return list.some((x) => x.commitment !== commitment && x.issuedEpoch + 1 + validityMax > nowEpoch);
}

export function retain(family: string, identities: string[], issued: IssuedAttestation[]): void {
  if (!issued.length || !identities.length) return;
  const doc = load(family);
  for (const id of identities) {
    const h = subjectHash(id, doc.salt);
    const list = doc.subjects[h] ?? [];
    for (const i of issued) list.push({ commitment: i.subjectCommitment, issuer: i.issuerId, buckets: [i.bucket], issuedEpoch: i.issueEpoch });
    doc.subjects[h] = list;
  }
  save(family, doc);
}

/** for the leak test: the retention files hold hashes, never the identities. PERSONA LAUNCH P5: the reach families
 *  (fc.reach, x.reach) bind one main account per root the same way, so they are listed (and cleared) here too. */
export function retentionFiles(): string[] {
  return ["onchain", "x", "neynar", "fc.reach", "x.reach"].map(filePath).filter((f) => storage.exists(f));
}

/** resetZk (fixture, dev hooks): the universe forgot every commitment, so the identity → commitment
 * bindings are moot — a root re-registering under a fresh commitment must be able to bind its own
 * wallet, handle or fid again. (The Gate 1 regression found the old bindings refusing the new root.) */
export function clearRetention(): void {
  for (const family of ["onchain", "x", "neynar", "fc.reach", "x.reach"]) {
    const f = filePath(family);
    if (storage.exists(f)) save(family, { salt: randomBytes(32).toString("hex"), subjects: {} });
  }
}
