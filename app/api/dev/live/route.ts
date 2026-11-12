import { NextResponse } from "next/server";
import { dataSource, isLiveContent, writeEnabled } from "@/lib/adapters/neynar/mode";
import { liveFeed } from "@/lib/adapters/neynar/content";
import { isPublicDeployment } from "@/lib/platform/env-contract";

export const dynamic = "force-dynamic";

/**
 * Diagnostic for the DATA_SOURCE switch. Reports what the server thinks its
 * content source is and whether a live read actually succeeds — the two can
 * disagree, and when they do the timeline quietly serves seeded data while
 * every "is it live?" check that only looks at config says yes.
 */
export async function GET() {
  // BROWSER KEYSTORE PASS Gate 6: a diagnostic is an operator surface. On a PUBLIC deployment it is refused whole,
  // like /api/dev — the environment contract already keeps a live key off such a deployment, but "inert because
  // another rule holds" is weaker than "refused", and this route performs a real network read when a key exists.
  if (isPublicDeployment()) {
    return NextResponse.json({ error: "dev diagnostic refused on a public deployment" }, { status: 403 });
  }
  const out: Record<string, unknown> = {
    dataSource: dataSource(),
    isLive: isLiveContent(),
    writeEnabled: writeEnabled(),
    hasKey: Boolean(process.env.NEYNAR_API_KEY),
    // the misconfiguration detector, SURFACED (it existed but nothing
    // reported it): live requested with no key means every surface is
    // silently serving seed while config says live
    misconfigured: isLiveContent() && !process.env.NEYNAR_API_KEY,
    viewerFid: process.env.NEYNAR_VIEWER_FID ?? "3",
  };
  try {
    const live = await liveFeed(Number(process.env.NEYNAR_VIEWER_FID ?? "3"), 5);
    out.liveFetch = "ok";
    out.stale = live.stale;
    out.count = live.value.length;
    out.sample = live.value.slice(0, 3).map((c) => ({ hash: c.hash, username: c.author.username }));
  } catch (e) {
    out.liveFetch = "threw";
    out.error = (e as Error).message;
  }
  return NextResponse.json(out);
}
