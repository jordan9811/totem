import "server-only";
// ONE answer to "is this persona public or private".
//
// There are two persona universes in this app: the keystore (personas this
// device minted) and the seed (fixture personas that predate the substrate).
// canPublishPublicly() reads only the keystore, so wiring it directly into the
// cast route would return false for every seeded persona and block all
// posting. The obvious patch — "if it isn't in the keystore, allow it" — is
// precisely the fail-open: an unknown persona would be granted the right to
// publish, which is the opposite of what an unknown should get.
//
// So: consult both universes explicitly, and keep "unknown" as its own answer
// rather than folding it into either side.
import * as keystore from "./keystore";
import { personaById } from "@/lib/adapters/mock/store";
import { seededPrivatePersonaIds } from "@/lib/private/seed";

export type PersonaKind = "public" | "private" | "unknown";

export function kindOf(personaId: string | null | undefined): PersonaKind {
  if (!personaId) return "unknown";
  try {
    const minted = keystore.getPersona(personaId);
    if (minted) return minted.kind === "private" ? "private" : "public";
  } catch {
    return "unknown"; // a keystore we cannot read tells us nothing
  }
  if (seededPrivatePersonaIds().includes(personaId)) return "private";
  return personaById.has(personaId) ? "public" : "unknown";
}

export function isPrivatePersona(personaId: string | null | undefined): boolean {
  return kindOf(personaId) === "private";
}

/**
 * May this persona publish to the public cast path?
 *
 * Only a persona we positively know to be public. Private personas and
 * unknown personas are both refused — an unknown is refused because we cannot
 * establish that it is public, which is the fail-closed reading.
 */
export function mayPublishPublicly(personaId: string | null | undefined): boolean {
  return kindOf(personaId) === "public";
}
