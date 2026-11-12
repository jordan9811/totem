import "server-only";
import { withMockLatency } from "../mockUtils";
import type { RepAdapter } from "../types";
import { personaById, state } from "./store";
import { resolvableSiblings } from "@/lib/identity/grants";
import { ownSiblingIds } from "@/lib/identity/ownership";
import { allPersonaSummaries as allPersonas } from "./persona";

const TIER_UNLOCKS: Record<number, string[]> = {
  1: ["Post and reply", "Follow accounts"],
  2: ["Post and reply", "Follow accounts"],
  3: ["Author community notes", "Appear in discovery surfaces"],
  4: ["Author community notes", "Appear in discovery surfaces"],
  5: ["Create custom modes", "Send posts to followers' timelines"],
  6: ["Create custom modes", "Send posts to followers' timelines"],
  7: ["Gate channels by rule", "Higher discovery weighting"],
  8: ["Gate channels by rule", "Higher discovery weighting"],
  9: ["Note endorsement carries extra weight", "Top-decile discovery weighting"],
  10: ["Note endorsement carries extra weight", "Top-decile discovery weighting"],
};

// Blocks live in persisted state (store.ts), not a module local, so they
// survive a restart and are cleared by the dev seed reset.
const blocks = () => state().blocks;

// v3: blocks are PAIRWISE (persona -> persona). No root ids are stored,
// because a persisted record keyed by root is root material outside the
// keystore. Fan-out happens at READ time over the siblings the viewer can
// actually resolve through grants.
//
// The semantic this produces is the honest one: YOU CANNOT BLOCK WHAT YOU
// CANNOT SEE. If a linkage is hidden from you, blocking one persona does not
// silently reach the others — you were never told they were the same person.

export const mockRepAdapter: RepAdapter = {
  async tierFor(personaId) {
    return withMockLatency(() => {
      const seed = personaById.get(personaId);
      const base = seed?.tier ?? 1;
      // Attestations bump tier (attestation acceptance test).
      const bonus = state()
        .attestations.filter((a) => a.personaId === personaId)
        .reduce((sum, a) => sum + (a.issuerId === "issuer_human" ? 1 : a.issuerId === "issuer_camera" ? 1 : 2), 0);
      return Math.min(10, base + bonus);
    }, { label: "rep.tierFor" });
  },

  async blockedFor(personaId) {
    return withMockLatency(() => {
      const s = state();
      // A person's own personas share one blocklist. That grouping is local
      // (the keystore knows my own personas); it needs no server-side root.
      const mine = new Set<string>([personaId, ...ownSiblingIds(personaId)]);
      const direct = new Set<string>();
      for (const [blocker, blocked] of s.blocks) {
        if (mine.has(blocker)) for (const b of blocked) direct.add(b);
      }
      // Fan out only over linkages this viewer is authorised to resolve.
      const out = new Set(direct);
      const grants = [...s.grantsV3.values()];
      for (const blocked of direct) {
        for (const sib of resolvableSiblings(grants, s.resolutionRequests, blocked, personaId)) {
          out.add(sib);
        }
      }
      return [...out];
    }, { label: "rep.blockedFor" });
  },

  async block(blockerPersonaId, blockedPersonaId) {
    return withMockLatency(() => {
      if (!blocks().has(blockerPersonaId)) blocks().set(blockerPersonaId, new Set());
      blocks().get(blockerPersonaId)!.add(blockedPersonaId);
    }, { label: "rep.block" });
  },

  async tierExplainer(tier) {
    return withMockLatency(() => ({
      tier,
      percentile: `${Math.max(0, (tier - 1) * 10)}–${tier * 10}th percentile`,
      unlocks: TIER_UNLOCKS[tier] ?? [],
    }), { label: "rep.tierExplainer" });
  },
};

export function resetMockBlocks() {
  blocks().clear();
}
