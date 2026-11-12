import "server-only";
// POST-DEPLOY Gate 3 — PER-ACCOUNT DELIVERY TIERS.
//
// "Notifications on/off" is the wrong question. The question an owner
// actually has is WHERE someone's posts show up, and the answer differs by
// context: never miss this person in personal mode, keep them quiet in work
// mode. So a tier is not a property of an account — it is a property of the
// PAIR (account, mode), which is why the key here is `modeId|personaId` and
// why the same account can sit at two tiers at once.
//
// NOT A PARALLEL FILTER PATH. The tiers are compiled into ordinary rules and
// evaluated by lib/rules/evaluate.ts, the same evaluator modes, packs, lenses
// and channel gates use. That is the whole reason the compile step exists:
// a second filtering system would fight the mode's rules instead of composing
// with them, and every future feature would have to learn about both.
//
// FIVE RULES, NOT ONE PER ACCOUNT. The compiled set is one rule per non-normal
// TIER, each matching on a single new field (`delivery.tier`) whose value the
// feed resolves per post from this map. A rule per account would make the
// rule list grow with the follow graph and would put the account ids into
// every structure a rule passes through.
//
// Stored like every other device preference: one opaque padded sealed vault
// record. Which accounts you never want to miss, and which you have quietly
// turned down, is a map of what you care about — the addresses would say as
// much as the values.
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";
import type { Rule, RuleGroup } from "@/lib/adapters/types";

export const VAULT_NS = "deliveryTiers";

export const DELIVERY_TIERS = ["never-miss", "banner", "normal", "facet-only", "quiet"] as const;
export type DeliveryTier = (typeof DELIVERY_TIERS)[number];
export const isDeliveryTier = (v: unknown): v is DeliveryTier =>
  typeof v === "string" && (DELIVERY_TIERS as readonly string[]).includes(v);

/** Normal is the absence of a setting, never a stored value: a map that stored
 *  "normal" would grow with every account ever looked at. */
export const DEFAULT_TIER: DeliveryTier = "normal";

interface Doc {
  /** "<modeId>|<personaId>" → tier, for non-normal tiers only */
  tiers: Record<string, DeliveryTier>;
  loaded: boolean;
}
const g = globalThis as unknown as { __layersDeliveryTiers?: Doc };
const keyOf = (modeId: string, personaId: string) => modeId + "|" + personaId;

async function load(): Promise<Doc> {
  if (g.__layersDeliveryTiers) return g.__layersDeliveryTiers;
  let doc: Doc = { tiers: {}, loaded: false };
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(VAULT_NS);
      if (res.status === 404) {
        doc.loaded = true;
        break;
      }
      if (!res.ok) throw new Error("validator answered " + res.status);
      const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
      if (entries && Object.keys(entries).length) {
        const plain = decryptNamespace(VAULT_NS, entries);
        const rec = plain["_"] as { m?: { tiers?: Record<string, DeliveryTier> } } | undefined;
        // GATE 5 (attack-post-3 F-1): records present but none readable is a CORRUPTED
        // namespace, not an empty one. Treating it as empty un-quieted every account the
        // owner had turned down and then sealed that emptiness over the real record.
        if (!rec)
          throw new Error(
            "vault: deliveryTiers holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one"
          );
        doc = { tiers: rec?.m?.tiers && typeof rec.m.tiers === "object" ? rec.m.tiers : {}, loaded: true };
      } else {
        // GATE 5 (attack-post-3 F-1, path 1): an empty namespace is benign only if it was
        // never written — the validator answers a MISSING namespace and a DELETED one the
        // same way. See lib/vault/sealedPins.ts.
        const { wasEverSealed } = await import("@/lib/vault/sealedPins");
        if (wasEverSealed(VAULT_NS))
          throw new Error(
            "vault: deliveryTiers is EMPTY on the validator but this device has sealed it before — refusing rather than treating a deleted namespace as a fresh one"
          );
        doc.loaded = true;
      }
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (String((e as Error).message).includes("vault")) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  // Never fail open. An unreadable tier map read as "everything is normal"
  // would quietly un-quiet an account the owner turned down, which is the one
  // direction of this setting that leaks attention to somebody unwanted.
  if (!doc.loaded)
    throw new Error(
      "delivery tiers unavailable (" +
        ((lastErr as Error)?.message ?? "validator unreachable") +
        ") — refusing rather than treating the vault as empty"
    );
  g.__layersDeliveryTiers = doc;
  return doc;
}

