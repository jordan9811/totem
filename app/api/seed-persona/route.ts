import { NextRequest, NextResponse } from "next/server";
import { SEED_PERSONA_COOKIE } from "@/lib/activePersona";
import { SEED_VIEWER, state } from "@/lib/adapters/mock/store";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { hasModeOverride } from "@/lib/session/ephemeral";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { personaId?: unknown; asRoot?: unknown };
  const { personaId } = body as { personaId?: string };
  // ACTING AS YOURSELF (lib/device/actingRoot.ts): {asRoot: true} on the live public site's device makes NO persona the
  // acting identity — the visitor's own Farcaster account (their public self) instead. Only for a visitor signed in with
  // Farcaster; never on a server, the rig or the preview (there the public self stays read-only and is refused below).
  if (body.asRoot === true) {
    const { liveDevice, actAsRoot } = await import("@/lib/device/actingRoot");
    if (!liveDevice()) return NextResponse.json({ error: "Acting as yourself is offered on the live site only.", code: "not_offered" }, { status: 400 });
    const { listPersonas } = await import("@/lib/identity/keystore");
    const self = listPersonas().find((p) => p.publicSelf === true);
    if (!self) return NextResponse.json({ error: "Sign in with Farcaster first: acting as yourself means acting as your Farcaster account.", code: "not_signed_in" }, { status: 409 });
    actAsRoot();
    return NextResponse.json({ ok: true, acting: "root", personaId: self.id });
  }
  // POST-DEPLOY Gate 1: a persona of this root may be acted as, whether it was seeded or minted here. The guard
  // used to read the seeded viewer's own snapshot alone, so a persona created by a fork or a clone could be
  // listed in the roster and still be unselectable — created, visible, and impossible to use. The session's
  // roster is the same list the picker draws, so the two now agree.
  const { getSession } = await import("@/lib/session");
  const session = await getSession();
  // PERSONA LAUNCH P1 (SIWF): the public self (the visitor's own Farcaster account, minted by Sign in with Farcaster)
  // is READ-ONLY: never the persona a post is made as. The switcher opens its profile instead; this is the door. Asked
  // FIRST (the keystore says whether the id is one of this device's public selves), so the refusal is the same whether
  // or not the session's roster lists it.
  {
    const { publicSelfRefusalFor } = await import("@/lib/identity/handleStem");
    const { getPersona } = await import("@/lib/identity/keystore");
    const who = typeof personaId === "string" ? personaId : null;
    const refusal = publicSelfRefusalFor(() => (who ? getPersona(who) : null));
    if (refusal) return NextResponse.json(refusal, { status: 403 });
  }
  const mine = new Set([...SEED_VIEWER.personas, ...session.personas.map((p) => p.id)]);
  if (!personaId || !mine.has(personaId)) {
    return NextResponse.json({ error: "unknown persona" }, { status: 400 });
  }
  // POST-DEPLOY Gate 2: REGISTER what we just accepted, so the cookie and the
  // resolver cannot disagree in a LATER request.
  //
  // GATE 5 (attack-post-1 F-7): the acceptance goes into a NARROW allowlist as well as
  // the rendering map. The rendering map holds every seeded account, so using it as the
  // resolver's ownership check meant a crafted cookie naming a stranger was honoured.
  //
  // This route validates ownership against the session roster, but the resolver
  // that reads the cookie afterwards (activeSeedPersonaId) is synchronous and can
  // only check the rendering map. On a cold process — or after a seed reset wiped
  // the map — the map has not been warmed for a roster persona, so the cookie this
  // route legitimately set resolved to the SEEDED DEFAULT instead, and every write
  // in that request landed on a different persona than the caller asked for. It
  // surfaced as a clone copying zero modes: the mode had been created for someone
  // else. Registering here makes the accepted switch survive into the next request
  // the way a switch is supposed to.
  const { allowActingAs, ROOT_HANDLE_COOKIE } = await import("@/lib/activePersona");
  const { cookies } = await import("next/headers");
  allowActingAs(personaId, cookies().get(ROOT_HANDLE_COOKIE)?.value ?? null);
  const { personaById, personaByHandle } = await import("@/lib/adapters/mock/store");
  if (!personaById.has(personaId)) {
    const p = session.personas.find((x) => x.id === personaId);
    if (p) {
      personaById.set(personaId, { id: p.id, rootId: session.rootId ?? "", name: p.name, handle: p.handle, avatarUrl: p.avatarUrl ?? "", bio: p.bio ?? "", cluster: "", tier: 1, demoTags: ["roster"] } as unknown as NonNullable<ReturnType<typeof personaById.get>>);
      if (!personaByHandle.has(p.handle)) personaByHandle.set(p.handle, personaById.get(personaId)!);
    }
  }
  const res = NextResponse.json({ ok: true, personaId });
  res.cookies.set(SEED_PERSONA_COOKIE, personaId, { path: "/" });
  // ACTING AS YOURSELF: a persona is named, so the tab no longer acts as itself (the device's marker goes)
  if (typeof window !== "undefined") (await import("@/lib/device/actingRoot")).actAsPersona(personaId);
  // LAYERS_WORLD=empty (review WORLD-ID-3): ONE identity — a switch here (Settings > Account & Personas) moves the
  // switcher's persona too, as /api/personas/active moves the acting one. (The session also prefers the acting
  // persona under the flag, so the two cannot name different personas even with a stale cookie.)
  const { isEmptyWorld } = await import("@/lib/world-flag");
  if (isEmptyWorld()) {
    const { PERSONA_COOKIE } = await import("@/lib/session");
    res.cookies.set(PERSONA_COOKIE, personaId, { path: "/" });
  }

  // UX Gate 1 — programmable bindings, the persona-default-mode half. Applied
  // ONLY on an explicit persona switch (this route), never on a read — same
  // "applied once, at the deliberate moment" discipline as the mode's own
  // pinnedPersonaId enforcement in /api/modes/active. An explicit in-session
  // mode swipe for this persona outranks the binding: "more specific wins."
  if (!hasModeOverride(personaId)) {
    const defaultModeId = state().personaDefaultMode.get(personaId);
    if (defaultModeId) {
      try {
        await retryAdapter(() => adapters.mode.setActive(personaId, defaultModeId));
      } catch {
        /* a stale/deleted binding target is not this route's problem to
           surface — the persona simply keeps whatever mode it already had */
      }
    }
  }
  return res;
}
