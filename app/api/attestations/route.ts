import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function GET() {
  const personaId = activeSeedPersonaId();
  try {
    const [issuers, connections, tier] = await Promise.all([
      retryAdapter(() => adapters.attestation.listIssuers()),
      retryAdapter(() => adapters.attestation.listConnections(personaId)),
      retryAdapter(() => adapters.rep.tierFor(personaId)),
    ]);
    return NextResponse.json({ issuers, connections, tier });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const { issuerId } = await req.json();
  if (!issuerId) return NextResponse.json({ error: "issuerId required" }, { status: 400 });
  const personaId = activeSeedPersonaId();
  try {
    const connection = await retryAdapter(() => adapters.attestation.connect(personaId, issuerId));
    // The tier is the whole point of connecting — retry rather than
    // reporting null, which would read as "connecting did nothing".
    const tier = await retryAdapter(() => adapters.rep.tierFor(personaId));
    return NextResponse.json({ connection, tier });
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json({ error: err.message }, { status: err.code === "NOT_FOUND" ? 404 : 503 });
  }
}
