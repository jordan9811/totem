import { NextResponse } from "next/server";
import { persistedMockRep } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

// Current viewer's blocked persona ids (root-level fan-out already applied).
// Fails CLOSED: on persistent error this returns 503 rather than an empty
// list, because an empty list reads as "nobody is blocked".
export async function GET() {
  try {
    const personaIds = await retryAdapter(() =>
      persistedMockRep.blockedFor(activeSeedPersonaId())
    );
    return NextResponse.json({ personaIds });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
