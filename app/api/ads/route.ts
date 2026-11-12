import { NextRequest, NextResponse } from "next/server";
// ADS, PHASE 1 — the ad planner, answered by the visitor's own tab (lib/ads/plan.ts holds the decisions; SECURITY-POSTURE.md
// §41 says what each party sees).
//
// A DEVICE ROUTE: it is in the browser bundle (scripts/device-routes.mjs does not list it as server-only), so on the
// public site the tab answers it in-process and nothing about it leaves the browser. NO SERVER ever answers it: a request
// that reaches any server process is refused 404 device_only BEFORE its body is read, so a server never learns a page's
// post hashes, a mode, an ad or a hide from it. Every op is a POST with its arguments in the body (never in a URL).
//   POST {op:"plan", placement: "following"|"forYou", modeId, posts: [hash…]}   the page's rows: posts, and ads at their
//                                                                             slots, with "Why this ad"
//   POST {op:"hide", what: "ad"|"advertiser", lot, actor}       hide that lot, or every lot of its advertiser, for the
//                                                               identity the ad was shown to (the plan's actor tag)
//   POST {op:"unhide", what: "ad"|"advertiser", id, actor}      the card's Undo
//   POST {op:"hidden"}                                          what the acting identity hid (Settings, Modes)
//   POST {op:"showAll", actor}                                  show everything it hid again
// Errors carry a fixed sentence and a code; a log line names the op and the error's NAME only.
import { AD_SENTENCES, AdPlanError, adHidden, adHide, adPlan, adShowAll, adUnhide } from "@/lib/ads/plan";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };
const DEVICE_ONLY = "Ads are picked by your browser's device, never by a server.";

function deviceOnly(): NextResponse {
  return NextResponse.json({ error: DEVICE_ONLY, code: "device_only" }, { status: 404, headers: NO_STORE });
}
function badRequest(): NextResponse {
  return NextResponse.json({ error: AD_SENTENCES.badRequest, code: "bad_request" }, { status: 400, headers: NO_STORE });
}

export async function GET() {
  if (typeof window === "undefined") return deviceOnly();
  return badRequest();
}

export async function POST(req: NextRequest) {
  // FIRST, before the body is read: no server decides, or learns, a visitor's ads
  if (typeof window === "undefined") return deviceOnly();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest();
  }
  if (!body || typeof body !== "object") return badRequest();
  const op = String(body.op ?? "");
  try {
    switch (op) {
      case "plan":
        return NextResponse.json(await adPlan(body), { headers: NO_STORE });
      case "hide":
        return NextResponse.json(await adHide(body), { headers: NO_STORE });
      case "unhide":
        return NextResponse.json(await adUnhide(body), { headers: NO_STORE });
      case "hidden":
        return NextResponse.json(await adHidden(), { headers: NO_STORE });
      case "showAll":
        return NextResponse.json(await adShowAll(body), { headers: NO_STORE });
      default:
        return badRequest();
    }
  } catch (e) {
    if (e instanceof AdPlanError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status, headers: NO_STORE });
    console.error(`[ads] ${["plan", "hide", "unhide", "hidden", "showAll"].includes(op) ? op : "unknown"} failed: ${(e as Error)?.name ?? "Error"}`);
    return NextResponse.json({ error: "Couldn't place ads just now (an internal error), so none are shown.", code: "internal" }, { status: 500, headers: NO_STORE });
  }
}
