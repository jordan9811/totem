import "server-only";
// ATTESTATION PASS Gate 4 (attack-att-1 MED, attack-att-3 INFO): the label's ninth
// condition is only honest if a rendered surface actually passes the bucket it gates
// on. A mode gates on an attestation when one of its rules names `attest.holds`;
// the first such clause is the surface's gated bucket, and the discovery surface
// hands it to the label.
import { adapters } from "@/lib/adapters/registry";
import type { ModeDefinition, RuleGroup } from "@/lib/adapters/types";
import { parseAttestTree, validBucket, validIssuer } from "./ids";

function firstAttestClause(group: RuleGroup | null | undefined): { issuer: string; bucket: string } | null {
  if (!group || !Array.isArray(group.clauses)) return null;
  for (const clause of group.clauses) {
    if ((clause as RuleGroup).combinator !== undefined) {
      const hit = firstAttestClause(clause as RuleGroup);
      if (hit) return hit;
      continue;
    }
    const c = clause as { field?: unknown; value?: unknown };
    if (c.field !== "attest.holds") continue;
    const raw = Array.isArray(c.value) ? String(c.value[0] ?? "") : String(c.value ?? "");
    const parsed = parseAttestTree("attest:" + raw);
    if (parsed && validIssuer(parsed.issuer) && validBucket(parsed.bucket)) return parsed;
  }
  return null;
}

/** the (issuer, bucket) an active mode gates on, or undefined when it gates on none */
export async function gatedAttestationOfMode(mode: Pick<ModeDefinition, "ruleIds"> | null | undefined): Promise<{ issuer: string; bucket: string } | undefined> {
  if (!mode || !Array.isArray(mode.ruleIds)) return undefined;
  for (const id of mode.ruleIds) {
    try {
      const rule = await adapters.rules.get(id);
      const hit = firstAttestClause(rule?.root);
      if (hit) return hit;
    } catch {
      /* a rule that cannot be read gates on nothing the label can name */
    }
  }
  return undefined;
}
