import { NextRequest, NextResponse } from "next/server";
// PERSONA LAUNCH P1 (SIWF) Gate 1f: SIGN IN WITH FARCASTER (lib/fc/siwf/flow.ts holds the flow and its reasons).
//
// A DEVICE ROUTE: it is in the browser bundle (scripts/device-routes.mjs does NOT list it as server-only), so on the
// public site the visitor's tab answers it in-process and the app server never hears of a sign-in. If a request ever
// reaches a PUBLIC server, the first statement refuses it 404 device_only BEFORE the body is read (the /api/recovery
// precedent): the server holds nothing and must learn nothing, not even that someone tried. On the rig's server
// (ZK_DEV_HOOKS=true, no owner secret) it answers with the fixture network so suites can drive it over HTTP; on the
// owner service it refuses ("Use Settings > Connect your Farcaster account on this service").
//   GET                                          where things stand (a pure read: no network call; never a token,
//                                                a signature or a message)
//   POST {action:"start"}                        a relay channel + the device's own nonce → the QR
//   POST {action:"approval", sessionId}          the sign-in link for the phone button (it carries the channel token,
//                                                so it is asked for, never pushed in the status view)
//   POST {action:"poll", sessionId}              one look at the channel; on completion verify, then record
//   POST {action:"cancel", sessionId}            forget the request
//   POST {action:"disconnect", confirm:"DISCONNECT"}   tombstone the link (the persona is kept, shown disconnected)
//   POST {action:"fixtureApprove", sessionId, ...}     RIG ONLY: approve as if scanned (or doctored, for refusals)
//   POST {action:"miniappStart"}                 PUBLIC GO-LIVE (anonpage): inside a Farcaster Mini App — the device's
//                                                nonce in a session with no relay channel: {sessionId, nonce, expirationTime}
//   POST {action:"miniappFinish", sessionId, message, signature, authMethod?, profile?}   the host's signed answer
//                                                (sdk.actions.signIn), verified and recorded exactly as a relay completion
// Errors carry a fixed sentence, a code and retryable; a log line names the action and the error's NAME only.
import { isPublicDeployment } from "@/lib/platform/env-contract";
import {
  SENTENCES,
  SiwfError,
  cancelSiwf,
  disconnectSiwf,
  finishMiniAppSiwf,
  fixtureApproveSiwf,
  pollSiwf,
  siwfApproval,
  siwfStatus,
  startMiniAppSiwf,
  startSiwf,
} from "@/lib/fc/siwf/flow";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function deviceOnly(): NextResponse {
  return NextResponse.json({ error: SENTENCES.device_only, code: "device_only" }, { status: 404, headers: NO_STORE });
}

function refuse(e: unknown, action: string): NextResponse {
  if (e instanceof SiwfError) return NextResponse.json({ error: e.message, code: e.code, retryable: e.retryable }, { status: e.status, headers: NO_STORE });
  // anything else: a generic answer, and a log line naming the action and the error's NAME only — never a message
  // that might carry a value (a vault, network or library error is not reviewed for secrets)
  console.error(`[siwf] ${action} failed: ${(e as Error)?.name ?? "Error"}`);
  return NextResponse.json({ error: "Sign in with Farcaster failed (an internal error). Nothing was saved; try again.", code: "internal", retryable: true }, { status: 500, headers: NO_STORE });
}

export async function GET() {
  if (typeof window === "undefined" && isPublicDeployment()) return deviceOnly();
  try {
    return NextResponse.json(await siwfStatus(), { headers: NO_STORE });
  } catch (e) {
    return refuse(e, "status");
  }
}

export async function POST(req: NextRequest) {
  // FIRST, before the body is read: a public server never verifies a sign-in, and never reads what was sent to it
  if (typeof window === "undefined" && isPublicDeployment()) return deviceOnly();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: SENTENCES.bad_request, code: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: SENTENCES.bad_request, code: "bad_request" }, { status: 400, headers: NO_STORE });
  const action = String(body.action ?? "");
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const flag = (v: unknown) => v === true;
  const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined);
  try {
    switch (action) {
      case "start":
        // where the sign-in is FOR: this page's own origin (location.origin in the device; the request's host on the rig)
        return NextResponse.json(await startSiwf({ origin: req.nextUrl.origin, host: req.nextUrl.host }), { headers: NO_STORE });
      case "approval":
        return NextResponse.json(await siwfApproval(sessionId), { headers: NO_STORE });
      case "poll":
        return NextResponse.json(await pollSiwf(sessionId), { headers: NO_STORE });
      case "cancel":
        return NextResponse.json(await cancelSiwf(sessionId), { headers: NO_STORE });
      case "miniappStart":
        return NextResponse.json(await startMiniAppSiwf({ origin: req.nextUrl.origin, host: req.nextUrl.host }), { headers: NO_STORE });
      case "miniappFinish":
        return NextResponse.json(
          await finishMiniAppSiwf(sessionId, {
            message: typeof body.message === "string" ? body.message : "",
            signature: typeof body.signature === "string" ? body.signature : "",
            authMethod: typeof body.authMethod === "string" ? body.authMethod : undefined,
            profile: body.profile && typeof body.profile === "object" ? (body.profile as Record<string, unknown>) : null,
          }),
          { headers: NO_STORE }
        );
      case "disconnect":
        return NextResponse.json(await disconnectSiwf(String(body.confirm ?? "")), { headers: NO_STORE });
      case "fixtureApprove":
        return NextResponse.json(
          await fixtureApproveSiwf({
            sessionId,
            fid: count(body.fid),
            wrongFid: flag(body.wrongFid),
            wrongSigner: flag(body.wrongSigner),
            badNonce: flag(body.badNonce),
            badDomain: flag(body.badDomain),
            expired: flag(body.expired),
            authAddress: flag(body.authAddress),
            unregisteredAuthAddress: flag(body.unregisteredAuthAddress),
            relayDown: count(body.relayDown),
            rpcDown: count(body.rpcDown),
          }),
          { headers: NO_STORE }
        );
      default:
        return NextResponse.json({ error: SENTENCES.bad_request, code: "bad_request" }, { status: 400, headers: NO_STORE });
    }
  } catch (e) {
    // the log names a KNOWN action only: the field is the caller's, and a log line must never carry what it sent
    return refuse(e, ["start", "approval", "poll", "cancel", "disconnect", "fixtureApprove", "miniappStart", "miniappFinish"].includes(action) ? action : "unknown");
  }
}
