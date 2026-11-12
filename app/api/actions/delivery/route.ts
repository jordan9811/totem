import { NextRequest, NextResponse } from "next/server";
// BUILD A — WHERE A POST GOES, asked BEFORE the click (the Composer's line under the box: "Posts to Farcaster as @x —
// public" or "Saved in Totem only — <why>"). A public, permanent post is a decision worth seeing before it is made.
//
//   GET  ?replyTo=<hash>  the acting persona's answer (app/api/actions/farcasterDelivery.ts deliveryFor), and for a
//        reply whether the post being replied to is on Farcaster (a probe: no live author lookup, no credits — the
//        post itself runs the full check, including the refusals). Writes off answers with no I/O.
//   POST { action: "fixtureDelivery", on }  TEST RIG ONLY: send the buttons through the write door on the SIMULATED
//        network for personas with a fixture account (scripts/accept-fc-buttons.mjs). Refused unless ZK_DEV_HOOKS=true,
//        and refused while real writes are armed, on the owner service, under LAYERS_WORLD=empty and under live content.
//        A seed reset disarms it.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { hydrate } from "@/lib/adapters/mock/store";
import {
  classifyTarget,
  deliveryFor,
  fixtureDeliveryArmed,
  isFarcaster,
  layersOnly,
  lineFor,
  setFixtureDelivery,
  uncheckedResponse,
  type FcDelivery,
} from "../farcasterDelivery";

export const dynamic = "force-dynamic";

// BUILD A review (PUB-1): the answer carries personaId and fid (the persona and the account the line names); the
// Composer sends them back with the post, and /api/actions/cast refuses the post if they no longer match. The Composer
// asks again on focus and when its tab becomes visible, so a line left open in another tab is refreshed before use.
export async function GET(req: NextRequest) {
  const replyTo = req.nextUrl.searchParams.get("replyTo");
  let delivery: FcDelivery;
  try {
    delivery = await deliveryFor(activeSeedPersonaId());
    if (isFarcaster(delivery) && replyTo) {
      await hydrate(); // the attribution index is read directly
      const t = await classifyTarget(replyTo, delivery, { probe: true });
      if (t.verdict === "layers") delivery = lineFor(layersOnly(delivery, t.reason, "reply"), true);
      else if (t.verdict === "refuse") delivery = { ...delivery, refused: true, message: t.message };
      else delivery = lineFor(delivery, true);
    }
  } catch (e) {
    return uncheckedResponse(e, "where this posts");
  }
  return NextResponse.json({ delivery, fixtureDelivery: fixtureDeliveryArmed() });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || body.action !== "fixtureDelivery")
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const r = setFixtureDelivery(body.on === true);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 403 });
  return NextResponse.json({ ok: true, fixtureDelivery: r.armed });
}
