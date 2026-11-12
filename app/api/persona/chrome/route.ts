import { NextRequest, NextResponse } from "next/server";
// POST-DEPLOY Gate 2 — PERSONA CHROME: tints, and the scope of every
// cross-persona surface.
//
// GET                                  the tint of every own persona, the palette, and the current scope
// POST {action:"tint", personaId, color}     set a persona's accent (its owner only)
// POST {action:"clearTint", personaId}       back to the distinct auto default
// POST {action:"unified", on}                the cross-persona view (refused while compartment mode is on)
// POST {action:"compartment", on}            the one-tap hard scope
//
// The scope this route reports is the SAME value /api/personas,
// /api/personas/act-as-options and /api/search/unified enforce — it is read
// from one chokepoint (lib/identity/chrome.ts viewScope), never recomputed.
import { activeSeedPersonaId } from "@/lib/activePersona";
import {
  TINT_PALETTE,
  clearTint,
  modeEdgeOf,
  setCompartment,
  setTint,
  setUnified,
  tintsFor,
  viewScope,
  washOf,
} from "@/lib/identity/chrome";

export const dynamic = "force-dynamic";

async function ownIds(): Promise<string[]> {
  const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
  return ownPersonaIdsAll();
}

export async function GET() {
  try {
    const active = activeSeedPersonaId();
    const own = await ownIds();
    const scope = await viewScope(active, own);
    // GATE 5 (attack-post-1 F-1): the route that IMPLEMENTS compartment mode was the one
    // surface that ignored it — it listed every sibling's id, handle and accent, and the
    // settings page rendered that list. The ASSIGNMENT still walks the whole roster, because
    // "a colour no sibling is using" is not computable from one persona; only the ANSWER is
    // narrowed.
    const tints = await tintsFor(own);
    const visible = new Set(scope.visiblePersonaIds);
    const { personaById } = await import("@/lib/adapters/mock/store");
    return NextResponse.json({
      activePersonaId: active,
      palette: TINT_PALETTE,
      scope,
      tints: own
        .filter((id) => visible.has(id))
        .map((id) => ({
          ...tints[id],
          handle: personaById.get(id)?.handle ?? id,
          wash: washOf(tints[id].color),
        })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.action === "tint") {
      // scoped the same way: setTint already refused a non-OWN persona, but under compartment
      // mode a SIBLING is still own, and the refusal message named the sibling's vision-model
      // distance — enough to confirm the sibling exists and localise its accent
      const tgt = String(body.personaId ?? "");
      const { visibleOwnPersonaIds: vis } = await import("@/lib/identity/chrome");
      if (!(await vis()).includes(tgt))
        return NextResponse.json({ error: "not a persona in this device's current scope", code: "out_of_scope" }, { status: 403 });
      const r = await setTint(tgt, String(body.color ?? ""), await ownIds());
      if (!r.ok)
        return NextResponse.json(
          { error: r.reason, code: r.code },
          { status: r.code === "not_own" ? 403 : r.code === "collides" ? 409 : 400 }
        );
      return NextResponse.json({ ok: true, tint: r.tint, wash: washOf(r.tint.color) });
    }
    if (body.action === "clearTint") {
      // GATE 5 (attack-post-1 F-1, residual): the GET was narrowed and the POST was not, so
      // clearTint stayed a clean membership oracle — non-null meant "this is one of the
      // device's personas" — and a DESTRUCTIVE one, since it deleted the sibling's chosen
      // tint before answering. It is now scoped like everything else, and refuses outright
      // rather than answering null, so it cannot be used to test a guess either.
      const target = String(body.personaId ?? "");
      const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
      const visible = await visibleOwnPersonaIds();
      if (!visible.includes(target))
        return NextResponse.json({ error: "not a persona in this device's current scope", code: "out_of_scope" }, { status: 403 });
      await clearTint(target);
      const tints = await tintsFor(await ownIds());
      return NextResponse.json({ ok: true, tint: tints[target] ?? null });
    }
    if (body.action === "unified") {
      const { resetUnifiedIndex } = await import("@/lib/search/unified");
      resetUnifiedIndex();
      let doc;
      try {
        doc = await setUnified(body.on === true);
      } catch (e) {
        // compartment mode is the stronger claim and wins: refused, and SAID,
        // rather than silently ignored or silently dropping compartment
        if (String((e as Error).message).includes("compartment"))
          return NextResponse.json({ error: (e as Error).message, code: "compartment" }, { status: 409 });
        throw e;
      }
      return NextResponse.json({ ok: true, scope: await viewScope(activeSeedPersonaId(), await ownIds()), unified: doc.unified });
    }
    if (body.action === "compartment") {
      const doc = await setCompartment(body.on === true);
      // Drop every scope's search index. Keyed caches mean the compartment index
      // never HELD a sibling's records; dropping the others means the process
      // does not keep holding them either, which is the actual screen-share risk.
      const { resetUnifiedIndex } = await import("@/lib/search/unified");
      resetUnifiedIndex();
      return NextResponse.json({
        ok: true,
        scope: await viewScope(activeSeedPersonaId(), await ownIds()),
        compartment: doc.compartment,
        unified: doc.unified,
      });
    }
    if (body.action === "modeEdge") {
      return NextResponse.json({ edge: modeEdgeOf(body.modeId == null ? null : String(body.modeId)) });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
