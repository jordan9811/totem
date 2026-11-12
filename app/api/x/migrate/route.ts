import { NextRequest, NextResponse } from "next/server";
// FOLLOW MIGRATION — matches, the one-confirm batch, and the per-user
// controls. Matching consults account attestations only; the pending list
// is hashed at rest and hashed HERE too — no plaintext identifier list
// crosses this surface.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { matchesFor, migrateAll, noticesFor, prefsFor, setPrefs } from "@/lib/x/migration";

export const dynamic = "force-dynamic";

export async function GET() {
  const personaId = activeSeedPersonaId();
  const { matches, pendingCount } = matchesFor(personaId);
  return NextResponse.json({
    matches: matches.map((m) => ({
      matchedHandle: m.matchedHandle,
      xHandle: m.xHandle,
      alreadyFollowing: m.alreadyFollowing,
    })),
    pendingCount,
    prefs: prefsFor(personaId),
    notices: noticesFor(personaId).map((n) => ({ kind: n.kind, text: n.text })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const personaId = activeSeedPersonaId();
  try {
    if (body.action === "migrate") {
      const result = await migrateAll(personaId);
      return NextResponse.json(result);
    }
    if (body.action === "prefs") {
      const prefs = await setPrefs(personaId, {
        ...(typeof body.deferred === "boolean" ? { deferred: body.deferred } : {}),
        ...(Array.isArray(body.excludedHandles) ? { excludedHandles: body.excludedHandles } : {}),
      });
      return NextResponse.json({ prefs });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
