import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { channelDetailView, channelsView } from "@/lib/views/spaces";
import { VIEW_NOT_FOUND } from "@/lib/views/types";

export const dynamic = "force-dynamic";

// PROD-LIVE (D-CU-0-4): the /channels and /channels/[channelId] pages, as data. On a public deployment the server
// has no identity, so the page renders a shell and its island asks for this; the browser device answers it
// in-process against the visitor's own memberships. The rig computes the same view with the same builder.
//
// THE GATE holds here as on the page: a membership check that errors is not membership — the view comes back locked
// with `checkFailed`, never open. A channel that cannot be read at all answers 503, not an empty channel.
export async function GET(req: NextRequest) {
  const personaId = activeSeedPersonaId();
  const channelId = req.nextUrl.searchParams.get("channelId");
  try {
    if (channelId) {
      const view = await channelDetailView(channelId, personaId, { strict: true });
      if (!view) return NextResponse.json({ error: VIEW_NOT_FOUND }, { status: 404 });
      return NextResponse.json(view);
    }
    return NextResponse.json(await channelsView(personaId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "channels unavailable" }, { status: 503 });
  }
}
