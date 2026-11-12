import { NextRequest, NextResponse } from "next/server";
import { getFeed } from "@/lib/data";
import { applyFeedPolicy } from "@/lib/policy";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get("tab") || "foryou";
  const page = Number(req.nextUrl.searchParams.get("page") || "0");
  const { casts, nextPage, liveSource } = await getFeed(tab, page);
  const session = await getSession();
  const surface = tab === "following" ? "following" : "discovery";
  const filtered = await applyFeedPolicy(casts, { surface, viewer: session.active, own: session.personas.map((p) => p.id) });
  // FC-READ: liveSource rides the payload the timeline consumes — {source: "seed"} whenever this tab does not read
  // through the relay (the UI then shows nothing), {source: "relay", state} when it does, so a paused or stale
  // relay is LABELLED on the page rather than silently swapped for preview content. Relayed casts carry network:true.
  return NextResponse.json({ casts: filtered, nextPage, liveSource });
}
