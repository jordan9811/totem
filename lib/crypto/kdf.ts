import "server-only";
// THE DERIVATION TREE. Every key in the system comes off the seed through
// HKDF-SHA256 with a domain-separated info string, so two different uses
// can never yield the same bytes and the whole hierarchy re-derives
// deterministically from the seed alone — which is exactly what makes
// Gate 4 recovery possible: the mnemonic IS the identity.
//
// Audited primitives only: HKDF from @noble/hashes (independently
// audited; already the transitive dependency viem builds on). No salts —
// the seed is uniform 32-byte entropy, HKDF's extract step with an empty
// salt is the standard construction for that case (RFC 5869 §3.1), and a
// fixed salt would add nothing but a second constant to keep stable
// forever.
//
// DISCIPLINE: info strings are versioned constants assembled HERE and
// nowhere else. A caller never concatenates its own info string — that
// is how two features accidentally derive the same key.
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";

const te = new TextEncoder();

/** Domain prefix, versioned. Bump ONLY with a migration plan — changing
 * it silently re-keys every persona and the vault. */
const DOMAIN = "layers/v1/";

function derive(seed: Uint8Array, info: string, length = 32): Uint8Array {
  if (seed.length !== 32) {
    // A short seed is not a weaker seed, it is a DIFFERENT identity that
    // happens to derive successfully. Refuse loudly.
    throw new Error(`kdf: seed must be exactly 32 bytes, got ${seed.length}`);
  }
  return hkdf(sha256, seed, new Uint8Array(0), te.encode(DOMAIN + info), length);
}

/** Ed25519 signing-key seed for one persona. Same (seed, nonce) → same
 * key, forever — re-derivation determinism is a Gate 0 exit criterion. */
export function personaSignSeed(seed: Uint8Array, nonce: string): Uint8Array {
  return derive(seed, "persona-sign/" + nonce);
}

/** The symmetric vault key (AES-256-GCM). One per seed, versioned in the
 * info string so a future re-key has an address to live at. */
export function vaultKey(seed: Uint8Array): Uint8Array {
  return derive(seed, "vault/1");
}

/**
 * The root's DEVICE-AUTH key (Ed25519) — signs device delegations and
 * nothing else. Deliberately its own branch, not a persona key: a
 * persona-signed delegation would publicly bind every persona the
 * device acts for to one signer on the validator, recreating the exact
 * linkage leak the disclosure model exists to prevent. The envelope
 * authenticates THE DEVICE; personas stay unlinkable.
 */
export function deviceAuthSeed(seed: Uint8Array): Uint8Array {
  return derive(seed, "device-auth/1");
}

/**
 * MULTI-FID PASS Gate 1: one persona's FARCASTER SIGNER (Ed25519 — Farcaster
 * signers are Ed25519, so no curve mismatch). Its own branch, separate from
 * the persona identity key, so either can rotate alone; derived from the
 * root, so recovery re-derives every persona's signer from the phrase.
 */
export function fcSignerSeed(seed: Uint8Array, nonce: string): Uint8Array {
  return derive(seed, "fc-signer/" + nonce);
}

/**
 * MULTI-FID PASS Gate 1: one persona's fid CUSTODY key (secp256k1 — the
 * address that owns the fid on the IdRegistry and can add signers through
 * the KeyGateway). Its own branch; recoverable like everything else here.
 * A 32-byte HKDF output is a valid secp256k1 scalar except with negligible
 * probability, where viem refuses loudly.
 */
export function fcCustodySeed(seed: Uint8Array, nonce: string): Uint8Array {
  return derive(seed, "fc-custody/" + nonce);
}

/**
 * PERSONA LAUNCH P6 (D6 / R1): one persona's fid RECOVERY key (secp256k1). A launched persona's account names a
 * recovery address on the IdRegistry; it is this second root-derived key, never a Totem key, so the Totem
 * registrar that paid for the account can never seize it (only the root's holder can recover). Its own branch, so the
 * custody key and the recovery key never coincide; re-derived from the phrase like every other leaf.
 */
export function fcRecoverySeed(seed: Uint8Array, nonce: string): Uint8Array {
  return derive(seed, "fc-recovery/" + nonce);
}

/**
 * PERSONA LAUNCH P4 (rings' diff, applied by launch — the kdf owner): a ring's inbox key material. The inbox IKM and
 * the PSK each have their own versioned branch per ring nonce, so a ring re-keys by a new nonce and two rings never
 * share bytes. Memory only (lib/identity/keystore.ts ringInboxMaterial); a linked device, which holds no seed, has none.
 */
export function ringInboxSeed(seed: Uint8Array, nonce: string): Uint8Array {
  return derive(seed, "ring-inbox/1/" + nonce);
}
export function ringPskSeed(seed: Uint8Array, nonce: string): Uint8Array {
  return derive(seed, "ring-psk/1/" + nonce);
}
/** PERSONA LAUNCH P4 (rings' diff): a ring NOTE key, for the case rings derives note keys from the root instead of
 *  drawing them at random inside the sealed store — its own branch either way, so it can never equal an inbox key */
export function ringNoteKeySeed(seed: Uint8Array, nonce: string): Uint8Array {
  return derive(seed, "ring-note/1/" + nonce);
}

/**
 * ZK PASS 1: the zk-identity MASTER — 32 bytes off its own frozen branch.
 * It is the private key of the root's Semaphore v4 identity: the audited
 * identity package turns it into a BabyJubJub secret scalar and a Poseidon
 * commitment (that derivation happens INSIDE @semaphore-protocol/identity,
 * never here). ONE per root, never per persona — a per-persona commitment
 * would rebuild the persona→root table inside the public tree. HKDF runs
 * exactly once, out of circuit (HKDF is circuit-hostile); anything that
 * must ever re-derive in-circuit derives via Poseidon from this master.
 * Inherits Gate-4 recovery determinism for free: phrase → seed → this
 * branch → the identical commitment, bit for bit.
 */
export function zkIdentitySeed(seed: Uint8Array): Uint8Array {
  return derive(seed, "zk-identity/1");
}

/** ZK PASS 2 Gate 3: the RE-ISSUED zk-identity master. Index 0 is the
 * original branch (bit-identical to zkIdentitySeed); index i ≥ 1 is a
 * fresh branch the device moves to after revoking the previous commitment
 * (revocation via epoch re-issuance). Deterministic from the seed, so a
 * recovered device can re-derive every index it may have used. */
export function zkIdentitySeedAt(seed: Uint8Array, index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index > 1024) throw new Error("kdf: zk identity index must be an integer in [0, 1024]");
  return index === 0 ? zkIdentitySeed(seed) : derive(seed, `zk-identity/1/reissue-${index}`);
}

/** Deterministic FIXTURE seed for a seeded account. The master constant
 * is public by construction — fixture identities are demo furniture, and
 * signing their objects with real keys beats a "legacy unsigned"
 * tolerance path that real forgeries could hide inside. */
const FIXTURE_MASTER = te.encode("layers-fixture-master/v1");
export function fixtureSeed(accountId: string): Uint8Array {
  return hkdf(sha256, FIXTURE_MASTER, new Uint8Array(0), te.encode(DOMAIN + "fixture-root/" + accountId), 32);
}
