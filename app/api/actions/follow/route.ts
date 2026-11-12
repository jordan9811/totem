import { NextRequest, NextResponse } from "next/server";
// BUILD A — FOLLOW A FARCASTER ACCOUNT, as the acting persona, through the one write door.
//
// /api/follow is the persona-to-persona edge inside Totem (a persona id, the relationship log). This route is the
// other kind: an fid on Farcaster — the author of a live cast on the owner service, the hover card's Follow. It goes
// out ONLY when the acting persona owns its own Farcaster account and real writes are armed
// (app/api/actions/farcasterDelivery.ts); there is no Totem-only follow of an fid, so anything else is refused in
// words ("Not followed — <why>"), never a button that flips to "Following" with nothing recorded.
//
//   POST { targetFid, follow?: boolean (default true), targetHandle?: string (for the sentence only),
//          actingPersonaId?: string (the persona the page was rendered for — refused when it is no longer the acting one) }
//
// Never the shared test account (requireFid), never another of the owner's own accounts or the owner's main account
// (followVerdict, and the write door's own guard), inside the daily follow budget and the actions cap
// (lib/fc/writeLedger.ts). Unfollowing on Farcaster is not wired yet: it is refused with that sentence and changes
// nothing. On a public preview the network-follow refusal answers first (lib/fc/networkTarget.ts).
import { assertWriteAllowed, WriteDisabledError } from "@/lib/adapters/neynar/mode";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { hydrate } from "@/lib/adapters/mock/store";
import { isViewerPersona } from "@/lib/identity/keys";
import { networkFollowRefusal } from "@/lib/fc/networkTarget";
import { followFc } from "@/lib/fc/writes";
import {
  deliveryFor,
  farcasterResult,
  followVerdict,
  forVerb,
  isFarcaster,
  personaChangedResponse,
  sentBefore,
  uncheckedResponse,
  writeErrorResponse,
  type FcDelivery,
} from "../farcasterDelivery";

export const dynamic = "force-dynamic";

/** a handle for the sentence only (it never selects anything): a protocol-shaped name, else nothing */
function handleLabel(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().replace(/^@/, "");
  return /^[a-z0-9][a-z0-9.-]{0,40}$/i.test(s) ? "@" + s : undefined;
}

export async function POST(req: NextRequest) {
  try {
    assertWriteAllowed("follow");
  } catch (e) {
    if (e instanceof WriteDisabledError) return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    throw e;
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  const targetFid = Number(body.targetFid);
  if (!Number.isInteger(targetFid) || targetFid <= 0) return NextResponse.json({ error: "targetFid required" }, { status: 400 });
  const follow = body.follow !== false;
  // FC-READ: a public preview reads the network and never writes to it — refused per target, first
  {
    const refusal = await networkFollowRefusal(targetFid);
    if (refusal) return NextResponse.json(refusal, { status: 403 });
  }
  const acting = activeSeedPersonaId();
  if (!isViewerPersona(acting)) return NextResponse.json({ error: "not one of your personas" }, { status: 403 });
  // PERSONA LAUNCH P1 (SIWF), belt and braces: never a follow AS the read-only public self
  {
    const { publicSelfRefusalFor } = await import("@/lib/identity/handleStem");
    const { getPersona } = await import("@/lib/identity/keystore");
    const who = acting;
    const refusal = publicSelfRefusalFor(() => (who ? getPersona(who) : null));
    if (refusal) return NextResponse.json(refusal, { status: 403 });
  }
  const target = handleLabel(body.targetHandle) ?? `fid ${targetFid}`;

  let delivery: FcDelivery;
  try {
    delivery = await deliveryFor(acting);
  } catch (e) {
    return uncheckedResponse(e, "this persona's Farcaster account");
  }
  if (!isFarcaster(delivery)) {
    const d = forVerb(delivery, "follow");
    return NextResponse.json({ error: d.message, code: "FC_NOT_SENT", delivery: d }, { status: 409 });
  }
  const d = delivery;
  // BUILD A review (PUB-1): the button names the persona its page was rendered for; another tab may have switched the
  // shared acting-persona cookie since — a follow is public, so it is never made as someone the page did not show
  if (follow) {
    const changed = personaChangedResponse(body.actingPersonaId, acting);
    if (changed) return changed;
  }
  try {
    await hydrate(); // the ledger is read directly
    const v = await followVerdict(targetFid, d);
    if (v.verdict === "refuse") return NextResponse.json({ error: v.message, code: v.code }, { status: v.status });
  } catch (e) {
    return uncheckedResponse(e, "whose account that is");
  }
  const already = sentBefore("follow", d, { targetFid });
  if (!follow) {
    return NextResponse.json(
      {
        error: already
          ? "Unfollowing on Farcaster isn't available from Totem yet — nothing changed. Unfollow in a Farcaster app."
          : `Nothing to undo — @${d.handle} hasn't followed ${target} from Totem, and unfollowing on Farcaster isn't available from Totem yet.`,
        code: "FC_UNDO_UNSUPPORTED",
      },
      { status: 409 }
    );
  }
  if (!already) {
    try {
      await followFc(targetFid, { personaId: acting, requireFid: d.fid, requireMode: d.mode });
    } catch (e) {
      return writeErrorResponse(e, "follow");
    }
  }
  return NextResponse.json({ ok: true, following: true, delivery: farcasterResult(d, "follow", { already, target }) });
}
