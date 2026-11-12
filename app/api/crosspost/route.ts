import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import {
  boundDestinationsFor,
  degradeFor,
  detectLinks,
  DESTINATIONS,
  xRateCardMeta,
} from "@/lib/crosspost/destinations";
import { state, persistNs } from "@/lib/adapters/mock/store";
import { logEdgeEvent } from "@/lib/eventlog/log";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

/**
 * GET → the ACTIVE persona's bound destinations, with per-destination cost
 * estimate and degradation preview for a draft. Estimates surface BEFORE
 * send — a link post costing 13x is information the user gets while the
 * post button is still unpressed.
 */
export async function GET(req: NextRequest) {
  const text = req.nextUrl.searchParams.get("text") ?? "";
  const hasMedia = req.nextUrl.searchParams.get("hasMedia") === "true";
  const persona = activeSeedPersonaId();
  const draft = { text, hasMedia, links: detectLinks(text) };
  const out = [];
  for (const dest of boundDestinationsFor(persona)) {
    try {
      // RETRY the read (the repo rule: adapters fail 2% of calls by design;
      // a single transient failure must not blank the price panel — it
      // did, once in ~5 sweep runs, as "crosspost toggle did not appear").
      // Still fail-closed below when the estimate fails persistently.
      const cost = await retryAdapter(() => dest.costEstimate(draft));
      out.push({
        id: dest.id,
        displayName: dest.displayName,
        capabilities: dest.capabilities,
        cost,
        degradation: degradeFor(dest, draft),
        // live rate cards go stale; the verification date rides the estimate
        ...(dest.id === "x" ? { rateCardVerified: xRateCardMeta().lastVerified } : {}),
      });
    } catch {
      // an unreachable destination is simply not offered this round —
      // showing it without a cost estimate would hide the price
    }
  }
  return NextResponse.json({ personaId: persona, destinations: out });
}

/**
 * POST { castHash, text, hasMedia, destinationIds } → publish to each bound
 * destination, record refs, log crosspost edge events.
 */
export async function POST(req: NextRequest) {
  const { castHash, text, hasMedia, destinationIds, confirmSpend } = await req.json();
  if (!castHash || !Array.isArray(destinationIds) || destinationIds.length === 0)
    return NextResponse.json({ error: "castHash and destinationIds required" }, { status: 400 });
  const persona = activeSeedPersonaId();
  const bound = new Set(boundDestinationsFor(persona).map((d) => d.id));
  const draft = { text: String(text ?? ""), hasMedia: !!hasMedia, links: detectLinks(String(text ?? "")) };

  const published = [];
  try {
    for (const destId of destinationIds) {
      // BINDING ENFORCED SERVER-SIDE: a client asking for a destination its
      // persona has not bound gets a refusal, not a quiet skip.
      if (!bound.has(destId))
        return NextResponse.json(
          { error: `destination ${destId} is not bound to the active persona` },
          { status: 403 }
        );
      const dest = DESTINATIONS[destId];
      // publish exactly what the degradation preview promised — the preview
      // IS the contract for what the destination receives
      const degraded = degradeFor(dest, draft);
      const delivered = {
        text: degraded.deliveredText,
        hasMedia: draft.hasMedia && !degraded.mediaDropped,
        links: degraded.linksDropped ? [] : draft.links,
      };
      let externalRef: string;
      if (destId === "x") {
        // the COSTED destination goes through the spend ledger: cap gate,
        // confirm threshold, idempotency key, check-before-retry — the only
        // path to a publish that costs money
        const { guardedPublish, SpendCapError } = await import("@/lib/x/spend");
        try {
          const result = await guardedPublish(dest, delivered, {
            idempotencyKey: `x:${castHash}`,
            confirmed: !!confirmSpend,
          });
          externalRef = result.externalRef;
          if (result.deduped) {
            // already landed on a prior attempt. If that attempt died AFTER
            // the publish but BEFORE the record/event writes, converge them
            // now — otherwise this is a pure no-op with the same ref.
            const s0 = state();
            const list0 = s0.crossposts.get(castHash) ?? [];
            if (!list0.some((r) => r.destinationId === destId)) {
              list0.push({ destinationId: destId, externalRef, at: Date.now() });
              s0.crossposts.set(castHash, list0);
              await persistNs("crossposts");
              await logEdgeEvent({
                type: "crosspost",
                actorPersonaId: persona,
                targetPersona: destId,
                triggeringCastId: castHash,
                context: "composer",
                externalRef,
              });
            }
            published.push({ destinationId: destId, externalRef, deduped: true });
            continue;
          }
        } catch (e) {
          if (e instanceof SpendCapError) {
            return NextResponse.json(
              { error: e.message, cap: e.cap, published },
              { status: 402 }
            );
          }
          throw e;
        }
      } else {
        ({ externalRef } = await dest.publish(delivered));
      }
      const s = state();
      const list = s.crossposts.get(castHash) ?? [];
      list.push({ destinationId: destId, externalRef, at: Date.now() });
      s.crossposts.set(castHash, list);
      await persistNs("crossposts");
      // the relationship log records the action, with the external ref
      await logEdgeEvent({
        type: "crosspost",
        actorPersonaId: persona,
        targetPersona: destId,
        triggeringCastId: castHash,
        context: "composer",
        externalRef,
      });
      published.push({ destinationId: destId, externalRef });
    }
    return NextResponse.json({ published });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message, published }, { status: 503 });
  }
}
