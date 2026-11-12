import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

// Dev control: fast-forward the readwise schedule (spec calls for this
// explicitly so chunk sequencing is testable without waiting).
export async function POST(req: NextRequest) {
  const { postHash, all } = await req.json().catch(() => ({}));
  const personaId = activeSeedPersonaId();
  try {
    if (all || !postHash) {
      const schedules = await adapters.feedHealth.fastForwardAll(personaId);
      return NextResponse.json({ schedules });
    }
    const schedule = await adapters.feedHealth.advanceReadwise(postHash, personaId);
    return NextResponse.json({ schedule });
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json({ error: err.message }, { status: err.code === "NOT_FOUND" ? 404 : 503 });
  }
}
