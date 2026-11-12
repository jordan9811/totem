import "server-only";
// ACCOUNT KEYS — the signing space for ACCOUNT-authored objects, distinct
// from the disclosure-persona space in keys.ts.
//
// Why two spaces. The disclosure model's personas (keystore-minted +
// seeded fixtures) sign grants, attribution, annotations — and their key
// resolution is STRICT: an id with no key gets null, so issuing as a
// persona you do not control refuses. But refutation AUTHOR edges are
// asserted by whoever authored the from-cast, and in this app a cast is
// authored by a SESSION/account persona (the validator-universe identity
// from /api/personas) — a real account that, in the shipped system,
// would hold a keystore key, but in the demo has none.
//
// So account objects resolve here: a keystore key if the persona is one
// we minted, otherwise a DETERMINISTIC account key derived from the
// persona id alone (the fixture mechanism). Two consequences that make
// this safe rather than a backdoor:
//
//   1. Resolution is by ID ONLY — no registry, no process state — so a
//      signature verifies identically after a restart, which the stored
//      `verified` boolean can no longer be trusted to carry.
//   2. It NEVER gates authorship. An account key exists for every id, so
//      the signature proves only INTEGRITY (tamper any field and it
//      breaks). WHO may asssert an author edge is gated separately and
//      earlier, by the authorship-equality check in declareEdge
//      (castAuthor === assertedBy). Signature + that check together are
//      what give an author edge standing.
//
// This is deliberately NOT used for grants/attribution/annotations —
// those keep keys.ts's strict resolution, so "issue as a persona with no
// key" still refuses there.
import { fixtureSeed, personaSignSeed } from "@/lib/crypto/kdf";
import { publicKeyOf, signCanonical } from "@/lib/crypto/ed25519";
import { personaPublicKey, signAsPersona } from "@/lib/identity/keystore";

function accountSeed(personaId: string): Uint8Array {
  // same two-step as fixture personas, keyed on the account id — stable
  // across restarts because it derives from the id and nothing else
  return personaSignSeed(fixtureSeed(personaId), personaId);
}

/** Public key for an account persona. Never null — every account id has a
 * deterministic key; keystore-minted personas use their real one. */
export function accountPublicKey(personaId: string): string {
  return personaPublicKey(personaId) ?? publicKeyOf(accountSeed(personaId));
}

/** Sign as an account persona. Never null, for the same reason. */
export function signAsAccount(personaId: string, canonical: string): string {
  return signAsPersona(personaId, canonical) ?? signCanonical(canonical, accountSeed(personaId));
}
