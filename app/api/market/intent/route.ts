import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";
import { marketClock } from "@/lib/adapters/mock/clock";
import { personaById } from "@/lib/adapters/mock/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const personaId = activeSeedPersonaId();
  const intentId = req.nextUrl.searchParams.get("intentId");
  try {
    if (intentId) {
      const intent = await retryAdapter(() => adapters.market.getIntent(intentId));
      if (!intent) return NextResponse.json({ error: "unknown intent" }, { status: 404 });
      const bids = await retryAdapter(() => adapters.market.bidsFor(intentId));
      return NextResponse.json({
        intent,
        bids: bids.map((b) => ({
          ...b,
          advertiserHandle: personaById.get(b.advertiserPersonaId)?.handle ?? "unknown",
        })),
        now: marketClock.now(),
      });
    }
    const intents = await retryAdapter(() => adapters.market.listIntents(personaId));
    return NextResponse.json({ intents, now: marketClock.now() });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const personaId = activeSeedPersonaId();
  try {
    if (body.action === "award") {
      const intent = await retryAdapter(() => adapters.market.awardIntent(body.intentId, body.bidId));
      const bids = await retryAdapter(() => adapters.market.bidsFor(body.intentId));
      const winner = bids.find((b) => b.id === body.bidId);
      // Settlement fires on award: escrow moves to the winning advertiser's
      // pitch, and the buyer's earnings view reflects the event.
      await retryAdapter(() =>
        adapters.settle.record({
          kind: "intent_award",
          personaId,
          amount: winner?.amount ?? intent.escrowAmount,
          category: intent.category,
          note: `Awarded "${intent.description}" to @${
            personaById.get(winner?.advertiserPersonaId ?? "")?.handle ?? "advertiser"
          }`,
        })
      );
      return NextResponse.json({ intent });
    }

    if (body.action === "lapse") {
      const intent = await retryAdapter(() => adapters.market.lapseIntent(body.intentId));
      // The alternate settlement path: escrow is refunded, and the event is
      // logged rather than silently dropped.
      await retryAdapter(() =>
        adapters.settle.record({
          kind: "intent_refund",
          personaId,
          amount: intent.escrowAmount,
          category: intent.category,
          note: `Window lapsed on "${intent.description}" — escrow refunded`,
        })
      );
      return NextResponse.json({ intent });
    }

    if (body.action === "advanceClock") {
      marketClock.advance(Number(body.ms ?? 0));
      return NextResponse.json({ now: marketClock.now() });
    }

    const intent = await retryAdapter(() =>
      adapters.market.createIntent({
        buyerPersonaId: personaId,
        category: body.category,
        description: body.description,
        escrowAmount: Number(body.escrowAmount),
        pitchSlots: Number(body.pitchSlots ?? 3),
        windowMs: Number(body.windowMs ?? 60_000),
      })
    );
    return NextResponse.json({ intent });
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 409 : 503 });
  }
}
