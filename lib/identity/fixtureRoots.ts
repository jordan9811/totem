import "server-only";
// FIXTURE ROOTS — real keys for the seeded world.
//
// Seeded personas belong to fixture "other people" who have no keystore.
// Fail-closed verification (Gate 1) would erase their entire disclosure
// world unless their objects carry REAL signatures — and the alternative,
// a "legacy unsigned" tolerance path, is precisely the hole a forger
// would walk through. So every seed-universe persona gets a
// deterministic seed derived off a public master constant
// (lib/crypto/kdf.ts fixtureSeed), and hydration signs their objects
// with real Ed25519 keys.
//
// These keys are public-by-construction: anyone reading the repo can
// derive them. That is FINE — fixture identities are demo furniture,
// and the security claim they support is "verification is real and
// tampering is detected", not "fixture personas are unimpersonatable".
// The report says this plainly. What matters: the verify path is ONE
// code path for fixture and real personas alike, so nothing about
// verification is demo-only.
//
// SCOPE GUARD: a fixture key is only ever minted for a persona the seed
// actually contains (personaById membership). Deriving fixture keys for
// arbitrary ids would let anyone "sign as" a future real persona by
// asking the fixture path — the gate below is what makes fixture keys
// harmless.
import { fcCustodySeed, fcSignerSeed, fixtureSeed, personaSignSeed } from "@/lib/crypto/kdf";
import { publicKeyOf, signCanonical, toHex } from "@/lib/crypto/ed25519";
import { privateKeyToAccount } from "viem/accounts";
import { personaById } from "@/lib/adapters/mock/store";

function fixtureKeyFor(personaId: string): Uint8Array | null {
  if (!personaById.has(personaId)) return null; // the scope guard
  // Two-step: a per-account fixture seed, then the SAME persona-sign
  // derivation real roots use (nonce = the persona id itself for
  // fixtures). One derivation discipline everywhere.
  return personaSignSeed(fixtureSeed(personaId), personaId);
}

export function fixturePublicKey(personaId: string): string | null {
  const k = fixtureKeyFor(personaId);
  return k ? publicKeyOf(k) : null;
}

export function fixtureSignAs(personaId: string, canonical: string): string | null {
  const k = fixtureKeyFor(personaId);
  return k ? signCanonical(canonical, k) : null;
}

/** MULTI-FID PASS Gate 1: a seeded persona's Farcaster SIGNER — the same fc-signer/<nonce> branch
 * real roots use, off the persona's fixture root (demo furniture: public by construction) */
export function fixtureFcSignerPublicKey(personaId: string): string | null {
  if (!personaById.has(personaId)) return null;
  return publicKeyOf(fcSignerSeed(fixtureSeed(personaId), personaId));
}

export function fixtureFcSignAs(personaId: string, canonical: string): string | null {
  if (!personaById.has(personaId)) return null;
  return signCanonical(canonical, fcSignerSeed(fixtureSeed(personaId), personaId));
}

/** MULTI-FID PASS Gate 2: a typed-data signature by a seeded persona's custody key (fixture root) */
export async function fixtureSignCustodyTypedData(personaId: string, typed: { domain: Record<string, unknown>; types: Record<string, readonly { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> }): Promise<string | null> {
  if (!personaById.has(personaId)) return null;
  const account = privateKeyToAccount(("0x" + toHex(fcCustodySeed(fixtureSeed(personaId), personaId))) as `0x${string}`);
  return account.signTypedData(typed as unknown as Parameters<typeof account.signTypedData>[0]);
}

/** MULTI-FID PASS Gate 1: a seeded persona's fid CUSTODY address (fc-custody/<nonce> off the fixture root) */
export function fixtureFcCustodyAddress(personaId: string): string | null {
  if (!personaById.has(personaId)) return null;
  const priv = fcCustodySeed(fixtureSeed(personaId), personaId);
  return privateKeyToAccount(("0x" + toHex(priv)) as `0x${string}`).address;
}
