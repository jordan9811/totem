import { NextRequest, NextResponse } from "next/server";
// POST AS YOU — "Allow Totem to post as you" and posting as the visitor's own Farcaster account (lib/fc/rootSigner/flow.ts
// holds the flow and its sentences).
//
// A DEVICE ROUTE: it is in the browser bundle (scripts/device-routes.mjs does NOT list it as server-only), so on the public
// site the visitor's tab answers it in-process. NO SERVER ever answers it: the root's posting key lives in the visitor's
// vault and is used in their tab only, so a request that reaches any server process (public or rig) is refused 404
// device_only BEFORE its body is read.
//   GET                                        where things stand: signed in, the site armed, none | pending | active,
//                                              the approval link + QR while pending, the public key (never the private)
//   POST {action:"start"}                      make the key, seal it, ask Farcaster for the approval (or resume one)
//   POST {action:"poll"}                       one look at the approval; enables the key only when YOUR account approved
//                                              it and Farcaster's network lists it
//   POST {action:"cancel"}                     forget a pending request
//   POST {action:"disconnect", confirm:"DISCONNECT"}   forget the key here (and say how to remove it in the Farcaster app)
//   POST {action:"cast", text, parent?}        post as you (parent = {fid, hash}: a reply)
//   POST {action:"delete", hash}               delete one of your casts
//   POST {action:"react", reaction, target, remove?}   like / recast (or undo)
// Errors carry a fixed sentence, a code and retryable; a log line names the action and the error's NAME only.
import {
  RootPostError,
  SENTENCES,
  cancelRootPost,
  castAsRoot,
  deleteAsRoot,
  disconnectRootPost,
  pollRootPost,
  reactAsRoot,
  rootPostStatus,
  startRootPost,
} from "@/lib/fc/rootSigner/flow";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

function deviceOnly(): NextResponse {
  return NextResponse.json({ error: SENTENCES.device_only, code: "device_only" }, { status: 404, headers: NO_STORE });
}
function refuse(e: unknown, action: string): NextResponse {
  if (e instanceof RootPostError) return NextResponse.json({ error: e.message, code: e.code, retryable: e.retryable }, { status: e.status, headers: NO_STORE });
  console.error(`[post-as-you] ${action} failed: ${(e as Error)?.name ?? "Error"}`);
  return NextResponse.json({ error: "Posting as you failed (an internal error). Nothing was sent; try again.", code: "internal", retryable: true }, { status: 500, headers: NO_STORE });
}
const castId = (v: unknown): { fid: number; hash: string } | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return Number.isSafeInteger(o.fid) && typeof o.hash === "string" ? { fid: o.fid as number, hash: o.hash.toLowerCase() } : null;
};

export async function GET() {
  if (typeof window === "undefined") return deviceOnly();
  try {
    return NextResponse.json(await rootPostStatus(), { headers: NO_STORE });
  } catch (e) {
    return refuse(e, "status");
  }
}

export async function POST(req: NextRequest) {
  // FIRST, before the body is read: no server holds or uses the root's key
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
        return NextResponse.json(await startRootPost(), { headers: NO_STORE });
      case "poll":
        return NextResponse.json(await pollRootPost(), { headers: NO_STORE });
      case "cancel":
        return NextResponse.json(await cancelRootPost(), { headers: NO_STORE });
      case "disconnect":
        return NextResponse.json(await disconnectRootPost(String(body.confirm ?? "")), { headers: NO_STORE });
      case "cast":
        return NextResponse.json(await castAsRoot(typeof body.text === "string" ? body.text : "", body.parent ? castId(body.parent) ?? { fid: 0, hash: "" } : null), { headers: NO_STORE });
      case "delete":
        return NextResponse.json(await deleteAsRoot(typeof body.hash === "string" ? body.hash.toLowerCase() : ""), { headers: NO_STORE });
      case "react": {
        const target = castId(body.target);
        const reaction = body.reaction === "like" || body.reaction === "recast" ? body.reaction : null;
        if (!target || !reaction) return NextResponse.json({ error: SENTENCES.bad_request, code: "bad_request" }, { status: 400, headers: NO_STORE });
        return NextResponse.json(await reactAsRoot(reaction, target, body.remove === true), { headers: NO_STORE });
      }
      default:
        return NextResponse.json({ error: SENTENCES.bad_request, code: "bad_request" }, { status: 400, headers: NO_STORE });
    }
  } catch (e) {
    return refuse(e, ["start", "poll", "cancel", "disconnect", "cast", "delete", "react"].includes(action) ? action : "unknown");
  }
}
