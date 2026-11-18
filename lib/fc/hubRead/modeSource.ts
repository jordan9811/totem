import "server-only";
// SPEC A — the ROOT's active mode, as THIS DEVICE holds it, for the real Following (lib/fc/hubRead/mode.ts applies it;
// lib/fc/hubRead/read.ts asks for it on every timeline answer, so a switch shows on the next one).
//
// KEYED EXACTLY AS THE ROUTES KEY IT: activeSeedPersonaId(), the function /api/modes, /api/modes/active, /api/rules and
// /api/delivery call. The hub timeline answers only while no persona acts (read.ts admit), and with no persona acting on
// the live device that function answers the public self (the visitor's own Farcaster account's record), so these are
// the same records the root reads and writes from Settings and the mode pill, never a persona's.
//
// NOTHING NEW LEAVES THE DEVICE. The mode, its rules, packs (and their post rules, lib/packs/rules.ts) and lenses are the
// device's own memory (hydrated once per tab from sealed vault records, as every route reads them); the delivery tiers
// are the sealed `deliveryTiers` record, read once per tab by the same call the sample feed and the delivery screen make
// (lib/delivery/tiers.ts, cached after). No node read, no app-server request, and no write: a mode's time-based
// auto-switch is NOT applied here (it would write the active mode at read time; the sample feed's build applies it).
//
// NEVER FAIL OPEN: a mode that cannot be read, or a rule it names that cannot be resolved, THROWS: the page shows nothing
// under it rather than the posts it might hide (the sample feed refuses the same way, lib/feed.ts). A rule that resolves
// but that the evaluator will not run (lib/rules/evaluate.ts runnableRules) is INERT and SAID: it hides and moves no post,
// and the mode's line names it (never a blank page for one bad rule, never a quiet change). An unreadable tier map
// degrades to Normal delivery, as the sample feed does (SECURITY-POSTURE §17), and is SAID on the page.
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
  const { runnableRules } = await import("@/lib/rules/evaluate");
  let viewer: string;
  let mode: Awaited<ReturnType<typeof adapters.mode.getActive>>;
  try {
    viewer = activeSeedPersonaId();
    mode = await retryAdapter(() => adapters.mode.getActive(viewer));
  } catch {
    throw new HubModeError(HUB_MODE_ERROR_SENTENCE);
  }
  const stored: import("@/lib/adapters/types").Rule[] = [];
  for (const id of mode.ruleIds ?? []) {
    let rule = null;
    try {
      rule = await retryAdapter(() => adapters.rules.get(id));
    } catch {
      throw new HubModeError(HUB_MODE_ERROR_SENTENCE);
    }
    // a rule the mode names but this device cannot resolve would quietly serve posts the mode exists to hide: refused,
    // by the mode's name
    if (!rule) throw new HubModeError(hubModeRuleErrorSentence(mode.name));
    stored.push(rule);
  }
  // a stored rule the evaluator will not run (a tree it cannot walk, one reaching past the evaluable fields) is left out
  // and SAID (gapsFor), exactly as the sample feed does (lib/feed.ts): it hides and moves no post. It used to refuse the
  // whole page, so one bad rule blanked Following.
  const owned = runnableRules(stored);
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
  const attached = packsForMode(mode.filterPackIds);
  // an attached pack's POST RULES run as the mode's own (lib/packs/rules.ts): after them in the spec's rules, so the one
  // ruleActions decides them, the author question counts them and gapsFor says what a Farcaster post cannot carry for
  // them too. A pack rule outside the import guardrails is inert and said, as an owner rule the evaluator won't run is.
  // Its claim predicates and curator riders stay what they were here: about Totem accounts, so they filter no Farcaster
  // post, and the page says so (gapsFor, per pack).
  const { packRules } = await import("@/lib/packs/rules");
  const packed = packRules(attached);
  const rules = [...owned.run, ...packed.run];
  const inertRules = [...owned.inert, ...packed.inert];
  const packs = attached.map((p) => ({
    id: p.id,
    name: p.artifact.name,
    perAccount: (p.artifact.attestationPredicates?.length ?? 0) > 0 || (p.artifact.curatorSubscriptions?.length ?? 0) > 0,
    postRules: packed.run.filter((r) => r.id.startsWith(`pack:${p.id}:`)).length,
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
    inertRules,
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
