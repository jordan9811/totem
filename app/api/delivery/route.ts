import { NextRequest, NextResponse } from "next/server";
// POST-DEPLOY Gate 3 — PER-ACCOUNT DELIVERY TIERS.
//
// GET                          every non-normal setting, across every mode, with handles and mode names
// GET ?personaId=[&modeId=]    one account's tier in one mode (the cast menu / profile control reads this)
// POST {personaId, tier[, modeId]}   set it; modeId defaults to the ACTIVE mode
//
// A tier is (account x mode) — "never miss in personal, quiet in work" is one
// setting on one account, not two accounts — so every read and write here names
// a mode, and the default is the mode the viewer is actually in.
//
// The tiers are enforced by the RULES ENGINE (lib/delivery/tiers.ts compiles
// them; lib/feed.ts evaluates them with every other rule). Nothing in this
// route filters anything.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { DELIVERY_TIERS, listNonNormal, setTier, tierFor, tierMapFor } from "@/lib/delivery/tiers";
import { fidOfHubAccountKey } from "@/lib/fc/hubRead/copy";

export const dynamic = "force-dynamic";

async function activeModeOf(viewer: string): Promise<{ id: string; name: string }> {
  const m = await retryAdapter(() => adapters.mode.getActive(viewer));
  return { id: m.id, name: m.name };
}

/** the clusters this viewer follows for `rootId`, from the EXISTING facet-follow
 *  state — "facet only" is that feature presented as a tier, not a new one */
async function followedClustersFor(viewer: string, rootId: string | null): Promise<string[]> {
  if (!rootId) return [];
  const ids = await retryAdapter(() => adapters.disclosure.followedFacets(viewer));
  const out: string[] = [];
  for (const facetId of ids) {
    const m = facetId.match(/^facet_(.+)_([^_]+)$/);
    if (m && m[1] === rootId) out.push(m[2]);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const viewer = activeSeedPersonaId();
  const q = req.nextUrl.searchParams;
  try {
    const active = await activeModeOf(viewer);
    const { personaById } = await import("@/lib/adapters/mock/store");
    const modes = await retryAdapter(() => adapters.mode.list(viewer));
    const modeName = (id: string) => modes.find((m) => m.id === id)?.name ?? id;

    const one = q.get("personaId");
    if (one) {
      const modeId = q.get("modeId") || active.id;
      const tier = await tierFor(modeId, one);
      return NextResponse.json({
        personaId: one,
        handle: personaById.get(one)?.handle ?? one,
        modeId,
        modeName: modeName(modeId),
        tier,
        tiers: DELIVERY_TIERS,
        facetsFollowed: await followedClustersFor(viewer, personaById.get(one)?.rootId ?? null),
      });
    }

    const rows = await listNonNormal();
    const inActive = await tierMapFor(active.id);
    return NextResponse.json({
      activeMode: active,
      tiers: DELIVERY_TIERS,
      // the management screen's list: EXACTLY the non-normal set, because
      // "normal" is the absence of a row rather than a stored value
      rows: rows.map((r) => ({
        ...r,
        modeName: modeName(r.modeId),
        // SPEC A: a Farcaster account's tier (keyed `fc:<fid>` from a hub card) shows as the hub shows an unnamed
        // account, `!<fid>` (this route reads nothing from the network to name it)
        handle: personaById.get(r.personaId)?.handle ?? (fidOfHubAccountKey(r.personaId) !== null ? "!" + fidOfHubAccountKey(r.personaId) : r.personaId),
        name: personaById.get(r.personaId)?.name ?? (fidOfHubAccountKey(r.personaId) !== null ? "Farcaster account " + fidOfHubAccountKey(r.personaId) : null),
        activeHere: r.modeId === active.id,
      })),
      activeModeTiers: [...inActive.entries()].map(([personaId, tier]) => ({ personaId, tier })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const viewer = activeSeedPersonaId();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const personaId = String(body.personaId ?? "");
    const active = await activeModeOf(viewer);
    const modeId = typeof body.modeId === "string" && body.modeId ? body.modeId : active.id;
    const { personaById } = await import("@/lib/adapters/mock/store");
    const facets = await followedClustersFor(viewer, personaById.get(personaId)?.rootId ?? null);
    const r = await setTier(modeId, personaId, body.tier, facets);
    if (!r.ok) return NextResponse.json({ error: r.reason, code: r.code }, { status: r.code === "no_facet" ? 409 : 400 });
    return NextResponse.json({ ok: true, personaId, modeId, modeName: active.name, tier: r.tier });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
