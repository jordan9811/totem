import "server-only";
// ENCRYPTED PASSPHRASE ESCROW — the stronger recovery option.
//
// The seed, encrypted under a key stretched from a user PASSPHRASE, stored
// as ciphertext the server can never read. Recovery needs only the
// passphrase. The trade-off, stated honestly in the report: convenience
// (no 24 words to keep safe) bought with a passphrase to remember and a
// new ciphertext-at-rest surface — weaker than a phrase kept offline,
// stronger than nothing, and it never exposes the seed to the server.
//
// WHY THIS AND NOT SHAMIR SOCIAL RECOVERY (the nominal default): social
// recovery needs Shamir secret sharing, and the crypto discipline is
// absolute — audited primitives only, no hand-rolled schemes. There is no
// vetted Shamir implementation on disk, and pulling an unvetted one in is
// the supply-chain risk that rule exists to prevent. Escrow meets the
// same "one stronger option" bar using only audited platform primitives
// (scrypt + AES-256-GCM). Shamir/SLIP-39 is the documented next step,
// once a library can be vetted.
//
// KDF: scrypt (OpenSSL, memory-hard) with per-escrow random salt and
// deliberately costly parameters, so a stolen escrow blob is not a fast
// offline-guess target.
import { aesGcmOpen, aesGcmSeal, randomBytes, scryptSync } from "@/lib/platform/crypto";

export interface SeedEscrow {
  v: 1;
  salt: string; // hex
  nonce: string; // hex
  ct: string; // hex (ciphertext + GCM tag)
  // scrypt cost, stored so a future parameter bump can still open old blobs
  N: number;
  r: number;
  p: number;
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

function stretch(passphrase: string, salt: Buffer, cost = SCRYPT): Buffer {
  return scryptSync(passphrase, salt, cost.keylen, { N: cost.N, r: cost.r, p: cost.p, maxmem: cost.maxmem });
}

/** Seal the seed under a passphrase. Only the returned blob is ever
 * stored; the passphrase and the seed stay on the device. */
export function sealSeedEscrow(seedHex: string, passphrase: string): SeedEscrow {
  if (!/^[0-9a-f]{64}$/.test(seedHex)) throw new Error("escrow: seed must be 32-byte hex");
  if (!passphrase || passphrase.length < 8) throw new Error("escrow: passphrase must be at least 8 characters");
  const salt = randomBytes(16);
  const key = stretch(passphrase, salt);
  const nonce = randomBytes(12);
  const body = Buffer.from(aesGcmSeal(key, nonce, Buffer.from(seedHex, "hex")));
  return { v: 1, salt: salt.toString("hex"), nonce: nonce.toString("hex"), ct: body.toString("hex"), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p };
}

/** Recover the seed from an escrow blob + passphrase. Throws on a wrong
 * passphrase (GCM auth fails) — a wrong passphrase yields NO seed, never
 * a plausible-but-wrong one. */
export function openSeedEscrow(blob: SeedEscrow, passphrase: string): string {
  const salt = Buffer.from(blob.salt, "hex");
  const key = stretch(passphrase, salt, { ...SCRYPT, N: blob.N, r: blob.r, p: blob.p });
  const body = Buffer.from(blob.ct, "hex");
  try {
    return Buffer.from(aesGcmOpen(key, Buffer.from(blob.nonce, "hex"), body)).toString("hex");
  } catch {
    throw new Error("wrong passphrase (escrow did not decrypt)");
  }
}
