import { NextRequest, NextResponse } from "next/server";
// PROD-LIVE PASS (D-CU-0-4) — the relationship-history tab for one account, from the viewer's OWN log (CALL OPTION B).
// Part of the event-log endpoint family on purpose: event-log material is served here and at /api/eventlog and
// nowhere else. The actor comes from the session exactly as /api/eventlog's does — there is no way to name someone
// else's log. The profile page computes this on the rig; on a public deployment the browser device answers it.
//
// A failed log read answers 200 with `status: "error"` (the tab renders the failure and a Retry) — the same view
// the rig's server render produces — so the island has one shape to draw either way.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { relationshipHistoryView } from "@/lib/views/social.server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("target");
  if (!target) return NextResponse.json({ error: "target required" }, { status: 400 });
  try {
    return NextResponse.json(await relationshipHistoryView(activeSeedPersonaId(), target));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "could not read your relationship history" }, { status: 503 });
  }
}
