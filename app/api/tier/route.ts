import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const tierParam = Number(req.nextUrl.searchParams.get("tier"));
  const personaId = req.nextUrl.searchParams.get("personaId");
  try {
    const tier = personaId ? await retryAdapter(() => adapters.rep.tierFor(personaId)) : tierParam;
    // ZK PASS 1: under the zk rep binding an UNPROVEN persona is tier 0 —
    // a real, honest answer ("nothing proven this epoch"), not a missing
    // parameter. Only a request with neither a persona nor a tier is 400.
    if (!Number.isInteger(tier) || (!personaId && !tier)) {
      return NextResponse.json({ error: "tier or personaId required" }, { status: 400 });
    }
    if (tier === 0) {
      // ZK PASS 2 Gate 1: not a tier — the honest answer, never a fake one
      return NextResponse.json({ tier: 0, proven: false, percentile: "not proven this epoch", unlocks: [] });
    }
    const explainer = await retryAdapter(() => adapters.rep.tierExplainer(tier));
    return NextResponse.json({ ...explainer, proven: true });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
