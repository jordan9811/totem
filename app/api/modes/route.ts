import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function GET() {
  const personaId = activeSeedPersonaId();
  try {
    const [modes, active] = await Promise.all([
      retryAdapter(() => adapters.mode.list(personaId)),
      retryAdapter(() => adapters.mode.getActive(personaId)),
    ]);
    // ADS, PHASE 1: each mode's ad dial as it applies (its own setting, the default for this identity, or forced off)
    const { effectiveAdDial } = await import("@/lib/ads/dial");
    const { kindOf } = await import("@/lib/identity/personaKind");
    const kind = kindOf(personaId);
    const adDials = Object.fromEntries(modes.map((m) => [m.id, effectiveAdDial(m, kind)]));
    // DORMANT (lib/ads/switch.ts): whether ads run on this site at all (the dial stays editable either way)
    const { adsRunning } = await import("@/lib/ads/switch");
    return NextResponse.json({ modes, activeId: active.id, adDials, adsRunning: adsRunning() });
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const personaId = activeSeedPersonaId();
  const body = await req.json();
  try {
    if (body.duplicateOf) {
      const mode = await adapters.mode.duplicate(body.duplicateOf, body.name);
      return NextResponse.json({ mode });
    }
    const mode = await adapters.mode.create({
      personaId,
      name: body.name,
      isPreset: false,
      ranking: body.ranking ?? { recency: 0.4, engagement: 0.3, authorAffinity: 0.2, clusterAffinity: 0.1 },
      ruleIds: body.ruleIds ?? [],
      notificationPolicy: body.notificationPolicy ?? "all",
      actionButtonSlots: body.actionButtonSlots ?? { composer: ["media", "gif", "poll", "emoji"], nav: ["home", "explore", "notifications"] },
      pinnedPersonaId: body.pinnedPersonaId ?? null,
      filterPackIds: body.filterPackIds ?? undefined,
      showTrending: body.showTrending ?? true,
      calmRanking: body.calmRanking ?? false,
      followedOnly: body.followedOnly,
      longformOnly: body.longformOnly,
      hideReplies: body.hideReplies,
    });
    return NextResponse.json({ mode });
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  // MEGA PASS 2 Gate 3: a cast-row binding is validated here, by name — an unknown or duplicated action never lands
  const slots = body?.patch?.actionButtonSlots as { cast?: unknown } | undefined;
  if (slots && slots.cast !== undefined) {
    const { validateCastRow } = await import("@/lib/actions/bindings");
    const v = validateCastRow(slots.cast);
    if (!v.row) return NextResponse.json({ error: v.reason }, { status: 400 });
    body.patch.actionButtonSlots = { ...slots, cast: v.row };
  }
  // ADS, PHASE 1: the ad dial is one of three words (null = back to the default); Event Safe Space stays at none
  if (body?.patch && typeof body.patch === "object" && "adDial" in body.patch) {
    const { isAdDial, DIAL_BAD_SENTENCE, DIAL_REFUSED_SENTENCE } = await import("@/lib/ads/dial");
    const want = body.patch.adDial;
    if (want !== null && !isAdDial(want)) return NextResponse.json({ error: DIAL_BAD_SENTENCE, code: "bad_ad_dial" }, { status: 400 });
    let target;
    try {
      target = await retryAdapter(() => adapters.mode.get(String(body.modeId)));
    } catch (e) {
      return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
    }
    if (!target) return NextResponse.json({ error: "unknown mode" }, { status: 404 });
    // the dial is set for the identity acting now, on its own modes only (never a persona's from the root, or back)
    if (target.personaId !== activeSeedPersonaId()) return NextResponse.json({ error: "That mode belongs to another identity: switch to it to change its ads.", code: "other_identity" }, { status: 409 });
    if (target.allowAds === false && want !== null && want !== "none") return NextResponse.json({ error: DIAL_REFUSED_SENTENCE, code: "ads_forced_off" }, { status: 400 });
    body.patch.adDial = want === null ? undefined : want;
  }
  try {
    const mode = await retryAdapter(() => adapters.mode.update(body.modeId, body.patch ?? {}));
    return NextResponse.json({ mode });
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json({ error: err.message }, { status: err.code === "NOT_FOUND" ? 404 : 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const modeId = req.nextUrl.searchParams.get("modeId");
  if (!modeId) return NextResponse.json({ error: "modeId required" }, { status: 400 });
  try {
    await retryAdapter(() => adapters.mode.delete(modeId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 403 : 503 });
  }
}
