import { NextResponse } from "next/server";
// UX GATE 4 — the Ad Match Score surface. Read-only: the score is derived
// entirely from existing graph state (claims + consent), never itself
// stored, so there is nothing here to get out of sync with the claims
// that actually back it.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { computeScore } from "@/lib/graph/score";

export const dynamic = "force-dynamic";

export async function GET() {
  const personaId = activeSeedPersonaId();
  try {
    const result = await computeScore(personaId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
