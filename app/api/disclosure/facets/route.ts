import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";
import { eventIdempotencyKey, logEdgeEvent } from "@/lib/eventlog/log";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const personaId = req.nextUrl.searchParams.get("personaId");
  try {
    const [facets, followed] = await Promise.all([
      personaId ? retryAdapter(() => adapters.persona.listFacets(personaId)) : Promise.resolve([]),
      retryAdapter(() => adapters.disclosure.followedFacets(activeSeedPersonaId())),
    ]);
    return NextResponse.json({ facets, followed });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { facetId, follow } = body;
  if (!facetId) return NextResponse.json({ error: "facetId required" }, { status: 400 });
  try {
    const viewer = activeSeedPersonaId();
    if (follow) await retryAdapter(() => adapters.disclosure.followFacet(viewer, facetId));
    else await retryAdapter(() => adapters.disclosure.unfollowFacet(viewer, facetId));
    // Facet follows are graph edges too — the "follow just part of this
    // account" mechanic — so they are logged with the same receipts.
    await logEdgeEvent({
      type: follow ? "facet_follow" : "facet_unfollow",
      actorPersonaId: viewer,
      targetPersona: facetId,
      context: body.context ?? "profile",
      idempotencyKey: eventIdempotencyKey(req, body),
    });
    const followed = await retryAdapter(() => adapters.disclosure.followedFacets(viewer));
    return NextResponse.json({ followed });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
