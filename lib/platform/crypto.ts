// BROWSER KEYSTORE PASS Gate 1, stage 1 — ONE crypto implementation for Node and the browser.
//
// The device used to be the Next server process and everything hashed, drew randomness and sealed through
// node:crypto. The device is now the browser (docs/custody-model.md, D-CU-0-2), so the same code must run in both
// hosts with identical bytes: sha-256 from @noble/hashes, AES-256-GCM from @noble/ciphers (audited, pure TypeScript,
// synchronous like node:crypto was), randomness from the platform's getRandomValues, and a Buffer for the callers that
// already speak Buffer (Node's own; the bundler supplies the browser polyfill).
//
// The shapes mirror the node:crypto calls the codebase makes — createHash("sha256").update(x).digest("hex"),
// randomBytes(n).toString("hex") — so the fifty-odd call sites change an import path and nothing else. No new
// primitive: AES-GCM, SHA-256, HKDF and scrypt were the primitives before; they are the primitives now.
import { Buffer } from "buffer";
import { sha256, sha512 } from "@noble/hashes/sha2";
import { sha1 } from "@noble/hashes/sha1";
import { blake2b } from "@noble/hashes/blake2b";
import { hkdf } from "@noble/hashes/hkdf";
import { scrypt as nobleScrypt } from "@noble/hashes/scrypt";
import { gcm } from "@noble/ciphers/aes";

export { Buffer };

type HashName = "sha256" | "sha512" | "sha1" | "blake2b512";
type Encoding = "hex" | "base64" | "base64url" | "utf8" | "utf-8" | "latin1" | "binary" | "ascii";

const HASHES: Record<HashName, () => { update(data: Uint8Array): unknown; digest(): Uint8Array }> = {
  sha256: () => sha256.create(),
  sha512: () => sha512.create(),
  sha1: () => sha1.create(),
  blake2b512: () => blake2b.create({ dkLen: 64 }),
};

function toBytes(data: string | Uint8Array, encoding?: Encoding): Uint8Array {
  if (typeof data !== "string") return data;
  return Buffer.from(data, (encoding ?? "utf8") as BufferEncoding);
}

/** the node:crypto Hash shape the call sites use: chainable update, digest() → Buffer, digest("hex") → string */
export interface Hasher {
  update(data: string | Uint8Array, encoding?: Encoding): Hasher;
  digest(): Buffer;
  digest(encoding: Encoding): string;
}

/** node:crypto's createHash, for the algorithms the codebase uses; digest() returns a Buffer like Node's does */
export function createHash(algorithm: string): Hasher {
  const make = HASHES[algorithm as HashName];
  if (!make) throw new Error(`platform/crypto: unsupported hash ${algorithm}`);
  const h = make();
  const api: Hasher = {
    update(data: string | Uint8Array, encoding?: Encoding): Hasher {
      h.update(toBytes(data, encoding));
      return api;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    digest(encoding?: Encoding): any {
      const out = Buffer.from(h.digest());
      return encoding ? out.toString(encoding as BufferEncoding) : out;
    },
  };
  return api;
}

/** node:crypto's randomBytes: a Buffer of n cryptographically random bytes from the platform */
export function randomBytes(n: number): Buffer {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return Buffer.from(out);
}

/** sha-256 over bytes, as bytes */
export function sha256Bytes(data: Uint8Array | string): Uint8Array {
  return sha256(toBytes(data));
}

/** AES-GCM seal: ciphertext || 16-byte tag, the layout node:crypto callers assembled by hand */
export function aesGcmSeal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  return gcm(key, nonce, aad).encrypt(plaintext);
}

/** AES-GCM open of ciphertext || tag; throws on any failure (wrong key, tampered bytes, wrong aad, truncation) */
export function aesGcmOpen(key: Uint8Array, nonce: Uint8Array, ciphertextWithTag: Uint8Array, aad?: Uint8Array): Uint8Array {
  return gcm(key, nonce, aad).decrypt(ciphertextWithTag);
}

/** HKDF-SHA256 (node's hkdfSync argument order: ikm, salt, info, length) */
export function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array | string, length: number): Uint8Array {
  return hkdf(sha256, ikm, salt, typeof info === "string" ? new TextEncoder().encode(info) : info, length);
}

/** scrypt (node's scryptSync shape: password, salt, keylen, { N, r, p, maxmem }) */
export function scryptSync(
  password: string | Uint8Array,
  salt: Uint8Array,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem?: number }
): Buffer {
  return Buffer.from(nobleScrypt(toBytes(password), salt, { N: opts.N, r: opts.r, p: opts.p, dkLen: keylen, maxmem: opts.maxmem }));
}
