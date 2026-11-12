import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { syncOwnedReads } from "@/lib/x/sync";
import { SpendCapError } from "@/lib/x/spend";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const kind = body.kind === "follows" ? "follows" : "bookmarks";
  try {
    const result = await syncOwnedReads(activeSeedPersonaId(), kind);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof SpendCapError) {
      return NextResponse.json({ error: e.message, cap: e.cap }, { status: 402 });
    }
    const msg = (e as Error).message ?? "error";
    const refusal = /requires a linked/.test(msg);
    return NextResponse.json({ error: msg }, { status: refusal ? 409 : 503 });
  }
}
