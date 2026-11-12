import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { roomId, messageId } = await req.json();
  if (!roomId || !messageId)
    return NextResponse.json({ error: "roomId and messageId required" }, { status: 400 });
  try {
    const highlight = await retryAdapter(() => adapters.space.markHighlight(roomId, messageId));
    const highlights = await retryAdapter(() => adapters.space.listHighlights(roomId));
    return NextResponse.json({ highlight, highlights });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
