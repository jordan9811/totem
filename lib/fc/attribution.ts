import "server-only";
// FC GATE 4 — persona attribution over the real network, v0: ONE shared
// FID, personas attributed client-side from the index recorded at publish
// time ({castHash → personaId}, written by the ONE write door in
// app/api/fc/write). Warpcast and every other client see the bare test
// FID; OUR client resolves the persona — that asymmetry is the design.
//
// Disclosure rules apply to attribution exactly as they apply to private
// posts, through the SAME chokepoint (canViewPrivate): a private-tier
// persona's attribution renders only for granted viewers; everyone else —
// in our client too — sees the bare FID identity.
//
// FAIL CLOSED, every direction: no index row, unknown persona, an
// unverifiable signature, or a THROWING lookup all render the bare FID.
// Attribution never guesses.
//
// The response shape carries persona DISPLAY data only (id, handle, name,
// avatar, tier) — never root material, never grant material. The leak
// greps pin that.
import { personaById, state } from "@/lib/adapters/mock/store";
import { verifyCanonical } from "@/lib/crypto/ed25519";
import { publicKeyForPersona } from "@/lib/identity/keys";
import { isPrivatePersona } from "@/lib/identity/personaKind";
import { canViewPrivate } from "@/lib/private/visibility";
import { resolveIdentity } from "@/lib/identity/resolver";

/** Canonical form the attribution signature covers — fixed HERE and
 * imported by the write route, so producer and verifier cannot drift. */
export function attributionCanonical(castHash: string, personaId: string, at: number): string {
  return ["layers-fc-attribution/1", castHash, personaId, String(at)].join("|");
}

export interface AttributedPersona {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
  tier: number;
  private: boolean;
  /** MULTI-FID Gate 2: true when THIS viewer holds a linkage grant that merges the persona with a sibling */
  merged?: boolean;
  /** the sibling the viewer may see, DISPLAY data only — absent for everyone else */
  linked?: { personaId: string; name: string; handle: string; avatarUrl: string; tier: string } | null;
}

export function attributionFor(
  castHash: string,
  viewerPersonaId: string | null
): AttributedPersona | null {
  try {
    const att = state().fcAttribution.get(castHash);
    if (!att) return null;
    // The row must PROVE the named persona signed it — an unsigned index
    // is a validator-side tamper away from re-attributing casts. No key
    // or a bad signature is the same answer as no row: bare FID.
    const pub = publicKeyForPersona(att.personaId);
    if (!pub) return null;
    if (!verifyCanonical(att.signature, attributionCanonical(castHash, att.personaId, att.at), pub)) return null;
    const p = personaById.get(att.personaId);
    if (!p) return null; // unknown persona: bare FID, never a guess
    const priv = isPrivatePersona(p.id);
    if (priv && !canViewPrivate(p.id, viewerPersonaId)) return null;
    // MULTI-FID Gate 2: the granted-viewer merge — the SAME resolver the profile page uses decides
    // whether this viewer may see the persona linked to a sibling (whitelist / opt-in tiers only)
    let merged = false;
    let linked: AttributedPersona["linked"] = null;
    try {
      const identity = resolveIdentity(p.id, viewerPersonaId);
      if (identity.merged && identity.linked) {
        merged = true;
        linked = { personaId: identity.linked.personaId, name: identity.linked.name, handle: identity.linked.handle, avatarUrl: identity.linked.avatarUrl, tier: identity.linked.tier };
      }
    } catch {
      /* an unresolvable linkage renders the bare persona — never a guess */
    }
    return {
      id: p.id,
      handle: p.handle,
      name: p.name,
      avatarUrl: p.avatarUrl,
      tier: p.tier,
      private: priv,
      merged,
      linked,
    };
  } catch {
    return null; // lookup failure renders the bare FID — fail closed
  }
}

export function attributionsFor(
  castHashes: string[],
  viewerPersonaId: string | null
): Record<string, AttributedPersona | null> {
  const out: Record<string, AttributedPersona | null> = {};
  for (const h of castHashes) out[h] = attributionFor(h, viewerPersonaId);
  return out;
}

/** MULTI-FID Gate 2: the author fields a cast card draws when THIS viewer holds a linkage grant that
 * merges the persona with a sibling — empty for everyone else (bare persona). Our client only. */
export function mergedAuthorFor(personaId: string, viewerPersonaId: string | null): { merged: true; linked: { username: string; displayName: string; pfpUrl: string; tier: string } } | null {
  try {
    const identity = resolveIdentity(personaId, viewerPersonaId);
    if (!identity.merged || !identity.linked) return null;
    return { merged: true, linked: { username: identity.linked.handle, displayName: identity.linked.name, pfpUrl: identity.linked.avatarUrl, tier: identity.linked.tier } };
  } catch {
    return null; // an unresolvable linkage renders the bare persona — never a guess
  }
}
