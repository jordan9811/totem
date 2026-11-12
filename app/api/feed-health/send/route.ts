import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { networkWriteRefusal } from "@/lib/fc/networkTarget";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { postHash, toPersonaId, fromPersonaId } = await req.json();
  if (!postHash || !toPersonaId) {
    return NextResponse.json({ error: "postHash and toPersonaId required" }, { status: 400 });
  }
  // FC-READ: sending a NETWORK cast (read through the public relay) to a friend's timeline records a send the
  // recipient's feed never renders (sent cards resolve local hashes only) — refused per target; local and seed
  // posts, and every rig, are unchanged (lib/fc/networkTarget.ts)
  const refusal = await networkWriteRefusal(typeof postHash === "string" ? postHash : null);
  if (refusal) return NextResponse.json(refusal, { status: 403 });
  try {
    const event = await adapters.feedHealth.sendToTimeline(
      fromPersonaId ?? activeSeedPersonaId(),
      toPersonaId,
      postHash
    );
    return NextResponse.json({ event });
  } catch (e) {
    const err = e as AdapterError;
    // Permission off → 403, which the UI surfaces as "they don't accept sends".
    return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 403 : 503 });
  }
}
