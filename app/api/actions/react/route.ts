import { NextRequest, NextResponse } from "next/server";
import { assertWriteAllowed, WriteDisabledError } from "@/lib/adapters/neynar/mode";
import { setReaction } from "@/lib/data";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { hydrate, postByHash } from "@/lib/adapters/mock/store";
import { networkWriteRefusal } from "@/lib/fc/networkTarget";
import { reactFc } from "@/lib/fc/writes";
import {
  eventIdempotencyKey,
  followingFor,
  logEdgeEvent,
  resolveFirstInteraction,
} from "@/lib/eventlog/log";
import {
  classifyTarget,
  deliveryFor,
  farcasterResult,
  forVerb,
  isFarcaster,
  layersOnly,
  pendingBefore,
  personaChangedResponse,
  sentBefore,
  uncheckedResponse,
  writeErrorResponse,
  type FcDelivery,
} from "../farcasterDelivery";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    assertWriteAllowed("react");
  } catch (e) {
    if (e instanceof WriteDisabledError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    throw e;
  }

  const body = await req.json();
  const { hash, kind, on } = body;
  if (!hash || !["like", "recast"].includes(kind))
    return NextResponse.json({ error: "hash and kind required" }, { status: 400 });
  // FC-READ: a like/recast on a NETWORK cast (read through the public relay) would be recorded here and nowhere
  // else — setReaction takes any hash — so it is refused per target, before the reaction or its default stake.
  // Local and seed targets, and every rig, pass through unchanged (lib/fc/networkTarget.ts).
  const refusal = await networkWriteRefusal(hash);
  if (refusal) return NextResponse.json(refusal, { status: 403 });

  // ---- BUILD A: a like or recast of a FARCASTER cast, by a persona that owns its own account, goes to Farcaster ----
  // through the one write door (app/api/actions/farcasterDelivery.ts). Writes off — every rig suite, every public
  // preview — answers "Totem" with no I/O and the reaction below is exactly what it always was.
  const verb: "like" | "recast" = kind;
  const acting = activeSeedPersonaId();
  // PERSONA LAUNCH P1 (SIWF), belt and braces: never a like or recast AS the read-only public self
  {
    const { publicSelfRefusalFor } = await import("@/lib/identity/handleStem");
    const { getPersona } = await import("@/lib/identity/keystore");
    const who = acting;
    const refusal = publicSelfRefusalFor(() => (who ? getPersona(who) : null));
    if (refusal) return NextResponse.json(refusal, { status: 403 });
  }
  let delivery: FcDelivery;
  try {
    delivery = await deliveryFor(acting);
  } catch (e) {
    return uncheckedResponse(e, "this persona's Farcaster account");
  }
  if (isFarcaster(delivery)) {
    const d = delivery;
    if (!on) {
      // Taking a reaction back on Farcaster is not wired yet (the door has no un-like): say so, change nothing. A heart
      // this persona never sent through Totem (a Totem-only like from before it had an account) is undone in Totem,
      // and the answer says Farcaster was not touched.
      // BUILD A review (UXC-11): decided BEFORE the target check — taking a like back sends nothing anywhere, so it
      // needs no author and is never refused as "another of your accounts" (that refusal left a Totem-only heart on a
      // sibling's cast that could never be cleared). (PUB-6) A like still ON ITS WAY (pending: a double tap) counts as
      // sent — "nothing changed on Farcaster" would be false the moment it lands.
      try {
        await hydrate(); // the ledger is read directly
      } catch (e) {
        return uncheckedResponse(e, "what this persona already sent");
      }
      const noun = verb === "like" ? "like" : "recast";
      if (pendingBefore(verb, d, String(hash))) {
        return NextResponse.json(
          { error: `Your ${noun} is still being sent to Farcaster, so it can't be taken back here — once it lands, remove it in a Farcaster app.`, code: "FC_UNDO_UNSUPPORTED" },
          { status: 409 }
        );
      }
      if (sentBefore(verb, d, { castHash: String(hash) })) {
        return NextResponse.json(
          { error: `Removing a ${noun} on Farcaster isn't available from Totem yet — nothing changed. Remove it in a Farcaster app.`, code: "FC_UNDO_UNSUPPORTED" },
          { status: 409 }
        );
      }
      setReaction(hash, kind, false);
      return NextResponse.json({ ok: true, stake: null, delivery: layersOnly(d, "undo_local", verb) });
    }
    // PUB-1: the card names the persona it was rendered for; another tab may have switched the shared cookie since
    {
      const changed = personaChangedResponse(body.actingPersonaId, acting);
      if (changed) return changed;
    }
    try {
      await hydrate(); // the attribution index and the ledger are read directly
      // the card sends its author's fid: it can only ever cause a refusal (another of your accounts), never a send
      const authorFid = typeof body.authorFid === "number" ? body.authorFid : null;
      const t = await classifyTarget(String(hash), d, { authorFid });
      if (t.verdict === "refuse") return NextResponse.json({ error: t.message, code: t.code }, { status: t.status });
      if (t.verdict === "layers") delivery = layersOnly(d, t.reason, verb);
    } catch (e) {
      return uncheckedResponse(e, "who wrote that post");
    }
    if (isFarcaster(delivery)) {
      // (a PENDING earlier like is sent again: after an unanswered attempt that is the safe retry — Farcaster keeps one
      // like per account — and the card's in-flight guard keeps one tab from racing itself)
      const already = sentBefore(verb, d, { castHash: String(hash) });
      if (!already) {
        try {
          // requireFid / requireMode: never under any other account or network
          await reactFc(verb, String(hash), { personaId: acting, requireFid: d.fid, requireMode: d.mode });
        } catch (e) {
          // the heart reverts in the UI; an unconfirmed send keeps its PENDING ledger entry (and its budget)
          return writeErrorResponse(e, verb);
        }
      }
      // the local copy stays in sync with what Farcaster now holds
      setReaction(hash, kind, true);
      await logReaction(req, body, kind, true, hash);
      const stake = await maybeStake(body, kind, hash);
      return NextResponse.json({ ok: true, stake, delivery: farcasterResult(d, verb, { already }) });
    }
  }

  setReaction(hash, kind, !!on);
  await logReaction(req, body, kind, !!on, hash);
  // MEGA PASS 2 Gate 1: a like/recast carries the user's default stake for that action (settable per action;
  // zero = none). The action stands whatever the stake says — a refused stake is REPORTED beside it, never a
  // failed like. `stake: null` or `stake: { amount: 0 }` opts out for this one action.
  const stake = await maybeStake(body, kind, hash);
  // BUILD A: where it went ("Liked in Totem only — <why>"); the card says it only for a live Farcaster post
  return NextResponse.json({ ok: true, stake, delivery: forVerb(delivery, verb) });
}

