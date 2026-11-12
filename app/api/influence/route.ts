import { NextRequest, NextResponse } from "next/server";
// MEGA PASS 2 Gate 1 — THE INFLUENCE LAYER's read/write API.
//
// GET ?view=allowance            the current epoch's balance + the per-action settings (own)
// GET ?view=history&personaId=   a persona's stake history AT ITS DISCLOSURE LEVEL (fail closed)
// GET ?view=cast&castHash=       verified stakes on a cast + the aggregate by direction (public)
// GET ?view=clusters[&epoch=]    coordinated-staking clusters over an epoch's public rows (legibility)
// GET ?view=accruals             this root's settled stewardship records (own)
// GET ?view=evaluate&personaId=&epoch=[&curves=json]  the PURE accrual arithmetic for any persona
// POST {action:"stake", castHash, stakeAction, direction?, amount?, personaId?}
// POST {action:"setSettings", defaults?, directions?}
// POST {action:"settle", evaluatedEpoch?}   evaluate the closed window and post the accrual on the root
import { activeSeedPersonaId } from "@/lib/activePersona";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { emptySummary, isStakeAction, isStakeDirection, type StakeEvent } from "@/lib/influence/types";
import { networkWriteRefusal } from "@/lib/fc/networkTarget";

export const dynamic = "force-dynamic";

/**
 * LAYERS_WORLD=empty (review WORLD-LEAK-5): the validator's stake table is not an adapter_state namespace, so the
 * store's partition never sees it — the demo world's seeded stakes (persona_acc_crypto_4/5/6's coordinated cluster,
 * signed by fixture personas on an earlier demo boot) are still there. lib/influence/stakes.ts drops them at the one
 * read every view goes through; this is the same allowlist applied again at the answer, so a row that names a persona
 * this device did not mint never leaves this route whatever the read path (clusters, a cast's summary, a history).
 */
