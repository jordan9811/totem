import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";
import { marketClock } from "@/lib/adapters/mock/clock";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  try {
    if (roomId) {
      const room = await retryAdapter(() => adapters.space.getRoom(roomId));
      if (!room) return NextResponse.json({ error: "unknown room" }, { status: 404 });
      const [messages, highlights] = await Promise.all([
        retryAdapter(() => adapters.space.roomMessages(roomId)),
        retryAdapter(() => adapters.space.listHighlights(roomId)),
      ]);
      return NextResponse.json({ room, messages, highlights, now: marketClock.now() });
    }
    const rooms = await retryAdapter(() => adapters.space.listRooms());
    return NextResponse.json({ rooms });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { roomId, action } = body;
  if (!roomId || !action) return NextResponse.json({ error: "roomId and action required" }, { status: 400 });
  try {
    switch (action) {
      case "open":
        return NextResponse.json({ room: await retryAdapter(() => adapters.space.openRoom(roomId)) });
      case "close":
        return NextResponse.json({ room: await retryAdapter(() => adapters.space.closeRoom(roomId)) });
      case "pin":
        return NextResponse.json({
          room: await retryAdapter(() => adapters.space.pinMessage(roomId, body.messageId ?? null)),
        });
      case "mute":
        return NextResponse.json({
          room: await retryAdapter(() =>
            adapters.space.muteParticipant(roomId, body.personaId, !!body.muted)
          ),
        });
      case "advanceClock":
        // Dev/test control: jump the room script forward without waiting.
        marketClock.advance(Number(body.ms ?? 0));
        return NextResponse.json({ now: marketClock.now() });
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
