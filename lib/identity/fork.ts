import "server-only";
// FORKING — the recovery mechanic, and the reason the whole model is
// survivable rather than merely private.
//
// A leaked linkage cannot be un-leaked. What CAN be done is move: mint a
// fresh persona, carry forward only the grant-holders you still trust, and
// publish a forward pointer that only THEY can resolve. The leaker keeps a
// pointer to a persona that has stopped mattering.
//
// Two properties this file must guarantee:
//   1. Reputation carries. The new persona's tier equals the root's tier
//      immediately — that is the entire point of rep living on the root.
//   2. The forward pointer is itself a grant-gated claim. A dropped holder
//      must not resolve it, through the UI or a forced adapter call.
import { OPEN_AUDIENCE, grantKind, signGrantWith, type Grant } from "./grants";
import { signForPersona } from "./keys";
import { verifiedGrants } from "./verifiedGrants";
import { state } from "@/lib/adapters/mock/store";

/**
 * Forward pointers are audience-scoped like a whitelist grant, but what marks
 * them as a different CLAIM is `kind: "forward"`, not this tier.
 */
export const FORWARD_TIER = "whitelist" as const;

export interface ForkPlan {
  fromPersona: string;
  /** grant holders to carry forward — the leaker is simply absent */
  carry: string[];
  newName: string;
  newHandle: string;
  newAvatarUrl?: string | null;
}

export interface ForkResult {
  oldPersona: string;
  newPersona: string;
  carried: string[];
  dropped: string[];
  forwardGrantIds: string[];
  reissuedGrantIds: string[];
}

/** Everyone currently holding a live grant on this persona's linkage. */
export function currentGrantHolders(personaId: string): { audienceMember: string; grantId: string; tier: string }[] {
  return verifiedGrants()
    .filter(
      (g) =>
        grantKind(g) === "linkage" && // forward pointers are not disclosures
        g.revokedAt === null &&
        (g.fromPersona === personaId || g.toPersona === personaId) &&
        g.audienceMember !== OPEN_AUDIENCE
    )
    .map((g) => ({ audienceMember: g.audienceMember, grantId: g.id, tier: g.tier }));
}

function put(g: Omit<Grant, "id" | "signature">): string {
  // The issuer IS fromPersona: the mover signs its own move, the fork signs
  // its own reissues. No key → REFUSE loudly; an unsigned row is never stored.
  const signed = signGrantWith(g, (c) => signForPersona(g.fromPersona, c));
  if (!signed) throw new Error("fork: cannot sign grant as " + g.fromPersona);
  state().grantsV3.set(signed.id, { ...g, id: signed.id, signature: signed.signature });
  return signed.id;
}

/**
 * Record the forward pointer old→new, resolvable ONLY by carried holders.
 *
 * Stored as ordinary grants with `audienceMember` set to each carried
 * holder. There is deliberately no open-audience row: a forward pointer with
 * an open audience would announce the move to exactly the person you forked
 * away from.
 */
export function issueForwardPointer(
  oldPersona: string,
  newPersona: string,
  carry: string[]
): string[] {
  const ids: string[] = [];
  for (const holder of carry) {
    ids.push(
      put({
        fromPersona: oldPersona,
        toPersona: newPersona,
        audienceMember: holder,
        tier: FORWARD_TIER,
        kind: "forward",
        issuedAt: Date.now(),
        revokedAt: null,
      })
    );
  }
  return ids;
}

/**
 * Can `viewer` learn that `oldPersona` moved to a new persona? Returns the
 * new persona id, or null.
 *
 * FAIL CLOSED by construction: absence of a grant naming the viewer is
 * absence of an answer. A forced adapter call gets the same null a dropped
 * holder's UI does.
 */
export function resolveForwardPointer(
  oldPersona: string,
  viewer: string | null,
  forwardIds: Set<string>
): string | null {
  if (!viewer) return null;
  for (const g of verifiedGrants()) {
    if (grantKind(g) !== "forward") continue;
    if (!forwardIds.has(g.id)) continue;
    if (g.revokedAt !== null) continue;
    if (g.fromPersona !== oldPersona) continue;
    if (g.audienceMember !== viewer) continue;
    return g.toPersona;
  }
  return null;
}

/** Reissue the carried linkage grants under the NEW persona. */
export function reissueGrants(
  oldPersona: string,
  newPersona: string,
  carry: string[]
): string[] {
  const ids: string[] = [];
  // Verified source only: reissuing signs the claim fresh as the NEW persona,
  // so an unverifiable original must never be laundered into a valid grant.
  const originals = verifiedGrants().filter(
    (g) =>
      grantKind(g) === "linkage" &&
      g.revokedAt === null &&
      (g.fromPersona === oldPersona || g.toPersona === oldPersona) &&
      carry.includes(g.audienceMember)
  );
  for (const g of originals) {
    const sibling = g.fromPersona === oldPersona ? g.toPersona : g.fromPersona;
    // Skip the forward pointers themselves — they point at the new persona.
    if (sibling === newPersona) continue;
    ids.push(
      put({
        fromPersona: newPersona,
        toPersona: sibling,
        audienceMember: g.audienceMember,
        tier: g.tier,
        kind: "linkage",
        issuedAt: Date.now(),
        revokedAt: null,
      })
    );
  }
  return ids;
}