async function realRowsOnly<T extends { personaId: string }>(rows: T[]): Promise<T[]> {
  const { isEmptyWorld, realPersonaIds } = await import("@/lib/world");
  if (!isEmptyWorld()) return rows;
  const real = new Set(realPersonaIds());
  return rows.filter((r) => real.has(r.personaId));
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const view = q.get("view") ?? "allowance";
  const viewer = activeSeedPersonaId();
  try {
    if (view === "allowance") {
      const a = await retryAdapter(() => adapters.influence.allowance());
      return NextResponse.json({ allowance: a });
    }
    if (view === "history") {
      const personaId = q.get("personaId") ?? viewer;
      // POST-DEPLOY Gate 2: a stake history is cross-persona material the moment
      // it names a SIBLING — "these two personas are the same hand" is exactly
      // what compartment mode exists to keep off a shared screen. Refused by id,
      // not by rendering: the route never answers for another own persona here.
      if (personaId !== viewer) {
        const { viewScope } = await import("@/lib/identity/chrome");
        const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
        const scope = await viewScope(viewer, await ownPersonaIdsAll());
        if (scope.compartment && !scope.visiblePersonaIds.includes(personaId))
          return NextResponse.json({ error: "compartment mode is on — this device is scoped to the active persona", code: "compartment" }, { status: 403 });
      }
      const r = await retryAdapter(() => adapters.influence.historyFor(personaId, viewer));
      if (!r.ok) return NextResponse.json({ error: r.reason, code: r.code }, { status: r.code === "forbidden" ? 403 : 503 });
      return NextResponse.json({ personaId, own: r.own, stakes: await realRowsOnly(r.stakes) });
    }
    if (view === "cast") {
      const castHash = q.get("castHash") ?? "";
      if (!castHash) return NextResponse.json({ error: "castHash required" }, { status: 400 });
      const r = await retryAdapter(() => adapters.influence.stakesForCast(castHash));
      const rows: StakeEvent[] = await realRowsOnly(r.rows);
      if (rows.length === r.rows.length) return NextResponse.json({ castHash, ...r });
      // review WORLD-LEAK-5: a summary over rows that are not answered would count stakes nobody can see
      const { summarize } = await import("@/lib/influence/stakes");
      return NextResponse.json({ castHash, rows, summary: summarize(rows).get(castHash) ?? emptySummary() });
    }
    if (view === "clusters") {
      const { currentEpoch } = await import("@/lib/influence/allowance");
      const { stakesInEpoch } = await import("@/lib/influence/stakes");
      const { detectClusters } = await import("@/lib/influence/clusters");
      const epoch = q.get("epoch") !== null ? Number(q.get("epoch")) : (await currentEpoch()) - 1;
      if (!Number.isInteger(epoch) || epoch < 0) return NextResponse.json({ error: "epoch malformed" }, { status: 400 });
      const rows = await realRowsOnly(await stakesInEpoch(epoch));
      return NextResponse.json({ epoch, rows: rows.length, clusters: detectClusters(rows) });
    }
    if (view === "accruals") {
      const { accruals, currentEpoch } = await import("@/lib/influence/allowance");
      return NextResponse.json({ epoch: await currentEpoch(), accruals: await accruals() });
    }
    if (view === "evaluate") {
      const personaId = q.get("personaId") ?? viewer;
      const epoch = Number(q.get("epoch"));
      if (!Number.isInteger(epoch) || epoch < 0) return NextResponse.json({ error: "epoch required" }, { status: 400 });
      const { evaluateEpochFor, CANONICAL_CURVES, sanitizeCurves } = await import("@/lib/influence/accrual");
      let curves = CANONICAL_CURVES;
      if (q.get("curves")) {
        const parsed = sanitizeCurves(JSON.parse(q.get("curves") as string));
        if (!parsed) return NextResponse.json({ error: "curves malformed" }, { status: 400 });
        curves = parsed;
      }
      const evaluation = await evaluateEpochFor([personaId], epoch, curves, viewer);
      return NextResponse.json({ personaId, epoch, curves, evaluation });
    }
    return NextResponse.json({ error: "unknown view" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const viewer = activeSeedPersonaId();
  try {
    if (body.action === "stake") {
      const castHash = typeof body.castHash === "string" ? body.castHash : "";
      const stakeAction = body.stakeAction;
      if (!castHash || !isStakeAction(stakeAction)) return NextResponse.json({ error: "castHash and a known stakeAction are required" }, { status: 400 });
      // FC-READ: a stake on a NETWORK cast (read through the public relay) is refused by default — the summary never
      // attaches to a network card, so it would spend allowance on something the visitor can never see again
      // (a product decision recorded as such; lib/fc/networkTarget.ts arms only on a relay-reading public device)
      const refusal = await networkWriteRefusal(castHash);
      if (refusal) return NextResponse.json(refusal, { status: 403 });
      const direction = body.direction === undefined ? undefined : isStakeDirection(body.direction) ? body.direction : null;
      if (direction === null) return NextResponse.json({ error: "unknown direction" }, { status: 400 });
      const amount = body.amount === undefined ? undefined : Number(body.amount);
      const personaId = typeof body.personaId === "string" ? body.personaId : viewer;
      const r = await retryAdapter(() => adapters.influence.stake({ personaId, castHash, action: stakeAction, direction, amount }));
      if (!r.ok) {
        const status = r.code === "not_own" ? 403 : r.code === "overdraw" ? 409 : r.code === "malformed" ? 400 : 503;
        return NextResponse.json({ error: r.reason, code: r.code, remaining: r.remaining, allowance: r.allowance }, { status });
      }
      return NextResponse.json(r);
    }
    if (body.action === "setSettings") {
      const defaults: Record<string, number> = {};
      const directions: Record<string, string> = {};
      for (const [k, v] of Object.entries((body.defaults as Record<string, unknown>) ?? {})) {
        if (!isStakeAction(k) || !Number.isInteger(v) || (v as number) < 0 || (v as number) > 50) return NextResponse.json({ error: `default for ${k} must be an integer 0..50` }, { status: 400 });
        defaults[k] = v as number;
      }
      for (const [k, v] of Object.entries((body.directions as Record<string, unknown>) ?? {})) {
        if (!isStakeAction(k) || !isStakeDirection(v)) return NextResponse.json({ error: `direction for ${k} unknown` }, { status: 400 });
        directions[k] = v;
      }
      const settings = await retryAdapter(() => adapters.influence.setSettings({ defaults, directions }));
      return NextResponse.json({ settings });
    }
    if (body.action === "settle") {
      const { settleStewardship } = await import("@/lib/influence/accrual");
      const evaluatedEpoch = body.evaluatedEpoch === undefined ? undefined : Number(body.evaluatedEpoch);
      const r = await settleStewardship({ evaluatedEpoch });
      if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
      return NextResponse.json(r);
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
