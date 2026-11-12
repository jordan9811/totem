import "server-only";
// PersonaAdapter, migrated onto the v3 substrate.
//
// The seed still groups personas by a `rootId` INTERNALLY — that is how the
// fixture expresses "these are the same person" — but that grouping never
// leaves this module. PersonaSummary has no rootId, so a caller cannot learn
// linkage except through a grant it is authorised to resolve.
import { withMockLatency } from "../mockUtils";
import { AdapterError, type Facet, type PersonaAdapter, type PersonaSummary } from "../types";
import { SEED_PERSONAS, nextId, personaById, rootByFid, state } from "./store";

const toSummary = (p: (typeof SEED_PERSONAS)[number]): PersonaSummary => ({
  id: p.id,
  name: p.name,
  handle: p.handle,
  avatarUrl: p.avatarUrl,
  bio: p.bio,
  cluster: p.cluster,
  kind: "public",
});

/** INTERNAL ONLY. Seed grouping; never returned from an adapter method. */
function seedRootOf(personaId: string): string | null {
  return personaById.get(personaId)?.rootId ?? runtimeRoot.get(personaId) ?? null;
}

/** INTERNAL ONLY. Sibling set as the SEED knows it, before any grant check. */
export function seedSiblingIds(personaId: string): string[] {
  const root = seedRootOf(personaId);
  if (!root) return [];
  const seeded = SEED_PERSONAS.filter((p) => p.rootId === root).map((p) => p.id);
  const runtime = [...runtimeRoot.entries()].filter(([, r]) => r === root).map(([id]) => id);
  return [...new Set([...seeded, ...runtime])].filter((id) => id !== personaId);
}

// Personas created at runtime (mock mode) live alongside seed personas. Their
// root grouping is held here, out of the returned shape.
const runtimePersonas: PersonaSummary[] = [];
const runtimeRoot = new Map<string, string>();

function allPersonas(): PersonaSummary[] {
  return [...SEED_PERSONAS.map(toSummary), ...runtimePersonas];
}

export const mockPersonaAdapter: PersonaAdapter = {
  async listForRoot(rootId) {
    return withMockLatency(() => {
      const seeded = SEED_PERSONAS.filter((p) => p.rootId === rootId).map(toSummary);
      const runtime = runtimePersonas.filter((p) => runtimeRoot.get(p.id) === rootId);
      return [...seeded, ...runtime];
    }, { label: "persona.listForRoot" });
  },

  async listByFid(fid) {
    return withMockLatency(() => {
      const root = rootByFid.get(fid);
      if (!root) return [];
      const seeded = SEED_PERSONAS.filter((p) => p.rootId === root.id).map(toSummary);
      const runtime = runtimePersonas.filter((p) => runtimeRoot.get(p.id) === root.id);
      return [...seeded, ...runtime];
    }, { label: "persona.listByFid" });
  },

  async get(personaId) {
    return withMockLatency(() => {
      const seed = personaById.get(personaId);
      if (seed) return toSummary(seed);
      return runtimePersonas.find((p) => p.id === personaId) ?? null;
    }, { label: "persona.get" });
  },

  async create(input) {
    return withMockLatency(() => {
      if (allPersonas().some((p) => p.handle.toLowerCase() === input.handle.toLowerCase())) {
        throw new AdapterError("handle taken", "FORBIDDEN");
      }
      const persona: PersonaSummary = {
        id: nextId("persona"),
        name: input.name,
        handle: input.handle,
        avatarUrl: input.avatarUrl ?? null,
        bio: input.bio ?? null,
        cluster: input.cluster,
        kind: "public",
      };
      runtimePersonas.push(persona);
      runtimeRoot.set(persona.id, input.rootId);
      return persona;
    }, { label: "persona.create" });
  },

  async listFacets(personaId) {
    return withMockLatency(() => {
      // A person's facets = the distinct clusters their personas post in.
      // Computed from the internal grouping; the facet ids that come out are
      // opaque handles, and following one never reveals the sibling set.
      const root = seedRootOf(personaId);
      if (!root) return [];
      const siblingIds = [personaId, ...seedSiblingIds(personaId)];
      const siblings = siblingIds
        .map((id) => personaById.get(id) ?? runtimePersonas.find((p) => p.id === id))
        .filter(Boolean) as { id: string; cluster?: string }[];
      const clusters = [...new Set(siblings.map((p) => p.cluster).filter(Boolean))] as string[];
      return clusters.map<Facet>((cluster) => ({
        id: `facet_${root}_${cluster}`,
        personaId: siblings.find((p) => p.cluster === cluster)!.id,
        cluster,
      }));
    }, { label: "persona.listFacets" });
  },
};

export function runtimePersonaList() {
  return runtimePersonas;
}

export function allPersonaSummaries() {
  return allPersonas();
}
