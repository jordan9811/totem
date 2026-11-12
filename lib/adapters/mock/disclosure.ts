import { isOwnSibling } from "@/lib/identity/ownership";
import "server-only";
import { withMockLatency } from "../mockUtils";
import {
  AdapterError,
  type DisclosureAdapter,
  type DisclosureGrant,
  type DisclosureLevel,
  type UnlockRequest,
} from "../types";
import { SEED_VIEWER, nextId, personaById, state  } from "./store";
import { allPersonaSummaries as allPersonas } from "./persona";

const DEFAULT_LEVEL: DisclosureLevel = "followers";

function grantFor(personaId: string): DisclosureGrant {
  const s = state();
  if (!s.grants.has(personaId)) {
    s.grants.set(personaId, {
      personaId,
      level: DEFAULT_LEVEL,
      innerCircleViewerIds: [],
      updatedAt: Date.now(),
    });
  }
  return s.grants.get(personaId)!;
}

export const mockDisclosureAdapter: DisclosureAdapter = {
  async getGrant(personaId) {
    return withMockLatency(() => grantFor(personaId), { label: "disclosure.getGrant" });
  },

  async setGrant(personaId, level, innerCircleViewerIds) {
    return withMockLatency(() => {
      const existing = grantFor(personaId);
      const updated: DisclosureGrant = {
        ...existing,
        level,
        innerCircleViewerIds: innerCircleViewerIds ?? existing.innerCircleViewerIds,
        updatedAt: Date.now(),
      };
      state().grants.set(personaId, updated);
      return updated;
    }, { label: "disclosure.setGrant" });
  },

  async canViewLinkage(personaId, viewerPersonaId) {
    return withMockLatency(() => {
      const grant = grantFor(personaId);
      // Own personas always see their own linkage.
      // Own personas always see their own linkage — decided locally, not by
      // comparing root ids (which no longer leave the keystore).
      if (viewerPersonaId && isOwnSibling(personaId, viewerPersonaId)) return true;

      switch (grant.level) {
        case "public":
          return true;
        case "hidden":
          return false;
        case "inner_circle":
          return !!viewerPersonaId && grant.innerCircleViewerIds.includes(viewerPersonaId);
        case "followers":
          // Mock enforcement: the seeded viewer's follow list stands in for
          // "does this viewer follow the target".
          return !!viewerPersonaId && SEED_VIEWER.followingPersonaIds.includes(personaId);
        default:
          return false;
      }
    }, { label: "disclosure.canViewLinkage" });
  },

  async requestUnlock(requesterPersonaId, targetPersonaId) {
    return withMockLatency(() => {
      const req: UnlockRequest = {
        id: nextId("unlock"),
        requesterPersonaId,
        targetPersonaId,
        status: "pending",
        createdAt: Date.now(),
        resolvedAt: null,
      };
      state().unlockRequests.push(req);
      return req;
    }, { label: "disclosure.requestUnlock" });
  },

  async respondToUnlock(requestId, accept) {
    return withMockLatency(() => {
      const req = state().unlockRequests.find((r) => r.id === requestId);
      if (!req) throw new AdapterError("unknown unlock request", "NOT_FOUND");
      req.status = accept ? "accepted" : "declined";
      req.resolvedAt = Date.now();
      if (accept) {
        // Both-or-nothing reveal: each side is added to the other's inner circle.
        const a = grantFor(req.targetPersonaId);
        if (!a.innerCircleViewerIds.includes(req.requesterPersonaId)) {
          a.innerCircleViewerIds.push(req.requesterPersonaId);
        }
        const b = grantFor(req.requesterPersonaId);
        if (!b.innerCircleViewerIds.includes(req.targetPersonaId)) {
          b.innerCircleViewerIds.push(req.targetPersonaId);
        }
      }
      return req;
    }, { label: "disclosure.respondToUnlock" });
  },

  async listUnlockRequests(personaId) {
    return withMockLatency(
      () => state().unlockRequests.filter((r) => r.targetPersonaId === personaId || r.requesterPersonaId === personaId),
      { label: "disclosure.listUnlockRequests" }
    );
  },

  async followFacet(viewerPersonaId, facetId) {
    return withMockLatency(() => {
      const s = state();
      if (!s.followedFacets.has(viewerPersonaId)) s.followedFacets.set(viewerPersonaId, new Set());
      s.followedFacets.get(viewerPersonaId)!.add(facetId);
    }, { label: "disclosure.followFacet" });
  },

  async unfollowFacet(viewerPersonaId, facetId) {
    return withMockLatency(() => {
      state().followedFacets.get(viewerPersonaId)?.delete(facetId);
    }, { label: "disclosure.unfollowFacet" });
  },

  async followedFacets(viewerPersonaId) {
    return withMockLatency(
      () => [...(state().followedFacets.get(viewerPersonaId) ?? [])],
      { label: "disclosure.followedFacets" }
    );
  },
};

/** Seeded counterparties auto-accept unlock requests (spec: "simulate the
 *  counterparty accepting for seeded accounts"). Called by the API route. */
export function autoAcceptIfSeeded(req: UnlockRequest): boolean {
  return personaById.has(req.targetPersonaId);
}
