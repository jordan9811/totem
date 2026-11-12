import { NextRequest, NextResponse } from "next/server";
import { roomDetailView, roomsView } from "@/lib/views/spaces";
import { VIEW_NOT_FOUND } from "@/lib/views/types";

export const dynamic = "force-dynamic";

// PROD-LIVE (D-CU-0-4): the /rooms and /rooms/[roomId] pages, as data (hosts and speakers resolved to what the page
// renders). On a public deployment the server cannot read the store — its hydrate needs a device key it refuses to
// mint — so the page renders a shell and its island asks for this; the browser device answers it in-process. The rig
// computes the same view with the same builder on the server.
export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  try {
    if (roomId) {
      const view = await roomDetailView(roomId, { strict: true });
      if (!view) return NextResponse.json({ error: VIEW_NOT_FOUND }, { status: 404 });
      return NextResponse.json(view);
    }
    return NextResponse.json(await roomsView());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "rooms unavailable" }, { status: 503 });
  }
}
