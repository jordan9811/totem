import { NextRequest, NextResponse } from "next/server";
// FOLLOWING FROM THE HUB — the signed-in root's Farcaster graph, read by the visitor's own tab straight from a Farcaster
// node (lib/fc/hubRead/read.ts holds the reads, the cache, the caps and the sentences).
//
// A DEVICE ROUTE: it is in the browser bundle (scripts/device-routes.mjs does NOT list it as server-only), so on the
// public site the visitor's tab answers it in-process and the reads go browser → node. NO SERVER ever answers it: a
// request that reaches any server process (public or rig) is refused 404 device_only BEFORE its body is read, so a
// server never learns a fid or a hash from it. Every op is a POST with its arguments in the body (never in a URL).
//   POST {op:"timeline", want?, refresh?: "auto"|"manual", retry?, waitMs?}   the Following timeline (a snapshot; ask
//                                                                            again while `loading`)
//   POST {op:"count", retry?}                       how many accounts the root follows (the home card)
//   POST {op:"people", offset?, limit?, retry?}     who the root follows, most recently followed first, with profiles
//   POST {op:"thread", fid, hash}                   a cast by its protocol id: what it replies to, and its replies
//   POST {op:"profile", fid}                        an account: its profile and newest casts
//   POST {op:"reacted", refresh?}                   which casts the root has already liked and recast (the cards'
//                                                   pressed state; POST AS YOU on hub cards)
//   POST {op:"notifications", tab?, refresh?: "auto"|"manual", retry?, waitMs?}   NOTIFICATIONS FROM FARCASTER: the root's
//                                                   followers, mentions, replies, likes and recasts, grouped (a snapshot;
//                                                   ask again while `loading`) (lib/fc/hubRead/notifications.ts)
//   POST {op:"unread", refresh?, waitMs?}           the badge's count (no profile read)
//   POST {op:"seen", upTo}                          viewing the page: everything up to `upTo` is seen (the sealed record)
//   POST {op:"foryou", want?, refresh?: "auto"|"manual", retry?, waitMs?}   SPEC B, FOR YOU FROM THE HUB: what the root's
//                                                   follows liked, recast and follow lately, under the root's mode (a
//                                                   snapshot; ask again while `loading`) (lib/fc/hubRead/forYou.ts)
// Errors carry a fixed sentence, a code and retryable; a log line names the op and the error's NAME only.
import { HubReadError, hubFollowsCount, hubPeople, hubProfile, hubReacted, hubThread, hubTimeline } from "@/lib/fc/hubRead/read";
import { hubNotifications, hubNotificationsSeen, hubUnread } from "@/lib/fc/hubRead/notifications";
import { hubForYou } from "@/lib/fc/hubRead/forYou";
import { HUB_READ_SENTENCES } from "@/lib/fc/hubRead/copy";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

function deviceOnly(): NextResponse {
  return NextResponse.json({ error: HUB_READ_SENTENCES.device_only, code: "device_only" }, { status: 404, headers: NO_STORE });
}
function badRequest(): NextResponse {
  return NextResponse.json({ error: HUB_READ_SENTENCES.bad_request, code: "bad_request" }, { status: 400, headers: NO_STORE });
}
function refuse(e: unknown, op: string): NextResponse {
  if (e instanceof HubReadError) return NextResponse.json({ error: e.message, code: e.code, retryable: e.retryable }, { status: e.status, headers: NO_STORE });
  console.error(`[hub-read] ${op} failed: ${(e as Error)?.name ?? "Error"}`);
  return NextResponse.json({ error: "Couldn't read Farcaster's network just now (an internal error). Try again.", code: "internal", retryable: true }, { status: 500, headers: NO_STORE });
}
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export async function GET() {
  // no GET op: identifiers never ride a URL, and a GET reaching a server learns nothing either
  if (typeof window === "undefined") return deviceOnly();
  return badRequest();
}

export async function POST(req: NextRequest) {
  // FIRST, before the body is read: no server reads a visitor's graph
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
      case "timeline": {
        const refresh = body.refresh === "auto" || body.refresh === "manual" ? body.refresh : null;
        return NextResponse.json(await hubTimeline({ want: num(body.want), refresh, retry: body.retry === true, waitMs: num(body.waitMs) }), { headers: NO_STORE });
      }
      case "count":
        return NextResponse.json(await hubFollowsCount({ retry: body.retry === true }), { headers: NO_STORE });
      case "people":
        return NextResponse.json(await hubPeople({ offset: num(body.offset), limit: num(body.limit), retry: body.retry === true }), { headers: NO_STORE });
      case "thread":
        return NextResponse.json(await hubThread(body.fid, body.hash), { headers: NO_STORE });
      case "profile":
        return NextResponse.json(await hubProfile(body.fid), { headers: NO_STORE });
      case "reacted":
        return NextResponse.json(await hubReacted({ refresh: body.refresh === true }), { headers: NO_STORE });
      case "notifications": {
        const refresh = body.refresh === "auto" || body.refresh === "manual" ? body.refresh : null;
        return NextResponse.json(await hubNotifications({ tab: body.tab, refresh, retry: body.retry === true, waitMs: num(body.waitMs) }), { headers: NO_STORE });
      }
      case "unread": {
        const refresh = body.refresh === "auto" || body.refresh === "manual" ? body.refresh : null;
        return NextResponse.json(await hubUnread({ refresh, waitMs: num(body.waitMs) }), { headers: NO_STORE });
      }
      case "seen":
        return NextResponse.json(await hubNotificationsSeen({ upTo: body.upTo }), { headers: NO_STORE });
      case "foryou": {
        const refresh = body.refresh === "auto" || body.refresh === "manual" ? body.refresh : null;
        return NextResponse.json(await hubForYou({ want: num(body.want), refresh, retry: body.retry === true, waitMs: num(body.waitMs) }), { headers: NO_STORE });
      }
      default:
        return badRequest();
    }
  } catch (e) {
    return refuse(e, ["timeline", "count", "people", "thread", "profile", "reacted", "notifications", "unread", "seen", "foryou"].includes(op) ? op : "unknown");
  }
}
