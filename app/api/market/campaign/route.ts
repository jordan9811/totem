import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const audienceParam = req.nextUrl.searchParams.get("audience");
  try {
    if (audienceParam) {
      const audience = JSON.parse(audienceParam);
      const [size, floor] = await Promise.all([
        retryAdapter(() => adapters.market.audienceSize(audience)),
        retryAdapter(() => adapters.market.kFloor(audience)),
      ]);
      return NextResponse.json({ size, kFloor: floor, belowFloor: size < floor });
    }
    const [campaigns, floor] = await Promise.all([
      retryAdapter(() => adapters.market.listCampaigns()),
      retryAdapter(() => adapters.market.kFloor()),
    ]);
    return NextResponse.json({ campaigns, kFloor: floor });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

// K-ANONYMITY FLOOR, enforced HERE independently of the UI. The client also
// disables submit below the floor, but this check must stand on its own —
// a forced call that bypasses the UI has to be rejected (criterion 12).
export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const [size, floor] = await Promise.all([
      retryAdapter(() => adapters.market.audienceSize(body.audience)),
      retryAdapter(() => adapters.market.kFloor(body.audience)),
    ]);
    if (size < floor) {
      return NextResponse.json(
        {
          error: `audience of ${size} is below the k-anonymity floor of ${floor}`,
          size,
          kFloor: floor,
        },
        { status: 422 }
      );
    }
    const campaign = await retryAdapter(() =>
      adapters.market.createCampaign({
        advertiserPersonaId: activeSeedPersonaId(),
        name: body.name,
        audience: body.audience,
        budget: Number(body.budget ?? 0),
        status: "live",
      })
    );
    return NextResponse.json({ campaign, size });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
