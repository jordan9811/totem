import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { SEED_PERSONA_COOKIE } from "@/lib/activePersona";
import { personaById } from "@/lib/adapters/mock/store";
import { markModeOverride } from "@/lib/session/ephemeral";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { modeId } = await req.json();
  if (!modeId) return NextResponse.json({ error: "modeId required" }, { status: 400 });
  try {
    const personaId = activeSeedPersonaId();
    await retryAdapter(() => adapters.mode.setActive(personaId, modeId));
    // UX Gate 1: this route is only ever reached by a direct user pick —
    // pill dropdown, swipe arrows. Mark the override BEFORE the pin branch
    // below, which can change the acting persona: the persona actually
    // being left (its mode choice) is the one that just picked explicitly.
    markModeOverride(personaId);
    const mode = await retryAdapter(() => adapters.mode.getActive(personaId));

    const res = NextResponse.json({ mode });
    // A mode that pins a persona switches who you are ACTING AS when you
    // activate it — that is what makes "Close Friends" a mode rather than a
    // filter. Applied only here, on explicit activation: modes are keyed by
    // persona, so applying a pin during a read would be a cycle (read mode ->
    // switch persona -> read that persona's mode -> ...).
    //
    // Validated against the seed: a pin naming a persona that does not exist
    // must not blank out the acting identity, because "nobody" is not a safe
    // default for who is posting.
    const pin = mode.pinnedPersonaId;
    if (pin && personaById.has(pin)) {
      res.cookies.set(SEED_PERSONA_COOKIE, pin, { path: "/" });
      // the pinned persona is now ALSO explicitly on this mode — without
      // this, switching away and back could let their own default-mode
      // binding silently displace the mode the user just picked
      markModeOverride(pin);
    }
    return res;
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json({ error: err.message }, { status: err.code === "NOT_FOUND" ? 404 : 503 });
  }
}
