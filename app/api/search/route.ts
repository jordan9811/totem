import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/search";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  try {
    // The viewer comes from the server session. A client-supplied viewer
    // would let anyone search as anyone.
    const results = await search(q, activeSeedPersonaId());
    return NextResponse.json(results);
  } catch (e) {
    // PROD-LIVE (review fix): this now includes an unreadable block list — search() throws rather than answering
    // with the viewer's blocked authors back in the results; the island draws search-error with a Retry
    return NextResponse.json({ error: (e as AdapterError)?.message || "search failed" }, { status: 503 });
  }
}