// A like is an action the user took, so it belongs in the relationship
// log — and it is one half of co-interaction detection. Only seeded posts
// resolve to a persona author; phase-1 fixture casts have no persona and
// produce no edge, which is correct rather than a gap.
async function logReaction(req: NextRequest, body: unknown, kind: "like" | "recast", on: boolean, hash: string) {
  if (kind === "like" && on) {
    const post = postByHash.get(hash);
    if (post) {
      const actor = activeSeedPersonaId();
      await logEdgeEvent({
        type: "like",
        actorPersonaId: actor,
        targetPersona: post.authorPersonaId,
        triggeringCastId: hash,
        context: "timeline",
        idempotencyKey: eventIdempotencyKey(req, body as Record<string, unknown>),
      });
      // "already follows" half: if this author is already followed and no
      // first-interaction pair exists, this like is the origin.
      if (followingFor(actor).has(post.authorPersonaId)) {
        await resolveFirstInteraction(actor, post.authorPersonaId, "timeline");
      }
    }
  }
}

async function maybeStake(body: { on?: unknown; stake?: { amount?: unknown; direction?: unknown } | null }, kind: "like" | "recast", hash: string) {
  if (!body.on || body.stake === null) return null;
  const s = body.stake ?? {};
  const amount = s.amount === undefined ? undefined : Number(s.amount);
  if (amount === 0) return null;
  const { placeStake } = await import("@/lib/influence/stakes");
  const { isStakeDirection } = await import("@/lib/influence/types");
  try {
    return await placeStake({ personaId: activeSeedPersonaId(), castHash: hash, action: kind, amount, direction: isStakeDirection(s.direction) ? s.direction : undefined });
  } catch (e) {
    return { ok: false as const, code: "unavailable" as const, reason: (e as Error).message };
  }
}
