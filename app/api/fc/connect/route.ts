import { NextRequest, NextResponse } from "next/server";
// CONNECT MAIN — the owner's existing Farcaster account, connected by QR (lib/fc/connect.ts holds the flow and its
// reasons). Owner service only: refused on a public deployment and inside the browser device (this file is bundled
// into it like every route — there it answers 404 and touches nothing); the laptop rig runs the fixture network.
//   GET                          where things stand: availability, the connector, the connected account, the request
//   POST {action:"start", handle}            resolve main, create the signer, register the key request → QR + link
//   POST {action:"poll", sessionId}          one look at the signer (pending / approved / wrong account / revoked / expired)
//   POST {action:"finish", sessionId}        re-read the approval, read the chain, mint main's persona, record it
//   POST {action:"cancel", sessionId}        drop a request that was not approved
//   POST {action:"disconnect", confirm:"DISCONNECT"}   Totem forgets main's signer (the Farcaster app removes the key)
//   POST {action:"fixtureApprove", sessionId, ...}     RIG ONLY: approve as if scanned (or as the wrong account)
// Never in a response: the signer uuid, the connector's key, the Neynar key. Errors carry a code and, when trying
// again can help, retryable:true. Writes after connecting go through the one write door (/api/fc/write), where the
// identity rule's "connected" branch and the self-link guard live (lib/fc/writes.ts).
// CONNECTOR SETUP: the connector account itself (created, funded, registered and named without the owner handling a
// key) is the sibling route /api/fc/connector (lib/fc/connector.server.ts); GET here reports which connector signs
// (`connector.source`: env, sealed or fixture) and the sealed setup's public state (`connector.setup`).
import { ConnectError, cancelConnect, connectStatus, disconnectMain, finishConnect, fixtureApprove, pollConnect, startConnect } from "@/lib/fc/connect";
import { ConnectRecordRefusal } from "@/lib/fc/personaFid";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function refuse(e: unknown, action: string): NextResponse {
  if (e instanceof ConnectError) return NextResponse.json({ error: e.message, code: e.code, retryable: e.retryable }, { status: e.status, headers: NO_STORE });
  if (e instanceof ConnectRecordRefusal) return NextResponse.json({ error: e.message, code: e.code, retryable: false }, { status: 409, headers: NO_STORE });
  // anything else: a generic answer, and a log line naming the action and the error's NAME only — never a message that
  // might carry a value (a vault, network or library error is not reviewed for secrets)
  console.error(`[connect] ${action} failed: ${(e as Error)?.name ?? "Error"}`);
  return NextResponse.json({ error: "Connecting failed on the server (an internal error). Nothing was recorded; try again.", code: "internal", retryable: true }, { status: 500, headers: NO_STORE });
}

export async function GET() {
  if (typeof window !== "undefined") return NextResponse.json({ error: "not here", code: "device" }, { status: 404 });
  try {
    return NextResponse.json(await connectStatus(), { headers: NO_STORE });
  } catch (e) {
    return refuse(e, "status");
  }
}

export async function POST(req: NextRequest) {
  if (typeof window !== "undefined") return NextResponse.json({ error: "not here", code: "device" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "malformed JSON body", code: "bad_request" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "malformed JSON body", code: "bad_request" }, { status: 400 });
  const action = String(body.action ?? "");
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const num = (v: unknown): number | undefined => (v === undefined || v === null || v === "" ? undefined : Number(v));
  try {
    switch (action) {
      case "start":
        return NextResponse.json(await startConnect({ handle: String(body.handle ?? "") }), { headers: NO_STORE });
      case "poll":
        return NextResponse.json(await pollConnect(sessionId), { headers: NO_STORE });
      case "finish":
        return NextResponse.json(await finishConnect(sessionId), { headers: NO_STORE });
      case "cancel":
        return NextResponse.json(await cancelConnect(sessionId), { headers: NO_STORE });
      case "disconnect":
        return NextResponse.json(await disconnectMain(String(body.confirm ?? "")), { headers: NO_STORE });
      case "fixtureApprove":
        return NextResponse.json(
          await fixtureApprove({
            sessionId,
            fid: num(body.fid),
            status: typeof body.status === "string" ? body.status : undefined,
            requestFid: num(body.requestFid),
            submittedBy: typeof body.submittedBy === "string" ? body.submittedBy : undefined,
            requestSigner: typeof body.requestSigner === "string" ? body.requestSigner : undefined,
          }),
          { headers: NO_STORE }
        );
      default:
        return NextResponse.json({ error: "unknown action", code: "bad_request" }, { status: 400 });
    }
  } catch (e) {
    return refuse(e, action);
  }
}
