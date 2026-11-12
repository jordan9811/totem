import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// PERSONA LAUNCH P8 — "ALSO POST TO @totem ON X", the anonymous X outbox (test data: nothing reaches X).
//
// GET                    whether a copy can go to @totem on X HERE (and why not, in plain words), the client's K_X, the
//                        outbox's config and queue counts as the last tick read them, this device's copies with where
//                        each one is ("waiting for review", "approved — goes out in the next X slot", "posted (test data
//                        — nothing reached X)", "not approved"), and this device's moderator key. ?xHash= for one copy.
//                        Every answer carries testData: true.
// POST {text, personaId?, copyOf?}          queue a copy (lib/zk/gate.ts requestXAnonPost): every refusal before
//                        anything is minted or written; the copy is proved at the next tick and sent over the anonymous
//                        channel at a random moment. The composer sends it AFTER its anonymous post was accepted (202) —
//                        a refusal here keeps that post and says why.
// POST {action:"moderate", id, decision}    the moderator's decision, signed on this device (an identified act by
//                        design); the validator verifies it against the PUBLIC moderator keys it was given.
// POST {action:"review"}                    the moderator's signed read of the texts waiting for a decision.
// RIG ONLY (ZK_DEV_HOOKS=true, and never under LAYERS_WORLD=empty — the owner service's validator is real):
//   {action:"registerModerator"}  this device's moderator key as a dev moderator on the rig's validator
//   {action:"relayNow"}           the outbox's relay now (approved rows only, through the fixture transport)
//   {action:"transportLog"}       what the fixture transport "posted" (destination: fixture, always)
//   {action:"readOutbox"}         read the outbox now, outside the schedule (the rig's tick-now)
//   {action:"submit", force:true} a copy past the client's X slot check, so the VALIDATOR refuses it as a replay
//
// NO node-only import at module top: the route is bundled into the browser device (lib/device/routes.generated.ts), where
// it answers that a copy to X is not offered on the public preview (D-X-PUBLIC-OFF) before loading anything else.

async function devAllowed(): Promise<string | null> {
  if (process.env.ZK_DEV_HOOKS !== "true") return "this is a test-rig action — refused unless ZK_DEV_HOOKS=true";
  if ((await import("@/lib/world-flag")).isEmptyWorld()) return "refused under LAYERS_WORLD=empty — the owner service's outbox is not a test rig";
  return null;
}

export async function GET(req: NextRequest) {
  try {
    if (typeof window !== "undefined") {
      const { X_PREVIEW_OFF_SENTENCE } = await import("@/lib/zk/gate");
      return NextResponse.json({ testData: true, offered: false, reason: X_PREVIEW_OFF_SENTENCE, scope: "deployment" });
    }
    const { xOutboxView, xEnvelopeForRig, xRecordForRig, XOutboxScopeError } = await import("@/lib/x/outbox/request");
    const xHash = req.nextUrl.searchParams.get("xHash");
    let view: Record<string, unknown>;
    try {
      view = await xOutboxView(xHash);
    } catch (e) {
      // PERSONA LAUNCH wave 3 (UXH-1): which personas this view may show could not be read — never an unscoped list
      if (e instanceof XOutboxScopeError) return NextResponse.json({ testData: true, offered: false, reason: "Couldn't check which of your personas this page may show, so your copies to @totem on X aren't listed. Try again in a moment.", error: e.message, code: "scope" }, { status: 503 });
      throw e;
    }
    // RIG ONLY: the X copy's envelope while it is QUEUED (the queue keeps no proof material after the send) — the
    // suite's leak and nullifier checks read it, like GET /api/anon?castHash=&envelope=1 — and (UXH-1) its sealed
    // record's persona and copied post, which the product view no longer carries
    if (xHash && req.nextUrl.searchParams.get("envelope") === "1" && !(await devAllowed())) {
      view.envelope = await xEnvelopeForRig(xHash);
      view.record = await xRecordForRig(xHash);
    }
    return NextResponse.json(view);
  } catch (e) {
    return NextResponse.json({ testData: true, offered: false, reason: "Couldn't read the @totem X outbox (" + (e as Error).message + ").", error: (e as Error).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (typeof window !== "undefined") {
      const { X_PREVIEW_OFF_SENTENCE } = await import("@/lib/zk/gate");
      return NextResponse.json({ error: X_PREVIEW_OFF_SENTENCE, code: "unavailable", testData: true }, { status: 503 });
    }
    const action = body.action === undefined ? "submit" : String(body.action);
    const req_ = await import("@/lib/x/outbox/request");
    if (action === "submit") {
      if (body.force === true) {
        const no = await devAllowed();
        if (no) return NextResponse.json({ error: no, testData: true }, { status: 403 });
      }
      const r = await req_.submitXCopy({ text: body.text, personaId: body.personaId, copyOf: body.copyOf, force: body.force === true });
      return NextResponse.json(r.json, { status: r.status });
    }
    if (action === "moderate") {
      const r = await req_.moderateFromThisDevice(body.id, body.decision);
      return NextResponse.json(r.json, { status: r.status });
    }
    if (action === "review") {
      const r = await req_.reviewFromThisDevice();
      return NextResponse.json(r.json, { status: r.status });
    }
    if (action === "registerModerator" || action === "relayNow" || action === "transportLog" || action === "readOutbox") {
      const no = await devAllowed();
      if (no) return NextResponse.json({ error: no, testData: true }, { status: 403 });
      const vc = await import("@/lib/zk/validatorClient");
      if (action === "registerModerator") {
        const { moderatorPublicKey } = await import("@/lib/x/outbox/moderation");
        const r = await vc.xOutboxDev("moderator", { mode: "fixture", pubkey: await moderatorPublicKey() });
        return NextResponse.json({ ...(r.json ?? {}), testData: true }, { status: r.status });
      }
      if (action === "relayNow") {
        const r = await vc.xOutboxDev("relay-now", { mode: "fixture" });
        return NextResponse.json({ ...(r.json ?? {}), testData: true }, { status: r.status });
      }
      if (action === "transportLog") return NextResponse.json({ ...(await vc.fetchXTransportLog("fixture")), testData: true });
      const { xOutboxOnce } = await import("@/lib/zk/prefetch");
      const snap = await xOutboxOnce("fixture");
      return NextResponse.json({ ok: !!snap && !snap.error, error: snap?.error ?? null, rows: snap?.list?.length ?? null, testData: true });
    }
    return NextResponse.json({ error: "unknown action", testData: true }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, testData: true }, { status: 503 });
  }
}
