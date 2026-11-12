import "server-only";
// ATTESTATION PASS Gate 1 — an ISSUER's signing key. Random Ed25519, one
// per issuer id, at .keystore/issuers/<id>.json (gitignored with the rest
// of .keystore/), loud-load / atomic-write like the device key.
//
// TOPOLOGY, stated (A-ATT-ISSUER-COHOSTED in the posture doc): in this
// repository the reference issuers run as modules inside the Next
// process, so their keys sit beside the user's keystore on the same
// host. That is a demo of a SEPARATE party: in a product the issuer's
// key lives on the issuer's host and the subject only ever holds the
// issuer's PUBLIC key (from the validator's registry). Nothing here is
// the user's key material, and it is leak-grepped like everything else.
import { storage } from "@/lib/platform/storage";
import { randomBytes } from "@/lib/platform/crypto";
import path from "node:path";
import { fromHex, publicKeyOf, signCanonical } from "@/lib/crypto/ed25519";
import { validIssuer } from "./ids";

interface IssuerKeyRecord {
  id: string;
  privHex: string; // never serialized outward, leak-grepped
  pubHex: string;
  createdAt: number;
}

const DEFAULT_DIR = () => process.env.KEYSTORE_DIR || path.join(process.cwd(), ".keystore");
const cache = new Map<string, IssuerKeyRecord>();

function keyFile(id: string, dir: string): string {
  return path.join(dir, "issuers", id + ".json");
}

export function issuerKey(id: string, dir: string = DEFAULT_DIR()): IssuerKeyRecord {
  if (!validIssuer(id)) throw new Error("issuerKey: malformed issuer id");
  const cached = cache.get(id);
  if (cached) return cached;
  const file = keyFile(id, dir);
  let rec: IssuerKeyRecord;
  if (storage.exists(file)) {
    try {
      rec = JSON.parse(storage.readText(file)) as IssuerKeyRecord;
    } catch {
      throw new Error(`issuerKey: ${file} is corrupt. Refusing to regenerate over key material.`);
    }
    if (!/^[0-9a-f]{64}$/.test(rec.privHex ?? "") || rec.id !== id) throw new Error(`issuerKey: ${file} failed validation. Refusing to regenerate.`);
  } else {
    const priv = randomBytes(32);
    rec = { id, privHex: priv.toString("hex"), pubHex: publicKeyOf(new Uint8Array(priv)), createdAt: Date.now() };
    storage.writeText(file, JSON.stringify(rec, null, 2) + "\n");
  }
  cache.set(id, rec);
  return rec;
}

export function issuerPublicKey(id: string): string {
  return issuerKey(id).pubHex;
}

export function signAsIssuer(id: string, canonical: string): string {
  return signCanonical(canonical, fromHex(issuerKey(id).privHex));
}

/** Gate 2: a key shared by an issuer FAMILY (the four onchain.* issuers sign
 * under one key in phase 1, key id "onchain" — documented as such; a
 * rotation is a new family). The key id follows the issuer-id grammar. */
export function issuerKeyFor(keyId: string, dir: string = DEFAULT_DIR()): IssuerKeyRecord {
  return issuerKey(keyId, dir);
}

export function signWithKey(rec: IssuerKeyRecord, canonical: string): string {
  return signCanonical(canonical, fromHex(rec.privHex));
}

/** every issuer private key on this host — for the leak grep, never for a payload */
export function issuerKeyMaterialForLeakTest(dir: string = DEFAULT_DIR()): string[] {
  const out: string[] = [];
  const d = path.join(dir, "issuers");
  for (const f of storage.list(d)) {
    if (!f.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(storage.readText(path.join(d, f))) as IssuerKeyRecord;
      if (rec.privHex) out.push(rec.privHex);
    } catch {
      /* unreadable: nothing to grep for */
    }
  }
  return out;
}
