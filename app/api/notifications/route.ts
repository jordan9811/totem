import { NextRequest, NextResponse } from "next/server";
// PROD-LIVE PASS (D-CU-0-4) — the notifications list for one tab, with the ACTIVE mode's notificationPolicy applied.
// The page computes exactly this on the rig; on a public deployment the mode is the visitor's, so the browser device
// answers this route. A mode that could not be read is reported (policyError), never silently treated as "all".
import { notificationsView } from "@/lib/views/social.server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get("tab") || "all";
  try {
    return NextResponse.json(await notificationsView(tab));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "could not read notifications" }, { status: 503 });
  }
}
