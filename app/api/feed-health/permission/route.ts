import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { allow, personaId } = await req.json();
  try {
    await retryAdapter(() => adapters.feedHealth.setReceivePermission(personaId ?? activeSeedPersonaId(), !!allow));
    return NextResponse.json({ ok: true, allow: !!allow });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
