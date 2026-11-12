import "server-only";
// "Which personas are MINE?" — answered locally, never by asking a server
// for a root grouping.
//
// Two sources, in order:
//   1. the keystore (personas this device derived), and
//   2. the seed's internal grouping, for fixture accounts adopted at
//      migration time.
//
// Neither answer is ever serialized outward: callers get sibling IDS they
// already had the right to know, never a root identifier.
import { ownPersonaIds } from "./keystore";
import { seedSiblingIds } from "@/lib/adapters/mock/persona";

/**
 * Siblings of `personaId` that the LOCAL owner knows about — used for
 * owner-only behaviour like a shared blocklist. This is not a disclosure
 * path: it only ever returns siblings of a persona the caller owns.
 */
export function ownSiblingIds(personaId: string): string[] {
  const owned = new Set(ownPersonaIds());
  if (owned.has(personaId)) {
    return [...owned].filter((id) => id !== personaId);
  }
  // Seeded fixture accounts: the seed's own grouping stands in for a
  // keystore this device never held.
  return seedSiblingIds(personaId);
}

/** Does the local keystore (or seed grouping) consider these the same person? */
export function isOwnSibling(a: string, b: string): boolean {
  return a === b || ownSiblingIds(a).includes(b);
}
