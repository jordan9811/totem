import { NextRequest, NextResponse } from "next/server";
import { eventIdempotencyKey, logEdgeEvent } from "@/lib/eventlog/log";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { blockedFor, blockPersona } from "@/lib/validator";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// "Block this persona" — ZK PASS 2 Gate 2 (migration 006). Blocks are
// PERSONA-LEVEL on the validator: ONE row per block action, written for
// the acting persona only. The device shares the block across ITS OWN
// personas at READ time (GET below; lib/policy.ts) — it knows its
// siblings, the validator never learns them. A fan-out WRITE (one row per
// own persona, in one burst) would have put siblings side by side in
// operator-visible rows: a persona → root signal, refused by design
// (SECURITY-POSTURE.md §10). The blocked account's OTHER personas are not
// reached at all — named in the UI and in the posture doc.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { personaId } = body;
  const session = await getSession();
  if (!session.active)
    return NextResponse.json({ error: "connect a signer first" }, { status: 401 });
  if (!personaId) return NextResponse.json({ error: "personaId required" }, { status: 400 });
  const ok = await blockPersona(session.active.id, personaId);
  if (ok) {
    // Both block paths log — this validator-backed one and block-seed. The
    // spec's warning was "there are more call sites than the obvious ones",
    // and this is exactly the one a grep for the mock adapter would miss.
    await logEdgeEvent({
      type: "block",
      actorPersonaId: activeSeedPersonaId(),
      targetPersona: personaId,
      triggeringCastId: body.triggeringCastId ?? null,
      context: body.context ?? "profile",
      idempotencyKey: eventIdempotencyKey(req, body),
    });
  }
  return NextResponse.json(
    { ok, fanout: "read-time, device-side", sharedAcross: session.personas.length },
    { status: ok ? 200 : 502 }
  );
}

/** The block list the feeds apply for the acting persona: the union of
 * every own persona's list — the device's knowledge, computed here. */
export async function GET() {
  const session = await getSession();
  if (!session.active)
    return NextResponse.json({ error: "connect a signer first" }, { status: 401 });
  const own = session.personas.length ? session.personas : [session.active];
  const lists = await Promise.all(own.map((p) => blockedFor(p.id)));
  return NextResponse.json({
    personaId: session.active.id,
    blocked: [...new Set(lists.flat())],
    sharedAcross: own.length,
    fanout: "read-time, device-side",
  });
}
