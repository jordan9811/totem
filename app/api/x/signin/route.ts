import { NextRequest, NextResponse } from "next/server";
// SIGN IN WITH X (2026-11-06): the device route (lib/x/signin/flow.ts holds the flow and its sentences).
//
// A DEVICE ROUTE: it is in the browser bundle (scripts/device-routes.mjs does NOT list it as server-only), so on the public
// site the visitor's tab answers it in-process and the app server never hears of a sign-in. If a request ever reaches a
// PUBLIC server, the first statement refuses it 404 device_only BEFORE the body is read (the /api/fc/siwf precedent). The
// rig and the owner service are not offered it: their servers answer device_only too (no hint reaches their pages).
//   GET                                          where things stand (a pure read: no network call; never a code, a
//                                                verifier or a state)
//   POST {action:"start"}                        a fresh verifier + state, kept in THIS TAB's sessionStorage → the
//                                                authorize URL (the card keeps the identity first, then navigates there)
//   POST {action:"finish", search}               the callback page's query: the stored request read AND removed, the
//                                                state checked, the code redeemed through the validator's relay, recorded
//   POST {action:"cancel"}                       forget the request in flight
//   POST {action:"disconnect", confirm:"DISCONNECT"}   tombstone the X link (the public self is kept)
// Errors carry a fixed sentence, a code and retryable; a log line names the action and the error's NAME only.
import { SENTENCES, XsiError, cancelXsi, disconnectXsi, finishXsi, startXsi, xsiStatus } from "@/lib/x/signin/flow";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function deviceOnly(): NextResponse {
  return NextResponse.json({ error: SENTENCES.device_only, code: "device_only" }, { status: 404, headers: NO_STORE });
}

function refuse(e: unknown, action: string): NextResponse {
  if (e instanceof XsiError) return NextResponse.json({ error: e.message, code: e.code, retryable: e.retryable }, { status: e.status, headers: NO_STORE });
  // anything else: a generic answer, and a log line naming the action and the error's NAME only — never a message that
  // might carry a value (a vault, network or library error is not reviewed for secrets)
  console.error(`[x-signin] ${action} failed: ${(e as Error)?.name ?? "Error"}`);
  return NextResponse.json({ error: "Sign in with X failed (an internal error). Nothing was saved; try again.", code: "internal", retryable: true }, { status: 500, headers: NO_STORE });
}

export async function GET() {
  if (typeof window === "undefined") return deviceOnly();
  try {
    return NextResponse.json(await xsiStatus(), { headers: NO_STORE });
  } catch (e) {
    return refuse(e, "status");
  }
}

export async function POST(req: NextRequest) {
  // FIRST, before the body is read: no server ever handles a sign-in, and none reads what was sent to it
  if (typeof window === "undefined") return deviceOnly();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: SENTENCES.bad_request, code: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: SENTENCES.bad_request, code: "bad_request" }, { status: 400, headers: NO_STORE });
  const action = String(body.action ?? "");
  try {
    switch (action) {
      case "start":
        return NextResponse.json(await startXsi({ origin: req.nextUrl.origin }), { headers: NO_STORE });
      case "finish":
        return NextResponse.json(await finishXsi({ origin: req.nextUrl.origin, search: typeof body.search === "string" ? body.search.slice(0, 4096) : "" }), { headers: NO_STORE });
      case "cancel":
        return NextResponse.json(await cancelXsi(), { headers: NO_STORE });
      case "disconnect":
        return NextResponse.json(await disconnectXsi(String(body.confirm ?? "")), { headers: NO_STORE });
      default:
        return NextResponse.json({ error: SENTENCES.bad_request, code: "bad_request" }, { status: 400, headers: NO_STORE });
    }
  } catch (e) {
    // the log names a KNOWN action only: the field is the caller's, and a log line must never carry what it sent
    return refuse(e, ["start", "finish", "cancel", "disconnect"].includes(action) ? action : "unknown");
  }
}
