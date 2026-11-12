import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

// Aggregates ONLY. The response shape carries no user identifiers by
// construction — no persona ids, no handles, no per-user rows. Criterion 15
// asserts on the payload shape itself, so nothing may be added here that
// identifies a member of the audience.
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId");
  try {
    if (campaignId) {
      const aggregate = await retryAdapter(() => adapters.market.measurement(campaignId));
      return NextResponse.json({ aggregate });
    }
    const campaigns = await retryAdapter(() => adapters.market.listCampaigns());
    const aggregates = [];
    for (const c of campaigns) {
      aggregates.push({
        name: c.name,
        ...(await retryAdapter(() => adapters.market.measurement(c.id))),
      });
    }
    return NextResponse.json({ aggregates });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
