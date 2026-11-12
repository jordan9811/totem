// BROWSER KEYSTORE PASS Gate 2 — the one wrap primitive (notes/reports/REPORT-CUSTODY.md D-CU-2-THE-WRAP-IS-ONE-PRIMITIVE).
//
// Every save method wraps the SAME 32-byte seed under that method's 32-byte KEK: AES-256-GCM from the platform
// layer (stage 1; no new primitive), a random 12-byte nonce, and the method id as associated data so a blob cannot
// be presented under another method. The KEK is HKDF-SHA256 of the method's secret with a per-method info string.
// A wrong KEK fails the tag; nothing half-succeeds.
import { aesGcmOpen, aesGcmSeal, hkdfSha256, randomBytes } from "@/lib/platform/crypto";

export interface WrappedSeed {
  v: 1;
  /** the method id this blob is bound to (also the associated data) */
  method: string;
  nonce: string;
  ct: string;
}

const te = new TextEncoder();
const NONE = new Uint8Array(0);

export function hexToBytes(hex: string): Uint8Array {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) throw new Error("wrap: not hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function bytesToHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const aad = (method: string) => te.encode("layers/custody/v1|" + method);

export function wrapSeed(seedHex: string, kek: Uint8Array, method: string): WrappedSeed {
  if (!/^[0-9a-f]{64}$/.test(seedHex)) throw new Error("wrap: the seed must be 32-byte hex");
  if (kek.length !== 32) throw new Error("wrap: the KEK must be 32 bytes");
  const nonce = new Uint8Array(randomBytes(12));
  const ct = aesGcmSeal(kek, nonce, hexToBytes(seedHex), aad(method));
  return { v: 1, method, nonce: bytesToHex(nonce), ct: bytesToHex(ct) };
}

/** throws on a wrong KEK, a wrong method, or a tampered blob — the GCM tag, never a guess. `expectedMethod` is the
 *  id the caller fetched the blob under: the blob's own field is not trusted to name it (attack-custody-3 #13). */
export function unwrapSeed(blob: WrappedSeed, kek: Uint8Array, expectedMethod: string): string {
  if (!blob || blob.v !== 1 || typeof blob.ct !== "string" || typeof blob.nonce !== "string" || typeof blob.method !== "string")
    throw new Error("unwrap: not a wrapped seed");
  if (blob.method !== expectedMethod) throw new Error("unwrap: this blob is bound to another method");
  if (kek.length !== 32) throw new Error("unwrap: the KEK must be 32 bytes");
  const seed = aesGcmOpen(kek, hexToBytes(blob.nonce), hexToBytes(blob.ct), aad(blob.method));
  if (seed.length !== 32) throw new Error("unwrap: the seed is not 32 bytes");
  return bytesToHex(seed);
}

/** D-CU-0-8: the PRF path — 32 deterministic bytes from the passkey become the KEK */
export function kekFromPrf(prf: Uint8Array): Uint8Array {
  if (prf.length < 32) throw new Error("kek: the PRF output must be at least 32 bytes");
  return hkdfSha256(prf, NONE, "layers/v1/kek-from-prf", 32);
}

/** D-CU-0-9: the provider's export is a KEK source, never the root */
export function kekFromProvider(exported: Uint8Array): Uint8Array {
  if (exported.length < 32) throw new Error("kek: the provider export must be at least 32 bytes");
  return hkdfSha256(exported, NONE, "layers/v1/kek-from-provider", 32);
}

/** D-CU-2-THE-WRAP-PATH-IS-STATELESS-ON-THE-SERVER: the released key is used as-is; it is already 32 random-looking bytes */
export function kekFromRelease(releasedHex: string): Uint8Array {
  const k = hexToBytes(releasedHex);
  if (k.length !== 32) throw new Error("kek: the released key must be 32 bytes");
  return k;
}
