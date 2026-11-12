import { NextRequest, NextResponse } from "next/server";
// PROD-LIVE PASS (D-CU-0-4) — a cast and its thread as the ACTING persona sees them: the persona layer (attribution,
// the granted viewer's merge), the replies, and which replies refute the cast (author-declared, plus curator-attested
// from the feeds THIS persona subscribes to). The permalink page computes exactly this on the rig; on a public
// deployment the browser device answers it, which is also the only place a visitor's own fresh cast exists.
import { hydrate } from "@/lib/adapters/mock/store";
import { threadView } from "@/lib/views/social.server";
import { CAST_MISSING } from "@/lib/views/social";
import { RelayReadError } from "@/lib/adapters/neynar/content";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get("hash");
  if (!hash) return NextResponse.json({ error: "hash required" }, { status: 400 });
  try {
    await hydrate(); // the refutation edges are a direct state() read — never serve pre-hydration emptiness
    const view = await threadView(hash);
    if (!view) return NextResponse.json({ error: CAST_MISSING }, { status: 404 });
    return NextResponse.json(view);
  } catch (e) {
    // FC-READ: a network cast the read relay could not answer is not "no such post" — 503, fixed sentence, code
    // FC-READ (review): `error` is one of lib/views/social.ts LIVE_PAUSED_SENTENCES and `code` is always fc_read_*
    // (never upstream text); ThreadIsland renders that sentence as the paused state (data-testid "live-paused") with
    // a Retry, instead of the generic load-error block
    if (e instanceof RelayReadError) return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    return NextResponse.json({ error: (e as Error).message || "could not read this thread" }, { status: 503 });
  }
}
