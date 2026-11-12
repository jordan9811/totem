import { NextRequest, NextResponse } from "next/server";
import { persistedMockRep } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";
import { eventIdempotencyKey, logEdgeEvent } from "@/lib/eventlog/log";

export const dynamic = "force-dynamic";

// Blocks a SEEDED persona. Seeded personas live in seed data, not the
// validator DB, so this always routes to the mock rep adapter regardless of
// the registry's rep binding. Fan-out semantics are identical: resolves to
// the root, hides every persona of that root.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { personaId } = body;
  if (!personaId) return NextResponse.json({ error: "personaId required" }, { status: 400 });
  try {
    await retryAdapter(() => persistedMockRep.block(activeSeedPersonaId(), personaId));
    // The log entry carries WHICH cast triggered the block and WHERE — the
    // difference between "blocked @x" and a receipt you can act on later.
    await logEdgeEvent({
      type: "block",
      actorPersonaId: activeSeedPersonaId(),
      targetPersona: personaId,
      triggeringCastId: body.triggeringCastId ?? null,
      context: body.context ?? "cast_menu",
      idempotencyKey: eventIdempotencyKey(req, body),
    });
    // RETRIED, and deliberately NOT allowed to fail the request. This is a
    // read-back AFTER the block and the log entry have both landed. Letting
    // an unretried 2% adapter blip return 503 here reports failure for work
    // that actually succeeded. A client retry of this POST is now SAFE — a
    // block event's id is content-derived (type+actor+target+cast+context), so
    // a repeated block collapses to the same event rather than logging a
    // second one (the randomBytes-id double-log that sweeps 3 and 4 of the
    // final verification hit as "expected 1 block event, got 2" no longer
    // exists) — but a needless 503 on a convenience read-back is still worth
    // avoiding.
    let blocked: string[] = [];
    try {
      blocked = await retryAdapter(() => persistedMockRep.blockedFor(activeSeedPersonaId()));
    } catch {
      // The block IS applied; only the convenience read-back failed. Say so
      // honestly rather than either lying with [] or failing the whole call.
      return NextResponse.json({ ok: true, blockedPersonaIds: null, listUnavailable: true });
    }
    return NextResponse.json({ ok: true, blockedPersonaIds: blocked });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
