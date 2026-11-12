import "server-only";
// ZK PASS 1 — THE COHORT CHECK: the anonymity floor and cohort
// continuity, computed by the CLIENT from the member list it can see.
//
// attack-3 F-2: the floor used to be a boolean the validator sent
// (`clearsFloor`) against a floor the validator chose. Now the client
// rebuilds the LeanIMT root over the served leaves (so the list it counts
// is the list the signed root commits to), counts them, and compares to
// ITS OWN ZK_ANON_FLOOR. Nothing off the wire is trusted for this.
//
// attack-3 F-1: a floor is an instantaneous count; an operator that
// rotates a floor-clearing cohort between epochs intersects a persona's
// proofs down to one root without ever failing the floor. The client
// therefore remembers the cohort it last proved into (per mode+tree, on
// the device — lib/zk/localPins.ts) and REFUSES to prove into a cohort
// from which more than ZK_COHORT_MAX_CHURN of that remembered cohort is
// missing. Additions never count as churn (padding is C1, admitted);
// removals do. This slows a rotation to one churn-step per epoch; it does
// not end it — SECURITY-POSTURE.md A-COHORT-ROTATION says how many epochs
// a patient operator still needs and what actually closes it (the
// placement circuit, a later step).
//
// attack-2 finding 8: the floor is a REFUSAL on the prove path, not just a
// label condition — below it the feature stays dark.
import { createHash } from "@/lib/platform/crypto";
import { Group } from "@semaphore-protocol/group";
import { ZK_ANON_FLOOR, ZK_COHORT_MAX_CHURN, type ZkMode } from "./config";
import { cohortFor, setCohort } from "./localPins";

export function rootOfMembers(members: string[]): string {
  const g = new Group(members.map((m) => BigInt(m)));
  const r = g.root;
  return r === undefined || r === null ? "0" : r.toString(10);
}

export function cohortDigest(members: string[]): string {
  return createHash("sha256").update([...members].sort().join(",")).digest("hex");
}

export interface CohortVerdict {
  ok: boolean;
  reason?: string;
  size: number;
  floor: number;
  rootMatches: boolean;
  continuity: {
    firstSight: boolean;
    previousEpoch: number | null;
    previousSize: number | null;
    retained: number | null;
    churn: number | null;
    maxChurn: number;
  };
}

/**
 * Floor + continuity for (mode, tree) at `epoch`, over the served
 * `members` whose LeanIMT root must equal `root` (which the caller has
 * already verified against the signed history). On success the cohort is
 * recorded as the new baseline — only on success, so a refused epoch can
 * never move the baseline.
 */
export function checkCohort(mode: ZkMode, tree: string, epoch: number, root: string, members: string[]): CohortVerdict {
  const size = members.length;
  const prev = cohortFor(mode, tree);
  const continuity: CohortVerdict["continuity"] = {
    firstSight: prev === null,
    previousEpoch: prev?.epoch ?? null,
    previousSize: prev?.size ?? null,
    retained: null,
    churn: null,
    maxChurn: ZK_COHORT_MAX_CHURN,
  };
  const base = { size, floor: ZK_ANON_FLOOR, continuity };
  const rootMatches = rootOfMembers(members) === root;
  if (!rootMatches) return { ok: false, reason: "served member list does not rebuild to the signed root — refusing to count it", rootMatches, ...base };
  if (size < ZK_ANON_FLOOR) return { ok: false, reason: `cohort ${size} is below the client's anonymity floor ${ZK_ANON_FLOOR} — the feature stays dark`, rootMatches, ...base };
  if (prev && prev.epoch !== epoch) {
    const cur = new Set(members);
    const retained = prev.members.filter((m) => cur.has(m)).length;
    const churn = prev.size === 0 ? 0 : 1 - retained / prev.size;
    continuity.retained = retained;
    continuity.churn = churn;
    if (churn > ZK_COHORT_MAX_CHURN) {
      return {
        ok: false,
        reason: `cohort churned ${(churn * 100).toFixed(0)}% since the epoch this client last proved into it (${retained}/${prev.size} retained; limit ${(ZK_COHORT_MAX_CHURN * 100).toFixed(0)}%) — refusing to prove into a rotated cohort`,
        rootMatches,
        ...base,
      };
    }
  }
  if (!prev || prev.epoch !== epoch) {
    setCohort(mode, tree, { epoch, size, digest: cohortDigest(members), members: [...members], recordedAt: Date.now() });
  }
  return { ok: true, rootMatches, ...base };
}
