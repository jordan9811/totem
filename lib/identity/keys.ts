import "server-only";
// THE ONE KEY-RESOLUTION SEAM. "Which public key speaks for this
// persona?" and "sign this as that persona" both answer here, so every
// verifier and every producer share one resolution order and there is
// exactly one place to reason about who can sign as whom:
//
//   1. keystore  — personas THIS root minted (p_*): the real hierarchy.
//   2. fixture   — seed-universe personas: deterministic fixture roots,
//                  scope-guarded to actual seed membership.
//   3. nothing   — null. An unknown persona has no key, so nothing it
//                  "signed" can ever verify. Fail closed by returning
//                  nothing rather than by policy at each caller.
//
// Resolution order is also a SECURITY order: the keystore is consulted
// first so a fixture entry can never shadow a real minted persona.
//
// The validator's key directory (registered public keys) rides on top
// for remote parties — Gate 1 wires it; local resolution never needs it.
import { fcCustodyAddress, fcRecoveryAddress, fcSignerPublicKey, isOwnPersona, personaPublicKey, signAsFcSigner, signAsPersona, signCustodyTypedData, type CustodyTypedData } from "@/lib/identity/keystore";
import { fixtureFcCustodyAddress, fixtureFcSignAs, fixtureFcSignerPublicKey, fixturePublicKey, fixtureSignAs, fixtureSignCustodyTypedData } from "@/lib/identity/fixtureRoots";
import { SEED_VIEWER } from "@/lib/adapters/mock/store";

/** The verifying half. Null = no key exists = nothing verifies. */
export function publicKeyForPersona(personaId: string): string | null {
  return personaPublicKey(personaId) ?? fixturePublicKey(personaId);
}

/** The producing half. Null = we cannot sign as this persona (not ours,
 * not seeded) — callers treat that as a refusal, never as "skip the
 * signature". */
export function signForPersona(personaId: string, canonical: string): string | null {
  return signAsPersona(personaId, canonical) ?? fixtureSignAs(personaId, canonical);
}

// ---------------------------------------------------------------- MULTI-FID PASS Gate 1: the persona's Farcaster keys, same dispatch

/** the persona's Farcaster signer public key — keystore persona, else seeded (fixture root); null = not ours */
export function fcSignerPublicKeyFor(personaId: string): string | null {
  return fcSignerPublicKey(personaId) ?? fixtureFcSignerPublicKey(personaId);
}

/** sign with the persona's Farcaster signer; null = we cannot sign as this persona */
export function signAsFcSignerFor(personaId: string, canonical: string): string | null {
  return signAsFcSigner(personaId, canonical) ?? fixtureFcSignAs(personaId, canonical);
}

/** the persona's fid custody ADDRESS (public material) — keystore persona, else seeded; null = not ours */
export function fcCustodyAddressFor(personaId: string): string | null {
  return fcCustodyAddress(personaId) ?? fixtureFcCustodyAddress(personaId);
}

/**
 * PERSONA LAUNCH P6 (D6): the persona's fid RECOVERY address (public material). KEYSTORE PERSONAS ONLY — no fixture
 * fallback, deliberately: a launched account is only ever made for a persona whose keys come off the root phrase
 * (D-FID-5-LIVE-KEYSTORE-ONLY), and a seeded persona's recovery key would be a public constant anyone could use to take
 * the account. null = not a keystore persona of this device (the launch refuses).
 */
export function fcRecoveryAddressFor(personaId: string): string | null {
  return fcRecoveryAddress(personaId);
}

/** MULTI-FID Gate 2: an EIP-712 signature by the persona's custody key — keystore persona, else seeded; null = not ours */
export async function signCustodyTypedDataFor(personaId: string, typed: CustodyTypedData): Promise<string | null> {
  return (await signCustodyTypedData(personaId, typed)) ?? (await fixtureSignCustodyTypedData(personaId, typed));
}

/** a persona this device may act for: minted into the keystore, or one of the seeded viewer's own */
export function isViewerPersona(personaId: string): boolean {
  return isOwnPersona(personaId) || SEED_VIEWER.personas.includes(personaId);
}

/** MULTI-FID Gate 5 (attack-fid-1 #1, attack-fid-2 #4, attack-fid-3 #1): a persona whose Farcaster keys come off
 * the ROOT PHRASE (keystore-minted). A seeded viewer persona's keys come off the fixture root — a public
 * constant — and may never own a LIVE account: anyone with the repo could compute its custody key
 * (D-FID-5-LIVE-KEYSTORE-ONLY). */
export function isKeystoreRootedPersona(personaId: string): boolean {
  return isOwnPersona(personaId);
}
