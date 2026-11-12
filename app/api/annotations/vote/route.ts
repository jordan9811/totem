import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { voteAnnotation } from "@/lib/refutation/edges";

export const dynamic = "force-dynamic";

/** One-tap concur/dispute on a curator annotation — "was this actually
 * unaddressed?" One vote per persona, switchable, feeding the per-curator
 * accuracy tally shown in subscription settings. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { annotationId, vote } = body;
  if (!annotationId || !["concur", "dispute"].includes(vote))
    return NextResponse.json({ error: "annotationId and vote(concur|dispute) required" }, { status: 400 });
  const tally = await voteAnnotation(annotationId, activeSeedPersonaId(), vote);
  // MEGA PASS 2 Gate 1: concurring with a note stakes `note-worthy` on its target; disputing stakes `misleading`
  // — the community-notes surface consuming the spectrum. The user's `note` default; zero = none; the vote stands.
  let stake = null;
  if (body.stake !== null && Number(body.stake?.amount) !== 0) {
    const { state } = await import("@/lib/adapters/mock/store");
    const target = [...state().curatorFeeds.values()].flatMap((f) => f.annotations).find((a) => a.id === annotationId)?.targetCastId;
    if (target) {
      const { placeStake } = await import("@/lib/influence/stakes");
      stake = await placeStake({
        personaId: activeSeedPersonaId(),
        castHash: target,
        action: "note",
        amount: body.stake?.amount === undefined ? undefined : Number(body.stake.amount),
        direction: vote === "concur" ? "note-worthy" : "misleading",
      }).catch((e: Error) => ({ ok: false as const, code: "unavailable" as const, reason: e.message }));
    }
  }
  return NextResponse.json({ annotationId, tally, stake });
}
