import { NextRequest, NextResponse } from "next/server";
import { state } from "@/lib/adapters/mock/store";
import { getAlgoCard } from "@/lib/algo/service";

export const dynamic = "force-dynamic";

/** Published algo cards: all of them, or one by id. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const card = getAlgoCard(id);
    if (!card) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ card });
  }
  return NextResponse.json({ cards: [...state().algoCards.values()] });
}
