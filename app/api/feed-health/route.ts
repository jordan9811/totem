import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { postByHash, state } from "@/lib/adapters/mock/store";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function GET() {
  const personaId = activeSeedPersonaId();
  try {
    const mode = await retryAdapter(() => adapters.mode.getActive(personaId));
    const [schedules, saturated, permission, inbox, reinjections] = await Promise.all([
      retryAdapter(() => adapters.feedHealth.getReadwiseSchedules(personaId)),
      retryAdapter(() => adapters.feedHealth.listSaturated(personaId, mode.id)),
      retryAdapter(() => adapters.feedHealth.getReceivePermission(personaId)),
      retryAdapter(() => adapters.feedHealth.inboxFor(personaId)),
      retryAdapter(() => adapters.feedHealth.reinjectionsFor(personaId)),
    ]);
    return NextResponse.json({ schedules, saturated, permission, inbox, reinjections });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

// Bookmark a long-form post → chunk it and schedule chunks back into the TL.
export async function POST(req: NextRequest) {
  const { postHash } = await req.json();
  const personaId = activeSeedPersonaId();
  const post = postByHash.get(postHash);
  if (!post) return NextResponse.json({ error: "unknown post" }, { status: 404 });
  try {
    state().bookmarks.add(postHash);
    // POST-DEPLOY Gate 4: cut at the ACTIVE MODE chunk width. The knob is a mode
    // preference, so the caller resolves it; the adapter never reads a vault.
    const { knobsFor } = await import("@/lib/readwise/state");
    const active = await retryAdapter(() => adapters.mode.getActive(personaId));
    const knobs = await knobsFor(active.id);
    const schedule = await retryAdapter(() => adapters.feedHealth.scheduleReadwise(postHash, personaId, post.text, knobs.chunkWords));
    return NextResponse.json({ schedule });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
