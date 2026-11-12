import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { autoAcceptIfSeeded } from "@/lib/adapters/mock/disclosure";

export const dynamic = "force-dynamic";

// Mutual-consent unlock: request deeper access, other side accepts, both
// sides reveal (both-or-nothing). Seeded counterparties auto-accept, per
// the spec's "simulate the counterparty accepting for seeded accounts".
export async function POST(req: NextRequest) {
  const { targetPersonaId, requestId, accept } = await req.json();
  try {
    if (requestId !== undefined) {
      const resolved = await adapters.disclosure.respondToUnlock(requestId, !!accept);
      return NextResponse.json({ request: resolved });
    }
    if (!targetPersonaId) return NextResponse.json({ error: "targetPersonaId required" }, { status: 400 });
    let request = await adapters.disclosure.requestUnlock(activeSeedPersonaId(), targetPersonaId);
    if (autoAcceptIfSeeded(request)) {
      request = await adapters.disclosure.respondToUnlock(request.id, true);
    }
    return NextResponse.json({ request });
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json({ error: err.message }, { status: err.code === "NOT_FOUND" ? 404 : 503 });
  }
}
