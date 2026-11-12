import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { channelId } = await req.json();
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });
  try {
    const membership = await retryAdapter(() =>
      adapters.space.join(channelId, activeSeedPersonaId())
    );
    return NextResponse.json({ membership });
  } catch (e) {
    const err = e as AdapterError;
    // Invite-only rejection is a real answer, not a transient failure.
    const status = err.code === "FORBIDDEN" ? 403 : err.code === "NOT_FOUND" ? 404 : 503;
    return NextResponse.json({ error: err.message }, { status });
  }
}
