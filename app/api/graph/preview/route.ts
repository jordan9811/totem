import { NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";
import { personaById } from "@/lib/adapters/mock/store";

export const dynamic = "force-dynamic";

// "What ads would I see" — the product's transparency argument. Returns the
// live graph alongside the campaigns it currently matches, with a per-match
// explanation. Uses the precomputed match index, so a claim toggle
// recomputes fast enough to feel instant.
export async function GET() {
  const personaId = activeSeedPersonaId();
  try {
    const [matching, matchable] = await Promise.all([
      retryAdapter(() => adapters.market.matchingCampaigns(personaId)),
      retryAdapter(() => adapters.graph.claimsForMatching(personaId)),
    ]);
    return NextResponse.json({
      claims: matchable.claims,
      sensitiveIncluded: matchable.sensitiveIncluded,
      matches: matching.map((m) => ({
        campaignId: m.campaign.id,
        name: m.campaign.name,
        advertiser: personaById.get(m.campaign.advertiserPersonaId)?.handle ?? "unknown",
        reasons: m.reasons,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
