import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { algoDetailView } from "@/lib/views/algo";
import { VIEW_NOT_FOUND } from "@/lib/views/types";

export const dynamic = "force-dynamic";

// PROD-LIVE (D-CU-0-4): the /algo/[cardId] page — THE MANDATORY PREVIEW — as data: the card, and the exact
// hides/boosts/mutes it would have on THIS viewer's current feed. The preview is a feed build for the viewer, so on a
// public deployment only the browser device can compute it (it answers this in-process); the rig computes the same
// view with the same builder on the server.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const view = await algoDetailView(id, activeSeedPersonaId());
    if (!view) return NextResponse.json({ error: VIEW_NOT_FOUND }, { status: 404 });
    return NextResponse.json(view);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "preview unavailable" }, { status: 503 });
  }
}
