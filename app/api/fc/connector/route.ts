import { NextRequest, NextResponse } from "next/server";
// CONNECTOR SETUP — the connector account C that main's QR connect signs with, created and kept by the owner service
// so the owner never handles a key (lib/fc/connector.server.ts holds the flow and its reasons; the owner drives it
// with scripts/owner/arm-connector.ps1). Owner service only: refused on a public deployment, inside the browser
// device (this file is bundled into it like every route — there it answers 404 and touches nothing), on the laptop
// rig, and — on top of middleware.ts's gate — for any request without a LIVE owner session (checked again here,
// statefully, so a mistake in the gate can never reach the vault write).
//   GET                                          where the setup stands: stage, the custody address, the balance and
//                                                the price (read-only RPC), the fid once registered, the name
//   POST {action:"create"}                       the keys, sealed; the custody ADDRESS comes back (idempotent)
//   POST {action:"register", confirm:"REGISTER"} IdGateway.register from the custody key, once funded (resumable)
//   POST {action:"fname", name}                  optional: a neutral name through the fname registry (free)
// Never in a response: a private key, the Neynar key. Errors carry a code and, when trying again can help,
// retryable:true. Nothing here spends until the owner typed REGISTER.
import { ConnectorError, connectorStatus, createConnector, nameConnector, registerConnector } from "@/lib/fc/connector.server";
import { OWNER_COOKIE, currentOwnerSession, readOwnerSecret } from "@/lib/platform/owner-access";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY_BYTES = 4096;

function refuse(e: unknown, action: string): NextResponse {
  if (e instanceof ConnectorError) return NextResponse.json({ error: e.message, code: e.code, retryable: e.retryable }, { status: e.status, headers: NO_STORE });
  // anything else: a generic answer, and a log line naming the action and the error's NAME only — never a message
  // that might carry a value (a vault, RPC or library error is not reviewed for secrets)
  console.error(`[connector] ${action} failed: ${(e as Error)?.name ?? "Error"}`);
  return NextResponse.json({ error: "The connector step failed on the server (an internal error). Nothing was changed; try again.", code: "internal", retryable: true }, { status: 500, headers: NO_STORE });
}

/** the owner gate's own verdict, re-made here: on a service with an owner secret, only a LIVE session may read or
 *  change the connector (the middleware already refuses strangers; this route never trusts that alone). Without a
 *  secret (the rig, the preview) nothing is checked here — the library's gate refuses those shapes anyway. */
async function ownerRefused(req: NextRequest): Promise<NextResponse | null> {
  const secret = readOwnerSecret();
  if (!secret) return null;
  let value: string | undefined;
  try {
    value = req.cookies.get(OWNER_COOKIE)?.value;
  } catch {
    value = undefined;
  }
  const session = await currentOwnerSession(value, secret);
  if (session) return null;
  return NextResponse.json({ error: "owner login required", code: "owner_login_required" }, { status: 401, headers: NO_STORE });
}

export async function GET(req: NextRequest) {
  if (typeof window !== "undefined") return NextResponse.json({ error: "not here", code: "device" }, { status: 404 });
  const refused = await ownerRefused(req);
  if (refused) return refused;
  try {
    return NextResponse.json(await connectorStatus(), { headers: NO_STORE });
  } catch (e) {
    return refuse(e, "status");
  }
}

export async function POST(req: NextRequest) {
  if (typeof window !== "undefined") return NextResponse.json({ error: "not here", code: "device" }, { status: 404 });
  const refused = await ownerRefused(req);
  if (refused) return refused;
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "body too large", code: "bad_request" }, { status: 413, headers: NO_STORE });
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "malformed JSON body", code: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "malformed JSON body", code: "bad_request" }, { status: 400, headers: NO_STORE });
  const action = String(body.action ?? "");
  try {
    switch (action) {
      case "create":
        return NextResponse.json(await createConnector(), { headers: NO_STORE });
      case "register":
        return NextResponse.json(await registerConnector(String(body.confirm ?? "")), { headers: NO_STORE });
      case "fname":
        return NextResponse.json(await nameConnector(String(body.name ?? "")), { headers: NO_STORE });
      default:
        return NextResponse.json({ error: "unknown action", code: "bad_request" }, { status: 400, headers: NO_STORE });
    }
  } catch (e) {
    return refuse(e, action);
  }
}
