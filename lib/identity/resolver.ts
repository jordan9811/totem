import "server-only";
// THE one place identity becomes pixels.
//
// Every surface that renders a name, handle or avatar goes through
// resolveIdentity(): timeline cards, search results, notifications, embeds,
// folder cards, highlight reels, room messages, profile headers, ad units.
// Built proactively — the standing lesson from the gated pass is that
// per-surface logic diverges, and a disclosure model dies at whichever
// surface forgot to ask.
//
// FAIL CLOSED. If a grant check errors, the viewer gets the BARE persona.
// Failing closed here means failing toward LESS disclosure, which is the
// only safe direction: a merged render leaks a linkage permanently, while a
// bare render merely under-informs someone who could refresh.
import { resolvableSiblings, resolveLinkage, type GrantTier } from "./grants";
import { verifiedGrants } from "./verifiedGrants";
import { state } from "@/lib/adapters/mock/store";
import { personaById } from "@/lib/adapters/mock/store";
import { isOwnSibling } from "./ownership";

export interface ResolvedIdentity {
  personaId: string;
  /** what to render as the display name */
  displayName: string;
  /** what to render as the handle */
  handle: string;
  avatarUrl: string;
  /** true when the viewer is authorised to see this as a linked identity */
  merged: boolean;
  /** populated only when merged */
  linked?: {
    personaId: string;
    name: string;
    handle: string;
    avatarUrl: string;
    tier: GrantTier;
  };
  /** true when the resolve failed and we fell back to bare — surfaced in dev */
  degraded?: boolean;
}

function bare(personaId: string): ResolvedIdentity {
  const p = personaById.get(personaId);
  return {
    personaId,
    displayName: p?.name ?? "Unknown",
    handle: p?.handle ?? "unknown",
    avatarUrl: p?.avatarUrl ?? "",
    merged: false,
  };
}

/**
 * Resolve how `personaId` should appear to `viewerPersonaId`.
 *
 * Merged rendering is OUR CLIENT ONLY and only for whitelist/opt-in tiers —
 * a public link is shown as a "linked identities" section on the profile
 * rather than as a merged card, because a merged card implies the viewer was
 * given something, and a public link was given to everyone.
 */
export function resolveIdentity(
  personaId: string,
  viewerPersonaId: string | null
): ResolvedIdentity {
  try {
    const s = state();
    // Verified grants only — an unverifiable grant is an ABSENT one, so a
    // forged or tampered linkage can never reach a merged render.
    const grants = verifiedGrants();
    const requests = s.resolutionRequests;

    const siblings = resolvableSiblings(grants, requests, personaId, viewerPersonaId);
    if (siblings.length === 0) return bare(personaId);

    // Own personas never render merged to their owner — you already know.
    const sibling = siblings.find((sid) => !isOwnSibling(personaId, sid)) ?? siblings[0];
    const link = resolveLinkage(grants, requests, personaId, sibling, viewerPersonaId);
    if (!link) return bare(personaId);

    const self = personaById.get(personaId);
    const other = personaById.get(sibling);
    if (!self || !other) return bare(personaId);

    const mergedRender = link.tier === "whitelist" || link.tier === "opt_in";

    return {
      personaId,
      // Combined display name only where the linkage was granted TO YOU.
      displayName: mergedRender ? `${self.name} / ${other.name}` : self.name,
      handle: self.handle,
      avatarUrl: self.avatarUrl,
      merged: mergedRender,
      linked: {
        personaId: other.id,
        name: other.name,
        handle: other.handle,
        avatarUrl: other.avatarUrl,
        tier: link.tier,
      },
    };
  } catch {
    // FAIL CLOSED — bare persona, byte-identical to what a stock client shows.
    return { ...bare(personaId), degraded: true };
  }
}

/** Batch helper so a feed build resolves once per card, not once per field. */
export function resolveMany(
  personaIds: string[],
  viewerPersonaId: string | null
): Map<string, ResolvedIdentity> {
  const out = new Map<string, ResolvedIdentity>();
  for (const id of personaIds) out.set(id, resolveIdentity(id, viewerPersonaId));
  return out;
}
