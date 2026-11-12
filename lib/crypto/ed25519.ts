import "server-only";
// Ed25519, thin and boring — a wrapper over @noble/curves (audited; the
// library the pass spec names) that fixes the codecs so the rest of the
// codebase never handles raw bytes ambiguously: keys and signatures are
// lowercase hex strings at every module boundary, bytes only inside.
//
// Noble takes the 32-byte HKDF output directly as the private key seed,
// which is why it is used here instead of node:crypto (whose Ed25519
// wants PKCS8 wrapping around the same bytes — format plumbing with no
// security payoff).
//
// NO novel constructions: sign(message, key) and verify(sig, message,
// pub) over canonical byte strings produced by the callers. Canonical
// form is the CALLER's contract (grants.ts fixed its shape a pass ago);
// this module never invents one.
import { ed25519 } from "@noble/curves/ed25519";

const te = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function fromHex(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) {
    // A malformed key is treated exactly like a wrong key: the caller's
    // verify fails closed. But malformed INPUT to signing is a bug, and
    // bugs throw.
    throw new Error("ed25519: malformed hex");
  }
  return new Uint8Array(Buffer.from(hex, "hex"));
}

/** Public key (32 bytes hex) for a private-key seed. */
export function publicKeyOf(privSeed: Uint8Array): string {
  return toHex(ed25519.getPublicKey(privSeed));
}

/** Sign a canonical string. Returns 64-byte signature as hex. */
export function signCanonical(canonical: string, privSeed: Uint8Array): string {
  return toHex(ed25519.sign(te.encode(canonical), privSeed));
}

/**
 * Verify a signature over a canonical string. NEVER throws — every
 * failure mode (bad hex, wrong length, wrong key, tampered content) is
 * the same answer: false. Fail-closed callers treat false as "this
 * object does not exist".
 */
export function verifyCanonical(signatureHex: string, canonical: string, publicKeyHex: string): boolean {
  try {
    if (!isUsablePublicKey(publicKeyHex)) return false;
    return ed25519.verify(fromHex(signatureHex), te.encode(canonical), fromHex(publicKeyHex));
  } catch {
    return false;
  }
}

/**
 * ATTESTATION PASS Gate 0 — SMALL-ORDER KEYS ARE NOT KEYS. The sweep runner's
 * own regression test handed a verifier an all-zero public key with an
 * all-zero signature and it VERIFIED: 32 zero bytes decode to a point of
 * order 4, and with S = 0 the equation S·B = R + h·A collapses to
 * (1 + h)·P = 0 — true for a quarter of all messages. A usable key is a
 * canonical encoding of a point that is neither small-order nor outside
 * the prime-order subgroup. Same check as validator/crypto.js and
 * scripts/lib/health-probe.mjs; every verifier in the system refuses first.
 */
export function isUsablePublicKey(publicKeyHex: string): boolean {
  try {
    if (!/^[0-9a-f]{64}$/.test(publicKeyHex)) return false;
    const P = (ed25519 as unknown as { Point?: PointCtor; ExtendedPoint?: PointCtor }).Point ?? (ed25519 as unknown as { ExtendedPoint: PointCtor }).ExtendedPoint;
    const p = P.fromHex(publicKeyHex);
    return !p.isSmallOrder() && p.isTorsionFree();
  } catch {
    return false;
  }
}
interface PointCtor {
  fromHex(hex: string): { isSmallOrder(): boolean; isTorsionFree(): boolean };
}