async function save(doc: Doc): Promise<void> {
  if (!doc.loaded) throw new Error("delivery tiers were never loaded from the validator — refusing to seal over them");
  // GATE 5 (attack-post-3 F-5): adopt the cache only once the flush succeeds — and the
  // caller must hand over a NEW document, because the first version of this rollback
  // captured the cached object that the mutator had already mutated in place.
  const previous = g.__layersDeliveryTiers;
  if (previous === doc) throw new Error("internal: save() was handed the cached document — build a new one, or a failed flush cannot be rolled back");
  const inner = JSON.stringify(doc.tiers);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  const sealed = encryptNamespace(VAULT_NS, { _: { m: { tiers: doc.tiers }, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });
  try {
    await flushVault(VAULT_NS, sealed);
  } catch (e) {
    g.__layersDeliveryTiers = previous;
    throw e;
  }
  const { markEverSealed } = await import("@/lib/vault/sealedPins");
  markEverSealed(VAULT_NS);
  g.__layersDeliveryTiers = doc;
}

export function resetDeliveryCache(): void {
  g.__layersDeliveryTiers = undefined;
}

// ------------------------------------------------------------------- reads

export async function tierFor(modeId: string, personaId: string): Promise<DeliveryTier> {
  const doc = await load();
  return doc.tiers[keyOf(modeId, personaId)] ?? DEFAULT_TIER;
}

/** The whole (account → tier) map for one mode. The feed resolves each post's
 *  author against this once, so the evaluator only ever sees a tier STRING. */
export async function tierMapFor(modeId: string): Promise<Map<string, DeliveryTier>> {
  const doc = await load();
  const out = new Map<string, DeliveryTier>();
  const prefix = modeId + "|";
  for (const [k, v] of Object.entries(doc.tiers)) if (k.startsWith(prefix)) out.set(k.slice(prefix.length), v);
  return out;
}

export interface TierRow {
  personaId: string;
  modeId: string;
  tier: DeliveryTier;
}

/** Every non-normal setting, across every mode — the management screen's list.
 *  Normal is never stored, so this IS the complete non-normal set by
 *  construction rather than by filtering. */
export async function listNonNormal(): Promise<TierRow[]> {
  const doc = await load();
  const out: TierRow[] = [];
  for (const [k, tier] of Object.entries(doc.tiers)) {
    const i = k.indexOf("|");
    if (i < 0) continue;
    out.push({ modeId: k.slice(0, i), personaId: k.slice(i + 1), tier });
  }
  return out;
}

// ------------------------------------------------------------------ writes

export type SetTierResult =
  | { ok: true; tier: DeliveryTier }
  | { ok: false; code: "malformed" | "no_facet"; reason: string };

/**
 * `facetFollowed` is the set of clusters the viewer follows for this account's
 * ROOT. "Facet only" with none selected would hide every post that account
 * makes, which nobody means by "facet only" — so it is refused with the reason,
 * rather than accepted and silently total.
 */
export async function setTier(
  modeId: string,
  personaId: string,
  tier: unknown,
  facetFollowed: string[] = []
): Promise<SetTierResult> {
  if (!modeId || !personaId) return { ok: false, code: "malformed", reason: "modeId and personaId are required" };
  // GATE 5 (attack-post-3 F-10): the key is `modeId|personaId`, so a `|` inside either half
  // desynchronises listNonNormal (which splits on the FIRST one) from tierMapFor (which
  // strips a PREFIX) — producing rows the management screen lists and cannot delete, and a
  // tier the feed never applies. The separator is refused at the door rather than escaped,
  // because an id containing it is a bug upstream either way.
  if (modeId.includes("|") || personaId.includes("|"))
    return { ok: false, code: "malformed", reason: "a mode or persona id may not contain '|' — it is the key separator" };
  if (modeId.length > 200 || personaId.length > 200)
    return { ok: false, code: "malformed", reason: "mode and persona ids are at most 200 characters" };
  if (!isDeliveryTier(tier)) return { ok: false, code: "malformed", reason: "unknown tier: " + String(tier) };
  if (tier === "facet-only" && facetFollowed.length === 0)
    return {
      ok: false,
      code: "no_facet",
      reason: "follow a facet of this account first — 'facet only' with no facet selected would hide everything they post",
    };
  const doc = await load();
  const next = { ...doc.tiers };
  if (tier === DEFAULT_TIER) delete next[keyOf(modeId, personaId)];
  else next[keyOf(modeId, personaId)] = tier;
  await save({ ...doc, tiers: next });
  return { ok: true, tier };
}

// ---------------------------------------------------------------- compiling

const only = (tier: DeliveryTier): RuleGroup => ({
  combinator: "AND",
  clauses: [{ field: "delivery.tier", op: "eq", value: tier }],
});

/**
 * The tiers, as RULES. One per non-normal tier — the account is not in the
 * rule at all; it is in the `delivery.tier` value the feed resolves per post.
 *
 * `allowedClustersByRoot` is the viewer's facet-follow state, which is what
 * makes "facet only" mean anything. A facet-only rule hides a post whose
 * author's cluster is not among the followed ones; the set is baked in at
 * compile time because the evaluator is pure and synchronous.
 *
 * These rules carry the two actions an IMPORTED algorithm may never use
 * (`pin`, `banner`) — see lib/algo/artifact.ts, which still allowlists only
 * hide/downrank/flag. An imported algorithm that could pin an account to the
 * top of somebody's timeline is an ad slot with extra steps.
 */
export function compileDeliveryRules(allowedClusters: string[], tiersInUse: ReadonlySet<DeliveryTier>): Rule[] {
  const at = Date.now();
  const rules: Rule[] = [];
  if (tiersInUse.has("never-miss")) rules.push({ id: "delivery:never-miss", name: "Never miss", action: "pin", root: only("never-miss"), createdAt: at });
  if (tiersInUse.has("banner")) rules.push({ id: "delivery:banner", name: "Banner", action: "banner", root: only("banner"), createdAt: at });
  if (tiersInUse.has("quiet")) rules.push({ id: "delivery:quiet", name: "Quiet", action: "downrank", root: only("quiet"), createdAt: at });
  // GATE 5 (attack-post-2 F-1): ONLY compile the tiers actually in use, and this one only
  // when some account is really on it.
  //
  // The facet-only rule is the reason this matters. It is the one compiled rule that
  // carries an `author.cluster` clause, and lib/feed.ts asks "does any hide rule reference
  // the author?" to decide whether a LIVE cast whose author it cannot resolve should be
  // hidden (fail-closed, correctly). Compiling all four rules whenever the map was non-empty
  // therefore meant that marking a single friend never-miss made that question true and
  // dropped every unattributed live cast — one preference, a blank timeline.
  if (!tiersInUse.has("facet-only")) return rules;
  rules.push({
    id: "delivery:facet-only",
    name: "Facet only",
    action: "hide",
    root: {
      combinator: "AND",
      clauses: [
        { field: "delivery.tier", op: "eq", value: "facet-only" },
        // NOT (the author's cluster is one this viewer follows)
        {
          combinator: "OR",
          negate: true,
          clauses: [{ field: "author.cluster", op: "in", value: allowedClusters.length ? allowedClusters : [" none"] }],
        },
      ],
    },
    createdAt: at,
  });
  return rules;
}

/** How far a quiet author falls. Big enough to lose to anything the mode ranks
 *  normally, finite so a quiet account is deranked and not disappeared — that
 *  is what "facet only" and a block are for. */
export const QUIET_PENALTY = 1000;
