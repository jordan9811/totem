import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError, SENSITIVE_CATEGORIES, type ClaimCategory } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

// Per-category explicit consent for sensitive categories. There is
// deliberately no bulk/select-all path here — each category is its own
// decision, which is why this route rejects anything but a single category.
export async function POST(req: NextRequest) {
  const { category, consented } = await req.json();
  if (!category || !SENSITIVE_CATEGORIES.includes(category as ClaimCategory)) {
    return NextResponse.json(
      { error: "a single sensitive category is required" },
      { status: 400 }
    );
  }
  try {
    await retryAdapter(() =>
      adapters.graph.setConsent(activeSeedPersonaId(), category as ClaimCategory, !!consented)
    );
    const now = await retryAdapter(() =>
      adapters.graph.getConsent(activeSeedPersonaId(), category as ClaimCategory)
    );
    return NextResponse.json({ category, consented: now });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
