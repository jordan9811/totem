import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { authorEdgeSigVerifies, curatorEdgesFor, declareEdge, edgesFor } from "@/lib/refutation/edges";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

/** Edges targeting a cast — author-declared plus, for THIS viewer, the
 * curator-attested edges of feeds they subscribe to. */
export async function GET(req: NextRequest) {
  const castId = req.nextUrl.searchParams.get("castId");
  if (!castId) return NextResponse.json({ error: "castId required" }, { status: 400 });
  const viewer = activeSeedPersonaId();
  // CRYPTO PASS: never surface a stored `verified` the signature no longer
  // backs — author edges re-verify at read time, here as everywhere.
  const edges = [
    ...edgesFor(castId).map((e) =>
      e.declaredBy === "author" ? { ...e, verified: e.verified && authorEdgeSigVerifies(e) } : e
    ),
    ...curatorEdgesFor(viewer).filter((e) => e.toCastId === castId),
  ];
  // MEGA PASS 2 Gate 1: the refutation surface consumes the wrong/misleading stake directions — an additive
  // signal beside the edges, never a change to the standing rule (volume still counts for nothing there)
  // PERSONA LAUNCH (final verify, accept-mega2-g1 check 4): the adapter read RETRIES (lib/adapters/retry.ts), as its
  // sibling /api/influence does — one transient failure answered a 200 with stakes null (an "unknown" the surface then
  // showed as no stake at all). null now means it failed three times.
  let stakes: { wrong: number; misleading: number; total: number } | null = null;
  try {
    const { adapters } = await import("@/lib/adapters/registry");
    const { summary } = await retryAdapter(() => adapters.influence.stakesForCast(castId));
    stakes = { wrong: summary.byDirection.wrong, misleading: summary.byDirection.misleading, total: summary.total };
  } catch {
    stakes = null;
  }
  return NextResponse.json({ castId, edges, stakes });
}

/** Author-declared edge. The asserter is the ACTIVE persona, taken from the
 * server session — a client cannot declare in someone else's name. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { fromCastId, toCastId, type } = body;
  if (!fromCastId || !toCastId)
    return NextResponse.json({ error: "fromCastId and toCastId required" }, { status: 400 });
  if (!["refutes", "probes"].includes(type))
    return NextResponse.json({ error: "type must be refutes|probes" }, { status: 400 });
  const edge = await declareEdge({
    fromCastId,
    toCastId,
    type,
    declaredBy: "author",
    assertedBy: activeSeedPersonaId(),
  });
  // Null = the asserter has no resolvable signing key. The declaration is
  // REFUSED — an unsigned author edge is never stored.
  if (edge === null)
    return NextResponse.json({ error: "cannot sign as this persona" }, { status: 403 });
  // MEGA PASS 2 Gate 1: a refutation carries the user's default `refute` stake (direction `wrong` unless set
  // otherwise) on the REFUTED cast; the edge stands whatever the stake says
  let stake = null;
  if (body.stake !== null && Number(body.stake?.amount) !== 0) {
    const { placeStake } = await import("@/lib/influence/stakes");
    const { isStakeDirection } = await import("@/lib/influence/types");
    stake = await placeStake({
      personaId: activeSeedPersonaId(),
      castHash: toCastId,
      action: "refute",
      amount: body.stake?.amount === undefined ? undefined : Number(body.stake.amount),
      direction: isStakeDirection(body.stake?.direction) ? body.stake.direction : undefined,
    }).catch((e: Error) => ({ ok: false as const, code: "unavailable" as const, reason: e.message }));
  }
  return NextResponse.json({ edge, stake });
}
