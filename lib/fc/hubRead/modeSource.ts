import "server-only";
// SPEC A — the ROOT's active mode, as THIS DEVICE holds it, for the real Following (lib/fc/hubRead/mode.ts applies it;
// lib/fc/hubRead/read.ts asks for it on every timeline answer, so a switch shows on the next one).
//
// KEYED EXACTLY AS THE ROUTES KEY IT: activeSeedPersonaId(), the function /api/modes, /api/modes/active, /api/rules and
// /api/delivery call. The hub timeline answers only while no persona acts (read.ts admit), and with no persona acting on
// the live device that function answers the public self (the visitor's own Farcaster account's record), so these are
// the same records the root reads and writes from Settings and the mode pill, never a persona's.
//
// NOTHING NEW LEAVES THE DEVICE. The mode, its rules, packs and lenses are the device's own memory (hydrated once per tab
// from sealed vault records, as every route reads them); the delivery tiers are the sealed `deliveryTiers` record, read
// once per tab by the same call the sample feed and the delivery screen make (lib/delivery/tiers.ts, cached after). No
// node read, no app-server request, and no write: a mode's time-based auto-switch is NOT applied here (it would write the
// active mode at read time; the sample feed's build applies it).
//
// NEVER FAIL OPEN: a mode that cannot be read, or a rule it names that cannot be resolved or walked, THROWS: the page
// shows nothing under it rather than the posts it might hide (the sample feed refuses the same way, lib/feed.ts). An
// unreadable tier map degrades to Normal delivery, as the sample feed does (SECURITY-POSTURE §17), and is SAID on the page.
import { HUB_MODE_ERROR_SENTENCE, fidOfHubAccountKey, hubModeRuleErrorSentence } from "./copy";
import type { HubModeSpec } from "./mode";

export class HubModeError extends Error {
  constructor(sentence: string) {
    super(sentence);
    this.name = "HubModeError";
  }
}

export async function hubModeSpec(): Promise<HubModeSpec> {
  const { activeSeedPersonaId } = await import("@/lib/activePersona");
  const { adapters } = await import("@/lib/adapters/registry");
  const { retryAdapter } = await import("@/lib/adapters/retry");
  const { isWellFormedGroup, validateRuleGroup } = await import("@/lib/rules/evaluate");
  let viewer: string;
  let mode: Awaited<ReturnType<typeof adapters.mode.getActive>>;
  try {
    viewer = activeSeedPersonaId();
    mode = await retryAdapter(() => adapters.mode.getActive(viewer));
  } catch {
    throw new HubModeError(HUB_MODE_ERROR_SENTENCE);
  }
  const rules = [];
  for (const id of mode.ruleIds ?? []) {
    let rule = null;
    try {
      rule = await retryAdapter(() => adapters.rules.get(id));
    } catch {
      throw new HubModeError(HUB_MODE_ERROR_SENTENCE);
    }
    // a rule the mode names but this device cannot resolve, or one whose tree the evaluator cannot walk (a stored root
    // with no clause list), would quietly serve posts the mode exists to hide: refused, by the mode's name
    if (!rule || !isWellFormedGroup(rule.root) || validateRuleGroup(rule.root).length) throw new HubModeError(hubModeRuleErrorSentence(mode.name));
    rules.push(rule);
  }
  // delivery tiers: the accounts of this mode keyed `fc:<fid>` (a hub card's tier control writes them)
  const tiers = new Map<number, string>();
  let tiersUnreadable = false;
  const { tierMapFor, compileDeliveryRules } = await import("@/lib/delivery/tiers");
  try {
    for (const [account, tier] of await tierMapFor(mode.id)) {
      const fid = fidOfHubAccountKey(account);
      if (fid !== null) tiers.set(fid, tier);
    }
  } catch {
    tiersUnreadable = true;
    tiers.clear();
  }
  const deliveryRules = tiers.size ? compileDeliveryRules([], new Set(tiers.values() as Iterable<import("@/lib/delivery/tiers").DeliveryTier>)) : [];
  const { lensForMode, getLens } = await import("@/lib/lens/service");
  const lens = lensForMode(mode);
  const { packsForMode } = await import("@/lib/packs/service");
  const packs = packsForMode(mode.filterPackIds).map((p) => ({
    id: p.id,
    name: p.artifact.name,
    perAccount: (p.artifact.attestationPredicates?.length ?? 0) > 0 || (p.artifact.curatorSubscriptions?.length ?? 0) > 0,
  }));
  return {
    id: mode.id,
    name: mode.name,
    ranking: mode.ranking,
    calmRanking: mode.calmRanking === true,
    longformOnly: mode.longformOnly === true,
    hideReplies: mode.hideReplies === true,
    kingOfTheHill: mode.kingOfTheHill === true,
    rules,
    deliveryRules,
    tiers,
    tiersUnreadable,
    lens: {
      id: lens.id,
      name: lens.source === "mode" ? getLens(lens.id)?.name ?? null : null,
      source: lens.source,
      spec: lens.spec,
      // the mode pins a lens this device no longer holds: lensForMode falls back; the page says so
      missing: !!mode.lens && lens.source !== "mode",
    },
    packs,
  };
}
