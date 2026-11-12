import "server-only";
// Validator-backed adapters: thin wrappers over lib/validator.ts (the
// phase-1 HTTP client for the Express+SQLite service on the pinned validator port, lib/ports.ts). Only
// Persona and Rep have real implementations — the validator does not know
// about modes, rules, disclosure grants, or feed health (ARCHITECTURE.md).
import {
  blockPersona,
  blockedFor,
  createPersona,
  getPersona,
  personasByFid,
  personasForRoot,
  tierFor,
} from "@/lib/validator";
import type { Facet, PersonaAdapter, PersonaSummary, RepAdapter } from "../types";
import { AdapterError } from "../types";

const toSummary = (p: {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
}): PersonaSummary => ({
  id: p.id,
    // rootId deliberately omitted: root material never leaves the keystore
  name: p.name,
  handle: p.handle,
  avatarUrl: p.avatarUrl,
  bio: p.bio,
});

export const validatorPersonaAdapter: PersonaAdapter = {
  async listForRoot(rootId) {
    return (await personasForRoot(rootId)).map(toSummary);
  },
  async listByFid(fid) {
    return (await personasByFid(fid)).map(toSummary);
  },
  async get(personaId) {
    const p = await getPersona(personaId);
    return p ? toSummary(p) : null;
  },
  async create(input) {
    // ZK PASS 2 Gate 2: the validator is told a persona exists — never
    // which root made it (a rootId in the body is refused there, 400).
    // The grouping is recorded on the DEVICE (the vault roster).
    const p = await createPersona({ name: input.name, handle: input.handle, avatarUrl: input.avatarUrl, bio: input.bio });
    if (!p) throw new AdapterError("validator persona creation failed", "FAILED");
    const { recordPersona } = await import("@/lib/identity/rootRoster");
    await recordPersona(input.rootId, p.id, { id: p.id, name: p.name, handle: p.handle, avatarUrl: p.avatarUrl, bio: p.bio, createdAt: p.createdAt });
    return toSummary(p);
  },
  async listFacets(personaId): Promise<Facet[]> {
    // The validator has no facet concept — facets are a client-side view
    // over a root's personas. Derive from the root's persona list.
    // v3: an outward Persona has no rootId, so facets are derived per
    // persona rather than by dereferencing a root. A facet id is an opaque
    // handle; following one never reveals a sibling set.
    const persona = await getPersona(personaId);
    if (!persona) return [];
    const siblings = [persona];
    return siblings.map((p) => ({
      id: `facet_${p.id}_${p.handle}`,
      personaId: p.id,
      cluster: p.handle,
    }));
  },
};

export const validatorRepAdapter: RepAdapter = {
  async tierFor(personaId) {
    // ZK PASS 2 Gate 2: tier by ROOT handle, for a persona THIS device can
    // attribute to one of its roots; any other persona has no answer here
    // (the validator no longer holds persona → root, migration 006).
    const tier = await tierFor(personaId);
    if (tier === null) throw new AdapterError("tier unknown: this device holds no root for the persona and the validator does not hold persona → root (migration 006)", "FAILED");
    return tier;
  },
  async blockedFor(personaId) {
    return blockedFor(personaId);
  },
  async block(blockerPersonaId, blockedPersonaId) {
    const ok = await blockPersona(blockerPersonaId, blockedPersonaId);
    if (!ok) throw new AdapterError("validator block failed", "FAILED");
  },
  async tierExplainer(tier) {
    // Percentile semantics come from the validator's documented model
    // (validator/API.md): tier = ceil(percentile * 10).
    return {
      tier,
      percentile: `${Math.max(0, (tier - 1) * 10)}–${tier * 10}th percentile`,
      unlocks:
        tier >= 9
          ? ["Note endorsement carries extra weight", "Top-decile discovery weighting"]
          : tier >= 7
            ? ["Gate channels by rule", "Higher discovery weighting"]
            : tier >= 5
              ? ["Create custom modes", "Send posts to followers' timelines"]
              : tier >= 3
                ? ["Author community notes", "Appear in discovery surfaces"]
                : ["Post and reply", "Follow accounts"],
    };
  },
};
