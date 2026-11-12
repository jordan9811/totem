import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { storyId, modeId, clear } = await req.json();
  if (!storyId) return NextResponse.json({ error: "storyId required" }, { status: 400 });
  const personaId = activeSeedPersonaId();
  try {
    if (clear) {
      await retryAdapter(() => adapters.feedHealth.clearSaturation(storyId, personaId));
      return NextResponse.json({ ok: true });
    }
    const entry = await retryAdapter(() => adapters.feedHealth.markCaughtUp(storyId, personaId, modeId ?? null));
    return NextResponse.json({ entry });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
