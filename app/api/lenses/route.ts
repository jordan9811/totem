import { NextRequest, NextResponse } from "next/server";
// MEGA PASS 2 Gate 2 — LENSES.
// GET                         the stored lenses (canonical + seeded + imported) and the active mode's lens
// GET ?export=<lensId>        the signed lens artifact (shareable through the algo pipeline)
// GET ?delta=<lensId>[&epoch] "under this lens, your accrual would have been X vs Y" for your own history
// POST {action:"apply", modeId?, lensId|null}   switch the lens a mode sees through (null = canonical)
// Import and preview go through the EXISTING /api/algo/import and /api/algo/preview — a lens is an artifact.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { applyLens, exportLens, getLens, influenceDelta, lensForMode, listLenses } from "@/lib/lens/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const viewer = activeSeedPersonaId();
  try {
    if (q.get("export")) {
      const id = q.get("export") as string;
      if (!getLens(id)) return NextResponse.json({ error: "unknown lens" }, { status: 404 });
      return NextResponse.json({ artifact: exportLens(id, viewer) });
    }
    if (q.get("delta")) {
      const lens = getLens(q.get("delta") as string);
      if (!lens) return NextResponse.json({ error: "unknown lens" }, { status: 404 });
      // GATE 5 (attack-post-1 F-3): this route ECHOED the persona set back to the caller, and
      // accepted a caller-supplied one — so it both leaked the siblings and let anyone confirm
      // a guess about them. It now defaults to the visible set and refuses a persona outside it.
      const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
      const visible = await visibleOwnPersonaIds();
      const epoch = q.get("epoch") !== null ? Number(q.get("epoch")) : undefined;
      const asked = q.get("personaIds") ? String(q.get("personaIds")).split(",").filter(Boolean) : visible;
      // The param is an ANALYSIS input — the legibility view names a coordinated cluster of
      // OTHER accounts, whose accruals are public rows on the validator. So a stranger stays
      // analysable; what is refused is naming one of your OWN personas that the current scope
      // hides, which is the only way this route could confirm a sibling.
      const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
      const own = new Set(await ownPersonaIdsAll());
      const hiddenSibling = asked.filter((id) => own.has(id) && !visible.includes(id));
      if (hiddenSibling.length)
        return NextResponse.json(
          { error: "that persona is one of yours and outside this device's current scope", code: "out_of_scope" },
          { status: 403 }
        );
      const personaIds = asked;
      const delta = await influenceDelta(lens.spec, personaIds, viewer, epoch);
      return NextResponse.json({ lensId: lens.id, personaIds, delta });
    }
    if (q.get("preview")) {
      // the money shot's data: the SAME feed, ranked without and with the candidate lens, plus the influence delta
      const lens = getLens(q.get("preview") as string);
      if (!lens) return NextResponse.json({ error: "unknown lens" }, { status: 404 });
      const { buildFeed } = await import("@/lib/feed");
      const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
      const LIMIT = 40;
      const [current, under] = await Promise.all([
        buildFeed(viewer, { surface: "discovery", limit: LIMIT, lensOverride: null }),
        buildFeed(viewer, { surface: "discovery", limit: LIMIT, lensOverride: lens.spec }),
      ]);
      const posts = (cards: typeof current.cards) => cards.filter((c) => c.kind === "post" && c.cast && !c.private).map((c) => ({ hash: c.cast.hash, author: c.cast.author.username, text: c.cast.text.slice(0, 100) }));
      const a = posts(current.cards);
      const b = posts(under.cards);
      const posA = new Map(a.map((p, i) => [p.hash, i]));
      const moved = b.filter((p, i) => posA.get(p.hash) !== i).length;
      const { visibleOwnPersonaIds: visibleForPreview } = await import("@/lib/identity/chrome");
      const delta = await influenceDelta(lens.spec, await visibleForPreview(), viewer);
      return NextResponse.json({ lensId: lens.id, current: a, under: b, moved, delta });
    }
    const mode = await retryAdapter(() => adapters.mode.getActive(viewer));
    const active = lensForMode(mode);
    return NextResponse.json({
      lenses: listLenses().map((l) => ({ id: l.id, name: l.name, summary: l.summary, authorHandle: l.authorHandle, seeded: !!l.seeded, spec: l.spec, forkedFrom: l.forkedFrom ?? null })),
      activeModeId: mode.id,
      active: { id: active.id, source: active.source },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const viewer = activeSeedPersonaId();
  try {
    if (body.action === "apply") {
      const lensId = body.lensId === null ? null : String(body.lensId ?? "");
      if (lensId !== null && !getLens(lensId)) return NextResponse.json({ error: "unknown lens" }, { status: 404 });
      const modeId = typeof body.modeId === "string" ? body.modeId : (await retryAdapter(() => adapters.mode.getActive(viewer))).id;
      const mode = await retryAdapter(() => adapters.mode.get(modeId));
      if (!mode || mode.personaId !== viewer) return NextResponse.json({ error: "mode does not belong to the active persona" }, { status: 403 });
      const updated = await applyLens(modeId, lensId);
      return NextResponse.json({ mode: updated, lens: lensForMode(updated) });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
