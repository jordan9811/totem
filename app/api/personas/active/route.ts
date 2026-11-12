import { NextRequest, NextResponse } from "next/server";
import { PERSONA_COOKIE } from "@/lib/session";
import { isEmptyWorld } from "@/lib/world";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { personaId } = await req.json();
  if (!personaId) return NextResponse.json({ error: "personaId required" }, { status: 400 });
  // LAYERS_WORLD=empty (lib/world.ts): the switcher's pick is one of the device's REAL personas or nothing, and it
  // moves the ACTING persona too (the composer, the pill, every write) — one identity, not the demo world's two
  // tracks. The persona is checked against the session roster (the keystore's), as /api/seed-persona checks it.
  if (isEmptyWorld()) {
    const { getSession } = await import("@/lib/session");
    const session = await getSession();
    if (!session.personas.some((p) => p.id === personaId)) return NextResponse.json({ error: "unknown persona" }, { status: 400 });
    // ACTING AS YOURSELF: the public self is never named as an acting PERSONA here (that would hide the root's own world
    // while acting as no one); acting as yourself is POST /api/seed-persona {asRoot: true}
    {
      const { publicSelfRefusalFor } = await import("@/lib/identity/handleStem");
      const { getPersona } = await import("@/lib/identity/keystore");
      const refusal = publicSelfRefusalFor(() => getPersona(String(personaId)));
      if (refusal) return NextResponse.json(refusal, { status: 403 });
    }
    const { allowActingAs, ROOT_HANDLE_COOKIE, SEED_PERSONA_COOKIE } = await import("@/lib/activePersona");
    const { cookies } = await import("next/headers");
    allowActingAs(personaId, cookies().get(ROOT_HANDLE_COOKIE)?.value ?? null);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(PERSONA_COOKIE, personaId, { path: "/" });
    res.cookies.set(SEED_PERSONA_COOKIE, personaId, { path: "/" });
    if (typeof window !== "undefined") (await import("@/lib/device/actingRoot")).actAsPersona(personaId);
    return res;
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PERSONA_COOKIE, personaId, { path: "/" });
  return res;
}
