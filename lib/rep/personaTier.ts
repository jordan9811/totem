import "server-only";
// ZK PASS 2 Gate 1 — THE ONE PLACE a persona's tier is read for display.
//
// Under the zk rep binding the answer is what the persona has PROVEN this
// epoch (the dispatching rep adapter → lib/adapters/zk/rep.ts; 0 = not
// proven, rendered as such — never a fake tier, never 1 by default).
// Under the legacy bindings the caller's own legacy read runs unchanged
// (the phase-1 validator read, or the seed's tier for a seeded profile),
// so the product is byte-for-byte what it was. No module outside this
// file and the validator adapter imports the validator's tierFor —
// test:z6 greps for it.
import { adapters, currentRepImpl } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { tierFor as validatorTierFor } from "@/lib/validator";
import { isEmptyWorld } from "@/lib/world-flag";

export type LegacyTier = () => Promise<number | null | undefined> | number | null | undefined;

export async function personaTier(personaId: string, legacy: LegacyTier): Promise<number | undefined> {
  if (currentRepImpl() === "zk") {
    try {
      return await retryAdapter(() => adapters.rep.tierFor(personaId));
    } catch {
      return undefined; // unreachable rep: no badge, never a default tier
    }
  }
  const v = await legacy();
  return v ?? undefined;
}

/** the phase-1 legacy read: tier by ROOT handle for a persona this device
 * can attribute to one of its own roots (null otherwise — the validator no
 * longer holds persona → root, migration 006) */
export async function legacyValidatorTier(personaId: string): Promise<number | null> {
  // LAYERS_WORLD=empty (review WORLD-ID-2 / F4): a real persona NEVER shows the demo account's reputation. Real personas
  // used to be filed under the seeded self's fixture root (fid 9152), so this read handed them its seeded tier 10;
  // the roster now files them under the service's own root and drops every fixture root under the flag
  // (lib/identity/rootRoster.ts), and this read is refused for a fixture-roster root outright. The own root's legacy
  // tier is not shown either: the legacy tier is a decile across the validator's population, which on the owner
  // service is the demo world's seeded roots still stored there, and "tier 1 by definition" for a root with no rep
  // events is that model's zero mark, not a tier the root earned — no badge is the honest answer. The tier a real
  // persona shows under the flag is the PROVEN one (ADAPTER_REP=zk, the zk branch above: 0 = not proven).
  if (isEmptyWorld()) {
    const { rootOfPersona, isFixtureRoot } = await import("@/lib/identity/rootRoster");
    // the roster read is also the roster's first-load hook (it files the device's personas under the own root)
    const rootId = await rootOfPersona(personaId);
    if (rootId && isFixtureRoot(rootId)) {
      // cannot happen (the roster drops every fixture root under the flag); said loudly if it ever does, never a tier
      console.error("[tier] " + personaId + " resolved to a fixture-roster root under LAYERS_WORLD=empty — the legacy tier is refused");
    }
    return null;
  }
  return validatorTierFor(personaId);
}
