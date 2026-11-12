import "server-only";
// ATTESTATION PASS Gate 3 — ONE FLOOR. The advertiser console's k-anonymity
// floor and the attestation floor are the same invariant: no surface may
// resolve to fewer people than the floor, whether the predicate is a graph
// claim or a proven bucket. The market keeps its dev-sized K_FLOOR for
// the seeded graph-claim population (so the seeded data can trip it); any
// audience that predicates on an ATTESTATION is held to the client's zk
// floor (ZK_ANON_FLOOR) as well — the higher of the two applies, never the
// lower, and the check is computed HERE for the API route, the console and
// the builder alike.
import type { RuleGroup } from "@/lib/adapters/types";
import { ZK_ANON_FLOOR } from "./config";

export function attestationFloor(): number {
  return ZK_ANON_FLOOR;
}

export function audienceHasAttestPredicate(group: RuleGroup | null | undefined): boolean {
  if (!group || !Array.isArray(group.clauses)) return false;
  for (const clause of group.clauses) {
    if ((clause as RuleGroup).combinator !== undefined) {
      if (audienceHasAttestPredicate(clause as RuleGroup)) return true;
    } else if (String((clause as { field?: unknown }).field) === "attest.holds") return true;
  }
  return false;
}

/** the floor an audience must clear: the k-floor, raised to the attestation floor when a proven bucket is in the predicate */
export function audienceFloor(group: RuleGroup | null | undefined, kFloor: number): number {
  return audienceHasAttestPredicate(group) ? Math.max(kFloor, attestationFloor()) : kFloor;
}
