import { NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function GET() {
  const personaId = activeSeedPersonaId();
  try {
    const [events, byCategory, total] = await Promise.all([
      retryAdapter(() => adapters.settle.listEvents(personaId)),
      retryAdapter(() => adapters.settle.earningsByCategory(personaId)),
      retryAdapter(() => adapters.settle.total(personaId)),
    ]);
    return NextResponse.json({ events, byCategory, total });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
