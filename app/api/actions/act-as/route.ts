import { NextRequest, NextResponse } from "next/server";
// ACT-AS-ANY-PERSONA — reply / quote / recast on a cast, from any persona
// you control, WITHOUT switching your active persona.
//
// The trust boundary this route exists to enforce, stated exactly like the
// two routes it borrows its shape from (actions/cast, private/posts): the
// EFFECTIVE acting persona for this one action is validated on the SERVER
// against the set of personas this root actually controls
// (SEED_VIEWER.personas) — the same allowlist /api/seed-persona already
// uses for real persona-switching. A client naming an arbitrary personaId
// gets a 403, never a silent fall-through to whatever is currently active.
// Widening WHICH of your own personas can post on a given request is not
// the same as trusting the client's own account of who it is.
//
// BUILD A: every answer carries `delivery` — where the action went, in the words the UI shows. A reply to a Farcaster
// cast by a persona with its own account goes through the write door (as before); on an ARMED service that account
// must be live (a fixture or pending record never sim-writes there), and never toward the owner's main account or the
// shared test account. A recast of a Farcaster cast goes there too when writes are armed (app/api/actions/
// farcasterDelivery.ts). The picker's waiver (A-FID-SELF-GRAPH) covers your other personas here, as it always has.
import { addLocalCast, getCast, getSelf } from "@/lib/data";
import { isOwnPersona } from "@/lib/identity/keystore";
import { attributionCanonical } from "@/lib/fc/attribution";
import { signForPersona } from "@/lib/identity/keys";
import { fcSimNetworkCasts, publishFcCast, reactFc } from "@/lib/fc/writes";
import { personaNetworkMode } from "@/lib/fc/networkMode";
import { personaFidRecord } from "@/lib/fc/personaFid";
import { hydrate, persistNs, state } from "@/lib/adapters/mock/store";
import { assertWriteAllowed, WriteDisabledError, writeEnabled } from "@/lib/adapters/neynar/mode";
import { networkWriteRefusal } from "@/lib/fc/networkTarget";
import { isPrivatePersona } from "@/lib/identity/personaKind";
import { createPrivatePost } from "@/lib/private/store";
import { visiblePrivatePost } from "@/lib/private/visibility";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { SEED_VIEWER, personaById, postByHash } from "@/lib/adapters/mock/store";
import {
  eventIdempotencyKey,
  followingFor,
  logEdgeEvent,
  resolveFirstInteraction,
} from "@/lib/eventlog/log";
import { boundDestinationsFor } from "@/lib/crosspost/destinations";
import {
  classifyTarget,
  deliveryFor,
  farcasterResult,
  forVerb,
  isFarcaster,
  layersOnly,
  sentBefore,
  uncheckedResponse,
  writeErrorResponse,
  type FarcasterDelivery,
  type FcDelivery,
} from "../farcasterDelivery";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    assertWriteAllowed("cast");
  } catch (e) {
    if (e instanceof WriteDisabledError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    throw e;
  }

  const body = await req.json();
  const { kind, targetHash, text, asPersonaId, destinationIds } = body as {
    kind: "reply" | "quote" | "recast";
    targetHash: string;
    text?: string;
    asPersonaId: string;
    destinationIds?: string[];
  };

  if (!["reply", "quote", "recast"].includes(kind))
    return NextResponse.json({ error: "kind must be reply, quote, or recast" }, { status: 400 });
  if (!targetHash) return NextResponse.json({ error: "targetHash required" }, { status: 400 });
  // FC-READ: reply / quote / recast on a NETWORK cast (read through the public relay) refuses per target — the
  // recast branch below would setReaction any hash, and a reply/quote would mint a local cast under a real Farcaster
  // post. Armed only on a relay-reading public device, so the rig's per-persona-fid network reply (a REAL write
  // behind ENABLE_FC_WRITE) and every local/seed target are unchanged (lib/fc/networkTarget.ts).
  {
    const refusal = await networkWriteRefusal(typeof targetHash === "string" ? targetHash : null);
    if (refusal) return NextResponse.json(refusal, { status: 403 });
  }

  // THE CHECK. asPersonaId is client-supplied — it earns trust only by
  // membership in the allowlist, exactly as /api/seed-persona requires for
  // an outright persona switch.
  // MULTI-FID Gate 2: a minted persona of this device may act too
  if (!asPersonaId || (!SEED_VIEWER.personas.includes(asPersonaId) && !isOwnPersona(asPersonaId))) {
    return NextResponse.json({ error: "not one of your personas" }, { status: 403 });
  }
  // PERSONA LAUNCH P1 (SIWF), belt and braces: one of your personas, but never the read-only public self (the picker offers
  // it nowhere; a request that names it anyway is refused before anything is resolved)
  {
    const { publicSelfRefusalFor } = await import("@/lib/identity/handleStem");
    const { getPersona } = await import("@/lib/identity/keystore");
    const who = asPersonaId;
    const refusal = publicSelfRefusalFor(() => (who ? getPersona(who) : null));
    if (refusal) return NextResponse.json(refusal, { status: 403 });
  }
  const actingPersona = personaById.get(asPersonaId);
  if (!actingPersona) return NextResponse.json({ error: "unknown persona" }, { status: 404 });

  const activeNow = activeSeedPersonaId();
  const viaActAs = asPersonaId !== activeNow;
  const idempotencyKey = eventIdempotencyKey(req, body);

  // BUILD A: where an action by this persona goes. Writes off (every rig suite, every public preview) answers
  // "Totem" with no I/O, and every branch below runs exactly as before.
  let actDelivery: FcDelivery;
  try {
    actDelivery = await deliveryFor(asPersonaId);
  } catch (e) {
    return uncheckedResponse(e, "this persona's Farcaster account");
  }

  // Resolution order: public/seeded/local first (getCast covers all three).
  // A reply MAY also target a private post the acting persona can see —
  // getCast knows nothing about the private store, so that lookup is the
  // fallback, not a special case bolted onto the "not found" path. Quote
  // and recast stay public-target-only: getCast returning null for a
  // private post's hash already refuses them, correctly, as "not found"
  // from that persona's vantage rather than confirming a private post's
  // existence to whoever the acting persona is quoting/recasting as.
  const target = await getCast(targetHash);
  const privateTarget = !target && kind === "reply" ? visiblePrivatePost(targetHash, asPersonaId) : null;
  // MULTI-FID Gate 2: a cast on the (sim or live) NETWORK is a target too — the persona with its own fid
  // replies through the write door, signed by ITS signer, and the reply is attributed to it.
  // BUILD A: a recast of one too, when this persona's recast goes to Farcaster (otherwise unchanged: not found)
  const networkTarget =
    !target && !privateTarget && (kind === "reply" || (kind === "recast" && isFarcaster(actDelivery)))
      ? fcSimNetworkCasts().find((c) => c.hash === targetHash) ?? null
      : null;
  if (!target && !privateTarget && !networkTarget) return NextResponse.json({ error: "target not found" }, { status: 404 });
  // BUILD A: a cast the write door published (the Composer now keeps a local copy of it under its network hash, which
  // getCast finds first) is on the network too — the attribution index or the sim network says so
  let doorPublished = false;
  if (target && target.live !== true && !networkTarget && (kind === "reply" || (kind === "recast" && isFarcaster(actDelivery)))) {
    try {
      await hydrate(); // the attribution index is read directly
      doorPublished = state().fcAttribution.has(targetHash) || fcSimNetworkCasts().some((c) => c.hash === targetHash);
    } catch (e) {
      return uncheckedResponse(e, "whether that post is on Farcaster");
    }
  }
  const targetIsNetwork = networkTarget !== null || (target !== null && (target.live === true || doorPublished));
  const targetAuthorFid = networkTarget?.fid ?? (target?.live || doorPublished ? target?.author?.fid ?? null : null);

  let networkReply =
    kind === "reply" && targetIsNetwork && personaNetworkMode() === "per-persona-fid" && !isPrivatePersona(asPersonaId) && !!(await personaFidRecord(asPersonaId));
  // BUILD A: on an ARMED service the persona's own account must be live — a fixture or pending record never
  // sim-writes there (the reply stays in Totem, and says why)
  if (networkReply && writeEnabled() && !isFarcaster(actDelivery)) networkReply = false;
  if (networkReply && isFarcaster(actDelivery)) {
    // never toward the owner's main account or the shared test account; an anonymous post stays in Totem
    try {
      await hydrate();
      const t = await classifyTarget(targetHash, actDelivery, { authorFid: targetAuthorFid, siblingsAllowed: true });
      if (t.verdict === "refuse") return NextResponse.json({ error: t.message, code: t.code }, { status: t.status });
      if (t.verdict === "layers") {
        networkReply = false;
        actDelivery = layersOnly(actDelivery, t.reason, "reply");
      }
    } catch (e) {
      return uncheckedResponse(e, "who wrote that post");
    }
  }
  if (networkReply) {
    if (!text || typeof text !== "string") return NextResponse.json({ error: "text required" }, { status: 400 });
    const guarded = isFarcaster(actDelivery) ? actDelivery : null;
    try {
      const r = await publishFcCast(text, "reply", targetHash, {
        personaId: asPersonaId,
        ...(guarded ? { requireFid: guarded.fid, requireMode: guarded.mode } : {}),
      });
      if (!r.deduped || !state().fcAttribution.get(r.hash)) {
        const at = Date.now();
        const signature = signForPersona(asPersonaId, attributionCanonical(r.hash, asPersonaId, at));
        if (signature) {
          state().fcAttribution.set(r.hash, { personaId: asPersonaId, at, signature });
          await persistNs("fcAttribution");
        }
      }
      // where it went: the decided account, or (writes off on a rig) the simulated network the door chose
      const d: FarcasterDelivery | null =
        guarded ??
        (r.fid !== null
          ? { to: "farcaster", personaId: asPersonaId, handle: actingPersona.handle, fid: r.fid, fname: null, mode: r.mode, message: "" }
          : null);
      const delivery = d ? farcasterResult(d, "reply", { hash: r.hash, deduped: r.deduped }) : undefined;
      return NextResponse.json({ ok: true, kind, asPersonaId, hash: r.hash, fid: r.fid, network: true, mode: r.mode, ...(delivery ? { delivery } : {}) });
    } catch (e) {
      // BUILD A: the exact refusal — a cap (429), the identity rule or a self-link (403), an unconfirmed send (502)
      return writeErrorResponse(e, "reply");
    }
  }

  const marker = ` layers:persona:${asPersonaId}`;
  const seedTarget = postByHash.get(targetHash);
  const targetAuthorPersona = seedTarget?.authorPersonaId ?? target?.personaId ?? privateTarget?.authorPersonaId ?? null;

  try {
    if (kind === "recast") {
      // BUILD A: a recast of a Farcaster cast by a persona that owns its own account goes to Farcaster
      if (isFarcaster(actDelivery)) {
        const d = actDelivery;
        let toFarcaster = false;
        try {
          await hydrate();
          const t = await classifyTarget(targetHash, d, { authorFid: targetAuthorFid, siblingsAllowed: true });
          if (t.verdict === "refuse") return NextResponse.json({ error: t.message, code: t.code }, { status: t.status });
          if (t.verdict === "farcaster") toFarcaster = true;
          else actDelivery = layersOnly(d, t.reason, "recast");
        } catch (e) {
          return uncheckedResponse(e, "who wrote that post");
        }
        if (toFarcaster) {
          const already = sentBefore("recast", d, { castHash: targetHash });
          if (!already) {
            try {
              await reactFc("recast", targetHash, { personaId: asPersonaId, requireFid: d.fid, requireMode: d.mode });
            } catch (e) {
              return writeErrorResponse(e, "recast");
            }
          }
          const { setReaction } = await import("@/lib/data");
          setReaction(targetHash, "recast", true);
          if (targetAuthorPersona) {
            await logEdgeEvent({
              type: "recast",
              actorPersonaId: asPersonaId,
              targetPersona: targetAuthorPersona,
              triggeringCastId: targetHash,
              context: "act_as",
              viaActAs,
              idempotencyKey,
            });
          }
          return NextResponse.json({ ok: true, kind, asPersonaId, delivery: farcasterResult(d, "recast", { already }) });
        }
      }
      // A recast has no body of its own — the target IS the content. No new
      // cast record; only the relationship-log action and the (currently
      // silent, same as the non-act-as recast button) reaction toggle.
      const { setReaction } = await import("@/lib/data");
      setReaction(targetHash, "recast", true);
      if (targetAuthorPersona) {
        await logEdgeEvent({
          type: "recast",
          actorPersonaId: asPersonaId,
          targetPersona: targetAuthorPersona,
          triggeringCastId: targetHash,
          context: "act_as",
          viaActAs,
          idempotencyKey,
        });
      }
      return NextResponse.json({ ok: true, kind, asPersonaId, delivery: inLayers(actDelivery, "recast") });
    }

    // reply / quote both mint new content, as a private post if the acting
    // persona is private, else a public local cast — the SAME branch every
    // other posting surface in this app uses, just keyed on the CHOSEN
    // persona instead of whichever one happens to be active.
    if (!text || typeof text !== "string")
      return NextResponse.json({ error: "text required" }, { status: 400 });

    if (isPrivatePersona(asPersonaId)) {
      if (kind === "quote")
        return NextResponse.json(
          { error: "quoting is not yet supported for private personas — private posts have no embed slot" },
          { status: 400 }
        );
      // a private reply must be visible to the replier, same rule the
      // plain private-posts route enforces — replying is not a way to
      // write into a thread you were never shown
      if (!visiblePrivatePost(targetHash, asPersonaId))
        return NextResponse.json({ error: "not found" }, { status: 404 });
      const post = await createPrivatePost({
        authorPersonaId: asPersonaId,
        text,
        replyToHash: targetHash,
      });
      await logEdgeEvent({
        type: "reply",
        actorPersonaId: asPersonaId,
        targetPersona: targetAuthorPersona ?? asPersonaId,
        triggeringCastId: targetHash,
        context: "act_as",
        viaActAs,
        idempotencyKey,
      });
      return NextResponse.json({ ok: true, kind, asPersonaId, hash: post.hash, private: true, delivery: inLayers(actDelivery, "reply") });
    }

    // quote is public-target-only (private posts have no embed slot, and
    // privateTarget is only ever computed for kind==="reply") — target is
    // therefore guaranteed non-null here, but assert it rather than trust
    // the branching to stay that way under future edits.
    if (kind === "quote" && !target)
      return NextResponse.json({ error: "target not found" }, { status: 404 });

    const self = getSelf();
    const hash = "0xlocal" + Date.now().toString(16) + Math.random().toString(16).slice(2, 6);
    addLocalCast({
      hash,
      author: {
        ...self,
        fid: 0,
        username: actingPersona.handle,
        displayName: actingPersona.name,
        pfpUrl: actingPersona.avatarUrl || self.pfpUrl,
      },
      text: text + marker,
      timestamp: Date.now(),
      replies: 0,
      likes: 0,
      recasts: 0,
      views: 1,
      embeds: kind === "quote" && target ? [{ type: "quote", quote: target }] : [],
      ...(kind === "reply" ? { replyingTo: targetHash } : {}),
    });

    await logEdgeEvent({
      type: kind === "quote" ? "quote" : "reply",
      actorPersonaId: asPersonaId,
      targetPersona: targetAuthorPersona ?? asPersonaId,
      triggeringCastId: targetHash,
      context: "act_as",
      viaActAs,
      idempotencyKey,
    });
    if (targetAuthorPersona && followingFor(asPersonaId).has(targetAuthorPersona)) {
      await resolveFirstInteraction(asPersonaId, targetAuthorPersona, "act_as");
    }

    // Destination binding follows the ACTING persona, not whoever is
    // active — a persona without an X attestation cannot quote-to-X just
    // because the user happened to be posting through the act-as picker.
    let boundDestinations: string[] = [];
    if (Array.isArray(destinationIds) && destinationIds.length) {
      const bound = new Set(boundDestinationsFor(asPersonaId).map((d) => d.id));
      const refused = destinationIds.filter((d) => !bound.has(d));
      if (refused.length) {
        return NextResponse.json(
          { error: `${refused.join(", ")} not bound to @${actingPersona.handle}`, hash },
          { status: 403 }
        );
      }
      boundDestinations = destinationIds;
    }

    return NextResponse.json({ ok: true, kind, asPersonaId, hash, boundDestinations, delivery: inLayers(actDelivery, kind) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

/** BUILD A: a Totem-only answer for this verb. When the persona's actions DO go to Farcaster, the reason this one
 *  did not is the action itself: a quote is not sent to Farcaster yet, and a reply or recast here targeted a post
 *  that is not on Farcaster. */
function inLayers(d: FcDelivery, verb: "reply" | "quote" | "recast"): FcDelivery {
  if (!isFarcaster(d)) return forVerb(d, verb);
  return layersOnly(d, verb === "quote" ? "quote" : "target_local", verb);
}
