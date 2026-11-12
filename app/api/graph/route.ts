import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError, SENSITIVE_CATEGORIES, type ClaimCategory } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";
import { CLAIM_CATALOGUE } from "@/lib/adapters/mock/graph";

export const dynamic = "force-dynamic";

export async function GET() {
  const personaId = activeSeedPersonaId();
  try {
    const claims = await retryAdapter(() => adapters.graph.listClaims(personaId));
    // Consent per sensitive category, read individually so one unreadable
    // category can't silently mark the others as consented.
    const consent: Record<string, boolean> = {};
    for (const category of SENSITIVE_CATEGORIES) {
      try {
        consent[category] = await retryAdapter(() =>
          adapters.graph.getConsent(personaId, category)
        );
      } catch {
        consent[category] = false; // FAIL CLOSED
      }
    }
    return NextResponse.json({
      claims,
      catalogue: CLAIM_CATALOGUE,
      sensitiveCategories: SENSITIVE_CATEGORIES,
      consent,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const personaId = activeSeedPersonaId();
  try {
    if (body.action === "toggle") {
      const claim = await retryAdapter(() =>
        adapters.graph.setClaimActive(body.claimId, !!body.active, personaId)
      );
      return NextResponse.json({ claim });
    }
    const claim = await retryAdapter(() =>
      adapters.graph.addClaim(
        personaId,
        body.category as ClaimCategory,
        body.label,
        body.value
      )
    );
    return NextResponse.json({ claim });
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json(
      { error: err.message },
      { status: err.code === "FORBIDDEN" ? 403 : 503 }
    );
  }
}
