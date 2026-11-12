import "server-only";
// ZK PASS 1 Gate 3 — IN-PROCESS SELF-TESTS the privacy label computes at
// read time. They replace the build "stamps" a suite used to write
// through an unauthenticated route (attack-2 finding 4 / attack-3 F-6):
// a stamp was a caller's claim that a check had run; these ARE the check,
// run by the process whose label is being computed, on its own secret,
// every time the label is read. What each one evidences — and does not —
// is written into its detail string and into SECURITY-POSTURE.md.
import { randomBytes } from "@/lib/platform/crypto";
import { Identity } from "@semaphore-protocol/identity";
import { ZK_PROOF_BUDGET } from "./config";
import { fieldOf } from "./hash";
import { zkSecretScalarForProver } from "./identity";
import { nullifierFor } from "./nullifier";
import { SCOPE_REGISTRY, scopeString } from "./scopes";
import { predicateOf, reserveBudget } from "./budget";

export interface SelfTest {
  ok: boolean;
  detail: string;
}

/**
 * SCOPE COLLISION, on the REAL secret: for every registered per-persona
 * scope, two personas of this root emit different nullifiers, epochs
 * separate them, another root's secret differs at the same scope, and
 * misuse of the registry fails closed in both directions.
 */
export function scopeCollisionSelfTest(): SelfTest {
  const problems: string[] = [];
  if (!Object.isFrozen(SCOPE_REGISTRY)) problems.push("scope registry is not frozen");
  const secret = zkSecretScalarForProver();
  const other = new Identity(randomBytes(32)).secretScalar;
  const A = "zk_selftest_persona_a";
  const B = "zk_selftest_persona_b";
  let perPersona = 0;
  for (const e of SCOPE_REGISTRY) {
    if (e.onePerHuman) {
      // reserved semantics: siblings collide BY DESIGN; assert it is stable and disclosed
      try {
        const a = nullifierFor(fieldOf("scope", scopeString(e.id, 0)), secret);
        const b = nullifierFor(fieldOf("scope", scopeString(e.id, 0)), secret);
        if (a !== b) problems.push(`${e.id}: onePerHuman scope is not stable`);
        if (!/DISCLOSED|disclosed/.test(e.linkage)) problems.push(`${e.id}: onePerHuman entry does not disclose the sibling link`);
      } catch (err) {
        problems.push(`${e.id}: ${(err as Error).message}`);
      }
      continue;
    }
    perPersona++;
    try {
      const a = nullifierFor(fieldOf("scope", scopeString(e.id, 0, A)), secret);
      const b = nullifierFor(fieldOf("scope", scopeString(e.id, 0, B)), secret);
      const a1 = nullifierFor(fieldOf("scope", scopeString(e.id, 1, A)), secret);
      const o = nullifierFor(fieldOf("scope", scopeString(e.id, 0, A)), other);
      if (a === b) problems.push(`${e.id}: TWO PERSONAS OF ONE ROOT SHARE A NULLIFIER`);
      if (a === a1) problems.push(`${e.id}: epochs do not separate nullifiers`);
      if (a === o) problems.push(`${e.id}: two roots collided at one scope`);
    } catch (err) {
      problems.push(`${e.id}: ${(err as Error).message}`);
    }
    // misuse fails closed: a per-persona entry without a persona
    let threw = false;
    try {
      scopeString(e.id, 0);
    } catch {
      threw = true;
    }
    if (!threw) problems.push(`${e.id}: a per-persona scope without a personaId did not fail closed`);
  }
  for (const e of SCOPE_REGISTRY) {
    if (!e.onePerHuman) continue;
    let threw = false;
    try {
      scopeString(e.id, 0, A);
    } catch {
      threw = true;
    }
    if (!threw) problems.push(`${e.id}: a onePerHuman scope WITH a personaId did not fail closed`);
  }
  if (perPersona === 0) problems.push("no per-persona scope entry registered");
  return problems.length
    ? { ok: false, detail: problems.join("; ") }
    : { ok: true, detail: `${SCOPE_REGISTRY.length} registry entries: sibling nullifiers differ, epochs separate, roots differ, misuse fails closed (computed now, on this root's secret)` };
}

/**
 * THE BUDGET REFUSES: on a synthetic persona at epoch −1, reserve
 * ZK_PROOF_BUDGET distinct REAL partitions (the tier trees the gate could
 * prove against) and require the next one to be refused. Evidence that
 * the counter refuses on a path the product can reach (attack-2 finding
 * 7) — not evidence about any real persona's usage.
 */
export function budgetSelfTest(): SelfTest {
  const probe = "zk_selftest_budget";
  const epoch = -1;
  let refusedAt: number | null = null;
  for (let i = 1; i <= ZK_PROOF_BUDGET + 1; i++) {
    const d = reserveBudget("fixture", probe, epoch, predicateOf("tier-membership", `tier-${i}`, "foryou"));
    if (!d.ok) {
      refusedAt = i;
      break;
    }
  }
  const ok = ZK_PROOF_BUDGET >= 1 && refusedAt === ZK_PROOF_BUDGET + 1;
  return ok
    ? { ok, detail: `budget ${ZK_PROOF_BUDGET} partitions (claimKind,tree,gate) per persona per epoch — self-test refused the ${ZK_PROOF_BUDGET + 1}th; epochs are NOT bounded (stated)` }
    : { ok, detail: refusedAt === null ? "budget self-test did not refuse" : `budget refused at ${refusedAt}, expected ${ZK_PROOF_BUDGET + 1}` };
}
