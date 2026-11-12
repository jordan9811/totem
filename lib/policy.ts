// Client policy over validator data (see validator/API.md "Client policy").
// Discovery surfaces drop tier-1 personas; Following is unfiltered; all
// surfaces drop blocked roots' personas. Tiers and block lists come from the
// validator — nothing here computes rep.
import "server-only";
import { ownSiblingIds } from "./identity/ownership";
import type { Cast, Persona } from "./types";
import { blockedFor, getPersona, personasByFid } from "./validator";
import { legacyValidatorTier, personaTier } from "./rep/personaTier";

async function personaFor(cast: Cast): Promise<Persona | null> {
  // ZK PASS 2 Gate 2: the persona chosen at cast time rides as a marker and
  // is resolved BY ID (the validator knows personas, not their accounts).
  // Without a marker only the DEVICE's own accounts resolve by fid (the
  // roster) — nobody asks a server which personas a fid has any more.
  const m = cast.text.match(/layers:persona:(\S+)/);
  if (m) {
    // MULTI-FID Gate 2: a persona this client MINTED (a fork) lives in the client's own registry and
    // nowhere on the validator (which learns commitments, never the old↔new relation) — resolve it
    // here first; a seeded id the client does not hold still comes from the validator by id.
    const { personaById, BOOT } = await import("./adapters/mock/store");
    const local = personaById.get(m[1]);
    // the route-handler shape carries NO rootId (architecture-v3, scripts/root-leak.mjs)
    if (local) return { id: local.id, name: local.name, handle: local.handle, avatarUrl: local.avatarUrl ?? null, bio: local.bio ?? null, createdAt: BOOT };
    const p = await getPersona(m[1]);
    if (p) return p;
  }
  const personas = await personasByFid(cast.author.fid);
  return personas[0] ?? null;
}

/** Attach persona identity + tier badges to casts (renders persona, not root). */
export async function attachPersonaLayer(casts: Cast[]): Promise<Cast[]> {
  // FC Gate 4: the shared-FID attribution index outranks the phase-1
  // marker heuristics — it is a publish-time fact, disclosure-gated and
  // fail-closed (null → fall through to the existing resolution, which
  // for an unattributed live cast means the bare FID identity).
  const { attributionFor, mergedAuthorFor } = await import("./fc/attribution");
  const { activeSeedPersonaId } = await import("./activePersona");
  const viewer = activeSeedPersonaId();
  return Promise.all(
    casts.map(async (cast) => {
      const att = attributionFor(cast.hash, viewer);
      if (att) {
        return {
          ...cast,
          personaId: att.id,
          tier: att.tier,
          author: {
            ...cast.author,
            username: att.handle,
            displayName: att.name,
            pfpUrl: att.avatarUrl || cast.author.pfpUrl,
            // MULTI-FID Gate 2: the granted viewer's merge, bare persona for everyone else
            ...(mergedAuthorFor(att.id, viewer) ?? {}),
          },
        };
      }
      // LIVE-WIRE casts: an unattributed live cast is a real Farcaster
      // account. The phase-1 fid heuristic (personasByFid) matches small
      // integer fids that REAL accounts also use — running it would
      // re-skin a stranger's cast as a fixture persona (fid collision).
      // Gated PER CAST on the mapper's provenance tag, not on config:
      // fixture-fallback casts served under live config still need the
      // heuristic (it is the only marker-strip + persona-badge site).
      if (cast.live) {
        // PERSONA LAUNCH P4 (DROP §4e): a live cast by an account a RING shared with this device (main, a launched or
        // fid-pass persona) — the root-left / persona-right merge, from memory only (lib/rings/merge.ts: no fetch, no
        // decrypt; compartment mode and an unknown drop read both answer null). Everyone else: the bare account.
        const { mergedAuthorForFid } = await import("./rings/merge");
        const ring = cast.author && cast.author.fid > 0 ? mergedAuthorForFid(cast.author.fid) : null;
        return ring ? { ...cast, author: { ...cast.author, ...ring } } : cast;
      }
      const persona = await personaFor(cast);
      if (!persona) return cast;
      // ZK PASS 2 Gate 1: PROOF under zk; the validator read otherwise
      const tier = await personaTier(persona.id, () => legacyValidatorTier(persona.id));
      return {
        ...cast,
        personaId: persona.id,
        tier,
        text: cast.text.replace(/\s*layers:persona:\S+/, ""),
        author: {
          ...cast.author,
          username: persona.handle,
          displayName: persona.name,
          pfpUrl: persona.avatarUrl || cast.author.pfpUrl,
          // MULTI-FID Gate 2: the granted viewer's merge on a local persona cast too
          ...(mergedAuthorFor(persona.id, viewer) ?? {}),
        },
      };
    })
  );
}

export async function applyFeedPolicy(
  casts: Cast[],
  opts: { surface: "discovery" | "following"; viewer: Persona | null; /** the session's own personas (device roster) — their block lists are shared at read time */ own?: string[] }
): Promise<Cast[]> {
  const withLayer = await attachPersonaLayer(casts);
  // You always see your OWN personas, whatever their tier. Answered from
  // the local keystore — no root dereference, no server round-trip.
  const ownPersonas = new Set(
    opts.viewer ? [opts.viewer.id, ...ownSiblingIds(opts.viewer.id), ...(opts.own ?? [])] : []
  );
  // ZK PASS 2 Gate 2: blocks are shared across the device's OWN personas
  // at READ time — one validator row per block action, never a fan-out
  // write that would seat siblings side by side in operator-visible rows.
  const lists = opts.viewer ? await Promise.all([...ownPersonas].map((id) => blockedFor(id))) : [];
  const blocked = new Set(lists.flat());
  return withLayer.filter((c) => {
    if (c.personaId && blocked.has(c.personaId)) return false;
    if (
      opts.surface === "discovery" &&
      c.tier === 1 &&
      !(c.personaId && ownPersonas.has(c.personaId))
    )
      return false;
    return true;
  });
}
