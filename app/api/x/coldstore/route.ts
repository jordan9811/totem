import { NextRequest, NextResponse } from "next/server";
// UX GATE 3 — cold-storage sources (X bookmark folders, DM threads) and
// their designated resolution into the existing readwise populator. See
// lib/x/coldstore.ts for the integration story.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { coldSourcesFor, coldSummaryFor, resolveSource } from "@/lib/x/coldstore";

export const dynamic = "force-dynamic";

export async function GET() {
  const personaId = activeSeedPersonaId();
  const sources = coldSourcesFor(personaId);
  const summary = coldSummaryFor(personaId);
  return NextResponse.json({ sources, summary });
}

export async function POST(req: NextRequest) {
  const personaId = activeSeedPersonaId();
  const body = await req.json();
  if (body.action !== "resolve") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  const sourceId = String(body.sourceId ?? "");
  try {
    const result = await resolveSource(personaId, sourceId);
    return NextResponse.json(result);
  } catch (e) {
    const { SpendCapError } = await import("@/lib/x/spend");
    if (e instanceof SpendCapError) {
      // The cap gate ran BEFORE any item was touched — refuse, don't
      // partially resolve. The client reads this as "prompt", not "fail".
      return NextResponse.json({ error: e.message, cap: e.cap }, { status: 402 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
