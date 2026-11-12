import { NextRequest, NextResponse } from "next/server";
// PROD-LIVE PASS (D-CU-0-4) — a profile, as the ACTING persona sees it: the header, the seeded posts, the linked-
// identities disclosure (PersonaResolver's answer for this viewer), the viewer's block state and the imported-from-X
// shelf. The page at app/(main)/[handle] computes exactly this on the rig and hands it to its island; on a public
// deployment the server holds no identity, so the island fetches this route and the browser device answers it
// in-process — which is also the only place a visitor's OWN persona (minted in the browser) can be resolved by handle.
//
// Relationship history is deliberately NOT here: event-log material is served only by the event-log endpoint family
// (/api/eventlog, /api/eventlog/history).
import { hydrate, personaByHandle } from "@/lib/adapters/mock/store";
import { getSession } from "@/lib/session";
import { profileView } from "@/lib/views/social.server";
import { PROFILE_MISSING } from "@/lib/views/social";
import { RelayReadError } from "@/lib/adapters/neynar/content";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const handle = req.nextUrl.searchParams.get("handle");
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });
  // PERSONA LAUNCH P1 (SIWF): ?live=1 is "Show my Farcaster posts here" on the visitor's OWN public self — honoured for
  // a publicSelf persona ONLY (any other handle answers 400, so live=1 can never become a relay lookup of an arbitrary
  // name), read by the FNAME from its sealed link, never automatically (lib/data.ts getPublicSelfLiveSourced).
  if (req.nextUrl.searchParams.get("live") === "1") {
    try {
      if (!personaByHandle.has(handle)) await getSession();
      const persona = personaByHandle.get(handle);
      const { publicSelfFacts } = await import("@/lib/fc/siwf/links");
      const facts = persona ? await publicSelfFacts(persona.id) : null;
      if (!facts) return NextResponse.json({ error: "live=1 is only for your own Farcaster account's profile", code: "not_public_self" }, { status: 400 });
      // SIGN IN WITH X: a root signed in with X only has no Farcaster account — its fname here is Totem's own handle, which
      // must never become a Farcaster lookup (it would read a stranger's profile under the visitor's name)
      if (facts.via === "x") return NextResponse.json({ error: "Your account here is your X account: there are no Farcaster posts to show. Connect Farcaster to add them.", code: "not_farcaster" }, { status: 409 });
      // NEYNAR AS A SWITCH (§42), THE HARD RULE: this read would name the visitor's own account to Totem's server (a relay
      // lookup of their fname from their address), so it is never made: their posts are read from Farcaster's network on
      // their own profile (/fc/profile) instead
      const { getPublicSelfLiveSourced } = await import("@/lib/data");
      const live = await getPublicSelfLiveSourced(facts.fname);
      if (!live)
        return NextResponse.json(
          { error: "Your own Farcaster posts are read from Farcaster's network, never through Neynar: that read would hand your account to Totem's server.", code: "names_you" },
          { status: 409 }
        );
      if (!live.user.value) return NextResponse.json({ error: PROFILE_MISSING }, { status: 404 });
      const relayed = [live.user.liveSource, live.casts.liveSource].filter((s) => s.source === "relay");
      const liveSource = relayed.length ? { source: "relay" as const, state: relayed.every((s) => s.state === "live") ? ("live" as const) : ("stale" as const) } : undefined;
      return NextResponse.json({ kind: "fixture", user: live.user.value, casts: live.casts.value, isSelf: false, network: true, ...(liveSource ? { liveSource } : {}) });
    } catch (e) {
      if (e instanceof RelayReadError) return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
      return NextResponse.json({ error: "Couldn't read your Farcaster posts right now. Try again.", code: "live_self_failed" }, { status: 503 });
    }
  }
  try {
    await hydrate(); // resolveIdentity and the import shelf read state() directly — never serve pre-hydration emptiness
    // A persona minted after the device booted (a fork, the composer's "new persona") reaches the handle map when
    // the session adopts the keystore roster. Ask for it before answering "no such account" about the viewer's own.
    if (!personaByHandle.has(handle)) await getSession();
    const view = await profileView(handle);
    if (!view) return NextResponse.json({ error: PROFILE_MISSING }, { status: 404 });
    // PERSONA LAUNCH P1 (SIWF): the public self's sealed facts (fname, verifiedAt, disconnected — never the fid) for the
    // "That's me" badge. lib/views/social.server.ts adds them where the view is built (byx's diff); this fills them in
    // when it has not, so the device's answer carries them either way. A publicSelf persona whose link cannot be read
    // THROWS here (503 below): never a profile that silently drops "disconnected".
    if (view.kind === "seeded" && !(view as { publicSelf?: unknown }).publicSelf) {
      const { publicSelfFacts } = await import("@/lib/fc/siwf/links");
      const facts = await publicSelfFacts(view.personaId);
      if (facts) return NextResponse.json({ ...view, publicSelf: facts });
    }
    return NextResponse.json(view);
  } catch (e) {
    // FC-READ: a network profile the read relay could not answer (switched off, out of budget, rate-limited,
    // unreachable) is NOT "no such account" — it is a 503 with the relay's fixed sentence and its code, so the island
    // shows the pause with a Retry instead of claiming the account does not exist
    // FC-READ (review): `error` is one of lib/views/social.ts LIVE_PAUSED_SENTENCES and `code` is always fc_read_*;
    // ProfileIsland renders that sentence as the paused state (data-testid "live-paused"), not the load-error block
    if (e instanceof RelayReadError) return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    return NextResponse.json({ error: (e as Error).message || "could not read this profile" }, { status: 503 });
  }
}
