import { NextRequest, NextResponse } from "next/server";
// FC Gate 3 — the ONE write door for Farcaster. Everything here goes
// ledger-first through lib/fc/writeLedger.ts and the identity gate in
// lib/fc/writes.ts. Gate 4's attribution index records at publish time,
// on this exact path — attribution is a fact about a publish, not a
// separately-mutable table.
import { SEED_VIEWER, state, persistNs, hydrate } from "@/lib/adapters/mock/store";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { attributionCanonical } from "@/lib/fc/attribution";
import { signForPersona } from "@/lib/identity/keys";
import { isOwnPersona } from "@/lib/identity/keystore";
import { FcWriteCapError, fcWrites, ledgerSummary } from "@/lib/fc/writeLedger";
import {
  FcIdentityError,
  FcRetryCheckError,
  FcRetryUnconfirmedError,
  assertThrowawayIdentity,
  deleteFcCast,
  followFc,
  isDefinitiveFailure,
  publishFcCast,
  reactFc,
  throwawayCreds,
} from "@/lib/fc/writes";
import { writeEnabled } from "@/lib/adapters/neynar/mode";
import { networkFollowRefusal, networkWriteRefusal } from "@/lib/fc/networkTarget";

export const dynamic = "force-dynamic";

export async function GET() {
  // HYDRATE FIRST: this route reads state() directly (no adapter call
  // hydrates for it). Skipping this made post-restart caps and
  // check-before-retry read an EMPTY ledger — a blind duplicate waiting
  // to happen. (Review finding, confirmed by construction.)
  await hydrate();
  return NextResponse.json({
    writeEnabled: writeEnabled(),
    throwawayConfigured: Boolean(throwawayCreds()),
    ledger: ledgerSummary(),
    entries: fcWrites().sort((a, b) => b.at - a.at).slice(0, 50),
  });
}

