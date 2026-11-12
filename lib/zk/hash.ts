// ZK PASS 1 — field-element encodings, byte-compatible with Semaphore v4.
//
// Two distinct hashes live here and they must not be confused:
//
//   semaphoreHash(x)  — THE circuit-input hash. @semaphore-protocol/proof
//                       feeds `hash(message)` and `hash(scope)` to the
//                       circuit, where hash(x) = keccak256(toBeHex(x, 32))
//                       >> 8n (packages/proof/src/hash.ts, pinned 4.14.3).
//                       This is a DELIBERATE DUPLICATE of that function so
//                       the nullifier can be recomputed and the public
//                       signals canonicalised without importing the prover;
//                       the live suite cross-checks it against a real proof.
//
//   fieldOf(domain, canonical) — OUR encoding of an application string as a
//                       field element. Semaphore's toBigInt() treats a
//                       non-numeric string as bytes32 (max 31 chars, throws
//                       above that), which is useless for scope strings of
//                       the form "layers/zk-scope/v1|feature|epoch|persona".
//                       So application values are hashed HERE to a 248-bit
//                       integer first and handed to the prover as a bigint;
//                       the prover then applies semaphoreHash() on top, as
//                       it does to every input. Domain-separated so a scope
//                       and a message with equal text never collide.
//
// Audited primitives only: keccak-256 and SHA-256 from @noble/hashes. No
// modular tricks: 248 bits < the BN254 scalar field (~2^254), so every
// output is a canonical field element by construction.
//
// (BigInt literals are avoided on purpose: the project targets es2017 and
// the pass does not touch project-wide compiler settings.)
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha2";

const te = new TextEncoder();
const B0 = BigInt(0);
const B1 = BigInt(1);
const B8 = BigInt(8);
const B255 = BigInt(255);
const B256 = BigInt(256);

/** BN254 scalar field modulus (the snark scalar field Semaphore lives in). */
export const SNARK_SCALAR_FIELD = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

/** 32-byte big-endian encoding (ethers' toBeHex(x, 32), as bytes). */
export function toBeBytes32(x: bigint): Uint8Array {
  if (x < B0 || x >= B1 << B256) throw new Error("toBeBytes32: value out of range");
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & B255);
    v >>= B8;
  }
  return out;
}

export function bytesToBigInt(b: Uint8Array): bigint {
  let v = B0;
  for (const byte of b) v = (v << B8) | BigInt(byte);
  return v;
}

/**
 * Semaphore's circuit-input hash, duplicated byte-for-byte:
 *   BigInt(keccak256(toBeHex(x, 32))) >> 8n
 */
export function semaphoreHash(x: bigint): bigint {
  return bytesToBigInt(keccak_256(toBeBytes32(x))) >> B8;
}

/**
 * Application string → 248-bit field element. Domain-separated and
 * versioned; the ONLY way a scope string or a message canonical becomes a
 * circuit-facing value. Changing this string re-keys every nullifier.
 */
export function fieldOf(domain: "scope" | "message" | "challenge", canonical: string): bigint {
  return bytesToBigInt(sha256(te.encode(`layers-zk-field/1|${domain}|${canonical}`))) >> B8;
}

/** Decimal string form used on the wire (Semaphore's NumericString). */
export function fieldToString(x: bigint): string {
  return x.toString(10);
}

/**
 * Parse a wire field element STRICTLY: the CANONICAL decimal encoding only
 * ("0" or no leading zero, ≤ 77 digits) and in range. attack-2 finding 3:
 * a verifier that accepts "0"+N as a field element and a replay store
 * that keys on the string sees two nullifiers where there is one value.
 * Canonical-only parsing makes the string and the value one-to-one.
 */
const CANONICAL_DECIMAL = /^(0|[1-9][0-9]{0,76})$/;
export function isCanonicalField(s: unknown): s is string {
  return typeof s === "string" && CANONICAL_DECIMAL.test(s) && BigInt(s) < SNARK_SCALAR_FIELD;
}
export function parseField(s: unknown): bigint | null {
  return isCanonicalField(s) ? BigInt(s) : null;
}
