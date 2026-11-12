import { NextRequest, NextResponse } from "next/server";
// PERSONA LAUNCH P2 (BYX G5-lite) — FIND YOUR PEOPLE: which of the accounts you follow on X are on Farcaster.
// A DEVICE route (answered in the tab by the browser device on a public deployment): the follow list and the matches
// live in the sealed xFollows document and the index is downloaded whole, so nothing about who you follow reaches a
// server. GET answers the stored matches and the index's status; POST {action:"rematch", force?} ("Check again")
// downloads the index and matches again. The follow queue (Keep / Queue / Follow) is a later wave (BYX G5).
//
// Failure is never "0 matches": an index the site has not built answers {index:{available:false}} (the panel says the
// list is not available here), and an unreadable follow list or vault answers 503 with the reason.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { matchStatus, rematch } from "@/lib/x/match";
import { ChunkReadError } from "@/lib/vault/chunkedDoc";
import { PersistError } from "@/lib/adapters/mock/persist";

export const dynamic = "force-dynamic";

/** PERSONA LAUNCH P2 (review UX-10): who matched and keeps the list — the in-tab device on a public deployment (this
 *  route answered in the tab, where `window` is defined) or the server of a single-owner service / the rig. The panel
 *  says where the follow list lives from it, never "never sent anywhere" (a sealed copy is stored either way). */
const savedBy = (): "device" | "service" => (typeof window === "undefined" ? "service" : "device");

function failure(e: unknown) {
  const msg = (e as Error)?.message || "the match could not be computed";
  if (e instanceof ChunkReadError) return NextResponse.json({ error: msg, code: "unreadable" }, { status: 503 });
  if (e instanceof PersistError) return NextResponse.json({ error: `Couldn't save the matches: ${msg}`, code: "save_failed" }, { status: 503 });
  return NextResponse.json({ error: msg }, { status: 503 });
}

export async function GET() {
  try {
    return NextResponse.json({ ...(await matchStatus(activeSeedPersonaId())), savedBy: savedBy() });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: NextRequest) {
  let body: { action?: unknown; force?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* an empty body is a plain rematch */
  }
  if (body.action !== undefined && body.action !== "rematch") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  try {
    return NextResponse.json({ ...(await rematch(activeSeedPersonaId(), { force: body.force === true })), savedBy: savedBy() });
  } catch (e) {
    return failure(e);
  }
}
