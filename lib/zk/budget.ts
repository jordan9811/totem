import "server-only";
// ZK PASS 1 — the per-persona PROOF-HISTORY BUDGET (C3 / F2b).
//
// personaId rides every proof's public signal in the clear, so the
// operator can intersect a persona's candidate root-sets across the
// PARTITIONS it proves — tier-3 today ∩ tier-4 after promotion ∩
// holds-attestation-I — collapsing to one named account with no crypto
// broken. The instantaneous anonymity floor does nothing about that.
//
// WHAT IS COUNTED (attack-2 finding 7 / attack-1 finding 4): the
// PARTITIONING predicate — (claimKind, tree, gateId) — not the claim
// kind alone. There is one claim kind in Pass 1, so a kind-only budget
// could never refuse; a persona proving tier-2, tier-5 and tier-9 is
// three partitions and IS refused at the third with the default of 2.
//
// WHAT IS NOT BOUNDED, stated: epochs. The budget is per (persona,
// epoch) because eligibility is per epoch; a persona that proves the same
// partition every epoch hands over one intersection event per epoch.
// SECURITY-POSTURE.md A-COHORT-ROTATION / A-PRESENCE-LOG say what that
// costs. Enforced CLIENT-SIDE (the client is the only party that can
// refuse before a proof exists), recorded ON THE DEVICE (lib/zk/localPins
// — never on the validator, attack-1 finding 1), and a hard refusal.
import { ZK_PROOF_BUDGET, type ZkMode } from "./config";
import { budgetFor, setBudget } from "./localPins";

/** the partition a proof makes visible to the operator.
 *
 * PERSONA LAUNCH P5: an ANON POST's partition does NOT include its tree. The budget bounds what an operator learns by
 * intersecting the partitions one NAMED persona proves; an anon post names no persona — every post of every person
 * carries the constant "anon" — so the trees anon posts prove are not one persona's partitions, and counting them
 * would only refuse real posts: with ZK_PROOF_BUDGET 2, a post boosted as 10k+, a plain one and a launch request in one
 * epoch would hit the device budget at 'budget' (the K slots per window are the anon limit, lib/zk/anon/slots.ts).
 * What every anon post does show is its tree — A-REACH-TREE-ON-EVERY-POST. A launch request (persona-launch) stays its
 * own partition, and every NON-anon claim keeps (claimKind, tree, gateId). */
export function predicateOf(claimKind: string, tree: string, gateId: string): string {
  // PERSONA LAUNCH P8: an X copy is an anon post for this budget — it names no persona (the constant "anon"), proves the
  // plain anon tree only, and its limit is its own K_X slots. It SHARES the anon posts' partition: a distinct one would
  // spend the device budget (ZK_PROOF_BUDGET 2) so that an anon post, its X copy and a launch request in one epoch would
  // refuse the third at 'budget' — refusing real posts while bounding nothing about a named persona.
  if (claimKind === "x-anon-post") return predicateOf("anon-post", tree, "anon-post");
  if (claimKind === "anon-post") return `${claimKind}|*|${gateId}`;
  return `${claimKind}|${tree}|${gateId}`;
}

export function budgetKey(mode: ZkMode, personaId: string, epoch: number): string {
  return `${mode}:${personaId}:${epoch}`;
}

export interface BudgetStatus {
  mode: ZkMode;
  personaId: string;
  epoch: number;
  limit: number;
  used: string[];
  remaining: number;
}

export function budgetStatus(mode: ZkMode, personaId: string, epoch: number): BudgetStatus {
  const used = budgetFor(budgetKey(mode, personaId, epoch));
  return { mode, personaId, epoch, limit: ZK_PROOF_BUDGET, used, remaining: Math.max(0, ZK_PROOF_BUDGET - used.length) };
}

export type BudgetDecision = { ok: true; status: BudgetStatus } | { ok: false; reason: string; status: BudgetStatus };

/**
 * Reserve a partition slot for (mode, persona, epoch). Idempotent for a
 * predicate already counted (re-proving the same partition is not a new
 * intersection). Refuses — hard — when the distinct-partition count is at
 * the limit. Written to the device before returning: a crash between
 * "ok" and the proof must not free the slot.
 */
export function reserveBudget(mode: ZkMode, personaId: string, epoch: number, predicate: string): BudgetDecision {
  const key = budgetKey(mode, personaId, epoch);
  const used = budgetFor(key);
  if (used.includes(predicate)) return { ok: true, status: budgetStatus(mode, personaId, epoch) };
  if (used.length >= ZK_PROOF_BUDGET) {
    return {
      ok: false,
      reason: `proof-history budget exhausted for this epoch (${used.length}/${ZK_PROOF_BUDGET} distinct partitions already proven; a further one would be an intersection event)`,
      status: budgetStatus(mode, personaId, epoch),
    };
  }
  setBudget(key, [...used, predicate]);
  return { ok: true, status: budgetStatus(mode, personaId, epoch) };
}
