import { NextRequest, NextResponse } from "next/server";
import { buildFeed, debunkSourcesFor } from "@/lib/feed";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

// Mode-aware seeded feed (Waves 1-3). The phase-1 /api/feed route still
// serves the original fixture timeline; this one drives the seeded,
// mode-filtered surface.
export async function GET(req: NextRequest) {
  const surface = (req.nextUrl.searchParams.get("surface") ?? "discovery") as "discovery" | "following";
  try {
    const personaId = activeSeedPersonaId();
    const { cards, mode, contentStale, previewStrip, pinnedHashes, liveSource } = await buildFeed(personaId, { surface });
    // Viewer-aware debunk attribution rides the same payload the timeline
    // consumes — tests assert the data path, not just the render.
    // contentStale (FC Gate 2): live content served from the stale shelf
    // after rate-limit/backoff exhaustion — the UI shows it, never launders it.
    // POST-DEPLOY Gate 3: the delivery tiers' two placement outputs ride the same
    // payload the timeline consumes — the banner tier's strip and which posts the
    // never-miss tier pinned — so they are assertable as DATA and not only as DOM.
    // FC-READ: liveSource — {source: "seed"} whenever this surface does not read through the preview's read relay
    // (the UI shows nothing: deploying with no key changes nothing), {source: "relay", state} on the discovery
    // surface when it does. A paused/stale relay is labelled from THIS field, not from contentStale (whose banner
    // promises a retry on refresh, which a kill switch or a spent budget will not honour). Network cards and their
    // casts carry network:true.
    return NextResponse.json({ cards, mode, contentStale, liveSource, previewStrip, pinnedHashes, debunk: debunkSourcesFor(personaId) });
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
}
