import "server-only";
// VAULT RECORD ENCRYPTION — AES-256-GCM via node:crypto (OpenSSL;
// platform-audited; the scheme the pass spec explicitly blesses).
//
// Shape decisions, each load-bearing:
//
//   Per-record random 96-bit nonce — GCM's one absolute rule is
//   nonce-uniqueness per key; random 12-byte nonces are safe orders of
//   magnitude beyond this app's write volume, and randomness beats a
//   counter that a restart could rewind.
//
//   AAD binds ns|id|v — the ciphertext is welded to its address. A
//   server that returns record A's ciphertext under record B's id
//   produces a clean decryption FAILURE, not a confused success. The
//   untrusted party stores bytes; it does not get to rearrange meaning.
//
//   Decrypt failure throws AND the caller treats it as ABSENT-of-record
//   (fail closed), never as empty-value success.
//
// The vault key never appears in this module — callers hold it (derived
// off the seed in kdf.ts) and pass it per call. This module is pure
// bytes-in/bytes-out.
// BROWSER KEYSTORE PASS: the same AES-256-GCM through lib/platform/crypto (@noble/ciphers), so the vault seals with
// identical bytes whether the device is the rig's server process or a visitor's browser (docs/custody-model.md).
import { aesGcmOpen, aesGcmSeal, randomBytes } from "@/lib/platform/crypto";

/** What actually gets persisted server-side: ciphertext and addressing,
 * nothing else. The leak grep asserts plaintext never rides along. */
export interface VaultCiphertext {
  v: 1;
  ns: string;
  id: string;
  nonce: string; // 12 bytes hex
  ct: string;    // ciphertext + GCM tag, hex
}

function aad(ns: string, id: string): Buffer {
  return Buffer.from(`layers-vault/1|${ns}|${id}`, "utf8");
}

export function encryptRecord(key: Uint8Array, ns: string, id: string, plaintext: unknown): VaultCiphertext {
  if (key.length !== 32) throw new Error(`vaultCipher: key must be 32 bytes, got ${key.length}`);
  const nonce = randomBytes(12);
  const pt = Buffer.from(JSON.stringify(plaintext), "utf8");
  const body = Buffer.from(aesGcmSeal(key, nonce, pt, aad(ns, id)));
  return { v: 1, ns, id, nonce: nonce.toString("hex"), ct: body.toString("hex") };
}

/**
 * Decrypt one record. Throws on ANY failure — wrong key, tampered
 * bytes, moved address (AAD mismatch), truncation. Callers fail closed:
 * a record that will not decrypt is a record that does not exist.
 */
export function decryptRecord<T = unknown>(key: Uint8Array, rec: VaultCiphertext): T {
  if (key.length !== 32) throw new Error(`vaultCipher: key must be 32 bytes, got ${key.length}`);
  const body = Buffer.from(rec.ct, "hex");
  if (body.length < 16) throw new Error("vaultCipher: ciphertext too short");
  const pt = Buffer.from(aesGcmOpen(key, Buffer.from(rec.nonce, "hex"), body, aad(rec.ns, rec.id)));
  return JSON.parse(pt.toString("utf8")) as T;
}
