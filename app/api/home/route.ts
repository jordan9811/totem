import { NextResponse } from "next/server";
// PROD-LIVE (D-CU-0-4) — THE HOME PAGE'S ACTING-PERSONA EXTRAS.
//
// /home used to read three things about the acting persona on the SERVER, beside the feed itself: what the
// composer must know about who is posting (composerPropsFor — kind, private audience, the mode's composer slots),
// the (persona) half of the header's (persona, mode) pill, and the timeline undo depth (UX Gate 2's one persisted
// knob). On a public deployment the server holds no identity, so it cannot read any of them; the browser device
// answers this route in-process instead (lib/device/host.ts), and the home island (components/home/HomeFeed.tsx)
// fetches it on mount. On the RIG the page still computes the same values on the server and never calls this
// route; it exists so the device can hand the island exactly what the server page would have.
//
// Never fails open: an unreadable store is a 503, and the island renders the composer DISABLED with a visible
// error rather than guessing a persona kind (a composer told "public" for a private persona would post in the
// open). composerPropsFor keeps its own documented semantics for the one read it degrades (an unreadable mode
// leaves the slots unrestricted, never empty).
import { activeSeedPersonaId } from "@/lib/activePersona";
import { composerPropsFor } from "@/lib/private/composerProps";
import { hydrate, personaById, state } from "@/lib/adapters/mock/store";

export const dynamic = "force-dynamic";

// route.ts may only export HTTP handlers + a small Next.js allowlist — a local constant, the same default
// /api/personas/bindings reports for a persona that never set one
const DEFAULT_UNDO_DEPTH = 3;

export async function GET() {
  try {
    // direct state() readers below (audience grants, the undo depth) — must not serve pre-hydration emptiness
    await hydrate();
    const personaId = activeSeedPersonaId();
    const composer = await composerPropsFor(personaId);
    const p = personaById.get(personaId);
    return NextResponse.json({
      personaId,
      // the same shape the server page hands ModePill (null where the page would hand it nothing)
      persona: p ? { id: personaId, handle: p.handle, name: p.name, avatarUrl: p.avatarUrl } : null,
      composer,
      undoDepth: state().timelineUndoDepth.get(personaId) ?? DEFAULT_UNDO_DEPTH,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "home extras unavailable" }, { status: 503 });
  }
}