export async function POST(req: NextRequest) {
  await hydrate(); // same reason as GET — ledger reads precede adapter calls
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    // `null` and scalars are VALID JSON that still cannot carry an action
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }
  try {
    if (body.action === "identityProbe") {
      // NO network, ever: this probes the identity gate itself. The
      // adversarial test configures a "second FID's signer" here and must
      // see a refusal.
      try {
        const creds = assertThrowawayIdentity({
          fid: body.fid === undefined ? undefined : Number(body.fid),
          signerUuid: body.signerUuid === undefined ? undefined : String(body.signerUuid),
        });
        return NextResponse.json({ allowed: true, fid: creds.fid });
      } catch (e) {
        if (e instanceof FcIdentityError) {
          return NextResponse.json({ allowed: false, reason: e.message }, { status: 403 });
        }
        throw e;
      }
    }

    if (body.action === "cast" || body.action === "reply") {
      const text = String(body.text ?? "");
      if (!text.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
      // Gate 4: persona attribution rides the publish. The acting persona
      // must be one of the viewer's own — same allowlist every act-as
      // surface uses. Absent personaId attributes to the active persona.
      const personaId = body.personaId ? String(body.personaId) : activeSeedPersonaId();
      // MULTI-FID Gate 1: any persona THIS device holds may act — a minted one too. A PRIVATE persona
      // never gets its own fid (Gate 1 acquisition refuses it); it still posts through the SHARED
      // account exactly as in the FC pass, the network seeing only that account and the attribution
      // staying disclosure-gated — "unchanged", per the prompt.
      if (!SEED_VIEWER.personas.includes(personaId) && !isOwnPersona(personaId)) {
        return NextResponse.json({ error: "not one of your personas" }, { status: 403 });
      }
      // A reply MUST carry its parent: without one the live transport would
      // publish it as a top-level cast, which reads as success and is wrong.
      const parent = body.parentHash ? String(body.parentHash) : undefined;
      if (body.action === "reply" && !parent) {
        return NextResponse.json({ error: "parentHash required for reply" }, { status: 400 });
      }
      // FC-READ: a reply under a NETWORK cast (read through the public relay) refuses per target — the sim
      // transport would "publish" it and the ledger would call a Farcaster reply done. A top-level cast has no
      // target and is unchanged; so is every rig (lib/fc/networkTarget.ts arms only on a relay-reading device).
      {
        const refusal = await networkWriteRefusal(parent);
        if (refusal) return NextResponse.json(refusal, { status: 403 });
      }
      // MULTI-FID Gate 1: the acting persona posts as ITSELF in per-persona-fid mode
      const r = await publishFcCast(text, body.action as "cast" | "reply", parent, { personaId });
      // ATTRIBUTION IS A FACT ABOUT A PUBLISH — FIRST WRITER WINS. A
      // deduped return with an EXISTING row never overwrites it (that
      // would reattribute the cast to whoever asked second, including
      // flipping a disclosure-gated private attribution public — review
      // finding, twice-confirmed). But a deduped return with NO row is
      // the ambiguous-failure retry: the publish that created the cast
      // threw before attribution could be recorded, and this retry is the
      // same author finishing the same publish — refusing here would
      // strand the cast bare-FID forever (re-review finding).
      const existing = state().fcAttribution.get(r.hash);
      if (!r.deduped || !existing) {
        // CRYPTO pass: the row is signed by the persona it names, over the
        // canonical fixed in lib/fc/attribution.ts; attributionFor verifies
        // before rendering. No signature → no row — storing unsigned is
        // exactly the tamper the signature exists to catch. Post-allowlist
        // a null here should be unreachable (viewer personas are seeded →
        // fixture keys), so refuse loudly if it ever isn't.
        const at = Date.now();
        const signature = signForPersona(personaId, attributionCanonical(r.hash, personaId, at));
        if (!signature) {
          return NextResponse.json(
            { error: "cannot sign attribution as this persona", code: "FC_ATTRIBUTION_UNSIGNABLE" },
            { status: 403 }
          );
        }
        state().fcAttribution.set(r.hash, { personaId, at, signature });
        await persistNs("fcAttribution");
        return NextResponse.json({ ...r, personaId });
      }
      return NextResponse.json({ ...r, personaId: existing.personaId, attributionUnchanged: true });
    }

    if (body.action === "like" || body.action === "recast") {
      const target = String(body.targetHash ?? "");
      if (!target) return NextResponse.json({ error: "targetHash required" }, { status: 400 });
      // FC-READ: same per-target refusal as /api/actions/react — a network cast is read-only on a public preview
      {
        const refusal = await networkWriteRefusal(target);
        if (refusal) return NextResponse.json(refusal, { status: 403 });
      }
      const actor = body.personaId ? String(body.personaId) : activeSeedPersonaId();
      if (!SEED_VIEWER.personas.includes(actor) && !isOwnPersona(actor)) return NextResponse.json({ error: "not one of your personas" }, { status: 403 });
      const r = await reactFc(body.action, target, { personaId: actor });
      return NextResponse.json({ ...r, personaId: actor });
    }

    if (body.action === "follow") {
      // MULTI-FID Gate 2: follow a fid as the acting persona (its own account)
      const targetFid = Number(body.targetFid);
      if (!Number.isInteger(targetFid) || targetFid <= 0) return NextResponse.json({ error: "targetFid required" }, { status: 400 });
      // FC-READ: following a LIVE account (an fid no local record carries) would be a sim ledger row presented as
      // a Farcaster follow — refused on a relay-reading public device; seed/fixture fids are unchanged
      {
        const refusal = await networkFollowRefusal(targetFid);
        if (refusal) return NextResponse.json(refusal, { status: 403 });
      }
      const actor = body.personaId ? String(body.personaId) : activeSeedPersonaId();
      if (!SEED_VIEWER.personas.includes(actor) && !isOwnPersona(actor)) return NextResponse.json({ error: "not one of your personas" }, { status: 403 });
      const r = await followFc(targetFid, { personaId: actor });
      return NextResponse.json({ ...r, personaId: actor });
    }

    if (body.action === "delete") {
      const hash = String(body.hash ?? "");
      if (!hash) return NextResponse.json({ error: "hash required" }, { status: 400 });
      // FC-READ: a network cast read through the relay is someone else's — never this device's to retract
      {
        const refusal = await networkWriteRefusal(hash);
        if (refusal) return NextResponse.json(refusal, { status: 403 });
      }
      // MULTI-FID Gate 1: a delete goes out under the fid the cast was attributed to
      const attributed = state().fcAttribution.get(hash)?.personaId;
      // MULTI-FID Gate 5 (attack-fid-3 #15): the deleting persona must be one of the viewer's own, like every other action
      const actor = attributed ?? (body.personaId ? String(body.personaId) : activeSeedPersonaId());
      if (!SEED_VIEWER.personas.includes(actor) && !isOwnPersona(actor)) return NextResponse.json({ error: "not one of your personas" }, { status: 403 });
      const r = await deleteFcCast(hash, { personaId: actor });
      // deletes are advisory on Farcaster (hubs/indexers may retain) — the
      // attribution row goes too, since the cast it described is retracted
      state().fcAttribution.delete(hash);
      await persistNs("fcAttribution");
      return NextResponse.json(r);
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof FcWriteCapError) {
      // LOUD refusal, zero network attempts after it — the caller sees
      // exactly which cap and how much was used.
      return NextResponse.json({ error: e.message, cap: e.cap }, { status: 429 });
    }
    if (e instanceof FcIdentityError) {
      return NextResponse.json({ error: e.message, code: "FC_IDENTITY" }, { status: 403 });
    }
    // BUILD A review (PUB-2): the outcomes that are NOT "it may have gone through" — an earlier attempt of these exact
    // words is unconfirmed (nothing sent now), the check itself could not be made (nothing sent), or the network
    // answered no (nothing happened; the ledger entry is settled failed)
    if (e instanceof FcRetryUnconfirmedError) return NextResponse.json({ error: e.message, code: e.code, ambiguous: false }, { status: 409 });
    if (e instanceof FcRetryCheckError) return NextResponse.json({ error: e.message, code: e.code, ambiguous: false }, { status: 503 });
    if (isDefinitiveFailure(e)) return NextResponse.json({ error: (e as Error).message, code: "FC_REFUSED", ambiguous: false }, { status: 502 });
    // ambiguous transport failure: the pending ledger entry is the receipt
    // check-before-retry resumes from
    return NextResponse.json({ error: (e as Error).message, ambiguous: true }, { status: 502 });
  }
}
