import "server-only";
import { provenAttestationsFor } from "@/lib/attest/proven";
import { audienceFloor } from "@/lib/zk/floor";
import { withMockLatency } from "../mockUtils";
import { AdapterError } from "../types";
import type {
  Bid,
  Campaign,
  Intent,
  MarketAdapter,
  MeasurementAggregate,
  RuleGroup,
} from "../types";
import graphRaw from "@/seed/data/graph.json";
import { nextId, personaById, state } from "./store";
import { marketClock } from "./clock";
import { mockGraphAdapter } from "./graph";
import { bank } from "@/lib/world";

// LAYERS_WORLD=empty (lib/world.ts): no seeded campaigns, match index or audience population (all demo personas)
const SEED_CAMPAIGNS = bank(graphRaw.campaigns as Campaign[], []);
const MATCH_INDEX = bank(graphRaw.matchIndex as Record<string, string[]>, {});
const POPULATION = bank(graphRaw.audiencePopulation as {
  personaId: string;
  tier: number;
  claims: string[];
}[], []);

/** k-anonymity floor. Dev value is 8 so the seeded data can actually trip it. */
export const K_FLOOR = 8;

function allCampaigns(): Campaign[] {
  const merged = new Map(SEED_CAMPAIGNS.map((c) => [c.id, c]));
  for (const [id, c] of state().campaigns) merged.set(id, c);
  return [...merged.values()];
}

/** Evaluate one audience predicate against one population member. */
function matchesAudience(
  audience: RuleGroup,
  member: { tier: number; claims: string[]; attestations?: string[] }
): { matched: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const evalClause = (clause: RuleGroup["clauses"][number]): boolean => {
    if ("combinator" in clause) {
      const results = clause.clauses.map(evalClause);
      const val = clause.combinator === "AND" ? results.every(Boolean) : results.some(Boolean);
      return clause.negate ? !val : val;
    }
    if (clause.field === "graph.claim") {
      const hit = member.claims.includes(String(clause.value));
      if (hit) reasons.push(String(clause.value));
      return hit;
    }
    if (clause.field === "attest.holds") {
      // Attestation pass Gate 3: proof-mediated — what the persona PROVED this epoch
      const held = member.attestations ?? [];
      const want = Array.isArray(clause.value) ? clause.value.map(String) : [String(clause.value)];
      const any = want.some((w) => held.includes(w));
      const hit = clause.op === "neq" ? !any : any;
      if (hit) reasons.push(`proved ${want.join(" or ")}`);
      return hit;
    }
    if (clause.field === "author.tier") {
      const v = Number(clause.value);
      const hit =
        clause.op === "gte" ? member.tier >= v
        : clause.op === "gt" ? member.tier > v
        : clause.op === "lte" ? member.tier <= v
        : clause.op === "lt" ? member.tier < v
        : member.tier === v;
      if (hit) {
        // Human-readable, not operator syntax — this string is shown to the
        // user as the explanation for why an ad reached them.
        const phrase =
          clause.op === "gte" ? `tier ${v}+`
          : clause.op === "gt" ? `tier above ${v}`
          : clause.op === "lte" ? `tier ${v} or below`
          : clause.op === "lt" ? `tier below ${v}`
          : `tier ${v}`;
        reasons.push(phrase);
      }
      return hit;
    }
    return false;
  };
  const results = audience.clauses.map(evalClause);
  const matched =
    audience.combinator === "AND" ? results.every(Boolean) : results.some(Boolean);
  return { matched: audience.negate ? !matched : matched, reasons };
}

/** Deterministic DP-style noise: seeded by campaign id, never random. */
function seededNoise(seed: string, bound: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return (Math.abs(h) % (bound * 2 + 1)) - bound;
}

