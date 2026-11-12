import { NextRequest, NextResponse } from "next/server";
import { addLocalCast, findLocalCast, getSelf, liveMode } from "@/lib/data";
import { getSession } from "@/lib/session";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { kindOf } from "@/lib/identity/personaKind";
import { assertWriteAllowed, WriteDisabledError } from "@/lib/adapters/neynar/mode";
import { hydrate, personaById, postByHash } from "@/lib/adapters/mock/store";
import { networkWriteRefusal } from "@/lib/fc/networkTarget";
import { publishFcCast } from "@/lib/fc/writes";
import { castTooLong } from "@/lib/fc/castLimits";
import { isEmptyWorld } from "@/lib/world-flag";
import {
  classifyTarget,
  deliveryChanged,
  deliveryChangedResponse,
  deliveryFor,
  farcasterResult,
  forVerb,
  isFarcaster,
  layersOnly,
  lineFor,
  parseExpectation,
  recordAttribution,
  uncheckedResponse,
  writeErrorResponse,
  type FcDelivery,
} from "../farcasterDelivery";
import {
  eventIdempotencyKey,
  followingFor,
  logEdgeEvent,
  resolveFirstInteraction,
} from "@/lib/eventlog/log";

export const dynamic = "force-dynamic";

// Publish a cast — the Composer's Post and Reply. BUILD A: when real Farcaster writes are armed and the acting persona
// owns its OWN live account, the cast goes out through the one write door (lib/fc/writes.ts: identity rule, ledger,
// caps, check-before-retry) as that persona, and a local copy keeps the app in sync. Otherwise it is saved in Totem
// only — the local store, authored by the ROOT signer and rendered under the ACTIVE PERSONA identity (marker carried
// in the cast body, stripped at render; see lib/policy.ts) — and the answer says so. Either way the response carries
// `delivery`: where it went, in the words the UI shows (app/api/actions/farcasterDelivery.ts).
//
// BUILD A review (PUB-1): the post carries `expect` — the line the Composer showed before the click ({ to, personaId,
// fid }). Where it goes is decided again HERE, and a post whose answer differs (another persona, another account,
// public where the line said Totem or the reverse) is refused 409 FC_DELIVERY_CHANGED with the fresh line, nothing
// posted. On the real network a Farcaster post with no expectation is refused the same way. (PUB-2) A Farcaster post
// over 320 bytes is refused before the write door, in the same words as the Composer's counter (lib/fc/castLimits.ts).
export async function POST(req: NextRequest) {
  // Writes are dead in live mode. This THROWS rather than no-opping: a silent
  // no-op returns 200, the UI shows a success toast, and the user believes
  // they posted something that does not exist.
  try {
    assertWriteAllowed("cast");
  } catch (e) {
    if (e instanceof WriteDisabledError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    throw e;
  }

  const body = await req.json();
  const { text, replyToHash, markRefutation } = body;
  if (!text || typeof text !== "string")
    return NextResponse.json({ error: "text required" }, { status: 400 });
  const expect = parseExpectation(body.expect);
  // FC-READ: a reply to a NETWORK cast would become a local cast threaded under a real Farcaster post that no other
  // client will ever see — refused per target. A top-level post (no replyToHash) and replies to local or seed casts
  // are the visitor's own world and proceed exactly as before (lib/fc/networkTarget.ts).
  const refusal = await networkWriteRefusal(typeof replyToHash === "string" ? replyToHash : null);
  if (refusal) return NextResponse.json(refusal, { status: 403 });
  const session = await getSession();
  // LAYERS_WORLD=empty (review F6): with no real persona yet, say so in the words every other surface uses — there is
  // no signer to connect on the owner service, there is a persona to create
  const emptyWorld = isEmptyWorld();
  if (!session.active)
    return NextResponse.json(
      emptyWorld
        ? { error: "No persona yet — create one in Settings › Account & Personas first", code: "no_persona" }
        : { error: "connect a signer first" },
      { status: emptyWorld ? 409 : 401 }
    );

  // WHO IS ACTING is decided here, from the server's own state — never from
  // the request body. A client that could name its own audience could publish
  // a private persona's post to the public timeline by sending one extra
  // field, which is the whole feature undone by a JSON key.
  const acting = activeSeedPersonaId();
  // PERSONA LAUNCH P1 (SIWF), belt and braces: /api/seed-persona never makes the read-only public self the acting
  // persona, and a cookie that names it anyway is refused here, before anything is written
  {
    const { publicSelfRefusalFor } = await import("@/lib/identity/handleStem");
    const { getPersona } = await import("@/lib/identity/keystore");
    const who = acting;
    const refusal = publicSelfRefusalFor(() => (who ? getPersona(who) : null));
    if (refusal) return NextResponse.json(refusal, { status: 403 });
  }
  // LAYERS_WORLD=empty (review WORLD-ID-3 / F5): the post is AUTHORED by the persona the kind check below is made on —
  // the acting persona, resolved from the session's roster by the acting id — never by the switcher's track. The
  // session prefers the acting persona under the flag, so the two agree; if they ever do not, refuse rather than
  // publish as one persona after checking another. The Totem-only copy below takes its author from `author`.
  if (emptyWorld && session.active.id !== acting)
    return NextResponse.json(
      { error: "the acting persona and the session's persona disagree — switch persona again, then post", code: "persona_mismatch" },
      { status: 409 }
    );
  const author = (emptyWorld && session.personas.find((p) => p.id === acting)) || session.active;
  const kind = kindOf(acting);
  if (kind !== "public") {
    return NextResponse.json(
      {
        error:
          kind === "private"
            ? "this persona is private — its posts go to its audience, not the public timeline"
            : "cannot establish that this persona may publish publicly",
        personaKind: kind,
      },
      { status: 403 }
    );
  }

  const marker = ` layers:persona:${author.id}`;

  if (liveMode() && process.env.NEYNAR_SIGNER_UUID) {
    // FC pass HARD IDENTITY RULE (safety-set): this was a phase-1 direct
    // publish — a raw fetch signing with WHATEVER signer uuid the env
    // carried, no write ledger, no caps, no throwaway-FID identity check.
    // Retired outright rather than patched: live writes exist ONLY behind
    // the Gate 3 write seam (ENABLE_FC_WRITE + the Gate 1 throwaway
    // credentials + the ledger). Refusing loudly beats publishing quietly.
    return NextResponse.json(
      {
        error:
          "live publish refused: the direct NEYNAR_SIGNER_UUID path is retired — " +
          "live writes go through the FC write ledger (ENABLE_FC_WRITE + throwaway FID) only",
      },
      { status: 403 }
    );
  }

  // ---- BUILD A: to Farcaster through the ONE write door when this persona owns its own account, or honestly not ----
  // (app/api/actions/farcasterDelivery.ts). Writes off — every rig suite, every public preview — answers "Totem" with
  // no I/O, and the local path below runs exactly as it always did. Nothing is ever posted as the shared test account.
  const isReply = typeof replyToHash === "string" && replyToHash.length > 0;
  const verb = isReply ? "reply" : "cast";
  let delivery: FcDelivery;
  try {
    delivery = await deliveryFor(acting);
  } catch (e) {
    return uncheckedResponse(e, "this persona's Farcaster account");
  }
  let fcParent: string | undefined;
  if (isFarcaster(delivery) && isReply) {
    // a reply goes to Farcaster only under a Farcaster cast, and never under another of the owner's own accounts
    try {
      await hydrate(); // the attribution index is read directly
      const t = await classifyTarget(replyToHash, delivery);
      if (t.verdict === "refuse") return NextResponse.json({ error: t.message, code: t.code }, { status: t.status });
      if (t.verdict === "layers") delivery = layersOnly(delivery, t.reason, "reply");
      else fcParent = replyToHash;
    } catch (e) {
      return uncheckedResponse(e, "who wrote the post you're replying to");
    }
  }

  // PUB-1: still what the owner was shown? (nothing has been sent or saved yet)
  {
    const fresh = isReply ? lineFor(forVerb(delivery, "reply"), true) : forVerb(delivery, "cast");
    const why = deliveryChanged(expect, fresh);
    if (why) return deliveryChangedResponse(why, fresh);
  }
  // PUB-2: Farcaster takes 320 bytes; a longer post would only come back refused (Totem-only posts may be longer)
  if (isFarcaster(delivery)) {
    const tooLong = castTooLong(text);
    if (tooLong) return NextResponse.json({ error: tooLong, code: "FC_TOO_LONG" }, { status: 422 });
  }

  let hash: string;
  if (isFarcaster(delivery)) {
    const d = delivery;
    let r: Awaited<ReturnType<typeof publishFcCast>>;
    try {
      await hydrate(); // the ledger (caps, check-before-retry) is read directly
      // requireFid / requireMode: the door refuses rather than post under any other account or network
      r = await publishFcCast(text, fcParent ? "reply" : "cast", fcParent, { personaId: acting, requireFid: d.fid, requireMode: d.mode });
    } catch (e) {
      // refused or unconfirmed: nothing is saved here either, so the composer keeps the text for a retry (a retry of
      // an unconfirmed publish is CHECKED by the door before anything is re-sent)
      return writeErrorResponse(e, verb);
    }
    hash = r.hash;
    const att = await recordAttribution(r.hash, acting, r.deduped);
    // the local copy stays in sync: the same cast, under its network hash and the persona's own fid (a retry that
    // found an earlier publish adds it once)
    if (!findLocalCast(r.hash)) {
      const self = getSelf();
      const p = personaById.get(acting);
      addLocalCast({
        hash: r.hash,
        author: {
          ...self,
          fid: d.fid,
          username: d.handle,
          displayName: p?.name ?? d.handle,
          pfpUrl: p?.avatarUrl || self.pfpUrl,
        },
        text: text + ` layers:persona:${acting}`,
        timestamp: Date.now(),
        replies: 0,
        likes: 0,
        recasts: 0,
        // no views: Farcaster has no such metric, and a copy of a Farcaster cast must not invent one
        embeds: [],
        ...(fcParent ? { replyingTo: fcParent } : {}),
      });
    }
    delivery = farcasterResult(d, verb, {
      hash: r.hash,
      deduped: r.deduped,
      warning: att.ok ? undefined : att.error + " — the post itself is on Farcaster",
    });
  } else {
    // In Totem only — the local path, unchanged.
    const self = getSelf();
    // The cast is authored by the ROOT's fid (the underlying signer identity);
    // stub-signer roots carry their fid in a cookie set at connect time.
    const fidCookie = req.cookies.get("layers_fid")?.value;
    const authorFid = fidCookie ? Number(fidCookie) : self.fid;
    hash = "0xlocal" + Date.now().toString(16);
    addLocalCast({
      hash,
      author: {
        ...self,
        fid: authorFid,
        username: author.handle,
        displayName: author.name,
        pfpUrl: author.avatarUrl || self.pfpUrl,
      },
      text: text + marker,
      timestamp: Date.now(),
      replies: 0,
      likes: 0,
      recasts: 0,
      views: 1,
      embeds: [],
      // parent linkage so the thread page can render this reply in place
      ...(replyToHash ? { replyingTo: replyToHash } : {}),
    });
    delivery = forVerb(delivery, verb);
  }

  // A reply is an action the user took — the other half of co-interaction.
  // Only replies to seeded posts resolve to a persona author; phase-1
  // fixture casts have none, and produce no edge.
  if (replyToHash) {
    const parent = postByHash.get(replyToHash);
    if (parent) {
      const actor = activeSeedPersonaId();
      if (markRefutation) {
        // Author-declared refutation: testimony, recorded as such. Whether
        // it takes STANDING from the target is decided later by tier and
        // curator attestation — declaring is free, dethroning is not.
        //
        // Asserted by the persona that AUTHORED the cast (the session
        // persona in the marker), not the seed viewer — the authorship
        // check compares the edge's asserter to the cast's author, and
        // those are different identity universes (Gate 0 found the cast
        // route asserting one while stamping the other).
        const { declareEdge } = await import("@/lib/refutation/edges");
        await declareEdge({
          fromCastId: hash,
          toCastId: replyToHash,
          type: "refutes",
          declaredBy: "author",
          assertedBy: author.id,
        });
      }
      await logEdgeEvent({
        type: "reply",
        actorPersonaId: actor,
        targetPersona: parent.authorPersonaId,
        triggeringCastId: replyToHash,
        context: "thread",
        idempotencyKey: eventIdempotencyKey(req, body),
      });
      if (followingFor(actor).has(parent.authorPersonaId)) {
        await resolveFirstInteraction(actor, parent.authorPersonaId, "thread");
      }
    }
  }
  // BUILD A: where it went, in the words the composer shows ("Posted to Farcaster as @x" with the cast's address, or
  // "Saved in Totem only — <why>")
  return NextResponse.json({ hash, delivery });
}
