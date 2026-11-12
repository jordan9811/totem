import { NextRequest, NextResponse } from "next/server";
// MEGA PASS 2 Gate 2 — GET /api/lenses/:id/evaluate?castId=  the ranked score and its term breakdown under
// that lens — inspectable, no black box: the breakdown sums to the score exactly, from the SAME signal
// extraction and arithmetic the feed ranks with.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { evaluateCast } from "@/lib/lens/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const castId = req.nextUrl.searchParams.get("castId");
  if (!castId) return NextResponse.json({ error: "castId required" }, { status: 400 });
  try {
    const evaluation = await evaluateCast(params.id, castId, activeSeedPersonaId());
    if (!evaluation) return NextResponse.json({ error: "unknown lens or cast" }, { status: 404 });
    return NextResponse.json(evaluation);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