export const mockMarketAdapter: MarketAdapter = {
  async listCampaigns() {
    return withMockLatency(() => allCampaigns(), { label: "market.listCampaigns" });
  },

  async createCampaign(input) {
    return withMockLatency(() => {
      const created: Campaign = { ...input, id: nextId("camp"), createdAt: Date.now() };
      state().campaigns.set(created.id, created);
      return created;
    }, { label: "market.createCampaign" });
  },

  async audienceSize(audience) {
    return withMockLatency(
      () => POPULATION.filter((m) => matchesAudience(audience, { ...m, attestations: provenAttestationsFor(m.personaId) }).matched).length,
      { label: "market.audienceSize" }
    );
  },

  async kFloor(audience) {
    // ONE floor: the k-floor, raised to the attestation floor when the audience predicates on a proven bucket (lib/zk/floor.ts)
    return withMockLatency(() => audienceFloor(audience ?? null, K_FLOOR), { label: "market.kFloor" });
  },

  // Uses the PRECOMPUTED match index rather than re-scanning every campaign,
  // so toggling a claim recomputes in constant time per claim (gated-pass
  // failure mode: no spinner on every toggle).
  async matchingCampaigns(personaId) {
    const { claims } = await mockGraphAdapter.claimsForMatching(personaId);
    return withMockLatency(() => {
      const held = new Set(claims.map((c) => c.value));
      const tier = personaById.get(personaId)?.tier ?? 1;
      const candidateIds = new Set<string>();
      for (const value of held) for (const id of MATCH_INDEX[value] ?? []) candidateIds.add(id);

      const out: { campaign: Campaign; reasons: string[] }[] = [];
      for (const campaign of allCampaigns()) {
        if (!candidateIds.has(campaign.id)) continue;
        const { matched, reasons } = matchesAudience(campaign.audience, {
          tier,
          claims: [...held],
        });
        if (matched) {
          // Human-readable explanation, per the transparency requirement.
          const labels = reasons.map((r) => {
            const claim = claims.find((c) => c.value === r);
            return claim ? claim.label.toLowerCase() : r;
          });
          out.push({ campaign, reasons: labels });
        }
      }
      return out;
    }, { label: "market.matchingCampaigns" });
  },

  // ---------- intent auction ----------

  async createIntent(input) {
    return withMockLatency(() => {
      const intent: Intent = {
        ...input,
        id: nextId("intent"),
        createdAt: marketClock.now(),
        status: "open",
        winningBidId: null,
      };
      state().intents.set(intent.id, intent);

      // Scripted, deterministic advertiser bids. Arrival offsets are fixed
      // so the auction lifecycle test never races wall-clock.
      const bidders = allCampaigns().slice(0, intent.pitchSlots);
      const bids: Bid[] = bidders.map((c, i) => ({
        id: `${intent.id}_bid${i}`,
        intentId: intent.id,
        advertiserPersonaId: c.advertiserPersonaId,
        pitch: `${c.name} — matched to "${intent.category}". ${
          ["Free trial, no card.", "20% off first order.", "Bundle with a 1-year pass."][i % 3]
        }`,
        amount: Math.round(intent.escrowAmount * (0.4 + i * 0.15)),
        arrivesAtMs: (i + 1) * 2000,
      }));
      state().bids.set(intent.id, bids);
      return intent;
    }, { label: "market.createIntent" });
  },

  async getIntent(intentId) {
    return withMockLatency(() => state().intents.get(intentId) ?? null, { label: "market.getIntent" });
  },

  async listIntents(personaId) {
    return withMockLatency(
      () => [...state().intents.values()].filter((i) => i.buyerPersonaId === personaId),
      { label: "market.listIntents" }
    );
  },

  async bidsFor(intentId, nowMs) {
    return withMockLatency(() => {
      const intent = state().intents.get(intentId);
      if (!intent) throw new AdapterError("unknown intent", "NOT_FOUND");
      const elapsed = (nowMs ?? marketClock.now()) - intent.createdAt;
      return (state().bids.get(intentId) ?? []).filter((b) => b.arrivesAtMs <= elapsed);
    }, { label: "market.bidsFor" });
  },

  async awardIntent(intentId, bidId) {
    return withMockLatency(() => {
      const s = state();
      const intent = s.intents.get(intentId);
      if (!intent) throw new AdapterError("unknown intent", "NOT_FOUND");
      if (intent.status !== "open") throw new AdapterError("intent already resolved", "FORBIDDEN");
      const updated: Intent = { ...intent, status: "awarded", winningBidId: bidId };
      s.intents.set(intentId, updated);
      return updated;
    }, { label: "market.awardIntent" });
  },

  async lapseIntent(intentId) {
    return withMockLatency(() => {
      const s = state();
      const intent = s.intents.get(intentId);
      if (!intent) throw new AdapterError("unknown intent", "NOT_FOUND");
      if (intent.status !== "open") return intent;
      const updated: Intent = { ...intent, status: "lapsed", winningBidId: null };
      s.intents.set(intentId, updated);
      return updated;
    }, { label: "market.lapseIntent" });
  },

  // Aggregates only. The response shape deliberately contains no user
  // identifiers — acceptance criterion 15 asserts on exactly that.
  async measurement(campaignId) {
    return withMockLatency(() => {
      const campaign = allCampaigns().find((c) => c.id === campaignId);
      if (!campaign) throw new AdapterError("unknown campaign", "NOT_FOUND");
      const reach = POPULATION.filter((m) => matchesAudience(campaign.audience, m).matched).length;
      const noiseBound = 5;
      const impressions = Math.max(0, reach * 37 + seededNoise(campaignId + ":imp", noiseBound));
      const conversions = Math.max(0, Math.round(reach * 2.4) + seededNoise(campaignId + ":conv", noiseBound));
      const agg: MeasurementAggregate = { campaignId, impressions, conversions, noiseBound };
      return agg;
    }, { label: "market.measurement" });
  },
};

export { matchesAudience, POPULATION };
