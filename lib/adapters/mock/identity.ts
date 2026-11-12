import "server-only";
// IdentityAdapter — the disclosure substrate behind an adapter seam.
//
// Two hard rules enforced here rather than in the UI:
//   1. NOTHING returned from this adapter contains root material. Persona
//      summaries carry no rootId; the caller cannot group personas by root
//      except through grants it is authorised to resolve.
//   2. Private personas never reach the public cast path — enforced in
//      canPublishPublicly(), which the cast route must consult.
import { withMockLatency } from "../mockUtils";
import { AdapterError } from "../types";
import type { IdentityAdapter, PersonaSummary } from "../types";
import {
  OPEN_AUDIENCE,
  resignGrant,
  resolvableSiblings,
  resolveLinkage,
  signGrantWith,
  type Grant,
  type GrantTier,
  type ResolutionRequest,
} from "@/lib/identity/grants";
import { signForPersona } from "@/lib/identity/keys";
import * as keystore from "@/lib/identity/keystore";
import { verifiedGrants } from "@/lib/identity/verifiedGrants";
import { nextId, state } from "./store";

function toSummary(p: keystore.KeystorePersona): PersonaSummary {
  // NOTE the absence of rootId. That omission is the feature.
  return {
    id: p.id,
    name: p.name,
    handle: p.handle,
    avatarUrl: p.avatarUrl,
    bio: p.bio,
    cluster: p.cluster ?? undefined,
    kind: p.kind,
  };
}

// Decisions read the VERIFIED set only — an unverifiable grant is absent.
function grants(): Grant[] {
  return verifiedGrants();
}

function requests(): ResolutionRequest[] {
  return state().resolutionRequests;
}

export const mockIdentityAdapter: IdentityAdapter = {
  async listOwnPersonas() {
    return withMockLatency(() => keystore.listPersonas().map(toSummary), {
      label: "identity.listOwnPersonas",
    });
  },

  async getPersona(personaId) {
    return withMockLatency(() => {
      const p = keystore.getPersona(personaId);
      return p ? toSummary(p) : null;
    }, { label: "identity.getPersona" });
  },

  async createPersona(input) {
    return withMockLatency(() => {
      const created = keystore.createPersona({
        name: input.name,
        handle: input.handle,
        kind: input.kind ?? "public",
        avatarUrl: input.avatarUrl ?? null,
        bio: input.bio ?? null,
        cluster: input.cluster ?? null,
        forkedFrom: input.forkedFrom ?? null,
      });
      return toSummary(created);
    }, { label: "identity.createPersona" });
  },

  // THE containment check for private personas. The cast write path calls
  // this; a UI that merely hides the button is not containment.
  async canPublishPublicly(personaId) {
    return withMockLatency(() => {
      const p = keystore.getPersona(personaId);
      if (!p) return false; // unknown persona cannot publish — fail closed
      return p.kind === "public";
    }, { label: "identity.canPublishPublicly" });
  },

  async visiblePrivatePosts(viewer) {
    return withMockLatency(
      async () => {
        const { visiblePrivatePosts } = await import("@/lib/private/visibility");
        return visiblePrivatePosts(viewer);
      },
      { label: "identity.privatePosts" }
    );
  },

  async audienceFor(personaId) {
    return withMockLatency(
      async () => {
        const { audienceOf } = await import("@/lib/private/visibility");
        return audienceOf(personaId);
      },
      { label: "identity.audienceFor" }
    );
  },

  // ---------- grants ----------

  async issueGrant(input) {
    return withMockLatency(() => {
      const base = {
        fromPersona: input.fromPersona,
        toPersona: input.toPersona,
        audienceMember: input.audienceMember ?? OPEN_AUDIENCE,
        tier: input.tier,
        issuedAt: Date.now(),
        revokedAt: null,
      };
      // The issuer IS fromPersona; no key for it means no grant, ever.
      const signed = signGrantWith(base, (c) => signForPersona(base.fromPersona, c));
      if (!signed) throw new AdapterError("cannot sign as this persona", "FORBIDDEN");
      const grant: Grant = { ...base, id: signed.id, signature: signed.signature };
      state().grantsV3.set(grant.id, grant);
      return grant;
    }, { label: "identity.issueGrant" });
  },

  async revokeGrant(grantId) {
    return withMockLatency(() => {
      const s = state();
      const g = s.grantsV3.get(grantId);
      if (!g) throw new AdapterError("unknown grant", "NOT_FOUND");
      // Revoke is a tombstone, not a delete: history stays, resolution stops.
      // The revoked state is itself a signed claim — re-sign, same id.
      const revoked = resignGrant(
        { ...g, revokedAt: Date.now() },
        (c) => signForPersona(g.fromPersona, c)
      );
      if (!revoked) throw new AdapterError("cannot sign as this persona", "FORBIDDEN");
      s.grantsV3.set(grantId, revoked);
      return revoked;
    }, { label: "identity.revokeGrant" });
  },

  async listGrantsFor(personaId) {
    return withMockLatency(
      () => grants().filter((g) => g.fromPersona === personaId || g.toPersona === personaId),
      { label: "identity.listGrantsFor" }
    );
  },

  // The resolution predicate the real track must prove in a circuit.
  async resolveLinkage(from, to, viewer) {
    return withMockLatency(
      () => resolveLinkage(grants(), requests(), from, to, viewer),
      { label: "identity.resolveLinkage" }
    );
  },

  async resolvableSiblings(personaId, viewer) {
    return withMockLatency(
      () => resolvableSiblings(grants(), requests(), personaId, viewer),
      { label: "identity.resolvableSiblings" }
    );
  },

  // ---------- opt-in resolution requests ----------

  async requestResolution(from, to, requesterPersona) {
    return withMockLatency(() => {
      const s = state();
      const existing = s.resolutionRequests.find(
        (r) =>
          r.requesterPersona === requesterPersona &&
          ((r.fromPersona === from && r.toPersona === to) ||
            (r.fromPersona === to && r.toPersona === from))
      );
      if (existing) return existing;
      // An opt-in link resolves on request — and the asking is recorded,
      // visibly, to the owner. That record is the price of the reveal.
      const req: ResolutionRequest = {
        id: nextId("req"),
        fromPersona: from,
        toPersona: to,
        requesterPersona,
        requestedAt: Date.now(),
        resolved: true,
      };
      s.resolutionRequests.push(req);
      return req;
    }, { label: "identity.requestResolution" });
  },

  async whoAsked(personaId) {
    return withMockLatency(
      () =>
        requests().filter((r) => r.fromPersona === personaId || r.toPersona === personaId),
      { label: "identity.whoAsked" }
    );
  },
};

/** Tier helper for seeding and for the grant-management screen. */
export function tierOfPair(from: string, to: string): GrantTier | "hidden" {
  const live = grants().filter(
    (g) =>
      g.revokedAt === null &&
      ((g.fromPersona === from && g.toPersona === to) ||
        (g.fromPersona === to && g.toPersona === from))
  );
  if (live.length === 0) return "hidden";
  if (live.some((g) => g.tier === "public")) return "public";
  if (live.some((g) => g.tier === "whitelist")) return "whitelist";
  return "opt_in";
}
