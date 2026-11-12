import { NextRequest, NextResponse } from "next/server";
import { createPersona } from "@/lib/validator";
import { getSession, PERSONA_COOKIE } from "@/lib/session";
import { ownRootId, recordPersona } from "@/lib/identity/rootRoster";
import { isEmptyWorld } from "@/lib/world";
import { localAvatar } from "@/lib/identity/localAvatar";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  // POST-DEPLOY Gate 2: the account switcher is a cross-persona surface — it is
  // the ORIGINAL one. Under compartment mode it lists the active persona and
  // nothing else, enforced HERE rather than by hiding a menu: a suppression that
  // only hides an element is one a view-source defeats.
  const { viewScope } = await import("@/lib/identity/chrome");
  const activeId = session.active?.id ?? null;
  const scope = await viewScope(activeId ?? "", session.personas.map((p) => p.id));
  const visible = new Set(scope.visiblePersonaIds);
  return NextResponse.json({
    personas: session.personas.filter((p) => visible.has(p.id)),
    scope: { compartment: scope.compartment, unified: scope.unified, reason: scope.reason },
    activeId: session.active?.id ?? null,
    // rootId deliberately absent: root material never leaves the keystore
    // (architecture-v3). A caller cannot group personas by root.
  });
}

// ZK PASS 2 Gate 2: the validator is told a persona exists — never which
// root made it. The grouping is recorded on the DEVICE (rootRoster).
export async function POST(req: NextRequest) {
  const { name, handle, avatarUrl = null, bio = null } = await req.json();
  // PROD-LIVE: inside the BROWSER DEVICE (a public deployment) "my personas" is the device's KEYSTORE — the session
  // shim lists what the keystore holds (lib/device/shims/session.ts). A validator-minted persona recorded in the
  // root roster is one the device session never lists and holds no keys for, so the account switcher's "Create
  // persona" answered 200 and the persona appeared nowhere (accept-prodlive #5). Mint it the way boot and the fork
  // route do: keystore-derived (its own signer and custody keys), rendered, and recorded in the roster.
  //
  // LAYERS_WORLD=empty (lib/world.ts) takes the SAME path on the server: there "my personas" is the server keystore's
  // real personas, and this is the plain "create persona" a first persona needs — the fork needs a source persona,
  // and a device with none has nothing to fork. The persona is minted by adapters.identity.createPersona (keystore-
  // derived, its own keys), recorded in the device roster only under a root this device registered (never the seeded
  // self's), and made both the switcher's active persona and the ACTING persona.
  const emptyWorld = isEmptyWorld();
  if (typeof window !== "undefined" || emptyWorld) {
    if (typeof name !== "string" || !name.trim() || typeof handle !== "string" || !/^[a-z0-9_]{1,30}$/i.test(handle))
      return NextResponse.json({ error: "a name and a handle (letters, digits, underscore) are required" }, { status: 400 });
    const { adapters } = await import("@/lib/adapters/registry");
    const { personaById, personaByHandle, SEED_VIEWER } = await import("@/lib/adapters/mock/store");
    const { realPersonas } = await import("@/lib/world");
    // review F7: a mint that LANDED while a later step failed (a persist, the roster, the sync) must be finished by the
    // retry, not answered 409 "that handle is taken" for the persona the first attempt made. A real persona of this
    // device with this handle AND this name is that persona: the steps below are idempotent, so they run again.
    const mintedBefore = (): ReturnType<typeof realPersonas>[number] | undefined => {
      try {
        return realPersonas().find((p) => p.handle === handle);
      } catch {
        return undefined;
      }
    };
    const prior = mintedBefore();
    const resuming = !!prior && prior.name === name.trim();
    if (personaByHandle.has(handle) && !resuming)
      return NextResponse.json(
        {
          error: prior
            ? "that handle belongs to a persona this device already created as " + JSON.stringify(prior.name) + " — submit it with that name to finish its setup, or pick another handle"
            : "that handle is taken",
          code: "handle_taken",
        },
        { status: 409 }
      );
    // CONNECT MAIN review (PL-4): on the owner service no persona's handle may share a name stem with the connected main
    // account's (matching names publicly link the persona to main). PERSONA LAUNCH P1 (SIWF): the browser device can
    // hold a main account now (Sign in with Farcaster's sealed accountLinks record), so the rule runs there too, through
    // lib/identity/mainName.ts (the connected record on a server, accountLinks wherever a sign-in can run). It THROWS on
    // an unreadable record: refused below, never guessed.
    if (!resuming) {
      let why: string | null;
      try {
        const { mainNameDerivation } = await import("@/lib/identity/mainName");
        why = await mainNameDerivation(handle);
      } catch (e) {
        return NextResponse.json({ error: "couldn't check this handle against your main account's name (" + (e as Error).message + ") — nothing was created. Try again.", code: "main_name_unchecked" }, { status: 503 });
      }
      if (why) return NextResponse.json({ error: why, code: "handle_stem" }, { status: 409 });
    }
    const session = await getSession();
    // review F7: the owner service is rig-shaped, so the mock adapters inject latency and a 2% synthetic failure — the
    // mint is RETRIED (as the fork route's is), and a failure is answered as JSON the form can show. Between attempts,
    // a persona the failed attempt DID mint is adopted rather than minted twice.
    type Created = { id: string; name: string; handle: string; avatarUrl: string | null; bio: string | null };
    let created: Created | null = resuming && prior ? { id: prior.id, name: prior.name, handle: prior.handle, avatarUrl: prior.avatarUrl ?? null, bio: prior.bio ?? null } : null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await adapters.identity.createPersona({
          name: name.trim(),
          handle,
          kind: "public",
          // PUBLIC GO-LIVE: drawn on the device (lib/identity/localAvatar.ts), never fetched from a third-party image host
          avatarUrl: avatarUrl ?? localAvatar(handle),
          bio: bio ?? "",
          cluster: null,
          forkedFrom: null,
        });
      } catch (e) {
        lastErr = e;
        const landed = mintedBefore();
        if (landed) created = { id: landed.id, name: landed.name, handle: landed.handle, avatarUrl: landed.avatarUrl ?? null, bio: landed.bio ?? null };
      }
    }
    if (!created) return NextResponse.json({ error: "could not create the persona: " + ((lastErr as Error)?.message ?? "unknown error") }, { status: 503 });
    personaById.set(created.id, {
      id: created.id,
      rootId: SEED_VIEWER.rootId,
      name: created.name,
      handle: created.handle,
      avatarUrl: created.avatarUrl ?? "",
      bio: created.bio ?? "",
      cluster: "",
      tier: 1,
      demoTags: ["device"],
    } as unknown as NonNullable<ReturnType<typeof personaById.get>>);
    personaByHandle.set(created.handle, personaById.get(created.id)!);
    const createdAt = Date.now();
    // LAYERS_WORLD=empty (review WORLD-ID-2 / F4): the device roster files the persona under THE SERVICE'S OWN ROOT
    // (lib/identity/rootRoster.ts ownRootId: this device's root, registered on first need under its anchor-derived
    // pseudo-fid — the root the ZK registration addresses) — never under the seeded self's fixture root, which the
    // fid fallback (getSelf().fid is still the seed self's 9152) resolved to: that filed every real persona under the
    // demo account's root and showed its seeded reputation tier on them. A roster that cannot be read REFUSES here
    // (ownRootId throws before anything is sealed; review WE-2): the persona is in the keystore, and the same request
    // again finishes the filing. The browser device keeps the root its own boot registered (the session's).
    try {
      const rosterRoot = emptyWorld ? await ownRootId() : session.rootId;
      if (rosterRoot) {
        await recordPersona(rosterRoot, created.id, { id: created.id, name: created.name, handle: created.handle, avatarUrl: created.avatarUrl ?? null, bio: created.bio ?? null, createdAt });
      }
      // the sealed identity roster is what an unlock on another device restores personas from
      const { syncRoster } = await import("@/lib/identity/roster");
      await syncRoster();
    } catch (e) {
      // review WE-2 / F7: the roster refused (it could not be read, so nothing was sealed over it). The persona IS in
      // the keystore; the same request again finishes these steps (the handle-and-name match above resumes it).
      return NextResponse.json(
        { error: "the persona was created, but its roster record could not be written (" + (e as Error).message + ") — submit the same name and handle again to finish", personaId: created.id, code: "roster_unavailable" },
        { status: 503 }
      );
    }
    const persona = { id: created.id, name: created.name, handle: created.handle, avatarUrl: created.avatarUrl ?? null, bio: created.bio ?? null, createdAt };
    const res = NextResponse.json({ persona });
    res.cookies.set(PERSONA_COOKIE, created.id, { path: "/" });
    // PROD-LIVE: PERSONA_COOKIE alone moved the switcher's checkmark and nothing else. The persona a post is made AS
    // is the session shim's activeSeedPersonaId(), which reads SEED_PERSONA_COOKIE (lib/device/shims/session.ts), so
    // a created persona was "active" in the switcher while the pill, the composer and every write stayed on the old
    // one. Make it the ACTING persona the way /api/seed-persona does: register it for this root handle
    // (allowActingAs — the device minted it into its own keystore just above, so it is this root's by construction)
    // and set the cookie the resolver reads. Dynamically imported, like the rest of this branch, so the rig path
    // below is untouched.
    const { SEED_PERSONA_COOKIE, ROOT_HANDLE_COOKIE, allowActingAs } = await import("@/lib/activePersona");
    const { cookies } = await import("next/headers");
    allowActingAs(created.id, cookies().get(ROOT_HANDLE_COOKIE)?.value ?? null);
    res.cookies.set(SEED_PERSONA_COOKIE, created.id, { path: "/" });
    // ACTING AS YOURSELF: the new persona acts now, so the tab no longer acts as itself (the device's marker goes)
    if (typeof window !== "undefined") (await import("@/lib/device/actingRoot")).actAsPersona(created.id);
    return res;
  }
  const session = await getSession();
  if (!session.rootId)
    return NextResponse.json({ error: "connect a signer first" }, { status: 401 });
  const persona = await createPersona({ name, handle, avatarUrl, bio });
  if (!persona) return NextResponse.json({ error: "persona creation failed" }, { status: 502 });
  await recordPersona(session.rootId, persona.id, { id: persona.id, name: persona.name, handle: persona.handle, avatarUrl: persona.avatarUrl, bio: persona.bio, createdAt: persona.createdAt });
  const res = NextResponse.json({ persona });
  res.cookies.set(PERSONA_COOKIE, persona.id, { path: "/" });
  return res;
}
