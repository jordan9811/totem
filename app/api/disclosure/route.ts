import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { SEED_VIEWER } from "@/lib/adapters/mock/store";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const personaId = req.nextUrl.searchParams.get("personaId") ?? activeSeedPersonaId();
  const viewerId = req.nextUrl.searchParams.get("viewerPersonaId");
  try {
    const [grant, canView, requests] = await Promise.all([
      retryAdapter(() => adapters.disclosure.getGrant(personaId)),
      retryAdapter(() => adapters.disclosure.canViewLinkage(personaId, viewerId ?? activeSeedPersonaId())),
      retryAdapter(() => adapters.disclosure.listUnlockRequests(personaId)),
    ]);
    // GATE 5 (attack-post-1 F-3): `ownPersonas` is the sibling set by another name — and the
    // residual the verifier found: filtering that ONE FIELD changed nothing, because the
    // `personaId` query param was never checked either, so a sibling's grant (whose
    // innerCircleViewerIds is itself a list of persona ids) came back through a field the
    // filter does not touch. Both halves are scoped now.
    const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
    const visible = new Set(await visibleOwnPersonaIds());
    if (personaId && !visible.has(personaId))
      return NextResponse.json({ error: "not a persona in this device's current scope", code: "out_of_scope" }, { status: 403 });
    return NextResponse.json({
      grant,
      canViewLinkage: canView,
      requests,
      ownPersonas: SEED_VIEWER.personas.filter((id) => visible.has(id)),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const { personaId, level, innerCircleViewerIds } = await req.json();
  try {
    const grant = await retryAdapter(() => adapters.disclosure.setGrant(
      personaId ?? activeSeedPersonaId(),
      level,
      innerCircleViewerIds
    ));
    return NextResponse.json({ grant });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
